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
   * Persist a new durable workspace record. Atomic upsert on the
   * caller-supplied `workspace.id`, not check-then-insert: two concurrent
   * creates for the same id must produce exactly one winner with no
   * unhandled duplicate-key throw, which a check-then-insert can't guarantee
   * (LIN-1337). `_id` is deliberately kept OUT of `$setOnInsert` — MongoDB
   * rejects an attempt to modify the immutable `_id` field via update — and
   * lives only in the filter. `returnDocument: 'before'` is what preserves
   * the existing W2 contract: `null` means this call created the document,
   * a non-null pre-image means a prior document already existed and this
   * call must not overwrite it. `insertFields` spreads `workspace` as-is
   * (its own `id` included) rather than destructuring `id` out: `_id` and
   * `id` are distinct field names, so keeping `id` in the doc alongside
   * `_id` isn't the immutable-field conflict `_id` itself would be — and
   * matches the pre-LIN-1337 persisted shape (`{...workspace, _id, ...}`)
   * that callers reading `.id` off a fetched workspace still rely on.
   * @param {import('./workspace.js').Workspace} workspace - The workspace shape to store, `bindings[]` intact.
   * @returns {Promise<{ok: true, workspace: Object}|{ok: false, reason: string}>}
   */
  async createWorkspace(workspace) {
    const now = new Date();
    // Everything lives in $setOnInsert, including createdAt/updatedAt: on a
    // losing concurrent call (the doc already exists) this must be a no-op,
    // never touch the existing document's fields.
    const insertFields = { ...workspace, createdAt: now, updatedAt: now };

    const before = await this.collection.findOneAndUpdate(
      { _id: workspace.id },
      { $setOnInsert: insertFields },
      { upsert: true, returnDocument: 'before' }
    );

    if (before) return { ok: false, reason: 'workspace-exists' };
    return { ok: true, workspace: { ...insertFields, _id: workspace.id } };
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
   * Merge-update an existing durable workspace record. Identity fields
   * (`_id`, `createdAt`) are stripped from the patch before it reaches the
   * write — not just the returned object — so a caller can never hijack a
   * record's identity or backdate its creation via `updateWorkspace`.
   * @param {string} workspaceId
   * @param {Object} patch - Fields to merge over the existing document.
   * @returns {Promise<{ok: true, workspace: Object}|{ok: false, reason: string}>}
   */
  async updateWorkspace(workspaceId, patch = {}) {
    const existing = await this.getWorkspace(workspaceId);
    if (!existing) return { ok: false, reason: 'unknown-workspace' };

    const { _id, createdAt, ...safePatch } = patch;
    const updatedAt = new Date();
    await this.collection.updateOne(
      { _id: workspaceId },
      { $set: { ...safePatch, updatedAt } }
    );

    // Re-read the persisted document rather than returning a JS-merged
    // reconstruction: for a dotted-path patch (e.g. {'prefs.theme': 'dark'}),
    // a naive `{...existing, ...safePatch}` merge produces a literal
    // "prefs.theme" key while Mongo's $set correctly nests it — the write
    // was always right, only the old return value lied (LIN-1337).
    return { ok: true, workspace: await this.getWorkspace(workspaceId) };
  }
}
