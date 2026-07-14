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
 * `linkIdentity` mirrors `linkProvider` (lib/workspace.js) — the same
 * find-index / merge-credentials / push-or-replace shape — but persists to a
 * durable collection instead of mutating an in-session object, and returns an
 * explicit result instead of throwing:
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

    const identities = account.identities || [];
    const index = identities.findIndex(i => i.provider === provider && i.scope === scope);
    const merged = { ...(index >= 0 ? identities[index].credentials : {}), ...credentials };
    const identity = { provider, scope, credentials: merged };
    if (index >= 0) identities[index] = identity;
    else identities.push(identity);

    const updatedAt = new Date();
    await this.collection.updateOne(
      { _id: accountId },
      { $set: { identities, updatedAt } }
    );

    return { ok: true, account: { ...account, identities, updatedAt } };
  }
}
