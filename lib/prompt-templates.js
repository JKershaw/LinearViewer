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

import { PROMPT_CATEGORIES, formatSelfReview, formatCicdCheck, formatPrReview, formatChildren, formatComments, appendGroundingSections, formatAttachmentsSection, resolvePromptUi, applyPromptCapabilities } from './prompt-formatters.js';
import { PROMPT_TEMPLATES, STAGE_LEADS } from './prompt-template-defs.js';
import { formatStageContract } from './prompt-contract.js';
import { withStageIntent } from './prompts/stage-intent.js';
import { isTerminalState } from './tree.js';

/**
 * Templates that involve committing/pushing code and should receive
 * code review instructions when the codeReview toggle is enabled.
 */
const IMPLEMENTATION_TEMPLATES = new Set(['implementation']);

// Re-export constants and templates
export { PROMPT_CATEGORIES } from './prompt-formatters.js';
export { PROMPT_TEMPLATES, STAGE_LEADS } from './prompt-template-defs.js';

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
// ("implementation", "review"), or the neutral default for prompts that
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
//    router prompt's action vocabulary) and IS derivable (deriveDispatchKind('defer')
//    must resolve to 'defer', not the 'custom' fallback), so the kind plumbing stays
//    honest between the router and dispatch.
// `defer` is always resolved server-side by the recommend recursion (LIN-329) before
// any dispatch, so it never reaches the dispatch queue as a worker step-kind. Its
// self-description (LIN-3300) is the body-less entry the stage selector lists.
export const RECOMMEND_META_ROUTES = {
  defer: {
    purpose: 'Descend into a subtask: the next real work lives in a child, not in this task.',
    when: 'The task has an open, actionable subtask and its subtasks cover its remaining scope.',
    whenNot: 'A leaf; every subtask done (close the parent); or the task needs its own work first (`plan-review` when its own plan is due one, `breakdown` for scope no subtask covers, `triage` if mis-filed).',
    requires: 'The child, on the DeferTo line.'
  }
}
export const RECOMMEND_META_ACTIONS = Object.keys(RECOMMEND_META_ROUTES)

// Periodical kind (LIN-341). Recurring, workspace-scoped maintenance tasks
// (e.g. Documentation Review) dispatched from the synthetic Periodicals group.
// Like `autopilot`, it is set EXPLICITLY at dispatch (baked into the row's
// data-kind) and never derived from a promptName — so it stays out of the alias
// map below. Unlike the PROMPT_TEMPLATES step-kinds it has no template body and
// carries no Linear issue fields (the periodical self-creates its own task).
export const DISPATCH_PERIODICAL_KINDS = ['periodical']

/** The bounded vocabulary of valid dispatch `kind` values. */
export const DISPATCH_KINDS = [...Object.keys(PROMPT_TEMPLATES), ...DISPATCH_META_KINDS, ...RECOMMEND_META_ACTIONS, ...DISPATCH_PERIODICAL_KINDS, DISPATCH_KIND_DEFAULT]

// The dispatch kinds a workspace can pin a per-type model/harness default for
// (LIN-1278): the PROMPT_TEMPLATES step-kinds PLUS the meta-loop kinds users
// actually dispatch (`autopilot`, a first-class dispatch concept set explicitly
// at dispatch — routes/workspace-api.js, routes/proxy.js). Deliberately NOT
// `defer` (resolved server-side, never reaches the queue), `periodical`
// (self-creating recurring task, no fixed default surface), or the `custom`
// fallback — none is a stable, user-dispatchable "type" to set a default for.
// This is the ONE source of truth the three dispatch-defaults surfaces agree on:
// the settings override rows (render-settings.js renderDispatchDefaultsSection),
// the save handler (server.js POST /settings/dispatch-defaults), and the read
// seam (resolveDispatchDefaults in workspace-preferences.js). Templates first,
// meta-kinds last, so the settings override list reads step-kinds then autopilot.
export const DISPATCH_DEFAULT_KINDS = [...Object.keys(PROMPT_TEMPLATES), ...DISPATCH_META_KINDS]

// Lookup from both template keys and display names → canonical key.
const _kindAlias = (s) => s.trim().toLowerCase().replace(/[\s_-]+/g, '-')
const _DISPATCH_KIND_BY_ALIAS = (() => {
  const map = new Map()
  for (const [key, template] of Object.entries(PROMPT_TEMPLATES)) {
    map.set(_kindAlias(key), key)
    if (template.name) map.set(_kindAlias(template.name), key)
  }
  // Recommend-meta actions have no template to seed from, so register them
  // explicitly (identity) — deriveDispatchKind('defer') === 'defer', not 'custom'.
  for (const action of RECOMMEND_META_ACTIONS) {
    map.set(_kindAlias(action), action)
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
 * and separator-insensitive: "close out" is close-out). Falls back to
 * DISPATCH_KIND_DEFAULT for custom/freeform prompts.
 * @param {string|null|undefined} promptName - The prompt's display name
 * @returns {string} A value from DISPATCH_KINDS
 */
export function deriveDispatchKind(promptName) {
  if (typeof promptName !== 'string') return DISPATCH_KIND_DEFAULT
  return _DISPATCH_KIND_BY_ALIAS.get(_kindAlias(promptName)) || DISPATCH_KIND_DEFAULT
}

/**
 * @typedef {Object} FeatureFlags
 * @property {boolean} [linearMcp=true] - Include Linear references in workflow steps
 */

/**
 * Generate a prompt for a label: the stage's body, finished by finishStagePrompt.
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
  const body = template.generate(issue, context, featureFlags)
  return { name: template.name, prompt: finishStagePrompt(body, labelName, issue, context, featureFlags, providerUi) }
}

/**
 * Everything code adds after a stage's body (LIN-3292). Synchronous and network-free.
 *
 * 0. Scope and Authority (LIN-3299), after the Goal's lead (withStageIntent).
 * 1. The stage contract (lib/prompt-contract.js): the formats later steps parse.
 * 2. Grounding (LIN-353/364/366, chosen per stage, LIN-3296), one source (LIN-435).
 * 3. Attachments (LIN-772): the same seam the router folds into its context block;
 *    '' when there are none.
 * 4. Code-review sections, implementation only, when the codeReview toggle is on (the
 *    sub-toggles take effect only under it).
 * 5. Capabilities (LIN-177 S4), LAST so it covers all of the above: provider capability
 *    is the floor and linearMcp the preference; a no-op for Linear.
 *
 * @param {string} body - The stage body
 * @param {string} kind - PROMPT_TEMPLATES key
 * @returns {string} The finished prompt
 */
export function finishStagePrompt(body, kind, issue, context, featureFlags = {}, providerUi = null) {
  const caps = resolvePromptUi(featureFlags, providerUi)
  let prompt = withStageIntent(body, kind) + formatStageContract(kind, issue.identifier, caps)
  prompt = appendGroundingSections(prompt, issue, context, kind)
  prompt += formatAttachmentsSection(context)
  if (featureFlags.codeReview === true && IMPLEMENTATION_TEMPLATES.has(kind)) {
    if (featureFlags.codeReviewSelf !== false) prompt += formatSelfReview()
    if (featureFlags.codeReviewCicd === true) prompt += formatCicdCheck()
    if (featureFlags.codeReviewPr === true) prompt += formatPrReview()
  }
  return applyPromptCapabilities(prompt, caps)
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
 * Check if an issue is eligible for ready prompts (plan)
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

  // Add the state-based prompt (plan).
  // Available for ready-queue states AND terminal states (LIN-353): terminal state
  // (Done/Canceled/Duplicate) is a SIGNAL that shapes the recommendation (see
  // formatTerminalStateNote / the meta-prompt Step 0), never a gate that strips the
  // option — "all prompts available for all tickets, influenced by state, not limited
  // by it." (`review` is already universal, so it needs no lift here. The old
  // `code-review` template was consolidated into `review` in LIN-523.)
  if (isEligibleForPlan(issue) || isTerminalState(issue.state?.type)) {
    if (!available.includes('plan')) {
      available.push('plan')
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
 * `retro` is a deliberate, manual action — teams let a completed
 * task settle before running a retrospective, so auto-recommending it the
 * moment a task is marked Done would trigger retros too eagerly. It
 * stays available in the prompts catalog and dispatch (user-initiated) but
 * is not offered to the stage selector.
 */
export const EXCLUDED_FROM_AI_RECOMMENDATION = new Set(['retro'])

/**
 * The stages the selector may choose (LIN-3300), each as it describes itself: its
 * purpose (the first sentence of its STAGE_LEADS entry), when it is the right next
 * step, when not, and what it requires. A template is selectable when its def carries
 * `route` and it is not excluded; `defer` joins from RECOMMEND_META_ROUTES. Nothing
 * else lists the options.
 * @returns {Array<{key: string, name: string, purpose: string, when: string, whenNot: string, requires?: string}>}
 */
export function getSelectableStages() {
  const stages = Object.entries(PROMPT_TEMPLATES)
    .filter(([key, t]) => t.route && !EXCLUDED_FROM_AI_RECOMMENDATION.has(key))
    .map(([key, t]) => ({ key, name: t.name, purpose: STAGE_LEADS[key].split(/(?<=[.?!])\s+/)[0], ...t.route }))
  for (const [key, r] of Object.entries(RECOMMEND_META_ROUTES)) stages.push({ key, name: key, ...r })
  return stages
}

/** The selector's option list, rendered from the stages' own descriptions. */
export function formatStageOptions() {
  return getSelectableStages().map(s => [
    `- \`${s.key}\`: ${s.purpose}`,
    `  When: ${s.when}`,
    `  Not when: ${s.whenNot}`,
    s.requires ? `  Requires: ${s.requires}` : ''
  ].filter(Boolean).join('\n')).join('\n')
}
