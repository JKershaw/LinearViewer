/**
 * PAT (Personal Access Token) auto-login middleware. When `LINEAR_ACCESS_TOKEN`
 * is set and the request has no session workspaces yet, auto-create one —
 * bypassing OAuth entirely for local/self-hosted dev.
 *
 * Extracted from server.js into its own factory (LIN-1329) so it can be unit
 * tested the same way every other sign-in path is: a `createX(deps)` factory
 * over a hand-rolled req/res/session, rather than an inline closure only a
 * running server could exercise.
 */
import { getProvider } from './providers/registry.js'
import { linkProvider, saveSession } from './workspace.js'
import { establishAccount } from './account-session.js'

/**
 * @param {Object} deps
 * @param {import('./account-store.js').AccountStore} deps.accountStore
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} deps.accountWorkspaceStore
 * @returns {(req, res, next) => Promise<void>} Express middleware.
 */
export function createEnsurePATSession({ accountStore, accountWorkspaceStore }) {
  return async function ensurePATSession(req, res, next) {
    const pat = process.env.LINEAR_ACCESS_TOKEN;
    if (!pat) return next();
    if (req.session.workspaces?.length > 0) return next();

    // Skip routes that don't need auth
    if (req.path.startsWith('/auth/') || req.path === '/logout' ||
        req.path.startsWith('/test/') || req.path === '/privacy' ||
        req.path === '/terms' || req.path === '/styleguide') {
      return next();
    }

    try {
      const provider = getProvider('linear');
      const [org, viewer] = await Promise.all([
        provider.fetchOrganization(pat),
        provider.fetchViewer(pat)
      ]);

      // PAT is the third identity-creation site (alongside OAuth login and local
      // create). It converges on the same linkProvider seam (LIN-562) so PAT
      // workspaces carry bindings[] for the downstream fan-out (LIN-544) instead
      // of being a divergent branch. Identity stays org-derived for back-compat
      // (session-ephemeral, nothing persisted to migrate); only the credential
      // attachment routes through linkProvider, which writes the legacy scalar
      // mirror (accessToken/credentials) so all existing PAT readers stay green.
      //
      // Durable-store posture (LIN-1524 close-out Finding #3, decided): a PAT
      // deliberately gets NO durable owner-credential record, and this factory
      // takes no `ownerCredentialStore` dependency at all — structurally, not
      // just behaviourally, there is nowhere here it could write one. A PAT
      // carries no `refreshToken` (it is a static, non-expiring credential —
      // see `tokenExpiresAt: Number.MAX_SAFE_INTEGER` below); the durable
      // store's entire purpose is persisting THE rotating credential
      // (owner-credential-store.js's own docstring), so there is nothing here
      // for it to hold. Consequence after LIN-1524's read-path cutover: PAT
      // workspaces are UNCHANGED for the common case (`ensureValidToken` skips
      // refresh entirely on `isPAT`, and a PAT's session row always carries a
      // live, non-expiring token, so `resolveWorkspaceAccess` resolves it
      // straight from the session — reason 'ok' — without ever reaching the
      // durable-read branch). The one edge this does NOT cover, unchanged from
      // today: a proxy token resolving a PAT workspace after that PAT's own
      // session row has been destroyed (e.g. explicit logout with no
      // immediate next request to auto-recreate it) gets `not_connected` with
      // no durable record to fall back to, same 503 it would already get
      // pre-cutover (refresh-on-resolve only ever read sessions too, and a
      // PAT has no refresh_token regardless). Not a regression; PAT-over-proxy
      // survives everything except a destroyed session row, before and after.
      const workspace = {
        id: org.id,
        name: org.name,
        urlKey: org.urlKey || org.name,
        addedAt: Date.now(),
        isPAT: true,
        tokenExpiresAt: Number.MAX_SAFE_INTEGER
      };
      linkProvider(workspace, 'linear', org.id, {
        token: pat,
        tokenExpiresAt: Number.MAX_SAFE_INTEGER, // PAT never expires; refresh middleware skips on isPAT
      });

      req.session.workspaces = [workspace];
      req.session.activeWorkspaceId = workspace.id;

      // LIN-1329 (Phase C): establish the durable account for this identity —
      // same seam every other sign-in path converges on. Identity scope is
      // Linear's viewer.id (the human), never the org.
      const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'linear', String(viewer.id), {}, workspace.id);
      if (!established.ok) {
        console.error('PAT account establish failed:', established);
      }

      await saveSession(req.session);
      console.log(`PAT session created for workspace: ${org.name} (${org.urlKey})`);
      next();
    } catch (error) {
      console.error('PAT auto-login failed:', error.message);
      next();
    }
  };
}
