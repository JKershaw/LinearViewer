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
const REQUEST_TIMEOUT_MS = 30000;

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
        max_tokens: 1500
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
