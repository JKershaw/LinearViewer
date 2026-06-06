/**
 * OpenRouter API Client
 *
 * Provides AI recommendations for which prompt to use next on a Linear task.
 * Uses OpenRouter to access various LLM providers with a unified API.
 */

import https from 'https';
import { formatAIHintsForMetaPrompt } from './prompt-templates.js';
import { buildMetaPromptTemplate } from './prompts/meta-prompt-template.js';
import { formatAllSignalsForMetaPrompt } from './completion-signals.js';
import { isTerminalState } from './tree.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';
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
 * Users can also enter custom model IDs not in this list.
 */
export const AVAILABLE_MODELS = [
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', description: 'Default - fast and efficient' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', description: 'Advanced coding/agents' },
  { id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', description: 'Frontier reasoning' },
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', description: 'Fast OpenAI workhorse' },
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Near-Pro reasoning, low latency' },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', description: 'Best value frontier' },
  { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder 480B (free)', description: 'Free, strong coding model' },
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (free)', description: 'Free, o1-level reasoning' },
];

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

// Proxy-aware fetch function
let customFetch = fetch;
let proxyInitialized = false;

/**
 * Initialize proxy support if HTTP_PROXY or HTTPS_PROXY is set.
 * Uses https-proxy-agent for robust proxy support (same approach as linear-cli.js).
 */
async function initProxyFetch() {
  if (proxyInitialized) return;
  proxyInitialized = true;

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
                   process.env.https_proxy || process.env.http_proxy;

  if (proxyUrl) {
    try {
      // Use https-proxy-agent for reliable proxy support (matches linear-cli.js approach)
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
  const done = children.filter(c => isTerminalState(c.state?.type));
  const remaining = children.filter(c => !isTerminalState(c.state?.type));

  const lines = [];
  if (done.length) {
    lines.push(`✓ Done: ${done.map(c => c.identifier).join(', ')}`);
  }
  if (remaining.length) {
    const remainingList = remaining.map(c => {
      const marker = c.id === focusedId ? '→ ' : '';
      const status = c.state?.type === 'started' ? ' (in progress)' : '';
      return `${marker}${c.identifier}${status}`;
    }).join(', ');
    lines.push(`○ Remaining: ${remainingList}`);
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
      lines.push(`*${notShown} siblings not shown. If the Strategy Framing step names a contract gap not in this list, fetch the parent epic's full child list via Linear MCP before committing to a strategy.*`);
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
      lines.push(`*${notShown} cousins not shown. If the Strategy Framing step names a contract gap not in this list, fetch the parent epic's full descendant tree via Linear MCP before committing to a strategy.*`);
    }
  }

  // Two-tier format: subtask overview + focused subtask details
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

    // Focused subtask details
    lines.push('');
    lines.push('---');
    lines.push(`**→ FOCUSED SUBTASK: ${focusedChild.issue.identifier} - ${focusedChild.issue.title}**`);
    lines.push(`**Status:** ${focusedChild.issue.state?.name || 'Unknown'} (${focusedChild.issue.state?.type || 'unknown'})`);

    if (focusedChild.issue.description) {
      lines.push(`**Description:** ${focusedChild.issue.description}`);
    }

    const focusedLabels = focusedChild.issue.labels || [];
    if (focusedLabels.length > 0) {
      lines.push(`**Labels:** ${focusedLabels.join(', ')}`);
    }

    if (focusedChild.comments?.length > 0) {
      lines.push(`**Subtask Discussion:** ${focusedChild.comments.length} comment(s)`);
      lines.push(...formatCommentsForPrompt(focusedChild.comments));
    }
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
function buildMetaPrompt(issue, context, featureFlags = {}) {
  const issueContext = formatIssueContext(issue, context);
  const children = context.children || [];
  const hasSubtasks = children.length > 0;
  const hasComments = context.comments && context.comments.length > 0;

  // Calculate subtask completion stats
  const completedCount = children.filter(c => isTerminalState(c.state?.type)).length;
  const inProgressCount = children.filter(c => c.state?.type === 'started').length;
  const remainingCount = children.length - completedCount;

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
    completionSignals: formatAllSignalsForMetaPrompt(),
    focusedSubtaskId,
    featureFlags
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
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured.');
  }

  // Initialize proxy support if needed
  await initProxyFetch();

  const metaPrompt = buildMetaPrompt(issue, context, featureFlags);

  // Check if proxy is active (customFetch doesn't support streaming)
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
                   process.env.https_proxy || process.env.http_proxy;
  const useStreaming = !proxyUrl;

  if (!useStreaming) {
    // Fallback: use non-streaming request, then emit events from complete response
    const result = await getRecommendation(issue, context, options);
    onEvent('phase', { phase: 'reasoning' });
    onEvent('delta', { section: 'reasoning', content: result.reasoning });
    onEvent('phase', { phase: 'prompt' });
    onEvent('delta', { section: 'prompt', content: result.prompt });
    onEvent('done', { truncated: result.truncated, completionTokens: result.completionTokens });
    return;
  }

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
        'X-Title': 'Linear Projects Viewer'
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: metaPrompt }],
        temperature: 0,
        max_tokens: RECOMMENDATION_MAX_TOKENS,
        stream: true
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
            const finishReason = parsed.choices?.[0]?.finish_reason;

            if (finishReason === 'length') truncated = true;
            if (parsed.usage?.completion_tokens) {
              completionTokens = parsed.usage.completion_tokens;
            }

            if (content) {
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

    onEvent('done', { truncated, completionTokens: completionTokens || null });
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
          'X-Title': 'Linear Projects Viewer'
        },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
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
      onEvent('token', { token: content });
      onEvent('done', { finishReason });
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
        'X-Title': 'Linear Projects Viewer'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true
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
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }

    onEvent('done', { finishReason });
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

export async function getRecommendation(issue, context, options = {}) {
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  const model = options.model || DEFAULT_MODEL;
  const featureFlags = options.featureFlags || {};
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured. Connect your OpenRouter account or set OPENROUTER_API_KEY.');
  }

  // Initialize proxy support if needed
  await initProxyFetch();

  const metaPrompt = buildMetaPrompt(issue, context, featureFlags);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await customFetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/JKershaw/LinearViewer',
        'X-Title': 'Linear Projects Viewer'
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
        max_tokens: RECOMMENDATION_MAX_TOKENS
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const finishReason = data.choices?.[0]?.finish_reason;
    const completionTokens = data.usage?.completion_tokens;

    if (!content) {
      throw new Error('No response content from OpenRouter');
    }

    // Check if response was truncated due to max_tokens
    const truncated = finishReason === 'length';

    // Parse markdown format: ## Reasoning and ## Prompt sections
    const reasoningMatch = content.match(/## Reasoning\n([\s\S]*?)(?=\n## Prompt|$)/);
    const promptMatch = content.match(/## Prompt\n([\s\S]*?)$/);

    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : null;
    // Strip code block markers if AI wrapped the prompt in them
    const prompt = stripCodeBlockMarkers(promptMatch ? promptMatch[1].trim() : null);

    // Validate response structure
    if (!reasoning || !prompt) {
      throw new Error('Invalid response: missing ## Reasoning or ## Prompt section');
    }

    return {
      reasoning,
      prompt,
      truncated,
      recommendedAction: parseRecommendedAction(reasoning),
      completionTokens: completionTokens || null
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('OpenRouter request timed out');
    }

    throw error;
  }
}
