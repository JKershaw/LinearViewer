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
    // LIN-3024's poll-fallback cache seam: the last-known halt per urlKey,
    // warmed by both this store's reads and its writes so proxy (LIN-3025)
    // and dashboard (LIN-3026) writers land on the same instance the poll
    // handler reads from (server.js's single shared WorkspaceHaltStore).
    // A per-urlKey write generation guards against a slow read landing after
    // a newer write/clear and resurrecting a stale value.
    this._lastKnownHalt = new Map();
    this._writeGeneration = new Map();
  }

  /**
   * @param {string} urlKey
   * @returns {Promise<Object|null>} the halt document, or null when unset.
   */
  async getWorkspaceHalt(urlKey) {
    const generationAtStart = this._writeGeneration.get(urlKey) || 0;
    const doc = await this.collection.findOne({ _id: urlKey });
    if ((this._writeGeneration.get(urlKey) || 0) === generationAtStart) {
      this._lastKnownHalt.set(urlKey, projectHalt(doc));
    }
    return doc;
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
    this._bumpWriteGeneration(urlKey);
    this._lastKnownHalt.set(urlKey, { mode, setAt, setBy });
  }

  /**
   * Resume a halted workspace. Harmless when nothing is set.
   *
   * @param {string} urlKey
   */
  async clearWorkspaceHalt(urlKey) {
    await this.collection.deleteOne({ _id: urlKey });
    this._bumpWriteGeneration(urlKey);
    this._lastKnownHalt.set(urlKey, null);
  }

  /**
   * Synchronous last-known-halt lookup for the poll handler's bounded-read
   * fallback (LIN-3024). Contract-shaped (`{mode,setAt,setBy}`, no `_id`).
   * Returns `null` both when nothing has ever warmed the cache for this
   * `urlKey` and when the last-known state is a resumed/cleared workspace —
   * either way the poll handler omits the `halt` key.
   *
   * @param {string} urlKey
   * @returns {Object|null}
   */
  getLastKnownHalt(urlKey) {
    return this._lastKnownHalt.get(urlKey) ?? null;
  }

  _bumpWriteGeneration(urlKey) {
    this._writeGeneration.set(urlKey, (this._writeGeneration.get(urlKey) || 0) + 1);
  }
}

function projectHalt(doc) {
  if (!doc) return null;
  const { mode, setAt, setBy } = doc;
  return { mode, setAt, setBy };
}
