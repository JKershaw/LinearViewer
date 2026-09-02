/**
 * Suspect-credential recovery for the headless resolve path (LIN-1980, with
 * LIN-2473's adopt-before-exchange arm).
 *
 * Lifted verbatim out of `server.js` (LIN-2473 review B3) for one reason: this
 * is the only remedy the headless lane has for a credential the provider has
 * just rejected, and while it lived inside a module that connects to a database
 * and starts listening at import, no test could drive it. Its coverage was a
 * hand-written copy in the test file, which is how a defect on its own success
 * path (LIN-2473 B1) passed green CI. Every dependency is injected, so this
 * module performs no IO of its own and the real function is now unit-testable.
 *
 * TWO REMEDIES, IN ORDER OF COST:
 *
 * 1. ADOPT (LIN-2473). Re-read the durable owner-credential record. If it holds
 *    a DIFFERENT credential from the one that was just rejected, a concurrent
 *    rotation winner (or a human re-login) has already superseded this lane's
 *    copy — take it, free. No exchange, no rotation, no cooldown spent.
 *    Without this arm the only remedy was (2), which rotates the grant and so
 *    invalidates whoever just superseded us: the self-sustaining 65s
 *    rotate/reject/rotate cycle LIN-2473's diagnosis traced.
 *
 * 2. EXCHANGE (LIN-1980). Spend a rate-limited OAuth refresh, at most once per
 *    `refreshCooldownMs` per fingerprint AND per `${ownerAccountId}:${urlKey}`
 *    scope (review F1: the scope cooldown is what bounds attempts across
 *    fingerprint churn, since `accept()` clears the superseded fingerprint's
 *    entry).
 *
 * Strictly non-worsening by construction: on `null` (nothing refreshable), a
 * throw, or the SAME fingerprint coming back, this returns `null` and the
 * caller keeps serving the credential it already selected, unchanged. Never
 * attempted for UNSCOPED (owner-blind) callers — mirroring the exclusion
 * refresh-on-resolve already applies.
 */
import { UNSCOPED } from './workspace-token-resolver.js';
import { refreshOwnerWorkspaceToken } from './workspace-token-refresh.js';
import { fingerprintCredential } from './credential-diagnostics.js';
import { normalizeProviderName } from './workspace.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from './credential-lifecycle-events.js';

/**
 * Can this provider's durable record be served as a credential on its own?
 *
 * Only where the provider's CALL SCOPE IS THE BARE TOKEN. This is the same
 * question — and the same answer — as the exchange path's own guard
 * (`lib/workspace-token-refresh.js`, "Linear's return stays exactly what it
 * was … no `scope`"), which drops the durable record's `scope` for Linear
 * because that field is the ORG ID, not a credential, and builds a structured
 * provider's pairing from a live session row instead.
 *
 * The adopt arm has no session row by construction — it is a point-read of the
 * durable store — so it can never build that pairing, which maps it exactly
 * onto the `!ownerWorkspace` half of that same guard. A structured-credential
 * provider (Jira's `{email, apiToken, site}`, the GitHub family's
 * `{token, repo}`) therefore falls through to the exchange arm untouched,
 * where a session row is available. Adopting a bare token for one of those
 * would hand `routes/proxy.js`'s `scope ?? token` substitution half a
 * credential — the same class of defect as leaking the org id.
 *
 * It also keeps credential IDENTITY consistent. Callers fingerprint
 * `scope ?? token`; for Linear the call scope IS the token, so the rejected
 * fingerprint and `fingerprintCredential(record.token)` are computed over the
 * same bytes and the comparison below means what it says. For a structured
 * provider they are computed over different fields, so a "difference" would be
 * an artefact of the shape rather than evidence of a newer credential — and
 * the adopt arm would fire on every resolve, starving the exchange arm and,
 * with it, LIN-2327/2329's byte-identical escalation.
 */
function isBareTokenCredentialProvider(provider) {
  return normalizeProviderName(provider) === 'linear';
}

/**
 * @param {Object} args
 * @param {string|null} args.fingerprint - fingerprint of the credential that was just rejected
 * @param {string} args.urlKey
 * @param {string|symbol} args.ownerAccountId
 * @param {string} [args.provider] - provider of the credential just selected (durable partition to point-read)
 * @param {() => Promise<Array>} args.loadSessions - thunk, so the cache-hit caller pays for `find({})` only when a refresh is actually due
 * @param {Object} args.registry - rejectedCredentialRegistry
 * @param {Object} args.store - ownerCredentialStore
 * @param {Object} args.lifecycleEventStore - credentialLifecycleEventStore
 * @param {Function} args.refreshAccessToken
 * @param {Function} args.persistSession
 * @param {Function} args.resolveProvider
 * @param {Function} [args.resolveExchange]
 * @returns {Promise<{token: *, expiresAt: number, provider: string, scope?: *, credentialFingerprint: string}|null>}
 */
// NOTE: the destructured parameter list stays on ONE line deliberately. The
// LIN-1980/LIN-2327 anti-drift pins extract this function by scanning for its
// first column-0 `}`; a wrapped parameter list closes with `}) {` in column 0
// and would silently truncate every one of them to the signature.
export async function attemptSuspectCredentialRefresh({ fingerprint, urlKey, ownerAccountId, provider, loadSessions, registry, store, lifecycleEventStore, refreshAccessToken, persistSession, resolveProvider, resolveExchange }) {
  if (ownerAccountId === UNSCOPED) return null;
  if (!registry.isSuspect(fingerprint)) return null;

  // --- Remedy 1: adopt a newer durable credential (LIN-2473) ---------------
  //
  // Deliberately BEFORE `shouldAttemptRefresh`: adopting costs nothing, so it
  // must not consume the one rate-limited exchange attempt this window allows.
  //
  // Not a pure read, and the comment should not claim otherwise: on a legacy
  // 2-part record `store.get` relocates it to its partitioned key
  // (`_migrateLegacy`, lib/owner-credential-store.js). That is idempotent and
  // pre-existing on this lane — three other call sites already read through
  // it — and it moves a record rather than changing any credential: nothing
  // rotates, nothing is spent, no credential is lost.
  if (isBareTokenCredentialProvider(provider)) {
    try {
      const durable = await store.get(ownerAccountId, urlKey, provider);
      if (durable?.token) {
        const durableFingerprint = fingerprintCredential(durable.token);
        if (durableFingerprint !== fingerprint) {
          // The durable record's `scope` is NOT returned. For Linear it is the
          // org id (see isBareTokenCredentialProvider above), and
          // `resolveWorkspaceAccess` caches whatever comes back here, from
          // which `routes/proxy.js` substitutes `scope ?? token` as the
          // credential — so returning it would authenticate with an org id.
          // Same three fields the exchange arm returns for Linear, no more.
          return {
            token: durable.token,
            expiresAt: durable.tokenExpiresAt,
            provider: durable.provider,
            credentialFingerprint: durableFingerprint,
          };
        }
      }
    } catch (err) {
      // A store blip must never be worse than not having looked: fall through
      // to the exchange arm exactly as before.
      console.error(`Durable point-read for suspect-credential adoption failed for workspace ${urlKey}:`, err);
    }
  }

  // --- Remedy 2: the rate-limited OAuth exchange (LIN-1980) ----------------
  if (!registry.shouldAttemptRefresh(fingerprint, `${ownerAccountId}:${urlKey}`)) return null;
  try {
    const sessions = await loadSessions();
    const refreshed = await refreshOwnerWorkspaceToken({
      sessions,
      urlKey,
      ownerAccountId,
      refreshAccessToken,
      persistSession,
      resolveProvider,
      resolveExchange,
      store,
      lifecycleEventStore,
    });
    if (!refreshed) return null;
    const refreshedFingerprint = fingerprintCredential(refreshed.scope ?? refreshed.token);
    // The provider hasn't necessarily fixed anything — a re-mint/re-read can
    // hand back the identical dead credential. Only a GENUINE replacement
    // counts as recovery; anything else falls through untouched.
    if (refreshedFingerprint === fingerprint) {
      // LIN-2327: make the byte-identical loop visible (previously silent)
      // and count it toward the escalation threshold that turns this
      // fingerprint's provider-auth classification terminal — see
      // isTransientProviderAuthFailure (routes/proxy.js). Fire-and-forget,
      // secret-safe (fingerprint digest only, never token bytes).
      lifecycleEventStore.recordEvent({
        accountId: ownerAccountId, urlKey, provider: refreshed.provider,
        kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SKIP,
        detail: { branch: 'byte-identical-after-rejection', fingerprint: refreshedFingerprint }
      }).catch(err => console.error('Failed to record credential-lifecycle event:', err));
      registry.recordByteIdenticalRejection?.(refreshedFingerprint);
      return null;
    }
    return { ...refreshed, credentialFingerprint: refreshedFingerprint };
  } catch (err) {
    console.error(`Suspect-credential forced refresh failed for workspace ${urlKey}:`, err);
    return null;
  }
}
