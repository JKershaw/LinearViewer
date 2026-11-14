/**
 * The one preparation of recommendation input (LIN-3469).
 *
 * Every recommendation entrance (the proxy's single hop, the workspace API's
 * deterministic descent, its streaming descent and its terminal hop) hands
 * getRecommendation / getRecommendationStream the same reduced object: the fetched task
 * context's fields the routing and stage prompts read, plus the task's recent runs
 * (LIN-3300). This is that projection, once.
 *
 * Deliberately an explicit field list, not `{ ...ctx, runs }`: a passthrough would leak
 * every extra field of the fetched context into the routing prompt. `siblingsTotal` is
 * live on the context but is NOT forwarded; forwarding it would change the selector
 * prompt. `attachments` (LIN-777) is forwarded so the ## Attachments section reaches the
 * routing and stage prompts.
 *
 * `allRuns` (LIN-4370) is every stage run the same single store read returned, unsliced, with
 * each run's dispatch time: the look-first route (lib/recommendation-look-first.js) reads its
 * attempts from it. `null` when the read failed (attempts unknown). No prompt renders it; the
 * selector's lines read `runs` only.
 *
 * It is not folded into getRecommendation: that layer must not load from the dispatch
 * store. Callers await it where they always did, including inside the proxy hop's
 * deadline callback.
 */
import { loadRecentRuns } from './recent-runs.js';

/**
 * @param {Object} ctx - fetched task context ({ parent, siblings, project, children, comments, focusedChild, attachments })
 * @param {Object} opts
 * @param {Object} opts.dispatchQueueStore - the dispatch store runs are read from
 * @param {string} opts.urlKey - the workspace url key
 * @param {string} opts.identifier - the task's identifier
 * @returns {Promise<Object>} the reduced input, with `runs` and `allRuns`
 */
export async function prepareRecommendationInput(ctx, { dispatchQueueStore, urlKey, identifier }) {
  const { parent, siblings, project, children, comments, focusedChild, attachments } = ctx;
  const { runs, allRuns } = await loadRecentRuns(dispatchQueueStore, urlKey, identifier);
  // The six fields promptContextOf projects (lib/prompts/prompt-context.js) are listed here too, plus focusedChild, runs
  // and allRuns. The list stays explicit, and its order stays as it was: a test pins that every promptContextOf field
  // reaches this object, so a field added there cannot miss the routing input.
  return { parent, siblings, project, children, comments, focusedChild, attachments, runs, allRuns };
}
