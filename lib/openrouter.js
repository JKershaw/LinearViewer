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
 * Build the meta-prompt for the AI to generate a tailored prompt
 * @param {Object} issue - The issue object
 * @param {Object} context - Context with parent, siblings, project, children
 * @returns {string} The complete prompt for the AI
 */
function buildMetaPrompt(issue, context) {
  const issueContext = formatIssueContext(issue, context);

  return `You are helping a developer decide their next action on a Linear task. Generate a tailored prompt they can use with an AI coding assistant.

## Task Context
${issueContext}

## Prompt Structure
Generate a prompt following this structure:

\`\`\`
[Action verb] task [identifier]

## Context
[Include relevant context from above - project, parent, siblings, etc.]

## Goal
[1-2 clear sentences describing the specific objective]
\`\`\`

## Goal Examples by Situation

**Task needs breaking down** (large, vague, or complex):
"Break this task into subtasks (1-3 hour chunks each), ordered by dependencies."

**Task needs research** (unknowns, options to explore):
"Identify key questions, research systematically, and provide actionable recommendations."

**Task needs scoping** (ambiguous requirements):
"Define clear boundaries (in scope vs out), assumptions, success criteria, and open questions."

**Task needs technical design** (architectural decisions):
"Evaluate 2-3 design approaches with tradeoffs, recommend one, and outline implementation."

**Task is blocked** (dependencies, missing info):
"Identify the blocker type and root cause, evaluate options to unblock, and recommend the best path."

**Task is a bug** (needs investigation):
"Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach."

**Task is ready to implement** (clear requirements):
"Research the codebase, identify files to modify, and create a step-by-step implementation plan."

**Task needs triage** (missing metadata, unclear priority):
"Review and suggest updates to labels, priority, estimate, and state with reasoning."

**Task needs context** (joining mid-way, returning after gap):
"Synthesize current state, what's done, what remains, key decisions, and recommended next steps."

**General exploration** (understanding what's involved):
"Summarize what this task involves and how it fits into the broader project context."

## Instructions
1. Analyze the task's current state, labels, and context
2. Determine what would move this task forward most effectively
3. Generate a tailored prompt with a specific, actionable goal
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
 * @returns {Promise<{reasoning: string, prompt: string}>}
 */
export async function getRecommendation(issue, context) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
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

    // Parse the JSON response
    const result = JSON.parse(content);

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
