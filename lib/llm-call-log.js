/**
 * LLM call log storage module.
 * Records metadata for every LLM (OpenRouter) call: model, provider, tokens,
 * cost, finish reason, duration. Append-only, fire-and-forget — modelled on
 * proxy-events.js / agent-status-store.js.
 *
 * "We don't need the tokens, just the metadata" (LIN-418): tokens are recorded
 * because OpenRouter returns them alongside cost for free, but the point is a
 * durable per-call log of model/provider/cost/time, not token accounting.
 *
 * Schema:
 * {
 *   _id: string,             // Call ID (UUID)
 *   urlKey: string|null,     // Workspace URL key (attribution; null if unknown)
 *   feature: string|null,    // Calling feature: recommend|brief|recap|roadmap|task-chat|...
 *   via: string|null,        // LIN-2620: transport lane, e.g. "proxy" — absent/null for
 *                            // every existing (browser-session) call site
 *   issueIdentifier: string|null, // Linear identifier when the call is task-scoped
 *   model: string|null,      // Model ID echoed by OpenRouter (or requested)
 *   provider: string|null,   // Upstream provider that served the request
 *   promptTokens: number|null,
 *   completionTokens: number|null,
 *   totalTokens: number|null,
 *   cost: number|null,       // USD, as reported by OpenRouter usage accounting
 *   finishReason: string|null,
 *   durationMs: number|null, // Wall-clock time of the call, measured locally
 *   timestamp: Date,         // When the call completed
 *   expiresAt: Date          // TTL for auto-cleanup (30 days)
 * }
 */

import crypto from 'crypto';

/**
 * LLM call log store for recording OpenRouter call metadata.
 */
export class LlmCallLogStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection
   * @param {number} [options.ttl=2592000] - Record TTL in seconds (default: 30 days)
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.ttl = options.ttl || 30 * 24 * 60 * 60; // 30 days
  }

  /**
   * Records an LLM call. Fire-and-forget: never throws to the caller.
   *
   * @param {Object} call - Call metadata
   * @returns {Promise<Object>} The created record
   */
  async record(call = {}) {
    const now = new Date();
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const doc = {
      _id: crypto.randomUUID(),
      urlKey: call.urlKey || null,
      feature: call.feature || null,
      via: call.via || null,
      issueIdentifier: call.issueIdentifier || null,
      model: call.model || null,
      provider: call.provider || null,
      promptTokens: num(call.promptTokens),
      completionTokens: num(call.completionTokens),
      totalTokens: num(call.totalTokens),
      cost: num(call.cost),
      finishReason: call.finishReason || null,
      durationMs: num(call.durationMs),
      timestamp: now,
      expiresAt: new Date(now.getTime() + this.ttl * 1000)
    };

    if (!this.collection) return doc;

    try {
      await this.collection.insertOne(doc);
      return doc;
    } catch (err) {
      console.error('Error recording LLM call:', err);
      return doc; // fire-and-forget
    }
  }

  /**
   * Lists recent LLM calls for a workspace.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @returns {Promise<{items: Array, total: number}>}
   */
  async listCalls(urlKey, { limit = 50, offset = 0 } = {}) {
    if (!urlKey || !this.collection) {
      return { items: [], total: 0 };
    }

    try {
      const now = new Date();
      const docs = await this.collection.find({
        urlKey,
        expiresAt: { $gt: now }
      }).toArray();

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
          feature: doc.feature,
          issueIdentifier: doc.issueIdentifier,
          model: doc.model,
          provider: doc.provider,
          promptTokens: doc.promptTokens,
          completionTokens: doc.completionTokens,
          totalTokens: doc.totalTokens,
          cost: doc.cost,
          finishReason: doc.finishReason,
          durationMs: doc.durationMs,
          timestamp: doc.timestamp?.toISOString?.() || doc.timestamp
        })),
        total
      };
    } catch (err) {
      console.error('Error listing LLM calls:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Aggregate simple KPIs for a workspace over the non-expired window.
   *
   * Deliberately small — counts and sums only, no per-call detail — so it can
   * back a compact settings-page summary. Numbers absent from a record (e.g. a
   * provider that didn't report cost) are skipped, never counted as zero, so a
   * partial record can't understate the total silently.
   *
   * `latencyByFeatureModel` (LIN-1988) applies the same skip discipline to
   * `durationMs`: a call with no recorded duration contributes to no group's
   * array at all (not folded to 0), and a (feature, model) pair with zero
   * timed calls produces no row (not a zero-count row). Percentiles use
   * nearest-rank (1-indexed, ceiling): for a sorted array `a` of length `n`,
   * the p-th percentile is `a[ceil(p * n) - 1]`. Rows are sorted descending
   * by p90Ms (ties by feature, then model, ascending) so the shape itself
   * encodes "which surface is slow" without the render layer re-deriving it.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<{totalCalls:number, totalCost:number, totalTokens:number, byFeature:Array<{feature:string, calls:number, cost:number}>, lastCallAt:string|null, latencyByFeatureModel:Array<{feature:string, model:string, count:number, p50Ms:number, p90Ms:number, maxMs:number}>}>}
   */
  async summarize(urlKey) {
    const empty = { totalCalls: 0, totalCost: 0, totalTokens: 0, byFeature: [], lastCallAt: null, latencyByFeatureModel: [] };
    if (!urlKey || !this.collection) return empty;

    try {
      const now = new Date();
      const docs = await this.collection.find({ urlKey, expiresAt: { $gt: now } }).toArray();
      if (docs.length === 0) return empty;

      let totalCost = 0;
      let totalTokens = 0;
      let lastCallMs = 0;
      const features = new Map();
      const latencyGroups = new Map();
      for (const doc of docs) {
        const cost = typeof doc.cost === 'number' && Number.isFinite(doc.cost) ? doc.cost : 0;
        const tokens = typeof doc.totalTokens === 'number' && Number.isFinite(doc.totalTokens) ? doc.totalTokens : 0;
        totalCost += cost;
        totalTokens += tokens;

        const ms = doc.timestamp instanceof Date ? doc.timestamp.getTime() : new Date(doc.timestamp).getTime();
        if (Number.isFinite(ms) && ms > lastCallMs) lastCallMs = ms;

        const key = doc.feature || 'unknown';
        const acc = features.get(key) || { feature: key, calls: 0, cost: 0 };
        acc.calls += 1;
        acc.cost += cost;
        features.set(key, acc);

        if (typeof doc.durationMs === 'number' && Number.isFinite(doc.durationMs)) {
          const feature = doc.feature || 'unknown';
          const model = doc.model || 'unknown';
          const latencyKey = `${feature} ${model}`;
          const durations = latencyGroups.get(latencyKey) || { feature, model, durations: [] };
          durations.durations.push(doc.durationMs);
          latencyGroups.set(latencyKey, durations);
        }
      }

      const byFeature = [...features.values()].sort((a, b) => b.calls - a.calls);

      const latencyByFeatureModel = [...latencyGroups.values()].map(({ feature, model, durations }) => {
        const sorted = [...durations].sort((a, b) => a - b);
        const n = sorted.length;
        const percentile = (p) => sorted[Math.min(n - 1, Math.ceil(p * n) - 1)];
        return {
          feature,
          model,
          count: n,
          p50Ms: percentile(0.5),
          p90Ms: percentile(0.9),
          maxMs: sorted[n - 1]
        };
      }).sort((a, b) => {
        if (b.p90Ms !== a.p90Ms) return b.p90Ms - a.p90Ms;
        if (a.feature !== b.feature) return a.feature < b.feature ? -1 : 1;
        return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
      });

      return {
        totalCalls: docs.length,
        totalCost,
        totalTokens,
        byFeature,
        lastCallAt: lastCallMs ? new Date(lastCallMs).toISOString() : null,
        latencyByFeatureModel
      };
    } catch (err) {
      console.error('Error summarizing LLM call log:', err);
      return empty;
    }
  }

  /**
   * Aggregate LLM call costs for one issue (LIN-1775) — the per-task
   * counterpart of `summarize()`'s per-workspace KPIs.
   *
   * Unlike `summarize()`, a null `cost` is NOT folded to 0: it is counted in
   * `unpricedCalls` instead. Folding it to 0 would make a partial figure look
   * complete (the exact silent-partial `/cost` is designed never to produce).
   *
   * @param {string} urlKey - Workspace URL key
   * @param {string} issueIdentifier - Issue identifier the calls are attributed to
   * @returns {Promise<{calls:number, costUsd:number, unpricedCalls:number, byFeature:Array<{feature:string, calls:number, costUsd:number}>}>}
   */
  async summarizeByIssue(urlKey, issueIdentifier) {
    const empty = { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] };
    if (!urlKey || !issueIdentifier || !this.collection) return empty;

    try {
      const now = new Date();
      const docs = await this.collection.find({ urlKey, issueIdentifier, expiresAt: { $gt: now } }).toArray();
      if (docs.length === 0) return empty;

      let costUsd = 0;
      let unpricedCalls = 0;
      const features = new Map();
      for (const doc of docs) {
        const hasCost = typeof doc.cost === 'number' && Number.isFinite(doc.cost);
        if (hasCost) costUsd += doc.cost;
        else unpricedCalls += 1;

        const key = doc.feature || 'unknown';
        const acc = features.get(key) || { feature: key, calls: 0, costUsd: 0 };
        acc.calls += 1;
        if (hasCost) acc.costUsd += doc.cost;
        features.set(key, acc);
      }

      return {
        calls: docs.length,
        costUsd,
        unpricedCalls,
        byFeature: [...features.values()].sort((a, b) => b.calls - a.calls)
      };
    } catch (err) {
      console.error('Error summarizing LLM call log by issue:', err);
      return empty;
    }
  }

  /**
   * Feature-scoped cost aggregation (LIN-2702) — the pre-run estimate
   * Phase 3 renders. Unlike `summarizeByIssue`'s literal-zero empty return,
   * this mirrors `lib/task-cost.js`'s `noLineage` shape: the unknown carrier
   * is published alongside the number and gates it to `null`, since a
   * 30-day TTL window with zero priced rows is genuine absence of history,
   * not evidence of zero spend — it would otherwise read as a confirmed
   * $0 rather than "no data". `cost: 0` rows are genuinely priced
   * (`Number.isFinite(0)` is true) and average to a real `$0.00`,
   * `unknown: false` — one number cannot carry both states, hence the flag.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {string} feature - Calling feature (e.g. 'scan')
   * @returns {Promise<{calls:number, pricedCalls:number, meanUsd:number|null, unknown:boolean}>}
   */
  async summarizeByFeature(urlKey, feature) {
    const empty = { calls: 0, pricedCalls: 0, meanUsd: null, unknown: true };
    if (!urlKey || !feature || !this.collection) return empty;

    try {
      const now = new Date();
      const docs = await this.collection.find({ urlKey, feature, expiresAt: { $gt: now } }).toArray();

      let pricedCalls = 0;
      let pricedSum = 0;
      for (const doc of docs) {
        const hasCost = typeof doc.cost === 'number' && Number.isFinite(doc.cost);
        if (hasCost) {
          pricedCalls += 1;
          pricedSum += doc.cost;
        }
      }

      if (pricedCalls === 0) return { calls: docs.length, pricedCalls: 0, meanUsd: null, unknown: true };

      return { calls: docs.length, pricedCalls, meanUsd: pricedSum / pricedCalls, unknown: false };
    } catch (err) {
      console.error('Error summarizing LLM call log by feature:', err);
      return empty;
    }
  }

  /**
   * Removes expired records.
   * @returns {Promise<number>} Number of records removed
   */
  async cleanup() {
    if (!this.collection) return 0;
    try {
      const result = await this.collection.deleteMany({ expiresAt: { $lt: new Date() } });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error cleaning up LLM call log:', err);
      return 0;
    }
  }

  /**
   * Clears all records for a workspace (used in tests).
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of records removed
   */
  async clear(urlKey) {
    if (!this.collection) return 0;
    try {
      const result = await this.collection.deleteMany(urlKey ? { urlKey } : {});
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing LLM call log:', err);
      return 0;
    }
  }
}
