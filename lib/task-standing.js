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
import { createRecordWrites } from './records/writes.js';
import { refreshTaskChanges } from './change-records.js';
import { isTerminalState } from './providers/state-map.js';
import { BLIND_READ_KIND } from './prompts/blind-read-words.js';

/** The verdict judgement of a review (a records word, lib/records/kinds.json outcome sets). */
export const REVIEW_JUDGEMENT = 'review';

const JUDGEMENTS = Object.freeze({ review: REVIEW_JUDGEMENT, blindRead: BLIND_READ_KIND });

let standingPrReaderFor = null;
let warnedNoReader = false;

/**
 * LIN-4518 (review finding d99d9922): the per-workspace PR reader the gating reads refresh heads with. Wired once at boot
 * (server.js, from createChangePrReaders, the reader the verdict route's refresh uses), so every gate that reads the
 * standing refreshes first and a push after a verdict shows the verdict stale on every surface, not only at close-out.
 * Unset (no reader), the gating reads run without a refresh and say so in the log once.
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
 * The head refresh a gating read runs before it reads (finding d99d9922): one refreshTaskChanges over the task's open
 * changes. Fail open, as the verdict route's refresh is: a refresh that cannot run is logged and the read goes on, so a
 * PR that cannot be read is never a refusal by itself.
 */
export async function refreshTaskHeads({ recordsStore, urlKey, taskId }) {
  if (!standingPrReaderFor) {
    if (!warnedNoReader) {
      warnedNoReader = true;
      console.warn(`[standing] no PR reader is wired (setStandingPrReaderFor): gating reads do not refresh change heads (${urlKey} ${taskId})`);
    }
    return;
  }
  try {
    const writes = createRecordWrites({ recordsStore, isTerminalState });
    await refreshTaskChanges({ urlKey, taskId, writes, recordsStore, readPrStatus: standingPrReaderFor(urlKey) });
  } catch (err) {
    console.error(`[standing] ${urlKey} ${taskId}: the head refresh before a gating read failed: ${err?.message || err}`);
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
 * The trail a gate reads (LIN-4518, beat 4): the records standing, and nothing else. Verdicts are records (the import ran
 * in production, and the writers write records since beat 3), so a task with no verdict record has no review, and the
 * selector routes it to review. Returns null when the standing was not read (a records fault, or no store): the caller
 * then stands aside, as each gate does for an unread input.
 * @param {{standing: ReturnType<typeof standingOf>|null|undefined}} input
 * @returns {{source: 'records', trail: Object}|null}
 */
export function gateTrailOf({ standing } = {}) {
  if (!standing) return null;
  return { source: 'records', trail: trailOfStanding(standing) };
}

/**
 * The change PRs of a ticket (LIN-4518): each change record's PR on the ticket's task, as `{url, repo, number, corroborated}`
 * (the run-evidence shape). The one reader of them: with `runId`, only the changes filed under that run (the run page's
 * PRs, the run-evidence box); without it, every change on the task (the ci-wake sweep's bare PR numbers). Empty when the
 * ticket has no task, no change matches, or the records cannot be read (logged): the caller falls back to the comments.
 * @param {Object} input
 * @param {Object|null} input.recordsStore
 * @param {string} input.urlKey
 * @param {string} input.ticket
 * @param {string|null} [input.runId=null]
 * @returns {Promise<Array<{url: string, repo: string, number: number, corroborated: boolean}>>}
 */
export async function changePrsOf({ recordsStore, urlKey, ticket, runId = null }) {
  if (!recordsStore || typeof recordsStore.taskForTicket !== 'function' || !ticket) return [];
  try {
    const taskId = await recordsStore.taskForTicket(urlKey, ticket);
    if (!taskId) return [];
    const changes = await recordsStore.find(urlKey, { kind: 'change', inRef: taskId });
    return changes
      .filter((c) => runId === null || c.run === runId)
      .map((c) => prRefOf(c.fields?.ref))
      .filter(Boolean)
      .map((pr) => ({ url: pr.url, repo: pr.repo, number: pr.number, corroborated: false }));
  } catch (err) {
    console.error(`[standing] the ticket's changes could not be read (${urlKey} ${ticket}${runId ? ` run ${runId}` : ''}): ${err?.message || err}`);
    return [];
  }
}
