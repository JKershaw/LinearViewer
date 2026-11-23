/**
 * The re-review route (LIN-4521, P8 of LIN-4513; ruling 1 agreed by John: close-out's own commits stale the approval, so the
 * work goes back to review rather than merging). Its CODE_ROUTES entry (lib/code-routes.js) settles the route.
 *
 * An approving code review judged each landing PR at the head its pinned version held. When an open change of the landing
 * has moved since (a push the judge never saw: implementation's fix round, or close-out's own commit), code sends `review`,
 * so the new head is judged before a blind read is sent for it or close-out merges it. Close-out refuses a merge at a moved
 * head (closeOutDecision `head-moved`), so without this route the selector had to guess the next stage from the facts, and
 * its rules order close-out before review.
 *
 * The answer is `closeOutDecision`'s `routesReview` (lib/run-closeout-state.js), as the blind read's is its `routesRead`:
 * the decision reads the records trail's moved PRs (lib/records/standing.js) and the ticket's state, and this module decides
 * nothing itself. It reads no comment and no PR: the head refresh runs before the trail is read (lib/task-standing.js).
 * It stands aside when no trail is read (null), and whenever the decision does: no approve, no open landing change that
 * moved (a PR merged after a push is stale but cannot be re-judged before its merge), or a terminal ticket (a Done ticket
 * whose landing is an audit's notes PR excepted, as for the blind read).
 *
 * Ahead of the blind read in CODE_ROUTES, and the blind read itself stands aside while the approval is stale (routesRead
 * reads `workAfterReview`), so a blind read is never sent for a head nobody has reviewed. A new approval does not owe a
 * new read: a read on record that names the landing stands through it (LIN-4544); only an unread PR sends one.
 */
import { closeOutDecision } from './run-closeout-state.js';
import { findingsNotRead } from './close-out-findings.js';

/**
 * The re-review route for a ticket, or null when it stands aside.
 * @param {{state?: {type?: string}}} issue
 * @param {{trail?: Object|null}} context - the ticket's records trail (lib/task-standing.js, trailOfStanding's shape)
 * @returns {{step: 'review', codeRoute: 're-review', why: string}|null}
 */
export function reReviewStep(issue, context = {}) {
  const trail = context.trail ?? null;
  if (!trail) return null;
  // LIN-4495: advice reads no findings; the open findings answer enforcement, which this does not read.
  const { routesReview, movedPrs } = closeOutDecision({
    trail, ticketState: issue?.state?.type ?? null, openFindings: findingsNotRead('the re-review route reads no findings'),
  });
  if (!routesReview) return null;
  return {
    step: 'review',
    codeRoute: 're-review',
    why: `the latest code review approved this landing, but ${movedPrs.join(', ')} moved since it judged the head: a push the review never saw (close-out's own commits included). Close-out merges only at the head the reviewer approved, so code sends review to judge the new head first.`
  };
}
