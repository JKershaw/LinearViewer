/**
 * Harbour-comments ledger (LIN-2648, WS1 of LIN-2241) — a durable record of
 * which comment ids were posted through Harbour, so their author is never
 * inferred from the tracker, a name or a heuristic. Since LIN-4548 an entry
 * means "posted through Harbour, its author settled at the post": the seam
 * files a person's own post as their finding, and Harbour's as nobody's.
 *
 * Modelled on the proposed-dismissals store (retired, LIN-4541)
 * exactly: same file layout, same constructor-injected collection, same `_id`
 * composition (`${urlKey}::${commentId}`, the LIN-2291/LIN-2262 keying
 * discipline for this class of store — embedding `urlKey` INTO `_id` rather
 * than relying on a separate filter field rules out a cross-workspace
 * collision structurally), same try/catch-and-log error handling.
 *
 * Durable, **no TTL** — this ledger is permanent: an
 * expiring record would silently forget which comments Harbour wrote, and
 * every comment written after the TTL lapsed would misread as foreign.
 *
 * Recorded through one seam, `lib/harbour-comment-post.js` (LIN-4535), by every
 * Harbour comment post: the proxy comment POST (`routes/proxy-writes.js`), the
 * session-auth reply route (`routes/workspace-api-issue-write.js`) and the records'
 * summaries (`lib/records-tracker.js`). Where the tracker takes a client-chosen id
 * (Linear) the id is recorded before the post; otherwise from the create-response's
 * own `id` after it. Two operations only:
 *
 *   - `record` — best-effort record-on-write (the caller, not this store, is
 *     responsible for making the write non-blocking; see the seam wiring).
 *   - `wereRecordedByHarbour` — a batch/set-membership read for the comment
 *     ingest (`lib/comment-ingest.js`, LIN-4535), which must never decide a
 *     ledgered comment's author again (the tracker names the posting credential). Its one reader since the scan's
 *     due-ness filter retired (LIN-4540), so a read that cannot be made throws.
 *
 * **Coverage is "recorded id ⇒ written through Harbour" — never "unrecorded id
 * ⇒ human-written."** A human edit to an already-Harbour-authored comment (a
 * Linear-UI PATCH) keeps that comment's recorded id, so the ingest will not see
 * the edit either — a stated limit of the ledger, not a bug.
 *
 * `wereRecordedByHarbour` resolves each entry via `resolveCommentId`
 * (`c.id || c.commentId`), exported here so a caller names a comment the way
 * the ledger keys it. Each entry may be a raw comment-like object (as in
 * `context.comments[]`) or an already-resolved id string.
 *
 * Schema (one document per (urlKey, commentId) — recording an already-recorded
 * id is an idempotent no-op, since only "was this ever written by Harbour"
 * matters, never a count or a latest-write timestamp):
 * {
 *   _id:         string,   // `${urlKey}::${commentId}`
 *   urlKey:      string,
 *   commentId:   string,
 *   recordedAt:  Date      // first-write time; never moved by a later duplicate record()
 * }
 */

/**
 * A comment's identity: `id` (GitHub/Jira/Local), falling back to `commentId` (Linear only). The ledger keys a
 * comment by this, so a caller resolves it the same way.
 *
 * @param {Object|null|undefined} c - a comment-like object
 * @returns {string}
 */
export function resolveCommentId(c) {
  const id = c?.id || c?.commentId;
  return typeof id === 'string' ? id : '';
}

function toRecord(doc) {
  if (!doc) return null;
  return {
    urlKey: doc.urlKey,
    commentId: doc.commentId,
    recordedAt: doc.recordedAt?.toISOString?.() || doc.recordedAt
  };
}

export class HarbourCommentsStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Record that Harbour itself wrote a comment. Idempotent: recording the
   * same (urlKey, commentId) twice is a no-op that preserves the original
   * `recordedAt` (`$setOnInsert`), not a re-stamp.
   *
   * @param {Object} entry
   * @param {string} entry.urlKey
   * @param {string} entry.commentId - the id from the create-response's own `id` field
   * @param {Date} [entry.now] - injected clock; defaults to `new Date()`
   * @returns {Promise<Object|null>} the stored record, or null on bad input/error
   */
  async record({ urlKey, commentId, now } = {}) {
    if (!this.collection || !urlKey || !commentId) return null;

    try {
      const nowDate = now instanceof Date ? now : new Date();
      const _id = `${urlKey}::${commentId}`;
      await this.collection.updateOne(
        { _id },
        { $set: { _id, urlKey, commentId }, $setOnInsert: { recordedAt: nowDate } },
        { upsert: true }
      );
      const stored = await this.collection.findOne({ _id });
      return toRecord(stored);
    } catch (err) {
      console.error('Error recording Harbour-authored comment:', err);
      return null;
    }
  }

  /**
   * A batch/set-membership read: which of the given comments, in this
   * workspace, were recorded as Harbour-authored? Returns the SUBSET of
   * resolved ids that were found, as a Set — `recorded.has(resolveCommentId(c))`
   * answers the question for one comment, and an unrecorded id is simply
   * absent (never a fabricated `false` row).
   *
   * A read that cannot be made (no collection, or the query throws) throws
   * rather than answering an empty Set: for the comment ingest an empty answer
   * reads as "no comment is Harbour's", and would credit Harbour's own posts
   * (made under the owner's credential) to the owner (LIN-4535).
   *
   * @param {string} urlKey
   * @param {Array<Object|string>} comments - comment-like objects (resolved via
   *   `resolveCommentId`) or already-resolved id strings; an empty/absent id is
   *   not a legal ledger key and is filtered out before the read, never coerced
   *   to a match.
   * @returns {Promise<Set<string>>}
   */
  async wereRecordedByHarbour(urlKey, comments) {
    const ids = (Array.isArray(comments) ? comments : [])
      .map(entry => (typeof entry === 'string' ? entry : resolveCommentId(entry)))
      .filter(id => typeof id === 'string' && id);
    if (!urlKey || ids.length === 0) return new Set();
    if (!this.collection) throw new Error('the Harbour-comments ledger has no collection');

    try {
      const idKeys = ids.map(id => `${urlKey}::${id}`);
      const docs = await this.collection.find({ _id: { $in: idKeys } }).toArray();
      return new Set(docs.map(d => d.commentId));
    } catch (err) {
      console.error('Error reading Harbour-comments ledger:', err);
      throw err;
    }
  }
}
