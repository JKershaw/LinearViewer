/**
 * Durable, write-only Connection record (LIN-3127, Session 1 of LIN-2149's
 * Account -> Connection -> Workspace cutover). Dual-written alongside the
 * existing binding/owner-credential writers through the shared
 * {@link writeConnection} helper. NO read path is wired to it yet (LIN-3124
 * owns the read cutover), and — unlike the first plan draft — NO delete path
 * either: see "Lifecycle" below for why deletion is deferred whole, not
 * partially, and what that leaves outstanding.
 *
 * Schema:
 * {
 *   _id:          `${accountId}::${normalizeProviderName(provider)}::${unitId}`,
 *   accountId, provider, unitId,
 *   credentials: { token, tokenExpiresAt, installationId,
 *                  email, authType, cloudId },   // verbatim subset of the
 *                                                 // binding's POST-linkProvider
 *                                                 // merged credentials — see
 *                                                 // "Record contents" below.
 *                                                 // `token` is never named
 *                                                 // `apiToken` for Jira Basic
 *                                                 // (apiToken is a read-side
 *                                                 // projection only,
 *                                                 // workspace.js:694/785) —
 *                                                 // moot for Basic under the
 *                                                 // ruling below, which omits
 *                                                 // `token` entirely for it.
 *   createdAt, updatedAt
 * }
 *
 * ## The (accountId, provider, unitId) partition
 *
 * `unitId` is the provider-declared connection unit, derived per provider by
 * {@link unitIdForBinding}: the GitHub/GitHub-Projects installation id, the
 * Jira binding `scope` (site URL — never `cloudId`, which a Basic binding does
 * not carry), or the Linear binding `scope` (the org id; `connectionUnit` is
 * null for Linear, so this reads the same field as Jira). The provider is
 * folded into the `_id` through `normalizeProviderName`, applying LIN-1887's
 * partition lesson: without it, linking Jira would overwrite Linear's record.
 * Both the provider AND the unit id are in the key from day one so several
 * installations/sites/orgs never collapse into one record.
 *
 * ## Record contents (the write helper)
 *
 * {@link writeConnection} reads the binding back AFTER `linkProvider` merged
 * the new credential into it (`lib/workspace.js:427`) and copies only the
 * whitelisted fields below off the merged object. A seam that wrote the
 * call-site literal instead would silently drop previously-set fields on an
 * update (e.g. a Jira Basic -> OAuth upgrade-in-place losing `email`).
 *
 * ## Plaintext at rest, and retention (LIN-1522)
 *
 * Credential fields are plaintext, matching lib/owner-credential-store.js —
 * LIN-1522 owns encryption/retention repo-wide. Per-class exposure (verified
 * against source, not assumed):
 *   - Jira Basic `token` (Atlassian API token): NOT STORED. Ruling
 *     `lin3127-jira-basic-retention` (Con ruling, delegated by John, comment
 *     `fd45fc6a`, CONFIRMED non-provisional by John on 2026-09-27, comment
 *     `04461f8f`): the token never expires and today lives only in 30-day
 *     sessions with no durable copy anywhere — storing it durably with no
 *     delete path (LIN-3124 not yet landed) would be a security-boundary
 *     widening made by default, not a deliberate choice. Omitted at the shared
 *     write helper, keyed on the binding's Jira auth type (Basic never sets
 *     `authType`; OAuth always sets `'oauth'`), so EVERY seam that could reach
 *     a Basic credential — the Basic add-source seam, a same-site Basic->OAuth
 *     upgrade-in-place, and merge-confirm — is covered by one check, not a
 *     per-seam guard. A Basic record is still written (same key, same
 *     idempotent-upsert shape as every other provider), holding only its
 *     non-secret fields (`email`) and no `token`. Jira Basic is therefore NO
 *     LONGER new durable exposure: it gains no durable secret copy at all
 *     under this ticket; affected users re-enter the Basic token after
 *     LIN-3124 lands deletion.
 *   - Jira OAuth `token` (access token, no refreshToken — linkProvider never
 *     mirrors it) and Linear OAuth `token`: both already durable via
 *     OwnerCredentialStore (7-site delete lifecycle applies there); this store
 *     adds a second, UNDELETED copy of an already-lifecycled secret that
 *     self-invalidates at its real provider-set expiry.
 *   - GitHub/GitHub-Projects installation token: no durable copy exists today
 *     (GitHub-family owns no OwnerCredentialStore record at all), but the token
 *     itself self-invalidates at GitHub's real ~1h expiry regardless of this
 *     copy; only the (non-secret) installationId persists usefully past that.
 * LIN-1522 (https://linear.app/linearviewer/issue/LIN-1522) covers this
 * collection's encryption/retention alongside `owner-credentials`.
 *
 * ## Lifecycle, referents and `origin` (LIN-3124 PR2)
 *
 * PR2 lands the additive read/delete lifecycle. Deletion authority is
 * deliberately narrow, so a LIN-3127-born row (which has no `referents` field
 * and no `origin`) can never be deleted or reported by this ticket even after a
 * connection-backed `link` shares it:
 *
 *   - the three-state rule (D10): **absent** `referents` = a dual-write row
 *     never connection-managed; **`[]`** = referenced and now empty;
 *     **non-empty** = referenced. Rows with `referents` absent are never
 *     returned by `readConnectionsByReferent` / `readReferencedConnections`,
 *     and never deleted by `deleteIfUnreferenced` / the merge prefix deleter.
 *   - `link` is one atomic upsert: `$set` credentials, `$addToSet` the
 *     referent, `$setOnInsert: {origin:'connection'}`. `origin` is only ever
 *     set on insert, so a LIN-3127 row that gains a referent still carries no
 *     `origin` and stays undeletable (retained for LIN-2150).
 *   - `deleteConnection` (unconditional, at a definitive-revocation site)
 *     returns the removed referents for cache-eviction fan-out;
 *     `deleteIfUnreferenced` (last-referent unlink) and
 *     `deleteEmptyByAccountPrefix` (account merge) both require
 *     `origin:'connection'` and `referents` present with `$size:0`.
 *   - `updateCredentials` mirrors a rotated credential into the row
 *     monotonically (a stale write with an older `tokenExpiresAt` is refused).
 *   - legacy `put` skips its credentials `$set` when the row is
 *     connection-managed (`referents` present), so a legacy dual-write cannot
 *     clobber a linked credential; the check-then-upsert window is bounded and
 *     self-repairs on the next refresh (`updateCredentials` is the
 *     authoritative writer and has no such skip).
 *
 * ## Indexing
 *
 * `connections` carries the D10 referent index
 * `{'referents.urlKey': 1, 'referents.provider': 1}` (lib/db-indexes.js), so the
 * connection-first read arms can find a connection by referent without a
 * collection scan. The composite-`_id` point lookups/upserts remain served by
 * the auto `_id` index.
 *
 * Conventions mirror lib/owner-credential-store.js: class +
 * `constructor({collection})`, composite-`_id` upsert, null-on-miss/no-throw.
 */

import { normalizeProviderName } from './workspace.js';
import { unitIdForBinding } from './connection-binding.js';

/** The explicit credential-field whitelist this store will persist (never the object wholesale). */
export const CONNECTION_CREDENTIAL_FIELDS = [
  'token',
  'tokenExpiresAt',
  'installationId',
  'email',
  'authType',
  'cloudId'
];

/** The `origin` marker `link` writes on first insert (D10). */
export const CONNECTION_ORIGIN = 'connection';

/**
 * Anchored `_id` prefix filter for `${accountId}::…` (the account-merge orphan
 * scan, D4). The account id is escaped so it cannot act as a regex.
 */
function anchorPrefixRe(accountId) {
  return new RegExp('^' + String(accountId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '::');
}

/**
 * Durable, write-only Connection store. Mirrors `lib/owner-credential-store.js`
 * conventions: class + `constructor({collection})`, `null` on a missing point
 * read, no throws.
 */
export class ConnectionStore {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection ('connections')
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /** Deterministic composite point-read key, partitioned by provider and connection unit. */
  _id(accountId, provider, unitId) {
    return `${accountId}::${normalizeProviderName(provider)}::${unitId}`;
  }

  /**
   * Best-effort upsert. Never throws; logs and returns `false` on failure,
   * including when `accountId`/`provider`/`unitId` is missing (warns, no-ops) —
   * mirrors `OwnerCredentialStore.put`'s discipline exactly. `$set`s an
   * EXPLICIT field list (only whichever of `token, tokenExpiresAt,
   * installationId, email, authType, cloudId` are present on the passed-in
   * `credentials`), never the object wholesale, and stores the NORMALIZED
   * `provider` exactly as `OwnerCredentialStore.put` does.
   *
   * @param {string} accountId
   * @param {string} provider
   * @param {string} unitId - the provider's connection unit (installation id / site / org id)
   * @param {Object} [credentials] - the binding's merged credential fields
   * @returns {Promise<boolean>} true if the write succeeded
   */
  async put(accountId, provider, unitId, credentials = {}) {
    if (!accountId || !provider || !unitId) {
      console.warn('ConnectionStore.put called without accountId/provider/unitId');
      return false;
    }

    try {
      const now = new Date();
      const normalizedProvider = normalizeProviderName(provider);
      const id = this._id(accountId, normalizedProvider, unitId);
      const stored = {};
      for (const field of CONNECTION_CREDENTIAL_FIELDS) {
        if (credentials[field] !== undefined) stored[field] = credentials[field];
      }
      // D10: a connection-managed row (`referents` field present) is owned by
      // the connection lifecycle, so a legacy dual-write must not clobber its
      // credentials — the row's own metadata is still refreshed. A concurrent
      // `link` landing between this read and the write leaves a small window,
      // self-repairing on the next refresh (`updateCredentials` has no skip).
      const existing = await this.collection.findOne({ _id: id });
      const managed = existing !== null && existing !== undefined &&
        Object.prototype.hasOwnProperty.call(existing, 'referents');
      const set = { accountId, provider: normalizedProvider, unitId, updatedAt: now };
      if (!managed) set.credentials = stored;
      await this.collection.updateOne(
        { _id: id },
        { $set: set, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
      return true;
    } catch (err) {
      console.error('Error saving connection:', err);
      return false;
    }
  }

  /**
   * Read a Connection by its composite parts. Test-only — added ONLY so the
   * acceptance witness's no-read-switch proof is expressible (stub-to-throw),
   * and renamed from `get` to the `readConnection*` naming law in LIN-3124 PR1
   * so an identifier-level guard can enforce that every Connection read is a
   * `readConnection*` call. NO production caller — enforced by the static
   * repo-wide guard (`tests/unit/connection-access-guard.test.js`).
   *
   * @param {string} accountId
   * @param {string} provider
   * @param {string} unitId
   * @returns {Promise<Object|null>} the stored record, or null if not found
   */
  async readConnectionByParts(accountId, provider, unitId) {
    if (!accountId || !provider || !unitId) {
      console.warn('ConnectionStore.readConnectionByParts called without accountId/provider/unitId');
      return null;
    }
    try {
      return await this.collection.findOne({
        _id: this._id(accountId, normalizeProviderName(provider), unitId)
      });
    } catch (err) {
      console.error('Error fetching connection:', err);
      return null;
    }
  }

  // No bare delete()/deleteAll() (OwnerCredentialStore's names). Deletion
  // authority is the narrow referent-gated lifecycle below (D10/D18).

  /**
   * Atomic connection-backed link (D10 / D18 step 2). One upsert writes the
   * credential, inserts `origin: 'connection'` on first insert, and adds the
   * referent. The referent is written together with the credential — never as a
   * separate compensating step — so `removeReferent` is not part of any
   * fallback. Never throws; `false` on failure or missing key parts.
   *
   * @param {string} accountId
   * @param {string} provider
   * @param {string} unitId
   * @param {Object} [credentials]
   * @param {Object} [referent] - `{urlKey, provider, scope}`; added only when provided
   * @returns {Promise<boolean>}
   */
  async link(accountId, provider, unitId, credentials = {}, referent) {
    if (!accountId || !provider || !unitId) {
      console.warn('ConnectionStore.link called without accountId/provider/unitId');
      return false;
    }
    try {
      const now = new Date();
      const normalizedProvider = normalizeProviderName(provider);
      const stored = {};
      for (const field of CONNECTION_CREDENTIAL_FIELDS) {
        if (credentials[field] !== undefined) stored[field] = credentials[field];
      }
      const update = {
        $set: {
          accountId,
          provider: normalizedProvider,
          unitId,
          credentials: stored,
          updatedAt: now
        },
        $setOnInsert: { origin: CONNECTION_ORIGIN, createdAt: now }
      };
      if (referent) update.$addToSet = { referents: referent };
      await this.collection.updateOne(
        { _id: this._id(accountId, normalizedProvider, unitId) },
        update,
        { upsert: true }
      );
      return true;
    } catch (err) {
      console.error('Error linking connection:', err);
      return false;
    }
  }

  /**
   * Point read by the connection id (`_id`). Named to the `readConnection*`
   * law so the identifier-level guard can enforce that every Connection read
   * lives in the reader modules. Never throws; `null` on a miss.
   *
   * @param {string} connectionId
   * @returns {Promise<Object|null>}
   */
  async readConnectionById(connectionId) {
    if (!connectionId) {
      console.warn('ConnectionStore.readConnectionById called without connectionId');
      return null;
    }
    try {
      return await this.collection.findOne({ _id: connectionId });
    } catch (err) {
      console.error('Error fetching connection:', err);
      return null;
    }
  }

  /**
   * LIN-3124 PR3 (D18 ambiguous acknowledgement): a point read that tells a
   * miss apart from a failed read, which `readConnectionById` (null for both)
   * cannot. Returns `{ connection }` (`connection` is `null` on a miss) when
   * the read succeeded, and `null` when it failed. Never throws.
   *
   * @param {string} connectionId
   * @returns {Promise<{connection: Object|null}|null>}
   */
  async readConnectionOutcome(connectionId) {
    if (!connectionId) return null;
    try {
      return { connection: (await this.collection.findOne({ _id: connectionId })) ?? null };
    } catch (err) {
      console.error('Error fetching connection outcome:', err);
      return null;
    }
  }

  /**
   * Batched point read by id set — the hydration middleware's one read per
   * request (`$in` on `_id`). Never throws; `[]` on failure or an empty set.
   *
   * @param {string[]} connectionIds
   * @returns {Promise<Object[]>}
   */
  async readConnectionsByIds(connectionIds) {
    const ids = Array.isArray(connectionIds) ? connectionIds.filter(Boolean) : [];
    if (ids.length === 0) return [];
    try {
      return await this.collection.find({ _id: { $in: ids } }).toArray();
    } catch (err) {
      console.error('Error fetching connections by ids:', err);
      return [];
    }
  }

  /**
   * Connections carrying a referent for `urlKey` (and, when given, `provider`).
   * The `$elemMatch` requires both fields on the SAME referent element —
   * strictly narrower than a session scan. Rows whose `referents` field is
   * absent (LIN-3127-born) are never returned. Never throws; `[]` on failure.
   *
   * @param {string} urlKey
   * @param {string} [provider]
   * @returns {Promise<Object[]>}
   */
  async readConnectionsByReferent(urlKey, provider) {
    if (!urlKey) return [];
    try {
      const elem = provider
        ? { urlKey, provider: normalizeProviderName(provider) }
        : { urlKey };
      return await this.collection.find({ referents: { $elemMatch: elem } }).toArray();
    } catch (err) {
      console.error('Error fetching connections by referent:', err);
      return [];
    }
  }

  /**
   * Every connection-managed row (its `referents` field exists, empty or not).
   * An absent field means "never connection-managed" and is never returned, so
   * a LIN-3127-born row can never be reported as `connection_unreferenced`.
   *
   * @returns {Promise<Object[]>}
   */
  async readReferencedConnections() {
    try {
      return await this.collection.find({ referents: { $exists: true } }).toArray();
    } catch (err) {
      console.error('Error fetching referenced connections:', err);
      return [];
    }
  }

  /**
   * Connections owned by an account (anchored `_id` prefix `${accountId}::`),
   * used by the account-merge orphan scan (D4). Never throws; `[]` on failure.
   *
   * @param {string} accountId
   * @returns {Promise<Object[]>}
   */
  async readConnectionsByAccountPrefix(accountId) {
    if (!accountId) return [];
    try {
      return await this.collection.find({ _id: anchorPrefixRe(accountId) }).toArray();
    } catch (err) {
      console.error('Error fetching connections by account prefix:', err);
      return [];
    }
  }

  /**
   * Monotonic credential mirror (D9): writes the whitelisted credential fields
   * from `credentials` into the row, but never moves `tokenExpiresAt` backwards
   * — when the incoming expiry is a number and the stored one is newer, the
   * write is refused. This is a connection-backed credential's authoritative
   * writer and (unlike `put`) has no managed-row skip, so it self-heals the
   * `put`/`link` window on the next refresh. Never throws.
   *
   * @param {string} connectionId
   * @param {Object} [credentials]
   * @returns {Promise<boolean>} true when the row was updated
   */
  async updateCredentials(connectionId, credentials = {}) {
    if (!connectionId) {
      console.warn('ConnectionStore.updateCredentials called without connectionId');
      return false;
    }
    try {
      const now = new Date();
      const set = { updatedAt: now };
      for (const field of CONNECTION_CREDENTIAL_FIELDS) {
        if (credentials[field] !== undefined) set[`credentials.${field}`] = credentials[field];
      }
      const filter = { _id: connectionId };
      const incomingExpiry = credentials.tokenExpiresAt;
      if (typeof incomingExpiry === 'number') {
        filter.$or = [
          { 'credentials.tokenExpiresAt': { $exists: false } },
          { 'credentials.tokenExpiresAt': { $lte: incomingExpiry } }
        ];
      }
      const result = await this.collection.updateOne(filter, { $set: set });
      return (result?.matchedCount ?? result?.modifiedCount ?? 0) === 1;
    } catch (err) {
      console.error('Error updating connection credentials:', err);
      return false;
    }
  }

  /**
   * LIN-3125 Phase 1 (C1) — referent-only write: add one referent to an EXISTING
   * connection-managed row with `$addToSet` (idempotent). Deliberately NOT
   * `link()`: `link` overwrites `credentials` in the same upsert and would race
   * the refresher, so a held add must add its referent without touching the
   * held credential. There is no upsert — a missing row is a `false`, never a
   * new row. Never throws; `false` on a missing key, a missing row, or failure.
   *
   * @param {string} connectionId - the row's `_id`
   * @param {Object} referent - `{urlKey, provider, scope}`
   * @returns {Promise<boolean>} true when an existing row was updated
   */
  async addReferent(connectionId, referent) {
    if (!connectionId || !referent) {
      console.warn('ConnectionStore.addReferent called without connectionId/referent');
      return false;
    }
    try {
      const result = await this.collection.updateOne(
        { _id: connectionId },
        { $addToSet: { referents: referent }, $set: { updatedAt: new Date() } }
      );
      return (result?.matchedCount ?? 0) === 1;
    } catch (err) {
      console.error('Error adding connection referent:', err);
      return false;
    }
  }

  /**
   * Removes one referent from a row. Never a failure-path fallback (D18), and
   * never throws.
   *
   * @param {string} connectionId
   * @param {Object} referent
   * @returns {Promise<boolean>}
   */
  async removeReferent(connectionId, referent) {
    if (!connectionId || !referent) {
      console.warn('ConnectionStore.removeReferent called without connectionId/referent');
      return false;
    }
    try {
      await this.collection.updateOne(
        { _id: connectionId },
        { $pull: { referents: referent }, $set: { updatedAt: new Date() } }
      );
      return true;
    } catch (err) {
      console.error('Error removing connection referent:', err);
      return false;
    }
  }

  /**
   * Deletes a row only when it is connection-managed and has no referents left
   * (D10 three-state rule). A row with `referents` absent is never deleted.
   * Returns `true` only when a document was actually removed.
   *
   * @param {string} connectionId
   * @returns {Promise<boolean>}
   */
  async deleteIfUnreferenced(connectionId) {
    if (!connectionId) {
      console.warn('ConnectionStore.deleteIfUnreferenced called without connectionId');
      return false;
    }
    try {
      const result = await this.collection.deleteOne({
        _id: connectionId,
        origin: CONNECTION_ORIGIN,
        referents: { $size: 0 }
      });
      return (result?.deletedCount ?? 0) === 1;
    } catch (err) {
      console.error('Error deleting unreferenced connection:', err);
      return false;
    }
  }

  /**
   * Unconditional deletion at a definitive-revocation site (D4). Returns the
   * removed row's referents (possibly `[]`) so the caller can fan out cache
   * eviction; `null` on error. Never throws.
   *
   * @param {string} connectionId
   * @returns {Promise<Array|null>}
   */
  async deleteConnection(connectionId) {
    if (!connectionId) {
      console.warn('ConnectionStore.deleteConnection called without connectionId');
      return null;
    }
    try {
      const existing = await this.collection.findOne({ _id: connectionId });
      await this.collection.deleteOne({ _id: connectionId });
      return Array.isArray(existing?.referents) ? existing.referents : [];
    } catch (err) {
      console.error('Error deleting connection:', err);
      return null;
    }
  }

  /**
   * Account-merge orphan cleanup (D4/D10): deletes only `origin:'connection'`
   * rows under the merged account's `_id` prefix that have no referents left.
   * A LIN-3127-born row (no `origin`) is never deleted. Returns the delete
   * count; `0` on error (never throws).
   *
   * @param {string} accountId
   * @returns {Promise<number>}
   */
  async deleteEmptyByAccountPrefix(accountId) {
    if (!accountId) {
      console.warn('ConnectionStore.deleteEmptyByAccountPrefix called without accountId');
      return 0;
    }
    try {
      const result = await this.collection.deleteMany({
        _id: anchorPrefixRe(accountId),
        origin: CONNECTION_ORIGIN,
        referents: { $size: 0 }
      });
      return result?.deletedCount ?? 0;
    } catch (err) {
      console.error('Error deleting empty connections by account prefix:', err);
      return 0;
    }
  }
}

// LIN-3124 PR3: `unitIdForBinding` moved to the store-free
// `lib/connection-binding.js` so the converter can derive a connection id
// without importing this module; re-exported here for existing importers.
export { unitIdForBinding };

/**
 * A Jira binding with no `authType: 'oauth'` is Basic.
 *
 * lin3127-jira-basic-retention (Con ruling, delegated by John, fd45fc6a;
 * confirmed non-provisional by John, comment 04461f8f): never persist a Basic
 * `token`. Checked in the ONE shared helper every seam funnels through, so a
 * Basic credential reaching Connection by ANY path (the Basic add-source seam,
 * a Basic->OAuth upgrade-in-place, or merge-confirm) is covered by this one
 * check, not a per-seam guard that could be missed on a new seam.
 */
function isJiraBasicCredential(provider, credentials = {}) {
  return provider === 'jira' && credentials.authType !== 'oauth';
}

/**
 * Dual-writes a Connection record for a binding on `workspace`.
 *
 * Called AFTER `linkProvider`, reading the binding back (not the call-site
 * literal) so the record carries the MERGED credentials. Best-effort at the
 * HELPER level (N4), not only inside `put`: a throw during the binding lookup
 * or unit-id derivation is caught here so it cannot fail the caller's
 * auth/merge path. No-ops when the store is absent (optional dependency), the
 * binding is not found, or the provider declares no unit id.
 *
 * `options.omitToken` is an explicit, caller-supplied "never persist `token`"
 * signal. The Basic add-source seam passes it unconditionally, because the
 * `authType` check below is bypassable: `linkProvider` merges
 * `{...existing.credentials, ...credentials}`, so a Basic add-source onto a
 * site that already holds an OAuth binding keeps `authType: 'oauth'` from the
 * old credentials while `token` becomes the Basic API token. `omitToken` closes
 * that hole at the seam that knows it is Basic; the `authType` check stays as
 * defense in depth for every other path (merge-confirm, Basic->OAuth
 * upgrade-in-place) that does not pass the flag.
 *
 * @param {ConnectionStore} connectionStore
 * @param {string} accountId
 * @param {Object} workspace - the container the binding was linked onto
 * @param {string} provider
 * @param {string} scope - the binding scope the caller just linked
 * @param {Object} [options]
 * @param {boolean} [options.omitToken] - unconditionally omit `token` from the record
 * @returns {Promise<void>}
 */
export async function writeConnection(connectionStore, accountId, workspace, provider, scope, options = {}) {
  if (!connectionStore) return;
  try {
    const binding = workspace.bindings.find(b => b.provider === provider && b.scope === scope);
    if (!binding) return;
    const unitId = unitIdForBinding(binding);
    if (!unitId) return;
    const omitToken = options.omitToken === true || isJiraBasicCredential(provider, binding.credentials);
    const credentials = {};
    for (const field of CONNECTION_CREDENTIAL_FIELDS) {
      if (field === 'token' && omitToken) continue;
      if (binding.credentials[field] !== undefined) credentials[field] = binding.credentials[field];
    }
    await connectionStore.put(accountId, provider, unitId, credentials);
  } catch (err) {
    console.error('Connection write failed:', err);
  }
}
