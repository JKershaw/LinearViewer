/**
 * Most recent credential resolution per (workspace, owner) — the lookup a 401
 * uses to name the credential the upstream rejected.
 *
 * Keyed the same way the token cache is (`workspaceTokenCacheKey`'s pairing),
 * because that is exactly the granularity at which two callers can receive
 * DIFFERENT credentials for the same workspace: owner-scoped selection means
 * one operator's token and an agent's token resolve independently. That
 * asymmetry is what made the 2026-08-09 incident unreadable — one token 200'd
 * while another 401'd on the same endpoint and the same issue ids.
 *
 * HONEST LIMIT: this is a correlation, not a per-request join. It records the
 * latest resolution for the pair, so under genuinely interleaved traffic with
 * a credential rotating mid-flight the named fingerprint could lag by a
 * request. It is exact in the case it is built for — a stuck credential
 * failing repeatedly, where every resolution in the window is the same one.
 * Never read for anything but logging.
 *
 * Bounded so a long-lived process cannot grow it without limit; Map preserves
 * insertion order, so evicting the oldest key is a shift off the front.
 */
import { describeCredentialResolution } from './credential-diagnostics.js';

const RESOLUTION_TRAIL_LIMIT = 256;

function resolutionKey(urlKey, ownerAccountId) {
  return `${urlKey ?? ''}\x00${ownerAccountId ?? ''}`;
}

/**
 * Builds one credential-resolution trail (a `credentialResolutions` Map plus
 * the two functions that read/write it), scoped to a single `createProxyRoutes`
 * call the way the trail always has been — a second factory call gets its own,
 * independent trail rather than sharing state with the first.
 */
export function createCredentialTrail() {
  const credentialResolutions = new Map();

  function recordCredentialResolution(urlKey, ownerAccountId, descriptorInput) {
    const key = resolutionKey(urlKey, ownerAccountId);
    // Re-insert so the most recently used key moves to the back of the eviction
    // order; without the delete, a hot key keeps its original position and can
    // be evicted while cold keys survive.
    credentialResolutions.delete(key);
    credentialResolutions.set(key, describeCredentialResolution(descriptorInput));
    if (credentialResolutions.size > RESOLUTION_TRAIL_LIMIT) {
      credentialResolutions.delete(credentialResolutions.keys().next().value);
    }
  }

  /**
   * Emit the one line that identifies a 401.
   * Write-up: docs/incidents/2026-08-09-proxy-401-flood.md
   *
   * The proxy returns 401 for two completely different failures that were
   * previously indistinguishable in the logs, and `stage` separates them:
   *
   *   - `proxy-token`   the CALLER's bearer token was rejected by Harbour. No
   *                     workspace credential was ever resolved. Remedy: re-issue
   *                     the agent's token.
   *   - `provider-lane` Harbour resolved a workspace credential, sent it
   *                     upstream, and the PROVIDER rejected it. Remedy is
   *                     entirely different — the stored credential is dead — and
   *                     the descriptor names which one, where it came from, and
   *                     what expiry the server believed it had.
   *
   * Deliberately NOT rate-limited. A flood of these is the signal: the volume,
   * and the fact that every line carries the same fingerprint, is what tells you
   * a single stuck credential is being re-served rather than many callers
   * failing independently. Throttling would erase exactly the evidence this
   * exists to capture. It costs one line per already-failing request.
   */
  function logCredentialRejection(req, endpoint) {
    const descriptor = credentialResolutions.get(resolutionKey(req.proxyUrlKey, req.proxyCreatedBy));
    console.warn('[credential-rejected]', JSON.stringify({
      // LIN-1746 (found by code review, round 6): `stage` here must agree
      // with logEvent's own `stage` below — both answer "did THIS request
      // actually resolve a provider credential." `descriptor` presence is
      // the WRONG signal for that: `recordCredentialResolution` records an
      // entry unconditionally, even on a resolution failure (credential:
      // null), so it stays truthy long after this diagnostic's own doc
      // above says `provider-lane` should mean "Harbour resolved a
      // credential." `req.resolvedCredentialFingerprint`'s presence is the
      // correct, already-fixed signal (see resolveProviderAccess).
      stage: req.resolvedCredentialFingerprint !== undefined ? 'provider-lane' : 'proxy-token',
      endpoint,
      method: req.method,
      urlKey: req.proxyUrlKey ?? null,
      // Identifies the CALLING token (already recorded on every audit row), so a
      // flood can be attributed to one agent's credential rather than guessed at.
      proxyTokenId: req.proxyTokenId ?? null,
      proxyTokenLabel: req.proxyTokenLabel ?? null,
      // LIN-2236 (LIN-2231 amendment A4): a 503 this now also covers (see
      // logEvent below) frequently means NO credential was ever selected —
      // `credentialResolutions` has no entry for this (urlKey, createdBy) pair
      // to spread in. That absence is itself a diagnostic fact, not nothing:
      // record it explicitly as `credentialSource: 'none'` rather than
      // silently omitting the field (which is indistinguishable, on the wire,
      // from a descriptor whose source happened to be missing for some other
      // reason).
      ...(descriptor ?? { credentialSource: 'none' }),
    }));
  }

  return { recordCredentialResolution, logCredentialRejection };
}
