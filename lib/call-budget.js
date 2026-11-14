/**
 * The token budget of one OpenRouter call, sized from the model's catalog entry (LIN-4358).
 *
 * Callers state the visible output they need (`maxTokens`). The call layer
 * (lib/openrouter.js `streamChat` and the tool hops) asks this module what to put on
 * the wire, so no caller keeps its own rule about which models reason.
 *
 * Why headroom and not a reasoning field: a model that can reason may spend hidden
 * reasoning tokens out of the same `max_tokens` as the answer. The catalog cannot say
 * reliably whether it will when not asked: on 7 Nov 2026 it said
 * `default_enabled: false` for openai/gpt-5.4-mini, which Harbour has measured spending
 * hidden reasoning against a bare cap (LIN-1000, LIN-1665), and it gave no
 * `default_enabled` at all for anthropic/claude-haiku-5.5. So the first attempt raises
 * `max_tokens` to prose + headroom for every model whose catalog entry has a
 * `reasoning` object, and sends NO `reasoning` field: a bigger cap costs nothing unless
 * it is used, and it does not turn thinking on (the LIN-1665 trap). If reasoning still
 * eats the cap, `planRetryBudget` bounds it explicitly for one retry.
 *
 * A model the catalog says cannot reason (no `reasoning` object) gets exactly the
 * requested cap, and so does a cold cache or an id the catalog does not list: there is
 * no fact to size from, and the retry still recovers a cut-off answer.
 *
 * Pure apart from the synchronous catalog-cache read.
 */

import { getCachedCatalogModel } from './openrouter-catalog.js';

/** Floor and ceiling of the reasoning allowance (LIN-1000's values). */
export const REASONING_MIN_TOKENS = 2000;
export const REASONING_MAX_TOKENS = 8000;

/** Rough characters per token, used only to keep headroom inside the context window. */
const CHARS_PER_TOKEN = 4;

/**
 * The reasoning allowance for a prose budget: the prose budget clamped to
 * [REASONING_MIN_TOKENS, REASONING_MAX_TOKENS].
 * @param {number} proseTokens
 * @returns {number}
 */
export function defaultReasoningTokens(proseTokens) {
  const prose = Math.max(1, Math.floor(Number(proseTokens) || 0));
  return Math.min(REASONING_MAX_TOKENS, Math.max(REASONING_MIN_TOKENS, prose));
}

/** Total characters of string message content (multimodal parts count their text). */
export function promptCharsOf(messages) {
  let n = 0;
  for (const m of messages || []) {
    const c = m?.content;
    if (typeof c === 'string') n += c.length;
    else if (Array.isArray(c)) for (const part of c) if (typeof part?.text === 'string') n += part.text.length;
  }
  return n;
}

/**
 * The most output tokens the catalog says this call may ask for: the endpoint's
 * `max_completion_tokens`, and what is left of `context_length` after the prompt.
 * Infinity when the catalog gives neither.
 */
function outputLimitOf(entry, promptChars) {
  let limit = Infinity;
  if (Number.isFinite(entry?.max_completion_tokens) && entry.max_completion_tokens > 0) {
    limit = entry.max_completion_tokens;
  }
  if (Number.isFinite(entry?.context_length) && entry.context_length > 0) {
    const left = entry.context_length - Math.ceil((Number(promptChars) || 0) / CHARS_PER_TOKEN);
    if (left > 0) limit = Math.min(limit, left);
  }
  return limit;
}

/**
 * The wire budget for a call's first attempt.
 *
 * - The caller passed an explicit `reasoning` field (roadmap, ship-biscuit through
 *   `resolveReasoningBudget`): its `maxTokens` is already prose + reasoning, so it is
 *   kept, only lowered to the catalog's output limit.
 * - The catalog lists the model with a `reasoning` object: prose + headroom, within the
 *   output limit (never below the requested prose).
 * - Otherwise: the requested cap, unchanged.
 *
 * @param {Object} args
 * @param {string} args.model
 * @param {number} args.maxTokens - visible output the caller needs
 * @param {Object} [args.reasoning] - caller's explicit OpenRouter `reasoning` field
 * @param {number} [args.promptChars]
 * @returns {{ maxTokens: number, reasoning: (Object|undefined), proseTokens: number, headroom: number }}
 */
export function planCallBudget({ model, maxTokens, reasoning, promptChars = 0 } = {}) {
  const prose = Math.max(1, Math.floor(Number(maxTokens) || 0));
  const entry = getCachedCatalogModel(String(model || ''));
  const limit = outputLimitOf(entry, promptChars);
  if (reasoning) {
    return { maxTokens: Math.max(1, Math.min(prose, limit)), reasoning, proseTokens: prose, headroom: 0 };
  }
  if (!entry || entry.reasoning == null) {
    return { maxTokens: prose, reasoning: undefined, proseTokens: prose, headroom: 0 };
  }
  const sized = Math.max(prose, Math.min(prose + defaultReasoningTokens(prose), limit));
  return { maxTokens: sized, reasoning: undefined, proseTokens: prose, headroom: sized - prose };
}

/**
 * The budget for the one retry after a call stopped at `finish_reason: 'length'`, or
 * null when no retry can do better.
 *
 * - Hidden reasoning was spent (`reasoningTokens > 0`) and the caller set no reasoning
 *   field: bound it explicitly, `reasoning: { max_tokens: allowance }`, and ask for
 *   prose + allowance, so the answer keeps its prose budget whatever the model thinks.
 *   Thinking was already on, so this does not switch it on.
 * - Otherwise the visible answer itself overran: double the cap, within the limit.
 *
 * @param {Object} args
 * @param {string} args.model
 * @param {{ maxTokens: number, reasoning: (Object|undefined), proseTokens: number }} args.first - the first attempt's plan
 * @param {{ reasoningTokens: (number|null) }} [args.usage] - the first attempt's usage
 * @param {number} [args.promptChars]
 * @returns {{ maxTokens: number, reasoning: (Object|undefined) }|null}
 */
export function planRetryBudget({ model, first, usage, promptChars = 0 } = {}) {
  if (!first) return null;
  const entry = getCachedCatalogModel(String(model || ''));
  const limit = outputLimitOf(entry, promptChars);
  const reasoningSpent = Number(usage?.reasoningTokens) > 0;
  if (reasoningSpent && !first.reasoning) {
    const allowance = defaultReasoningTokens(first.proseTokens);
    const maxTokens = Math.min(first.proseTokens + allowance, limit);
    if (maxTokens <= allowance) return null; // no room left for any prose
    return { maxTokens, reasoning: { max_tokens: allowance } };
  }
  const maxTokens = Math.min(first.maxTokens * 2, limit);
  if (!(maxTokens > first.maxTokens)) return null;
  return { maxTokens, reasoning: first.reasoning };
}
