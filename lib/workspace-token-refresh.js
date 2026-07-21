/**
 * Refresh-on-resolve for the agent/proxy token path (LIN-1373; provider-aware
 * routing added LIN-1499 Phase 1).
 *
 * Before this, `resolveWorkspaceAccess` (server.js) only ever READ sessions via
 * the pure selector (lib/workspace-token-resolver.js) — a headless proxy token
 * stopped resolving the moment its creating human's access token lapsed,
 * because only human web activity (`ensureValidToken`, server.js) ever refreshed
 * it. This module is the caller-side refresh: it finds the owner's own expired
 * row via the pure sibling selector `selectExpiredOwnerRow`, refreshes it, and
 * persists the result back.
 *
 * Branches by `workspace.provider`, mirroring the arm-for-arm shape at
 * `server.js`'s `ensureValidToken`: Linear keeps its `refresh_token` exchange
 * (`refreshAccessToken` + `updateWorkspaceTokens`, unchanged, byte-identical).
 * GitHub-family workspaces (`github`, `github-projects`) carry no
 * refresh_token — their tokens are RE-MINTED from the App JWT +
 * `installationId` via the provider's own `refreshCredential` seam, reached
 * through `remintActiveCredential` (lib/workspace.js) so the binding AND the
 * legacy scalar mirror rotate in lockstep. The provider instance is supplied
 * by an INJECTED `resolveProvider` dependency (never imported directly here)
 * so this module keeps its all-IO-injected contract and never couples to the
 * import-order-sensitive provider registry (lib/providers/registry.js).
 *
 * All IO is injected (refreshAccessToken, persistSession, resolveProvider) so
 * this is unit-testable with fakes and integration-testable without booting
 * server.js.
 */
import { selectExpiredOwnerRow } from './workspace-token-resolver.js';
import { rotateOwnerCredential, remintActiveCredential } from './workspace.js';

// Per-(ownerAccountId, urlKey) single-flight, mirroring lib/openrouter-catalog.js's
// inflight-promise coalescing precedent. Concurrent resolves for the same owner's
// same workspace share one Linear refresh round-trip and one persisted result
// instead of racing to rotate the same refresh token (which would strand the
// loser with a spent, already-rotated one). The entry is removed once the
// refresh settles — success or failure — so a later, independent lapse still
// triggers its own refresh.
const inflight = new Map(); // `${ownerAccountId}::${urlKey}` -> Promise

async function doRefresh({ sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession, resolveProvider, store, fetchImpl, now }) {
  const row = selectExpiredOwnerRow(sessions, urlKey, ownerAccountId);
  if (!row) return null;

  const { sid, session, workspaceIndex, provider } = row;
  const workspace = session.workspaces[workspaceIndex];

  // Mirrors server.js's ensureValidToken branch: GitHub-family re-mints via
  // the provider seam, everything else keeps Linear's refresh_token exchange
  // byte-identical. updateWorkspaceTokens (reached via rotateOwnerCredential,
  // LIN-1523) is Linear-wire-shaped (access_token/refresh_token/expires_in) —
  // a GitHub patch must never reach it, so the minting arm goes through
  // remintActiveCredential -> linkProvider exclusively (no durable dual-write:
  // GitHub-family needs no durable secret, LIN-1523 scope boundary), which
  // mutates `workspace` (== session.workspaces[workspaceIndex]) in place so
  // the shared persistSession below captures it either way.
  if (provider === 'github' || provider === 'github-projects') {
    await remintActiveCredential(workspace, resolveProvider(workspace), { fetchImpl, now });
  } else {
    const tokenData = await refreshAccessToken(workspace.refreshToken);
    await rotateOwnerCredential({ accountId: ownerAccountId, workspace, tokenData, store });
  }

  await persistSession(sid, session);

  return { token: workspace.accessToken, expiresAt: workspace.tokenExpiresAt, provider: workspace.provider };
}

/**
 * Refresh the owner's expired access token in place — routed by provider (see
 * module docstring) — using whatever that provider's own refresh path needs
 * from the same session blob the pure selector reads. Returns `null` when the
 * owner has no expired-but-refreshable row for `urlKey` — there is nothing to
 * refresh, so the caller should keep its existing `session_expired` result.
 * Throws (never persists) when a refresh was attempted but failed — a
 * `TokenRefreshError` from `refreshAccessToken`, a mint failure from
 * `resolveProvider(...).refreshCredential`, or a `persistSession` failure —
 * so the caller falls through to the existing `session_expired` 503 rather
 * than surfacing a 500 or caching a stale token.
 *
 * @param {Object} deps
 * @param {Array} deps.sessions - raw session rows (sessionsCollection.find({}).toArray())
 * @param {string} deps.urlKey - workspace url key being resolved
 * @param {string} deps.ownerAccountId - the proxy token's owning account (never UNSCOPED)
 * @param {Function} deps.refreshAccessToken - (refreshToken) => Promise<{access_token, refresh_token, expires_in}>; Linear arm only
 * @param {Function} deps.persistSession - (sid, session) => Promise<void>; must NOT roll the session's TTL (see server.js's persistSessionRow)
 * @param {Function} deps.resolveProvider - (workspace) => Provider; resolves the provider instance for the GitHub-family minting arm (e.g. getProviderForWorkspace). Injected, never imported, so this module stays IO-free and decoupled from the import-order-sensitive provider registry.
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} deps.store - LIN-1523: durable owner-credential store, dual-written alongside the session on the Linear refresh arm via rotateOwnerCredential.
 * @param {Function} [deps.fetchImpl] - test seam forwarded to the provider's refreshCredential (deterministic network stub)
 * @param {number} [deps.now] - test seam forwarded to the provider's refreshCredential (deterministic clock, epoch ms)
 * @returns {Promise<{token: string, expiresAt: number, provider: string}|null>}
 */
export async function refreshOwnerWorkspaceToken({ sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession, resolveProvider, store, fetchImpl, now }) {
  const key = `${ownerAccountId}::${urlKey}`;
  let promise = inflight.get(key);
  if (!promise) {
    promise = doRefresh({ sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession, resolveProvider, store, fetchImpl, now });
    inflight.set(key, promise);
    // Two-branch .then (not .finally) so the cleanup itself never produces an
    // unhandled rejection when doRefresh throws — the caller's own await/catch
    // of `promise` (returned below) is what's meant to observe the failure.
    promise.then(
      () => { if (inflight.get(key) === promise) inflight.delete(key); },
      () => { if (inflight.get(key) === promise) inflight.delete(key); }
    );
  }
  return promise;
}

/** Test-only: clear in-flight single-flight state between specs. */
export function _resetInflightForTests() {
  inflight.clear();
}
