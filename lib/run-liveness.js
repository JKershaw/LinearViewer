/**
 * LIN-4531 (LIN-4529 plan D3): run liveness, the one leaf that says whether a run's session can still take a follow-up.
 *
 * Moved unchanged in meaning from lib/unanswered-decisions.js: `REAP_INACTIVITY_MS` and `resolveDisposition`, the press-time
 * mapping every ask and answer reads (the answer route now; the cards' read-only rule in LIN-4532, P2b). The old module re-exports both until
 * LIN-4529 P7b deletes it. Pure: no I/O, `now` injected. `runLoopFactsOf` reads the same facts from a raw dispatch row, so a
 * route that holds only the row (the answer route) asks the same question the cards ask of a loop.
 */

import { isRowClosed, isWaitingWakeMarker, deriveTerminalStatus, deriveCompletedAt, deriveBlockedStatus } from './dispatch-terminal.js';

// Mirrors simple-dispatcher's REAP_INACTIVITY_MS (config.js, LIN-4172): the
// RECORD window. A terminal session's record, the thing a follow-up resumes
// from, is kept this long after its last activity; past it the record is
// deleted and `resumable` no longer applies. This is deliberately NOT SD's
// CLONE_REAP_INACTIVITY_MS (24 h): once the clone is gone a follow-up still
// resumes, because SD re-clones the recorded folder on resume (LIN-4171). So
// the only question this constant answers is "is the record still there?".
// The two repos share no config source of truth, so this is a duplicated
// constant, not an import — the drift risk this creates is tracked as
// LIN-2201 rather than fixed here (routed-around contract gap, small and
// self-limiting: a mislabeled reply-button action, backstopped by SD's own
// async `no-session` rejection when the guess is wrong). It is exported so the
// tests read this one copy instead of keeping their own.
export const REAP_INACTIVITY_MS = 7 * 86400000; // 7d

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
 * @param {{terminalStatus?: string|null, terminalCompletedAt?: string|Date|null, bookkeeping?: object|null, wakeMarker?: string|null, agentState?: string|null}} loop
 * @param {{now: Date}} opts
 * @returns {'resumable'|'gone'|'mid-turn'|'indeterminate'}
 */
export function resolveDisposition(loop, { now }) {
  if (!loop.terminalStatus && isWaitingWakeMarker(loop.wakeMarker)) return 'resumable';
  // A stamped (closed) row has no live writer, whatever its agentState says (LIN-3364):
  // it ages from the stamp like a terminal one.
  if (loop.terminalStatus || isRowClosed(loop)) {
    const endedAt = loop.terminalCompletedAt || loop.bookkeeping?.at;
    const completedAtMs = endedAt ? new Date(endedAt).getTime() : NaN;
    const age = Number.isFinite(completedAtMs) ? now.getTime() - completedAtMs : Infinity;
    return age <= REAP_INACTIVITY_MS ? 'resumable' : 'gone';
  }
  if (loop.agentState === 'running') return 'mid-turn';
  return 'indeterminate';
}

/**
 * The loop-shaped facts `resolveDisposition` reads, from a raw dispatch row (history or queue). A taken row with no terminal
 * marker and no stamp is the one live writer (`running`); a queued row has none (`indeterminate`). `[blocked]` is the
 * waiting marker that makes a run resumable at any age (LIN-2079).
 * @param {{feedback?: Array, bookkeeping?: object|null, status?: string}} row
 * @returns {{terminalStatus: string|null, terminalCompletedAt: string|null, bookkeeping: object|null, wakeMarker: string|null, agentState: string|null}}
 */
export function runLoopFactsOf(row) {
  const feedback = row?.feedback || [];
  const terminalStatus = deriveTerminalStatus(feedback);
  const bookkeeping = row?.bookkeeping || null;
  const live = !terminalStatus && !bookkeeping;
  return {
    terminalStatus,
    terminalCompletedAt: deriveCompletedAt(feedback),
    bookkeeping,
    wakeMarker: deriveBlockedStatus(feedback) === 'blocked' ? 'blocked' : null,
    agentState: live && row?.status === 'taken' ? 'running' : null,
  };
}
