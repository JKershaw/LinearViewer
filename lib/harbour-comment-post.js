/**
 * LIN-4535 (P5, plan D4): the one write seam for a comment Harbour itself posts.
 *
 * Every comment Harbour writes through a provider goes through postHarbourComment: the agents' comment route
 * (routes/proxy-writes.js), the page's reply route (routes/workspace-api-issue-write.js) and the records' summaries
 * (lib/records-tracker.js). The ledger (lib/harbour-comments-store.js) therefore means exactly "Harbour's own writers
 * posted this", and the comment-ingest reader (lib/comment-ingest.js) never credits such a comment to a person.
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

/** How many times a failed ledger record is attempted in all (the first try included). */
export const LEDGER_ATTEMPTS = 3;

let ledger = null;
let gaps = 0;

/** Register the workspace's Harbour-comments ledger (server boot). Pass null to clear it (tests). */
export function configureHarbourCommentLedger(store) {
  ledger = store || null;
}

/** How many Harbour-posted comments went unrecorded after every attempt, in this process. */
export function harbourCommentLedgerGaps() {
  return gaps;
}

/** Test seam: zero the gap counter. */
export function resetHarbourCommentLedgerGaps() {
  gaps = 0;
}

/** The comment id in a provider answer: the envelope's `comment`, or the bare entity (Local, GitHub). */
export function commentIdOf(answer) {
  const comment = answer && typeof answer === 'object' && 'comment' in answer ? answer.comment : answer;
  const id = comment && typeof comment === 'object' ? comment.id : null;
  return typeof id === 'string' && id ? id : null;
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

/** The refusal answered when the record-before-post ledger write never lands: nothing was posted. */
export const LEDGER_REFUSAL = Object.freeze({ success: false, error: 'the comment was not posted: Harbour could not record it in the ledger first' });

/**
 * Post a comment through `post` and record it, in the order the provider allows (see the module note).
 * `post(commentId)` makes the provider call; `commentId` is null where the provider mints the id, and a UUID Harbour
 * chose where it takes one (`clientIds`). Resolves to the provider's answer as `post` gave it, so a caller's own checks
 * still see its shape; a refused answer (`success: false`) or one with no id records nothing. Resolves to LEDGER_REFUSAL,
 * and posts nothing, when a client-id post's record never lands. Throws only if `post` throws.
 * @param {Object} args
 * @param {string} args.urlKey - the workspace the comment is on
 * @param {(commentId: string|null) => Promise<any>} args.post - the provider call
 * @param {boolean} [args.clientIds] - the provider takes a client-chosen comment id (`provider.clientCommentIds`)
 * @param {{record: Function}|null} [args.store] - the ledger to record in; a route passes its own (the one its deps name).
 *   Default: the ledger registered at boot.
 * @returns {Promise<any>}
 */
export async function postHarbourComment({ urlKey, post, store = null, clientIds = false }) {
  const target = store || ledger;
  if (clientIds) {
    const commentId = randomUUID();
    if (target && !(await storeWithRetries(target, urlKey, commentId))) return LEDGER_REFUSAL;
    const answer = await post(commentId);
    if (answer?.success === false) return answer;
    if (commentIdOf(answer) !== commentId) console.error(`[harbour-comment] the tracker did not keep client comment id ${commentId} (${urlKey})`);
    return answer;
  }
  const answer = await post(null);
  if (answer?.success === false) return answer;
  const commentId = commentIdOf(answer);
  if (!commentId) return answer;
  if (!target) return answer;
  if (!(await storeWithRetries(target, urlKey, commentId))) {
    gaps += 1;
    console.error(`[harbour-comment] LEDGER GAP: comment ${commentId} (${urlKey}) was posted by Harbour but not recorded after ${LEDGER_ATTEMPTS} attempts; it may read as a person's comment`);
  }
  return answer;
}
