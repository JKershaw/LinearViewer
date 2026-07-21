/**
 * Durable owner-scoped provider credential storage (LIN-1523, Session 1 of the
 * LIN-1501 plan). Stores the rotating Linear OAuth credential per (account,
 * workspace) pair so it survives outside the session — see `lib/workspace.js`
 * `updateWorkspaceTokens`, the session-only writer this store dual-writes
 * alongside via the `rotateOwnerCredential` seam (`lib/workspace.js`, landed
 * with this store in Session 1; this module is additive-only and touches no
 * read path — the durable READ path is Session 2, LIN-1524).
 *
 * Schema:
 * {
 *   _id:            `${accountId}::${urlKey}`,  // composite point-read key
 *   accountId, urlKey, provider, scope,
 *   token,                                       // access token (short-lived cache)
 *   refreshToken,                                // THE durable rotating credential
 *   tokenExpiresAt,
 *   createdAt, updatedAt
 * }
 *
 * ## Plaintext at rest (LIN-1522)
 *
 * `refreshToken` is stored in plaintext. That is accepted **conditionally, for
 * this phase only** — [LIN-1522](https://linear.app/linearviewer/issue/LIN-1522)
 * owns encryption and retention for this collection. Plaintext is not a settled
 * end state; do not treat this store as a precedent for a new plaintext secret
 * elsewhere without the same follow-up.
 *
 * ## Indexing / retention
 *
 * No index: a pure composite-`_id` point read, covered by the auto `_id`
 * index (joins the "Deliberately NOT indexed" list in `lib/db-indexes.js`).
 * No `expiresAt`, no TTL index, no `cleanup()` entry: this is authorised
 * authority that lasts until explicitly revoked (see the three deletion call
 * sites LIN-1523 wires elsewhere), not a cache with a natural expiry. A second
 * local expiry clock would silently kill delegations on a schedule nobody
 * chose. `updatedAt` is carried so LIN-1522 can add idle-based retention as a
 * purely additive change later.
 */

/**
 * Durable owner-credential store. Mirrors `lib/user-preferences.js`
 * conventions: class + `constructor({collection})`, `null` on a missing point
 * read, no throws.
 */
export class OwnerCredentialStore {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection ('owner-credentials')
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /** Deterministic composite point-read key. */
  _id(accountId, urlKey) {
    return `${accountId}::${urlKey}`;
  }

  /**
   * Reads the durable credential for an (account, workspace) pair.
   *
   * @param {string} accountId
   * @param {string} urlKey - the workspace urlKey
   * @returns {Promise<Object|null>} the stored record, or null if not found
   */
  async get(accountId, urlKey) {
    if (!accountId || !urlKey) {
      console.warn('OwnerCredentialStore.get called without accountId/urlKey');
      return null;
    }

    try {
      const doc = await this.collection.findOne({ _id: this._id(accountId, urlKey) });
      return doc || null;
    } catch (err) {
      console.error('Error fetching owner credential:', err);
      return null;
    }
  }

  /**
   * Writes the full durable credential for an (account, workspace) pair.
   * Upsert on the deterministic composite `_id` — verbatim the shape of
   * `saveUserPreferences` (`lib/user-preferences.js:111-123`). A returning
   * owner **repairs in place**; a second record for the same pair is
   * unrepresentable, not merely avoided by discipline.
   *
   * Callers that only have a subset of fields should use `patch` instead,
   * which read-merges before calling this.
   *
   * @param {string} accountId
   * @param {string} urlKey - the workspace urlKey
   * @param {Object} credential
   * @param {string} [credential.provider] - defaults to 'linear'
   * @param {string} [credential.scope]
   * @param {string} [credential.token] - access token
   * @param {string} [credential.refreshToken] - the durable rotating credential
   * @param {number|string} [credential.tokenExpiresAt]
   * @returns {Promise<boolean>} true if the write succeeded
   */
  async put(accountId, urlKey, credential = {}) {
    if (!accountId || !urlKey) {
      console.warn('OwnerCredentialStore.put called without accountId/urlKey');
      return false;
    }

    try {
      const now = new Date();
      const { provider = 'linear', scope, token, refreshToken, tokenExpiresAt } = credential;
      await this.collection.updateOne(
        { _id: this._id(accountId, urlKey) },
        {
          $set: {
            accountId,
            urlKey,
            provider,
            scope,
            token,
            refreshToken,
            tokenExpiresAt,
            updatedAt: now
          },
          $setOnInsert: {
            createdAt: now
          }
        },
        { upsert: true }
      );
      return true;
    } catch (err) {
      console.error('Error saving owner credential:', err);
      return false;
    }
  }

  /**
   * Updates a subset of credential fields, preserving sibling fields —
   * read-merge, mirroring `setOpenRouterApiKey` (`lib/user-preferences.js:160-161`).
   *
   * @param {string} accountId
   * @param {string} urlKey - the workspace urlKey
   * @param {Object} fields - partial credential fields to merge in
   * @returns {Promise<boolean>} true if the write succeeded
   */
  async patch(accountId, urlKey, fields = {}) {
    if (!accountId || !urlKey) {
      console.warn('OwnerCredentialStore.patch called without accountId/urlKey');
      return false;
    }
    const existing = await this.get(accountId, urlKey);
    return this.put(accountId, urlKey, { ...existing, ...fields });
  }

  /**
   * Deletes the durable credential for an (account, workspace) pair. No-op
   * (never throws) when no record exists — mirrors the `null`-on-missing /
   * no-throw convention for the delete path.
   *
   * @param {string} accountId
   * @param {string} urlKey - the workspace urlKey
   * @returns {Promise<boolean>} true if the call completed (whether or not a record existed)
   */
  async delete(accountId, urlKey) {
    if (!accountId || !urlKey) {
      console.warn('OwnerCredentialStore.delete called without accountId/urlKey');
      return false;
    }

    try {
      await this.collection.deleteOne({ _id: this._id(accountId, urlKey) });
      return true;
    } catch (err) {
      console.error('Error deleting owner credential:', err);
      return false;
    }
  }
}
