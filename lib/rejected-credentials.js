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
 * THE COOLDOWN IS TWO-LEVEL (LIN-1980 review F1). The per-fingerprint cooldown
 * alone does not bound attempts once a replacement is adopted: `accept()`
 * deletes the superseded fingerprint's entry (attempt stamp included), and a
 * freshly-marked replacement fingerprint starts with `lastAttemptAt: null` —
 * so a credential that keeps rotating to a new fingerprint on every refresh
 * while still being rejected (a routine 403 collapsed to 401 against a
 * healthy-but-scope-limited credential is enough to trigger this; see the
 * review comment on LIN-1980) re-triggers a forced refresh on every single
 * request, not once per window. A second cooldown keyed on the caller-supplied
 * `scopeKey` (`resolveWorkspaceAccess` passes `${ownerAccountId}:${urlKey}`)
 * closes that gap: it survives `accept()` (deliberately — the whole point is
 * to keep governing the NEXT fingerprint this workspace churns through, not
 * reset just because one particular fingerprint was superseded), so a
 * workspace attempts a forced refresh at most once per `refreshCooldownMs`
 * window no matter how many distinct fingerprints it produces in that window.
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
 *
 * BYTE-IDENTICAL-REJECTION COUNTER (LIN-2327). A fourth map, independent of
 * `entries`/`scopeAttempts`/`witnessed` above: `byteIdenticalRejections`,
 * keyed on `fingerprint` ALONE — no owner/urlKey scope component of any kind.
 * Fingerprint-only keying was chosen over a scope-composite key because the
 * write site (`server.js`'s `attemptSuspectCredentialRefresh`) sees a
 * canonical account id while the read site (`routes/proxy.js`'s classifier)
 * only ever has the raw, pre-merge id on `req` — a workspace whose owning
 * account was later merged would silently and permanently desync a
 * scope-keyed counter between the two sites. Fingerprint alone removes the
 * shared variable those two sites could ever disagree about. Retention is
 * limit-only, never time-pruned — the same discipline `scopeAttempts` already
 * uses — because a TTL-pruned counter would lapse exactly at
 * `suspectTtlMs`, the moment `isSuspect` also lapses, re-arming the very loop
 * this counter exists to stop. A fingerprint's count is never decremented or
 * cleared by a later successful response or `witnessAccepted` call — once
 * past threshold, a fingerprint stays classified terminal for the rest of
 * the process's life (or until LRU eviction): re-auth mints new bytes, i.e.
 * a new fingerprint and a fresh counter, rather than rehabilitating the old
 * one.
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
 * How many byte-identical-after-rejection refreshes for the same fingerprint
 * before that fingerprint is treated as never-transient (LIN-2327). Mirrors
 * `RECENT_REASON_MIN_STREAK`'s "one data point is ambiguous" rationale — a
 * single byte-identical refresh could still be a race; a second is a pattern.
 */
export const BYTE_IDENTICAL_ESCALATION_THRESHOLD = 2;

/**
 * Shared eviction helper: deletes every entry from `map` whose age (relative
 * to `currentTime`) has reached `ttlMs`. `timestampOf` extracts the age
 * timestamp from a stored value — `entries` stores `{markedAt, ...}` objects,
 * `witnessed` stores a bare timestamp, so this stays one small function
 * rather than two near-identical copies of the same loop.
 */
function pruneStale(map, currentTime, ttlMs, timestampOf) {
  for (const [key, value] of map) {
    if (currentTime - timestampOf(value) >= ttlMs) map.delete(key);
  }
}

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
  // scopeKey (e.g. `${ownerAccountId}:${urlKey}`) -> lastAttemptAt. Deliberately
  // separate from `entries` and never touched by `accept()` — see the
  // "two-level cooldown" module doc above.
  const scopeAttempts = new Map();

  function prune(currentTime) {
    pruneStale(entries, currentTime, suspectTtlMs, entry => entry.markedAt);
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
   * `scopeKey`, when provided, adds a SECOND cooldown across the same window,
   * keyed independently of fingerprint (LIN-1980 review F1). Without it, a
   * credential that rotates to a new fingerprint on every refresh while
   * still being rejected escapes the per-fingerprint cooldown entirely — each
   * new fingerprint starts with no attempt history of its own. The scope
   * cooldown bounds attempts for the underlying workspace/owner regardless of
   * how many fingerprints it churns through. Optional and independently
   * test-and-set, same shape as the per-fingerprint check.
   *
   * @param {string|null|undefined} fingerprint
   * @param {string|null|undefined} [scopeKey] caller-stable identity (e.g. `${ownerAccountId}:${urlKey}`) to cap attempts across fingerprint churn
   * @param {number} [at] injectable "now", for tests
   * @returns {boolean}
   */
  function shouldAttemptRefresh(fingerprint, scopeKey, at) {
    if (!fingerprint) return false;
    const currentTime = at ?? now();
    const entry = entries.get(fingerprint);
    if (!entry) return false;
    if (entry.lastAttemptAt != null && currentTime - entry.lastAttemptAt < refreshCooldownMs) return false;
    if (scopeKey) {
      const scopeLastAttempt = scopeAttempts.get(scopeKey);
      if (scopeLastAttempt != null && currentTime - scopeLastAttempt < refreshCooldownMs) return false;
    }
    entry.lastAttemptAt = currentTime;
    if (scopeKey) {
      scopeAttempts.delete(scopeKey);
      scopeAttempts.set(scopeKey, currentTime);
      if (scopeAttempts.size > limit) scopeAttempts.delete(scopeAttempts.keys().next().value);
    }
    return true;
  }

  /**
   * Clear a fingerprint's mark — called once a different, working credential
   * has been adopted in its place. Never called merely because a request
   * succeeded with the suspect credential still in use (this registry only
   * clears on REPLACEMENT, not on a lucky retry of the same one).
   *
   * Deliberately does NOT touch `scopeAttempts` — the scope cooldown exists
   * precisely to keep governing whatever fingerprint this workspace produces
   * NEXT, so clearing it on acceptance would defeat it the moment it matters.
   *
   * @param {string|null|undefined} fingerprint
   */
  function accept(fingerprint) {
    if (!fingerprint) return;
    entries.delete(fingerprint);
  }

  // fingerprint -> witnessedAt (LIN-2109). A THIRD, independent map — never
  // touched by markSuspect/isSuspect/accept/shouldAttemptRefresh above, which
  // all answer "was this fingerprint recently REJECTED". This answers a
  // structurally different question: "has this fingerprint ever been PROVEN
  // accepted by a real, non-401 provider-lane response". Exchange success and
  // adoption are deliberately NOT this signal — see this module's own header
  // and `accept()`'s own doc for why (LIN-1983's two singleton fingerprints:
  // exchanged, adopted, `accept()`ed, and 401'd immediately). Same
  // `suspectTtlMs`/`limit` discipline as `entries` — a witness this old is
  // stale evidence, and the map is bounded the same way.
  const witnessed = new Map();

  function pruneWitnessed(currentTime) {
    pruneStale(witnessed, currentTime, suspectTtlMs, witnessedAt => witnessedAt);
  }

  /**
   * Record that a NON-401 provider-lane response was actually observed for
   * this fingerprint — the sound witness this ticket names, as opposed to
   * merely having exchanged or adopted it. Fail-open on an unidentifiable
   * credential, mirroring `markSuspect`.
   *
   * @param {string|null|undefined} fingerprint
   * @param {number} [at] injectable "now", for tests
   */
  function witnessAccepted(fingerprint, at) {
    if (!fingerprint) return;
    const currentTime = at ?? now();
    pruneWitnessed(currentTime);
    witnessed.delete(fingerprint);
    witnessed.set(fingerprint, currentTime);
    if (witnessed.size > limit) witnessed.delete(witnessed.keys().next().value);
  }

  /**
   * @param {string|null|undefined} fingerprint
   * @param {number} [at] injectable "now", for tests
   * @returns {boolean} true iff this fingerprint has a live (unexpired) acceptance witness
   */
  function hasBeenWitnessed(fingerprint, at) {
    if (!fingerprint) return false;
    const currentTime = at ?? now();
    pruneWitnessed(currentTime);
    return witnessed.has(fingerprint);
  }

  // fingerprint -> { count, lastAt } (LIN-2327). A FOURTH, independent map —
  // never touched by markSuspect/isSuspect/accept/shouldAttemptRefresh/
  // witnessAccepted/hasBeenWitnessed above. Keyed on fingerprint alone (see
  // module doc above for why) and never time-pruned (limit-only eviction).
  const byteIdenticalRejections = new Map();

  /**
   * Record that a forced refresh against this fingerprint came back
   * byte-identical to the credential that was just rejected — the signature
   * this ticket exists to make visible and, past threshold, terminal.
   * Fail-open on an unidentifiable credential, mirroring `markSuspect`.
   *
   * @param {string|null|undefined} fingerprint
   * @param {number} [at] injectable "now", for tests (signature symmetry only — unused for retention, since this map is never time-pruned)
   */
  function recordByteIdenticalRejection(fingerprint, at) {
    if (!fingerprint) return;
    const currentTime = at ?? now();
    const existing = byteIdenticalRejections.get(fingerprint);
    byteIdenticalRejections.delete(fingerprint);
    byteIdenticalRejections.set(fingerprint, { count: (existing?.count ?? 0) + 1, lastAt: currentTime });
    if (byteIdenticalRejections.size > limit) byteIdenticalRejections.delete(byteIdenticalRejections.keys().next().value);
  }

  /**
   * @param {string|null|undefined} fingerprint
   * @param {number} threshold
   * @param {number} [at] injectable "now", for tests (unused — no prune step, nothing to prune)
   * @returns {boolean} true once this fingerprint's byte-identical-rejection count has reached `threshold`
   */
  function isPastByteIdenticalThreshold(fingerprint, threshold, at) {
    if (!fingerprint) return false;
    return (byteIdenticalRejections.get(fingerprint)?.count ?? 0) >= threshold;
  }

  return {
    markSuspect, isSuspect, shouldAttemptRefresh, accept, witnessAccepted, hasBeenWitnessed,
    recordByteIdenticalRejection, isPastByteIdenticalThreshold
  };
}
