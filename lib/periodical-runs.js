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
 * `effectiveHorizonMs` is RE-APPLIED here, inside the fold, rather than
 * trusted from the caller's `since` (review F2): a history row older than
 * `now - effectiveHorizonMs` is excluded from evidence entirely, inclusive at
 * the boundary (`$gte` parity with `listHistory`'s own `since` filter). This
 * is what makes the `never` claim above actually true of the code — without
 * it, a caller-side `since` narrower than what the fold enforces could still
 * leave an out-of-window row counted as evidence.
 *
 * `historyTtlMs` is required — an omitted/non-finite value throws rather than
 * silently degrading every unresolved template to `unknown` (review F4): the
 * store's retention window is a system contract this fold reasons about, not
 * per-row data tolerant of absence the way a single row's `dispatchedAt` is.
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
 * A lane's key is the row's `repo` field exactly as stored — no `.trim()`,
 * no case-folding (LIN-1932 §2). Mirrors `_formatItem`/`_formatHistoryItem`'s
 * own `doc.repo || null` coercion (lib/dispatch-store.js) rather than
 * introducing a second one; `repo: null` is the distinct default lane, never
 * "all repos" and never discarded.
 *
 * @param {Object} row
 * @returns {string|null}
 */
function _laneKey(row) {
  return row.repo || null;
}

/**
 * Fetch a per-template inner `Map`, creating it only at the moment of first
 * write (LIN-1932 §2, plan-review `f1ef4ad9` blocking finding) — callers
 * invoke this AFTER every guard that could skip the row, never before, so a
 * template with no writable row never gets an inner `Map` at all for that
 * accumulator, rather than an empty one `Math.max(...[])` could later choke
 * on.
 *
 * @param {Map} outer
 * @param {string} templateId
 * @returns {Map}
 */
function _getOrCreateLaneMap(outer, templateId) {
  let inner = outer.get(templateId);
  if (!inner) {
    inner = new Map();
    outer.set(templateId, inner);
  }
  return inner;
}

/** Records a lane's first-seen position for a template (queue rows scanned before history rows) — dedup, not a full row list. */
function _recordLaneOrder(laneOrderByTemplate, templateId, lane) {
  let order = laneOrderByTemplate.get(templateId);
  if (!order) {
    order = [];
    laneOrderByTemplate.set(templateId, order);
  }
  if (!order.includes(lane)) order.push(lane);
}

/**
 * Fold queue + history rows into per-template run state, per-`(periodicalId,
 * repo)` lane (LIN-1932). Each of `hasRecentQueueRow`, `runsByTemplate`, and
 * `lastDispatchedByTemplate` is a nested `Map<templateId, Map<laneKey,
 * value>>` — nested Maps, not a delimited composite key, because `repo` is
 * an arbitrary ≤1000-char opaque string and no delimiter is safe to compose
 * a key with. Rule 1 (a live queue row means `recent`) is now per-lane: an
 * in-flight run against repo A marks only repo A's lane, not every lane of
 * that template — the queue-half of the bug this ticket fixes.
 *
 * The top-level (repo-ignorant) view is DERIVED from the lane maps, not kept
 * as a second, parallel accumulation: `runs` sums every lane, `lastDispatchedAt`
 * is the max across lanes, `daysSince` is recomputed from that aggregated
 * timestamp (never a min/max of the lanes' own `daysSince`), and the queue
 * rule is "any lane has a queue row". This reproduces the exact pre-refactor
 * scalar behaviour, which was already an aggregate over all rows regardless
 * of repo.
 *
 * @param {Array<{id: string, title: string, mode?: string, cadence?: string}>} templates - The live periodicals registry (lib/periodicals.js's `PERIODICALS`).
 * @param {Object} rows
 * @param {Array} [rows.queueRows] - Formatted dispatch-queue rows (`_formatItem` shape) read under `PERIODICAL_PROJECTION`.
 * @param {Array} [rows.historyRows] - Formatted dispatch-history rows (`_formatHistoryItem` shape) read under `PERIODICAL_PROJECTION`.
 * @param {Object} opts
 * @param {number} opts.now - Injected clock, epoch ms.
 * @param {number} [opts.horizonMs] - How far back a caller wants to look. Defaults to `DEFAULT_HORIZON_MS`.
 * @param {number} opts.historyTtlMs - The store's actual history retention window, in ms (its `historyTtl` option, in ms not seconds).
 * @returns {Array<{periodicalId: string, title: string, mode: string|undefined, cadence: string|undefined, lastDispatchedAt: number|null, runs: number, daysSince: number|null, state: 'due'|'recent'|'never'|'unknown', repos: Array<{repo: string|null, isDefault: boolean, lastDispatchedAt: number|null, runs: number, daysSince: number|null, state: 'due'|'recent'|'never'|'unknown'}>}>}
 */
export function foldPeriodicalRuns(templates, { queueRows = [], historyRows = [] } = {}, { now, horizonMs = DEFAULT_HORIZON_MS, historyTtlMs } = {}) {
  if (!Array.isArray(templates)) return [];
  if (!Number.isFinite(historyTtlMs)) {
    throw new TypeError('foldPeriodicalRuns: opts.historyTtlMs is required and must be a finite number (the store\'s historyTtl, in ms)');
  }

  const effectiveHorizonMs = Math.min(horizonMs, historyTtlMs);
  const horizonCutoff = now - effectiveHorizonMs;

  const hasRecentQueueRow = new Map();
  const runsByTemplate = new Map();
  const lastDispatchedByTemplate = new Map();
  const laneOrderByTemplate = new Map();

  for (const row of queueRows || []) {
    if (!row || _isExcluded(row)) continue;
    const template = _resolveTemplateForRow(row, templates);
    if (!template) continue;
    const lane = _laneKey(row);
    _recordLaneOrder(laneOrderByTemplate, template.id, lane);
    _getOrCreateLaneMap(hasRecentQueueRow, template.id).set(lane, true);
  }

  for (const row of historyRows || []) {
    if (!row || _isExcluded(row) || row.status !== 'taken') continue;
    const template = _resolveTemplateForRow(row, templates);
    if (!template) continue;
    const ts = _epoch(row.dispatchedAt);
    if (ts === null) continue;
    if (ts < horizonCutoff) continue;
    const lane = _laneKey(row);
    _recordLaneOrder(laneOrderByTemplate, template.id, lane);

    const runsInner = _getOrCreateLaneMap(runsByTemplate, template.id);
    runsInner.set(lane, (runsInner.get(lane) || 0) + 1);

    const lastInner = _getOrCreateLaneMap(lastDispatchedByTemplate, template.id);
    const currentMax = lastInner.get(lane);
    if (currentMax === undefined || ts > currentMax) {
      lastInner.set(lane, ts);
    }
  }

  return templates.map(template => {
    const laneQueue = hasRecentQueueRow.get(template.id);        // Map<laneKey, true> | undefined
    const laneRuns = runsByTemplate.get(template.id);             // Map<laneKey, number> | undefined
    const laneLast = lastDispatchedByTemplate.get(template.id);   // Map<laneKey, epochMs> | undefined

    // hasRecentQueueRow's inner Map only ever holds `true`, so "any lane has
    // a queue row" reduces to "the inner Map is non-empty" — the exact
    // repo-ignorant semantic the original single queue row already had.
    const hasAnyRecentQueueRow = laneQueue ? laneQueue.size > 0 : false;
    const runs = laneRuns ? [...laneRuns.values()].reduce((a, n) => a + n, 0) : 0;
    // Guarded on size, not presence (plan-review f1ef4ad9 blocking finding):
    // an inner Map that exists but is empty would send Math.max() an empty
    // argument list, returning -Infinity, which throws RangeError once a
    // caller does `new Date(-Infinity).toISOString()` at the wire boundary.
    const lastDispatchedAt = laneLast?.size ? Math.max(...laneLast.values()) : null;
    const ageMs = lastDispatchedAt === null ? null : now - lastDispatchedAt;
    // Recomputed from the aggregated lastDispatchedAt, never derived from
    // the lanes' own daysSince values — a future-dated lane yields
    // daysSince: null while still contributing a real timestamp to the max.
    const daysSince = ageMs === null || ageMs < 0 ? null : Math.floor(ageMs / DAY_MS);

    let state;
    if (hasAnyRecentQueueRow) {
      state = 'recent';
    } else if (lastDispatchedAt !== null) {
      state = ageMs >= resolveCadenceMs(template.cadence) ? 'due' : 'recent';
    } else {
      state = effectiveHorizonMs === historyTtlMs ? 'never' : 'unknown';
    }

    // Lane order: default (null) lane first when present, then other repos
    // in first-seen traversal order (queue rows scanned before history
    // rows) — mirrors knownWorkspaceRepos's own first-seen dedup
    // convention. A template with no matched row at all (rawOrder empty)
    // still synthesizes a single default lane — never `repos: []`.
    const rawOrder = laneOrderByTemplate.get(template.id) || [];
    const laneKeys = rawOrder.length
      ? [...(rawOrder.includes(null) ? [null] : []), ...rawOrder.filter(k => k !== null)]
      : [null];

    const repos = laneKeys.map(lane => {
      const laneLastDispatchedAt = laneLast?.get(lane) ?? null;
      const laneRunsCount = laneRuns?.get(lane) || 0;
      const laneHasQueueRow = laneQueue?.get(lane) === true;
      const laneAgeMs = laneLastDispatchedAt === null ? null : now - laneLastDispatchedAt;
      const laneDaysSince = laneAgeMs === null || laneAgeMs < 0 ? null : Math.floor(laneAgeMs / DAY_MS);

      let laneState;
      if (laneHasQueueRow) {
        laneState = 'recent';
      } else if (laneLastDispatchedAt !== null) {
        laneState = laneAgeMs >= resolveCadenceMs(template.cadence) ? 'due' : 'recent';
      } else {
        laneState = effectiveHorizonMs === historyTtlMs ? 'never' : 'unknown';
      }

      return {
        repo: lane,
        isDefault: lane === null,
        lastDispatchedAt: laneLastDispatchedAt,
        runs: laneRunsCount,
        daysSince: laneDaysSince,
        state: laneState
      };
    });

    return {
      periodicalId: template.id,
      title: template.title,
      mode: template.mode,
      cadence: template.cadence,
      lastDispatchedAt,
      runs,
      daysSince,
      state,
      repos
    };
  });
}
