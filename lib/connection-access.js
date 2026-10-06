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
 * D12 owner-row read for the headless arm, returning BOTH the resolved provider
 * and the owner's session-row workspace (LIN-3241 (A)). The connection-first arm
 * needs the workspace itself to project the binding scope — the GitHub-family
 * repo — rather than `connection.unitId` (the App installation id). This is the
 * ONE `selectOwnerSessionRow` call on the headless arm, so the off-session-reader
 * census sees no extra reader; the provider falls back to `linear` when no owner
 * row exists (today's post-logout behaviour). The row selector and provider
 * normalizer are injected so this module stays free of the protected resolver.
 *
 * @returns {{provider: string, ownerWorkspace: (Object|null)}}
 */
export function ownerHeadlessContext(sessions, urlKey, ownerAccountId, { selectOwnerSessionRow, normalizeProvider }) {
  const ownerRow = selectOwnerSessionRow(sessions, urlKey, ownerAccountId);
  const ownerWorkspace = ownerRow ? ownerRow.session.workspaces[ownerRow.workspaceIndex] : null;
  return {
    provider: ownerRow ? normalizeProvider(ownerWorkspace) : 'linear',
    ownerWorkspace,
  };
}

/**
 * The provider-string projection of {@link ownerHeadlessContext} — the
 * pre-LIN-3241 D12 shape, kept for its existing callers and tests. Delegates so
 * the owner-row read stays single-sourced.
 */
export function ownerHeadlessProvider(sessions, urlKey, ownerAccountId, deps) {
  return ownerHeadlessContext(sessions, urlKey, ownerAccountId, deps).provider;
}

/**
 * Build the `resolveWorkspaceAccess` result for a Connection, using the SAME
 * provider call-scope projection the session lane uses (`getBindingCallScope`).
 * A transient LEGACY-shaped binding is used deliberately: the projection reads
 * `binding.credentials`, and this object is never persisted or hydrated.
 *
 * `bindingScope` is the BINDING's identity scope, supplied by the caller
 * (LIN-3241 (A)). For a GitHub connection this is the `owner/name` repo — NOT
 * `connection.unitId`, which is the App installation id and therefore the wrong
 * repo for every binding on the Connection. When the caller cannot name a
 * binding scope (legacy/Linear/Jira, or no owner session row) it falls back to
 * `connection.unitId`, which is byte-identical to the pre-LIN-3241 projection
 * for those providers.
 *
 * The `scope` output carries no `connectionId`, so the `scope ?? token`
 * substitution cannot leak one.
 *
 * LIN-3323: every result this constructor builds is a SUCCESSFUL resolution, so
 * it must carry `reason: 'ok'`. It previously omitted the field, and callers of
 * `resolveWorkspaceAccess` that gate on `reason === 'ok'` then read a valid
 * owner login as `refresh_error` until a repeat read hit the 30s token cache
 * and got a cached answer that did carry it.
 */
export function connectionResolveResult(connection, { bindingScope, source, fingerprintCredential }) {
  const credentials = connectionCredential(connection);
  const binding = { provider: connection.provider, scope: bindingScope ?? connection.unitId, credentials };
  const scope = getBindingCallScope(binding);
  const token = credentials.token;
  return {
    token,
    reason: 'ok',
    scope,
    provider: connection.provider,
    expiresAt: credentials.tokenExpiresAt,
    source,
    credentialFingerprint: fingerprintCredential(scope ?? token),
  };
}