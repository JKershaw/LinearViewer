/**
 * Workspace halt store (LIN-2994/LIN-3023) — the durable operator pause/stop
 * flag for a workspace, keyed by `urlKey`. Nothing consumes this store yet;
 * it is Surface 1 of 5 and is wired additively only.
 *
 * Unlike `getWorkspacePreferences` (`lib/workspace-preferences.js:77-90`),
 * which swallows collection errors and falls back to `{}`, none of this
 * store's three methods catches. Errors propagate by design: the poll/take/
 * dashboard surfaces that will eventually call this store decide how to
 * degrade on failure, not the store itself.
 *
 * Schema (one document per urlKey):
 * {
 *   _id:   string,               // urlKey
 *   mode:  'pause' | 'stop',
 *   setAt: Date,
 *   setBy: string
 * }
 */
export class WorkspaceHaltStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * @param {string} urlKey
   * @returns {Promise<Object|null>} the halt document, or null when unset.
   */
  async getWorkspaceHalt(urlKey) {
    return this.collection.findOne({ _id: urlKey });
  }

  /**
   * Upsert the halt for a workspace. Last write wins: a second call replaces
   * `mode`/`setAt`/`setBy` in full, since the document holds nothing else.
   *
   * @param {string} urlKey
   * @param {Object} params
   * @param {'pause'|'stop'} params.mode
   * @param {string} params.setBy
   * @param {Date} [params.now] - injected clock; defaults to `new Date()`.
   */
  async setWorkspaceHalt(urlKey, { mode, setBy, now } = {}) {
    const setAt = now instanceof Date ? now : new Date();
    await this.collection.updateOne(
      { _id: urlKey },
      { $set: { mode, setAt, setBy } },
      { upsert: true }
    );
  }

  /**
   * Resume a halted workspace. Harmless when nothing is set.
   *
   * @param {string} urlKey
   */
  async clearWorkspaceHalt(urlKey) {
    await this.collection.deleteOne({ _id: urlKey });
  }
}
