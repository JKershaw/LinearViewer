/**
 * Share-link store (LIN-3243, Session A of LIN-3073).
 *
 * A share is a public, read-only view of a task collection — either a parent
 * task's subtasks or every task carrying a label. The link is the ONLY
 * credential: an unguessable 32-byte base64url token. Only the token's SHA-256
 * is stored, and that hash is the record's `_id`, so a lookup is a point read
 * and a leaked store never yields a usable link. This follows the single-use
 * hashed-token precedent `lib/email-auth.js:56` (32 random bytes, base64url,
 * sha256 stored).
 *
 * Schema (collection: shares):
 * {
 *   _id: string,                  // sha256(token) hex — the raw token is never stored
 *   tokenHash: string,            // same value, explicit (indexed unique)
 *   urlKey: string,               // workspace the collection lives in
 *   workspaceId: string|null,     // durable workspace id, for the owner check
 *   ownerAccountId: string,       // the account that created the link
 *   subject: {                    // what the link shows
 *     type: 'collection',
 *     kind: 'parent' | 'label',
 *     id: string                  // parent canonical UUID, or label name
 *   },
 *   includeDescriptions: boolean, // opt-in; descriptions are never on by default
 *   createdAt: Date,
 *   revokedAt: Date|null,         // set → 410 (revoked rows are kept, no TTL)
 *   snapshot: Object|null,        // { title, items } — see lib/share-snapshot.js
 *   snapshotAt: Date|null,        // when `snapshot` content was fetched
 *   lastRefreshAttemptAt: Date|null // stamps both successful and failed refreshes
 * }
 *
 * No TTL and no `cleanup()`: revoked rows are retained (LIN-2950 reuses the
 * record/cache/revoke), and a share has no natural expiry — the owner revokes
 * it. The two declared indexes are in lib/db-indexes.js.
 */

import { createHash, randomBytes } from 'node:crypto';

export const SHARE_COLLECTION = 'shares';

// 32 random bytes → exactly 43 base64url characters, no padding.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SUBJECT_KINDS = ['parent', 'label'];

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function randomToken() {
  return randomBytes(32).toString('base64url');
}

function isWellFormedToken(value) {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

/**
 * Whether a path token is even shaped like a share token (32 random bytes,
 * base64url). The route checks this BEFORE any store read, so a malformed
 * `/s/<junk>` never touches the database (matrix row 1's cheap reject).
 *
 * @param {unknown} token
 * @returns {boolean}
 */
export function isWellFormedShareToken(token) {
  return isWellFormedToken(token);
}

function validSubject(subject) {
  return Boolean(
    subject &&
    subject.type === 'collection' &&
    SUBJECT_KINDS.includes(subject.kind) &&
    typeof subject.id === 'string' &&
    subject.id.length > 0
  );
}

/**
 * @param {Object} options
 * @param {Object} options.collection - MongoDB/MangoDB `shares` collection
 * @param {() => Date} [options.now] - clock, injectable for tests
 */
export class ShareStore {
  constructor({ collection, now = () => new Date() } = {}) {
    this.collection = collection;
    this.now = now;
  }

  /**
   * Mint a share link and store its record. Returns the plaintext token ONCE —
   * it is never recoverable from the store afterwards.
   *
   * @param {Object} input
   * @param {string} input.urlKey
   * @param {string|null} [input.workspaceId]
   * @param {string} input.ownerAccountId
   * @param {{type:'collection',kind:'parent'|'label',id:string}} input.subject
   * @param {boolean} [input.includeDescriptions=false]
   * @returns {Promise<{token: string, record: Object}>}
   */
  async create({ urlKey, workspaceId = null, ownerAccountId, subject, includeDescriptions = false } = {}) {
    if (!urlKey) throw new Error('urlKey is required');
    if (!ownerAccountId) throw new Error('ownerAccountId is required');
    if (!validSubject(subject)) throw new Error('subject must be { type: "collection", kind: "parent"|"label", id }');

    const token = randomToken();
    const tokenHash = hashToken(token);
    const createdAt = this.now();

    const record = {
      _id: tokenHash,
      tokenHash,
      urlKey,
      workspaceId,
      ownerAccountId,
      subject: { type: 'collection', kind: subject.kind, id: subject.id },
      includeDescriptions: includeDescriptions === true,
      createdAt,
      revokedAt: null,
      snapshot: null,
      snapshotAt: null,
      lastRefreshAttemptAt: null
    };

    await this.collection.insertOne(record);
    return { token, record };
  }

  /**
   * Resolve a link token to its record, revoked or not. The caller decides what
   * `revokedAt` means (matrix row 2 → 410). Null for a malformed or unknown token.
   *
   * @param {unknown} token
   * @returns {Promise<Object|null>}
   */
  async getByToken(token) {
    if (!isWellFormedToken(token)) return null;
    return this.collection.findOne({ _id: hashToken(token) });
  }

  /**
   * List a workspace's shares, newest-first. The sort is `{createdAt:-1,_id:-1}`
   * and the declared index key must stay exactly `{urlKey:1,createdAt:-1,_id:-1}`
   * (pinned by the LIN-3163 parity guard in tests/unit/db-indexes.test.js).
   *
   * @param {string} urlKey
   * @returns {Promise<Object[]>}
   */
  async listByUrlKey(urlKey) {
    if (!urlKey) return [];
    return this.collection.find({ urlKey }).sort({ createdAt: -1, _id: -1 }).toArray();
  }

  /**
   * Revoke a share. Idempotent: an already-revoked or unknown token returns the
   * existing/absent record without changing the original `revokedAt`.
   *
   * @param {unknown} token
   * @returns {Promise<Object|null>} the updated record, or null if unknown
   */
  async revoke(token) {
    if (!isWellFormedToken(token)) return null;
    const tokenHash = hashToken(token);
    const updated = await this.collection.findOneAndUpdate(
      { _id: tokenHash, revokedAt: null },
      { $set: { revokedAt: this.now() } },
      { returnDocument: 'after' }
    );
    if (updated) return updated;
    // Already revoked or never existed — read back so the caller can still tell
    // "revoked" from "unknown"; the update above changed nothing.
    return this.collection.findOne({ _id: tokenHash });
  }

  /**
   * Revoke a share by its record id, optionally scoped to a workspace so a
   * management route can never cross workspace boundaries (LIN-3244). Idempotent
   * like `revoke`: an already-revoked row keeps its original `revokedAt`.
   *
   * @param {unknown} id - the record `_id` (token hash)
   * @param {string} [urlKey] - when present, the row must also match this workspace
   * @returns {Promise<Object|null>} the updated record, or null if unknown/mismatched
   */
  async revokeById(id, urlKey) {
    if (typeof id !== 'string' || id.length === 0) return null;
    const scope = { _id: id };
    if (urlKey) scope.urlKey = urlKey;
    const updated = await this.collection.findOneAndUpdate(
      { ...scope, revokedAt: null },
      { $set: { revokedAt: this.now() } },
      { returnDocument: 'after' }
    );
    if (updated) return updated;
    // Already revoked (or unknown): read back so the caller can still tell them apart.
    return this.collection.findOne(scope);
  }

  /**
   * Stamp a refresh attempt and, when a snapshot was produced, store it.
   * `lastRefreshAttemptAt` moves on every call (success or failure) — the route
   * uses it to bound retries after a failure (row 7 backoff). A null `snapshot`
   * therefore records a failed attempt without disturbing the last good content.
   *
   * @param {string} tokenHash - the record's `tokenHash` (its `_id`)
   * @param {Object|null} snapshot - `{ title, items }` from lib/share-snapshot.js, or null on failure
   * @param {Object} [opts]
   * @param {Date} [opts.at] - attempt timestamp (defaults to the store clock)
   * @returns {Promise<boolean>} true when a matching record was updated
   */
  async saveSnapshot(tokenHash, snapshot, { at = this.now() } = {}) {
    if (!tokenHash) return false;
    const update = { $set: { lastRefreshAttemptAt: at } };
    if (snapshot != null) {
      update.$set.snapshot = snapshot;
      update.$set.snapshotAt = at;
    }
    const result = await this.collection.updateOne({ _id: tokenHash }, update);
    return (result?.matchedCount ?? result?.modifiedCount ?? 0) > 0;
  }
}
