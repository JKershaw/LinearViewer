/**
 * OpenRouter API Client
 *
 * Provides AI recommendations for which prompt to use next on a Linear task.
 * Uses OpenRouter to access various LLM providers with a unified API.
 */

import https from 'https';
import { deriveDispatchKind, generatePrompt } from './prompt-templates.js';
import { formatAttachmentsSection } from './prompt-formatters.js';
// LIN-3304: the next-stage choice's own seam — the routing prompt, its contract and
// its parse.
import { buildRouterPrompt, routeStage, parseRecommendedAction, parseDeferTo } from './stage-router.js';
import { isTerminalState } from './providers/state-map.js';
import {
  compareByIdentifier, assembleNodeFacts, condensePlan,
  assembleTrailFacts, formatTrailFactsBlock, formatNodeFactsBlock
} from './recommendation-facts.js';
import { isRuling, isPersonComment } from './run-trail.js';
import { getDisplayPricing, resolveWorkerModelId } from './model-pricing.js';
import { getCachedCatalogModel } from './openrouter-catalog.js';
import {
  REASONING_MIN_TOKENS, REASONING_MAX_TOKENS, defaultReasoningTokens,
  planCallBudget, planRetryBudget, promptCharsOf
} from './call-budget.js';
import { claudeAliasModel } from './model-routing-harnesses.js';
import { formatRecentRuns } from './recent-runs.js';
import { CODE_ROUTES } from './code-routes.js';

// Overridable via OPENROUTER_API_URL so the full-system hermetic test suite can point
// Harbour's real model calls at a wire-fake OpenRouter endpoint (Tap 1). Defaults to the
// live OpenRouter chat-completions URL in every normal run.
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
// Validated as the default for every per-task LLM call (recommend, brief, recap) by the
// LIN-263 benchmark: GPT-5.4-Mini matched or beat Opus 4.8 across synthetic, real,
// node/defer, and dense-leaf cases at K=3, and was the only non-Opus model to pass brief
// AND recap cleanly — at ~1/6 Opus's cost and several× the speed. (Haiku 4.5, the prior
// default, repeatably mis-reads dense tickets; see scripts/eval/lin-263-findings.md.)
export const DEFAULT_MODEL = 'openai/gpt-5.4-mini';
const REQUEST_TIMEOUT_MS = 120000;

// ---------------------------------------------------------------------------
// Reasoning-token budget split (LIN-1000)
//
// Reasoning models (first measured on openai/gpt-5.4-mini and the LIN-819
// GPT-5.5 / GPT-5.5 Pro overrides) spend hidden reasoning tokens against the
// SAME completion budget as visible prose. Since LIN-4358 which models take the
// explicit split is read from the catalog alone (isReasoningModel below). A live OpenRouter spike confirmed
// this: with `reasoning: { max_tokens: N }` accepted for gpt-5.x, the returned
// `completion_tokens_details.reasoning_tokens` are billed INSIDE
// `completion_tokens`. So a bare `max_tokens` lets a heavy reasoning run exhaust
// the budget and truncate visible output (finish_reason: 'length') no matter how
// high the prose cap is. The structural fix is an explicit split: bound reasoning
// with OpenRouter's unified `reasoning: { max_tokens }` field AND size the request
// `max_tokens = prose + reasoning` so the prose budget survives the reasoning run.
//
// This helper is where that arithmetic lives — one pure, unit-tested unit. Call
// sites pass the visible-prose budget they want guaranteed and receive the wire
// values (`reasoning`, `maxTokens`) to thread into streamChat. The `reasoning`
// option is opt-in: a caller that does not pass it keeps today's request body
// byte-identical (see streamChat).
// ---------------------------------------------------------------------------

// Reasoning headroom reserved ON TOP of the prose budget (REASONING_MIN_TOKENS,
// REASONING_MAX_TOKENS, defaultReasoningTokens) lives with the call budget:
// import it from lib/call-budget.js (LIN-4358).

/**
 * Whether a model has thinking ON by default, so an explicit reasoning bound only
 * limits it (and therefore the explicit split applies).
 *
 * Rule (LIN-4358, from the catalog alone): split <=> the cached catalog entry says
 * `reasoning.mandatory` or `reasoning.default_enabled === true`. The hand list of
 * OpenAI prefixes that used to be unioned in (`REASONING_MODEL_PREFIXES`) is gone.
 *
 * Deliberately NOT "has a `reasoning` object" or `supported_parameters.includes('reasoning')`:
 * those mean the model CAN reason. Sending `reasoning.max_tokens` to a model whose
 * thinking is off by default turns it on and changes cost (LIN-1665 measured 0 chars /
 * finish_reason 'length' on gpt-5.4-mini). Such a model (gpt-5.4-mini, whose catalog
 * entry says `default_enabled: false`; claude-haiku-5.5, which does not say) still gets
 * room for hidden reasoning: the call layer (lib/call-budget.js `planCallBudget`) adds
 * headroom for every model whose catalog entry can reason, without a `reasoning` field,
 * and retries once with an explicit bound if hidden reasoning still eats the cap. So the
 * prefix list's only remaining job, an up-front explicit bound for gpt-5.x on the
 * roadmap and Ship's Biscuit calls, became the thing LIN-1665 warned against, and it
 * went. A cold cache or an unlisted id gives no signal: no explicit split, and the call
 * layer sends the requested cap.
 *
 * @param {string} model - Model id (e.g. 'openai/gpt-6.1-sol')
 * @returns {boolean}
 */
export function isReasoningModel(model) {
  const r = getCachedCatalogModel(String(model || ''))?.reasoning;
  return !!(r && (r.mandatory === true || r.default_enabled === true));
}

/**
 * Resolve the reasoning/prose budget split for a streamChat call (LIN-1000).
 *
 * Pure. Given the visible-prose budget the caller wants guaranteed, returns the
 * wire values to pass to streamChat: an OpenRouter `reasoning` field that bounds
 * hidden reasoning, and a `maxTokens` sized to cover reasoning + prose so the
 * prose budget survives a heavy reasoning run.
 *
 * For a non-reasoning model the split is a no-op: `reasoning` is undefined
 * (streamChat omits the field ⇒ byte-identical body) and `maxTokens` equals the
 * prose budget unchanged. This is what keeps the option safe to thread onto a
 * call site whose model is user-selectable.
 *
 * @param {Object} args
 * @param {string} args.model - Model id (decides whether the split applies).
 * @param {number} args.proseTokens - Visible-output budget to guarantee.
 * @param {number} [args.reasoningTokens] - Explicit reasoning cap; default is the
 *   prose budget clamped to [REASONING_MIN_TOKENS, REASONING_MAX_TOKENS].
 * @returns {{ reasoning: ({max_tokens: number}|undefined), maxTokens: number }}
 */
export function resolveReasoningBudget({ model, proseTokens, reasoningTokens } = {}) {
  const prose = Math.max(1, Math.floor(Number(proseTokens) || 0));
  if (!isReasoningModel(model)) {
    return { reasoning: undefined, maxTokens: prose };
  }
  const reasoning = reasoningTokens != null
    ? Math.max(0, Math.floor(Number(reasoningTokens)))
    : defaultReasoningTokens(prose);
  return { reasoning: { max_tokens: reasoning }, maxTokens: prose + reasoning };
}

/**
 * Output token cap for the routing reply. Since LIN-3300 the reply is reasoning and a
 * decision only (code assembles the prompt), so 8000 is headroom, not a budget a prompt
 * body competes for.
 */
const RECOMMENDATION_MAX_TOKENS = 8000;

/**
 * The routing call's wire budget (LIN-4358): the 8000 visible-output cap sized through
 * lib/call-budget.js like every other call, so a model the catalog lists as reasoning
 * gets headroom above it and every model is clamped to its catalog output limit.
 * Shared by the streaming and buffered routing paths so they send the same budget.
 *
 * @param {string} model
 * @param {string} metaPrompt
 * @returns {{ maxTokens: number, reasoning: (Object|undefined) }}
 */
function planRoutingBudget(model, metaPrompt) {
  return planCallBudget({
    model,
    maxTokens: RECOMMENDATION_MAX_TOKENS,
    promptChars: promptCharsOf([{ role: 'user', content: metaPrompt }])
  });
}

/**
 * Epic-shape detection: a parent counts as epic-shaped when it has at least this
 * many children. Tunes the "is this big enough that cousins matter?" check.
 */
export const EPIC_CHILD_THRESHOLD = 4;

/**
 * Hard cap on cousins (grandchildren via siblings) rendered into prompt context.
 * Hard, not soft: epic-of-epics can produce hundreds of cousins, and an unbounded
 * list both bloats the prompt window and hides the silent-truncation failure mode
 * LIN-279 exists to prevent. When the cap fires, formatIssueContext appends an
 * explicit MCP-fetch nudge instead of a bare "…and N more".
 */
export const COUSIN_CAP = 20;

/**
 * Hard cap on siblings (other children of the same parent) rendered into prompt
 * context. Same shape as COUSIN_CAP: when the cap fires, formatIssueContext
 * appends an explicit MCP-fetch nudge instead of leaving the truncation silent —
 * the failure mode LIN-284 exists to prevent.
 */
export const SIBLING_CAP = 5;

/**
 * Tracker-language regex for epic-shaped parent detection. Matches case-insensitively:
 * - whole word "Phase", "Migration", "Epic"
 * - titles containing a Unicode em-dash (—), the convention for "X — Y" epic titles.
 *   NOTE: this is the em-dash character (U+2014), NOT a hyphen-minus.
 */
export const EPIC_TITLE_PATTERN = /\b(phase|migration|epic)\b|—/i;

/**
 * Decide whether a parent task is epic-shaped — i.e., big enough that
 * grandchildren via siblings ("cousins") are likely to matter when the plan weighs a route around a contract gap.
 *
 * Returns true when EITHER the parent has at least EPIC_CHILD_THRESHOLD children
 * OR the parent title matches EPIC_TITLE_PATTERN.
 *
 * Fail-safe toward inclusion: when child count is unknown but the title carries
 * tracker language ("Migration", "Phase", "Epic", em-dash), include. Only return
 * false when there is genuinely no signal of epic-shape.
 *
 * @param {Object|null} parent - Parent issue object with at least a `title`
 * @param {number|null} parentChildCount - Total number of children on the parent
 * @returns {boolean}
 */
export function isEpicShapedParent(parent, parentChildCount) {
  if (!parent) return false;
  if (typeof parentChildCount === 'number' && parentChildCount >= EPIC_CHILD_THRESHOLD) {
    return true;
  }
  if (parent.title && EPIC_TITLE_PATTERN.test(parent.title)) {
    return true;
  }
  return false;
}

/**
 * The models Harbour suggests first in its model pickers (LIN-263, LIN-993; ids only
 * since LIN-4358).
 *
 * This list remains, and it is the only thing it holds: WHICH models are suggested is a
 * person's choice, and the ticket that removed the facts kept that choice with people.
 * Every fact about these models is read from the OpenRouter catalog, like any other model:
 * the name ({@link getModelDisplayName}), the price ({@link getModelPricingHint}), tools
 * ({@link supportsTools}), reasoning and output limits (lib/call-budget.js). Being
 * suggested grants nothing: it is not the free-tier allowlist ({@link FREE_TIER_MODEL_IDS})
 * and it is not what a picker offers. Every picker offers the whole catalog after these
 * (`buildModelOptions`, lib/openrouter-catalog.js), so a model released tomorrow is
 * offered, named, priced and budgeted the day the catalog lists it, without an edit here.
 *
 * Kept honest by tests/unit/catalog-model-facts.test.js: every id here must be listed,
 * priced and tool-capable in the pinned catalog snapshot, so a retired or renamed
 * suggestion fails a test instead of offering a model that cannot run.
 *
 * History of the choice: GPT-5.4 Mini was the LIN-263 benchmark winner (passes recommend
 * + brief + recap). Haiku 4.5 was added on request (LIN-1763) despite LIN-263 finding it
 * mis-reads dense tickets. GPT-6.1 Sol and Claude Haiku 5.5 were added with LIN-4358,
 * because both had run the brief by 7 Nov 2026 (Sol is where the brief runs; Haiku 5.5
 * waits on the replay named in docs/areas/llm-and-prompts.md before any call moves to it).
 * Per-call recommendations, dated and with evidence: docs/papers/harbour/model-choice-by-call.md.
 */
export const SUGGESTED_MODEL_IDS = Object.freeze([
  'openai/gpt-5.4-mini',
  'openai/gpt-6.1-sol',
  'anthropic/claude-haiku-5.5',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.8',
  'openai/gpt-5.5',
  'openai/gpt-5.5-pro',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-opus-5',
  'anthropic/claude-fable-5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5.6-sol',
]);

/** True when an id is one of the suggested models. */
export function isSuggestedModel(id) {
  return typeof id === 'string' && SUGGESTED_MODEL_IDS.includes(id);
}

/**
 * The suggested models as picker entries `{ id, name, pricing }`, with the name and the
 * two-tier price (USD per 1M, or null when unknown) read from the catalog at call time.
 * A function, not a constant, because the facts change when the catalog does.
 *
 * @returns {Array<{id: string, name: string, pricing: ({prompt: number, completion: number}|null)}>}
 */
export function suggestedModels() {
  return SUGGESTED_MODEL_IDS.map(id => ({ id, name: getModelDisplayName(id), pricing: getDisplayPricing(id) }));
}

/**
 * Format a model's two-tier price into a compact one-line hint for the UI (LIN-993).
 * Returns null when the model has no known `pricing` (a cold catalog, or an id the
 * catalog does not list), so callers can render a "—" placeholder.
 *
 * @param {Object|null} model - A `suggestedModels()` entry (or any object with `pricing`)
 * @returns {string|null} e.g. "$0.75 in / $4.50 out per 1M tokens"
 */
export function formatModelPricing(model) {
  const p = model && model.pricing;
  if (!p || typeof p.prompt !== 'number' || typeof p.completion !== 'number') return null;
  return `$${p.prompt.toFixed(2)} in / $${p.completion.toFixed(2)} out per 1M tokens`;
}

/**
 * The formatted rate for a worker-reported Claude id (`claude-sonnet-5-5`), through the same resolution a run's
 * usage is priced by (LIN-3987). Null when the id maps to no rate row.
 *
 * @param {string} workerId - The model string a run reports
 * @returns {string|null} e.g. "$2.00 in / $10.00 out per 1M tokens"
 */
export function workerModelPricingHint(workerId) {
  return formatModelPricing({ pricing: getDisplayPricing(resolveWorkerModelId(workerId)) });
}

/**
 * Look up the formatted pricing hint for a model ID (LIN-993). Convenience wrapper
 * over formatModelPricing for callers that only have the id string.
 *
 * @param {string} modelId - Model ID
 * @returns {string|null} Formatted pricing hint, or null when unknown
 */
export function getModelPricingHint(modelId) {
  // LIN-3987: a bare Claude Code alias prices as the model it runs (lib/model-routing-harnesses.js).
  const aliased = claudeAliasModel(modelId);
  if (aliased) return workerModelPricingHint(aliased);
  // LIN-4358: the catalog is the one source (lib/catalog-rate.js), for suggested and
  // catalog-only ids alike. Variable-priced routers (OpenRouter publishes -1) price to
  // null and are never shown as a rate.
  return formatModelPricing({ pricing: getDisplayPricing(modelId) });
}

/**
 * Friendly display name for a model ID, for compact UI surfaces like the footer and the decision panel.
 *
 * One rule, extended in place (LIN-3962, LIN-3987, LIN-4358): the live catalog's name, without
 * OpenRouter's "Provider: " prefix ("Anthropic: Claude Haiku 5.5" → "Claude Haiku 5.5"); else, for a bare
 * Claude Code alias, the name of the model it runs ("Claude Sonnet 5.5"); else, for a Claude id the catalog
 * does not key, its name in the same form ('claude-sonnet-5-5' → "Claude Sonnet 5.5"); else the
 * provider-stripped slug (e.g. 'openai/gpt-5.4-mini' → 'gpt-5.4-mini', which is also what a cold catalog shows).
 *
 * @param {string} modelId - Model ID (defaults to DEFAULT_MODEL when falsy)
 * @returns {string} Short display name
 */
export function getModelDisplayName(modelId) {
  const id = modelId || DEFAULT_MODEL;
  const catalogName = getCachedCatalogModel(id)?.name;
  if (catalogName && catalogName !== id) return catalogName.replace(/^[^:]{1,40}:\s+/, '');
  const aliased = claudeAliasModel(id);
  if (aliased) return getModelDisplayName(aliased);
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (claude) {
    const family = claude[1].charAt(0).toUpperCase() + claude[1].slice(1);
    return `Claude ${family} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  }
  return id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
}

/**
 * Whether a model supports the tool-calling round-trip (LIN-990, LIN-3882, LIN-4358).
 *
 * Source order: (1) a cached catalog entry that HAS a `supported_parameters` array
 * answers by `includes('tools')`; (2) otherwise, only while the catalog has no answer
 * (a cold cache, or an entry with no `supported_parameters`), a suggested model
 * ({@link SUGGESTED_MODEL_IDS}) is taken as capable, so a catalog outage at boot never
 * strips tools from the models Harbour runs today. That fallback cannot lie while it is
 * pinned: tests/unit/catalog-model-facts.test.js requires every suggested id to take
 * tools in the pinned catalog. (3) Otherwise false: unknown is not capable, and the
 * caller degrades to plain streaming rather than offer tools a model may not honor.
 * Sync by design: it reads the module cache and never fetches.
 *
 * @param {string} modelId - Model ID (e.g. 'openai/gpt-5.4-mini')
 * @returns {boolean}
 */
export function supportsTools(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  const params = getCachedCatalogModel(modelId)?.supported_parameters;
  if (Array.isArray(params)) return params.includes('tools');
  return isSuggestedModel(modelId);
}

export function isToolCapableModel(modelId) {
  return supportsTools(modelId);
}

/**
 * The free-tier allowlist (LIN-1333/LIN-513): the ids an operator may set as
 * OPENROUTER_FREE_TIER_MODEL. Deliberately its own fixed list, NOT derived from
 * {@link SUGGESTED_MODEL_IDS} or the catalog: free-tier calls bill against the operator's
 * shared key, so this fails closed.
 *
 * Why this hand list remains (LIN-4358): it encodes what may be spent on the operator's
 * key, which stays a person's choice. A catalog rule (a price ceiling) would let a cold or
 * wrong catalog decide that spending, so the allowlist stays and fails closed (John's
 * ruling on LIN-4358). openai/gpt-6-luna, cheaper than gpt-5.4-mini and ahead of it on the
 * boards that score both, joins only once every free-tier job has come back whole on it
 * (docs/papers/harbour/model-choice-by-call.md, The free tier). Which allowed model the
 * free tier runs on is OPENROUTER_FREE_TIER_MODEL, else DEFAULT_MODEL.
 */
export const FREE_TIER_MODEL_IDS = [
  'openai/gpt-5.4-mini',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.8',
  'openai/gpt-5.5',
  'openai/gpt-5.5-pro',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-opus-5',
  'anthropic/claude-fable-5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5.6-sol',
];

/**
 * The model free-tier requests are clamped to (LIN-1333).
 *
 * Free-tier calls bill against the operator's shared OPENROUTER_FREE_TIER_KEY, so the
 * clamp in resolveWorkspaceModel/resolveAiOperationModel (lib/workspace-preferences.js)
 * refuses the workspace's own preference (LIN-513). This resolves the value that clamp
 * returns, so an operator can run the free tier on a different model per environment —
 * the same way FREE_TIER_RUN_LIMIT/FREE_TIER_HOURLY_LIMIT tune its other knobs —
 * without moving DEFAULT_MODEL for every workspace that has no stored preference.
 *
 * Fails closed against the curated allowlist: an unset, empty, or uncurated value keeps
 * the free tier on DEFAULT_MODEL. An unchecked env value would reach OpenRouter as-is
 * and become the one path that bills an arbitrary model against the shared key — exactly
 * what the clamp exists to prevent. Validating here mirrors the same allowlist gate
 * resolveRoadmapModelOverride already applies to the per-request override path.
 *
 * Silent by design — a rejected value is reported once at startup via
 * {@link getFreeTierModelConfigWarning} rather than on every LLM call. Read per call
 * rather than at module load so this stays a pure function under test; a config-var
 * change restarts the process anyway, so there is no liveness difference.
 *
 * @returns {string} A curated model id: the env override when valid, else DEFAULT_MODEL
 */
export function resolveFreeTierModel() {
  const raw = process.env.OPENROUTER_FREE_TIER_MODEL;
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (id && FREE_TIER_MODEL_IDS.includes(id)) return id;
  return DEFAULT_MODEL;
}

/**
 * Startup validation for OPENROUTER_FREE_TIER_MODEL (LIN-1333).
 *
 * {@link resolveFreeTierModel} fails closed, so a typo'd model id degrades silently to
 * DEFAULT_MODEL — the free tier keeps working and the operator never learns their
 * setting was ignored. This returns the warning text for that case so server.js can
 * surface it once at boot, where an operator setting the var will actually see it.
 *
 * @returns {string|null} Warning text when the var is set but uncurated, else null
 */
export function getFreeTierModelConfigWarning() {
  const raw = process.env.OPENROUTER_FREE_TIER_MODEL;
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id || FREE_TIER_MODEL_IDS.includes(id)) return null;
  return `OPENROUTER_FREE_TIER_MODEL="${id}" is not a curated model id — ignoring it. `
    + `Free-tier requests stay on ${DEFAULT_MODEL}. `
    + `Valid ids: ${FREE_TIER_MODEL_IDS.join(', ')}`;
}

// LLM call recorder hook (LIN-418). Set once at startup via setLlmCallRecorder
// so this module records every call's metadata (model, provider, tokens, cost,
// finishReason, durationMs) without importing the store directly — same
// decoupling-via-module-hook pattern as customFetch below. Default is a no-op,
// so the client works unchanged when no recorder is registered (tests, scripts).
let _llmCallRecorder = null;

/**
 * Register the function that persists LLM call metadata. Called once at startup.
 * @param {Function|null} fn - (callRecord) => void | Promise<void>
 */
export function setLlmCallRecorder(fn) {
  _llmCallRecorder = typeof fn === 'function' ? fn : null;
}

/**
 * Record one LLM call. Merges the metadata captured from the OpenRouter response
 * with the caller's attribution (options.callMeta: { urlKey, feature,
 * issueIdentifier }) and hands it to the registered recorder. Fire-and-forget and
 * fully guarded: a recorder error must never surface to (or fail) an LLM call.
 *
 * @param {Object} meta - Captured response metadata
 * @param {Object} [callMeta] - Caller attribution (urlKey/feature/issueIdentifier)
 */
function recordLlmCall(meta, callMeta) {
  if (!_llmCallRecorder) return;
  try {
    const result = _llmCallRecorder({ ...(callMeta || {}), ...meta });
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // never let recording break a call
  }
}

// Prompt trace recorder hook (LIN-578). A SECOND, independent hook — deliberately
// not piggybacking on recordLlmCall — because the metadata recorder's payload is
// content-free, while a trace carries the rendered input + output (ticket content).
// Wired ONLY at the two recommendation seams (getRecommendation /
// getRecommendationStream), never the generic chat path. Default no-op so the
// client works unchanged when no recorder is registered (tests, scripts).
let _promptTraceRecorder = null;

/**
 * Register the function that persists prompt traces. Called once at startup.
 * @param {Function|null} fn - (trace) => void | Promise<void>
 */
export function setPromptTraceRecorder(fn) {
  _promptTraceRecorder = typeof fn === 'function' ? fn : null;
}

/**
 * Record one prompt trace. Merges the captured content (input + output) with the
 * caller's attribution (options.callMeta: { urlKey, feature, issueIdentifier }) and
 * hands it to the registered recorder. Fire-and-forget and fully guarded: a recorder
 * error must never surface to (or fail) an LLM call.
 *
 * @param {Object} trace - Captured trace content
 * @param {Object} [callMeta] - Caller attribution (urlKey/feature/issueIdentifier)
 */
function recordPromptTrace(trace, callMeta) {
  if (!_promptTraceRecorder) return;
  try {
    const result = _promptTraceRecorder({ ...(callMeta || {}), ...trace });
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // never let recording break a call
  }
}

/**
 * Extract the metadata we log from an OpenRouter response/usage object.
 * Tolerant of partial shapes (streaming chunks deliver usage separately from
 * the model/provider header), so callers merge what they have.
 *
 * @param {Object} [usage] - OpenRouter usage object (with usage accounting on)
 * @returns {{promptTokens:number|null, completionTokens:number|null, totalTokens:number|null, cost:number|null, reasoningTokens:number|null}}
 */
function extractUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return { promptTokens: null, completionTokens: null, totalTokens: null, cost: null, reasoningTokens: null };
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    totalTokens: num(usage.total_tokens),
    cost: num(usage.cost),
    // LIN-3359: reasoning tokens share the bare max_tokens budget with the answer,
    // so a `length` row needs this to say whether reasoning or prose ate the cap.
    reasoningTokens: num(usage.completion_tokens_details?.reasoning_tokens)
  };
}

// Proxy-aware fetch function
let customFetch = fetch;
let proxyInitialized = false;

/**
 * Initialize proxy support if HTTP_PROXY or HTTPS_PROXY is set.
 * Uses https-proxy-agent for robust proxy support.
 */
async function initProxyFetch() {
  if (proxyInitialized) return;
  proxyInitialized = true;

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
                   process.env.https_proxy || process.env.http_proxy;

  if (proxyUrl) {
    try {
      // Use https-proxy-agent for reliable proxy support
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      const agent = new HttpsProxyAgent(proxyUrl);

      // Create a custom fetch using Node's https module with the proxy agent
      customFetch = (url, options = {}) => {
        return new Promise((resolve, reject) => {
          const urlObj = new URL(url);
          const postData = options.body || '';

          const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            agent: agent,
            headers: {
              ...options.headers,
              'Content-Length': Buffer.byteLength(postData)
            }
          };

          const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                json: () => Promise.resolve(JSON.parse(data)),
                text: () => Promise.resolve(data)
              });
            });
          });

          // Handle timeout via AbortSignal
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              req.destroy();
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          }

          req.on('error', reject);
          if (postData) req.write(postData);
          req.end();
        });
      };
    } catch (e) {
      console.warn('Failed to initialize proxy for OpenRouter:', e.message);
    }
  }
}

// Transport override hook (LIN-1848). Same decoupling-via-module-hook pattern as
// setLlmCallRecorder/setPromptTraceRecorder above: tests can substitute the actual
// transport regardless of which branch (proxy-aware customFetch vs native fetch) a
// call would otherwise take, instead of mocking global.fetch — which the proxy
// branch bypasses entirely. Default is null, so production behavior (the
// proxyUrl ? customFetch : fetch selection) is unchanged when no override is set.
let _fetchImplOverride = null;

/**
 * Register a function to use as the OpenRouter transport for every call site,
 * overriding both the proxy-aware and native-fetch branches. Pass null to clear.
 * @param {Function|null} fn
 */
export function setFetchImpl(fn) {
  _fetchImplOverride = typeof fn === 'function' ? fn : null;
}

/**
 * Resolve the transport function OpenRouter calls should use: the injected
 * override when one is set, otherwise today's proxyUrl-conditioned selection
 * between the proxy-aware customFetch and native fetch.
 * @returns {Promise<Function>}
 */
async function resolveOpenRouterFetch() {
  if (_fetchImplOverride) return _fetchImplOverride;
  await initProxyFetch();
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
                   process.env.https_proxy || process.env.http_proxy;
  return proxyUrl ? customFetch : fetch;
}

/**
 * Format subtask list with status indicators (no full details).
 * Marks the focused subtask with → arrow.
 *
 * @param {Array} children - Array of child issues
 * @param {string} focusedId - ID of the focused subtask
 * @returns {string} Formatted subtask overview string
 */
export function formatSubtaskOverview(children, focusedId) {
  const done = children.filter(c => isTerminalState(c.state?.type)).sort(compareByIdentifier);
  // Order remaining the same way the focus picker does (lowest identifier first),
  // so the displayed order matches the suggested child and reads in work order.
  const remaining = children.filter(c => !isTerminalState(c.state?.type)).sort(compareByIdentifier);

  const lines = [];
  if (done.length) {
    lines.push(`✓ Done: ${done.map(c => c.identifier).join(', ')}`);
  }
  if (remaining.length) {
    // Title + status + nested-subtask count give the recommender enough to validate
    // (or override) the suggested focus child — "which child" becomes an informed
    // choice rather than a blind pick — without drilling each child's full detail,
    // so the routing-vs-node-work decision stays coarse (see formatIssueContext).
    lines.push('○ Remaining:');
    for (const c of remaining) {
      const marker = c.id === focusedId ? '→ ' : '  ';
      const title = c.title ? ` ${c.title}` : '';
      const status = c.state?.type === 'started' ? ' (in progress)' : '';
      const subCount = c.children?.nodes?.length || 0;
      const subs = subCount > 0 ? ` [${subCount} subtask${subCount === 1 ? '' : 's'}]` : '';
      lines.push(`  ${marker}${c.identifier}${title}${status}${subs}`);
    }
  }
  return lines.join('\n');
}

/**
 * Resolve the server's paid OpenRouter env key as a *usable* key, or undefined.
 *
 * The single normalized reader for `process.env.OPENROUTER_API_KEY`: it trims,
 * so an empty-string OR whitespace-only value counts as unset (LIN-961). This is
 * the one predicate every "is there a usable paid key?" site should route
 * through, so empty/whitespace can never (a) be classified as a paid `env` key,
 * or (b) be forwarded to OpenRouter as a bogus auth header (which produced a 401
 * rather than a clean free-tier fallback). Reads live per-call (no import
 * caching) exactly like the bare reads it replaces.
 *
 * @returns {string|undefined} The trimmed key, or undefined when unset/blank.
 */
export function getPaidEnvKey() {
  const raw = process.env.OPENROUTER_API_KEY;
  const trimmed = raw && raw.trim();
  return trimmed || undefined;
}

/**
 * True when a usable (non-empty, non-whitespace) paid env key is configured.
 * Thin boolean wrapper over getPaidEnvKey() for the truthiness call sites.
 * @returns {boolean}
 */
export function hasPaidEnvKey() {
  return !!getPaidEnvKey();
}

/**
 * Check if the OpenRouter feature is enabled (API key is configured)
 * @param {string} [sessionApiKey] - Optional API key from user session (OAuth)
 * @returns {boolean} True if an API key is available (session or env)
 */
export function isRecommendationEnabled(sessionApiKey = null) {
  return !!(sessionApiKey || hasPaidEnvKey());
}

/**
 * Format comments for display in AI prompt.
 * @param {Array} comments - Array of comment objects
 * @returns {string[]} Array of formatted comment lines
 */
function formatCommentsForPrompt(comments) {
  if (!Array.isArray(comments)) return [];
  const lines = [];
  for (const comment of comments) {
    const date = new Date(comment.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    lines.push(`\n**${comment.user}** (${date}):`);
    lines.push(comment.body);
  }
  return lines;
}

/**
 * The blocker lines (LIN-3309), rendered from the relation itself so no reader infers
 * "blocked" from prose: still open vs already resolved, because one combined list
 * carrying "(Done)" made the model count resolved blockers as active (research spike
 * §3). A canceled blocker counts as resolved. None when the issue has no blockers.
 * @param {Object} issue
 * @returns {string[]}
 */
function formatBlockerLines(issue) {
  const blockedBy = Array.isArray(issue.blockedBy) ? issue.blockedBy : [];
  const fmt = (b) => `${b.identifier}${b.title ? ` — ${b.title}` : ''} (${b.state?.name || 'Unknown'})`;
  const open = blockedBy.filter(b => !isTerminalState(b?.state?.type));
  const resolved = blockedBy.filter(b => isTerminalState(b?.state?.type));
  const lines = [];
  if (open.length > 0) lines.push(`**Blocked by (open):** ${open.map(fmt).join('; ')}`);
  if (resolved.length > 0) lines.push(`**Blockers already resolved:** ${resolved.map(fmt).join('; ')}`);
  return lines;
}

/**
 * Format issue context for the AI prompt.
 * Supports two-tier format for parent tasks with focusedChild.
 *
 * @param {Object} issue - The issue object
 * @param {Object} context - Context with parent, siblings, project, children, focusedChild
 * @returns {string} Formatted context string
 */
export function formatIssueContext(issue, context) {
  const lines = [];

  // Check if this is a parent task with a focused child (two-tier mode)
  const hasFocusedChild = context.focusedChild && context.children?.length > 0;

  lines.push(`**Issue:** ${issue.identifier} - ${issue.title}`);
  lines.push(`**State:** ${issue.state?.name || 'Unknown'} (${issue.state?.type || 'unknown'})`);

  // Created date feeds the staleness-check directive's `git log --since=<createdAt>`.
  if (issue.createdAt) {
    lines.push(`**Created:** ${issue.createdAt}`);
  }

  // Last-touched date (LIN-1067): answers "when was this task last updated". Additive
  // and rendered only when present, so surfaces (or providers) that don't select
  // updatedAt are unchanged.
  if (issue.updatedAt) {
    lines.push(`**Updated:** ${issue.updatedAt}`);
  }

  if (issue.description) {
    lines.push(`**Description:** ${issue.description}`);
  }

  lines.push(...formatBlockerLines(issue));

  const labels = issue.labels || [];
  if (labels.length > 0) {
    lines.push(`**Labels:** ${labels.join(', ')}`);
  }

  if (context.project) {
    lines.push(`**Project:** ${context.project.name}`);
  }

  if (context.parent) {
    lines.push(`**Parent Task:** ${context.parent.identifier} - ${context.parent.title} (${context.parent.state?.name || 'Unknown'})`);
  }

  if (context.siblings?.length > 0) {
    lines.push('**Sibling Tasks:**');
    for (const sibling of context.siblings) {
      lines.push(`  - ${sibling.identifier}: ${sibling.title} (${sibling.state?.name || 'Unknown'})`);
    }
    const siblingsTotal = typeof context.siblingsTotal === 'number'
      ? context.siblingsTotal
      : context.siblings.length;
    if (siblingsTotal > context.siblings.length) {
      const notShown = siblingsTotal - context.siblings.length;
      lines.push(`*${notShown} siblings not shown. If the plan's approach routes around a contract gap not in this list, fetch the parent epic's full child list via the API before committing to a strategy.*`);
    }
  }

  // Related work in the parent epic (cousins) — only in the non-focusedChild branch.
  // Cousins widen the frame so the plan can spot adjacent tracked contract
  // gaps. In two-tier mode the parent IS the current issue and "cousins" are the
  // focusedChild's siblings, already rendered in the children list — so skip there
  // to avoid double-rendering. See LIN-279.
  if (
    !hasFocusedChild &&
    isEpicShapedParent(context.parent, context.parentChildCount) &&
    context.cousins?.length > 0
  ) {
    const cousins = context.cousins;
    const cousinsTotal = typeof context.cousinsTotal === 'number'
      ? context.cousinsTotal
      : cousins.length;
    lines.push(`**Related work in the parent epic:** (top ${COUSIN_CAP} by relevance; ${cousinsTotal} total)`);
    for (const cousin of cousins) {
      lines.push(`  - ${cousin.identifier}: ${cousin.title} (${cousin.state?.name || 'Unknown'})`);
    }
    if (cousinsTotal > cousins.length) {
      const notShown = cousinsTotal - cousins.length;
      lines.push(`*${notShown} cousins not shown. If the plan's approach routes around a contract gap not in this list, fetch the parent epic's full descendant tree via the API before committing to a strategy.*`);
    }
  }

  // Node format (LIN-327): a parent with a focused child is presented as a *node*
  // to route, not a blended parent+child prompt. The recommender sees the node's
  // own context, a subtask overview, and a SUGGESTED NEXT pointer, then decides
  // node-work (breakdown/triage/close) vs `defer` to the suggested child. We
  // deliberately do NOT drill the focused child's full description/labels/comments
  // in here: if the recommender defers, the recursion (LIN-329) re-enters on that
  // child and fetches its full context fresh at that hop. Drilling it here is the
  // old two-tier blend that framed the action at the parent — the regression this
  // replaces.
  if (hasFocusedChild && context.focusedChild?.issue) {
    const focusedChild = context.focusedChild;
    const focusedId = focusedChild.issue.id;

    // Subtask overview (status only)
    lines.push(`**Subtasks Overview:**`);
    lines.push(formatSubtaskOverview(context.children, focusedId));

    if (context.comments?.length > 0) {
      lines.push(`**Parent Discussion:** ${context.comments.length} comment(s)`);
      lines.push(...formatCommentsForPrompt(context.comments));
    }

    // SUGGESTED NEXT pointer (identifier/title/status only — a seed for the defer
    // decision, not drilled context). The meta-prompt also receives this id via
    // focusedSubtaskId; here it gives the overview a clear "descend here unless a
    // sibling should take priority" anchor.
    lines.push('');
    lines.push(`**→ SUGGESTED NEXT (defer candidate): ${focusedChild.issue.identifier} - ${focusedChild.issue.title} (${focusedChild.issue.state?.name || 'Unknown'})**`);
  } else {
    // Leaf task format: show all children and full comments
    if (context.children?.length > 0) {
      lines.push(`**Existing Subtasks:** ${context.children.length} subtasks`);
      for (const child of context.children) {
        lines.push(`  - ${child.identifier}: ${child.title} (${child.state?.name || 'Unknown'})`);
      }
    }

    if (context.comments?.length > 0) {
      lines.push(`**Discussion History:** ${context.comments.length} comment(s)`);
      // Show all comments with full content (oldest first for chronological reading)
      lines.push(...formatCommentsForPrompt(context.comments));
    }
  }

  // Shared Attachments section (LIN-772) — the SAME formatAttachmentsSection seam
  // the stage prompt appends as a post-pass, so the router and the worker see the
  // same attachment set. Self-gates to '' when there are no attachments.
  const attachmentsBlock = formatAttachmentsSection(context);
  if (attachmentsBlock) lines.push(attachmentsBlock);

  return lines.join('\n');
}

/** How many of the newest comments the selector reads in full, and each one's cap (LIN-3300). */
export const SELECTOR_COMMENTS = 3;
export const SELECTOR_COMMENT_CAP = 2000;

/** One comment for the selector: author (or a label), date and body, capped. */
function formatSelectorComment(c, label = null) {
  const body = String(c.body || '');
  const capped = body.length > SELECTOR_COMMENT_CAP
    ? `${body.slice(0, SELECTOR_COMMENT_CAP)}… [${body.length - SELECTOR_COMMENT_CAP} more characters]`
    : body;
  return `\n**${label || c.user || 'Unknown'}** (${String(c.createdAt || '').slice(0, 10)}):\n${capped}`;
}

/**
 * The stage selector's view of a ticket (LIN-3300): enough to understand it, and the
 * latest thing a person said. Title, state, labels, project and relations; the
 * description with a long plan body condensed (condensePlan); the newest
 * SELECTOR_COMMENTS comments, each capped; and the latest ruling and the latest
 * person's comment wherever they sit, marked as such; and the attachments. Older
 * comment bodies are not shown: the trail facts answer every whole-trail question
 * from all of them. The worker-only epic cousins and "fetch the epic's child list"
 * nudge are not in it.
 * formatIssueContext stays the view every other consumer reads.
 * @param {Object} issue
 * @param {Object} context
 * @returns {string}
 */
export function formatSelectorView(issue, context) {
  const lines = [
    `**Issue:** ${issue.identifier} - ${issue.title}`,
    `**State:** ${issue.state?.name || 'Unknown'} (${issue.state?.type || 'unknown'})`
  ];
  const labels = issue.labels || [];
  if (labels.length > 0) lines.push(`**Labels:** ${labels.join(', ')}`);
  if (context.project) lines.push(`**Project:** ${context.project.name}`);
  if (context.parent) {
    lines.push(`**Parent Task:** ${context.parent.identifier} - ${context.parent.title} (${context.parent.state?.name || 'Unknown'})`);
  }
  if (context.siblings?.length > 0) {
    lines.push('**Sibling Tasks:**');
    for (const s of context.siblings) lines.push(`  - ${s.identifier}: ${s.title} (${s.state?.name || 'Unknown'})`);
    const total = typeof context.siblingsTotal === 'number' ? context.siblingsTotal : context.siblings.length;
    if (total > context.siblings.length) lines.push(`*${total - context.siblings.length} siblings not shown.*`);
  }
  lines.push(...formatBlockerLines(issue));

  const children = context.children || [];
  const focused = context.focusedChild?.issue;
  if (focused && children.length > 0) {
    lines.push('**Subtasks Overview:**', formatSubtaskOverview(children, focused.id));
    lines.push(`**→ SUGGESTED NEXT (defer candidate): ${focused.identifier} - ${focused.title} (${focused.state?.name || 'Unknown'})**`);
  } else if (children.length > 0) {
    lines.push(`**Existing Subtasks:** ${children.length} subtasks`);
    for (const c of children) lines.push(`  - ${c.identifier}: ${c.title} (${c.state?.name || 'Unknown'})`);
  }

  if (issue.description) lines.push(`**Description:** ${condensePlan(issue.description)}`);

  const comments = (context.comments || [])
    .filter(c => c && typeof c.body === 'string')
    .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
  if (comments.length > 0) {
    const latest = comments.slice(-SELECTOR_COMMENTS);
    const ruling = [...comments].reverse().find(c => isRuling(c.body));
    const person = [...comments].reverse().find(c => isPersonComment(c.body));
    if (ruling && !latest.includes(ruling)) {
      lines.push(formatSelectorComment(ruling, ruling === person ? 'Latest ruling recorded via Harbour, the latest person\'s comment' : 'Latest ruling recorded via Harbour'));
    }
    if (person && person !== ruling && !latest.includes(person)) {
      lines.push(formatSelectorComment(person, 'Latest person\'s comment'));
    }
    lines.push(`\n**Comments:** Latest ${latest.length} of ${comments.length} comments, oldest first (older bodies are not shown; the trail facts read all of them).`);
    for (const c of latest) {
      const label = c === person ? `${c.user || 'Unknown'}, the latest person's comment${isRuling(c.body) ? ' (a ruling recorded via Harbour)' : ''}` : null;
      lines.push(formatSelectorComment(c, label));
    }
  }
  // The same attachment set the stage prompt carries (LIN-772).
  const attachments = formatAttachmentsSection(context);
  if (attachments) lines.push(attachments);
  return lines.join('\n');
}

/**
 * The stage selector's inputs (LIN-3300): its own view of the ticket, the facts code
 * computes from the whole trail and the task's recent runs (`context.runs`, from
 * lib/recent-runs.js loadRecentRuns), as plain data.
 * @param {Object} issue
 * @param {Object} [context]
 * @param {Object} [featureFlags]
 * @param {Object} [providerUi]
 * @returns {Object} buildRouterPrompt's params
 */
export function buildSelectorArgs(issue, context = {}, featureFlags = {}, providerUi = null) {
  const children = context.children || [];
  const comments = context.comments || [];
  const runs = formatRecentRuns(context.runs);
  const leaf = children.length === 0;
  const parentPlan = leaf && context.parent?.description ? { identifier: context.parent.identifier, description: context.parent.description } : null;
  const trail = formatTrailFactsBlock(assembleTrailFacts(comments, issue.description, { leaf, parentPlan }), comments.length, { runs: !!runs });
  return {
    view: formatSelectorView(issue, context),
    identifier: issue.identifier,
    facts: [trail, formatNodeFactsBlock(assembleNodeFacts(issue, children), children.length), runs].filter(Boolean).join('\n'),
    featureFlags,
    providerUi
  };
}

/** The routing prompt a recommendation call sends: the stage selector (LIN-3300). */
function buildRoutingPrompt(issue, context, featureFlags = {}, providerUi = null) {
  return buildRouterPrompt(buildSelectorArgs(issue, context, featureFlags, providerUi));
}

/**
 * Parse streamed content into reasoning and prompt sections.
 * Handles the case where section boundaries are split across chunks.
 *
 * A routing reply is `## Reasoning` alone; a `## Prompt` section, should a model add
 * one, is split off so the stream can drop it (code assembles the prompt).
 *
 * @class
 */
export class StreamingSectionParser {
  static MAX_BUFFER_SIZE = 50 * 1024; // 50KB

  constructor() {
    this.buffer = '';
    this.state = 'waiting_for_header'; // waiting_for_header | reasoning | prompt
    this.pendingEmit = '';
  }

  /**
   * Process a chunk of streamed content.
   * Returns an array of events to emit: { section, content }
   * @param {string} chunk - New text chunk from the stream
   * @returns {Array<{section: string, content: string}>}
   */
  processChunk(chunk) {
    if (this.buffer.length + chunk.length > StreamingSectionParser.MAX_BUFFER_SIZE) {
      throw new Error('Buffer overflow: response too large');
    }
    this.buffer += chunk;
    const events = [];

    if (this.state === 'waiting_for_header') {
      const idx = this.buffer.indexOf('## Reasoning\n');
      if (idx !== -1) {
        this.buffer = this.buffer.slice(idx + '## Reasoning\n'.length);
        this.state = 'reasoning';
      } else {
        return events;
      }
    }

    if (this.state === 'reasoning') {
      const promptHeader = '\n## Prompt\n';
      const idx = this.buffer.indexOf(promptHeader);
      if (idx !== -1) {
        // Emit everything before the prompt header as reasoning
        const reasoningContent = this.buffer.slice(0, idx);
        if (reasoningContent) {
          events.push({ section: 'reasoning', content: reasoningContent });
        }
        this.buffer = this.buffer.slice(idx + promptHeader.length);
        this.state = 'prompt';
        // Emit any remaining buffer as prompt
        if (this.buffer) {
          events.push({ section: 'prompt', content: this.buffer });
          this.buffer = '';
        }
      } else {
        // Keep enough buffer to detect the prompt header across chunk boundaries
        const safeLength = this.buffer.length - promptHeader.length;
        if (safeLength > 0) {
          events.push({ section: 'reasoning', content: this.buffer.slice(0, safeLength) });
          this.buffer = this.buffer.slice(safeLength);
        }
      }
    } else if (this.state === 'prompt') {
      if (this.buffer) {
        events.push({ section: 'prompt', content: this.buffer });
        this.buffer = '';
      }
    }

    return events;
  }

  /**
   * Flush any remaining buffered content.
   * Call this when the stream ends.
   * @returns {Array<{section: string, content: string}>}
   */
  flush() {
    const events = [];
    if (this.buffer && this.state !== 'waiting_for_header') {
      events.push({ section: this.state, content: this.buffer });
      this.buffer = '';
    }
    return events;
  }
}

/**
 * Stream a recommendation via OpenRouter's streaming API: the routing reply's
 * reasoning streams live; code then assembles the routed stage's prompt
 * (composeRoutedRecommendation) and sends it as one prompt delta.
 *
 * @param {Object} issue - The issue object
 * @param {Object} context - Context with parent, siblings, project, children, comments, focusedChild
 * @param {Object} [options] - Optional settings
 * @param {string} [options.apiKey] - API key
 * @param {string} [options.model] - Model ID
 * @param {Object} [options.featureFlags] - Feature flags
 * @param {AbortSignal} [options.signal] - Abort signal for cancellation
 * @param {Function} onEvent - Callback: (type, data) => void
 *   Types: 'phase', 'delta', 'done', 'error'
 * @returns {Promise<Object>} The structured recommendation
 */
export async function getRecommendationStream(issue, context, options = {}, onEvent) {
  const apiKey = options.apiKey || getPaidEnvKey();
  const model = options.model || DEFAULT_MODEL;
  const featureFlags = options.featureFlags || {};
  const providerUi = options.providerUi || null;
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured.');
  }

  // Initialize proxy support if needed
  await initProxyFetch();

  // LIN-2854: an already-aborted signal fires no future `abort` event, so the
  // listener below would never run and a full streamed call would be bought and
  // discarded. Fail before any transport call (also covers the non-streaming
  // fallback, which delegates to getRecommendation).
  throwIfAborted(options.signal);

  const metaPrompt = buildRoutingPrompt(issue, context, featureFlags, providerUi);

  // The code routes (lib/code-routes.js, in their order): none is a routing call.
  const bounded = codeRoutedRecommendation(issue, context, featureFlags, providerUi, metaPrompt, model, options);
  if (bounded) {
    onEvent('phase', { phase: 'reasoning' });
    onEvent('delta', { section: 'reasoning', content: bounded.reasoning });
    // A live-stage wait has no prompt; the caller reports it (routes/workspace-api.js).
    if (bounded.prompt != null) {
      onEvent('phase', { phase: 'prompt' });
      onEvent('delta', { section: 'prompt', content: bounded.prompt });
    }
    onEvent('done', { truncated: false, completionTokens: null });
    return bounded;
  }

  // Check if proxy is active (customFetch doesn't support streaming)
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
                   process.env.https_proxy || process.env.http_proxy;
  const useStreaming = !proxyUrl;

  if (!useStreaming) {
    // Fallback: use non-streaming request, then emit events from complete response.
    // Mirror the streaming path's per-section emission so a defer hop (prompt:null)
    // emits only reasoning — keeping the event contract identical either way — and
    // return the same structured object so this path can substitute for the stream.
    const result = await getRecommendation(issue, context, options);
    onEvent('phase', { phase: 'reasoning' });
    if (result.reasoning) onEvent('delta', { section: 'reasoning', content: result.reasoning });
    if (result.prompt) {
      onEvent('phase', { phase: 'prompt' });
      onEvent('delta', { section: 'prompt', content: result.prompt });
    }
    onEvent('done', { truncated: result.truncated, completionTokens: result.completionTokens });
    return result;
  }

  const budget = planRoutingBudget(model, metaPrompt);
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Link external signal to our controller
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    // Use native fetch for streaming (not customFetch which buffers), unless
    // overridden — see resolveOpenRouterFetch.
    const streamFetch = await resolveOpenRouterFetch();
    const response = await streamFetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/JKershaw/LinearViewer',
        'X-Title': 'Harbour'
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: metaPrompt }],
        temperature: 0,
        max_tokens: budget.maxTokens,
        ...(budget.reasoning ? { reasoning: budget.reasoning } : {}),
        stream: true,
        // LIN-418: usage accounting — the final SSE chunk carries cost + tokens.
        usage: { include: true }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorBody}`);
    }

    // Parse SSE stream from OpenRouter
    const parser = new StreamingSectionParser();
    let currentSection = null;
    // D1 (LIN-3309): the parser only starts on `## Reasoning\n`, so a `**Reasoning**`
    // or headerless reply streams no reasoning at all. Track whether any streamed,
    // then emit a catch-up delta from the final parse when none did.
    let reasoningStreamed = false;
    let truncated = false;
    let completionTokens = null;
    let finishReason = null;
    // LIN-418: usage/provider/model arrive across chunks (usage in the final
    // chunk, provider/model in the header) — accumulate and record after the loop.
    let usageMeta = null;
    let responseProvider = null;
    let responseModel = null;
    // Accumulate the raw markdown exactly as it arrives so the terminal flush can
    // route it through routeStage — byte-identical to the buffered path (LIN-328
    // defer contract), even though we emit reasoning deltas live.
    let rawContent = '';
    let sseBuffer = '';
    const emit = (evt) => {
      if (evt.section === 'prompt') return; // a routing reply has no body
      if (evt.section !== currentSection) {
        currentSection = evt.section;
        onEvent('phase', { phase: currentSection });
      }
      if (evt.section === 'reasoning') reasoningStreamed = true;
      onEvent('delta', evt);
    };

    for await (const chunk of response.body) {
      const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      sseBuffer += text;

      // Parse SSE events from buffer
      const parts = sseBuffer.split('\n\n');
      sseBuffer = parts.pop(); // Keep incomplete part

      for (const part of parts) {
        if (!part.trim()) continue;
        // Skip SSE comments (e.g., ": OPENROUTER PROCESSING")
        if (part.startsWith(':')) continue;

        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);

          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            const chunkFinishReason = parsed.choices?.[0]?.finish_reason;

            if (chunkFinishReason) finishReason = chunkFinishReason;
            if (chunkFinishReason === 'length') truncated = true;
            if (parsed.usage?.completion_tokens) {
              completionTokens = parsed.usage.completion_tokens;
            }
            if (parsed.usage) usageMeta = parsed.usage;
            if (parsed.provider) responseProvider = parsed.provider;
            if (parsed.model) responseModel = parsed.model;

            if (content) {
              rawContent += content;
              for (const evt of parser.processChunk(content)) emit(evt);
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }

    // Flush any remaining content
    for (const evt of parser.flush()) emit(evt);

    // Route the accumulated raw markdown through the SAME seam as the buffered
    // path so defer parsing and truncation surfacing are byte-identical (LIN-328,
    // 13ecc22): the next-stage choice parses its own reply (LIN-3304); routeStage
    // re-derives `truncated` from finishReason.
    const parsed = routedReplyToParsed(routeStage(rawContent, finishReason, completionTokens));

    // D1 (LIN-3309): the stream parser starts only on `## Reasoning\n`. When the
    // reply used `**Reasoning**`, another header, or no header at all, nothing
    // streamed; emit the parsed reasoning now as one delta so the live view matches
    // the buffered path. One owner: the final parse supplies the text, no regex here.
    if (!reasoningStreamed && parsed.reasoning) {
      currentSection = 'reasoning';
      onEvent('phase', { phase: 'reasoning' });
      onEvent('delta', { section: 'reasoning', content: parsed.reasoning });
    }

    // Code assembles the routed stage's prompt; skipped on defer (prompt === null).
    const structured = composeRoutedRecommendation(parsed, issue, context, featureFlags, providerUi);

    // The finished prompt goes out as one delta. This is load-bearing, not cosmetic:
    // the leaf streaming path (routes/workspace-api.js) delivers the prompt to the
    // consumer ONLY through these deltas and discards the return value.
    if (structured.prompt != null) {
      onEvent('phase', { phase: 'prompt' });
      onEvent('delta', { section: 'prompt', content: structured.prompt });
    }

    // Record the call metadata (LIN-418). Fire-and-forget.
    recordLlmCall({
      model: responseModel || model,
      provider: responseProvider || null,
      finishReason: finishReason || null,
      durationMs: Date.now() - startTime,
      maxTokens: budget.maxTokens,
      ...extractUsage(usageMeta)
    }, options.callMeta);

    // Record the full prompt trace (LIN-578). Content-bearing sibling of the
    // metadata log above; fire-and-forget, always-on, session-auth read only.
    recordPromptTrace({
      metaPrompt,
      model: responseModel || model,
      featureFlags,
      providerUi,
      rawContent,
      reasoning: parsed.reasoning,
      prompt: parsed.prompt,
      finalPrompt: structured.prompt,
      finishReason: finishReason || null,
      truncated
    }, options.callMeta);

    onEvent('done', { truncated, completionTokens: completionTokens || null });

    // Return the structured object so the parent SSE path can stream every hop
    // (including the terminal one) AND still get the recommendation it needs to
    // drive the descent. Leaf callers ignore this return value (backward-compatible).
    return structured;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('OpenRouter request timed out');
    }
    throw error;
  }
}

/**
 * Fail fast when an external AbortSignal is already aborted (LIN-2637).
 *
 * An already-aborted signal fires no future `abort` event — the event has been
 * and gone — so registering only a listener lets a late abort slip through and
 * buy a full request. Both `streamChat` and `runToolHop` must run this guard
 * BEFORE starting their request, or the two shapes drift again — the asymmetry
 * between them is exactly what made this bug invisible. Throws the same message
 * the mid-flight abort path produces (AbortError → 'OpenRouter request timed
 * out'), so callers see one consistent abort contract whether the signal fired
 * before or during the request.
 *
 * @param {AbortSignal|null|undefined} signal - External signal, if any.
 * @returns {void}
 */
function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw new Error('OpenRouter request timed out');
  }
}

/**
 * The finish reasons that mean the model finished on its own (LIN-4358). OpenRouter
 * normalizes every provider's reason to one of stop / length / tool_calls /
 * content_filter / error; anything else, and a stream that ended with no reason at all,
 * means the text is a partial.
 */
const COMPLETE_FINISH_REASONS = new Set(['stop', 'tool_calls']);

/** True when a call's finish reason means its output is whole. */
export function isCompleteFinish(finishReason) {
  return COMPLETE_FINISH_REASONS.has(finishReason);
}

/**
 * A call's output stopped short (LIN-4358): `finish_reason` was `length`, `error`,
 * `content_filter`, or missing because the stream dropped. Thrown by `streamChat` /
 * `streamChatWithTools` unless the caller passed `allowPartial: true`, so no caller can
 * keep, cache or show a cut-off answer as if it were whole. The message names the model,
 * the reason and where the tokens went, and starts with "OpenRouter" so every route's
 * existing OpenRouter arm reports it rather than a generic 500.
 */
export class TruncatedOutputError extends Error {
  constructor({ model, finishReason, completionTokens = null, reasoningTokens = null, maxTokens = null, providerError = null, retried = false }) {
    const reason = finishReason ? `finish_reason '${finishReason}'` : 'no finish_reason (the stream ended early)';
    const spent = [];
    if (completionTokens != null) spent.push(`${completionTokens} of ${maxTokens ?? '?'} output tokens`);
    else if (maxTokens != null) spent.push(`a cap of ${maxTokens} output tokens`);
    if (reasoningTokens) spent.push(`${reasoningTokens} of them hidden reasoning`);
    super(
      `OpenRouter output cut off: ${model} stopped with ${reason}`
      + (spent.length ? ` (${spent.join(', ')})` : '')
      + (providerError ? `: ${providerError}` : '')
      + (retried ? ', after one retry with a larger budget' : '')
      + '. The partial result was not kept.'
    );
    this.name = 'TruncatedOutputError';
    this.code = 'OUTPUT_TRUNCATED';
    this.model = model;
    this.finishReason = finishReason || null;
    this.completionTokens = completionTokens;
    this.reasoningTokens = reasoningTokens;
    this.maxTokens = maxTokens;
    this.retried = retried;
  }
}

/**
 * The HTTP reply a route gives for a TruncatedOutputError: 502 (the upstream model gave
 * a partial), a plain message, and the facts a reader needs to see why. Null for any
 * other error, so a route can try this first and fall through to its own mapping.
 * @param {Error} err
 * @returns {[number, string, Object]|null}
 */
export function truncationFailureOf(err) {
  if (!err || err.code !== 'OUTPUT_TRUNCATED') return null;
  return [502, 'The model\'s output was cut off, so nothing was kept', {
    code: 'OUTPUT_TRUNCATED', message: err.message, model: err.model ?? null, finishReason: err.finishReason ?? null,
  }];
}

/**
 * One OpenRouter chat request, streamed (or, behind an HTTP proxy, one non-streaming
 * request). Records the call, forwards text through `onToken` as it arrives, and returns
 * what happened; it never judges completeness — `streamChat` does.
 *
 * Streaming has two deadlines: REQUEST_TIMEOUT_MS until the response headers, and the
 * same span of silence between body chunks (LIN-4358: before, the timer was cleared at
 * the headers, so a stalled body had no deadline of its own).
 *
 * @returns {Promise<{text: string, finishReason: (string|null), usage: Object, providerError: (string|null)}>}
 */
async function requestChatOnce(messages, { apiKey, model, temperature, maxTokens, reasoning, signal, callMeta }, onToken) {
  const startTime = Date.now();
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
                   process.env.https_proxy || process.env.http_proxy;
  const useStreaming = !proxyUrl;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://github.com/JKershaw/LinearViewer',
    'X-Title': 'Harbour'
  };

  const controller = new AbortController();
  let timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onExternalAbort);

  try {
    const doFetch = await resolveOpenRouterFetch();
    const response = await doFetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(useStreaming ? { stream: true } : {}),
        // LIN-418: usage accounting — the final SSE chunk (or the body) carries cost + tokens.
        usage: { include: true },
        // LIN-1000: a reasoning bound only when the caller or the retry plan sets one.
        ...(reasoning ? { reasoning } : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorBody}`);
    }

    if (!useStreaming) {
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      const finishReason = data.choices?.[0]?.finish_reason || null;
      const usage = extractUsage(data.usage);
      const providerError = data.error ? (data.error.message || JSON.stringify(data.error)) : null;
      // Record the call metadata (LIN-418). Fire-and-forget.
      recordLlmCall({
        model: data.model || model,
        provider: data.provider || null,
        finishReason: finishReason || (providerError ? 'error' : null),
        durationMs: Date.now() - startTime,
        maxTokens,
        ...usage
      }, callMeta);
      if (text) onToken(text);
      return { text, finishReason: finishReason || (providerError ? 'error' : null), usage, providerError };
    }

    let sseBuffer = '';
    let text = '';
    let finishReason = null;
    let providerError = null;
    // LIN-418: accumulate usage/provider/model across chunks for the call log.
    let usageMeta = null;
    let responseProvider = null;
    let responseModel = null;
    const rearm = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    };
    rearm();
    for await (const chunk of response.body) {
      rearm();
      const piece = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      sseBuffer += piece;

      const parts = sseBuffer.split('\n\n');
      sseBuffer = parts.pop();

      for (const part of parts) {
        if (!part.trim() || part.startsWith(':')) continue;

        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              text += content;
              onToken(content);
            }
            const reason = parsed.choices?.[0]?.finish_reason;
            if (reason) finishReason = reason;
            // A mid-stream provider failure arrives as an `error` object on a chunk
            // (LIN-4358): keep its words for the error message.
            if (parsed.error) providerError = parsed.error.message || JSON.stringify(parsed.error);
            if (parsed.usage) usageMeta = parsed.usage;
            if (parsed.provider) responseProvider = parsed.provider;
            if (parsed.model) responseModel = parsed.model;
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }
    if (!finishReason && providerError) finishReason = 'error';

    const usage = extractUsage(usageMeta);
    // Record the call metadata (LIN-418). Fire-and-forget.
    recordLlmCall({
      model: responseModel || model,
      provider: responseProvider || null,
      finishReason,
      durationMs: Date.now() - startTime,
      maxTokens,
      ...usage
    }, callMeta);
    return { text, finishReason, usage, providerError };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('OpenRouter request timed out');
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Generic chat streaming function for arbitrary messages.
 *
 * Unlike getRecommendationStream (which is specific to the routing call),
 * this accepts a raw messages array and streams plain tokens without section parsing.
 *
 * Whole or loud (LIN-4358). By default the call must finish on its own
 * (`isCompleteFinish`). Tokens are held until it does, then emitted in order followed by
 * `done`, so a caller that buffers tokens never sees a partial. A call that stops at
 * `length` is retried once with a larger budget (`planRetryBudget`: an explicit
 * reasoning bound when hidden reasoning ate the cap, else a doubled cap); the held tokens
 * of the failed attempt are dropped. A call that still is not whole throws
 * TruncatedOutputError, and no `done` is emitted.
 *
 * `allowPartial: true` is for callers that stream to a person and handle a cut-off
 * themselves (the roadmap layers and chat, Ship's Biscuit's editor check, the agent
 * turn's cut-off note): tokens are forwarded live, there is no retry, and `done` carries
 * the finish reason as before.
 *
 * Budget: `maxTokens` is the visible output the caller needs. The request's `max_tokens`
 * comes from `planCallBudget` (lib/call-budget.js): headroom for hidden reasoning on any
 * model whose catalog entry can reason, within the catalog's output limits.
 *
 * @param {Array<{role: string, content: string}>} messages - Chat messages (system, user, assistant)
 * @param {Object} options
 * @param {string} options.apiKey - OpenRouter API key
 * @param {string} [options.model] - Model ID (defaults to DEFAULT_MODEL)
 * @param {number} [options.maxTokens=1000] - Visible output tokens the caller needs
 * @param {number} [options.temperature=0.3] - Sampling temperature
 * @param {Object} [options.reasoning] - Explicit OpenRouter reasoning field (LIN-1000);
 *   `maxTokens` is then taken as already covering reasoning + prose
 * @param {boolean} [options.allowPartial=false] - Forward tokens live and return a partial
 * @param {AbortSignal} [options.signal] - Abort signal
 * @param {Function} onEvent - Callback: (type, data) => void
 *   Types: 'token' (streaming text), 'done' (with { finishReason, usage })
 * @returns {Promise<{text: string, finishReason: (string|null), usage: Object, complete: boolean}>}
 */
export async function streamChat(messages, options = {}, onEvent = () => {}) {
  const apiKey = options.apiKey || getPaidEnvKey();
  const model = options.model || DEFAULT_MODEL;
  const requested = options.maxTokens || 1000;
  const temperature = options.temperature ?? 0.3;
  const allowPartial = options.allowPartial === true;

  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured.');
  }

  await initProxyFetch();

  // LIN-2637: guard the already-aborted case BEFORE any request is issued. An
  // AbortSignal that is already aborted fires no future `abort` event — the
  // event has been and gone — so the listener registered in requestChatOnce
  // would never fire and a full streaming call would be bought and discarded.
  // Placed AFTER initProxyFetch so an abort landing during that await is also
  // caught; everything from here to the listener registration is synchronous.
  throwIfAborted(options.signal);

  const promptChars = promptCharsOf(messages);
  const first = planCallBudget({ model, maxTokens: requested, reasoning: options.reasoning, promptChars });
  let attempt = { maxTokens: first.maxTokens, reasoning: first.reasoning };
  let retried = false;

  for (;;) {
    const held = [];
    const onToken = allowPartial
      ? (token) => onEvent('token', { token })
      : (token) => held.push(token);
    const out = await requestChatOnce(messages, {
      apiKey, model, temperature, maxTokens: attempt.maxTokens, reasoning: attempt.reasoning,
      signal: options.signal,
      callMeta: retried ? { ...(options.callMeta || {}), retry: 'length' } : options.callMeta
    }, onToken);
    const complete = isCompleteFinish(out.finishReason);

    if (complete || allowPartial) {
      for (const token of held) onEvent('token', { token });
      onEvent('done', { finishReason: out.finishReason, usage: out.usage });
      return { text: out.text, finishReason: out.finishReason, usage: out.usage, complete };
    }

    const retry = !retried && out.finishReason === 'length'
      ? planRetryBudget({ model, first, usage: out.usage, promptChars })
      : null;
    if (!retry) {
      throw new TruncatedOutputError({
        model, finishReason: out.finishReason,
        completionTokens: out.usage?.completionTokens ?? null,
        reasoningTokens: out.usage?.reasoningTokens ?? null,
        maxTokens: attempt.maxTokens, providerError: out.providerError, retried
      });
    }
    // The cut attempt's text is dropped with `held`; nothing of it reached the caller.
    throwIfAborted(options.signal);
    attempt = retry;
    retried = true;
  }
}

/**
 * Hard cap on tool-calling hops (LIN-988). Once this many non-streaming hops
 * have each returned `tool_calls`, we stop looping and let the model answer with
 * the context it has accumulated. Kept small so a misbehaving model or tool
 * cannot spin up unbounded round-trips.
 */
export const DEFAULT_MAX_TOOL_ITERATIONS = 4;

/**
 * Each tool result is truncated to this many characters before being appended as
 * a `role: 'tool'` message (LIN-988). A large payload (e.g. a full issue tree)
 * would otherwise re-enter the prompt on every subsequent hop AND on the final
 * streamed answer, multiplying latency and cost.
 */
export const TOOL_RESULT_MAX_CHARS = 4000;

/**
 * Truncate a tool result to a character budget, appending a marker that notes how
 * much was dropped. Non-string results are JSON-stringified first so an executor
 * may return objects.
 *
 * @param {*} text - The tool result (string or JSON-serializable value)
 * @param {number} [max=TOOL_RESULT_MAX_CHARS]
 * @returns {string}
 */
export function truncateToolResult(text, max = TOOL_RESULT_MAX_CHARS) {
  let str;
  if (typeof text === 'string') {
    str = text;
  } else {
    try { str = JSON.stringify(text ?? ''); } catch { str = String(text); }
  }
  if (str.length <= max) return str;
  const dropped = str.length - max;
  return `${str.slice(0, max)}\n… [truncated ${dropped} chars]`;
}

/**
 * Run a single NON-streaming tool hop: one request that offers `tools` +
 * `tool_choice` and returns the model's message (which may carry `tool_calls`)
 * plus its finish_reason. Transport comes from resolveOpenRouterFetch (LIN-1848):
 * an injected override when tests set one, otherwise today's proxyUrl-conditioned
 * selection between the proxy-aware fetch and plain fetch.
 */
async function runToolHop(messages, { tools, toolChoice, apiKey, model, temperature, maxTokens, signal, callMeta }) {
  const doFetch = await resolveOpenRouterFetch();

  // LIN-2637: same up-front guard as streamChat, placed after the transport
  // resolution await so an abort landing during it is also caught — and with
  // no await between this check and the listener registration below. The
  // former `signal.aborted` branch aborted the controller but still invoked
  // the transport; real fetch would then refuse on the aborted signal (so the
  // wire outcome was the same), but the transport call was wasted and the two
  // shapes could drift again.
  throwIfAborted(signal);

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onExternalAbort);

  try {
    const response = await doFetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/JKershaw/LinearViewer',
        'X-Title': 'Harbour'
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: toolChoice,
        temperature,
        // LIN-4358: the hop is sized like any call, with reasoning headroom from the catalog.
        max_tokens: planCallBudget({ model, maxTokens, promptChars: promptCharsOf(messages) }).maxTokens,
        usage: { include: true }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();
    // Log the hop like every other LLM call (LIN-418). Fire-and-forget.
    recordLlmCall({
      model: data.model || model,
      provider: data.provider || null,
      finishReason: data.choices?.[0]?.finish_reason || null,
      durationMs: Date.now() - startTime,
      maxTokens,
      ...extractUsage(data.usage)
    }, callMeta);

    return {
      message: data.choices?.[0]?.message || {},
      finishReason: data.choices?.[0]?.finish_reason || null,
      // Returned so a hop-1 short-circuit (LIN-1009) can emit a `done` event whose
      // usage payload is byte-for-byte the shape streamChat would have emitted.
      usage: extractUsage(data.usage)
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('OpenRouter request timed out');
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Reusable tool-calling loop (LIN-988), layered BESIDE streamChat without
 * touching it. The loop runs non-streaming tool hops until the model stops
 * requesting tools (or the iteration cap fires), then streams the FINAL answer
 * through streamChat exactly as today.
 *
 * Flow per hop:
 *   1. Send a non-streaming request with `tools` + `tool_choice`.
 *   2. If the reply carries `tool_calls`, append the assistant turn, run each
 *      call through `executeTool`, truncate the result, and append a
 *      `role: 'tool'` message. Then loop.
 *   3. When a reply carries no tool calls (the model is ready to answer) OR the
 *      hard cap is reached, break and stream the final answer WITHOUT tools so
 *      the model must answer from the accumulated context.
 *
 * No-tool short-circuit (LIN-1009): if the FIRST hop already returns a non-empty
 * answer with zero tool_calls, that hop IS the answer — it is emitted directly
 * (one `token` + `done`) and the redundant second tools-off call is skipped. Any
 * turn that runs ≥1 tool hop still streams its final answer via streamChat (the
 * tool-using contract is unchanged). Quota is unaffected: callers meter one
 * `tryUse` per turn, independent of how many LLM calls this loop makes.
 *
 * A tool that throws is NOT fatal: its error is reported as a `tool` breadcrumb
 * and fed back to the model as the tool result, so the model can recover.
 *
 * The caller's `messages` array is never mutated — tool-call turns are appended
 * to an internal copy.
 *
 * @param {Array<Object>} messages - Chat messages (system, user, assistant)
 * @param {Object} options
 * @param {string} options.apiKey - OpenRouter API key
 * @param {Array<Object>} options.tools - OpenAI-style tool/function definitions
 * @param {Function} options.executeTool - async ({id, name, arguments, rawArguments}) => string|value
 * @param {string} [options.model]
 * @param {number} [options.maxTokens=1000]
 * @param {number} [options.temperature=0.3]
 * @param {string} [options.toolChoice='auto']
 * @param {number} [options.maxIterations=DEFAULT_MAX_TOOL_ITERATIONS]
 * @param {number} [options.toolResultMaxChars=TOOL_RESULT_MAX_CHARS]
 * @param {Object<string,number>} [options.toolResultMaxCharsByTool] - Additive
 *   per-tool budget overrides (LIN-1065): `{ toolName: maxChars }`. A tool named
 *   here uses its own budget; every other tool keeps `toolResultMaxChars`.
 * @param {AbortSignal} [options.signal]
 * @param {Object} [options.callMeta] - Caller attribution for the call log
 * @param {boolean} [options.emitHopText=false] - LIN-3362: emit a tool hop's prose as a
 *   completed `hop-text` frame `{ text }` when the hop returns (never as `token`).
 * @param {boolean} [options.emitHopUsage=false] - LIN-2705: emit each model hop's usage
 *   as a `usage` frame `{ iteration, usage }` when the hop returns, so summing the frames
 *   and the final `done` gives the whole turn. The hop-1 no-tool answer is the exception:
 *   its usage already rides on its `done`, so it emits no `usage` frame.
 * @param {Set<string>} [options.concurrentTools] - LIN-3362: when EVERY call in a hop is
 *   named here, the hop's tools run together (results still reported in call order);
 *   any other call makes the whole hop run serially, as today.
 * @param {Function} onEvent - (type, data) => void.
 *   Types: 'token' / 'done' / 'error' (as streamChat), plus 'tool' breadcrumbs:
 *     { phase: 'call',   iteration, id, name, arguments }
 *     { phase: 'result', iteration, id, name, result }
 *     { phase: 'error',  iteration, id, name, error }
 *     { phase: 'cap',    iteration, maxIterations }
 *   plus, with `emitHopUsage`, `usage` frames `{ iteration, usage }` (see above).
 * @returns {Promise<void>}
 */
export async function streamChatWithTools(messages, options = {}, onEvent) {
  const apiKey = options.apiKey || getPaidEnvKey();
  const model = options.model || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || 1000;
  const temperature = options.temperature ?? 0.3;
  const tools = options.tools || [];
  const executeTool = options.executeTool;
  const toolChoice = options.toolChoice || 'auto';
  const maxIterations = Number.isInteger(options.maxIterations) && options.maxIterations > 0
    ? options.maxIterations
    : DEFAULT_MAX_TOOL_ITERATIONS;
  const resultMaxChars = options.toolResultMaxChars || TOOL_RESULT_MAX_CHARS;
  // Per-tool result budget override (LIN-1065): an additive `{ toolName: max }` map
  // that lets a single tool (e.g. get_comments) carry a larger budget than the
  // global default WITHOUT re-inflating every other tool hop. A tool absent from
  // the map falls through to `resultMaxChars`, so the default stays byte-unchanged.
  const perToolMaxChars = options.toolResultMaxCharsByTool || {};
  const budgetForTool = (name) => {
    const override = perToolMaxChars[name];
    return Number.isInteger(override) && override > 0 ? override : resultMaxChars;
  };

  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured.');
  }

  // Options threaded to the FINAL streamed answer (never carries tool wiring).
  // `allowPartial` rides along so the final answer is whole-or-loud exactly as the
  // caller asked (LIN-4358).
  const allowPartial = options.allowPartial === true;
  const streamOptions = {
    apiKey, model, maxTokens, temperature,
    signal: options.signal, callMeta: options.callMeta,
    ...(allowPartial ? { allowPartial: true } : {})
  };

  // No tools (or no executor) ⇒ nothing to loop over; behave exactly like
  // streamChat so the primitive is a safe drop-in for the tool-less case.
  if (!tools.length || typeof executeTool !== 'function') {
    return streamChat(messages, streamOptions, onEvent);
  }

  // Work on a copy — the caller's array must not gain tool-call turns.
  const convo = messages.slice();

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const { message, finishReason, usage } = await runToolHop(convo, {
      tools, toolChoice, apiKey, model, temperature, maxTokens,
      signal: options.signal, callMeta: options.callMeta
    });

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length === 0) {
      // The model declined tools. On the FIRST hop with a real answer in hand,
      // this is the common no-tool chat turn: the (non-streaming) hop already
      // holds the complete answer, so emit it directly and skip the redundant
      // second tools-off streamChat call — halving cost/latency for that turn
      // (LIN-1009). The blob-vs-token UX cost is accepted: the current re-stream
      // is actually SLOWER to first content (it awaits the full hop AND a second
      // call), and a single-token answer is already the established shape (see
      // the mockAi task-chat branch). We short-circuit ONLY here — after any tool
      // hop has run, the contract still requires the final answer to stream fresh
      // from the accumulated context (the streamChat below).
      //
      // LIN-4358: only a WHOLE hop-1 answer short-circuits (or any answer, for a caller
      // that takes partials). A cut-off one falls through to the streamed final answer,
      // which carries the budget retry and fails loudly if it is still cut.
      if (iteration === 1 && typeof message.content === 'string' && message.content.length > 0
          && (allowPartial || isCompleteFinish(finishReason))) {
        onEvent('token', { token: message.content });
        onEvent('done', { finishReason, usage });
        return;
      }
      // No usable hop-1 content (empty answer, or a later hop) — fall through to
      // the streamed final answer so the model produces a real response.
      // LIN-2705: this hop is billed but its reply is discarded for the streamed
      // answer below, so its usage is reported here or it is lost from the turn.
      if (options.emitHopUsage) onEvent('usage', { iteration, usage });
      break;
    }

    // LIN-2705: every hop that requests tools is billed in full before its calls run,
    // so its usage is known now. Reported once, here, not per tool call.
    if (options.emitHopUsage) onEvent('usage', { iteration, usage });

    // LIN-4358: a hop cut at `length` beside its tool calls has cut JSON arguments (they
    // would parse to `{}` and the tool would run on nothing). Refuse before any tool runs.
    if (finishReason === 'length' && !allowPartial) {
      throw new TruncatedOutputError({
        model, finishReason,
        completionTokens: usage?.completionTokens ?? null,
        reasoningTokens: usage?.reasoningTokens ?? null,
        maxTokens: planCallBudget({ model, maxTokens, promptChars: promptCharsOf(convo) }).maxTokens
      });
    }

    // The assistant turn that requested the tools must remain in history, or the
    // following `role: 'tool'` messages have nothing to attach to.
    convo.push({ role: 'assistant', content: message.content ?? null, tool_calls: toolCalls });

    // LIN-3362: a tool hop is non-streaming, so the prose beside its tool calls only
    // exists once the hop returns. Emit it as its own completed frame (never `token`,
    // which clients treat as answer-bubble text and the observer pass buffers). Off
    // by default so every other caller's frames are unchanged.
    if (options.emitHopText && typeof message.content === 'string' && message.content.trim()) {
      onEvent('hop-text', { text: message.content });
    }

    // Parse + budget + execute + truncate one call. Shared by the serial and the
    // concurrent path so the two cannot drift. Returns the frame to emit and the
    // tool message to append; it emits nothing itself.
    const runCall = async (call) => {
      const name = call.function?.name || '';
      let parsedArgs = {};
      try {
        parsedArgs = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        parsedArgs = {};
      }
      // Resolve this specific tool's budget: its per-tool override if present,
      // else the global default. Both the success and error paths use it so a
      // large-budget tool's error text is clipped by the same rule (LIN-1065).
      const toolMaxChars = budgetForTool(name);
      const callFrame = { phase: 'call', iteration, id: call.id, name, arguments: parsedArgs };
      const run = async () => {
        try {
          const raw = await executeTool({
            id: call.id, name, arguments: parsedArgs, rawArguments: call.function?.arguments
          });
          const resultText = truncateToolResult(raw, toolMaxChars);
          return { resultText, frame: { phase: 'result', iteration, id: call.id, name, result: resultText } };
        } catch (err) {
          // A failing tool is recoverable context, not a fatal error: hand the
          // model the error text so it can adjust on the next hop.
          const errMessage = err?.message || String(err);
          const resultText = truncateToolResult(`Error: ${errMessage}`, toolMaxChars);
          return { resultText, frame: { phase: 'error', iteration, id: call.id, name, error: errMessage } };
        }
      };
      return { name, callFrame, run };
    };

    const concurrent = options.concurrentTools instanceof Set
      && toolCalls.length > 1
      && toolCalls.every(c => options.concurrentTools.has(c.function?.name || ''));

    if (concurrent) {
      // Every call is a read: announce them all in order, run them together, then
      // report results in ORIGINAL call order so the frames and `convo` match what
      // the serial path would have produced (the caller's `emit` rewrites by call
      // id, one result at a time). No cap: width is bounded by what the model
      // returned in one response and `maxIterations`.
      const prepared = await Promise.all(toolCalls.map(runCall));
      for (const p of prepared) onEvent('tool', p.callFrame);
      const settled = await Promise.all(prepared.map(p => p.run()));
      toolCalls.forEach((call, i) => {
        onEvent('tool', settled[i].frame);
        convo.push({ role: 'tool', tool_call_id: call.id, name: prepared[i].name, content: settled[i].resultText });
      });
    } else {
      for (const call of toolCalls) {
        const { name, callFrame, run } = await runCall(call);
        onEvent('tool', callFrame);
        const { resultText, frame } = await run();
        onEvent('tool', frame);
        convo.push({ role: 'tool', tool_call_id: call.id, name, content: resultText });
      }
    }

    if (iteration >= maxIterations) {
      // Cap reached with the model still asking for tools. Announce it and drop
      // out to the tool-less final answer below.
      onEvent('tool', { phase: 'cap', iteration, maxIterations });
    }
  }

  // Final answer ALWAYS streams — byte-identical to streamChat — and is sent
  // WITHOUT tools so the model can no longer request hops and must answer from
  // the context accumulated above.
  return streamChat(convo, streamOptions, onEvent);
}

/**
 * The action-name and defer-target readers now live with the next-stage choice
 * (LIN-3304, lib/stage-router.js); re-exported here so existing importers
 * (e.g. the fused recommend-and-dispatch verb)
 * keep one canonical parser.
 */
export { parseRecommendedAction, parseDeferTo };

/** The routing reply's decision object in the `parsed` shape the entry points pass on. */
function routedReplyToParsed(d) {
  return {
    reasoning: d.reasoning,
    prompt: null,
    truncated: d.truncated,
    recommendedAction: d.action,
    deferTo: d.deferTo,
    completionTokens: d.completionTokens
  };
}

/**
 * Turn a routing reply into a recommendation with a prompt (LIN-3292, LIN-3300): the
 * action picks the stage and code assembles its prompt, exactly generatePrompt for that
 * stage (its lead, Scope and Authority, process, contract and grounding). A defer has
 * no body (the no-body cost contract). An action that names no stage is an invalid
 * reply: there is no body to fall back to.
 *
 * @param {Object} parsed - routedReplyToParsed(routeStage(...))
 * @returns {Object} parsed with prompt filled (unchanged on defer)
 */
export function composeRoutedRecommendation(parsed, issue, context = {}, featureFlags = {}, providerUi = null) {
  if (parsed.recommendedAction === 'defer') return parsed;
  const out = generatePrompt(deriveDispatchKind(parsed.recommendedAction), issue, context, featureFlags, providerUi);
  if (!out) throw new Error(`Invalid response: action "${parsed.recommendedAction}" names no stage`);
  return { ...parsed, prompt: out.prompt };
}

/**
 * The code routes settle a recommendation without a routing call (lib/code-routes.js, which holds
 * their order and reasons). None reads a model's verdict. Both seams call this one helper, so
 * getRecommendation and getRecommendationStream never differ. Code assembles the prompt exactly as
 * a routed stage gets it, and the trace records which route fired (`codeRoute`: the `emits` of the
 * entry that fired). A `live-wait` returns no step and no prompt, with `liveWait` naming the run.
 * Null when none applies: the selector decides.
 */
function codeRoutedRecommendation(issue, context, featureFlags, providerUi, metaPrompt, model, options) {
  const route = codeRouteOf(issue, context, options);
  if (!route) return null;
  if (route.wait) {
    // A live stage run: no step and no prompt, and no selector call either (it could send
    // another stage beside the live one). The trace names it apart from the routes that send.
    const reasoning = `→ **wait** for ${route.wait.kind}\n**Why now:** ${route.why}`;
    recordPromptTrace({
      metaPrompt, model, featureFlags, providerUi,
      rawContent: reasoning, reasoning, prompt: null, finalPrompt: null,
      finishReason: 'code-route', truncated: false, codeRoute: route.codeRoute
    }, options.callMeta);
    return { reasoning, prompt: null, truncated: false, recommendedAction: null, deferTo: null, completionTokens: null, codeRoute: route.codeRoute, liveWait: route.wait };
  }
  const reasoning = `→ **${route.action}**\n**Why now:** ${route.why}`;
  const parsed = routedReplyToParsed({ reasoning, action: route.action, deferTo: null, truncated: false, completionTokens: null });
  const structured = composeRoutedRecommendation(parsed, issue, context, featureFlags, providerUi);
  recordPromptTrace({
    metaPrompt, model, featureFlags, providerUi,
    rawContent: reasoning, reasoning, prompt: null, finalPrompt: structured.prompt,
    finishReason: 'code-route', truncated: false, codeRoute: route.codeRoute
  }, options.callMeta);
  return { ...structured, codeRoute: route.codeRoute };
}

/**
 * Which code route applies: the first entry of CODE_ROUTES (lib/code-routes.js, the order and
 * its reasons) whose route does not stand aside. `options.skipLiveWait` (set only by
 * recommend-and-dispatch's descent arm, for `force: true` or a set `followUpTo`) drops the first
 * entry, the live-stage wait, and nothing else.
 */
function codeRouteOf(issue, context, options = {}) {
  const routes = options.skipLiveWait === true ? CODE_ROUTES.slice(1) : CODE_ROUTES;
  for (const entry of routes) {
    const route = entry.route(issue, context);
    if (route) return route;
  }
  return null;
}

/**
 * Get a recommendation for a task: one routing call picks the stage (or a code route in
 * CODE_ROUTES settles it), then code assembles that stage's prompt.
 * @param {Object} issue - The issue object with identifier, title, description, state, labels
 * @param {Object} context - Context with parent, siblings, project, children
 * @param {Object} [options] - Optional settings
 * @param {string} [options.apiKey] - API key from user session (OAuth), falls back to env
 * @param {string} [options.model] - Model ID to use, falls back to DEFAULT_MODEL
 * @param {Object} [options.featureFlags] - Feature toggle flags
 * @param {boolean} [options.skipLiveWait] - skip the first code route, the live-stage wait (LIN-4392, CODE_ROUTES[0]): recommend-and-dispatch's `force`/`followUpTo` only
 * @returns {Promise<{reasoning: string, prompt: string|null, recommendedAction: string|null, deferTo: string|null, truncated: boolean, completionTokens: number|null, liveWait?: Object}>}
 */
export async function getRecommendation(issue, context, options = {}) {
  const apiKey = options.apiKey || getPaidEnvKey();
  const model = options.model || DEFAULT_MODEL;
  const featureFlags = options.featureFlags || {};
  const providerUi = options.providerUi || null;
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured. Connect your OpenRouter account or set OPENROUTER_API_KEY.');
  }

  // Initialize proxy support if needed
  await initProxyFetch();

  // LIN-2854: fail before any transport call when the signal is already aborted
  // (a pre-aborted signal fires no future `abort` event).
  throwIfAborted(options.signal);

  const metaPrompt = buildRoutingPrompt(issue, context, featureFlags, providerUi);

  // The code routes (lib/code-routes.js, in their order): none is a routing call.
  const bounded = codeRoutedRecommendation(issue, context, featureFlags, providerUi, metaPrompt, model, options);
  if (bounded) return bounded;

  const budget = planRoutingBudget(model, metaPrompt);
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Honor an external abort signal (gap #2, LIN-346) so a caller — the proxy LLM
  // call, the per-hop descent, the streaming fallback — can cancel an in-flight
  // generation, mirroring the sibling streaming functions. The listener is detached
  // on settle (finally) so a long-lived external signal can't pin this closure.
  const onExternalAbort = () => controller.abort();
  if (options.signal) options.signal.addEventListener('abort', onExternalAbort);

  try {
    const recommendFetch = await resolveOpenRouterFetch();
    const response = await recommendFetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/JKershaw/LinearViewer',
        'X-Title': 'Harbour'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: metaPrompt
          }
        ],
        temperature: 0,
        max_tokens: budget.maxTokens,
        ...(budget.reasoning ? { reasoning: budget.reasoning } : {}),
        // LIN-418: usage accounting — OpenRouter returns cost + token counts in
        // the response when this is set, so we log cost without a price table.
        usage: { include: true }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const finishReason = data.choices?.[0]?.finish_reason;
    const completionTokens = data.usage?.completion_tokens;

    // Record the call metadata (LIN-418). Fire-and-forget; never blocks the return.
    recordLlmCall({
      model: data.model || model,
      provider: data.provider || null,
      finishReason: finishReason || null,
      durationMs: Date.now() - startTime,
      maxTokens: budget.maxTokens,
      ...extractUsage(data.usage)
    }, options.callMeta);

    if (!content) {
      throw new Error('No response content from OpenRouter');
    }

    // The next-stage choice parses its own reply (LIN-3304); code assembles the
    // routed stage's prompt (skipped on defer, which has no body).
    const parsed = routedReplyToParsed(routeStage(content, finishReason, completionTokens));
    const structured = composeRoutedRecommendation(parsed, issue, context, featureFlags, providerUi);

    // Record the full prompt trace (LIN-578). Content-bearing sibling of the
    // metadata log above; fire-and-forget, always-on, session-auth read only.
    recordPromptTrace({
      metaPrompt,
      model: data.model || model,
      featureFlags,
      providerUi,
      rawContent: content,
      reasoning: parsed.reasoning,
      prompt: parsed.prompt,
      finalPrompt: structured.prompt,
      finishReason: finishReason || null,
      truncated: parsed.truncated
    }, options.callMeta);

    return structured;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('OpenRouter request timed out');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
  }
}
