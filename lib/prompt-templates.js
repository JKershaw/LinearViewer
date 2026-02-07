/**
 * Prompt Templates for Label-Based AI Workflows
 *
 * Maps Linear labels to AI prompts that help process tasks.
 * Each template receives issue data and context (parent, siblings, project, children)
 * and generates a prompt for Claude Code with Linear MCP.
 *
 * Template categories:
 * - 'pre-work': Task needs work before it's ready (excludes from Ready queue)
 * - 'work-issue': Issues that occur during active work (label-based)
 * - 'ready': Available when task is in Ready queue (state-based, no label needed)
 * - 'universal': Available for all issues
 *
 * Simplified label system (3 labels):
 * - preparing: Pre-implementation work (research, breakdown, design, etc.)
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 */

import { COMPLETION_SIGNALS } from './completion-signals.js';
import { WORK_ISSUE_LABELS, VIRTUAL_PROMPTS, PREPARING_LABEL } from './workflow-config.js';

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
 * Human-readable display names for prompt categories
 */
export const CATEGORY_DISPLAY_NAMES = {
  [PROMPT_CATEGORIES.PRE_WORK]: 'Pre-Work',
  [PROMPT_CATEGORIES.WORK_ISSUE]: 'Work Issues',
  [PROMPT_CATEGORIES.READY]: 'Ready',
  [PROMPT_CATEGORIES.UNIVERSAL]: 'Universal'
};

/**
 * Display order for prompt categories.
 * Used by renderers to ensure consistent category ordering.
 */
export const CATEGORY_DISPLAY_ORDER = [
  CATEGORY_DISPLAY_NAMES[PROMPT_CATEGORIES.PRE_WORK],
  CATEGORY_DISPLAY_NAMES[PROMPT_CATEGORIES.WORK_ISSUE],
  CATEGORY_DISPLAY_NAMES[PROMPT_CATEGORIES.READY],
  CATEGORY_DISPLAY_NAMES[PROMPT_CATEGORIES.UNIVERSAL]
];

/**
 * @typedef {Object} PromptContext
 * @property {Object|null} parent - Parent issue (id, title, identifier, state)
 * @property {Array} siblings - Sibling issues (up to 5 most relevant)
 * @property {Object|null} project - Project name and description
 * @property {Array} children - Existing child issues
 * @property {Array} comments - Issue comments (body, createdAt, user)
 */

/**
 * Format sibling issues for display in prompt
 * @param {Array} siblings - Array of sibling issues
 * @returns {string} Formatted sibling list or empty string if none
 */
function formatSiblings(siblings) {
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
function formatChildren(children) {
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
function formatSubtaskSummary(children) {
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
function formatComments(comments) {
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
function formatProject(project) {
  if (!project) return 'Unknown'
  return project.name
}

/**
 * Format labels excluding specified ones
 * @param {Array} labels - Array of label names
 * @param {Array} exclude - Labels to exclude
 * @returns {string} Formatted labels or empty string if none
 */
function formatLabels(labels, exclude = []) {
  const filtered = (labels || []).filter(l => !exclude.includes(l))
  return filtered.length > 0 ? filtered.join(', ') : ''
}

/**
 * Format parent task info consistently
 * @param {Object|null} parent - Parent issue object
 * @returns {string} Formatted parent info or empty string if none
 */
function formatParent(parent) {
  if (!parent) return ''
  return `${parent.identifier}: "${parent.title}" (${parent.state?.name || 'Unknown'})`
}

/**
 * Format a section with label and content, only if content exists
 * @param {string} label - Section label (e.g., "Parent Task")
 * @param {string} content - Section content
 * @returns {string} Formatted section or empty string if no content
 */
function formatSection(label, content) {
  if (!content) return ''
  return `**${label}:** ${content}`
}

/**
 * Format a multi-line section with label and content, only if content exists
 * @param {string} label - Section label (e.g., "Sibling Tasks")
 * @param {string} content - Section content (multi-line)
 * @returns {string} Formatted section or empty string if no content
 */
function formatMultiLineSection(label, content) {
  if (!content) return ''
  return `**${label}:**\n${content}`
}

/**
 * Format the prompt header with task identifier and title
 * @param {string} action - Action verb (e.g., "Implement", "Break down", "Research")
 * @param {Object} issue - Issue object with identifier and title
 * @returns {string} Formatted header
 */
function formatHeader(action, issue) {
  return `# ${action} ${issue.identifier}: ${issue.title}`
}

/**
 * Generate workflow instructions based on prompt category
 * @param {string} category - The prompt category
 * @param {Object} issue - Issue object with identifier
 * @returns {string} Workflow section or empty string
 */
function formatWorkflow(category, issue) {
  const identifier = issue.identifier

  // Universal prompts: start, fetch details, add findings as comment
  if (category === PROMPT_CATEGORIES.UNIVERSAL) {
    return `## Workflow

1. **Start**: Use Linear MCP to set ${identifier} status to "In Progress" (if not already)
2. **Fetch details**: Use Linear MCP to get full issue details for ${identifier}
3. **Analyze**: Complete the goal below
4. **Update Linear**: Add findings as a comment on ${identifier} via Linear MCP`
  }

  // Work-issue prompts (blocked, bug): start, investigate and update
  if (category === PROMPT_CATEGORIES.WORK_ISSUE) {
    return `## Workflow

1. **Start**: Use Linear MCP to set ${identifier} status to "In Progress" (if not already)
2. **Fetch details**: Use Linear MCP to get full issue details for ${identifier}
3. **Investigate**: Complete the goal below
4. **Update Linear**: Add findings as a comment and update labels if needed via Linear MCP`
  }

  // Ready prompts (plan, code-review): full implementation workflow
  if (category === PROMPT_CATEGORIES.READY) {
    return `## Workflow

1. **Start**: Use Linear MCP to set ${identifier} status to "In Progress" (if not already)
2. **Fetch details**: Use Linear MCP to get full issue details
3. **Implement**: Complete the goal below
4. **Commit**: Push changes with descriptive commit message
5. **Complete**: Use Linear MCP to set ${identifier} status to "Done" and add summary comment`
  }

  return ''
}

/**
 * Generate workflow instructions for read-only templates (no status change)
 * Used by templates that gather information without modifying issue state
 * @param {Object} issue - Issue object with identifier
 * @returns {string} Workflow section
 */
function formatReadOnlyWorkflow(issue) {
  const identifier = issue.identifier
  return `## Workflow

1. **Fetch details**: Use Linear MCP to get full issue details for ${identifier}
2. **Analyze**: Complete the goal below
3. **Update Linear**: Add findings as a comment on ${identifier} via Linear MCP`
}

/**
 * Generate success criteria for implementation prompts
 * @param {Object} issue - Issue object
 * @param {Object} context - Context object
 * @returns {string} Success criteria section or empty string
 */
function formatSuccessCriteria(issue, context) {
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
function formatIfBlocked() {
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
function hasPreparingLabel(issue) {
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
function formatPreparingLabelRemoval(issue) {
  if (!hasPreparingLabel(issue)) {
    return ''
  }
  return `
**Label Update**: This task has the \`${PREPARING_LABEL}\` label. Remove it via Linear MCP when implementation begins (it indicates pre-implementation work is complete).`
}

/**
 * Prompt template definitions
 * Each template has:
 * - name: Display name for the prompt
 * - category: When prompt is available (pre-work, work-issue, ready)
 * - generate: Function that takes (issue, context) and returns prompt string
 */
export const PROMPT_TEMPLATES = {
  [WORK_ISSUE_LABELS.BLOCKED]: {
    name: 'blocked',
    category: PROMPT_CATEGORIES.WORK_ISSUE,
    description: 'Analyze and resolve blockers preventing progress. Use when work is stalled due to dependencies, missing info, or technical issues.',
    completionSignals: COMPLETION_SIGNALS[WORK_ISSUE_LABELS.BLOCKED],
    aiHint: {
      situation: 'dependencies, missing info, or stalled',
      goal: 'Identify the blocker type and root cause, evaluate options to unblock.',
      workflow: 'Fetch details → Analyze blocker → Update labels and add comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Unblock', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.WORK_ISSUE, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, [WORK_ISSUE_LABELS.BLOCKED])),
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical analyst diagnosing work impediments. You have authority to identify blockers, evaluate options, and recommend solutions, but cannot unilaterally make decisions that require stakeholder input.',
        '',
        'Identify the blocker type and root cause, evaluate options to unblock, and recommend the best path forward.',
        '',
        'Analyze:',
        '- **Blocker Type**: Dependency, missing info, technical issue, external, or other',
        '- **Root Cause**: What\'s actually preventing progress',
        '- **Options**: 2-3 ways to unblock with tradeoffs',
        '- **Recommendation**: Best path forward with rationale',
        '',
        '**When resolved**: Remove the `blocked` label via Linear MCP'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  [WORK_ISSUE_LABELS.BUG]: {
    name: 'bug',
    category: PROMPT_CATEGORIES.WORK_ISSUE,
    description: 'Investigate and debug an issue. Use when you need to find root cause, reproduction steps, and potential fixes.',
    completionSignals: COMPLETION_SIGNALS[WORK_ISSUE_LABELS.BUG],
    aiHint: {
      situation: 'needs investigation, debugging',
      goal: 'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.',
      workflow: 'Fetch details → Investigate → Add findings as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Investigate bug', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.WORK_ISSUE, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, [WORK_ISSUE_LABELS.BUG])),
        formatMultiLineSection('Bug Reports & Discussion', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a software debugger investigating unexpected behavior. You have authority to reproduce issues, trace root causes, and propose fixes, but should not deploy changes without review.',
        '',
        'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.',
        '',
        'Investigation process:',
        '1. Reproduce the issue (document exact steps)',
        '2. Identify likely causes (code paths, recent changes)',
        '3. Debug systematically (add logging, trace execution)',
        '4. Propose fix with minimal scope',
        '5. Verify fix doesn\'t introduce regressions',
        '',
        '**When fixed**: Remove the `bug` label via Linear MCP'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'plan': {
    name: 'plan',
    category: PROMPT_CATEGORIES.READY,
    description: 'Create a step-by-step implementation plan. Use when task is well-defined and you need to document the approach before coding.',
    completionSignals: COMPLETION_SIGNALS['plan'],
    aiHint: {
      situation: 'clear requirements, needs documented approach',
      goal: 'Create a clear implementation plan that someone could follow to complete the task.',
      workflow: 'Set status to "In Progress" → Analyze requirements → Document plan in description → Ready for implementation'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Implement', issue),
        '',
        '## Workflow',
        '',
        `1. **Start**: Use Linear MCP to set ${issue.identifier} status to "In Progress" (if not already)`,
        `2. **Fetch details**: Use Linear MCP to get full issue details for ${issue.identifier}`,
        '3. **Plan first**: Create an implementation plan before writing any code',
        `4. **Update description**: Add the implementation plan to the issue description via Linear MCP`,
        '5. **Implement**: Execute the plan with test coverage',
        '6. **Commit**: Push changes with commit message referencing ' + issue.identifier,
        `7. **Complete**: Update description with summary via Linear MCP, set status to "Done"`,
        formatPreparingLabelRemoval(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['plan', PREPARING_LABEL])),
        formatMultiLineSection('Prior Discussion', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as an implementation engineer planning and executing code changes. You have authority to design the implementation approach, write code, and create tests, but must follow existing codebase patterns and conventions.',
        '',
        '### Phase 1: Planning (required before coding)',
        '',
        'Create an implementation plan that includes:',
        '- Files to modify or create',
        '- Key changes in each file',
        '- Potential risks or edge cases',
        '- Testing approach',
        '',
        '**After planning**: Update the issue description with the implementation plan so the task overview reflects what will be done.',
        '',
        '### Phase 2: Implementation',
        '',
        '1. Run existing tests to verify baseline (ensure no pre-existing failures)',
        '2. Implement changes incrementally, following the plan',
        '3. Write tests for new/changed behavior',
        '4. Verify all tests pass before completing',
        '',
        '**After completing**: Update the issue description with a brief summary of what was implemented.',
        '',
        formatSubtaskSummary(context.children),
        '### Scope Control',
        '',
        '- Only implement what is explicitly requested',
        '- Avoid over-engineering or adding unrequested features',
        '- Keep changes minimal and focused on the task',
        formatSuccessCriteria(issue, context),
        formatIfBlocked()
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'code-review': {
    name: 'code review',
    category: PROMPT_CATEGORIES.READY,
    description: 'Review code changes for correctness, tests, and quality. Use when code is ready for review before merging.',
    completionSignals: COMPLETION_SIGNALS['code-review'],
    aiHint: {
      situation: 'code ready for review',
      goal: 'Review code changes for correctness, tests, style, security, and performance.',
      workflow: 'Fetch details → Review code → Add review findings as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Review', issue),
        '',
        '## Workflow',
        '',
        `1. **Fetch details**: Use Linear MCP to get full issue details for ${issue.identifier}`,
        '2. **Review**: Examine the code changes against the task requirements',
        `3. **Document**: Add review findings as a comment on ${issue.identifier} via Linear MCP`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['code-review'])),
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a code reviewer ensuring quality before merge. You have authority to approve, request changes, or flag concerns, but cannot override explicit project requirements.',
        '',
        'Review code changes for correctness, tests, style, security, and performance.',
        '',
        'Review checklist:',
        '- [ ] Changes match task requirements',
        '- [ ] Tests cover new/changed behavior',
        '- [ ] No security vulnerabilities introduced',
        '- [ ] Code style consistent with codebase',
        '- [ ] No performance regressions',
        '- [ ] Error handling is appropriate',
        '',
        'Provide verdict: **Approve** / **Request Changes** / **Needs Discussion**'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'look-into': {
    name: 'look into',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Get a quick overview and context for any task. Use when you want to understand what a task involves before deciding next steps.',
    completionSignals: COMPLETION_SIGNALS['look-into'],
    aiHint: {
      situation: 'understanding what\'s involved',
      goal: 'Summarize what this task involves and how it fits into the broader project context.',
      workflow: 'Fetch details → Analyze → Add findings as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Look into', issue),
        '',
        formatReadOnlyWorkflow(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, [VIRTUAL_PROMPTS.LOOK_INTO])),
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a project analyst providing quick orientation. Your role is to summarize and inform, not to make decisions or changes.',
        '',
        'Provide a quick overview of this task and its context.',
        '',
        'Summarize:',
        '- What the task is asking for',
        '- How it fits into the broader project',
        '- Current status and any blockers',
        '- Recommended next action (which prompt type to use next)'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'triage': {
    name: 'triage',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Review and update task metadata: labels, priority, assignee. Use when a task needs organizational cleanup before work begins.',
    completionSignals: COMPLETION_SIGNALS['triage'],
    aiHint: {
      situation: 'missing metadata, unclear priority',
      goal: 'Review and apply updates to labels, priority, and state.',
      workflow: 'Fetch details → Analyze → Apply changes directly via Linear MCP'
    },
    generate: (issue, context) => {
      const currentLabels = formatLabels(issue.labels) || 'None'
      const sections = [
        formatHeader('Triage', issue),
        '',
        '## Workflow',
        '',
        `1. **Fetch details**: Use Linear MCP to get full issue details for ${issue.identifier}`,
        '2. **Analyze**: Review against the criteria below',
        `3. **Update Linear**: Apply recommended changes via Linear MCP`,
        '',
        '## Current State',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Status', issue.state?.name || 'Unknown'),
        formatSection('Priority', issue.priority !== undefined ? `${issue.priority}` : 'Not set'),
        formatSection('Assignee', issue.assignee?.name || 'Unassigned'),
        formatSection('Labels', currentLabels),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a project coordinator with authority to update task metadata. You can modify labels, priority, and state based on assessment, but should explain your reasoning for significant changes.',
        '',
        'Review this task and apply appropriate updates via Linear MCP.',
        '',
        '### Label Selection Guide',
        '',
        'Labels indicate **current state**, not future needs.',
        '',
        '**Available Labels:**',
        `- \`${PREPARING_LABEL}\`: Task needs pre-implementation work (research, breakdown, design, etc.) before it\'s ready to implement`,
        `- \`${WORK_ISSUE_LABELS.BLOCKED}\`: Work is stuck on external dependency, decision, or missing information`,
        `- \`${WORK_ISSUE_LABELS.BUG}\`: Unexpected behavior discovered that needs investigation and fix`,
        '',
        '**Label Rules:**',
        `- Add \`${PREPARING_LABEL}\` if task needs research, breakdown, scoping, or design before implementation`,
        `- Remove \`${PREPARING_LABEL}\` when pre-work is complete and task is ready to implement`,
        `- \`${WORK_ISSUE_LABELS.BLOCKED}\` and \`${WORK_ISSUE_LABELS.BUG}\` can coexist with \`${PREPARING_LABEL}\``,
        '',
        '### Other Metadata',
        '',
        '- **Priority**: Is the current priority appropriate given importance and urgency?',
        '- **State**: Is it in the right workflow state for its current progress?',
        '',
        'For each change, provide reasoning. Apply changes directly via Linear MCP.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'breakdown': {
    name: 'breakdown',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Break a large or vague task into smaller, actionable subtasks. Use when task scope is unclear or too big to start.',
    completionSignals: COMPLETION_SIGNALS['breakdown'],
    aiHint: {
      situation: 'large, vague, or complex',
      goal: 'Break this task into smaller, actionable subtasks ordered by dependencies.',
      workflow: 'Fetch details → Analyze → Create subtasks → Add blocked-by relations → Add summary comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Break down', issue),
        '',
        `## Workflow

1. **Start**: Use Linear MCP to set ${issue.identifier} status to "In Progress" (if not already)
2. **Fetch details**: Use Linear MCP to get full issue details for ${issue.identifier}
3. **Analyze**: Complete the goal below
4. **Update Linear**: Create subtasks via Linear MCP, add blocked-by relations, then add summary comment`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Existing Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['breakdown'])),
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical decomposer breaking complex work into actionable units. You have authority to create subtasks and define dependencies, but should preserve the original task\'s intent and scope.',
        '',
        'Break this task into smaller, actionable subtasks ordered by dependencies.',
        context.children?.length > 0 ? 'Review existing subtasks and avoid duplicating them.' : '',
        '',
        '### Creating Subtasks',
        '',
        'For each subtask, create it in Linear via MCP with:',
        '- Clear title and description with acceptance criteria',
        '- `parentId` to link to the parent issue',
        '- `projectId` inherited from parent',
        '- `stateId` set to "Todo"',
        '',
        '### After Creating All Subtasks',
        '',
        '1. Create `blocked-by` relations to establish execution order',
        '2. Add a summary comment to the parent grouping subtasks by phase'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'research': {
    name: 'research',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Investigate unknowns, explore options, and gather information. Use when you need to understand a problem before implementing.',
    completionSignals: COMPLETION_SIGNALS['research'],
    aiHint: {
      situation: 'unknowns, options to explore',
      goal: 'Identify key questions, research systematically, and provide actionable recommendations.',
      workflow: 'Fetch details → Research → Add exploration notes as comment, update description with key findings via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Research', issue),
        '',
        `## Workflow

1. **Start**: Use Linear MCP to set ${issue.identifier} status to "In Progress" (if not already)
2. **Fetch details**: Use Linear MCP to get full issue details for ${issue.identifier}
3. **Analyze**: Complete the goal below
4. **Update Linear**: Add exploration notes as comment, then update description with key findings via Linear MCP`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, ['research'])),
        formatMultiLineSection('Prior Research & Discussion', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical researcher investigating unknowns. Your role is to gather information and provide recommendations, not to make final decisions on direction.',
        '',
        'Identify key questions, research systematically, and provide actionable recommendations.',
        context.comments?.length > 0 ? 'Review the prior research above and build on existing findings.' : '',
        '',
        'Document your findings:',
        '- Key discoveries and insights',
        '- Options considered with pros/cons',
        '- Recommended next steps',
        '',
        '**Output:**',
        '- **Comment**: Full research notes, exploration process, sources consulted',
        '- **Description**: Key findings, conclusions, and recommended approach (makes task overview accurate)'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'scoping': {
    name: 'scoping',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Define clear boundaries, assumptions, and success criteria. Use when requirements are ambiguous or scope creep is a risk.',
    completionSignals: COMPLETION_SIGNALS['scoping'],
    aiHint: {
      situation: 'ambiguous requirements',
      goal: 'Define clear boundaries (in scope vs out), assumptions, success criteria, and open questions.',
      workflow: 'Fetch details → Define scope → Update issue description with finalized scope via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Define scope for', issue),
        '',
        `## Workflow

1. **Start**: Use Linear MCP to set ${issue.identifier} status to "In Progress" (if not already)
2. **Fetch details**: Use Linear MCP to get full issue details for ${issue.identifier}
3. **Analyze**: Complete the goal below
4. **Update Linear**: Update issue description with finalized scope via Linear MCP`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Work', formatSiblings(context.siblings)),
        formatMultiLineSection('Existing Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['scoping'])),
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a scope analyst defining clear boundaries. You have authority to propose what\'s in and out of scope, but open questions should be flagged for stakeholder resolution.',
        '',
        'Define clear boundaries (in scope vs out of scope), assumptions, success criteria, and open questions.',
        '',
        'Document in a structured format suitable for the issue description:',
        '- **In Scope**: What this task will deliver',
        '- **Out of Scope**: What is explicitly excluded',
        '- **Assumptions**: What we\'re assuming to be true',
        '- **Success Criteria**: How we\'ll know when it\'s done',
        '- **Open Questions**: Unresolved items needing clarification',
        '',
        'Note: Update the description (not a comment) so scope is the single source of truth.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'design': {
    name: 'design',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Create a technical design with multiple approaches and tradeoffs. Use for complex features needing architectural decisions.',
    completionSignals: COMPLETION_SIGNALS['design'],
    aiHint: {
      situation: 'architectural decisions needed',
      goal: 'Evaluate 2-3 design approaches with tradeoffs, recommend one, and outline implementation.',
      workflow: 'Fetch details → Design → Add full analysis as comment, update description with chosen design via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Design', issue),
        '',
        `## Workflow

1. **Start**: Use Linear MCP to set ${issue.identifier} status to "In Progress" (if not already)
2. **Fetch details**: Use Linear MCP to get full issue details for ${issue.identifier}
3. **Analyze**: Complete the goal below
4. **Update Linear**: Add full design analysis as comment, then update description with chosen approach via Linear MCP`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Existing Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['design'])),
        formatMultiLineSection('Prior Discussion', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical architect evaluating design options. You have authority to analyze tradeoffs and recommend approaches, but major architectural decisions may require stakeholder sign-off.',
        '',
        'Evaluate 2-3 design approaches with tradeoffs, recommend one, and outline implementation considerations.',
        '',
        'For each approach, document:',
        '- High-level architecture',
        '- Pros and cons',
        '- Implementation complexity',
        '- Risk factors',
        '',
        'Conclude with a clear recommendation and rationale.',
        '',
        '**Output:**',
        '- **Comment**: Full design analysis with all approaches evaluated',
        '- **Description**: Summary of chosen approach and key implementation details'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'spike': {
    name: 'spike',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Time-boxed exploration to answer specific technical questions. Use when you need proof-of-concept or feasibility assessment.',
    completionSignals: COMPLETION_SIGNALS['spike'],
    aiHint: {
      situation: 'needs proof-of-concept or feasibility check',
      goal: 'Define specific questions, explore with a timebox, and provide go/no-go recommendation.',
      workflow: 'Fetch details → Spike → Add findings as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Spike', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.UNIVERSAL, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Labels', formatLabels(issue.labels, ['spike'])),
        formatMultiLineSection('Prior Research', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical explorer validating feasibility. Your role is to answer specific questions through focused experimentation, not to implement production solutions.',
        '',
        'Define 3-5 specific questions to answer, a focused exploration approach, and clear success criteria.',
        '',
        'Spike deliverables:',
        '- Specific questions to answer',
        '- Proof-of-concept code (if applicable)',
        '- Findings summary with go/no-go recommendation',
        '- Identified risks or unknowns remaining'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'context': {
    name: 'context',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Synthesize current state and history of a task. Use when joining a task mid-way or after a long gap.',
    completionSignals: COMPLETION_SIGNALS['context'],
    aiHint: {
      situation: 'joining mid-way, returning after gap',
      goal: 'Synthesize current state, what\'s done, what remains, key decisions, and next steps.',
      workflow: 'Fetch details and comments → Analyze → Add summary as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Get context for', issue),
        '',
        formatReadOnlyWorkflow(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['context'])),
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a project historian synthesizing task state. Your role is to inform and summarize, not to make changes or decisions.',
        '',
        'Synthesize current state, what\'s done, what remains, key decisions, and recommended next steps.',
        '',
        'Gather context from:',
        '- The discussion history above',
        '- Related code changes (git history)',
        '- Sibling and parent task status',
        '',
        'Summarize:',
        '- **Current State**: Where things stand now',
        '- **Completed**: What\'s already done',
        '- **Remaining**: What still needs to happen',
        '- **Key Decisions**: Important choices made',
        '- **Next Steps**: Recommended actions to proceed'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'implementation': {
    name: 'implement',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Guide for active implementation phase. Use when research and planning are complete and coding is in progress.',
    completionSignals: COMPLETION_SIGNALS['implementation'],
    aiHint: {
      situation: 'ready to code, plan exists',
      goal: 'Implement the planned changes with test coverage.',
      workflow: 'Fetch details → Implement → Run tests → Commit → Add summary comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Implement', issue),
        '',
        `## Workflow

1. **Start**: Use Linear MCP to set ${issue.identifier} status to "In Progress" (if not already)
2. **Fetch details**: Use Linear MCP to get full issue details for ${issue.identifier}
3. **Implement**: Complete the goal below
4. **Test**: Run tests to verify implementation
5. **Commit**: Push changes with commit message referencing ${issue.identifier}
6. **Update Linear**: Add summary comment via Linear MCP`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['implementation'])),
        formatMultiLineSection('Prior Discussion', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a software engineer executing planned changes. You have authority to implement code and tests within the defined scope, but should flag scope expansion for approval.',
        '',
        'Implement the changes described in the issue with appropriate test coverage.',
        '',
        '### Implementation Guidelines',
        '',
        '1. Follow the implementation plan in the description (if present)',
        '2. Write tests for new/changed behavior',
        '3. Verify all tests pass before completing',
        '4. Keep changes minimal and focused on the task',
        '',
        '### Scope Control',
        '',
        '- Only implement what is explicitly requested',
        '- Avoid over-engineering or adding unrequested features',
        '- Keep changes minimal and focused on the task',
        formatIfBlocked()
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'review': {
    name: 'review',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Comprehensive review checklist for completed implementation. Use when code is ready for CI/CD and final review.',
    completionSignals: COMPLETION_SIGNALS['review'],
    aiHint: {
      situation: 'implementation complete, awaiting review',
      goal: 'Verify implementation is complete and ready for merge.',
      workflow: 'Fetch details → Verify tests pass → Check CI status → Add review findings as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Review', issue),
        '',
        formatReadOnlyWorkflow(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, ['review'])),
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a quality assurance reviewer verifying implementation completeness. Your role is to verify against requirements, not to add new requirements.',
        '',
        'Verify the implementation is complete and meets the requirements.',
        '',
        '### Review Checklist',
        '',
        '- [ ] Implementation matches task requirements',
        '- [ ] Tests cover new/changed behavior',
        '- [ ] CI/CD pipeline passes',
        '- [ ] No regressions introduced',
        '- [ ] Code is ready for production',
        '',
        '### Completion',
        '',
        'When review passes:',
        '1. Add a summary comment noting what was verified',
        '2. Update task status as appropriate'
      ].filter(Boolean)

      return sections.join('\n')
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
 * Get the display name for a prompt template
 * @param {string} labelName - The label/key name
 * @returns {string} Human-readable name or the label name if not found
 */
export function getPromptDisplayName(labelName) {
  return PROMPT_TEMPLATES[labelName]?.name || labelName
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

/**
 * Get all labels with a specific category
 * @param {string} category - The category to filter by (from PROMPT_CATEGORIES)
 * @returns {string[]} Array of label names with that category
 */
export function getLabelsByCategory(category) {
  return Object.entries(PROMPT_TEMPLATES)
    .filter(([, template]) => template.category === category)
    .map(([label]) => label)
}

/**
 * Get all pre-work labels (tasks not ready for implementation)
 * These labels exclude tasks from the Ready queue
 * @returns {string[]} Array of pre-work label names
 */
export function getPreWorkLabels() {
  // Simplified: only the preparing label indicates pre-work
  return [PREPARING_LABEL]
}

/**
 * Get all universal labels (available for all issues)
 * @returns {string[]} Array of universal label names
 */
export function getUniversalLabels() {
  return getLabelsByCategory(PROMPT_CATEGORIES.UNIVERSAL)
}

/**
 * Get the category of a prompt template
 * @param {string} labelName - The label name
 * @returns {string|null} The category or null if not found
 */
export function getPromptCategory(labelName) {
  const template = PROMPT_TEMPLATES[labelName]
  return template?.category || null
}

/**
 * Check if a label is a pre-work label (excludes from Ready queue)
 * @param {string} labelName - The label name to check
 * @returns {boolean} True if the label is a pre-work label
 */
export function isPreWorkLabel(labelName) {
  return labelName.toLowerCase() === PREPARING_LABEL.toLowerCase()
}

/**
 * Check if an issue is eligible for ready prompts (plan, code-review)
 * Eligible = (backlog/unstarted/started state) AND no preparing label
 * This covers Ready queue tasks AND in-progress tasks without blockers
 * @param {Object} issue - The issue object with state and labels
 * @returns {boolean} True if the issue is eligible for ready prompts
 */
export function isEligibleForPlan(issue) {
  const stateType = issue.state?.type?.toLowerCase() || ''
  const eligibleStates = ['backlog', 'unstarted', 'started']

  if (!eligibleStates.includes(stateType)) {
    return false
  }

  // Check if issue has the preparing label
  const issueLabels = (issue.labels?.nodes || []).map(l => l.name.toLowerCase())
  return !issueLabels.includes(PREPARING_LABEL.toLowerCase())
}

// Legacy alias for backwards compatibility
export const isInReadyQueue = isEligibleForPlan

/**
 * Get all available prompts for an issue (both label-based and state-based)
 * @param {Object} issue - The issue object with labels and state
 * @returns {string[]} Array of available prompt label names
 */
export function getAvailablePrompts(issue) {
  const available = []

  // Add label-based prompts
  const issueLabels = (issue.labels?.nodes || []).map(l => l.name)
  for (const label of issueLabels) {
    if (hasPrompt(label)) {
      available.push(label)
    }
  }

  // Add state-based prompts (plan and code-review for eligible tasks)
  if (isEligibleForPlan(issue)) {
    if (!available.includes('plan')) {
      available.push('plan')
    }
    if (!available.includes('code-review')) {
      available.push('code-review')
    }
  }

  // Add universal prompts (available for all issues)
  for (const label of getUniversalLabels()) {
    if (!available.includes(label)) {
      available.push(label)
    }
  }

  return available
}

/**
 * Get all prompt templates organized by category
 * @returns {Object} Object with category keys containing arrays of { key, name }
 */
export function getAllPromptsByCategory() {
  const byCategory = {
    [PROMPT_CATEGORIES.PRE_WORK]: [],
    [PROMPT_CATEGORIES.WORK_ISSUE]: [],
    [PROMPT_CATEGORIES.READY]: [],
    [PROMPT_CATEGORIES.UNIVERSAL]: []
  }

  for (const [key, template] of Object.entries(PROMPT_TEMPLATES)) {
    byCategory[template.category].push({
      key,
      name: template.name
    })
  }

  return byCategory
}

/**
 * Get prompt descriptions for AI recommendation
 * @param {string[]} availablePromptKeys - Array of available prompt keys for the issue
 * @returns {Array<{key: string, name: string, description: string, category: string}>}
 */
export function getPromptDescriptionsForAI(availablePromptKeys) {
  return availablePromptKeys
    .filter(key => PROMPT_TEMPLATES[key])
    .map(key => {
      const template = PROMPT_TEMPLATES[key]
      return {
        key,
        name: template.name,
        description: template.description,
        category: template.category
      }
    })
}

/**
 * Format all template aiHints as examples for the AI meta-prompt
 * @returns {string} Formatted examples section for the meta-prompt
 */
export function formatAIHintsForMetaPrompt() {
  const lines = []

  for (const [key, template] of Object.entries(PROMPT_TEMPLATES)) {
    if (!template.aiHint) continue

    const { situation, goal, workflow } = template.aiHint
    lines.push(`**${template.name}** (${situation}):`)
    lines.push(`Goal: "${goal}"`)
    lines.push(`Workflow: ${workflow}`)
    lines.push('')
  }

  return lines.join('\n').trim()
}
