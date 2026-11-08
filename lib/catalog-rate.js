/**
 * A model's rate, read from its OpenRouter catalog `pricing` (LIN-4358).
 *
 * Harbour used to keep a hand-pasted rate card (`MODEL_PRICING`) and an hourly sweep that
 * diffed it against the catalog. The card went stale anyway: on 8 Nov 2026 the catalog
 * priced deepseek/deepseek-v4.1-flash-1017 at $0.006 / $0.50 per 1M against the card's
 * $0.15 / $0.60, and z-ai/glm-5.3-flash at $0.0335 / $0.083 against $0.15 / $0.50. This
 * module turns the catalog's own `pricing` object into the rate shape lib/model-pricing.js
 * prices with, so a model is priced the day it appears and a price change needs no edit.
 *
 * The catalog shape, read live on 8 Nov 2026 (pinned in
 * tests/fixtures/openrouter-models-2026-11-08.json):
 *
 *   pricing: { prompt, completion, input_cache_read?, input_cache_write?,
 *              input_cache_write_1h?, web_search?, image?, audio?, internal_reasoning?, …,
 *              overrides?: [{ min_prompt_tokens?, utc_days?, utc_start?, utc_end?, <tiers> }] }
 *
 * Every price is a STRING in USD per token. The rate shape is USD per 1M tokens, so each
 * tier is multiplied by 1e6 exactly once, here.
 *
 * Tiers priced: the five token tiers a usage record carries (prompt, completion, cache
 * read, cache write 5m, cache write 1h). Every other key (web_search, image, audio,
 * internal_reasoning, …) prices something a Harbour usage record does not count, and is
 * ignored. `internal_reasoning` in particular: reasoning tokens are billed inside
 * `completion_tokens`, and on every model that publishes it on 8 Nov it equals
 * `completion` (one exception, perplexity/sonar-deep-research, prices more).
 *
 * Overrides, each kept with the gates it states:
 *   - `min_prompt_tokens` (long-context tier): applies when the request's total prompt is
 *     strictly greater (OpenRouter's rule, LIN-2403).
 *   - `utc_start` / `utc_end` (time-of-day tier): integers in HHMM form, read from the
 *     values the catalog publishes (100, 400, 1000, 1500, 1600). The window is
 *     [start, end); when end <= start it wraps past midnight (1500 → 100 is 15:00–01:00).
 *     This reading is inferred from the published values, not from a spec.
 *   - `utc_days` (day-of-week tier): lowercase English day names, matched against the UTC
 *     day of the moment priced.
 * An entry may carry several gates; it applies only when all of them hold.
 *
 * A gate this module does not know makes the entry unmodelled: it is dropped, and
 * `unmodelledGates` names the key, so the pricing sweep can say so instead of pricing
 * wrong in silence.
 *
 * Returns null, never a guess, when `prompt` or `completion` is absent, not a number or
 * negative (OpenRouter publishes -1 for variable-priced routers such as openrouter/auto).
 *
 * Pure. Results are memoized per pricing object, so the hot pricing path does no work
 * after the first read of a catalog snapshot.
 */

/** Catalog tier key -> rate key. */
export const CATALOG_TIERS = Object.freeze({
  prompt: 'prompt',
  completion: 'completion',
  input_cache_read: 'cacheRead',
  input_cache_write: 'cacheWrite',
  input_cache_write_1h: 'cacheWrite1h',
});

/** Override keys that gate when an entry applies, and that this module models. */
const KNOWN_GATES = new Set(['min_prompt_tokens', 'utc_start', 'utc_end', 'utc_days']);

/**
 * Override keys that are neither a gate nor a priced tier: prices for things a usage
 * record does not count. Anything outside the three sets is read as an unknown gate.
 */
const IGNORED_TIERS = new Set([
  'web_search', 'image', 'image_output', 'audio', 'audio_output', 'input_audio_cache',
  'internal_reasoning', 'request', 'discount',
]);

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const memo = new WeakMap();

/** A per-token price string (or number) as USD per 1M, or null when not a usable price. */
function perMillion(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  // Round to 10 significant decimals so 0.0000001 * 1e6 reads 0.1, not 0.09999999999999999.
  return Math.round(n * 1e6 * 1e10) / 1e10;
}

function hhmm(v) {
  return Number.isInteger(v) && v >= 0 && v <= 2400 ? v : null;
}

function convertOverride(raw) {
  if (!raw || typeof raw !== 'object') return { entry: null, unknown: [] };
  const unknown = Object.keys(raw).filter(k => !KNOWN_GATES.has(k) && !IGNORED_TIERS.has(k) && !(k in CATALOG_TIERS));
  if (unknown.length) return { entry: null, unknown };
  const entry = {};
  if (raw.min_prompt_tokens !== undefined) {
    if (!Number.isFinite(raw.min_prompt_tokens)) return { entry: null, unknown: ['min_prompt_tokens'] };
    entry.minPromptTokens = raw.min_prompt_tokens;
  }
  if (raw.utc_start !== undefined || raw.utc_end !== undefined) {
    const start = hhmm(raw.utc_start ?? 0);
    const end = hhmm(raw.utc_end ?? 2400);
    if (start === null || end === null) return { entry: null, unknown: ['utc_start/utc_end'] };
    entry.utcStart = start;
    entry.utcEnd = end;
  }
  if (raw.utc_days !== undefined) {
    if (!Array.isArray(raw.utc_days) || !raw.utc_days.every(d => DAYS.includes(String(d).toLowerCase()))) {
      return { entry: null, unknown: ['utc_days'] };
    }
    entry.utcDays = raw.utc_days.map(d => String(d).toLowerCase());
  }
  for (const [catalogKey, rateKey] of Object.entries(CATALOG_TIERS)) {
    const v = perMillion(raw[catalogKey]);
    if (v !== null) entry[rateKey] = v;
  }
  return { entry, unknown: [] };
}

/**
 * The rate for a catalog `pricing` object, or null when it carries no usable base price.
 * Frozen, like the rate card it replaces, so a consumer cannot change what the next one reads.
 *
 * @param {Object|null} pricing - a catalog entry's `pricing`, verbatim
 * @returns {Readonly<import('./model-pricing.js').ModelRate>|null}
 */
export function rateFromCatalogPricing(pricing) {
  return convert(pricing).rate;
}

/**
 * The override gate keys in a catalog `pricing` object that this module does not model.
 * Empty when every override was understood. The pricing sweep reports these.
 *
 * @param {Object|null} pricing
 * @returns {string[]}
 */
export function unmodelledGates(pricing) {
  return convert(pricing).unknown;
}

function convert(pricing) {
  if (!pricing || typeof pricing !== 'object') return { rate: null, unknown: [] };
  const hit = memo.get(pricing);
  if (hit) return hit;
  let result;
  const prompt = perMillion(pricing.prompt);
  const completion = perMillion(pricing.completion);
  if (prompt === null || completion === null) {
    result = { rate: null, unknown: [] };
  } else {
    const rate = { prompt, completion };
    for (const [catalogKey, rateKey] of Object.entries(CATALOG_TIERS)) {
      if (rateKey === 'prompt' || rateKey === 'completion') continue;
      const v = perMillion(pricing[catalogKey]);
      if (v !== null) rate[rateKey] = v;
    }
    const unknown = [];
    if (Array.isArray(pricing.overrides) && pricing.overrides.length) {
      const overrides = [];
      for (const raw of pricing.overrides) {
        const { entry, unknown: u } = convertOverride(raw);
        unknown.push(...u);
        if (entry) overrides.push(Object.freeze(entry));
      }
      if (overrides.length) rate.overrides = Object.freeze(overrides);
    }
    result = { rate: Object.freeze(rate), unknown: [...new Set(unknown)] };
  }
  memo.set(pricing, result);
  return result;
}

/**
 * Whether an override's time gates hold at `atMs`. An entry with no time gate holds at any
 * moment. An entry WITH a time gate does not hold when the moment is unknown (`atMs` not a
 * finite number): the base rate is used, as it was before time tiers were modelled.
 *
 * @param {{utcStart?: number, utcEnd?: number, utcDays?: string[]}} entry
 * @param {number|undefined} atMs
 * @returns {boolean}
 */
export function timeGatesHold(entry, atMs) {
  const timed = entry.utcStart !== undefined || entry.utcDays !== undefined;
  if (!timed) return true;
  if (!Number.isFinite(atMs)) return false;
  const at = new Date(atMs);
  if (entry.utcDays !== undefined && !entry.utcDays.includes(DAYS[at.getUTCDay()])) return false;
  if (entry.utcStart !== undefined) {
    const now = at.getUTCHours() * 100 + at.getUTCMinutes();
    const { utcStart: start, utcEnd: end } = entry;
    const inside = end > start ? (now >= start && now < end) : (now >= start || now < end);
    if (!inside) return false;
  }
  return true;
}
