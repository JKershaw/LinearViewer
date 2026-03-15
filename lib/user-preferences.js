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
