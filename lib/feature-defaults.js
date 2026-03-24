/**
 * Feature Toggle Defaults and Helpers
 *
 * Defines the available feature toggles, their default values,
 * and helpers for reading/merging feature flags from user preferences.
 *
 * All features are universal (per-user, not per-workspace).
 * Stored in UserPreferencesStore under preferences.features.
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
  ROADMAP: 'roadmap'
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
  [FEATURES.ROADMAP]: false
};

/**
 * Human-readable labels for each feature toggle.
 * Used in the settings UI.
 */
export const FEATURE_LABELS = {
  [FEATURES.LINEAR_MCP]: 'Linear references in prompts',
  [FEATURES.FEATURE_BRANCHES]: 'Feature branch workflow',
  [FEATURES.DISPATCH]: 'Dispatch queue',
  [FEATURES.AI_RECOMMENDATIONS]: 'AI recommendations',
  [FEATURES.PROMPT_BUTTONS]: 'Prompt buttons',
  [FEATURES.CODE_REVIEW]: 'Code review before completing',
  [FEATURES.CODE_REVIEW_SELF]: 'Self-review',
  [FEATURES.CODE_REVIEW_CICD]: 'CI/CD check',
  [FEATURES.CODE_REVIEW_PR]: 'PR review',
  [FEATURES.PROXY]: 'Linear API proxy',
  [FEATURES.ROADMAP]: 'Narrative roadmap'
};

/**
 * Short descriptions for each feature toggle.
 * Shown inline next to the toggle in settings UI.
 */
export const FEATURE_DESCRIPTIONS = {
  [FEATURES.LINEAR_MCP]: 'Include "in Linear" hints in workflow steps',
  [FEATURES.FEATURE_BRANCHES]: 'Git feature branch per task',
  [FEATURES.DISPATCH]: 'Queue prompts for external consumers',
  [FEATURES.AI_RECOMMENDATIONS]: 'AI-generated prompt recommendations',
  [FEATURES.PROMPT_BUTTONS]: 'Show prompt buttons on issues',
  [FEATURES.CODE_REVIEW]: 'Add review steps to implementation prompts',
  [FEATURES.CODE_REVIEW_SELF]: 'Review own changes before committing',
  [FEATURES.CODE_REVIEW_CICD]: 'Check CI/CD pipeline after pushing',
  [FEATURES.CODE_REVIEW_PR]: 'Check PR feedback before completing',
  [FEATURES.PROXY]: 'Let AI agents interact with Linear via proxy tokens',
  [FEATURES.ROADMAP]: 'Projected timeline and AI narrative from task data'
};

/**
 * Optional notes shown next to toggles in settings UI.
 */
export const FEATURE_NOTES = {
  [FEATURES.LINEAR_MCP]: 'Recommended for task tracking'
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
