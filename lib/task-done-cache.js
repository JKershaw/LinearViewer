/**
 * Small in-process TTL cache for a touched task's live "done" state, used by the
 * Observation feed's bounded server-side hydration (LIN-1258, Axis B).
 *
 * The `/api/dashboard/sessions` poll fires every ~5s. Only an errored-terminal
 * session's status can flip (to `done-with-warning`) once its touched task is
 * Done in the backend, so the feed hydrates the seed task's real done-state for
 * at most a few such sessions per poll. Without a cache that would re-read the
 * backend for the same task on every 5s tick, violating the no-Linear-read-per-
 * poll cost contract. This caches the resolved boolean so a task is read at most
 * once per `ttlMs`, and a repeat poll within the window is a pure memory hit.
 *
 * Deliberately tiny and in-process (mirrors `lib/sessions-feed-cache.js`):
 *   - `peek(key)` returns the fresh cached boolean, or `undefined` on a miss /
 *     expiry — WITHOUT producing. The feed uses it to tell a free cache hit from
 *     a miss, so the per-poll N-cap counts only the reads that actually hit the
 *     backend (cached hits are free and always applied).
 *   - `get(key, producer)` returns the fresh cached boolean, else awaits
 *     `producer()` once, caches the coerced boolean, and returns it. A throwing
 *     producer propagates and is NOT cached, so a transient hydration failure is
 *     retried on a later poll rather than pinned as `false` for the whole TTL.
 *
 * `done` is sticky (a Done task stays Done), so a 60s default TTL keeps the
 * collapsed card fresh within a minute while bounding backend reads to ≤1 per
 * eligible task per minute.
 */

const DEFAULT_TTL_MS = 60 * 1000; // 60s (LIN-1258)

/**
 * @param {Object}   [opts]
 * @param {number}   [opts.ttlMs=60000] - freshness window for a cached done-state
 * @param {Function} [opts.now]         - injectable clock (ms) for tests
 * @returns {{ peek: Function, get: Function, clear: Function, ttlMs: number }}
 */
export function createTaskDoneCache({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  // key (`${wsUrlKey}::${identifier}`) → { value: boolean, at: ms }
  const entries = new Map();

  /**
   * Fresh cached done-state for `key`, or `undefined` on a miss/expiry. Never
   * produces. Prunes the entry when stale so a later `get` re-reads.
   * @param {string} key
   * @returns {boolean|undefined}
   */
  function peek(key) {
    const e = entries.get(key);
    if (!e) return undefined;
    if (now() - e.at > ttlMs) { entries.delete(key); return undefined; }
    return e.value;
  }

  /**
   * Return the fresh cached done-state for `key`, else produce it once and cache
   * the coerced boolean. A throwing `producer` propagates and is NOT cached.
   * @param {string} key
   * @param {() => Promise<boolean>} producer
   * @returns {Promise<boolean>}
   */
  async function get(key, producer) {
    const cached = peek(key);
    if (cached !== undefined) return cached;
    const value = !!(await producer());
    entries.set(key, { value, at: now() });
    return value;
  }

  /** Drop all cached entries (test-reset seam; the cache always degrades to a re-read). */
  function clear() { entries.clear(); }

  return { peek, get, clear, ttlMs };
}
