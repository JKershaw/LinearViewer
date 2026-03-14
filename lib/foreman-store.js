/**
 * Foreman status storage module.
 * Records foreman progress updates as an append-only log.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,              // Status entry ID (UUID)
 *   urlKey: string,            // Workspace URL key
 *   taskIdentifier: string,    // Issue identifier (e.g., "LIN-42")
 *   action: string,            // Action performed (e.g., "research", "implementation", "review")
 *   status: string,            // Outcome (e.g., "completed", "failed", "blocked")
 *   summary: string,           // Human-readable summary
 *   timestamp: Date,           // When the status was recorded
 *   expiresAt: Date            // TTL for auto-cleanup (24 hours)
 * }
 */

import crypto from 'crypto';

const MAX_SUMMARY_LENGTH = 10000;
const MAX_FIELD_LENGTH = 200;

/**
 * Foreman status store for recording task progress.
 */
export class ForemanStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection
   * @param {number} [options.ttl=86400] - Status TTL in seconds (default: 24 hours)
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.ttl = options.ttl || 24 * 60 * 60; // 24 hours
  }

  /**
   * Records a foreman status update.
   *
   * @param {Object} entry - Status data
   * @param {string} entry.urlKey - Workspace URL key
   * @param {string} entry.taskIdentifier - Issue identifier
   * @param {string} entry.action - Action performed
   * @param {string} entry.status - Outcome status
   * @param {string} entry.summary - Human-readable summary
   * @returns {Promise<Object>} The created entry
   */
  async recordStatus({ urlKey, taskIdentifier, action, status, summary }) {
    const now = new Date();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      taskIdentifier: (taskIdentifier || '').slice(0, MAX_FIELD_LENGTH),
      action: (action || '').slice(0, MAX_FIELD_LENGTH),
      status: (status || '').slice(0, MAX_FIELD_LENGTH),
      summary: (summary || '').slice(0, MAX_SUMMARY_LENGTH),
      timestamp: now,
      expiresAt: new Date(now.getTime() + this.ttl * 1000)
    };

    await this.collection.insertOne(doc);
    return doc;
  }

  /**
   * Lists recent foreman status entries for a workspace.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {number} [options.limit=20] - Max entries to return
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Promise<{items: Array, total: number}>}
   */
  async listStatus(urlKey, { limit = 20, offset = 0 } = {}) {
    if (!urlKey) {
      return { items: [], total: 0 };
    }

    try {
      const now = new Date();
      const docs = await this.collection.find({
        urlKey,
        expiresAt: { $gt: now }
      }).toArray();

      // Sort by timestamp descending (newest first)
      docs.sort((a, b) => {
        const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
        const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
        return bTime - aTime;
      });

      const total = docs.length;
      const sliced = docs.slice(offset, offset + limit);

      return {
        items: sliced.map(doc => ({
          id: doc._id,
          taskIdentifier: doc.taskIdentifier,
          action: doc.action,
          status: doc.status,
          summary: doc.summary,
          timestamp: doc.timestamp?.toISOString?.() || doc.timestamp
        })),
        total
      };
    } catch (err) {
      console.error('Error listing foreman status:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Removes expired entries.
   *
   * @returns {Promise<number>} Number of entries removed
   */
  async cleanup() {
    try {
      const now = new Date();
      const result = await this.collection.deleteMany({
        expiresAt: { $lt: now }
      });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error cleaning up foreman status:', err);
      return 0;
    }
  }

  /**
   * Clears all entries for a workspace (used in tests).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of entries removed
   */
  async clear(urlKey) {
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing foreman status:', err);
      return 0;
    }
  }
}
