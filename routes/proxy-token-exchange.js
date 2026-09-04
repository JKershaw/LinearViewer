/**
 * Group C token-exchange route (LIN-679 Stage 2 / LIN-2535: extracted from
 * routes/proxy.js).
 *
 * POST /api/proxy/token — the bootstrap→working-token mint (LIN-376). This is
 * the ONE unauthenticated proxy-token-surface route: it mints the credential
 * `authenticateProxyToken` would otherwise require, so it cannot require one.
 * Do not add `authenticateProxyToken` here.
 */
import { Router } from 'express';
import { jsonError } from '../lib/errors.js';
import { WORKING_TOKEN_TTL_SECONDS } from '../lib/proxy-tokens.js';

/**
 * @param {Object} deps
 * @param {Object} deps.proxyTokenStore - Proxy token storage instance
 * @param {Object} deps.proxyEventStore - Proxy event/audit storage instance
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware (module-scope in routes/proxy.js, shared as-is; injected here rather than redeclared so that lifetime is preserved)
 * @param {Object} deps.PROXY_TOKEN_REJECTED_EXTRA - Structured-error-envelope extra fields for a proxy-token rejection (closure-local in createProxyRoutes, built from STAGE_PROXY_TOKEN; injected here rather than duplicating the literal)
 */
export function createTokenExchangeRoutes({ proxyTokenStore, proxyEventStore, proxyLimiter, PROXY_TOKEN_REJECTED_EXTRA }) {
  const router = Router();

  /**
   * POST /api/proxy/token  (LIN-376)
   * Exchange a single-use bootstrap token for a multi-use working token.
   *
   * This is the ONE operation a bootstrap token authenticates — `authenticateProxyToken`
   * (via validateToken) rejects a bootstrap on every data endpoint, so a handoff can
   * embed a bootstrap safely and the agent's first real call is this exchange. The
   * working token is returned only in this response body; it never enters the durable
   * prompt/queue/log. Auth is inline (not authenticateProxyToken, which would reject a
   * bootstrap): read the Bearer token and hand it straight to the store's atomic
   * exchange. Rate-limited like every consumer route; the successful exchange is
   * audit-logged against the resolved workspace.
   */
  router.post('/api/proxy/token', proxyLimiter, async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonError(res, 401, 'Missing or invalid Authorization header', PROXY_TOKEN_REJECTED_EXTRA);
    }
    const bootstrap = authHeader.slice(7);
    if (!bootstrap) {
      return jsonError(res, 401, 'Empty token', PROXY_TOKEN_REJECTED_EXTRA);
    }

    try {
      const working = await proxyTokenStore.exchangeBootstrapToken(bootstrap, {
        ttl: WORKING_TOKEN_TTL_SECONDS
      });
      if (!working) {
        // No workspace to attribute a failed exchange to, so it is not audit-logged.
        // LIN-1985: same non-workspace-fault class as authenticateProxyToken's
        // rejections above — the presented (bootstrap) token itself is bad.
        return jsonError(res, 401, 'Invalid, expired, or already-exchanged bootstrap token', PROXY_TOKEN_REJECTED_EXTRA);
      }

      proxyEventStore.recordEvent({
        urlKey: working.urlKey,
        tokenId: working.tokenId,
        tokenLabel: working.label,
        method: 'POST',
        endpoint: '/api/proxy/token',
        status: 200
      }).catch(err => console.error('Failed to log proxy event:', err));

      res.json({
        token: working.token,
        scope: working.scope,
        expiresAt: working.expiresAt,
        notes: 'The bootstrap token you sent has been consumed by this exchange. Use the token above (the "token" field of this response) for all subsequent requests — the bootstrap is now spent and will never authenticate again.'
      });
    } catch (err) {
      console.error('Proxy token exchange error:', err.message);
      jsonError(res, 500, 'Failed to exchange token');
    }
  });

  return router;
}
