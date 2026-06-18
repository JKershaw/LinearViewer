/**
 * Linear API call log storage module.
 *
 * Records one lightweight row per outbound Linear GraphQL request: its outcome
 * (ok / upstream / auth / client_error / server_error / internal) and duration.
 * Append-only, fire-and-forget — modelled on llm-call-log.js / proxy-events.js.
 *
 * Motivation (LIN-538 RCA): a production incident where every Linear call failed
 * with undici "Premature close" was invisible until someone read the dyno logs —
 * the dashboards that still worked (/kpis) had no view of Linear request volume
 * or its failure rate. This log makes both visible: a burst of calls and a spike
 * of `upstream` failures show up side by side on the public KPIs page.
 *
 * Privacy: this feeds the public, unauthenticated /kpis page, so a row carries
 * ONLY an app-defined outcome label + duration + timestamp — never tokens,
 * workspace keys, query text, variables, or response content.
 *
 * Schema:
 * {
 *   _id: string,         // Call ID (UUID)
 *   outcome: string,     // ok | upstream | auth | client_error | server_error | internal
 *   status: number|null, // HTTP status when a response arrived (null on network failure)
 *   durationMs: number|null,
 *   timestamp: Date,
 *   expiresAt: Date      // TTL for auto-cleanup (30 days)
 * }
 */

import crypto from 'crypto';

/** Outcome label vocabulary, in display order. Stable for kpi-stats bucketing. */
export const LINEAR_CALL_OUTCOMES = ['ok', 'upstream', 'auth', 'client_error', 'server_error', 'internal'];

/**
 * Map a resolved HTTP status to an outcome label (the response-arrived path).
 * The network-failure path is classified by the caller via classifyUpstreamError.
 * @param {number} status
 * @returns {string}
 */
export function outcomeForStatus(status) {
  if (status < 300) return 'ok';
  if (status === 401 || status === 403) return 'auth';
  if (status < 500) return 'client_error';
  return 'server_error';
}

/**
 * Linear call log store. record() is the only write path; kpi-stats reads the
 * collection directly (same convention as the other KPI source collections).
 */
export class LinearCallLogStore {
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
   * Records one Linear call. Fire-and-forget: never throws to the caller, so a
   * logging hiccup can never break (or slow the failure path of) a Linear fetch.
   *
   * @param {Object} call
   * @param {string} call.outcome - one of LINEAR_CALL_OUTCOMES
   * @param {number|null} [call.status]
   * @param {number|null} [call.durationMs]
   * @returns {Promise<Object|null>} the created record, or null if it could not be written
   */
  async record(call = {}) {
    try {
      if (!this.collection) return null;
      const now = new Date();
      const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const doc = {
        _id: crypto.randomUUID(),
        outcome: LINEAR_CALL_OUTCOMES.includes(call.outcome) ? call.outcome : 'internal',
        status: num(call.status),
        durationMs: num(call.durationMs),
        timestamp: now,
        expiresAt: new Date(now.getTime() + this.ttl * 1000)
      };
      await this.collection.insertOne(doc);
      return doc;
    } catch {
      return null; // fire-and-forget
    }
  }
}
