/**
 * Harbour-comments ledger (LIN-2648, WS1 of LIN-2241) — a durable record of
 * which comment ids Harbour itself wrote, so WS2's due-ness filter can tell a
 * Harbour-authored comment apart from a human one without inferring authorship
 * from a name or a heuristic.
 *
 * Modelled on `lib/shelved-rulings-store.js` / `lib/dismissal-suggestions-store.js`
 * exactly: same file layout, same constructor-injected collection, same `_id`
 * composition (`${urlKey}::${commentId}`, the LIN-2291/LIN-2262 keying
 * discipline for this class of store — embedding `urlKey` INTO `_id` rather
 * than relying on a separate filter field rules out a cross-workspace
 * collision structurally), same try/catch-and-log error handling.
 *
 * Durable, **no TTL** — this ledger is permanent, for the same reason
 * `lib/task-decisions-store.js` and `lib/task-snapshot-store.js` give: an
 * expiring record would silently forget which comments Harbour wrote, and
 * every comment written after the TTL lapsed would misread as foreign.
 *
 * Recorded at all three `provider.createComment` seams (`routes/proxy-writes.js`
 * `:541,:771`, `routes/workspace-api.js` `:1565` — wired in a LATER beat, not
 * here) from the create-response's own `id` field. Two operations only:
 *
 *   - `record` — best-effort record-on-write (the caller, not this store, is
 *     responsible for making the write non-blocking; see the seam wiring).
 *   - `wereRecordedByHarbour` — a batch/set-membership read for WS2's
 *     `dueBasisHash` filter.
 *
 * **Coverage is "recorded id ⇒ written through Harbour" — never "unrecorded id
 * ⇒ human-written."** A human edit to an already-Harbour-authored comment (a
 * Linear-UI PATCH) keeps that comment's recorded id, so due-ness will not see
 * the edit either — a stated limit of the ledger, not a bug.
 *
 * `wereRecordedByHarbour` resolves each entry via the SAME `resolveCommentId`
 * (`c.id || c.commentId`) `scanBasisFromContext` uses (`lib/scan-fingerprint.js`
 * — imported, never re-implemented here), so "is this comment in the ledger"
 * and "does this comment feed the basis hash" can never disagree about which
 * field names a given comment. Each entry may be a raw comment-like object
 * (as in `context.comments[]`) or an already-resolved id string.
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

import { resolveCommentId } from './scan-fingerprint.js';

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
   * absent (never a throw, never a fabricated `false` row).
   *
   * @param {string} urlKey
   * @param {Array<Object|string>} comments - comment-like objects (resolved via
   *   the SAME `id || commentId` precedence `scanBasisFromContext` uses) or
   *   already-resolved id strings; an empty/absent id is not a legal ledger
   *   key and is filtered out before the read, never coerced to a match.
   * @returns {Promise<Set<string>>}
   */
  async wereRecordedByHarbour(urlKey, comments) {
    const ids = (Array.isArray(comments) ? comments : [])
      .map(entry => (typeof entry === 'string' ? entry : resolveCommentId(entry)))
      .filter(id => typeof id === 'string' && id);
    if (!this.collection || !urlKey || ids.length === 0) return new Set();

    try {
      const docs = await this.collection.find({ urlKey, commentId: { $in: ids } }).toArray();
      return new Set(docs.map(d => d.commentId));
    } catch (err) {
      console.error('Error reading Harbour-comments ledger:', err);
      return new Set();
    }
  }
}
