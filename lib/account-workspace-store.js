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
 *   createdAt:   Date,
 *   role?:       'owner'   // LIN-1892: only on a workspace's first edge; absent = plain membership
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
    this.logger = options.logger || console;
  }

  /**
   * Bind an account to a workspace. Idempotent: re-binding the same pair
   * leaves exactly one edge document. Atomic upsert on `{accountId,
   * workspaceId}`, not check-then-insert (LIN-1337): with the unique backstop
   * index present, concurrent binds for the same pair raced past
   * check-then-insert's read and both attempted the insert, throwing E11000
   * at the caller instead of just risking a duplicate. `_id` stays IN
   * `$setOnInsert` (unlike `createWorkspace`'s `_id`, which is
   * caller-supplied and must stay out) so a plain edge's key set is still
   * exactly `{_id, accountId, workspaceId, createdAt}`.
   *
   * Owner mark (LIN-1892 S1): the `_id` is generated up front, so
   * `edge._id === newId` means this call inserted the edge (a pre-existing
   * edge always carries its own, different `_id`). Only an inserted edge that
   * is also the workspace's FIRST edge, by `(createdAt, _id)`, gets
   * `role: 'owner'`. A workspace bound before S1 therefore never gains an
   * owner here: a new member's edge is an insert but not the first edge.
   * Existing edges are never touched.
   *
   * The `account_workspaces_one_owner` partial unique index
   * (lib/db-indexes.js) is what keeps concurrent first binders to one owner:
   * a losing mark throws E11000, which is swallowed and leaves that edge
   * plain. Any other failure of the mark is logged and swallowed too. That
   * workspace then stays owner-less for good (the crash gap): later binds are
   * not its first edge and re-binds are not inserts. This is deliberate,
   * because from the edges alone it can't be told apart from a pre-S1
   * workspace. The ownership dry-run surfaces such workspaces instead.
   * @param {string} accountId
   * @param {string} workspaceId
   * @returns {Promise<Object>} the edge document as it stands after the owner step (existing or newly created)
   */
  async bindAccountToWorkspace(accountId, workspaceId) {
    const newId = randomUUID();
    const edge = await this.collection.findOneAndUpdate(
      { accountId, workspaceId },
      {
        $setOnInsert: {
          _id: newId,
          accountId,
          workspaceId,
          createdAt: new Date()
        }
      },
      { upsert: true, returnDocument: 'after' }
    );
    if (!edge || edge._id !== newId) return edge;

    const marked = await this._markOwnerIfFirstEdge(newId, workspaceId);
    return marked ? { ...edge, role: 'owner' } : edge;
  }

  /**
   * Mark a just-inserted edge as its workspace's owner, if it is the
   * workspace's first edge. Never throws: see `bindAccountToWorkspace`.
   * @param {string} edgeId - the `_id` this call just inserted
   * @param {string} workspaceId
   * @returns {Promise<boolean>} whether the mark landed
   */
  async _markOwnerIfFirstEdge(edgeId, workspaceId) {
    try {
      const first = await this.collection.findOne({ workspaceId }, { sort: { createdAt: 1, _id: 1 } });
      if (!first || first._id !== edgeId) return false;
      const result = await this.collection.updateOne(
        { _id: edgeId, role: { $exists: false } },
        { $set: { role: 'owner' } }
      );
      return result.modifiedCount === 1;
    } catch (err) {
      // A concurrent first binder's mark won the owner index.
      if (err.code === 11000) return false;
      this.logger.error(`[account-workspace-store] owner mark failed for workspace ${workspaceId}, edge ${edgeId}; the workspace stays owner-less: ${err.message}`);
      return false;
    }
  }

  /**
   * The workspace's owner account (LIN-1892), canonicalised through
   * `resolveCanonicalAccountId`, so an owner merged away resolves to its
   * survivor. `null` when the workspace has no owner edge (every workspace
   * bound before S1, and any crash-gap workspace).
   *
   * - Realises Decision 3's `ownerAccountId`. The name deliberately differs
   *   from the credential-scope `ownerAccountId` (owner-credentials), which is
   *   an unrelated concept.
   * - The owner is the `role: 'owner'` edge; an absent `role` is plain
   *   membership. The edge carries no credential.
   * - A shared Linear-org workspace's owner is its first connector (LIN-1892
   *   N12): its id is the org id, so whoever binds it first owns it.
   * - Intended consumer: this is Decision 3's read seam for LIN-2883
   *   (machines) and workspace sharing. LIN-1892 adds no production caller;
   *   its tests pin the behaviour.
   * @param {string} workspaceId
   * @param {import('./account-store.js').AccountStore} accountStore - resolves the owner through `mergedInto`
   * @returns {Promise<string|null>}
   */
  async getWorkspaceOwnerAccountId(workspaceId, accountStore) {
    const owner = await this.collection.findOne({ workspaceId, role: 'owner' });
    if (!owner) return null;
    return accountStore.resolveCanonicalAccountId(owner.accountId);
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

  /**
   * List every account↔workspace edge in the collection (LIN-2236, L5.4's
   * startup/periodic invariant sweep: "each live account↔workspace edge
   * resolves to a durable credential record"). A full scan, not an
   * indexed query — this store is sized by membership count, not request
   * volume, and the sweep that consumes this runs on a multi-minute cadence,
   * never per-request (see lib/credential-invariant-sweep.js).
   * @returns {Promise<{accountId: string, workspaceId: string}[]>}
   */
  async listAllEdges() {
    const edges = await this.collection.find({}).toArray();
    return edges.map(e => ({ accountId: e.accountId, workspaceId: e.workspaceId }));
  }
}
