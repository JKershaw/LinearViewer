/**
 * OpenRouter API Client
 *
 * Provides AI recommendations for which prompt to use next on a Linear task.
 * Uses OpenRouter to access various LLM providers with a unified API.
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-3.1-8b-instruct';
const REQUEST_TIMEOUT_MS = 30000;

// Proxy-aware fetch function
let customFetch = fetch;

/**
 * Initialize proxy support if HTTP_PROXY or HTTPS_PROXY is set
 */
async function initProxyFetch() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
                   process.env.https_proxy || process.env.http_proxy;

  if (proxyUrl && customFetch === fetch) {
    try {
      const { ProxyAgent, fetch: undiciFetch } = await import('undici');
      const dispatcher = new ProxyAgent({
        uri: proxyUrl,
        requestTls: { rejectUnauthorized: false },
      });
      customFetch = (url, options = {}) => undiciFetch(url, { ...options, dispatcher });
    } catch (e) {
      console.warn('Failed to initialize proxy for OpenRouter:', e.message);
    }
  }
}

/**
 * Check if the OpenRouter feature is enabled (API key is configured)
 * @returns {boolean} True if OPENROUTER_API_KEY is set
 */
export function isRecommendationEnabled() {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * Format issue context for the AI prompt
 * @param {Object} issue - The issue object
 * @param {Object} context - Context with parent, siblings, project, children
 * @returns {string} Formatted context string
 */
function formatIssueContext(issue, context) {
  const lines = [];

  lines.push(`**Issue:** ${issue.identifier} - ${issue.title}`);
  lines.push(`**State:** ${issue.state?.name || 'Unknown'} (${issue.state?.type || 'unknown'})`);

  if (issue.description) {
    lines.push(`**Description:** ${issue.description.slice(0, 500)}${issue.description.length > 500 ? '...' : ''}`);
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
    for (const sibling of context.siblings.slice(0, 3)) {
      lines.push(`  - ${sibling.identifier}: ${sibling.title} (${sibling.state?.name || 'Unknown'})`);
    }
  }

  if (context.children?.length > 0) {
    lines.push(`**Existing Subtasks:** ${context.children.length} subtasks`);
    for (const child of context.children.slice(0, 3)) {
      lines.push(`  - ${child.identifier}: ${child.title} (${child.state?.name || 'Unknown'})`);
    }
  }

  return lines.join('\n');
}

/**
 * Format available prompts for the AI
 * @param {Array} prompts - Array of prompt descriptions
 * @returns {string} Formatted prompts string
 */
function formatAvailablePrompts(prompts) {
  return prompts.map(p =>
    `- **${p.key}** (${p.name}): ${p.description}`
  ).join('\n');
}

/**
 * Build the meta-prompt for the AI
 * @param {Object} issue - The issue object
 * @param {Object} context - Context with parent, siblings, project, children
 * @param {Array} availablePrompts - Array of available prompt descriptions
 * @returns {string} The complete prompt for the AI
 */
function buildMetaPrompt(issue, context, availablePrompts) {
  const issueContext = formatIssueContext(issue, context);
  const promptList = formatAvailablePrompts(availablePrompts);

  return `You are helping a developer decide their next action on a Linear task. Analyze the task and recommend ONE approach from the available options, or suggest a custom approach if none fit well.

## Task Context
${issueContext}

## Available Approaches
${promptList}

## Instructions
1. Analyze the task's current state, labels, and context
2. Consider what would move this task forward most effectively
3. Recommend ONE approach from the available options, or suggest a custom approach

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "suggestedPrompt": "the-prompt-key or null if custom",
  "reasoning": "2-3 sentences explaining why this is the best next step",
  "customPrompt": "only if suggestedPrompt is null, provide a custom prompt text"
}`;
}

/**
 * Get AI recommendation for which prompt to use
 * @param {Object} issue - The issue object with identifier, title, description, state, labels
 * @param {Object} context - Context with parent, siblings, project, children
 * @param {Array} availablePrompts - Array of { key, name, description } for available prompts
 * @returns {Promise<{suggestedPrompt: string|null, reasoning: string, customPrompt?: string}>}
 */
export async function getRecommendation(issue, context, availablePrompts) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  // Initialize proxy support if needed
  await initProxyFetch();

  const prompt = buildMetaPrompt(issue, context, availablePrompts);

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
        model: DEFAULT_MODEL,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
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

    if (!content) {
      throw new Error('No response content from OpenRouter');
    }

    // Parse the JSON response
    const result = JSON.parse(content);

    // Validate response structure
    if (typeof result.reasoning !== 'string') {
      throw new Error('Invalid response: missing reasoning');
    }

    return {
      suggestedPrompt: result.suggestedPrompt || null,
      reasoning: result.reasoning,
      customPrompt: result.customPrompt || null
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('OpenRouter request timed out');
    }

    if (error instanceof SyntaxError) {
      throw new Error('Failed to parse AI response as JSON');
    }

    throw error;
  }
}
