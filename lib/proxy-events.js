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

// LIN-1586 (Beat 1 of LIN-1577). The reason token `workspaceUnavailable` rides
// onto the audit write as the `note` breadcrumb when workspace-token selection
// finds no owner (routes/proxy.js, LIN-1540). Consumed here UNCHANGED — this
// module never extends the reason vocabulary, it only reads it.
export const OWNERLESS_NOTE = 'token_ownerless';

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
