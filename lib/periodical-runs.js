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
 * store; `historyTtlMs` arrives as a plain number naming the read window the
 * fold reasons about, without importing the store (a Mongo projection literal
 * is storage dialect the store owns — see PERIODICAL_PROJECTION,
 * lib/dispatch-store.js).
 *
 * Load-bearing rules, in the order they resolve a template's `state`:
 *
 *  1. Any matched, non-excluded QUEUE row → `recent`, unconditionally,
 *     regardless of what history alone would say. Queue docs carry no
 *     `status` field at all (a queue row is inherently live), so this is
 *     what stops an in-flight periodical reading `due` and getting
 *     double-dispatched.
 *  2. Else, a matched HISTORY row counts as evidence of a real run only when
 *     BOTH `status === 'taken'` (a `cancelled`/`expired` row was queued and
 *     never claimed) AND its `feedback[]` carries a terminal `done`/`complete`
 *     marker, via `deriveTerminalStatus` (lib/dispatch-terminal.js) — LIN-2385:
 *     a mint that was claimed and then `[failed]`/`[aborted]`/never reported
 *     is still `status: 'taken'` but must not reset the cadence clock. Compared
 *     against cadence in MILLISECONDS, never through the floored `daysSince`
 *     display field: at exactly one cadence period elapsed the state is `due`
 *     (`>=`, not `>`).
 *  2b. LIN-4381: a lane that rule 2 reads `recent` reads `landed` instead when
 *     work has landed in its repo since its last run (see `_landedSince`): the
 *     template is `scope: 'repo'`, the lane has no queue row, a same-repo
 *     landing not on a Periodical's own issue merged after the lane's last run,
 *     and at least `LANDED_MIN_GAP_MS` has passed since that run. `due` is never
 *     overridden (the weekly floor wins), and neither is rule 1's `recent`.
 *     The top level ages from the newest run across lanes, so a top level
 *     reading `due` has every lane `due`; `landed` only ever replaces `recent`.
 *  3. Else (no matched row at all): `never` is a BOUNDED claim — "no evidence
 *     in the read window" — never "never ran".
 *     `effectiveHorizonMs = Math.min(horizonMs, historyTtlMs)` caps the read
 *     at the narrower of the caller's `horizonMs` and the supplied read-window
 *     input. Production feeds the shared 30-day READ horizon for both
 *     (`READ_HORIZON_MS`, LIN-3161); evidence is lifetime-retained (LIN-3163),
 *     so there is no store TTL to cap against. When the two agree the absence
 *     is conclusive (`never`); when the caller asked for a window narrower
 *     than that input the read is `unknown`. `unknown` is unreachable by any
 *     production caller today (no caller narrows `historyTtlMs`/`horizonMs`
 *     below their 30-day defaults) but is kept as a defensive branch for a
 *     narrower horizon.
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
 * read window is a system contract this fold reasons about, not per-row data
 * tolerant of absence the way a single row's `dispatchedAt` is.
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

import { deriveTerminalStatus } from './dispatch-terminal.js';
import { toEpochMs } from './utils/time.js';

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
 * LIN-4381: the least time since a lane's last run before landed work can make
 * it read `landed`. Landings batch into the next reading, so a lane re-reads at
 * most once a day. This is the one dial if the spend needs turning.
 */
export const LANDED_MIN_GAP_MS = DAY_MS;

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
 * LIN-4381: one spelling of a repo for comparison. Lowercased, without a
 * `https://github.com/` prefix, a trailing `/` or `.git`. GitHub repo names
 * compare case-insensitively elsewhere too (`prReadToken`,
 * lib/github-pr-status.js; lib/ci-wake-sweep.js).
 */
function _repoSpelling(repo) {
  return String(repo).trim().toLowerCase()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
}

/**
 * LIN-4381: whether a landing's repo (`owner/name`, from its PR URL) is this
 * lane's repo. A lane's `repo` is the runner's folder override (a folder
 * basename, e.g. `LinearViewer`; LIN-2075) or any `owner/name` spelling. A lane
 * spelled `owner/name` matches only that repo; a bare name matches the
 * landing's name part. The default (null) lane matches every landing: Harbour
 * cannot name the runner's default folder, and every lane today is that one.
 */
function _laneMatchesRepo(lane, landingRepo) {
  if (lane === null) return true;
  if (!landingRepo) return false;
  const laneSpelling = _repoSpelling(lane);
  const landingSpelling = _repoSpelling(landingRepo);
  if (laneSpelling.includes('/')) return laneSpelling === landingSpelling;
  return laneSpelling === landingSpelling.split('/').pop();
}

/**
 * LIN-4381: the issues any Periodical row names. A landing on one of these is
 * a Periodical's own PR (its Stage-2 review task's), not work for it to read.
 * Without this, each review's merge would make every lane `landed` again.
 *
 * Load-bearing dependency: it holds only while Stage-2 rows name the review
 * issue AND carry `periodicalId`, so they reach this fold at all. Two writers do
 * that today: the kickoff's opening stamp (`periodicalId` on the chain-opening
 * `POST /recommend-and-dispatch`, lib/prompts/autopilot-kickoff.js) and
 * `resolvePeriodicalIdFromGateMarker` (lib/periodicals.js), which stamps every
 * recommend-and-dispatch on a gate-marked issue (LIN-2575). The route's reads
 * must also project `issueIdentifier` (PERIODICAL_PROJECTION,
 * lib/dispatch-store.js). A change to any of these must keep this exclusion
 * working; tests/unit/lin-4381-landed-route.test.js witnesses it end to end.
 *
 * Every row counts, whatever its status or terminal marker: a Stage-2 run that
 * failed or is still running names its review issue just the same.
 *
 * Rows come from the route's 30-day read window, the same window as the
 * landings read. That is enough: a Periodical's own PR merges after its Stage-2
 * row was dispatched, so the row is always newer than the landing it excludes,
 * and a landing still inside the window has its row inside it too. Narrowing
 * one read without the other would break that.
 */
function _periodicalIssues(rows, templates) {
  const issues = new Set();
  for (const row of rows) {
    if (!row || !row.issueIdentifier) continue;
    if (row.kind === 'periodical' || row.periodicalId != null || _resolveTemplateForRow(row, templates)) {
      issues.add(row.issueIdentifier);
    }
  }
  return issues;
}

/**
 * LIN-4381: landings as the fold uses them: a finite merge time, and not on a
 * Periodical's own issue.
 */
function _usableLandings(landings, periodicalIssues) {
  const usable = [];
  for (const landing of Array.isArray(landings) ? landings : []) {
    if (!landing) continue;
    const mergedAt = toEpochMs(landing.mergedAt);
    if (mergedAt === null) continue;
    if (landing.issueIdentifier && periodicalIssues.has(landing.issueIdentifier)) continue;
    usable.push({ repo: landing.repo || null, mergedAt });
  }
  return usable;
}

/**
 * LIN-4381: whether a lane that would read `recent` reads `landed` (rule 2b).
 * The caller has already settled that the lane has no queue row and has not
 * reached its cadence.
 */
function _landedSince(template, lane, lastRunAt, now, landings) {
  if (template.scope !== 'repo') return false;
  if (now - lastRunAt < LANDED_MIN_GAP_MS) return false;
  return landings.some(l => l.mergedAt > lastRunAt && _laneMatchesRepo(lane, l.repo));
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
 * @param {Array<{repo: string|null, mergedAt: string|number, issueIdentifier: string|null}>} [rows.landings] - LIN-4381:
 *   the workspace's landings (merged close-out events): `repo` is the PR's `owner/name`, `mergedAt` the forge merge
 *   time. Data only — the route reads them; empty (a failed read) means no lane reads `landed`.
 * @param {Object} opts
 * @param {number} opts.now - Injected clock, epoch ms.
 * @param {number} [opts.horizonMs] - How far back a caller wants to look. Defaults to `DEFAULT_HORIZON_MS`.
 * @param {number} opts.historyTtlMs - The reporting-window input, in ms. Production feeds the shared 30-day READ horizon (`READ_HORIZON_MS`, LIN-3161); it is no longer a store retention value — dispatch-history is lifetime-retained (LIN-3163).
 * @returns {Array<{periodicalId: string, title: string, mode: string|undefined, cadence: string|undefined, lastDispatchedAt: number|null, runs: number, daysSince: number|null, state: 'due'|'landed'|'recent'|'never'|'unknown', repos: Array<{repo: string|null, isDefault: boolean, lastDispatchedAt: number|null, runs: number, daysSince: number|null, state: 'due'|'landed'|'recent'|'never'|'unknown'}>}>}
 */
export function foldPeriodicalRuns(templates, { queueRows = [], historyRows = [], landings = [] } = {}, { now, horizonMs = DEFAULT_HORIZON_MS, historyTtlMs } = {}) {
  if (!Array.isArray(templates)) return [];
  if (!Number.isFinite(historyTtlMs)) {
    throw new TypeError('foldPeriodicalRuns: opts.historyTtlMs is required and must be a finite number (the read-horizon input, in ms)');
  }

  const effectiveHorizonMs = Math.min(horizonMs, historyTtlMs);
  const horizonCutoff = now - effectiveHorizonMs;

  const hasRecentQueueRow = new Map();
  const runsByTemplate = new Map();
  const lastDispatchedByTemplate = new Map();
  const laneOrderByTemplate = new Map();

  // LIN-4381: self-exclusion first, over every row, then the landings left.
  const periodicalIssues = _periodicalIssues([...(queueRows || []), ...(historyRows || [])], templates);
  const usableLandings = _usableLandings(landings, periodicalIssues);

  for (const row of queueRows || []) {
    if (!row || _isExcluded(row)) continue;
    const template = _resolveTemplateForRow(row, templates);
    if (!template) continue;
    const lane = _laneKey(row);
    _recordLaneOrder(laneOrderByTemplate, template.id, lane);
    _getOrCreateLaneMap(hasRecentQueueRow, template.id).set(lane, true);
  }

  for (const row of historyRows || []) {
    if (!row || _isExcluded(row) || row.status !== 'taken' || deriveTerminalStatus(row.feedback) !== 'done') continue;
    const template = _resolveTemplateForRow(row, templates);
    if (!template) continue;
    const ts = toEpochMs(row.dispatchedAt);
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
    // rows) — a stable first-seen dedup convention. A template with no
    // matched row at all (rawOrder empty)
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
        if (laneState === 'recent' && _landedSince(template, lane, laneLastDispatchedAt, now, usableLandings)) {
          laneState = 'landed';
        }
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

    // LIN-4381: the top level reads `landed` when it would read `recent` and a
    // lane reads `landed`. `due`, `never` and `unknown` are left as they are.
    // This holds even while another lane has a queued run (which made the top
    // level `recent`): the per-lane state is authoritative, and the kickoff
    // tells a run to check each lane's own state before acting.
    const topState = state === 'recent' && repos.some(r => r.state === 'landed') ? 'landed' : state;

    return {
      periodicalId: template.id,
      title: template.title,
      mode: template.mode,
      cadence: template.cadence,
      lastDispatchedAt,
      runs,
      daysSince,
      state: topState,
      repos
    };
  });
}
