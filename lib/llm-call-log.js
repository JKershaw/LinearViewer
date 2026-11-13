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
 *                            // every existing (browser-session) call site; LIN-3864:
 *                            // "precompute" for the background session-summary rows
 *   issueIdentifier: string|null, // Linear identifier when the call is task-scoped
 *   model: string|null,      // Model ID echoed by OpenRouter (or requested)
 *   provider: string|null,   // Upstream provider that served the request
 *   promptTokens: number|null,
 *   completionTokens: number|null,
 *   totalTokens: number|null,
 *   cost: number|null,       // USD, as reported by OpenRouter usage accounting
 *   finishReason: string|null,
 *   maxTokens: number|null,       // LIN-3359: the max_tokens cap the call requested
 *   reasoningTokens: number|null, // LIN-3359: completion_tokens_details.reasoning_tokens
 *   durationMs: number|null, // Wall-clock time of the call, measured locally
 *   timestamp: Date,         // When the call completed
 * }
 */

import crypto from 'crypto';
import { readHorizonStart } from './read-horizon.js';

/**
 * The call telemetry that is not cost (LIN-418, LIN-1988): the call count, tokens, the last call, and latency per
 * (feature, model). Pure over the docs `listInHorizon` returns. The cost figure is never here: lib/cost-read-calls.js owns the calls figure.
 *
 * A call with no recorded duration contributes to no latency group (not folded to 0); a (feature, model) pair with
 * no timed call produces no row. Percentiles are nearest-rank (for a sorted array of length n, the p-th percentile
 * is a[ceil(p * n) - 1]). Rows are sorted descending by p90Ms, ties by feature then model, so the shape itself says
 * which surface is slow.
 *
 * @param {Array<Object>} docs
 * @returns {{totalCalls:number, totalTokens:number, lastCallAt:string|null, latencyByFeatureModel:Array<{feature:string, model:string, count:number, p50Ms:number, p90Ms:number, maxMs:number}>}}
 */
export function callTelemetryOf(docs) {
  let totalTokens = 0;
  let lastCallMs = 0;
  const latencyGroups = new Map();
  for (const doc of docs || []) {
    const tokens = typeof doc.totalTokens === 'number' && Number.isFinite(doc.totalTokens) ? doc.totalTokens : 0;
    totalTokens += tokens;

    const ms = doc.timestamp instanceof Date ? doc.timestamp.getTime() : new Date(doc.timestamp).getTime();
    if (Number.isFinite(ms) && ms > lastCallMs) lastCallMs = ms;

    if (typeof doc.durationMs === 'number' && Number.isFinite(doc.durationMs)) {
      const feature = doc.feature || 'unknown';
      const model = doc.model || 'unknown';
      const latencyKey = `${feature} ${model}`;
      const durations = latencyGroups.get(latencyKey) || { feature, model, durations: [] };
      durations.durations.push(doc.durationMs);
      latencyGroups.set(latencyKey, durations);
    }
  }

  const latencyByFeatureModel = [...latencyGroups.values()].map(({ feature, model, durations }) => {
    const sorted = [...durations].sort((a, b) => a - b);
    const n = sorted.length;
    const percentile = (p) => sorted[Math.min(n - 1, Math.ceil(p * n) - 1)];
    return { feature, model, count: n, p50Ms: percentile(0.5), p90Ms: percentile(0.9), maxMs: sorted[n - 1] };
  }).sort((a, b) => {
    if (b.p90Ms !== a.p90Ms) return b.p90Ms - a.p90Ms;
    if (a.feature !== b.feature) return a.feature < b.feature ? -1 : 1;
    return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
  });

  return {
    totalCalls: (docs || []).length,
    totalTokens,
    lastCallAt: lastCallMs ? new Date(lastCallMs).toISOString() : null,
    latencyByFeatureModel
  };
}

/**
 * LLM call log store for recording OpenRouter call metadata.
 */
export class LlmCallLogStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection
   */
  constructor(options = {}) {
    this.collection = options.collection;
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
      maxTokens: num(call.maxTokens),
      reasoningTokens: num(call.reasoningTokens),
      durationMs: num(call.durationMs),
      // LIN-4358: 'length' on the call streamChat re-sent after a length stop, so a
      // recovered wrong budget guess shows in the log instead of looking like two calls.
      retry: call.retry || null,
      timestamp: now
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
   * The workspace's calls in a window, as the raw docs (LIN-3855, LIN-4179). The store returns docs only: every
   * cost figure is summed by the one read (lib/cost-read-calls.js `readCalls` / `appCallsOf` / `callsSurfaceOf`), and a
   * null cost stays null here, so an unpriced call is never counted as $0.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [filters]
   * @param {string} [filters.issueIdentifier] - only calls tagged with this issue (LIN-1775's per-task read)
   * @param {string} [filters.feature] - only calls from this feature (e.g. 'scan')
   * @param {Date} [filters.since] - lower bound on `timestamp`; the 30-day read horizon when omitted (LIN-3161).
   *   The call log is lifetime-retained (LIN-3163), so this is a read window, not a retention predicate.
   * @returns {Promise<Array<Object>>} the call docs, in the store's order; [] on error (logged, never thrown)
   */
  async listInHorizon(urlKey, { issueIdentifier, feature, since } = {}) {
    if (!urlKey || !this.collection) return [];
    if (issueIdentifier !== undefined && !issueIdentifier) return [];
    if (feature !== undefined && !feature) return [];
    const query = { urlKey, timestamp: { $gte: since ?? readHorizonStart() } };
    if (issueIdentifier !== undefined) query.issueIdentifier = issueIdentifier;
    if (feature !== undefined) query.feature = feature;
    try {
      return await this.collection.find(query).toArray();
    } catch (err) {
      console.error('Error reading LLM call log:', err);
      return [];
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
