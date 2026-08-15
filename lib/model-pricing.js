/**
 * Shared model rate card (LIN-1495) — the ONE representation of what a model costs.
 *
 * This is the extraction of the rate card that used to live inline in
 * `lib/openrouter.js`'s `AVAILABLE_MODELS` (LIN-993), widened from two tiers to
 * four so worker token usage can actually be priced. It has two audiences that
 * must not be conflated:
 *
 *   1. `AVAILABLE_MODELS` (lib/openrouter.js) — the CURATED, user-facing allowlist.
 *      It derives its `{ prompt, completion }` display pricing from this table via
 *      {@link getDisplayPricing}, so the same human edit that adds a model still
 *      adds its rate (LIN-993's charter) with no second table to hand-sync.
 *   2. `parseUsagePayload` (lib/session-telemetry.js) — prices a dispatched worker's
 *      own token usage via {@link computeUsageCostUsd}.
 *
 * **This table is a SUPERSET of the allowlist, and deliberately so.** A row here is
 * a rate, never a permission — `AVAILABLE_MODELS` also gates `isToolCapableModel`
 * and the fail-closed free-tier clamp (LIN-513/LIN-1333). Membership flows one way
 * only: `AVAILABLE_MODELS` reads rates from this table; this table never reads
 * membership from it. As of LIN-1763 every row below is curated/user-selectable —
 * there is no longer a priceable-but-not-selectable worker block — but the
 * superset invariant itself still holds and future dispatched-worker-only ids
 * would land the same way: priceable here without being added to the allowlist.
 *
 * **Why four tiers.** `claude-code` does not route through OpenRouter and has no
 * native cost field anywhere in its transcript, so its cost must be derived. Measured
 * on a real dispatched worker transcript, cache-read is ~92% of all input-side tokens;
 * pricing from prompt/completion rates alone overstates by ~4.4x. A number that wrong
 * is worse than `costUsd: null`, because a wrong number looks authoritative while a
 * null one visibly says "unknown".
 *
 * **Units.** USD per 1M tokens, matching the convention `AVAILABLE_MODELS` has always
 * used. OpenRouter's `/api/v1/models` reports USD **per token** (`prompt: 0.000005`),
 * so there is a 1e6 factor between the two representations — apply it exactly once
 * (see {@link computeUsageCostUsd}).
 *
 * **Cache-write tiers (LIN-2113).** `cacheWrite` is OpenRouter's `input_cache_write`
 * (the 5m ephemeral tier); `cacheWrite1h` is `input_cache_write_1h` (the 1h ephemeral
 * tier), present only on the 6 `anthropic/claude-*` rows — `openai/gpt-5.6-sol` exposes
 * `input_cache_write` but no 1h tier, so it deliberately has no `cacheWrite1h` row.
 * Claude Code's transcripts carry 5m and 1h cache creation separately, but the runner's
 * `walkUsage` sums both into one `cacheCreationInputTokens` TOTAL and additionally
 * reports the 1h portion alone as `cacheCreation1hInputTokens` — a partition marker on
 * that total, not a second addend. `computeUsageCostUsd` prices the 1h portion (clamped
 * to at most the total) at `cacheWrite1h` and the remainder at `cacheWrite`; a usage
 * object without `cacheCreation1hInputTokens` at all prices its entire cache-write total
 * at `cacheWrite`, exactly as before this field existed.
 *
 * POINT-IN-TIME RATES — verified against https://openrouter.ai/api/v1/models on
 * 2026-07-24 (2026-08-01 for the LIN-1763 additions; 2026-08-15 for the LIN-2113
 * `cacheWrite1h` additions). OpenRouter prices change;
 * re-verify against that endpoint when editing
 * this table, and treat these as indicative, not billed. Omit a tier a model does not
 * expose rather than inventing one — an absent tier that the usage actually needs
 * yields `null`, not a guess.
 *
 * The live catalog (`lib/openrouter-catalog.js`) is deliberately NOT consulted here:
 * it is async and degrades to `[]` on network failure, which would turn every
 * transient OpenRouter blip into a silently-null cost. It supplements, never replaces.
 */

/**
 * @typedef {Object} ModelRate
 * @property {number} prompt      - USD per 1M uncached input tokens
 * @property {number} completion  - USD per 1M output tokens
 * @property {number} [cacheRead]  - USD per 1M cache-read input tokens (absent when unpriced)
 * @property {number} [cacheWrite] - USD per 1M cache-write (5m) input tokens (absent when unpriced)
 * @property {number} [cacheWrite1h] - USD per 1M cache-write (1h) input tokens (absent when unpriced; LIN-2113)
 */

/** Freeze the table and every rate row inside it. */
function deepFreezeRates(table) {
  for (const rate of Object.values(table)) Object.freeze(rate);
  return Object.freeze(table);
}

/**
 * Frozen rows as well as a frozen table: `getModelRate` hands the live row to its
 * caller, and a rate card that a consumer can mutate is not one representation.
 *
 * @type {Readonly<Record<string, Readonly<ModelRate>>>}
 */
export const MODEL_PRICING = deepFreezeRates({
  // Curated / user-selectable (mirrored into AVAILABLE_MODELS' display pricing)
  'openai/gpt-5.4-mini': { prompt: 0.75, completion: 4.50, cacheRead: 0.075 },
  'anthropic/claude-sonnet-4.6': { prompt: 3.00, completion: 15.00, cacheRead: 0.30, cacheWrite: 3.75, cacheWrite1h: 6.00 },
  'anthropic/claude-opus-4.8': { prompt: 5.00, completion: 25.00, cacheRead: 0.50, cacheWrite: 6.25, cacheWrite1h: 10.00 },
  'openai/gpt-5.5': { prompt: 5.00, completion: 30.00, cacheRead: 0.50 },
  'openai/gpt-5.5-pro': { prompt: 30.00, completion: 180.00 },
  'anthropic/claude-opus-5': { prompt: 5.00, completion: 25.00, cacheRead: 0.50, cacheWrite: 6.25, cacheWrite1h: 10.00 },
  'anthropic/claude-sonnet-5': { prompt: 2.00, completion: 10.00, cacheRead: 0.20, cacheWrite: 2.50, cacheWrite1h: 4.00 },
  'anthropic/claude-fable-5': { prompt: 10.00, completion: 50.00, cacheRead: 1.00, cacheWrite: 12.50, cacheWrite1h: 20.00 },
  'anthropic/claude-haiku-4.5': { prompt: 1.00, completion: 5.00, cacheRead: 0.10, cacheWrite: 1.25, cacheWrite1h: 2.00 },
  'openai/gpt-5.6-sol': { prompt: 5.00, completion: 30.00, cacheRead: 0.50, cacheWrite: 6.25 },
});

/**
 * The rate row for a catalog id, or null when the id carries no known rate.
 *
 * @param {string} modelId - An OpenRouter-shaped catalog id, e.g. 'anthropic/claude-opus-4.8'
 * @returns {ModelRate|null}
 */
export function getModelRate(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(MODEL_PRICING, modelId)
    ? MODEL_PRICING[modelId]
    : null;
}

/**
 * The two-tier `{ prompt, completion }` view `AVAILABLE_MODELS` entries publish
 * (LIN-993). Returns null for an id with no rate, which the existing contract already
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
 * A worker-reported model string, e.g. `claude-opus-4-8`, mapped to this table's
 * OpenRouter-shaped id, e.g. `anthropic/claude-opus-4.8`. Pure; returns null rather
 * than guessing.
 *
 * Four rules, drawn from the model strings actually observed across 2,624 real worker
 * transcripts:
 *
 *   - an id already in the table passes through unchanged (`opencode` reports native
 *     OpenRouter ids, `claude-code` reports its own dashed shorthand);
 *   - a trailing `-YYYYMMDD` build-date suffix is stripped (`claude-haiku-4-5-20251001`);
 *   - version dashes become dots (`claude-opus-4-8` → `claude-opus-4.8`);
 *   - anything else is REJECTED — notably `<synthetic>` (Claude Code's placeholder for
 *     turns it generated itself, which carry a real but zero-token usage object) and
 *     bare aliases like `opus`, which name no specific version and so no specific rate.
 *
 * A resolved id is not a promise of a rate: an id this maps successfully but that has
 * no row (a model newer than this table) still prices to null in
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
 * Derive a session's cost in USD from its raw token counts and this table's rates.
 *
 * Returns `null` — never `0`, never `NaN`, never a partial figure — whenever the
 * answer is genuinely unknown, because `costUsd: null` visibly means "unknown" while
 * a wrong number looks authoritative (LIN-1086). The null cases:
 *
 *   - no usage object, or no `model` on it;
 *   - a model string that does not resolve (`<synthetic>`, bare `opus`);
 *   - a resolved id with no rate row in this table;
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
 * Never throws — it sits on the tolerant telemetry path.
 *
 * @param {{model?: string, inputTokens?: number, outputTokens?: number, cacheCreationInputTokens?: number, cacheCreation1hInputTokens?: number, cacheReadInputTokens?: number}} usage
 * @returns {number|null} USD, or null when unpriceable
 */
export function computeUsageCostUsd(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const rate = getModelRate(resolveWorkerModelId(usage.model));
  if (!rate) return null;

  let perMillion = 0;
  let tokenTotal = 0;
  for (const [field, tier] of TOKEN_TIERS) {
    const tokens = usage[field];
    if (tokens === undefined || tokens === null) continue;
    if (!Number.isFinite(tokens) || tokens < 0) return null;
    if (tokens === 0) continue;
    if (!Number.isFinite(rate[tier])) return null; // priced tier missing → unknown, not free
    perMillion += tokens * rate[tier];
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
        if (!Number.isFinite(rate.cacheWrite1h)) return null; // priced tier missing → unknown, not free
        perMillion += capped1h * rate.cacheWrite1h;
      }
      if (remainder5m > 0) {
        if (!Number.isFinite(rate.cacheWrite)) return null; // priced tier missing → unknown, not free
        perMillion += remainder5m * rate.cacheWrite;
      }
      tokenTotal += total;
    }
  }

  if (tokenTotal === 0) return null;

  // The 1e6 factor between this table (USD per 1M) and per-token cost, applied ONCE.
  return perMillion / 1e6;
}
