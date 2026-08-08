/**
 * Durable owner-scoped provider credential storage (LIN-1523, Session 1 of the
 * LIN-1501 plan). Stores the rotating Linear OAuth credential per (account,
 * workspace) pair so it survives outside the session — see `lib/workspace.js`
 * `updateWorkspaceTokens`, the session-only writer this store's durable half is
 * dual-written alongside (the OAuth acquisition sites write here via
 * `persistOwnerCredential`; the Linear refresh path via this store's own
 * compare-and-set write — see `lib/workspace-token-refresh.js`). Landed with
 * this store in Session 1; this module is additive-only and touches no read
 * path — the durable READ path is Session 2, LIN-1524.
 *
 * Schema:
 * {
 *   _id:            `${accountId}::${urlKey}::${provider}`,  // composite point-read key
 *   accountId, urlKey, provider, scope,
 *   token,                                       // access token (short-lived cache)
 *   refreshToken,                                // THE durable rotating credential
 *   tokenExpiresAt,
 *   createdAt, updatedAt
 * }
 *
 * ## The provider partition (LIN-1887, F1)
 *
 * The `_id` gained its `::${provider}` component in LIN-1887. Before it, the
 * key was `${accountId}::${urlKey}` and `provider` was a STAMP on the single
 * record rather than a partition — one durable credential per (account,
 * workspace), which was true only while exactly one provider per workspace was
 * refreshable. Jira OAuth (LIN-1887) is the second, and it lands exclusively on
 * workspaces that already have another binding (Jira is add-source only), so
 * without the partition a Jira link `put`s straight over Linear's rotating
 * refresh token, leaves the record mislabelled `provider: 'linear'`, and the
 * next Linear refresh spends an Atlassian token at `api.linear.app` →
 * `invalid_grant` → durable delete → `removeWorkspace` → `session.destroy()`.
 * Linking Jira deleted the user's Linear workspace and session.
 *
 * The partition is derived from the record's OWN `provider` field on every
 * write (`put`/`putIfRefreshToken` read it out of the credential they are
 * given), so a record's partition and its label are structurally incapable of
 * disagreeing. Reads take the provider explicitly, because a read has no
 * credential to derive it from.
 *
 * Legacy 2-part records are handled by a read-through with migrate-on-read (see
 * {@link OwnerCredentialStore#get}) rather than a batch backfill — a one-shot
 * migration over a production credential store has no rollback, and this does
 * not need one.
 *
 * Two consumers of the OLD invariant were rewritten with this change rather
 * than silently invalidated: `server.js`'s `deleteDurable: false` rationale on a
 * GitHub re-mint failure, and the `provider === 'linear'` gate on the
 * unlink-one-binding delete.
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

import { normalizeProviderName } from './workspace.js';

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

  /** Deterministic composite point-read key, partitioned by provider (LIN-1887). */
  _id(accountId, urlKey, provider) {
    return `${accountId}::${urlKey}::${normalizeProviderName(provider)}`;
  }

  /**
   * The pre-LIN-1887 2-part key. Read-only: nothing writes this shape anymore.
   * Kept so {@link OwnerCredentialStore#get} can migrate a legacy record on
   * read and {@link OwnerCredentialStore#deleteAll} can reap one.
   */
  _legacyId(accountId, urlKey) {
    return `${accountId}::${urlKey}`;
  }

  /**
   * Reads the durable credential for an (account, workspace, provider) triple.
   *
   * Falls back to the legacy 2-part record — **only when that record belongs to
   * the provider being asked for** — and migrates it to the partitioned id on
   * the way through.
   *
   * ### Why the provider gate is load-bearing (LIN-1887 G1)
   *
   * An UNGATED fallback reproduces, through the fix, the very defect the
   * partition exists to prevent. On a co-resident workspace (a legacy Linear
   * record, a Jira binding being added) the first jira-scoped read would hit
   * the legacy id, migrate Linear's rotating credential into the `::jira`
   * partition and delete the legacy record. Two consequences: Linear's own read
   * then returns `null`, so `ensureValidToken` throws, `removeWorkspace` fires
   * and the Linear workspace is removed; and Linear's refresh token now sits in
   * the partition Jira's `oauth-refresh` arm reads and would spend at Atlassian.
   * A miss for the wrong provider is therefore a `null` that leaves the legacy
   * record exactly where it is.
   *
   * ### Why migrate-on-read rather than read-through (LIN-1887 N3)
   *
   * A read that fell back to the 2-part id while `putIfRefreshToken` wrote the
   * 3-part id would leave the CAS witness and the read id pointing at different
   * documents, so the compare-and-set would miss **forever** — a silent,
   * permanent failure. Copying the record to the partitioned id first means
   * every downstream reader and the CAS only ever see one id. Concurrent
   * migrators write identical content to the same id, so it is idempotent; a
   * failed delete degrades to a harmless stale record the next read re-migrates.
   *
   * @param {string} accountId
   * @param {string} urlKey - the workspace urlKey
   * @param {string} [provider] - the credential's provider; legacy-normalized to `'linear'`
   * @returns {Promise<Object|null>} the stored record, or null if not found
   */
  async get(accountId, urlKey, provider) {
    if (!accountId || !urlKey) {
      console.warn('OwnerCredentialStore.get called without accountId/urlKey');
      return null;
    }
    const partition = normalizeProviderName(provider);

    try {
      const doc = await this.collection.findOne({ _id: this._id(accountId, urlKey, partition) });
      if (doc) return doc;

      const legacy = await this.collection.findOne({ _id: this._legacyId(accountId, urlKey) });
      if (!legacy) return null;
      // G1: the legacy record belongs to exactly ONE provider. Anyone else
      // asking must miss, and must leave it untouched.
      if (normalizeProviderName(legacy.provider) !== partition) return null;

      return await this._migrateLegacy(accountId, urlKey, partition, legacy);
    } catch (err) {
      console.error('Error fetching owner credential:', err);
      return null;
    }
  }

  /**
   * Copy a legacy 2-part record onto its partitioned id and best-effort drop the
   * legacy one. Returns the record as it now lives at the partitioned id.
   *
   * The delete is deliberately non-fatal: a migrated-but-not-deleted record is
   * shadowed by the partitioned copy on every subsequent read (the partitioned
   * `findOne` runs first), so the worst case is a re-migration, never a wrong
   * answer.
   */
  async _migrateLegacy(accountId, urlKey, partition, legacy) {
    const { _id: _legacy, ...fields } = legacy;
    // `_id` is immutable in Mongo, so it is the FILTER, never part of `$set`.
    const partitionedId = this._id(accountId, urlKey, partition);
    const set = { ...fields, provider: partition };
    const migrated = { ...set, _id: partitionedId };
    await this.collection.updateOne(
      { _id: partitionedId },
      { $set: set },
      { upsert: true }
    );
    try {
      await this.collection.deleteOne({ _id: this._legacyId(accountId, urlKey) });
    } catch (err) {
      console.error('Error removing migrated legacy owner credential:', err);
    }
    return migrated;
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
   * LIN-1887: the record's own `provider` selects the partition, so the write
   * cannot land in one partition while claiming to be another.
   *
   * @param {string} accountId
   * @param {string} urlKey - the workspace urlKey
   * @param {Object} credential
   * @param {string} [credential.provider] - defaults to 'linear'; ALSO selects the `_id` partition
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
      const { scope, token, refreshToken, tokenExpiresAt } = credential;
      const provider = normalizeProviderName(credential.provider);
      await this.collection.updateOne(
        { _id: this._id(accountId, urlKey, provider) },
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
   * Optimistic compare-and-set write, keyed on the CURRENT `refreshToken`
   * (LIN-1546, S3). Writes `next` ONLY if the stored record's `refreshToken`
   * still equals `expectedRefreshToken` — the value a refresh entrant read
   * before it spent that token against Linear. If the stored value no longer
   * matches (a concurrent rotation winner already rotated it, an OAuth
   * re-login replaced the record, or the record is gone), the write is skipped
   * so the winner's healthy credential is never clobbered, and `false` is
   * returned so the caller can re-read and converge on whatever is durably
   * stored now.
   *
   * Reuses the in-repo optimistic-CAS idiom already shipping at
   * `lib/dispatch-store.js`'s terminal-wake election (LIN-1343/1357): a single
   * conditional `updateOne(filter-including-the-CAS-field, $set)` gated on
   * `matchedCount === 1`, MongoDB+MangoDB-proven — NOT a
   * `countDocuments`/`deleteOne` check (which MangoDB may not support). No
   * upsert: a missing or mismatched record must never create or overwrite one,
   * it must miss.
   *
   * Value-comparison on the plaintext `refreshToken` is valid while the
   * credential is stored in plaintext (see the module header — LIN-1522 owns
   * at-rest encryption/retention). If LIN-1522 lands NON-deterministic
   * encryption that breaks value-equality on `refreshToken`, this CAS field
   * must move to a monotonic `rev` stamp; the choice is deliberately localised
   * to this one method so that swap stays a single-site change.
   *
   * Preserves the store's conventions verbatim: guards on
   * `accountId`/`urlKey`, never throws (a caught error returns `false`), and a
   * miss is a distinguishable `false` (not a throw), safe for the caller to
   * re-read. Additive — `put` (the unconditional upsert) is unchanged, and a
   * caller with no concurrency concern keeps using it.
   *
   * @param {string} accountId
   * @param {string} urlKey - the workspace urlKey
   * @param {string} expectedRefreshToken - the refreshToken the caller expects to still be stored (the CAS witness)
   * @param {Object} next - the full credential to write on a CAS win (same shape as {@link put}'s `credential`)
   * @returns {Promise<boolean>} true iff the CAS matched and the write landed; false on a lost race, a missing record, a missing accountId/urlKey/expectedRefreshToken, or an error
   */
  async putIfRefreshToken(accountId, urlKey, expectedRefreshToken, next = {}) {
    if (!accountId || !urlKey) {
      console.warn('OwnerCredentialStore.putIfRefreshToken called without accountId/urlKey');
      return false;
    }
    // A CAS with no witness can't distinguish "matches an absent/empty field"
    // from "matches a real token" — refuse it as a safe miss rather than risk
    // an unconditional write masquerading as a compare-and-set.
    if (!expectedRefreshToken) {
      console.warn('OwnerCredentialStore.putIfRefreshToken called without expectedRefreshToken');
      return false;
    }

    try {
      const now = new Date();
      const { scope, token, refreshToken, tokenExpiresAt } = next;
      const provider = normalizeProviderName(next.provider);
      const { matchedCount } = await this.collection.updateOne(
        { _id: this._id(accountId, urlKey, provider), refreshToken: expectedRefreshToken },
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
          }
        }
      );
      return matchedCount === 1;
    } catch (err) {
      console.error('Error in owner credential compare-and-set:', err);
      return false;
    }
  }

  /**
   * Updates a subset of credential fields, preserving sibling fields —
   * read-merge, mirroring `setOpenRouterApiKey` (`lib/user-preferences.js:160-161`).
   *
   * LIN-1887: `provider` is explicit here because it selects the partition to
   * read from; the merged write then re-derives the same partition from the
   * record's own `provider` field.
   *
   * @param {string} accountId
   * @param {string} urlKey - the workspace urlKey
   * @param {string} [provider] - the credential's provider; legacy-normalized to `'linear'`
   * @param {Object} fields - partial credential fields to merge in
   * @returns {Promise<boolean>} true if the write succeeded
   */
  async patch(accountId, urlKey, provider, fields = {}) {
    if (!accountId || !urlKey) {
      console.warn('OwnerCredentialStore.patch called without accountId/urlKey');
      return false;
    }
    const partition = normalizeProviderName(provider);
    const existing = await this.get(accountId, urlKey, partition);
    return this.put(accountId, urlKey, { ...existing, ...fields, provider: partition });
  }

  /**
   * Deletes ONE provider's durable credential for an (account, workspace) pair.
   * No-op (never throws) when no record exists — mirrors the `null`-on-missing /
   * no-throw convention for the delete path.
   *
   * LIN-1887: this is the PER-PARTITION delete. A caller that is tearing down
   * the whole workspace — rather than revoking one binding or reacting to one
   * provider's refresh failure — wants {@link OwnerCredentialStore#deleteAll};
   * a partition-scoped delete there silently orphans every other provider's
   * credential for a workspace that no longer exists.
   *
   * @param {string} accountId
   * @param {string} urlKey - the workspace urlKey
   * @param {string} [provider] - the credential's provider; legacy-normalized to `'linear'`
   * @returns {Promise<boolean>} true if the call completed (whether or not a record existed)
   */
  async delete(accountId, urlKey, provider) {
    if (!accountId || !urlKey) {
      console.warn('OwnerCredentialStore.delete called without accountId/urlKey');
      return false;
    }

    try {
      await this.collection.deleteOne({ _id: this._id(accountId, urlKey, provider) });
      return true;
    } catch (err) {
      console.error('Error deleting owner credential:', err);
      return false;
    }
  }

  /**
   * Deletes EVERY provider partition for an (account, workspace) pair — the
   * whole-workspace teardown verb (LIN-1887 N2).
   *
   * Filters on the `accountId`/`urlKey` FIELDS rather than an `_id` prefix or a
   * hard-coded provider census: both are carried on every record by `put`, and
   * the alternatives are worse — an `_id` regex is a scan with a fragile
   * pattern, and enumerating known providers silently misses whichever one is
   * added next, which is precisely the failure mode this verb exists to
   * prevent. The filter also matches a not-yet-migrated legacy 2-part record,
   * so a workspace removed before its credential was ever read leaves nothing
   * behind.
   *
   * This is the store's ONLY non-`_id` query. It is a delete on a tiny
   * collection (one record per account × workspace × provider) on the rare
   * teardown path, so `lib/db-indexes.js`'s "deliberately NOT indexed" entry —
   * which is about the READ path being a pure `_id` point read — still holds.
   *
   * @param {string} accountId
   * @param {string} urlKey - the workspace urlKey
   * @returns {Promise<boolean>} true if the call completed (whether or not any record existed)
   */
  async deleteAll(accountId, urlKey) {
    if (!accountId || !urlKey) {
      console.warn('OwnerCredentialStore.deleteAll called without accountId/urlKey');
      return false;
    }

    try {
      await this.collection.deleteMany({ accountId, urlKey });
      return true;
    } catch (err) {
      console.error('Error deleting owner credentials:', err);
      return false;
    }
  }
}
