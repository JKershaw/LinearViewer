/**
 * Ship Journey routes — the experimental animated journey map (LIN-1675 P3).
 *
 * Anchored at /workspace/:urlKey/ship-journey (reusing workspaceFromUrl + the
 * experimental feature-gate-redirect-to-settings pattern shared by
 * collective/task-chat/next-run/live-console). Pure read, no LLM call on page
 * load (matching the /ship contract, LIN-298/301): the route reads the
 * workspace's full retained report history (reportHistoryStore.listFull, P1 —
 * LIN-1683) plus current issue state (fetchWorkspaceIssues), derives the
 * waypoint trail via deriveJourney (lib/ship-journey.js, P2 — LIN-1684), and
 * renders. All playback/animation is client-side over the embedded data.
 *
 * Current-issue-state seam correction (plan-review, 2026-07-29): this uses
 * `fetchWorkspaceIssues` — the SAME seam createDashboardRoutes takes — and
 * deliberately NOT the /ship route's `fetchAndPrepareProjects`, which returns
 * project *trees* rather than the flat `identifier -> {stateType, completedAt}`
 * index deriveJourney needs.
 *
 *   GET /workspace/:urlKey/ship-journey — page shell (gated)
 */

import { Router } from 'express';
import { renderShipJourneyPage } from '../lib/render-ship-journey.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { deriveJourney } from '../lib/ship-journey.js';

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - middleware: session + req.workspace
 * @param {Object}   deps.reportHistoryStore - durable roadmap-report store (listFull)
 * @param {Function} deps.fetchWorkspaceIssues - (workspace) => Promise<Issue[]>,
 *   the current-issue-state seam (mirrors createDashboardRoutes' wiring)
 * @param {Function} deps.getOpenRouterSource - (req) => 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo - () => deploy metadata
 * @returns {Router}
 */
export function createShipJourneyRoutes({ workspaceFromUrl, reportHistoryStore, fetchWorkspaceIssues, getOpenRouterSource, getDeployInfo }) {
  const router = Router();

  router.get('/workspace/:urlKey/ship-journey', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors collective/live-console).
    if (featureFlags.shipJourney !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      const [reports, issues] = await Promise.all([
        reportHistoryStore ? reportHistoryStore.listFull(workspace.urlKey) : Promise.resolve([]),
        fetchWorkspaceIssues(workspace),
      ]);
      const journey = deriveJourney({ reports, issues });

      res.send(renderShipJourneyPage(journey, {
        deployInfo: getDeployInfo(),
        urlKey: workspace.urlKey,
        openRouterSource: getOpenRouterSource(req),
        workspaces: req.session.workspaces,
        featureFlags,
      }));
    } catch (error) {
      console.error('Ship journey page error:', error);
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not load the Ship Journey. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/ship-journey`,
      }));
    }
  });

  return router;
}
