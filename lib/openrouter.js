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

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';
const REQUEST_TIMEOUT_MS = 60000;

// Two-tier context constants
const MAX_COMMENTS = 3;
const MAX_COMMENT_LENGTH = 500;

/**
 * Available models for the settings dropdown.
 * Users can also enter custom model IDs not in this list.
 */
export const AVAILABLE_MODELS = [
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', description: 'Default - fast and efficient' },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', description: 'Advanced coding/agents' },
  { id: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5', description: 'Frontier reasoning' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast, good value' },
  { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek v3', description: 'Best value frontier' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (free)', description: 'Free, GPT-4 level' },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (free)', description: 'Free, 1M context' },
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
 * Truncate comments to reduce context size for AI recommendations.
 * Takes the most recent N comments and truncates long bodies.
 *
 * @param {Array} comments - Array of comment objects with body property
 * @returns {Array} Truncated comments array
 */
export function truncateComments(comments) {
  if (!comments?.length) return [];
  return comments.slice(-MAX_COMMENTS).map(c => ({
    ...c,
    body: c.body.length > MAX_COMMENT_LENGTH
      ? c.body.slice(0, MAX_COMMENT_LENGTH) + '...'
      : c.body
  }));
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
  const done = children.filter(c =>
    c.state?.type === 'completed' || c.state?.type === 'canceled');
  const remaining = children.filter(c =>
    c.state?.type !== 'completed' && c.state?.type !== 'canceled');

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
function formatIssueContext(issue, context) {
  const lines = [];

  // Check if this is a parent task with a focused child (two-tier mode)
  const hasFocusedChild = context.focusedChild && context.children?.length > 0;

  lines.push(`**Issue:** ${issue.identifier} - ${issue.title}`);
  lines.push(`**State:** ${issue.state?.name || 'Unknown'} (${issue.state?.type || 'unknown'})`);

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
  }

  // Two-tier format: subtask overview + focused subtask details
  if (hasFocusedChild && context.focusedChild?.issue) {
    const focusedChild = context.focusedChild;
    const focusedId = focusedChild.issue.id;

    // Subtask overview (status only)
    lines.push(`**Subtasks Overview:**`);
    lines.push(formatSubtaskOverview(context.children, focusedId));

    // Parent task comments (truncated)
    if (context.comments?.length > 0) {
      const truncated = truncateComments(context.comments);
      lines.push(`**Parent Discussion:** ${context.comments.length} comment(s), showing last ${truncated.length}`);
      lines.push(...formatCommentsForPrompt(truncated));
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

    // Focused subtask comments (truncated)
    if (focusedChild.comments?.length > 0) {
      const truncated = truncateComments(focusedChild.comments);
      lines.push(`**Subtask Discussion:** ${focusedChild.comments.length} comment(s), showing last ${truncated.length}`);
      lines.push(...formatCommentsForPrompt(truncated));
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
  const completedCount = children.filter(c => c.state?.type === 'completed' || c.state?.type === 'canceled').length;
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
        max_tokens: 4000,
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
 *   Types: 'token' (streaming text), 'done', 'error'
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
      onEvent('token', { token: content });
      onEvent('done', {});
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
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }

    onEvent('done', {});
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('OpenRouter request timed out');
    throw error;
  }
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
        max_tokens: 4000
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
