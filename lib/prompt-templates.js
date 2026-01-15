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
    generate: (issue, context) => {
      const sections = [
        `Help me break down task ${issue.identifier}`,
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
        'Break this task into subtasks (1-3 hour chunks each), ordered by dependencies.',
        context.children?.length > 0 ? 'Review existing subtasks and avoid duplicating them.' : ''
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'needs-research': {
    name: 'Research Task',
    category: PROMPT_CATEGORIES.PRE_WORK,
    generate: (issue, context) => {
      const sections = [
        `Help me research task ${issue.identifier}`,
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
        'Identify key questions, research systematically, and provide actionable recommendations.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'needs-scoping': {
    name: 'Scope Definition',
    category: PROMPT_CATEGORIES.PRE_WORK,
    generate: (issue, context) => {
      const sections = [
        `Help me define the scope of ${issue.identifier}`,
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
        'Define clear boundaries (in scope vs out of scope), assumptions, success criteria, and open questions.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'needs-design': {
    name: 'Technical Design',
    category: PROMPT_CATEGORIES.PRE_WORK,
    generate: (issue, context) => {
      const sections = [
        `Help me create a technical design for ${issue.identifier}`,
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
        'Evaluate 2-3 design approaches with tradeoffs, recommend one, and outline implementation considerations.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'needs-spike': {
    name: 'Technical Spike',
    category: PROMPT_CATEGORIES.PRE_WORK,
    generate: (issue, context) => {
      const sections = [
        `Help me plan a technical spike for ${issue.identifier}`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Labels', formatLabels(issue.labels, ['needs-spike'])),
        issue.estimate ? `**Suggested Timebox:** ${issue.estimate} points worth of effort` : '',
        '',
        '## Goal',
        '',
        'Define 3-5 specific questions to answer, a focused exploration approach, and clear success criteria.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'blocked': {
    name: 'Blocker Analysis',
    category: PROMPT_CATEGORIES.WORK_ISSUE,
    generate: (issue, context) => {
      const sections = [
        `Help me analyze and resolve the blocker on ${issue.identifier}`,
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
        'Identify the blocker type and root cause, evaluate options to unblock, and recommend the best path forward.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'needs-context': {
    name: 'Context Summary',
    category: PROMPT_CATEGORIES.PRE_WORK,
    generate: (issue, context) => {
      const sections = [
        `Provide a context summary for ${issue.identifier}`,
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
        'Synthesize current state, what\'s done, what remains, key decisions, and recommended next steps.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'bug': {
    name: 'Bug Investigation',
    category: PROMPT_CATEGORIES.WORK_ISSUE,
    generate: (issue, context) => {
      const sections = [
        `Help me investigate bug ${issue.identifier}`,
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
        'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'plan': {
    name: 'Implementation Plan',
    category: PROMPT_CATEGORIES.READY,
    generate: (issue, context) => {
      const sections = [
        `Help me create an implementation plan for ${issue.identifier}`,
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
        'Research the codebase, identify files to modify, and create a step-by-step implementation plan with test coverage.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'code-review': {
    name: 'Code Review',
    category: PROMPT_CATEGORIES.READY,
    generate: (issue, context) => {
      const sections = [
        `Help me review the code changes for ${issue.identifier}`,
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
        'Review code changes for correctness, tests, style, security, and performance. Provide a verdict: Approve / Request Changes / Needs Discussion.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'look-into': {
    name: 'Look Into',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    generate: (issue, context) => {
      const sections = [
        `Look into ${issue.identifier}`,
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
        'Summarise this project. Then look into this task and the related tasks (parent, siblings), and provide a summary of what this task involves and how it fits into the broader context.'
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
