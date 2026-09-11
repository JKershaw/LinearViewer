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
 * call sites merge this catalog's ids into their model `<select>`'s option
 * set (LIN-2719, via `buildModelOptions` below). Never throws — a cold-cache
 * fetch failure resolves to `[]`, and a warm-cache background-refresh failure
 * just keeps serving the last good snapshot — so an unreachable/down
 * OpenRouter degrades to "no extra models discoverable today", never a
 * broken page.
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
// DISPATCH_MODEL_SUGGESTIONS (and outside lib/model-pricing.js's
// MODEL_PRICING — lib/pricing-conformance-sweep.js looks every MODEL_PRICING
// id up in the live catalog, and a colliding fixture id would diff an
// invented price against the real rate card) so tests can assert the catalog
// actually reached the merged picker.
//
// Pricing (LIN-2719) pins all three observable states a free-model picker
// needs: a genuinely free model (both tiers zero, as real per-token
// strings — never a bare `0`), a priced one, and one with `pricing: null`
// (unknown, never rendered as free). Under NODE_ENV=test this is the ONLY
// path a "choose a free model" step can exercise (routes/workspace-api.js's
// shouldMockAi gate forces the mock path), so without a free entry here that
// acceptance step is unobservable.
export const MOCK_CATALOG_MODELS = [
  { id: 'mock-provider/catalog-model-one', name: 'Catalog Model One', pricing: { prompt: '0', completion: '0' } },
  { id: 'mock-provider/catalog-model-two', name: 'Catalog Model Two', pricing: { prompt: '0.000002', completion: '0.00001' } },
  { id: 'mock-provider/catalog-model-three', name: 'Catalog Model Three', pricing: null },
];

let cache = { at: 0, models: null };
let inflight = null;

// `pricing` (LIN-2384) is retained verbatim — raw OpenRouter per-token strings,
// no unit conversion here — so lib/pricing-conformance-sweep.js can diff the
// static rate card against its declared source of truth instead of a
// hand-typed copy of itself. Both existing consumers (lib/render-settings.js,
// public/common.js) read `.id` only, so this is purely additive.
function normalizeModel(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
    pricing: raw.pricing && typeof raw.pricing === 'object' ? raw.pricing : null,
  };
}

/**
 * True IFF a catalog model's raw per-token pricing strings indicate a $0
 * cost on BOTH the prompt and completion tiers (LIN-2719). Catalog `pricing`
 * is retained verbatim as raw OpenRouter per-token STRINGS (`normalizeModel`
 * above) — never numeric — so this coerces with `Number()` only after
 * explicitly rejecting empty/nullish first (`Number('') === 0` would
 * misread a missing value as free). An absent/null `pricing` object or a
 * missing tier reads as UNKNOWN, not free — never assume free from silence.
 *
 * Deliberately NOT `formatModelPricing` (lib/openrouter.js): that helper
 * requires `typeof p.prompt === 'number'` and returns `null` for every
 * string, which would silently mark the whole catalog unpriced.
 *
 * @param {{pricing?: {prompt?: string, completion?: string}|null}} model
 * @returns {boolean}
 */
export function isFreeModel(model) {
  const pricing = model && model.pricing;
  if (!pricing || typeof pricing !== 'object') return false;
  const { prompt, completion } = pricing;
  if (prompt === undefined || prompt === null || prompt === '') return false;
  if (completion === undefined || completion === null || completion === '') return false;
  const promptNum = Number(prompt);
  const completionNum = Number(completion);
  if (Number.isNaN(promptNum) || Number.isNaN(completionNum)) return false;
  return promptNum === 0 && completionNum === 0;
}

/**
 * Merge a curated id list with the live/mock catalog into plain option
 * descriptors `{id, label, free}` — DATA, not HTML — so a server renderer
 * (lib/render-settings.js) and a browser renderer (public/common.js, which
 * cannot import this ESM module and instead receives `free` over the wire
 * via GET .../api/openrouter/models) can each render their own idiom from
 * the same merge/de-dupe/free-marking rule (LIN-2719 S0).
 *
 * De-dupes against `curatedIds` AND within `catalog` itself — the client's
 * pre-existing stricter behaviour (the server's prior merge only de-duped
 * against curated ids, a divergence this consolidates). Order is curated
 * ids first (in caller-supplied order), then catalog entries in catalog
 * order.
 *
 * @param {Object} [opts]
 * @param {string[]} [opts.curatedIds] - Static suggestion ids for the caller's harness
 * @param {Array<{id: string, name?: string, pricing?: Object|null}>} [opts.catalog] - Live/mock catalog entries
 * @returns {Array<{id: string, label: string, free: boolean}>}
 */
export function buildModelOptions({ curatedIds = [], catalog = [] } = {}) {
  const seen = new Set();
  const descriptors = [];
  for (const id of curatedIds) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    descriptors.push({ id, label: id, free: false });
  }
  for (const model of catalog) {
    if (!model || typeof model.id !== 'string' || !model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    descriptors.push({
      id: model.id,
      label: (typeof model.name === 'string' && model.name) ? model.name : model.id,
      free: isFreeModel(model)
    });
  }
  return descriptors;
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
 * @returns {Promise<Array<{id: string, name: string, pricing: Object|null}>>}
 */
export async function getModelCatalog({ mock = false } = {}) {
  if (mock) return MOCK_CATALOG_MODELS.map(normalizeModel).filter(Boolean);

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
