/**
 * Refresh-on-resolve for the agent/proxy token path (LIN-1373; provider-aware
 * routing added LIN-1499 Phase 1; Linear moved to the durable store LIN-1524).
 *
 * Before LIN-1373, `resolveWorkspaceAccess` (server.js) only ever READ sessions
 * via the pure selector (lib/workspace-token-resolver.js) — a headless proxy
 * token stopped resolving the moment its creating human's access token lapsed,
 * because only human web activity (`ensureValidToken`, server.js) ever refreshed
 * it. This module is the caller-side refresh.
 *
 * Branches by `workspace.provider` (or, for the Linear arm, the durable
 * record's own `provider`), mirroring the arm-for-arm shape at `server.js`'s
 * `ensureValidToken`:
 *
 * - GitHub-family (`github`, `github-projects`) stays exactly as it was:
 *   session/binding-resident, found via the pure sibling selector
 *   `selectExpiredOwnerRow` (untouched — its GitHub-family arm needs no
 *   durable secret, LIN-1523/1524 scope boundary), re-minted from the App JWT
 *   + `installationId` via `remintActiveCredential`, persisted back to the
 *   session row.
 * - Linear (LIN-1524) no longer has a session row to find: `updateWorkspaceTokens`/
 *   `linkProvider` stopped writing `refreshToken` to the session entirely, so
 *   `selectExpiredOwnerRow`'s Linear arm (which requires `ws.refreshToken` on
 *   the row) is now structurally unreachable for it — a byte-identical,
 *   dead-in-practice branch, not a bug (its own A1-A8 tests still exercise the
 *   pure logic against hand-built fixtures that set the field directly). The
 *   REAL Linear arm here is a point-read against the durable store —
 *   `store.get(ownerAccountId, urlKey)` — the durable sibling of that session
 *   scan: same "is there something refreshable for this owner+workspace"
 *   question, asked of the other storage. Reached whenever the row isn't a
 *   GitHub-family one — covering BOTH a `session_expired` Linear row (which
 *   this arm ignores in favor of the durable record, now the sole source of
 *   truth) and `not_connected` (no session row at all, e.g. after logout).
 *   When the owner DOES still have a session row (the `session_expired`
 *   case), the fresh accessToken/tokenExpiresAt are mirrored into it as a
 *   pure cache via the separate pure sibling `selectOwnerSessionRow` (no
 *   refreshability filter — unlike `selectExpiredOwnerRow`, it only answers
 *   "does a row exist to mirror into") — never the refreshToken, and never
 *   required for the refresh itself to succeed.
 *
 * The provider instance is supplied by an INJECTED `resolveProvider`
 * dependency (never imported directly here) so this module keeps its
 * all-IO-injected contract and never couples to the import-order-sensitive
 * provider registry (lib/providers/registry.js).
 *
 * All IO is injected (refreshAccessToken, persistSession, resolveProvider,
 * store) so this is unit-testable with fakes and integration-testable
 * without booting server.js.
 */
import { selectExpiredOwnerRow, selectOwnerSessionRow } from './workspace-token-resolver.js';
import { remintActiveCredential } from './workspace.js';
import { calculateExpiresAt } from './token-refresh.js';

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

  // GitHub-family: unchanged, session/binding-resident (LIN-1523/1524 scope
  // boundary — no durable secret for this family, so the durable arm below
  // never applies to it).
  if (row && (row.provider === 'github' || row.provider === 'github-projects')) {
    const { sid, session, workspaceIndex } = row;
    const workspace = session.workspaces[workspaceIndex];
    await remintActiveCredential(workspace, resolveProvider(workspace), { fetchImpl, now });
    await persistSession(sid, session);
    return { token: workspace.accessToken, expiresAt: workspace.tokenExpiresAt, provider: workspace.provider };
  }

  // Linear-durable arm (LIN-1524): the durable record is the ONLY place a
  // rotating Linear credential lives now. `ownerAccountId` is guaranteed
  // non-UNSCOPED by the caller (server.js's resolveWorkspaceAccess), but may
  // still be a falsy real value (e.g. a legacy bootstrap token's
  // `createdBy: null`, LIN-1376) or a legacy pre-LIN-1329 session's missing
  // `session.accountId` never even reaches here in the first place — either
  // way `store.get` fails closed (its own accountId/urlKey guard) rather than
  // throwing, so this returns null exactly like "nothing to refresh" below.
  const record = await store.get(ownerAccountId, urlKey);
  if (!record?.refreshToken) return null;

  const tokenData = await refreshAccessToken(record.refreshToken);
  const tokenExpiresAt = calculateExpiresAt(tokenData.expires_in);
  await store.put(ownerAccountId, urlKey, {
    provider: record.provider,
    scope: record.scope,
    token: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt
  });

  // Mirror accessToken/tokenExpiresAt (pure cache, NEVER refreshToken) into
  // the owner's own session row, if one exists — the same mirroring
  // `ensureValidToken` does on its own session-resident path, preserved here
  // even though this refresh was triggered off-session (e.g. a proxy token
  // resolving while the human's browser session sits idle). `sessions` was
  // already loaded by the caller for the (now largely dead-for-Linear)
  // `selectExpiredOwnerRow` scan above, so this reuses it — no extra read.
  // No row exists for a `not_connected` owner (e.g. post-logout): nothing to
  // mirror into, which is fine — the durable record alone is authoritative.
  const ownerRow = selectOwnerSessionRow(sessions, urlKey, ownerAccountId);
  if (ownerRow) {
    const ownerWorkspace = ownerRow.session.workspaces[ownerRow.workspaceIndex];
    ownerWorkspace.accessToken = tokenData.access_token;
    ownerWorkspace.tokenExpiresAt = tokenExpiresAt;
    await persistSession(ownerRow.sid, ownerRow.session);
  }

  return { token: tokenData.access_token, expiresAt: tokenExpiresAt, provider: record.provider };
}

/**
 * Refresh the owner's expired-or-disconnected credential — routed by provider
 * (see module docstring): GitHub-family from the session row, Linear from the
 * durable store. Returns `null` when there is nothing refreshable — no
 * GitHub-family session row AND no durable Linear record with a
 * `refreshToken` — so the caller should keep its existing failure result.
 * Throws (never persists) when a refresh was attempted but failed — a
 * `TokenRefreshError` from `refreshAccessToken`, a mint failure from
 * `resolveProvider(...).refreshCredential`, a `persistSession` failure, or a
 * `store.put` failure — so the caller falls through to the existing 503
 * rather than surfacing a 500 or caching a stale token.
 *
 * @param {Object} deps
 * @param {Array} deps.sessions - raw session rows (sessionsCollection.find({}).toArray()); GitHub-family arm only
 * @param {string} deps.urlKey - workspace url key being resolved
 * @param {string} deps.ownerAccountId - the proxy token's owning account (never UNSCOPED)
 * @param {Function} deps.refreshAccessToken - (refreshToken) => Promise<{access_token, refresh_token, expires_in}>; Linear arm only
 * @param {Function} deps.persistSession - (sid, session) => Promise<void>; must NOT roll the session's TTL (see server.js's persistSessionRow); GitHub-family arm only
 * @param {Function} deps.resolveProvider - (workspace) => Provider; resolves the provider instance for the GitHub-family minting arm (e.g. getProviderForWorkspace). Injected, never imported, so this module stays IO-free and decoupled from the import-order-sensitive provider registry.
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} deps.store - LIN-1524: the durable owner-credential store — Linear's sole rotating-credential home, read AND written here (point-read + point-write, keyed on `(ownerAccountId, urlKey)`).
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
