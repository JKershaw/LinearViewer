/**
 * User preferences storage module.
 * Stores user preferences in MongoDB, keyed by Linear user ID.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,           // Linear user ID (primary key)
 *   preferences: Object,   // User preferences object
 *   createdAt: Date,       // First created timestamp
 *   updatedAt: Date        // Last updated timestamp
 * }
 */

/**
 * Valid global theme keys (LIN-756). 'light' is the `:root` default (no class);
 * 'dark'/'amber' map to the `.theme-dark`/`.theme-amber` rebinds in style.css.
 * Shared by the store's get/set, the save route's validation, and the settings UI.
 * @type {readonly string[]}
 */
export const VALID_THEMES = ['light', 'dark', 'amber'];

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
   * Retrieves user preferences by Linear user ID.
   * Returns an empty object if no preferences exist for the user.
   *
   * @param {string} linearUserId - The Linear user ID
   * @returns {Promise<Object>} User preferences object (empty if not found)
   */
  async getUserPreferences(linearUserId) {
    if (!linearUserId) {
      console.warn('getUserPreferences called without linearUserId');
      return {};
    }

    try {
      const doc = await this.collection.findOne({ _id: linearUserId });
      return doc?.preferences || {};
    } catch (err) {
      console.error('Error fetching user preferences:', err);
      return {};
    }
  }

  /**
   * Saves user preferences for a Linear user ID.
   * Uses upsert to create new document or update existing one.
   * Automatically manages createdAt and updatedAt timestamps.
   *
   * @param {string} linearUserId - The Linear user ID
   * @param {Object} preferences - Preferences object to save
   * @returns {Promise<boolean>} True if save succeeded, false otherwise
   */
  async saveUserPreferences(linearUserId, preferences) {
    if (!linearUserId) {
      console.warn('saveUserPreferences called without linearUserId');
      return false;
    }

    try {
      const now = new Date();
      await this.collection.updateOne(
        { _id: linearUserId },
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
   * Reads the durable OpenRouter API key for a Linear user.
   *
   * This is the single source of truth for a user's OpenRouter connection
   * (LIN-498). The session field `openRouterApiKey` is only a request-scoped
   * mirror, rehydrated from here after `session.regenerate()`; the proxy path
   * reads here directly instead of scanning sessions.
   *
   * @param {string} linearUserId - The Linear user ID
   * @returns {Promise<string|null>} The stored key, or null if not connected
   */
  async getOpenRouterApiKey(linearUserId) {
    const prefs = await this.getUserPreferences(linearUserId);
    return prefs.openRouterApiKey || null;
  }

  /**
   * Persists a user's OpenRouter API key durably (read-merge — preserves the
   * rest of the preferences object, which saveUserPreferences replaces wholesale).
   *
   * @param {string} linearUserId - The Linear user ID
   * @param {string} apiKey - The OpenRouter API key to store
   * @returns {Promise<boolean>} True if save succeeded
   */
  async setOpenRouterApiKey(linearUserId, apiKey) {
    if (!linearUserId) {
      console.warn('setOpenRouterApiKey called without linearUserId');
      return false;
    }
    const existing = await this.getUserPreferences(linearUserId);
    return this.saveUserPreferences(linearUserId, { ...existing, openRouterApiKey: apiKey });
  }

  /**
   * Removes a user's stored OpenRouter API key (read-merge — leaves all other
   * preferences intact). Mirrors the session disconnect.
   *
   * @param {string} linearUserId - The Linear user ID
   * @returns {Promise<boolean>} True if save succeeded
   */
  async clearOpenRouterApiKey(linearUserId) {
    if (!linearUserId) {
      console.warn('clearOpenRouterApiKey called without linearUserId');
      return false;
    }
    const existing = await this.getUserPreferences(linearUserId);
    if (!('openRouterApiKey' in existing)) return true;
    const { openRouterApiKey, ...rest } = existing;
    return this.saveUserPreferences(linearUserId, rest);
  }

  /**
   * Reads the remembered team selection for a given workspace (LIN-727).
   *
   * Team selection is driven by the `?team=<uuid>` query param; when that param
   * is absent the main route falls back to this per-`{user, workspace}` value so
   * leaving a workspace and returning preserves the prior filter. Returns null
   * when nothing is remembered (which the route treats as the "all teams" default).
   *
   * @param {string} linearUserId - The Linear user ID
   * @param {string} workspaceKey - The workspace urlKey
   * @returns {Promise<string|null>} The remembered team ID, or null
   */
  async getSelectedTeam(linearUserId, workspaceKey) {
    if (!linearUserId || !workspaceKey) return null;
    const prefs = await this.getUserPreferences(linearUserId);
    return prefs.selectedTeamByWorkspace?.[workspaceKey] || null;
  }

  /**
   * Persists the remembered team selection for a given workspace (LIN-727).
   *
   * Read-merges so the rest of the preferences object survives (saveUserPreferences
   * replaces wholesale). A null/empty teamId clears the entry — this is how an
   * explicit "all teams" selection is recorded (no specific team to remember).
   *
   * @param {string} linearUserId - The Linear user ID
   * @param {string} workspaceKey - The workspace urlKey
   * @param {string|null} teamId - The team ID to remember, or null to clear
   * @returns {Promise<boolean>} True if save succeeded
   */
  async setSelectedTeam(linearUserId, workspaceKey, teamId) {
    if (!linearUserId || !workspaceKey) return false;
    const existing = await this.getUserPreferences(linearUserId);
    const map = { ...(existing.selectedTeamByWorkspace || {}) };
    if (teamId) {
      map[workspaceKey] = teamId;
    } else {
      delete map[workspaceKey];
    }
    return this.saveUserPreferences(linearUserId, { ...existing, selectedTeamByWorkspace: map });
  }

  /**
   * Reads the durable global theme preference (LIN-756).
   *
   * One of {@link VALID_THEMES} ('light' | 'dark' | 'amber'), or null when the
   * user has never chosen a theme (the bootstrap then leaves the light default).
   *
   * @param {string} linearUserId - The Linear user ID
   * @returns {Promise<string|null>} The stored theme key, or null
   */
  async getTheme(linearUserId) {
    if (!linearUserId) return null;
    const prefs = await this.getUserPreferences(linearUserId);
    return VALID_THEMES.includes(prefs.theme) ? prefs.theme : null;
  }

  /**
   * Persists the durable global theme preference (LIN-756). Read-merges so the rest
   * of the preferences object survives (saveUserPreferences replaces wholesale).
   *
   * @param {string} linearUserId - The Linear user ID
   * @param {string} theme - One of {@link VALID_THEMES}
   * @returns {Promise<boolean>} True if save succeeded; false on an invalid theme
   */
  async setTheme(linearUserId, theme) {
    if (!linearUserId) {
      console.warn('setTheme called without linearUserId');
      return false;
    }
    if (!VALID_THEMES.includes(theme)) {
      console.warn('setTheme called with invalid theme:', theme);
      return false;
    }
    const existing = await this.getUserPreferences(linearUserId);
    return this.saveUserPreferences(linearUserId, { ...existing, theme });
  }

  /**
   * Deletes user preferences for a Linear user ID.
   * Used when a user wants to reset their preferences.
   *
   * @param {string} linearUserId - The Linear user ID
   * @returns {Promise<boolean>} True if delete succeeded, false otherwise
   */
  async deleteUserPreferences(linearUserId) {
    if (!linearUserId) {
      console.warn('deleteUserPreferences called without linearUserId');
      return false;
    }

    try {
      await this.collection.deleteOne({ _id: linearUserId });
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
  if (VALID_THEMES.includes(prefs.theme)) session.theme = prefs.theme;
}
