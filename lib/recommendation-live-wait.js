/**
 * The live-stage wait (LIN-4392): the first route code settles, before the review loop bound,
 * the look-first sequence and the stage selector. While any stage run on the ticket is queued
 * or running, a recommendation sends no stage: it answers "wait", naming the newest live run.
 *
 * Why it is here, before the selector. The selector sees live runs only as a hint (`, started`
 * in lib/recent-runs.js formatRecentRuns) and nothing stopped it picking a second stage beside
 * one. The duplicate guard (lib/dispatch-factory.js guardDuplicate) is keyed by issue and kind
 * and looks back five minutes, and it runs at the enqueue, after the selector has been paid
 * for. lib/openrouter.js codeRouteOf feeds every recommendation surface (recommend-and-dispatch,
 * GET /recommend, the task page's buffered GET and both streams), so one rule here means no
 * surface offers a stage the verb would refuse. The look-first wait LIN-4370 built is one case
 * of it: it is folded in here and gone from lib/recommendation-look-first.js.
 *
 * What counts as live. Only stage-run facts (lib/recent-runs.js stageRuns keeps
 * PROMPT_TEMPLATES kinds), with outcome queued or running (isLiveRun). So `autopilot`,
 * `custom`, wake, leftover, periodical and abort rows never hold a ticket: a ticket never waits
 * on its own coordinator. A run waiting on a person, ended, closed or aborted is not live. Age
 * never ends a run: a silent row holds the ticket, visibly with its id, until it closes or is
 * aborted. When the run read failed (`allRuns` not an array) the rule stands aside and the
 * selector decides, as before: a store fault must not stall every ticket.
 *
 * Who skips it. Only recommend-and-dispatch's descent arm, with `force: true` or a set
 * `followUpTo` (the call option `skipLiveWait`, threaded on every hop; never recommendation
 * context). The `kind` override never reaches a code route. Read surfaces take no bypass.
 *
 * Residual risk, accepted: the wait is a read, not a claim. Two calls racing within
 * milliseconds both pass; the same-kind duplicate guard still refuses a same-kind second.
 */
import { isLiveRun } from './recent-runs.js';

/** The refusal code recommend-and-dispatch answers a live-stage wait with (409). */
export const STAGE_IN_FLIGHT_CODE = 'STAGE_IN_FLIGHT';

/**
 * The newest live stage run in a ticket's run facts, or null. `allRuns` is stageRuns' list,
 * oldest first (a live run is dated by its dispatch), so the newest live run is the last.
 * @param {Array<Object>|null} allRuns
 * @returns {Object|null}
 */
export function newestLiveRun(allRuns) {
  if (!Array.isArray(allRuns)) return null;
  return allRuns.findLast(isLiveRun) || null;
}

const when = (at) => (at ? String(at).slice(0, 16).replace('T', ' ') : 'at an unknown time');

/**
 * The live wait for a ticket, or null when no stage run is live (or the runs are unknown).
 * @param {Array<Object>|null} allRuns - the recommendation input's allRuns
 * @returns {{wait: {kind: string, id: string|null, dispatchedAt: string|null, outcome: string}, why: string}|null}
 */
export function liveWaitOf(allRuns) {
  const live = newestLiveRun(allRuns);
  if (!live) return null;
  const wait = { kind: live.stage, id: live.id ?? null, dispatchedAt: live.dispatchedAt ?? live.at ?? null, outcome: live.outcome };
  return {
    wait,
    why: `${wait.kind} is still ${wait.outcome} on this ticket (dispatched ${when(wait.dispatchedAt)}), so code sends no stage beside it; the next step is chosen once it ends. If it is wedged, abort it.`
  };
}

/**
 * The refusal for a live-stage wait, as recommend-and-dispatch and the task page's streams say
 * it. Like the duplicate guard's refusal, the answer is to adopt the live run.
 * @param {{kind: string, id: string|null, dispatchedAt: string|null, outcome: string}} wait
 * @param {string} issueIdentifier
 * @returns {{error: string, code: string, id: string|null, issueIdentifier: string, kind: string, dispatchedAt: string|null, outcome: string}}
 */
export function liveWaitRefusal(wait, issueIdentifier) {
  return {
    error: `${issueIdentifier} already has a ${wait.kind} run ${wait.outcome}${wait.id ? ` (dispatch ${wait.id})` : ''}: no other stage is sent beside it. Adopt and watch that dispatch; the next step is chosen once it ends. If it is wedged, abort it, or send a step by hand with the "kind" override.`,
    code: STAGE_IN_FLIGHT_CODE,
    id: wait.id,
    issueIdentifier,
    kind: wait.kind,
    dispatchedAt: wait.dispatchedAt,
    outcome: wait.outcome
  };
}
