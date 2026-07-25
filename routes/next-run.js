/**
 * Suggested Next Run routes — the experimental "suggest the next autopilot run"
 * feature (LIN-603).
 *
 * Anchored at /workspace/:urlKey/next-run (reusing workspaceFromUrl + the
 * collective/task-chat feature-gate-redirect-to-settings pattern). The page is a
 * provider-free shell; clicking Generate POSTs to the suggest endpoint, which
 * fetches the workspace's projects/issues, builds the deterministic roadmap model,
 * and asks an LLM for grounded goal options (each with reasoning + a t-shirt
 * size), always plus a "continue until stopped" option (empty goal).
 *
 *   GET  /workspace/:urlKey/next-run               — page shell (gated)
 *   POST /workspace/:urlKey/api/next-run/suggest   — generate goal options (JSON)
 *
 * Accepting an option happens client-side: it hands the chosen goal paragraph to
 * the existing dispatch launch path (the dispatch page goal field) — no new run
 * mechanism here.
 */

import { Router } from 'express';
import { renderNextRunPage } from '../lib/render-next-run.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { generateGoalSuggestions, CONTINUE_UNTIL_STOPPED_OPTION, formatNextRunContext, buildNextRunSummary, ensureSizeCoverage, attachReferencedTaskTitles, resolveDirections } from '../lib/next-run.js';
import { buildRoadmapModel } from '../lib/roadmap.js';
import { isRecommendationEnabled, getPaidEnvKey, hasPaidEnvKey } from '../lib/openrouter.js';
import { resolveWorkspaceModel, resolveAiOperationModel } from '../lib/workspace-preferences.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
import { getWorkspaceCallScope } from '../lib/workspace.js';
import { testMockData } from '../tests/fixtures/mock-data.js';

/**
 * Whether the AI layer should be mocked for this request — mirrors `shouldMockAi`
 * in routes/workspace-api.js / task-chat.js so e2e specs (and local-provider
 * sessions) get deterministic options without an OpenRouter key.
 */
function shouldMockAi(workspace) {
  return process.env.NODE_ENV === 'test' &&
    (workspace?.accessToken === 'test-token' || workspace?.provider === 'local');
}

/**
 * Deterministic, grounded mock response for test mode — a headline-titled
 * direction per the first in-progress / queued mock issue (each carrying
 * machine-readable referencedTaskIds), the per-size S/M/L guarantee filled the
 * same way the live path fills it, a global `analysis` preamble, then the
 * always-present continue-until-stopped option, plus the representative grounding
 * `context`/`summary`. Mirrors the SHAPE of the real generator
 * ({ analysis, directions, options, summary, context }) without calling an LLM, so
 * live and test paths don't diverge (LIN-633, LIN-638, LIN-642, LIN-1566).
 *
 * Shape parity is a correctness requirement here, not tidiness: this mock is the
 * ONLY thing the e2e suite exercises, so a mock that omitted `directions` would let
 * every grouped-path test quietly pass against the flat fallback.
 */
function buildMockResponse() {
  const issues = testMockData.issues || [];
  const projects = testMockData.projects || [];
  const inProgress = issues.find(i => i.state?.type === 'started');
  const queued = issues.find(i => i.state?.type === 'unstarted' || i.state?.type === 'backlog');

  const roadmapModel = buildRoadmapModel(projects, issues);

  // The two named directions the mock's hand-written options are tagged with
  // (LIN-1566). Declared here exactly as the LLM would declare them, so the mock
  // drives the same resolver over the same inputs the live path uses.
  const declaredDirections = [
    { name: 'finish started work', summary: 'Close out what is already in flight before pulling anything new off the stack.' },
    { name: 'start the next queued item', summary: 'Open up the next ranked item on the execution queue.' },
  ];

  const concrete = [];
  if (inProgress) {
    concrete.push({
      title: `Finish ${inProgress.identifier}: ${inProgress.title}`,
      goal: `Drive ${inProgress.identifier} (${inProgress.title}) to completion: finish the work in progress, verify it, and close it out before pulling anything new off the stack.`,
      reasoning: `${inProgress.identifier} is already in progress — finishing started work first keeps WIP low.`,
      size: 'M',
      referencedTaskIds: [inProgress.identifier],
      direction: declaredDirections[0].name
    });
  }
  if (queued) {
    concrete.push({
      title: `Start ${queued.identifier}: ${queued.title}`,
      goal: `Start ${queued.identifier} (${queued.title}): research the codebase, plan the change, and make progress toward a reviewable state.`,
      reasoning: `${queued.identifier} is the next ranked item on the execution queue.`,
      size: 'S',
      referencedTaskIds: [queued.identifier],
      direction: declaredDirections[1].name
    });
  }
  // Guarantee S/M/L exactly as the live generator does, so the mock honours the
  // same contract (the fixtures cover S+M, so this fills the missing L). The fill
  // is deliberately NOT hand-tagged with a direction: it carries none in the live
  // path either, so letting it fall into the catch-all gives e2e real coverage of
  // the resolver's total-partition invariant.
  const covered = ensureSizeCoverage(concrete, roadmapModel);
  // Resolve referenced task ids → titles (LIN-923), mirroring the live generator so
  // the mock exercises the same enriched shape the client renders.
  const options = attachReferencedTaskTitles(
    [...covered, { ...CONTINUE_UNTIL_STOPPED_OPTION }],
    roadmapModel
  );
  // Same exported resolver the live generator calls, run at the same point in the
  // pipeline (last, over the final list) — never a re-implementation.
  const directions = resolveDirections(options, declaredDirections);

  // Build the analysis + context + summary from the same machinery the real
  // generator uses, so the mock panels show representative output (parity).
  const analysis = 'Started work is the priority to keep WIP low; the queue then offers the next ranked item, and a larger direction is available if there is appetite for it.';
  const context = formatNextRunContext(roadmapModel, 'Test Workspace');
  const summary = buildNextRunSummary(roadmapModel, 'Test Workspace');
  return { analysis, directions, options, context, summary };
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl    - middleware: session + req.workspace
 * @param {Object}   deps.freeTierStore       - free-tier usage store (tryUse)
 * @param {Object}   deps.workspacePreferencesStore - workspace prefs store (model selection)
 * @param {Function} deps.getOpenRouterSource - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo       - () → deploy metadata
 * @param {Object}   [deps.reportHistoryStore] - durable roadmap-report store (getLatest); LIN-742
 * @returns {Router}
 */
export function createNextRunRoutes({ workspaceFromUrl, freeTierStore, workspacePreferencesStore, getOpenRouterSource, getDeployInfo, reportHistoryStore }) {
  const router = Router();

  // ─── HTML page ──────────────────────────────────────────────────────────────

  router.get('/workspace/:urlKey/next-run', workspaceFromUrl, (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors collective/task-chat).
    if (featureFlags.nextRun !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      const aiConfigured = isRecommendationEnabled(req.session.openRouterApiKey) || !!process.env.OPENROUTER_FREE_TIER_KEY;
      // Localhost is the only place the `local`/harbour dispatch target makes
      // sense (a Harbour OS session on the operator's own machine), mirroring the
      // tree/swipe disclosure's `isLocalhost` gate.
      const host = req.get('host') || '';
      const isLocalhost = ['localhost', '127.0.0.1'].some(h => host.startsWith(h));
      const html = renderNextRunPage(
        { aiConfigured },
        {
          deployInfo: getDeployInfo(),
          urlKey: workspace.urlKey,
          openRouterSource: getOpenRouterSource(req),
          workspaces: req.session.workspaces,
          featureFlags,
          isLocalhost,
        }
      );
      res.send(html);
    } catch (error) {
      console.error('Next run page error:', error);
      const html = renderErrorPage('Something Went Wrong', 'Could not load the Suggested Next Run page. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/next-run`,
      });
      res.status(500).send(html);
    }
  });

  // ─── Suggest endpoint ─────────────────────────────────────────────────────────

  router.post('/workspace/:urlKey/api/next-run/suggest', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;

    const featureFlags = getFeatureFlags(req.session);
    if (featureFlags.nextRun !== true) {
      return res.status(403).json({ error: 'Suggested next run feature is not enabled' });
    }

    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const mockAi = shouldMockAi(workspace);
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;
    const apiKeyToUse = sessionApiKey || getPaidEnvKey() || freeTierKey;

    if (!mockAi && !apiKeyToUse) {
      return res.status(503).json({ error: 'AI is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.' });
    }

    if (!mockAi && isFreeTier) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return res.status(429).json({
          error: check.reason,
          freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt }
        });
      }
    }

    if (mockAi) {
      return res.json({ ...buildMockResponse(), model: 'mock' });
    }

    try {
      const { organizationName, projects, issues } =
        await getProviderForWorkspace(workspace).fetchProjects(getWorkspaceCallScope(workspace));
      const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'next-run', forceDefault: isFreeTier });
      // Fold the latest durable roadmap narrative into context when one exists and
      // is fresh; getLatest already returns null on absence/error, and the lib gates
      // staleness, so suggestions degrade cleanly when there is nothing to add (LIN-742).
      const roadmapReport = reportHistoryStore ? await reportHistoryStore.getLatest(workspace.urlKey) : null;
      // Live workspace north star (LIN-779): the session preference set/read in
      // routes/workspace-api.js. Always-current intent — threaded so goal options can be
      // ranked by alignment, not just delivery state. Empty when none → no-north-star path.
      const northStar = req.session.northStarByWorkspace?.[workspace.urlKey] || '';
      const result = await generateGoalSuggestions(
        { projects, issues, organizationName, roadmapReport, northStar },
        { apiKey: apiKeyToUse, model, urlKey: workspace.urlKey }
      );
      res.json(result);
    } catch (error) {
      console.error('Next run suggest error:', error);
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' });
      }
      res.status(502).json({ error: 'Failed to generate suggestions' });
    }
  });

  return router;
}
