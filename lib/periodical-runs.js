/**
 * lib/periodical-runs.js
 *
 * The ledger for periodicals (LIN-1827, sub-ticket of LIN-373 Approach C,
 * Phase 2 + G2 of the revision-2 plan): what ran, when, how often, or that we
 * cannot tell. This module computes NO trigger and dispatches NOTHING —
 * LIN-1629 owns turning a fold result into a dispatch decision. It only folds
 * queue + history rows into per-template run state.
 *
 * Pure, network-free, `now`-injected — the same discipline as
 * lib/credential-state.js / lib/live-console.js. The module never touches the
 * store; `historyTtlMs` arrives as a plain number so the fold can reason about
 * the store's actual retention window without importing the store (a Mongo
 * projection literal is storage dialect the store owns — see
 * PERIODICAL_PROJECTION, lib/dispatch-store.js).
 *
 * Load-bearing rules, in the order they resolve a template's `state`:
 *
 *  1. Any matched, non-excluded QUEUE row → `recent`, unconditionally,
 *     regardless of what history alone would say. Queue docs carry no
 *     `status` field at all (a queue row is inherently live), so this is
 *     what stops an in-flight periodical reading `due` and getting
 *     double-dispatched.
 *  2. Else, a matched HISTORY row counts as evidence of a real run only when
 *     `status === 'taken'` — a `cancelled`/`expired` row was queued and never
 *     claimed. Compared against cadence in MILLISECONDS, never through the
 *     floored `daysSince` display field: at exactly one cadence period
 *     elapsed the state is `due` (`>=`, not `>`).
 *  3. Else (no matched row at all): `never` is a BOUNDED claim — "no evidence
 *     in the full window the store can still hold" — never "never ran".
 *     `effectiveHorizonMs = Math.min(horizonMs, historyTtlMs)` caps the read
 *     at the store's guaranteed-retention window; when that cap is the
 *     store's own TTL the absence is conclusive (`never`), otherwise the
 *     window was narrower than the store could prove and the read is
 *     `unknown`. `unknown` is unreachable by any production caller today (no
 *     caller narrows `historyTtlMs`/`horizonMs` below their 30-day defaults)
 *     but is kept as a defensive branch for a narrower horizon.
 *
 * A row stamped with a `periodicalId` that matches no current template is
 * tolerated silently and deliberately — both dispatch routes validate the
 * registry only at ingest time (routes/proxy.js, routes/dispatch.js), so a
 * non-matching id names a since-removed template, not malformed input. The
 * title fallback (`promptName === template.title`, prefix-tolerant for
 * `"<title> + Autopilot"`) applies only to rows with no `periodicalId` at
 * all, and an ambiguous title match (a row's `promptName` matching two or
 * more templates) resolves to no template rather than shared evidence.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** Cadence vocabulary → milliseconds. Weekly-only today (LIN-1827 G2); every registry entry's `cadence` is currently `'weekly'`. */
export const CADENCE_MS = { weekly: WEEK_MS };

/** Fallback cadence for an unrecognised or absent `cadence` string. */
export const DEFAULT_CADENCE_MS = WEEK_MS;

/** Default read-back horizon: 30 days. */
export const DEFAULT_HORIZON_MS = 30 * DAY_MS;

/**
 * Normalise a template's `cadence` display string into milliseconds. Tolerant
 * of casing/whitespace/absence, same normalisation idiom as `statusToKind`
 * (lib/live-console.js:76-83); anything unrecognised resolves to
 * `DEFAULT_CADENCE_MS` rather than throwing.
 *
 * @param {string} [cadence]
 * @returns {number}
 */
export function resolveCadenceMs(cadence) {
  const key = String(cadence || '').trim().toLowerCase();
  return CADENCE_MS[key] ?? DEFAULT_CADENCE_MS;
}

/**
 * Parse a `dispatchedAt`-shaped value (ISO string, Date, or garbage) into an
 * epoch ms number, or null when unparseable. Copied verbatim from
 * lib/live-console.js's `_epoch` — the same tolerant-timestamp idiom.
 *
 * @param {*} value
 * @returns {number|null}
 */
function _epoch(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Resolve which template (if any) a queue/history row belongs to.
 * `periodicalId` wins when present — matched only against the live registry,
 * never falling back to a title match on a stamped-but-unmatched id (a
 * since-removed template, per the module docstring). Absent `periodicalId`
 * falls back to an exact-or-`" + Autopilot"`-suffix title match; an
 * ambiguous match (≥2 templates) resolves to no template.
 *
 * @param {Object} row
 * @param {Array} templates
 * @returns {Object|null}
 */
function _resolveTemplateForRow(row, templates) {
  if (row.periodicalId) {
    return templates.find(t => t.id === row.periodicalId) || null;
  }
  const promptName = row.promptName;
  const matches = templates.filter(
    t => promptName === t.title || promptName === `${t.title} + Autopilot`
  );
  return matches.length === 1 ? matches[0] : null;
}

/** A row queued/archived as a followUp or an abort is never run evidence. */
function _isExcluded(row) {
  return row.followUpTo != null || row.abort === true;
}

/**
 * Fold queue + history rows into per-template run state.
 *
 * @param {Array<{id: string, title: string, mode?: string, cadence?: string}>} templates - The live periodicals registry (lib/periodicals.js's `PERIODICALS`).
 * @param {Object} rows
 * @param {Array} [rows.queueRows] - Formatted dispatch-queue rows (`_formatItem` shape) read under `PERIODICAL_PROJECTION`.
 * @param {Array} [rows.historyRows] - Formatted dispatch-history rows (`_formatHistoryItem` shape) read under `PERIODICAL_PROJECTION`.
 * @param {Object} opts
 * @param {number} opts.now - Injected clock, epoch ms.
 * @param {number} [opts.horizonMs] - How far back a caller wants to look. Defaults to `DEFAULT_HORIZON_MS`.
 * @param {number} opts.historyTtlMs - The store's actual history retention window, in ms (its `historyTtl` option, in ms not seconds).
 * @returns {Array<{periodicalId: string, title: string, mode: string|undefined, cadence: string|undefined, lastDispatchedAt: number|null, runs: number, daysSince: number|null, state: 'due'|'recent'|'never'|'unknown'}>}
 */
export function foldPeriodicalRuns(templates, { queueRows = [], historyRows = [] } = {}, { now, horizonMs = DEFAULT_HORIZON_MS, historyTtlMs } = {}) {
  if (!Array.isArray(templates)) return [];

  const effectiveHorizonMs = Math.min(horizonMs, historyTtlMs);

  const hasRecentQueueRow = new Map();
  const runsByTemplate = new Map();
  const lastDispatchedByTemplate = new Map();

  for (const row of queueRows || []) {
    if (!row || _isExcluded(row)) continue;
    const template = _resolveTemplateForRow(row, templates);
    if (!template) continue;
    hasRecentQueueRow.set(template.id, true);
  }

  for (const row of historyRows || []) {
    if (!row || _isExcluded(row) || row.status !== 'taken') continue;
    const template = _resolveTemplateForRow(row, templates);
    if (!template) continue;
    const ts = _epoch(row.dispatchedAt);
    if (ts === null) continue;
    runsByTemplate.set(template.id, (runsByTemplate.get(template.id) || 0) + 1);
    const currentMax = lastDispatchedByTemplate.get(template.id);
    if (currentMax === undefined || ts > currentMax) {
      lastDispatchedByTemplate.set(template.id, ts);
    }
  }

  return templates.map(template => {
    const lastDispatchedAt = lastDispatchedByTemplate.get(template.id) ?? null;
    const runs = runsByTemplate.get(template.id) || 0;
    const ageMs = lastDispatchedAt === null ? null : now - lastDispatchedAt;
    const daysSince = ageMs === null || ageMs < 0 ? null : Math.floor(ageMs / DAY_MS);

    let state;
    if (hasRecentQueueRow.get(template.id)) {
      state = 'recent';
    } else if (lastDispatchedAt !== null) {
      state = ageMs >= resolveCadenceMs(template.cadence) ? 'due' : 'recent';
    } else {
      state = effectiveHorizonMs === historyTtlMs ? 'never' : 'unknown';
    }

    return {
      periodicalId: template.id,
      title: template.title,
      mode: template.mode,
      cadence: template.cadence,
      lastDispatchedAt,
      runs,
      daysSince,
      state
    };
  });
}
