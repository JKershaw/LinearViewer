/**
 * Custom prompts storage module.
 * Stores custom prompt templates in MongoDB, keyed by workspace urlKey.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,           // Prompt ID (UUID)
 *   urlKey: string,        // Workspace URL key (indexed)
 *   name: string,          // Display name (max 50 chars)
 *   template: string,      // Prompt template with {{variable}} placeholders
 *   createdAt: string,     // ISO timestamp
 *   updatedAt: string      // ISO timestamp
 * }
 */

import crypto from 'crypto';

const MAX_CUSTOM_PROMPTS = 20;
const MAX_PROMPT_NAME_LENGTH = 50;

/**
 * Custom prompts store for managing workspace-scoped prompt templates.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
export class CustomPromptsStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * List all custom prompts for a workspace.
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<Array>} Array of prompt objects
   */
  async list(urlKey) {
    if (!urlKey) return [];
    try {
      const docs = await this.collection.find({ urlKey }).toArray();
      return docs.map(({ _id, urlKey: _uk, ...rest }) => ({ id: _id, ...rest }));
    } catch (err) {
      console.error('Error listing custom prompts:', err);
      return [];
    }
  }

  /**
   * Get a single custom prompt by ID.
   * @param {string} urlKey - Workspace URL key
   * @param {string} id - Prompt ID
   * @returns {Promise<Object|null>}
   */
  async get(urlKey, id) {
    if (!urlKey || !id) return null;
    try {
      const doc = await this.collection.findOne({ _id: id, urlKey });
      if (!doc) return null;
      const { _id, urlKey: _uk, ...rest } = doc;
      return { id: _id, ...rest };
    } catch (err) {
      console.error('Error getting custom prompt:', err);
      return null;
    }
  }

  /**
   * Create a new custom prompt.
   * @param {string} urlKey - Workspace URL key
   * @param {Object} data - { name, template }
   * @returns {Promise<Object>} Created prompt
   * @throws {Error} On validation failure or limit exceeded
   */
  async create(urlKey, { name, template }) {
    if (!urlKey) throw new Error('urlKey is required');
    if (!name || typeof name !== 'string' || !name.trim()) throw new Error('Name is required');
    if (!template || typeof template !== 'string' || !template.trim()) throw new Error('Template is required');
    if (name.length > MAX_PROMPT_NAME_LENGTH) throw new Error(`Name must be ${MAX_PROMPT_NAME_LENGTH} characters or less`);

    const existing = await this.collection.find({ urlKey }).toArray();
    if (existing.length >= MAX_CUSTOM_PROMPTS) {
      throw new Error(`You have reached the maximum of ${MAX_CUSTOM_PROMPTS} custom prompts`);
    }

    const now = new Date().toISOString();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      name: name.trim(),
      template: template.trim(),
      createdAt: now,
      updatedAt: now
    };

    await this.collection.insertOne(doc);
    const { _id, urlKey: _uk, ...rest } = doc;
    return { id: _id, ...rest };
  }

  /**
   * Update an existing custom prompt.
   * @param {string} urlKey - Workspace URL key
   * @param {string} id - Prompt ID
   * @param {Object} data - Fields to update { name?, template? }
   * @returns {Promise<Object|null>} Updated prompt or null if not found
   */
  async update(urlKey, id, { name, template }) {
    if (!urlKey || !id) return null;

    const updates = { updatedAt: new Date().toISOString() };
    if (name !== undefined) {
      if (name.length > MAX_PROMPT_NAME_LENGTH) throw new Error(`Name must be ${MAX_PROMPT_NAME_LENGTH} characters or less`);
      updates.name = name.trim();
    }
    if (template !== undefined) updates.template = template.trim();

    await this.collection.updateOne(
      { _id: id, urlKey },
      { $set: updates }
    );

    return this.get(urlKey, id);
  }

  /**
   * Delete a custom prompt.
   * @param {string} urlKey - Workspace URL key
   * @param {string} id - Prompt ID
   * @returns {Promise<boolean>} True if deleted
   */
  async delete(urlKey, id) {
    if (!urlKey || !id) return false;
    try {
      const result = await this.collection.deleteOne({ _id: id, urlKey });
      return (result.deletedCount || 0) > 0;
    } catch (err) {
      console.error('Error deleting custom prompt:', err);
      return false;
    }
  }

  /**
   * Delete all custom prompts for a workspace. Used in tests.
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<boolean>}
   */
  async deleteAll(urlKey) {
    if (!urlKey) return false;
    try {
      await this.collection.deleteMany({ urlKey });
      return true;
    } catch (err) {
      console.error('Error deleting all custom prompts:', err);
      return false;
    }
  }
}
