import { fingerprintCredential } from './credential-diagnostics.js';

/**
 * rejected-credentials.js — the missing feedback edge on the headless lane.
 *
 * THE GAP THIS CLOSES (2026-08-09 incident, follow-up 1). When a provider
 * rejects a workspace credential on the consumer proxy, nothing learns from it.
 * `routes/proxy.js` maps the upstream 401 → 401, returns it, and stops:
 * `evictWorkspaceToken` is called from zero places on that lane, and
 * `handleUnauthorizedError` — which refreshes, re-mints, or prompts a re-link —
 * is on the session/web path only. So the next poll re-resolves, re-selects the
 * SAME dead credential, and fails identically. That loop ran ~75 minutes at
 * ~1/sec and would not have stopped on its own.
 *
 * Cache eviction alone does NOT fix it, which is the subtlety worth stating
 * plainly: `createWorkspaceTokenCache`'s `evict` drops the 30s entry, but the
 * next resolve re-scans Mongo and `selectOwnerWorkspaceToken` re-picks the very
 * same token out of the session row — it is dead *upstream* but its recorded
 * `tokenExpiresAt` is still in the future, and that is the only liveness test
 * selection has. The credential must be made unselectable for anything to change.
 *
 * That is what this registry does: it records credentials the provider has just
 * refused, so selection can skip them. Skipping makes `selected.token` falsy,
 * which is precisely the condition refresh-on-resolve is already gated on
 * (`server.js`) — so a fresh credential gets minted from the durable store and
 * the loop ends. No new refresh path is introduced; an existing one is simply
 * made reachable for a failure mode that could never trigger it.
 *
 * WHY CONSECUTIVE COUNTING, NOT A SINGLE STRIKE. `graphqlErrorStatus` collapses
 * upstream 401 AND 403 into one proxy 401, so at the point of rejection we
 * genuinely cannot tell "this credential is dead" from "this credential is fine
 * but lacks scope for this one write", or from a transient provider blip.
 * Blocklisting on a single strike would let one scope-403 on a write suspend a
 * perfectly healthy READ credential. Requiring `threshold` CONSECUTIVE
 * rejections of the same fingerprint sidesteps that ambiguity without needing
 * to plumb the raw upstream status through 22 catch blocks: an isolated refusal
 * never trips it, while a genuinely dead credential — which fails every single
 * call — trips within three requests, about three seconds at the incident's
 * observed rate.
 *
 * Consecutive is enforced by `accept()`: any successful use of a fingerprint
 * clears its counter. Without that this would be "N failures ever", and a
 * healthy credential could accumulate three unrelated scope-403s over an hour
 * and suspend itself.
 *
 * Identity is `fingerprintCredential` (lib/credential-diagnostics.js) — the same
 * one-way digest the rejection log prints, so a suspension in the logs and a
 * suspension in here name the credential identically and can never disagree.
 * No token bytes are stored: the registry holds digests only.
 *
 * SCOPE — deliberately per-process and in-memory. A replica learns from its own
 * 401s and no others, so a multi-replica deployment converges one replica at a
 * time rather than instantly. That is accepted: the alternative is a shared
 * store on the hot path of every proxy read, and each replica still self-heals
 * within its own three strikes. It also means a restart clears every suspension,
 * which is the correct failure direction — a restart should retry, not inherit.
 */

export const DEFAULT_REJECTION_THRESHOLD = 3;

/**
 * How long a suspension lasts before the credential is retried.
 *
 * Bounded on purpose, and the bound is the safety property: if this registry is
 * ever WRONG about a credential — a provider outage answering 401 for a healthy
 * token, say — the damage self-repairs after the window instead of requiring a
 * deploy. Long enough that a genuinely dead credential is not retried in a hot
 * loop; short enough that a false suspension is an inconvenience, not an outage.
 */
export const DEFAULT_SUSPENSION_MS = 10 * 60 * 1000;

/** Bounded so a long-lived process cannot grow the registry without limit. */
export const DEFAULT_REGISTRY_LIMIT = 256;

/**
 * @param {Object}   [opts]
 * @param {number}   [opts.threshold=3]      consecutive rejections before suspension
 * @param {number}   [opts.suspensionMs]     how long a suspension lasts
 * @param {number}   [opts.limit=256]        max tracked fingerprints
 * @param {Function} [opts.now]              injectable clock (ms)
 */
export function createRejectedCredentialRegistry({
  threshold = DEFAULT_REJECTION_THRESHOLD,
  suspensionMs = DEFAULT_SUSPENSION_MS,
  limit = DEFAULT_REGISTRY_LIMIT,
  now = () => Date.now(),
} = {}) {
  // fingerprint -> { strikes, lastAt }
  const entries = new Map();

  function prune(currentTime) {
    for (const [fingerprint, entry] of entries) {
      if (currentTime - entry.lastAt >= suspensionMs) entries.delete(fingerprint);
    }
  }

  /**
   * Record that the provider refused this credential.
   *
   * @returns {boolean} whether the credential is NOW suspended (the transition
   *   is worth logging once; every subsequent rejection returns true too, so
   *   callers wanting the edge should compare against `isSuspended` beforehand)
   */
  function reject(credential) {
    const fingerprint = fingerprintCredential(credential);
    // An unidentifiable credential cannot be suspended — there is nothing to key
    // on, and guessing would risk suspending an unrelated one.
    if (!fingerprint) return false;

    const currentTime = now();
    prune(currentTime);

    const existing = entries.get(fingerprint);
    const strikes = (existing?.strikes ?? 0) + 1;
    // Re-insert so the hottest fingerprint sits at the back of the eviction
    // order; without the delete it keeps its original position and could be
    // evicted while colder entries survive.
    entries.delete(fingerprint);
    entries.set(fingerprint, { strikes, lastAt: currentTime });

    if (entries.size > limit) evictOne();

    return strikes >= threshold;
  }

  /**
   * Drop one entry to stay under `limit`, preferring the oldest entry that is
   * NOT yet suspended.
   *
   * Plain oldest-first would silently UN-SUSPEND a credential: dropping its
   * entry is indistinguishable from never having refused it, so selection would
   * hand the dead credential straight back out. Sub-threshold entries are cheap
   * to lose by comparison — the worst case is that a credential needs its three
   * strikes again. Falls back to the oldest entry when every tracked credential
   * is suspended, so this always frees a slot and can never grow unbounded.
   */
  function evictOne() {
    for (const [fingerprint, entry] of entries) {
      if (entry.strikes < threshold) {
        entries.delete(fingerprint);
        return;
      }
    }
    entries.delete(entries.keys().next().value);
  }

  /**
   * Record that this credential worked, clearing its strike count.
   *
   * This is what makes the counting CONSECUTIVE rather than cumulative, so a
   * healthy credential cannot slowly accrue unrelated refusals into a
   * suspension. Cheap enough for the success path: one Map delete.
   */
  function accept(credential) {
    const fingerprint = fingerprintCredential(credential);
    if (fingerprint) entries.delete(fingerprint);
  }

  /**
   * Has this credential been refused enough consecutive times to be skipped?
   *
   * Read by selection, so it must be total and cheap: an unidentifiable
   * credential is never suspended (fail OPEN — a credential we cannot name is
   * one we must not withhold, since withholding it would 503 a workspace on a
   * guess).
   */
  function isSuspended(credential) {
    const fingerprint = fingerprintCredential(credential);
    if (!fingerprint) return false;

    const currentTime = now();
    const entry = entries.get(fingerprint);
    if (!entry) return false;
    if (currentTime - entry.lastAt >= suspensionMs) {
      entries.delete(fingerprint);
      return false;
    }
    return entry.strikes >= threshold;
  }

  /** Diagnostic only — never used to decide anything. */
  function size() {
    return entries.size;
  }

  return { reject, accept, isSuspended, size };
}
