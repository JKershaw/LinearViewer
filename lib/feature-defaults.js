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
  PROMPT_BUTTONS: 'promptButtons'
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
  [FEATURES.PROMPT_BUTTONS]: true
};

/**
 * Human-readable labels for each feature toggle.
 * Used in the settings UI.
 */
export const FEATURE_LABELS = {
  [FEATURES.LINEAR_MCP]: 'Linear MCP in prompts',
  [FEATURES.FEATURE_BRANCHES]: 'Feature branch workflow',
  [FEATURES.DISPATCH]: 'Dispatch queue',
  [FEATURES.AI_RECOMMENDATIONS]: 'AI recommendations',
  [FEATURES.PROMPT_BUTTONS]: 'Prompt buttons'
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
