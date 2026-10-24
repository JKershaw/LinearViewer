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
import { requestFeatureFlags } from '../lib/run-controls.js';

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl
 * @param {Object} deps.collections - dispatchQueue, dispatchHistory, proxyEvents,
 *   agentStatus, reportHistory, customPrompts, closeOutEvents, kpiDailyRollup
 * @param {() => Date} [deps.now]
 */
export function createWorkspaceKpisRoutes({ workspaceFromUrl, collections, now = () => new Date() }) {
  const router = Router();

  router.get('/workspace/:urlKey/kpis', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    try {
      const stats = await collectWorkspaceKpis({ collections, urlKey: workspace.urlKey, now: now() });
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
