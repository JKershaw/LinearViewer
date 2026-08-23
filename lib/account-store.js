/**
 * Account store: the durable, human-tied account record (LIN-1327, Phase A of
 * LIN-1326). Linear/GitHub/email are login identities ATTACHED to an account,
 * not the account itself — this store is where that distinction becomes real.
 *
 * Schema (one document per account):
 * {
 *   _id:        string,   // accountId — Harbour-minted randomUUID() (routes/workspace.js:85 makes the same move for local workspaces)
 *   identities: [ { provider, scope, credentials } ],   // LIN-562 binding shape (lib/workspace.js), reused verbatim
 *   createdAt:  Date,
 *   updatedAt:  Date
 * }
 *
 * `linkIdentity` returns an explicit result instead of throwing:
 *
 *   - identity already attached to a DIFFERENT account -> `{ ok: false, conflict: { accountId } }`,
 *     no mutation on either side (strict, no auto-merge — LIN-1326 is settled on this).
 *   - identity already attached to THIS account -> idempotent re-link: credentials merge in place.
 *   - identity not attached anywhere -> attached fresh.
 *   - unknown accountId -> `{ ok: false, reason: 'unknown-account' }`.
 *
 * Identity lookup keys on `(provider, scope)` via `$elemMatch`, NOT a dotted-path
 * query (`{'identities.provider': p, 'identities.scope': s}`), which can match
 * `provider` from one array element against `scope` from a different one —
 * producing a false conflict and breaking the "same provider, two scopes, one
 * account" case (e.g. a GitHub issues binding + a GitHub Projects binding).
 *
 * LIN-1338: the write path is NOT the `linkProvider` (lib/workspace.js)
 * find-index/merge/push-or-replace shape any more — that whole-array `$set`
 * was a check-then-write race (two different accounts could both pass the
 * `$elemMatch` pre-check and both commit) AND a lost-update clobber
 * (two different identities linked to the SAME account concurrently could
 * overwrite each other, snapshot-reconstructed from a stale read). The
 * pre-check is retained (it produces the conflict *signal* and is the only
 * thing that's multikey-correct on both MongoDB and MangoDB), but the write
 * itself is now a guarded `$push` (same-account merges go through
 * `arrayFilters` instead of an array rewrite) plus a caught `E11000` against
 * the `accounts_identity_unique` index (lib/db-indexes.js) — the index is
 * the only enforcer of cross-document uniqueness, not a backstop, since this
 * invariant has no single-document atomic expression and transactions are
 * unavailable (standalone CI Mongo, no MangoDB session API).
 *
 * Phase A only: this store is constructed in server.js but wired to NO route —
 * auth-path wiring is LIN-1329 (Phase C).
 */

import { randomUUID } from 'crypto';

export class AccountStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Mint a new, identity-less account.
   * @returns {Promise<Object>} the created account document
   */
  async createAccount() {
    const now = new Date();
    const account = {
      _id: randomUUID(),
      identities: [],
      createdAt: now,
      updatedAt: now
    };
    await this.collection.insertOne(account);
    return account;
  }

  /**
   * Fetch an account by its accountId, or null.
   * @param {string} accountId
   * @returns {Promise<Object|null>}
   */
  async getAccount(accountId) {
    if (!accountId) return null;
    return this.collection.findOne({ _id: accountId });
  }

  /**
   * Find the account (if any) with an identity matching `(provider, scope)`.
   * Uses `$elemMatch` so both fields must match on the SAME array element.
   * @param {string} provider
   * @param {string} scope
   * @returns {Promise<Object|null>}
   */
  async findAccountByIdentity(provider, scope) {
    return this.collection.findOne({
      identities: { $elemMatch: { provider, scope } }
    });
  }

  /**
   * Attach (or re-attach) a `(provider, scope)` identity to an account — the
   * single seam every auth path will converge on in Phase C.
   *
   * @param {string} accountId
   * @param {string} provider
   * @param {string} scope
   * @param {Object} [credentials={}]
   * @returns {Promise<{ok: true, account: Object}|{ok: false, conflict: {accountId: string}}|{ok: false, reason: string}>}
   */
  async linkIdentity(accountId, provider, scope, credentials = {}) {
    const account = await this.getAccount(accountId);
    if (!account) return { ok: false, reason: 'unknown-account' };

    const owner = await this.findAccountByIdentity(provider, scope);
    if (owner && owner._id !== accountId) {
      return { ok: false, conflict: { accountId: owner._id } };
    }
    if (owner && owner._id === accountId) {
      return this._mergeIdentity(accountId, provider, scope, credentials);
    }

    // No owner yet anywhere (per the pre-check) — push, guarded so an
    // intra-document duplicate (a concurrent call that landed on THIS
    // account between the pre-check and here) can't slip in as a second
    // array element.
    try {
      const { matchedCount } = await this.collection.updateOne(
        { _id: accountId, identities: { $not: { $elemMatch: { provider, scope } } } },
        {
          $push: { identities: { provider, scope, credentials } },
          $set: { updatedAt: new Date() }
        }
      );
      if (matchedCount === 0) {
        // Raced onto this same account since the pre-check — merge instead
        // of attempting a second push.
        return this._mergeIdentity(accountId, provider, scope, credentials);
      }
    } catch (err) {
      if (err.code !== 11000) throw err;
      // Another account won the race for this identity between the
      // pre-check and this write. The `accounts_identity_unique` index
      // (lib/db-indexes.js) is the only cross-document enforcer of this
      // invariant, so a caught duplicate key IS the primary mechanism here,
      // not a fallback — re-read through the same `$elemMatch` lookup the
      // sequential path uses, so both routes return a byte-identical signal.
      const conflictOwner = await this.findAccountByIdentity(provider, scope);
      if (conflictOwner && conflictOwner._id !== accountId) {
        return { ok: false, conflict: { accountId: conflictOwner._id } };
      }
      return this._mergeIdentity(accountId, provider, scope, credentials);
    }

    return { ok: true, account: await this.getAccount(accountId) };
  }

  /**
   * Delete an account outright. Used to clean up a zero-identity orphan left
   * behind when a mint-then-link race is lost (LIN-1329 `establishAccount`) —
   * never called against an account that has any linked identity.
   * @param {string} accountId
   * @returns {Promise<void>}
   */
  async deleteAccount(accountId) {
    await this.collection.deleteOne({ _id: accountId });
  }

  /**
   * Merge credentials into an identity already attached to this account, in
   * place via `arrayFilters` — never a whole-array rewrite, so a concurrent
   * link of a DIFFERENT identity to the same account can't be clobbered by
   * this write. Last-writer-wins on the credentials of the SAME identity
   * under concurrent re-links, unchanged from prior behaviour and semantically
   * correct (the newest token wins).
   * @param {string} accountId
   * @param {string} provider
   * @param {string} scope
   * @param {Object} credentials
   * @returns {Promise<{ok: true, account: Object}>}
   */
  async _mergeIdentity(accountId, provider, scope, credentials) {
    const account = await this.getAccount(accountId);
    const existing = (account?.identities || []).find(
      i => i.provider === provider && i.scope === scope
    );
    const merged = { ...(existing?.credentials || {}), ...credentials };

    await this.collection.updateOne(
      { _id: accountId },
      { $set: { 'identities.$[e].credentials': merged, updatedAt: new Date() } },
      { arrayFilters: [{ 'e.provider': provider, 'e.scope': scope }] }
    );

    return { ok: true, account: await this.getAccount(accountId) };
  }

  /**
   * Merge `mergedId` into `canonicalId` (LIN-2233, L2.2 of the LIN-2231
   * design) — an ALIAS, never a migration:
   *
   *   - Writes `mergedInto: canonicalId` onto the merged account's document.
   *     Permanent and one-way — never reassigned once set. A merge of an
   *     already-merged account is refused here (chain resolution through
   *     `mergedInto` is Ticket B's `resolveCanonicalAccountId`, not a write
   *     concern of this method).
   *   - Re-binds every `accountWorkspaceStore` edge the merged account held
   *     onto the canonical account — additive/idempotent, so the merged
   *     account's own edges are never removed (audit history stays intact).
   *   - Never touches `identities[]`, `owner-credentials`, or per-account
   *     content stores (saved chats, preferences, north-star, quota) — zero
   *     data migration risk. Callers needing those to resolve through the
   *     canonical account go through Ticket B's chokepoint instead.
   *   - Durably logged via `mergeLogStore` (when supplied) — a merge is rare
   *     and high-consequence, so its record must outlive Railway's rolling
   *     log window, not ride along as a console.log.
   *
   * @param {string} canonicalId - the account that absorbs `mergedId`; stays live in the confirming session
   * @param {string} mergedId - the account being merged in
   * @param {Object} [options]
   * @param {import('./account-workspace-store.js').AccountWorkspaceStore} [options.accountWorkspaceStore] - when supplied, re-binds the merged account's workspace edges
   * @param {import('./account-merge-log.js').AccountMergeLogStore} [options.mergeLogStore] - when supplied, durably logs the merge
   * @returns {Promise<{ok: true, account: Object, alreadyMerged?: true}|{ok: false, reason: string, mergedInto?: string}>}
   */
  async mergeAccounts(canonicalId, mergedId, { accountWorkspaceStore, mergeLogStore } = {}) {
    if (!canonicalId || !mergedId) return { ok: false, reason: 'missing-id' };
    if (canonicalId === mergedId) return { ok: false, reason: 'self-merge' };

    const [canonical, merged] = await Promise.all([
      this.getAccount(canonicalId),
      this.getAccount(mergedId)
    ]);
    if (!canonical) return { ok: false, reason: 'unknown-canonical' };
    if (!merged) return { ok: false, reason: 'unknown-merged' };

    if (merged.mergedInto) {
      // Idempotent no-op if this exact merge already happened; refuse (rather
      // than silently re-point) if it was already merged somewhere else —
      // `mergedInto` is permanent once set.
      if (merged.mergedInto === canonicalId) {
        return { ok: true, account: merged, alreadyMerged: true };
      }
      return { ok: false, reason: 'already-merged', mergedInto: merged.mergedInto };
    }

    await this.collection.updateOne(
      { _id: mergedId },
      { $set: { mergedInto: canonicalId, updatedAt: new Date() } }
    );

    let workspaceIds = [];
    if (accountWorkspaceStore) {
      workspaceIds = await accountWorkspaceStore.listWorkspacesForAccount(mergedId);
      for (const workspaceId of workspaceIds) {
        await accountWorkspaceStore.bindAccountToWorkspace(canonicalId, workspaceId);
      }
    }

    if (mergeLogStore) {
      await mergeLogStore.recordMerge({ canonicalId, mergedId, workspaceIds });
    }

    return { ok: true, account: await this.getAccount(mergedId) };
  }

  /**
   * Resolve `accountId` to its canonical form (LIN-2234, L3 of the LIN-2231
   * design) — the runtime-resolution counterpart to `mergeAccounts`' write.
   * Walks `mergedInto` edges to a fixed point:
   *
   *   - `null`/falsy `accountId` -> `null` immediately, no lookup at all.
   *     This is deliberate, not merely convenient: constraint 2 (null-owner
   *     fail-closed) and the `UNSCOPED` sentinel (a caller-side concept this
   *     store knows nothing about) both depend on canonicalization being a
   *     no-op for a falsy id, never a lookup that could turn `null` into a
   *     real account id.
   *   - A non-merged (or unknown) account resolves to itself — `mergeAccounts`
   *     only ever creates edges FROM the merged side, so "no `mergedInto`
   *     found" is the ordinary terminal case, not an error.
   *   - `mergedInto` may itself point at an account that was LATER merged
   *     again (e.g. X merged into Y, then Y merged into Z) — walked to its
   *     fixed point, not just one hop.
   *   - Depth-capped at `maxDepth`: `mergeAccounts` refuses to create a cycle
   *     through its own write path (merging into an already-merged account is
   *     rejected there), so a cycle here means the data is corrupt, not that
   *     traversal took a wrong turn. Failing loud (throwing) surfaces that in
   *     tests/logs instead of hanging a production request forever.
   *
   * @param {string|null|undefined} accountId
   * @param {number} [maxDepth=8] - safety bound on `mergedInto` hops before this throws
   * @returns {Promise<string|null>}
   */
  async resolveCanonicalAccountId(accountId, maxDepth = 8) {
    if (!accountId) return null;

    let current = accountId;
    const visited = new Set([current]);
    for (let hop = 0; hop < maxDepth; hop++) {
      const account = await this.getAccount(current);
      if (!account || !account.mergedInto) return current;
      if (visited.has(account.mergedInto)) {
        throw new Error(`resolveCanonicalAccountId: cycle detected resolving ${accountId} (mergedInto loops back to ${account.mergedInto})`);
      }
      current = account.mergedInto;
      visited.add(current);
    }
    throw new Error(`resolveCanonicalAccountId: exceeded maxDepth=${maxDepth} resolving ${accountId} — likely a corrupt mergedInto chain`);
  }
}
