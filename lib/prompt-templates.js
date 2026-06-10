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
 * Workflow labels (2):
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 */

import { PROMPT_CATEGORIES, formatGitWorkflow, formatSelfReview, formatCicdCheck, formatPrReview, formatChildren, formatComments, formatStalenessCheck, formatTerminalStateNote, formatChildrenCompleteNote, resolvePromptUi, applyPromptCapabilities } from './prompt-formatters.js';
import { PROMPT_TEMPLATES } from './prompt-template-defs.js';
import { isTerminalState } from './tree.js';

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
 * Generate a prompt from a custom template with variable substitution.
 * Applies the same feature flag transforms as built-in prompts.
 *
 * @param {Object} customPrompt - Custom prompt object { id, name, template }
 * @param {Object} issue - The issue object
 * @param {PromptContext} context - Context with parent, siblings, project, children, comments
 * @param {FeatureFlags} [featureFlags] - Feature toggle flags
 * @param {Object} [providerUi] - Active provider's UI capability surface (provider.ui); LIN-177 S4
 * @returns {{name: string, prompt: string}} Generated prompt
 */
export function generateCustomPrompt(customPrompt, issue, context, featureFlags = {}, providerUi = null) {
  const labels = Array.isArray(issue.labels)
    ? issue.labels
    : (issue.labels?.nodes || []).map(l => l.name);

  const childrenText = context.children?.length
    ? formatChildren(context.children)
    : 'None';

  const commentsText = context.comments?.length
    ? formatComments(context.comments)
    : 'None';

  // Variable substitution
  let prompt = customPrompt.template
    .replace(/\{\{title\}\}/g, issue.title || '')
    .replace(/\{\{identifier\}\}/g, issue.identifier || '')
    .replace(/\{\{description\}\}/g, issue.description || '')
    .replace(/\{\{status\}\}/g, issue.state?.name || '')
    .replace(/\{\{labels\}\}/g, labels.join(', '))
    .replace(/\{\{project\}\}/g, context.project?.name || '')
    .replace(/\{\{children\}\}/g, childrenText)
    .replace(/\{\{comments\}\}/g, commentsText);

  // Apply provider capability + feature flag transforms (same as built-in prompts).
  // For Linear with the flag on this is a no-op; it renames the tracker for a
  // non-Linear provider and strips tracker references when write/flag are off.
  prompt = applyPromptCapabilities(prompt, resolvePromptUi(featureFlags, providerUi));

  return {
    name: customPrompt.name,
    prompt
  };
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

// ─── Dispatch kind classification ────────────────────────────────────────────
//
// A dispatched item's `kind` is a stable, machine-readable classification drawn
// from the SAME vocabulary the Pipeline view uses for `stage` (see
// `_deriveStage` in lib/pipeline-loops.js): the PROMPT_TEMPLATES keys. A watcher
// (e.g. the Autopilot orchestrator) reads `kind` directly instead of inferring
// the task type from `promptName` or the prompt body.
//
// `promptName` is a free-form *display* name ("implement", "code review",
// "Custom"); `kind` normalises it back to the stable template key
// ("implementation", "code-review"), or the neutral default for prompts that
// don't map to a template (custom/freeform text).

/** Neutral fallback kind for prompts that don't map to a known template. */
export const DISPATCH_KIND_DEFAULT = 'custom'

// Meta-loop kinds that aren't single prompt-templates. `autopilot` is an
// orchestrator run (the kickoff prompt that drives the dispatch loop itself),
// distinct from the step-kinds (plan / implementation / review). It's set
// explicitly at dispatch — never derived from a promptName — so watchers and
// history can tell a loop-driver apart from a single worker step.
export const DISPATCH_META_KINDS = ['autopilot']

// Recommend-meta actions (LIN-327). `defer` is a routing decision the recommender
// can emit on a node-shaped task ("the real work lives at child X") — a third
// bucket distinct from both PROMPT_TEMPLATES actions and DISPATCH_META_KINDS:
//  - unlike a PROMPT_TEMPLATES action, it has NO `generate()` body. A deferring
//    recommendation emits only `{ recommendedAction: 'defer', deferTo, reasoning }`
//    and no prompt — the no-body cost contract is enforced structurally by the
//    absence of a template here (and so it can't bloat the "exactly N templates" lock).
//  - unlike `autopilot`, it IS emitted by the AI recommender (so it appears in the
//    meta-prompt's action vocabulary) and IS derivable (deriveDispatchKind('defer')
//    must resolve to 'defer', not the 'custom' fallback), so the kind plumbing stays
//    honest across the both-paths boundary.
// `defer` is always resolved server-side by the recommend recursion (LIN-329) before
// any dispatch, so it never reaches the dispatch queue as a worker step-kind.
export const RECOMMEND_META_ACTIONS = ['defer']

// Periodical kind (LIN-341). Recurring, workspace-scoped maintenance tasks
// (e.g. Documentation Review) dispatched from the synthetic Periodicals group.
// Like `autopilot`, it is set EXPLICITLY at dispatch (baked into the row's
// data-kind) and never derived from a promptName — so it stays out of the alias
// map below. Unlike the PROMPT_TEMPLATES step-kinds it has no template body and
// carries no Linear issue fields (the periodical self-creates its own task).
export const DISPATCH_PERIODICAL_KINDS = ['periodical']

/** The bounded vocabulary of valid dispatch `kind` values. */
export const DISPATCH_KINDS = [...Object.keys(PROMPT_TEMPLATES), ...DISPATCH_META_KINDS, ...RECOMMEND_META_ACTIONS, ...DISPATCH_PERIODICAL_KINDS, DISPATCH_KIND_DEFAULT]

// Lowercased lookup from both template keys and display names → canonical key.
const _DISPATCH_KIND_BY_ALIAS = (() => {
  const map = new Map()
  for (const [key, template] of Object.entries(PROMPT_TEMPLATES)) {
    map.set(key.toLowerCase(), key)
    if (template.name) map.set(template.name.toLowerCase(), key)
  }
  // Recommend-meta actions have no template to seed from, so register them
  // explicitly (identity) — deriveDispatchKind('defer') === 'defer', not 'custom'.
  for (const action of RECOMMEND_META_ACTIONS) {
    map.set(action.toLowerCase(), action)
  }
  return map
})()

/**
 * Check whether a value is a valid dispatch kind.
 * @param {*} kind - Candidate kind value
 * @returns {boolean} True if `kind` is one of DISPATCH_KINDS
 */
export function isValidDispatchKind(kind) {
  return typeof kind === 'string' && DISPATCH_KINDS.includes(kind)
}

/**
 * Derive a dispatch `kind` from a prompt's display name by matching it against
 * the prompt-template classification (template key or display name, case-
 * insensitive). Falls back to DISPATCH_KIND_DEFAULT for custom/freeform prompts.
 * @param {string|null|undefined} promptName - The prompt's display name
 * @returns {string} A value from DISPATCH_KINDS
 */
export function deriveDispatchKind(promptName) {
  if (typeof promptName !== 'string') return DISPATCH_KIND_DEFAULT
  return _DISPATCH_KIND_BY_ALIAS.get(promptName.trim().toLowerCase()) || DISPATCH_KIND_DEFAULT
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
 * @param {Object} [providerUi] - Active provider's UI capability surface (provider.ui); LIN-177 S4
 * @returns {{name: string, prompt: string}|null} Generated prompt or null if no template
 */
export function generatePrompt(labelName, issue, context, featureFlags = {}, providerUi = null) {
  const template = PROMPT_TEMPLATES[labelName]
  if (!template) return null

  let prompt = template.generate(issue, context, featureFlags)

  // Re-grounding directive: instruct the executing agent to re-verify the ticket
  // against current source before trusting it. Mirrored in the AI meta-prompt
  // path (lib/prompts/meta-prompt-template.js) per CLAUDE.md's both-paths rule.
  prompt += formatStalenessCheck(issue)

  // Terminal-state note: if the task is already Done/Canceled/Duplicate with no open
  // children, tell the agent to verify/close rather than redo it (LIN-353). Mirrored
  // in the AI meta-prompt path (Step 0) per CLAUDE.md's both-paths rule.
  prompt += formatTerminalStateNote(issue, context)

  // All-subtasks-complete note: an OPEN parent whose every child is terminal has no
  // open child to descend into — steer to review/close the parent rather than dead-end
  // on a rejected defer (LIN-364). Mirrored in the AI meta-prompt path (Step 0) per
  // CLAUDE.md's both-paths rule. Mutually exclusive with formatTerminalStateNote (that
  // fires only when the issue's own state is terminal; this only when it is not).
  prompt += formatChildrenCompleteNote(issue, context)

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

  // Capability-aware post-process (LIN-177 S4), applied LAST so it also covers the
  // appended git/code-review sections. Provider capability is the hard floor and
  // the linearMcp user flag the soft preference; for Linear with the flag on this
  // is a no-op (Linear output stays byte-identical). Supersedes the old
  // `linearMcp === false` " in Linear" strip, which it now subsumes.
  prompt = applyPromptCapabilities(prompt, resolvePromptUi(featureFlags, providerUi))

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
 * Check if an issue is eligible for ready prompts (plan, code-review)
 * Eligible = backlog/unstarted/started state
 * This covers Ready queue tasks AND in-progress tasks
 * @param {Object} issue - The issue object with state
 * @returns {boolean} True if the issue is eligible for ready prompts
 */
export function isEligibleForPlan(issue) {
  const stateType = issue.state?.type?.toLowerCase() || ''
  const eligibleStates = ['backlog', 'unstarted', 'started']

  return eligibleStates.includes(stateType)
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

  // Add state-based prompts (plan and code-review).
  // Available for ready-queue states AND terminal states (LIN-353): terminal state
  // (Done/Canceled/Duplicate) is a SIGNAL that shapes the recommendation (see
  // formatTerminalStateNote / the meta-prompt Step 0), never a gate that strips the
  // option — "all prompts available for all tickets, influenced by state, not limited
  // by it." (`review` is already universal; this lifts the code-review/plan limit.)
  if (isEligibleForPlan(issue) || isTerminalState(issue.state?.type)) {
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
 * Prompt types intentionally kept out of the AI recommendation path.
 *
 * `retro` is a deliberate, manual action — teams usually let a completed
 * task settle before running a retrospective, so auto-recommending it the
 * moment a task is marked Done would trigger retros far too eagerly. It
 * stays available in the prompts catalog and dispatch (user-initiated) but
 * is not surfaced to the meta-prompt's Action Types Reference.
 */
const EXCLUDED_FROM_AI_RECOMMENDATION = new Set(['retro'])

/**
 * The bounded set of action names the AI recommender may emit (the `→ **name**`
 * signal). These are exactly the template display names that are surfaced to the
 * meta-prompt's Action Types Reference — i.e. `aiHint` present and not excluded
 * from recommendation. Enumerating them in the meta-prompt keeps the emitted
 * action inside the vocabulary `deriveDispatchKind()` understands, so the fused
 * recommend-and-dispatch verb lands a real `kind` (not the `custom` fallback)
 * for every known action type, not just the few that used to appear as examples.
 *
 * Recommend-meta actions (`defer`, LIN-327) are appended too: they have no
 * PROMPT_TEMPLATES entry but are valid actions the recommender may emit, and
 * deriveDispatchKind() resolves them, so they belong in the meta-prompt vocabulary.
 *
 * @returns {string[]} Display names (e.g. "plan", "implement", "code review", "defer")
 */
export function getAIRecommendationActionNames() {
  const names = []
  for (const [key, template] of Object.entries(PROMPT_TEMPLATES)) {
    if (!template.aiHint) continue
    if (EXCLUDED_FROM_AI_RECOMMENDATION.has(key)) continue
    names.push(template.name)
  }
  names.push(...RECOMMEND_META_ACTIONS)
  return names
}

/**
 * Format all template aiHints as examples for the AI meta-prompt
 * @returns {string} Formatted examples section for the meta-prompt
 */
export function formatAIHintsForMetaPrompt() {
  const lines = []

  for (const [key, template] of Object.entries(PROMPT_TEMPLATES)) {
    if (!template.aiHint) continue
    if (EXCLUDED_FROM_AI_RECOMMENDATION.has(key)) continue

    const { situation, goal, workflow } = template.aiHint
    lines.push(`**${template.name}** (${situation}):`)
    lines.push(`Goal: "${goal}"`)
    lines.push(`Workflow: ${workflow}`)
    lines.push('')
  }

  return lines.join('\n').trim()
}
