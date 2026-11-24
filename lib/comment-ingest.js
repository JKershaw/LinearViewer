/**
 * LIN-4535 (P5, plan D5, D6-ender): a person's comment reaches its task once, as a finding under its real author.
 *
 * Who wrote a comment is settled in one of two places, never both (LIN-4548):
 *   - a comment Harbour posts (the proxy, the page's reply box, the records' summaries) is settled at the post, from the
 *     credential that sent it (lib/harbour-comment-post.js): a person's own credential files their finding there, through
 *     recordPersonCommentFinding below, and every such post is in the Harbour-comments ledger;
 *   - a comment typed in the tracker is settled here, from the tracker's author id. This module is the ONLY code that reads
 *     a comment's author id (tests/unit/lin-4535-comments-inward.test.js pins that).
 * The ingest's rule is structural, not textual:
 *   - the comment is newer than the workspace's cutover instant (set at boot of the deploying version, so a comment
 *     posted before it is never reprocessed and one posted after it is not lost);
 *   - its id is not in the Harbour-comments ledger (posted through Harbour, so its author was settled at the post);
 *   - its author's tracker user id is a workspace person's `trackerUserId` (lib/workspace-people.js).
 * A comment that fails any clause is left out. Nothing is credited to the owner by default: a comment with no author id,
 * or an id no person has, is never a person's.
 *
 * The person's comment becomes a `finding` (by `person:<accountId>`, via `comment`, to and in the task), under a fixed id
 * from the comment's id. A second pass finds the record already there, so a comment is ingested once however many reads
 * see it. A stage run that carried the finding ends it done (endCarriedPersonFindings), so the next brief does not repeat it.
 *
 * Configured once at boot (configureCommentIngest) with the records writer, the workspace-person reader, the cutover reader
 * and the ledger. An unconfigured process ingests nothing, which is the test harness and nothing else.
 */
import { fixedIdOf } from './records/refs.js';
import { resolveCommentId } from './harbour-comments-store.js';

/** Our words for a finding made from a person's comment, when a stage later ends it. */
const CARRIED_REASON = (runId) => `carried into run ${runId}'s brief`;

let config = null;

/** A person's finding made from a comment: `by person:<id>`, `via comment` (the ingest's, and the comment seam's). */
const isPersonCommentFinding = (f) => typeof f?.by === 'string' && f.by.startsWith('person:') && f.via === 'comment';

/**
 * @param {Object|null} deps
 * @param {{add: Function, end: Function}} deps.writes - lib/records/writes.js createRecordWrites (the checked pipeline)
 * @param {(urlKey: string) => Promise<Array<{accountId: string, name: string, trackerUserId?: string}>>} deps.listPeople
 * @param {(urlKey: string) => Promise<number|null>} deps.cutoffOf - the cutover instant in ms, or null (none: all comments count)
 * @param {{wereRecordedByHarbour: Function}} deps.ledger - lib/harbour-comments-store.js (a read fault throws)
 * @param {(urlKey: string, ticket: string) => Promise<string|null>} deps.taskForTicket - the ticket's task id, or null
 * @param {(ctx: any, urlKey: string, ticket: string) => Promise<string|null>} deps.taskOfTicket - the ticket's task, made if
 *   it has none (through the writer's tracker access `ctx`); null on a failure, which is logged by the caller
 */
export function configureCommentIngest(deps) {
  config = deps || null;
}

/**
 * The person's comments among `comments`, by the rule in the module note. Pure: the reads it needs are passed in.
 * @param {Array<{id?: string, commentId?: string, body?: string, createdAt?: string, authorId?: string|null}>} comments
 * @param {{cutoffAt: number|null, recorded: Set<string>, people: Array<{accountId: string, trackerUserId?: string}>}} inputs
 * @returns {Array<{commentId: string, body: string, createdAt: string, accountId: string}>}
 */
export function personCommentsOf(comments, { cutoffAt = null, recorded = new Set(), people = [] } = {}) {
  const accountByTracker = new Map();
  for (const person of people) {
    if (person?.trackerUserId) accountByTracker.set(String(person.trackerUserId), person.accountId);
  }
  const out = [];
  for (const c of Array.isArray(comments) ? comments : []) {
    const commentId = resolveCommentId(c);
    if (!commentId) continue;
    const at = Date.parse(c.createdAt);
    if (!Number.isFinite(at)) continue;
    if (cutoffAt != null && at <= cutoffAt) continue;
    if (recorded.has(commentId)) continue;
    if (!c.authorId) continue;
    const accountId = accountByTracker.get(String(c.authorId));
    if (!accountId) continue;
    out.push({ commentId, body: typeof c.body === 'string' ? c.body : '', createdAt: c.createdAt, accountId });
  }
  return out;
}

/**
 * The instant a finding is dated with: the comment's own time (finding-83a0ca32), so a comment the run already followed is
 * not "newer" than that run because it was ingested late. Null when the time is not a time (the write's own clock then).
 */
export function findingAtOf(createdAt) {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * One person's comment as a finding on its task, under the comment's fixed id, so a second write finds it already there.
 * It is dated by the comment's own `createdAt`.
 * @returns {Promise<{ok: true}|{ok: false, reason: string}>}
 */
async function writePersonFinding({ urlKey, taskId, accountId, commentId, body, createdAt = null }) {
  try {
    const at = findingAtOf(createdAt);
    const out = await config.writes.add({
      urlKey,
      kind: 'finding',
      input: { says: body, to: taskId, in: taskId },
      by: `person:${accountId}`,
      via: 'comment',
      fixedId: fixedIdOf('finding', 'comment', commentId),
      ...(at ? { at } : {})
    });
    if (out?.problems) return { ok: false, reason: out.problems[0]?.message || 'refused' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

/**
 * Ingest the person's comments on a task's ticket: one finding each. Returns the count written (or found already there).
 * Never throws: a failed write is logged and the rest go on. Unconfigured, or no task yet: nothing (the next read, once the
 * task exists, takes them: the cutover keeps them from being lost).
 * @param {{urlKey: string, ticket: string, comments: Array<object>}} args
 * @returns {Promise<{ingested: number, failed: number}>}
 */
export async function ingestPersonComments({ urlKey, ticket, comments }) {
  if (!config || !ticket || !Array.isArray(comments) || !comments.length) return { ingested: 0, failed: 0 };
  const taskId = await config.taskForTicket(urlKey, ticket);
  if (!taskId) return { ingested: 0, failed: 0 };
  const cutoffAt = await config.cutoffOf(urlKey);
  // A ledger that cannot be read must not let Harbour's own posts (made under the owner's credential, so the
  // owner's tracker id) pass as the owner's words, and the finding's fixed id means a wrong write is never reconsidered. So
  // the batch is skipped; the cutover keeps its comments from being lost, and a later read takes them.
  let recorded;
  try {
    recorded = await config.ledger.wereRecordedByHarbour(urlKey, comments);
  } catch (err) {
    console.error(`[comment-ingest] the Harbour-comments ledger could not be read for ${urlKey} ${ticket}; its comments are not ingested this time: ${err?.message || err}`);
    return { ingested: 0, failed: 0 };
  }
  const people = await config.listPeople(urlKey);
  let ingested = 0;
  let failed = 0;
  for (const c of personCommentsOf(comments, { cutoffAt, recorded, people })) {
    const out = await writePersonFinding({ urlKey, taskId, ...c });
    if (out.ok) ingested += 1;
    else {
      failed += 1;
      console.error(`[comment-ingest] comment ${c.commentId} (${urlKey} ${ticket}) was not ingested: ${out.reason}`);
    }
  }
  return { ingested, failed };
}

/**
 * The finding for a person's comment that Harbour posted (lib/harbour-comment-post.js, LIN-4548): one sent with their own
 * proxy token, or the page's reply box under their session. It goes out under the workspace's credential, so the tracker
 * cannot credit it; the post is ledgered, so the ingest skips it, and the seam writes its finding here under the same
 * fixed id the ingest would have used. The ticket's task is made if it has none, through `ctx` (the writer's tracker
 * access), so the comment is never lost.
 * @returns {Promise<{ok: true, taskId: string}|{ok: false, reason: string}>}
 */
export async function recordPersonCommentFinding({ ctx = null, urlKey, ticket, accountId, commentId, body, createdAt = null }) {
  if (!config) return { ok: false, reason: 'the comment ingest is not configured' };
  const taskId = (await config.taskForTicket(urlKey, ticket)) ?? (await config.taskOfTicket(ctx, urlKey, ticket));
  if (!taskId) return { ok: false, reason: `${ticket} has no task to file the comment under` };
  const out = await writePersonFinding({ urlKey, taskId, accountId, commentId, body, createdAt });
  return out.ok ? { ok: true, taskId } : { ok: false, reason: out.reason };
}

/**
 * The person's findings on a task, as the selector reads them: a finding `by person:<id>` made `via` a comment (the ingest,
 * or the comment seam for a person's comment Harbour posted, which writes its finding with the same `via`). Oldest first. A ruling is an answered question (a
 * decision record), never a comment: the page reply's ruling mark retired with answers as comments (LIN-4541).
 * @param {Array<{id?: string, by?: string, via?: string|null, at?: string, fields?: {says?: string}}>} findings
 * @returns {Array<{id: string, at: string, accountId: string, says: string}>}
 */
export function personFindingsOf(findings) {
  return (Array.isArray(findings) ? findings : [])
    .filter(isPersonCommentFinding)
    .map((f) => {
      const says = typeof f.fields?.says === 'string' ? f.fields.says : '';
      return { id: f.id, at: f.at, accountId: f.by.slice('person:'.length), says };
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * The person's finding for a comment, or null: the finding written for that comment's fixed id (the ingest's and the comment
 * seam's rule). Matched by id, never by the comment's words.
 * @param {Array<{id: string}>} personFindings - personFindingsOf's output
 * @param {{commentId?: string, id?: string}} comment
 */
export function personFindingOfComment(personFindings, comment) {
  const commentId = resolveCommentId(comment);
  if (!commentId) return null;
  const id = fixedIdOf('finding', 'comment', commentId);
  return (Array.isArray(personFindings) ? personFindings : []).find((f) => f.id === id) ?? null;
}

/**
 * End the open person findings a run carried: those in `carried` (the record ids its brief carried, from the brief's query
 * log; lib/records/run-brief.js). A finding the run's brief did not carry stays open for the next run that does. Harbour
 * ends them (by `harbour`, never the agent). Returns the ids ended. Unconfigured or nothing carried: nothing.
 * @param {{urlKey: string, runId: string, carried: Set<string>, findings: Array<object>}} args
 *   `findings`: the task's open findings (the caller's one read), each with `id`, `by`, `via`
 */
export async function endCarriedPersonFindings({ urlKey, runId, carried, findings }) {
  if (!config || !(carried instanceof Set) || !carried.size) return [];
  const ended = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!isPersonCommentFinding(f)) continue;
    if (!carried.has(f.id)) continue;
    try {
      const out = await config.writes.end({
        urlKey,
        id: f.id,
        input: { state: 'done', reason: CARRIED_REASON(runId) },
        by: 'harbour'
      });
      if (!out?.problems) ended.push(f.id);
    } catch (err) {
      console.error(`[comment-ingest] finding ${f.id} (${urlKey}) was not ended after run ${runId}: ${err?.message || err}`);
    }
  }
  return ended;
}
