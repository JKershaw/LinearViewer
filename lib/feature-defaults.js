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
  ROADMAP: 'roadmap',
  COLLECTIVE: 'collective',
  TASK_CHAT: 'taskChat',
  SHIP: 'ship',
  FLIGHT_COMPANION: 'flightCompanion',
  PASSAGE_PLANNER: 'passagePlanner',
  SHIP_BISCUIT: 'shipBiscuit',
  LIVE_CONSOLE: 'liveConsole',
  SHIP_JOURNEY: 'shipJourney',
  FEEDBACK_WIDGET: 'feedbackWidget'
  // NOTE: the experimental `dashboard` flag was retired in LIN-595 — the
  // autopilot dashboard was promoted to the first-class Observation page
  // (/workspace/:urlKey/observation, no flag). /dashboard now 302s there.
  // NOTE: the `dispatch` and `proxy` switches were removed in LIN-3849. Run
  // controls are derived (lib/run-controls.js: the workspace owner AND a live
  // runner key or queue token); key tools are always on. The +proxy default
  // stays, as `prefs.proxyDefault` (lib/settings-proxy-default.js).
  // NOTE: nine switches were removed in LIN-3848 (`linearMcp`, `aiRecommendations`,
  // `promptButtons`, `codeReview*`, `feedbackTriage`, and the workspace
  // `observerAuthority`) — they did nothing or were superseded. Their behaviour
  // is now permanent; stale stored values are dropped by `getFeatureFlags` /
  // `getWorkspaceFeatures` (unknown keys filtered), never migrated.
  // NOTE: the `featureBranches` toggle was removed in LIN-3296. It only ever
  // reached the plan prompt, which must not branch or open a PR, and
  // implementation carries its own branch and PR steps. A stale stored value
  // is dropped by `getFeatureFlags` (unknown keys are filtered), never
  // rendered in Settings, and rejected by the toggle route.
};

/**
 * Default values for all feature toggles.
 * These apply when a user has no saved preferences.
 */
export const FEATURE_DEFAULTS = {
  [FEATURES.ROADMAP]: false,
  [FEATURES.COLLECTIVE]: false,
  [FEATURES.TASK_CHAT]: false,
  [FEATURES.SHIP]: false,
  [FEATURES.FLIGHT_COMPANION]: false,
  [FEATURES.PASSAGE_PLANNER]: false,
  [FEATURES.SHIP_BISCUIT]: false,
  [FEATURES.LIVE_CONSOLE]: false,
  [FEATURES.SHIP_JOURNEY]: false,
  [FEATURES.FEEDBACK_WIDGET]: false
};

/**
 * Human-readable labels for each feature toggle.
 * Used in the settings UI.
 */
export const FEATURE_LABELS = {
  [FEATURES.ROADMAP]: 'Narrative roadmap',
  [FEATURES.COLLECTIVE]: 'Collective (experimental)',
  [FEATURES.TASK_CHAT]: 'Task chat (experimental)',
  [FEATURES.SHIP]: 'Ship (experimental)',
  [FEATURES.FLIGHT_COMPANION]: 'Flight companion (experimental)',
  [FEATURES.PASSAGE_PLANNER]: 'Passage planner (experimental)',
  [FEATURES.SHIP_BISCUIT]: "The Ship's Biscuit (experimental)",
  // LIN-3977: promoted out of experimental; the flag stays as an opt-out.
  [FEATURES.LIVE_CONSOLE]: 'Live console',
  [FEATURES.SHIP_JOURNEY]: 'Ship journey (experimental)',
  [FEATURES.FEEDBACK_WIDGET]: 'Feedback widget'
};

/**
 * Short descriptions for each feature toggle.
 * Shown inline next to the toggle in settings UI.
 */
export const FEATURE_DESCRIPTIONS = {
  [FEATURES.ROADMAP]: 'Projected timeline and AI narrative from task data',
  [FEATURES.COLLECTIVE]: 'Experimental: dispatch agents from several workspaces into one Yap discussion you watch and steer',
  [FEATURES.TASK_CHAT]: 'Experimental: open a task and have a grounded, multi-turn conversation with it',
  [FEATURES.SHIP]: 'Experimental: a radial dependency view — in-progress work at the centre, everything else orbiting by priority and sector',
  [FEATURES.FLIGHT_COMPANION]: 'Experimental: a live, in-page chat with a companion that watches work in flight and checks in with you on its own — approve or dismiss what it proposes. A copyable kickoff prompt for a full agent session is also on the page, rendering the same shared brief so both behave alike',
  [FEATURES.PASSAGE_PLANNER]: 'Experimental: a one-click kickoff prompt for a live passage-planning session — paste it into a fresh Claude Code session with a readWrite proxy token to orient off the real state of the workspace and negotiate a small ratified plan together',
  [FEATURES.SHIP_BISCUIT]: "Experimental: an LLM-set newspaper of what your autopilot has been up to — run the presses for a front page and an index of headlines over the last day/week/month; the article bodies come later, on demand",
  // LIN-3977: one line in Harbour's voice, what the page shows.
  [FEATURES.LIVE_CONSOLE]: 'Sit back and watch your agents work. Each run shows what it is doing, which ones wait on you, and what happened recently.',
  [FEATURES.SHIP_JOURNEY]: 'Experimental: an animated map of your roadmap journey — play back completed work as waypoints charted against your north star over your retained report history, with a coverage figure and north-star-change markers. Generation-free; a pure read over saved reports.',
  [FEATURES.FEEDBACK_WIDGET]: 'Show a feedback control in the nav bar; submit free-text feedback (with priority and an optional screenshot) as a fresh ticket.'
};

/**
 * Optional notes shown next to toggles in settings UI.
 */
export const FEATURE_NOTES = {};

/**
 * Experimental views, in canonical order (LIN-1247).
 *
 * The single shared source of truth for the TWO surfaces that list experimental
 * views — the Settings discovery links (`lib/render-settings.js`) and the nav
 * "⋯ more" overflow entries (`lib/components/view-nav.js`) — so the two can no
 * longer drift on WHICH features are experimental or WHICH route each maps to.
 * (It is precisely this drift that let the docs under-count the set as "five"
 * while `shipBiscuit` was the silent sixth.)
 *
 * `flag` is the camelCase per-user feature key — the gate. `path` is the
 * kebab-case route segment, which is ALSO the nav link `text` / page
 * `currentPage` key used for active-matching and active-hoist. The two diverge
 * for multi-word features (`taskChat` → `task-chat`), which is exactly why the
 * flag→path mapping must be owned in one place: nav must gate on the camelCase
 * flag but emit the kebab `path` so active matching works when the user is on
 * that page.
 *
 * Each surface keeps its OWN human label local (nav short view label vs
 * Settings' "open the …" action phrase); this table owns only membership +
 * flag→path, not display text.
 */
export const EXPERIMENTAL_VIEWS = [
  { flag: FEATURES.COLLECTIVE, path: 'collective' },
  { flag: FEATURES.TASK_CHAT, path: 'task-chat' },
  { flag: FEATURES.SHIP, path: 'ship' },
  { flag: FEATURES.FLIGHT_COMPANION, path: 'flight-companion' },
  { flag: FEATURES.PASSAGE_PLANNER, path: 'passage-planner' },
  { flag: FEATURES.SHIP_BISCUIT, path: 'ship-biscuit' },
  { flag: FEATURES.SHIP_JOURNEY, path: 'ship-journey' }
];

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
  PERIODICALS: 'periodicals',
  // LIN-3854: lets any readWrite proxy token change the model-routing table (with a
  // reason, logged, undoable). Off by default; set only through the session-authed
  // POST /settings/workspace-features, never over the proxy.
  MODEL_ROUTING_PROXY_WRITES: 'modelRoutingProxyWrites'
  // NOTE: `observerAuthority` (LIN-2395) was removed in LIN-3848 — it only
  // stamped the report and had no acting path; a stale stored value is ignored.
};

/**
 * Default values for workspace feature toggles.
 * Applied when a workspace has no saved override. Gated, not-yet-launched
 * features default off.
 */
export const WORKSPACE_FEATURE_DEFAULTS = {
  [WORKSPACE_FEATURES.PERIODICALS]: false,
  [WORKSPACE_FEATURES.MODEL_ROUTING_PROXY_WRITES]: false
};

/**
 * Human-readable labels for workspace feature toggles (settings UI).
 */
export const WORKSPACE_FEATURE_LABELS = {
  [WORKSPACE_FEATURES.PERIODICALS]: 'Periodic reviews',
  [WORKSPACE_FEATURES.MODEL_ROUTING_PROXY_WRITES]: 'Agents can change models'
};

/**
 * Short descriptions for workspace feature toggles (settings UI).
 */
export const WORKSPACE_FEATURE_DESCRIPTIONS = {
  // LIN-3846: there is no scheduler for these. Sixteen weekly templates are run by hand from the
  // Home tree; the flag only adds that group (`cadence` is a fallback floor, not a trigger).
  [WORKSPACE_FEATURES.PERIODICALS]: 'Weekly documentation-review templates you run by hand from Home (workspace-scoped, applies to every user of this workspace). Nothing runs them on a schedule.',
  [WORKSPACE_FEATURES.MODEL_ROUTING_PROXY_WRITES]: 'Let agents with a read-write proxy token change which model each job runs on. Every change needs a reason, is logged and can be undone. Off: agents can only read the table.'
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
