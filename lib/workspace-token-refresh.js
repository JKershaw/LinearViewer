/**
 * Refresh-on-resolve for the agent/proxy token path (LIN-1373).
 *
 * Before this, `resolveWorkspaceAccess` (server.js) only ever READ sessions via
 * the pure selector (lib/workspace-token-resolver.js) — a headless proxy token
 * stopped resolving the moment its creating human's Linear access token lapsed,
 * because only human web activity (`ensureValidToken`, server.js) ever refreshed
 * it. This module is the caller-side refresh: it finds the owner's own expired
 * row via the pure sibling selector `selectExpiredOwnerRow`, refreshes it using
 * the `refreshToken` already sitting in that same session blob, and persists the
 * result back — reusing `refreshAccessToken` (lib/token-refresh.js) and
 * `updateWorkspaceTokens` (lib/workspace.js) unchanged, so their existing
 * rotation/invariant guarantees (LIN-561/562) are preserved rather than
 * re-implemented here.
 *
 * All IO is injected (refreshAccessToken, persistSession) so this is
 * unit-testable with fakes and integration-testable without booting server.js.
 */
import { selectExpiredOwnerRow } from './workspace-token-resolver.js';
import { updateWorkspaceTokens } from './workspace.js';

// Per-(ownerAccountId, urlKey) single-flight, mirroring lib/openrouter-catalog.js's
// inflight-promise coalescing precedent. Concurrent resolves for the same owner's
// same workspace share one Linear refresh round-trip and one persisted result
// instead of racing to rotate the same refresh token (which would strand the
// loser with a spent, already-rotated one). The entry is removed once the
// refresh settles — success or failure — so a later, independent lapse still
// triggers its own refresh.
const inflight = new Map(); // `${ownerAccountId}::${urlKey}` -> Promise

async function doRefresh({ sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession }) {
  const row = selectExpiredOwnerRow(sessions, urlKey, ownerAccountId);
  if (!row) return null;

  const { sid, refreshToken, session, workspaceIndex } = row;
  const tokenData = await refreshAccessToken(refreshToken);

  const workspace = session.workspaces[workspaceIndex];
  updateWorkspaceTokens(workspace, tokenData);
  await persistSession(sid, session);

  return { token: workspace.accessToken, expiresAt: workspace.tokenExpiresAt, provider: workspace.provider };
}

/**
 * Refresh the owner's expired Linear access token in place, using the
 * refreshToken already present in the same session blob the pure selector
 * reads. Returns `null` when the owner has no expired-but-refreshable row for
 * `urlKey` — there is nothing to refresh, so the caller should keep its
 * existing `session_expired` result. Throws (never persists) when a refresh
 * was attempted but failed — a `TokenRefreshError` from `refreshAccessToken`,
 * or a `persistSession` failure — so the caller falls through to the existing
 * `session_expired` 503 rather than surfacing a 500 or caching a stale token.
 *
 * @param {Object} deps
 * @param {Array} deps.sessions - raw session rows (sessionsCollection.find({}).toArray())
 * @param {string} deps.urlKey - workspace url key being resolved
 * @param {string} deps.ownerAccountId - the proxy token's owning account (never UNSCOPED)
 * @param {Function} deps.refreshAccessToken - (refreshToken) => Promise<{access_token, refresh_token, expires_in}>
 * @param {Function} deps.persistSession - (sid, session) => Promise<void>; must NOT roll the session's TTL (see server.js's persistSessionRow)
 * @returns {Promise<{token: string, expiresAt: number, provider: string}|null>}
 */
export async function refreshOwnerWorkspaceToken({ sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession }) {
  const key = `${ownerAccountId}::${urlKey}`;
  let promise = inflight.get(key);
  if (!promise) {
    promise = doRefresh({ sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession });
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
