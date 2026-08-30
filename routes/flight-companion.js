/**
 * Flight Companion route — the experimental prototype for LIN-751's "realtime
 * chat interface for work in flight" (LIN-922).
 *
 * Anchored at /workspace/:urlKey/flight-companion, reusing workspaceFromUrl + the
 * collective/task-chat/next-run feature-gate-redirect-to-settings pattern. The
 * page is a provider-free stub that surfaces the exact kickoff prompt
 * (buildFlightCompanionKickoff) for copy/paste into a real Claude Code session —
 * the prototype's whole mechanism (a session standing in for the model, its curls
 * as tools). No new transport is invented; the prompt reuses the proven proxy
 * kickoff shape.
 *
 *   GET /workspace/:urlKey/flight-companion   — page shell (gated)
 *
 * There is intentionally no launch/dispatch endpoint in this V1: the prototype is
 * validated by pasting the prompt into a session by hand and watching it, which
 * also keeps the user-approval gate honest (nothing dispatches from this page). A
 * launch-via-dispatch button is a named, deferred follow-up.
 */

import { Router } from 'express';
import { renderFlightCompanionPage } from '../lib/render-flight-companion.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { buildFlightCompanionKickoff } from '../lib/prompts/flight-companion-kickoff.js';
import { PASS_INSTANCE_PREFIX } from '../lib/observer-pass.js';

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl    - middleware: session + req.workspace
 * @param {Function} deps.getOpenRouterSource - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo       - () → deploy metadata
 * @param {import('../lib/observer-state-store.js').ObserverStateStore} [deps.observerStateStore] -
 *   LIN-2395: read-only source for the latest observer-pass report panel.
 *   Optional so this route keeps working (empty-state panel) if omitted.
 * @returns {Router}
 */
export function createFlightCompanionRoutes({ workspaceFromUrl, getOpenRouterSource, getDeployInfo, observerStateStore }) {
  const router = Router();

  router.get('/workspace/:urlKey/flight-companion', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors collective/task-chat/next-run).
    if (featureFlags.flightCompanion !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const prompt = buildFlightCompanionKickoff({ baseUrl });
      // Read-only: readCurrent ONLY. This route must never be able to write
      // observer state — there is no ensureSeeded/advance call reachable
      // from request/render handling (LIN-2395).
      const observerReportDoc = observerStateStore
        ? await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${workspace.urlKey}`)
        : null;
      const html = renderFlightCompanionPage(
        { prompt, observerReportDoc },
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
      console.error('Flight Companion page error:', error);
      const html = renderErrorPage('Something Went Wrong', 'Could not load the Flight Companion page. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/flight-companion`,
      });
      res.status(500).send(html);
    }
  });

  return router;
}
