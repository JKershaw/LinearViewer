/**
 * Dispatch token storage module.
 * Stores API tokens for dispatch queue consumer authentication.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,           // Token ID (UUID, for management)
 *   urlKey: string,        // Associated workspace URL key
 *   tokenHash: string,     // SHA-256 hash of token (never store plain text)
 *   label: string,         // User-provided label
 *   createdBy: string|null,// Account ID of token creator (LIN-1397; null for
 *                          // tokens minted before this field existed)
 *   createdAt: Date,       // When token was created
 *   lastUsedAt: Date       // Last time token was used (updated on poll/take)
 * }
 *
 * Security notes:
 * - Tokens are generated using crypto.randomBytes (256 bits of entropy)
 * - Only the SHA-256 hash is stored; the plain token is returned once at creation
 * - Validation uses hash lookup (timing attacks not applicable - hash is one-way)
 */

import crypto from 'crypto';

/**
 * Dispatch token store for managing consumer API authentication.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
export class DispatchTokenStore {
  /**
   * Creates a new dispatch token store instance.
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection for storing tokens
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Generates and stores a new token for a workspace.
   * The plain text token is returned only once and should be shown to the user immediately.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {string} [label='default'] - User-provided label for the token
   * @param {string|null} [createdBy=null] - Account ID of the creating user (LIN-1397).
   *   Additive/backward-compatible: existing tokens minted before this param existed
   *   have no createdBy and validate as null — a consumer that needs a non-null owner
   *   (e.g. the broker-token mint) must fail closed on those until the token is re-minted.
   * @returns {Promise<Object>} Object with tokenId, token (plain text), and label
   */
  async createToken(urlKey, label = 'default', createdBy = null) {
    if (!urlKey) {
      throw new Error('urlKey is required');
    }

    // Generate a secure random token (32 bytes = 256 bits)
    const tokenBytes = crypto.randomBytes(32);
    const token = tokenBytes.toString('base64url'); // URL-safe base64

    // Hash the token for storage
    const tokenHash = this._hashToken(token);

    const now = new Date();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      tokenHash,
      label: label || 'default',
      createdBy: createdBy || null,
      createdAt: now,
      lastUsedAt: null
    };

    await this.collection.insertOne(doc);

    return {
      tokenId: doc._id,
      token, // Plain text - only returned once!
      label: doc.label
    };
  }

  /**
   * Validates a token and returns the associated workspace URL key.
   * Updates lastUsedAt timestamp on successful validation.
   *
   * @param {string} token - Plain text token to validate
   * @returns {Promise<{urlKey: string, label: string, createdBy: string|null}|null>}
   *   Token info if valid, null otherwise. `createdBy` is null for tokens created
   *   before LIN-1397 (never fabricated from another field).
   * @see listTokens, whose `hasOwner` is the operator-facing view of the same field
   */
  async validateToken(token) {
    if (!token) {
      return null;
    }

    try {
      const tokenHash = this._hashToken(token);

      // Find token by hash (exact match via database query)
      // Security note: Timing attacks are not a concern here because:
      // 1. We hash the provided token before lookup
      // 2. The database query returns either a match or nothing
      // 3. An attacker cannot reverse the hash from timing information
      const doc = await this.collection.findOne({ tokenHash });

      if (!doc) {
        return null;
      }

      // Update last used timestamp (fire and forget)
      this.collection.updateOne(
        { _id: doc._id },
        { $set: { lastUsedAt: new Date() } }
      ).catch(err => {
        console.error('Error updating token lastUsedAt:', err);
      });

      return { urlKey: doc.urlKey, label: doc.label, createdBy: doc.createdBy || null };
    } catch (err) {
      console.error('Error validating dispatch token:', err);
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
        createdAt: doc.createdAt?.toISOString?.() || doc.createdAt,
        lastUsedAt: doc.lastUsedAt?.toISOString?.() || doc.lastUsedAt,
        // LIN-1448: a VERDICT, never the owning account id — this is a
        // metadata-only surface. An ownerless (pre-LIN-1397) token cannot mint a
        // usable broker bootstrap, so "which of my tokens are ownerless?" is the
        // question an operator must be able to answer before switching the
        // LIN-1447 compat lane off (DISPATCH_OWNERLESS_BROKER_COMPAT).
        hasOwner: !!doc.createdBy
      }));
    } catch (err) {
      console.error('Error listing dispatch tokens:', err);
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
      console.error('Error revoking dispatch token:', err);
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
      console.error('Error counting dispatch tokens:', err);
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
      console.error('Error clearing dispatch tokens:', err);
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
