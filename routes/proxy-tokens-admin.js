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
import { SCOPES, RUNNER_GRANTS } from '../lib/proxy-scopes.js';
import { ownerMintRefusal } from '../lib/owner-mint-refusals.js';
import { isRunnerOwnerRefusal, sendRunnerRefusal } from '../lib/runner-owner-gate.js';

// LIN-525 #5: the +proxy toggle auto-mints a 'prompt-proxy' readWrite token on
// every page-load session that dispatches. To stop these standing credentials
// from accumulating for the 90-day default TTL, give them a short TTL so they
// self-prune. 48h comfortably outlives the 24h dispatch-queue item lifetime
// plus the agent run that consumes the token, while bounding the exposure window.
export const PROMPT_PROXY_LABEL = 'prompt-proxy';
const PROMPT_PROXY_TOKEN_TTL_SECONDS = 48 * 60 * 60;

/**
 * The default ("prompt-proxy") copy mint, as the client sends it: the toggle
 * path's `getOrCreateToken` posts exactly `{ label: 'prompt-proxy',
 * scope: 'readWrite', bootstrap: true }` (public/common.js). Both halves are
 * required so the per-account allowance below is scoped to the actual
 * default-copy token and not to any other request that merely borrows the
 * label (the label is client-supplied). Exported so `routes/proxy.js` can key
 * its `defaultCopyTokenCreationLimiter` off the SAME definition the route uses,
 * with no string duplicated across the two files.
 */
export function isDefaultCopyMint(req) {
  const body = req?.body;
  return !!body
    && body.label === PROMPT_PROXY_LABEL
    && (body.bootstrap === true || body.bootstrap === 'true');
}

// LIN-3131 S2b.2 / LIN-3137 — the P5 refusal vocabulary for the owner-checked
// runner copy mint now lives in the shared lib/owner-mint-refusals.js, so this
// mint and the legacy dispatch-token mint (routes/dispatch.js) cannot drift.
// This route keeps its OWN outcome→code mapping: `mintGrantBootstrap` throws a
// tagged error (`code`/`status`/`retryable`) and the route maps it through the
// shared vocabulary, with a short human `error`. There is deliberately NO
// compatibility lane: every one fails closed. An unknown code is rethrown
// (→ the route's generic 500) rather than silently allowed.
const RUNNER_CREDENTIAL_SUBJECT = 'a runner credential';

// LIN-3136 S5 (LIN-2884 M5) — the closed, server-side copy-purpose table. The
// client sends only a row NAME (`purpose`, or the older `runner: true` alias
// for `runner`); the grants, lifetime profile and label come from here, behind
// the owner check in `mintGrantBootstrap`. `driver` is the owner's copy-prompt
// credential (Autopilot, Flight Companion, Passage Planner copies): exactly
// `['dispatch']`, never `take`, on the 48h `worker` profile — never
// RUNNER_GRANTS, which would over-grant `take` and shorten its lifetime.
// `label` is fixed server-side so the audit log tells a driver copy from the
// toggle path's `prompt-proxy`; the runner row passes none, as before.
// `providerIdentity` marks the rows whose response carries
// `providerDisplayName` (the driver block names the declared backend); the
// runner response stays as it was.
export const COPY_PURPOSES = Object.freeze({
  runner: Object.freeze({
    grants: Object.freeze([...RUNNER_GRANTS]),
    profile: 'runner',
    subject: RUNNER_CREDENTIAL_SUBJECT,
    label: null,
    providerIdentity: false,
    logName: 'Runner copy'
  }),
  driver: Object.freeze({
    grants: Object.freeze(['dispatch']),
    profile: 'worker',
    subject: 'a driver credential',
    label: 'prompt-driver',
    providerIdentity: true,
    logName: 'Driver copy'
  })
});

function invalidPurpose(res) {
  return jsonError(res, 400, 'Unknown copy purpose', {
    code: 'INVALID_PURPOSE', category: 'auth', retryable: false
  });
}

/**
 * @param {Object} deps
 * @param {Object} deps.proxyTokenStore - Proxy token storage instance
 * @param {Object} deps.proxyEventStore - Proxy event/audit storage instance
 * @param {Function} deps.workspaceFromUrl - Session-cookie workspace resolution middleware
 * @param {Function} deps.proxyTokenCreationLimiter - Per-IP rate limiter middleware, POST /tokens only (process-global across every createProxyRoutes() instance; injected here rather than redeclared so that lifetime is preserved)
 * @param {Function} deps.defaultCopyTokenCreationLimiter - Per-ACCOUNT rate limiter for the default-copy mint only, mounted as path-scoped middleware on the tokens path; keys on req.session.accountId (LIN-2944 P3, ruling lin2944-p3-r1-mint-limit)
 */
export function createTokensAdminRoutes({ proxyTokenStore, proxyEventStore, workspaceFromUrl, proxyTokenCreationLimiter, defaultCopyTokenCreationLimiter }) {
  const router = Router();

  /**
   * POST /workspace/:urlKey/api/proxy/tokens
   * Create a new proxy token.
   *
   * LIN-2944 P3 (ruling lin2944-p3-r1-mint-limit): with the proxy on by
   * default, every task-prompt copy/download mints the default-copy token, so
   * it carries its own per-account budget. The limiter is mounted as its own
   * path-scoped middleware just below rather than inline on the POST chain,
   * because the LIN-2534 source-text witnesses pin that chain's literal shape
   * (`proxyTokenCreationLimiter, workspaceFromUrl, async`). `skip()` keeps it
   * to the default-copy mint only; proxyTokenCreationLimiter skips exactly
   * those requests. Every other mint is still bounded per IP by the first
   * limiter.
   */
  router.use('/workspace/:urlKey/api/proxy/tokens', defaultCopyTokenCreationLimiter);

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
      const { label, scope, singleUse, bootstrap, runner, grants, purpose } = req.body || {};

      // F4 (LIN-3129/LIN-3059): the server resolves grants, never the client.
      // Any body carrying the field is refused outright, on every path — before
      // the runner branch and before the default path, so neither grows a
      // client-settable grant lane.
      if (grants !== undefined) {
        return jsonError(res, 400, 'Grants cannot be set by the client', {
          code: 'GRANTS_NOT_CLIENT_SETTABLE', category: 'auth', retryable: false
        });
      }

      // LIN-3136: resolve the copy purpose. `runner: true` stays an alias of
      // `purpose: 'runner'`; an unknown, non-string or conflicting purpose is
      // refused rather than falling through to the grant-less default path.
      // No purpose and no runner is the default path below, unchanged.
      const wantRunner = runner === true || runner === 'true';
      let purposeName = null;
      if (purpose !== undefined) {
        if (typeof purpose !== 'string' || !Object.prototype.hasOwnProperty.call(COPY_PURPOSES, purpose)) {
          return invalidPurpose(res);
        }
        purposeName = purpose;
      }
      if (wantRunner) {
        if (purposeName !== null && purposeName !== 'runner') return invalidPurpose(res);
        purposeName = 'runner';
      }

      // LIN-3131 S2b.2 / LIN-3136 S5 — the owner-checked copy mint (LIN-3059 P4).
      // The SERVER resolves the grant list and profile from the purpose row and
      // the owner from the session (J4), never the client. Branched BEFORE the
      // label/scope validation on purpose: client `scope` and `label` are
      // IGNORED on this path. No compatibility lane — every refusal fails closed
      // and maps through the shared owner-mint refusal vocabulary (P5).
      if (purposeName !== null) {
        const row = COPY_PURPOSES[purposeName];
        if (!req.session?.accountId) {
          console.warn(
            `${row.logName} refused: session has no account owner (urlKey=${workspace.urlKey}) — ` +
            `GRANT_OWNERLESS (${purposeName === 'runner' ? 'LIN-3131' : 'LIN-3136'})`
          );
          const refusal = ownerMintRefusal('GRANT_OWNERLESS', row.subject);
          return jsonError(res, refusal.status, refusal.error, {
            code: refusal.code, category: refusal.category, retryable: refusal.retryable
          });
        }

        let minted;
        try {
          minted = await proxyTokenStore.mintGrantBootstrap({
            urlKey: workspace.urlKey,
            workspaceId: workspace.id,
            ownerAccountId: req.session.accountId,
            grants: [...row.grants],
            profile: row.profile,
            ...(row.label ? { label: row.label } : {})
          });
        } catch (err) {
          const refusal = ownerMintRefusal(err?.code, row.subject);
          if (!refusal) throw err;
          return jsonError(res, refusal.status, refusal.error, {
            code: refusal.code, category: refusal.category, retryable: refusal.retryable
          });
        }

        if (!row.providerIdentity) {
          return res.status(201).json({
            success: true,
            tokenId: minted.tokenId,
            token: minted.token,
            label: minted.label,
            scope: minted.scope,
            kind: minted.kind,
            singleUse: minted.singleUse,
            grants: minted.grants,
            expiresAt: minted.expiresAt,
            lifetimeProfile: minted.lifetimeProfile,
            message: 'Runner bootstrap created. Save this token now - it cannot be retrieved later.'
          });
        }

        // The driver block (public/common.js buildBlock) names the declared
        // provider and states the grant, so this response carries both. Same
        // identity derivation as the default path below (see LIN-2370 there).
        return res.status(201).json({
          success: true,
          tokenId: minted.tokenId,
          token: minted.token,
          label: minted.label,
          scope: minted.scope,
          kind: minted.kind,
          singleUse: minted.singleUse,
          grants: minted.grants,
          expiresAt: minted.expiresAt,
          lifetimeProfile: minted.lifetimeProfile,
          providerDisplayName: getProvider(workspace.provider)?.ui?.displayName ?? null,
          message: 'Driver bootstrap created. Save this token now - it cannot be retrieved later.'
        });
      }

      if (label && label.length > MAX_NAME_LENGTH) {
        return badRequest.json(res, `label exceeds maximum length of ${MAX_NAME_LENGTH}`);
      }

      if (scope && !SCOPES.includes(scope)) {
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
        // LIN-3409: identity only (no authority) so proxy halt can owner-check
        // this token's creator. From workspaceFromUrl, never the request body.
        workspaceId: workspace.id,
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
      // LIN-3409: the store owner-checks the revoke of a grant-bearing lineage
      // (it owns the seam and the branch logic); a grant-less self-revoke stays
      // member-reachable. The refusal arrives as a tagged throw.
      const revoked = await proxyTokenStore.revokeToken(workspace.urlKey, tokenId, {
        workspaceId: workspace.id,
        accountId: req.session?.accountId
      });
      if (!revoked) {
        return notFound.json(res, 'Token not found');
      }
      res.json({ success: true });
    } catch (err) {
      if (isRunnerOwnerRefusal(err)) {
        return sendRunnerRefusal(res, {
          code: err.code,
          status: err.status,
          category: err.category,
          retryable: err.retryable,
          error: err.message
        });
      }
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
