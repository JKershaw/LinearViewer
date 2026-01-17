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
 */

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
 * @typedef {Object} PromptContext
 * @property {Object|null} parent - Parent issue (id, title, identifier, state)
 * @property {Array} siblings - Sibling issues (up to 5 most relevant)
 * @property {Object|null} project - Project name and description
 * @property {Array} children - Existing child issues
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

  // Pre-work and universal prompts: fetch details, add findings as comment
  if (category === PROMPT_CATEGORIES.PRE_WORK || category === PROMPT_CATEGORIES.UNIVERSAL) {
    return `## Workflow

1. **Fetch details**: Use Linear MCP to get full issue details for ${identifier}
2. **Analyze**: Complete the goal below
3. **Update Linear**: Add findings as a comment on ${identifier} via Linear MCP`
  }

  // Work-issue prompts (blocked, bug): investigate and update
  if (category === PROMPT_CATEGORIES.WORK_ISSUE) {
    return `## Workflow

1. **Fetch details**: Use Linear MCP to get full issue details for ${identifier}
2. **Investigate**: Complete the goal below
3. **Update Linear**: Add findings as a comment and update labels if needed via Linear MCP`
  }

  // Ready prompts (plan, code-review): full implementation workflow
  if (category === PROMPT_CATEGORIES.READY) {
    return `## Workflow

1. **Start**: Use Linear MCP to set ${identifier} status to "In Progress"
2. **Fetch details**: Use Linear MCP to get full issue details
3. **Implement**: Complete the goal below
4. **Commit**: Push changes with descriptive commit message
5. **Complete**: Use Linear MCP to set ${identifier} status to "Done" and add summary comment`
  }

  return ''
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
 * Prompt template definitions
 * Each template has:
 * - name: Display name for the prompt
 * - category: When prompt is available (pre-work, work-issue, ready)
 * - generate: Function that takes (issue, context) and returns prompt string
 */
export const PROMPT_TEMPLATES = {
  'needs-breakdown': {
    name: 'Task Breakdown',
    category: PROMPT_CATEGORIES.PRE_WORK,
    description: 'Break a large or vague task into smaller, actionable subtasks. Use when task scope is unclear or too big to start.',
    aiHint: {
      situation: 'large, vague, or complex',
      goal: 'Break this task into smaller, actionable subtasks ordered by dependencies.',
      workflow: 'Fetch details → Analyze → Create subtasks in Linear via MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Break down', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.PRE_WORK, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Existing Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['needs-breakdown'])),
        '',
        '## Goal',
        '',
        'Break this task into smaller, actionable subtasks ordered by dependencies.',
        context.children?.length > 0 ? 'Review existing subtasks and avoid duplicating them.' : '',
        '',
        'For each subtask, create it in Linear via MCP with a clear title and brief description.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'needs-research': {
    name: 'Research Task',
    category: PROMPT_CATEGORIES.PRE_WORK,
    description: 'Investigate unknowns, explore options, and gather information. Use when you need to understand a problem before implementing.',
    aiHint: {
      situation: 'unknowns, options to explore',
      goal: 'Identify key questions, research systematically, and provide actionable recommendations.',
      workflow: 'Fetch details → Research → Add findings as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Research', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.PRE_WORK, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, ['needs-research'])),
        '',
        '## Goal',
        '',
        'Identify key questions, research systematically, and provide actionable recommendations.',
        '',
        'Document your findings with:',
        '- Key discoveries and insights',
        '- Options considered with pros/cons',
        '- Recommended next steps'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'needs-scoping': {
    name: 'Scope Definition',
    category: PROMPT_CATEGORIES.PRE_WORK,
    description: 'Define clear boundaries, assumptions, and success criteria. Use when requirements are ambiguous or scope creep is a risk.',
    aiHint: {
      situation: 'ambiguous requirements',
      goal: 'Define clear boundaries (in scope vs out), assumptions, success criteria, and open questions.',
      workflow: 'Fetch details → Define scope → Add scope document as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Define scope for', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.PRE_WORK, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Work', formatSiblings(context.siblings)),
        formatMultiLineSection('Existing Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['needs-scoping'])),
        '',
        '## Goal',
        '',
        'Define clear boundaries (in scope vs out of scope), assumptions, success criteria, and open questions.',
        '',
        'Document:',
        '- **In Scope**: What this task will deliver',
        '- **Out of Scope**: What is explicitly excluded',
        '- **Assumptions**: What we\'re assuming to be true',
        '- **Success Criteria**: How we\'ll know when it\'s done',
        '- **Open Questions**: Unresolved items needing clarification'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'needs-design': {
    name: 'Technical Design',
    category: PROMPT_CATEGORIES.PRE_WORK,
    description: 'Create a technical design with multiple approaches and tradeoffs. Use for complex features needing architectural decisions.',
    aiHint: {
      situation: 'architectural decisions needed',
      goal: 'Evaluate 2-3 design approaches with tradeoffs, recommend one, and outline implementation.',
      workflow: 'Fetch details → Design → Add design document as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Design', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.PRE_WORK, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Existing Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['needs-design'])),
        '',
        '## Goal',
        '',
        'Evaluate 2-3 design approaches with tradeoffs, recommend one, and outline implementation considerations.',
        '',
        'For each approach, document:',
        '- High-level architecture',
        '- Pros and cons',
        '- Implementation complexity',
        '- Risk factors',
        '',
        'Conclude with a clear recommendation and rationale.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'needs-spike': {
    name: 'Technical Spike',
    category: PROMPT_CATEGORIES.PRE_WORK,
    description: 'Time-boxed exploration to answer specific technical questions. Use when you need proof-of-concept or feasibility assessment.',
    aiHint: {
      situation: 'needs proof-of-concept or feasibility check',
      goal: 'Define specific questions, explore with a timebox, and provide go/no-go recommendation.',
      workflow: 'Fetch details → Spike → Add findings as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Spike', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.PRE_WORK, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Labels', formatLabels(issue.labels, ['needs-spike'])),
        '',
        '## Goal',
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

  'blocked': {
    name: 'Blocker Analysis',
    category: PROMPT_CATEGORIES.WORK_ISSUE,
    description: 'Analyze and resolve blockers preventing progress. Use when work is stalled due to dependencies, missing info, or technical issues.',
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
        formatSection('Labels', formatLabels(issue.labels, ['blocked'])),
        '',
        '## Goal',
        '',
        'Identify the blocker type and root cause, evaluate options to unblock, and recommend the best path forward.',
        '',
        'Analyze:',
        '- **Blocker Type**: Dependency, missing info, technical issue, external, or other',
        '- **Root Cause**: What\'s actually preventing progress',
        '- **Options**: 2-3 ways to unblock with tradeoffs',
        '- **Recommendation**: Best path forward with rationale',
        '',
        'If resolved, remove the "blocked" label via Linear MCP.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'needs-context': {
    name: 'Context Summary',
    category: PROMPT_CATEGORIES.PRE_WORK,
    description: 'Synthesize current state and history of a task. Use when joining a task mid-way or after a long gap.',
    aiHint: {
      situation: 'joining mid-way, returning after gap',
      goal: 'Synthesize current state, what\'s done, what remains, key decisions, and next steps.',
      workflow: 'Fetch details and comments → Analyze → Add summary as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Get context for', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.PRE_WORK, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['needs-context'])),
        '',
        '## Goal',
        '',
        'Synthesize current state, what\'s done, what remains, key decisions, and recommended next steps.',
        '',
        'Gather context from:',
        '- Issue description and comments (via Linear MCP)',
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

  'bug': {
    name: 'Bug Investigation',
    category: PROMPT_CATEGORIES.WORK_ISSUE,
    description: 'Investigate and debug an issue. Use when you need to find root cause, reproduction steps, and potential fixes.',
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
        formatSection('Labels', formatLabels(issue.labels, ['bug'])),
        '',
        '## Goal',
        '',
        'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.',
        '',
        'Investigation process:',
        '1. Reproduce the issue (document exact steps)',
        '2. Identify likely causes (code paths, recent changes)',
        '3. Debug systematically (add logging, trace execution)',
        '4. Propose fix with minimal scope',
        '5. Verify fix doesn\'t introduce regressions'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'plan': {
    name: 'Implementation Plan',
    category: PROMPT_CATEGORIES.READY,
    description: 'Create a step-by-step implementation plan. Use when task is well-defined and ready to start coding.',
    aiHint: {
      situation: 'clear requirements, ready to implement',
      goal: 'Create an implementation plan first, then implement with test coverage.',
      workflow: 'Set status to "In Progress" → Plan changes → Implement → Set status to "In Review" (or "Done" if unavailable)'
    },
    generate: (issue, context) => {
      const hasSubtasks = context.children && context.children.length > 0

      const sections = [
        formatHeader('Implement', issue),
        '',
        '## Workflow',
        '',
        `1. **Start**: Use Linear MCP to set ${issue.identifier} status to "In Progress"`,
        `2. **Fetch details**: Use Linear MCP to get full issue details for ${issue.identifier}`,
        '3. **Plan first**: Create an implementation plan before writing any code',
        '4. **Implement**: Execute the plan with test coverage',
        '5. **Commit**: Push changes with commit message referencing ' + issue.identifier,
        `6. **Submit for review**: Use Linear MCP to set ${issue.identifier} status to "In Review" (or "Done" if unavailable)`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['plan'])),
        '',
        '## Goal',
        '',
        '### Phase 1: Planning (required before coding)',
        '',
        'Create an implementation plan that includes:',
        '- Files to modify or create',
        '- Key changes in each file',
        '- Potential risks or edge cases',
        '- Testing approach',
        '',
        '### Phase 2: Implementation',
        '',
        '1. Run existing tests to verify baseline (ensure no pre-existing failures)',
        '2. Implement changes incrementally, following the plan',
        '3. Write tests for new/changed behavior',
        '4. Verify all tests pass before completing',
        '',
        hasSubtasks ? '### Subtask Guidance\n\nThis task has subtasks. Work through them systematically:\n- Check which subtasks are already completed\n- Do not duplicate work that is already done\n- Update subtask status as you complete them\n' : '',
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
    name: 'Code Review',
    category: PROMPT_CATEGORIES.READY,
    description: 'Review code changes for correctness, tests, and quality. Use when code is ready for review before merging.',
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
        '',
        '## Goal',
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
    name: 'Look Into',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Get a quick overview and context for any task. Use when you want to understand what a task involves before deciding next steps.',
    aiHint: {
      situation: 'understanding what\'s involved',
      goal: 'Summarize what this task involves and how it fits into the broader project context.',
      workflow: 'Fetch details → Analyze → Add findings as comment via Linear MCP'
    },
    generate: (issue, context) => {
      const sections = [
        formatHeader('Look into', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.UNIVERSAL, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['look-into'])),
        '',
        '## Goal',
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
    name: 'Task Triage',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Review and update task metadata: labels, priority, assignee. Use when a task needs organizational cleanup before work begins.',
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
        '',
        '## Goal',
        '',
        'Review this task and apply appropriate updates via Linear MCP:',
        '',
        '- **Labels**: Should it have needs-breakdown, needs-research, bug, blocked, or other workflow labels?',
        '- **Priority**: Is the current priority appropriate given the task\'s importance and urgency?',
        '- **State**: Is it in the right workflow state for its current progress?',
        '',
        'For each change, provide reasoning. Apply changes directly via Linear MCP.'
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
  return getLabelsByCategory(PROMPT_CATEGORIES.PRE_WORK)
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
  const template = PROMPT_TEMPLATES[labelName]
  return template?.category === PROMPT_CATEGORIES.PRE_WORK
}

/**
 * Check if an issue is eligible for ready prompts (plan, code-review)
 * Eligible = (backlog/unstarted/started state) AND no pre-work labels
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

  // Check if issue has any pre-work labels
  const issueLabels = (issue.labels?.nodes || []).map(l => l.name.toLowerCase())
  const preWorkLabels = getPreWorkLabels()

  return !preWorkLabels.some(label => issueLabels.includes(label.toLowerCase()))
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
