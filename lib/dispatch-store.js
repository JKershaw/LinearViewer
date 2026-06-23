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
 *   kind: string,             // Stable task classification (PROMPT_TEMPLATES key, e.g. "implementation"; "custom" for freeform). See lib/prompt-templates.js DISPATCH_KINDS
 *   issueId: string,          // Issue UUID
 *   issueIdentifier: string,  // Issue identifier (e.g., "LIN-42")
 *   issueTitle: string,       // Issue title
 *   issueUrl: string,         // Full URL to issue
 *   dispatchedAt: Date,       // When item was dispatched
 *   dispatchedBy: string,     // Linear user ID (optional)
 *   target: string,           // Dispatch target: 'cli' (default), 'web', 'dash', or 'local' (Harbour)
 *   repo: string,             // Target repo name (from project description, optional)
 *   followUpTo: string,       // Original dispatchId to resume as a follow-up (optional, nullable, cli/web only). Stored + forwarded blindly; the downstream dispatcher owns session identity/liveness. See LIN-415.
 *   sessionId: string,        // Autopilot dispatchId that spawned this worker dispatch (optional, nullable, any target). Stored + forwarded blindly; groups worker dispatches into one autopilot session. See LIN-591.
 *   expiresAt: Date           // TTL-based expiration
 * }
 */

import crypto from 'crypto';

/**
 * Append the autopilot session self-reference block to a kickoff prompt (LIN-599).
 *
 * An autopilot run must stamp its OWN dispatch id as `sessionId` on every worker
 * dispatch it spawns, so those workers group into one session (LIN-591). But the
 * id is minted here in `addItem` — after the kickoff prompt was built (and in a
 * separate request), so the running autopilot has no other channel to learn it.
 * This is the only point where the minted id and the prompt coexist, so for
 * `kind: 'autopilot'` we append a short, self-describing block naming the id.
 *
 * The block is self-contained on purpose: the kickoff guide (Seam B) tells the
 * autopilot to forward `sessionId`, and this is where it reads the concrete value.
 *
 * @param {string} prompt - The kickoff prompt text
 * @param {string} sessionId - The autopilot's own dispatch id (`doc._id`)
 * @returns {string} The prompt with the session-id block appended
 */
function appendAutopilotSessionRef(prompt, sessionId) {
  return `${prompt}

---

## Your autopilot session id

This run's own dispatch id — your **session id** — is \`${sessionId}\`. Pass it as
\`sessionId\` on **every** worker dispatch you issue this run: every
\`POST /recommend-and-dispatch\`, every plain \`POST /dispatch\`, and any \`followUpTo\`
liveness nudge. That explicit link is what groups all the work you spawn into this
one autopilot session.`;
}

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
   * @param {string} [item.kind] - Stable task classification (a DISPATCH_KINDS value; defaults to 'custom')
   * @param {string} [item.issueId] - Issue UUID
   * @param {string} [item.issueIdentifier] - Issue identifier (e.g., "LIN-42")
   * @param {string} [item.issueTitle] - Issue title
   * @param {string} [item.issueUrl] - Full URL to issue
   * @param {string} [item.dispatchedBy] - Linear user ID
   * @param {string} [item.target] - Dispatch target: 'cli' (default), 'web', 'dash', or 'local' (Harbour)
   * @param {string} [item.repo] - Target repo name (from project description)
   * @param {string} [item.followUpTo] - Original dispatchId to resume as a follow-up (optional; stored + forwarded blindly)
   * @param {string} [item.sessionId] - Autopilot dispatchId that spawned this worker (optional; stored + forwarded blindly)
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
      // Stable task classification. The route layer resolves this (explicit
      // `kind` or derived from promptName); 'custom' is a defensive default for
      // any caller that doesn't supply one. See lib/prompt-templates.js.
      kind: item.kind || 'custom',
      issueId: item.issueId || null,
      issueIdentifier: item.issueIdentifier || null,
      issueTitle: item.issueTitle || null,
      issueUrl: item.issueUrl || null,
      dispatchedAt: now,
      dispatchedBy: item.dispatchedBy || null,
      target: item.target || 'cli',
      repo: item.repo || null,
      // Optional follow-up reference: the original dispatchId whose session the
      // downstream dispatcher should resume. Stored + forwarded blindly (no
      // liveness check here); cli/web only. See LIN-415.
      followUpTo: item.followUpTo || null,
      // Optional autopilot session reference: the dispatchId of the autopilot
      // run that spawned this worker. Stored + forwarded blindly (no liveness
      // check); any target, groups workers into one session. See LIN-591.
      sessionId: item.sessionId || null,
      expiresAt: new Date(now.getTime() + this.ttl * 1000)
    };

    // LIN-599: An autopilot kickoff can't know its own dispatch id until it's
    // minted just above — yet it must forward that id as `sessionId` on the
    // worker dispatches it spawns. Surface the id by appending a self-reference
    // block to the prompt. Gated on `kind === 'autopilot'`, so every other
    // dispatch (incl. the workers themselves, and collective fan-out) is left
    // byte-identical.
    if (doc.kind === 'autopilot') {
      doc.prompt = appendAutopilotSessionRef(doc.prompt, doc._id);
    }

    await this.collection.insertOne(doc);
    return doc;
  }

  /**
   * Looks up a single dispatch item by ID and reports its lifecycle status.
   *
   * Resolves across BOTH collections, because an item moves from the active
   * queue to history the moment a consumer takes it:
   *   - still in the active queue          → status 'queued', feedback []
   *   - archived in history (taken/etc.)   → its history status + feedback[]
   * Returns null if the ID is unknown to the workspace. This is the read
   * ("watch") half the autopilot orchestrator polls after dispatching.
   *
   * @param {string} urlKey - Workspace URL key (scopes the lookup)
   * @param {string} itemId - Item ID (UUID)
   * @returns {Promise<Object|null>} `{ id, status, target, issue*, feedback, ... }` or null
   */
  async getItemStatus(urlKey, itemId) {
    if (!urlKey || !itemId) {
      return null;
    }

    try {
      // Active queue first — present here means not yet taken.
      const active = await this.collection.findOne({ _id: itemId, urlKey });
      if (active) {
        return { ...this._formatItem(active), status: 'queued', feedback: [] };
      }

      // Otherwise it may have been taken (and possibly fed back on).
      if (this.historyCollection) {
        const hist = await this.historyCollection.findOne({ _id: itemId, urlKey });
        if (hist) {
          const formatted = this._formatHistoryItem(hist);
          return { ...formatted, feedback: formatted.feedback || [] };
        }
      }

      return null;
    } catch (err) {
      console.error('Error getting dispatch item status:', err);
      return null;
    }
  }

  /**
   * Lists all items in the queue for a workspace.
   * Excludes expired items.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {string} [options.issueIdentifier] - Restrict to one Linear issue
   *   (e.g. "LIN-42"). Pushed into the query so an issue-scoped read uses the
   *   {urlKey, issueIdentifier} index rather than scanning the whole queue (LIN-613).
   * @returns {Promise<Array>} Array of queued items
   */
  async listItems(urlKey, { issueIdentifier } = {}) {
    if (!urlKey) {
      return [];
    }

    try {
      const now = new Date();
      const query = { urlKey, expiresAt: { $gt: now } };
      if (issueIdentifier) query.issueIdentifier = issueIdentifier;
      const docs = await this.collection.find(query).toArray();

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
        prompt: doc.prompt || null,
        promptName: doc.promptName,
        kind: doc.kind || 'custom',
        issueId: doc.issueId,
        issueIdentifier: doc.issueIdentifier,
        issueTitle: doc.issueTitle,
        issueUrl: doc.issueUrl,
        dispatchedAt: doc.dispatchedAt,
        dispatchedBy: doc.dispatchedBy,
        target: doc.target || 'cli',
        repo: doc.repo || null,
        followUpTo: doc.followUpTo || null,
        sessionId: doc.sessionId || null,
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
   * @param {number} [options.limit] - Maximum items to return (omit for all)
   * @param {number} [options.offset=0] - Number of items to skip
   * @param {string} [options.issueIdentifier] - Restrict to one Linear issue
   *   (e.g. "LIN-42"). Pushed into the query so an issue-scoped read uses the
   *   {urlKey, issueIdentifier} index rather than pulling the whole workspace's
   *   30-day history and filtering in JS (LIN-613).
   * @param {Date} [options.since] - Restrict to rows whose `dispatchedAt` is at
   *   or after this instant. A selective predicate (NOT a row cap), pushed into
   *   the query so rows the feed would discard anyway — anything older than the
   *   30-day lookback, plus any cleanup-lag backlog — are never materialised.
   *   Correctness-identical to the `dispatchedAt` cutoff pipeline-loops applies
   *   in JS, just moved server-side to bound peak memory (LIN-622).
   * @returns {Promise<{items: Array, total: number}>} History items and total count
   */
  async listHistory(urlKey, { limit, offset = 0, issueIdentifier, since } = {}) {
    if (!urlKey || !this.historyCollection) {
      return { items: [], total: 0 };
    }

    try {
      const query = { urlKey };
      if (issueIdentifier) query.issueIdentifier = issueIdentifier;
      if (since) query.dispatchedAt = { $gte: since };
      const docs = await this.historyCollection.find(query).toArray();

      // Sort by resolvedAt descending
      docs.sort((a, b) => {
        const aTime = a.resolvedAt instanceof Date ? a.resolvedAt.getTime() : new Date(a.resolvedAt).getTime();
        const bTime = b.resolvedAt instanceof Date ? b.resolvedAt.getTime() : new Date(b.resolvedAt).getTime();
        return bTime - aTime;
      });

      const total = docs.length;
      const sliced = limit ? docs.slice(offset, offset + limit) : docs.slice(offset);

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
    const item = {
      id: doc._id,
      prompt: doc.prompt || null,
      promptName: doc.promptName,
      kind: doc.kind || 'custom',
      issueId: doc.issueId,
      issueIdentifier: doc.issueIdentifier,
      issueTitle: doc.issueTitle,
      issueUrl: doc.issueUrl,
      dispatchedAt: doc.dispatchedAt?.toISOString?.() || doc.dispatchedAt,
      target: doc.target || 'cli',
      repo: doc.repo || null,
      followUpTo: doc.followUpTo || null,
      sessionId: doc.sessionId || null,
      status: doc.status,
      resolvedAt: doc.resolvedAt?.toISOString?.() || doc.resolvedAt,
      takenByTokenLabel: doc.takenByTokenLabel || null
    };

    if (doc.feedback && doc.feedback.length > 0) {
      item.feedback = doc.feedback.map(f => ({
        message: f.message,
        url: f.url || null,
        urlLabel: f.urlLabel || null,
        timestamp: f.timestamp?.toISOString?.() || f.timestamp
      }));
    }

    return item;
  }

  /**
   * Adds feedback to a history item.
   * Only allowed on items with status 'taken' in the matching workspace.
   *
   * @param {string} itemId - History item ID
   * @param {string} urlKey - Workspace URL key
   * @param {Object} feedback - Feedback data
   * @param {string} feedback.message - Feedback message (required)
   * @param {string} [feedback.url] - Optional link URL
   * @param {string} [feedback.urlLabel] - Optional link display text
   * @param {string} tokenLabel - Label of the token posting feedback
   * @returns {Promise<{success: boolean, feedbackCount: number}|null>} Result or null if not found/unauthorized
   */
  async addFeedback(itemId, urlKey, { message, url, urlLabel }, tokenLabel) {
    if (!itemId || !urlKey || !this.historyCollection) {
      return null;
    }

    try {
      // Find the history item and verify ownership
      const doc = await this.historyCollection.findOne({ _id: itemId, urlKey });

      if (!doc) {
        return null;
      }

      if (doc.status !== 'taken') {
        return null;
      }

      // Strict ownership: only the token that took the item can post feedback
      if (doc.takenByTokenLabel !== tokenLabel) {
        return null;
      }

      const feedbackEntry = {
        message,
        url: url || null,
        urlLabel: urlLabel || null,
        timestamp: new Date()
      };

      const existing = doc.feedback || [];
      const updated = [...existing, feedbackEntry];

      await this.historyCollection.updateOne(
        { _id: itemId },
        { $set: { feedback: updated } }
      );

      return { success: true, feedbackCount: updated.length };
    } catch (err) {
      console.error('Error adding feedback:', err);
      return null;
    }
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
      kind: doc.kind || 'custom',
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
      // The seam poll/take hand to the consumer: deliver the follow-up reference
      // so the downstream dispatcher can resume the original session. See LIN-415.
      followUpTo: doc.followUpTo || null,
      // Deliver the autopilot session reference so the consumer can forward it
      // (e.g. the autopilot stamps it onto subsequent worker dispatches). See LIN-591.
      sessionId: doc.sessionId || null,
      expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt
    };
  }
}
