/**
 * Workspace KPIs route (LIN-3689): the in-Harbour KPIs page for ONE workspace.
 *
 *   GET /workspace/:urlKey/kpis
 *
 * Session auth via `workspaceFromUrl` (no session redirects to `/`, a workspace
 * the session lacks and a malformed key get the 404 page). The handler reads the
 * workspace ONLY from `req.workspace.urlKey` — never `req.params` or `req.query`
 * — so no URL can widen the scope. Unlike the escalation KPIs page it does not
 * read every workspace in the session. Login-gated and indexed, so uncached.
 */

import { Router } from 'express';
import { renderErrorPage } from '../lib/render-pages.js';
import { renderWorkspaceKpisPage } from '../lib/render-workspace-kpis.js';
import { collectWorkspaceKpis } from '../lib/workspace-kpi-stats.js';
import { createWorkspaceKpisCache } from '../lib/workspace-kpis-cache.js';
import { requestFeatureFlags } from '../lib/run-controls.js';

/**
 * The page's per-workspace stale-while-revalidate cache over `collectWorkspaceKpis` (LIN-4201,
 * lib/workspace-kpis-cache.js): the records-first cost read loads the window's request records, about +1.35 s at
 * steady-state volume, so the page serves the last read (at most 60 s old) and refreshes in the background, as /kpis
 * does. server.js builds it once and registers it as per-key state (lib/key-state-holders.js).
 *
 * @param {Object} deps  `collections`, `requestUsageLoader` (both required by the read) and `now`, as the route takes them
 */
export function workspaceKpisCacheFor({ collections, requestUsageLoader, now = () => new Date() }) {
  return createWorkspaceKpisCache({ collect: urlKey => collectWorkspaceKpis({ collections, urlKey, now: now(), requestUsageLoader }) });
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl
 * @param {Object} deps.collections - dispatchQueue, dispatchHistory, proxyEvents,
 *   agentStatus, reportHistory, customPrompts, closeOutEvents, kpiDailyRollup
 * @param {() => Date} [deps.now]
 * @param {Object} deps.requestUsageLoader - the request-usage loader (LIN-4201); the cost read requires its records
 * @param {Object} [deps.workspaceKpisCache] - the shared cache (`workspaceKpisCacheFor`); absent, the route builds its
 *   own over the same deps (unit tests)
 */
export function createWorkspaceKpisRoutes({ workspaceFromUrl, collections, now = () => new Date(), requestUsageLoader, workspaceKpisCache }) {
  const router = Router();
  const cache = workspaceKpisCache || workspaceKpisCacheFor({ collections, requestUsageLoader, now });

  router.get('/workspace/:urlKey/kpis', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    try {
      const stats = await cache.get(workspace.urlKey);
      res.send(renderWorkspaceKpisPage(workspace.name || workspace.urlKey, {
        urlKey: workspace.urlKey,
        workspaces: req.session.workspaces || [],
        featureFlags: await requestFeatureFlags(req),
        stats
      }));
    } catch (error) {
      console.error('Workspace KPIs page error:', error);
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Failed to compute workspace KPIs'));
    }
  });

  return router;
}
