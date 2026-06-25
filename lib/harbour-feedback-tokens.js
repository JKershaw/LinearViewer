/**
 * Harbour OS feedback token store.
 *
 * Mints short-lived, single-use Bearer tokens that a repo-level Claude
 * Code hook (e.g. `Stop`) can use to POST back to the dispatch feedback
 * endpoint. Each token is scoped to a single dispatch item, so a token
 * leaked from one Harbour OS session cannot be replayed against another.
 *
 * Schema (collection: dispatch-feedback-tokens):
 * {
 *   _id: string,        // Token ID (UUID)
 *   itemId: string,     // Dispatch item ID this token authorises feedback on
 *   urlKey: string,     // Workspace URL key (cached for fast lookup)
 *   tokenHash: string,  // SHA-256 hash of the plain token (never stored plain)
 *   createdAt: Date,
 *   expiresAt: Date,    // Hard expiry; default 1 hour after mint
 *   used: boolean,      // Flipped to true on first successful use
 *   usedAt: Date|null   // Timestamp of single-use consumption (audit trail)
 * }
 */

import crypto from 'crypto';

const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

export class HarbourFeedbackTokenStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Mints a new single-use, short-TTL token bound to a dispatch item.
   *
   * @param {string} itemId - Dispatch item UUID
   * @param {string} urlKey - Workspace URL key (the addFeedback contract requires it)
   * @param {Object} [opts]
   * @param {number} [opts.ttlSeconds=3600] - Token lifetime in seconds
   * @returns {Promise<{token: string, tokenId: string, expiresAt: Date}>}
   */
  async mintToken(itemId, urlKey, opts = {}) {
    if (!itemId || !urlKey) {
      throw new Error('itemId and urlKey are required');
    }
    const ttlSeconds = opts.ttlSeconds || DEFAULT_TTL_SECONDS;

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = this._hashToken(token);
    const now = new Date();

    const doc = {
      _id: crypto.randomUUID(),
      itemId,
      urlKey,
      tokenHash,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      used: false,
      usedAt: null
    };

    await this.collection.insertOne(doc);

    return { token, tokenId: doc._id, expiresAt: doc.expiresAt };
  }

  /**
   * Validates a token, optionally checking it matches the expected itemId,
   * and atomically marks it consumed (single-use).
   *
   * Returns the bound urlKey on success, null on any failure (unknown,
   * expired, already used, or wrong itemId). Callers should treat null as
   * 401 Unauthorized — no caller-facing distinction between failure modes
   * to avoid leaking which property failed.
   *
   * @param {string} token - Plain text Bearer token
   * @param {string} [expectedItemId] - If provided, token must be bound to this item
   * @returns {Promise<{urlKey: string, itemId: string}|null>}
   */
  async validateAndConsume(token, expectedItemId = null) {
    if (!token) return null;

    try {
      const tokenHash = this._hashToken(token);
      const now = new Date();

      const query = {
        tokenHash,
        used: false,
        expiresAt: { $gt: now }
      };
      if (expectedItemId) {
        query.itemId = expectedItemId;
      }

      // Atomic claim: only one caller can flip `used` from false to true.
      const update = { $set: { used: true, usedAt: now } };
      const doc = await this.collection.findOneAndUpdate(query, update, { returnDocument: 'after' });

      if (!doc) return null;

      return { urlKey: doc.urlKey, itemId: doc.itemId };
    } catch (err) {
      console.error('Error validating harbour feedback token:', err);
      return null;
    }
  }

  /**
   * Removes expired tokens from the collection. Used tokens are kept as an
   * audit trail until they expire.
   *
   * @returns {Promise<number>} Count of removed tokens
   */
  async cleanup() {
    try {
      const result = await this.collection.deleteMany({ expiresAt: { $lt: new Date() } });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error cleaning up harbour feedback tokens:', err);
      return 0;
    }
  }

  _hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
