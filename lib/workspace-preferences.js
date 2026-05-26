/**
 * Workspace preferences storage module.
 * Stores workspace-level preferences in MongoDB, keyed by Linear workspace urlKey.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Unlike user preferences (per-user, cross-device), workspace preferences are
 * shared across every user connected to the same Linear organization, so
 * settings like the chosen AI model apply uniformly to UI and proxy traffic.
 *
 * Schema:
 * {
 *   _id: string,           // Linear workspace urlKey (primary key)
 *   preferences: Object,   // Workspace preferences object (e.g. { modelId })
 *   createdAt: Date,       // First created timestamp
 *   updatedAt: Date        // Last updated timestamp
 * }
 */

import { DEFAULT_MODEL } from './openrouter.js';

/**
 * Workspace preferences store for persisting workspace-scoped settings.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
export class WorkspacePreferencesStore {
  /**
   * Creates a new workspace preferences store instance.
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection for storing preferences
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Retrieves workspace preferences by urlKey.
   * Returns an empty object if no preferences exist for the workspace.
   *
   * @param {string} urlKey - The Linear workspace urlKey
   * @returns {Promise<Object>} Workspace preferences object (empty if not found)
   */
  async getWorkspacePreferences(urlKey) {
    if (!urlKey) {
      console.warn('getWorkspacePreferences called without urlKey');
      return {};
    }

    try {
      const doc = await this.collection.findOne({ _id: urlKey });
      return doc?.preferences || {};
    } catch (err) {
      console.error('Error fetching workspace preferences:', err);
      return {};
    }
  }

  /**
   * Saves workspace preferences for a urlKey.
   * Uses upsert to create new document or update existing one.
   * Automatically manages createdAt and updatedAt timestamps.
   *
   * @param {string} urlKey - The Linear workspace urlKey
   * @param {Object} preferences - Preferences object to save
   * @returns {Promise<boolean>} True if save succeeded, false otherwise
   */
  async saveWorkspacePreferences(urlKey, preferences) {
    if (!urlKey) {
      console.warn('saveWorkspacePreferences called without urlKey');
      return false;
    }

    try {
      const now = new Date();
      await this.collection.updateOne(
        { _id: urlKey },
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
      console.error('Error saving workspace preferences:', err);
      return false;
    }
  }

  /**
   * Deletes workspace preferences for a urlKey.
   *
   * @param {string} urlKey - The Linear workspace urlKey
   * @returns {Promise<boolean>} True if delete succeeded, false otherwise
   */
  async deleteWorkspacePreferences(urlKey) {
    if (!urlKey) {
      console.warn('deleteWorkspacePreferences called without urlKey');
      return false;
    }

    try {
      await this.collection.deleteOne({ _id: urlKey });
      return true;
    } catch (err) {
      console.error('Error deleting workspace preferences:', err);
      return false;
    }
  }
}

/**
 * Resolves the AI model for a workspace. This is the single source of truth
 * for model selection — every LLM call site (UI and proxy) should use it.
 *
 * @param {Object} options
 * @param {string} options.urlKey - The Linear workspace urlKey
 * @param {WorkspacePreferencesStore} options.workspacePreferencesStore - The store
 * @returns {Promise<string>} The chosen model ID, or DEFAULT_MODEL if unset
 */
export async function resolveWorkspaceModel({ urlKey, workspacePreferencesStore }) {
  if (!urlKey || !workspacePreferencesStore) {
    return DEFAULT_MODEL;
  }
  const prefs = await workspacePreferencesStore.getWorkspacePreferences(urlKey);
  return prefs.modelId || DEFAULT_MODEL;
}
