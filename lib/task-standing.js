/**
 * LIN-4518 (P5 of LIN-4513): the one reader of a ticket's standing, from records. Every gate and route that decides from a
 * review, a blind read, the landing or work after review reads it here: close-out's guard and merge recorder, the blind-read
 * route, the selector's facts and the live-stage wait. It takes the ticket's task from the store (the claim the ticket made),
 * never from a comment.
 *
 * The judgement words are the verdict vocabulary of the review and the blind read. They are spelled here, beside the
 * readers that use them, because lib/records/ imports only Platform and takes them as input (standing.js).
 *
 * With no task on record the standing is the empty one: no review, no landing, nothing to wait on. A records read that
 * throws is logged and answered `null` ("not read"), so a caller can tell an empty ticket from an unread one.
 */
import { readStandingRecords, standingOf, trailOfStanding } from './records/standing.js';
import { prRefOf } from './records/change-ref.js';
import { readTrail } from './run-trail.js';
import { BLIND_READ_KIND } from './prompts/blind-read-words.js';

/** The verdict judgement of a review (a records word, lib/records/kinds.json outcome sets). */
export const REVIEW_JUDGEMENT = 'review';

const JUDGEMENTS = Object.freeze({ review: REVIEW_JUDGEMENT, blindRead: BLIND_READ_KIND });

/** The standing of a ticket with no task on record: nothing reviewed, no landing. */
export function emptyStanding() {
  return standingOf({ taskId: null, versions: [], judgements: JUDGEMENTS });
}

/**
 * The standing of a ticket, read from the records store, or `null` when the read fails (logged).
 * @param {Object} deps
 * @param {Object|null} deps.recordsStore - the records store; null means "no store": not read
 * @param {string} deps.urlKey
 * @param {string} deps.ticket - the ticket's identifier
 * @returns {Promise<ReturnType<typeof standingOf>|null>}
 */
export async function standingForTicket({ recordsStore, urlKey, ticket }) {
  if (!recordsStore || typeof recordsStore.taskForTicket !== 'function' || !ticket) return null;
  try {
    const taskId = await recordsStore.taskForTicket(urlKey, ticket);
    if (!taskId) return emptyStanding();
    return await readStandingRecords({ recordsStore, urlKey, taskId, judgements: JUDGEMENTS });
  } catch (err) {
    console.error(`[standing] the ticket's standing could not be read (${urlKey} ${ticket}): ${err?.message || err}`);
    return null;
  }
}

/**
 * Which trail a gate reads (LIN-4518, the transition until verdict writes move to records in beat 4): the records standing
 * when the task's newest verdict is a record, else the comment trail, as the gates read it before this slice. A verdict
 * written on records at or after the newest review comment is the newest verdict, so the records govern; an older record
 * (a cutover import, say) yields to a newer review comment. With no review anywhere, or no records review, the comments
 * govern and the answer is the one the comment path always gave.
 *
 * Returns null when neither source is given (no standing and no comments): nothing is known, so the caller stands aside.
 * @param {Object} input
 * @param {ReturnType<typeof standingOf>|null|undefined} input.standing - the records standing (null: not read)
 * @param {Array<{body: string, createdAt?: string}>|null|undefined} input.comments - the ticket's comments; undefined: not read
 * @returns {{source: 'records'|'comments', trail: Object}|null}
 */
export function gateTrailOf({ standing, comments } = {}) {
  if (!standing && comments === undefined) return null;
  const commentTrail = readTrail(Array.isArray(comments) ? comments : []);
  const commentReviewAt = commentTrail.reviewComment ? Date.parse(commentTrail.reviewComment.createdAt || '') : null;
  if (standing?.review) {
    const recordAt = Date.parse(standing.review.at || '');
    if (commentReviewAt === null || Number.isNaN(commentReviewAt) || recordAt >= commentReviewAt) {
      return { source: 'records', trail: trailOfStanding(standing) };
    }
  }
  return { source: 'comments', trail: commentTrail };
}

/**
 * The PRs one run reported (LIN-4518): the change records of the ticket's task that were filed under that run, each as
 * `{url, repo, number, corroborated}` (the run-evidence shape). Empty when the ticket has no task, the run filed no change,
 * or the records cannot be read (logged): the caller falls back to the comments, as before.
 * @param {Object} input
 * @param {Object|null} input.recordsStore
 * @param {string} input.urlKey
 * @param {string} input.ticket
 * @param {string} input.runId
 * @returns {Promise<Array<{url: string, repo: string, number: number, corroborated: boolean}>>}
 */
export async function changePrsOfRun({ recordsStore, urlKey, ticket, runId }) {
  if (!recordsStore || typeof recordsStore.taskForTicket !== 'function' || !ticket || !runId) return [];
  try {
    const taskId = await recordsStore.taskForTicket(urlKey, ticket);
    if (!taskId) return [];
    const changes = await recordsStore.find(urlKey, { kind: 'change', inRef: taskId });
    return changes
      .filter((c) => c.run === runId)
      .map((c) => prRefOf(c.fields?.ref))
      .filter(Boolean)
      .map((pr) => ({ url: pr.url, repo: pr.repo, number: pr.number, corroborated: false }));
  } catch (err) {
    console.error(`[standing] the run's changes could not be read (${urlKey} ${ticket} ${runId}): ${err?.message || err}`);
    return [];
  }
}
