/**
 * Prompt Formatting Helpers
 *
 * Reusable formatting functions used by prompt templates.
 * Handles formatting of issue context (siblings, children, parents,
 * comments, labels, projects) and workflow/structural sections.
 */

import { COMPLETION_SIGNALS } from './completion-signals.js';
import { WORK_ISSUE_LABELS, VIRTUAL_PROMPTS } from './workflow-config.js';
import { isTerminalState } from './tree.js';
import { STARTED, UNSTARTED, BACKLOG } from './providers/models.js';

// Re-export for convenience (templates need these)
export { COMPLETION_SIGNALS, WORK_ISSUE_LABELS, VIRTUAL_PROMPTS };

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
  const completedCount = children.filter(c => isTerminalState(c.state?.type)).length
  const inProgressCount = children.filter(c => c.state?.type === STARTED).length

  let line = `**Subtasks:** ${completedCount}/${total} done`

  if (inProgressCount > 0) {
    line += `, ${inProgressCount} in progress`
  }

  // Find the first actionable child (relies on pre-sorted order: started > unstarted > backlog > completed)
  const nextChild = children.find(c =>
    c.state?.type === STARTED || c.state?.type === UNSTARTED || c.state?.type === BACKLOG
  )

  if (nextChild) {
    const action = nextChild.state?.type === STARTED ? 'Continue' : 'Next'
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
 * Parse repo name from a project description.
 * Looks for a line matching `repo=<value>` (case-sensitive key, any line position).
 * @param {string|null} description - Project description text
 * @returns {string|null} Repo name or null if not found
 */
export function parseRepoFromDescription(description) {
  if (!description) return null
  const match = description.match(/^repo=([^\r\n]+)$/m)
  return match ? match[1].trim() : null
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
 * @param {boolean} [options.useLinear=true] - Whether to include Linear references in workflow steps
 * @returns {string} Workflow section or empty string
 */
export function formatWorkflow(category, issue, { useMcp, useLinear } = {}) {
  const identifier = issue.identifier
  // Support legacy useMcp parameter, prefer useLinear
  const includeLinear = useLinear ?? useMcp ?? true
  const linear = includeLinear ? ' in Linear' : ''

  // Universal prompts: start, fetch details, add findings as comment
  if (category === PROMPT_CATEGORIES.UNIVERSAL) {
    return `## Workflow

1. **Start**: Set ${identifier} status to "In Progress"${linear} (if not already)
2. **Fetch details**: Get full issue details for ${identifier}${linear}
3. **Analyze**: Complete the goal below
4. **Update Linear**: Add findings as a comment on ${identifier}`
  }

  // Work-issue prompts (blocked, bug): start, investigate and update
  if (category === PROMPT_CATEGORIES.WORK_ISSUE) {
    return `## Workflow

1. **Start**: Set ${identifier} status to "In Progress"${linear} (if not already)
2. **Fetch details**: Get full issue details for ${identifier}${linear}
3. **Investigate**: Complete the goal below
4. **Update Linear**: Add findings as a comment and update labels if needed`
  }

  // Ready prompts (plan, code-review): full implementation workflow
  if (category === PROMPT_CATEGORIES.READY) {
    return `## Workflow

1. **Start**: Set ${identifier} status to "In Progress"${linear} (if not already)
2. **Fetch details**: Get full issue details${linear}
3. **Implement**: Complete the goal below
4. **Commit**: Push changes with descriptive commit message
5. **Complete**: Set ${identifier} status to "Done" and add summary comment`
  }

  return ''
}

/**
 * Generate workflow instructions for read-only templates (no status change)
 * Used by templates that gather information without modifying issue state
 * @param {Object} issue - Issue object with identifier
 * @param {Object} [options] - Options
 * @param {boolean} [options.useLinear=true] - Whether to include Linear references
 * @returns {string} Workflow section
 */
export function formatReadOnlyWorkflow(issue, { useMcp, useLinear } = {}) {
  const identifier = issue.identifier
  const includeLinear = useLinear ?? useMcp ?? true
  const linear = includeLinear ? ' in Linear' : ''
  return `## Workflow

1. **Fetch details**: Get full issue details for ${identifier}${linear}
2. **Analyze**: Complete the goal below
3. **Update Linear**: Add findings as a comment on ${identifier}`
}

/**
 * Generate workflow instructions for inform-only templates (no Linear updates)
 * Used by templates that summarize findings for the user without writing back to Linear
 * @param {Object} issue - Issue object with identifier
 * @param {Object} [options] - Options
 * @param {boolean} [options.useLinear=true] - Whether to include Linear references
 * @returns {string} Workflow section
 */
export function formatInformOnlyWorkflow(issue, { useMcp, useLinear } = {}) {
  const identifier = issue.identifier
  const includeLinear = useLinear ?? useMcp ?? true
  const linear = includeLinear ? ' in Linear' : ''
  return `## Workflow

1. **Fetch details**: Get full issue details for ${identifier}${linear}
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
 * Generate a staleness / re-grounding directive for the executing agent.
 *
 * Tells the downstream coding agent to treat the ticket as a hypothesis about
 * the codebase rather than ground truth, and to re-verify it against current
 * source before relying on it. Guards against tickets whose description was
 * accurate when written but invalidated by later commits.
 *
 * NOTE: This directive is intentionally mirrored in the AI meta-prompt path
 * (lib/prompts/meta-prompt-template.js). Per CLAUDE.md, prompt-behavior
 * changes must be applied to BOTH the handwritten and AI-generated paths.
 *
 * @param {Object} issue - Issue object (uses createdAt for the since-date)
 * @returns {string} Staleness-check section
 */
export function formatStalenessCheck(issue) {
  const createdAt = issue?.createdAt
  const sinceArg = createdAt ? `"${createdAt}"` : '<ticket-createdAt>'
  const createdNote = createdAt
    ? `since this ticket was created (${createdAt})`
    : 'since this ticket was created'
  return `

## Re-ground the Ticket (staleness check)

Treat this ticket as a **hypothesis** about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:

1. List the files and symbols the ticket references.
2. Check whether any of them have changed ${createdNote}: run \`git log --since=${sinceArg} -- <paths>\` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.`
}

/**
 * Generate a terminal-state note for a task that is already finished.
 *
 * When the issue's own state is terminal (Done / Canceled / Duplicate) AND it has
 * no open (non-terminal) children, the work is complete — the executing agent
 * should verify/close rather than redo it as if unstarted. State is a SIGNAL that
 * shapes the action, not a gate that strips prompts (LIN-353).
 *
 * NOTE: This directive is intentionally mirrored in the AI meta-prompt path
 * (lib/prompts/meta-prompt-template.js → Step 0). Per CLAUDE.md, prompt-behavior
 * changes must be applied to BOTH the handwritten and AI-generated paths. A
 * terminal task that still has open children is NOT short-circuited here.
 *
 * @param {Object} issue - Issue object (uses state)
 * @param {Object} [context] - Context with children (to detect open remaining work)
 * @returns {string} Terminal-state note, or empty string when not terminal / has open children
 */
export function formatTerminalStateNote(issue, context = {}) {
  if (!isTerminalState(issue?.state?.type)) return '';
  const children = context?.children || [];
  const hasOpenChildren = children.some(c => !isTerminalState(c.state?.type));
  if (hasOpenChildren) return '';
  const stateName = issue?.state?.name || 'a terminal state';
  return `

## Task Already Complete (state: ${stateName})

This task is in a terminal state (Done / Canceled / Duplicate) and has no open subtasks — the work is already finished. Do NOT redo or re-investigate it as if it were unstarted. Treat this as a review/verification pass: confirm the finished work holds up against the goal, capture anything genuinely missing as a follow-up, and close out. State shapes this into a review; it is not a license for busywork against completed work.`;
}

/**
 * Scale-to-task directive (lower bound).
 *
 * Tells the executing agent to size its output to the task's actual scale rather
 * than to the template — a genuinely small task gets a short result and may skip the
 * heavy framing/completeness/history machinery. Includes the over-trim guard: do NOT
 * infer "small" from a terse description (rename/refactor/migrate-everywhere and
 * shared-identifier changes fan out to many surfaces even when tersely worded).
 *
 * Proven on the meta-prompt path via scripts/eval-prompt-scaling.mjs (genuine smalls
 * shrink ~12-20% with the quality floor held; the deceptive-small over-trim guard
 * holds). Mirrored here per CLAUDE.md's both-paths rule. Woven into the heavy
 * generative templates (plan, research) rather than tail-appended, because scale-down
 * is subtractive and a trailing "keep it brief" loses to the scaffold's gravity.
 *
 * @returns {string} Scale-to-task directive block
 */
export function formatScaleToTask() {
  return `**Scale this to the task.** Match the depth of what follows to the task's ACTUAL scale, not to this template. If the task is genuinely small or single-surface (a typo, a constant/config change, a one-file edit, or work that obviously fits one focused session), a short result is correct and complete — name the file(s) and the change, state the scope in a line, and skip the heavier framing/completeness/history sub-steps below. Do NOT infer "small" from a terse description, though: renaming, moving, refactoring, or migrating a name "everywhere"/"across the codebase", or changing a shared identifier or widely-used symbol, fans out to many surfaces even when written in one sentence — keep the full structure for those. Size to the surfaces you can verify, not to the template.`
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
2. Add a comment on the issue in Linear explaining the blocker
3. Consider if the task needs a "blocked" label`
}

