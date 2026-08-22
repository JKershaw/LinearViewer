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

/** `resumable`/`gone` both admit a reply (a different action under the hood); `mid-turn`/`indeterminate` are read-only. */
function canReplyFor(disposition) {
  return disposition === 'resumable' || disposition === 'gone';
}

/**
 * Collect every unanswered decision across `loops` — and, forward-compat,
 * `taskDecisions` (LIN-2197's not-yet-landed task-keyed decision producer,
 * which has no dispatch item behind it). `taskDecisions` defaults to `[]`,
 * the trivial case this module already handles correctly by doing nothing
 * with it; LIN-2197 defines its shape and the normalisation into a ruling
 * row when it lands.
 *
 * A loop's decision counts as unanswered when: the loop carries a decision,
 * the loop is not superseded by a later follow-up loop within this same
 * input set (`computeSupersededLoopIds` — see its own input-scope contract:
 * loopIds are globally unique dispatch-history ids, so a merged
 * cross-workspace set is safe here), and the loop's own `answeredDecisionId`
 * does not match the decision's own `decision_id` — a newer, still-unanswered
 * decision posted after an older one was answered stays unanswered.
 *
 * @param {{loops?: Array<Object>, taskDecisions?: Array<Object>}} input
 * @param {{now: Date}} opts
 * @returns {Array<{decision: Object, decisionCase: Array<string>, anchor: Object, disposition: string, canReply: boolean}>}
 */
export function collectUnansweredDecisions({ loops = [], taskDecisions = [] } = {}, { now } = {}) {
  const effectiveNow = now instanceof Date ? now : new Date();
  const superseded = computeSupersededLoopIds(loops);

  const rows = [];
  for (const loop of loops) {
    if (!loop || !loop.decision) continue;
    if (superseded.has(loop.loopId)) continue;
    if (loop.answeredDecisionId === loop.decision.decision_id) continue;

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
      canReply: canReplyFor(disposition)
    });
  }

  return rows;
}
