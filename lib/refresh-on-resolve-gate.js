/**
 * refresh-on-resolve-gate.js — bounds the OAuth-exchange attempt rate on the
 * refresh-on-resolve branch (server.js's `resolveWorkspaceAccess`, the
 * `!selected.token && ownerAccountId !== UNSCOPED` block), added as part of
 * LIN-2097.
 *
 * THE GAP THIS CLOSES. LIN-2097's other half (lib/workspace-token-refresh.js's
 * `doOwnerRefresh`) freezes a rejected credential's recorded expiry instead of
 * re-stamping it forward on every forced refresh. That freeze has a direct
 * consequence: once the frozen expiry ages past the refresh buffer, EVERY
 * subsequent resolve for that owner+workspace falls into the refresh-on-resolve
 * branch and attempts a live OAuth exchange — a branch that, unlike the
 * suspect-credential lane (`attemptSuspectCredentialRefresh` in server.js, its
 * own `rejectedCredentialRegistry`-backed cooldown), has NO cooldown at all.
 * Left unguarded, freezing the expiry would turn a ~60s OAuth round-trip into a
 * per-request one — strictly worse than the defect it fixes.
 *
 * WHY NOT JUST REUSE `rejectedCredentialRegistry.isSuspect`/`shouldAttemptRefresh`.
 * That registry's mark carries a TTL (`DEFAULT_SUSPECT_TTL_MS`, 10 minutes) far
 * shorter than how long a durably-dead credential can sit unrefreshed on this
 * branch. A gate that requires `isSuspect` to still be true stops applying the
 * moment the mark ages out — even though the row is still exactly as dead — and
 * the per-request pump resumes. This gate is deliberately unconditional: it
 * never asks the registry whether a fingerprint is (still) suspect, only
 * whether IT has attempted this exact credential recently.
 *
 * FINGERPRINT-SCOPED, NOT SCOPE-ONLY. Keyed on (scopeKey, credential
 * fingerprint) together, not scopeKey alone — a genuinely NEW credential at the
 * same scope (e.g. a human re-authorizes after seeing the workspace go dark)
 * fingerprints differently and is never throttled by a stale credential's
 * cooldown; only repeated attempts against the SAME dead bytes are bounded.
 *
 * A DISTINCT cooldown budget from `rejectedCredentialRegistry`'s own
 * `scopeAttempts` map (the one `attemptSuspectCredentialRefresh`, server.js
 * :1954, spends via `shouldAttemptRefresh`'s scopeKey argument) — this module
 * owns its own state so the two gates, which guard structurally different
 * preconditions (one already holds a fingerprint from `selected`/`cached`; this
 * one, reached only when nothing resolved at all, has none and must read the
 * durable store for one), can never consume each other's budget.
 *
 * Pure aside from the injectable clock — no IO, no import of the durable store
 * or the rejected-credentials registry — so this is unit-testable exactly like
 * lib/rejected-credentials.js and lib/workspace-token-resolver.js.
 */

/** Mirrors lib/rejected-credentials.js's DEFAULT_REFRESH_COOLDOWN_MS — same class of bound, independent budget. */
export const DEFAULT_REFRESH_ON_RESOLVE_COOLDOWN_MS = 60 * 1000; // 60 seconds

/**
 * @param {Object}   [opts]
 * @param {number}   [opts.cooldownMs] minimum time between attempts against the SAME (scopeKey, fingerprint) pair
 * @param {Function} [opts.now]        injectable clock (ms), for tests
 */
export function createRefreshOnResolveGate({
  cooldownMs = DEFAULT_REFRESH_ON_RESOLVE_COOLDOWN_MS,
  now = () => Date.now(),
} = {}) {
  // `${scopeKey}::${fingerprint}` -> attemptedAt
  const lastAttempt = new Map();

  /**
   * Test-and-set: true means "go ahead and attempt the exchange", and stamps
   * the attempt as a side effect (mirroring rejectedCredentialRegistry's
   * shouldAttemptRefresh idiom) so a concurrent/rapid caller within the same
   * window sees false without needing an external lock.
   *
   * A missing scopeKey or fingerprint always attempts — with no durable
   * credential to identify, there is no dead credential's repeated exchange to
   * bound (the caller's own refresh attempt will cheaply no-op instead of
   * spending a network round-trip).
   *
   * @param {string|null|undefined} scopeKey caller-stable identity, e.g. `${ownerAccountId}:${urlKey}`
   * @param {string|null|undefined} fingerprint the stale durable credential's fingerprint
   * @param {number} [at] injectable "now", for tests
   * @returns {boolean}
   */
  function shouldAttempt(scopeKey, fingerprint, at) {
    if (!scopeKey || !fingerprint) return true;
    const key = `${scopeKey}::${fingerprint}`;
    const currentTime = at ?? now();
    const attemptedAt = lastAttempt.get(key);
    if (attemptedAt != null && currentTime - attemptedAt < cooldownMs) return false;
    lastAttempt.set(key, currentTime);
    return true;
  }

  return { shouldAttempt };
}
