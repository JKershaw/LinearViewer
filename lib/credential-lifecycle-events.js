/**
 * Durable, append-only log of credential-lifecycle events (LIN-2236, L5.1 of
 * the LIN-2231 design). Mirrors this repo's existing append-only-log pattern
 * (lib/proxy-events.js, lib/agent-status-store.js, lib/account-merge-log.js):
 * class + constructor({collection}), one document per event, write failures
 * caught and logged (fire-and-forget), never thrown into the refresh/resolve
 * flow that rode in on them.
 *
 * Why this exists (the LIN-2231 incident's own evidence-destruction lesson):
 * Railway's log retention is a rolling ~7-day window that can silently drop
 * high-volume output, and it lost the window that would have shown this
 * incident's root event. Every fact this store records already exists as a
 * console.log/warn/error somewhere in this codebase — this is the SAME facts,
 * durably, so a future incident's evidence outlives the deploy that produced
 * it.
 *
 * Schema:
 * {
 *   _id:       string,   // UUID
 *   accountId: string|null,  // the CANONICAL account this event concerns (LIN-2234's resolveCanonicalAccountId, when available)
 *   urlKey:    string|null,
 *   provider:  string|null,
 *   kind:      string,   // one of CREDENTIAL_LIFECYCLE_EVENT_KINDS
 *   detail:    Object|string|null,  // kind-specific, secret-safe (never token bytes)
 *   at:        Date,
 *   expiresAt: Date   // TTL for auto-cleanup — see the `ttl` constructor option
 * }
 */

import crypto from 'crypto';

/**
 * The `kind` vocabulary L5.1 specifies. `refresh_skip` covers all three of
 * the previously-silent branches (distinguished by `detail.branch`):
 * `cooldown-gate` (LIN-2097's 60s refreshOnResolveGate), `no-durable-record`
 * (doOwnerRefresh's `!record?.refreshToken` guard), and
 * `frozen-expiry-non-live` (LIN-2097's isRefreshResultLive boundary check).
 */
export const CREDENTIAL_LIFECYCLE_EVENT_KINDS = Object.freeze({
  REFRESH_SKIP: 'refresh_skip',
  REFRESH_FAIL: 'refresh_fail',
  REFRESH_SUCCESS: 'refresh_success',
  OWNER_MISMATCH_503: 'owner_mismatch_503',
  MERGE: 'merge',
  SPEND_INTENT: 'spend_intent',
  // Additive beyond L5.1's original six-kind vocabulary: L5.4's startup/
  // periodic invariant sweep (lib/credential-invariant-sweep.js) needs a
  // durable home for its own violations ("logs loudly — durably, via L5.1"),
  // and none of the six named kinds describes "this edge has no matching
  // credential record" — they all describe a REFRESH attempt or its outcome,
  // which this specifically is not.
  INVARIANT_VIOLATION: 'credential_invariant_violation',
});

export class CredentialLifecycleEventStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection ('credential-lifecycle-events')
   * @param {number} [options.ttl=2592000] - Event TTL in seconds (default: 30 days — the
   *   same convention lib/proxy-events.js and lib/agent-status-store.js already use, and
   *   drastically longer than Railway's ~7-day window this store exists to outlive).
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.ttl = options.ttl || 30 * 24 * 60 * 60; // 30 days
  }

  /**
   * Records a credential-lifecycle event. Never throws — a write failure is
   * logged and the (unpersisted) doc is still returned, mirroring every other
   * append-only store in this repo, so a logging failure never breaks the
   * refresh/resolve flow that produced the event.
   *
   * @param {Object} event
   * @param {string|null} [event.accountId] - the canonical account this event concerns
   * @param {string|null} [event.urlKey]
   * @param {string|null} [event.provider]
   * @param {string} event.kind - one of CREDENTIAL_LIFECYCLE_EVENT_KINDS
   * @param {Object|string|null} [event.detail] - kind-specific, secret-safe detail (never token bytes)
   * @returns {Promise<Object>} the recorded event
   */
  async recordEvent({ accountId, urlKey, provider, kind, detail } = {}) {
    const now = new Date();
    const doc = {
      _id: crypto.randomUUID(),
      accountId: accountId ?? null,
      urlKey: urlKey ?? null,
      provider: provider ?? null,
      kind,
      detail: detail ?? null,
      at: now,
      expiresAt: new Date(now.getTime() + this.ttl * 1000),
    };
    try {
      await this.collection.insertOne(doc);
    } catch (err) {
      console.error('Error recording credential-lifecycle event:', err);
    }
    return doc;
  }
}
