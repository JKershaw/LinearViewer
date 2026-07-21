import { getBindingsForWorkspace } from './workspace.js';

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

// A GitHub-family binding's `installationId` (the re-mint key) lives on the
// binding's own `credentials`, never mirrored onto the workspace's legacy
// scalar fields (lib/workspace.js's linkProvider only mirrors token/
// refreshToken/tokenExpiresAt). Finds the ACTIVE binding the same way
// remintActiveCredential does — by mirrored token, falling back to the first
// binding for the active provider — and reads its installationId.
function findActiveInstallationId(workspace) {
  const bindings = getBindingsForWorkspace(workspace);
  const active =
    bindings.find(b => b.provider === workspace.provider && b.credentials?.token === workspace.accessToken) ||
    bindings.find(b => b.provider === workspace.provider) ||
    bindings[0];
  return active?.credentials?.installationId;
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

// selectExpiredOwnerRow(sessions, urlKey, ownerAccountId): a pure sibling of
// selectOwnerWorkspaceToken, added for LIN-1373's refresh-on-resolve fix.
// selectOwnerWorkspaceToken itself is left byte-identical (its A1-A7 tests stay
// green) — this is a separate read over the same session rows, used by
// lib/workspace-token-refresh.js to find what to refresh, never by the
// resolver's own selection path.
//
// Locates the owner's own row for `urlKey` whose token is expired (or
// expiring within the same TOKEN_REFRESH_BUFFER_MS buffer the selector uses)
// but which is still refreshable. Among the owner's matching rows, picks the
// latest-expiring one (mirroring the live selector's own tie-break) so a
// long-abandoned session doesn't win over a more recently-active one. Returns
// null when there is nothing refreshable: no owner, no session for this
// workspace, only still-live tokens, or an expired token with no way to
// refresh it.
//
// Refreshability is provider-aware (LIN-1499 Phase 1): Linear rows refresh
// via `refreshToken` (a GitHub-family binding never has one by design — see
// lib/providers/github/index.js). GitHub-family rows (`github`,
// `github-projects`) instead re-mint from `installationId`, so THEY are
// refreshable by that field. `installationId` is binding-scoped, not part of
// the legacy scalar mirror (see linkProvider/getBindingsForWorkspace in
// lib/workspace.js), so it is read off the active binding's `credentials`,
// mirroring the same active-binding match `remintActiveCredential` uses. A
// row lacking the field its own provider needs must stay unselectable here —
// returning null, not later throwing — so "nothing to refresh" stays a null
// result for every provider, exactly as it already is for Linear.
//
// ownerAccountId must be a real account id — unlike selectOwnerWorkspaceToken,
// there is no UNSCOPED mode here: refresh-on-resolve only ever acts on behalf
// of a single known owner, never owner-blind.
export function selectExpiredOwnerRow(sessions, urlKey, ownerAccountId) {
  if (!ownerAccountId) return null;

  let best = null;
  let bestExpiry = -Infinity;

  for (const row of sessions) {
    const data = parseSessionData(row);
    if (data?.accountId !== ownerAccountId) continue;
    const workspaceIndex = data?.workspaces?.findIndex(w => w.urlKey === urlKey) ?? -1;
    if (workspaceIndex < 0) continue;

    const ws = data.workspaces[workspaceIndex];
    const isLive = ws.accessToken && ws.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS;
    if (isLive) continue;

    const isGitHubFamily = ws.provider === 'github' || ws.provider === 'github-projects';
    const isRefreshable = isGitHubFamily ? !!findActiveInstallationId(ws) : !!ws.refreshToken;
    if (!isRefreshable) continue;

    const expiry = ws.tokenExpiresAt || 0;
    if (expiry > bestExpiry) {
      bestExpiry = expiry;
      // refreshToken is carried for back-compat with the pre-LIN-1499 Linear-only
      // shape (existing callers/tests read row.refreshToken directly) — it is
      // simply undefined on a GitHub-family row, which never has one by design.
      best = { sid: row._id, refreshToken: ws.refreshToken, session: data, workspaceIndex, provider: ws.provider };
    }
  }

  return best;
}

// detectOwnerAccountMismatch(sessions, urlKey, ownerAccountId): a pure sibling
// of selectOwnerWorkspaceToken, added for LIN-1413. Fires when the owner's own
// token has no live row for this workspace AND some DIFFERENT account does.
// Returns a verdict only — never a token, never the other account's id — so
// this changes how a resolution failure is *described*, never who gets a
// credential (LIN-1366 fail-closed is untouched).
//
// Re-review finding (LIN-1413): this predicate is a SIGNAL, not a proof of
// account fork. It fires identically for two distinct situations the
// available session data cannot tell apart: (a) the owner account genuinely
// no longer holds the workspace (re-auth cannot fix it), and (b) the owner's
// own token merely lapsed (LIN-1373's ordinary case) while a different,
// legitimate account on the same workspace happens to be live (re-auth CAN
// fix it). Distinguishing them would require a same-human identity concept
// this ticket deliberately does not build (see routes/auth.js's org-vs-human
// scope contradiction, tracked separately) — accountWorkspaceStore's bindings
// are additive/never-revoked (lib/account-session.js's bindAccountToWorkspace
// call, with no unbind caller anywhere) so they cannot serve as that signal
// either. Callers of this function's verdict must not claim more certainty
// than that — see lib/errors.js's owner_mismatch detail.
//
// Returns false for a null/empty ownerAccountId (LIN-1376's case; must stay
// not_connected) and for UNSCOPED (owner-blind callers have no owner to
// mismatch against).
export function detectOwnerAccountMismatch(sessions, urlKey, ownerAccountId) {
  if (!ownerAccountId || ownerAccountId === UNSCOPED) return false;

  let ownerLive = false;
  let otherAccountLive = false;

  for (const row of sessions) {
    const data = parseSessionData(row);
    const ws = data?.workspaces?.find(w => w.urlKey === urlKey);
    if (!ws) continue;
    const isLive = ws.accessToken && ws.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS;
    if (!isLive) continue;
    if (data?.accountId === ownerAccountId) {
      ownerLive = true;
    } else {
      otherAccountLive = true;
    }
  }

  return !ownerLive && otherAccountLive;
}
