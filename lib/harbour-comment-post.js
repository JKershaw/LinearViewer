/**
 * LIN-4535 (P5, plan D4), LIN-4548: the one write seam for a comment Harbour posts, and where its author is settled.
 *
 * Every comment Harbour writes through a provider goes through postHarbourComment: the agents' comment route
 * (routes/proxy-writes.js, which also serves the attachment route's comment target), the page's reply route
 * (routes/workspace-api-issue-write.js) and the records' summaries (lib/records-tracker.js). The ledger
 * (lib/harbour-comments-store.js) therefore means "posted through Harbour, its author settled at the post", and the
 * comment-ingest reader (lib/comment-ingest.js) never decides such a comment's author again from the tracker's author id
 * (which names whoever owns the posting credential, often the workspace owner).
 *
 * Who wrote it (LIN-4548): every caller says, as `by`. A comment is a person's when it is sent with that person's own
 * credential: a proxy token that is positively theirs (lib/run-lineage.js `personOfCredential`, the records API's own
 * person test) or the page's reply box under their session. Anything else is Harbour's (`HARBOUR`): a dispatch token,
 * with a run or without, an old token with no origin, and the records' summaries. After a person's post lands, the seam
 * files it as that person's finding on the ticket's task (lib/comment-ingest.js `recordPersonCommentFinding`, the same
 * fixed id the ingest uses for a comment typed in the tracker), so it reaches its task once. The finding is best effort:
 * a failure is logged and never fails the post (the comment is written). A dedupe hit's repair
 * (repairHarbourCommentRecord) files it again, idempotently, which heals a finding write that failed the first time.
 *
 * Two orders, by what the tracker accepts:
 *   - Record before post, where the provider takes a client-chosen comment id (Linear: `provider.clientCommentIds`,
 *     introspected as CommentCreateInput.id). Harbour mints the id, records it, then posts with that id. A record that
 *     never lands means NOTHING is posted and the answer is a refusal, so a lost record cannot make a Harbour post
 *     look human. No gap is possible on this path.
 *   - Record after post, where the tracker mints the id (GitHub, Jira, Local). The id is known only from the answer,
 *     so the record follows the post, with bounded retries. A record that never lands is then a counted, logged gap:
 *     the comment reads as its author's, which for a comment posted with the owner's key is the owner's
 *     (harbourCommentLedgerGaps). The gap is the reason the record-before order is used wherever the tracker allows it.
 *
 * The ledger is registered once at boot (configureHarbourCommentLedger). A process that never registers one posts
 * without recording, and nothing counts as a gap: that is the test harness and nothing else.
 */
import { randomUUID } from 'node:crypto';
import { looksLikeTicket } from './records/refs.js';
import { recordPersonCommentFinding } from './comment-ingest.js';

/** The `by` of a comment Harbour itself writes (a run's, or Harbour's own words): never a person's finding. */
export const HARBOUR = 'harbour';

/** How many times a failed ledger record is attempted in all (the first try included). */
export const LEDGER_ATTEMPTS = 3;

let ledger = null;
let gaps = 0;

/** Register the workspace's Harbour-comments ledger (server boot). Pass null to clear it (tests). */
export function configureHarbourCommentLedger(store) {
  ledger = store || null;
}

/**
 * How many Harbour-posted comments went unrecorded after every attempt, in this process. Only tests read it today: in
 * production a gap is the `LEDGER GAP` log line, and the count is there for a monitor to read later.
 */
export function harbourCommentLedgerGaps() {
  return gaps;
}

/** Test seam: zero the gap counter. */
export function resetHarbourCommentLedgerGaps() {
  gaps = 0;
}

/** The comment id in a provider answer: the envelope's `comment`, or the bare entity (Local, GitHub). */
export function commentIdOf(answer) {
  const comment = commentOf(answer);
  const id = comment && typeof comment === 'object' ? comment.id : null;
  return typeof id === 'string' && id ? id : null;
}

/** The comment entity in a provider answer: the envelope's `comment`, or the bare entity. */
function commentOf(answer) {
  return answer && typeof answer === 'object' && 'comment' in answer ? answer.comment : answer;
}

/**
 * The account a comment's `by` names, or null for Harbour's own. Every caller states `by`: a missing or malformed one
 * throws, so no post is ever filed under a guess.
 * @param {string} by - HARBOUR, or `person:<accountId>`
 * @returns {string|null}
 */
function accountOfBy(by) {
  if (by === HARBOUR) return null;
  if (typeof by === 'string' && by.startsWith('person:') && by.length > 'person:'.length) return by.slice('person:'.length);
  throw new TypeError(`a Harbour comment post must say who wrote it: by is '${HARBOUR}' or 'person:<accountId>', not ${JSON.stringify(by)}`);
}

/**
 * File a person's posted comment as their finding on its ticket's task. The ticket is the issue ref when it reads as one,
 * else the provider's issueDetail names it; the task is made if the ticket has none (lib/comment-ingest.js). Best effort:
 * never throws, a failure is logged.
 * @param {{urlKey: string, accountId: string, commentId: string, createdAt?: string|null,
 *   finding: {ctx: {provider: any, token: any}, issueRef: string, body: string}}} args
 */
async function filePersonFinding({ urlKey, accountId, commentId, createdAt = null, finding }) {
  const { ctx = null, issueRef = null, body = '' } = finding || {};
  try {
    const ticket = looksLikeTicket(issueRef) ? issueRef : (await ctx?.provider?.issueDetail?.(ctx.token, issueRef))?.identifier;
    const filed = ticket
      ? await recordPersonCommentFinding({ ctx, urlKey, ticket, accountId, commentId, body, createdAt })
      : { ok: false, reason: `${issueRef} could not be read to name its ticket` };
    if (!filed.ok) console.error(`[harbour-comment] comment ${commentId} on ${issueRef} (${urlKey}) by person:${accountId} has no finding: ${filed.reason}`);
  } catch (err) {
    console.error(`[harbour-comment] comment ${commentId} on ${issueRef} (${urlKey}) by person:${accountId} has no finding: ${err?.message || err}`);
  }
}

/**
 * Write one ledger record, with the bounded retries. Resolves true when it lands; false after every attempt (each failure
 * logged). Throws nothing.
 */
async function storeWithRetries(store, urlKey, commentId) {
  for (let attempt = 1; attempt <= LEDGER_ATTEMPTS; attempt++) {
    try {
      const stored = await store.record({ urlKey, commentId });
      if (stored) return true;
    } catch (err) {
      console.error(`[harbour-comment] ledger record attempt ${attempt} threw for ${commentId}:`, err?.message || err);
    }
  }
  return false;
}

// Who posted each comment answer a dedupe cache holds, keyed by the cached answer itself (a side map, so the answer a
// consumer is served is unchanged). The dedupe keys carry no credential, so a repeat from another credential is served the
// first poster's answer; its repair must credit that first poster, never the one repeating (LIN-4548).
const posters = new WeakMap();

/** Remember who posted `answer`, the value about to be put in a dedupe cache. Returns it. */
export function rememberCommentPoster(answer, by) {
  if (answer && typeof answer === 'object') posters.set(answer, by);
  return answer;
}

/** Who posted a cached answer: the `by` remembered with it, or Harbour when none was (so a repair never invents a person). */
export function commentPosterOf(answer) {
  return (answer && typeof answer === 'object' && posters.get(answer)) || HARBOUR;
}

/**
 * Repair a comment Harbour already posted (a dedupe hit, LIN-2649 S1/F2): the original post's own ledger record may have
 * failed, and so may a person's finding (LIN-4548). Re-records it with the post's bounded retries (an idempotent upsert, so
 * a comment already recorded is unchanged), and for a person's comment files the finding again under its fixed id (found
 * already there when the first write landed). Never throws and never gates the caller's response; a repair that does not
 * land is logged.
 * @param {{urlKey: string, comment: {id?: string, createdAt?: string}|null, by: string,
 *   finding?: {ctx: any, issueRef: string, body: string}|null, store?: {record: Function}|null}} args
 *   `by` and `finding` as for postHarbourComment
 * @returns {Promise<boolean>} whether the ledger record landed (false with no id or no ledger)
 */
export async function repairHarbourCommentRecord({ urlKey, comment, by, finding = null, store = null }) {
  const accountId = accountOfBy(by);
  const commentId = comment?.id;
  if (typeof commentId !== 'string' || !commentId) return false;
  const target = store || ledger;
  let landed = false;
  if (target) {
    landed = await storeWithRetries(target, urlKey, commentId);
    if (!landed) console.error(`[harbour-comment] ledger repair of ${commentId} (${urlKey}) did not land after ${LEDGER_ATTEMPTS} attempts`);
  }
  if (accountId) await filePersonFinding({ urlKey, accountId, commentId, createdAt: comment.createdAt ?? null, finding });
  return landed;
}

/** The refusal answered when the record-before-post ledger write never lands: nothing was posted. */
export const LEDGER_REFUSAL = Object.freeze({ success: false, error: 'the comment was not posted: Harbour could not record it in the ledger first' });

/**
 * Post a comment through `post` and record it, in the order the provider allows (see the module note), then file a
 * person's comment as their finding.
 * `post(commentId)` makes the provider call; `commentId` is null where the provider mints the id, and a UUID Harbour
 * chose where it takes one (`clientIds`). Resolves to the provider's answer as `post` gave it, so a caller's own checks
 * still see its shape; a refused answer (`success: false`) or one with no id records nothing and files nothing. Resolves
 * to LEDGER_REFUSAL, and posts nothing, when a client-id post's record never lands. Throws only if `post` throws, or
 * when `by` is not stated.
 * @param {Object} args
 * @param {string} args.urlKey - the workspace the comment is on
 * @param {string} args.by - who wrote it: `person:<accountId>` for a comment sent with that person's own credential,
 *   HARBOUR for anything else (a run's, a run-less dispatch token's, the records' summaries)
 * @param {{ctx: {provider: any, token: any}, issueRef: string, body: string}|null} [args.finding] - what a person's
 *   finding needs: the writer's tracker access, the issue as the caller named it, and the comment's words
 * @param {(commentId: string|null) => Promise<any>} args.post - the provider call
 * @param {boolean} [args.clientIds] - the provider takes a client-chosen comment id (`provider.clientCommentIds`)
 * @param {{record: Function}|null} [args.store] - the ledger to record in; a route passes its own (the one its deps name).
 *   Default: the ledger registered at boot.
 * @returns {Promise<any>}
 */
export async function postHarbourComment({ urlKey, by, finding = null, post, store = null, clientIds = false }) {
  const accountId = accountOfBy(by);
  const target = store || ledger;
  let answer;
  let commentId;
  if (clientIds) {
    commentId = randomUUID();
    if (target && !(await storeWithRetries(target, urlKey, commentId))) return LEDGER_REFUSAL;
    answer = await post(commentId);
    if (answer?.success === false) return answer;
    if (commentIdOf(answer) !== commentId) console.error(`[harbour-comment] the tracker did not keep client comment id ${commentId} (${urlKey})`);
    commentId = commentIdOf(answer);
  } else {
    answer = await post(null);
    if (answer?.success === false) return answer;
    commentId = commentIdOf(answer);
    if (commentId && target && !(await storeWithRetries(target, urlKey, commentId))) {
      gaps += 1;
      console.error(`[harbour-comment] LEDGER GAP: comment ${commentId} (${urlKey}) was posted by Harbour but not recorded after ${LEDGER_ATTEMPTS} attempts; it may read as a person's comment`);
    }
  }
  if (accountId && commentId) await filePersonFinding({ urlKey, accountId, commentId, createdAt: commentOf(answer)?.createdAt ?? null, finding });
  return answer;
}
