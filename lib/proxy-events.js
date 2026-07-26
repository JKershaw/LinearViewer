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
   * Computes per-token credential health for a workspace within a recent
   * window (LIN-1586). A token is `credential-dead` iff, within the window,
   * it has BOTH a `token_ownerless` breadcrumb (exact match — the LIN-961
   * free-tier writer emits an unrelated English sentence) AND a successful
   * (<400) call — the signature of a worker whose workspace-free calls
   * (e.g. `/agent/status`, `/dispatch`, both 201s) succeed while its
   * workspace-scoped calls silently fail as ownerless (LIN-1577). Does not
   * key on `status === 503` alone: most 503 `logEvent` call sites carry no
   * note at all. Time-bounded and field-projected so this never loads every
   * non-expired workspace event like `listEvents` does; folded per token in
   * JS, mirroring this store's existing in-JS aggregation style.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {number} [options.windowMs=900000] - Lookback window in ms (default 15 min)
   * @returns {Promise<{windowMs: number, tokens: Array}>}
   */
  async listCredentialHealth(urlKey, { windowMs = 15 * 60 * 1000 } = {}) {
    if (!urlKey) {
      return { windowMs, tokens: [] };
    }

    try {
      const now = new Date();
      const since = new Date(now.getTime() - windowMs);
      const docs = await this.collection.find({
        urlKey,
        expiresAt: { $gt: now },
        timestamp: { $gt: since }
      }).toArray();

      const rows = docs.map(doc => ({
        tokenId: doc.tokenId,
        tokenLabel: doc.tokenLabel,
        status: doc.status,
        note: doc.note ?? null,
        timestamp: doc.timestamp?.toISOString?.() || doc.timestamp
      }));

      const byToken = new Map();
      for (const row of rows) {
        if (!row.tokenId) continue;
        let entry = byToken.get(row.tokenId);
        if (!entry) {
          entry = { tokenId: row.tokenId, tokenLabel: row.tokenLabel || null, ownerlessCount: 0, okCount: 0 };
          byToken.set(row.tokenId, entry);
        }
        if (row.note === 'token_ownerless') entry.ownerlessCount++;
        if (row.status < 400) entry.okCount++;
        if (!entry.tokenLabel && row.tokenLabel) entry.tokenLabel = row.tokenLabel;
      }

      const tokens = Array.from(byToken.values()).map(entry => ({
        ...entry,
        verdict: (entry.ownerlessCount > 0 && entry.okCount > 0) ? 'credential-dead' : 'ok'
      }));

      return { windowMs, tokens };
    } catch (err) {
      console.error('Error computing proxy credential health:', err);
      return { windowMs, tokens: [] };
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
