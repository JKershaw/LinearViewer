/**
 * Proxy operator halt routes (LIN-2994 Surface 3 / LIN-3025) — the
 * degraded-mode operator path (Decision 4): GET/POST/DELETE
 * /api/proxy/dispatch/halt. Mirrors the shape of routes/proxy-agent-status.js
 * (proxyLimiter + authenticateProxyToken for reads, + requireWriteScope for
 * writes, logEvent on every handled branch including a 200 GET).
 *
 * The runner honours the stored halt (lib/runner-kit/runner.mjs `haltAction`:
 * pause leaves fresh items, stop sweeps), so setting or clearing one is a
 * runner-state mutation and is OWNER-ONLY (LIN-3409, LIN-3398): POST/DELETE are
 * gated through the one hoisted `workspaceOwnerCheck` on the token's own
 * workspace id and creator (`req.proxyWorkspaceId` / `req.proxyCreatedBy`).
 * A token that carries no workspace id (every grant-less token minted before
 * LIN-3409 stamped one, and every dispatched-session / refire-broker token) cannot
 * be checked and gets `409 PROXY_TOKEN_UNBOUND`. GET stays read-only and ungated.
 * No Linear, no resolveProviderAccess, no session enumeration in this file, and
 * no cache/seam code: LIN-3024 owns the shared last-known-halt cache on
 * WorkspaceHaltStore, so these handlers only call its existing
 * getWorkspaceHalt/setWorkspaceHalt/clearWorkspaceHalt methods.
 *
 * `workspaceHaltStore` is deliberately undefaulted here (unlike
 * createProxyRoutes's own `= null` default) so the DI census counts it as a
 * required dependency of this factory; a null store at runtime (the
 * composer's own default) is still handled below with a JSON 500, never a
 * thrown error.
 */
import { Router } from 'express';
import { badRequest, jsonError } from '../lib/errors.js';
import { HALT_MODES, HALT_MODE_ERROR } from '../lib/workspace-halt.js';
import { resolveRunnerOwnerRefusal, sendRunnerRefusal } from '../lib/runner-owner-gate.js';

const HALT_ROUTE = '/api/proxy/dispatch/halt';

// One message, true for every unbound population (pre-stamp Proxy-page tokens,
// dispatched-session tokens, refire-broker tokens).
export const PROXY_TOKEN_UNBOUND_MESSAGE =
  'This token is not bound to a workspace, so it cannot halt the runner. ' +
  'Mint a new token on the Proxy page, or use the Dispatch page.';

/**
 * @param {Object} deps
 * @param {Object} deps.workspaceHaltStore - Durable per-workspace operator halt store (lib/workspace-halt.js)
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware
 * @param {Function} deps.authenticateProxyToken - Proxy bearer-token auth middleware
 * @param {Function} deps.requireWriteScope - Middleware requiring a readWrite-scoped token
 * @param {Function} deps.logEvent - Proxy event/audit logger
 * @param {Function|null} deps.workspaceOwnerCheck - the ONE hoisted owner seam
 *   (server.js); deliberately undefaulted like `workspaceHaltStore`. Absent or
 *   null fails closed (500) on POST/DELETE.
 */
export function createProxyHaltRoutes({ workspaceHaltStore, workspaceOwnerCheck, proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent }) {
  const router = Router();

  /**
   * Owner gate for POST/DELETE. Resolves true when the request was REFUSED (the
   * response is already sent), false when the owner may proceed. Runs before any
   * store write.
   *
   * Never 503 on this route (LIN-3025): `logEvent(..., 503)` runs
   * `logCredentialRejection` + `markSuspect` (routes/proxy.js) and would log a
   * false `[credential-rejected]` for what is an owner-check failure, not a bad
   * credential. So every 503 refusal (GRANT_OWNERLESS, OWNER_CHECK_UNAVAILABLE)
   * is mapped to 500 for BOTH logEvent and the wire (envelope code/category/
   * retryable kept); 403/409 pass through. The shared responder stays free of
   * logEvent on purpose.
   */
  async function refuseUnlessOwner(req, res) {
    if (!req.proxyWorkspaceId) {
      logEvent(req, HALT_ROUTE, 409);
      jsonError(res, 409, PROXY_TOKEN_UNBOUND_MESSAGE, {
        code: 'PROXY_TOKEN_UNBOUND',
        category: 'config',
        retryable: false
      });
      return true;
    }
    const refusal = await resolveRunnerOwnerRefusal({
      ownerCheck: workspaceOwnerCheck,
      workspaceId: req.proxyWorkspaceId,
      accountId: req.proxyCreatedBy
    });
    if (!refusal) return false;
    const status = refusal.status === 503 ? 500 : refusal.status;
    logEvent(req, HALT_ROUTE, status);
    sendRunnerRefusal(res, { ...refusal, status });
    return true;
  }

  /**
   * GET /api/proxy/dispatch/halt
   * Read scope is enough, as with the agent-status GET. Returns
   * `{ halt: null }` when unset, else `{ halt: { mode, setAt, setBy } }`
   * (the store's `_id` is stripped).
   */
  router.get(HALT_ROUTE, proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (!workspaceHaltStore) {
      logEvent(req, HALT_ROUTE, 500);
      return jsonError(res, 500, 'Failed to read halt');
    }

    try {
      const doc = await workspaceHaltStore.getWorkspaceHalt(req.proxyUrlKey);
      logEvent(req, HALT_ROUTE, 200);
      if (!doc) {
        return res.json({ halt: null });
      }
      const { mode, setAt, setBy } = doc;
      return res.json({ halt: { mode, setAt, setBy } });
    } catch (err) {
      // Never 503 here: a 503 trips routes/proxy.js's logEvent-internal
      // logCredentialRejection/markSuspect and falsely emits a
      // [credential-rejected] log line for what is really a store failure.
      logEvent(req, HALT_ROUTE, 500);
      console.error('Workspace halt read error:', err.message);
      return jsonError(res, 500, 'Failed to read halt');
    }
  });

  /**
   * POST /api/proxy/dispatch/halt
   * Body `{ mode }` with `mode` one of `HALT_MODES`; anything else is a 400.
   * Owner-only (LIN-3409): the gate runs after mode validation and before any
   * write. `setBy` is attributed from the token creator, which the gate has
   * just proven is the workspace owner (an ownerless token is refused).
   */
  router.post(HALT_ROUTE, proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const { mode } = req.body || {};
    if (!HALT_MODES.includes(mode)) {
      logEvent(req, HALT_ROUTE, 400);
      return badRequest.json(res, HALT_MODE_ERROR);
    }

    if (await refuseUnlessOwner(req, res)) return;

    if (!workspaceHaltStore) {
      logEvent(req, HALT_ROUTE, 500);
      return jsonError(res, 500, 'Failed to set halt');
    }

    const setBy = req.proxyCreatedBy;
    const now = new Date();

    try {
      await workspaceHaltStore.setWorkspaceHalt(req.proxyUrlKey, { mode, setBy, now });
      logEvent(req, HALT_ROUTE, 200);
      return res.json({ success: true, halt: { mode, setAt: now, setBy } });
    } catch (err) {
      logEvent(req, HALT_ROUTE, 500);
      console.error('Workspace halt set error:', err.message);
      return jsonError(res, 500, 'Failed to set halt');
    }
  });

  /**
   * DELETE /api/proxy/dispatch/halt
   * Same auth and the same owner-only gate as POST. Clears the stored halt
   * (the runner then resumes). Harmless when nothing is set (the store's own
   * `deleteOne` semantics).
   */
  router.delete(HALT_ROUTE, proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (await refuseUnlessOwner(req, res)) return;

    if (!workspaceHaltStore) {
      logEvent(req, HALT_ROUTE, 500);
      return jsonError(res, 500, 'Failed to clear halt');
    }

    try {
      await workspaceHaltStore.clearWorkspaceHalt(req.proxyUrlKey);
      logEvent(req, HALT_ROUTE, 200);
      return res.json({ success: true });
    } catch (err) {
      logEvent(req, HALT_ROUTE, 500);
      console.error('Workspace halt clear error:', err.message);
      return jsonError(res, 500, 'Failed to clear halt');
    }
  });

  return router;
}
