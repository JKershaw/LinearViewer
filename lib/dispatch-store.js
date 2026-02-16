/**
 * Dispatch queue storage module.
 * Stores dispatched prompts in MongoDB, keyed by workspace urlKey.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,              // Item ID (UUID)
 *   urlKey: string,           // Workspace URL key (indexed)
 *   prompt: string,           // The prompt text
 *   promptName: string,       // Display name (e.g., "blocked")
 *   issueId: string,          // Issue UUID
 *   issueIdentifier: string,  // Issue identifier (e.g., "LIN-42")
 *   issueTitle: string,       // Issue title
 *   issueUrl: string,         // Full URL to issue
 *   dispatchedAt: Date,       // When item was dispatched
 *   dispatchedBy: string,     // Linear user ID (optional)
 *   target: string,           // Dispatch target: 'cli' (default) or 'web'
 *   repo: string,             // Target repo name (from project description, optional)
 *   expiresAt: Date           // TTL-based expiration
 * }
 */

import crypto from 'crypto';

/**
 * Dispatch queue store for managing dispatched prompts.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
export class DispatchQueueStore {
  /**
   * Creates a new dispatch queue store instance.
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection for storing items
   * @param {number} [options.ttl=86400] - Item time-to-live in seconds (default: 24 hours)
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.historyCollection = options.historyCollection || null;
    this.ttl = options.ttl || 86400; // 24 hours in seconds
    this.historyTtl = options.historyTtl || 30 * 24 * 60 * 60; // 30 days in seconds
  }

  /**
   * Adds an item to the dispatch queue.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} item - Item to dispatch
   * @param {string} item.prompt - The prompt text
   * @param {string} item.promptName - Display name for the prompt
   * @param {string} [item.issueId] - Issue UUID
   * @param {string} [item.issueIdentifier] - Issue identifier (e.g., "LIN-42")
   * @param {string} [item.issueTitle] - Issue title
   * @param {string} [item.issueUrl] - Full URL to issue
   * @param {string} [item.dispatchedBy] - Linear user ID
   * @param {string} [item.target] - Dispatch target: 'cli' (default) or 'web'
   * @param {string} [item.repo] - Target repo name (from project description)
   * @returns {Promise<Object>} The created item with ID
   */
  async addItem(urlKey, item) {
    if (!urlKey || !item?.prompt) {
      throw new Error('urlKey and prompt are required');
    }

    const now = new Date();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      prompt: item.prompt,
      promptName: item.promptName || 'Prompt',
      issueId: item.issueId || null,
      issueIdentifier: item.issueIdentifier || null,
      issueTitle: item.issueTitle || null,
      issueUrl: item.issueUrl || null,
      dispatchedAt: now,
      dispatchedBy: item.dispatchedBy || null,
      target: item.target || 'cli',
      repo: item.repo || null,
      expiresAt: new Date(now.getTime() + this.ttl * 1000)
    };

    await this.collection.insertOne(doc);
    return doc;
  }

  /**
   * Lists all items in the queue for a workspace.
   * Excludes expired items.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<Array>} Array of queued items
   */
  async listItems(urlKey) {
    if (!urlKey) {
      return [];
    }

    try {
      const now = new Date();
      const docs = await this.collection.find({
        urlKey,
        expiresAt: { $gt: now }
      }).toArray();

      return docs.map(doc => this._formatItem(doc));
    } catch (err) {
      console.error('Error listing dispatch items:', err);
      return [];
    }
  }

  /**
   * Gets the count of items in the queue for a workspace.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Count of queued items
   */
  async countItems(urlKey) {
    if (!urlKey) {
      return 0;
    }

    try {
      const now = new Date();
      // MangoDB may not support countDocuments, so use find + length
      const docs = await this.collection.find({
        urlKey,
        expiresAt: { $gt: now }
      }).toArray();
      return docs.length;
    } catch (err) {
      console.error('Error counting dispatch items:', err);
      return 0;
    }
  }

  /**
   * Removes a specific item from the queue.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {string} itemId - Item ID to remove
   * @returns {Promise<boolean>} True if item was removed
   */
  async removeItem(urlKey, itemId) {
    if (!urlKey || !itemId) {
      return false;
    }

    try {
      // Fetch doc before deleting so we can archive it
      const doc = await this.collection.findOne({ _id: itemId, urlKey });
      const result = await this.collection.deleteOne({
        _id: itemId,
        urlKey
      });

      if (result.deletedCount > 0 && doc) {
        await this._archiveItem(doc, 'cancelled');
      }

      return result.deletedCount > 0;
    } catch (err) {
      console.error('Error removing dispatch item:', err);
      return false;
    }
  }

  /**
   * Atomically claims and removes an item from the queue.
   * Used by consumers to take items for processing.
   * Returns null if item doesn't exist, is expired, or was already taken.
   *
   * @param {string} itemId - Item ID to take
   * @param {string} [urlKey] - Optional workspace URL key for verification
   * @returns {Promise<Object|null>} The taken item or null
   */
  async takeItem(itemId, urlKey = null, tokenLabel = null) {
    if (!itemId) {
      return null;
    }

    try {
      const now = new Date();
      const query = {
        _id: itemId,
        expiresAt: { $gt: now }
      };

      // If urlKey provided, verify it matches (for consumer API security)
      if (urlKey) {
        query.urlKey = urlKey;
      }

      // Atomic find and delete
      const doc = await this.collection.findOneAndDelete(query);

      if (!doc) {
        return null;
      }

      await this._archiveItem(doc, 'taken', { takenByTokenLabel: tokenLabel });

      return this._formatItem(doc);
    } catch (err) {
      console.error('Error taking dispatch item:', err);
      return null;
    }
  }

  /**
   * Polls for available items in a workspace.
   * Returns items without removing them.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<Array>} Array of available items
   */
  async pollAvailable(urlKey) {
    return this.listItems(urlKey);
  }

  /**
   * Removes all expired items from the queue.
   * Called periodically to prevent stale item buildup.
   *
   * @returns {Promise<number>} Number of items removed
   */
  async cleanup() {
    try {
      const now = new Date();

      // Archive expired items before deleting
      if (this.historyCollection) {
        try {
          const expired = await this.collection.find({
            expiresAt: { $lt: now }
          }).toArray();
          for (const doc of expired) {
            await this._archiveItem(doc, 'expired');
          }
        } catch (archiveErr) {
          console.error('Error archiving expired items:', archiveErr);
        }

        // Clean up old history entries
        try {
          await this.historyCollection.deleteMany({
            historyExpiresAt: { $lt: now }
          });
        } catch (historyErr) {
          console.error('Error cleaning up history:', historyErr);
        }
      }

      const result = await this.collection.deleteMany({
        expiresAt: { $lt: now }
      });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Dispatch queue cleanup error:', err);
      return 0;
    }
  }

  /**
   * Clears all items for a workspace (used in tests).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of items removed
   */
  async clear(urlKey) {
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing dispatch queue:', err);
      return 0;
    }
  }

  /**
   * Archives a queue item to the history collection.
   *
   * @param {Object} doc - Original queue document
   * @param {'taken'|'expired'|'cancelled'} status - Resolution status
   * @param {Object} [metadata] - Additional metadata
   * @param {string} [metadata.takenByTokenLabel] - Token label for taken items
   * @private
   */
  async _archiveItem(doc, status, metadata = {}) {
    if (!this.historyCollection) return;

    try {
      const now = new Date();
      await this.historyCollection.insertOne({
        _id: doc._id,
        urlKey: doc.urlKey,
        promptName: doc.promptName,
        issueId: doc.issueId,
        issueIdentifier: doc.issueIdentifier,
        issueTitle: doc.issueTitle,
        issueUrl: doc.issueUrl,
        dispatchedAt: doc.dispatchedAt,
        dispatchedBy: doc.dispatchedBy,
        target: doc.target || 'cli',
        repo: doc.repo || null,
        status,
        resolvedAt: now,
        takenByTokenLabel: metadata.takenByTokenLabel || null,
        historyExpiresAt: new Date(now.getTime() + this.historyTtl * 1000)
      });
    } catch (err) {
      console.error('Error archiving dispatch item:', err);
    }
  }

  /**
   * Lists history items for a workspace, sorted by resolvedAt descending.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options] - Query options
   * @param {number} [options.limit=20] - Maximum items to return
   * @param {number} [options.offset=0] - Number of items to skip
   * @returns {Promise<{items: Array, total: number}>} History items and total count
   */
  async listHistory(urlKey, { limit = 20, offset = 0 } = {}) {
    if (!urlKey || !this.historyCollection) {
      return { items: [], total: 0 };
    }

    try {
      const docs = await this.historyCollection.find({ urlKey }).toArray();

      // Sort by resolvedAt descending
      docs.sort((a, b) => {
        const aTime = a.resolvedAt instanceof Date ? a.resolvedAt.getTime() : new Date(a.resolvedAt).getTime();
        const bTime = b.resolvedAt instanceof Date ? b.resolvedAt.getTime() : new Date(b.resolvedAt).getTime();
        return bTime - aTime;
      });

      const total = docs.length;
      const sliced = docs.slice(offset, offset + limit);

      return {
        items: sliced.map(doc => this._formatHistoryItem(doc)),
        total
      };
    } catch (err) {
      console.error('Error listing dispatch history:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Clears all history for a workspace (used in tests).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of items removed
   */
  async clearHistory(urlKey) {
    if (!this.historyCollection) return 0;

    try {
      const result = await this.historyCollection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing dispatch history:', err);
      return 0;
    }
  }

  /**
   * Formats a history document for API response.
   *
   * @param {Object} doc - History database document
   * @returns {Object} Formatted history item
   * @private
   */
  _formatHistoryItem(doc) {
    return {
      id: doc._id,
      promptName: doc.promptName,
      issueId: doc.issueId,
      issueIdentifier: doc.issueIdentifier,
      issueTitle: doc.issueTitle,
      issueUrl: doc.issueUrl,
      dispatchedAt: doc.dispatchedAt?.toISOString?.() || doc.dispatchedAt,
      target: doc.target || 'cli',
      repo: doc.repo || null,
      status: doc.status,
      resolvedAt: doc.resolvedAt?.toISOString?.() || doc.resolvedAt,
      takenByTokenLabel: doc.takenByTokenLabel || null
    };
  }

  /**
   * Formats a database document for API response.
   *
   * @param {Object} doc - Database document
   * @returns {Object} Formatted item
   * @private
   */
  _formatItem(doc) {
    return {
      id: doc._id,
      prompt: doc.prompt,
      promptName: doc.promptName,
      issueId: doc.issueId,
      issueIdentifier: doc.issueIdentifier,
      issueTitle: doc.issueTitle,
      issueUrl: doc.issueUrl,
      workspace: {
        urlKey: doc.urlKey
      },
      dispatchedAt: doc.dispatchedAt?.toISOString?.() || doc.dispatchedAt,
      dispatchedBy: doc.dispatchedBy,
      target: doc.target || 'cli',
      repo: doc.repo || null,
      expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt
    };
  }
}
