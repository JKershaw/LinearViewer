// workspace-token-resolver.js: pure selector extracted from server.js's
// resolveWorkspaceAccess (LIN-1366). The proxy previously resolved a workspace's
// Linear access token owner-blind — any session referencing the urlKey could win,
// so one connected user's proxy token could read/write under another user's Linear
// identity. This selector scopes token selection to the owning account
// (req.proxyCreatedBy, threaded in by server.js/routes/proxy.js) and fails closed
// when no token for that owner exists, mirroring this repo's LIN-1352/1353
// lib/openrouter-key-resolver.js precedent for extracting owner-scoped selection
// into a testable pure module.
//
// `sessions` is the raw array from sessionsCollection.find({}).toArray() — each row's
// `.session` is the persisted express-session blob (string or already-parsed object)
// carrying `accountId` and `workspaces[]` ({ urlKey, provider, accessToken,
// tokenExpiresAt }), the same shape resolveWorkspaceAccess has always scanned.
//
// UNSCOPED marks the legacy owner-blind call path (getWorkspaceAccessToken /
// routes/test.js): passing it reproduces byte-identical legacy selection — the
// latest-expiring token among ALL sessions referencing urlKey, no owner filter.
export const UNSCOPED = Symbol('workspace-token-resolver.UNSCOPED');

// Same buffer resolveWorkspaceAccess has always used before this extraction
// (server.js's TOKEN_REFRESH_BUFFER_MS) — duplicated here so this module stays a
// pure function of its three arguments, with no import back into server.js.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

function parseSessionData(row) {
  return typeof row.session === 'string' ? JSON.parse(row.session) : row.session;
}

// The provider (e.g. 'linear') is a property of the workspace, not of whichever
// account's token wins selection — resolved owner-blind from ANY session that
// referenced urlKey, even one belonging to a different account or carrying an
// expired token, so the proxy's pre-token capability gate on writes always sees it,
// including on a fail-closed result.
function seenProviderFor(sessions, urlKey) {
  for (const row of sessions) {
    const data = parseSessionData(row);
    const ws = data?.workspaces?.find(w => w.urlKey === urlKey);
    if (ws?.provider) return ws.provider;
  }
  return null;
}

// selectOwnerWorkspaceToken(sessions, urlKey, ownerAccountId): resolves the
// workspace access token to use for `urlKey`, scoped to `ownerAccountId` unless it
// is the UNSCOPED sentinel. Returns { token, reason, provider }:
//   ok               → token present (the owner's own, latest-expiring)
//   session_expired  → the owner (or, when UNSCOPED, any session) referenced this
//                       workspace but every such token is expired — re-auth
//   not_connected    → no matching session references this workspace at all, OR an
//                       explicit owner was null/empty (never resolves, never
//                       borrows another account's token)
export function selectOwnerWorkspaceToken(sessions, urlKey, ownerAccountId = UNSCOPED) {
  const scoped = ownerAccountId !== UNSCOPED;
  const seenProvider = seenProviderFor(sessions, urlKey);

  // An explicit null/empty owner (e.g. a legacy bootstrap token's createdBy: null)
  // can never match a real accountId. Fail closed here, before any scan for a
  // token, so it can never fall through to owner-blind selection.
  if (scoped && !ownerAccountId) {
    return { token: null, reason: 'not_connected', provider: seenProvider };
  }

  let bestToken = null;
  let bestExpiry = 0;
  let bestProvider = null;
  let sawMatch = false;

  for (const row of sessions) {
    const data = parseSessionData(row);
    if (scoped && data?.accountId !== ownerAccountId) continue;
    const ws = data?.workspaces?.find(w => w.urlKey === urlKey);
    if (!ws) continue;
    sawMatch = true;
    if (ws.accessToken && ws.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      if (ws.tokenExpiresAt > bestExpiry) {
        bestToken = ws.accessToken;
        bestExpiry = ws.tokenExpiresAt;
        bestProvider = ws.provider || null;
      }
    }
  }

  if (bestToken) {
    return { token: bestToken, expiresAt: bestExpiry, reason: 'ok', provider: bestProvider };
  }

  return { token: null, reason: sawMatch ? 'session_expired' : 'not_connected', provider: seenProvider };
}
