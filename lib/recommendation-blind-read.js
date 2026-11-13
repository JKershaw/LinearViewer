/**
 * The blind read before close-out (LIN-4438, piece 3 of LIN-4396): a route code settles, after the
 * live-stage wait and the review loop bound and before the look-first sequence. Between an approving
 * code review and close-out, code sends `blind-read` (a stage with `route: null`, so the selector
 * never offers it) until a read naming every PR of the current landing is on record after that
 * review. Both recommendation seams reach it through lib/openrouter.js codeRouteOf, so the task page,
 * GET /recommend and recommend-and-dispatch agree.
 *
 * It reads only whether a read is on record, never what it said: a `worse` verdict does not hold the
 * merge. Its facts are the ones the selector reads (assembleTrailFacts: the review with its blindRead,
 * workAfterReview, closeOutAfterReview), the landing is landingPrUrls, and the decision is
 * closeOutWaitsOn, the rule both readiness lanes and the task page's box ask too. Nothing here
 * re-derives approval or the trail.
 *
 * When it stands aside (the selector decides, in this order):
 *   - no code review on record;
 *   - the ticket is terminal and not Done (Canceled, Duplicate): nothing will merge;
 *   - the ticket is Done and a close-out came after the latest review: the merge happened. An audit's
 *     notes PR on a Done ticket still gets its read, since its own review comes after that close-out;
 *   - work is reported after the latest review: the selector sends review first, and the read follows
 *     that review;
 *   - closeOutWaitsOn says nothing is waited on (not approved, no landing PR, or a read names every one).
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
import { isTerminalState } from './providers/state-map.js';
import { assembleTrailFacts } from './recommendation-facts.js';
import { landingPrUrls } from './run-trail.js';
import { closeOutWaitsOn } from './run-closeout-state.js';
import { isLiveRun } from './run-live-wait.js';
import { toEpochMs } from './utils/time.js';

/** Ended `blind-read` runs since the latest review, with no read on record, before code sends `blocked`. */
export const BLIND_READ_ATTEMPT_BOUND = 2;

const COMPLETED = 'completed';

/** Ended blind-read runs dispatched after `reviewAt` (ms), from the unsliced run facts. */
function endedReadsSince(allRuns, reviewAt) {
  return allRuns.filter(r => r?.stage === 'blind-read' && !isLiveRun(r)
    && (toEpochMs(r.dispatchedAt ?? r.at) ?? -Infinity) > reviewAt).length;
}

/**
 * The blind-read route for a ticket, or null when it stands aside.
 * @param {{state?: {type?: string}}} issue
 * @param {{comments?: Array<Object>, allRuns?: Array<Object>|null}} context
 * @returns {{step: 'blind-read'|'blocked', codeRoute: 'blind-read'|'blocked', why: string}|null}
 */
export function blindReadStep(issue, context = {}) {
  const comments = context.comments || [];
  const facts = assembleTrailFacts(comments, '', { leaf: false });
  if (!facts.review) return null;
  const type = issue?.state?.type;
  if (isTerminalState(type) && (type !== COMPLETED || facts.closeOutAfterReview)) return null;
  if (facts.workAfterReview) return null;
  const landing = landingPrUrls(comments);
  if (closeOutWaitsOn(facts.review, landing) !== 'blind-read') return null;
  if (Array.isArray(context.allRuns)
    && endedReadsSince(context.allRuns, toEpochMs(facts.review.at) ?? -Infinity) >= BLIND_READ_ATTEMPT_BOUND) {
    return {
      step: 'blocked',
      codeRoute: 'blocked',
      why: `blind reads ended without a verdict: ${BLIND_READ_ATTEMPT_BOUND} blind-read runs ended since the latest code review approved, and no read naming ${landing.join(', ')} is on record. A person decides whether to send another or close out without one.`
    };
  }
  return {
    step: 'blind-read',
    codeRoute: 'blind-read',
    why: `the latest code review approved, and no blind read since it names ${landing.join(', ')}; close-out merges only after one does, so code sends the read first.`
  };
}
