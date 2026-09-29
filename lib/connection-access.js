/**
 * Connection-backed read-arm helpers (LIN-3124 PR3, D7/D12).
 *
 * Pure/selection logic for the owner-scoped connection-first arm in
 * `server.js`'s `resolveWorkspaceAccess`, factored out so it is unit-testable
 * without a database or a listening server. The IO (readConnectionsByReferent,
 * authorizeConnection, refreshConnection) is injected by the caller.
 *
 * This module imports only the store-free `connection-binding.js` and
 * `workspace.js` (for the provider call-scope projection), so it is outside the
 * D6(c) protected set and imports none of the three connection modules.
 *
 * D12: the provider is a mandatory filter on the durable lookup; among the
 * owner's connections for that provider the best is chosen by the LIN-1982
 * finite-beats-sentinel expiry rule (mirrored here rather than exporting the
 * hash-pinned `isBetterCandidate` from the resolver, which §7 pins at zero
 * diff).
 */
import { getBindingCallScope } from './workspace.js';
import { SENTINEL_EXPIRY_FLOOR_MS } from './credential-diagnostics.js';

/** The credential bag on a Connection row. */
export function connectionCredential(connection) {
  return connection?.credentials || {};
}

function isSentinel(expiresAt) {
  return typeof expiresAt === 'number' && expiresAt >= SENTINEL_EXPIRY_FLOOR_MS;
}

/** LIN-1982 rule: finite beats sentinel; otherwise the later expiry wins. */
function isBetterExpiry(candidateExpiresAt, bestExpiresAt) {
  if (bestExpiresAt === null) return true;
  const candidateSentinel = isSentinel(candidateExpiresAt);
  const bestSentinel = isSentinel(bestExpiresAt);
  if (candidateSentinel !== bestSentinel) return !candidateSentinel;
  return candidateExpiresAt > bestExpiresAt;
}

/** True when a Connection's credential is live (expiry beyond the refresh buffer). */
export function isConnectionCredentialLive(connection, { now = Date.now(), bufferMs } = {}) {
  const expiresAt = connectionCredential(connection).tokenExpiresAt;
  return typeof expiresAt === 'number' && expiresAt > now + bufferMs;
}

/** The live subset of `connections`. */
export function liveConnections(connections, { now = Date.now(), bufferMs } = {}) {
  return (connections || []).filter(c => isConnectionCredentialLive(c, { now, bufferMs }));
}

/**
 * Pick the best Connection among candidates by credential expiry (finite beats
 * sentinel, then later wins). A candidate with no numeric expiry is only chosen
 * when nothing better exists.
 */
export function selectBestConnection(connections) {
  let best = null;
  let bestExpiry = null;
  for (const connection of connections || []) {
    const expiresAt = connectionCredential(connection).tokenExpiresAt;
    if (typeof expiresAt !== 'number') {
      if (best === null) best = connection;
      continue;
    }
    if (isBetterExpiry(expiresAt, bestExpiry)) {
      best = connection;
      bestExpiry = expiresAt;
    }
  }
  return best;
}

/**
 * D12 provider selection for the headless arm: the owner's session row's
 * `workspace.provider` (today's `headlessRefreshProvider` source), falling back
 * to `linear` when no row exists (today's post-logout behaviour). The row
 * selector and provider normalizer are injected so this module stays free of
 * the protected resolver.
 */
export function ownerHeadlessProvider(sessions, urlKey, ownerAccountId, { selectOwnerSessionRow, normalizeProvider }) {
  const ownerRow = selectOwnerSessionRow(sessions, urlKey, ownerAccountId);
  return ownerRow ? normalizeProvider(ownerRow.session.workspaces[ownerRow.workspaceIndex]) : 'linear';
}

/**
 * Build the `resolveWorkspaceAccess` result for a Connection, using the SAME
 * provider call-scope projection the session lane uses (`getBindingCallScope`).
 * A transient LEGACY-shaped binding is used deliberately: the projection reads
 * `binding.credentials`, and this object is never persisted or hydrated.
 *
 * The `scope` output carries no `connectionId`, so the `scope ?? token`
 * substitution cannot leak one.
 */
export function connectionResolveResult(connection, { source, fingerprintCredential }) {
  const credentials = connectionCredential(connection);
  const binding = { provider: connection.provider, scope: connection.unitId, credentials };
  const scope = getBindingCallScope(binding);
  const token = credentials.token;
  return {
    token,
    scope,
    provider: connection.provider,
    expiresAt: credentials.tokenExpiresAt,
    source,
    credentialFingerprint: fingerprintCredential(scope ?? token),
  };
}