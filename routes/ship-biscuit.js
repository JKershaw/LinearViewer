/**
 * "The Ship's Biscuit" routes — the experimental, flag-gated LLM-generated
 * newspaper (LIN-818, V1: front page + index only).
 *
 * Anchored at /workspace/:urlKey/ship-biscuit, reusing workspaceFromUrl + the
 * collective/task-chat/next-run/flight-companion feature-gate-redirect-to-settings
 * pattern (`createShipBiscuitRoutes(...)` factory, per the plan's store=class /
 * router=factory convention).
 *
 *   GET  /workspace/:urlKey/ship-biscuit            — page shell (gated → redirect)
 *   POST /workspace/:urlKey/api/ship-biscuit/generate  — build + persist an edition (gated → 403)
 *
 * The generate endpoint is the deterministic index-first pass: gather the window's
 * already-wired event sources → build the deterministic edition model → make ONE
 * editor-in-chief LLM call → persist the edition durably → return it. Article bodies
 * are NOT generated here (the deferred V2 on-demand pass). A quiet window skips the
 * LLM entirely and yields an honest slow-news-day edition (quiet-window honesty).
 *
 * §C — free-tier + model override: `chargeRoadmapLayer` is private to
 * createWorkspaceApiRoutes, so this router carries its own 2-line free-tier guard
 * (exactly as routes/next-run.js does). The charge fires ONLY on the real LLM path —
 * a quiet edition makes no call, so it isn't charged.
 */

import { Router } from 'express';
import { renderShipBiscuitPage } from '../lib/render-ship-biscuit.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { buildEditionModel, windowRange } from '../lib/ship-biscuit.js';
import { buildEditorMessages, parseEditorResponse, buildQuietEdition, buildMockEdition } from '../lib/prompts/ship-biscuit-editor.js';
import { DEFAULT_MODEL, streamChat, isRecommendationEnabled, getPaidEnvKey, hasPaidEnvKey } from '../lib/openrouter.js';
import { resolveAiOperationModel } from '../lib/workspace-preferences.js';

/**
 * Whether the AI layer should be mocked for this request — mirrors `shouldMockAi`
 * in routes/next-run.js so e2e specs (and local-provider sessions) get a deterministic
 * grounded edition without an OpenRouter key.
 */
function shouldMockAi(workspace) {
  return process.env.NODE_ENV === 'test' &&
    (workspace?.accessToken === 'test-token' || workspace?.provider === 'local');
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl        - middleware: session + req.workspace
 * @param {Object}   deps.freeTierStore           - free-tier usage store (tryUse)
 * @param {Object}   deps.workspacePreferencesStore - workspace prefs store (model selection)
 * @param {Function} deps.getOpenRouterSource     - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo           - () → deploy metadata
 * @param {Object}   deps.observationSessionsStore - materialized sessions read-model (findByWorkspace)
 * @param {Object}   deps.agentStatusStore        - agent-status log (listStatus)
 * @param {Object}   deps.llmCallLogStore         - LLM call log (summarize → Weather)
 * @param {Object}   deps.shipBiscuitHistoryStore - durable edition store (save/getLatest)
 * @returns {Router}
 */
export function createShipBiscuitRoutes({
  workspaceFromUrl,
  freeTierStore,
  workspacePreferencesStore,
  getOpenRouterSource,
  getDeployInfo,
  observationSessionsStore,
  agentStatusStore,
  llmCallLogStore,
  shipBiscuitHistoryStore
}) {
  const router = Router();

  // ─── HTML page ──────────────────────────────────────────────────────────────

  router.get('/workspace/:urlKey/ship-biscuit', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors flight-companion/next-run).
    if (featureFlags.shipBiscuit !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    try {
      const aiConfigured = isRecommendationEnabled(req.session.openRouterApiKey) || !!process.env.OPENROUTER_FREE_TIER_KEY;
      const latest = shipBiscuitHistoryStore
        ? await shipBiscuitHistoryStore.getLatest(workspace.urlKey).catch(() => null)
        : null;
      const html = renderShipBiscuitPage(
        { edition: latest, aiConfigured },
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
      console.error("Ship's Biscuit page error:", error);
      const html = renderErrorPage('Something Went Wrong', "Could not load The Ship's Biscuit. Please try again.", {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/ship-biscuit`,
      });
      res.status(500).send(html);
    }
  });

  // ─── Generate endpoint ────────────────────────────────────────────────────────

  router.post('/workspace/:urlKey/api/ship-biscuit/generate', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;

    const featureFlags = getFeatureFlags(req.session);
    if (featureFlags.shipBiscuit !== true) {
      return res.status(403).json({ error: "The Ship's Biscuit feature is not enabled" });
    }

    const mockAi = shouldMockAi(workspace);
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;
    const apiKeyToUse = sessionApiKey || getPaidEnvKey() || freeTierKey;

    if (!mockAi && !apiKeyToUse) {
      return res.status(503).json({ error: 'AI is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.' });
    }

    try {
      // 1) Gather the window's already-wired event sources (deterministic inputs).
      const range = windowRange(req.body?.window);
      const [sessionsResult, statusResult, llmStats] = await Promise.all([
        observationSessionsStore ? observationSessionsStore.findByWorkspace(workspace.urlKey).catch(() => ({ sessions: [] })) : Promise.resolve({ sessions: [] }),
        agentStatusStore ? agentStatusStore.listStatus(workspace.urlKey, { since: range.since }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        llmCallLogStore ? llmCallLogStore.summarize(workspace.urlKey).catch(() => null) : Promise.resolve(null),
      ]);

      // 2) Build the deterministic, addressable edition model.
      const model = buildEditionModel({
        window: range.window,
        workspaceName: workspace.name || workspace.organizationName || workspace.urlKey,
        sessions: sessionsResult.sessions || [],
        agentStatusItems: statusResult.items || [],
        llmStats,
      });

      // 3) Produce the front page + index.
      let body;
      let modelId;
      if (model.isQuiet) {
        // Honest slow news day — deterministic, NO LLM call, NO free-tier charge.
        body = buildQuietEdition(model);
        modelId = 'quiet';
      } else if (mockAi) {
        body = buildMockEdition(model);
        modelId = 'mock';
      } else {
        // Real editor-in-chief call. Charge the free tier only here (the one paid call).
        if (isFreeTier) {
          const check = await freeTierStore.tryUse(workspace.urlKey);
          if (!check.allowed) {
            return res.status(429).json({
              error: check.reason,
              freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt }
            });
          }
        }
        modelId = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'ship-biscuit', forceDefault: isFreeTier });
        let buffer = '';
        await streamChat(
          buildEditorMessages(model),
          { apiKey: apiKeyToUse, model: modelId, maxTokens: 1600, temperature: 0.5,
            callMeta: { urlKey: workspace.urlKey, feature: 'ship-biscuit' } },
          (type, data) => { if (type === 'token' && data?.token) buffer += data.token; }
        );
        body = parseEditorResponse(buffer, model);
        // A model that returned nothing usable degrades to the honest quiet edition
        // rather than an empty-but-loud front page.
        if (!body.frontPage.lede && body.index.length === 0) {
          body = buildQuietEdition(model);
          modelId = `${modelId} (empty→quiet)`;
        }
      }

      // 4) Persist durably and return the saved edition.
      const saved = shipBiscuitHistoryStore
        ? await shipBiscuitHistoryStore.save(workspace.urlKey, {
            model: modelId,
            window: model.window,
            since: model.since,
            workspaceName: model.workspaceName,
            isQuiet: model.isQuiet,
            frontPage: body.frontPage,
            index: body.index,
            weather: model.weather,
          })
        : { model: modelId, window: model.window, since: model.since, workspaceName: model.workspaceName, isQuiet: model.isQuiet, frontPage: body.frontPage, index: body.index, weather: model.weather };

      res.json({ edition: saved });
    } catch (error) {
      console.error("Ship's Biscuit generate error:", error);
      if (error.response?.status === 401) {
        return res.status(401).json({ error: 'Token expired or invalid' });
      }
      res.status(502).json({ error: 'Failed to generate the edition' });
    }
  });

  return router;
}
