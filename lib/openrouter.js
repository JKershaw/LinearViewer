/**
 * OpenRouter API Client
 *
 * Provides AI recommendations for which prompt to use next on a Linear task.
 * Uses OpenRouter to access various LLM providers with a unified API.
 */

import { formatAIHintsForMetaPrompt } from './prompt-templates.js';

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
        connect: { rejectUnauthorized: false },
      });
      customFetch = (url, options = {}) => undiciFetch(url, { ...options, dispatcher });
    } catch (e) {
      console.warn('Failed to initialize proxy for OpenRouter:', e.message);
    }
  }
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
 * Build the meta-prompt for the AI to generate a tailored prompt
 * @param {Object} issue - The issue object
 * @param {Object} context - Context with parent, siblings, project, children
 * @returns {string} The complete prompt for the AI
 */
function buildMetaPrompt(issue, context) {
  const issueContext = formatIssueContext(issue, context);
  const identifier = issue.identifier;

  return `You are helping a developer decide their next action on a Linear task. Generate a tailored prompt they can use with Claude Code that has Linear MCP integration.

## Task Context
${issueContext}

## Prompt Structure
Generate a prompt following this structure:

\`\`\`
# [Action verb] ${identifier}: [Task title]

## Workflow
1. **Fetch details**: Use Linear MCP to get full issue details for ${identifier}
2. [Action-specific steps]
3. **Update Linear**: [How to update Linear when done - add comment, change status, etc.]

## Context
[Include relevant context - project, parent, siblings if useful]

## Goal
[1-2 clear sentences describing the specific objective]

[Additional structured guidance specific to the action type]
\`\`\`

## Goal Examples by Situation

${formatAIHintsForMetaPrompt()}

## Instructions
1. Analyze the task's current state, labels, and context
2. Determine what would move this task forward most effectively
3. Generate a tailored prompt including:
   - Header with action verb and task identifier/title
   - Workflow section with Linear MCP integration steps
   - Context section with relevant project/parent/sibling info
   - Goal section with specific objective
4. Write 2-3 sentences of reasoning explaining your recommendation

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "reasoning": "2-3 sentences explaining why this approach will move the task forward",
  "prompt": "The complete prompt text following the structure above"
}`;
}

/**
 * Get AI-generated prompt for a task
 * @param {Object} issue - The issue object with identifier, title, description, state, labels
 * @param {Object} context - Context with parent, siblings, project, children
 * @param {Object} [options] - Optional settings
 * @param {string} [options.apiKey] - API key from user session (OAuth), falls back to env
 * @returns {Promise<{reasoning: string, prompt: string}>}
 */
export async function getRecommendation(issue, context, options = {}) {
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured. Connect your OpenRouter account or set OPENROUTER_API_KEY.');
  }

  // Initialize proxy support if needed
  await initProxyFetch();

  const metaPrompt = buildMetaPrompt(issue, context);

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
            content: metaPrompt
          }
        ],
        temperature: 0.4,
        max_tokens: 800
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

    // Strip markdown code blocks if present (common LLM behavior)
    let jsonContent = content.trim();
    if (jsonContent.startsWith('```json')) {
      jsonContent = jsonContent.slice(7);
    } else if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.slice(3);
    }
    if (jsonContent.endsWith('```')) {
      jsonContent = jsonContent.slice(0, -3);
    }
    jsonContent = jsonContent.trim();

    // Parse the JSON response
    const result = JSON.parse(jsonContent);

    // Validate response structure
    if (typeof result.reasoning !== 'string' || typeof result.prompt !== 'string') {
      throw new Error('Invalid response: missing reasoning or prompt');
    }

    return {
      reasoning: result.reasoning,
      prompt: result.prompt
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
