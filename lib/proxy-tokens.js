/**
 * Proxy token storage module.
 * Stores API tokens for Linear API proxy authentication.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,           // Token ID (UUID, for management)
 *   urlKey: string,        // Associated workspace URL key
 *   tokenHash: string,     // SHA-256 hash of token (never store plain text)
 *   label: string,         // User-provided label
 *   scope: string,         // 'read' or 'readWrite'
 *   singleUse: boolean,    // If true, token is consumed after first use
 *   createdBy: string,     // Linear user ID of token creator (for OAuth key scoping)
 *   createdAt: Date,       // When token was created
 *   lastUsedAt: Date,      // Last time token was used
 *   expiresAt: Date,       // Token expiry (null = no expiry)
 *   consumed: boolean      // Whether single-use token has been used
 * }
 *
 * Security notes:
 * - Tokens are generated using crypto.randomBytes (256 bits of entropy)
 * - Only the SHA-256 hash is stored; the plain token is returned once at creation
 * - Validation uses hash lookup (timing attacks not applicable - hash is one-way)
 * - Single-use tokens are marked consumed after first validation
 */

import crypto from 'crypto';

/**
 * Proxy token store for managing proxy API authentication.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
export class ProxyTokenStore {
  /**
   * Creates a new proxy token store instance.
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection for storing tokens
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Generates and stores a new proxy token for a workspace.
   * The plain text token is returned only once and should be shown to the user immediately.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options] - Token options
   * @param {string} [options.label='default'] - User-provided label
   * @param {string} [options.scope='read'] - 'read' or 'readWrite'
   * @param {boolean} [options.singleUse=false] - Whether token expires after one use
   * @param {string} [options.createdBy] - Linear user ID of token creator
   * @param {number} [options.ttl] - TTL in seconds (null = no expiry)
   * @returns {Promise<Object>} Object with tokenId, token (plain text), label, scope
   */
  async createToken(urlKey, options = {}) {
    if (!urlKey) {
      throw new Error('urlKey is required');
    }

    // Opportunistic cleanup: remove expired/consumed tokens to prevent DB
    // bloat between hourly cleanup cycles. Fire-and-forget to avoid slowing
    // down token creation.
    this.cleanup().catch(err => {
      console.error('Opportunistic proxy token cleanup error:', err);
    });

    const {
      label = 'default',
      scope = 'read',
      singleUse = false,
      createdBy = null,
      ttl = null
    } = options;

    // Validate scope
    if (!['read', 'readWrite'].includes(scope)) {
      throw new Error('scope must be "read" or "readWrite"');
    }

    // Generate a secure random token (32 bytes = 256 bits)
    const tokenBytes = crypto.randomBytes(32);
    const token = tokenBytes.toString('base64url');

    // Hash the token for storage
    const tokenHash = this._hashToken(token);

    const now = new Date();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      tokenHash,
      label: label || 'default',
      scope,
      singleUse: !!singleUse,
      createdBy: createdBy || null,
      createdAt: now,
      lastUsedAt: null,
      expiresAt: ttl ? new Date(now.getTime() + ttl * 1000) : null,
      consumed: false
    };

    await this.collection.insertOne(doc);

    return {
      tokenId: doc._id,
      token, // Plain text - only returned once!
      label: doc.label,
      scope: doc.scope,
      singleUse: doc.singleUse,
      expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt
    };
  }

  /**
   * Validates a token and returns the associated workspace info.
   * Updates lastUsedAt timestamp on successful validation.
   * For single-use tokens, marks as consumed after first validation.
   *
   * @param {string} token - Plain text token to validate
   * @returns {Promise<Object|null>} Token info if valid, null otherwise
   */
  async validateToken(token) {
    if (!token) {
      return null;
    }

    try {
      const tokenHash = this._hashToken(token);
      const now = new Date();

      // For single-use tokens, use atomic findOneAndUpdate to prevent race conditions.
      // The query includes { consumed: false } so only the first concurrent request wins.
      const doc = await this.collection.findOne({ tokenHash });

      if (!doc) {
        return null;
      }

      // Check expiry
      if (doc.expiresAt && now > new Date(doc.expiresAt)) {
        return null;
      }

      // Check if single-use token already consumed
      if (doc.singleUse && doc.consumed) {
        return null;
      }

      if (doc.singleUse) {
        // Atomic consume: only succeeds if consumed is still false.
        // This prevents race conditions where two concurrent requests
        // both pass the check above.
        const result = await this.collection.updateOne(
          { _id: doc._id, consumed: false },
          { $set: { consumed: true, lastUsedAt: now } }
        );
        // If no document was modified, another request consumed it first
        if (!result.modifiedCount && !result.matchedCount) {
          return null;
        }
      } else {
        // Non-single-use: fire-and-forget update of lastUsedAt
        this.collection.updateOne(
          { _id: doc._id },
          { $set: { lastUsedAt: now } }
        ).catch(err => {
          console.error('Error updating proxy token lastUsedAt:', err);
        });
      }

      return {
        tokenId: doc._id,
        urlKey: doc.urlKey,
        label: doc.label,
        scope: doc.scope,
        singleUse: doc.singleUse,
        createdBy: doc.createdBy || null
      };
    } catch (err) {
      console.error('Error validating proxy token:', err);
      return null;
    }
  }

  /**
   * Lists all tokens for a workspace.
   * Returns metadata only - never the token hash.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<Array>} Array of token metadata objects
   */
  async listTokens(urlKey) {
    if (!urlKey) {
      return [];
    }

    try {
      const docs = await this.collection.find({ urlKey }).toArray();

      return docs.map(doc => ({
        tokenId: doc._id,
        label: doc.label,
        scope: doc.scope,
        singleUse: doc.singleUse,
        consumed: doc.consumed,
        createdAt: doc.createdAt?.toISOString?.() || doc.createdAt,
        lastUsedAt: doc.lastUsedAt?.toISOString?.() || doc.lastUsedAt,
        expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt
      }));
    } catch (err) {
      console.error('Error listing proxy tokens:', err);
      return [];
    }
  }

  /**
   * Revokes (deletes) a token.
   *
   * @param {string} urlKey - Workspace URL key (for verification)
   * @param {string} tokenId - Token ID to revoke
   * @returns {Promise<boolean>} True if token was revoked
   */
  async revokeToken(urlKey, tokenId) {
    if (!urlKey || !tokenId) {
      return false;
    }

    try {
      const result = await this.collection.deleteOne({
        _id: tokenId,
        urlKey
      });
      return result.deletedCount > 0;
    } catch (err) {
      console.error('Error revoking proxy token:', err);
      return false;
    }
  }

  /**
   * Counts tokens for a workspace.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of tokens
   */
  async countTokens(urlKey) {
    if (!urlKey) {
      return 0;
    }

    try {
      const docs = await this.collection.find({ urlKey }).toArray();
      return docs.length;
    } catch (err) {
      console.error('Error counting proxy tokens:', err);
      return 0;
    }
  }

  /**
   * Clears all tokens for a workspace (used in tests).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of tokens removed
   */
  async clear(urlKey) {
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing proxy tokens:', err);
      return 0;
    }
  }

  /**
   * Removes expired and consumed single-use tokens.
   *
   * @returns {Promise<number>} Number of tokens removed
   */
  async cleanup() {
    try {
      const now = new Date();
      // Remove expired tokens
      const expiredResult = await this.collection.deleteMany({
        expiresAt: { $lt: now, $ne: null }
      });
      // Remove consumed single-use tokens older than 24 hours
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const consumedResult = await this.collection.deleteMany({
        singleUse: true,
        consumed: true,
        lastUsedAt: { $lt: oneDayAgo }
      });
      return (expiredResult.deletedCount || 0) + (consumedResult.deletedCount || 0);
    } catch (err) {
      console.error('Error cleaning up proxy tokens:', err);
      return 0;
    }
  }

  /**
   * Hashes a token using SHA-256.
   *
   * @param {string} token - Plain text token
   * @returns {string} Hex-encoded hash
   * @private
   */
  _hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
