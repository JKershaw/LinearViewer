/**
 * Live Console routes — the experimental ambient "watch the swarm" view
 * (LIN-1436).
 *
 * Anchored at /workspace/:urlKey/live-console (reusing workspaceFromUrl + the
 * experimental feature-gate-redirect-to-settings pattern shared by
 * collective/task-chat/next-run). The page is a provider-free shell; the client
 * polls a generation-free events endpoint that merges the agent-status feed
 * across every connected workspace and shapes it via lib/live-console.js.
 *
 *   GET /workspace/:urlKey/live-console            — page shell (gated)
 *   GET /workspace/:urlKey/api/live-console/events — merged, normalized feed (JSON)
 *
 * Cost contract (mirrors Observation): the poll spends NO LLM call — it is pure
 * Mongo reads + a deterministic transform.
 */

import { Router } from 'express';
import { renderLiveConsolePage } from '../lib/render-live-console.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { buildConsoleFeed } from '../lib/live-console.js';

// Bound the read window so peak memory tracks recent activity, not the full
// 30-day agent-status retention (mirrors the observation feed's windowing).
const FEED_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - middleware: session + req.workspace
 * @param {Object}   deps.agentStatusStore - agent status store (listStatus)
 * @param {Function} deps.getOpenRouterSource - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo - () → deploy metadata
 * @returns {Router}
 */
export function createLiveConsoleRoutes({ workspaceFromUrl, agentStatusStore, getOpenRouterSource, getDeployInfo }) {
  const router = Router();

  // ─── HTML page ────────────────────────────────────────────────────────────
  router.get('/workspace/:urlKey/live-console', workspaceFromUrl, (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors collective/next-run).
    if (featureFlags.liveConsole !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      const html = renderLiveConsolePage({
        deployInfo: getDeployInfo(),
        urlKey: workspace.urlKey,
        openRouterSource: getOpenRouterSource(req),
        workspaces: req.session.workspaces,
        featureFlags,
      });
      res.send(html);
    } catch (error) {
      console.error('Live console page error:', error);
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not load the Live Console. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/live-console`,
      }));
    }
  });

  // ─── Events endpoint (generation-free poll source) ──────────────────────────
  router.get('/workspace/:urlKey/api/live-console/events', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);
    if (featureFlags.liveConsole !== true) {
      return res.status(403).json({ error: 'Live console feature is not enabled' });
    }

    const workspaces = (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }));
    // Anchor workspace is always in scope even if the session list is thin (e.g.
    // a PAT-mode single-workspace session).
    if (!workspaces.some(w => w.urlKey === workspace.urlKey)) {
      workspaces.push({ urlKey: workspace.urlKey, name: workspace.name || workspace.urlKey });
    }

    const since = new Date(Date.now() - FEED_WINDOW_MS);

    // Per-workspace reads degrade independently: one bad store never blanks the
    // whole feed (mirrors mergeLoops).
    const settled = await Promise.allSettled(
      workspaces.map(async (ws) => {
        const { items } = await agentStatusStore.listStatus(ws.urlKey, { since });
        return (items || []).map(item => ({
          ...item,
          workspaceUrlKey: ws.urlKey,
          workspaceName: ws.name || ws.urlKey,
        }));
      })
    );

    const merged = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') merged.push(...r.value);
      else console.error('Live console: status read failed for a workspace:', r.reason?.message);
    }

    const feed = buildConsoleFeed(merged, { now: Date.now() });
    res.json(feed);
  });

  return router;
}
