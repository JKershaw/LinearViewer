/**
 * Consumer poll-recency warning (LIN-2885).
 *
 * The 16 Sep 2026 phone-dispatch incident: a workspace created from a phone
 * had no runner bound to it. Every dispatch was accepted with a 201 and sat
 * in the queue — nothing on the item, the dispatch page, the Observation feed
 * or the proxy response said that no consumer had ever polled that workspace.
 * Every consumer token already records `lastUsedAt` (lib/dispatch-tokens.js),
 * updated on each successful poll/take — this module reads that as the source
 * of truth for "is anything listening?" without refusing the dispatch (it
 * must still enqueue; a runner may come up later). Recording a per-MACHINE
 * last poll is a separate, larger ticket (LIN-2883) this deliberately does
 * not duplicate.
 */

import { hasGrant } from './proxy-scopes.js';
import { toEpochMs } from './utils/time.js';

/**
 * How old a runner's last call may be before Harbour says nobody is
 * listening: 20 minutes. The single stale limit for every no-listener warning
 * (new-run reply, dispatch-page queue warnings, proxy queued-item reads) and
 * for the dispatcher-silent alarm (lib/liveness-detectors.js). Not
 * configurable — one boundary, so the warning and the alarm cannot disagree.
 */
export const NOBODY_LISTENING_MS = 20 * 60 * 1000;

/**
 * Reads the most recent `lastUsedAt` across a workspace's consumer tokens.
 * `dispatchTokenStore.listTokens` already scopes to non-revoked tokens — a
 * revoked token is deleted outright (lib/dispatch-tokens.js's `revokeToken`),
 * never merely flagged. LIN-3421: a row with a past `expiresAt` still lists
 * (expiry is validate-time only); its `lastUsedAt` cannot post-date the expiry,
 * so the staleness read below stays correct. Fail-soft: a
 * missing store/method, or a store read failure, resolves to null (treated as
 * "never seen"), the same fail-open stance the dispatch factory's other
 * capability-gated guards take.
 *
 * LIN-3130 (S2a): when a `proxyTokenStore` is supplied, grant-bearing `take`
 * proxy tokens (the runner credential) are folded into the same maximum, so a
 * runner-only workspace — one with no dispatch token at all — does not read
 * "never polled". Only `take`-grant tokens count: an ordinary proxy token is
 * not a consumer. Pass `proxyTokenStore` from the dispatch factory's enqueue
 * stamp; the runner poll's own `otherConsumerLastSeenAt` deliberately calls
 * WITHOUT it so it stays dispatch-token-only (what detects Simple Dispatcher).
 *
 * A3 dilution (stated, accepted for v1): `validateToken` bumps `lastUsedAt` on
 * every proxy call, so the runner's own enqueue/tracker calls also refresh it
 * and can mask "never polled" for a runner that has stopped polling — a
 * runner still calling Harbour at all is alive.
 *
 * @param {Object} dispatchTokenStore - Must expose `listTokens(urlKey)`.
 * @param {string} urlKey - Workspace URL key.
 * @param {Object} [proxyTokenStore] - Optional proxy token store (grants on
 *   each listed token); its `take`-grant tokens join the maximum.
 * @returns {Promise<string|null>} ISO timestamp of the most recent poll/take,
 *   or null when the workspace has never had a consumer token poll/take.
 */
export async function getConsumerLastSeenAt(dispatchTokenStore, urlKey, proxyTokenStore = null) {
  if (!urlKey) {
    return null;
  }

  let latest = null;
  const consider = (lastUsedAt) => {
    const seenMs = toEpochMs(lastUsedAt);
    if (seenMs == null) return;
    if (latest == null || seenMs > latest) latest = seenMs;
  };

  if (dispatchTokenStore && typeof dispatchTokenStore.listTokens === 'function') {
    const tokens = await dispatchTokenStore.listTokens(urlKey).catch(() => []);
    for (const token of tokens || []) consider(token?.lastUsedAt);
  }

  if (proxyTokenStore && typeof proxyTokenStore.listTokens === 'function') {
    const tokens = await proxyTokenStore.listTokens(urlKey).catch(() => []);
    for (const token of tokens || []) {
      if (!hasGrant(token?.grants, 'take')) continue;
      consider(token.lastUsedAt);
    }
  }

  return latest != null ? new Date(latest).toISOString() : null;
}

/**
 * Builds the human-readable poll-recency warning for a `consumerLastSeenAt`
 * value, or null when the workspace is being actively polled (a live
 * workspace shows nothing new — see the ticket's own "done when"). Used at
 * enqueue time (the 201 body) against the just-read recency stamp. Read-time
 * surfaces (GET /dispatch/{id}, the lean list, the dispatch-page queue list)
 * use buildQueuedPollWarning instead, which feeds the LIVE recency through this
 * same function for queued rows only (LIN-3367), so both share one limit.
 *
 * Distinguishes "never" (no consumer token has ever polled/taken in this
 * workspace) from a concrete stale timestamp, per the ticket's explicit
 * requirement that the warning name which case it is.
 *
 * @param {string|null} consumerLastSeenAt - ISO timestamp, or null for "never".
 * @param {Object} [options]
 * @param {Date} [options.now] - Injectable clock for tests.
 * @returns {string|null}
 */
export function buildConsumerPollWarning(consumerLastSeenAt, { now = new Date() } = {}) {
  if (!consumerLastSeenAt) {
    return 'No consumer has ever polled this workspace — this dispatch was enqueued but may sit unclaimed until a runner starts.';
  }
  const lastSeen = new Date(consumerLastSeenAt);
  if (Number.isNaN(lastSeen.getTime())) return null;
  const ageMs = now.getTime() - lastSeen.getTime();
  // Strictly "older than" the limit (ticket wording) — a poll exactly at
  // the boundary is not yet stale.
  if (ageMs <= NOBODY_LISTENING_MS) return null;
  return `No consumer has polled this workspace since ${consumerLastSeenAt} — this dispatch was enqueued but may sit unclaimed until a runner starts.`;
}

/**
 * Read-time poll warning for a dispatch row (LIN-3367): the warning only means
 * something while the row is still `queued` — "this may sit unclaimed until a
 * runner starts". Once a row is taken / terminal / closed it has been picked
 * up (or ended), so the warning is `null`, never a stale "no consumer has ever
 * polled" on a row that was claimed within seconds (wake rows carry no enqueue
 * stamp, which used to read as "ever").
 *
 * `liveLastSeenAt` is the LIVE `getConsumerLastSeenAt(...)` value, NOT the
 * enqueue-stamped `item.consumerLastSeenAt`. That helper is async and lists
 * tokens, so callers read it ONCE per request and pass the value for every row.
 *
 * @param {string} status - The row's reported status.
 * @param {string|null} liveLastSeenAt - Live poll recency, or null for "never".
 * @param {Object} [options] - Forwarded to `buildConsumerPollWarning`.
 * @returns {string|null}
 */
export function buildQueuedPollWarning(status, liveLastSeenAt, options) {
  if (status !== 'queued') return null;
  return buildConsumerPollWarning(liveLastSeenAt || null, options);
}
