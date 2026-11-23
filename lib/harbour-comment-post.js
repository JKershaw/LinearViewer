/**
 * LIN-4535 (P5, plan D4): the one write seam for a comment Harbour itself posts.
 *
 * Every comment Harbour writes through a provider goes through postHarbourComment: the agents' comment route
 * (routes/proxy-writes.js), the page's reply route (routes/workspace-api-issue-write.js) and the records' summaries
 * (lib/records-tracker.js). The helper posts, then records the comment's id in the Harbour-comments ledger
 * (lib/harbour-comments-store.js). The ledger therefore means exactly "Harbour's own writers posted this", and the
 * comment-ingest reader (lib/comment-ingest.js) never credits such a comment to a person.
 *
 * Order: post first, then record. The provider takes no client-chosen comment id here, so the id is known only from
 * the answer. A record that fails is retried a fixed number of times, then counted and logged loudly. A comment whose
 * record never lands is then the one gap: it reads as its author's, which for a comment posted with the owner's key is
 * the owner's. That gap is counted (harbourCommentLedgerGaps) so a deploy can be read for it.
 *
 * The ledger is registered once at boot (configureHarbourCommentLedger). A process that never registers one posts
 * without recording, and nothing counts as a gap: that is the test harness and nothing else.
 */

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
 * Record one posted comment, with the bounded retries. A gap is logged and counted; nothing is thrown, since the comment
 * has already landed and the response must not fail on its ledger.
 */
async function recordWithRetries(store, urlKey, commentId) {
  for (let attempt = 1; attempt <= LEDGER_ATTEMPTS; attempt++) {
    try {
      const stored = await store.record({ urlKey, commentId });
      if (stored) return true;
    } catch (err) {
      console.error(`[harbour-comment] ledger record attempt ${attempt} threw for ${commentId}:`, err?.message || err);
    }
  }
  gaps += 1;
  console.error(`[harbour-comment] LEDGER GAP: comment ${commentId} (${urlKey}) was posted by Harbour but not recorded after ${LEDGER_ATTEMPTS} attempts; it may read as a person's comment`);
  return false;
}

/**
 * Post a comment through `post` and record it. `post` makes the provider call and resolves to its answer (an envelope
 * or a bare comment). A refused answer (`success: false`) or one with no id records nothing. Resolves to the answer as
 * `post` gave it, so a caller's own checks still see the provider's shape. Throws only if `post` throws.
 * @param {Object} args
 * @param {string} args.urlKey - the workspace the comment is on
 * @param {() => Promise<any>} args.post - the provider call
 * @param {{record: Function}|null} [args.store] - the ledger to record in; a route passes its own (the one its deps name).
 *   Default: the ledger registered at boot.
 * @returns {Promise<any>}
 */
export async function postHarbourComment({ urlKey, post, store = null }) {
  const answer = await post();
  if (answer?.success === false) return answer;
  const commentId = commentIdOf(answer);
  if (!commentId) return answer;
  const target = store || ledger;
  if (!target) return answer;
  await recordWithRetries(target, urlKey, commentId);
  return answer;
}
