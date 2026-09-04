/**
 * Agent-status API routes (LIN-679 Stage 1 / LIN-2533: extracted from
 * routes/proxy.js, group G).
 *
 * Handles /api/proxy/agent/status (and its deprecated /api/proxy/foreman/status
 * array-path alias, pre-LIN-533 name) — record + list agent status updates.
 * Both routes share one handler per verb (LIN-528 pattern).
 */
import { Router } from 'express';
import { badRequest, jsonError } from '../lib/errors.js';
import { MAX_NAME_LENGTH, DANGEROUS_CHARS_REGEX } from '../lib/issue-write-validation.js';

/**
 * @param {Object} deps
 * @param {Object} deps.agentStatusStore - Agent status storage instance
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware
 * @param {Function} deps.authenticateProxyToken - Proxy bearer-token auth middleware
 * @param {Function} deps.requireWriteScope - Middleware requiring a readWrite-scoped token
 * @param {Function} deps.logEvent - Proxy event/audit logger
 */
export function createAgentStatusRoutes({ agentStatusStore, proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent }) {
  const router = Router();

  /**
   * POST /api/proxy/agent/status  (canonical)
   * POST /api/proxy/foreman/status  (forgiving alias, deprecated — pre-LIN-533 name)
   * Record an agent status update. Shared handler across both forms (LIN-528 pattern).
   */
  router.post(['/api/proxy/agent/status', '/api/proxy/foreman/status'], proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const { taskIdentifier, action, status, summary, dispatchId } = req.body;

    if (!taskIdentifier || typeof taskIdentifier !== 'string') {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'taskIdentifier is required');
    }
    if (!action || typeof action !== 'string') {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'action is required');
    }
    if (!status || typeof status !== 'string') {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'status is required');
    }
    if (!summary || typeof summary !== 'string') {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'summary is required');
    }
    if (summary.length > 10000) {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'summary exceeds max length (10000)');
    }
    if (taskIdentifier.length > 200 || action.length > 200 || status.length > 200) {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'Field exceeds max length (200)');
    }

    // dispatchId is optional. When present it must be a non-empty string ≤200 chars
    // (same cap as other field inputs). Enables exact-match loop join in LIN-245;
    // absence is back-compatible and consumers fall back to timestamp-window matching.
    if (dispatchId !== undefined && dispatchId !== null) {
      if (typeof dispatchId !== 'string' || dispatchId.length === 0) {
        logEvent(req, '/api/proxy/agent/status', 400);
        return badRequest.json(res, 'dispatchId must be a non-empty string');
      }
      if (dispatchId.length > 200) {
        logEvent(req, '/api/proxy/agent/status', 400);
        return badRequest.json(res, 'Field exceeds max length (200)');
      }
      if (DANGEROUS_CHARS_REGEX.test(dispatchId)) {
        logEvent(req, '/api/proxy/agent/status', 400);
        return badRequest.json(res, 'Input contains invalid characters');
      }
    }

    if (DANGEROUS_CHARS_REGEX.test(taskIdentifier) || DANGEROUS_CHARS_REGEX.test(action) ||
        DANGEROUS_CHARS_REGEX.test(status) || DANGEROUS_CHARS_REGEX.test(summary)) {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'Input contains invalid characters');
    }

    try {
      await agentStatusStore.recordStatus({
        urlKey: req.proxyUrlKey,
        taskIdentifier,
        action,
        status,
        summary,
        // Attribute the write to the posting token so the UI can group
        // entries into sessions. Label is snapshotted so it survives revocation.
        tokenId: req.proxyTokenId,
        tokenLabel: req.proxyTokenLabel,
        ...(dispatchId ? { dispatchId } : {})
      });

      logEvent(req, '/api/proxy/agent/status', 201);
      res.status(201).json({ success: true });
    } catch (err) {
      logEvent(req, '/api/proxy/agent/status', 500);
      console.error('Agent status post error:', err.message);
      jsonError(res, 500, 'Failed to record status');
    }
  });

  /**
   * GET /api/proxy/agent/status  (canonical)
   * GET /api/proxy/foreman/status  (forgiving alias, deprecated — pre-LIN-533 name)
   * List recent agent status entries. Optional filters: tokenId (session) +
   * taskIdentifier (task thread). Shared handler across both forms (LIN-528 pattern).
   */
  router.get(['/api/proxy/agent/status', '/api/proxy/foreman/status'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const filters = {};
      if (req.query.tokenId) {
        const raw = String(req.query.tokenId);
        if (raw.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(raw)) {
          logEvent(req, '/api/proxy/agent/status', 400);
          return badRequest.json(res, 'Invalid tokenId');
        }
        filters.tokenId = raw;
      }
      if (req.query.taskIdentifier) {
        const raw = String(req.query.taskIdentifier);
        if (raw.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(raw)) {
          logEvent(req, '/api/proxy/agent/status', 400);
          return badRequest.json(res, 'Invalid taskIdentifier');
        }
        filters.taskIdentifier = raw;
      }

      const result = await agentStatusStore.listStatus(req.proxyUrlKey, { limit, offset, ...filters });

      logEvent(req, '/api/proxy/agent/status', 200);
      res.json(result);
    } catch (err) {
      logEvent(req, '/api/proxy/agent/status', 500);
      console.error('Agent status list error:', err.message);
      jsonError(res, 500, 'Failed to list status');
    }
  });

  return router;
}
