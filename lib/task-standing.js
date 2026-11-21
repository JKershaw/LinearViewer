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
import { readStandingRecords, standingOf } from './records/standing.js';
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
