/**
 * Free Tier Usage Store
 *
 * Tracks daily prompt usage for workspaces using the free tier.
 * Enforces per-workspace daily limits and global hourly limits.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,              // "<urlKey>:<YYYY-MM-DD>" or "global:<YYYY-MM-DDTHH>"
 *   urlKey: string,           // Workspace URL key (null for global records)
 *   date: string,             // "YYYY-MM-DD" UTC date (or "YYYY-MM-DDTHH" for hourly)
 *   count: number,            // Prompts used
 *   lastUsedAt: Date,         // Timestamp of last prompt
 *   expiresAt: Date           // TTL for auto-cleanup
 * }
 */

/**
 * Placeholder free-tier run limit: fresh runs per account per UTC day. This is
 * the plan's only constant and is explicitly a placeholder until the hosted
 * free-tier / pricing work (LIN-1645) picks a real number (LIN-3238 Q9). Override
 * with the `runLimit` constructor option (server.js wires FREE_TIER_RUN_LIMIT).
 */
export const DEFAULT_RUN_LIMIT = 10;

/**
 * Free tier usage store for tracking and enforcing rate limits.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
export class FreeTierStore {
  /**
   * Creates a new free tier store instance.
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection for storing usage records
   * @param {number} [options.dailyLimit=20] - Max prompts per workspace per day
   * @param {number} [options.hourlyLimit=50] - Max total free-tier prompts per hour (all workspaces)
   * @param {number} [options.workspaceTtlDays=7] - TTL in days for workspace usage records
   * @param {number} [options.globalTtlHours=24] - TTL in hours for global hourly records
   * @param {number} [options.runLimit=DEFAULT_RUN_LIMIT] - Max fresh runs per account per UTC day (LIN-3238)
   * @param {Object} [options.dispatchStore] - Dispatch store exposing countFreshRunsSince (LIN-3238)
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.dailyLimit = options.dailyLimit || 20;
    this.hourlyLimit = options.hourlyLimit || 50;
    this.workspaceTtlMs = (options.workspaceTtlDays || 7) * 24 * 60 * 60 * 1000;
    this.globalTtlMs = (options.globalTtlHours || 24) * 60 * 60 * 1000;
    this.runLimit = options.runLimit || DEFAULT_RUN_LIMIT;
    this.dispatchStore = options.dispatchStore || null;
  }

  /**
   * Get the current UTC date string (YYYY-MM-DD).
   * @returns {string}
   */
  _getDateKey() {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Get the current UTC hour string (YYYY-MM-DDTHH).
   * @returns {string}
   */
  _getHourKey() {
    return new Date().toISOString().slice(0, 13);
  }

  /**
   * Storage key for the global hourly counter: `global:<YYYY-MM-DDTHH>`.
   *
   * Built here once and shared by canUse/tryUse/recordUsage (LIN-689). `tryUse`
   * used to build `global:<hour>` and then prefix it again on write
   * (`global:global:<hour>`), so the row it incremented was never the row the
   * guard read and the hourly cap never fired.
   *
   * @param {string} [hour] - UTC hour key; defaults to the current hour
   * @returns {string}
   */
  _getGlobalHourKey(hour = this._getHourKey()) {
    return `global:${hour}`;
  }

  /**
   * Get the UTC midnight reset time for today.
   * @returns {string} ISO string for next midnight UTC
   */
  _getResetsAt() {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.toISOString();
  }

  /**
   * UTC midnight for the current day — the inclusive lower bound of the run
   * count window. Shares the UTC day with `_getDateKey`/`_getResetsAt`.
   * @returns {Date}
   */
  _getDayStart() {
    return new Date(`${this._getDateKey()}T00:00:00.000Z`);
  }

  /**
   * Check if a workspace can make a free-tier request (read-only).
   * Checks global hourly limit first (fail fast), then workspace daily limit.
   * For non-mutating checks (e.g. status endpoint). Use tryUse() for actual requests.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<{allowed: boolean, reason?: string, remaining: number, limit: number, resetsAt: string}>}
   */
  async canUse(urlKey) {
    if (!urlKey) {
      return { allowed: false, reason: 'Missing workspace', remaining: 0, limit: this.dailyLimit, resetsAt: this._getResetsAt() };
    }

    try {
      // Check global hourly limit first (fail fast)
      const hourKey = this._getGlobalHourKey();
      const hourDoc = await this.collection.findOne({ _id: hourKey });
      const hourCount = hourDoc?.count || 0;

      if (hourCount >= this.hourlyLimit) {
        return {
          allowed: false,
          reason: 'Service busy, try again later',
          remaining: 0,
          limit: this.dailyLimit,
          resetsAt: this._getResetsAt()
        };
      }

      // Check workspace daily limit
      const dateKey = this._getDateKey();
      const docId = `${urlKey}:${dateKey}`;
      const doc = await this.collection.findOne({ _id: docId });
      const used = doc?.count || 0;
      const remaining = Math.max(0, this.dailyLimit - used);

      if (used >= this.dailyLimit) {
        return {
          allowed: false,
          reason: 'Daily limit reached, resets at midnight UTC',
          remaining: 0,
          limit: this.dailyLimit,
          resetsAt: this._getResetsAt()
        };
      }

      return {
        allowed: true,
        remaining,
        limit: this.dailyLimit,
        resetsAt: this._getResetsAt()
      };
    } catch (err) {
      console.error('FreeTierStore.canUse error:', err);
      // Fail closed - deny the request if we can't verify limits
      return { allowed: false, reason: 'Unable to verify usage limits, try again later', remaining: 0, limit: this.dailyLimit, resetsAt: this._getResetsAt() };
    }
  }

  /**
   * Atomically check and record a usage in a single operation.
   * Increments workspace daily counter first, then checks if limit was exceeded.
   * If exceeded, decrements back and returns denied. This prevents race conditions
   * between concurrent requests.
   *
   * Also increments the global hourly counter.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<{allowed: boolean, reason?: string, remaining: number, limit: number, resetsAt: string}>}
   */
  async tryUse(urlKey) {
    if (!urlKey) {
      return { allowed: false, reason: 'Missing workspace', remaining: 0, limit: this.dailyLimit, resetsAt: this._getResetsAt() };
    }

    const now = new Date();
    const hour = this._getHourKey();
    const hourKey = this._getGlobalHourKey(hour);

    try {
      // Check global hourly limit first (fail fast, read-only)
      const hourDoc = await this.collection.findOne({ _id: hourKey });
      const hourCount = hourDoc?.count || 0;

      if (hourCount >= this.hourlyLimit) {
        return {
          allowed: false,
          reason: 'Service busy, try again later',
          remaining: 0,
          limit: this.dailyLimit,
          resetsAt: this._getResetsAt()
        };
      }

      // Atomically increment workspace daily counter and check result
      const dateKey = this._getDateKey();
      const docId = `${urlKey}:${dateKey}`;
      const updated = await this.collection.findOneAndUpdate(
        { _id: docId },
        {
          $inc: { count: 1 },
          $set: { lastUsedAt: now },
          $setOnInsert: {
            urlKey,
            date: dateKey,
            expiresAt: new Date(now.getTime() + this.workspaceTtlMs)
          }
        },
        { upsert: true, returnDocument: 'after' }
      );

      const newCount = updated?.count || 1;

      // If we exceeded the limit, rollback the increment
      if (newCount > this.dailyLimit) {
        await this.collection.findOneAndUpdate(
          { _id: docId },
          { $inc: { count: -1 } }
        );
        return {
          allowed: false,
          reason: 'Daily limit reached, resets at midnight UTC',
          remaining: 0,
          limit: this.dailyLimit,
          resetsAt: this._getResetsAt()
        };
      }

      // Also atomically increment global hourly counter
      await this.collection.findOneAndUpdate(
        { _id: hourKey },
        {
          $inc: { count: 1 },
          $set: { lastUsedAt: now },
          $setOnInsert: {
            urlKey: null,
            date: hour,
            expiresAt: new Date(now.getTime() + this.globalTtlMs)
          }
        },
        { upsert: true, returnDocument: 'after' }
      );

      const remaining = Math.max(0, this.dailyLimit - newCount);
      return {
        allowed: true,
        remaining,
        limit: this.dailyLimit,
        resetsAt: this._getResetsAt()
      };
    } catch (err) {
      console.error('FreeTierStore.tryUse error:', err);
      // Fail closed - deny the request if we can't verify limits
      return { allowed: false, reason: 'Unable to verify usage limits, try again later', remaining: 0, limit: this.dailyLimit, resetsAt: this._getResetsAt() };
    }
  }

  /**
   * Record a usage atomically (for test helpers that need to add usage without checking limits).
   * Uses findOneAndUpdate with $inc to prevent race conditions.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<void>}
   */
  async recordUsage(urlKey) {
    if (!urlKey) return;

    const now = new Date();
    const dateKey = this._getDateKey();
    const hour = this._getHourKey();
    const globalId = this._getGlobalHourKey(hour);

    try {
      // Atomically increment workspace daily counter
      const docId = `${urlKey}:${dateKey}`;
      await this.collection.findOneAndUpdate(
        { _id: docId },
        {
          $inc: { count: 1 },
          $set: { lastUsedAt: now },
          $setOnInsert: {
            urlKey,
            date: dateKey,
            expiresAt: new Date(now.getTime() + this.workspaceTtlMs)
          }
        },
        { upsert: true, returnDocument: 'after' }
      );

      // Atomically increment global hourly counter
      await this.collection.findOneAndUpdate(
        { _id: globalId },
        {
          $inc: { count: 1 },
          $set: { lastUsedAt: now },
          $setOnInsert: {
            urlKey: null,
            date: hour,
            expiresAt: new Date(now.getTime() + this.globalTtlMs)
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
    } catch (err) {
      // Log but don't fail - usage recording is best-effort
      console.error('FreeTierStore.recordUsage error:', err);
    }
  }

  /**
   * Get current usage info for a workspace (for display in UI).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<{used: number, limit: number, remaining: number, resetsAt: string}>}
   */
  async getUsage(urlKey) {
    if (!urlKey) {
      return { used: 0, limit: this.dailyLimit, remaining: this.dailyLimit, resetsAt: this._getResetsAt() };
    }

    try {
      const dateKey = this._getDateKey();
      const docId = `${urlKey}:${dateKey}`;
      const doc = await this.collection.findOne({ _id: docId });
      const used = doc?.count || 0;

      return {
        used,
        limit: this.dailyLimit,
        remaining: Math.max(0, this.dailyLimit - used),
        resetsAt: this._getResetsAt()
      };
    } catch (err) {
      console.error('FreeTierStore.getUsage error:', err);
      return { used: 0, limit: this.dailyLimit, remaining: this.dailyLimit, resetsAt: this._getResetsAt() };
    }
  }

  /**
   * Read the caller's fresh-run count over the UTC day (LIN-3238). Thin wrapper
   * over the injected dispatch store so `getRunUsage` and `checkRun` share one
   * predicate and one read (the factory gate and the quota read both go through
   * here). Deliberately does NOT read `task-mode-events` or any task-mode store.
   *
   * @param {string[]} accountIds - The account merge group's ids
   * @returns {Promise<number|null>} The count, or null when it could not be read
   * @private
   */
  async _readRunCount(accountIds) {
    if (!this.dispatchStore || typeof this.dispatchStore.countFreshRunsSince !== 'function') {
      return null;
    }
    try {
      return await this.dispatchStore.countFreshRunsSince(accountIds, this._getDayStart());
    } catch (err) {
      console.error('FreeTierStore run-count read error:', err);
      return null;
    }
  }

  /**
   * Current run usage for the account merge group (LIN-3238) — the read behind
   * the quota endpoint. `runsUsed` is null when the count could not be read, and
   * `remaining` is then 0 rather than a fabricated allowance.
   *
   * @param {string[]} accountIds - The account merge group's ids
   * @returns {Promise<{runsUsed: number|null, limit: number, remaining: number, resetsAt: string}>}
   */
  async getRunUsage(accountIds) {
    const runsUsed = await this._readRunCount(accountIds);
    return {
      runsUsed,
      limit: this.runLimit,
      remaining: runsUsed == null ? 0 : Math.max(0, this.runLimit - runsUsed),
      resetsAt: this._getResetsAt()
    };
  }

  /**
   * Enforce the per-account run limit (LIN-3238). Allowed under the limit,
   * refused with the usage at/over it, unverified when the count could not be
   * read (the caller fails closed). One predicate, one store method.
   *
   * @param {string[]} accountIds - The account merge group's ids
   * @returns {Promise<{allowed: boolean, reason?: 'limit'|'unverified', runsUsed: number|null, limit: number, remaining: number, resetsAt: string}>}
   */
  async checkRun(accountIds) {
    const runsUsed = await this._readRunCount(accountIds);
    const limit = this.runLimit;
    const resetsAt = this._getResetsAt();

    if (runsUsed == null) {
      return { allowed: false, reason: 'unverified', runsUsed: null, limit, remaining: 0, resetsAt };
    }
    const remaining = Math.max(0, limit - runsUsed);
    if (runsUsed >= limit) {
      return { allowed: false, reason: 'limit', runsUsed, limit, remaining: 0, resetsAt };
    }
    return { allowed: true, runsUsed, limit, remaining, resetsAt };
  }

  /**
   * Removes all expired records from the collection.
   * Called periodically to prevent stale data buildup.
   *
   * @returns {Promise<number>} Number of records removed
   */
  async cleanup() {
    try {
      const result = await this.collection.deleteMany({
        expiresAt: { $lt: new Date() }
      });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('FreeTierStore cleanup error:', err);
      return 0;
    }
  }

  /**
   * Clears all records for a workspace and global counters (used in tests).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of records removed
   */
  async clear(urlKey) {
    try {
      // Clear workspace records
      const wsResult = await this.collection.deleteMany({ urlKey });
      // Also clear global hourly records
      const globalResult = await this.collection.deleteMany({ urlKey: null });
      return (wsResult.deletedCount || 0) + (globalResult.deletedCount || 0);
    } catch (err) {
      console.error('Error clearing free tier usage:', err);
      return 0;
    }
  }
}
