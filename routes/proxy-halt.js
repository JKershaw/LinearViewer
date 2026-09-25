/**
 * Proxy operator halt routes (LIN-2994 Surface 3 / LIN-3025) — the
 * degraded-mode operator path (Decision 4): GET/POST/DELETE
 * /api/proxy/dispatch/halt. Mirrors the shape of routes/proxy-agent-status.js
 * (proxyLimiter + authenticateProxyToken for reads, + requireWriteScope for
 * writes, logEvent on every handled branch including a 200 GET).
 *
 * This stores an operator REQUEST only — the runner does not yet honor it
 * (pending LIN-2995). Never say "paused"/"stopped" as if enforced. No
 * Linear, no resolveProviderAccess, no session enumeration in this file, and
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

const HALT_ROUTE = '/api/proxy/dispatch/halt';

/**
 * @param {Object} deps
 * @param {Object} deps.workspaceHaltStore - Durable per-workspace operator halt store (lib/workspace-halt.js)
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware
 * @param {Function} deps.authenticateProxyToken - Proxy bearer-token auth middleware
 * @param {Function} deps.requireWriteScope - Middleware requiring a readWrite-scoped token
 * @param {Function} deps.logEvent - Proxy event/audit logger
 */
export function createProxyHaltRoutes({ workspaceHaltStore, proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent }) {
  const router = Router();

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
   * Body `{ mode: 'pause' | 'stop' }`; anything else is a 400. `setBy` is
   * attributed from the token creator (`null` for a legacy ownerless
   * token — the proxy-dispatch.js:354 precedent — rather than rejecting the
   * halt outright).
   */
  router.post(HALT_ROUTE, proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const { mode } = req.body || {};
    if (mode !== 'pause' && mode !== 'stop') {
      logEvent(req, HALT_ROUTE, 400);
      return badRequest.json(res, "mode must be 'pause' or 'stop'");
    }

    if (!workspaceHaltStore) {
      logEvent(req, HALT_ROUTE, 500);
      return jsonError(res, 500, 'Failed to set halt');
    }

    const setBy = req.proxyCreatedBy || null;
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
   * Same auth as POST. Resumes a halted workspace; harmless when nothing is
   * set (the store's own `deleteOne` semantics).
   */
  router.delete(HALT_ROUTE, proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
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
