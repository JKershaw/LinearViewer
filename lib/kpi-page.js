/**
 * The public /kpis route's cache and handler (LIN-3703; moved out of server.js).
 *
 * The page is served stale-while-revalidate behind a single-flight lock: once
 * warmed, the route ALWAYS responds instantly from cache and refreshes in the
 * background, so a slow DB read can never block the request or trip the 30s
 * router timeout (the old behaviour: a >30s read died before it could fill the
 * cache, so every request re-ran the read and timed out — a death spiral). Only
 * a cold cache (process just booted) awaits the first computation. The
 * single-flight lock collapses concurrent refreshes into one DB read.
 *
 * What is cached is the public view (`toPublicKpis`), never raw stats: `collect`
 * returns it, and `render` only ever sees it.
 */

export const KPI_CACHE_MS = 60 * 1000;

/**
 * @param {Object} options
 * @param {() => Promise<Object>} options.collect - one read; resolves to the public view
 * @param {(view: Object) => string} options.render - the page HTML for a view
 * @param {() => string} options.renderError - the 500 page HTML
 * @param {() => number} [options.now] - clock override for tests
 * @returns {{ handler: Function, reset: (mode?: string) => void }}
 */
export function createKpiPage({ collect, render, renderError, now = Date.now }) {
  let cache = { at: 0, view: null };
  let inflight = null;

  async function refresh() {
    const startedAt = now();
    const view = await collect();
    const ms = now() - startedAt;
    if (ms > 5000) console.warn(`KPI stats collection slow: ${ms}ms`);
    else console.log(`KPI stats collected in ${ms}ms`);
    cache = { at: now(), view };
    return view;
  }

  // Single-flight: collapse concurrent (re)fills into one in-flight DB read.
  function refreshOnce() {
    if (!inflight) {
      inflight = refresh().finally(() => { inflight = null; });
    }
    return inflight;
  }

  async function handler(req, res) {
    let view = cache.view;
    try {
      const fresh = view && now() - cache.at <= KPI_CACHE_MS;
      if (!fresh) {
        if (view) {
          // Warm but stale: serve the last good snapshot now, refresh in the
          // background. Never await — the request must not block on the DB read.
          refreshOnce().catch(err => console.error('KPI background refresh failed:', err));
        } else {
          // Cold cache (fresh boot): nothing to serve yet, so await the first fill.
          view = await refreshOnce();
        }
      }
    } catch (error) {
      console.error('Failed to render KPIs page:', error);
      // A failed first read leaves nothing to serve; any snapshot that landed
      // meanwhile (a concurrent fill) is the last good one.
      view = cache.view;
      if (!view) return res.status(500).send(renderError());
    }
    // The renderer runs once. The old catch re-called it, so a renderer that
    // had just thrown threw again, outside any handler (LIN-3703).
    let html;
    try {
      html = render(view);
    } catch (error) {
      console.error('Failed to render KPIs page:', error);
      return res.status(500).send(renderError());
    }
    res.send(html);
  }

  // Test seam (/test/clear-kpi-cache): 'stale' keeps the snapshot but backdates
  // it past KPI_CACHE_MS (warm-but-stale, no 60s real wait); anything else
  // clears it (cold boot).
  function reset(mode) {
    cache = mode === 'stale' ? { at: 0, view: cache.view } : { at: 0, view: null };
  }

  return { handler, reset };
}
