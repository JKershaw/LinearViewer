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

/** Default staleness threshold: 1 hour. */
export const DEFAULT_CONSUMER_POLL_WARNING_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Reads the configurable staleness threshold from the
 * `CONSUMER_POLL_WARNING_THRESHOLD_MS` env var, falling back to the 1h
 * default on an absent, non-numeric, or non-positive value. Read fresh per
 * call (no caching) so a changed env var takes effect on the next dispatch —
 * mirrors lib/plan-fee-config.js's env-config convention.
 *
 * @returns {number} Threshold in milliseconds.
 */
export function getConsumerPollWarningThresholdMs() {
  const raw = process.env.CONSUMER_POLL_WARNING_THRESHOLD_MS;
  if (raw === undefined || raw === '') return DEFAULT_CONSUMER_POLL_WARNING_THRESHOLD_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONSUMER_POLL_WARNING_THRESHOLD_MS;
}

/**
 * Resolves the most recent `lastUsedAt` across a workspace's consumer
 * tokens. `dispatchTokenStore.listTokens` already scopes to non-revoked
 * tokens — a revoked token is deleted outright (lib/dispatch-tokens.js's
 * `revokeToken`), never merely flagged — so every row it returns is live.
 * Fail-soft: a missing store/method, or a store read failure, resolves to
 * null (treated as "never seen"), the same fail-open stance the dispatch
 * factory's other capability-gated guards take.
 *
 * @param {Object} dispatchTokenStore - Must expose `listTokens(urlKey)`.
 * @param {string} urlKey - Workspace URL key.
 * @returns {Promise<string|null>} ISO timestamp of the most recent poll/take,
 *   or null when the workspace has never had a consumer token poll/take.
 */
export async function getConsumerLastSeenAt(dispatchTokenStore, urlKey) {
  if (!dispatchTokenStore || typeof dispatchTokenStore.listTokens !== 'function' || !urlKey) {
    return null;
  }
  const tokens = await dispatchTokenStore.listTokens(urlKey).catch(() => []);
  let latest = null;
  for (const token of tokens || []) {
    if (!token?.lastUsedAt) continue;
    const seenAt = token.lastUsedAt instanceof Date ? token.lastUsedAt : new Date(token.lastUsedAt);
    if (Number.isNaN(seenAt.getTime())) continue;
    if (!latest || seenAt > latest) latest = seenAt;
  }
  return latest ? latest.toISOString() : null;
}

/**
 * Builds the human-readable poll-recency warning for a `consumerLastSeenAt`
 * value, or null when the workspace is being actively polled (a live
 * workspace shows nothing new — see the ticket's own "done when"). Reused
 * both at enqueue time (the 201 body) and at read time (GET /dispatch/{id},
 * the lean list) against the SAME stamped value, so "on the item" and "at
 * dispatch" never disagree about what counts as stale.
 *
 * Distinguishes "never" (no consumer token has ever polled/taken in this
 * workspace) from a concrete stale timestamp, per the ticket's explicit
 * requirement that the warning name which case it is.
 *
 * @param {string|null} consumerLastSeenAt - ISO timestamp, or null for "never".
 * @param {Object} [options]
 * @param {number} [options.thresholdMs] - Staleness threshold; defaults to
 *   `getConsumerPollWarningThresholdMs()`.
 * @param {Date} [options.now] - Injectable clock for tests.
 * @returns {string|null}
 */
export function buildConsumerPollWarning(consumerLastSeenAt, { thresholdMs = getConsumerPollWarningThresholdMs(), now = new Date() } = {}) {
  if (!consumerLastSeenAt) {
    return 'No consumer has ever polled this workspace — this dispatch was enqueued but may sit unclaimed until a runner starts.';
  }
  const lastSeen = new Date(consumerLastSeenAt);
  if (Number.isNaN(lastSeen.getTime())) return null;
  const ageMs = now.getTime() - lastSeen.getTime();
  // Strictly "older than" the threshold (ticket wording) — a poll exactly at
  // the boundary is not yet stale.
  if (ageMs <= thresholdMs) return null;
  return `No consumer has polled this workspace since ${consumerLastSeenAt} — this dispatch was enqueued but may sit unclaimed until a runner starts.`;
}
