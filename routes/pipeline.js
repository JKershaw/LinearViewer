/**
 * Pipeline routes — page view and JSON polling endpoint.
 *
 * Two GET routes:
 *   - GET /workspace/:urlKey/pipeline        — HTML page (server-rendered shell)
 *   - GET /workspace/:urlKey/api/pipeline/state — JSON snapshot for client polling
 *
 * Both session-gated via `workspaceFromUrl`. No new auth paths introduced.
 *
 * See LIN-248 for the design plan and rationale.
 */

import { Router } from 'express';
import { renderPipelinePage } from '../lib/render-pipeline.js';
import { renderErrorPage } from '../lib/render.js';
import { buildPipelineSnapshot, getTaskForIssue } from '../lib/pipeline-state.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl        - middleware: session + req.workspace
 * @param {Function} deps.getWorkspaceAccessToken  - (urlKey) → token
 * @param {Object}   deps.dispatchQueueStore       - dispatch store (listItems/listHistory)
 * @param {Object}   deps.foremanStore             - foreman status store
 * @param {Function} deps.getOpenRouterSource      - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo            - () → deploy metadata
 * @param {Function} deps.handleUnauthorizedError  - shared 401 handler
 * @returns {Router}
 */
export function createPipelineRoutes({
  workspaceFromUrl,
  getWorkspaceAccessToken,
  dispatchQueueStore,
  foremanStore,
  getOpenRouterSource,
  getDeployInfo,
  handleUnauthorizedError
}) {
  const router = Router();

  /**
   * Helper: build the deps object for pipeline-state functions.
   */
  function stateDeps() {
    return {
      getWorkspaceAccessToken,
      dispatchStore: dispatchQueueStore,
      foremanStore
    };
  }

  // ─── HTML page ──────────────────────────────────────────────────────────────

  router.get('/workspace/:urlKey/pipeline', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const deployInfo = getDeployInfo();
    const openRouterSource = getOpenRouterSource(req);
    const featureFlags = getFeatureFlags(req.session);

    try {
      const snapshot = await buildPipelineSnapshot(workspace.urlKey, stateDeps());

      const html = renderPipelinePage(
        { snapshot, organizationName: workspace.name || 'Workspace' },
        {
          deployInfo,
          urlKey: workspace.urlKey,
          openRouterSource,
          workspaces: req.session.workspaces,
          featureFlags
        }
      );
      res.send(html);
    } catch (error) {
      console.error('Pipeline page error:', error);

      if (error.response?.status === 401) {
        return handleUnauthorizedError(workspace, req.session, null, openRouterSource, res);
      }

      const html = renderErrorPage('Something Went Wrong', 'Could not load the pipeline. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/pipeline`
      });
      res.status(500).send(html);
    }
  });

  // ─── JSON polling endpoint ──────────────────────────────────────────────────

  router.get('/workspace/:urlKey/api/pipeline/state', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;

    try {
      const snapshot = await buildPipelineSnapshot(workspace.urlKey, stateDeps());
      res.json(snapshot);
    } catch (error) {
      console.error('Pipeline state error:', error);

      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      res.status(500).json({ error: 'Could not build pipeline snapshot' });
    }
  });

  // ─── Single-task detail endpoint (for overlay refresh) ────────────────────

  router.get('/workspace/:urlKey/api/pipeline/task/:identifier', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { identifier } = req.params;

    try {
      const task = await getTaskForIssue(workspace.urlKey, identifier, stateDeps());
      res.json(task);
    } catch (error) {
      console.error('Pipeline task detail error:', error);

      if (error.status === 404) {
        return res.status(404).json({ error: `Issue not found: ${identifier}` });
      }
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      res.status(500).json({ error: 'Could not fetch task detail' });
    }
  });

  return router;
}
