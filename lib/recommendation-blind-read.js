/**
 * The blind read before close-out (LIN-4438, piece 3 of LIN-4396): its CODE_ROUTES entry
 * (lib/code-routes.js) settles the route. Between an approving
 * code review and close-out, code sends `blind-read` (a stage with `route: null`, so the selector
 * never offers it) until a read naming every PR of the current landing is on record after that
 * review. Both recommendation seams reach it through lib/openrouter.js codeRouteOf, so the task page,
 * GET /recommend and recommend-and-dispatch agree.
 *
 * It reads only whether a read is on record, never what it said: a `worse` verdict does not hold the
 * merge. LIN-4518: the standing is read from records (`context.standing`, lib/task-standing.js), never
 * from comments, and the answer is `closeOutDecision`'s `routesRead` (lib/run-closeout-state.js, LIN-4460):
 * the rule the readiness lanes and the task page's box enforce, read here for advice only. Nothing here
 * re-derives approval, the standing or the ticket's passenger rule.
 *
 * When it stands aside (the decision decides):
 *   - no code review on record;
 *   - the ticket is terminal and not Done (Canceled, Duplicate): nothing will merge;
 *   - the ticket is Done and the trail holds a close-out on this landing: the merge happened. A Done
 *     ticket with no close-out on its landing and no audit's notes PR also stands aside: a person closed
 *     it outside Harbour, and Harbour follows (LIN-4447's passenger ruling). An audit's notes PR on a Done
 *     ticket still gets its read, since its own review comes after that close-out;
 *   - work is reported after the latest review: the selector sends review first, and the read follows
 *     that review;
 *   - the gate is not waited on (not approved, no landing PR, or a read names every one).
 * A close-out reported after the review does not stop it: a not-ready close-out is an attempt on this
 * landing, and the predicate decides.
 *
 * The bound, only when the runs are known: after BLIND_READ_ATTEMPT_BOUND ended `blind-read` runs
 * dispatched since that review with still no read on record, it sends `blocked`. Every ended outcome
 * counts (done, failed, aborted, skipped, closed, waiting on a person): run facts carry no report
 * text, so a `[skipped]` for an empty landing and a cascade `[skipped]` read alike (the LIN-4437 note),
 * and either way no read landed. With `allRuns` unknown the read is still sent and the bound skipped;
 * the cost is a possible duplicate read, one extra comment, not a hole.
 */
import { trailOfStanding } from './records/standing.js';
import { closeOutDecision } from './run-closeout-state.js';
import { findingsNotRead } from './close-out-findings.js';
import { isLiveRun } from './run-live-wait.js';
import { toEpochMs } from './utils/time.js';
import { BLIND_READ_KIND } from './prompts/blind-read-words.js';

/** Ended `blind-read` runs since the latest review, with no read on record, before code sends `blocked`. */
export const BLIND_READ_ATTEMPT_BOUND = 2;

/** Ended blind-read runs dispatched after `reviewAt` (ms), from the unsliced run facts. */
function endedReadsSince(allRuns, reviewAt) {
  return allRuns.filter(r => r?.stage === BLIND_READ_KIND && !isLiveRun(r)
    && (toEpochMs(r.dispatchedAt ?? r.at) ?? -Infinity) > reviewAt).length;
}

/**
 * The blind-read route for a ticket, or null when it stands aside.
 * @param {{state?: {type?: string}}} issue
 * @param {{standing?: Object|null, allRuns?: Array<Object>|null}} context - `standing` is the ticket's records standing
 *   (lib/task-standing.js); null (not read) stands the route aside, as a store fault always has.
 * @returns {{step: 'blind-read'|'blocked', codeRoute: 'blind-read'|'blocked', why: string}|null}
 */
export function blindReadStep(issue, context = {}) {
  if (!context.standing) return null;
  const trail = trailOfStanding(context.standing);
  // LIN-4495: the route reads the blind read only; the open findings answer enforcement, which this does not read.
  const { routesRead } = closeOutDecision({
    trail, ticketState: issue?.state?.type ?? null, openFindings: findingsNotRead('the blind-read route reads no findings'),
  });
  if (!routesRead) return null;
  const landing = trail.landing;
  if (Array.isArray(context.allRuns)
    && endedReadsSince(context.allRuns, toEpochMs(trail.review.at) ?? -Infinity) >= BLIND_READ_ATTEMPT_BOUND) {
    return {
      step: 'blocked',
      codeRoute: 'blocked',
      why: `blind reads ended without a verdict: ${BLIND_READ_ATTEMPT_BOUND} blind-read runs ended since the latest code review approved, and no read naming ${landing.join(', ')} is on record. A person decides whether to send another or close out without one.`
    };
  }
  return {
    step: BLIND_READ_KIND,
    codeRoute: BLIND_READ_KIND,
    why: `the latest code review approved, and no blind read since it names ${landing.join(', ')}; close-out merges only after one does, so code sends the read first.`
  };
}

/**
 * Whether close-out's gate is held on a blind read the record does not yet hold (LIN-4518): an approving review, a landing
 * PR the read has not named. A close-out run parked on that gate cannot end until the read is on record, so it does not
 * hold the ticket: the live-stage wait (lib/run-live-wait.js) steps aside for it. It steps aside whether or not the
 * blind-read route sends the read now: when work came after the review, the selector must send review first, and a
 * wait on the parked close-out would block that review (the LIN-4499 deadlock).
 */
export function closeOutGateHeld(context = {}) {
  const standing = context.standing;
  if (!standing?.review) return false;
  // The gate is asked through closeOutDecision (lib/run-closeout-state.js owns it, LIN-4460), with no PR reads: `waitsOn`
  // holds whatever the statuses say, since it is decided from the approval and the landing alone when nothing is merged.
  const { waitsOn } = closeOutDecision({
    trail: trailOfStanding(standing), ticketState: null, openFindings: findingsNotRead('the live wait reads no findings'),
  });
  return waitsOn === BLIND_READ_KIND;
}
