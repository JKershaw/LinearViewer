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
   * Reads the durable favourite custom prompts for a given workspace (LIN-1011).
   *
   * Favourites are a user-curated list of prompt strings that — unlike the
   * rolling, capped `recentCustomPrompts` window — never roll off. Same
   * per-`{user, workspace}` map shape as `recentCustomPrompts` /
   * `selectedTeamByWorkspace`; identity is the exact (trimmed) string, so a
   * favourite stays in sync by value with its recent counterpart.
   *
   * @param {string} linearUserId - The Linear user ID
   * @param {string} workspaceKey - The workspace urlKey
   * @returns {Promise<string[]>} The favourite prompt strings, most-recent-first
   */
  async getFavoritePrompts(linearUserId, workspaceKey) {
    if (!linearUserId || !workspaceKey) return [];
    const prefs = await this.getUserPreferences(linearUserId);
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
   * @param {string} linearUserId - The Linear user ID
   * @param {string} workspaceKey - The workspace urlKey
   * @param {string} prompt - The prompt string to favourite
   * @returns {Promise<string[]>} The updated favourites list
   */
  async addFavoritePrompt(linearUserId, workspaceKey, prompt) {
    if (!linearUserId || !workspaceKey) return [];
    const existing = await this.getUserPreferences(linearUserId);
    const byWorkspace = { ...(existing.favoriteCustomPrompts || {}) };
    let list = (byWorkspace[workspaceKey] || []).filter(p => p !== prompt);
    list.unshift(prompt);
    list = list.slice(0, MAX_FAVORITE_PROMPTS);
    byWorkspace[workspaceKey] = list;
    await this.saveUserPreferences(linearUserId, { ...existing, favoriteCustomPrompts: byWorkspace });
    return list;
  }

  /**
   * Removes a favourite custom prompt for a given workspace (LIN-1011).
   *
   * Read-merges (as above); filters the exact string out. Un-star is the one
   * path recents has no equivalent of. Returns the updated list.
   *
   * @param {string} linearUserId - The Linear user ID
   * @param {string} workspaceKey - The workspace urlKey
   * @param {string} prompt - The prompt string to un-favourite
   * @returns {Promise<string[]>} The updated favourites list
   */
  async removeFavoritePrompt(linearUserId, workspaceKey, prompt) {
    if (!linearUserId || !workspaceKey) return [];
    const existing = await this.getUserPreferences(linearUserId);
    const byWorkspace = { ...(existing.favoriteCustomPrompts || {}) };
    const list = (byWorkspace[workspaceKey] || []).filter(p => p !== prompt);
    byWorkspace[workspaceKey] = list;
    await this.saveUserPreferences(linearUserId, { ...existing, favoriteCustomPrompts: byWorkspace });
    return list;
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
