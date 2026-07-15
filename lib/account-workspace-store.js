/**
 * Account↔workspace store: the explicit many-to-many membership association
 * (LIN-1328, Phase B of LIN-1326). This is the FIRST membership record — not
 * a second representation of one. Per-(human, workspace) *settings/content*
 * already exist elsewhere (lib/user-preferences.js's
 * selectedTeamByWorkspace/northStarByWorkspace, lib/saved-chat-store.js), but
 * those are settings, not membership; re-keying them is LIN-1330 (Phase D).
 *
 * Schema (one document per account↔workspace edge, its own collection):
 * {
 *   _id:         string,   // randomUUID()
 *   accountId:   string,
 *   workspaceId: string,
 *   createdAt:   Date
 * }
 *
 * Deliberately NOT embedded as an array on either the account or workspace
 * document — an explicit standalone association, per LIN-1326's settled
 * many-to-many decision. Deliberately carries NO credentials — credential
 * placement is Phase E; putting them on this edge would pre-decide it.
 *
 * The unique `{accountId, workspaceId}` index (lib/db-indexes.js) is a
 * BACKSTOP, not an invariant — `ensureIndexes` treats a unique build failure
 * as non-fatal, so re-bind idempotency is enforced here via check-then-insert,
 * mirroring `lib/account-store.js`'s `linkIdentity` idempotency.
 *
 * Phase B only: constructed in server.js but wired to NO route until LIN-1329
 * (Phase C) wires auth to write it.
 */

import { randomUUID } from 'crypto';

export class AccountWorkspaceStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Bind an account to a workspace. Idempotent: re-binding the same pair
   * leaves exactly one edge document. Atomic upsert on `{accountId,
   * workspaceId}`, not check-then-insert (LIN-1337): with the unique backstop
   * index present, concurrent binds for the same pair raced past
   * check-then-insert's read and both attempted the insert, throwing E11000
   * at the caller instead of just risking a duplicate. `_id: randomUUID()`
   * stays IN `$setOnInsert` (unlike `createWorkspace`'s `_id`, which is
   * caller-supplied and must stay out) so the returned edge's key set is
   * still exactly `{_id, accountId, workspaceId, createdAt}`.
   * @param {string} accountId
   * @param {string} workspaceId
   * @returns {Promise<Object>} the edge document (existing or newly created)
   */
  async bindAccountToWorkspace(accountId, workspaceId) {
    return this.collection.findOneAndUpdate(
      { accountId, workspaceId },
      {
        $setOnInsert: {
          _id: randomUUID(),
          accountId,
          workspaceId,
          createdAt: new Date()
        }
      },
      { upsert: true, returnDocument: 'after' }
    );
  }

  /**
   * Remove the edge between an account and a workspace, if any. Leaves every
   * other edge (on either side) untouched.
   * @param {string} accountId
   * @param {string} workspaceId
   * @returns {Promise<void>}
   */
  async unbindAccountFromWorkspace(accountId, workspaceId) {
    await this.collection.deleteMany({ accountId, workspaceId });
  }

  /**
   * List every workspaceId bound to an account.
   * @param {string} accountId
   * @returns {Promise<string[]>}
   */
  async listWorkspacesForAccount(accountId) {
    const edges = await this.collection.find({ accountId }).toArray();
    return edges.map(e => e.workspaceId);
  }

  /**
   * List every accountId bound to a workspace.
   * @param {string} workspaceId
   * @returns {Promise<string[]>}
   */
  async listAccountsForWorkspace(workspaceId) {
    const edges = await this.collection.find({ workspaceId }).toArray();
    return edges.map(e => e.accountId);
  }
}
