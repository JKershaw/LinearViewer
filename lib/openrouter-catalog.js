/**
 * Live OpenRouter model catalog (LIN-1111 Session 2).
 *
 * Wraps `GET https://openrouter.ai/api/v1/models` — a public, unauthenticated
 * endpoint — with an in-process TTL cache. Mirrors the KPI cache shape
 * (server.js `kpiCache`/`KPI_CACHE_MS`): a module-level `{ at, models }`
 * snapshot, a background refresh when stale-but-warm, and a blocking first
 * fill only when the cache is cold. Unlike lib/recap-cache.js this is NOT
 * per-workspace — OpenRouter's model list is the same for every workspace, so
 * there is no DB-backed partitioning, just one shared in-memory snapshot.
 *
 * This is a SUPPLEMENT to the static DISPATCH_MODEL_SUGGESTIONS curated lists
 * in public/common.js and lib/render-settings.js, never a replacement: both
 * call sites merge this catalog's ids into their existing suggestion
 * datalists. Never throws — a cold-cache fetch failure resolves to `[]`, and
 * a warm-cache background-refresh failure just keeps serving the last good
 * snapshot — so an unreachable/down OpenRouter degrades to "no extra models
 * discoverable today", never a broken page.
 */

const MODELS_API_URL = 'https://openrouter.ai/api/v1/models';
const FETCH_TIMEOUT_MS = 10000;

// Model catalogs change rarely relative to a settings-page/dispatch-page
// visit cadence, so an hour-long TTL keeps this well clear of OpenRouter rate
// limits without ever showing meaningfully stale data.
export const CATALOG_CACHE_TTL_MS = 60 * 60 * 1000;

// Canned, deterministic stand-in for `mock: true` callers (test/local-provider
// sessions, mirroring the `shouldMockAi` gate already used for the AI
// recommendation endpoints) so automated tests never depend on a live
// third-party network call. Ids are deliberately outside
// DISPATCH_MODEL_SUGGESTIONS so tests can assert the catalog actually reached
// the merged datalist.
export const MOCK_CATALOG_MODELS = [
  { id: 'mock-provider/catalog-model-one', name: 'Catalog Model One' },
  { id: 'mock-provider/catalog-model-two', name: 'Catalog Model Two' },
];

let cache = { at: 0, models: null };
let inflight = null;

function normalizeModel(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  return { id: raw.id, name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id };
}

async function fetchCatalog() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(MODELS_API_URL, {
      headers: {
        'HTTP-Referer': 'https://github.com/JKershaw/LinearViewer',
        'X-Title': 'Harbour'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`OpenRouter models API error: ${response.status}`);
    }
    const data = await response.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    return list.map(normalizeModel).filter(Boolean);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Return the live OpenRouter model catalog, refreshing the in-process cache
 * in the background when stale. Never throws or rejects.
 *
 * @param {Object} [options]
 * @param {boolean} [options.mock=false] - Return the canned MOCK_CATALOG_MODELS
 *   without touching the network or the shared cache. Callers should pass this
 *   using the same predicate that gates the AI recommendation mock (e.g.
 *   `shouldMockAi(workspace)` in routes/workspace-api.js) so tests never make a
 *   live third-party call.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function getModelCatalog({ mock = false } = {}) {
  if (mock) return MOCK_CATALOG_MODELS;

  const fresh = cache.models && Date.now() - cache.at <= CATALOG_CACHE_TTL_MS;
  if (fresh) return cache.models;

  if (cache.models) {
    // Warm but stale: serve the last good snapshot now, refresh in the
    // background. Never await — a request must not block on this network call.
    if (!inflight) {
      inflight = fetchCatalog()
        .then(models => { cache = { at: Date.now(), models }; })
        .catch(err => console.error('OpenRouter model catalog refresh failed:', err.message))
        .finally(() => { inflight = null; });
    }
    return cache.models;
  }

  // Cold cache: await the first fill, degrade to [] on failure.
  try {
    const models = await fetchCatalog();
    cache = { at: Date.now(), models };
    return models;
  } catch (err) {
    console.error('OpenRouter model catalog fetch failed:', err.message);
    return [];
  }
}

/** Test-only: reset the module-level cache/inflight state between specs. */
export function _resetCatalogCacheForTests() {
  cache = { at: 0, models: null };
  inflight = null;
}

/** Test-only: seed the module-level cache directly (skips a real fetch). */
export function _setCatalogCacheForTests({ at, models }) {
  cache = { at, models };
}
