/**
 * lib/session-roles.js: what role one dispatch plays in a task's sessions, and how a lineage reads (LIN-4405, part 2
 * of LIN-4395).
 *
 * One place answers "is this a wake, a resume, an orchestration row or work?" for the session timeline
 * (lib/task-timeline.js). It reads the one kind set, `ORCHESTRATION_KINDS` (lib/run-view.js), and copies nothing.
 *
 * Precedence, in this order (the approved plan's):
 *   1. `wake`: kind `wake`.
 *   2. `resumed`: any other row with `followUpTo` (a reply follow-up, or a ci-wake `custom` row: lib/ci-wake-sweep.js
 *      stamps `followUpTo` on a `custom` row and nothing else tells it apart), and every `leftover` row, which by
 *      its kind resumes a build (`LEFTOVER_KIND`, lib/dispatch-fields.js) even if a row lost its `followUpTo`.
 *   3. `orchestration`: a kind in `ORCHESTRATION_KINDS` (`autopilot`, `custom`, `periodical`; `wake` is caught above).
 *   4. `work`: everything else (the stage kinds).
 *
 * Stages' `groupSessions` (lib/task-page-loader.js) does NOT use this helper (the plan's Departure 1): it asks only
 * `ORCHESTRATION_KINDS.has(kind)`, and checking `resumed` first would move ci-wake `custom` rows out of Stages'
 * check-ins and change its output. Both read the same set, so the fact is still written once.
 *
 * A lineage reads as:
 *   - `held`: its base is orchestration and it has at least one `wake` dispatch. A ci-wake `custom` resume is NOT a
 *     wake (it is `resumed`), so a lineage driven only by CI wakes is not called held: nobody held it open for a
 *     child, it parked on CI (LIN-4405 decision, recorded on LIN-4395).
 *   - `fresh`: its base is work (a stage kind).
 *   - otherwise `null`, and the lane is labelled by its kind alone. A plain `custom` base with no wakes is neither held
 *     nor fresh (plan-review builder note 6).
 */

import { ORCHESTRATION_KINDS } from './run-view.js';
import { LEFTOVER_KIND } from './dispatch-fields.js';

/** The four dispatch roles, in precedence order. */
export const DISPATCH_ROLES = Object.freeze(['wake', 'resumed', 'orchestration', 'work']);

/**
 * One dispatch's role. Pure.
 *
 * @param {{kind?: string|null, followUpTo?: string|null}} dispatch
 * @returns {'wake'|'resumed'|'orchestration'|'work'}
 */
export function roleOf({ kind = null, followUpTo = null } = {}) {
  if (kind === 'wake') return 'wake';
  if (kind === LEFTOVER_KIND || (followUpTo !== null && followUpTo !== undefined && followUpTo !== '')) return 'resumed';
  // A row with no kind is stored and read as `custom` (lib/cost-read.js `kind || 'custom'`).
  if (ORCHESTRATION_KINDS.has(kind || 'custom')) return 'orchestration';
  return 'work';
}

/**
 * How a lineage reads, from its base kind and its dispatches. Pure.
 *
 * @param {{baseKind?: string|null, dispatches?: Array<{kind?: string|null, followUpTo?: string|null}>|null}} lineage
 * @returns {'held'|'fresh'|null}
 */
export function lineageRoleOf({ baseKind = null, dispatches = null } = {}) {
  const base = roleOf({ kind: baseKind });
  if (base === 'work') return 'fresh';
  if (base !== 'orchestration') return null;
  const woken = Array.isArray(dispatches) && dispatches.some(dispatch => roleOf(dispatch) === 'wake');
  return woken ? 'held' : null;
}
