/**
 * LIN-4518 (P5 of LIN-4513, plan-f77d6aea item 1): the one reader of a ticket's standing, from records. A gate that decides
 * from a review, a blind read, the landing or work after review reads it here. It takes the ticket's task from the store
 * (the claim the ticket made), never from a comment.
 *
 * Before it reads, it refreshes the task's open changes from their PRs (refreshTaskChanges), so a push after a verdict is
 * stale on the first read that follows it, not only after some later verdict write (LIN-4518 review finding d99d9922).
 * The refresh fails open: a PR that cannot be read is logged and the read goes on.
 *
 * The judgement words are the verdict vocabulary of the review and the blind read. They are spelled here, beside the
 * reader that uses them, because lib/records/ imports only Platform and takes them as input (standing.js).
 *
 * With no task on record the standing is the empty one: no review, no landing, nothing to wait on. A records read that
 * throws is logged and answered `null` ("not read"), so a caller can tell an empty ticket from an unread one.
 */
import { readStandingRecords, standingOf, trailOfStanding } from './records/standing.js';
import { createRecordWrites } from './records/writes.js';
import { refreshTaskChanges } from './change-records.js';
import { isTerminalState } from './providers/state-map.js';
import { BLIND_READ_KIND } from './prompts/blind-read-words.js';
import { REVIEW_JUDGEMENT } from './records/words.js';

const JUDGEMENTS = Object.freeze({ review: REVIEW_JUDGEMENT, blindRead: BLIND_READ_KIND });

let standingPrReaderFor = null;
let warnedNoReader = false;

/**
 * The per-workspace PR reader the head refresh reads through. Wired once at boot (server.js, from the same
 * createChangePrReaders the verdict route's refresh uses), so every standing read refreshes first.
 * Unset, the standing is read without a refresh, and that is logged once.
 * @param {((urlKey: string) => (args: {repo: string, number: number}) => Promise<object>)|null} fn
 */
export function setStandingPrReaderFor(fn) {
  standingPrReaderFor = typeof fn === 'function' ? fn : null;
}

/** The standing of a ticket with no task on record: nothing reviewed, no landing. */
export function emptyStanding() {
  return standingOf({ taskId: null, versions: [], judgements: JUDGEMENTS });
}

/**
 * The head refresh a standing read runs first: one refreshTaskChanges over the task's open changes. Fail open: a refresh
 * that cannot run is logged and the read goes on.
 */
export async function refreshTaskHeads({ recordsStore, urlKey, taskId }) {
  if (!standingPrReaderFor) {
    if (!warnedNoReader) {
      warnedNoReader = true;
      console.warn(`[standing] no PR reader is wired (setStandingPrReaderFor): standing reads do not refresh change heads (${urlKey} ${taskId})`);
    }
    return;
  }
  try {
    const writes = createRecordWrites({ recordsStore, isTerminalState });
    await refreshTaskChanges({ urlKey, taskId, writes, recordsStore, readPrStatus: standingPrReaderFor(urlKey) });
  } catch (err) {
    console.error(`[standing] ${urlKey} ${taskId}: the head refresh before a standing read failed: ${err?.message || err}`);
  }
}

/**
 * The standing of a ticket, read from the records store, or `null` when the read fails (logged). The task's open changes
 * are refreshed from their PRs first (refreshTaskHeads), so the standing reads the heads as they are now.
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
    await refreshTaskHeads({ recordsStore, urlKey, taskId });
    return await readStandingRecords({ recordsStore, urlKey, taskId, judgements: JUDGEMENTS });
  } catch (err) {
    console.error(`[standing] the ticket's standing could not be read (${urlKey} ${ticket}): ${err?.message || err}`);
    return null;
  }
}

/**
 * The trail a gate reads, from records (LIN-4518 step 3): `trailOfStanding` over the ticket's standing, the one trail
 * `closeOutDecision` and every reader that takes a trail read (LIN-4520 retired the comment trail). Null when the
 * standing could not be read (logged by standingForTicket), so a caller refuses instead of reading an unread ticket as
 * "no review, no landing".
 * @returns {Promise<ReturnType<typeof trailOfStanding>|null>}
 */
export async function trailForTicket({ recordsStore, urlKey, ticket }) {
  const standing = await standingForTicket({ recordsStore, urlKey, ticket });
  return standing ? trailOfStanding(standing) : null;
}
