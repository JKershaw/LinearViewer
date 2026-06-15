/**
 * Feature Toggle Defaults and Helpers
 *
 * Defines the available feature toggles, their default values,
 * and helpers for reading/merging feature flags from user preferences.
 *
 * Dual feature contract:
 * - Per-user features (the `FEATURES` set below) are universal per-user, not
 *   per-workspace. They flow through `session.features` / `getFeatureFlags(session)`
 *   and are stored in UserPreferencesStore under preferences.features.
 * - Workspace features (the `WORKSPACE_FEATURES` set below) are a separate,
 *   workspace-scoped path. They are read via `isWorkspaceFeatureEnabled(...)`,
 *   backed by WorkspacePreferencesStore (preferences.features), and must NOT
 *   piggyback on `session.features`, `getFeatureFlags(session)`, or the per-user
 *   `FEATURES` set. The two paths are intentionally isolated.
 */

/**
 * Feature toggle keys — use these constants instead of raw strings
 * to avoid typos and enable refactoring.
 */
export const FEATURES = {
  LINEAR_MCP: 'linearMcp',
  FEATURE_BRANCHES: 'featureBranches',
  DISPATCH: 'dispatch',
  AI_RECOMMENDATIONS: 'aiRecommendations',
  PROMPT_BUTTONS: 'promptButtons',
  CODE_REVIEW: 'codeReview',
  CODE_REVIEW_SELF: 'codeReviewSelf',
  CODE_REVIEW_CICD: 'codeReviewCicd',
  CODE_REVIEW_PR: 'codeReviewPr',
  PROXY: 'proxy',
  ROADMAP: 'roadmap',
  PIPELINE: 'pipeline',
  COLLECTIVE: 'collective',
  TASK_CHAT: 'taskChat',
  SHIP: 'ship'
};

/**
 * Default values for all feature toggles.
 * These apply when a user has no saved preferences.
 */
export const FEATURE_DEFAULTS = {
  [FEATURES.LINEAR_MCP]: true,
  [FEATURES.FEATURE_BRANCHES]: false,
  [FEATURES.DISPATCH]: false,
  [FEATURES.AI_RECOMMENDATIONS]: true,
  [FEATURES.PROMPT_BUTTONS]: true,
  [FEATURES.CODE_REVIEW]: false,
  [FEATURES.CODE_REVIEW_SELF]: true,
  [FEATURES.CODE_REVIEW_CICD]: false,
  [FEATURES.CODE_REVIEW_PR]: false,
  [FEATURES.PROXY]: false,
  [FEATURES.ROADMAP]: false,
  [FEATURES.PIPELINE]: false,
  [FEATURES.COLLECTIVE]: false,
  [FEATURES.TASK_CHAT]: false,
  [FEATURES.SHIP]: false
};

/**
 * Human-readable labels for each feature toggle.
 * Used in the settings UI.
 */
export const FEATURE_LABELS = {
  [FEATURES.LINEAR_MCP]: 'Use Linear MCP',
  [FEATURES.FEATURE_BRANCHES]: 'Feature branch workflow',
  [FEATURES.DISPATCH]: 'Dispatch queue',
  [FEATURES.AI_RECOMMENDATIONS]: 'AI recommendations',
  [FEATURES.PROMPT_BUTTONS]: 'Prompt buttons',
  [FEATURES.CODE_REVIEW]: 'Code review before completing',
  [FEATURES.CODE_REVIEW_SELF]: 'Self-review',
  [FEATURES.CODE_REVIEW_CICD]: 'CI/CD check',
  [FEATURES.CODE_REVIEW_PR]: 'PR review',
  [FEATURES.PROXY]: 'Linear API proxy',
  [FEATURES.ROADMAP]: 'Narrative roadmap',
  [FEATURES.PIPELINE]: 'Pipeline floor view',
  [FEATURES.COLLECTIVE]: 'Collective (experimental)',
  [FEATURES.TASK_CHAT]: 'Task chat (experimental)',
  [FEATURES.SHIP]: 'Ship (experimental)'
};

/**
 * Short descriptions for each feature toggle.
 * Shown inline next to the toggle in settings UI.
 */
export const FEATURE_DESCRIPTIONS = {
  [FEATURES.LINEAR_MCP]: 'Agent prompts reference Linear by ID; foreman routes writes (comments, status, subtasks) through MCP instead of the proxy',
  [FEATURES.FEATURE_BRANCHES]: 'Git feature branch per task',
  [FEATURES.DISPATCH]: 'Queue prompts for external consumers',
  [FEATURES.AI_RECOMMENDATIONS]: 'AI-generated prompt recommendations',
  [FEATURES.PROMPT_BUTTONS]: 'Show prompt buttons on issues',
  [FEATURES.CODE_REVIEW]: 'Add review steps to implementation prompts',
  [FEATURES.CODE_REVIEW_SELF]: 'Review own changes before committing',
  [FEATURES.CODE_REVIEW_CICD]: 'Check CI/CD pipeline after pushing',
  [FEATURES.CODE_REVIEW_PR]: 'Check PR feedback before completing',
  [FEATURES.PROXY]: 'Let AI agents interact with Linear via proxy tokens',
  [FEATURES.ROADMAP]: 'Projected timeline and AI narrative from task data',
  [FEATURES.PIPELINE]: 'Control-panel view of active tasks, dispatch loops, and agent state',
  [FEATURES.COLLECTIVE]: 'Experimental: dispatch agents from several workspaces into one Yap discussion you watch and steer',
  [FEATURES.TASK_CHAT]: 'Experimental: open a task and have a grounded, multi-turn conversation with it',
  [FEATURES.SHIP]: 'Experimental: a radial dependency view — in-progress work at the centre, everything else orbiting by priority and sector'
};

/**
 * Optional notes shown next to toggles in settings UI.
 */
export const FEATURE_NOTES = {
  [FEATURES.LINEAR_MCP]: 'Recommended — requires Linear MCP in your agent'
};

/**
 * All valid feature keys.
 */
export const FEATURE_KEYS = Object.values(FEATURES);

/**
 * Check if a feature key is valid.
 * @param {string} key - Feature key to validate
 * @returns {boolean}
 */
export function isValidFeatureKey(key) {
  return FEATURE_KEYS.includes(key);
}

/**
 * Get merged feature flags from session.
 * Returns defaults merged with any user overrides stored in session.
 *
 * @param {Object} session - Express session object
 * @returns {Object} Feature flags with all keys guaranteed present
 */
export function getFeatureFlags(session) {
  const userFeatures = session?.features || {};
  return {
    ...FEATURE_DEFAULTS,
    ...Object.fromEntries(
      Object.entries(userFeatures).filter(([key]) => isValidFeatureKey(key))
    )
  };
}

// =============================================================================
// Workspace features (per-workspace, separate from the per-user FEATURES above)
//
// These live on the WorkspacePreferencesStore path (preferences.features) and
// are read via isWorkspaceFeatureEnabled(...) in lib/workspace-preferences.js.
// They deliberately do NOT share storage, defaults, or accessors with the
// per-user FEATURES set — keep the two contracts isolated.
// =============================================================================

/**
 * Workspace feature toggle keys — use these constants instead of raw strings.
 */
export const WORKSPACE_FEATURES = {
  PERIODICALS: 'periodicals'
};

/**
 * Default values for workspace feature toggles.
 * Applied when a workspace has no saved override. Gated, not-yet-launched
 * features default off.
 */
export const WORKSPACE_FEATURE_DEFAULTS = {
  [WORKSPACE_FEATURES.PERIODICALS]: false
};

/**
 * Human-readable labels for workspace feature toggles (settings UI).
 */
export const WORKSPACE_FEATURE_LABELS = {
  [WORKSPACE_FEATURES.PERIODICALS]: 'Periodicals'
};

/**
 * Short descriptions for workspace feature toggles (settings UI).
 */
export const WORKSPACE_FEATURE_DESCRIPTIONS = {
  [WORKSPACE_FEATURES.PERIODICALS]: 'Scheduled documentation-review periodicals (workspace-scoped, applies to every user of this workspace)'
};

/**
 * All valid workspace feature keys.
 */
export const WORKSPACE_FEATURE_KEYS = Object.values(WORKSPACE_FEATURES);

/**
 * Check if a workspace feature key is valid.
 * @param {string} key - Workspace feature key to validate
 * @returns {boolean}
 */
export function isValidWorkspaceFeatureKey(key) {
  return WORKSPACE_FEATURE_KEYS.includes(key);
}
