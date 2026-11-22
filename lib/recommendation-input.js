/**
 * The one preparation of recommendation input (LIN-3469).
 *
 * Every recommendation entrance (the proxy's single hop, the workspace API's
 * deterministic descent, its streaming descent and its terminal hop) hands
 * getRecommendation / getRecommendationStream the same reduced object: the fetched task
 * context's fields the routing and stage prompts read, plus the task's recent runs
 * (LIN-3300). This is that projection, once.
 *
 * Deliberately built from the explicit field list in promptContextOf, not `{ ...ctx, runs }`: a passthrough would leak
 * every extra field of the fetched context into the routing prompt. `siblingsTotal` is
 * live on the context but is NOT forwarded; forwarding it would change the selector
 * prompt. `attachments` (LIN-777) is forwarded so the ## Attachments section reaches the
 * routing and stage prompts.
 *
 * `allRuns` (LIN-4370) is every stage run the same single store read returned, unsliced, with
 * each run's dispatch time: the look-first route (lib/recommendation-look-first.js) reads its
 * attempts and, since LIN-4497, an implementation run's own `pr` from it. `null` when the read failed (attempts unknown). No prompt renders it; the
 * selector's lines read `runs` only.
 *
 * It is not folded into getRecommendation: that layer must not load from the dispatch
 * store. Callers await it where they always did, including inside the proxy hop's
 * deadline callback.
 */
import { loadRecentRuns } from './recent-runs.js';
import { readOpenFindings } from './close-out-findings.js';
import { promptContextOf } from './prompts/prompt-context.js';
import { landingChangesFor } from './records/landing.js';
import { planFactsNotMeasured } from './records/plan-facts.js';
import { trailForTicket } from './task-standing.js';
import { reviewRoundOf } from './prompts/fix-round.js';
import { loopFactsOf } from './recommendation-facts.js';

/**
 * @param {Object} ctx - fetched task context ({ parent, siblings, project, children, comments, focusedChild, attachments })
 * @param {Object} opts
 * @param {Object} opts.dispatchQueueStore - the dispatch store runs are read from
 * @param {string} opts.urlKey - the workspace url key
 * @param {string} opts.identifier - the task's identifier
 * @param {Object} [opts.recordsStore] - LIN-4495: the records store the open findings to close-out are read from
 * @returns {Promise<Object>} the reduced input, with `runs`, `allRuns`, `openFindings` (the one reading, lib/close-out-findings.js)
 *   and `asked` (LIN-4501: the task's immutable words, lib/records-store.js askedForTicket; null with no task or store)
 *   and `planFacts` (LIN-4504: the ticket's plan facts from records, lib/records/plan-facts.js; not measured with no store
 *   or on a records fault, never "no plan")
 */
export async function prepareRecommendationInput(ctx, { dispatchQueueStore, urlKey, identifier, recordsStore = null }) {
  const { focusedChild } = ctx;
  const { runs, allRuns } = await loadRecentRuns(dispatchQueueStore, urlKey, identifier);
  const openFindings = await readOpenFindings({
    store: recordsStore, urlKey, ticket: identifier,
  });
  const trail = await trailOfTicketOf(recordsStore, urlKey, identifier);
  const planReviewRun = await planReviewRunOfTicket(recordsStore, urlKey, identifier);
  // The fields every prompt surface reads come from promptContextOf (lib/prompts/prompt-context.js), the one list;
  // this adds focusedChild, runs and allRuns. A field added to the builder reaches the routing input from there.
  return {
    ...promptContextOf(ctx), focusedChild, runs, allRuns, openFindings,
    asked: await askedForTicketOf(recordsStore, urlKey, identifier),
    planFacts: await planFactsForTicketOf(recordsStore, urlKey, identifier),
    landingChanges: await landingChangesOf(recordsStore, urlKey, identifier),
    // LIN-4518 step 3: the review, the blind read and the landing, from the ticket's records (null: not read).
    trail,
    reviewRound: reviewRoundOf(trail),
    // LIN-4520: the plan-review run from records (null: not read), and the loop's facts over it (LIN-4518 finding-55356e66).
    planReviewRun,
    planReviewLoop: planReviewRun ? loopFactsOf(planReviewRun, ctx.comments || []) : null,
  };
}

/**
 * LIN-4518 (finding-55356e66): the plan-review loop's facts (lib/recommendation-facts.js loopFactsOf): the run of verdicts
 * and their blocking findings from the ticket's records, and a person's comment or landed work since its latest verdict.
 * Null with no store, no identifier or a records fault (logged): the loop is not read, so the bound stands aside.
 */
async function planReviewRunOfTicket(recordsStore, urlKey, identifier) {
  if (!recordsStore || typeof recordsStore.planReviewRunForTicket !== 'function' || !identifier) return null;
  try {
    return await recordsStore.planReviewRunForTicket(urlKey, identifier);
  } catch (err) {
    console.error(`[recommend] the plan-review run could not be read (${urlKey} ${identifier}): ${err?.message || err}`);
    return null;
  }
}

/**
 * LIN-4518 step 3: the ticket's trail from records (lib/task-standing.js trailForTicket), the one read every gate and the
 * selector take it from. Null with no store or identifier, or on a records fault (logged by the standing read): "not read".
 */
async function trailOfTicketOf(recordsStore, urlKey, identifier) {
  if (!recordsStore || typeof recordsStore.taskForTicket !== 'function' || !identifier) return null;
  return trailForTicket({ recordsStore, urlKey, ticket: identifier });
}

/**
 * LIN-4518 step 2: the change records a blind read would judge (lib/records/landing.js landingChangesFor), so a routed or
 * code-routed blind-read prompt can name them. Null with no store, no identifier or a records fault (logged): "not read".
 */
async function landingChangesOf(recordsStore, urlKey, identifier) {
  if (!recordsStore || typeof recordsStore.taskForTicket !== 'function' || !identifier) return null;
  try {
    return await landingChangesFor({ urlKey, ticket: identifier, recordsStore });
  } catch (err) {
    console.error(`[recommend] the landing's change records could not be read (${urlKey} ${identifier}): ${err?.message || err}`);
    return null;
  }
}

/**
 * LIN-4504: the ticket's plan facts, the one producer of every plan fact the selector, look-first and the node facts
 * read (lib/openrouter.js buildSelectorArgs). A list of one through the batched reader. With no store, no identifier or
 * a records fault (logged) they read "not measured", never "no plan": a missed caller shows instead of re-planning.
 */
async function planFactsForTicketOf(recordsStore, urlKey, identifier) {
  if (!recordsStore || typeof recordsStore.planFactsForTickets !== 'function') return planFactsNotMeasured('no records store for this recommendation');
  if (!identifier) return planFactsNotMeasured('no ticket identifier');
  try {
    return (await recordsStore.planFactsForTickets(urlKey, [identifier])).get(identifier) || planFactsNotMeasured('the records read gave no answer for this ticket');
  } catch (err) {
    console.error(`[recommend] the plan facts could not be read (${urlKey} ${identifier}): ${err?.message || err}`);
    return planFactsNotMeasured(`the records read failed (${err?.message || 'unavailable'})`);
  }
}

/** LIN-4501: the task's `asked` for the look-first route; null with no store or task, or on a records fault (logged). */
async function askedForTicketOf(recordsStore, urlKey, identifier) {
  if (!recordsStore || typeof recordsStore.askedForTicket !== 'function' || !identifier) return null;
  try {
    return await recordsStore.askedForTicket(urlKey, identifier);
  } catch (err) {
    console.error(`[recommend] the task's asked could not be read (${urlKey} ${identifier}): ${err?.message || err}`);
    return null;
  }
}
