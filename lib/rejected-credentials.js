/**
 * rejected-credentials.js — the missing feedback edge on the headless lane
 * (LIN-1980, amplifier follow-up to the 2026-08-09 incident).
 *
 * THE GAP THIS CLOSES. When the provider rejects a workspace credential on the
 * consumer proxy, nothing learns from it: selection's only liveness test is
 * recorded expiry, so a credential revoked upstream reads as perfectly healthy
 * and the next poll re-selects and re-serves the same dead credential.
 *
 * THIS IS NOT PR #1099's REGISTRY. That earlier design made a suspected
 * credential UNSELECTABLE (`selectOwnerWorkspaceToken` skipped it, forcing
 * `selected.token` falsy) after `threshold` CONSECUTIVE rejections. CI proved
 * that latches into a workspace-wide 503 whenever no replacement credential
 * can be minted — the exact "refuse to serve a live credential" failure mode
 * this ticket exists to avoid. See the LIN-1980 investigation comment for the
 * differential-test evidence.
 *
 * This registry instead marks a credential SUSPECT — a signal consulted only
 * to decide whether to ATTEMPT a forced refresh, never to withhold anything.
 * `resolveWorkspaceAccess` (server.js) still serves the originally-selected
 * credential whenever no replacement is found; this registry never makes a
 * credential unselectable and is never consulted by
 * `selectOwnerWorkspaceToken`.
 *
 * SINGLE STRIKE, NOT CONSECUTIVE COUNTING. `graphqlErrorStatus` collapses
 * upstream 401 and 403 into one proxy 401, so a false-positive mark (a
 * scope-403 on an otherwise-healthy credential) is possible. Under the old
 * unselectable design that risk demanded consecutive-strike counting to avoid
 * a false 503. Here a false positive only costs one rate-limited forced-refresh
 * attempt — cheap by construction, since a `null`/same-fingerprint/throw result
 * always falls through to the credential already selected. So a single
 * rejection is enough to mark suspect.
 *
 * Identity is `fingerprintCredential` (lib/credential-diagnostics.js) — the
 * same one-way digest the `[credential-rejected]` log line prints, so a mark
 * here and a line in the log can never disagree about which credential. No
 * token bytes are stored: the registry holds digests only.
 *
 * SCOPE — deliberately per-process and in-memory, mirroring the existing
 * `workspaceTokenCache`/`credentialResolutions` precedents. A restart clears
 * every mark, which is the correct failure direction: a restart should retry,
 * not inherit suspicion.
 */

/** How long a mark lasts before the credential is treated as no longer suspect. */
export const DEFAULT_SUSPECT_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Per-fingerprint cooldown between forced-refresh attempts, so concurrent or
 * rapid resolves for the same suspect credential trigger at most one refresh
 * round-trip per window instead of one per request.
 */
export const DEFAULT_REFRESH_COOLDOWN_MS = 60 * 1000; // 60 seconds

/** Bounded so a long-lived process cannot grow the registry without limit. */
export const DEFAULT_REGISTRY_LIMIT = 256;

/**
 * @param {Object}   [opts]
 * @param {number}   [opts.suspectTtlMs]     how long a mark lasts
 * @param {number}   [opts.refreshCooldownMs] per-fingerprint forced-refresh cooldown
 * @param {number}   [opts.limit=256]        max tracked fingerprints
 * @param {Function} [opts.now]              injectable clock (ms), for tests
 */
export function createRejectedCredentialRegistry({
  suspectTtlMs = DEFAULT_SUSPECT_TTL_MS,
  refreshCooldownMs = DEFAULT_REFRESH_COOLDOWN_MS,
  limit = DEFAULT_REGISTRY_LIMIT,
  now = () => Date.now(),
} = {}) {
  // fingerprint -> { markedAt, reason, lastAttemptAt }
  const entries = new Map();

  function prune(currentTime) {
    for (const [fingerprint, entry] of entries) {
      if (currentTime - entry.markedAt >= suspectTtlMs) entries.delete(fingerprint);
    }
  }

  /**
   * Record that the provider just refused this credential. Fail-open on an
   * unidentifiable credential — there is nothing to key on, and guessing
   * would risk marking an unrelated one.
   *
   * @param {string|null|undefined} fingerprint
   * @param {{reason?: string, now?: number}} [opts]
   */
  function markSuspect(fingerprint, { reason = null, now: at } = {}) {
    if (!fingerprint) return;
    const currentTime = at ?? now();
    prune(currentTime);
    // Re-insert so the hottest fingerprint sits at the back of the eviction
    // order, and so a repeat rejection refreshes the TTL — a credential that
    // keeps failing should keep reading as suspect. `lastAttemptAt` is
    // preserved across re-marks: it tracks refresh ATTEMPTS, not rejections,
    // and resetting it here would defeat the cooldown on a hot failure loop.
    const existing = entries.get(fingerprint);
    entries.delete(fingerprint);
    entries.set(fingerprint, { markedAt: currentTime, reason, lastAttemptAt: existing?.lastAttemptAt ?? null });
    if (entries.size > limit) entries.delete(entries.keys().next().value);
  }

  /**
   * @param {string|null|undefined} fingerprint
   * @param {number} [at] injectable "now", for tests
   * @returns {boolean} true while the mark is within its TTL
   */
  function isSuspect(fingerprint, at) {
    if (!fingerprint) return false;
    const currentTime = at ?? now();
    prune(currentTime);
    return entries.has(fingerprint);
  }

  /**
   * Whether a forced-refresh attempt for this fingerprint is allowed right
   * now — true at most once per `refreshCooldownMs` window. Has the side
   * effect of stamping the attempt when it returns true (a test-and-set), so
   * concurrent/rapid callers within the same window after the first see
   * `false` without needing an external lock.
   *
   * @param {string|null|undefined} fingerprint
   * @param {number} [at] injectable "now", for tests
   * @returns {boolean}
   */
  function shouldAttemptRefresh(fingerprint, at) {
    if (!fingerprint) return false;
    const currentTime = at ?? now();
    const entry = entries.get(fingerprint);
    if (!entry) return false;
    if (entry.lastAttemptAt != null && currentTime - entry.lastAttemptAt < refreshCooldownMs) return false;
    entry.lastAttemptAt = currentTime;
    return true;
  }

  /**
   * Clear a fingerprint's mark — called once a different, working credential
   * has been adopted in its place. Never called merely because a request
   * succeeded with the suspect credential still in use (this registry only
   * clears on REPLACEMENT, not on a lucky retry of the same one).
   *
   * @param {string|null|undefined} fingerprint
   */
  function accept(fingerprint) {
    if (!fingerprint) return;
    entries.delete(fingerprint);
  }

  return { markSuspect, isSuspect, shouldAttemptRefresh, accept };
}
