/**
 * Short-TTL, in-process stale-while-revalidate cache for the Observation
 * sessions feed (LIN-617).
 *
 * The `/api/dashboard/sessions` poll fans a whole-workspace read plus full loop/
 * session reconstruction across every connected workspace on every ~5s tick
 * (`lib/pipeline-loops.getSessionsForWorkspace` → `_fetchWorkspaceData`). On a
 * busy workspace that scan is slow, so the page's `#obs-poll-status` banner sits
 * on its initial placeholder until the FIRST poll resolves — and then the same
 * cost is re-paid on every subsequent poll, so the page perpetually appears to
 * be "loading". This collapses that repeat cost:
 *
 *   - the first poll for a given workspace set pays the scan (awaited),
 *   - every poll within `ttlMs` is served instantly from the last value,
 *   - once the entry is stale the next poll STILL returns the last value
 *     immediately while a SINGLE background refresh runs (stale-while-revalidate).
 *
 * The page therefore keeps painting a fresh-enough feed and flips its banner to
 * `● live` on the very next poll instead of appearing stuck.
 *
 * Deliberately in-process and keyed by the connected-workspace SET — it caches
 * the merged feed OUTPUT, never the store reads, so the LIN-615 truncation-
 * footgun guard on `_fetchWorkspaceData` is untouched (this adds no `limit` to
 * any store call).
 */

const DEFAULT_TTL_MS = 5000;

/**
 * @param {Object}   [opts]
 * @param {number}   [opts.ttlMs=5000] - staleness threshold before a background refresh
 * @param {Function} [opts.now]        - injectable clock (ms) for tests
 * @returns {{ keyFor: Function, get: Function }}
 */
export function createSessionsFeedCache({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  // key → { value, at, refreshing } once warm, or { pending } while cold-loading.
  const entries = new Map();

  /**
   * Order-independent key for a connected-workspace set. Two requests with the
   * same workspaces (in any order) share one cached feed.
   *
   * The optional `view` discriminator (LIN-1194) namespaces the entry so the two
   * Observation tabs — the store-backed Autopilot feed and the live in-flight
   * Sessions feed — never collide on one entry keyed by workspace set alone (they
   * carry different payloads for the same workspaces). It is prefixed as
   * `<view>::<urlKeys>` so a falsy/omitted view yields the byte-identical legacy
   * key (existing Autopilot callers pass none), and `clear()` still resolves the
   * workspace set after stripping the prefix.
   *
   * @param {Array<{urlKey: string}>} workspaces
   * @param {string} [view] - optional view namespace (e.g. 'sessions')
   * @returns {string}
   */
  function keyFor(workspaces, view) {
    const base = (workspaces || []).map(w => w.urlKey).sort().join(',');
    return view ? `${view}::${base}` : base;
  }

  /**
   * Return the cached merged feed for `key`, producing it via `producer` on a
   * cold miss (awaited) or refreshing it in the background when stale.
   *
   * @param {string} key
   * @param {() => Promise<any>} producer - builds the feed on a miss/refresh
   * @returns {Promise<any>}
   */
  async function get(key, producer) {
    const entry = entries.get(key);

    // Warm entry: serve the last value now, kicking a single background refresh
    // if it has gone stale. A failed refresh keeps the last good value in place.
    if (entry && 'value' in entry) {
      if (now() - entry.at > ttlMs && !entry.refreshing) {
        entry.refreshing = true;
        Promise.resolve()
          .then(producer)
          .then(value => { entry.value = value; entry.at = now(); })
          .catch(() => { /* keep serving the last good value */ })
          .finally(() => { entry.refreshing = false; });
      }
      return entry.value;
    }

    // Cold miss: collapse concurrent callers onto one in-flight production so a
    // burst of first polls triggers a single scan, not one per request.
    if (entry && entry.pending) return entry.pending;
    const pending = Promise.resolve().then(producer);
    entries.set(key, { pending });
    try {
      const value = await pending;
      entries.set(key, { value, at: now(), refreshing: false });
      return value;
    } catch (err) {
      entries.delete(key); // let the next poll retry from cold rather than cache a failure
      throw err;
    }
  }

  /**
   * Drop cached feed entries. The cache is keyed by the connected-workspace SET,
   * so a `urlKey` invalidates every entry whose set includes that workspace; with
   * no argument the whole cache is cleared. The cache always degrades to a correct
   * cold rebuild, so dropping an entry is never wrong — only a re-pay of the scan.
   *
   * This is the test-reset seam (LIN-799): the E2E `clearRuns()` wipes the dispatch/
   * agent-status logs and the LIN-623 read-model, but the feed OUTPUT cache survived
   * and served a stale pre-seed feed within its 5s TTL, racing the first assertion.
   * (Production semantics are untouched — the 5s eventual-consistency window on a
   * polling dashboard is the cache's whole point and is not a production defect.)
   *
   * @param {string} [urlKey] - invalidate entries whose workspace set includes this key; omit to clear all
   */
  function clear(urlKey) {
    if (urlKey == null) { entries.clear(); return; }
    for (const key of [...entries.keys()]) {
      // Strip an optional `<view>::` namespace prefix (LIN-1194) so a view-scoped
      // entry (e.g. `sessions::ws-a,ws-b`) still matches on its workspace set.
      const sep = key.indexOf('::');
      const base = sep >= 0 ? key.slice(sep + 2) : key;
      if (base.split(',').includes(urlKey)) entries.delete(key);
    }
  }

  return { keyFor, get, clear };
}
