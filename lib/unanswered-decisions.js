/**
 * lib/unanswered-decisions.js
 *
 * Pure module (LIN-1728): "does this loop carry a decision with no recorded
 * answer" — the ONE predicate the ambient nav count and the filtered rulings
 * view both read, instead of independently re-deriving the same fact and
 * risking the disagreement this epic already contains once (`loopIsWaiting`
 * vs `deriveLifecycleStatus` on a `[blocked]`-then-`[done]` lineage).
 *
 * Deliberately separate from `loopIsWaiting` (routes/dashboard.js) — a
 * decision is orthogonal to both terminality and to "waiting" (`hook.js`'s
 * complete-path decision emission routinely lands on a terminal, non-waiting
 * loop) — this module never widens or imports that predicate.
 *
 * No I/O, `now` injected throughout, importing nothing from loopIsWaiting.
 */

import { computeSupersededLoopIds } from './loop-supersede.js';

// Mirrors simple-dispatcher's REAP_INACTIVITY_MS (config.js): a terminal
// session is reaped after this long of inactivity with no live child. The
// two repos share no config source of truth, so this is a duplicated
// constant, not an import — the drift risk this creates is tracked as
// LIN-2201 rather than fixed here (routed-around contract gap, small and
// self-limiting: a mislabeled reply-button action, backstopped by SD's own
// async `no-session` rejection when the guess is wrong).
const REAP_INACTIVITY_MS = 21600000; // 6h

/**
 * Resolve a loop's press-time reply disposition — a TOTAL mapping (LIN-1728
 * Revision 3, F8): every loop state maps to exactly one of four
 * dispositions, resolved fresh at press time and never stored (liveness
 * decays, so a stored flag would lie to the operator by the time they act
 * on it).
 *
 *   - `resumable` — permanently-parked-blocked (never reaped while
 *     `[blocked]`) OR freshly terminal within the reap window. Both take
 *     simple-dispatcher's plain no-force `resume` branch
 *     (`followup.js`'s `resolveFollowUpTarget`: a terminal loop is not an
 *     active phase, so `!active` and `forced: false`) — same button, same
 *     no-force follow-up, so they share one disposition.
 *   - `gone` — terminal, past the reap window. "Reply & start a run" is a
 *     different action, labelled honestly as such by the call site.
 *   - `mid-turn` — non-terminal, actively running. Hold rather than collide
 *     with a live writer.
 *   - `indeterminate` — the residual non-terminal/non-blocked/non-running
 *     case (e.g. a lean loop mid-transition between agent states).
 *     Read-only, distinct wording from `mid-turn` at the call site.
 *
 * @param {{terminalStatus?: string|null, terminalCompletedAt?: string|Date|null, wakeMarker?: string|null, agentState?: string|null}} loop
 * @param {{now: Date}} opts
 * @returns {'resumable'|'gone'|'mid-turn'|'indeterminate'}
 */
export function resolveDisposition(loop, { now }) {
  if (!loop.terminalStatus && loop.wakeMarker === 'blocked') return 'resumable';
  if (loop.terminalStatus) {
    const completedAtMs = loop.terminalCompletedAt ? new Date(loop.terminalCompletedAt).getTime() : NaN;
    const age = Number.isFinite(completedAtMs) ? now.getTime() - completedAtMs : Infinity;
    return age <= REAP_INACTIVITY_MS ? 'resumable' : 'gone';
  }
  if (loop.agentState === 'running') return 'mid-turn';
  return 'indeterminate';
}

/**
 * `resumable`/`gone` both admit a reply (a different action under the hood);
 * `mid-turn`/`indeterminate` are read-only. `task-bound` (LIN-2197 Phase 3)
 * always admits a reply too — its answer path is the always-available
 * issue-keyed `POST /workspace/:urlKey/api/comments/:issueId`, not a
 * session-dependent resume, so it is structurally bounded rather than
 * liveness-dependent like a loop's `resumable`/`gone`.
 */
function canReplyFor(disposition) {
  return disposition === 'resumable' || disposition === 'gone' || disposition === 'task-bound';
}

function taskDecisionScannedAtMs(entry) {
  const raw = entry && entry.scannedAt;
  if (raw instanceof Date) return raw.getTime();
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * A task-decision row's anchor, normalised into the same shape a loop's
 * anchor carries — except `loopId` is always `null` (no dispatch item backs
 * a scan) and `target`/`followUpTo` are always `null` (a task decision has
 * neither a run target nor a follow-up lineage). `taskDecisionId` is an
 * additive field with no loop-anchor counterpart, carrying the scan store's
 * own record id so a reply/dismiss action can address the exact row.
 */
function taskDecisionAnchor(entry) {
  return {
    loopId: null,
    issueId: entry.issueId || null,
    issueIdentifier: entry.issueIdentifier || null,
    workspaceUrlKey: entry.urlKey || null,
    target: null,
    followUpTo: null,
    taskDecisionId: entry.id || null
  };
}

/**
 * Collect every unanswered decision across `loops` and `taskDecisions`
 * (LIN-2197's task-keyed decision producer, which has no dispatch item
 * behind it — a human-triggered scan of a task's description/comments/
 * subtask state). `taskDecisions` defaults to `[]`, the trivial no-op case.
 *
 * A loop's decision counts as unanswered when: the loop carries a decision,
 * the loop is not superseded by a later follow-up loop within this same
 * input set (`computeSupersededLoopIds` — see its own input-scope contract:
 * loopIds are globally unique dispatch-history ids, so a merged
 * cross-workspace set is safe here), and the loop's own `answeredDecisionId`
 * does not match the decision's own `decision_id` — a newer, still-unanswered
 * decision posted after an older one was answered stays unanswered.
 *
 * Each `taskDecisions` entry is a `lib/task-decisions-store.js` record
 * (`{id, urlKey, issueId, issueIdentifier, decision, scannedAt, outcome}`).
 * A task-decision entry counts as unanswered when: it carries a non-null
 * `decision` (a stored `decision: null` is a persisted *zero-finding* scan —
 * nothing to rule on, not the absence of a scan), it carries no `outcome`
 * (`'answered'`/`'dismissed'` are both terminal — resolved, not unanswered),
 * and it is the most-recently-scanned entry for its `(urlKey, issueId)` pair
 * in this input set — an older row for the same task is superseded by a
 * newer scan even when both are otherwise decision-bearing and unanswered,
 * mirroring the loop branch's own `computeSupersededLoopIds` treatment.
 * `resolveDisposition` is not consulted for task decisions — they get their
 * own fixed `'task-bound'` disposition, assigned here rather than folded
 * into that (loop-shaped, four-way) total mapping.
 *
 * A THIRD input, `shelvedRulings` (LIN-1727) — raw records from
 * `lib/shelved-rulings-store.js`, one per `(urlKey, decisionId)` that has
 * ever been shelved. A decision whose shelf row is still ACTIVE
 * (`resurfaceAt` in the future) is excluded from the result entirely — the
 * whole point of a shelve is to declutter the queue until it re-surfaces.
 * Once `resurfaceAt` passes, the row is included again like any other
 * unanswered decision (shelving never mutates the underlying answer state),
 * carrying `shelvedLapseCount` so the UI can flag a decision that keeps
 * getting shelved and re-lapsing rather than actually decided
 * (docs/escalation-philosophy.md §4/§6: repeated lapses should raise
 * priority, not be silently tolerated forever).
 *
 * @param {{loops?: Array<Object>, taskDecisions?: Array<Object>, shelvedRulings?: Array<Object>}} input
 * @param {{now: Date}} opts
 * @returns {Array<{decision: Object, decisionCase: Array<string>, anchor: Object, disposition: string, canReply: boolean, shelvedLapseCount: number}>}
 */
export function collectUnansweredDecisions({ loops = [], taskDecisions = [], shelvedRulings = [] } = {}, { now } = {}) {
  const effectiveNow = now instanceof Date ? now : new Date();
  const superseded = computeSupersededLoopIds(loops);

  const shelfByKey = new Map();
  for (const shelf of shelvedRulings) {
    if (shelf?.urlKey && shelf?.decisionId) shelfByKey.set(`${shelf.urlKey}::${shelf.decisionId}`, shelf);
  }
  // Returns null when actively shelved (caller must exclude the row), else
  // the lapse count to attach (0 when never shelved). Keyed by
  // (urlKey, decisionId), matching lib/shelved-rulings-store.js's own
  // composite key — decisionId alone is agent-invented free text and not
  // globally unique, so two workspaces can share one without a shelve in
  // one silently suppressing the other's unrelated, unshelved decision.
  function shelfGate(urlKey, decisionId) {
    const shelf = shelfByKey.get(`${urlKey}::${decisionId}`);
    if (!shelf) return 0;
    const resurfaceMs = new Date(shelf.resurfaceAt).getTime();
    if (Number.isFinite(resurfaceMs) && resurfaceMs > effectiveNow.getTime()) return null; // still shelved
    return shelf.lapseCount || 0;
  }

  const rows = [];
  for (const loop of loops) {
    if (!loop || !loop.decision) continue;
    if (superseded.has(loop.loopId)) continue;
    if (loop.answeredDecisionId === loop.decision.decision_id) continue;
    const shelvedLapseCount = shelfGate(loop.workspaceUrlKey, loop.decision.decision_id);
    if (shelvedLapseCount === null) continue; // actively shelved

    const disposition = resolveDisposition(loop, { now: effectiveNow });
    rows.push({
      decision: loop.decision,
      decisionCase: loop.decisionCase || [],
      anchor: {
        loopId: loop.loopId,
        issueId: loop.issueId || null,
        issueIdentifier: loop.issueIdentifier || null,
        workspaceUrlKey: loop.workspaceUrlKey || null,
        target: loop.target || null,
        followUpTo: loop.followUpTo || null
      },
      disposition,
      canReply: canReplyFor(disposition),
      shelvedLapseCount
    });
  }

  // Task decisions: only the most-recently-scanned entry per (urlKey, issueId)
  // is "live" — an older row for the same task is superseded by a newer scan,
  // regardless of that older row's own decision/outcome content.
  const latestByTask = new Map();
  for (const entry of taskDecisions) {
    if (!entry) continue;
    const key = `${entry.urlKey || ''}::${entry.issueId || ''}`;
    const existing = latestByTask.get(key);
    if (!existing || taskDecisionScannedAtMs(entry) > taskDecisionScannedAtMs(existing)) {
      latestByTask.set(key, entry);
    }
  }
  for (const entry of latestByTask.values()) {
    if (!entry.decision) continue; // persisted zero-finding: nothing to rule on
    if (entry.outcome) continue; // 'answered'/'dismissed': resolved, not unanswered
    const shelvedLapseCount = shelfGate(entry.urlKey, entry.decision.decision_id);
    if (shelvedLapseCount === null) continue; // actively shelved

    rows.push({
      decision: entry.decision,
      decisionCase: [],
      anchor: taskDecisionAnchor(entry),
      disposition: 'task-bound',
      canReply: canReplyFor('task-bound'),
      shelvedLapseCount
    });
  }

  return rows;
}
