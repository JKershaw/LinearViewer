/**
 * Public share-link route (LIN-3243, Session A of LIN-3073).
 *
 * `GET /s/:token` serves an owner's task-collection snapshot as a read-only
 * public page (lib/render-share.js). The token is the only credential; the
 * route receives the `ShareStore`, `readOwnerIssues` and `workspaceOwnerCheck`
 * by injection, so it imports nothing from the owner-credential / connection
 * stores and `tests/unit/connection-access-guard.test.js` stays green.
 *
 * Every GET runs the owner/revocation matrix BEFORE any cached content:
 *   1. unknown token                                    → 404
 *   2. revoked (`revokedAt` set)                        → 410
 *   3. owner no longer owns the workspace / workspace gone → 410, no content
 *   4. ownership check cannot answer (throws)           → 503, no content
 *   5. snapshot present and fresh (< SNAPSHOT_TTL_MS)   → serve
 *   6. snapshot present, stale, refresh not ok / throws → serve last-good, "as of"
 *      (ruling `lin3073-owner-unresolvable`: serve-last-good)
 *   7. snapshot null and refresh not ok / unavailable   → 503, no content
 *
 * Refresh is GET-triggered only (no background refresher), single-flight per
 * token, and bounded by `MIN_REFRESH_INTERVAL_MS` after a success and
 * `FAILURE_BACKOFF_MS` after a failure. An in-process per-token attempt stamp
 * (`attempts`, below) also guards the throttle: when a store-write outage
 * prevents `lastRefreshAttemptAt` from persisting, that stamp still suppresses
 * repeated reads, so anonymous traffic cannot spend the owner's provider rate
 * limit without bound.
 *
 * Provider coverage carry-forward (approving verdict (b), Session B): a
 * `kind: 'parent'` share must be REFUSED at create when the workspace's
 * provider declares `ui.subtasks: false` (`github`, `github-projects` always
 * emit `parent: null`) — such a share would otherwise always be empty. Label
 * shares work on every provider. The create route (and that refusal) lands in
 * LIN-3244 / Session B, so it is not implemented here.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { buildShareSnapshot } from '../lib/share-snapshot.js';
import { isWellFormedShareToken } from '../lib/share-store.js';
import { renderSharePage } from '../lib/render-share.js';

export const SNAPSHOT_TTL_MS = 60_000;
export const MIN_REFRESH_INTERVAL_MS = 60_000;
export const FAILURE_BACKOFF_MS = 300_000;
export const SHARE_REFRESH_TIMEOUT_MS = 50_000;
export const READ_LIMIT_MAX = 120;

function defaultSkip() {
  return process.env.NODE_ENV === 'test';
}

/**
 * Build the share limiters. Exported as a factory (shaped like
 * `feedbackLimiter` in routes/dispatch.js) so the 429 test can construct its
 * own isolated limiter instance with a small `max` and `skip: () => false`.
 *
 * @param {{windowMs?: number, max?: number, skip?: Function}} [opts]
 * @returns {{read: Function}}
 */
export function createShareLimiters({ windowMs = 60 * 1000, max = READ_LIMIT_MAX, skip = defaultSkip } = {}) {
  return {
    read: rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many share requests, please try again later' },
      skip
    })
  };
}

// The default limiter: 120 reads/minute per IP, skipped under NODE_ENV=test.
export const shareReadLimiter = createShareLimiters().read;

function serve(res, record, stale) {
  return res.status(200).type('html').send(renderSharePage({
    snapshot: record.snapshot,
    includeDescriptions: record.includeDescriptions,
    snapshotAt: record.snapshotAt,
    stale
  }));
}

/**
 * @param {Object} deps
 * @param {import('../lib/share-store.js').ShareStore} deps.shareStore
 * @param {(urlKey: string, ownerAccountId: string) => Promise<{reason: string, issues: Object[]|null}>} deps.readOwnerIssues
 * @param {(args: {workspaceId?: string, accountId?: string}) => Promise<{status: string}>} deps.workspaceOwnerCheck
 * @param {(promise: Promise, ms: number) => Promise} deps.withTimeout - injected from routes/proxy.js (LIN-3158 timer fix)
 * @param {Function} [deps.readLimiter]
 * @returns {import('express').Router}
 */
export function createShareRoutes({ shareStore, readOwnerIssues, workspaceOwnerCheck, withTimeout, readLimiter = shareReadLimiter } = {}) {
  const router = Router();

  // Per-token single-flight for refreshes (closure state, one map per router).
  const inflight = new Map();
  // Per-token last-attempt stamp, in-process only. `lastRefreshAttemptAt` is
  // persisted by `saveSnapshot`, which is exactly what fails during a
  // store-write outage, so it cannot be the only guard (LIN-3255). Bounded by
  // pruning entries older than FAILURE_BACKOFF_MS on write and read.
  const attempts = new Map();

  async function refresh(record) {
    const key = record.tokenHash;
    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const at = new Date();
      // Stamp before any await so a timeout, build throw or save throw cannot
      // skip it, and sweep stale entries so the map stays bounded.
      for (const [k, ts] of attempts) {
        if (at.getTime() - ts >= FAILURE_BACKOFF_MS) attempts.delete(k);
      }
      attempts.set(key, at.getTime());
      let outcome;
      try {
        outcome = await withTimeout(
          readOwnerIssues(record.urlKey, record.ownerAccountId),
          SHARE_REFRESH_TIMEOUT_MS
        );
      } catch (err) {
        outcome = { reason: 'refresh_error', issues: null };
      }

      const ok = outcome != null && outcome.issues != null && outcome.reason === 'ok';
      // A store write or snapshot build failure is a REFRESH failure, not an
      // unhandled rejection: the handler then serves last-good (row 6) or 503
      // (row 7). Without this the rejection escapes and production returns 500.
      try {
        if (!ok) {
          // A failed attempt still stamps `lastRefreshAttemptAt` (row 7 backoff)
          // but must never disturb the last good snapshot (row 6).
          await shareStore.saveSnapshot(key, null, { at });
          return { ok: false, reason: outcome?.reason ?? 'refresh_error' };
        }

        const snapshot = buildShareSnapshot({
          subject: record.subject,
          issues: outcome.issues,
          includeDescriptions: record.includeDescriptions
        });
        await shareStore.saveSnapshot(key, snapshot, { at });
        return { ok: true, snapshot, snapshotAt: at, reason: outcome.reason };
      } catch (err) {
        return { ok: false, reason: 'refresh_error' };
      }
    })().finally(() => { inflight.delete(key); });

    inflight.set(key, promise);
    return promise;
  }

  router.get('/s/:token', readLimiter, async (req, res) => {
    // Security headers on EVERY response from this route (200 or error).
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Robots-Tag', 'noindex');

    const { token } = req.params;
    // Matrix row 1's cheap reject: a malformed token never reaches the store.
    if (!isWellFormedShareToken(token)) return res.status(404).send('Not found');

    let record;
    try {
      record = await shareStore.getByToken(token);
    } catch (err) {
      return res.status(503).end();
    }
    if (!record) return res.status(404).send('Not found');      // row 1
    if (record.revokedAt) return res.status(410).send('Gone');  // row 2

    let owner;
    try {
      owner = await workspaceOwnerCheck({ workspaceId: record.workspaceId, accountId: record.ownerAccountId });
    } catch (err) {
      return res.status(503).end();                             // row 4
    }
    if (!owner || owner.status !== 'owner') return res.status(410).end(); // row 3

    const now = Date.now();
    const snapshotAtMs = record.snapshotAt ? new Date(record.snapshotAt).getTime() : null;

    // Row 5: fresh snapshot, no provider read at all.
    if (record.snapshot != null && snapshotAtMs != null && now - snapshotAtMs < SNAPSHOT_TTL_MS) {
      return serve(res, record, false);
    }

    // A prior attempt NEWER than the last success must have failed → longer backoff.
    const recordedAttemptMs = record.lastRefreshAttemptAt ? new Date(record.lastRefreshAttemptAt).getTime() : null;
    // The in-process stamp is the fallback when a store-write outage prevents
    // `lastRefreshAttemptAt` from persisting (LIN-3255). Drop it once expired:
    // past FAILURE_BACKOFF_MS it cannot change any `due` result.
    let attemptMs = attempts.get(record.tokenHash);
    if (attemptMs != null && now - attemptMs >= FAILURE_BACKOFF_MS) {
      attempts.delete(record.tokenHash);
      attemptMs = null;
    }
    const lastAttemptMs = attemptMs == null ? recordedAttemptMs
      : recordedAttemptMs == null ? attemptMs
        : Math.max(recordedAttemptMs, attemptMs);
    const lastFailed = lastAttemptMs != null && (snapshotAtMs == null || lastAttemptMs > snapshotAtMs);
    const interval = lastFailed ? FAILURE_BACKOFF_MS : MIN_REFRESH_INTERVAL_MS;
    // `inflight.has` keeps concurrent GETs joining an in-flight refresh even
    // after the winner stamped an attempt (a null snapshot must not 503).
    const due = inflight.has(record.tokenHash) || lastAttemptMs == null || now - lastAttemptMs >= interval;

    if (due) {
      const result = await refresh(record);
      if (result.ok) {
        return res.status(200).type('html').send(renderSharePage({
          snapshot: result.snapshot,
          includeDescriptions: record.includeDescriptions,
          snapshotAt: result.snapshotAt,
          stale: false
        }));
      }
      if (record.snapshot != null) {
        // A stale snapshot whose refresh failed serves last-good, marked
        // "as of <snapshotAt>" (ruling `lin3073-owner-unresolvable`:
        // serve-last-good). Rows 3, 4 and 7 are unaffected.
        return serve(res, record, true);
      }
      return res.status(503).end();                            // row 7
    }

    // Throttled/backing off: zero provider reads. Serve last-good if we have it.
    if (record.snapshot != null) return serve(res, record, true);
    return res.status(503).end();                              // row 7
  });

  return router;
}
