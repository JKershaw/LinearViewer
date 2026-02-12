/**
 * Prompt Formatting Helpers
 *
 * Reusable formatting functions used by prompt templates.
 * Handles formatting of issue context (siblings, children, parents,
 * comments, labels, projects) and workflow/structural sections.
 */

import { COMPLETION_SIGNALS } from './completion-signals.js';
import { WORK_ISSUE_LABELS, VIRTUAL_PROMPTS, PREPARING_LABEL } from './workflow-config.js';

// Re-export for convenience (templates need these)
export { COMPLETION_SIGNALS, WORK_ISSUE_LABELS, VIRTUAL_PROMPTS, PREPARING_LABEL };

/**
 * Template categories for prompt availability rules
 */
export const PROMPT_CATEGORIES = {
  PRE_WORK: 'pre-work',    // Task not ready, needs preparation
  WORK_ISSUE: 'work-issue', // Issue during active work
  READY: 'ready',          // Task ready for implementation
  UNIVERSAL: 'universal'   // Available for all issues
};

/**
 * Format sibling issues for display in prompt
 * @param {Array} siblings - Array of sibling issues
 * @returns {string} Formatted sibling list or empty string if none
 */
export function formatSiblings(siblings) {
  if (!siblings || siblings.length === 0) {
    return ''
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
 * @returns {string} Formatted children summary or empty string if none
 */
export function formatChildren(children) {
  if (!children || children.length === 0) {
    return ''
  }
  return children
    .map(c => {
      const status = c.state?.name || 'Unknown'
      return `- ${c.identifier}: "${c.title}" (${status})`
    })
    .join('\n')
}

/**
 * Format subtask summary with progress and recommended next action.
 * Provides a dense one-line summary instead of verbose guidance.
 *
 * Note: Expects children to be pre-sorted by state relevance (in-progress first,
 * then todo, then completed) as done by fetchIssueContext in lib/linear.js.
 * The first non-completed child is the recommended next action.
 *
 * @param {Array} children - Array of child issues, pre-sorted by state
 * @returns {string} Dense one-line summary or empty string if no children
 */
export function formatSubtaskSummary(children) {
  if (!children || children.length === 0) {
    return ''
  }

  const total = children.length
  const completedCount = children.filter(c => c.state?.type === 'completed' || c.state?.type === 'canceled').length
  const inProgressCount = children.filter(c => c.state?.type === 'started').length

  let line = `**Subtasks:** ${completedCount}/${total} done`

  if (inProgressCount > 0) {
    line += `, ${inProgressCount} in progress`
  }

  // Find the first actionable child (relies on pre-sorted order: started > unstarted > backlog > completed)
  const nextChild = children.find(c =>
    c.state?.type === 'started' || c.state?.type === 'unstarted' || c.state?.type === 'backlog'
  )

  if (nextChild) {
    const action = nextChild.state?.type === 'started' ? 'Continue' : 'Next'
    line += ` → ${action}: ${nextChild.identifier}`
  }

  return line + '\n'
}

/**
 * Format comments for display in prompt
 * Shows comment body, author, and date
 * @param {Array} comments - Array of comment objects with body, user, createdAt
 * @returns {string} Formatted comments or empty string if none
 */
export function formatComments(comments) {
  if (!comments || comments.length === 0) {
    return ''
  }

  return comments
    .map(c => {
      const date = new Date(c.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
      // Indent multi-line comment bodies for readability
      const body = c.body.split('\n').map((line, i) => i === 0 ? line : `  ${line}`).join('\n')
      return `**${c.user}** (${date}):\n${body}`
    })
    .join('\n\n')
}


/**
 * Format project info consistently
 * @param {Object|null} project - Project object with name and description
 * @returns {string} Formatted project name
 */
export function formatProject(project) {
  if (!project) return 'Unknown'
  return project.name
}

/**
 * Format labels excluding specified ones
 * @param {Array} labels - Array of label names
 * @param {Array} exclude - Labels to exclude
 * @returns {string} Formatted labels or empty string if none
 */
export function formatLabels(labels, exclude = []) {
  const filtered = (labels || []).filter(l => !exclude.includes(l))
  return filtered.length > 0 ? filtered.join(', ') : ''
}

/**
 * Format parent task info consistently
 * @param {Object|null} parent - Parent issue object
 * @returns {string} Formatted parent info or empty string if none
 */
export function formatParent(parent) {
  if (!parent) return ''
  return `${parent.identifier}: "${parent.title}" (${parent.state?.name || 'Unknown'})`
}

/**
 * Format a section with label and content, only if content exists
 * @param {string} label - Section label (e.g., "Parent Task")
 * @param {string} content - Section content
 * @returns {string} Formatted section or empty string if no content
 */
export function formatSection(label, content) {
  if (!content) return ''
  return `**${label}:** ${content}`
}

/**
 * Format a multi-line section with label and content, only if content exists
 * @param {string} label - Section label (e.g., "Sibling Tasks")
 * @param {string} content - Section content (multi-line)
 * @returns {string} Formatted section or empty string if no content
 */
export function formatMultiLineSection(label, content) {
  if (!content) return ''
  return `**${label}:**\n${content}`
}

/**
 * Format the prompt header with task identifier and title
 * @param {string} action - Action verb (e.g., "Implement", "Break down", "Research")
 * @param {Object} issue - Issue object with identifier and title
 * @returns {string} Formatted header
 */
export function formatHeader(action, issue) {
  return `# ${action} ${issue.identifier}: ${issue.title}`
}

/**
 * Generate workflow instructions based on prompt category
 * @param {string} category - The prompt category
 * @param {Object} issue - Issue object with identifier
 * @param {Object} [options] - Options
 * @param {boolean} [options.useMcp=true] - Whether to include Linear MCP references
 * @returns {string} Workflow section or empty string
 */
export function formatWorkflow(category, issue, { useMcp = true } = {}) {
  const identifier = issue.identifier
  const mcp = useMcp ? ' via Linear MCP' : ''
  const mcpTool = useMcp ? ' Use Linear MCP to' : ''

  // Universal prompts: start, fetch details, add findings as comment
  if (category === PROMPT_CATEGORIES.UNIVERSAL) {
    return `## Workflow

1. **Start**:${mcpTool} Set ${identifier} status to "In Progress" (if not already)
2. **Fetch details**:${mcpTool} Get full issue details for ${identifier}
3. **Analyze**: Complete the goal below
4. **Update Linear**: Add findings as a comment on ${identifier}${mcp}`
  }

  // Work-issue prompts (blocked, bug): start, investigate and update
  if (category === PROMPT_CATEGORIES.WORK_ISSUE) {
    return `## Workflow

1. **Start**:${mcpTool} Set ${identifier} status to "In Progress" (if not already)
2. **Fetch details**:${mcpTool} Get full issue details for ${identifier}
3. **Investigate**: Complete the goal below
4. **Update Linear**: Add findings as a comment and update labels if needed${mcp}`
  }

  // Ready prompts (plan, code-review): full implementation workflow
  if (category === PROMPT_CATEGORIES.READY) {
    return `## Workflow

1. **Start**:${mcpTool} Set ${identifier} status to "In Progress" (if not already)
2. **Fetch details**:${mcpTool} Get full issue details
3. **Implement**: Complete the goal below
4. **Commit**: Push changes with descriptive commit message
5. **Complete**:${mcpTool} Set ${identifier} status to "Done" and add summary comment`
  }

  return ''
}

/**
 * Generate workflow instructions for read-only templates (no status change)
 * Used by templates that gather information without modifying issue state
 * @param {Object} issue - Issue object with identifier
 * @param {Object} [options] - Options
 * @param {boolean} [options.useMcp=true] - Whether to include Linear MCP references
 * @returns {string} Workflow section
 */
export function formatReadOnlyWorkflow(issue, { useMcp = true } = {}) {
  const identifier = issue.identifier
  const mcp = useMcp ? ' via Linear MCP' : ''
  const mcpTool = useMcp ? ' Use Linear MCP to' : ''
  return `## Workflow

1. **Fetch details**:${mcpTool} Get full issue details for ${identifier}
2. **Analyze**: Complete the goal below
3. **Update Linear**: Add findings as a comment on ${identifier}${mcp}`
}

/**
 * Generate workflow instructions for inform-only templates (no Linear updates)
 * Used by templates that summarize findings for the user without writing back to Linear
 * @param {Object} issue - Issue object with identifier
 * @param {Object} [options] - Options
 * @param {boolean} [options.useMcp=true] - Whether to include Linear MCP references
 * @returns {string} Workflow section
 */
export function formatInformOnlyWorkflow(issue, { useMcp = true } = {}) {
  const identifier = issue.identifier
  const mcpTool = useMcp ? ' Use Linear MCP to' : ''
  return `## Workflow

1. **Fetch details**:${mcpTool} Get full issue details for ${identifier}
2. **Analyze**: Complete the goal below
3. **Summarize**: Present your findings to the user`
}

/**
 * Generate git workflow instructions for feature branch prompts
 * @param {Object} issue - Issue object with identifier
 * @returns {string} Git workflow section
 */
export function formatGitWorkflow(issue) {
  const identifier = issue.identifier
  return `

## Git Workflow

1. Create a feature branch: \`git checkout -b feature/${identifier.toLowerCase()}\`
2. Make changes with descriptive commits referencing ${identifier}
3. Push the branch and create a pull request`
}

/**
 * Generate self-review instructions for code review toggle
 * @returns {string} Self-review section
 */
export function formatSelfReview() {
  return `

## Self-Review

Before committing, review your changes:
- Verify correctness against task requirements
- Check for security vulnerabilities
- Ensure test coverage for new/changed behavior
- Confirm code style matches the codebase`
}

/**
 * Generate CI/CD check instructions for code review toggle
 * @returns {string} CI/CD check section
 */
export function formatCicdCheck() {
  return `

## CI/CD Check

After pushing changes:
1. Check CI/CD pipeline status
2. Fix any failures before proceeding
3. Do not mark the task as Done until all checks pass`
}

/**
 * Generate PR review instructions for code review toggle
 * @returns {string} PR review section
 */
export function formatPrReview() {
  return `

## PR Review

After creating the pull request:
1. Check for review comments and requested changes
2. Address all feedback
3. Only mark the task as Done after approval and merge`
}

/**
 * Generate success criteria for implementation prompts
 * @param {Object} issue - Issue object
 * @param {Object} context - Context object
 * @returns {string} Success criteria section or empty string
 */
export function formatSuccessCriteria(issue, context) {
  const lines = [
    '',
    '## Success Criteria',
    '',
    '- [ ] Implementation matches task requirements',
    '- [ ] Tests cover new/changed behavior',
    '- [ ] No regressions in existing tests'
  ]

  // Add parent-aware criteria if has parent
  if (context.parent) {
    lines.push(`- [ ] Changes align with parent task ${context.parent.identifier}`)
  }

  return lines.join('\n')
}

/**
 * Generate if-blocked guidance
 * @returns {string} If blocked section
 */
export function formatIfBlocked() {
  return `

## If Blocked

If you encounter blockers during this work:
1. Document the blocker clearly
2. Add a comment on the issue via Linear MCP explaining the blocker
3. Consider if the task needs a "blocked" label`
}

/**
 * Check if issue has the preparing label
 * @param {Object} issue - Issue object with labels
 * @returns {boolean} True if issue has preparing label
 */
export function hasPreparingLabel(issue) {
  const issueLabels = (issue.labels?.nodes || issue.labels || [])
    .map(l => typeof l === 'string' ? l : l.name)
    .map(l => l.toLowerCase())
  return issueLabels.includes(PREPARING_LABEL.toLowerCase())
}

/**
 * Generate preparing label instructions for implementation prompts
 * Rule: If task has preparing label, add instruction to remove it
 * @param {Object} issue - Issue object
 * @returns {string} Label instruction or empty string
 */
export function formatPreparingLabelRemoval(issue) {
  if (!hasPreparingLabel(issue)) {
    return ''
  }
  return `
**Label Update**: This task has the \`${PREPARING_LABEL}\` label. Remove it via Linear MCP when implementation begins (it indicates pre-implementation work is complete).`
}
