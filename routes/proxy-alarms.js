/**
 * Proxy liveness-alarm read route (LIN-3258, M21 option A): GET
 * /api/proxy/alarms. Mirrors routes/proxy-halt.js's shape — `proxyLimiter` +
 * `authenticateProxyToken` for a read, `logEvent` on every handled branch
 * (including the 200). Read-only: no write verbs, and the alarm store is
 * consult-only here.
 *
 * `livenessAlarmStore` is deliberately undefaulted (unlike createProxyRoutes's
 * own `= null` default) so the DI census counts it as a required dependency of
 * this factory; a null store at runtime is still handled with a JSON 500,
 * never a thrown error.
 */
import { Router } from 'express';
import { jsonError } from '../lib/errors.js';

const ALARMS_ROUTE = '/api/proxy/alarms';
const STATE_VALUES = new Set(['open', 'cleared', 'all']);
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/**
 * @param {Object} deps
 * @param {Object} deps.livenessAlarmStore - Durable liveness-alarm store (lib/liveness-alarm-store.js)
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware
 * @param {Function} deps.authenticateProxyToken - Proxy bearer-token auth middleware
 * @param {Function} deps.logEvent - Proxy event/audit logger
 */
export function createProxyAlarmRoutes({ livenessAlarmStore, proxyLimiter, authenticateProxyToken, logEvent }) {
  const router = Router();

  /**
   * GET /api/proxy/alarms?state=open|cleared|all&limit=
   * Read scope is enough. Returns `{ alarms: [...], total }`, oldest-rule
   * irrelevant, newest-fired first. Each alarm is a plain advisory record:
   * `{ id, rule, shape, members, waiters, feeders, leafLineages, dispatchIds,
   * tickets, startedAt, firedAt, lastSeenAt, clearedAt, reopenCount, detail }`.
   */
  router.get(ALARMS_ROUTE, proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (!livenessAlarmStore) {
      logEvent(req, ALARMS_ROUTE, 500);
      return jsonError(res, 500, 'Failed to read alarms');
    }

    const state = typeof req.query?.state === 'string' ? req.query.state : 'open';
    if (!STATE_VALUES.has(state)) {
      logEvent(req, ALARMS_ROUTE, 400);
      return jsonError(res, 400, 'state must be one of: open, cleared, all');
    }
    const parsedLimit = Number.parseInt(req.query?.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

    try {
      const alarms = await livenessAlarmStore.list(req.proxyUrlKey, { state, limit });
      logEvent(req, ALARMS_ROUTE, 200);
      return res.json({ alarms: (alarms || []).map(toPublic), total: (alarms || []).length });
    } catch (err) {
      logEvent(req, ALARMS_ROUTE, 500);
      console.error('Liveness alarm read error:', err.message);
      return jsonError(res, 500, 'Failed to read alarms');
    }
  });

  return router;
}

function toPublic(doc) {
  return {
    id: doc._id,
    rule: doc.rule,
    shape: doc.shape || null,
    members: doc.members || [],
    waiters: doc.waiters || [],
    feeders: doc.feeders || [],
    leafLineages: doc.leafLineages || [],
    dispatchIds: doc.dispatchIds || [],
    tickets: doc.tickets || [],
    startedAt: iso(doc.startedAt),
    firedAt: iso(doc.firedAt),
    lastSeenAt: iso(doc.lastSeenAt),
    clearedAt: iso(doc.clearedAt),
    reopenCount: doc.reopenCount || 0,
    detail: doc.detail || {}
  };
}

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
