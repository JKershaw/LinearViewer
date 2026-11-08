/**
 * What a model costs, and the pricing of usage (LIN-1495; from the catalog since LIN-4358).
 *
 * Rates come from the live OpenRouter catalog (`lib/openrouter-catalog.js`), converted by
 * `lib/catalog-rate.js`. There is no hand-written rate card any more: the one this file
 * kept (`MODEL_PRICING`, pasted by hand and diffed hourly against the catalog) had gone
 * stale by 8 Nov 2026 for two of its rows, and it never priced a model nobody had pasted.
 * A model the catalog lists is priced the day it appears, long-context and time-of-day
 * tiers included.
 *
 * Two audiences:
 *
 *   1. The model pickers' price hint (`getModelPricingHint`, lib/openrouter.js) and the
 *      landing page, through {@link getDisplayPricing}.
 *   2. `parseUsagePayload` (lib/session-telemetry.js) and the per-request fold
 *      (lib/request-usage-fold.js), which price a dispatched worker's own token usage via
 *      {@link computeUsageCostUsd} / {@link priceRequest}.
 *
 * **Cold catalog.** The catalog is warmed at boot and refreshed in the background
 * (server.js); a warm-but-stale snapshot keeps serving. Before the first successful read,
 * every rate is unknown and every derived cost is `null`. That is honest under this
 * file's null contract, and it does not stick: a derived cost is never stored, it is
 * re-derived from the stored token counts on every read (lib/session-telemetry.js), so
 * the next read after the catalog warms prices it. The same property means a catalog
 * price change restates derived history on its next read, exactly as an edit to the old
 * card did (LIN-2384).
 *
 * **A rate is never a permission.** Being priceable grants no tools and no free-tier
 * access; tools read the catalog's `supported_parameters` and the free-tier clamp reads
 * its own allowlist (lib/openrouter.js).
 *
 * **Why four tiers.** `claude-code` does not route through OpenRouter and has no native
 * cost field anywhere in its transcript, so its cost must be derived. Measured on a real
 * dispatched worker transcript, cache-read is ~92% of all input-side tokens; pricing from
 * prompt/completion rates alone overstates by ~4.4x. A number that wrong is worse than
 * `costUsd: null`, because a wrong number looks authoritative while a null one visibly
 * says "unknown".
 *
 * **Units.** USD per 1M tokens. OpenRouter's `/api/v1/models` reports USD **per token**;
 * lib/catalog-rate.js applies the 1e6 factor once, and {@link priceUsage} divides it back
 * out once.
 *
 * **Cache-write tiers (LIN-2113).** `cacheWrite` is OpenRouter's `input_cache_write`
 * (the 5m ephemeral tier); `cacheWrite1h` is `input_cache_write_1h` (the 1h ephemeral
 * tier), which only some models publish. Claude Code's transcripts carry 5m and 1h cache
 * creation separately, but the runner's `walkUsage` sums both into one
 * `cacheCreationInputTokens` TOTAL and additionally reports the 1h portion alone as
 * `cacheCreation1hInputTokens` — a partition marker on that total, not a second addend.
 * `computeUsageCostUsd` prices the 1h portion (clamped to at most the total) at
 * `cacheWrite1h` and the remainder at `cacheWrite`; a usage object without
 * `cacheCreation1hInputTokens` at all prices its entire cache-write total at
 * `cacheWrite`. A tier the catalog does not publish is absent from the rate, and usage
 * that needs it prices to `null`, not a guess.
 */

import { isRunningTotal } from './row-usage.js';
import { getCachedCatalogModel } from './openrouter-catalog.js';
import { rateFromCatalogPricing, timeGatesHold } from './catalog-rate.js';

/**
 * @typedef {Object} ModelRateOverride
 * @property {number} [minPromptTokens] - Applies when total prompt tokens (inputTokens +
 *   cacheReadInputTokens + cacheCreationInputTokens) are STRICTLY GREATER than this
 *   (OpenRouter's own `min_prompt_tokens` gate — exclusive, not `>=`).
 * @property {number} [utcStart] - Time-of-day gate, HHMM UTC, inclusive (LIN-4358)
 * @property {number} [utcEnd] - Time-of-day gate, HHMM UTC, exclusive; wraps past midnight when <= utcStart
 * @property {string[]} [utcDays] - Day-of-week gate, lowercase UTC day names
 * @property {number} [prompt] - USD per 1M uncached input tokens at this tier
 * @property {number} [completion] - USD per 1M output tokens at this tier
 * @property {number} [cacheRead] - USD per 1M cache-read input tokens at this tier
 * @property {number} [cacheWrite] - USD per 1M cache-write (5m) input tokens at this tier
 * @property {number} [cacheWrite1h] - USD per 1M cache-write (1h) input tokens at this tier
 *
 * @typedef {Object} ModelRate
 * @property {number} prompt      - USD per 1M uncached input tokens
 * @property {number} completion  - USD per 1M output tokens
 * @property {number} [cacheRead]  - USD per 1M cache-read input tokens (absent when unpriced)
 * @property {number} [cacheWrite] - USD per 1M cache-write (5m) input tokens (absent when unpriced)
 * @property {number} [cacheWrite1h] - USD per 1M cache-write (1h) input tokens (absent when unpriced; LIN-2113)
 * @property {ReadonlyArray<ModelRateOverride>} [overrides] - OpenRouter's `pricing.overrides`
 *   in this file's vocabulary (camelCase, USD/1M). Absent tier keys inherit the base row;
 *   when multiple entries apply, later entries win per key (OpenRouter's own merge rule —
 *   see {@link selectRateForPrompt}).
 */

/**
 * The rate for a catalog id, from the cached OpenRouter catalog (LIN-4358), or null when
 * the cache is cold, the id is not listed, or its pricing has no usable base price.
 * Synchronous: it reads the cache and never fetches.
 *
 * @param {string} modelId - An OpenRouter-shaped catalog id, e.g. 'anthropic/claude-opus-4.8'
 * @returns {Readonly<ModelRate>|null}
 */
export function getModelRate(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  return rateFromCatalogPricing(getCachedCatalogModel(modelId)?.pricing);
}

/**
 * The two-tier `{ prompt, completion }` view the price hints show (LIN-993). Returns null for an id with no rate, which the existing contract already
 * handles — `formatModelPricing` degrades to a "—" placeholder rather than lying.
 *
 * Deliberately narrow: the display surface has never shown cache tiers, and widening
 * the object would leak new keys into a shape three render surfaces duck-type.
 *
 * @param {string} modelId
 * @returns {{prompt: number, completion: number}|null}
 */
export function getDisplayPricing(modelId) {
  const rate = getModelRate(modelId);
  if (!rate) return null;
  return { prompt: rate.prompt, completion: rate.completion };
}

/**
 * A worker-reported model string, e.g. `claude-opus-4-8`, mapped to its
 * OpenRouter catalog id, e.g. `anthropic/claude-opus-4.8`. Pure; returns null rather
 * than guessing.
 *
 * Four rules, drawn from the model strings actually observed across 2,624 real worker
 * transcripts:
 *
 *   - an id the catalog prices passes through unchanged (`opencode` reports native
 *     OpenRouter ids, `claude-code` reports its own dashed shorthand);
 *   - a trailing `-YYYYMMDD` build-date suffix is stripped (`claude-haiku-4-5-20251001`);
 *   - version dashes become dots (`claude-opus-4-8` → `claude-opus-4.8`);
 *   - anything else is REJECTED — notably `<synthetic>` (Claude Code's placeholder for
 *     turns it generated itself, which carry a real but zero-token usage object) and
 *     bare aliases like `opus`, which name no specific version and so no specific rate.
 *
 * A resolved id is not a promise of a rate: an id this maps successfully but that the
 * catalog does not list (or a cold catalog) still prices to null in
 * {@link computeUsageCostUsd}. Resolution and rate lookup are separate failures.
 *
 * @param {string} raw - The worker-reported `model` string
 * @returns {string|null} A catalog-shaped id, or null when unmappable
 */
export function resolveWorkerModelId(raw) {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (!id) return null;
  if (getModelRate(id)) return id;

  const undated = id.replace(/-\d{8}$/, '');
  const match = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(undated);
  if (!match) return null;
  return `anthropic/claude-${match[1]}-${match[2].replace(/-/g, '.')}`;
}

/**
 * The raw token fields priced 1:1 against a single rate tier. `cacheCreationInputTokens`
 * is deliberately NOT here (LIN-2113): it splits across two tiers (5m/1h) sharing one
 * total, so it is priced separately in {@link computeUsageCostUsd} below rather than as
 * a fifth flat entry in this loop.
 */
const TOKEN_TIERS = [
  ['inputTokens', 'prompt'],
  ['outputTokens', 'completion'],
  ['cacheReadInputTokens', 'cacheRead'],
];

/**
 * Fold a rate's applicable override entries over the base row, per OpenRouter's own
 * documented rule: an entry applies when every gate it states holds; applicable entries
 * are folded in array order, so a later entry's keys win over an earlier one's; a key an
 * applicable entry omits keeps inheriting the base row (or an earlier entry's value).
 *
 * Gates (lib/catalog-rate.js): `minPromptTokens` holds when `promptTokens` is STRICTLY
 * GREATER (LIN-2403); `utcStart`/`utcEnd`/`utcDays` hold when `atMs` falls inside them
 * (LIN-4358). With no `atMs` a time-gated entry does not apply, so a usage with no moment
 * prices at the base rate, as it did before time tiers were modelled.
 *
 * Pure and allocation-free on the common path: a rate with no `overrides`, or none of
 * whose entries apply, returns the SAME object reference (`===`), never a copy.
 *
 * @param {ModelRate} rate
 * @param {number} promptTokens - inputTokens + cacheReadInputTokens + cacheCreationInputTokens
 * @param {number} [atMs] - the moment of the request, epoch ms, for time-of-day tiers
 * @returns {ModelRate} `rate` itself, or a merged plain object when an override applies
 */
export function selectRateForPrompt(rate, promptTokens, atMs) {
  if (!rate || !Array.isArray(rate.overrides) || rate.overrides.length === 0) return rate;
  let merged = rate;
  for (const entry of rate.overrides) {
    if (!entry) continue;
    if (entry.minPromptTokens !== undefined && !(promptTokens > entry.minPromptTokens)) continue;
    if (!timeGatesHold(entry, atMs)) continue;
    if (merged === rate) merged = { ...rate };
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'minPromptTokens' || key === 'utcStart' || key === 'utcEnd' || key === 'utcDays' || key === 'overrides') continue;
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Derive a session's cost in USD from its raw token counts and the catalog's rates.
 *
 * Returns `null` — never `0`, never `NaN`, never a partial figure — whenever the
 * answer is genuinely unknown, because `costUsd: null` visibly means "unknown" while
 * a wrong number looks authoritative (LIN-1086). The null cases:
 *
 *   - no usage object, or no `model` on it;
 *   - a model string that does not resolve (`<synthetic>`, bare `opus`);
 *   - a resolved id the catalog does not price (or a cold catalog);
 *   - any token field present but non-finite or negative;
 *   - zero tokens in total (nothing was spent to price);
 *   - (LIN-2113) `cacheCreation1hInputTokens` present but non-finite or negative;
 *   - (LIN-2113) `cacheCreation1hInputTokens` present and valid but
 *     `cacheCreationInputTokens` itself absent, non-finite, or negative — a corrupt
 *     payload, since the runner never emits one without the other.
 *
 * A tier the usage actually uses but the rate does not expose (e.g. cache-read tokens
 * on a model with no `cacheRead` rate) is also null: silently dropping those tokens
 * would understate the cost while still looking authoritative. A tier with zero
 * tokens needs no rate.
 *
 * **Cache-write split (LIN-2113).** `cacheCreationInputTokens` is the sole total;
 * `cacheCreation1hInputTokens` is a partition marker on it, never a second addend. The
 * 1h portion is clamped to `min(cacheCreation1hInputTokens, cacheCreationInputTokens)`
 * so a malformed payload where the 1h figure exceeds the total cannot produce a
 * negative `cacheWrite`-priced remainder; the clamped 1h portion prices at
 * `cacheWrite1h` and the rest at `cacheWrite`. If either non-zero portion's rate is
 * absent on the resolved model's row, the whole usage is `null` — never a silent
 * fallback to the other tier's rate. A usage object without `cacheCreation1hInputTokens`
 * at all (every historical row, every OpenCode row) prices its entire cache-write total
 * at `cacheWrite`, byte-identical to before this field existed.
 *
 * **Long-context overrides (LIN-2403).** `promptTokens = inputTokens +
 * cacheReadInputTokens + cacheCreationInputTokens` (the WHOLE prompt, cached tokens
 * included, per OpenRouter's own `min_prompt_tokens` semantics). `min_prompt_tokens`
 * gates a single REQUEST's prompt size — meaningful for a per-request usage row
 * (reported harness `opencode`), but unrecoverable from a session-CUMULATIVE row (any
 * other reported harness, or none: `isRunningTotal`, lib/row-usage.js): summing many small requests can cross a threshold no
 * single request came near. So: an `opencode` row selects the applicable override rate
 * via {@link selectRateForPrompt} normally; a cumulative/unknown-harness row on an
 * override-bearing model whose `promptTokens` clears ANY of its thresholds returns
 * `null` rather than guess under- or over-priced — honest under this function's own
 * null contract. This is live, not a no-op: `anthropic/claude-haiku-5.5` carries an
 * override, and `claude-haiku-5-5` resolves to it, so most Haiku sessions run under
 * `claude-code` and cross 100k cumulatively — they price to null. Whether to model that
 * is an open question (LIN-3916 PR), not something this function decides.
 *
 * Never throws — it sits on the tolerant telemetry path.
 *
 * @param {{model?: string, harness?: string, inputTokens?: number, outputTokens?: number, cacheCreationInputTokens?: number, cacheCreation1hInputTokens?: number, cacheReadInputTokens?: number}} usage
 * @returns {number|null} USD, or null when unpriceable
 */
export function computeUsageCostUsd(usage) {
  return priceUsage(usage, false);
}

/**
 * A request's total prompt size (LIN-2403): input + cache-read + cache-write. The one
 * definition the long-context tiers, the per-request pricing and the intake's 2M bound
 * all read, so they cannot disagree about what "prompt size" means.
 *
 * @param {{inputTokens?: number, cacheReadInputTokens?: number, cacheCreationInputTokens?: number}} usage
 * @returns {number}
 */
export function promptTokensOf(usage) {
  return (usage.inputTokens || 0) + (usage.cacheReadInputTokens || 0) + (usage.cacheCreationInputTokens || 0);
}

/**
 * Price ONE model request (a stored per-request usage record, LIN-4198 / LIN-4195 D5). A sibling of
 * {@link computeUsageCostUsd} rather than a flag on it: the snapshot function's contract and
 * its callers stay as they are, and this one is different in exactly two ways.
 *
 *   - It takes the tier rate for the record's OWN prompt size (selectRateForPrompt), whatever
 *     `harness` says. A record is per-request by construction, so the cumulative-total guard
 *     (`crossesThreshold && isRunningTotal`) is skipped for it. The snapshot path keeps that
 *     guard unchanged.
 *   - A native `costUsd` on the record, when it is a finite number, WINS over the read-time
 *     price, including 0 and including a model the catalog does not price. The harness priced it
 *     at the time of spend, so it is never restated. This is the same precedence as
 *     lib/session-telemetry.js (LIN-4195 review note 4). It is stated here and must be stated
 *     in the docs.
 *
 * Everything else is shared with the snapshot path (priceUsage), so the two cannot drift. A
 * record carries no price: nothing here stores one.
 *
 * Never throws; returns null when the price is genuinely unknown.
 *
 * @param {{model?: string, harness?: string, inputTokens?: number, outputTokens?: number, cacheCreationInputTokens?: number, cacheCreation1hInputTokens?: number, cacheReadInputTokens?: number, costUsd?: number}} record
 * @returns {number|null} USD, or null when unpriceable
 */
export function priceRequest(record) {
  if (!record || typeof record !== 'object') return null;
  if (Number.isFinite(record.costUsd)) return record.costUsd;
  return priceUsage(record, true);
}

/** A record's `at` (Date, ISO string or epoch ms) as epoch ms, or undefined. */
function momentOf(at) {
  if (at instanceof Date) return at.getTime();
  if (typeof at === 'number') return Number.isFinite(at) ? at : undefined;
  if (typeof at === 'string') { const ms = Date.parse(at); return Number.isFinite(ms) ? ms : undefined; }
  return undefined;
}

/**
 * The shared pricing body. `perRequest` true skips the cumulative-total guard: it is only
 * ever true for a record, whose tokens are one request's, so the prompt size is exact.
 *
 * @param {Object} usage
 * @param {boolean} perRequest
 * @returns {number|null}
 */
function priceUsage(usage, perRequest) {
  if (!usage || typeof usage !== 'object') return null;
  const rate = getModelRate(resolveWorkerModelId(usage.model));
  if (!rate) return null;

  // The three fields that make up a request's total prompt size must be validated
  // up front — computeUsageCostUsd's own null contract already requires this of
  // each individually, but override selection (below) needs their sum before the
  // per-tier pricing loop would otherwise reach them.
  for (const field of ['inputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens']) {
    const value = usage[field];
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0)) return null;
  }
  const promptTokens = promptTokensOf(usage);

  let effectiveRate = rate;
  if (Array.isArray(rate.overrides) && rate.overrides.length > 0) {
    const crossesThreshold = rate.overrides.some(
      o => Number.isFinite(o.minPromptTokens) && promptTokens > o.minPromptTokens
    );
    if (!perRequest && crossesThreshold && isRunningTotal(usage)) return null;
    // A record knows its own moment (LIN-4358), so a time-of-day tier applies to it; a
    // session snapshot spans many moments and prices at the base rate.
    effectiveRate = selectRateForPrompt(rate, promptTokens, perRequest ? momentOf(usage.at) : undefined);
  }

  let perMillion = 0;
  let tokenTotal = 0;
  for (const [field, tier] of TOKEN_TIERS) {
    const tokens = usage[field];
    if (tokens === undefined || tokens === null) continue;
    if (!Number.isFinite(tokens) || tokens < 0) return null;
    if (tokens === 0) continue;
    if (!Number.isFinite(effectiveRate[tier])) return null; // priced tier missing → unknown, not free
    perMillion += tokens * effectiveRate[tier];
    tokenTotal += tokens;
  }

  // cacheCreationInputTokens splits across two tiers (5m/1h) sharing one total, so it
  // is priced here rather than as a fifth entry in the flat loop above (LIN-2113).
  const total = usage.cacheCreationInputTokens;
  const oneHour = usage.cacheCreation1hInputTokens;
  const oneHourPresent = oneHour !== undefined && oneHour !== null;
  if (oneHourPresent && (!Number.isFinite(oneHour) || oneHour < 0)) return null;

  if (total === undefined || total === null) {
    // Absent-field backward compatibility: no cache-write tokens to price. But a 1h
    // count with no total to partition is a corrupt payload (the runner never emits
    // one without the other) — never guess, return null (N1).
    if (oneHourPresent) return null;
  } else {
    if (!Number.isFinite(total) || total < 0) return null;
    if (total > 0) {
      const capped1h = Math.min(oneHourPresent ? oneHour : 0, total);
      const remainder5m = total - capped1h;
      if (capped1h > 0) {
        if (!Number.isFinite(effectiveRate.cacheWrite1h)) return null; // priced tier missing → unknown, not free
        perMillion += capped1h * effectiveRate.cacheWrite1h;
      }
      if (remainder5m > 0) {
        if (!Number.isFinite(effectiveRate.cacheWrite)) return null; // priced tier missing → unknown, not free
        perMillion += remainder5m * effectiveRate.cacheWrite;
      }
      tokenTotal += total;
    }
  }

  if (tokenTotal === 0) return null;

  // The 1e6 factor between the rate (USD per 1M) and per-token cost, applied ONCE.
  return perMillion / 1e6;
}
