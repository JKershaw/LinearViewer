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
 *   stage: string|null,    // 'provider-lane' | 'proxy-token' — whether this call resolved a
 *                          // workspace provider credential at all (LIN-2076). Sourced at the
 *                          // single existing write seam (routes/proxy.js's logEvent) from
 *                          // whether resolveProviderAccess ran for this request, the same
 *                          // presence check that already gates req.resolvedCredentialFingerprint.
 *                          // null on rows written outside that seam (e.g. the token-exchange
 *                          // audit write), which predates this field.
 *   credentialFingerprint: string|null,  // Fingerprint of the credential THIS call actually
 *                          // resolved (LIN-2076) — the same value LIN-1980 already computes
 *                          // and stamps onto req.resolvedCredentialFingerprint, now persisted
 *                          // instead of discarded. null when stage is 'proxy-token' or absent.
 *   timestamp: Date,       // When the call was made
 *   expiresAt: Date        // TTL for auto-cleanup (30 days)
 * }
 */

import crypto from 'crypto';
import { NON_OWNERLESS_WORKSPACE_DEATH_REASONS } from './errors.js';

// LIN-1586 (Beat 1 of LIN-1577). The reason token `workspaceUnavailable` rides
// onto the audit write as the `note` breadcrumb when workspace-token selection
// finds no owner (routes/proxy.js, LIN-1540). Consumed here UNCHANGED — this
// module never extends the reason vocabulary, it only reads it.
export const OWNERLESS_NOTE = 'token_ownerless';

// LIN-2076: the two `stage` values a proxy-event row can carry. 'provider-lane'
// means this call resolved (attempted to resolve) a workspace provider
// credential via resolveProviderAccess; 'proxy-token' means it never reached
// that resolution (a workspace-free consumer call, or a failure before it).
export const STAGE_PROVIDER_LANE = 'provider-lane';
export const STAGE_PROXY_TOKEN = 'proxy-token';

// Default credential-health window. Short on purpose: the question this answers
// is "is this token dying RIGHT NOW", not "has it ever failed".
export const CREDENTIAL_HEALTH_WINDOW_MS = 15 * 60 * 1000;

// Upper bound on the window, whoever asks. The time bound is the entire reason
// this read is not `listEvents`: with the bound collapsed, the query degenerates
// to `{urlKey, expiresAt:{$gt:now}}` — every non-expired row for the workspace,
// the shape that pushed /kpis past the 30s router timeout (ea7abb56). A caller
// asking for a year gets a day.
export const CREDENTIAL_HEALTH_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a caller-supplied window to a usable, bounded one.
 * Junk or non-positive falls back to the default; anything over the cap clamps.
 *
 * @param {number} [windowMs]
 * @returns {number}
 */
export function resolveCredentialHealthWindow(windowMs) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return CREDENTIAL_HEALTH_WINDOW_MS;
  return Math.min(windowMs, CREDENTIAL_HEALTH_MAX_WINDOW_MS);
}

/**
 * Coerce a stored timestamp (Date, ISO string, or epoch ms) to epoch ms.
 * Returns null when it can't be read — such a row is dropped from the fold
 * rather than silently counted at the epoch.
 *
 * @param {Date|string|number|null|undefined} value
 * @returns {number|null}
 */
function toMillis(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The credential-health predicate for ONE token, over that token's own events.
 *
 * Pure, `now`-injected, and free of any store call — the shape LIN-1588 (S-3)
 * recorded as its precondition, because its consumer (`deriveLoopLanes` in
 * lib/live-console.js) is a pure, network-free module and a Mongo read inside it
 * would be the regression. S-3 resolves verdicts at the route and injects a
 * tokenId → verdict index; this is the function it calls. `listCredentialHealth`
 * below is the store read built ON this, never a second copy of the rule.
 *
 * Within the window, the token is **credential-dead** iff it has BOTH:
 *   - ≥1 event whose note is EXACTLY `token_ownerless`. Exact equality, never
 *     `includes`: `note` is free text and its other writer emits an English
 *     sentence (the LIN-961 free-tier breadcrumb), which must not match.
 *   - ≥1 event with `status < 400` — NOT `=== 200`. A dispatched worker's most
 *     common workspace-free successes are 201s (POST /agent/status, POST
 *     /dispatch), and those are exactly the calls that keep working while every
 *     workspace-scoped verb 503s. Counting only 200s would miss the live worker.
 *
 * Deliberately NOT keyed on `status === 503` alone: there are 24 `logEvent(…,
 * 503)` call sites and exactly one passes this note, so 503 on its own says
 * nothing about WHY.
 *
 * The window bound is exclusive (`timestamp > since`), matching the query in
 * `listCredentialHealth` — the fold must never disagree with the read feeding it.
 *
 * @param {Array<{status, note, timestamp}>} eventsForToken - One token's events
 * @param {Object} [options]
 * @param {Date|number} [options.now=Date.now()] - Injected clock
 * @param {number} [options.windowMs=900000] - Look-back window (clamped)
 * @returns {{ownerlessCount: number, okCount: number, verdict: 'credential_dead'|'ok'}}
 */
export function credentialVerdict(eventsForToken, { now = Date.now(), windowMs = CREDENTIAL_HEALTH_WINDOW_MS } = {}) {
  const nowMs = toMillis(now) ?? Date.now();
  const since = nowMs - resolveCredentialHealthWindow(windowMs);

  let ownerlessCount = 0;
  let okCount = 0;

  for (const event of eventsForToken || []) {
    if (!event) continue;

    // A row whose timestamp can't be read is dropped, never counted at the epoch.
    const ts = toMillis(event.timestamp);
    if (ts === null || ts <= since) continue;

    if (event.note === OWNERLESS_NOTE) ownerlessCount++;
    if (typeof event.status === 'number' && event.status < 400) okCount++;
  }

  return {
    ownerlessCount,
    okCount,
    verdict: ownerlessCount > 0 && okCount > 0 ? 'credential_dead' : 'ok'
  };
}

/**
 * Groups projected proxy-event rows by token and applies `credentialVerdict` to
 * each. The grouping half of the fold; the rule itself lives above and is not
 * restated here.
 *
 * Within the window, a tokenId is **credential-dead** iff it has BOTH:
 *   - ≥1 event whose note is EXACTLY `token_ownerless`. Exact equality, never
 *     `includes`: `note` is free text and its other writer emits an English
 *     sentence (the LIN-961 free-tier breadcrumb), which must not match.
 *   - ≥1 event with `status < 400` — NOT `=== 200`. A dispatched worker's most
 *     common workspace-free successes are 201s (POST /agent/status, POST
 *     /dispatch), and those are exactly the calls that keep working while every
 *     workspace-scoped verb 503s. Counting only 200s would miss the live worker.
 *
 * Deliberately NOT keyed on `status === 503` alone: there are 24 `logEvent(…,
 * 503)` call sites and exactly one passes this note, so 503 on its own says
 * nothing about WHY.
 *
 * Rows with no tokenId (unauthenticated calls) are skipped — credential health
 * is a per-credential question and has no answer for "no credential".
 *
 * @param {Array<{tokenId, tokenLabel, status, note, timestamp}>} rows
 * @param {Object} [options]
 * @param {Date|number} [options.now=Date.now()] - Injected clock
 * @param {number} [options.windowMs=900000] - Look-back window (clamped)
 * @returns {Array<{tokenId, tokenLabel, ownerlessCount, okCount, verdict}>}
 */
export function foldCredentialHealth(rows, { now = Date.now(), windowMs = CREDENTIAL_HEALTH_WINDOW_MS } = {}) {
  const byToken = new Map();

  for (const row of rows || []) {
    if (!row || !row.tokenId) continue;

    let entry = byToken.get(row.tokenId);
    if (!entry) {
      entry = { tokenId: row.tokenId, tokenLabel: row.tokenLabel ?? null, events: [] };
      byToken.set(row.tokenId, entry);
    }
    // Newest label wins for a token relabelled mid-window; a row carrying no
    // label never blanks one already seen.
    if (row.tokenLabel != null) entry.tokenLabel = row.tokenLabel;
    entry.events.push(row);
  }

  return [...byToken.values()].map(({ tokenId, tokenLabel, events }) => ({
    tokenId,
    tokenLabel,
    ...credentialVerdict(events, { now, windowMs })
  }));
}

// LIN-2076: bucket width for the provider-lane occupancy detector. 30s halves
// the square-wave fault's measured ~62.6s period, so a real episode always
// lands at least one bad bucket alongside a good one rather than aliasing to
// a single mixed bucket.
export const OCCUPANCY_BUCKET_MS = 30 * 1000;

// LIN-2076: the occupancy window's lower bound. A window shorter than one
// fault cycle (~60s measured) can land entirely inside either phase of the
// square wave and read falsely clean or falsely dead — this is the ticket's
// own stated constraint, enforced here rather than left to callers.
export const OCCUPANCY_MIN_WINDOW_MS = 60 * 1000;

// LIN-2076: minimum number of DISTINCT buckets carrying at least one
// provider-lane call before a verdict is trusted. Below this floor there is
// not enough sampled time to say anything — `unknown`, never a false `ok`
// from silence (the ticket's own explicit constraint).
export const OCCUPANCY_MIN_BUCKETS = 2;

/**
 * Resolve a caller-supplied occupancy window to a usable, bounded one.
 * Unlike `resolveCredentialHealthWindow`, this also enforces a LOWER bound
 * (`OCCUPANCY_MIN_WINDOW_MS`) — a short window can alias the fault's own
 * period and lie, which the credential-health window has no equivalent risk
 * of (it is a liveness check, not a periodic-fault detector).
 *
 * @param {number} [windowMs]
 * @returns {number}
 */
export function resolveOccupancyWindow(windowMs) {
  const base = (!Number.isFinite(windowMs) || windowMs <= 0) ? CREDENTIAL_HEALTH_WINDOW_MS : windowMs;
  return Math.max(OCCUPANCY_MIN_WINDOW_MS, Math.min(base, CREDENTIAL_HEALTH_MAX_WINDOW_MS));
}

/**
 * The provider-lane occupancy detector for ONE credential lane (LIN-2076).
 *
 * Pure, `now`-injected, store-free — same discipline as `credentialVerdict`
 * above, which this sits BESIDE rather than forks: `credentialVerdict`
 * answers "is this token dead right now" from the ownerless-note signal;
 * this answers a structurally different, time-bucketed question the research
 * on this ticket found the naive call-ratio cannot: "what fraction of the
 * time this lane was actually exercised did it fail upstream". Only rows
 * with `stage === 'provider-lane'` count — a `proxy-token`-stage row (a
 * workspace-free call, or a call that never reached credential resolution)
 * is not evidence about the provider credential and must not dilute or
 * pollute either the numerator or the denominator.
 *
 * Denominator is BUCKET occupancy, not raw call count: a caller retrying a
 * failing request several times inside one bad bucket must not inflate that
 * bucket's weight relative to a bucket that saw one lonely successful call.
 * A bucket is "faulting" if it contains >=1 provider-lane 401, OR >=1
 * provider-lane 503 that carries a `credentialFingerprint` (LIN-2473 — the
 * same LIN-2216 transient-provider-auth shape `routes/proxy.js`'s `logEvent`
 * labels `provider-503-transient`: a credential resolved and Linear rejected
 * it anyway, just relayed as a 503 instead of a 401). A fingerprint-less 503
 * (nothing ever resolved) still does not count here. Occupancy is
 * the fraction of buckets THAT SAW PROVIDER-LANE TRAFFIC (not every bucket
 * in the window — an idle bucket is not evidence either way) which faulted.
 *
 * `callRatio` (failed calls / total calls) rides along as a supplementary,
 * labelled figure only — per the ticket's own constraint it must never be
 * the primary detector, since it is set by client retry cadence as much as
 * by the fault itself.
 *
 * @param {Array<{status, stage, timestamp, credentialFingerprint}>} rows - provider-lane-relevant proxy-event rows
 * @param {Object} [options]
 * @param {Date|number} [options.now=Date.now()] - Injected clock
 * @param {number} [options.windowMs] - Look-back window (clamped, min 60s)
 * @param {number} [options.bucketMs=30000] - Bucket width
 * @returns {{verdict: 'unknown'|'ok'|'degraded', occupancy: number|null, callRatio: number|null,
 *   bucketsWithEvidence: number, bucketsFaulting: number, totalCalls: number, failedCalls: number,
 *   windowMs: number, bucketMs: number}}
 */
export function providerLaneOccupancy(rows, { now = Date.now(), windowMs, bucketMs = OCCUPANCY_BUCKET_MS } = {}) {
  const nowMs = toMillis(now) ?? Date.now();
  const effectiveWindow = resolveOccupancyWindow(windowMs);
  const since = nowMs - effectiveWindow;

  const buckets = new Map();
  let totalCalls = 0;
  let failedCalls = 0;

  for (const row of rows || []) {
    if (!row || row.stage !== STAGE_PROVIDER_LANE) continue;

    const ts = toMillis(row.timestamp);
    if (ts === null || ts <= since || ts > nowMs) continue;

    const bucketIndex = Math.floor(ts / bucketMs);
    let bucket = buckets.get(bucketIndex);
    if (!bucket) {
      bucket = { total: 0, failed: 0 };
      buckets.set(bucketIndex, bucket);
    }
    bucket.total++;
    totalCalls++;
    // LIN-2473: a provider-lane 503 that carries a credentialFingerprint is
    // LIN-2216's transient-provider-auth reclassification (routes/proxy.js's
    // logEvent labels this exact shape 'provider-503-transient') — a
    // credential resolved and Linear rejected it anyway, the same fault this
    // detector already counts when it surfaces as a 401. Without this, a fix
    // that converts every 401 into a self-healing 503 would read this
    // endpoint permanently green while the lane still flaps. A resolution
    // failure 503 (no fingerprint — nothing ever resolved) is deliberately
    // NOT counted here; it is invisible to this detector by design (see
    // recentFailureReasons below, which is what tallies that class).
    if (row.status === 401 || (row.status === 503 && row.credentialFingerprint)) {
      bucket.failed++;
      failedCalls++;
    }
  }

  const bucketsWithEvidence = buckets.size;
  const callRatio = totalCalls > 0 ? failedCalls / totalCalls : null;

  if (bucketsWithEvidence < OCCUPANCY_MIN_BUCKETS) {
    return {
      verdict: 'unknown',
      occupancy: null,
      callRatio,
      bucketsWithEvidence,
      bucketsFaulting: 0,
      totalCalls,
      failedCalls,
      windowMs: effectiveWindow,
      bucketMs
    };
  }

  let bucketsFaulting = 0;
  for (const bucket of buckets.values()) {
    if (bucket.failed > 0) bucketsFaulting++;
  }
  const occupancy = bucketsFaulting / bucketsWithEvidence;

  return {
    verdict: occupancy > 0 ? 'degraded' : 'ok',
    occupancy,
    callRatio,
    bucketsWithEvidence,
    bucketsFaulting,
    totalCalls,
    failedCalls,
    windowMs: effectiveWindow,
    bucketMs
  };
}

// LIN-1746: below how many hits of the SAME reason a streak is trusted. One
// failed call is genuinely ambiguous between "transient" and "permanently
// dead" (this ticket's own framing) — never call it on a single data point.
export const RECENT_REASON_MIN_STREAK = 2;

// LIN-1746: the exact non-ownerless credential-death class this ticket names
// — `workspaceUnavailable`'s `reason` vocabulary is wider (also
// `store_unreachable`, a transient infra blip, and `token_ownerless`, a
// property of the calling token with its own distinct LIN-1448 remedy —
// "re-issue the token", not "ask for re-dispatch"). Imported from
// lib/errors.js's `NON_OWNERLESS_WORKSPACE_DEATH_REASONS` (a single source of
// truth, not a second, hand-duplicated literal Set here that could drift).
const NON_OWNERLESS_DEATH_REASONS = NON_OWNERLESS_WORKSPACE_DEATH_REASONS;

/**
 * The non-ownerless credential-death signal `providerLaneOccupancy` above
 * cannot see and `credentialVerdict` was never built for (LIN-1746): a
 * `session_expired` / `owner_signed_out` / `owner_mismatch` / `not_connected`
 * 503 fires from `workspaceUnavailable()` (routes/proxy.js) BEFORE any
 * provider-lane credential resolves — `stage: 'proxy-token'`, no fingerprint
 * (found by code review: an earlier revision of `resolveProviderAccess`
 * stamped a fingerprint even on this failure, which misfiled it as
 * `stage: 'provider-lane'` and let it silently inflate `providerLaneOccupancy`'s
 * denominator; fixed at the stamp site, routes/proxy.js's `resolveProviderAccess`)
 * — so it is invisible to both of those. This tallies the calling
 * token's own recent `note` (the `workspaceUnavailable` reason, LIN-1540)
 * across its 503 rows, extending the SAME per-token audit-row grouping
 * `foldCredentialHealth` already uses rather than a second model.
 *
 * A single failure is ambiguous by this ticket's own framing — `verdict`
 * only leaves `'unknown'` once the SAME reason has repeated at least
 * `RECENT_REASON_MIN_STREAK` times in the window, at which point it names
 * that reason as `dominantReason` (a worker can act: stop guessing "the
 * workspace is disconnected" and ask for re-dispatch instead — the exact
 * LIN-1576 misdiagnosis this ticket exists to prevent).
 *
 * Shares `providerLaneOccupancy`'s 60s-floored window resolver
 * (`resolveOccupancyWindow`) rather than the unfloored
 * `resolveCredentialHealthWindow`, so both halves of the self-scoped
 * credential-health read honour the same floor.
 *
 * @param {Array<{status, note, timestamp}>} rows - this token's own proxy-event rows
 * @param {Object} [options]
 * @param {Date|number} [options.now=Date.now()] - Injected clock
 * @param {number} [options.windowMs] - Look-back window (clamped, min 60s)
 * @returns {{verdict: 'unknown'|'likely_dead', dominantReason: string|null,
 *   reasons: Object<string, number>, totalFailures: number, windowMs: number}}
 */
export function recentFailureReasons(rows, { now = Date.now(), windowMs = CREDENTIAL_HEALTH_WINDOW_MS } = {}) {
  const nowMs = toMillis(now) ?? Date.now();
  const effectiveWindow = resolveOccupancyWindow(windowMs);
  const since = nowMs - effectiveWindow;

  const reasons = {};
  const latestSeenAt = {};
  let totalFailures = 0;

  for (const row of rows || []) {
    if (!row || row.status !== 503 || !NON_OWNERLESS_DEATH_REASONS.has(row.note)) continue;
    const ts = toMillis(row.timestamp);
    // Same future-timestamp guard `providerLaneOccupancy` applies (found by
    // code review — an earlier revision here omitted it): a row stamped
    // ahead of the injected/wall-clock `now` (clock skew between dynos, or a
    // caller-supplied `now` that lags) must not count, or this half could
    // flip to `likely_dead` one failure earlier than its sibling ever would
    // for the identical event stream, despite both being documented to
    // share one window/consistency contract.
    if (ts === null || ts <= since || ts > nowMs) continue;
    reasons[row.note] = (reasons[row.note] || 0) + 1;
    if (!(row.note in latestSeenAt) || ts > latestSeenAt[row.note]) latestSeenAt[row.note] = ts;
    totalFailures++;
  }

  // Highest count wins; a tie breaks toward whichever reason's MOST RECENT
  // occurrence is more recent — "what's failing on you right now" is the
  // more actionable answer for a worker deciding what to report, and it no
  // longer depends on an unsorted query's incidental row order. A further
  // tie (found by code review, round 5: two reasons can share the exact same
  // millisecond timestamp — `recordEvent` stamps with `new Date()` at call
  // time, and concurrent/rapid requests can land in the same tick) breaks
  // alphabetically on the reason name, so the result never again depends on
  // `Object.entries`' insertion order, i.e. the unsorted query's row order.
  let dominantReason = null;
  let dominantCount = 0;
  let dominantLatestAt = -Infinity;
  for (const [reason, count] of Object.entries(reasons)) {
    const isBetter = count > dominantCount
      || (count === dominantCount && latestSeenAt[reason] > dominantLatestAt)
      || (count === dominantCount && latestSeenAt[reason] === dominantLatestAt && (dominantReason === null || reason < dominantReason));
    if (isBetter) {
      dominantReason = reason;
      dominantCount = count;
      dominantLatestAt = latestSeenAt[reason];
    }
  }

  const verdict = dominantCount >= RECENT_REASON_MIN_STREAK ? 'likely_dead' : 'unknown';

  return {
    verdict,
    dominantReason: verdict === 'likely_dead' ? dominantReason : null,
    reasons,
    totalFailures,
    windowMs: effectiveWindow
  };
}

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
   * @param {string} [event.stage] - 'provider-lane' | 'proxy-token' (LIN-2076)
   * @param {string} [event.credentialFingerprint] - Resolved credential fingerprint (LIN-2076)
   * @returns {Promise<Object>} The created event
   */
  async recordEvent({ urlKey, tokenId, tokenLabel, method, endpoint, status, note, stage, credentialFingerprint }) {
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
      stage: stage || null,
      credentialFingerprint: credentialFingerprint || null,
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
   * Reads per-token credential health over a short recent window (LIN-1586).
   *
   * A SEPARATE read from `listEvents` on purpose — not a widening of it.
   * `listEvents` pulls every non-expired row for the workspace into memory and
   * sorts in JS (the shape that pushed /kpis past the 30s router timeout,
   * ea7abb56); this read is time-bounded to the window AND projected to the
   * five fields the predicate needs, so it stays small no matter how busy the
   * workspace is. Folding then happens in JS, the repo convention for
   * store-side grouping (lib/proxy-tokens.js cleanup).
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {number} [options.windowMs=900000] - How far back to look (15 min)
   * @returns {Promise<{windowMs: number, tokens: Array<{tokenId, tokenLabel, ownerlessCount, okCount, verdict}>}>}
   */
  async listCredentialHealth(urlKey, { windowMs = CREDENTIAL_HEALTH_WINDOW_MS } = {}) {
    // Clamped, not merely defaulted: an unbounded window collapses the time
    // bound this read exists to keep (see CREDENTIAL_HEALTH_MAX_WINDOW_MS).
    const effectiveWindow = resolveCredentialHealthWindow(windowMs);

    if (!urlKey) {
      return { windowMs: effectiveWindow, tokens: [] };
    }

    try {
      const now = new Date();
      const since = new Date(now.getTime() - effectiveWindow);

      const docs = await this.collection.find(
        {
          urlKey,
          expiresAt: { $gt: now },
          timestamp: { $gt: since }
        },
        { projection: { tokenId: 1, tokenLabel: 1, status: 1, note: 1, timestamp: 1 } }
      ).toArray();

      const rows = docs.map(doc => ({
        tokenId: doc.tokenId ?? null,
        tokenLabel: doc.tokenLabel ?? null,
        status: doc.status,
        note: doc.note ?? null,
        timestamp: doc.timestamp
      }));

      return {
        windowMs: effectiveWindow,
        tokens: foldCredentialHealth(rows, { now, windowMs: effectiveWindow })
      };
    } catch (err) {
      console.error('Error reading proxy credential health:', err);
      return { windowMs: effectiveWindow, tokens: [] };
    }
  }

  /**
   * The self-scoped credential-health read `GET /api/proxy/credential-health`
   * (routes/proxy.js) serves — LIN-2076's provider-lane occupancy AND
   * LIN-1746's non-ownerless failure-reason tally, from ONE query instead of
   * two (found by code review: the two halves were originally separate
   * `find()` calls against the same collection/tokenId on every poll of a
   * route explicitly meant to be cheap enough to poll — a needless doubling
   * of I/O). Both halves now share one window (`resolveOccupancyWindow`, the
   * 60s-floored resolver), so one query correctly covers both: the two pure
   * folds below need different, overlapping subsets — `providerLaneOccupancy`
   * wants `stage: 'provider-lane'` rows of any status, `recentFailureReasons`
   * wants `status: 503` rows of any stage — so the query's own `$or` filters
   * to that union AT THE MONGO LEVEL (found by a later review round: an
   * earlier revision of this consolidation fetched every row for
   * (urlKey, tokenId) in the window with no filter at all, including
   * unrelated stage:'proxy-token' 2xx traffic neither fold needs), and each
   * pure fold still re-applies its own narrower filter client-side on top
   * (unchanged — the folds are also called directly, elsewhere, over rows
   * this query never touches).
   *
   * Deliberately token-scoped, never workspace-wide: the ticket's own
   * constraint is that agent-lane exposure must be bounded to the caller's
   * own token, not workspace-wide token metadata (unlike the session-authed
   * `listCredentialHealth` above, which already reports every token in the
   * workspace to an authenticated human operator).
   *
   * @param {string} urlKey - Workspace URL key
   * @param {string} tokenId - The CALLING token's own id — never another token's
   * @param {Object} [options]
   * @param {number} [options.windowMs] - How far back to look (clamped, min 60s)
   * @returns {Promise<{occupancy: ReturnType<typeof providerLaneOccupancy>, workspaceAccess: ReturnType<typeof recentFailureReasons>}>}
   */
  async listSelfCredentialHealth(urlKey, tokenId, { windowMs } = {}) {
    const effectiveWindow = resolveOccupancyWindow(windowMs);

    if (!urlKey || !tokenId) {
      return {
        occupancy: providerLaneOccupancy([], { windowMs: effectiveWindow }),
        workspaceAccess: recentFailureReasons([], { windowMs: effectiveWindow }),
      };
    }

    try {
      const now = new Date();
      const since = new Date(now.getTime() - effectiveWindow);

      // LIN-1746 (found by code review, round 5): the query itself must union
      // both halves' row shapes — `providerLaneOccupancy` only wants
      // `stage: STAGE_PROVIDER_LANE` rows, `recentFailureReasons` only wants
      // `status: 503` rows — rather than fetching every row for this
      // (urlKey, tokenId) in the window, including stage:'proxy-token' 2xx
      // traffic (dispatch polling, /api/proxy/status, …) neither fold needs,
      // on an endpoint documented to be "cheap enough to poll".
      const docs = await this.collection.find(
        {
          urlKey,
          tokenId,
          expiresAt: { $gt: now },
          timestamp: { $gt: since },
          $or: [{ stage: STAGE_PROVIDER_LANE }, { status: 503 }]
        },
        { projection: { status: 1, stage: 1, note: 1, timestamp: 1 } }
      ).toArray();

      const rows = docs.map(doc => ({
        status: doc.status,
        stage: doc.stage ?? null,
        note: doc.note ?? null,
        timestamp: doc.timestamp
      }));

      return {
        occupancy: providerLaneOccupancy(rows, { now, windowMs: effectiveWindow }),
        workspaceAccess: recentFailureReasons(rows, { now, windowMs: effectiveWindow }),
      };
    } catch (err) {
      console.error('Error reading self credential health:', err);
      return {
        occupancy: providerLaneOccupancy([], { windowMs: effectiveWindow }),
        workspaceAccess: recentFailureReasons([], { windowMs: effectiveWindow }),
      };
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
