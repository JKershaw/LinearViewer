/**
 * lib/workspace-kpis-cache.js: the workspace KPIs page's per-workspace stale-while-revalidate cache (LIN-4201).
 *
 * Why: the records-first cost read (lib/cost-read.js, LIN-4201) loads every request record of the workspace's 30-day
 * window. Measured at LIN-4200's steady-state volume (about 230k records), that load and fold add about 1.35 s to a
 * read of about 0.8 s (LIN-4200 beat 3; LIN-4201 beat 3 re-timed it: fetch 1.18 s, fold 0.17 s). LIN-4200's carried
 * condition was to put it behind the same cache /kpis uses (lib/kpi-page.js) or build the D13 pre-sum. This is the
 * cache: the plain projection fetch stays the one read (D13), and the page stops paying for it on every request.
 *
 * Behaviour, per urlKey, the same as lib/kpi-page.js: a fresh entry (younger than the TTL) is served as is; a stale one
 * is served at once while one background refresh runs; a cold key awaits its first read. Concurrent fills of one key
 * collapse into one read (single-flight). A failed refresh keeps the last good entry; a failed first read throws to the
 * caller (the route answers 500, as before).
 *
 * Per-key state: registered in lib/key-state-holders.js (`workspace-kpis-cache`), so a seed seam's reset clears it.
 */

import { KPI_CACHE_MS } from './kpi-page.js';

/**
 * @param {Object} options
 * @param {(urlKey: string) => Promise<Object>} options.collect - one read of one workspace's KPIs
 * @param {() => number} [options.now] - clock override for tests
 * @param {number} [options.ttlMs]
 * @param {Object} [options.logger]
 * @returns {{get: (urlKey: string) => Promise<Object>, clear: (ctx: {urlKey: string}) => void, countFor: (ctx: {urlKey: string}) => number}}
 */
export function createWorkspaceKpisCache({ collect, now = Date.now, ttlMs = KPI_CACHE_MS, logger = console }) {
  if (typeof collect !== 'function') throw new TypeError('createWorkspaceKpisCache: collect is required');
  const entries = new Map(); // urlKey -> { at, stats }
  const inflight = new Map(); // urlKey -> Promise<stats>

  function refreshOnce(urlKey) {
    let pending = inflight.get(urlKey);
    if (!pending) {
      pending = (async () => {
        const stats = await collect(urlKey);
        entries.set(urlKey, { at: now(), stats });
        return stats;
      })().finally(() => inflight.delete(urlKey));
      inflight.set(urlKey, pending);
    }
    return pending;
  }

  async function get(urlKey) {
    const entry = entries.get(urlKey);
    if (!entry) return refreshOnce(urlKey);
    if (now() - entry.at > ttlMs) {
      refreshOnce(urlKey).catch(err => logger.error('Workspace KPIs background refresh failed:', err?.message || err));
    }
    return entry.stats;
  }

  return {
    get,
    clear: ({ urlKey }) => { entries.delete(urlKey); inflight.delete(urlKey); },
    countFor: ({ urlKey }) => (entries.has(urlKey) ? 1 : 0),
  };
}
