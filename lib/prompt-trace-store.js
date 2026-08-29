/**
 * Prompt trace storage module (LIN-578).
 *
 * Content-bearing sibling of llm-call-log.js. Where llm-call-log records only
 * metadata (model, tokens, cost, time), this store captures the FULL trace of an
 * AI recommendation generation — the rendered input sent to the model and the
 * resulting output — so bad outputs can be debugged and an eval set can be built
 * from real production traffic.
 *
 * Two stores, deliberately separate: llm-call-log stays content-free (it backs the
 * settings summary and is the /kpis privacy precedent), while this store carries
 * ticket content. They share the append-only / fire-and-forget / TTL-index shape
 * but never share state. Capture is always-on (no opt-in), workspace-scoped, and
 * wired ONLY at the two recommendation seams in lib/openrouter.js
 * (getRecommendation / getRecommendationStream) — never the generic chat path.
 *
 * Privacy boundary: traces hold ticket content, so they are NEVER exposed on the
 * proxy token-auth surface and NEVER fed to /kpis. Read access is session-auth
 * only (listTraces + an optional session-auth route).
 *
 * Schema:
 * {
 *   _id: string,             // Trace ID (UUID)
 *   urlKey: string|null,     // Workspace URL key (attribution; null if unknown)
 *   feature: string|null,    // Calling feature: recommend|...
 *   issueIdentifier: string|null, // Linear identifier when the trace is task-scoped
 *   timestamp: Date,         // When the generation completed
 *   expiresAt: Date,         // TTL for auto-cleanup (30 days)
 *   // --- input (content-bearing) ---
 *   metaPrompt: string|null, // Full rendered prompt actually sent to the LLM
 *   model: string|null,      // Model ID (echoed by OpenRouter, or requested)
 *   featureFlags: Object|null, // Generation feature flags
 *   providerUi: Object|null, // Provider capability context at generation time
 *   // --- output (content-bearing) ---
 *   rawContent: string|null, // Raw model output (markdown)
 *   reasoning: string|null,  // Parsed reasoning section
 *   prompt: string|null,     // Parsed prompt section (pre-grounding)
 *   finalPrompt: string|null,// Post-grounding prompt the user receives
 *   finishReason: string|null,
 *   truncated: boolean|null
 * }
 */

import crypto from 'crypto';
import { resolvePromptUi } from './prompt-formatters.js';

/**
 * Fixed coverage-limitation string for `summarizeProviderContext` (LIN-2357).
 * Only the two recommendation seams in lib/openrouter.js write a prompt trace —
 * the deterministic producers LIN-2353 also fixed (prompt template downloads,
 * kind-override recommend, feedback triage) write none, so a clean report is
 * evidence about the LLM recommend path only. All writer seams also stamp
 * `feature: 'recommend'`, so the verdict below is deliberately lane-agnostic —
 * it cannot distinguish the dispatch lane from the in-app lane, and restating
 * that as a field would be a phantom dimension this store cannot back.
 */
const PROVIDER_CONTEXT_BASIS = 'recommend-path traces only; deterministic prompt generations (prompt template downloads, kind-override recommend, feedback triage) are not traced';

/**
 * Single source of truth for "no provider-context data" (LIN-2357). Both this
 * store's own no-collection guard and the prompt-traces route's no-store
 * branch return this exact constant — never two independent empty shapes.
 */
export const EMPTY_PROVIDER_CONTEXT = Object.freeze({
  traces: 0,
  untracedContext: 0,
  divergent: 0,
  benign: 0,
  newestUntracedContextAt: null,
  expectedDisplayName: null,
  basis: PROVIDER_CONTEXT_BASIS
});

/**
 * Pure fold deriving the provider-context regression verdict for a set of
 * traces (LIN-2357). A `providerUi: null` trace can only mean the recording
 * seam did not thread the provider's capability object — a real provider's
 * `.ui` getter is never null (lib/providers/interface.js) and
 * getProviderForWorkspace never returns undefined (lib/providers/registry.js).
 * So the only question worth asking is whether that null was HARMLESS
 * (a Linear workspace, where null already renders identically to the real
 * provider) or a DIVERGENT regression (any other provider).
 *
 * The verdict is derived by calling the existing `resolvePromptUi` rule —
 * never a hardcoded `provider !== 'linear'` test — so this can never disagree
 * with what the prompt renderer actually produced.
 *
 * @param {Array<{providerUi, featureFlags, timestamp}>} traces
 * @param {Object|null} expectedUi - The workspace's real provider.ui
 * @returns {{traces:number, untracedContext:number, divergent:number, benign:number, newestUntracedContextAt:string|null}}
 */
export function providerContextVerdict(traces, expectedUi) {
  let untracedContext = 0;
  let divergent = 0;
  let benign = 0;
  let newestMs = 0;

  for (const trace of traces || []) {
    if (!trace || trace.providerUi != null) continue;
    untracedContext++;

    const flags = trace.featureFlags || {};
    const asIs = resolvePromptUi(flags, null);
    const expected = resolvePromptUi(flags, expectedUi);
    const isDivergent = JSON.stringify(asIs) !== JSON.stringify(expected);
    if (isDivergent) divergent++;
    else benign++;

    const ms = trace.timestamp instanceof Date ? trace.timestamp.getTime() : new Date(trace.timestamp).getTime();
    if (Number.isFinite(ms) && ms > newestMs) newestMs = ms;
  }

  return {
    traces: (traces || []).length,
    untracedContext,
    divergent,
    benign,
    newestUntracedContextAt: newestMs ? new Date(newestMs).toISOString() : null
  };
}

// Process-monotonic sequence stamped on every record. The listing sorts
// newest-first by `timestamp` (ms resolution), but two records written inside
// the same millisecond would tie — leaving their relative order at the mercy of
// the storage layer's scan order. `_seq` is a deterministic, strictly-increasing
// tiebreaker so a same-millisecond burst still lists in true write order. Across
// a restart the counter resets to 0, but timestamps then differ by far more than
// a millisecond, so cross-restart ties can't occur.
let traceSeq = 0;

/**
 * Prompt trace store for recording full AI recommendation generations.
 */
export class PromptTraceStore {
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
   * Records a prompt trace. Fire-and-forget: never throws to the caller, and
   * tolerates a missing collection or an insert failure (a recording error must
   * never fail or surface to an LLM call).
   *
   * @param {Object} trace - Trace content + attribution
   * @returns {Promise<Object>} The created record
   */
  async record(trace = {}) {
    const now = new Date();
    const str = (v) => (typeof v === 'string' ? v : v == null ? null : String(v));
    const obj = (v) => (v && typeof v === 'object' ? v : null);
    const doc = {
      _id: crypto.randomUUID(),
      _seq: traceSeq++,
      urlKey: trace.urlKey || null,
      feature: trace.feature || null,
      issueIdentifier: trace.issueIdentifier || null,
      timestamp: now,
      expiresAt: new Date(now.getTime() + this.ttl * 1000),
      // input
      metaPrompt: str(trace.metaPrompt),
      model: trace.model || null,
      featureFlags: obj(trace.featureFlags),
      providerUi: obj(trace.providerUi),
      // output
      rawContent: str(trace.rawContent),
      reasoning: str(trace.reasoning),
      prompt: str(trace.prompt),
      finalPrompt: str(trace.finalPrompt),
      finishReason: trace.finishReason || null,
      truncated: typeof trace.truncated === 'boolean' ? trace.truncated : null
    };

    if (!this.collection) return doc;

    try {
      await this.collection.insertOne(doc);
      return doc;
    } catch (err) {
      console.error('Error recording prompt trace:', err);
      return doc; // fire-and-forget
    }
  }

  /**
   * Lists recent prompt traces for a workspace, newest-first. Session-auth only:
   * this returns content-bearing records and must never back a proxy token-auth or
   * /kpis surface.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @returns {Promise<{items: Array, total: number}>}
   */
  async listTraces(urlKey, { limit = 50, offset = 0 } = {}) {
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
        if (bTime !== aTime) return bTime - aTime;
        // Same-millisecond tie: fall back to the monotonic write sequence so the
        // newest-first order stays deterministic (older records may predate _seq;
        // treat those as -1 so they sort last within the tie).
        const aSeq = typeof a._seq === 'number' ? a._seq : -1;
        const bSeq = typeof b._seq === 'number' ? b._seq : -1;
        return bSeq - aSeq;
      });

      const total = docs.length;
      const sliced = docs.slice(offset, offset + limit);

      return {
        items: sliced.map(doc => ({
          id: doc._id,
          urlKey: doc.urlKey,
          feature: doc.feature,
          issueIdentifier: doc.issueIdentifier,
          model: doc.model,
          featureFlags: doc.featureFlags,
          providerUi: doc.providerUi,
          metaPrompt: doc.metaPrompt,
          rawContent: doc.rawContent,
          reasoning: doc.reasoning,
          prompt: doc.prompt,
          finalPrompt: doc.finalPrompt,
          finishReason: doc.finishReason,
          truncated: doc.truncated,
          timestamp: doc.timestamp?.toISOString?.() || doc.timestamp
        })),
        total
      };
    } catch (err) {
      console.error('Error listing prompt traces:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Summarizes provider-context regression signal for a workspace (LIN-2357):
   * counts + a coverage basis, never trace content. Complements `listTraces` —
   * the disclosure this store's own privacy header calls for so a null
   * `providerUi` (a recording-seam regression, see `providerContextVerdict`)
   * doesn't sit unread the way it did before this ticket.
   *
   * Deliberately its OWN unpaginated query over the same `{urlKey, expiresAt}`
   * index `listTraces` uses (no new index): the disclosure must reflect the
   * workspace's whole non-expired window, not whatever page a caller of
   * `listTraces` happened to request. Projected to only the three fields the
   * fold needs — content-bearing fields (metaPrompt, rawContent, finalPrompt,
   * etc.) never leave the query, reinforcing this file's privacy header at the
   * read layer rather than relying on the fold to discard them.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {Object|null} [options.expectedUi] - The workspace's real provider.ui
   * @returns {Promise<Object>} Same shape as EMPTY_PROVIDER_CONTEXT
   */
  async summarizeProviderContext(urlKey, { expectedUi = null } = {}) {
    if (!urlKey || !this.collection) {
      return EMPTY_PROVIDER_CONTEXT;
    }

    try {
      const now = new Date();
      const docs = await this.collection.find(
        { urlKey, expiresAt: { $gt: now } },
        { projection: { providerUi: 1, featureFlags: 1, timestamp: 1 } }
      ).toArray();

      const verdict = providerContextVerdict(docs, expectedUi);
      return {
        ...verdict,
        expectedDisplayName: resolvePromptUi({}, expectedUi).displayName,
        basis: PROVIDER_CONTEXT_BASIS
      };
    } catch (err) {
      console.error('Error summarizing provider context:', err);
      return EMPTY_PROVIDER_CONTEXT;
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
      console.error('Error cleaning up prompt traces:', err);
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
      console.error('Error clearing prompt traces:', err);
      return 0;
    }
  }
}
