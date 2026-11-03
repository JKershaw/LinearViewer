/**
 * lib/key-state.js — one owner for "what is per-key test state" (LIN-4168).
 *
 * Test state in the server is kept per workspace key (`urlKey`) in several in-memory holders: the task-facts holder,
 * the workspace issues memo, the sessions feed cache, the touched-task done caches, the workspace token cache, and the
 * two refresh cooldowns. Before this module each seed seam reset the holders its author knew about, so a holder added
 * later could outlive a reseed (LIN-4110 was one: the task-facts set outlived the reseed and answered `task-missing`).
 *
 * This registry is the single answer to that question:
 *  - `holder({...})` registers an in-memory per-key holder: how to clear its entries for a key, optionally how to
 *    refill them from the new seed, and how many entries it keeps under a key (`probe`, which lets a test see that a
 *    reset actually worked).
 *  - `globalOnly({...})` writes down a cache that can only be cleared globally, with the reason and what clears it. It
 *    is an exception, not a holder, and it is listed so that nothing is skipped silently.
 *  - `resetKey(ctx)` is the one reset every seed seam calls. It runs in two phases, fixed here and not per seam:
 *      1. every holder's `clear(ctx)`, in registration order. A clear that throws fails the seam (loud).
 *      2. every holder's `refill(ctx)`, after all clears, so a refill reads the new seed. A refill that throws is
 *         reported and does not fail the seam.
 *
 * Registrations live in lib/key-state-holders.js (one function, `registerKeyStateHolders`), so a unit test can build the
 * real registry from the real instances without booting server.js. The census test (tests/unit/key-state-census.test.js)
 * makes a per-key container that is not registered or listed as an exception fail a test.
 *
 * Production code paths do not call `resetKey`; only the test router does.
 */

/**
 * @param {Object} [opts]
 * @param {Function} [opts.onRefillError] - (holderName, err) → void; a failed refill never fails the seam
 * @returns {{
 *   holder: Function, globalOnly: Function, resetKey: Function,
 *   holderNames: Function, exceptionNames: Function, exceptionFor: Function, probeAll: Function
 * }}
 */
export function createKeyState({
  onRefillError = (name, err) => console.error(`[key-state] refill failed for ${name}:`, err),
} = {}) {
  /** @type {Map<string, {name: string, clear: Function, refill: Function|null, probe: Function}>} */
  const holders = new Map();
  /** @type {Map<string, {name: string, why: string, clearedBy: string}>} */
  const exceptions = new Map();

  function claim(name) {
    if (typeof name !== 'string' || !name) throw new Error('key-state: a holder or exception needs a name');
    if (holders.has(name) || exceptions.has(name)) throw new Error(`key-state: "${name}" is already registered`);
  }

  /**
   * Register an in-memory per-key holder.
   * @param {Object} spec
   * @param {string} spec.name
   * @param {(ctx: KeyCtx) => (void|Promise<void>)} spec.clear - drop every entry this holder keeps under ctx.urlKey
   * @param {(ctx: KeyCtx) => (void|Promise<void>)} [spec.refill] - refill from the new seed (after every clear)
   * @param {(ctx: KeyCtx) => number} spec.probe - entries this holder keeps under the key (0 after a reset, unless refilled)
   */
  function holder({ name, clear, refill = null, probe }) {
    claim(name);
    if (typeof clear !== 'function') throw new Error(`key-state: "${name}" needs a clear function`);
    if (typeof probe !== 'function') throw new Error(`key-state: "${name}" needs a probe, or a reset cannot be checked`);
    if (refill !== null && typeof refill !== 'function') throw new Error(`key-state: "${name}" refill must be a function`);
    holders.set(name, { name, clear, refill, probe });
  }

  /**
   * Write down a cache that is per-process, per-repo or per-token rather than per workspace key. It is never reset by
   * `resetKey`; the entry says why and what clears it.
   * @param {Object} spec
   * @param {string} spec.name
   * @param {string} spec.why
   * @param {string} spec.clearedBy
   */
  function globalOnly({ name, why, clearedBy }) {
    claim(name);
    if (!why || !clearedBy) throw new Error(`key-state: exception "${name}" needs a why and a clearedBy`);
    exceptions.set(name, { name, why, clearedBy });
  }

  /**
   * The one reset. Every seed seam calls it once per workspace it puts in the session, after the seam has finished
   * seeding and before the session is saved (or the seam returns).
   * @param {KeyCtx} ctx
   */
  async function resetKey(ctx) {
    if (!ctx || typeof ctx.urlKey !== 'string' || !ctx.urlKey) throw new Error('key-state: resetKey needs a urlKey');
    for (const h of holders.values()) await h.clear(ctx);
    for (const h of holders.values()) {
      if (!h.refill) continue;
      try {
        await h.refill(ctx);
      } catch (err) {
        onRefillError(h.name, err);
      }
    }
  }

  return {
    holder,
    globalOnly,
    resetKey,
    holderNames: () => [...holders.keys()],
    exceptionNames: () => [...exceptions.keys()],
    exceptionFor: (name) => exceptions.get(name) ?? null,
    /** @returns {Object<string, number>} entries each holder keeps under the key, by holder name */
    probeAll: (ctx) => Object.fromEntries([...holders.values()].map((h) => [h.name, h.probe(ctx)])),
  };
}

/**
 * @typedef {Object} KeyCtx
 * @property {string} urlKey
 * @property {Object|null} [workspace] - the workspace the seam put in the session (`id`, `urlKey`, `accessToken`, …)
 * @property {string|null} [accountId] - the session's account, or null
 */
