/**
 * User-facing (session-auth) proxy token admin routes (LIN-679 Stage 2 /
 * LIN-2534, group A: extracted from routes/proxy.js).
 *
 * Handles the workspace-prefixed token management + audit surface:
 * POST/GET/DELETE /workspace/:urlKey/api/proxy/tokens, GET
 * /workspace/:urlKey/api/proxy/events, and GET
 * /workspace/:urlKey/api/proxy/credential-health. These five are the ONLY
 * routes in the proxy surface on workspaceFromUrl session-cookie auth — every
 * other group is on the proxy-token bearer-auth surface instead. Do not
 * "harmonise" this chain onto that one.
 */
import { Router } from 'express';
import { badRequest, jsonError, notFound, serviceUnavailable } from '../lib/errors.js';
import { MAX_NAME_LENGTH } from '../lib/issue-write-validation.js';
import { UUID_REGEX } from '../lib/workspace.js';
import { getProvider } from '../lib/providers/registry.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { ownerlessCompatEnabled } from '../lib/ownerless-token-policy.js';
import { BOOTSTRAP_TOKEN_TTL_SECONDS } from '../lib/proxy-tokens.js';

// LIN-525 #5: the +proxy toggle auto-mints a 'prompt-proxy' readWrite token on
// every page-load session that dispatches. To stop these standing credentials
// from accumulating for the 90-day default TTL, give them a short TTL so they
// self-prune. 48h comfortably outlives the 24h dispatch-queue item lifetime
// plus the agent run that consumes the token, while bounding the exposure window.
const PROMPT_PROXY_LABEL = 'prompt-proxy';
const PROMPT_PROXY_TOKEN_TTL_SECONDS = 48 * 60 * 60;

/**
 * @param {Object} deps
 * @param {Object} deps.proxyTokenStore - Proxy token storage instance
 * @param {Object} deps.proxyEventStore - Proxy event/audit storage instance
 * @param {Function} deps.workspaceFromUrl - Session-cookie workspace resolution middleware
 * @param {Function} deps.proxyTokenCreationLimiter - Per-IP rate limiter middleware, POST /tokens only (process-global across every createProxyRoutes() instance — see routes/proxy.js's own declaration/comment; injected here rather than redeclared so that lifetime is preserved)
 */
export function createTokensAdminRoutes({ proxyTokenStore, proxyEventStore, workspaceFromUrl, proxyTokenCreationLimiter }) {
  const router = Router();

  /**
   * POST /workspace/:urlKey/api/proxy/tokens
   * Create a new proxy token.
   */
  router.post('/workspace/:urlKey/api/proxy/tokens', proxyTokenCreationLimiter, workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    // LIN-525 #2: token minting is gated on the proxy feature flag (defense in
    // depth — independent of the UI). The proxy page that mints tokens
    // is itself flag-gated, so a mint request on a flag-off session means a
    // stale global +proxy toggle is trying to inject where no button is shown.
    if (getFeatureFlags(req.session).proxy !== true) {
      return jsonError(res, 403, 'Proxy feature is not enabled for this workspace');
    }

    try {
      const { label, scope, singleUse, bootstrap } = req.body || {};

      if (label && label.length > MAX_NAME_LENGTH) {
        return badRequest.json(res, `label exceeds maximum length of ${MAX_NAME_LENGTH}`);
      }

      if (scope && !['read', 'readWrite'].includes(scope)) {
        return badRequest.json(res, 'scope must be "read" or "readWrite"');
      }

      // LIN-376: a bootstrap request mints a single-use, exchange-only token (the
      // credential a handoff embeds); the client exchanges it at POST /api/proxy/token
      // for a working token. Bootstrap is forced single-use in the store and carries
      // the outlives-the-queue TTL.
      const wantBootstrap = bootstrap === true || bootstrap === 'true';

      // LIN-1582 — refuse an ownerless BOOTSTRAP mint before attempting it, when
      // the compat lane is off. The store now refuses this structurally
      // (lib/proxy-tokens.js), so without this pre-check the throw would land in
      // the catch below and surface as a generic 500 "Failed to create token" —
      // misreporting a deliberate policy decision as a server fault. Shaped like
      // the broker lane's refusal (routes/dispatch.js): a 503 whose detail names
      // the remedy, because the caller's own session is what lacks an owner and
      // no retry can fix that. Scoped INSIDE the bootstrap case on purpose: the
      // non-bootstrap branch shares the createToken call below via a ternary
      // spread and must stay byte-identical, ownerless session or not.
      if (wantBootstrap && !req.session?.accountId && !ownerlessCompatEnabled()) {
        console.warn(
          `Proxy token mint refused: bootstrap requested by a session with no account owner ` +
          `(urlKey=${workspace.urlKey}) — DISPATCH_OWNERLESS_BROKER_COMPAT is off (LIN-1448/LIN-1582)`
        );
        return serviceUnavailable.json(
          res,
          'Session has no account owner (LIN-1448)',
          'A bootstrap minted for a session with no account owner cannot resolve a workspace ' +
          'credential, and the working token it is exchanged for inherits the miss. Sign in ' +
          'again, or use an account that has this workspace connected, before requesting a ' +
          'bootstrap token.'
        );
      }

      // LIN-525 #5: short-TTL the auto-minted prompt-proxy tokens so they
      // self-prune instead of standing for the 90-day default.
      const isPromptProxy = (label || '') === PROMPT_PROXY_LABEL;

      const result = await proxyTokenStore.createToken(workspace.urlKey, {
        label: label || 'default',
        scope: scope || 'read',
        createdBy: req.session?.accountId || null,
        ...(wantBootstrap
          ? { kind: 'bootstrap', ttl: BOOTSTRAP_TOKEN_TTL_SECONDS }
          : {
              singleUse: singleUse === true || singleUse === 'true',
              ...(isPromptProxy ? { ttl: PROMPT_PROXY_TOKEN_TTL_SECONDS } : {})
            })
      });

      // LIN-2370: the server→client provider channel the browser copy-prompt
      // blocks need. `public/proxy.js` (buildAgentPrompt) and `public/common.js`
      // (buildBlock, the +proxy append) both compose an agent-facing block that
      // asserted "currently backed by Linear" to every workspace, because no
      // provider identity is in scope in the browser. Both already mint through
      // THIS route first, so the mint response is the channel — no new endpoint,
      // no page-shell data attribute (lib/render.js et al. would each need one).
      //
      // IDENTITY, NOT ACCESS. `workspace.provider` is the declared field already
      // on the session row `workspaceFromUrl` resolved, and `getProvider` looks
      // it up WITHOUT the registry's legacy-Linear default — so this is the same
      // pre-fallback discriminator `declaredProviderDisplayName` gates on, for
      // zero IO. Reading it here rather than calling `resolveProviderAccess` is
      // deliberate and load-bearing (found by review): that helper resolves
      // ACCESS, and on a cache miss it can walk every session, spend the
      // refresh-on-resolve cooldown, and perform a live OAuth exchange with
      // retries — an unbounded stall on an interactive copy button that
      // previously touched no provider at all, plus credential-trail and
      // token-rotation side effects, all to obtain a name already sitting on
      // `req`. A try/catch would have bounded the failure but never the latency.
      //
      // Never `getProviderForWorkspace`: that one applies LEGACY_DEFAULT_PROVIDER,
      // so an undeclared workspace would read as "Linear" — the exact defect.
      // Same derivation as routes/collective.js and the feedback-triage dispatch
      // in routes/workspace-api.js. Null ⇒ the clients omit the clause entirely
      // rather than hedging or guessing.
      const providerDisplayName = getProvider(workspace.provider)?.ui?.displayName ?? null;

      res.status(201).json({
        success: true,
        tokenId: result.tokenId,
        token: result.token,
        label: result.label,
        scope: result.scope,
        kind: result.kind,
        singleUse: result.singleUse,
        providerDisplayName,
        message: 'Token created. Save this token now - it cannot be retrieved later.'
      });
    } catch (err) {
      console.error('Create proxy token error:', err.message);
      jsonError(res, 500, 'Failed to create token');
    }
  });

  /**
   * GET /workspace/:urlKey/api/proxy/tokens
   * List all proxy tokens for this workspace.
   */
  router.get('/workspace/:urlKey/api/proxy/tokens', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const tokens = await proxyTokenStore.listTokens(workspace.urlKey);
      res.json({ tokens });
    } catch (err) {
      console.error('List proxy tokens error:', err.message);
      jsonError(res, 500, 'Failed to list tokens');
    }
  });

  /**
   * DELETE /workspace/:urlKey/api/proxy/tokens/:tokenId
   * Revoke a proxy token.
   */
  router.delete('/workspace/:urlKey/api/proxy/tokens/:tokenId', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;
    const { tokenId } = req.params;

    if (!UUID_REGEX.test(tokenId)) {
      return badRequest.json(res, 'Invalid token ID format');
    }

    try {
      const revoked = await proxyTokenStore.revokeToken(workspace.urlKey, tokenId);
      if (!revoked) {
        return notFound.json(res, 'Token not found');
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Revoke proxy token error:', err.message);
      jsonError(res, 500, 'Failed to revoke token');
    }
  });

  /**
   * GET /workspace/:urlKey/api/proxy/events
   * List recent proxy events for this workspace.
   */
  router.get('/workspace/:urlKey/api/proxy/events', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 100) : 50;
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const result = await proxyEventStore.listEvents(workspace.urlKey, { limit, offset });
      res.json(result);
    } catch (err) {
      console.error('List proxy events error:', err.message);
      jsonError(res, 500, 'Failed to list events');
    }
  });

  /**
   * GET /workspace/:urlKey/api/proxy/credential-health
   * Per-token credential health over the recent window (LIN-1586).
   *
   * Session-authenticated + workspace-scoped, exactly like the events endpoint
   * above — same auth, same workspace resolution, same error envelope. It reads
   * the audit rows the Event Log already shows, folded into the one verdict the
   * rows cannot state on their own: a token that is still succeeding on
   * workspace-free calls while every workspace-scoped call it makes reports
   * `token_ownerless` is dead as a workspace credential.
   *
   * Returns verdicts and counts only — no account ids, no free text beyond the
   * label the token list already shows.
   */
  router.get('/workspace/:urlKey/api/proxy/credential-health', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const result = await proxyEventStore.listCredentialHealth(workspace.urlKey);
      res.json(result);
    } catch (err) {
      console.error('Proxy credential health error:', err.message);
      jsonError(res, 500, 'Failed to read credential health');
    }
  });

  return router;
}
