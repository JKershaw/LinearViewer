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
import { ingestPersonComments, personFindingsOf } from './comment-ingest.js';
import { STAGE_KINDS } from './prompts/stage-kinds.js';

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
  // LIN-4535: the person's findings on the task, read after the ingest takes the ticket's new person comments (lib/comment-ingest.js).
  const personFindings = await personFindingsOfTicket(recordsStore, urlKey, identifier, ctx.comments || []);
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
    planReviewLoop: planReviewRun ? loopFactsOf(planReviewRun, personFindings ?? []) : null,
    // LIN-4535: the person's findings (lib/comment-ingest.js personFindingsOf; null is not read). The selector and look-first
    // read these in place of a comment's text. `runTimes` are the dispatch times of the task's runs (the rule's "later dispatched run").
    personFindings,
    // LIN-4538 (P7a): the person's answered questions on the task (the selector's latest ruling), from question records.
    answeredQuestions: await answeredByPersonOfTicket(recordsStore, urlKey, identifier),
    // LIN-4542 (P8): the size of the move is a standing decision by scoping on the task (null is not read). The selector's
    // size line and look-first read it; no description section is read for it.
    sizeDecisions: await sizeDecisionsOfTicket(recordsStore, urlKey, identifier),
    runTimes: allRuns ? allRuns.map((r) => Date.parse(r.dispatchedAt)).filter(Number.isFinite) : null,
  };
}

/**
 * LIN-4538 (P7a): the questions on the task that a PERSON answered (state `answered`, ended by `person:<account>`), each with the
 * time it was answered. Null with no store, no identifier or a records fault (logged): the selector then says "none" only when
 * the records were read, never on a fault. An answer by a deciding stage is not a person's ruling and is left out.
 */
async function answeredByPersonOfTicket(recordsStore, urlKey, identifier) {
  if (!recordsStore || typeof recordsStore.taskForTicket !== 'function' || !identifier) return null;
  try {
    const taskId = await recordsStore.taskForTicket(urlKey, identifier);
    if (!taskId) return [];
    const answered = await recordsStore.find(urlKey, { kind: 'question', state: 'answered', inRef: taskId });
    return answered
      .filter((q) => typeof q.by === 'string' && q.by.startsWith('person:'))
      .map((q) => ({ questionId: q.id, at: q.at ?? null }));
  } catch (err) {
    console.error(`[recommend] the answered questions could not be read (${urlKey} ${identifier}): ${err?.message || err}`);
    return null;
  }
}

/**
 * LIN-4542 (P8): the size of the move on the task: its standing decisions written by scoping (`by` the scoping stage, `in` the
 * task, state `stands`), oldest first, each as { id, answer, why, at }. A superseded or withdrawn one is not standing and is
 * left out; so is a person's decision (an answer to scoping's question resumes scoping, which then writes the size). [] when
 * the task has none or no task is on record; null with no store, no identifier or a records fault (logged), so the size reads
 * "not measured", never "not decided".
 */
async function sizeDecisionsOfTicket(recordsStore, urlKey, identifier) {
  if (!recordsStore || typeof recordsStore.taskForTicket !== 'function' || !identifier) return null;
  try {
    const taskId = await recordsStore.taskForTicket(urlKey, identifier);
    if (!taskId) return [];
    const standing = await recordsStore.find(urlKey, { kind: 'decision', state: 'stands', inRef: taskId });
    return standing
      .filter((d) => d.by === STAGE_KINDS.scoping.name)
      .map((d) => ({ id: d.id, answer: d.fields?.answer ?? null, why: d.fields?.why ?? null, at: d.at ?? null }))
      .sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  } catch (err) {
    console.error(`[recommend] the size decisions could not be read (${urlKey} ${identifier}): ${err?.message || err}`);
    return null;
  }
}

/**
 * LIN-4535: the ticket's person findings. The ingest first takes its new person comments as findings (once each, by their
 * fixed ids), then the task's person findings are read. Null with no store, no identifier, no task or a records fault (logged).
 */
async function personFindingsOfTicket(recordsStore, urlKey, identifier, comments) {
  if (!recordsStore || typeof recordsStore.taskForTicket !== 'function' || !identifier) return null;
  try {
    await ingestPersonComments({ urlKey, ticket: identifier, comments });
    const taskId = await recordsStore.taskForTicket(urlKey, identifier);
    if (!taskId) return [];
    return personFindingsOf(await recordsStore.find(urlKey, { kind: 'finding', inRef: taskId }));
  } catch (err) {
    console.error(`[recommend] the person's findings could not be read (${urlKey} ${identifier}): ${err?.message || err}`);
    return null;
  }
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
