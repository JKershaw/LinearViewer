/**
 * LIN-4535 (P5, plan D5, D6-ender): a person's comment reaches its task once, as a finding under its real author.
 *
 * This module is the ONLY code that decides who wrote a comment (tests/unit/lin-4535-comments-inward.test.js pins that).
 * The rule is structural, not textual:
 *   - the comment is newer than the workspace's cutover instant (set at boot of the deploying version, so a comment
 *     posted before it is never reprocessed and one posted after it is not lost);
 *   - its id is not in the Harbour-comments ledger (lib/harbour-comment-post.js: Harbour's own posts);
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
import { RULING_MARK } from './run-trail.js';

/** Our words for a finding made from a person's comment, when a stage later ends it. */
const CARRIED_REASON = (runId) => `carried into run ${runId}'s brief`;

let config = null;

/**
 * @param {Object|null} deps
 * @param {{add: Function, end: Function}} deps.writes - lib/records/writes.js createRecordWrites (the checked pipeline)
 * @param {(urlKey: string) => Promise<Array<{accountId: string, name: string, trackerUserId?: string}>>} deps.listPeople
 * @param {(urlKey: string) => Promise<number|null>} deps.cutoffOf - the cutover instant in ms, or null (none: all comments count)
 * @param {{wereRecordedByHarbour: Function}} deps.ledger - lib/harbour-comments-store.js
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
    const commentId = c?.commentId || c?.id;
    if (typeof commentId !== 'string' || !commentId) continue;
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
  const recorded = await config.ledger.wereRecordedByHarbour(urlKey, comments);
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
 * The finding for a person's reply that a route posted itself (the page's reply, which goes out under the workspace's own
 * credential and so cannot be credited by the tracker). The comment is ledgered as Harbour's, so the ingest skips it; this
 * writes its finding under the same fixed id the ingest would have used. The ticket's task is made if it has none, through
 * `ctx` (the writer's tracker access), so the reply is never lost.
 * @returns {Promise<{ok: true, taskId: string}|{ok: false, reason: string}>}
 */
export async function recordPersonReplyFinding({ ctx = null, urlKey, ticket, accountId, commentId, body, createdAt = null }) {
  if (!config) return { ok: false, reason: 'the comment ingest is not configured' };
  const taskId = (await config.taskForTicket(urlKey, ticket)) ?? (await config.taskOfTicket(ctx, urlKey, ticket));
  if (!taskId) return { ok: false, reason: `${ticket} has no task to file the reply under` };
  const out = await writePersonFinding({ urlKey, taskId, accountId, commentId, body, createdAt });
  return out.ok ? { ok: true, taskId } : { ok: false, reason: out.reason };
}

/**
 * The person's findings on a task, as the selector reads them: a finding `by person:<id>` made `via` a comment (the ingest,
 * or the page reply, which writes its own finding with the same `via`). Oldest first. `ruling` marks an answer the page's
 * reply route tagged (RULING_MARK, kept until the ruling machinery retires, P7b).
 * @param {Array<{id?: string, by?: string, via?: string|null, at?: string, fields?: {says?: string}}>} findings
 * @returns {Array<{id: string, at: string, accountId: string, says: string, ruling: boolean}>}
 */
export function personFindingsOf(findings) {
  return (Array.isArray(findings) ? findings : [])
    .filter((f) => typeof f?.by === 'string' && f.by.startsWith('person:') && f.via === 'comment')
    .map((f) => {
      const says = typeof f.fields?.says === 'string' ? f.fields.says : '';
      return { id: f.id, at: f.at, accountId: f.by.slice('person:'.length), says, ruling: says.trimEnd().endsWith(RULING_MARK) };
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * The person's finding for a comment, or null: the finding written for that comment's fixed id (the ingest's and the page
 * reply's rule). Matched by id, never by the comment's words.
 * @param {Array<{id: string}>} personFindings - personFindingsOf's output
 * @param {{commentId?: string, id?: string}} comment
 */
export function personFindingOfComment(personFindings, comment) {
  const commentId = comment?.commentId || comment?.id;
  if (typeof commentId !== 'string' || !commentId) return null;
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
    if (!(typeof f?.by === 'string' && f.by.startsWith('person:') && f.via === 'comment')) continue;
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
