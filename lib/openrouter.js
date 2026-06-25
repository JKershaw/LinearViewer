/**
 * OpenRouter API Client
 *
 * Provides AI recommendations for which prompt to use next on a Linear task.
 * Uses OpenRouter to access various LLM providers with a unified API.
 */

import https from 'https';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from './prompt-templates.js';
import { appendGroundingSections, resolvePromptUi, applyPromptCapabilities } from './prompt-formatters.js';
import { buildMetaPromptTemplate } from './prompts/meta-prompt-template.js';
import { formatAllSignalsForMetaPrompt } from './completion-signals.js';
import { isTerminalState, compareByIdentifier } from './tree.js';
import { assembleNodeFacts } from './recommendation-facts.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Validated as the default for every per-task LLM call (recommend, brief, recap) by the
// LIN-263 benchmark: GPT-5.4-Mini matched or beat Opus 4.8 across synthetic, real,
// node/defer, and dense-leaf cases at K=3, and was the only non-Opus model to pass brief
// AND recap cleanly — at ~1/6 Opus's cost and several× the speed. (Haiku 4.5, the prior
// default, repeatably mis-reads dense tickets; see scripts/eval/lin-263-findings.md.)
export const DEFAULT_MODEL = 'openai/gpt-5.4-mini';
const REQUEST_TIMEOUT_MS = 120000;

/**
 * Output token cap for generated recommendations.
 *
 * The meta-prompt emits the Reasoning section before the Prompt section, and
 * this cap covers BOTH combined — so when it's too low the Prompt (the part the
 * user actually runs) is the first casualty of a `finish_reason: 'length'`
 * truncation. 8000 leaves comfortable headroom for a full reasoning block plus
 * a complete prompt.
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
 * - Sonnet 4.6 / Opus 4.8: safe higher-tier fallbacks (frontier quality, more expensive).
 *
 * Deliberately omitted despite being cheap: Haiku 4.5 and DeepSeek V4-Flash (both
 * repeatably mis-route dense tickets) and Gemini 3.5 Flash (emits chain-of-thought before
 * the recap JSON and blows the token cap → empty recap). See lin-263-findings.md.
 */
export const AVAILABLE_MODELS = [
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', description: 'Default - validated, fast and cheap' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', description: 'Safe higher tier (mid frontier)' },
  { id: 'anthropic/claude-opus-4.8', name: 'Claude Opus 4.8', description: 'Safe frontier (most expensive)' },
];

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
 * Strip markdown code block markers from a string.
 * The AI sometimes wraps its output in triple backticks, mimicking the example format.
 * @param {string} text - Text that may be wrapped in code block markers
 * @returns {string} Text with code block markers removed
 */
export function stripCodeBlockMarkers(text) {
  if (!text) return text;
  return text.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
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
 * Check if the OpenRouter feature is enabled (API key is configured)
 * @param {string} [sessionApiKey] - Optional API key from user session (OAuth)
 * @returns {boolean} True if an API key is available (session or env)
 */
export function isRecommendationEnabled(sessionApiKey = null) {
  return !!(sessionApiKey || process.env.OPENROUTER_API_KEY);
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

  if (issue.description) {
    lines.push(`**Description:** ${issue.description}`);
  }

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

  return lines.join('\n');
}

/**
 * Build the meta-prompt for the AI to generate a tailored prompt
 * @param {Object} issue - The issue object
 * @param {Object} context - Context with parent, siblings, project, children, comments, focusedChild
 * @param {Object} [featureFlags] - Feature toggle flags
 * @returns {string} The complete prompt for the AI
 */
function buildMetaPrompt(issue, context, featureFlags = {}, providerUi = null) {
  const issueContext = formatIssueContext(issue, context);
  const children = context.children || [];
  const hasSubtasks = children.length > 0;
  const hasComments = context.comments && context.comments.length > 0;

  // Deterministic, network-free fact assembly (LIN-434): one module computes the
  // per-node fact set — child-state counts, the node's own terminal flag, and the
  // FRONTIER FACTS (LIN-433: open/blocked counts + next child + plan session-fit,
  // surfaced so the model stops re-deriving them at the defer-vs-breakdown fork).
  // buildMetaPrompt just consumes it; values are byte-identical to the prior inline
  // computation. Mirrored in the handwritten path via formatFrontierFacts /
  // formatSubtaskSummary (both import the same seam from recommendation-facts.js).
  //
  // The isTerminal / hasOpenChildren flags drive the Step 0 completion branch
  // (LIN-353, unified): when a task's substantive work is already finished and there
  // is no open child to descend into — its own state is terminal (Done/Canceled/
  // Duplicate) OR every subtask is terminal — Step 0 routes to `review`/close, never a
  // no-op `look-into`. A terminal task that still has open children keeps descending.
  // `review` is no longer gated to those terminal cases: Step 3 also routes an
  // implemented-but-still-open leaf to `review` from the implementation completion
  // signals (so a merged-but-In-Progress task stops looping `implementation`). Routing
  // lives only in this meta-prompt path; the handwritten path mirrors the
  // terminal-completion *content* via formatTerminalStateNote / formatChildrenCompleteNote.
  const {
    completedCount,
    inProgressCount,
    remainingCount,
    hasOpenChildren,
    isTerminal,
    frontierFacts
  } = assembleNodeFacts(issue, children);

  // Get focused subtask identifier if present (two-tier mode)
  const focusedSubtaskId = context.focusedChild?.issue?.identifier || null;

  return buildMetaPromptTemplate({
    issueContext,
    identifier: issue.identifier,
    hasSubtasks,
    subtaskCount: children.length,
    completedCount,
    inProgressCount,
    remainingCount,
    hasComments,
    commentCount: context.comments?.length || 0,
    aiHints: formatAIHintsForMetaPrompt(),
    actionVocabulary: getAIRecommendationActionNames().join(', '),
    completionSignals: formatAllSignalsForMetaPrompt(),
    focusedSubtaskId,
    frontierFacts,
    isTerminal,
    hasOpenChildren,
    featureFlags,
    providerUi
  });
}

/**
 * Get AI-generated prompt for a task
 * @param {Object} issue - The issue object with identifier, title, description, state, labels
 * @param {Object} context - Context with parent, siblings, project, children
 * @param {Object} [options] - Optional settings
 * @param {string} [options.apiKey] - API key from user session (OAuth), falls back to env
 * @param {string} [options.model] - Model ID to use, falls back to DEFAULT_MODEL
 * @param {Object} [options.featureFlags] - Feature toggle flags
 * @returns {Promise<{reasoning: string, prompt: string}>}
 */
/**
 * Parse streamed content into reasoning and prompt sections.
 * Handles the case where section boundaries are split across chunks.
 *
 * The AI response format is:
 *   ## Reasoning
 *   ...reasoning text...
 *   ## Prompt
 *   ...prompt text...
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
 * Stream AI-generated prompt for a task via OpenRouter's streaming API.
 * Calls the provided callback with section events as tokens arrive.
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
 * @returns {Promise<void>}
 */
export async function getRecommendationStream(issue, context, options = {}, onEvent) {
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  const model = options.model || DEFAULT_MODEL;
  const featureFlags = options.featureFlags || {};
  const providerUi = options.providerUi || null;
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured.');
  }

  // Initialize proxy support if needed
  await initProxyFetch();

  const metaPrompt = buildMetaPrompt(issue, context, featureFlags, providerUi);

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
    // Use native fetch for streaming (not customFetch which buffers)
    const response = await fetch(OPENROUTER_API_URL, {
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
    let truncated = false;
    let completionTokens = null;
    let finishReason = null;
    // LIN-418: usage/provider/model arrive across chunks (usage in the final
    // chunk, provider/model in the header) — accumulate and record after the loop.
    let usageMeta = null;
    let responseProvider = null;
    let responseModel = null;
    // Accumulate the raw markdown exactly as it arrives so the terminal flush can
    // route it through parseRecommendationResponse — byte-identical to the buffered
    // path (LIN-328 defer contract), even though we emit section deltas live.
    let rawContent = '';
    let sseBuffer = '';

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
              const sectionEvents = parser.processChunk(content);
              for (const evt of sectionEvents) {
                // Emit phase change when section changes
                if (evt.section !== currentSection) {
                  currentSection = evt.section;
                  onEvent('phase', { phase: currentSection });
                }
                onEvent('delta', evt);
              }
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }

    // Flush any remaining content
    const remaining = parser.flush();
    for (const evt of remaining) {
      if (evt.section !== currentSection) {
        currentSection = evt.section;
        onEvent('phase', { phase: currentSection });
      }
      onEvent('delta', evt);
    }

    // Route the accumulated raw markdown through the SAME parser as the buffered
    // path so defer parsing and truncation surfacing are byte-identical (LIN-328,
    // 13ecc22). parseRecommendationResponse re-derives `truncated` from finishReason.
    const parsed = parseRecommendationResponse(rawContent, finishReason, completionTokens);

    // Append the deterministic grounding sections (LIN-435) — the same post-pass the
    // handwritten path runs. Skipped on defer (parsed.prompt === null).
    const structured = applyGroundingToRecommendation(parsed, issue, context, featureFlags, providerUi);

    // Stream the appended grounding as a prompt delta so the LIVE view matches the
    // grounded prompt the descent ships. This is load-bearing, not cosmetic: the leaf
    // streaming path (routes/workspace-api.js) delivers the prompt to the consumer
    // ONLY through these deltas and discards the return value, so without this delta a
    // leaf task's prompt would lose its grounding entirely. By construction
    // structured.prompt === parsed.prompt + grounding, so the slice is exactly the
    // appended (capability-shaped) grounding text.
    if (parsed.prompt != null && structured.prompt !== parsed.prompt) {
      if (currentSection !== 'prompt') {
        currentSection = 'prompt';
        onEvent('phase', { phase: 'prompt' });
      }
      onEvent('delta', { section: 'prompt', content: structured.prompt.slice(parsed.prompt.length) });
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
 * Generic chat streaming function for arbitrary messages.
 *
 * Unlike getRecommendationStream (which is specific to the meta-prompt workflow),
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
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  const model = options.model || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || 1000;
  const temperature = options.temperature ?? 0.3;

  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured.');
  }

  await initProxyFetch();

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
      const response = await customFetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/JKershaw/LinearViewer',
          'X-Title': 'Harbour'
        },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, usage: { include: true } }),
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
    const response = await fetch(OPENROUTER_API_URL, {
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
        usage: { include: true }
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
 * Extract the chosen action name from a recommendation's Reasoning section.
 *
 * The meta-prompt's Reasoning section emits the selected action on its own line
 * as `→ **<name>**` (see lib/prompts/meta-prompt-template.js). This reads that
 * existing output so callers (e.g. the fused recommend-and-dispatch proxy verb)
 * can derive a dispatch `kind` without a meta-prompt change. Returns the trimmed
 * action name, or null when the arrow line is absent.
 *
 * @param {string|null|undefined} reasoning - The Reasoning section text
 * @returns {string|null} The action name (e.g. "plan", "bug") or null
 */
export function parseRecommendedAction(reasoning) {
  if (typeof reasoning !== 'string') return null;
  const match = reasoning.match(/→\s*\*\*(.+?)\*\*/);
  return match ? match[1].trim() : null;
}

/**
 * Extract the defer target from a recommendation's Reasoning section.
 *
 * A `defer` recommendation (LIN-327) emits its target on a dedicated contract
 * line: `**DeferTo:** ABC-123`. This reads that structured slot — the recursion
 * (LIN-329) triggers off this field, never off scraping the identifier out of the
 * prose reasoning, so prose drift can never silently break the traversal (the same
 * discipline as parseRecommendedAction's `→ **action**` line). Accepts a Linear
 * identifier (e.g. LIN-297) or a UUID. Returns null when the line is absent.
 *
 * @param {string|null|undefined} reasoning - The Reasoning section text
 * @returns {string|null} The defer-target identifier, or null
 */
export function parseDeferTo(reasoning) {
  if (typeof reasoning !== 'string') return null;
  const match = reasoning.match(/DeferTo:\s*\*{0,2}\s*([A-Za-z][A-Za-z0-9]*-\d+|[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,})/);
  return match ? match[1].trim() : null;
}

/**
 * Parse an OpenRouter recommendation completion into the structured result.
 *
 * Extracted from getRecommendation so the parse/validate/assemble seam is unit
 * testable without a network call (the rest of getRecommendation is just the HTTP
 * round-trip). Handles the two response shapes:
 *  - a normal action: `## Reasoning` + a non-empty `## Prompt` body.
 *  - a `defer` routing decision (LIN-327): `## Reasoning` carrying a `DeferTo`
 *    target and an intentionally EMPTY `## Prompt` (the no-body cost contract).
 *    A prompt is NOT required — requiring one would reject every defer reply.
 *
 * @param {string} content - The raw completion text
 * @param {string} [finishReason] - OpenRouter finish_reason (`length` ⇒ truncated)
 * @param {number} [completionTokens] - Reported completion token count
 * @returns {{reasoning: string, prompt: string|null, truncated: boolean, recommendedAction: string|null, deferTo: string|null, completionTokens: number|null}}
 */
export function parseRecommendationResponse(content, finishReason, completionTokens) {
  // Check if response was truncated due to max_tokens
  const truncated = finishReason === 'length';

  // Parse markdown format: ## Reasoning and ## Prompt sections
  const reasoningMatch = content.match(/## Reasoning\n([\s\S]*?)(?=\n## Prompt|$)/);
  const promptMatch = content.match(/## Prompt\n([\s\S]*?)$/);

  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : null;
  // Strip code block markers if AI wrapped the prompt in them
  const prompt = stripCodeBlockMarkers(promptMatch ? promptMatch[1].trim() : null);

  const recommendedAction = parseRecommendedAction(reasoning);

  // `defer` (LIN-327) is a routing decision, not a unit of work: it carries a
  // target child and intentionally NO prompt body (the cost contract). It is
  // resolved server-side by the recommend recursion (LIN-329) before any
  // dispatch, so it never reaches a worker. Validate/return it on its own
  // contract — requiring a prompt here would reject every defer reply.
  if (recommendedAction === 'defer') {
    const deferTo = parseDeferTo(reasoning);
    if (!reasoning || !deferTo) {
      throw new Error('Invalid defer response: missing ## Reasoning or DeferTo target');
    }
    return {
      reasoning,
      prompt: null,
      truncated,
      recommendedAction,
      deferTo,
      completionTokens: completionTokens || null
    };
  }

  // Validate response structure
  if (!reasoning || !prompt) {
    throw new Error('Invalid response: missing ## Reasoning or ## Prompt section');
  }

  return {
    reasoning,
    prompt,
    truncated,
    recommendedAction,
    deferTo: null,
    completionTokens: completionTokens || null
  };
}

/**
 * Append the deterministic grounding sections to a parsed recommendation's prompt.
 *
 * This is the meta-prompt path's half of the LIN-435 single-source grounding: the SAME
 * `appendGroundingSections` post-pass the handwritten path runs (lib/prompt-templates.js
 * → generatePrompt) is applied here to the LLM's parsed `## Prompt` body. The result is
 * that the deterministic re-grounding rules (staleness, terminal-state, all-children-
 * complete, bug-investigated) live in ONE place and the meta-prompt no longer hand-types
 * them as prose — which is what let its staleness `--since` date drift to a placeholder.
 * The staleness date is now injected deterministically from `issue.createdAt`.
 *
 * Capability-shaped to mirror the handwritten path's final applyPromptCapabilities pass.
 * This is a no-op for Linear, and for grounding text in general (it names no tracker), so
 * Linear output is unaffected — it is applied for robustness and path symmetry only.
 *
 * Skipped for `defer` replies (prompt === null): the no-body cost contract (LIN-327/328)
 * — a defer carries only a routing decision, never a prompt body. The pure parser
 * (parseRecommendationResponse) is deliberately NOT given issue/context; grounding is
 * applied here, at the call sites that have them, so the parser stays byte-identical.
 *
 * @param {Object} structured - parseRecommendationResponse result
 * @param {Object} issue - Issue object (state, labels, createdAt)
 * @param {Object} [context] - Context with children and comments
 * @param {Object} [featureFlags] - Feature flags (capability resolution)
 * @param {Object} [providerUi] - Active provider UI surface (LIN-177)
 * @returns {Object} structured with grounding appended to .prompt (unchanged on defer)
 */
export function applyGroundingToRecommendation(structured, issue, context = {}, featureFlags = {}, providerUi = null) {
  if (!structured || structured.prompt == null) return structured;
  const grounding = appendGroundingSections('', issue, context);
  const shaped = applyPromptCapabilities(grounding, resolvePromptUi(featureFlags, providerUi));
  return { ...structured, prompt: structured.prompt + shaped };
}

export async function getRecommendation(issue, context, options = {}) {
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  const model = options.model || DEFAULT_MODEL;
  const featureFlags = options.featureFlags || {};
  const providerUi = options.providerUi || null;
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured. Connect your OpenRouter account or set OPENROUTER_API_KEY.');
  }

  // Initialize proxy support if needed
  await initProxyFetch();

  const metaPrompt = buildMetaPrompt(issue, context, featureFlags, providerUi);

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
    const response = await customFetch(OPENROUTER_API_URL, {
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

    // Append the deterministic grounding sections to the LLM's prompt (LIN-435) —
    // the same post-pass the handwritten path runs. Skipped on defer (no body).
    // Lifted into locals (pure reorder, identical return) so the trace below can
    // capture parsed + grounded output without a second parse (LIN-578).
    const parsed = parseRecommendationResponse(content, finishReason, completionTokens);
    const structured = applyGroundingToRecommendation(
      parsed, issue, context, featureFlags, providerUi
    );

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
