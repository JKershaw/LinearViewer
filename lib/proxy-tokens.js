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
 *   kind: string,          // 'standard' (default) or 'bootstrap' (single-use, exchange-only)
 *   singleUse: boolean,    // If true, token is consumed after first use
 *   createdBy: string,     // Account ID of token creator (for OAuth key scoping)
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
 * - Bootstrap tokens (LIN-376) are single-use credentials that authenticate ONLY
 *   the exchange (`exchangeBootstrapToken`); `validateToken` rejects them so they
 *   can never reach a data endpoint. The exchange consumes the bootstrap and mints
 *   a standard, multi-use working token. This is what lets a handoff (prompt, page,
 *   clipboard) carry a credential that is inert the instant the agent starts, rather
 *   than a standing working token.
 */

import crypto from 'crypto';

// Default token lifetime: 90 days. Applied when no explicit ttl is provided
// so tokens age out on their own and the list doesn't accumulate forever.
const DEFAULT_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

// LIN-376: TTLs for the two-token bootstrap handoff. The bootstrap TTL must
// OUTLIVE the dispatch queue — an item can sit up to 24h before a consumer
// takes it, so a shorter TTL would leave the embedded token dead on arrival.
// 48h bounds the un-exchanged window while covering that wait; the containment
// property is single-use, not a tight TTL. The exchanged working token gets the
// same 48h, which covers the run that consumes it. Exported so every mint site
// (proxy dispatch, feedback, collective) shares one source of truth.
export const BOOTSTRAP_TOKEN_TTL_SECONDS = 48 * 60 * 60;
export const WORKING_TOKEN_TTL_SECONDS = 48 * 60 * 60;

// Idle-token threshold for cleanup: tokens older than this with no recent use
// are pruned during the periodic cleanup pass.
const IDLE_TOKEN_PRUNE_SECONDS = 60 * 24 * 60 * 60;

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
   * @param {number} [options.defaultTtl] - Default TTL in seconds when caller does not specify one
   * @param {number} [options.idlePruneSeconds] - Idle threshold for cleanup pruning
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.defaultTtl = options.defaultTtl ?? DEFAULT_TOKEN_TTL_SECONDS;
    this.idlePruneSeconds = options.idlePruneSeconds ?? IDLE_TOKEN_PRUNE_SECONDS;
  }

  /**
   * Generates and stores a new proxy token for a workspace.
   * The plain text token is returned only once and should be shown to the user immediately.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options] - Token options
   * @param {string} [options.label='default'] - User-provided label
   * @param {string} [options.scope='read'] - 'read' or 'readWrite'
   * @param {string} [options.kind='standard'] - 'standard' or 'bootstrap' (single-use, exchange-only)
   * @param {boolean} [options.singleUse=false] - Whether token expires after one use
   * @param {string} [options.createdBy] - Account ID of token creator
   * @param {number} [options.ttl] - TTL in seconds (null = no expiry)
   * @returns {Promise<Object>} Object with tokenId, token (plain text), label, scope, kind
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
      kind = 'standard',
      createdBy = null
    } = options;

    // Validate kind
    if (!['standard', 'bootstrap'].includes(kind)) {
      throw new Error('kind must be "standard" or "bootstrap"');
    }

    // A bootstrap token is single-use by definition — it authenticates exactly one
    // operation (the exchange). Force it here so a caller can never mint a
    // multi-use bootstrap by omitting the flag.
    const singleUse = kind === 'bootstrap' ? true : (options.singleUse ?? false);

    // Fall back to the instance default only when the caller omitted ttl
    // entirely. Explicit `null` disables expiry (used for tests / special cases).
    const ttl = Object.prototype.hasOwnProperty.call(options, 'ttl')
      ? options.ttl
      : this.defaultTtl;

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
      kind,
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
      kind: doc.kind,
      singleUse: doc.singleUse,
      expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt
    };
  }

  /**
   * Exchanges a single-use bootstrap token for a fresh standard (multi-use)
   * working token in the same workspace and scope (LIN-376).
   *
   * The bootstrap is atomically consumed (reusing the single-use consume path), so
   * a leaked handoff that already ran leaves only a spent credential. The returned
   * working token is what the agent uses for every subsequent call; it exists only
   * in this response, never in the durable prompt/queue/log.
   *
   * Returns null when the presented token is missing, not a bootstrap, already
   * consumed, or expired — the caller maps that to a 401.
   *
   * @param {string} token - Plain text bootstrap token
   * @param {Object} [options] - Working-token options
   * @param {string} [options.label] - Label for the minted working token; defaults to the
   *   bootstrap's own label (`doc.label`, e.g. 'dispatch-bootstrap'/'refire-broker'/etc.) so the
   *   per-site lane survives the exchange, falling back to 'exchanged' only when the bootstrap
   *   itself carries no label (LIN-1587 R1)
   * @param {number} [options.ttl] - Working-token TTL in seconds (defaults to store default)
   * @returns {Promise<Object|null>} createToken result (+ urlKey) for the working token, or null
   */
  async exchangeBootstrapToken(token, options = {}) {
    if (!token) {
      return null;
    }

    try {
      const tokenHash = this._hashToken(token);
      const now = new Date();

      const doc = await this.collection.findOne({ tokenHash });
      if (!doc) return null;
      // Only bootstrap tokens are exchangeable.
      if (doc.kind !== 'bootstrap') return null;
      // Expiry + already-consumed guards.
      if (doc.expiresAt && now > new Date(doc.expiresAt)) return null;
      if (doc.consumed) return null;

      // Atomic consume: only the first concurrent exchange wins.
      const result = await this.collection.updateOne(
        { _id: doc._id, consumed: false },
        { $set: { consumed: true, lastUsedAt: now } }
      );
      if (!result.modifiedCount && !result.matchedCount) {
        return null;
      }

      // LIN-1448 — the inheritance step. `createdBy: doc.createdBy || null` below
      // is where an ownerless bootstrap becomes an ownerless WORKING token, which
      // is dead on arrival at every workspace-scoped verb (LIN-1366's null-owner
      // guard) while still returning 200 on the few that resolve no workspace.
      // That silent propagation is how two bad mints halted four autopilot trees
      // on 2026-07-25 (LIN-1576).
      //
      // The exchange still succeeds on purpose: while the LIN-1447 compat lane is
      // on, ownerless tokens are a supported population, and refusing here would
      // strand the host runner mid-flight rather than at a mint it could retry.
      // Prevention lives at the MINT (lib/proxy-preamble.js's provisionBootstrapToken
      // and the broker-token lane in routes/dispatch.js, both gated on
      // DISPATCH_OWNERLESS_BROKER_COMPAT); what belongs here is the breadcrumb.
      // Workspace slug only — never token bytes, never the owner id.
      if (!doc.createdBy) {
        console.warn(
          `Exchanging a bootstrap with no owner (urlKey=${doc.urlKey} label=${doc.label}): ` +
          `the working token inherits the missing owner and cannot resolve a workspace ` +
          `credential (LIN-1448)`
        );
      }

      // Mint the working token: same workspace + scope, multi-use, standard kind.
      const minted = await this.createToken(doc.urlKey, {
        label: options.label || doc.label || 'exchanged',
        scope: doc.scope,
        kind: 'standard',
        singleUse: false,
        createdBy: doc.createdBy || null,
        ...(Object.prototype.hasOwnProperty.call(options, 'ttl') ? { ttl: options.ttl } : {})
      });

      return { ...minted, urlKey: doc.urlKey };
    } catch (err) {
      console.error('Error exchanging bootstrap proxy token:', err);
      return null;
    }
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

      // Bootstrap tokens authenticate ONLY the exchange (exchangeBootstrapToken),
      // never a data endpoint. Reject before the consume path so presenting a
      // bootstrap here does not burn it (LIN-376).
      if (doc.kind === 'bootstrap') {
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

      docs.sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
        return bTime - aTime;
      });

      return docs.map(doc => ({
        tokenId: doc._id,
        label: doc.label,
        scope: doc.scope,
        kind: doc.kind || 'standard',
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

      // Prune long-idle tokens: created a while ago AND never used (or unused
      // for just as long). Guards against accumulation when tokens were
      // created without an explicit TTL (legacy rows) or explicitly with none.
      // Filter entirely in JS so we don't depend on server-side operator
      // support, then delete by _id individually.
      let idleDeleted = 0;
      const idleCutoffMs = now.getTime() - this.idlePruneSeconds * 1000;
      const allDocs = await this.collection.find({}).toArray();
      for (const doc of allDocs) {
        const created = doc.createdAt ? new Date(doc.createdAt).getTime() : null;
        if (created === null || created >= idleCutoffMs) continue;
        const last = doc.lastUsedAt ? new Date(doc.lastUsedAt).getTime() : null;
        if (last !== null && last >= idleCutoffMs) continue;
        const r = await this.collection.deleteOne({ _id: doc._id });
        idleDeleted += r.deletedCount || 0;
      }

      return (expiredResult.deletedCount || 0)
        + (consumedResult.deletedCount || 0)
        + idleDeleted;
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
