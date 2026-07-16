/**
 * User preferences storage module.
 * Stores user preferences in MongoDB, keyed by account ID.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,           // account ID (primary key)
 *   preferences: Object,   // User preferences object
 *   createdAt: Date,       // First created timestamp
 *   updatedAt: Date        // Last updated timestamp
 * }
 *
 * ## Ownership (LIN-1331, Phase E)
 *
 * Rule: a setting that follows the person wherever they go is **account-owned**
 * (belongs here); a setting shared by everyone in the workspace is
 * **workspace-owned** (belongs in workspace-preferences.js instead). This store
 * is the account-owned side of that boundary — every key below is here because
 * it follows the person, not the workspace.
 *
 * Per-setting classification:
 * - `openRouterApiKey` — **account-owned credential, workspace-consumed.**
 *   Credentials live with the account unless explicitly workspace-scoped; this
 *   one isn't. Written only by `routes/openrouter-auth.js`; resolved for
 *   proxy/agent calls via the account-keyed `getWorkspaceOpenRouterKey(store,
 *   creatorId=accountId)` (`lib/openrouter-key-resolver.js`), which enforces
 *   the Phase D quota-isolation invariant: the key must resolve strictly from
 *   the token creator's own account, so one user's proxy token can never
 *   consume another user's OpenRouter quota, and a keyless creator falls
 *   through to the shared free-tier key metered per-workspace — never to
 *   another account's personal key (pinned by `tests/unit/quota-isolation.test.js`).
 * - `theme` — account-owned; light/dark follows the person cross-device.
 * - `selectedTeamByWorkspace` — account-owned; a personal remembered team
 *   filter. Per-workspace *scoping* of the map key is not the same as
 *   workspace *ownership* of the setting.
 * - `favoriteCustomPrompts` — account-owned; user-curated favourites.
 * - `recentCustomPrompts` — account-owned; personal rolling recents.
 * - `features` (this store's set) — account-owned, **per-user** flags. This is
 *   a deliberate, documented duality with the separate workspace `features`
 *   set in workspace-preferences.js (see `lib/feature-defaults.js:7-16`) — do
 *   **not** merge them; collapsing the two sets is LIN-282's job, not this
 *   store's.
 * - `northStarByWorkspace` — account-owned **as-built** (personal,
 *   session-mirrored). Open question, not decided here: whether product wants
 *   one shared workspace-level goal instead.
 */

/**
 * Cap on the durable favourite-custom-prompts list per {user, workspace}
 * (LIN-1011). Favourites are curated so this is unlikely to bite, but the cap
 * bounds the preferences document (Mongo 16MB) the same way MAX_RECENT_PROMPTS
 * bounds recents. Higher than the recents cap (10) because favourites are kept.
 */
export const MAX_FAVORITE_PROMPTS = 25;

/**
 * User preferences store for persisting cross-device preferences.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
export class UserPreferencesStore {
  /**
   * Creates a new user preferences store instance.
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection for storing preferences
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Retrieves user preferences by account ID.
   * Returns an empty object if no preferences exist for the user.
   *
   * @param {string} accountId - The account ID
   * @returns {Promise<Object>} User preferences object (empty if not found)
   */
  async getUserPreferences(accountId) {
    if (!accountId) {
      console.warn('getUserPreferences called without accountId');
      return {};
    }

    try {
      const doc = await this.collection.findOne({ _id: accountId });
      return doc?.preferences || {};
    } catch (err) {
      console.error('Error fetching user preferences:', err);
      return {};
    }
  }

  /**
   * Saves user preferences for a account ID.
   * Uses upsert to create new document or update existing one.
   * Automatically manages createdAt and updatedAt timestamps.
   *
   * @param {string} accountId - The account ID
   * @param {Object} preferences - Preferences object to save
   * @returns {Promise<boolean>} True if save succeeded, false otherwise
   */
  async saveUserPreferences(accountId, preferences) {
    if (!accountId) {
      console.warn('saveUserPreferences called without accountId');
      return false;
    }

    try {
      const now = new Date();
      await this.collection.updateOne(
        { _id: accountId },
        {
          $set: {
            preferences,
            updatedAt: now
          },
          $setOnInsert: {
            createdAt: now
          }
        },
        { upsert: true }
      );
      return true;
    } catch (err) {
      console.error('Error saving user preferences:', err);
      return false;
    }
  }

  /**
   * Reads the durable OpenRouter API key for an account.
   *
   * This is the single source of truth for a user's OpenRouter connection
   * (LIN-498). The session field `openRouterApiKey` is only a request-scoped
   * mirror, rehydrated from here after `session.regenerate()`; the proxy path
   * reads here directly instead of scanning sessions.
   *
   * @param {string} accountId - The account ID
   * @returns {Promise<string|null>} The stored key, or null if not connected
   */
  async getOpenRouterApiKey(accountId) {
    const prefs = await this.getUserPreferences(accountId);
    return prefs.openRouterApiKey || null;
  }

  /**
   * Persists a user's OpenRouter API key durably (read-merge — preserves the
   * rest of the preferences object, which saveUserPreferences replaces wholesale).
   *
   * @param {string} accountId - The account ID
   * @param {string} apiKey - The OpenRouter API key to store
   * @returns {Promise<boolean>} True if save succeeded
   */
  async setOpenRouterApiKey(accountId, apiKey) {
    if (!accountId) {
      console.warn('setOpenRouterApiKey called without accountId');
      return false;
    }
    const existing = await this.getUserPreferences(accountId);
    return this.saveUserPreferences(accountId, { ...existing, openRouterApiKey: apiKey });
  }

  /**
   * Removes a user's stored OpenRouter API key (read-merge — leaves all other
   * preferences intact). Mirrors the session disconnect.
   *
   * @param {string} accountId - The account ID
   * @returns {Promise<boolean>} True if save succeeded
   */
  async clearOpenRouterApiKey(accountId) {
    if (!accountId) {
      console.warn('clearOpenRouterApiKey called without accountId');
      return false;
    }
    const existing = await this.getUserPreferences(accountId);
    if (!('openRouterApiKey' in existing)) return true;
    const { openRouterApiKey, ...rest } = existing;
    return this.saveUserPreferences(accountId, rest);
  }

  /**
   * Reads the remembered team selection for a given workspace (LIN-727).
   *
   * Team selection is driven by the `?team=<uuid>` query param; when that param
   * is absent the main route falls back to this per-`{user, workspace}` value so
   * leaving a workspace and returning preserves the prior filter. Returns null
   * when nothing is remembered (which the route treats as the "all teams" default).
   *
   * @param {string} accountId - The account ID
   * @param {string} workspaceKey - The workspace urlKey
   * @returns {Promise<string|null>} The remembered team ID, or null
   */
  async getSelectedTeam(accountId, workspaceKey) {
    if (!accountId || !workspaceKey) return null;
    const prefs = await this.getUserPreferences(accountId);
    return prefs.selectedTeamByWorkspace?.[workspaceKey] || null;
  }

  /**
   * Persists the remembered team selection for a given workspace (LIN-727).
   *
   * Read-merges so the rest of the preferences object survives (saveUserPreferences
   * replaces wholesale). A null/empty teamId clears the entry — this is how an
   * explicit "all teams" selection is recorded (no specific team to remember).
   *
   * @param {string} accountId - The account ID
   * @param {string} workspaceKey - The workspace urlKey
   * @param {string|null} teamId - The team ID to remember, or null to clear
   * @returns {Promise<boolean>} True if save succeeded
   */
  async setSelectedTeam(accountId, workspaceKey, teamId) {
    if (!accountId || !workspaceKey) return false;
    const existing = await this.getUserPreferences(accountId);
    const map = { ...(existing.selectedTeamByWorkspace || {}) };
    if (teamId) {
      map[workspaceKey] = teamId;
    } else {
      delete map[workspaceKey];
    }
    return this.saveUserPreferences(accountId, { ...existing, selectedTeamByWorkspace: map });
  }

  /**
   * Reads the durable favourite custom prompts for a given workspace (LIN-1011).
   *
   * Favourites are a user-curated list of prompt strings that — unlike the
   * rolling, capped `recentCustomPrompts` window — never roll off. Same
   * per-`{user, workspace}` map shape as `recentCustomPrompts` /
   * `selectedTeamByWorkspace`; identity is the exact (trimmed) string, so a
   * favourite stays in sync by value with its recent counterpart.
   *
   * @param {string} accountId - The account ID
   * @param {string} workspaceKey - The workspace urlKey
   * @returns {Promise<string[]>} The favourite prompt strings, most-recent-first
   */
  async getFavoritePrompts(accountId, workspaceKey) {
    if (!accountId || !workspaceKey) return [];
    const prefs = await this.getUserPreferences(accountId);
    return prefs.favoriteCustomPrompts?.[workspaceKey] || [];
  }

  /**
   * Adds a favourite custom prompt for a given workspace (LIN-1011).
   *
   * Read-merges so the rest of the preferences object survives
   * (saveUserPreferences replaces wholesale). Deduplicates on the exact string
   * (remove existing match, prepend), then caps at MAX_FAVORITE_PROMPTS —
   * matching the recents cap semantics (adding past the cap silently drops the
   * oldest, never errors). Callers own trimming/validation, mirroring the
   * recents POST endpoint.
   *
   * @param {string} accountId - The account ID
   * @param {string} workspaceKey - The workspace urlKey
   * @param {string} prompt - The prompt string to favourite
   * @returns {Promise<string[]>} The updated favourites list
   */
  async addFavoritePrompt(accountId, workspaceKey, prompt) {
    if (!accountId || !workspaceKey) return [];
    const existing = await this.getUserPreferences(accountId);
    const byWorkspace = { ...(existing.favoriteCustomPrompts || {}) };
    let list = (byWorkspace[workspaceKey] || []).filter(p => p !== prompt);
    list.unshift(prompt);
    list = list.slice(0, MAX_FAVORITE_PROMPTS);
    byWorkspace[workspaceKey] = list;
    await this.saveUserPreferences(accountId, { ...existing, favoriteCustomPrompts: byWorkspace });
    return list;
  }

  /**
   * Removes a favourite custom prompt for a given workspace (LIN-1011).
   *
   * Read-merges (as above); filters the exact string out. Un-star is the one
   * path recents has no equivalent of. Returns the updated list.
   *
   * @param {string} accountId - The account ID
   * @param {string} workspaceKey - The workspace urlKey
   * @param {string} prompt - The prompt string to un-favourite
   * @returns {Promise<string[]>} The updated favourites list
   */
  async removeFavoritePrompt(accountId, workspaceKey, prompt) {
    if (!accountId || !workspaceKey) return [];
    const existing = await this.getUserPreferences(accountId);
    const byWorkspace = { ...(existing.favoriteCustomPrompts || {}) };
    const list = (byWorkspace[workspaceKey] || []).filter(p => p !== prompt);
    byWorkspace[workspaceKey] = list;
    await this.saveUserPreferences(accountId, { ...existing, favoriteCustomPrompts: byWorkspace });
    return list;
  }

  /**
   * Deletes user preferences for a account ID.
   * Used when a user wants to reset their preferences.
   *
   * @param {string} accountId - The account ID
   * @returns {Promise<boolean>} True if delete succeeded, false otherwise
   */
  async deleteUserPreferences(accountId) {
    if (!accountId) {
      console.warn('deleteUserPreferences called without accountId');
      return false;
    }

    try {
      await this.collection.deleteOne({ _id: accountId });
      return true;
    } catch (err) {
      console.error('Error deleting user preferences:', err);
      return false;
    }
  }
}

/**
 * Rehydrates session fields from durable user preferences after a Linear
 * `session.regenerate()` (LIN-498). Regeneration wipes the session, so every
 * preference that session readers depend on must be re-applied from the durable
 * store here. Centralising this restore mapping keeps the set of rehydrated
 * fields in one place so an addition (like `openRouterApiKey`) can't be
 * forgotten on the auth callback path again.
 *
 * Pure and side-effect-free beyond mutating `session`; safe to unit-test.
 *
 * @param {Object} session - The (regenerated) Express session to populate
 * @param {Object} prefs - Durable preferences from getUserPreferences()
 */
export function applyUserPreferencesToSession(session, prefs) {
  if (!session || !prefs) return;
  if (prefs.features) session.features = prefs.features;
  if (prefs.northStarByWorkspace) session.northStarByWorkspace = prefs.northStarByWorkspace;
  if (prefs.openRouterApiKey) session.openRouterApiKey = prefs.openRouterApiKey;
  // LIN-785: the durable light/dark theme preference. Rehydrated into the session
  // so a returning/cross-device user's choice is known server-side and can seed
  // the pre-paint `theme` cookie at login (see the auth callback).
  if (prefs.theme) session.theme = prefs.theme;
}

/** Persisted theme cookie lifetime — a year, so the choice outlives the session. */
export const THEME_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The accepted theme values. The single source of truth shared by the route
 * validator and any other theme writer, so an added theme can't be validated in
 * one place and dropped in another.
 */
export const VALID_THEMES = ['light', 'dark'];

/**
 * Writes the pre-paint `theme` cookie (LIN-785).
 *
 * Deliberately NOT httpOnly: the shared shell's pre-paint script reads it via
 * `document.cookie` to apply `theme-dark` before first paint. `sameSite: 'lax'`
 * + `secure` in production match the session-cookie posture. Centralised here so
 * the route and the login-seed path can't drift on the cookie's contract.
 *
 * @param {Object} res - Express response
 * @param {string} theme - One of VALID_THEMES
 */
export function setThemeCookie(res, theme) {
  res.cookie('theme', theme, {
    maxAge: THEME_COOKIE_MAX_AGE_MS,
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });
}
