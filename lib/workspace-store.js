/**
 * Workspace store: the durable workspace record (LIN-1328, Phase B of
 * LIN-1326). Today a `Workspace` (lib/workspace.js) lives only inside the
 * Express session, on the session collection's rolling 30-day TTL — this
 * store is where it gets a durable home.
 *
 * Schema (one document per workspace):
 * {
 *   _id:       string,   // workspace.id — the model's existing identity (lib/workspace.js:86,104)
 *   urlKey:    string,   // separate indexed lookup field; every existing side table joins on it
 *   bindings:  ProviderBinding[],   // LIN-562 shape ({provider, scope, credentials}), carried over intact
 *   ...        // the rest of the existing Workspace shape (lib/workspace.js), stored as-is
 *   createdAt: Date,
 *   updatedAt: Date
 * }
 *
 * Mirrors `lib/account-store.js` (Phase A) conventions: class +
 * `constructor({collection})`, explicit result objects for failure-bearing
 * operations, plain `null` for missing point reads, no throws.
 *
 * Phase B only: this store is constructed in server.js but wired to NO route
 * and NO session read site — the cutover is LIN-1330 (Phase D). The durable
 * collection and the session blob intentionally coexist until then.
 */

export class WorkspaceStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Persist a new durable workspace record.
   * @param {import('./workspace.js').Workspace} workspace - The workspace shape to store, `bindings[]` intact.
   * @returns {Promise<Object>} the created document
   */
  async createWorkspace(workspace) {
    const now = new Date();
    const doc = {
      ...workspace,
      _id: workspace.id,
      createdAt: now,
      updatedAt: now
    };
    await this.collection.insertOne(doc);
    return doc;
  }

  /**
   * Fetch a workspace by its id, or null.
   * @param {string} workspaceId
   * @returns {Promise<Object|null>}
   */
  async getWorkspace(workspaceId) {
    if (!workspaceId) return null;
    return this.collection.findOne({ _id: workspaceId });
  }

  /**
   * Fetch a workspace by its urlKey, or null.
   * @param {string} urlKey
   * @returns {Promise<Object|null>}
   */
  async getWorkspaceByUrlKey(urlKey) {
    if (!urlKey) return null;
    return this.collection.findOne({ urlKey });
  }

  /**
   * Merge-update an existing durable workspace record.
   * @param {string} workspaceId
   * @param {Object} patch - Fields to merge over the existing document.
   * @returns {Promise<{ok: true, workspace: Object}|{ok: false, reason: string}>}
   */
  async updateWorkspace(workspaceId, patch = {}) {
    const existing = await this.getWorkspace(workspaceId);
    if (!existing) return { ok: false, reason: 'unknown-workspace' };

    const updatedAt = new Date();
    const updated = { ...existing, ...patch, _id: existing._id, updatedAt };
    await this.collection.updateOne(
      { _id: workspaceId },
      { $set: { ...patch, updatedAt } }
    );

    return { ok: true, workspace: updated };
  }
}
