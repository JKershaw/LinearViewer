/**
 * Task share-link store (LIN-3330, Subtask C of LIN-3324).
 *
 * A task share link is a public, read-only view of ONE owner's task page: the
 * same page the owner sees, with only the owner controls hidden. The link is
 * the ONLY credential — an unguessable 32-byte base64url token. Only the
 * token's SHA-256 is stored, shown once at creation and never returned again
 * (the `lib/email-auth.js` hashed-token precedent).
 *
 * Collection: `task_share_links` — NEVER `shares`. The old LIN-3073 collection
 * (`shares`) belongs to the retired collection/run share feature;
 * `scripts/drop-shares-collection.mjs` still targets `shares` and must stay
 * untouched. A test pins both names.
 *
 * Schema:
 * {
 *   _id: shareId,                 // 16 random bytes base64url — NOT derived from the token
 *   tokenHash: string,            // sha256 hex of the token (unique, indexed)
 *   urlKey: string,               // workspace the task lives in
 *   workspaceId: string|null,     // durable workspace id, for the owner check
 *   ownerAccountId: string,       // the account that created the link
 *   issueIdentifier: string,      // canonical tracker identifier (LIN-50)
 *   issueId: string|null,         // canonical tracker id, when the page had it
 *   source: string|null,          // provider-kind provenance (`?source=`, LIN-3335)
 *   createdAt: Date,
 *   revokedAt: Date|null          // set → the link is gone (indistinguishable from never-issued)
 * }
 *
 * `listForTask`'s sort is `{createdAt:-1,_id:-1}`; the declared index key
 * `{urlKey:1,issueIdentifier:1,createdAt:-1,_id:-1}` must match it exactly
 * (the LIN-3163 rule, pinned by the parity guard in tests/unit/db-indexes.test.js).
 */

import { createHash, randomBytes } from 'node:crypto';

export const TASK_SHARE_COLLECTION = 'task_share_links';

// 32 random bytes → exactly 43 base64url characters, no padding.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** The random id is separate from the token hash: list/revoke never touch token-derived data. */
function randomShareId() {
  return randomBytes(16).toString('base64url');
}

function randomToken() {
  return randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Whether a path token is even shaped like a task share token (32 random bytes,
 * base64url). The route checks this BEFORE any store read, so a malformed
 * `/t/<junk>` never touches the database (matrix row 1's cheap reject).
 *
 * @param {unknown} token
 * @returns {boolean}
 */
export function isWellFormedTaskShareToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/**
 * @param {Object} options
 * @param {Object} options.collection - MongoDB/MangoDB `task_share_links` collection
 * @param {() => Date} [options.now] - clock, injectable for tests
 */
export class TaskShareStore {
  constructor({ collection, now = () => new Date() } = {}) {
    this.collection = collection;
    this.now = now;
  }

  /**
   * Mint a task share link and store its record. Returns the plaintext token
   * ONCE — it is never recoverable from the store afterwards.
   *
   * @param {Object} input
   * @param {string} input.urlKey
   * @param {string|null} [input.workspaceId]
   * @param {string} input.ownerAccountId
   * @param {string} input.issueIdentifier - canonical tracker identifier
   * @param {string|null} [input.issueId]
   * @param {string|null} [input.source]
   * @returns {Promise<{token: string, record: Object}>}
   */
  async create({ urlKey, workspaceId = null, ownerAccountId, issueIdentifier, issueId = null, source = null } = {}) {
    if (!urlKey) throw new Error('urlKey is required');
    if (!ownerAccountId) throw new Error('ownerAccountId is required');
    if (!issueIdentifier) throw new Error('issueIdentifier is required');

    const token = randomToken();
    const tokenHash = hashToken(token);
    const createdAt = this.now();
    const shareId = randomShareId();

    const record = {
      _id: shareId,
      tokenHash,
      urlKey,
      workspaceId,
      ownerAccountId,
      issueIdentifier,
      issueId: issueId || null,
      source: source || null,
      createdAt,
      revokedAt: null,
    };

    await this.collection.insertOne(record);
    return { token, record };
  }

  /**
   * Resolve a link token to its record, revoked or not. Null for a malformed or
   * unknown token. The malformed check runs BEFORE any collection access, so a
   * junk token costs zero reads (matrix row 1).
   *
   * @param {unknown} token
   * @returns {Promise<Object|null>}
   */
  async getByToken(token) {
    if (!isWellFormedTaskShareToken(token)) return null;
    return this.collection.findOne({ tokenHash: hashToken(token) });
  }

  /**
   * List one task's links, newest-first. The projection returns only
   * `{id, createdAt, revokedAt}` — the store never hands back a token or hash.
   * The sort is `{createdAt:-1,_id:-1}` and the declared index key must match
   * exactly (LIN-3163).
   *
   * @param {string} urlKey
   * @param {string} issueIdentifier
   * @returns {Promise<Array<{id: string, createdAt: Date, revokedAt: Date|null}>>}
   */
  async listForTask(urlKey, issueIdentifier) {
    if (!urlKey || !issueIdentifier) return [];
    const rows = await this.collection
      .find({ urlKey, issueIdentifier })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
    return rows.map(r => ({ id: r._id, createdAt: r.createdAt, revokedAt: r.revokedAt || null }));
  }

  /**
   * Revoke a link. Idempotent — a second call keeps the first `revokedAt` — and
   * SCOPED to the same workspace/task, so a link cannot be revoked across
   * workspaces or via another task's route. Returns the record (unchanged if
   * already revoked), or null when no such scoped link exists.
   *
   * @param {string} shareId
   * @param {{urlKey: string, issueIdentifier: string}} scope
   * @returns {Promise<Object|null>}
   */
  async revoke(shareId, { urlKey, issueIdentifier } = {}) {
    if (!shareId || !urlKey || !issueIdentifier) return null;
    const existing = await this.collection.findOne({ _id: shareId, urlKey, issueIdentifier });
    if (!existing) return null;
    if (existing.revokedAt) return existing;
    const updated = await this.collection.findOneAndUpdate(
      { _id: shareId, urlKey, issueIdentifier, revokedAt: null },
      { $set: { revokedAt: this.now() } },
      { returnDocument: 'after' }
    );
    return updated || { ...existing, revokedAt: this.now() };
  }
}
