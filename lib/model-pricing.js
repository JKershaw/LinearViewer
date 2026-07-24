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
 * **This table is a SUPERSET of the allowlist, and deliberately so.** It carries
 * worker models (`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4.5`) that must
 * be priceable but must NOT become user-selectable — `AVAILABLE_MODELS` also gates
 * `isToolCapableModel` and the fail-closed free-tier clamp (LIN-513/LIN-1333), so a
 * row here is a rate, never a permission. Membership flows one way only:
 * `AVAILABLE_MODELS` reads rates from this table; this table never reads membership
 * from it.
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
 * **Cache-write tier.** `cacheWrite` is OpenRouter's `input_cache_write`, i.e. the 5m
 * ephemeral tier. Claude Code's transcripts carry 5m and 1h cache creation separately,
 * but the runner's `walkUsage` collapses them into one `cacheCreationInputTokens`
 * field, so the 1h portion is priced at the 5m rate — a bounded UNDERSTATEMENT on 1h
 * cache writes only. Accepted deliberately; widening the payload is a runner change.
 *
 * POINT-IN-TIME RATES — verified against https://openrouter.ai/api/v1/models on
 * 2026-07-24. OpenRouter prices change; re-verify against that endpoint when editing
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
 */

/** @type {Readonly<Record<string, ModelRate>>} */
export const MODEL_PRICING = Object.freeze({
  // Curated / user-selectable (mirrored into AVAILABLE_MODELS' display pricing)
  'openai/gpt-5.4-mini': { prompt: 0.75, completion: 4.50, cacheRead: 0.075 },
  'anthropic/claude-sonnet-4.6': { prompt: 3.00, completion: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'anthropic/claude-opus-4.8': { prompt: 5.00, completion: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
  'openai/gpt-5.5': { prompt: 5.00, completion: 30.00, cacheRead: 0.50 },
  'openai/gpt-5.5-pro': { prompt: 30.00, completion: 180.00 },

  // Worker models — priceable, NOT user-selectable (see the allowlist note above)
  'anthropic/claude-opus-5': { prompt: 5.00, completion: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
  'anthropic/claude-sonnet-5': { prompt: 2.00, completion: 10.00, cacheRead: 0.20, cacheWrite: 2.50 },
  'anthropic/claude-haiku-4.5': { prompt: 1.00, completion: 5.00, cacheRead: 0.10, cacheWrite: 1.25 },
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

/** The four raw token fields, paired with the rate tier each is billed at. */
const TOKEN_TIERS = [
  ['inputTokens', 'prompt'],
  ['outputTokens', 'completion'],
  ['cacheCreationInputTokens', 'cacheWrite'],
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
 *   - zero tokens in total (nothing was spent to price).
 *
 * A tier the usage actually uses but the rate does not expose (e.g. cache-read tokens
 * on a model with no `cacheRead` rate) is also null: silently dropping those tokens
 * would understate the cost while still looking authoritative. A tier with zero
 * tokens needs no rate.
 *
 * Never throws — it sits on the tolerant telemetry path.
 *
 * @param {{model?: string, inputTokens?: number, outputTokens?: number, cacheCreationInputTokens?: number, cacheReadInputTokens?: number}} usage
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
  if (tokenTotal === 0) return null;

  // The 1e6 factor between this table (USD per 1M) and per-token cost, applied ONCE.
  return perMillion / 1e6;
}
