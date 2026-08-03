/**
 * Passage Planner route (LIN-1849) — one-click kickoff prompt, Flight
 * Companion parity (LIN-922 + LIN-1764).
 *
 * Anchored at /workspace/:urlKey/passage-planner, reusing workspaceFromUrl +
 * the collective/task-chat/next-run/flight-companion feature-gate-redirect
 * pattern. The page serves the validated Passage Planner kickoff prompt
 * (buildPassagePlannerKickoff — `docs/passage-planner-prompt.md` at HEAD,
 * preamble stripped) with a fresh single-use proxy bootstrap token appended
 * on copy, so running a planning session no longer means copying the doc
 * from GitHub AND separately minting a token on the proxy page.
 *
 * Unlike Flight Companion's kickoff, no `baseUrl` templating is needed here —
 * the planner doc is static prose with purely relative endpoint references.
 *
 *   GET /workspace/:urlKey/passage-planner   — page shell (gated)
 */

import { Router } from 'express';
import { renderPassagePlannerPage } from '../lib/render-passage-planner.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { buildPassagePlannerKickoff } from '../lib/prompts/passage-planner-kickoff.js';

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl    - middleware: session + req.workspace
 * @param {Function} deps.getOpenRouterSource - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo       - () → deploy metadata
 * @returns {Router}
 */
export function createPassagePlannerRoutes({ workspaceFromUrl, getOpenRouterSource, getDeployInfo }) {
  const router = Router();

  router.get('/workspace/:urlKey/passage-planner', workspaceFromUrl, (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors collective/task-chat/next-run/flight-companion).
    if (featureFlags.passagePlanner !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      const prompt = buildPassagePlannerKickoff();
      const html = renderPassagePlannerPage(
        { prompt },
        {
          deployInfo: getDeployInfo(),
          urlKey: workspace.urlKey,
          openRouterSource: getOpenRouterSource(req),
          workspaces: req.session.workspaces,
          featureFlags,
        }
      );
      res.send(html);
    } catch (error) {
      console.error('Passage Planner page error:', error);
      const html = renderErrorPage('Something Went Wrong', 'Could not load the Passage Planner page. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/passage-planner`,
      });
      res.status(500).send(html);
    }
  });

  return router;
}
