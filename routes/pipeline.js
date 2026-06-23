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
import { armKeepalive } from '../lib/http-keepalive.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl        - middleware: session + req.workspace
 * @param {Function} deps.getWorkspaceAccessToken  - (urlKey) → token
 * @param {Object}   deps.dispatchQueueStore       - dispatch store (listItems/listHistory)
 * @param {Object}   deps.agentStatusStore             - agent status store
 * @param {Function} deps.getOpenRouterSource      - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo            - () → deploy metadata
 * @param {Function} deps.handleUnauthorizedError  - shared 401 handler
 * @returns {Router}
 */
export function createPipelineRoutes({
  workspaceFromUrl,
  getWorkspaceAccessToken,
  dispatchQueueStore,
  agentStatusStore,
  getOpenRouterSource,
  getDeployInfo,
  handleUnauthorizedError
}) {
  const router = Router();

  /**
   * Helper: build the deps object for pipeline-state functions.
   *
   * Resolve the workspace's provider so `/pipeline` works for any backend, not
   * just Linear. Linear/legacy workspaces resolve to the Linear provider, so the
   * injected `fetchProjects` is byte-equivalent to pipeline-state's default;
   * local (and future) workspaces fetch from their own provider instead of
   * hitting the Linear API with a non-Linear token (LIN-387).
   */
  function stateDeps(workspace) {
    const provider = getProviderForWorkspace(workspace);
    return {
      getWorkspaceAccessToken,
      dispatchStore: dispatchQueueStore,
      agentStatusStore,
      fetchProjects: (token) => provider.fetchProjects(token)
    };
  }

  // ─── HTML page ──────────────────────────────────────────────────────────────

  router.get('/workspace/:urlKey/pipeline', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const deployInfo = getDeployInfo();
    const openRouterSource = getOpenRouterSource(req);
    const featureFlags = getFeatureFlags(req.session);

    // Guard: pipeline feature must be enabled
    if (featureFlags.pipeline !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      const snapshot = await buildPipelineSnapshot(workspace.urlKey, stateDeps(workspace));

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

    // buildPipelineSnapshot reads the whole-workspace loop log; there is no
    // selective predicate to push down, so bound the request with a keepalive
    // heartbeat rather than capping the store read (LIN-615).
    const keepalive = armKeepalive(res);
    try {
      const snapshot = await buildPipelineSnapshot(workspace.urlKey, stateDeps(workspace));
      keepalive.stop();
      keepalive.send(200, snapshot);
    } catch (error) {
      console.error('Pipeline state error:', error);
      keepalive.stop();

      if (error.response?.status === 401) {
        return keepalive.send(401, { error: 'Unauthorized' });
      }

      keepalive.send(500, { error: 'Could not build pipeline snapshot' });
    }
  });

  // ─── Single-task detail endpoint (for overlay refresh) ────────────────────

  router.get('/workspace/:urlKey/api/pipeline/task/:identifier', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { identifier } = req.params;

    // Issue-scoped after LIN-615 (getTaskForIssue → getLoopsForIssue pushdown),
    // but still pairs an issue read with a fetchProjects call; keep the request
    // bounded with a keepalive heartbeat.
    const keepalive = armKeepalive(res);
    try {
      const task = await getTaskForIssue(workspace.urlKey, identifier, stateDeps(workspace));
      keepalive.stop();
      keepalive.send(200, task);
    } catch (error) {
      console.error('Pipeline task detail error:', error);
      keepalive.stop();

      // error.status: manually set by pipeline-state.js (e.g. 404)
      // error.response?.status: graphql-request error shape (e.g. 401)
      if (error.status === 404) {
        return keepalive.send(404, { error: 'Issue not found' });
      }
      if (error.response?.status === 401) {
        return keepalive.send(401, { error: 'Unauthorized' });
      }

      keepalive.send(500, { error: 'Could not fetch task detail' });
    }
  });

  return router;
}
