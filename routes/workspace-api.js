/**
 * Workspace-prefixed API routes.
 *
 * Handles all /workspace/:urlKey/api/* endpoints:
 * - Audit (GET audit): moved to workspace-api-audit.js (LIN-3883), registered on this router where the block sat
 * - Prompts: moved to workspace-api-prompts.js (LIN-3842): GET /api/prompt/:issueId/:labelName and both GET /api/autopilot-prompt
 * - Recommendations: AI-generated prompts via OpenRouter
 * - Issue reads (GET comments, detail, image): moved to workspace-api-issue-read.js (LIN-3872)
 * - Issue writes (POST comments, POST issues, PATCH issues): moved to workspace-api-issue-write.js (LIN-3876)
 * - Scan (GET and POST scan, dismiss, retire, unretire, scan-due): moved to workspace-api-scan.js (LIN-3877), registered on this router where the block sat
 * - Sessions (GET sessions) and run evidence / close-out (GET run-evidence, POST check, POST close-out-press): moved to workspace-api-run-evidence.js (LIN-3894), registered on this router where the blocks sat
 * - Feedback intake (POST feedback): moved to workspace-api-feedback.js (LIN-3893), registered on this router where the block sat; its limiter is re-exported from here
 *
 * Shape (LIN-3596): every route is registered explicitly, in the order below, as a
 * thin handler over a small set of shared steps. The steps sit in two places:
 *   - module level, where they need no dependency (`recommendCallOptions`, `toHopRecord`, ...;
 *     `openIssue`, `refuseCapability`, `failureOf`, `isTestToken`, `refuseFreeTier`, `aiNotConfigured`, `keepaliveFailure` and `loadContext` live in workspace-api-steps.js, shared with workspace-api-prompts.js, workspace-api-issue-read.js, workspace-api-issue-write.js, workspace-api-scan.js, workspace-api-audit.js and workspace-api-feedback.js);
 *   - inside `createWorkspaceApiRoutes`, where they close over the injected stores.
 * The AI pre-flight calls (`resolveChatCredential`, `checkFreeTierGate`, the
 * `forceDefault` model clamp) are deliberately NOT shared: each route names its own,
 * because the source-text censuses scan this file for every one of them.
 *
 * Test-mode builders (mock recommendation, recap, brief, scan, audit data, ...) live
 * in lib/workspace-api-mocks.js.
 */
import { Router } from 'express';
import { jsonError, keepaliveError, notFound } from '../lib/errors.js';
import '../lib/providers/linear/index.js'; // side effect: self-registers the Linear provider into the registry
import { createRoadmapRoutes } from './workspace-api-roadmap.js';
import { createPromptsRoutes } from './workspace-api-prompts.js';
import { registerIssueReadRoutes } from './workspace-api-issue-read.js';
import { registerIssueWriteRoutes } from './workspace-api-issue-write.js';
import { registerAuditRoutes } from './workspace-api-audit.js';
import { registerScanRoutes } from './workspace-api-scan.js';
import { registerFeedbackRoutes } from './workspace-api-feedback.js';
import { registerSessionsRoutes, registerRunEvidenceRoutes } from './workspace-api-run-evidence.js';
export { feedbackSubmitLimiter } from './workspace-api-feedback.js';
export { decisionStampDedupe } from './workspace-api-issue-write.js';
import { isTestToken, failureOf, openIssue, refuseFreeTier, aiNotConfigured, keepaliveFailure, loadContext } from './workspace-api-steps.js';
import { isRecommendationEnabled, getRecommendation, getRecommendationStream, getModelDisplayName } from '../lib/openrouter.js';
import { resolveChatCredential, isAiUnavailable, checkFreeTierGate, isFlagFreeTier, freeTierRefusalBlock } from '../lib/chat-request.js';
import { getModelCatalog, isFreeModel } from '../lib/openrouter-catalog.js';
import { resolveRecommendation, armHopSignal } from '../lib/recommend-recurse.js';
import { prepareRecommendationInput } from '../lib/recommendation-input.js';
import { resolveAiOperationModel } from '../lib/workspace-preferences.js';
import { generateRecap } from '../lib/recap.js';
import { generateBrief } from '../lib/brief.js';
import { buildContextGraph } from '../lib/context-graph.js';
import { hashContext } from '../lib/recap-cache.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { armKeepalive, armSseKeepalive, clientGoneSignal } from '../lib/http-keepalive.js';
import { testMockData } from '../lib/sample-data/mock-data.js';
import { shouldMockAi } from '../lib/should-mock-ai.js';
import { sendSSE } from '../lib/sse.js';
import {
  generateMockRecommendation,
  buildMockRecommendationHop,
  planMockDescent,
  buildMockRecap,
  buildMockBrief,
} from '../lib/workspace-api-mocks.js';

// The two mock builders other modules import from this router (tests, the dashboard).
export { generateMockRecommendation, buildMockRecommendationHop };

// Shared cross-hop budget for the recommend recursion (LIN-329) on the human UI
// path. Matches the proxy's budget; defer hops are cheap (no prompt body) so a deep
// descent stays well inside it. Checked between hops by resolveRecommendation, and
// enforced in-flight per hop via armHopSignal (gap #3, LIN-346).
const RECOMMEND_DESCENT_BUDGET_MS = 180_000;

// Per-fetch bound for a single Linear context fetch. Composes (via AbortSignal.any)
// with the client-disconnect signal and the shared descent budget so a stalled Linear
// call can't hold the SSE socket open until Heroku's H15 fires (LIN-346, gap #1).
const CONTEXT_FETCH_TIMEOUT_MS = 45_000;


// ===========================================================================
// Shared steps that need no dependency
// ===========================================================================






/** The recommendation call options the buffered GET and both stream paths pass the model. */
function recommendCallOptions({ apiKey, model, session, provider, workspace, identifier, signal }) {
  return {
    apiKey,
    model,
    featureFlags: getFeatureFlags(session),
    providerUi: provider.ui || null,
    signal,
    callMeta: { urlKey: workspace.urlKey, feature: 'recommend', issueIdentifier: identifier }
  };
}

/** One recommend hop as the resolver's `computeOne` returns it, from the hop's context and the model's answer. */
function toHopRecord(ctx, r) {
  return {
    identifier: ctx.issue.identifier,
    reasoning: r.reasoning,
    prompt: r.prompt,
    truncated: r.truncated,
    completionTokens: r.completionTokens,
    recommendedAction: r.recommendedAction,
    deferTo: r.deferTo,
    issueUrl: ctx.issue.url,
    // Node state + children (with state) feed the resolver's terminal-state
    // descent guard (LIN-353) — already in ctx, no extra round-trip.
    state: ctx.issue.state,
    children: ctx.children
  };
}

function openSse(res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.flushHeaders();
}

/** The mock stream's reasoning and prompt, each split into 2 chunks so the multi-chunk assembly assertions hold (LIN-405). */
function sendMockSections(res, { reasoning, prompt }) {
  sendSSE(res, 'phase', { phase: 'reasoning' });
  const reasoningMid = Math.floor(reasoning.length / 2);
  sendSSE(res, 'delta', { section: 'reasoning', content: reasoning.slice(0, reasoningMid) });
  sendSSE(res, 'delta', { section: 'reasoning', content: reasoning.slice(reasoningMid) });
  sendSSE(res, 'phase', { phase: 'prompt' });
  const promptMid = Math.floor(prompt.length / 2);
  sendSSE(res, 'delta', { section: 'prompt', content: prompt.slice(0, promptMid) });
  sendSSE(res, 'delta', { section: 'prompt', content: prompt.slice(promptMid) });
}

/** The test-token stream over a fixture issue (LIN-185): a container descends (LIN-327), a leaf streams its mock. */
function streamMockFixture(res, mockIssue) {
  const descent = planMockDescent(mockIssue);

  // Node-shaped mock issue (LIN-327): mirror the live node path — stream a
  // descent breadcrumb for each container, then the terminal child's mock
  // recommendation. Keeps the descent-streaming behaviour E2E-covered.
  if (descent) {
    const { path, terminal, deferredVia, idOf } = descent;
    openSse(res);
    sendSSE(res, 'phase', { phase: 'reasoning' });
    for (let k = 0; k < path.length - 1; k++) {
      sendSSE(res, 'delta', { section: 'reasoning', content: `\n\n↳ ${idOf(path[k])} is a container → routing to ${idOf(path[k + 1])}\n\n` });
    }
    const term = generateMockRecommendation(terminal);
    sendSSE(res, 'delta', { section: 'reasoning', content: term.reasoning });
    sendSSE(res, 'phase', { phase: 'prompt' });
    sendSSE(res, 'delta', { section: 'prompt', content: term.prompt });
    sendSSE(res, 'done', {
      truncated: false, completionTokens: null,
      issueUrl: terminal.url,
      identifier: idOf(terminal), deferredVia, deferTruncated: false
    });
    res.end();
    return;
  }

  const mock = generateMockRecommendation(mockIssue);
  openSse(res);
  sendSSE(res, 'phase', { phase: 'fetching_context' });
  sendMockSections(res, mock);
  sendSSE(res, 'done', { truncated: false, completionTokens: null, issueUrl: mockIssue.url });
  res.end();
}


/**
 * Create workspace API routes with required dependencies.
 * @param {Object} options
 * @param {Function} options.workspaceFromUrl - Middleware to extract workspace from URL
 * @param {Object} options.freeTierStore - Free tier usage store
 * @param {Function} options.getOpenRouterSource - Helper to determine OpenRouter source
 * @param {Object} [options.taskDecisionsStore] - Task-keyed scan-decision store (LIN-2197)
 * @param {Object} [options.sessionsFeedCache] - Shared SWR cache for the rulings/sessions feed (LIN-2755); null → uncached deployment, invalidation is a no-op
 * @param {Object} [options.ownerCredentialStore] - Durable owner-credential store (LIN-2933); null → the comment route's one-shot auth-recovery is disabled, not a hard dependency
 * @param {Function} [options.adoptConnectionCredential] - LIN-3124 PR3 (D7): connection-keyed adopt read (injected; protected module imports no connection seam)
 * @param {Object} [options.runEvidence] - LIN-3247 test seam for the run-evidence route: optional `{ resolveProvider, viewerIsOwner, readPrStatus, githubFetch }` overrides
 * @param {Object} [options.closeOutEventsStore] - LIN-3248 close-out event log (lib/close-out-events-store.js)
 * @param {Object} [options.closeOut] - LIN-3248 test seam for the check/press routes: optional `{ resolveProvider, readPrStatus, githubFetch, isStopAtRun, runnerReady, markDone }` overrides
 * @returns {Router} Express router
 */
export function createWorkspaceApiRoutes({ workspaceFromUrl, freeTierStore, getOpenRouterSource, userPreferencesStore, workspacePreferencesStore, customPromptsStore, recapCacheStore, briefCacheStore, reportHistoryStore, dispatchQueueStore, agentStatusStore, promptTraceStore, proxyTokenStore, taskDecisionsStore, harbourCommentsStore = null, sessionsFeedCache = null, ownerCredentialStore = null, adoptConnectionCredential = null, accountStore = null, runEvidence = null, closeOutEventsStore = null, closeOut = null, workspaceOwnerCheck = null, onTicketWrite = null, recordPipelineMerge = null, installationTokenFor = null }) {
  const router = Router();

  // The test-token DATA mock charges the free tier on its own (the AI-gate above it is
  // scoped to !isTestMode). Returns the denying check, or null when the call may proceed.
  const chargeTestFreeTier = async (workspace, session) => {
    if (!isFlagFreeTier({ sessionApiKey: session.openRouterApiKey, sessionFreeTierFlag: session.freeTierEnabled })) return null;
    const check = await freeTierStore.tryUse(workspace.urlKey);
    return check.allowed ? null : check;
  };


  // Prompt-traces, custom-prompts and prompt-generation API endpoints (LIN-2246 /
  // LIN-3842: extracted to workspace-api-prompts.js). Mounted first; the groups'
  // literal path prefixes (/prompt-traces, /prompts/custom, /prompt/, /autopilot-prompt)
  // are disjoint from every other group's, so mount order is not load-bearing here.
  router.use(createPromptsRoutes({ workspaceFromUrl, promptTraceStore, customPromptsStore }));

  registerAuditRoutes(router, { workspaceFromUrl });

  // What one recommendation model call takes — the issue, its prepared input and
  // the call options — as the argument list for `getRecommendation` /
  // `getRecommendationStream`. `call` carries the per-request pieces (apiKey,
  // model, session, provider, workspace) and the abort `signal` of the hop.
  // Forwards `attachments` (LIN-777) so routing and stage prompts carry the
  // ## Attachments section on every hop, matching the proxy recommendation path.
  async function modelCallArgs(ctx, { signal, ...call }) {
    const identifier = ctx.issue.identifier;
    const input = await prepareRecommendationInput(ctx, { dispatchQueueStore, urlKey: call.workspace.urlKey, identifier });
    return [ctx.issue, input, recommendCallOptions({ ...call, identifier, signal })];
  }

  // The production half of GET …/recommend/:issueId/stream, after the pre-flight
  // refusals. Opens the SSE response and then streams one of two shapes:
  //   - a node task (children) resolves its `defer` descent, streaming every hop;
  //   - a leaf task token-streams its single recommendation.
  // A hang-up aborts the in-flight work and silences everything after it.
  async function streamRecommendation({ req, res, issueId, mockAi, workspace, provider, callScope, apiKey, isFreeTier }) {
    openSse(res);
    // A comment line every 15s keeps the router's 55s window open through any
    // silent stretch, such as a slow routing call.
    const sseKeepalive = armSseKeepalive(res);

    const abort = new AbortController();
    let closed = false;
    const onClientGone = () => {
      closed = true;
      abort.abort();
    };
    req.on('close', onClientGone);
    // A client that left during the awaits before this point (the free-tier gate)
    // closed before the listener was there: it is gone already, so no model call starts.
    if (res.destroyed) onClientGone();

    // Gap #1 (LIN-346): every context fetch is bound by its caller's abort signal
    // ∪ a per-fetch timeout, so a stalled Linear call can't silently idle the socket.
    const fetchContext = (id, signal) => provider.fetchRecommendationContext(
      callScope,
      id,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(CONTEXT_FETCH_TIMEOUT_MS)]) }
    );
    const emit = (type, data) => {
      if (!closed) sendSSE(res, type, data);
    };

    try {
      // Sent even when the client is already gone, as the fetch below is too.
      sendSSE(res, 'phase', { phase: 'fetching_context' });
      const context = await fetchContext(issueId, abort.signal);
      const { issue: contextIssue, children } = context;
      if (closed) return;

      const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recommend', forceDefault: isFreeTier });
      const call = { apiKey, model, session: req.session, provider, workspace };

      if (children?.length > 0) {
        await streamDescent({ res, issueId, mockAi, call, fetchContext, abort, emit, isClosed: () => closed });
      } else if (mockAi) {
        // AI mock (local session) leaf fast-path: the same SSE phase/delta/done
        // sequence the real token stream emits, 2 chunks per section so the
        // multi-chunk assembly assertions hold (LIN-405). The leaf TEST-11 reaches
        // here (children=[]), so mocking only the descent's computeOne would miss it.
        sendMockSections(res, generateMockRecommendation(contextIssue));
        sendSSE(res, 'done', { truncated: false, completionTokens: null, issueUrl: contextIssue.url });
      } else {
        // Phase 2: a leaf task is true token streaming, with the issue url merged
        // into the final done event so all its data arrives in one event.
        await getRecommendationStream(
          ...await modelCallArgs(context, { ...call, signal: abort.signal }),
          (type, data) => emit(type, type === 'done' ? { ...data, issueUrl: contextIssue.url } : data)
        );
      }
    } catch (error) {
      if (closed) return;
      console.error('Streaming recommendation error:', error);
      sendSSE(res, 'error', { error: error.message });
    } finally {
      sseKeepalive.stop();
      if (!closed) res.end();
    }
  }

  // Node-shaped tasks (LIN-327): the first hop is a `defer` with no prompt body,
  // which can't be token-streamed. The descent is resolved and surfaced LIVE —
  // each defer hop streams a breadcrumb into the reasoning section as it routes,
  // so the UI shows progress instead of sitting on "fetching" — and only the
  // terminal hop carries a prompt.
  async function streamDescent({ res, issueId, mockAi, call, fetchContext, abort, emit, isClosed }) {
    // Unhide the reasoning section up front so the breadcrumbs render live.
    sendSSE(res, 'phase', { phase: 'reasoning' });
    const deadline = Date.now() + RECOMMEND_DESCENT_BUDGET_MS;

    // Option B (LIN-346): stream EVERY hop, the terminal one included, rather than
    // buffering it and writing reasoning and prompt only after up to 8000 tokens.
    // Each hop's getRecommendationStream emits phase/delta events that go straight
    // to the client, so the socket stays warm and Heroku H15 can't fire on an
    // all-complete parent that recommends real work at hop 0. The streaming fn's
    // structured return drives the descent (defer parsing is byte-identical: it
    // routes through the same routeStage as the buffered path).
    const { recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
      startIdentifier: issueId,
      deadline,
      onHop: (hop) => {
        if (hop.recommendedAction !== 'defer' || !hop.deferTo) return;
        // LIN-329: a breadcrumb per container routed through, in blank lines so it
        // renders as its own paragraph between the deferring hop's reasoning and
        // the next hop's rather than running on into the surrounding text.
        emit('delta', { section: 'reasoning', content: `\n\n↳ ${hop.identifier} is a container → routing to ${hop.deferTo}\n\n` });
      },
      computeOne: async (id) => {
        // Gap #3: a per-hop in-flight guard (client hang-up ∪ remaining descent
        // budget), released on settle so its timer can't leak into the next hop.
        const hop = armHopSignal({ clientSignal: abort.signal, deadline });
        try {
          const ctx = await fetchContext(id, hop.signal);
          if (mockAi) {
            // AI mock (local session): the terminal hop streams its reasoning and
            // prompt like getRecommendationStream; a defer hop streams nothing
            // here, its breadcrumb coming from onHop (LIN-405).
            const mockHop = buildMockRecommendationHop(ctx);
            if (!isClosed() && mockHop.recommendedAction !== 'defer') {
              emit('phase', { phase: 'reasoning' });
              emit('delta', { section: 'reasoning', content: mockHop.reasoning });
              emit('phase', { phase: 'prompt' });
              emit('delta', { section: 'prompt', content: mockHop.prompt });
            }
            return mockHop;
          }
          return toHopRecord(ctx, await getRecommendationStream(
            ...await modelCallArgs(ctx, { ...call, signal: hop.signal }),
            // Phase + delta go live; the per-hop done is swallowed, since the final
            // done below carries the descent metadata once.
            (type, data) => { if (type !== 'done') emit(type, data); }
          ));
        } finally {
          hop.release();
        }
      }
    });
    if (isClosed()) return;

    if (rec.recommendedAction === 'defer' || !rec.prompt) {
      // An abnormal stop (depth / cycle / unresolved / timeout) is surfaced, never
      // shipped as a defer. The terminal hop's reasoning already streamed live.
      emit('error', { error: 'Recommendation did not resolve to an actionable task', deferredVia, deferTruncated, deferStopReason });
    } else {
      emit('done', { truncated: rec.truncated, completionTokens: rec.completionTokens, issueUrl: rec.issueUrl, identifier: rec.identifier, deferredVia, deferTruncated, deferStopReason });
    }
    // The caller's `finally` ends the response again; the descent has always ended
    // it itself first, and the double end is what a client's socket sees today.
    res.end();
  }

  // ===========================================================================
  // AI Recommendation API
  // ===========================================================================

  /**
   * Check if recommendation feature is available.
   * Returns feature availability status.
   *
   * @route GET /workspace/:urlKey/api/recommend/status
   * @returns {Object} { enabled: boolean }
   */
  router.get('/workspace/:urlKey/api/recommend/status', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;

    // In test mode, always report as enabled for testing
    const sessionApiKey = req.session.openRouterApiKey;
    const source = getOpenRouterSource(req);

    const enabled = isTestToken(workspace) || isRecommendationEnabled(sessionApiKey) || source === 'free';

    // Resolve the workspace's configured LLM model so the footer can surface it.
    // Same single-source-of-truth helper every LLM call site uses.
    const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recommend' })

    res.json({ enabled, source, model, modelName: getModelDisplayName(model) });
  });

  /**
   * Get AI-generated prompt for a task.
   * Analyzes task context and generates a tailored prompt.
   *
   * @route GET /workspace/:urlKey/api/recommend/:issueId
   * @param {string} issueId - The Linear issue ID
   * @returns {Object} { reasoning, prompt } or error
   */
  router.get('/workspace/:urlKey/api/recommend/:issueId', workspaceFromUrl, async (req, res) => {
    // Capability backstop — clean 422 (never a raw NotImplementedError) for a
    // provider that never implements recommendation context (LIN-1910).
    const issue = openIssue(req, res, { capability: 'recommendations' });
    if (!issue) return;
    const { workspace, issueId, provider: issueProvider, callScope: issueCallScope } = issue;

    // Check if feature is enabled (except in test mode)
    // `isTestMode` (test-token) gates the DATA mock; `mockAi` additionally fires
    // the AI mock for local-provider sessions, whose data comes from the provider
    // (LIN-388/LIN-405). The 503/free-tier guards key off `mockAi` so a migrated
    // local session isn't 503'd for lacking an OpenRouter key.
    const isTestMode = isTestToken(workspace);
    const mockAi = shouldMockAi(workspace);
    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
    const { apiKey: apiKeyToUse, isFreeTier } = credential;
    // Free-tier on the AI-mock path is the session flag (CI sets no env key, so
    // `isFreeTier` is always false there); the test-token DATA mock charges its
    // own inside the isTestMode block below, so this is scoped to !isTestMode.
    const surfaceFreeTier = !isTestMode && (mockAi ? isFlagFreeTier({ sessionApiKey: req.session.openRouterApiKey, sessionFreeTierFlag: req.session.freeTierEnabled }) : isFreeTier);
    if (isAiUnavailable({ credential, mockAi })) {
      return jsonError(res, 503, 'AI recommendation feature is not configured. Connect your OpenRouter account or set OPENROUTER_API_KEY.');
    }

    // Atomically check rate limits and record usage before proceeding
    if (surfaceFreeTier) {
      const check = await checkFreeTierGate({ isFreeTier: surfaceFreeTier, urlKey: workspace.urlKey, freeTierStore });
      if (check) {
        return refuseFreeTier(res, check);
      }
    }

    // Linear + OpenRouter can exceed Heroku's 30s router cap (H12). Arm a
    // whitespace keepalive around the slow path.
    const keepalive = armKeepalive(res);
    const gone = clientGoneSignal(res);
    try {
      // Use mock data in test mode
      if (isTestMode) {
        const mockIssue = testMockData.issues.find(i => i.id === issueId);
        if (!mockIssue) {
          return keepaliveError(keepalive, 404, 'Issue not found');
        }

        // Atomically check free tier limits and record usage in test mode
        const denied = await chargeTestFreeTier(workspace, req.session);
        if (denied) {
          return keepaliveError(keepalive, 429, denied.reason, freeTierRefusalBlock(denied));
        }

        const { reasoning, prompt } = generateMockRecommendation(mockIssue);
        return keepalive.send(200, {
          reasoning,
          prompt,
          truncated: false,
          completionTokens: null,
          issueUrl: mockIssue.url
        });
      }

      // Get AI-generated prompt, following any `defer` decisions to a terminal
      // actionable node (LIN-329). A leaf resolves in one hop; a parent the human
      // pinned is transparently resolved to its actionable descendant, with the
      // descent breadcrumb returned. Free-tier usage is charged once per request
      // (above, before this point), not per hop.
      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recommend', forceDefault: isFreeTier });
      const call = { apiKey: apiKeyToUse, model: selectedModel, session: req.session, provider: issueProvider, workspace };
      const deadline = Date.now() + RECOMMEND_DESCENT_BUDGET_MS;
      const { recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
        startIdentifier: issueId,
        deadline,
        computeOne: async (id) => {
          // Two-tier context for parent tasks; the focused child seeds the defer choice.
          const ctx = await issueProvider.fetchRecommendationContext(issueCallScope, id);
          // AI mock (local session): synthesise the hop deterministically so the
          // SAME resolver drives the descent without an OpenRouter call (LIN-405).
          if (mockAi) return buildMockRecommendationHop(ctx);
          // A client hang-up or the descent budget aborts the hop's model calls.
          const hop = armHopSignal({ clientSignal: gone.signal, deadline });
          try {
            return toHopRecord(ctx, await getRecommendation(...await modelCallArgs(ctx, { ...call, signal: hop.signal })));
          } finally {
            hop.release();
          }
        }
      });

      keepalive.send(200, {
        reasoning: rec.reasoning,
        prompt: rec.prompt,
        truncated: rec.truncated,
        completionTokens: rec.completionTokens,
        issueUrl: rec.issueUrl,
        // Terminal identifier + descent breadcrumb (LIN-327, additive).
        identifier: rec.identifier,
        deferredVia,
        deferTruncated,
        deferStopReason
      });
    } catch (error) {
      // A hang-up aborts the model call, which surfaces as a timeout: the client
      // left, and that is not an AI outage.
      if (gone.gone) {
        return keepaliveError(keepalive, 499, 'Client closed the request');
      }
      console.error('Recommendation error:', error);
      keepaliveError(keepalive, ...failureOf(error, 'Failed to get recommendation', { openRouter: true }));
    } finally {
      gone.release();
    }
  });

  // ===========================================================================
  // AI Recommendation Streaming API (SSE)
  // ===========================================================================

  /**
   * Stream AI-generated prompt for a task via Server-Sent Events.
   * Delivers content incrementally with phase indicators.
   *
   * LIN-185: Streaming endpoint for dynamic AI suggestion UX.
   *
   * @route GET /workspace/:urlKey/api/recommend/:issueId/stream
   * @param {string} issueId - The Linear issue ID
   * @returns SSE stream with phase, delta, done, and error events
   */
  router.get('/workspace/:urlKey/api/recommend/:issueId/stream', workspaceFromUrl, async (req, res) => {
    // --- Pre-flight validation (regular HTTP errors) ---

    const issue = openIssue(req, res, { capability: 'recommendations' });
    if (!issue) return;
    const { workspace, issueId, provider: issueProvider, callScope: issueCallScope } = issue;

    // See the GET handler: `isTestMode` gates the DATA mock; `mockAi` fires the
    // AI mock for local sessions; 503/free-tier guards key off `mockAi` (LIN-405).
    const isTestMode = isTestToken(workspace);
    const mockAi = shouldMockAi(workspace);
    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
    const { apiKey: apiKeyToUse, isFreeTier } = credential;
    const surfaceFreeTier = !isTestMode && (mockAi ? isFlagFreeTier({ sessionApiKey: req.session.openRouterApiKey, sessionFreeTierFlag: req.session.freeTierEnabled }) : isFreeTier);

    if (isAiUnavailable({ credential, mockAi })) {
      return jsonError(res, 503, 'AI recommendation feature is not configured.');
    }

    // AI-mock local path: a missing issue must 404 with a real HTTP status BEFORE
    // the SSE headers flush. The production stream surfaces not-found as an in-stream
    // `error` event (headers already sent), but the deterministic mock can verify
    // existence up front, matching the test-token 404 contract (LIN-405). test-token
    // keeps its own 404 in the isTestMode block below.
    if (mockAi && !isTestMode) {
      try {
        await issueProvider.fetchRecommendationContext(issueCallScope, issueId);
      } catch (err) {
        if (/not found/i.test(err?.message)) {
          return notFound.json(res, 'Issue not found');
        }
        throw err;
      }
    }

    // Rate limiting (before streaming starts)
    if (surfaceFreeTier) {
      const check = await checkFreeTierGate({ isFreeTier: surfaceFreeTier, urlKey: workspace.urlKey, freeTierStore });
      if (check) {
        return refuseFreeTier(res, check);
      }
    }

    // --- Test mode: mock streaming ---

    if (isTestMode) {
      const mockIssue = testMockData.issues.find(i => i.id === issueId);
      if (!mockIssue) {
        return notFound.json(res, 'Issue not found');
      }

      // Free tier check in test mode
      const denied = await chargeTestFreeTier(workspace, req.session);
      if (denied) {
        return refuseFreeTier(res, denied);
      }

      return streamMockFixture(res, mockIssue);
    }

    // --- Production mode: real streaming ---

    return streamRecommendation({
      req, res, issueId, mockAi,
      workspace, provider: issueProvider, callScope: issueCallScope,
      apiKey: apiKeyToUse, isFreeTier
    });
  });


  // ===========================================================================
  // Comments API
  // ===========================================================================

  // The issue-read routes (GET comments, detail, image) moved to workspace-api-issue-read.js (LIN-3872);
  // they register on this router, here, so GET comments still precedes POST comments, registered next.
  registerIssueReadRoutes(router, { workspaceFromUrl, getOpenRouterSource, customPromptsStore });

  // The issue-write routes (POST comments, POST issues, PATCH issues) moved to workspace-api-issue-write.js
  // (LIN-3876); they register on this router directly after the reads, so the three paths keep one router (and one OPTIONS `Allow`).
  registerIssueWriteRoutes(router, { workspaceFromUrl, dispatchQueueStore, taskDecisionsStore, harbourCommentsStore, sessionsFeedCache, ownerCredentialStore, adoptConnectionCredential, onTicketWrite, recordPipelineMerge });

  // The sessions route (LIN-3894): registered on this router, here, so the route table's order is unchanged.
  registerSessionsRoutes(router, { workspaceFromUrl, dispatchQueueStore, agentStatusStore });

  // ===========================================================================
  // Recap API (LIN-261) and Brief API (current-state task brief)
  // ===========================================================================

  // The GET half of both: the cache status for one issue, read against the issue's
  // CURRENT content hash. `fresh` carries the stored body, `stale` (the content moved)
  // and `missing` (never generated) do not.
  //   @returns {Object} { status: 'fresh'|'stale'|'missing', <kind>?, generatedAt?, model? }
  const cachedStatusHandler = (kind, store, storeName) => async (req, res) => {
    const issue = openIssue(req, res, { store, storeName, capability: kind });
    if (!issue) return;
    const { workspace, issueId } = issue;

    try {
      const { context, missing } = await loadContext(workspace, issueId, issue);
      if (missing) return notFound.json(res, 'Issue not found');

      const canonicalId = context.issue?.id || issueId;
      const inputHash = hashContext(context);
      const cached = await store.get(workspace.urlKey, canonicalId);

      if (!cached) {
        return res.json({ status: 'missing' });
      }
      if (cached.inputHash !== inputHash) {
        return res.json({
          status: 'stale',
          generatedAt: cached.generatedAt,
          model: cached.model
        });
      }
      return res.json({
        status: 'fresh',
        [kind]: cached[kind],
        generatedAt: cached.generatedAt,
        model: cached.model
      });
    } catch (error) {
      console.error(`${kind === 'recap' ? 'Recap' : 'Brief'} GET error:`, error);
      jsonError(res, ...failureOf(error, `Failed to fetch ${kind} status`));
    }
  };

  // The POST half of both, after each route's own AI pre-flight: read the context, generate
  // the body (the deterministic mock under `mockAi`, the model otherwise), persist it under
  // the issue's content hash, read the stored row back for its timestamp, and reply fresh.
  // Force-regenerate always calls OpenRouter; the keepalive is a Heroku H12 guard.
  //   @param {'recap'|'brief'} kind
  //   @param {Object} ai - the route's resolved credential: `{ mockAi, apiKey, isFreeTier }`
  const generateCachedDocument = async (kind, store, res, issue, ai, { generate, buildMock }) => {
    const { workspace, issueId } = issue;
    const { isFreeTier } = ai;
    const keepalive = armKeepalive(res);
    try {
      const { context, missing } = await loadContext(workspace, issueId, issue);
      if (missing) {
        return keepaliveError(keepalive, 404, 'Issue not found');
      }

      const canonicalId = context.issue?.id || issueId;
      const inputHash = hashContext(context);
      const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: kind, forceDefault: isFreeTier });

      let body;
      let modelUsed;
      if (ai.mockAi) {
        body = buildMock(context);
        modelUsed = model;
      } else {
        const result = await generate(context.issue, context, { apiKey: ai.apiKey, model, callMeta: { urlKey: workspace?.urlKey } });
        body = result[kind];
        modelUsed = result.model;
      }

      await store.put(workspace.urlKey, canonicalId, { inputHash, [kind]: body, model: modelUsed });
      const stored = await store.get(workspace.urlKey, canonicalId);

      keepalive.send(200, {
        status: 'fresh',
        [kind]: stored?.[kind] ?? body,
        generatedAt: stored?.generatedAt ?? new Date(),
        model: modelUsed
      });
    } catch (error) {
      keepaliveFailure(keepalive, `${kind === 'recap' ? 'Recap' : 'Brief'} POST error:`, error, `Failed to generate ${kind}`, { openRouter: true });
    }
  };

  /**
   * GET recap status + body (if fresh).
   *
   * @route GET /workspace/:urlKey/api/recap/:issueId
   * @returns {Object} { status: 'fresh'|'stale'|'missing', recap?, generatedAt?, model? }
   */
  router.get('/workspace/:urlKey/api/recap/:issueId', workspaceFromUrl, cachedStatusHandler('recap', recapCacheStore, 'Recap cache'));

  /**
   * POST recap generate.
   * Regenerates the recap via Haiku (or configured model) and caches it.
   *
   * @route POST /workspace/:urlKey/api/recap/:issueId
   * @returns {Object} { status: 'fresh', recap, generatedAt, model }
   */
  router.post('/workspace/:urlKey/api/recap/:issueId', workspaceFromUrl, async (req, res) => {
    const issue = openIssue(req, res, { store: recapCacheStore, storeName: 'Recap cache', capability: 'recap' });
    if (!issue) return;
    const { workspace, issueId } = issue;

    // `isTestMode` (test-token) gates the DATA mock; `mockAi` additionally fires
    // the AI mock for local-provider sessions, whose data comes from the
    // provider (LIN-388). The AI-config + free-tier guards key off `mockAi` so a
    // migrated local session isn't 503'd for lacking an OpenRouter key.
    const mockAi = shouldMockAi(workspace);
    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
    const { apiKey: apiKeyToUse, isFreeTier } = credential;

    if (isAiUnavailable({ credential, mockAi })) {
      return aiNotConfigured(res, 'recap');
    }

    if (!mockAi && isFreeTier) {
      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
      if (check) {
        return refuseFreeTier(res, check);
      }
    }

    return generateCachedDocument('recap', recapCacheStore, res, issue, { mockAi, apiKey: apiKeyToUse, isFreeTier }, { generate: generateRecap, buildMock: buildMockRecap });
  });

  // ===========================================================================
  // Context API (LIN-572) — relationship neighborhood for the Context section.
  //
  // Deterministic, not AI: it resolves the issue's blocker chains, parent/child
  // links, and related tasks against the workspace's loaded issue set (the same
  // universe the dashboard renders), so there is nothing to cache or regenerate.
  // One read of fetchProjects feeds buildContextGraph; transitive chains fall out
  // of the in-set graph traversal — no per-hop API calls. Shared by both the main
  // project page and the swipe view via the public/context.js client module.
  // ===========================================================================

  /**
   * GET the relationship neighborhood (blockers, blocked, parent/child, related)
   * of an issue, ready to render as a context diagram.
   *
   * @route GET /workspace/:urlKey/api/context/:issueId
   * @returns {Object} The context graph (see lib/context-graph.js), or 404 when
   *   the issue is absent from the loaded set.
   */
  router.get('/workspace/:urlKey/api/context/:issueId', workspaceFromUrl, async (req, res) => {
    // LIN-3240 (LIN-3126 §2): this is an ISSUE-neighbourhood read — fetch the
    // issue's OWN binding (strict), not the workspace's active one.
    const found = openIssue(req, res);
    if (!found) return;
    const { workspace, issueId } = found;

    try {
      const issues = isTestToken(workspace)
        ? testMockData.issues
        : (await found.provider.fetchProjects(found.callScope)).issues;

      // Resolve the root by canonical id or human identifier (LIN-123), since the
      // section mounts with whichever the surface has to hand.
      const needle = issueId.toLowerCase();
      const root = (issues || []).find(i =>
        i.id === issueId || (i.identifier || '').toLowerCase() === needle);
      if (!root) {
        return notFound.json(res, 'Issue not found');
      }

      const graph = buildContextGraph(issues, root.id);
      if (!graph) {
        return notFound.json(res, 'Issue not found');
      }
      return res.json(graph);
    } catch (error) {
      console.error('Context GET error:', error);
      jsonError(res, ...failureOf(error, 'Failed to build context'));
    }
  });

  /**
   * GET brief status + body (if fresh).
   *
   * @route GET /workspace/:urlKey/api/brief/:issueId
   * @returns {Object} { status: 'fresh'|'stale'|'missing', brief?, generatedAt?, model? }
   */
  router.get('/workspace/:urlKey/api/brief/:issueId', workspaceFromUrl, cachedStatusHandler('brief', briefCacheStore, 'Brief cache'));

  /**
   * POST brief generate.
   * Regenerates the brief via Haiku (or configured model) and caches it.
   *
   * @route POST /workspace/:urlKey/api/brief/:issueId
   * @returns {Object} { status: 'fresh', brief, generatedAt, model }
   */
  router.post('/workspace/:urlKey/api/brief/:issueId', workspaceFromUrl, async (req, res) => {
    const issue = openIssue(req, res, { store: briefCacheStore, storeName: 'Brief cache', capability: 'brief' });
    if (!issue) return;
    const { workspace, issueId } = issue;

    // See the recap POST note: `isTestMode` gates the DATA mock, `mockAi` the AI
    // mock (incl. local-provider sessions) and the AI-config/free-tier guards.
    const mockAi = shouldMockAi(workspace);
    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
    const { apiKey: apiKeyToUse, isFreeTier } = credential;

    if (isAiUnavailable({ credential, mockAi })) {
      return aiNotConfigured(res, 'brief');
    }

    if (!mockAi && isFreeTier) {
      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
      if (check) {
        return refuseFreeTier(res, check);
      }
    }

    return generateCachedDocument('brief', briefCacheStore, res, issue, { mockAi, apiKey: apiKeyToUse, isFreeTier }, { generate: generateBrief, buildMock: buildMockBrief });
  });

  // The scan routes (LIN-3877): registered on this router, here, so the route table's order is unchanged.
  registerScanRoutes(router, { workspaceFromUrl, freeTierStore, workspacePreferencesStore, taskDecisionsStore, harbourCommentsStore, sessionsFeedCache });

  // The feedback intake route (LIN-3893): registered on this router, here, so the route table's order is unchanged.
  registerFeedbackRoutes(router, { workspaceFromUrl, freeTierStore, workspacePreferencesStore, dispatchQueueStore, proxyTokenStore, accountStore, workspaceOwnerCheck });

  // ===========================================================================
  // Custom Prompts API
  // ===========================================================================

  /**
   * Live OpenRouter model catalog (LIN-1111 Session 2) — the JSON source the
   * client-rendered dispatch-exec-controls (public/common.js) fetch once per
   * page load to supplement the static DISPATCH_MODEL_SUGGESTIONS picker
   * with the full live catalog. Same underlying cache module
   * (lib/openrouter-catalog.js) the Settings server-render path calls
   * directly, so both surfaces share one source of truth (never a fourth
   * duplicated list). Never 500s: a catalog fetch failure resolves to `[]`
   * upstream, so this always returns 200 with whatever's available.
   *
   * Widened additively (LIN-2719 S0) with a per-model `free` boolean —
   * `isFreeModel` has exactly one implementation (lib/openrouter-catalog.js),
   * so the browser reads the verdict off the wire rather than re-deriving it
   * from raw per-token pricing strings client-side. Existing consumers read
   * `.id` only, so this changes nothing for them.
   * @route GET /workspace/:urlKey/api/openrouter/models
   */
  router.get('/workspace/:urlKey/api/openrouter/models', workspaceFromUrl, async (req, res) => {
    try {
      const models = await getModelCatalog({ mock: shouldMockAi(req.workspace) });
      res.json({ models: models.map(m => ({ id: m.id, name: m.name, free: isFreeModel(m) })) });
    } catch (error) {
      console.error('OpenRouter model catalog endpoint error:', error);
      res.json({ models: [] });
    }
  });

  // The run-evidence and close-out routes (LIN-3894): registered on this router, here, so the route table's order is unchanged.
  registerRunEvidenceRoutes(router, { workspaceFromUrl, dispatchQueueStore, runEvidence, closeOutEventsStore, closeOut, onTicketWrite, installationTokenFor });

  // Roadmap API endpoints (LIN-2246: extracted to workspace-api-roadmap.js).
  // Mounted at this same position in the registration sequence it previously
  // occupied inline; every /api/roadmap/* path is disjoint from every other
  // group's literal prefix (recap/brief/scan/comments/...), so no dynamic
  // :param route in another group can ever swallow a /roadmap/* request —
  // the mount position is not load-bearing here (unlike task-chat.js's
  // /saved-before-/:issueId case), but is kept for a minimal diff.
  router.use(createRoadmapRoutes({ workspaceFromUrl, freeTierStore, userPreferencesStore, workspacePreferencesStore, reportHistoryStore }));

  return router;
}
