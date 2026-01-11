/**
 * Prompt Templates for Label-Based AI Workflows
 *
 * Maps Linear labels to AI prompts that help process tasks.
 * Each template receives issue data and context (parent, siblings, project, children)
 * and generates a prompt for Claude Code with Linear MCP.
 */

/**
 * @typedef {Object} PromptContext
 * @property {Object|null} parent - Parent issue (id, title, identifier, state)
 * @property {Array} siblings - Sibling issues (up to 5 most relevant)
 * @property {Object|null} project - Project name and description
 * @property {Array} children - Existing child issues
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
 * Format existing children for display in prompt
 * @param {Array} children - Array of child issues
 * @returns {string} Formatted children summary
 */
function formatChildren(children) {
  if (!children || children.length === 0) {
    return 'None'
  }
  return children
    .map(c => {
      const status = c.state?.name || 'Unknown'
      return `- ${c.identifier}: "${c.title}" (${status})`
    })
    .join('\n')
}

/**
 * Format description with truncation notice
 * @param {string|null} description - Issue description
 * @param {number} maxLength - Maximum length before truncation
 * @returns {string} Formatted description
 */
function formatDescription(description, maxLength = 500) {
  if (!description) {
    return 'No description provided'
  }
  const trimmed = description.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, maxLength)}...\n\n_(Description truncated. Use MCP to read full details.)_`
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
      // Format parent info
      const parentInfo = context.parent
        ? `${context.parent.identifier}: "${context.parent.title}" (${context.parent.state?.name || 'Unknown'})`
        : 'None (this is a top-level task)'

      // Format project info
      let projectInfo = 'Unknown'
      if (context.project) {
        projectInfo = context.project.name
        if (context.project.description) {
          const projDesc = context.project.description.trim()
          projectInfo += projDesc.length > 100
            ? `\n  ${projDesc.slice(0, 100)}...`
            : `\n  ${projDesc}`
        }
      }

      // Format siblings and children
      const siblingList = formatSiblings(context.siblings)
      const childrenList = formatChildren(context.children)

      // Format description with truncation notice
      const description = formatDescription(issue.description)

      // Get other labels (excluding the prompt trigger label)
      const otherLabels = (issue.labels || [])
        .filter(l => l !== 'needs-breakdown')
      const labelsInfo = otherLabels.length > 0
        ? otherLabels.join(', ')
        : 'None'

      return `Using the Linear MCP, help me break down task ${issue.identifier}: "${issue.title}"

## Context

**Project:** ${projectInfo}

**Issue URL:** ${issue.url}

**Parent Task:** ${parentInfo}

**Sibling Tasks:**
${siblingList}

**Existing Subtasks:**
${childrenList}

**Other Labels:** ${labelsInfo}

**Current Description:**
${description}

## Instructions

1. Use \`mcp__linear__get_issue\` to read the full task details and any comments
2. Analyze what needs to be done to complete this task
3. Break the work into subtasks, aiming for 1-3 hour chunks each
4. Ensure subtasks are logically ordered (dependencies first)
5. Identify any blockers or unknowns that need resolution
6. Flag any ambiguities or missing requirements
${context.children?.length > 0 ? '7. Review existing subtasks above and avoid duplicating them\n' : ''}
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
 * @param {Object} issue - The issue object (must include identifier, title, description, url, labels)
 * @param {PromptContext} context - Context with parent, siblings, project, children
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
