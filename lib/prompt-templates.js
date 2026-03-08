/**
 * Prompt Templates for Label-Based AI Workflows
 *
 * Main entry point — re-exports template definitions and provides
 * query/utility functions for looking up templates by label, category, etc.
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

import { PREPARING_LABEL } from './workflow-config.js';
import { PROMPT_CATEGORIES, formatGitWorkflow, formatSelfReview, formatCicdCheck, formatPrReview } from './prompt-formatters.js';
import { PROMPT_TEMPLATES } from './prompt-template-defs.js';

/**
 * Templates that involve committing/pushing code and should receive
 * code review instructions when the codeReview toggle is enabled.
 */
const IMPLEMENTATION_TEMPLATES = new Set(['implementation']);

// Re-export constants and templates
export { PROMPT_CATEGORIES } from './prompt-formatters.js';
export { PROMPT_TEMPLATES } from './prompt-template-defs.js';

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
 * @typedef {Object} FeatureFlags
 * @property {boolean} [linearMcp=true] - Include Linear references in workflow steps
 * @property {boolean} [featureBranches=false] - Include git workflow instructions
 */

/**
 * Generate a prompt for a label
 * @param {string} labelName - The label name
 * @param {Object} issue - The issue object (must include identifier, title, description, url, labels)
 * @param {PromptContext} context - Context with parent, siblings, project, children
 * @param {FeatureFlags} [featureFlags] - Feature toggle flags
 * @returns {{name: string, prompt: string}|null} Generated prompt or null if no template
 */
export function generatePrompt(labelName, issue, context, featureFlags = {}) {
  const template = PROMPT_TEMPLATES[labelName]
  if (!template) return null

  let prompt = template.generate(issue, context, featureFlags)

  // Strip Linear references from workflow steps when disabled
  if (featureFlags.linearMcp === false) {
    prompt = prompt
      .replace(/ in Linear/g, '')
  }

  // Append git workflow when feature branches toggle is on
  if (featureFlags.featureBranches === true && template.category === PROMPT_CATEGORIES.READY) {
    prompt += formatGitWorkflow(issue)
  }

  // Append code review instructions when toggle is on (implementation templates only).
  // Note: sub-toggle values may exist in session even when parent is off — this gate
  // ensures they only take effect when the parent codeReview toggle is enabled.
  if (featureFlags.codeReview === true && IMPLEMENTATION_TEMPLATES.has(labelName)) {
    if (featureFlags.codeReviewSelf !== false) {
      prompt += formatSelfReview()
    }
    if (featureFlags.codeReviewCicd === true) {
      prompt += formatCicdCheck()
    }
    if (featureFlags.codeReviewPr === true) {
      prompt += formatPrReview()
    }
  }

  return {
    name: template.name,
    prompt
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
