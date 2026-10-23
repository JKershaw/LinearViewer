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
 *   expiresAt: Date|null,  // LIN-3421: optional expiry, enforced at validate time
 *                          // only. LIN-3618: tokens minted through the production
 *                          // store carry a 90-day expiry; null/absent = never
 *                          // expires (every legacy row, which validates as before)
 *   lastUsedAt: Date       // Last time token was used (updated on poll/take)
 * }
 *
 * Security notes:
 * - Tokens are generated using crypto.randomBytes (256 bits of entropy), prefixed per lib/harbour-token-format.js (LIN-3795)
 * - Only the SHA-256 hash is stored; the plain token is returned once at creation
 * - Validation uses hash lookup (timing attacks not applicable - hash is one-way)
 */

import crypto from 'crypto';
import { mintHarbourToken } from './harbour-token-format.js';

// LIN-3618: lifetime of a newly minted dispatch token, 90 days. Hardcoded on
// purpose (no env knob) and applied at the store (server.js passes it as
// `defaultTtlSeconds`), not in the mint route, so every caller of createToken,
// including /test/create-dispatch-token, gets it. The class default below stays
// `null`. Rows that already exist are never rewritten by this.
export const DISPATCH_TOKEN_DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60;

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
   * @param {number|null} [options.defaultTtlSeconds=null] - LIN-3421: lifetime stamped
   *   as `expiresAt` on new tokens. `null` (the default) means no expiry. LIN-3618:
   *   production passes DISPATCH_TOKEN_DEFAULT_TTL_SECONDS (server.js).
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? null;
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
   * @param {Object} [options]
   * @param {number|null} [options.ttlSeconds] - LIN-3421: per-token lifetime; overrides
   *   the store default. `null`/omitted with a `null` default = no expiry.
   * @returns {Promise<Object>} Object with tokenId, token (plain text), label and
   *   expiresAt (LIN-3618: ISO string, or null when the token has no expiry)
   */
  async createToken(urlKey, label = 'default', createdBy = null, { ttlSeconds } = {}) {
    if (!urlKey) {
      throw new Error('urlKey is required');
    }

    // Generate a secure random token: hbd_ + 32 bytes (256 bits) base64url (LIN-3795)
    const token = mintHarbourToken('dispatch');

    // Hash the token for storage
    const tokenHash = this._hashToken(token);

    const now = new Date();
    const ttl = ttlSeconds === undefined ? this.defaultTtlSeconds : ttlSeconds;
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      tokenHash,
      label: label || 'default',
      createdBy: createdBy || null,
      createdAt: now,
      expiresAt: ttl ? new Date(now.getTime() + ttl * 1000) : null,
      lastUsedAt: null
    };

    await this.collection.insertOne(doc);

    return {
      tokenId: doc._id,
      token, // Plain text - only returned once!
      label: doc.label,
      expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null
    };
  }

  /**
   * Validates a token and returns the associated workspace URL key.
   * Updates lastUsedAt timestamp on successful validation, unless `touch` is
   * false (LIN-3647: a consumer heartbeat is not a poll, so the heartbeat
   * routes validate without refreshing the poll-recency stamp).
   *
   * @param {string} token - Plain text token to validate
   * @param {{touch?: boolean}} [options] - `touch: false` skips the lastUsedAt write; default true
   * @returns {Promise<{urlKey: string, label: string, createdBy: string|null}|null>}
   *   Token info if valid, null when the token is unknown or expired (a REJECTION).
   *   `createdBy` is null for tokens created before LIN-1397 (never fabricated from
   *   another field). A STORE failure is not a rejection: it throws (LIN-3699), so
   *   the route can answer a retryable 503 instead of a 401 the consumer reads as
   *   "this credential is dead".
   * @see listTokens, whose `hasOwner` is the operator-facing view of the same field
   */
  async validateToken(token, { touch = true } = {}) {
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

      // LIN-3421: optional expiry, checked here and nowhere else. The row is NOT
      // deleted: dispatch-token rows are urlKey holder evidence (LIN-3381/3382),
      // so an expired row stays listed and held. Rows with no `expiresAt` (every
      // row minted before this field) never expire.
      if (doc.expiresAt && Date.now() > new Date(doc.expiresAt).getTime()) {
        return null;
      }

      // Update last used timestamp (fire and forget). LIN-3647: skipped for the
      // heartbeat routes, whose timer is independent of polling.
      if (touch) {
        this.collection.updateOne(
          { _id: doc._id },
          { $set: { lastUsedAt: new Date() } }
        ).catch(err => {
          console.error('Error updating token lastUsedAt:', err);
        });
      }

      // LIN-1952: tokenId lets the heartbeat store record which credential sent a beat.
      return { urlKey: doc.urlKey, label: doc.label, createdBy: doc.createdBy || null, tokenId: String(doc._id) };
    } catch (err) {
      // LIN-3699: log and rethrow. This used to return null, which the route
      // answered as the same 401 an unknown or expired token gets, so a database
      // blip was indistinguishable from a rejected credential (LIN-66 origin).
      console.error('Error validating dispatch token:', err);
      throw err;
    }
  }

  /**
   * Holder projection (LIN-3381): `{urlKey, createdBy, createdAt}` only, never
   * `tokenHash`. These tokens expire only if `expiresAt` is set (LIN-3421; new
   * tokens get 90 days, LIN-3618, legacy rows have none; enforced at validate
   * time only: an expired row is still returned here) and have no cleanup, so each row is a durable (urlKey, account) pairing. The store has no `workspaceId` field,
   * so none is returned. Without a `urlKey`, every token. Never throws by
   * default (`[]` on failure); with `{strict: true}` (LIN-3382) the error is
   * logged and rethrown. Separate from `validateToken` on purpose (LIN-3137
   * pin).
   *
   * @param {string} [urlKey]
   * @param {{strict?: boolean}} [options]
   * @returns {Promise<Array<{urlKey: string, createdBy: (string|null), createdAt: Date}>>}
   */
  async listHolderRows(urlKey, { strict = false } = {}) {
    try {
      return await this.collection
        .find(urlKey ? { urlKey } : {}, { projection: { _id: 0, urlKey: 1, createdBy: 1, createdAt: 1 } })
        .toArray();
    } catch (err) {
      console.error('Error listing dispatch token holders:', err);
      if (strict) throw err;
      return [];
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
        // LIN-3421: null for a token with no expiry (every legacy row; new tokens carry 90 days, LIN-3618).
        expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt || null,
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
   * LIN-3421: deletes the tokens the named accounts minted for a workspace, used
   * when one of them removes that workspace. Only `createdBy` matches: another
   * account's rows for the same key and ownerless rows (null `createdBy`, which
   * can never match an account id) are left alone. A hard delete on purpose: the
   * removing account released the key in the same request, and a dead row would
   * keep it a urlKey holder (LIN-3381/3382) indefinitely.
   *
   * @param {string} urlKey
   * @param {string[]} accountIds - the removing account's ids (canonical + alias)
   * @returns {Promise<number>} rows deleted
   */
  async revokeByCreator(urlKey, accountIds) {
    const ids = (accountIds || []).filter(Boolean);
    if (!urlKey || ids.length === 0) return 0;
    let deleted = 0;
    for (const id of ids) {
      const result = await this.collection.deleteMany({ urlKey, createdBy: id });
      deleted += result.deletedCount || 0;
    }
    return deleted;
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
