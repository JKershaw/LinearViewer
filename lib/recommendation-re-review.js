/**
 * The re-review route (LIN-4521, P8 of LIN-4513; ruling 1 agreed by John: close-out's own commits stale the approval, so the
 * work goes back to review rather than merging). Its CODE_ROUTES entry (lib/code-routes.js) settles the route.
 *
 * An approving code review judged each landing PR at the head its pinned version held. When a PR of the landing has moved
 * since (a push the judge never saw: implementation's fix round, or close-out's own commit), the records trail names that
 * PR in `review.staleUrls` (lib/records/standing.js). Then code sends `review`, so the new head is judged before a blind
 * read is sent for it or close-out merges it. Close-out refuses a merge at a moved head (closeOutDecision `head-moved`), so
 * without this route the selector had to guess the next stage from the facts.
 *
 * It reads only the trail, never a comment, and never a PR: the trail's stale flag is the records' own (the head refresh
 * runs before the trail is read, lib/task-standing.js). It stands aside when:
 *   - no trail is read (null);
 *   - the latest review is not an approve: a review that asks for changes is handled by its own verdict and the selector;
 *   - no PR a stale link names is on the landing: a PR outside the landing (an abandoned or unlanded change) is not
 *     something review can re-judge, so it does not loop the ticket back to review.
 *
 * Ahead of the blind read in CODE_ROUTES, and the blind read itself stands aside while the approval is stale
 * (run-closeout-state.js routesRead reads `workAfterReview`), so a blind read is never sent for a head nobody has reviewed.
 * A new approval is a new review record: its blind read is owed again, through the same route as before.
 */
import { isApprovedReview } from './run-closeout-state.js';

/**
 * The re-review route for a ticket, or null when it stands aside.
 * @param {{state?: {type?: string}}} issue
 * @param {{trail?: Object|null}} context - the ticket's records trail (lib/task-standing.js, trailOfStanding's shape)
 * @returns {{step: 'review', codeRoute: 're-review', why: string}|null}
 */
export function reReviewStep(issue, context = {}) {
  const trail = context.trail ?? null;
  if (!trail) return null;
  if (!isApprovedReview(trail.review)) return null;
  const landing = Array.isArray(trail.landing) ? trail.landing : [];
  const moved = (trail.review.staleUrls ?? []).filter((url) => landing.includes(url));
  if (moved.length === 0) return null;
  return {
    step: 'review',
    codeRoute: 're-review',
    why: `the latest code review approved this landing, but ${moved.join(', ')} moved since it judged the head: a push the review never saw (close-out's own commits included). Close-out merges only at the head the reviewer approved, so code sends review to judge the new head first.`
  };
}
