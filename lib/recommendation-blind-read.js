/**
 * The blind read before close-out (LIN-4438, piece 3 of LIN-4396): its CODE_ROUTES entry
 * (lib/code-routes.js) settles the route. Between an approving
 * code review and close-out, code sends `blind-read` (a stage with `route: null`, so the selector
 * never offers it) until a read naming every PR of the current landing is on record after that
 * review. Both recommendation seams reach it through lib/openrouter.js codeRouteOf, so the task page,
 * GET /recommend and recommend-and-dispatch agree.
 *
 * It reads only whether a read is on record, never what it said: a `worse` verdict does not hold the
 * merge. The trail is the ticket's records trail (lib/task-standing.js), and the answer is `closeOutDecision`'s `routesRead`
 * (lib/run-closeout-state.js, LIN-4460): the rule the readiness lanes and the task page's box enforce,
 * read here for advice only. Nothing here re-derives approval, the trail or the ticket's passenger rule.
 *
 * When it stands aside (the decision decides):
 *   - no code review on record;
 *   - the ticket is terminal and not Done (Canceled, Duplicate): nothing will merge;
 *   - the ticket is Done and the trail holds a close-out on this landing: the merge happened. A Done
 *     ticket with no close-out on its landing and no audit's notes PR also stands aside: a person closed
 *     it outside Harbour, and Harbour follows (LIN-4447's passenger ruling). An audit's notes PR on a Done
 *     ticket still gets its read, since its own review comes after that close-out;
 *   - work is reported after the latest review: `routesRead` is false, so no read is sent for it. A stale approval is
 *     re-judged first by the re-review route (lib/recommendation-re-review.js, LIN-4521); other work after a review
 *     goes to the selector, and the approving review that follows judges it (a read on record still stands, LIN-4544);
 *   - the gate is not waited on (not approved, no landing PR, or a read names every one).
 * A close-out reported after the review does not stop it: a not-ready close-out is an attempt on this
 * landing, and the predicate decides.
 *
 * The bound, only when the runs are known: after BLIND_READ_ATTEMPT_BOUND ended `blind-read` runs
 * dispatched since the latest read on record (LIN-4544: a read stands across re-reviews, so a re-review does not
 * restart the count; with no read on record, since the ticket's first run) with still no read naming the landing,
 * it sends `blocked`. Every ended outcome
 * counts (done, failed, aborted, skipped, closed, waiting on a person): run facts carry no report
 * text, so a `[skipped]` for an empty landing and a cascade `[skipped]` read alike (the LIN-4437 note),
 * and either way no read landed. With `allRuns` unknown the read is still sent and the bound skipped;
 * the cost is a possible duplicate read, one extra comment, not a hole.
 */
import { closeOutDecision } from './run-closeout-state.js';
import { findingsNotRead } from './close-out-findings.js';
import { isLiveRun } from './run-live-wait.js';
import { toEpochMs } from './utils/time.js';
import { BLIND_READ_KIND } from './prompts/blind-read-words.js';

/** Ended `blind-read` runs since the latest read on record (or the ticket's first run), with no read naming the landing, before code sends `blocked`. */
export const BLIND_READ_ATTEMPT_BOUND = 2;

/** Ended blind-read runs dispatched after `sinceMs` (ms), from the unsliced run facts. */
function endedReadsSince(allRuns, sinceMs) {
  return allRuns.filter(r => r?.stage === BLIND_READ_KIND && !isLiveRun(r)
    && (toEpochMs(r.dispatchedAt ?? r.at) ?? -Infinity) > sinceMs).length;
}

/**
 * The blind-read route for a ticket, or null when it stands aside.
 * @param {{state?: {type?: string}}} issue
 * @param {{trail?: Object|null, allRuns?: Array<Object>|null}} context
 * @returns {{step: 'blind-read'|'blocked', codeRoute: 'blind-read'|'blocked', why: string}|null}
 */
export function blindReadStep(issue, context = {}) {
  // LIN-4518 step 3: the trail is the ticket's records trail, handed in by the entrance (lib/recommendation-input.js).
  // LIN-4520: no comment fallback; an unread trail (null, or none handed in) stands the route aside.
  const trail = context.trail ?? null;
  if (!trail) return null;
  // LIN-4495: the route reads the blind read only; the open findings answer enforcement, which this does not read.
  const { routesRead } = closeOutDecision({
    trail, ticketState: issue?.state?.type ?? null, openFindings: findingsNotRead('the blind-read route reads no findings'),
  });
  if (!routesRead) return null;
  const landing = trail.landing;
  // LIN-4544: counted from the read on record (it stands across re-reviews), or from the ticket's first run when none is on record.
  const countFrom = toEpochMs(trail.review.blindRead?.at) ?? -Infinity;
  if (Array.isArray(context.allRuns)
    && endedReadsSince(context.allRuns, countFrom) >= BLIND_READ_ATTEMPT_BOUND) {
    return {
      step: 'blocked',
      codeRoute: 'blocked',
      why: `blind reads ended without a verdict: ${BLIND_READ_ATTEMPT_BOUND} blind-read runs ended since the last blind read on record (or the ticket's first run), and no read naming ${landing.join(', ')} is on record. A person decides whether to send another or close out without one.`
    };
  }
  return {
    step: BLIND_READ_KIND,
    codeRoute: BLIND_READ_KIND,
    why: `the latest code review approved, and no blind read on record names ${landing.join(', ')}; close-out merges only after one does, so code sends the read first.`
  };
}
