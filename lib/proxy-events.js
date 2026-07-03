/**
 * Proxy event storage module.
 * Records every proxy API call for audit logging.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,           // Event ID (UUID)
 *   urlKey: string,        // Workspace URL key
 *   tokenId: string,       // Proxy token ID
 *   tokenLabel: string,    // Proxy token label
 *   method: string,        // HTTP method (GET, POST, etc.)
 *   endpoint: string,      // Proxy endpoint path
 *   status: number,        // HTTP response status code
 *   note: string|null,     // Optional free-text breadcrumb (e.g. free-tier key-source; LIN-961)
 *   timestamp: Date,       // When the call was made
 *   expiresAt: Date        // TTL for auto-cleanup (30 days)
 * }
 */

import crypto from 'crypto';

/**
 * Proxy event store for recording API proxy calls.
 */
export class ProxyEventStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection
   * @param {number} [options.ttl=2592000] - Event TTL in seconds (default: 30 days)
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.ttl = options.ttl || 30 * 24 * 60 * 60; // 30 days
  }

  /**
   * Records a proxy API event.
   *
   * @param {Object} event - Event data
   * @param {string} event.urlKey - Workspace URL key
   * @param {string} event.tokenId - Token ID used
   * @param {string} event.tokenLabel - Token label
   * @param {string} event.method - HTTP method
   * @param {string} event.endpoint - Endpoint path
   * @param {number} event.status - Response status code
   * @param {string} [event.note] - Optional free-text breadcrumb (LIN-961)
   * @returns {Promise<Object>} The created event
   */
  async recordEvent({ urlKey, tokenId, tokenLabel, method, endpoint, status, note }) {
    const now = new Date();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      tokenId: tokenId || null,
      tokenLabel: tokenLabel || null,
      method: method || 'GET',
      endpoint: endpoint || '/',
      status: status || 200,
      note: note || null,
      timestamp: now,
      expiresAt: new Date(now.getTime() + this.ttl * 1000)
    };

    try {
      await this.collection.insertOne(doc);
      return doc;
    } catch (err) {
      console.error('Error recording proxy event:', err);
      return doc; // Return doc even on error (fire-and-forget pattern)
    }
  }

  /**
   * Lists recent events for a workspace.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {number} [options.limit=50] - Max events to return
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Promise<{items: Array, total: number}>}
   */
  async listEvents(urlKey, { limit = 50, offset = 0 } = {}) {
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
          tokenId: doc.tokenId,
          tokenLabel: doc.tokenLabel,
          method: doc.method,
          endpoint: doc.endpoint,
          status: doc.status,
          note: doc.note ?? null,
          timestamp: doc.timestamp?.toISOString?.() || doc.timestamp
        })),
        total
      };
    } catch (err) {
      console.error('Error listing proxy events:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Removes expired events.
   *
   * @returns {Promise<number>} Number of events removed
   */
  async cleanup() {
    try {
      const now = new Date();
      const result = await this.collection.deleteMany({
        expiresAt: { $lt: now }
      });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error cleaning up proxy events:', err);
      return 0;
    }
  }

  /**
   * Clears all events for a workspace (used in tests).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of events removed
   */
  async clear(urlKey) {
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing proxy events:', err);
      return 0;
    }
  }
}
