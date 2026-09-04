/**
 * Group F compute routes (LIN-679 Stage 4 / LIN-2538: extracted from
 * routes/proxy.js, byte-identical handler bodies).
 *
 * Task-automation / compute endpoints: task stack, prompt generation,
 * AI recommendation, task snapshots + diff, cost, north-star, periodicals,
 * recap (GET+POST), brief (GET+POST).
 */
import { Router } from 'express';
import { graphqlErrorExtra, graphqlErrorDetail } from '../lib/proxy-graphql-errors.js';
import { anchorFor as taskCostAnchorFor, buildTaskCost } from '../lib/task-cost.js';
import { isRecommendationEnabled } from '../lib/openrouter.js';
import { resolveRecommendation } from '../lib/recommend-recurse.js';
import { resolveAiOperationModel } from '../lib/workspace-preferences.js';
import { resolveNorthStarSignal, resolveRoadmapNarrative, classifyReportFreshness, ROADMAP_REPORT_MAX_AGE_DAYS } from '../lib/next-run.js';
import { getNorthStarDocVersion } from '../lib/north-star-resolver.js';
import { generateRecap } from '../lib/recap.js';
import { generateBrief } from '../lib/brief.js';
import { hashContext } from '../lib/recap-cache.js';
import { isTerminalState } from '../lib/tree.js';
import { buildTaskStack } from '../lib/task-stack.js';
import { generatePrompt, hasPrompt, deriveDispatchKind } from '../lib/prompt-templates.js';
import { getPeriodicals } from '../lib/periodicals.js';
import { foldPeriodicalRuns, DEFAULT_HORIZON_MS } from '../lib/periodical-runs.js';
import { PERIODICAL_PROJECTION, PERIODICAL_HISTORY_PROJECTION } from '../lib/dispatch-store.js';
import { parseRepoFromDescription, buildPromptFilename } from '../lib/prompt-formatters.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { UUID_REGEX, isValidIssueId } from '../lib/workspace.js';
import { badRequest, jsonError, notFound } from '../lib/errors.js';

/**
 * @param {Object} deps
 * @param {Object} deps.recapCacheStore - Recap cache storage instance
 * @param {Object} deps.briefCacheStore - Brief cache storage instance
 * @param {Object} deps.taskSnapshotStore - Task-history snapshot storage instance
 * @param {Object} deps.dispatchQueueStore - Dispatch queue storage instance
 * @param {Object} deps.llmCallLogStore - Per-LLM-call metadata log
 * @param {Function} deps.getWorkspaceOpenRouterKey - Function to get OpenRouter API key from workspace sessions
 * @param {Function} [deps.getWorkspaceNorthStar] - Function(urlKey, accountId) resolving the proxy
 *   token creator's durable north-star intent (LIN-1810). Absent → GET /api/proxy/north-star 503s.
 * @param {Function} [deps.getNorthStarDocVersionForWorkspace] - Function(urlKey, accountId)
 *   resolving the doc-hash stamp recorded for this workspace's northStar, if any (LIN-2254).
 * @param {Object} [deps.reportHistoryStore] - Durable per-workspace roadmap report history store (LIN-1810).
 * @param {Object} deps.workspacePreferencesStore - Workspace-level preference storage
 * @param {Function} deps.proxyLimiter - Per-IP rate limiter middleware (module-scope in routes/proxy.js, shared as-is; injected here rather than redeclared so that lifetime is preserved)
 * @param {Function} deps.authenticateProxyToken - Consumer-token auth middleware (closure-local in createProxyRoutes)
 * @param {Function} deps.resolveProviderAccess - Resolves {token, reason, provider} for the active workspace/provider (closure-local)
 * @param {Function} deps.denyIfUnsupported - Capability gate; 422s an unsupported provider method (closure-local)
 * @param {Function} deps.logEvent - Audit/witness event logger (closure-local)
 * @param {Function} deps.logOpenRouterCredentialSource - Logs which OpenRouter credential source served a free-tier-eligible request (closure-local; shared with group I)
 * @param {Function} deps.workspaceUnavailable - 503 envelope for an unresolvable workspace credential (closure-local)
 * @param {Function} deps.graphqlErrorStatus - Maps a provider/GraphQL error to an HTTP status (closure-local)
 * @param {Function} deps.captureTaskSnapshot - Fire-and-forget task-history snapshot capture (closure-local)
 * @param {Function} deps.chargeFreeTierOrReject - Free-tier metering choke point (closure-local; relocated in routes/proxy.js by G1, shared with group I)
 * @param {Function} deps.computeRecommendation - Shared, test-mode-aware recommendation compute (closure-local; relocated in routes/proxy.js by G1, shared with group I)
 * @param {Function} deps.recommendErrorResponse - Maps a recommendation error to {status, body} (closure-local; relocated in routes/proxy.js by G1, shared with group I)
 * @param {Function} deps.resolveProxyLLM - Resolves OpenRouter credentials for a proxy LLM call (module-scope in routes/proxy.js, shared with group I)
 * @param {Function} deps.resolvePromptIssueContext - Resolves the issue + prompt context for deterministic, server-side prompt generation (module-scope, shared with groups H/I)
 * @param {Function} deps.withTimeout - Races a promise against a timeout (module-scope, shared with group I)
 * @param {number} deps.LINEAGE_QUERY_LIMIT - Cap on lineage-history rows read for the north-star endpoint (module-scope)
 * @param {number} deps.RECOMMEND_DESCENT_BUDGET_MS - Shared cross-hop budget for the recommend recursion (module-scope)
 * @param {number} deps.LLM_TIMEOUT_MS - Budget for the OpenRouter LLM generation leg (module-scope)
 * @param {Function} deps.getTestMockData - Lazy-loads test fixtures in test mode (module-scope, shared with groups H/I)
 * @param {Function} deps.fetchWithTimeout - Like withTimeout, but cancels the underlying work via AbortSignal on trip (module-scope; definition stays in routes/proxy.js, shared with group I)
 * @param {number} deps.CONTEXT_FETCH_TIMEOUT_MS - Backstop for the Linear context fetch on recommendation-style endpoints (module-scope; definition stays in routes/proxy.js, shared with group I)
 */
export function createComputeRoutes({
  recapCacheStore,
  briefCacheStore,
  taskSnapshotStore,
  dispatchQueueStore,
  llmCallLogStore,
  getWorkspaceOpenRouterKey,
  getWorkspaceNorthStar,
  getNorthStarDocVersionForWorkspace,
  reportHistoryStore,
  workspacePreferencesStore,
  proxyLimiter,
  authenticateProxyToken,
  resolveProviderAccess,
  denyIfUnsupported,
  logEvent,
  logOpenRouterCredentialSource,
  workspaceUnavailable,
  graphqlErrorStatus,
  captureTaskSnapshot,
  chargeFreeTierOrReject,
  computeRecommendation,
  recommendErrorResponse,
  resolveProxyLLM,
  resolvePromptIssueContext,
  withTimeout,
  LINEAGE_QUERY_LIMIT,
  RECOMMEND_DESCENT_BUDGET_MS,
  LLM_TIMEOUT_MS,
  getTestMockData,
  fetchWithTimeout,
  CONTEXT_FETCH_TIMEOUT_MS,
}) {
  const router = Router();

  // Longer timeout for Linear endpoints that make multiple sequential GraphQL
  // calls (e.g. the projects + issues fetch behind /stack-style pagination).
  // The OpenRouter generation leg is NOT capped by this — it has its own, much
  // larger budget (LLM_TIMEOUT_MS) so a slow-but-healthy generation isn't killed.
  const MULTI_REQUEST_TIMEOUT_MS = 50_000;

  /**
   * Build a mock recommendation context from test fixtures (mirrors workspace-api.js).
   */
  async function buildMockRecapContextFromFixtures(issueId) {
    const mockData = await getTestMockData();
    const mockIssue = mockData.issues.find(i => i.id === issueId || i.identifier === issueId || i.url?.endsWith(`/${issueId}`));
    if (!mockIssue) return null;
    const project = mockData.projects.find(p => p.id === mockIssue.project?.id) || null;
    const labels = (mockIssue.labels?.nodes || []).map(l => l.name);
    const comments = (mockIssue.comments?.nodes || []).map(c => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      user: { name: c.user?.name || 'Unknown' }
    }));
    const children = (mockIssue.children?.nodes || []).map(c => ({
      id: c.id,
      identifier: c.identifier || c.id,
      title: c.title,
      state: c.state || { type: 'unstarted', name: 'Todo' },
      labels: (c.labels?.nodes || []).map(l => l.name)
    }));
    return {
      issue: {
        id: mockIssue.id,
        identifier: mockIssue.identifier || mockIssue.id,
        title: mockIssue.title,
        description: mockIssue.description || '',
        state: mockIssue.state,
        labels,
        url: mockIssue.url
      },
      parent: null,
      siblings: [],
      project: project ? { id: project.id, name: project.name } : null,
      children,
      comments,
      focusedChild: null
    };
  }

  /**
   * Build a small deterministic recap for test mode.
   */
  function buildMockRecapFromContext(context) {
    const done = [];
    const pending = [];
    const deviations = [];

    if ((context.comments || []).length > 0) {
      done.push({
        item: 'Discussion captured in comments',
        evidence: `${context.comments.length} comment(s) recorded`
      });
    }
    if (context.issue?.description) {
      done.push({
        item: 'Description documented',
        evidence: 'Description is present on the issue'
      });
    }
    const remainingChildren = (context.children || []).filter(
      c => !isTerminalState(c.state?.type)
    );
    for (const c of remainingChildren.slice(0, 3)) {
      pending.push({
        item: `Complete subtask ${c.identifier}`,
        predicted: c.title || ''
      });
    }
    if (pending.length === 0) {
      pending.push({
        item: 'Continue implementation',
        predicted: 'Pick up from current state'
      });
    }
    return { done, pending, deviations };
  }

  /**
   * Build a small deterministic brief (fixed-section Markdown) for test mode.
   * Mirrors buildMockBrief in routes/workspace-api.js so the proxy and in-app
   * paths return the same shape under test.
   */
  function buildMockBriefFromContext(context) {
    const issue = context.issue || {};
    const remaining = (context.children || []).filter(c => !isTerminalState(c.state?.type));

    const lines = [];
    lines.push('## Current');
    lines.push(`${issue.title || 'Untitled task'} — ${issue.description ? issue.description.split('\n')[0] : 'No description provided.'}`);
    if (remaining.length > 0) {
      lines.push('');
      lines.push(`Remaining: ${remaining.map(c => c.identifier).join(', ')}.`);
    }
    lines.push('');

    lines.push('## Constraints');
    lines.push('- _None._');
    lines.push('');

    lines.push('## Open questions');
    lines.push('- _None._');
    lines.push('');

    lines.push('## Changelog');
    if ((context.comments || []).length > 0) {
      lines.push(`- **Discussion captured in ${context.comments.length} comment(s)** — context lives in the thread, not yet folded into the spec.`);
    } else {
      lines.push('- _None._');
    }

    return lines.join('\n');
  }

  // =========================================================================
  // Consumer API - Task Automation Endpoints
  // =========================================================================

  /**
   * GET /api/proxy/stack
   * Returns the sorted task stack for task-automation use.
   * Uses the same sort pipeline as the swipe view.
   */
  router.get('/api/proxy/stack', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      // LIN-1980: stamp before any other logic (incl. the !accessToken early
      // return below) so the fingerprint is present even when this request
      // later 401s from a shared credential another site marked suspect.
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/stack', reason);
      }
      if (denyIfUnsupported(provider, 'fetchProjects', req, res, '/api/proxy/stack')) return;

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 50);

      // Fetch projects and issues (use mock data in test mode)
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      let projects, issues;
      if (isTestMode) {
        const mockData = await getTestMockData();
        projects = [...mockData.projects];
        issues = [...mockData.issues];
      } else {
        ({ projects, issues } = await withTimeout(provider.fetchProjects(accessToken), MULTI_REQUEST_TIMEOUT_MS));
      }

      // Project the sorted stack via the shared pure pipeline (lib/task-stack.js),
      // the exact same projection the read-only `get_stack` chat tool drives.
      const view = req.query.view === 'digest' ? 'digest' : 'full';
      const { tasks, total, view: resolvedView } = buildTaskStack({ projects, issues, limit, view });

      logEvent(req, '/api/proxy/stack', 200);
      res.json({ tasks, total, view: resolvedView });
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/stack', status);
      console.error('Proxy /stack error:', err.message);
      jsonError(res, status, 'Failed to fetch task stack', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/issues/:identifier/prompt/:templateKey  (canonical — nested issue-scoped)
   * GET /api/proxy/prompt/:identifier/:templateKey           (forgiving alias, flat form)
   * Returns the generated prompt for a specific issue and template.
   * Shared :identifier/:templateKey params across both forms (LIN-528).
   */
  router.get(['/api/proxy/issues/:identifier/prompt/:templateKey', '/api/proxy/prompt/:identifier/:templateKey'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      // LIN-1980: stamp before any other logic (incl. the !accessToken early
      // return below) so the fingerprint is present even when this request
      // later 401s from a shared credential another site marked suspect.
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/prompt', reason);
      }
      if (denyIfUnsupported(provider, 'fetchIssueContext', req, res, '/api/proxy/prompt')) return;

      const { identifier, templateKey } = req.params;

      // Validate identifier format (UUID or LIN-123 pattern)
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/prompt', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }

      // Validate template key
      if (!hasPrompt(templateKey)) {
        logEvent(req, '/api/proxy/prompt', 404);
        return notFound.json(res, `No prompt template for key: ${templateKey}`);
      }

      // Fetch issue context (use mock data in test mode)
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const ctx = await resolvePromptIssueContext(provider, accessToken, identifier, isTestMode);
      if (!ctx) {
        logEvent(req, '/api/proxy/prompt', 404);
        return notFound.json(res, 'Issue not found');
      }
      const { issue, parent, siblings, project, children, comments, attachments } = ctx;

      // Generate the prompt. Forward `attachments` so generatePrompt's
      // formatAttachmentsSection post-pass surfaces the worker-facing Attachments
      // section (LIN-776) — fetchIssueContext now carries it at top-level (LIN-772),
      // and dropping it here is what silently hid the section on this route.
      const result = generatePrompt(templateKey, issue, { parent, siblings, project, children, comments, attachments }, {}, provider?.ui || null);

      if (!result) {
        logEvent(req, '/api/proxy/prompt', 500);
        return jsonError(res, 500, 'Failed to generate prompt');
      }

      logEvent(req, '/api/proxy/prompt', 200);
      res.json({
        identifier: issue.identifier,
        templateKey,
        promptName: result.name,
        prompt: result.prompt,
        repo: parseRepoFromDescription(project?.description)
      });
    } catch (err) {
      if (err.message?.includes('not found')) {
        logEvent(req, '/api/proxy/prompt', 404);
        return notFound.json(res, 'Issue not found');
      }
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/prompt', status);
      console.error('Proxy /prompt error:', err.message);
      jsonError(res, status, 'Failed to generate prompt', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });


  /**
   * GET /api/proxy/issues/:identifier/recommend  (canonical — nested issue-scoped)
   * GET /api/proxy/recommend/:identifier           (forgiving alias, flat form)
   * Returns an AI-generated prompt recommendation for an issue.
   * Uses the token creator's OAuth key (if available) or server-side OPENROUTER_API_KEY.
   * Shared :identifier param across both forms (LIN-528).
   */
  router.get(['/api/proxy/issues/:identifier/recommend', '/api/proxy/recommend/:identifier'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      // LIN-1980: stamp before any other logic (incl. the !accessToken early
      // return below) so the fingerprint is present even when this request
      // later 401s from a shared credential another site marked suspect.
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recommend', reason);
      }
      // Two capability-gated fetchers can serve this route: the kind-override
      // branch below reaches fetchIssueContext (via resolvePromptIssueContext),
      // the default descent reaches fetchRecommendationContext (via
      // computeRecommendation, which has no req/res of its own — LIN-2044
      // review Note A — so its gate lives here at the resolution point instead).
      if (denyIfUnsupported(provider, 'fetchIssueContext', req, res, '/api/proxy/recommend')) return;
      if (denyIfUnsupported(provider, 'fetchRecommendationContext', req, res, '/api/proxy/recommend')) return;

      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';

      // Resolve OpenRouter API key: token creator's OAuth key or server env var
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      const { identifier } = req.params;

      // Verb-override (LIN-839): an optional ?kind= pins the returned prompt to a
      // specific template kind, returning that kind's grounded prompt
      // deterministically (no LLM/OpenRouter call). Because it makes no LLM call
      // it must bypass the recommendation-enabled 503 gate and free-tier metering
      // below — mirroring the LIN-573 recommend-and-dispatch override. Read it
      // early so those gates can be skipped; generation happens in the keepalive
      // block, falling through to the shared md/JSON response so ?format=md
      // mirrors automatically. No ?kind= → byte-identical to pre-LIN-839 behavior.
      const kind = req.query.kind;

      // Check if AI recommendations are available (skip in test mode and on the
      // deterministic kind-override path). A free-tier-only deployment (only
      // OPENROUTER_FREE_TIER_KEY set) is accepted via isFreeTier.
      const { isFreeTier } = resolveProxyLLM(sessionApiKey);
      if (kind === undefined && !isTestMode && !isRecommendationEnabled(sessionApiKey) && !isFreeTier) {
        logEvent(req, '/api/proxy/recommend', 503);
        return jsonError(res, 503, 'AI recommendations not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.');
      }

      // Validate identifier format (UUID or LIN-123 pattern)
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/recommend', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }

      // Validate the override kind against the generatable template set
      // (hasPrompt = `kind in PROMPT_TEMPLATES`) — NOT isValidDispatchKind, whose
      // DISPATCH_KINDS superset admits non-generatable meta-kinds (defer/autopilot/
      // periodical/custom) that make generatePrompt return null (LIN-839).
      if (kind !== undefined && !hasPrompt(kind)) {
        logEvent(req, '/api/proxy/recommend', 400);
        return badRequest.json(res, `Invalid kind: ${kind}`);
      }

      // LIN-1458: witness which credential source served this request when
      // the creator's own key came back empty. Gated the same as the charge
      // below (kind-override makes no LLM call, so nothing to witness there).
      if (kind === undefined && !isTestMode) {
        logOpenRouterCredentialSource(req, '/api/proxy/recommend', { sessionApiKey, isFreeTier });
      }

      // Charge one free-tier unit ONCE per request (not per descent hop — that
      // would overbill a multi-hop container). resolveRecommendation does the
      // generation below; charge before it so an exhausted user gets a clean 429.
      // Skipped on the kind-override path (LIN-839): it makes no LLM call.
      if (kind === undefined && isFreeTier && !isTestMode) {
        const rejection = await chargeFreeTierOrReject(req, '/api/proxy/recommend');
        if (rejection) {
          logEvent(req, '/api/proxy/recommend', 429);
          return res.status(rejection.status).json(rejection.body);
        }
      }

      // noDescend (LIN-365): recommend the named node's OWN work, never descend into
      // an open child. Deterministic leaf-target lever for parents whose children are
      // out of scope / separately tracked.
      const noDescend = req.query.noDescend === '1' || req.query.noDescend === 'true';

      // Linear + OpenRouter can exceed Heroku's 30s router cap (H12). Arm a
      // delayed whitespace keepalive so the dyno can keep the connection open
      // while the LLM call completes.
      const keepalive = armKeepalive(res);
      try {
        let rec, deferredVia, deferTruncated, deferStopReason;
        if (kind !== undefined) {
          // Kind-override (LIN-839): skip the LLM recommendation + descent. Fetch
          // the named issue's context and generate the requested kind's prompt
          // deterministically. generatePrompt() internally runs the grounding
          // post-passes (appendGroundingSections: staleness / terminal-state /
          // all-subtasks-complete / bug-investigated, plus capability + attachments),
          // so every grounding section the LLM path emits is preserved here.
          // provider?.ui is threaded through so a non-Linear provider renders
          // capability-appropriate text (LIN-2353); Linear output stays
          // byte-identical since its ui is the DEFAULT_PROMPT_UI floor.
          let ctx;
          try {
            ctx = await resolvePromptIssueContext(provider, accessToken, identifier, isTestMode);
          } catch (err) {
            if (err.message?.includes('not found')) {
              keepalive.stop();
              logEvent(req, '/api/proxy/recommend', 404);
              return notFound.json(res, 'Issue not found');
            }
            throw err;
          }
          if (!ctx) {
            keepalive.stop();
            logEvent(req, '/api/proxy/recommend', 404);
            return notFound.json(res, 'Issue not found');
          }
          const { issue, parent, siblings, project, children, comments, attachments } = ctx;
          const generated = generatePrompt(kind, issue, { parent, siblings, project, children, comments, attachments }, {}, provider?.ui || null);
          if (!generated) {
            keepalive.stop();
            logEvent(req, '/api/proxy/recommend', 500);
            return jsonError(res, 500, 'Failed to generate prompt');
          }
          // Shape a recommendation-equivalent object so the override falls through
          // to the shared md/JSON response below (no forked response path).
          rec = {
            identifier: issue.identifier,
            reasoning: null,
            prompt: generated.prompt,
            truncated: false,
            repo: parseRepoFromDescription(project?.description) || null,
            recommendedAction: kind,
            override: true
          };
        } else {
          // Follow any `defer` decisions to a terminal actionable node (LIN-329).
          // A leaf resolves in one hop; a container descends to its real work.
          const recommendDeadline = Date.now() + RECOMMEND_DESCENT_BUDGET_MS;
          ({ recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
            startIdentifier: identifier,
            deadline: recommendDeadline,
            noDescend,
            computeOne: (id) => computeRecommendation({
              urlKey: req.proxyUrlKey,
              createdBy: req.proxyCreatedBy,
              identifier: id,
              accessToken,
              provider,
              isTestMode,
              sessionApiKey,
              deadline: recommendDeadline,
              noDescend
            })
          }));
        }

        keepalive.stop();
        logEvent(req, '/api/proxy/recommend', 200);
        // ?format=md serves the bare recommended prompt as a downloadable
        // markdown file for external consumers (LIN-316). When the keepalive
        // already flushed JSON headers (>25s runs) we can no longer set the
        // attachment headers, so we just stream the prompt bytes — a curl
        // consumer redirecting to a file still gets the right content.
        if (req.query.format === 'md') {
          if (!keepalive.flushed) {
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${buildPromptFilename(rec.identifier, 'recommend')}"`);
          }
          return res.end(rec.prompt || '');
        }
        // recommendedAction + kind are additive (LIN-321); deferredVia + the terminal
        // identifier are additive (LIN-327): existing clients that read
        // identifier/reasoning/prompt/truncated/repo are unaffected. `override` is
        // additive too and present only on the kind-override path (LIN-839), so the
        // default no-kind response stays byte-identical.
        keepalive.send(200, {
          identifier: rec.identifier,
          reasoning: rec.reasoning,
          prompt: rec.prompt,
          truncated: rec.truncated,
          repo: rec.repo,
          recommendedAction: rec.recommendedAction,
          kind: deriveDispatchKind(rec.recommendedAction),
          deferredVia,
          deferTruncated,
          deferStopReason,
          ...(rec.override ? { override: true } : {})
        });
      } catch (err) {
        keepalive.stop();
        const { status, body } = recommendErrorResponse(err, req);
        logEvent(req, '/api/proxy/recommend', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      const { status, body } = recommendErrorResponse(err, req);
      logEvent(req, '/api/proxy/recommend', status);
      res.status(status).json(body);
    }
  });

  /**
   * GET /api/proxy/issues/:identifier/snapshots  (LIN-598)
   * Lists the task-history archive for an issue, newest-first: the append-only
   * sequence of observed-state snapshots captured at the recap/brief read seams.
   * `?limit=N` caps the returned rows; `?diff=1` additionally folds in the
   * read-time diff of the two most recent snapshots (same as /snapshots/diff).
   * Pure read of local history — no Linear fetch, no LLM call.
   */
  router.get('/api/proxy/issues/:identifier/snapshots', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      if (!taskSnapshotStore) {
        logEvent(req, '/api/proxy/snapshots', 503);
        return jsonError(res, 503, 'Task snapshot store not configured');
      }
      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/snapshots', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }

      const rawLimit = parseInt(req.query.limit, 10);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : undefined;
      const { items, total } = await taskSnapshotStore.list(req.proxyUrlKey, identifier, { limit });

      const body = { identifier, total, snapshots: items };
      if (req.query.diff === '1' || req.query.diff === 'true') {
        body.diff = await taskSnapshotStore.diffLatest(req.proxyUrlKey, identifier);
      }
      logEvent(req, '/api/proxy/snapshots', 200);
      res.json(body);
    } catch (err) {
      logEvent(req, '/api/proxy/snapshots', 500);
      jsonError(res, 500, 'Failed to list task snapshots');
    }
  });

  /**
   * GET /api/proxy/issues/:identifier/snapshots/diff  (LIN-598)
   * Read-time field-level diff of the two most recent snapshots for an issue.
   * `changed: false` with one (or zero) snapshot means nothing to compare yet.
   */
  router.get('/api/proxy/issues/:identifier/snapshots/diff', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      if (!taskSnapshotStore) {
        logEvent(req, '/api/proxy/snapshots/diff', 503);
        return jsonError(res, 503, 'Task snapshot store not configured');
      }
      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/snapshots/diff', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }
      const diff = await taskSnapshotStore.diffLatest(req.proxyUrlKey, identifier);
      logEvent(req, '/api/proxy/snapshots/diff', 200);
      res.json({ identifier, ...diff });
    } catch (err) {
      logEvent(req, '/api/proxy/snapshots/diff', 500);
      jsonError(res, 500, 'Failed to diff task snapshots');
    }
  });

  /**
   * GET /api/proxy/issues/:identifier/cost  (canonical — nested issue-scoped)
   * GET /api/proxy/cost/:identifier          (forgiving alias, flat form)
   * (LIN-1775)
   *
   * Per-task API-equivalent USD cost: joins worker dispatch usage telemetry
   * (cumulative `[usage]` feedback, LIN-1425/LIN-1495) with app-side
   * OpenRouter llm-call-log spend attributed to this issue. Pure read — no
   * Linear fetch, no LLM call.
   *
   * `:identifier` MUST be the human issue identifier (e.g. `LIN-1770`), not
   * a UUID: unlike /recap and /brief, this route never resolves through the
   * provider, and dispatch/call-log rows are keyed by identifier. A
   * UUID-shaped param is rejected with 400 rather than silently matching
   * zero rows and returning an authoritative-looking $0.00 (LIN-1775 R1).
   *
   * Own rows come from BOTH the live queue and history, scoped by
   * `issueIdentifier` at the store (indexed). Lineage siblings — other rows
   * sharing a `rootItemId` anchor with one of the own rows — are
   * batch-fetched from history UNSCOPED by issueIdentifier, mirroring the
   * `/dispatch` list route: a cross-issue follow-up's usage must still merge
   * into the anchor's single cumulative total, or that lineage would be
   * undercounted here. `buildTaskCost` (lib/task-cost.js) does the actual
   * lineage-group/merge/sum join; this route only fetches its inputs.
   */
  router.get(['/api/proxy/issues/:identifier/cost', '/api/proxy/cost/:identifier'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      if (!dispatchQueueStore) {
        logEvent(req, '/api/proxy/cost', 503);
        return jsonError(res, 503, 'Dispatch is not available');
      }
      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/cost', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }
      // Dispatch rows and call-log rows are joined on the human issue
      // identifier (e.g. "LIN-1770"), never the issue UUID — unlike
      // /recap and /brief, this route does no provider lookup to resolve
      // one to the other. A UUID passes isValidIssueId's shape check but
      // matches no row, so it must be rejected loudly here rather than
      // silently returning an authoritative-looking $0.00 (LIN-1775 R1).
      if (UUID_REGEX.test(identifier)) {
        logEvent(req, '/api/proxy/cost', 400);
        return badRequest.json(res, 'This endpoint requires the issue identifier (e.g. LIN-123), not a UUID — dispatch and call-log rows are keyed by identifier, so a UUID would silently match zero rows');
      }

      const [queued, history] = await Promise.all([
        dispatchQueueStore.listItems(req.proxyUrlKey, { issueIdentifier: identifier, projection: { prompt: 0 } }),
        dispatchQueueStore.listHistory(req.proxyUrlKey, { issueIdentifier: identifier, projection: { prompt: 0 } })
      ]);
      const ownRows = [
        ...queued.map(i => ({ ...i, status: 'queued', feedback: [] })),
        ...history.items
      ];

      const anchors = [...new Set(
        ownRows.filter(i => i.status === 'taken').map(taskCostAnchorFor).filter(Boolean)
      )];

      const siblingRowsByAnchor = new Map();
      if (anchors.length) {
        const { items: lineageSiblings, total: lineageTotal } = await dispatchQueueStore.listHistory(req.proxyUrlKey, {
          rootItemId: { $in: anchors },
          limit: LINEAGE_QUERY_LIMIT,
          projection: { prompt: 0 }
        });
        if (lineageTotal > LINEAGE_QUERY_LIMIT) {
          console.warn(`Lineage query exceeded LINEAGE_QUERY_LIMIT (${LINEAGE_QUERY_LIMIT}) for urlKey=${req.proxyUrlKey}, identifier=${identifier}, anchors=${anchors.length}, total=${lineageTotal} — result truncated to the newest ${LINEAGE_QUERY_LIMIT}`);
        }
        for (const sib of lineageSiblings) {
          const bucket = siblingRowsByAnchor.get(sib.rootItemId);
          if (bucket) bucket.push(sib);
          else siblingRowsByAnchor.set(sib.rootItemId, [sib]);
        }
      }

      const appSummary = llmCallLogStore
        ? await llmCallLogStore.summarizeByIssue(req.proxyUrlKey, identifier)
        : { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] };

      const result = buildTaskCost({ ownRows, siblingRowsByAnchor, appSummary });

      const ttlSeconds = llmCallLogStore?.ttl || 30 * 24 * 60 * 60;
      const window = {
        days: Math.round(ttlSeconds / 86400),
        appCallsSince: new Date(Date.now() - ttlSeconds * 1000).toISOString()
      };

      logEvent(req, '/api/proxy/cost', 200);
      res.json({ identifier, ...result, window });
    } catch (err) {
      logEvent(req, '/api/proxy/cost', 500);
      jsonError(res, 500, 'Failed to compute task cost');
    }
  });

  /**
   * GET /api/proxy/north-star  (LIN-1810)
   *
   * Read-only: the token creator's durable north-star intent for this
   * workspace, plus a freshness-gated alignment reading and the latest
   * roadmap digest — composed off ONE reportHistoryStore.getLatest() fetch so
   * the two readings cannot drift relative to each other (mirrors
   * generateGoalSuggestions, lib/next-run.js:900-910).
   *
   * Harbour-local-only: no resolveWorkspaceAccess, no provider fetch — the
   * north star and report history are both Harbour-local stores, not
   * Linear-backed. Identity comes from req.proxyCreatedBy, never a session;
   * a creator-less/ownerless token resolves no intent (fails closed), the
   * same invariant getWorkspaceOpenRouterKey enforces (LIN-1352).
   *
   * Reads durable ACCOUNT-owned user preferences (lib/north-star-resolver.js),
   * never workspace preferences and never a session: northStarByWorkspace is
   * account-owned as-built (lib/user-preferences.js:44-46) — an open product
   * question this endpoint must not silently answer. The durable copy can
   * trail an unsaved in-session edit (the best-effort write-through in
   * routes/workspace-api.js); that provenance gap is accepted, not papered
   * over with a session read.
   *
   * Never falls back to ReportRecord.northStar — that is a report-time
   * SNAPSHOT, not the live intent this endpoint returns
   * (lib/report-history-store.js:10-12, :24).
   *
   * No write path, no feature-flag gate (see LIN-1810 research §6): the
   * workspace-scoped, creator-bound, audit-logged token is the
   * authorization, same as every other read verb on this router.
   *
   * docVersion (LIN-2254, additive): makes the `northStar` value's freshness
   * a falsifiable claim instead of an assertion. `current` is always the
   * real, live hash+title of docs/north-star.md (Harbour's own normative
   * doc — read via a local file, never Linear); `stamped` is whatever doc
   * hash was recorded at paste time for THIS workspace's stored
   * northStarByWorkspace value, `null` for the (typical) case where that
   * value isn't sourced from the doc at all; `drift` is `true`/`false` only
   * when a stamp exists to compare against `current`, else `null` — "no
   * claim made," never a fabricated staleness signal against arbitrary
   * pasted text. Resolved off the SAME account+workspace identity as
   * `northStar` (req.proxyCreatedBy/req.proxyUrlKey), independently of
   * `signal`/`reading`/`roadmap` — it fails closed on its own for a
   * creator-less token. `getNorthStarDocVersionForWorkspace` is an OPTIONAL
   * dependency: when a caller constructs this router without it, `stamped`
   * and `drift` degrade to `null` rather than widening the existing
   * `!reportHistoryStore || !getWorkspaceNorthStar` 503 gate — this route
   * stays Harbour-local-only (no resolveWorkspaceAccess, no provider fetch,
   * no capability gating) either way.
   */
  router.get('/api/proxy/north-star', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      if (!reportHistoryStore || !getWorkspaceNorthStar) {
        logEvent(req, '/api/proxy/north-star', 503);
        return jsonError(res, 503, 'Roadmap report history is not configured');
      }

      const [northStar, report, docStamp] = await Promise.all([
        getWorkspaceNorthStar(req.proxyUrlKey, req.proxyCreatedBy),
        reportHistoryStore.getLatest(req.proxyUrlKey),
        getNorthStarDocVersionForWorkspace
          ? getNorthStarDocVersionForWorkspace(req.proxyUrlKey, req.proxyCreatedBy)
          : Promise.resolve(null)
      ]);

      // One report fetch feeds both resolvers, exactly as lib/next-run.js:905-910
      // composes them for generateGoalSuggestions — the two readings cannot
      // disagree about which report is "latest".
      const signal = resolveNorthStarSignal(northStar, report);
      const narrative = resolveRoadmapNarrative(report);
      const reportState = classifyReportFreshness(report);

      // ageDays is null for more than one cause inside resolveNorthStarSignal
      // (no report / stale / future-dated / fresh-but-unscored — LIN-1810
      // research §4a). classifyReportFreshness disambiguates report-level
      // freshness; "unscored" is the one remaining case it can't distinguish
      // on its own (a fresh report whose narrative never carried the layer
      // that block reports).
      //
      // BOTH blocks carry the same four-way discriminator off that one
      // report-level classification, differing only in which narrative layer
      // decides fresh-vs-unscored: the alignment layers (northStarReading/gap)
      // for `reading`, the digest/trajectory layers for `roadmap`. Keeping them
      // symmetric is the point of the endpoint — a consumer must never have to
      // null-check a payload that its own `state` just called "fresh"
      // (LIN-1810 close-out, review finding 1).
      let readingState;
      if (!signal) {
        readingState = 'absent'; // no live north star at all — nothing to fold in
      } else if (reportState !== 'fresh') {
        readingState = reportState; // 'absent' | 'stale'
      } else {
        readingState = (signal.reading || signal.gap) ? 'fresh' : 'unscored';
      }

      // resolveRoadmapNarrative applies the same gate off the same report, so a
      // non-null narrative here implies reportState === 'fresh'; the only case
      // the report-level classification can't call on its own is a fresh report
      // with no digest AND no trajectory prose.
      const roadmapState = reportState !== 'fresh'
        ? reportState // 'absent' | 'stale'
        : (narrative ? 'fresh' : 'unscored');

      const currentDocVersion = getNorthStarDocVersion();
      const drift = (!docStamp || currentDocVersion.hash === null) ? null : docStamp.hash !== currentDocVersion.hash;

      logEvent(req, '/api/proxy/north-star', 200);
      res.json({
        northStar: signal ? signal.northStar : null,
        reading: {
          state: readingState,
          text: signal ? signal.reading : '',
          gap: signal ? signal.gap : '',
          ageDays: signal ? signal.ageDays : null
        },
        roadmap: {
          state: roadmapState,
          narrative: narrative ? narrative.text : null,
          ageDays: narrative ? narrative.ageDays : null
        },
        docVersion: {
          current: currentDocVersion,
          stamped: docStamp || null,
          drift
        },
        reportGeneratedAt: report?.generatedAt || null,
        maxAgeDays: ROADMAP_REPORT_MAX_AGE_DAYS
      });
    } catch (err) {
      logEvent(req, '/api/proxy/north-star', 500);
      jsonError(res, 500, 'Failed to resolve north star');
    }
  });

  /**
   * GET /api/proxy/periodicals  (LIN-1829, sub-ticket of LIN-373 Approach C)
   *
   * Read-only: per-template periodical run state (`due`/`recent`/`never`/
   * `unknown`) derived from the live dispatch queue + history via
   * foldPeriodicalRuns (LIN-1827, lib/periodical-runs.js). This route owns
   * the async reads the fold is pure about — it computes no trigger and
   * dispatches nothing (LIN-1629, not yet built, owns turning this evidence
   * into a dispatch decision).
   *
   * Guards mirror GET /api/proxy/north-star (LIN-1810, :3820 above): proxyLimiter
   * + authenticateProxyToken, `read` scope (no requireWriteScope — its absence
   * is the existing read-scope convention on this router), workspace-scoped via
   * req.proxyUrlKey, 503 when dispatchQueueStore is unavailable. No feature-flag
   * gate — matches every other read verb here (isWorkspaceFeatureEnabled has
   * exactly one app-wide consumer, server.js, and no proxy-token route is
   * flag-gated).
   *
   * Read safety is TWO obligations, not one (LIN-1829 research, corrected
   * 2026-08-03 — this ticket originally conflated them):
   *
   *  (a) PROJECTION. The queue read carries PERIODICAL_PROJECTION and the
   *      history read carries PERIODICAL_HISTORY_PROJECTION (LIN-2385: adds
   *      `feedback: 1`, needed to require a terminal marker — see below) —
   *      the multi-KB-to-10MB `prompt` field never transfers on either read,
   *      and `feedback[]` never transfers on the queue read at all, since
   *      `listItems` has no row-bounding predicate to make that read safe. A
   *      projection is a column filter, NOT a row cap (lib/dispatch-store.js
   *      :55-78).
   *  (b) ROW BOUNDING. `limit` is ruled out permanently: listHistory's `limit`
   *      path sorts on `resolvedAt`, not `dispatchedAt` (lib/dispatch-store.js
   *      :918-940), so it can silently drop or wrongly retain a periodical's
   *      only run. Bounding instead comes from the JS-side
   *      `kind === 'periodical' || periodicalId != null` filter below (a
   *      registry-validated `periodicalId` needs no `kind` guard — LIN-2385).
   *      The history read additionally pushes the same row set down into the
   *      store query itself (`listHistory`'s `periodicalEvidenceRow` option,
   *      lib/dispatch-store.js) — measured safe today (~7,183 history rows
   *      workspace-wide for an O(15) answer). REVISIT TRIGGER: workspace
   *      dispatch-history row count materially exceeding ~25-30k, or this
   *      route's own latency approaching the 30s router ceiling — whichever
   *      comes first — push the same predicate into the queue read too
   *      (deferred out of this ticket; not done here).
   *
   * RUN EVIDENCE (LIN-2385): a history row counts as a completed run only when
   * `status === 'taken'` (excludes `cancelled`/`expired`) AND its `feedback[]`
   * carries a terminal `done`/`complete` marker (via lib/dispatch-terminal.js's
   * `deriveTerminalStatus`, applied in lib/periodical-runs.js) — a claim that
   * was `taken` and then `[failed]`/never reported no longer resets the
   * cadence clock. A LIVE queue row still reads `recent` unconditionally
   * (queue docs carry no `status`/`feedback` at all) — that anti-double-
   * dispatch guard is unchanged.
   *
   * historyTtl is stored in SECONDS (lib/dispatch-store.js:142); the fold
   * wants milliseconds. This is a correctness gate, not a style point — a
   * raw-seconds value is finite, so it passes the fold's Number.isFinite
   * guard and silently collapses the horizon to ~30 minutes, reading every
   * template as `never`. This endpoint must fail toward `recent`, never
   * toward a false `never` — a false `never` would make the (unbuilt)
   * LIN-1629 consumer read "nothing has ever run" and over-dispatch all 15
   * templates at once.
   *
   * `now` is route-supplied (`Date.now()`), never a request parameter — no
   * `?days=`, which keeps the fold's `unknown` state unreachable via any
   * request parameter (not unreachable by construction: an operator raising
   * `historyTtl` above 30 days makes it live with no code change). `runs` is
   * deliberately not published: no live consumer exists yet (LIN-1629 is
   * unbuilt) and reshaping a published field later is costlier than adding
   * one. No registry re-join: `mode`/`cadence` are fold output, carried
   * through from the matched template, so this route can never publish a
   * value that disagrees with the one the `due`/`recent` boundary itself
   * used.
   */
  router.get('/api/proxy/periodicals', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      if (!dispatchQueueStore) {
        logEvent(req, '/api/proxy/periodicals', 503);
        return jsonError(res, 503, 'Dispatch is not available');
      }

      const now = Date.now();
      // Belt-and-suspenders only — the fold re-applies the horizon itself
      // (lib/periodical-runs.js), so this `since` is not load-bearing for
      // correctness, only for trimming the read.
      const effectiveHorizonMs = Math.min(DEFAULT_HORIZON_MS, dispatchQueueStore.historyTtl * 1000);

      const [queueRows, history] = await Promise.all([
        dispatchQueueStore.listItems(req.proxyUrlKey, { projection: PERIODICAL_PROJECTION }),
        dispatchQueueStore.listHistory(req.proxyUrlKey, {
          // A Date, not a raw number: `dispatchedAt` is stored as a real Date
          // and listHistory's `since` is compared against it via `$gte`. The
          // file-backed MangoDB store's cross-type comparator returns NaN
          // (no match) for a Date-vs-Number `$gte`, so a raw epoch-ms number
          // here would silently exclude every history row on that backend —
          // this belt-and-suspenders `since` is supposed to trim the read,
          // never break it.
          since: new Date(now - effectiveHorizonMs),
          projection: PERIODICAL_HISTORY_PROJECTION,
          // LIN-2385: push the same row set the JS-side filter below admits
          // (kind:'periodical' OR periodicalId != null) down into the store
          // query, BEFORE the projection above widens to include `feedback` —
          // narrow rows first, then widen columns. The queue read (`listItems`)
          // gets no such predicate: it never gains `feedback` (see the read-
          // safety note above), so it needs no row-bounding for this purpose.
          periodicalEvidenceRow: true
        })
      ]);

      // JS-side admission filter — a CORRECTNESS guard (stops a human prompt
      // titled like a template from counting as run evidence via the fold's
      // title fallback), never a cost bound — see the revisit trigger above
      // before adding a query-side predicate to the queue read too. Admits a
      // row whose `kind` is the mint's own `'periodical'` OR whose
      // `periodicalId` is stamped (LIN-2385: batch/lane dispatches that
      // discharge a periodical's remit carry a registry-validated
      // `periodicalId` but a different `kind`, e.g. `implementation`) — a
      // stamped `periodicalId` needs no `kind` guard, since it is validated
      // against the live registry at write time (routes/dispatch.js,
      // routes/proxy.js's `POST /dispatch` and `POST /recommend-and-dispatch`).
      const isPeriodicalRow = row => row.kind === 'periodical' || row.periodicalId != null;
      const filteredQueue = queueRows.filter(isPeriodicalRow);
      const filteredHistory = history.items.filter(isPeriodicalRow);

      const results = foldPeriodicalRuns(getPeriodicals(), {
        queueRows: filteredQueue,
        historyRows: filteredHistory
      }, {
        now,
        // historyTtl is SECONDS (lib/dispatch-store.js:142) — mandatory
        // conversion; see the correctness-gate note above.
        historyTtlMs: dispatchQueueStore.historyTtl * 1000
      });

      logEvent(req, '/api/proxy/periodicals', 200);
      res.json({
        periodicals: results.map(r => ({
          id: r.periodicalId,
          title: r.title,
          mode: r.mode,
          cadence: r.cadence,
          state: r.state,
          lastDispatchedAt: r.lastDispatchedAt === null ? null : new Date(r.lastDispatchedAt).toISOString(),
          daysSince: r.daysSince,
          // Per-repo lanes (LIN-1932), additive: always emitted, never `[]`
          // (the fold synthesizes a single default lane even with zero
          // evidence). `runs` is deliberately withheld per lane, mirroring
          // this route's existing top-level withholding above — not a new
          // precedent. `label` is computed here, not in the fold: the fold
          // stays network-free, and this route makes zero provider calls,
          // so it cannot resolve a repo's display name via knownWorkspaceRepos
          // — 'none' reuses that helper's own default-lane label string for
          // vocabulary consistency without importing it.
          repos: r.repos.map(lane => ({
            repo: lane.repo,
            label: lane.repo === null ? 'none' : lane.repo,
            isDefault: lane.isDefault,
            state: lane.state,
            lastDispatchedAt: lane.lastDispatchedAt === null ? null : new Date(lane.lastDispatchedAt).toISOString(),
            daysSince: lane.daysSince
          }))
        }))
      });
    } catch (err) {
      logEvent(req, '/api/proxy/periodicals', 500);
      jsonError(res, 500, 'Failed to resolve periodicals');
    }
  });

  /**
   * GET /api/proxy/issues/:identifier/recap  (canonical — nested issue-scoped)
   * GET /api/proxy/recap/:identifier           (forgiving alias, flat form)
   * Returns the AI-generated recap (done/pending/deviations) for an issue.
   * Auto-regenerates when missing or stale unless `?noRefresh=1` is passed.
   * Shared :identifier param across both forms (LIN-528). POST /recap/:identifier
   * (force-regenerate) is intentionally left flat-only — out of scope for LIN-528.
   */
  router.get(['/api/proxy/issues/:identifier/recap', '/api/proxy/recap/:identifier'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      // LIN-1980: stamp before any other logic (incl. the !accessToken early
      // return below) so the fingerprint is present even when this request
      // later 401s from a shared credential another site marked suspect.
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recap', reason);
      }
      if (denyIfUnsupported(provider, 'fetchRecommendationContext', req, res, '/api/proxy/recap')) return;
      if (!recapCacheStore) {
        logEvent(req, '/api/proxy/recap', 503);
        return jsonError(res, 503, 'Recap cache not configured');
      }

      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/recap', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }

      const noRefresh = req.query.noRefresh === '1' || req.query.noRefresh === 'true';
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      // Regenerate path calls OpenRouter; arm a Heroku H12 guard.
      const keepalive = armKeepalive(res);
      try {
        let context;
        if (isTestMode) {
          context = await buildMockRecapContextFromFixtures(identifier);
          if (!context) {
            keepalive.stop();
            logEvent(req, '/api/proxy/recap', 404);
            return keepalive.send(404, { error: 'Issue not found' });
          }
        } else {
          context = await fetchWithTimeout((signal) => provider.fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        }

        const canonicalId = context.issue?.id || identifier;
        const inputHash = hashContext(context);
        captureTaskSnapshot({ urlKey: req.proxyUrlKey, identifier, context, canonicalId, inputHash });
        const cached = await recapCacheStore.get(req.proxyUrlKey, canonicalId);

        if (cached && cached.inputHash === inputHash) {
          keepalive.stop();
          logEvent(req, '/api/proxy/recap', 200);
          return keepalive.send(200, {
            status: 'fresh',
            identifier: context.issue?.identifier || identifier,
            recap: cached.recap,
            generatedAt: cached.generatedAt,
            model: cached.model
          });
        }

        if (noRefresh) {
          keepalive.stop();
          logEvent(req, '/api/proxy/recap', 200);
          return keepalive.send(200, {
            status: cached ? 'stale' : 'missing',
            identifier: context.issue?.identifier || identifier,
            generatedAt: cached?.generatedAt,
            model: cached?.model
          });
        }

        // A free-tier-only deployment is accepted via isFreeTier. The gate sits
        // AFTER the cache-hit / noRefresh returns above, so a fresh-cache read
        // never reaches it — and the charge below never bills a cache hit.
        const { apiKey: resolvedApiKey, isFreeTier } = resolveProxyLLM(sessionApiKey);
        if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !isFreeTier) {
          keepalive.stop();
          logEvent(req, '/api/proxy/recap', 503);
          return keepalive.send(503, { error: 'AI recap is not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.' });
        }

        // LIN-1458: witness which credential source served this request.
        if (!isTestMode) {
          logOpenRouterCredentialSource(req, '/api/proxy/recap', { sessionApiKey, isFreeTier });
        }

        // Charge one free-tier unit only now that generation is guaranteed.
        if (isFreeTier && !isTestMode) {
          const rejection = await chargeFreeTierOrReject(req, '/api/proxy/recap');
          if (rejection) {
            keepalive.stop();
            logEvent(req, '/api/proxy/recap', 429);
            return keepalive.send(rejection.status, rejection.body);
          }
        }

        const selectedModel = await resolveAiOperationModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore, opKind: 'recap', forceDefault: isFreeTier });
        let recap;
        let modelUsed;
        if (isTestMode) {
          recap = buildMockRecapFromContext(context);
          modelUsed = selectedModel;
        } else {
          const result = await withTimeout(
            generateRecap(context.issue, context, { apiKey: resolvedApiKey, model: selectedModel, callMeta: { urlKey: req.proxyUrlKey } }),
            LLM_TIMEOUT_MS
          );
          recap = result.recap;
          modelUsed = result.model;
        }

        await recapCacheStore.put(req.proxyUrlKey, canonicalId, {
          inputHash,
          recap,
          model: modelUsed
        });
        const stored = await recapCacheStore.get(req.proxyUrlKey, canonicalId);

        keepalive.stop();
        logEvent(req, '/api/proxy/recap', 200);
        keepalive.send(200, {
          status: 'fresh',
          identifier: context.issue?.identifier || identifier,
          recap: stored?.recap ?? recap,
          generatedAt: stored?.generatedAt ?? new Date(),
          model: modelUsed
        });
      } catch (err) {
        keepalive.stop();
        let status;
        let body;
        if (err.message?.includes('not found')) {
          status = 404;
          body = { error: 'Issue not found' };
        } else if (err.message?.includes('OpenRouter')) {
          status = 503;
          body = { error: 'AI service temporarily unavailable', detail: err.message };
        } else {
          status = graphqlErrorStatus(err, req);
          body = { error: 'Failed to fetch recap', detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) };
          console.error('Proxy /recap error:', err.message);
        }
        logEvent(req, '/api/proxy/recap', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      logEvent(req, '/api/proxy/recap', 500);
      console.error('Proxy /recap outer error:', err.message);
      jsonError(res, 500, 'Failed to fetch recap', { detail: err.message });
    }
  });

  /**
   * POST /api/proxy/recap/:identifier
   * Force-regenerate the recap and return it.
   */
  router.post('/api/proxy/recap/:identifier', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      // LIN-1980: stamp before any other logic (incl. the !accessToken early
      // return below) so the fingerprint is present even when this request
      // later 401s from a shared credential another site marked suspect.
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recap', reason);
      }
      if (denyIfUnsupported(provider, 'fetchRecommendationContext', req, res, '/api/proxy/recap')) return;
      if (!recapCacheStore) {
        logEvent(req, '/api/proxy/recap', 503);
        return jsonError(res, 503, 'Recap cache not configured');
      }

      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/recap', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }

      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      // A free-tier-only deployment is accepted via isFreeTier. POST always
      // regenerates (no cache short-circuit), so charging right after the gate
      // bills exactly one unit per generation.
      const { apiKey: resolvedApiKey, isFreeTier } = resolveProxyLLM(sessionApiKey);
      if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !isFreeTier) {
        logEvent(req, '/api/proxy/recap', 503);
        return jsonError(res, 503, 'AI recap is not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.');
      }

      // LIN-1458: witness which credential source served this request.
      if (!isTestMode) {
        logOpenRouterCredentialSource(req, '/api/proxy/recap', { sessionApiKey, isFreeTier });
      }

      if (isFreeTier && !isTestMode) {
        const rejection = await chargeFreeTierOrReject(req, '/api/proxy/recap');
        if (rejection) {
          logEvent(req, '/api/proxy/recap', 429);
          return res.status(rejection.status).json(rejection.body);
        }
      }

      // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
      const keepalive = armKeepalive(res);
      try {
        let context;
        if (isTestMode) {
          context = await buildMockRecapContextFromFixtures(identifier);
          if (!context) {
            keepalive.stop();
            logEvent(req, '/api/proxy/recap', 404);
            return keepalive.send(404, { error: 'Issue not found' });
          }
        } else {
          context = await fetchWithTimeout((signal) => provider.fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        }

        const canonicalId = context.issue?.id || identifier;
        const inputHash = hashContext(context);
        captureTaskSnapshot({ urlKey: req.proxyUrlKey, identifier, context, canonicalId, inputHash });

        const selectedModel = await resolveAiOperationModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore, opKind: 'recap', forceDefault: isFreeTier });
        let recap;
        let modelUsed;
        if (isTestMode) {
          recap = buildMockRecapFromContext(context);
          modelUsed = selectedModel;
        } else {
          const result = await withTimeout(
            generateRecap(context.issue, context, { apiKey: resolvedApiKey, model: selectedModel, callMeta: { urlKey: req.proxyUrlKey } }),
            LLM_TIMEOUT_MS
          );
          recap = result.recap;
          modelUsed = result.model;
        }

        await recapCacheStore.put(req.proxyUrlKey, canonicalId, {
          inputHash,
          recap,
          model: modelUsed
        });
        const stored = await recapCacheStore.get(req.proxyUrlKey, canonicalId);

        keepalive.stop();
        logEvent(req, '/api/proxy/recap', 200);
        keepalive.send(200, {
          status: 'fresh',
          identifier: context.issue?.identifier || identifier,
          recap: stored?.recap ?? recap,
          generatedAt: stored?.generatedAt ?? new Date(),
          model: modelUsed
        });
      } catch (err) {
        keepalive.stop();
        let status;
        let body;
        if (err.message?.includes('not found')) {
          status = 404;
          body = { error: 'Issue not found' };
        } else if (err.message?.includes('OpenRouter')) {
          status = 503;
          body = { error: 'AI service temporarily unavailable', detail: err.message };
        } else {
          status = graphqlErrorStatus(err, req);
          body = { error: 'Failed to fetch recap', detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) };
          console.error('Proxy /recap error:', err.message);
        }
        logEvent(req, '/api/proxy/recap', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      if (err.message?.includes('not found')) {
        logEvent(req, '/api/proxy/recap', 404);
        return notFound.json(res, 'Issue not found');
      }
      if (err.message?.includes('OpenRouter')) {
        logEvent(req, '/api/proxy/recap', 503);
        return jsonError(res, 503, 'AI service temporarily unavailable', { detail: err.message });
      }
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/recap', status);
      console.error('Proxy /recap POST error:', err.message);
      jsonError(res, status, 'Failed to generate recap', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/issues/:identifier/brief  (canonical — nested issue-scoped)
   * GET /api/proxy/brief/:identifier           (forgiving alias, flat form)
   * Returns the current-state task brief (fixed-section Markdown) for an issue.
   * Auto-regenerates when missing or stale unless `?noRefresh=1` is passed.
   * Shared :identifier param across both forms (LIN-528). POST /brief/:identifier
   * (force-regenerate) is intentionally left flat-only — out of scope for LIN-528.
   */
  router.get(['/api/proxy/issues/:identifier/brief', '/api/proxy/brief/:identifier'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      // LIN-1980: stamp before any other logic (incl. the !accessToken early
      // return below) so the fingerprint is present even when this request
      // later 401s from a shared credential another site marked suspect.
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/brief', reason);
      }
      if (denyIfUnsupported(provider, 'fetchRecommendationContext', req, res, '/api/proxy/brief')) return;
      if (!briefCacheStore) {
        logEvent(req, '/api/proxy/brief', 503);
        return jsonError(res, 503, 'Brief cache not configured');
      }

      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/brief', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }

      const noRefresh = req.query.noRefresh === '1' || req.query.noRefresh === 'true';
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      // Regenerate path calls OpenRouter; arm a Heroku H12 guard.
      const keepalive = armKeepalive(res);
      try {
        let context;
        if (isTestMode) {
          context = await buildMockRecapContextFromFixtures(identifier);
          if (!context) {
            keepalive.stop();
            logEvent(req, '/api/proxy/brief', 404);
            return keepalive.send(404, { error: 'Issue not found' });
          }
        } else {
          context = await fetchWithTimeout((signal) => provider.fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        }

        const canonicalId = context.issue?.id || identifier;
        const inputHash = hashContext(context);
        captureTaskSnapshot({ urlKey: req.proxyUrlKey, identifier, context, canonicalId, inputHash });
        const cached = await briefCacheStore.get(req.proxyUrlKey, canonicalId);

        if (cached && cached.inputHash === inputHash) {
          keepalive.stop();
          logEvent(req, '/api/proxy/brief', 200);
          return keepalive.send(200, {
            status: 'fresh',
            identifier: context.issue?.identifier || identifier,
            brief: cached.brief,
            generatedAt: cached.generatedAt,
            model: cached.model
          });
        }

        if (noRefresh) {
          keepalive.stop();
          logEvent(req, '/api/proxy/brief', 200);
          return keepalive.send(200, {
            status: cached ? 'stale' : 'missing',
            identifier: context.issue?.identifier || identifier,
            generatedAt: cached?.generatedAt,
            model: cached?.model
          });
        }

        // Free-tier-only deployments accepted via isFreeTier. The gate sits after
        // the cache-hit / noRefresh returns, so a fresh-cache read never charges.
        const { apiKey: resolvedApiKey, isFreeTier } = resolveProxyLLM(sessionApiKey);
        if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !isFreeTier) {
          keepalive.stop();
          logEvent(req, '/api/proxy/brief', 503);
          return keepalive.send(503, { error: 'AI brief is not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.' });
        }

        // LIN-1458: witness which credential source served this request.
        if (!isTestMode) {
          logOpenRouterCredentialSource(req, '/api/proxy/brief', { sessionApiKey, isFreeTier });
        }

        // Charge one free-tier unit only now that generation is guaranteed.
        if (isFreeTier && !isTestMode) {
          const rejection = await chargeFreeTierOrReject(req, '/api/proxy/brief');
          if (rejection) {
          keepalive.stop();
          logEvent(req, '/api/proxy/brief', 429);
          return keepalive.send(rejection.status, rejection.body);
        }
      }

        const selectedModel = await resolveAiOperationModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore, opKind: 'brief', forceDefault: isFreeTier });
        let brief;
        let modelUsed;
        if (isTestMode) {
          brief = buildMockBriefFromContext(context);
          modelUsed = selectedModel;
        } else {
          const result = await withTimeout(
            generateBrief(context.issue, context, { apiKey: resolvedApiKey, model: selectedModel, callMeta: { urlKey: req.proxyUrlKey } }),
            LLM_TIMEOUT_MS
          );
          brief = result.brief;
          modelUsed = result.model;
        }

        await briefCacheStore.put(req.proxyUrlKey, canonicalId, {
          inputHash,
          brief,
          model: modelUsed
        });
        const stored = await briefCacheStore.get(req.proxyUrlKey, canonicalId);

        keepalive.stop();
        logEvent(req, '/api/proxy/brief', 200);
        keepalive.send(200, {
          status: 'fresh',
          identifier: context.issue?.identifier || identifier,
          brief: stored?.brief ?? brief,
          generatedAt: stored?.generatedAt ?? new Date(),
          model: modelUsed
        });
      } catch (err) {
        keepalive.stop();
        let status;
        let body;
        if (err.message?.includes('not found')) {
          status = 404;
          body = { error: 'Issue not found' };
        } else if (err.message?.includes('OpenRouter')) {
          status = 503;
          body = { error: 'AI service temporarily unavailable', detail: err.message };
        } else {
          status = graphqlErrorStatus(err, req);
          body = { error: 'Failed to fetch brief', detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) };
          console.error('Proxy /brief error:', err.message);
        }
        logEvent(req, '/api/proxy/brief', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      logEvent(req, '/api/proxy/brief', 500);
      console.error('Proxy /brief outer error:', err.message);
      jsonError(res, 500, 'Failed to fetch brief', { detail: err.message });
    }
  });

  /**
   * POST /api/proxy/brief/:identifier
   * Force-regenerate the brief and return it.
   */
  router.post('/api/proxy/brief/:identifier', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      // LIN-1980: stamp before any other logic (incl. the !accessToken early
      // return below) so the fingerprint is present even when this request
      // later 401s from a shared credential another site marked suspect.
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/brief', reason);
      }
      if (denyIfUnsupported(provider, 'fetchRecommendationContext', req, res, '/api/proxy/brief')) return;
      if (!briefCacheStore) {
        logEvent(req, '/api/proxy/brief', 503);
        return jsonError(res, 503, 'Brief cache not configured');
      }

      const { identifier } = req.params;
      if (!isValidIssueId(identifier)) {
        logEvent(req, '/api/proxy/brief', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }

      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);

      // Free-tier-only deployments accepted via isFreeTier. POST always regenerates,
      // so charging right after the gate bills exactly one unit per generation.
      const { apiKey: resolvedApiKey, isFreeTier } = resolveProxyLLM(sessionApiKey);
      if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !isFreeTier) {
        logEvent(req, '/api/proxy/brief', 503);
        return jsonError(res, 503, 'AI brief is not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.');
      }

      // LIN-1458: witness which credential source served this request.
      if (!isTestMode) {
        logOpenRouterCredentialSource(req, '/api/proxy/brief', { sessionApiKey, isFreeTier });
      }

      if (isFreeTier && !isTestMode) {
        const rejection = await chargeFreeTierOrReject(req, '/api/proxy/brief');
        if (rejection) {
          logEvent(req, '/api/proxy/brief', 429);
          return res.status(rejection.status).json(rejection.body);
        }
      }

      // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
      const keepalive = armKeepalive(res);
      try {
        let context;
        if (isTestMode) {
          context = await buildMockRecapContextFromFixtures(identifier);
          if (!context) {
            keepalive.stop();
            logEvent(req, '/api/proxy/brief', 404);
            return keepalive.send(404, { error: 'Issue not found' });
          }
        } else {
          context = await fetchWithTimeout((signal) => provider.fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        }

        const canonicalId = context.issue?.id || identifier;
        const inputHash = hashContext(context);
        captureTaskSnapshot({ urlKey: req.proxyUrlKey, identifier, context, canonicalId, inputHash });

        const selectedModel = await resolveAiOperationModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore, opKind: 'brief', forceDefault: isFreeTier });
        let brief;
        let modelUsed;
        if (isTestMode) {
          brief = buildMockBriefFromContext(context);
          modelUsed = selectedModel;
        } else {
          const result = await withTimeout(
            generateBrief(context.issue, context, { apiKey: resolvedApiKey, model: selectedModel, callMeta: { urlKey: req.proxyUrlKey } }),
            LLM_TIMEOUT_MS
          );
          brief = result.brief;
          modelUsed = result.model;
        }

        await briefCacheStore.put(req.proxyUrlKey, canonicalId, {
          inputHash,
          brief,
          model: modelUsed
        });
        const stored = await briefCacheStore.get(req.proxyUrlKey, canonicalId);

        keepalive.stop();
        logEvent(req, '/api/proxy/brief', 200);
        keepalive.send(200, {
          status: 'fresh',
          identifier: context.issue?.identifier || identifier,
          brief: stored?.brief ?? brief,
          generatedAt: stored?.generatedAt ?? new Date(),
          model: modelUsed
        });
      } catch (err) {
        keepalive.stop();
        let status;
        let body;
        if (err.message?.includes('not found')) {
          status = 404;
          body = { error: 'Issue not found' };
        } else if (err.message?.includes('OpenRouter')) {
          status = 503;
          body = { error: 'AI service temporarily unavailable', detail: err.message };
        } else {
          status = graphqlErrorStatus(err, req);
          body = { error: 'Failed to generate brief', detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) };
          console.error('Proxy /brief error:', err.message);
        }
        logEvent(req, '/api/proxy/brief', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      if (err.message?.includes('not found')) {
        logEvent(req, '/api/proxy/brief', 404);
        return notFound.json(res, 'Issue not found');
      }
      if (err.message?.includes('OpenRouter')) {
        logEvent(req, '/api/proxy/brief', 503);
        return jsonError(res, 503, 'AI service temporarily unavailable', { detail: err.message });
      }
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/brief', status);
      console.error('Proxy /brief POST error:', err.message);
      jsonError(res, status, 'Failed to generate brief', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  return router;
}
