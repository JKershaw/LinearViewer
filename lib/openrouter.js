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
import { isTerminalState, compareByIdentifier } from './tree.js';
import {
  assembleNodeFacts, reviewLoopExhausted, condensePlan, isRuling, isPersonComment,
  assembleTrailFacts, formatTrailFactsBlock, formatNodeFactsBlock
} from './recommendation-facts.js';
import { getDisplayPricing } from './model-pricing.js';

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
// OpenAI reasoning models (the default openai/gpt-5.4-mini and the LIN-819
// GPT-5.5 / GPT-5.5 Pro overrides) spend hidden reasoning tokens against the
// SAME completion budget as visible prose. A live OpenRouter spike confirmed
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

// Model families that spend hidden reasoning tokens. The split only applies to
// these — a non-reasoning model has no hidden reasoning to bound, so it keeps a
// bare `max_tokens` and never receives an unsupported `reasoning` field.
export const REASONING_MODEL_PREFIXES = ['openai/gpt-5', 'openai/o1', 'openai/o3', 'openai/o4'];

// Reasoning headroom reserved ON TOP of the prose budget, clamped so the split
// stays proportional to the ask without ballooning cost on large prose caps.
export const REASONING_MIN_TOKENS = 2000;
export const REASONING_MAX_TOKENS = 8000;

/**
 * Whether a model spends hidden reasoning tokens (and therefore needs the split).
 * Prefix match against REASONING_MODEL_PREFIXES, case-insensitive.
 *
 * @param {string} model - Model id (e.g. 'openai/gpt-5.4-mini')
 * @returns {boolean}
 */
export function isReasoningModel(model) {
  const id = String(model || '').toLowerCase();
  return REASONING_MODEL_PREFIXES.some(prefix => id.startsWith(prefix));
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
 * The default reasoning allowance for a prose budget: the prose budget clamped to
 * [REASONING_MIN_TOKENS, REASONING_MAX_TOKENS]. Pure.
 * @param {number} proseTokens
 * @returns {number}
 */
export function defaultReasoningTokens(proseTokens) {
  const prose = Math.max(1, Math.floor(Number(proseTokens) || 0));
  return Math.min(REASONING_MAX_TOKENS, Math.max(REASONING_MIN_TOKENS, prose));
}

/**
 * Output token cap for the routing reply. Since LIN-3300 the reply is reasoning and a
 * decision only (code assembles the prompt), so 8000 is headroom, not a budget a prompt
 * body competes for.
 */
const RECOMMENDATION_MAX_TOKENS = 8000;

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
 * grandchildren via siblings ("cousins") are likely to matter for strategy framing.
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
 * Available models for the settings dropdown.
 *
 * Curated (LIN-263) to only what we've validated or trust by size — a benchmarked
 * default plus safe higher-cost fallbacks — so an operator can't silently pick a model
 * that fails a call. The free-text custom-model input remains for power users who want
 * to try anything on OpenRouter.
 *
 * - GPT-5.4-Mini: the validated default (passes recommend + brief + recap).
 * - Sonnet 4.6 / Opus 4.8, Sonnet 5 / Opus 5 / Fable 5: safe higher-tier fallbacks
 *   (frontier quality, more expensive).
 * - Haiku 4.5 (LIN-1763): added on request despite LIN-263 benchmarking it as a
 *   repeatable mis-router on dense tickets. Its `description` below records that
 *   caveat for anyone reading this list, but the Settings <select> only renders
 *   `name` — no description text reaches the UI — so this is documentation, not
 *   an in-product warning at the point of choice.
 *
 * Deliberately omitted despite being cheap: DeepSeek V4-Flash (repeatably mis-routes
 * dense tickets) and Gemini 3.5 Flash (emits chain-of-thought before the recap JSON
 * and blows the token cap → empty recap). See lin-263-findings.md.
 *
 * `pricing` (LIN-993) is a static per-model rate card in USD per 1M tokens
 * ({ prompt, completion }), surfaced as a hint line under the model selector. It is
 * NOT the LLM call log (that is retrospective spend, not a rate).
 *
 * The rates themselves now live in `lib/model-pricing.js` (LIN-1495), which widened
 * the card to four tiers (adding cache-read/cache-write) so dispatched worker token
 * usage can be priced. Each entry DERIVES its two-tier `{ prompt, completion }` view
 * from that table via `getDisplayPricing`, so LIN-993's charter still holds — the same
 * human edit that adds a model adds its rate — with one representation rather than
 * two hand-synced ones. Rate edits and re-verification happen THERE; this list stays
 * what it has always been: the curated, user-facing allowlist. It is also a
 * security-relevant one (it gates `isToolCapableModel` and the fail-closed free-tier
 * clamp), so a model being priceable is deliberately NOT a reason to add it here.
 *
 * An id with no rate row derives `pricing: null`, which the UI already handles by
 * degrading to "pricing: —" rather than lying.
 */
export const AVAILABLE_MODELS = [
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', description: 'Default - validated, fast and cheap' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', description: 'Safe higher tier (mid frontier)' },
  { id: 'anthropic/claude-opus-4.8', name: 'Claude Opus 4.8', description: 'Safe frontier (most expensive)' },
  { id: 'openai/gpt-5.5', name: 'GPT-5.5', description: 'Frontier - newer, higher cost' },
  { id: 'openai/gpt-5.5-pro', name: 'GPT-5.5 Pro', description: 'Frontier Pro - highest tier, most expensive' },
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', description: 'Mid frontier, newest generation' },
  { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', description: 'Frontier (newest Claude)' },
  { id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', description: 'Frontier - 1M context' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', description: 'Cheapest - weaker on dense tickets (LIN-263)' },
  { id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Mid frontier, same tier as Sonnet 5' },
].map(m => ({ ...m, pricing: getDisplayPricing(m.id) }));

/**
 * Format a model's static rate card into a compact one-line hint for the UI
 * (LIN-993). Returns null when the model has no known `pricing` (e.g. a custom
 * OpenRouter id the operator typed), so callers can render a "—" placeholder.
 *
 * @param {Object|null} model - An AVAILABLE_MODELS entry (or any object with `pricing`)
 * @returns {string|null} e.g. "$0.75 in / $4.50 out per 1M tokens"
 */
export function formatModelPricing(model) {
  const p = model && model.pricing;
  if (!p || typeof p.prompt !== 'number' || typeof p.completion !== 'number') return null;
  return `$${p.prompt.toFixed(2)} in / $${p.completion.toFixed(2)} out per 1M tokens`;
}

/**
 * Look up the formatted pricing hint for a model ID (LIN-993). Convenience wrapper
 * over formatModelPricing for callers that only have the id string.
 *
 * @param {string} modelId - Model ID
 * @returns {string|null} Formatted pricing hint, or null when unknown
 */
export function getModelPricingHint(modelId) {
  return formatModelPricing(AVAILABLE_MODELS.find(m => m.id === modelId));
}

/**
 * Friendly display name for a model ID, for compact UI surfaces like the footer.
 *
 * Prefers the curated name from AVAILABLE_MODELS; for custom/uncurated IDs falls
 * back to the provider-stripped slug (e.g. 'openai/gpt-5.4-mini' → 'gpt-5.4-mini').
 *
 * @param {string} modelId - Model ID (defaults to DEFAULT_MODEL when falsy)
 * @returns {string} Short display name
 */
export function getModelDisplayName(modelId) {
  const id = modelId || DEFAULT_MODEL;
  const known = AVAILABLE_MODELS.find(m => m.id === id);
  if (known) return known.name;
  return id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
}

/**
 * Whether a model is known to support the tool-calling round-trip (LIN-990).
 *
 * Capability = membership in the curated {@link AVAILABLE_MODELS} allowlist. Using
 * that single list as the source of truth keeps future model additions (e.g. the
 * LIN-992 GPT-5.5 pair) in sync automatically — no separate capability table to
 * drift. A custom/uncurated id, or a falsy/non-string id, is treated as UNKNOWN,
 * and unknown ≠ capable: the caller must degrade to plain streaming rather than
 * offer tools a model may not honor (or, worse, silently swap the user's choice).
 *
 * @param {string} modelId - Model ID (e.g. 'openai/gpt-5.4-mini')
 * @returns {boolean} True only for a curated, tool-capable model id.
 */
export function isToolCapableModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  return AVAILABLE_MODELS.some(m => m.id === modelId);
}

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
  if (id && AVAILABLE_MODELS.some(m => m.id === id)) return id;
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
  if (!id || AVAILABLE_MODELS.some(m => m.id === id)) return null;
  return `OPENROUTER_FREE_TIER_MODEL="${id}" is not a curated model id — ignoring it. `
    + `Free-tier requests stay on ${DEFAULT_MODEL}. `
    + `Valid ids: ${AVAILABLE_MODELS.map(m => m.id).join(', ')}`;
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
 * @returns {{promptTokens:number|null, completionTokens:number|null, totalTokens:number|null, cost:number|null}}
 */
function extractUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return { promptTokens: null, completionTokens: null, totalTokens: null, cost: null };
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    totalTokens: num(usage.total_tokens),
    cost: num(usage.cost)
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
      lines.push(`*${notShown} siblings not shown. If the Strategy Framing step names a contract gap not in this list, fetch the parent epic's full child list via the API before committing to a strategy.*`);
    }
  }

  // Related work in the parent epic (cousins) — only in the non-focusedChild branch.
  // Cousins widen the frame so Strategy Framing can spot adjacent tracked contract
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
      lines.push(`*${notShown} cousins not shown. If the Strategy Framing step names a contract gap not in this list, fetch the parent epic's full descendant tree via the API before committing to a strategy.*`);
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
 * The stage selector's inputs (LIN-3300): its own view of the ticket and the facts code
 * computes from the whole trail, as plain data.
 * @param {Object} issue
 * @param {Object} [context]
 * @param {Object} [featureFlags]
 * @param {Object} [providerUi]
 * @returns {Object} buildRouterPrompt's params
 */
export function buildSelectorArgs(issue, context = {}, featureFlags = {}, providerUi = null) {
  const children = context.children || [];
  const comments = context.comments || [];
  const trail = formatTrailFactsBlock(assembleTrailFacts(comments, issue.description, { leaf: children.length === 0 }), comments.length);
  return {
    view: formatSelectorView(issue, context),
    identifier: issue.identifier,
    facts: [trail, formatNodeFactsBlock(assembleNodeFacts(issue, children), children.length)].filter(Boolean).join('\n'),
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

  const metaPrompt = buildRoutingPrompt(issue, context, featureFlags, providerUi);

  // The review loop bound (LIN-3309): code stops the loop, so no routing call is made.
  const bounded = loopBoundRecommendation(issue, context, featureFlags, providerUi, metaPrompt, model, options);
  if (bounded) {
    onEvent('phase', { phase: 'reasoning' });
    onEvent('delta', { section: 'reasoning', content: bounded.reasoning });
    onEvent('phase', { phase: 'prompt' });
    onEvent('delta', { section: 'prompt', content: bounded.prompt });
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
        max_tokens: RECOMMENDATION_MAX_TOKENS,
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
 * Generic chat streaming function for arbitrary messages.
 *
 * Unlike getRecommendationStream (which is specific to the routing call),
 * this accepts a raw messages array and streams plain tokens without section parsing.
 *
 * @param {Array<{role: string, content: string}>} messages - Chat messages (system, user, assistant)
 * @param {Object} options
 * @param {string} options.apiKey - OpenRouter API key
 * @param {string} [options.model] - Model ID (defaults to DEFAULT_MODEL)
 * @param {number} [options.maxTokens=1000] - Max output tokens
 * @param {number} [options.temperature=0.3] - Sampling temperature
 * @param {AbortSignal} [options.signal] - Abort signal
 * @param {Function} onEvent - Callback: (type, data) => void
 *   Types: 'token' (streaming text), 'done' (with { finishReason }), 'error'
 * @returns {Promise<void>}
 */
export async function streamChat(messages, options = {}, onEvent) {
  const apiKey = options.apiKey || getPaidEnvKey();
  const model = options.model || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || 1000;
  const temperature = options.temperature ?? 0.3;
  // LIN-1000: opt-in reasoning allocation. Spliced into the request body ONLY
  // when a caller supplies it — omitted ⇒ the body is byte-identical to today,
  // so every sibling call site (recap/brief/run-summary/session-summary/next-run/
  // feedback-title/task-chat + streamChatWithTools) is provably unaffected.
  const reasoning = options.reasoning;

  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured.');
  }

  await initProxyFetch();

  // LIN-2637: guard the already-aborted case BEFORE any request is issued. An
  // AbortSignal that is already aborted fires no future `abort` event — the
  // event has been and gone — so the listener registered in the branches below
  // would never fire and a full streaming call would be bought and discarded.
  // Placed AFTER initProxyFetch so an abort landing during that await is also
  // caught; this single check covers both the streaming and non-streaming
  // branches below, and everything from here to the listener registration is
  // synchronous, so no abort can slip between the check and the listener.
  throwIfAborted(options.signal);

  const startTime = Date.now();
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
                   process.env.https_proxy || process.env.http_proxy;
  const useStreaming = !proxyUrl;

  if (!useStreaming) {
    // Fallback: non-streaming request, emit all at once
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const nonStreamFetch = await resolveOpenRouterFetch();
      const response = await nonStreamFetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/JKershaw/LinearViewer',
          'X-Title': 'Harbour'
        },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, usage: { include: true }, ...(reasoning ? { reasoning } : {}) }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errorBody}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const finishReason = data.choices?.[0]?.finish_reason || null;
      // Record the call metadata (LIN-418). Fire-and-forget.
      recordLlmCall({
        model: data.model || model,
        provider: data.provider || null,
        finishReason,
        durationMs: Date.now() - startTime,
        ...extractUsage(data.usage)
      }, options.callMeta);
      onEvent('token', { token: content });
      onEvent('done', { finishReason, usage: extractUsage(data.usage) });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('OpenRouter request timed out');
      throw error;
    }
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const streamChatFetch = await resolveOpenRouterFetch();
    const response = await streamChatFetch(OPENROUTER_API_URL, {
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
        temperature,
        max_tokens: maxTokens,
        stream: true,
        // LIN-418: usage accounting — the final SSE chunk carries cost + tokens.
        usage: { include: true },
        // LIN-1000: opt-in reasoning allocation, omitted ⇒ byte-identical body.
        ...(reasoning ? { reasoning } : {})
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorBody}`);
    }

    let sseBuffer = '';
    let finishReason = null;
    // LIN-418: accumulate usage/provider/model across chunks for the call log.
    let usageMeta = null;
    let responseProvider = null;
    let responseModel = null;
    for await (const chunk of response.body) {
      const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      sseBuffer += text;

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
              onEvent('token', { token: content });
            }
            const reason = parsed.choices?.[0]?.finish_reason;
            if (reason) finishReason = reason;
            if (parsed.usage) usageMeta = parsed.usage;
            if (parsed.provider) responseProvider = parsed.provider;
            if (parsed.model) responseModel = parsed.model;
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }

    // Record the call metadata (LIN-418). Fire-and-forget.
    recordLlmCall({
      model: responseModel || model,
      provider: responseProvider || null,
      finishReason,
      durationMs: Date.now() - startTime,
      ...extractUsage(usageMeta)
    }, options.callMeta);

    onEvent('done', { finishReason, usage: extractUsage(usageMeta) });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('OpenRouter request timed out');
    throw error;
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
        max_tokens: maxTokens,
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
 * @param {Function} onEvent - (type, data) => void.
 *   Types: 'token' / 'done' / 'error' (as streamChat), plus 'tool' breadcrumbs:
 *     { phase: 'call',   iteration, id, name, arguments }
 *     { phase: 'result', iteration, id, name, result }
 *     { phase: 'error',  iteration, id, name, error }
 *     { phase: 'cap',    iteration, maxIterations }
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
  const streamOptions = {
    apiKey, model, maxTokens, temperature,
    signal: options.signal, callMeta: options.callMeta
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
      if (iteration === 1 && typeof message.content === 'string' && message.content.length > 0) {
        onEvent('token', { token: message.content });
        onEvent('done', { finishReason, usage });
        return;
      }
      // No usable hop-1 content (empty answer, or a later hop) — fall through to
      // the streamed final answer so the model produces a real response.
      break;
    }

    // The assistant turn that requested the tools must remain in history, or the
    // following `role: 'tool'` messages have nothing to attach to.
    convo.push({ role: 'assistant', content: message.content ?? null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      const name = call.function?.name || '';
      let parsedArgs = {};
      try {
        parsedArgs = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        parsedArgs = {};
      }

      onEvent('tool', { phase: 'call', iteration, id: call.id, name, arguments: parsedArgs });

      // Resolve this specific tool's budget: its per-tool override if present,
      // else the global default. Both the success and error paths use it so a
      // large-budget tool's error text is clipped by the same rule (LIN-1065).
      const toolMaxChars = budgetForTool(name);

      let resultText;
      try {
        const raw = await executeTool({
          id: call.id, name, arguments: parsedArgs, rawArguments: call.function?.arguments
        });
        resultText = truncateToolResult(raw, toolMaxChars);
        onEvent('tool', { phase: 'result', iteration, id: call.id, name, result: resultText });
      } catch (err) {
        // A failing tool is recoverable context, not a fatal error: hand the
        // model the error text so it can adjust on the next hop.
        const errMessage = err?.message || String(err);
        resultText = truncateToolResult(`Error: ${errMessage}`, toolMaxChars);
        onEvent('tool', { phase: 'error', iteration, id: call.id, name, error: errMessage });
      }

      convo.push({ role: 'tool', tool_call_id: call.id, name, content: resultText });
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
 * The review loop bound (LIN-3309, reviewLoopExhausted): the one route code settles. A
 * plan that keeps being sent back stops at `blocked` for a person, without a routing
 * call; code assembles the prompt exactly as a routed `blocked` gets it and records the
 * same trace. Null when the bound does not apply.
 */
function loopBoundRecommendation(issue, context, featureFlags, providerUi, metaPrompt, model, options) {
  if (!reviewLoopExhausted(issue, context.comments || [])) return null;
  const reasoning = '→ **blocked**\n**Why now:** the plan-review loop reached its bound: the plan has been sent back repeatedly since its last Approve, with no person\'s comment since the latest verdict.';
  const parsed = routedReplyToParsed({ reasoning, action: 'blocked', deferTo: null, truncated: false, completionTokens: null });
  const structured = composeRoutedRecommendation(parsed, issue, context, featureFlags, providerUi);
  recordPromptTrace({
    metaPrompt, model, featureFlags, providerUi,
    rawContent: reasoning, reasoning, prompt: null, finalPrompt: structured.prompt,
    finishReason: 'code-route', truncated: false, codeRoute: 'blocked'
  }, options.callMeta);
  return { ...structured, codeRoute: 'blocked' };
}

/**
 * Get a recommendation for a task: one routing call picks the stage (or the review loop
 * bound settles it), then code assembles that stage's prompt.
 * @param {Object} issue - The issue object with identifier, title, description, state, labels
 * @param {Object} context - Context with parent, siblings, project, children
 * @param {Object} [options] - Optional settings
 * @param {string} [options.apiKey] - API key from user session (OAuth), falls back to env
 * @param {string} [options.model] - Model ID to use, falls back to DEFAULT_MODEL
 * @param {Object} [options.featureFlags] - Feature toggle flags
 * @returns {Promise<{reasoning: string, prompt: string|null, recommendedAction: string|null, deferTo: string|null, truncated: boolean, completionTokens: number|null}>}
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

  const metaPrompt = buildRoutingPrompt(issue, context, featureFlags, providerUi);

  // The review loop bound (LIN-3309): code stops the loop, so no routing call is made.
  const bounded = loopBoundRecommendation(issue, context, featureFlags, providerUi, metaPrompt, model, options);
  if (bounded) return bounded;

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Honor an external abort signal (gap #2, LIN-346) so a caller — the proxy LLM
  // call, the per-hop descent, the streaming fallback — can cancel an in-flight
  // generation, mirroring the sibling streaming functions. The listener is detached
  // on settle (finally) so a long-lived external signal can't pin this closure.
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onExternalAbort);
  }

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
        max_tokens: RECOMMENDATION_MAX_TOKENS,
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
