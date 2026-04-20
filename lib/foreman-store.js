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
 *   tokenId?: string,          // Proxy token that posted this status. Absent for entries
 *                              // recorded before session attribution landed; those roll
 *                              // up into a synthetic "unattributed" session in the UI.
 *   tokenLabel?: string,       // Denormalised label snapshot so sessions survive
 *                              // token revocation (labels can't be relabelled).
 *   dispatchId?: string,       // Optional back-reference to dispatch-history item ID
 *   timestamp: Date,           // When the status was recorded
 *   expiresAt: Date            // TTL for auto-cleanup (30 days)
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
   * @param {number} [options.ttl=2592000] - Status TTL in seconds (default: 30 days)
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.ttl = options.ttl || 30 * 24 * 60 * 60; // 30 days
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
   * @param {string} [entry.tokenId] - Proxy token ID that posted this status. When set,
   *   enables session grouping in listSessions(). Optional for back-compat.
   * @param {string} [entry.tokenLabel] - Label snapshot at write time. Persisting it
   *   means sessions remain readable even after the token is revoked/rotated.
   * @param {string} [entry.dispatchId] - Optional dispatch-history item ID this status decorates.
   * @returns {Promise<Object>} The created entry
   */
  async recordStatus({ urlKey, taskIdentifier, action, status, summary, tokenId, tokenLabel, dispatchId }) {
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
    // Only persist optional fields when supplied — keeps old docs/queries unaffected.
    if (dispatchId) {
      doc.dispatchId = String(dispatchId).slice(0, MAX_FIELD_LENGTH);
    }
    if (tokenId) {
      doc.tokenId = String(tokenId).slice(0, MAX_FIELD_LENGTH);
    }
    if (tokenLabel) {
      doc.tokenLabel = String(tokenLabel).slice(0, MAX_FIELD_LENGTH);
    }

    await this.collection.insertOne(doc);
    return doc;
  }

  /**
   * Lists recent foreman status entries for a workspace.
   *
   * When `limit` is omitted, returns all non-expired entries for the workspace.
   * This matches `dispatch-store.listHistory` semantics and avoids a silent-
   * truncation footgun for callers that need the full set (e.g. pipeline loop
   * reconstruction over a 30-day window).
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {number} [options.limit] - Max entries to return (omit for all)
   * @param {number} [options.offset=0] - Offset for pagination
   * @param {string} [options.tokenId] - Filter to entries from this token (session filter).
   *   Pass the string literal `'__unattributed__'` to get entries that have no tokenId
   *   (legacy bucket).
   * @param {string} [options.taskIdentifier] - Filter to entries for this Linear identifier.
   * @returns {Promise<{items: Array, total: number}>}
   */
  async listStatus(urlKey, { limit, offset = 0, tokenId, taskIdentifier } = {}) {
    if (!urlKey) {
      return { items: [], total: 0 };
    }

    try {
      const now = new Date();
      // Do filtering in JS so both MongoDB and MangoDB (file-based) queries stay simple.
      // Workspace-scoped result sets are small enough that this is fine.
      const docs = (await this.collection.find({
        urlKey,
        expiresAt: { $gt: now }
      }).toArray()).filter(doc => {
        if (taskIdentifier && doc.taskIdentifier !== taskIdentifier) return false;
        if (tokenId === '__unattributed__') return !doc.tokenId;
        if (tokenId && doc.tokenId !== tokenId) return false;
        return true;
      });

      // Sort by timestamp descending (newest first)
      docs.sort((a, b) => {
        const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
        const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
        return bTime - aTime;
      });

      const total = docs.length;
      const sliced = limit ? docs.slice(offset, offset + limit) : docs.slice(offset);

      return {
        items: sliced.map(doc => {
          const item = {
            id: doc._id,
            taskIdentifier: doc.taskIdentifier,
            action: doc.action,
            status: doc.status,
            summary: doc.summary,
            timestamp: doc.timestamp?.toISOString?.() || doc.timestamp
          };
          // Only include optional fields when present so old entries stay compact.
          if (doc.dispatchId) item.dispatchId = doc.dispatchId;
          if (doc.tokenId) item.tokenId = doc.tokenId;
          if (doc.tokenLabel) item.tokenLabel = doc.tokenLabel;
          return item;
        }),
        total
      };
    } catch (err) {
      console.error('Error listing foreman status:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Groups status entries into sessions by tokenId. Entries without a tokenId
   * roll up into a single synthetic "unattributed" session keyed as
   * `tokenId === null` / `id === '__unattributed__'`.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<{sessions: Array}>}
   */
  async listSessions(urlKey) {
    if (!urlKey) return { sessions: [] };

    try {
      const now = new Date();
      const docs = await this.collection.find({
        urlKey,
        expiresAt: { $gt: now }
      }).toArray();

      const byToken = new Map();
      for (const doc of docs) {
        const key = doc.tokenId || '__unattributed__';
        const ts = doc.timestamp instanceof Date ? doc.timestamp.getTime() : new Date(doc.timestamp).getTime();

        const existing = byToken.get(key);
        if (!existing) {
          byToken.set(key, {
            id: key,
            tokenId: doc.tokenId || null,
            label: doc.tokenLabel || (doc.tokenId ? null : 'unattributed'),
            firstSeen: ts,
            lastSeen: ts,
            itemCount: 1,
            lastEntry: doc
          });
          continue;
        }

        existing.itemCount += 1;
        if (ts < existing.firstSeen) existing.firstSeen = ts;
        if (ts > existing.lastSeen) {
          existing.lastSeen = ts;
          existing.lastEntry = doc;
          // Refresh the label from the most recent entry in case the user renamed the token.
          if (doc.tokenLabel) existing.label = doc.tokenLabel;
        }
      }

      const sessions = Array.from(byToken.values())
        .map(s => ({
          id: s.id,
          tokenId: s.tokenId,
          label: s.label,
          firstSeen: new Date(s.firstSeen).toISOString(),
          lastSeen: new Date(s.lastSeen).toISOString(),
          itemCount: s.itemCount,
          lastTaskIdentifier: s.lastEntry.taskIdentifier || null,
          lastAction: s.lastEntry.action || null,
          lastStatus: s.lastEntry.status || null
        }))
        .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

      return { sessions };
    } catch (err) {
      console.error('Error listing foreman sessions:', err);
      return { sessions: [] };
    }
  }

  /**
   * Groups status entries into threads by Linear task identifier. Optionally
   * filter to a single session (tokenId) to answer "what tasks has this agent
   * touched?".
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {string} [options.tokenId] - Restrict to one session (or `'__unattributed__'`)
   * @returns {Promise<{tasks: Array}>}
   */
  async listTaskThreads(urlKey, { tokenId } = {}) {
    if (!urlKey) return { tasks: [] };

    try {
      const now = new Date();
      const docs = (await this.collection.find({
        urlKey,
        expiresAt: { $gt: now }
      }).toArray()).filter(doc => {
        if (tokenId === '__unattributed__') return !doc.tokenId;
        if (tokenId && doc.tokenId !== tokenId) return false;
        return true;
      });

      const byTask = new Map();
      for (const doc of docs) {
        const key = doc.taskIdentifier || '(unknown)';
        const ts = doc.timestamp instanceof Date ? doc.timestamp.getTime() : new Date(doc.timestamp).getTime();
        const existing = byTask.get(key);
        if (!existing) {
          byTask.set(key, {
            taskIdentifier: key,
            firstSeen: ts,
            lastSeen: ts,
            itemCount: 1,
            lastEntry: doc
          });
          continue;
        }
        existing.itemCount += 1;
        if (ts < existing.firstSeen) existing.firstSeen = ts;
        if (ts > existing.lastSeen) {
          existing.lastSeen = ts;
          existing.lastEntry = doc;
        }
      }

      const tasks = Array.from(byTask.values())
        .map(t => ({
          taskIdentifier: t.taskIdentifier,
          firstSeen: new Date(t.firstSeen).toISOString(),
          lastSeen: new Date(t.lastSeen).toISOString(),
          itemCount: t.itemCount,
          lastAction: t.lastEntry.action || null,
          lastStatus: t.lastEntry.status || null
        }))
        .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

      return { tasks };
    } catch (err) {
      console.error('Error listing foreman task threads:', err);
      return { tasks: [] };
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
