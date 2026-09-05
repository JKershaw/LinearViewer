/**
 * Scan-basis fingerprint (LIN-2241 tier 1).
 *
 * "Has the content a ruling was raised FROM moved since it was raised?" —
 * answered with a hash comparison, no model call and no provider call.
 *
 * ## Why this is not `hashContext`, and not the scan's rendered input
 *
 * LIN-2241's Half A prescribes "a fingerprint of the scan's own input
 * (description + comments + subtask state — what `formatIssueContext`
 * composes)" while its acceptance criterion 1 requires that a change to
 * priority/labels/assignee alone must NOT mark a task due. At HEAD those two
 * sentences are unsatisfiable together, so this module implements the
 * criterion rather than the parenthetical:
 *
 *   - `formatIssueContext` (lib/openrouter.js) composes `**Updated:**
 *     ${issue.updatedAt}` (:651, added by LIN-1067) and `**Labels:**` (:660).
 *     A digest of what it actually composes moves on every `updatedAt` bump —
 *     i.e. on exactly the priority/label/assignee/cycle edits criterion 1
 *     names as changes that must not count.
 *   - `hashContext` (lib/recap-cache.js:94) — already stored on every scan row
 *     as `inputHash` — excludes `updatedAt`, priority and assignee, but
 *     INCLUDES labels, on the issue and on every child (:54, :64). A
 *     label-only edit flips it, so it fails criterion 1 too.
 *
 * `inputHash` is also not free to narrow in place: `TaskDecisionsStore.buildId`
 * derives a durable row `_id` from it, and `lib/scan.js` reuses that same
 * formula for a decision's own `decision_id`. It is the row's IDENTITY.
 * The basis hash here is a second, additive digest with a different job —
 * two hashes, two jobs.
 *
 * ## The slice
 *
 * Included: title, description, the task's own state TYPE, comments (id +
 * body), and parent/subtask state — the content a scan's judgement actually
 * rests on, and the content whose movement means "the question may no longer
 * be the right question".
 *
 * Excluded: `updatedAt`, labels, priority, assignee, cycle, project. A
 * nuisance signal destroys trust in the panel faster than anything else
 * (docs/escalation-philosophy.md §4), and none of these can change the answer
 * to "does this task carry a decision that needs the operator".
 *
 * ## Agreement by construction
 *
 * Two callers need the same digest from two different shapes: the scan routes
 * hold a live recommendation `context`, while the rulings feed can only reach
 * a stored `lib/task-snapshot-store.js` snapshot (free — no provider call).
 * Rather than maintain two parallel projections that must be kept in step by
 * convention, `scanBasisFromContext` is defined AS
 * `scanBasisFromSnapshot(snapshotFromContext(context))`. The two entry points
 * cannot drift, because there is only one projection.
 *
 * The price of routing through the snapshot slice is that `focusedChild` is
 * dropped (`snapshotFromContext` does not carry it), so a change confined to
 * a focused child's own body does not move the basis. That is a MISSED flag,
 * never a false one — the safe direction for a signal whose whole purpose is
 * to be trusted, and consistent with LIN-2241's "when uncertain, the ruling
 * stays".
 */

import crypto from 'crypto';
import { snapshotFromContext } from './task-snapshot-store.js';
import { stableStringify } from './recap-cache.js';

/** The snapshot fields the basis reads. Anything absent here is deliberately excluded. */
export const SCAN_BASIS_FIELDS = Object.freeze(['title', 'description', 'state', 'comments', 'parent', 'children']);

function stateType(state) {
  return state && typeof state === 'object' ? (state.type || '') : '';
}

/**
 * Project a task snapshot (lib/task-snapshot-store.js's `TaskSnapshot`) down to
 * the basis slice. Pure; the single projection both entry points share.
 *
 * @param {Object|null} snapshot
 * @returns {Object} the normalized basis slice
 */
export function scanBasisFromSnapshot(snapshot) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return {
    title: typeof snap.title === 'string' ? snap.title : '',
    description: typeof snap.description === 'string' ? snap.description : '',
    // The state TYPE only. A workflow rename ("In Review" → "Reviewing") is a
    // cosmetic provider-side edit that cannot change whether the task carries
    // an operator-worthy decision; `type` is the canonical axis (lib/providers/state-map.js).
    state: stateType(snap.state),
    comments: (Array.isArray(snap.comments) ? snap.comments : []).map(c => ({
      id: typeof c?.id === 'string' ? c.id : '',
      body: typeof c?.body === 'string' ? c.body : ''
    })),
    parent: snap.parent
      ? { identifier: typeof snap.parent.identifier === 'string' ? snap.parent.identifier : '', state: stateType(snap.parent.state) }
      : null,
    children: (Array.isArray(snap.children) ? snap.children : []).map(c => ({
      identifier: typeof c?.identifier === 'string' ? c.identifier : '',
      state: stateType(c?.state)
    }))
  };
}

/**
 * The basis slice for a live recommendation context. Defined through
 * `snapshotFromContext` so it cannot drift from `scanBasisFromSnapshot` —
 * see "Agreement by construction" above.
 *
 * @param {Object|null} context - Output of fetchRecommendationContext().
 * @returns {Object} the normalized basis slice
 */
export function scanBasisFromContext(context) {
  return scanBasisFromSnapshot(snapshotFromContext(context));
}

/** SHA-256 over a normalized basis slice. */
function digest(basis) {
  return crypto.createHash('sha256').update(stableStringify(basis)).digest('hex');
}

/**
 * The basis fingerprint of a live recommendation context — what the scan
 * routes store on a fresh scan row and re-derive to answer "is this fresh".
 *
 * @param {Object|null} context
 * @returns {string} SHA-256 hex digest
 */
export function scanBasisHashFromContext(context) {
  return digest(scanBasisFromContext(context));
}

/**
 * The basis fingerprint of a stored task snapshot — what the rulings feed
 * uses to detect a moved basis without any provider or model call.
 *
 * @param {Object|null} snapshot
 * @returns {string} SHA-256 hex digest
 */
export function scanBasisHashFromSnapshot(snapshot) {
  return digest(scanBasisFromSnapshot(snapshot));
}

/**
 * Has a pending ruling's basis moved? A deliberately TRI-state answer:
 *
 *   - `true`  — both hashes are known and they differ. The task changed.
 *   - `false` — both hashes are known and they agree.
 *   - `null`  — UNKNOWN, and never rendered as either of the above. Reached
 *               when the row predates this feature (no `basisHash` recorded),
 *               when no snapshot of the task exists yet (capture is
 *               opportunistic — `routes/proxy.js`'s `captureTaskSnapshot`
 *               fires on proxy issue reads, not on every scan), or when the
 *               only snapshot is OLDER than the scan itself, in which case it
 *               describes content the scan already saw and comparing against
 *               it would manufacture a difference that never happened.
 *
 * The null case is the load-bearing one. LIN-2241 is explicit that clearing is
 * more dangerous than raising, and the same asymmetry applies to flagging: a
 * flag the operator cannot trust is worse than no flag, so absence of evidence
 * is reported as absence of evidence.
 *
 * @param {Object} args
 * @param {string|null|undefined} args.raisedBasisHash - `basisHash` stored on the scan row
 * @param {string|null|undefined} args.currentBasisHash - hash of the freshest known content
 * @param {number|null|undefined} [args.raisedAtMs] - the scan row's `scannedAt`
 * @param {number|null|undefined} [args.observedAtMs] - when the current content was observed
 * @returns {boolean|null}
 */
export function basisChanged({ raisedBasisHash, currentBasisHash, raisedAtMs, observedAtMs } = {}) {
  if (!raisedBasisHash || !currentBasisHash) return null;
  // Only an observation STRICTLY newer than the scan can testify to a change
  // after it. When either timestamp is unusable we decline rather than guess.
  if (raisedAtMs != null || observedAtMs != null) {
    if (!Number.isFinite(raisedAtMs) || !Number.isFinite(observedAtMs)) return null;
    if (observedAtMs <= raisedAtMs) return null;
  }
  return raisedBasisHash !== currentBasisHash;
}
