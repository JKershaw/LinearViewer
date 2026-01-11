/**
 * Prompt Templates for Label-Based AI Workflows
 *
 * Maps Linear labels to AI prompts that help process tasks.
 * Each template receives issue data and context (parent, siblings)
 * and generates a prompt for Claude Code with Linear MCP.
 */

/**
 * @typedef {Object} PromptContext
 * @property {Object|null} parent - Parent issue (id, title, identifier, state)
 * @property {Array} siblings - Sibling issues (up to 5 most relevant)
 */

/**
 * Format sibling issues for display in prompt
 * @param {Array} siblings - Array of sibling issues
 * @returns {string} Formatted sibling list
 */
function formatSiblings(siblings) {
  if (!siblings || siblings.length === 0) {
    return 'None'
  }
  return siblings
    .map(s => {
      const status = s.state?.name || 'Unknown'
      return `- ${s.identifier}: "${s.title}" (${status})`
    })
    .join('\n')
}

/**
 * Get status emoji for state type
 * @param {string} stateType - Linear state type
 * @returns {string} Status indicator
 */
function getStatusIndicator(stateType) {
  switch (stateType) {
    case 'completed':
    case 'canceled':
      return '✓'
    case 'started':
      return '◐'
    default:
      return '○'
  }
}

/**
 * Prompt template definitions
 * Each template has:
 * - name: Display name for the prompt
 * - generate: Function that takes (issue, context) and returns prompt string
 */
export const PROMPT_TEMPLATES = {
  'needs-breakdown': {
    name: 'Task Breakdown',
    generate: (issue, context) => {
      const parentInfo = context.parent
        ? `${context.parent.identifier}: "${context.parent.title}" (${context.parent.state?.name || 'Unknown'})`
        : 'None (this is a top-level task)'

      const siblingList = formatSiblings(context.siblings)

      const description = issue.description
        ? issue.description.trim().slice(0, 500) + (issue.description.length > 500 ? '...' : '')
        : 'No description provided'

      return `Using the Linear MCP, help me break down task ${issue.identifier}: "${issue.title}"

## Context

**Parent Task:** ${parentInfo}

**Sibling Tasks:**
${siblingList}

**Current Description:**
${description}

## Instructions

1. Use \`mcp__linear__get_issue\` to read the full task details and any comments
2. Analyze what needs to be done to complete this task
3. Break the work into subtasks, aiming for 1-3 hour chunks each
4. Ensure subtasks are logically ordered (dependencies first)
5. Identify any blockers or unknowns that need resolution
6. Flag any ambiguities or missing requirements

## Output Format

Provide:
1. **Summary**: Your understanding of what this task accomplishes
2. **Subtasks**: A numbered list with:
   - Clear, actionable title
   - Brief description of what's involved
   - Estimated complexity (small/medium/large)
3. **Dependencies**: Any ordering constraints between subtasks
4. **Questions**: Anything that needs clarification before starting

After I approve the breakdown, use \`mcp__linear__create_issue\` to create the subtasks as children of ${issue.identifier}.`
    }
  }
}

/**
 * Check if a label has an associated prompt template
 * @param {string} labelName - The label name to check
 * @returns {boolean} True if the label has a prompt template
 */
export function hasPrompt(labelName) {
  return labelName in PROMPT_TEMPLATES
}

/**
 * Get all labels that have prompt templates
 * @returns {string[]} Array of label names with prompts
 */
export function getPromptLabels() {
  return Object.keys(PROMPT_TEMPLATES)
}

/**
 * Generate a prompt for a label
 * @param {string} labelName - The label name
 * @param {Object} issue - The issue object (must include identifier, title, description)
 * @param {PromptContext} context - Context with parent and siblings
 * @returns {{name: string, prompt: string}|null} Generated prompt or null if no template
 */
export function generatePrompt(labelName, issue, context) {
  const template = PROMPT_TEMPLATES[labelName]
  if (!template) return null

  return {
    name: template.name,
    prompt: template.generate(issue, context)
  }
}
