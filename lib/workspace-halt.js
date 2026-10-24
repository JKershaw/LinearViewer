/**
 * Workspace halt store (LIN-2994/LIN-3023) — the durable operator pause/stop
 * flag for a workspace, keyed by `urlKey`. Consumed by the poll fallback
 * (LIN-3024), the proxy operator routes (LIN-3025) and the dashboard routes
 * (LIN-3026).
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
 *   mode:  HALT_MODES[number],
 *   setAt: Date,
 *   setBy: string
 * }
 */

/**
 * The single runtime source of truth for a valid halt mode (LIN-3026). Both
 * write surfaces (dashboard `routes/dispatch.js`, proxy `routes/proxy-halt.js`)
 * validate `mode` against this export instead of each hard-coding their own
 * `'pause'|'stop'` literal, so the two validators cannot drift.
 *
 * Adding a mode (LIN-3650): teach the runner kit (`haltAction`) and Simple
 * Dispatcher first, and Harbour last. Until then an unknown mode is read as
 * `pause` by SD and left (aborts included) by the kit. The check is two tests:
 * `runner-kit-helper.test.js` (an explicit kit branch) and
 * `runner-kit-contract.test.js` (halt rows in `contract.json`).
 */
export const HALT_MODES = Object.freeze(['pause', 'stop']);

/**
 * The 400 message both write surfaces return for an invalid `mode`, derived
 * from `HALT_MODES` so the mode set has one textual source too (LIN-3026
 * close-out L8 / LIN-3030). Byte-identical to the original hand-written
 * "mode must be 'pause' or 'stop'"; pinned by both surfaces' 400 tests.
 */
export const HALT_MODE_ERROR = `mode must be ${HALT_MODES.map(m => `'${m}'`).join(' or ')}`;

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
    this._onChange = null;
  }

  /**
   * Late-bound change hook (LIN-3846), as the token store binds its owner seam late:
   * server.js wires it once to the workspace change log. It is called after a
   * set or clear that names a `via` and is not `quiet`, with
   * `{ urlKey, from, to, via, setBy, reason }`; `from`/`to` are 'none' | 'pause'
   * | 'stop' (or 'unknown' when the prior read failed). The hook is how every
   * writer (Settings, the Dispatch page, the proxy route) lands in the log
   * without each one knowing about it.
   *
   * A hook failure NEVER fails the halt: it is logged and the write stands. That
   * is the opposite of the model store's LOG_WRITE_FAILED, which is right for a
   * config edit and wrong for an emergency stop. A call with no `via` (a test
   * seed) is not logged, and the Settings Undo passes `quiet` because the
   * change log writes its own single `undo` row.
   *
   * @param {((change: Object) => Promise<void>|void)|null} fn
   */
  setOnChange(fn) {
    this._onChange = typeof fn === 'function' ? fn : null;
  }

  /** The prior mode for the hook, read before the write; 'unknown' if the read throws. */
  async _priorMode(urlKey) {
    try {
      const doc = await this.collection.findOne({ _id: urlKey });
      return doc?.mode || 'none';
    } catch {
      return 'unknown';
    }
  }

  async _notify(change) {
    try {
      await this._onChange(change);
    } catch (err) {
      console.error('Workspace halt change hook failed (the halt stands):', err?.message || err);
    }
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
   * @param {HALT_MODES[number]} params.mode
   * @param {string} params.setBy
   * @param {Date} [params.now] - injected clock; defaults to `new Date()`.
   * @param {'page'|'proxy'} [params.via] - names the writer for the change hook (LIN-3846).
   * @param {string} [params.reason] - typed reason (Settings); absent means "Changed outside Settings".
   * @param {boolean} [params.quiet] - skip the hook (the Settings Undo logs its own row).
   */
  async setWorkspaceHalt(urlKey, { mode, setBy, now, via, reason, quiet } = {}) {
    const hooked = !!(this._onChange && via && !quiet);
    const from = hooked ? await this._priorMode(urlKey) : null;
    const setAt = now instanceof Date ? now : new Date();
    await this.collection.updateOne(
      { _id: urlKey },
      { $set: { mode, setAt, setBy } },
      { upsert: true }
    );
    this._bumpWriteGeneration(urlKey);
    this._lastKnownHalt.set(urlKey, { mode, setAt, setBy });
    if (hooked) await this._notify({ urlKey, from, to: mode, via, setBy: setBy || null, reason });
  }

  /**
   * Resume a halted workspace. Harmless when nothing is set.
   *
   * @param {string} urlKey
   * @param {{via?: string, setBy?: string, reason?: string, quiet?: boolean}} [options] - as `setWorkspaceHalt`.
   */
  async clearWorkspaceHalt(urlKey, { via, setBy, reason, quiet } = {}) {
    const hooked = !!(this._onChange && via && !quiet);
    const from = hooked ? await this._priorMode(urlKey) : null;
    await this.collection.deleteOne({ _id: urlKey });
    this._bumpWriteGeneration(urlKey);
    this._lastKnownHalt.set(urlKey, null);
    if (hooked) await this._notify({ urlKey, from, to: 'none', via, setBy: setBy || null, reason });
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
