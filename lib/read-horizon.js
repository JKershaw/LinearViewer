/**
 * lib/read-horizon.js
 *
 * The two read rules: the shared 30-day REPORTING window (LIN-3157 A1), and the TASK-LIFE rule (LIN-4404).
 *
 * Neither is a storage-retention constant. Evidence stores are
 * retained for the life of the project (LIN-3157/LIN-3163 — no expiry, no
 * evictor). The rules say how much of that history a read looks at:
 *
 *  - REPORTING WINDOW (30 days). Every published reporting window (periodicals,
 *    `/kpis`, workspace spend, pipeline loops) stays fixed at 30 days so
 *    published figures do not silently widen. Consumers derive their query
 *    bound from here (`readHorizonStart`) instead of from a store's TTL, which
 *    keeps the read horizon and the retention policy as separate quantities.
 *    Where a store defaults a missing bound, it defaults to this window
 *    (`listInHorizon`, lib/llm-call-log.js), and that stays so.
 *
 *  - TASK LIFE (LIN-4404, the size ruling on LIN-4395). A task's own reads cover
 *    its whole life: `/cost/:identifier` (lib/task-cost-read.js) and the task
 *    page's session reads. They are bounded by the task's identity keys, never by
 *    time. The rule takes one of two forms, by the store read it bounds:
 *      - An identity-keyed dispatch-history read (`listHistory` by
 *        `issueIdentifier` or `rootItemId`) passes NO `since`. The identity key
 *        already bounds it (dispatch-store.js `assertBoundedHistoryRead`), and a
 *        `Date` bound there would add `dispatchedAt: {$gte}`, which skips a row
 *        that has no `dispatchedAt`. pipeline-loops' `horizon: TASK_LIFE_HORIZON`
 *        (`'all'`, LIN-3328: the task page's Stages and run evidence) is this
 *        same form for the loop read: no store `since` and no build cutoff.
 *      - A store read whose missing bound means 30 days (`listInHorizon`) is
 *        passed `taskLifeStart()`: an explicit bound that admits every record. It
 *        is a `Date` for the reason `readHorizonStart` gives below.
 *    Never pass the task-life bound to `readCost` as `windowStart`: the window
 *    guard there would drop a lineage whose members have no `dispatchedAt`.
 *
 * A windowed read of the 30-day horizon must have a declared index matching its
 * range predicate (the lockstep rule in lib/db-indexes.js, LIN-3811).
 *
 * Adopt the 30-day horizon only at the sites enumerated in LIN-3161. Unrelated
 * `30 * 24 * 60 * 60` literals stay as they are.
 *
 * LIN-3975: `inReadWindow` is the task page's attempt-link consumer. It is an
 * in-memory filter over loops already read, not a store read, so the LIN-3811
 * index rule does not apply to it. It decides whether a run-page link is shown,
 * and the run page reads a reporting window, so it stays on the 30 days.
 */

import { toEpochMs } from './utils/time.js';

export const READ_HORIZON_DAYS = 30;

export const READ_HORIZON_MS = READ_HORIZON_DAYS * 24 * 60 * 60 * 1000;

/**
 * Start of the read window: `now − READ_HORIZON_MS`.
 *
 * `now` accepts either an epoch-ms number or a `Date`, matching the call
 * sites (`lib/kpi-stats.js` passes a `Date`, most others the default
 * `Date.now()`). It always returns a `Date`: the consumers compare it
 * against real `Date` fields (`dispatchedAt`, `timestamp`), and the
 * file-backed MangoDB store's cross-type `$gte` returns no match for a Date
 * field against a raw number.
 *
 * @param {Date|number} [now=Date.now()] - current time, as a Date or epoch ms
 * @returns {Date} the horizon start
 */
export function readHorizonStart(now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  return new Date(nowMs - READ_HORIZON_MS);
}

/**
 * Is a loop's `dispatchedAt` inside the read window (LIN-3975)? The run page's own read keeps a row whose
 * dispatch is at or after `readHorizonStart(now)` (lib/pipeline-loops.js `_admitRow`, which drops only `<`).
 * `dispatchedAt` is the store's ISO string, so it is parsed first with the shared `toEpochMs`: a raw
 * comparison against a `Date` is always false. A missing or unparseable value is out of the window.
 *
 * @param {string|Date|number|null|undefined} dispatchedAt
 * @param {Date|number} [now=Date.now()]
 * @returns {boolean}
 */
export function inReadWindow(dispatchedAt, now = Date.now()) {
  const ms = toEpochMs(dispatchedAt);
  return ms != null && ms >= readHorizonStart(now).getTime();
}

/** The task-life rule's name on the wire: `/cost/:identifier`'s `window.scope` (LIN-4404). */
export const TASK_LIFE_SCOPE = 'task-life';

/**
 * The task-life rule as pipeline-loops' `horizon` option (LIN-3328): no store `since` and no build cutoff. It is the
 * value its callers have always passed; naming it here keeps one rule with one home (LIN-4404).
 */
export const TASK_LIFE_HORIZON = 'all';

/**
 * The task-life bound (LIN-4404): an explicit lower bound that admits every record, for a store read whose missing
 * bound means the 30-day window (`listInHorizon`). It returns a new `Date` on each call, so no caller can move
 * another's bound. Identity-keyed `listHistory` reads take no `since` instead (see the header).
 *
 * @returns {Date} the epoch
 */
export function taskLifeStart() {
  return new Date(0);
}
