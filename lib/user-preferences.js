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
}
