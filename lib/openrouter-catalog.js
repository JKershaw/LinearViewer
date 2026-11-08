/**
 * Live OpenRouter model catalog (LIN-1111 Session 2).
 *
 * Wraps `GET https://openrouter.ai/api/v1/models` — a public, unauthenticated
 * endpoint — with an in-process TTL cache. Mirrors the KPI cache shape
 * (lib/kpi-page.js's cache, `KPI_CACHE_MS`): a module-level `{ at, models }`
 * snapshot, a background refresh when stale-but-warm, and a blocking first
 * fill only when the cache is cold. Unlike lib/recap-cache.js this is NOT
 * per-workspace — OpenRouter's model list is the same for every workspace, so
 * there is no DB-backed partitioning, just one shared in-memory snapshot.
 *
 * Since LIN-4358 this is where Harbour's facts about a model come from: its
 * name, price (lib/catalog-rate.js), tools, reasoning and input/output limits
 * (lib/call-budget.js). The hand lists that remain hold choices, not facts:
 * which models a picker suggests first (SUGGESTED_MODEL_IDS,
 * DISPATCH_MODEL_SUGGESTIONS), and which the free tier may run. Every picker
 * offers the whole catalog after its suggestions (LIN-2719, via
 * `buildModelOptions` below). Never throws — a cold-cache
 * fetch failure resolves to `[]`, and a warm-cache background-refresh failure
 * just keeps serving the last good snapshot — so an unreachable/down
 * OpenRouter degrades to "no extra models discoverable today", never a
 * broken page.
 */

import { rateFromCatalogPricing } from './catalog-rate.js';

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
// DISPATCH_MODEL_SUGGESTIONS and SUGGESTED_MODEL_IDS so tests can assert the
// catalog actually reached the merged picker. This mock feeds the pickers only;
// it never enters the shared cache that prices and budgets calls.
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

let cache = { at: 0, models: null, byId: null };

// Every cache assignment goes through here so `byId` always matches `models`
// (LIN-4358): getCachedCatalogModel sits on the pricing hot path (priceUsage reads it
// two or three times per record across KPI and lineage folds), so it is a Map lookup,
// not a scan of ~460 entries.
function cacheOf(at, models) {
  const byId = new Map();
  for (const m of models || []) if (m && typeof m.id === 'string' && !byId.has(m.id)) byId.set(m.id, m);
  return { at, models, byId: models ? byId : null };
}
let inflight = null;

// `pricing` (LIN-2384) is retained verbatim — raw OpenRouter per-token strings,
// no unit conversion here. Since LIN-4358 it is the only rate source:
// lib/catalog-rate.js converts it, and lib/pricing-conformance-sweep.js checks the
// converter understands it. Consumers read named fields only, so every
// addition here is purely additive.
//
// `supported_parameters` and `reasoning` (LIN-3882) are retained so
// lib/openrouter.js can answer "does this model take tools / spend hidden
// reasoning tokens" from the catalog instead of a hand-written list.
// `supported_parameters` is an array of strings or null (null = no signal, NOT
// "supports nothing").
//
// `reasoning` follows the live /models shape, read on 7 Nov 2026 and pinned in
// tests/fixtures/openrouter-models-2026-11-07.json (LIN-4358):
// `{ mandatory, default_enabled?, supported_efforts, default_effort }`. There is no
// `supports_max_tokens`. `default_enabled` is often ABSENT (it was for
// anthropic/claude-haiku-5.5), so it is kept tri-state: true, false, or null for
// "the catalog does not say". A model with no `reasoning` object normalizes to null:
// the catalog says it does not reason.
//
// `context_length` and `top_provider.max_completion_tokens` (LIN-4358) bound what a
// call may ask for; lib/call-budget.js sizes every request from them. Null when absent.
function normalizeReasoning(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    mandatory: raw.mandatory === true,
    default_enabled: typeof raw.default_enabled === 'boolean' ? raw.default_enabled : null,
    supported_efforts: Array.isArray(raw.supported_efforts)
      ? raw.supported_efforts.filter(e => typeof e === 'string')
      : null,
    default_effort: typeof raw.default_effort === 'string' ? raw.default_effort : null,
  };
}

function positiveInt(v) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
}

function normalizeModel(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
    pricing: raw.pricing && typeof raw.pricing === 'object' ? raw.pricing : null,
    supported_parameters: Array.isArray(raw.supported_parameters)
      ? raw.supported_parameters.filter(p => typeof p === 'string')
      : null,
    reasoning: normalizeReasoning(raw.reasoning),
    context_length: positiveInt(raw.top_provider?.context_length) ?? positiveInt(raw.context_length),
    max_completion_tokens: positiveInt(raw.top_provider?.max_completion_tokens),
  };
}

/** Test-only: the normalizer itself, so a fixture of the live shape can be run through it. */
export function _normalizeModelForTests(raw) {
  return normalizeModel(raw);
}

/**
 * True IFF a catalog model costs $0 on BOTH the prompt and completion tiers
 * (LIN-2719). Read through `rateFromCatalogPricing` (lib/catalog-rate.js, LIN-4358),
 * the one parser of the catalog's per-token price strings, so "free" and "priced"
 * cannot disagree: an absent/null `pricing` object, a missing or empty tier, or a
 * variable (-1) price is UNKNOWN, not free — never assume free from silence.
 *
 * @param {{pricing?: {prompt?: string, completion?: string}|null}} model
 * @returns {boolean}
 */
export function isFreeModel(model) {
  const rate = rateFromCatalogPricing(model && model.pricing);
  return !!rate && rate.prompt === 0 && rate.completion === 0;
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
 *   `shouldMockAi(workspace)` in lib/should-mock-ai.js) so tests never make a
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
        // An empty list never replaces a non-empty snapshot (LIN-3882): a
        // successful-but-empty or malformed response must not cost an hour of
        // degraded capability lookups.
        .then(models => { if (models.length) cache = cacheOf(Date.now(), models); })
        .catch(err => console.error('OpenRouter model catalog refresh failed:', err.message))
        .finally(() => { inflight = null; });
    }
    return cache.models;
  }

  // Cold cache: await the first fill, degrade to [] on failure.
  try {
    const models = await fetchCatalog();
    // A cold empty result is returned but not cached, so it cannot block a
    // refetch for an hour (LIN-3882).
    if (models.length) cache = cacheOf(Date.now(), models);
    return models;
  } catch (err) {
    console.error('OpenRouter model catalog fetch failed:', err.message);
    return [];
  }
}

/**
 * Synchronous read of the cached catalog entry for a model id (LIN-3882).
 * Never fetches or refreshes, and ignores snapshot age: a stale entry is still
 * the best answer for "what can this model do". Returns null when the cache is
 * cold or the id is absent: callers treat that as unknown (no price, no headroom, a
 * slug for a name); only tool capability falls back, to the suggested models (LIN-4358).
 * Kept sync so the pure capability helpers in lib/openrouter.js stay sync.
 *
 * @param {string} id
 * @returns {{id: string, name: string, pricing: Object|null, supported_parameters: string[]|null, reasoning: Object|null, context_length: number|null, max_completion_tokens: number|null}|null}
 */
export function getCachedCatalogModel(id) {
  if (!id || typeof id !== 'string' || !cache.models) return null;
  return cache.byId?.get(id) || null;
}

/**
 * Seed the shared cache from a raw `/models` body (`{ data: [...] }`), run through the
 * real normalizer, and hold it as fresh for good (LIN-4358). For NODE_ENV=test only:
 * server.js seeds the pinned snapshot (tests/fixtures/openrouter-models-2026-11-08.json)
 * so a test server prices, names and budgets models as production does, with no live
 * call. Unit tests use tests/unit/helpers/pinned-catalog.js for the same snapshot.
 *
 * @param {{data?: Array}} body
 * @returns {number} how many models were cached
 */
export function _seedCatalogFromBodyForTests(body) {
  const models = (Array.isArray(body?.data) ? body.data : []).map(normalizeModel).filter(Boolean);
  // `at` in the far future: never stale, so a long test run never refetches.
  cache = cacheOf(Number.MAX_SAFE_INTEGER, models);
  return models.length;
}

/** Test-only: reset the module-level cache/inflight state between specs. */
export function _resetCatalogCacheForTests() {
  cache = { at: 0, models: null, byId: null };
  inflight = null;
}

/** Test-only: seed the module-level cache directly (skips a real fetch). */
export function _setCatalogCacheForTests({ at, models }) {
  cache = cacheOf(at, models);
}
