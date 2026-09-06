/**
 * Workspace-prefixed API routes.
 *
 * Handles all /workspace/:urlKey/api/* endpoints:
 * - Audit: Run workspace audit
 * - Prompts: Generate handwritten prompts
 * - Recommendations: AI-generated prompts via OpenRouter
 * - Comments: Fetch issue comments
 * - Images: Proxy Linear-hosted images with auth
 */
import { Router, json } from 'express';
import { badRequest, jsonError, notFound, unauthorized } from '../lib/errors.js';
import { getProviderForWorkspace, getProvider } from '../lib/providers/registry.js';
import '../lib/providers/linear/index.js'; // side effect: self-registers the Linear provider into the registry
import { createRoadmapRoutes } from './workspace-api-roadmap.js';
import { createPromptsRoutes } from './workspace-api-prompts.js';
import { generatePrompt, generateCustomPrompt, hasPrompt, getAvailablePrompts } from '../lib/prompt-templates.js';
import { renderDetailsContent, PRIORITY_OPTION_LABELS } from '../lib/render.js';
import { WORK_ISSUE_LABELS } from '../lib/workflow-config.js';
import { parseRepoFromDescription, buildPromptFilename } from '../lib/prompt-formatters.js';
import { attachProxyContext } from '../lib/proxy-preamble.js';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT, AUTOPILOT_VARIANTS, AUTOPILOT_VARIANT_DEFAULT } from '../lib/prompts/autopilot-kickoff.js';
import { isRecommendationEnabled, getRecommendation, getRecommendationStream, getModelDisplayName, getPaidEnvKey, hasPaidEnvKey } from '../lib/openrouter.js';
import { getModelCatalog } from '../lib/openrouter-catalog.js';
import { resolveRecommendation, armHopSignal } from '../lib/recommend-recurse.js';
import { sniffRasterType, parseFeedbackImage } from '../lib/attachment-upload.js';

// Shared cross-hop budget for the recommend recursion (LIN-329) on the human UI
// path. Matches the proxy's budget; defer hops are cheap (no prompt body) so a deep
// descent stays well inside it. Checked between hops by resolveRecommendation, and
// enforced in-flight per hop via armHopSignal (gap #3, LIN-346).
const RECOMMEND_DESCENT_BUDGET_MS = 180_000;

// Per-fetch bound for a single Linear context fetch. Composes (via AbortSignal.any)
// with the client-disconnect signal and the shared descent budget so a stalled Linear
// call can't hold the SSE socket open until Heroku's H15 fires (LIN-346, gap #1).
const CONTEXT_FETCH_TIMEOUT_MS = 45_000;

// GET /api/scan-due paging + fan-out bounds (LIN-2649 WS2/S3). Page size
// mirrors BASIS_CHECK_MAX_PER_PAGE (public/observation.js) and its reasoning
// — each check fetches live task context, so N candidates is N provider
// reads. Concurrency mirrors pumpBasisChecks's shape, server-side over the
// DB-sourced candidate list.
const DUE_CHECK_PAGE_SIZE = 40;
const DUE_CHECK_CONCURRENCY = 5;
import { resolveWorkspaceModel, resolveAiOperationModel } from '../lib/workspace-preferences.js';
import { createDispatchItem } from '../lib/dispatch-factory.js';
import { validateOpaqueDispatchField, MAX_NAME_LENGTH } from '../lib/dispatch-validation.js';
import { generateRecap } from '../lib/recap.js';
import { generateBrief } from '../lib/brief.js';
import { generateScan, parseScanResponse } from '../lib/scan.js';
import { TaskDecisionsStore } from '../lib/task-decisions-store.js';
import { generateFeedbackTitle } from '../lib/feedback-title.js';
import { buildContextGraph } from '../lib/context-graph.js';
import { hashContext } from '../lib/recap-cache.js';
import { scanBasisHashFromContext, dueBasisHashFromContext, dueChanged, basisChanged as computeBasisChanged, BASIS_VERSION } from '../lib/scan-fingerprint.js';
import { settleWithConcurrency } from './dashboard.js';
import { getLoopsForIssue } from '../lib/pipeline-loops.js';
import { toSessionView } from '../lib/sessions-view.js';
import { runAudit, computeAuditFromData } from '../lib/audit.js';
import { UUID_REGEX, isValidIssueId, getWorkspaceCallScope, resolveIssueBinding, isActiveProviderLinear } from '../lib/workspace.js';
// LIN-1552 Session A: the session-auth issue write routes reuse the SAME
// symbolic-ref primitives the proxy write path uses, the shared trashed-signal
// detector, and the shared issue-write validator — no rules re-inlined here.
import {
  parseSourceNamespace,
  resolveStateRef,
  resolveProjectRef,
  resolveTeamRef,
  RefResolutionError,
} from '../lib/proxy-ref-resolver.js';
import { PartialWriteError } from '../lib/partial-write-error.js';
import { isTrashed } from '../lib/trashed-signal.js';
import { validateIssueWriteFields, isValidPriority, validateCommentBody, MAX_COMMENT_LENGTH } from '../lib/issue-write-validation.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
// LIN-2154: the session-auth (human-lane) comment write shares the agent-lane's
// dedupe cache instances (routes/proxy.js) rather than a fresh pair that would
// miss workspace-wide generation bumps, and its key-building primitive.
import { dedupeKey, createDedupeCache } from '../lib/proxy-dedupe.js';
import { commentDedupe, commentDedupeGenerations } from './proxy.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { isTerminalState, isBlocked } from '../lib/tree.js';
import { testMockTeams, testMockData } from '../tests/fixtures/mock-data.js';

/**
 * Whether the AI layer should be mocked for this request (LIN-388).
 *
 * The AI surfaces (recap/brief/recommend/prompt) historically gated their mock
 * on `NODE_ENV==='test' && accessToken==='test-token'`, which conflated TWO
 * mocks: the Linear DATA mock (testMockData) and the OpenRouter AI mock. The
 * provider seam already serves the data layer, so the migration splits the gate:
 * data stays on the narrow `test-token` check (the local provider serves it
 * otherwise), while the AI mock is re-gated here onto BOTH test-token and
 * local-provider sessions. CI has no OpenRouter key, so a migrated local spec
 * still needs the server's deterministic mock to fire.
 *
 * This stays a SUPERSET of the old `test-token` predicate, so legacy specs are
 * unaffected. It deliberately does NOT widen to all test sessions — the 503
 * "AI not configured" tests run on `test-token` with the AI mock active; an
 * unconfigured non-local session must still 503.
 *
 * @param {Object} workspace - req.workspace (carries provider + accessToken)
 * @returns {boolean}
 */
export function shouldMockAi(workspace) {
  return process.env.NODE_ENV === 'test' &&
    (workspace?.accessToken === 'test-token' || workspace?.provider === 'local');
}

/**
 * Send a generated prompt as JSON (default) or as a downloadable markdown
 * file when `?format=md` is set. The markdown branch serves the bare prompt
 * string with attachment headers (Content-Disposition); the in-app `+proxy`
 * block is appended client-side, so it intentionally never appears here.
 * Default JSON behaviour is unchanged for every existing consumer.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Object} opts
 * @param {Object} opts.json - JSON body returned when not downloading
 * @param {string} opts.prompt - Raw prompt string for the markdown download
 * @param {string} opts.identifier - Issue identifier for the filename (may be empty)
 * @param {string} opts.downloadName - Prompt name slug for the filename
 */
function sendPromptResult(req, res, { json, prompt, identifier, downloadName }) {
  if (req.query.format === 'md') {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${buildPromptFilename(identifier, downloadName)}"`);
    return res.send(prompt);
  }
  return res.json(json);
}

/**
 * Generate mock recommendation content for the AI mock (LIN-185, LIN-405).
 *
 * Shared by the streaming and non-streaming recommend endpoints. Kept
 * SHAPE-TOLERANT so it serves BOTH the canonical provider issue (local
 * sessions, post-LIN-405) and the Linear-shaped `testMockData` issue still
 * passed by the `isTestMode` stream / GET blocks. (LIN-413 verdict: those
 * blocks are RETAINED — free-tier.spec still drives the stream on the
 * test-token path and the recommend GET directly, so they are not orphaned.):
 *   - labels arrive either as a plain `['bug']` array or as `{ nodes: [...] }`;
 *   - the identifier is read from `issue.identifier` (canonical urls end in a
 *     UUID, so the historic `url.split('/').pop()` is only a last-ditch fallback).
 * @param {Object} mockIssue - A canonical or Linear-shaped issue.
 * @returns {{ reasoning: string, prompt: string, identifier: string }}
 */
export function generateMockRecommendation(mockIssue) {
  const rawLabels = mockIssue.labels;
  const labels = Array.isArray(rawLabels)
    ? rawLabels
    : (rawLabels?.nodes || []).map(l => l.name);
  let reasoning = 'Start by getting an overview of what this task involves before deciding on the next steps.';
  let goal = 'Summarize what this task involves and how it fits into the broader project context.';

  if (isBlocked(mockIssue)) {
    // LIN-357: blocked-ness is the incomplete blocking relationship, not a label.
    reasoning = 'This task is blocked. Analyzing the blocker will help identify ways to unblock progress.';
    goal = 'Identify the blocker type and root cause, evaluate options to unblock, and recommend the best path.';
  } else if (labels.includes(WORK_ISSUE_LABELS.BUG)) {
    reasoning = 'This is a bug. Investigating the issue systematically will help find the root cause and fix.';
    goal = 'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.';
  } else if (mockIssue.state?.type === 'backlog' || mockIssue.state?.type === 'unstarted') {
    reasoning = 'This task is ready to start. Creating an implementation plan will provide a clear path forward.';
    goal = 'Research the codebase, identify files to modify, and create a step-by-step implementation plan.';
  }

  const identifier = mockIssue.identifier || mockIssue.url?.split('/').pop() || 'ISSUE';

  const prompt = `Help me with task ${identifier}

## Context

**Project:** Test Project
**Status:** ${mockIssue.state?.name || 'Unknown'}
${labels.length > 0 ? `**Labels:** ${labels.join(', ')}` : ''}

## Goal

${goal}`;

  return { reasoning, prompt, identifier };
}

/**
 * Build one mock recommendation hop from provider context for the resolver's
 * `computeOne` (LIN-405). Deterministically mirrors what a single
 * getRecommendation(Stream) call would return so a local (AI-mocked) session
 * drives the SAME `resolveRecommendation` descent the real path uses:
 *   - a parent whose focused child is non-terminal synthesises a `defer` to that
 *     child (passing `children`/`state` through so the resolver's LIN-353
 *     terminal-edge guard can validate the hop), so e.g. TEST-1 → TEST-2 descends;
 *   - a leaf returns a real (non-defer) action carrying the mock prompt.
 * @param {Object} ctx - provider.fetchRecommendationContext result.
 * @returns {Object} A computeOne hop record.
 */
export function buildMockRecommendationHop(ctx) {
  const base = {
    identifier: ctx.issue.identifier,
    truncated: false,
    completionTokens: null,
    issueUrl: ctx.issue.url,
    repo: parseRepoFromDescription(ctx.project?.description),
    state: ctx.issue.state,
    children: ctx.children,
  };
  const focusChild = ctx.focusedChild?.issue;
  if (focusChild) {
    return {
      ...base,
      reasoning: `${ctx.issue.identifier} is a container → routing to ${focusChild.identifier}`,
      prompt: null,
      recommendedAction: 'defer',
      deferTo: focusChild.identifier,
    };
  }
  const { reasoning, prompt } = generateMockRecommendation(ctx.issue);
  return {
    ...base,
    reasoning,
    prompt,
    recommendedAction: 'recommend',
    deferTo: null,
  };
}

// LIN-2208: whether the decision-answer stamp(s) for a given comment-dedupe
// `key` have already succeeded — separate from `commentDedupe` itself (which
// caches the WRITTEN COMMENT and is spread verbatim into the JSON response;
// piggybacking stamp bookkeeping onto that value would leak new fields into
// the wire contract). Same TTL discipline as `commentDedupe`: an entry ages
// out with the comment dedupe window it tracks, so a stamp that never
// succeeds within 5 minutes simply falls out of both caches together, at
// which point a resubmission mints a fresh (unrelated) comment+stamp attempt
// rather than being treated as a retry forever.
const decisionStampDedupe = createDedupeCache();

/**
 * Best-effort decision-answer stamp(s) for a human comment write (LIN-1728
 * decision 1 / LIN-2197 Phase 5) — the loop-backed and task-bound sibling
 * stamps, factored out so the dedupe-hit retry path (LIN-2208) and the
 * fresh-write path share identical stamping logic; they must never drift.
 * Both stamp attempts are independently best-effort (a lone id pair is a
 * malformed/partial client payload, never a half-stamp attempt) and never
 * throw — failure is logged only, mirroring the pre-LIN-2208 inline code.
 *
 * @returns {Promise<boolean>} true iff every REQUESTED stamp (only the pairs
 *   actually present in `decision`) succeeded — the signal LIN-2208's dedupe
 *   bypass uses to decide whether a later identical-text retry still needs to
 *   try again.
 */
async function stampDecisionAnswers(workspace, decision, { dispatchQueueStore, taskDecisionsStore }) {
  const { decisionLoopId, decisionId, taskDecisionId, taskDecisionIssueId } = decision || {};
  let ok = true;

  if (typeof decisionLoopId === 'string' && decisionLoopId && typeof decisionId === 'string' && decisionId) {
    try {
      const stamped = await dispatchQueueStore.markDecisionAnswered(decisionLoopId, workspace.urlKey, decisionId);
      if (!stamped) {
        console.error(`Decision-answer stamp not applied: no matching item ${decisionLoopId} in workspace ${workspace.urlKey}`);
        ok = false;
      }
    } catch (stampErr) {
      console.error('Decision-answer stamp failed:', stampErr.message);
      ok = false;
    }
  }

  if (taskDecisionsStore && typeof taskDecisionId === 'string' && taskDecisionId && typeof taskDecisionIssueId === 'string' && taskDecisionIssueId) {
    try {
      const stamped = await taskDecisionsStore.markOutcome({
        urlKey: workspace.urlKey, issueId: taskDecisionIssueId, id: taskDecisionId, outcome: 'answered'
      });
      if (!stamped) {
        console.error(`Task-decision answer stamp not applied: no matching row ${taskDecisionId} for issue ${taskDecisionIssueId} in workspace ${workspace.urlKey}`);
        ok = false;
      }
    } catch (stampErr) {
      console.error('Task-decision answer stamp failed:', stampErr.message);
      ok = false;
    }
  }

  return ok;
}

/**
 * Create workspace API routes with required dependencies.
 * @param {Object} options
 * @param {Function} options.workspaceFromUrl - Middleware to extract workspace from URL
 * @param {Object} options.freeTierStore - Free tier usage store
 * @param {Function} options.getOpenRouterSource - Helper to determine OpenRouter source
 * @param {Object} [options.taskDecisionsStore] - Task-keyed scan-decision store (LIN-2197)
 * @returns {Router} Express router
 */
export function createWorkspaceApiRoutes({ workspaceFromUrl, freeTierStore, getOpenRouterSource, userPreferencesStore, workspacePreferencesStore, customPromptsStore, recapCacheStore, briefCacheStore, reportHistoryStore, dispatchQueueStore, agentStatusStore, promptTraceStore, proxyTokenStore, taskDecisionsStore, harbourCommentsStore = null }) {
  const router = Router();

  // Prompt-traces + custom-prompts API endpoints (LIN-2246: extracted to
  // workspace-api-prompts.js). Mounted first, at the same relative position
  // the prompt-traces group previously occupied inline; both groups' literal
  // path prefixes (/prompt-traces, /prompts/custom) are disjoint from every
  // other group's, so mount order is not load-bearing here.
  router.use(createPromptsRoutes({ workspaceFromUrl, promptTraceStore, customPromptsStore }));

  // ===========================================================================
  // Audit API
  // ===========================================================================

  /**
   * Audit API endpoint - runs a workspace audit and returns JSON.
   * Requires authentication.
   */
  router.get('/workspace/:urlKey/api/audit', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;

    try {
      // Use mock audit data in test mode. Audit is NOT provider-routed —
      // runAudit() goes straight to GraphQL — so the local provider can't back
      // this surface; instead the deterministic mock gate is widened to fire for
      // local sessions too (LIN-412). This stays a DATA-mock carve-out (its own
      // predicate, NOT shouldMockAi): the semantics are "serve the deterministic
      // audit report", not "mock the AI call". The mock data below is unchanged —
      // the local-seed identity only affects session/workspace resolution.
      if (process.env.NODE_ENV === 'test' &&
          (workspace.accessToken === 'test-token' || workspace.provider === 'local')) {
        const mockAuditData = {
          teams: testMockTeams,
          projects: testMockData.projects.map(p => ({ ...p, state: 'started' })),
          workflowStates: [
            { id: 'ws1', name: 'Backlog', type: 'backlog', team: { id: 'team1', name: 'Test Team' } },
            { id: 'ws2', name: 'In Progress', type: 'started', team: { id: 'team1', name: 'Test Team' } },
            { id: 'ws3', name: 'Done', type: 'completed', team: { id: 'team1', name: 'Test Team' } }
          ],
          labels: [
            { id: 'l1', name: 'breakdown', color: '#000', issues: { nodes: [{ id: 'i1' }] } },
            { id: 'l2', name: 'ready', color: '#000', issues: { nodes: [{ id: 'i2' }, { id: 'i3' }] } },
            { id: 'l3', name: 'bug', color: '#f00', issues: { nodes: [] } }
          ],
          issues: testMockData.issues.map(i => ({
            ...i,
            labels: { nodes: [] }
          }))
        };
        const report = computeAuditFromData(mockAuditData);
        return res.json(report);
      }

      // LIN-1899: the audit is a Linear-SPECIFIC capability — it reads the
      // provider-agnostic scalar mirror `workspace.accessToken` and hands it to
      // a statically Linear-bound GraphQL client (lib/audit.js:180). For a
      // non-Linear active binding that mirror holds THAT provider's credential
      // (a raw Jira API token, say), so the call below discloses it to
      // api.linear.app — and returns a misleading 401 from the catch branch
      // because Linear rejects it. Refuse instead: a capability endpoint with no
      // meaningful non-Linear rendering declines with 422 CAPABILITY_NOT_SUPPORTED
      // (the denyIfUnsupported envelope, routes/proxy.js:750-757), not the 503
      // workspaceUnavailable envelope — a provider mismatch is not transient.
      //
      // Placed AFTER the test-mode mock branch above so the LIN-412 local
      // carve-out keeps firing (tests/e2e/audit.spec.js runs on a genuine
      // `provider: 'local'` seed). Consequence, recorded deliberately: a local
      // workspace is mocked in test but REFUSED in production — today it sends
      // its urlKey to Linear for a fake 401, and 422 is the honest answer.
      // `linear`-only, never `linear` OR `local` (LIN-1891's settled rule); the
      // sibling asset relay withholds the header instead of refusing, because
      // capability endpoints refuse and asset relays degrade (see /api/image).
      if (!isActiveProviderLinear(workspace)) {
        return jsonError(res, 422, `This workspace's provider does not support this`, {
          code: 'CAPABILITY_NOT_SUPPORTED',
          capability: 'audit',
          provider: workspace.provider,
        });
      }

      const report = await runAudit(workspace.accessToken);
      res.json(report);
    } catch (error) {
      console.error('Audit error:', error);

      // Handle 401 from Linear API
      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Token expired or invalid');
      }

      jsonError(res, 500, 'Audit failed', { message: error.message });
    }
  });

  // ===========================================================================
  // Prompt Generation API
  // ===========================================================================

  /**
   * Generate a prompt for a specific issue and label.
   * Returns a prompt that can be copied and used with Claude Code and the workspace API.
   *
   * @route GET /workspace/:urlKey/api/prompt/:issueId/:labelName
   * @param {string} issueId - The Linear issue ID
   * @param {string} labelName - The label name (must have a prompt template)
   * @returns {Object} { label, promptName, prompt } or error
   */
  router.get('/workspace/:urlKey/api/prompt/:issueId/:labelName', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace

    const { issueId, labelName } = req.params

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format')
    }

    // Check if this is a custom prompt request (format: custom:promptId)
    const isCustomPrompt = labelName.startsWith('custom:');

    // Check if label has a prompt template (unless it's a custom prompt)
    if (!isCustomPrompt && !hasPrompt(labelName)) {
      return notFound.json(res, `No prompt template for label: ${labelName}`)
    }

    // Capability-aware prompt generation (LIN-177 S4/S5): thread the active
    // provider's UI surface into prompt generation. Resolved from the workspace
    // (source isn't populated on canonical issues); falls back to Linear for
    // legacy workspaces. For Linear this is a no-op — output stays byte-identical.
    const providerUi = getProviderForWorkspace(workspace)?.ui || null

    try {
      // Use mock data in test mode
      if (process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token') {
        const mockIssue = testMockData.issues.find(i => i.id === issueId)
        if (!mockIssue) {
          return notFound.json(res, 'Issue not found')
        }

        // Extract identifier from URL (e.g., https://linear.app/test/issue/TEST-6 -> TEST-6)
        const identifier = mockIssue.url.split('/').pop()

        // Find project for the mock issue
        const mockProject = testMockData.projects.find(p => p.id === mockIssue.project?.id)

        // Extract labels as array of strings
        const labels = (mockIssue.labels?.nodes || []).map(l => l.name)

        // Find parent issue if exists
        const mockParent = mockIssue.parent
          ? testMockData.issues.find(i => i.id === mockIssue.parent.id)
          : null

        // Find siblings (other children of same parent)
        const mockSiblings = mockParent
          ? testMockData.issues
              .filter(i => i.parent?.id === mockParent.id && i.id !== issueId)
              .slice(0, 5)
              .map(s => ({
                id: s.id,
                identifier: s.url.split('/').pop(),
                title: s.title,
                state: s.state
              }))
          : []

        // Find children of this issue
        const mockChildren = testMockData.issues
          .filter(i => i.parent?.id === issueId)
          .map(c => ({
            id: c.id,
            identifier: c.url.split('/').pop(),
            title: c.title,
            state: c.state
          }))

        const mockContext = {
          parent: mockParent ? {
            id: mockParent.id,
            identifier: mockParent.url.split('/').pop(),
            title: mockParent.title,
            state: mockParent.state
          } : null,
          siblings: mockSiblings,
          project: mockProject ? { name: mockProject.name, description: mockProject.content } : null,
          children: mockChildren
        };

        const issueObj = { ...mockIssue, identifier, labels };
        let result;

        if (isCustomPrompt) {
          const customPromptId = labelName.slice('custom:'.length);
          const customPromptDef = await customPromptsStore.get(req.workspace.urlKey, customPromptId);
          if (!customPromptDef) {
            return notFound.json(res, 'Custom prompt not found');
          }
          result = generateCustomPrompt(customPromptDef, issueObj, mockContext, getFeatureFlags(req.session), providerUi);
        } else {
          result = generatePrompt(labelName, issueObj, mockContext, getFeatureFlags(req.session), providerUi);
        }

        const mockProjectDescription = mockProject?.content || null
        return sendPromptResult(req, res, {
          identifier,
          downloadName: result.name,
          prompt: result.prompt,
          json: {
            label: labelName,
            promptName: result.name,
            prompt: result.prompt,
            repo: parseRepoFromDescription(mockProjectDescription)
          }
        })
      }

      // LIN-1904: resolve the issue's OWN binding (per the `source` provenance
      // stamp LIN-561 puts on every merged-tree row, LIN-544) rather than
      // always the workspace's active provider — same fix as /api/detail
      // (LIN-1903), same helper.
      const requestedSource = typeof req.query.source === 'string' ? req.query.source : null
      const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource)
      const { issue, parent, siblings, project, children, comments, attachments } = await issueProvider.fetchIssueContext(issueCallScope, issueId)

      // Generate the prompt
      let result;
      if (isCustomPrompt) {
        const customPromptId = labelName.slice('custom:'.length);
        const customPromptDef = await customPromptsStore.get(req.workspace.urlKey, customPromptId);
        if (!customPromptDef) {
          return notFound.json(res, 'Custom prompt not found');
        }
        // NOTE: generateCustomPrompt renders no Attachments section (variable
        // substitution only) — passing `attachments` would be a no-op, so it's left
        // out here; that's a separate pre-existing gap, not part of LIN-776.
        result = generateCustomPrompt(customPromptDef, issue, { parent, siblings, project, children, comments }, getFeatureFlags(req.session), providerUi);
      } else {
        // Forward `attachments` (LIN-776) so the in-app /prompt endpoint surfaces the
        // worker-facing Attachments section, matching the proxy /prompt route.
        result = generatePrompt(labelName, issue, { parent, siblings, project, children, comments, attachments }, getFeatureFlags(req.session), providerUi);
      }

      if (!result) {
        return jsonError(res, 500, 'Failed to generate prompt')
      }

      sendPromptResult(req, res, {
        identifier: issue.identifier,
        downloadName: result.name,
        prompt: result.prompt,
        json: {
          label: labelName,
          promptName: result.name,
          prompt: result.prompt,
          repo: parseRepoFromDescription(project?.description)
        }
      })
    } catch (error) {
      console.error('Prompt generation error:', error)

      // Handle 401 from Linear API
      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Token expired or invalid')
      }

      // Handle issue not found
      if (error.message?.includes('not found')) {
        return notFound.json(res, error.message)
      }

      jsonError(res, 500, 'Failed to generate prompt', { message: error.message })
    }
  })

  /**
   * Generate an Autopilot kickoff prompt scoped to a specific issue — the
   * "run on autopilot until this task is done" instruction. Autopilot is a
   * light orchestrator that dispatches the actual work to a separate worker;
   * dispatching this prompt to `web` lets the user sit back and watch the loop.
   *
   * The general (stack-walk) kickoff is served at the issueless route below and
   * at /api/proxy/autopilot/kickoff for external agents.
   *
   * Gated on the proxy feature flag — the kickoff drives the
   * proxy API exclusively. Optional `?mode=readonly` restricts the run to
   * investigation/research prompts; default is write (merge-gated).
   *
   * @route GET /workspace/:urlKey/api/autopilot-prompt/:issueId
   * @param {string} issueId - The Linear issue ID (UUID)
   * @returns {Object} { label, promptName, kind, prompt, repo } or error
   */
  router.get('/workspace/:urlKey/api/autopilot-prompt/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace
    const { issueId } = req.params

    const featureFlags = getFeatureFlags(req.session)
    if (featureFlags.proxy !== true) {
      return jsonError(res, 403, 'Proxy feature is not enabled')
    }

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format')
    }

    const mode = AUTOPILOT_MODES.includes(req.query.mode) ? req.query.mode : AUTOPILOT_MODE_DEFAULT
    // LIN-836: surface the stepper variant in the UI. Validate against the shared
    // list (unknown/absent → standard), thread it into the kickoff body, and let
    // ONLY the stepper branch change label/promptName/downloadName — the standard
    // strings stay byte-identical to preserve the LIN-791 additive invariant.
    const variant = AUTOPILOT_VARIANTS.includes(req.query.variant) ? req.query.variant : AUTOPILOT_VARIANT_DEFAULT
    const stepper = variant === 'stepper'
    const baseUrl = `${req.protocol}://${req.get('host')}`

    try {
      // Use mock data in test mode
      if (process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token') {
        const mockIssue = testMockData.issues.find(i => i.id === issueId)
        if (!mockIssue) {
          return notFound.json(res, 'Issue not found')
        }
        const identifier = mockIssue.url?.split('/').pop() || ''
        const mockProject = testMockData.projects.find(p => p.id === mockIssue.project?.id)
        const prompt = buildAutopilotKickoff({
          baseUrl,
          issue: { identifier, title: mockIssue.title },
          mode,
          variant,
          standalone: true
        })
        return sendPromptResult(req, res, {
          identifier,
          downloadName: stepper ? 'autopilot-stepper' : 'autopilot',
          prompt,
          json: {
            label: stepper ? 'autopilot-stepper' : 'autopilot',
            promptName: stepper ? `Autopilot (stepped) — ${identifier}` : `Autopilot — ${identifier}`,
            kind: 'autopilot',
            prompt,
            repo: parseRepoFromDescription(mockProject?.content || null)
          }
        })
      }

      // LIN-1904: resolve the issue's own binding via `source`, same as /api/prompt.
      const requestedSource = typeof req.query.source === 'string' ? req.query.source : null
      const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource)
      const { issue, project } = await issueProvider.fetchIssueContext(issueCallScope, issueId)
      const prompt = buildAutopilotKickoff({
        baseUrl,
        issue: { identifier: issue.identifier, title: issue.title },
        mode,
        variant,
        standalone: true
      })
      sendPromptResult(req, res, {
        identifier: issue.identifier,
        downloadName: stepper ? 'autopilot-stepper' : 'autopilot',
        prompt,
        json: {
          label: stepper ? 'autopilot-stepper' : 'autopilot',
          promptName: stepper ? `Autopilot (stepped) — ${issue.identifier}` : `Autopilot — ${issue.identifier}`,
          kind: 'autopilot',
          prompt,
          repo: parseRepoFromDescription(project?.description)
        }
      })
    } catch (error) {
      console.error('Autopilot prompt error:', error)
      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Token expired or invalid')
      }
      if (error.message?.includes('not found')) {
        return notFound.json(res, error.message)
      }
      jsonError(res, 500, 'Failed to generate autopilot prompt', { message: error.message })
    }
  })

  /**
   * Generate a general (stack-walking) Autopilot kickoff — no issue scope.
   * Autopilot orients off `GET /stack` under the precedence policy and works the
   * backlog until it needs the human. Optional `?goal=` supplies a free-text
   * focus; `?mode=readonly` restricts to investigation/research prompts.
   *
   * @route GET /workspace/:urlKey/api/autopilot-prompt
   * @returns {Object} { label, promptName, kind, prompt } or error
   */
  router.get('/workspace/:urlKey/api/autopilot-prompt', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session)
    if (featureFlags.proxy !== true) {
      return jsonError(res, 403, 'Proxy feature is not enabled')
    }

    const mode = AUTOPILOT_MODES.includes(req.query.mode) ? req.query.mode : AUTOPILOT_MODE_DEFAULT
    // LIN-836: same variant wiring as the issue-scoped twin above (stepper only
    // changes the response strings; standard stays byte-identical).
    const variant = AUTOPILOT_VARIANTS.includes(req.query.variant) ? req.query.variant : AUTOPILOT_VARIANT_DEFAULT
    const stepper = variant === 'stepper'
    const goal = typeof req.query.goal === 'string' ? req.query.goal.slice(0, 1000) : ''
    const baseUrl = `${req.protocol}://${req.get('host')}`

    // Task budget (LIN-1737 D3/Beat 1 seam #3): an optional scope bound threaded
    // into the kickoff so its prose states it, then forwarded by the client to
    // POST /api/dispatch where it is actually enforced (LIN-1751). Query params
    // are always strings, so blank/whitespace-only is treated as ABSENT, not an
    // error — distinct from the JSON-body validation at the dispatch route,
    // which has no such "blank" case to account for. A non-blank value follows
    // the same integer->=1 rule and error text as every other maxTasks entry point.
    let maxTasks = null
    if (typeof req.query.maxTasks === 'string' && req.query.maxTasks.trim() !== '') {
      const parsedMaxTasks = Number(req.query.maxTasks.trim())
      if (!Number.isInteger(parsedMaxTasks) || parsedMaxTasks < 1) {
        return badRequest.json(res, 'maxTasks must be an integer >= 1')
      }
      maxTasks = parsedMaxTasks
    }

    try {
      const prompt = buildAutopilotKickoff({ baseUrl, goal, mode, variant, standalone: true, maxTasks })
      sendPromptResult(req, res, {
        identifier: '',
        downloadName: stepper ? 'autopilot-stepper' : 'autopilot',
        prompt,
        json: {
          label: stepper ? 'autopilot-stepper' : 'autopilot',
          promptName: stepper
            ? (goal.trim() ? `Autopilot (stepped) — ${goal.trim().slice(0, 60)}` : 'Autopilot (stepped, stack walk)')
            : (goal.trim() ? `Autopilot — ${goal.trim().slice(0, 60)}` : 'Autopilot (stack walk)'),
          kind: 'autopilot',
          prompt
        }
      })
    } catch (error) {
      console.error('Autopilot kickoff error:', error)
      jsonError(res, 500, 'Failed to generate autopilot kickoff', { message: error.message })
    }
  })

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
    const workspace = req.workspace

    // In test mode, always report as enabled for testing
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'
    const sessionApiKey = req.session.openRouterApiKey
    const source = getOpenRouterSource(req)

    const enabled = isTestMode || isRecommendationEnabled(sessionApiKey) || source === 'free'

    // Resolve the workspace's configured LLM model so the footer can surface it.
    // Same single-source-of-truth helper every LLM call site uses.
    const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recommend' })

    const result = { enabled, source, model, modelName: getModelDisplayName(model) }

    // Include free tier usage info when applicable
    if (source === 'free') {
      const usage = await freeTierStore.getUsage(workspace.urlKey)
      result.freeTier = usage
    }

    res.json(result)
  })

  /**
   * Get AI-generated prompt for a task.
   * Analyzes task context and generates a tailored prompt.
   *
   * @route GET /workspace/:urlKey/api/recommend/:issueId
   * @param {string} issueId - The Linear issue ID
   * @returns {Object} { reasoning, prompt } or error
   */
  router.get('/workspace/:urlKey/api/recommend/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace

    const { issueId } = req.params
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource)

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format')
    }

    // Capability backstop — clean 422 (never a raw NotImplementedError) for a
    // provider that never implements recommendation context (LIN-1910).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return jsonError(res, 422, "This workspace's provider does not support recommendations for this issue", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
      })
    }

    // Check if feature is enabled (except in test mode)
    // `isTestMode` (test-token) gates the DATA mock; `mockAi` additionally fires
    // the AI mock for local-provider sessions, whose data comes from the provider
    // (LIN-388/LIN-405). The 503/free-tier guards key off `mockAi` so a migrated
    // local session isn't 503'd for lacking an OpenRouter key.
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'
    const mockAi = shouldMockAi(workspace)
    const sessionApiKey = req.session.openRouterApiKey
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey
    // Free-tier on the AI-mock path is the session flag (CI sets no env key, so
    // `isFreeTier` is always false there); the test-token DATA mock charges its
    // own inside the isTestMode block below, so this is scoped to !isTestMode.
    const testIsFreeTier = req.session.freeTierEnabled && !sessionApiKey && !hasPaidEnvKey()
    const surfaceFreeTier = !isTestMode && (mockAi ? testIsFreeTier : isFreeTier)
    if (!mockAi && !isRecommendationEnabled(sessionApiKey) && !freeTierKey) {
      return jsonError(res, 503, 'AI recommendation feature is not configured. Connect your OpenRouter account or set OPENROUTER_API_KEY.')
    }

    // Atomically check rate limits and record usage before proceeding
    if (surfaceFreeTier) {
      const check = await freeTierStore.tryUse(workspace.urlKey)
      if (!check.allowed) {
        return jsonError(res, 429, check.reason, { freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } })
      }
    }

    // Linear + OpenRouter can exceed Heroku's 30s router cap (H12). Arm a
    // whitespace keepalive around the slow path.
    const keepalive = armKeepalive(res);
    try {
      // Use mock data in test mode
      if (isTestMode) {
        const mockIssue = testMockData.issues.find(i => i.id === issueId)
        if (!mockIssue) {
          keepalive.stop();
          return keepalive.send(404, { error: 'Issue not found' })
        }

        // Atomically check free tier limits and record usage in test mode
        const testIsFreeTier = req.session.freeTierEnabled && !req.session.openRouterApiKey && !hasPaidEnvKey()
        if (testIsFreeTier) {
          const check = await freeTierStore.tryUse(workspace.urlKey)
          if (!check.allowed) {
            keepalive.stop();
            return keepalive.send(429, {
              error: check.reason,
              freeTier: {
                used: true,
                remaining: check.remaining,
                limit: check.limit,
                resetsAt: check.resetsAt
              }
            })
          }
        }

        // Generate a mock prompt based on the issue
        const labels = (mockIssue.labels?.nodes || []).map(l => l.name)
        let reasoning = 'Start by getting an overview of what this task involves before deciding on the next steps.'
        let goal = 'Summarize what this task involves and how it fits into the broader project context.'

        // Provide contextual mock prompts based on blocking relationship / labels
        if (isBlocked(mockIssue)) {
          // LIN-357: blocked-ness is the incomplete blocking relationship, not a label.
          reasoning = 'This task is blocked. Analyzing the blocker will help identify ways to unblock progress.'
          goal = 'Identify the blocker type and root cause, evaluate options to unblock, and recommend the best path.'
        } else if (labels.includes(WORK_ISSUE_LABELS.BUG)) {
          reasoning = 'This is a bug. Investigating the issue systematically will help find the root cause and fix.'
          goal = 'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.'
        } else if (mockIssue.state?.type === 'backlog' || mockIssue.state?.type === 'unstarted') {
          reasoning = 'This task is ready to start. Creating an implementation plan will provide a clear path forward.'
          goal = 'Research the codebase, identify files to modify, and create a step-by-step implementation plan.'
        }

        // Build the mock prompt
        // Extract identifier from URL (e.g., "https://linear.app/test/issue/TEST-6" -> "TEST-6")
        const identifier = mockIssue.url?.split('/').pop() || 'ISSUE'

        const prompt = `Help me with task ${identifier}

## Context

**Project:** Test Project
**Status:** ${mockIssue.state?.name || 'Unknown'}
${labels.length > 0 ? `**Labels:** ${labels.join(', ')}` : ''}

## Goal

${goal}`

        const mockRecommendProject = testMockData.projects.find(p => p.id === mockIssue.project?.id)
        const result = {
          reasoning,
          prompt,
          truncated: false,
          completionTokens: null,
          issueUrl: mockIssue.url,
          repo: parseRepoFromDescription(mockRecommendProject?.content)
        }

        // Include free tier metadata in test mode
        if (testIsFreeTier) {
          const usage = await freeTierStore.getUsage(workspace.urlKey)
          result.freeTier = {
            used: true,
            remaining: usage.remaining,
            limit: usage.limit,
            resetsAt: usage.resetsAt
          }
        }

        keepalive.stop();
        return keepalive.send(200, result)
      }

      // Get AI-generated prompt, following any `defer` decisions to a terminal
      // actionable node (LIN-329). A leaf resolves in one hop; a parent the human
      // pinned is transparently resolved to its actionable descendant, with the
      // descent breadcrumb returned. Free-tier usage is charged once per request
      // (above, before this point), not per hop.
      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recommend', forceDefault: isFreeTier })
      const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined)
      const { recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
        startIdentifier: issueId,
        deadline: Date.now() + RECOMMEND_DESCENT_BUDGET_MS,
        computeOne: async (id) => {
          // Two-tier context for parent tasks; the focused child seeds the defer choice.
          const ctx = await issueProvider.fetchRecommendationContext(issueCallScope, id)
          // AI mock (local session): synthesise the hop deterministically so the
          // SAME resolver drives the descent without an OpenRouter call (LIN-405).
          if (mockAi) return buildMockRecommendationHop(ctx)
          const r = await getRecommendation(
            ctx.issue,
            // Forward `attachments` (LIN-777) so the meta-prompt surfaces the
            // worker-facing ## Attachments section on this LLM recommendation hop.
            { parent: ctx.parent, siblings: ctx.siblings, project: ctx.project, children: ctx.children, comments: ctx.comments, focusedChild: ctx.focusedChild, attachments: ctx.attachments },
            { apiKey: apiKeyToUse, model: selectedModel, featureFlags: getFeatureFlags(req.session), providerUi: issueProvider.ui || null,
              callMeta: { urlKey: workspace.urlKey, feature: 'recommend', issueIdentifier: ctx.issue.identifier } }
          )
          return {
            identifier: ctx.issue.identifier,
            reasoning: r.reasoning,
            prompt: r.prompt,
            truncated: r.truncated,
            completionTokens: r.completionTokens,
            recommendedAction: r.recommendedAction,
            deferTo: r.deferTo,
            issueUrl: ctx.issue.url,
            repo: parseRepoFromDescription(ctx.project?.description),
            // Node state + children (with state) feed the resolver's terminal-state
            // descent guard (LIN-353) — already fetched in ctx, no extra round-trip.
            state: ctx.issue.state,
            children: ctx.children
          }
        }
      })

      const result = {
        reasoning: rec.reasoning,
        prompt: rec.prompt,
        truncated: rec.truncated,
        completionTokens: rec.completionTokens,
        issueUrl: rec.issueUrl,
        repo: rec.repo,
        // Terminal identifier + descent breadcrumb (LIN-327, additive).
        identifier: rec.identifier,
        deferredVia,
        deferTruncated,
        deferStopReason
      }

      // Include free tier metadata
      if (surfaceFreeTier) {
        const usage = await freeTierStore.getUsage(workspace.urlKey)
        result.freeTier = {
          used: true,
          remaining: usage.remaining,
          limit: usage.limit,
          resetsAt: usage.resetsAt
        }
      }

      keepalive.stop();
      keepalive.send(200, result)
    } catch (error) {
      keepalive.stop();
      console.error('Recommendation error:', error)

      if (error.response?.status === 401) {
        return keepalive.send(401, { error: 'Token expired or invalid' })
      }
      if (error.message?.includes('not found')) {
        return keepalive.send(404, { error: error.message })
      }
      if (error.message?.includes('OpenRouter')) {
        return keepalive.send(503, { error: 'AI service temporarily unavailable', message: error.message })
      }
      keepalive.send(500, { error: 'Failed to get recommendation', message: error.message })
    }
  })

  // ===========================================================================
  // AI Recommendation Streaming API (SSE)
  // ===========================================================================

  /**
   * Helper: write an SSE event to the response.
   * @param {Object} res - Express response
   * @param {string} type - Event type
   * @param {Object} data - Event data (will be JSON-stringified)
   */
  function sendSSE(res, type, data) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

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
    const workspace = req.workspace;
    const { issueId } = req.params;
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource);

    // --- Pre-flight validation (regular HTTP errors) ---

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }

    // Capability backstop — clean 422 (never a raw NotImplementedError) for a
    // provider that never implements recommendation context (LIN-1910).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return jsonError(res, 422, "This workspace's provider does not support recommendations for this issue", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
      });
    }

    // See the GET handler: `isTestMode` gates the DATA mock; `mockAi` fires the
    // AI mock for local sessions; 503/free-tier guards key off `mockAi` (LIN-405).
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const mockAi = shouldMockAi(workspace);
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;
    const testIsFreeTier = req.session.freeTierEnabled && !sessionApiKey && !hasPaidEnvKey();
    const surfaceFreeTier = !isTestMode && (mockAi ? testIsFreeTier : isFreeTier);

    if (!mockAi && !isRecommendationEnabled(sessionApiKey) && !freeTierKey) {
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
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return jsonError(res, 429, check.reason, { freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } });
      }
    }

    // --- Test mode: mock streaming ---

    if (isTestMode) {
      const mockIssue = testMockData.issues.find(i => i.id === issueId);
      if (!mockIssue) {
        return notFound.json(res, 'Issue not found');
      }

      // Free tier check in test mode
      const testIsFreeTier = req.session.freeTierEnabled && !req.session.openRouterApiKey && !hasPaidEnvKey();
      if (testIsFreeTier) {
        const check = await freeTierStore.tryUse(workspace.urlKey);
        if (!check.allowed) {
          return jsonError(res, 429, check.reason, { freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } });
        }
      }

      const idOf = (iss) => iss.url?.split('/').pop() || iss.identifier;
      const incompleteChild = (iss) => testMockData.issues.find(
        i => i.parent?.id === iss.id && i.state?.type !== 'completed' && i.state?.type !== 'canceled'
      );

      // Node-shaped mock issue (LIN-327): mirror the live node path — stream a
      // descent breadcrumb for each container, then the terminal child's mock
      // recommendation. Keeps the descent-streaming behaviour E2E-covered.
      if (incompleteChild(mockIssue)) {
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.flushHeaders();
        sendSSE(res, 'phase', { phase: 'reasoning' });

        const path = [];
        const seen = new Set();
        let node = mockIssue;
        while (node && !seen.has(node.id) && path.length < 10) {
          seen.add(node.id);
          path.push(node);
          node = incompleteChild(node);
        }
        const terminal = path[path.length - 1];
        const deferredVia = path.map(idOf);
        for (let k = 0; k < path.length - 1; k++) {
          sendSSE(res, 'delta', { section: 'reasoning', content: `\n\n↳ ${idOf(path[k])} is a container → routing to ${idOf(path[k + 1])}\n\n` });
        }
        const term = generateMockRecommendation(terminal);
        const termProject = testMockData.projects.find(p => p.id === terminal.project?.id);
        sendSSE(res, 'delta', { section: 'reasoning', content: term.reasoning });
        sendSSE(res, 'phase', { phase: 'prompt' });
        sendSSE(res, 'delta', { section: 'prompt', content: term.prompt });
        const doneData = {
          truncated: false, completionTokens: null,
          issueUrl: terminal.url, repo: parseRepoFromDescription(termProject?.content),
          identifier: idOf(terminal), deferredVia, deferTruncated: false
        };
        if (testIsFreeTier) {
          const usage = await freeTierStore.getUsage(workspace.urlKey);
          doneData.freeTier = { used: true, remaining: usage.remaining, limit: usage.limit, resetsAt: usage.resetsAt };
        }
        sendSSE(res, 'done', doneData);
        res.end();
        return;
      }

      const { reasoning, prompt } = generateMockRecommendation(mockIssue);
      const mockProject = testMockData.projects.find(p => p.id === mockIssue.project?.id);

      // Start SSE
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.flushHeaders();

      // Emit phases and deltas
      sendSSE(res, 'phase', { phase: 'fetching_context' });

      // Split into multiple chunks to test assembly
      sendSSE(res, 'phase', { phase: 'reasoning' });
      const reasoningMid = Math.floor(reasoning.length / 2);
      sendSSE(res, 'delta', { section: 'reasoning', content: reasoning.slice(0, reasoningMid) });
      sendSSE(res, 'delta', { section: 'reasoning', content: reasoning.slice(reasoningMid) });

      sendSSE(res, 'phase', { phase: 'prompt' });
      const promptMid = Math.floor(prompt.length / 2);
      sendSSE(res, 'delta', { section: 'prompt', content: prompt.slice(0, promptMid) });
      sendSSE(res, 'delta', { section: 'prompt', content: prompt.slice(promptMid) });

      // Done event with metadata
      const doneData = {
        truncated: false,
        completionTokens: null,
        issueUrl: mockIssue.url,
        repo: parseRepoFromDescription(mockProject?.content)
      };

      if (testIsFreeTier) {
        const usage = await freeTierStore.getUsage(workspace.urlKey);
        doneData.freeTier = {
          used: true,
          remaining: usage.remaining,
          limit: usage.limit,
          resetsAt: usage.resetsAt
        };
      }

      sendSSE(res, 'done', doneData);
      res.end();
      return;
    }

    // --- Production mode: real streaming ---

    // Start SSE
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();

    // Track client disconnection
    const abortController = new AbortController();
    let closed = false;
    req.on('close', () => {
      closed = true;
      abortController.abort();
    });

    try {
      // Phase 1: Fetch context from Linear
      sendSSE(res, 'phase', { phase: 'fetching_context' });
      // Gap #1 (LIN-346): bound this fetch by the client-disconnect signal ∪ a
      // per-fetch timeout so a stalled Linear call can't silently idle the socket.
      const context = await issueProvider.fetchRecommendationContext(
        issueCallScope,
        issueId,
        { signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(CONTEXT_FETCH_TIMEOUT_MS)]) }
      );
      const { issue, parent, siblings, project, children, comments, focusedChild, attachments } = context;

      if (closed) return;

      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recommend', forceDefault: isFreeTier });
      const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined);

      // Node-shaped tasks (LIN-327): the first hop is a `defer` with no prompt body,
      // which can't be token-streamed. We resolve the descent and surface it LIVE —
      // each defer hop streams a breadcrumb into the reasoning section as it routes,
      // so the UI shows progress instead of sitting on "fetching" — then the terminal
      // node's reasoning and prompt are delivered (only the terminal hop has a prompt).
      // Leaf tasks fall through to true token streaming below — the common path is unchanged.
      if (children?.length > 0) {
        // Unhide the reasoning section up front so the descent breadcrumbs render live.
        sendSSE(res, 'phase', { phase: 'reasoning' });

        // Option B (LIN-346): stream EVERY hop — including the terminal one — instead
        // of buffering the terminal getRecommendation() and only writing its reasoning
        // and prompt after up to 8000 tokens. Each hop's getRecommendationStream emits
        // phase/delta events that we forward straight to the client, so the socket stays
        // warm on every hop and Heroku H15 can't fire on an all-complete parent that
        // recommends real work at hop 0. The streaming fn's structured return drives the
        // descent (defer parsing stays byte-identical — it routes through the same
        // parseRecommendationResponse as the buffered path).
        const deadline = Date.now() + RECOMMEND_DESCENT_BUDGET_MS;
        const { recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
          startIdentifier: issueId,
          deadline,
          onHop: (hop) => {
            // Stream a breadcrumb for each container we route through (LIN-329).
            if (closed || !(hop.recommendedAction === 'defer' && hop.deferTo)) return;
            // Wrap the breadcrumb in blank lines so it renders as its own paragraph
            // between the deferring hop's reasoning and the next hop's — otherwise the
            // descent runs on into the surrounding reasoning text.
            sendSSE(res, 'delta', { section: 'reasoning', content: `\n\n↳ ${hop.identifier} is a container → routing to ${hop.deferTo}\n\n` });
          },
          computeOne: async (id) => {
            // Per-hop in-flight guard (gap #3): client-disconnect ∪ remaining descent
            // budget. Released on settle so its timer can't leak into the next hop.
            const hop = armHopSignal({ clientSignal: abortController.signal, deadline });
            try {
              // Gap #1: bound the per-hop Linear fetch by the hop signal ∪ a per-fetch timeout.
              const ctx = await issueProvider.fetchRecommendationContext(
                issueCallScope,
                id,
                { signal: AbortSignal.any([hop.signal, AbortSignal.timeout(CONTEXT_FETCH_TIMEOUT_MS)]) }
              );
              // AI mock (local session): synthesise the hop; the terminal hop streams
              // its reasoning+prompt deltas (mirroring getRecommendationStream), while a
              // defer hop streams nothing here — its breadcrumb comes from onHop (LIN-405).
              if (mockAi) {
                const mockHop = buildMockRecommendationHop(ctx);
                if (!closed && mockHop.recommendedAction !== 'defer') {
                  sendSSE(res, 'phase', { phase: 'reasoning' });
                  sendSSE(res, 'delta', { section: 'reasoning', content: mockHop.reasoning });
                  sendSSE(res, 'phase', { phase: 'prompt' });
                  sendSSE(res, 'delta', { section: 'prompt', content: mockHop.prompt });
                }
                return mockHop;
              }
              const r = await getRecommendationStream(
                ctx.issue,
                // Forward `attachments` (LIN-777) so the streamed meta-prompt surfaces
                // the worker-facing ## Attachments section on each descent hop.
                { parent: ctx.parent, siblings: ctx.siblings, project: ctx.project, children: ctx.children, comments: ctx.comments, focusedChild: ctx.focusedChild, attachments: ctx.attachments },
                { apiKey: apiKeyToUse, model: selectedModel, featureFlags: getFeatureFlags(req.session), providerUi: issueProvider.ui || null, signal: hop.signal,
                  callMeta: { urlKey: workspace.urlKey, feature: 'recommend', issueIdentifier: ctx.issue.identifier } },
                (type, data) => {
                  if (closed) return;
                  // Forward phase + delta live; swallow the per-hop done — the handler
                  // emits the single final done with descent metadata after the descent.
                  if (type === 'done') return;
                  sendSSE(res, type, data);
                }
              );
              return {
                identifier: ctx.issue.identifier, reasoning: r.reasoning, prompt: r.prompt,
                truncated: r.truncated, completionTokens: r.completionTokens,
                recommendedAction: r.recommendedAction, deferTo: r.deferTo,
                issueUrl: ctx.issue.url, repo: parseRepoFromDescription(ctx.project?.description),
                // Node state + children (with state) feed the resolver's terminal-state
                // descent guard (LIN-353) — already in ctx, no extra round-trip.
                state: ctx.issue.state, children: ctx.children
              };
            } finally {
              hop.release();
            }
          }
        });
        if (closed) return;

        const metadata = { issueUrl: rec.issueUrl, repo: rec.repo, identifier: rec.identifier, deferredVia, deferTruncated, deferStopReason };
        if (surfaceFreeTier) {
          const usage = await freeTierStore.getUsage(workspace.urlKey);
          metadata.freeTier = { used: true, remaining: usage.remaining, limit: usage.limit, resetsAt: usage.resetsAt };
        }

        if (rec.recommendedAction === 'defer' || !rec.prompt) {
          // Abnormal stop (depth/cycle/unresolved/timeout) — surface, don't ship a defer.
          // The terminal hop's reasoning already streamed live before we got here.
          sendSSE(res, 'error', { error: 'Recommendation did not resolve to an actionable task', deferredVia, deferTruncated, deferStopReason });
        } else {
          // Reasoning and prompt already streamed live per hop above; just close out
          // with the single final done carrying descent + truncation metadata.
          sendSSE(res, 'done', { truncated: rec.truncated, completionTokens: rec.completionTokens, ...metadata });
        }
        res.end();
        return;
      }

      // Phase 2: Stream AI recommendation (leaf task — true token streaming)

      // Build metadata to merge into the done event
      const metadata = {
        issueUrl: issue.url,
        repo: parseRepoFromDescription(project?.description)
      };

      if (surfaceFreeTier) {
        const usage = await freeTierStore.getUsage(workspace.urlKey);
        metadata.freeTier = {
          used: true,
          remaining: usage.remaining,
          limit: usage.limit,
          resetsAt: usage.resetsAt
        };
      }

      // AI mock (local session) leaf fast-path: emit the same SSE phase/delta/done
      // sequence the real token stream would, split into 2 chunks per section so
      // the multi-chunk assembly assertions hold (LIN-405). The leaf TEST-11 reaches
      // here (children=[]), so mocking only the descent computeOne would miss it.
      if (mockAi) {
        const { reasoning, prompt } = generateMockRecommendation(issue);
        sendSSE(res, 'phase', { phase: 'reasoning' });
        const reasoningMid = Math.floor(reasoning.length / 2);
        sendSSE(res, 'delta', { section: 'reasoning', content: reasoning.slice(0, reasoningMid) });
        sendSSE(res, 'delta', { section: 'reasoning', content: reasoning.slice(reasoningMid) });
        sendSSE(res, 'phase', { phase: 'prompt' });
        const promptMid = Math.floor(prompt.length / 2);
        sendSSE(res, 'delta', { section: 'prompt', content: prompt.slice(0, promptMid) });
        sendSSE(res, 'delta', { section: 'prompt', content: prompt.slice(promptMid) });
        sendSSE(res, 'done', { truncated: false, completionTokens: null, ...metadata });
      } else {
        await getRecommendationStream(
          issue,
          // Forward `attachments` (LIN-777) so the streamed terminal-hop meta-prompt
          // surfaces the worker-facing ## Attachments section, matching the proxy
          // recommendation path. fetchRecommendationContext carries it (LIN-772/773).
          { parent, siblings, project, children, comments, focusedChild, attachments },
          {
            apiKey: apiKeyToUse,
            model: selectedModel,
            featureFlags: getFeatureFlags(req.session),
            providerUi: issueProvider.ui || null,
            signal: abortController.signal,
            callMeta: { urlKey: workspace.urlKey, feature: 'recommend', issueIdentifier: issue.identifier }
          },
          (type, data) => {
            if (closed) return;
            // Merge metadata into the done event so all data arrives in one event
            if (type === 'done') {
              sendSSE(res, 'done', { ...data, ...metadata });
            } else {
              sendSSE(res, type, data);
            }
          }
        );
      }
    } catch (error) {
      if (closed) return;
      console.error('Streaming recommendation error:', error);
      sendSSE(res, 'error', { error: error.message });
    } finally {
      if (!closed) res.end();
    }
  });

  // ===========================================================================
  // Comments API
  // ===========================================================================

  /**
   * Fetch comments for a specific issue.
   * LIN-156: Lightweight endpoint for fetching issue comments.
   *
   * @route GET /workspace/:urlKey/api/comments/:issueId
   * @param {string} issueId - The Linear issue ID
   * @returns {Object} { comments: Array<{id, body, createdAt, user}> }
   */
  router.get('/workspace/:urlKey/api/comments/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace
    const { issueId } = req.params

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format')
    }

    try {
      // The detail-surface comments path is fully provider-backed: the dashboard
      // (interactions.spec) reads comments through the local provider and no
      // test-token spec reaches this endpoint, so the old `testMockData` data-mock
      // branch was orphaned and removed (LIN-413). Linear + local both serve here.
      // LIN-1904: resolve the issue's own binding via `source`, same as /api/detail.
      const requestedSource = typeof req.query.source === 'string' ? req.query.source : null
      const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource)
      const comments = await issueProvider.fetchIssueComments(issueCallScope, issueId)
      res.json({ comments })
    } catch (error) {
      console.error('Comments fetch error:', error)

      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Token expired or invalid')
      }

      if (error.message?.includes('not found')) {
        return notFound.json(res, error.message)
      }

      jsonError(res, 500, 'Failed to fetch comments', { message: error.message })
    }
  })

  /**
   * Add a human comment to an issue (LIN-2154) — the session-auth twin of the
   * agent-lane `POST /api/proxy/issues/:issueId/comments` (routes/proxy.js).
   * The durable sink for a "save"/"save and continue" ruling response from the
   * session reply box: the operator's answer lands as a comment on the task,
   * independent of (and, from the client, sequenced before) the existing
   * follow-up dispatch.
   *
   * V1 tenancy note: `resolveIssueBinding(workspace, req.query.source)` below
   * is the same defensive shape the paired GET above and the issues PATCH
   * already use. The reply-box client sends no `?source=` (removed — see
   * public/session.js), so on a workspace holding more than one binding of
   * the same provider this resolves to the workspace's ACTIVE binding, which
   * may not be the one the displayed issue actually lives in. Accepted as a
   * named V1 limitation; LIN-2188 owns closing that gap.
   *
   * @route POST /workspace/:urlKey/api/comments/:issueId
   * Body: { body: string, decisionLoopId?: string, decisionId?: string, taskDecisionId?: string, taskDecisionIssueId?: string }
   * @returns 201 { success: true, comment } | 200 { success: true, comment, deduped: true }
   *
   * LIN-1728 Phase 2: an optional `{decisionLoopId, decisionId}` pair, both
   * required together, threaded from the reply box's `data-decision-id`
   * (`renderInlineReplyBox`, lib/render-session.js) via
   * `window.ReplyDelivery`. After a successful comment write, best-effort
   * stamps the answer onto the decision-bearing loop via
   * `dispatchStore.markDecisionAnswered` — logged on failure, never thrown,
   * and never blocks the (already-succeeded) comment response. This is the
   * ONE write path for the `decision-answer` kind (decision 1): a runner
   * token can never reach it, since it lives outside the runner-facing
   * feedback route entirely.
   *
   * LIN-2197 Phase 5 (Phase 4 close-out ledger item L4): the task-decision
   * sibling of the pair above — an optional `{taskDecisionId, taskDecisionIssueId}`
   * pair, both required together, threaded from `public/scan.js`'s answer
   * form via the same `window.ReplyDelivery.postComment`. After a successful
   * comment write, best-effort stamps `outcome: 'answered'` onto the scanned
   * row via `taskDecisionsStore.markOutcome` — logged on failure, never
   * thrown, mirroring the loop-decision stamp's discipline exactly. This is
   * the first (and, at HEAD, only) production caller of `markOutcome` with
   * `'answered'` — before this, the outcome was reachable only as
   * `'dismissed'` via the dismiss route, so `'answered'` was unwritable in
   * production (the gap Phase 4's review recorded as L4, "the item that must
   * not be dropped": dismissed-vs-answered is what the false-escalation KPI
   * `docs/escalation-philosophy.md` is computed from).
   */
  router.post('/workspace/:urlKey/api/comments/:issueId', workspaceFromUrl, json(), async (req, res) => {
    const workspace = req.workspace
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null
    const { provider, callScope: token } = resolveIssueBinding(workspace, requestedSource)

    if (!provider.supports('createComment')) {
      return jsonError(res, 422, "This workspace's provider does not support commenting on issues", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'createComment', provider: provider.name,
      })
    }

    const { issueId } = req.params
    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format')
    }

    const { body } = req.body || {}
    const bodyValidation = validateCommentBody(body, { required: true })
    if (!bodyValidation.valid) {
      return badRequest.json(res, bodyValidation.error)
    }
    if (body.length > MAX_COMMENT_LENGTH) {
      return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`)
    }

    try {
      // test-token/testMockData branch (matches the codebase-wide `isTestMode`
      // convention, e.g. fetchWorkspaceIssues above): a `/test/set-session`
      // workspace carries no real provider binding, so the session-page e2e
      // coupling specs (tests/e2e/session-page.spec.js) need a write double
      // here rather than a live Linear GraphQL call — including no real
      // `issueWriteGuard` to check trashed-ness against, so this mode skips
      // that step entirely. Real (local/Linear-bound) workspaces are
      // unaffected and keep the full guard below.
      const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'

      if (!isTestMode) {
        // Two-step trashed guard (LIN-1559): the capability check above cannot
        // speak for this route-internal read, so a provider that implements
        // createComment but not issueWriteGuard gets a clean 422, not a 500.
        if (typeof provider.issueWriteGuard !== 'function') {
          return jsonError(res, 422, "This workspace's provider does not support commenting on issues", {
            code: 'CAPABILITY_NOT_SUPPORTED', capability: 'issueWriteGuard', provider: provider.name,
          })
        }
        const guard = await provider.issueWriteGuard(token, issueId)
        if (isTrashed(guard)) {
          return jsonError(res, 409, 'Issue is trashed; refusing to comment on a deleted issue')
        }
      }

      // Dedupe key is salted with a stable 'human-comment' discriminator so this
      // lane's digest stream can never collide with the agent lane's own
      // 4-argument call (routes/proxy.js) — see the comment there. Keyed on the
      // RAW, pre-attribution operator text (not the final attributed body,
      // composed below): an identical resubmission must hit the same cache
      // entry even though attribution makes the two *written* bodies diverge.
      const key = dedupeKey(workspace.urlKey, issueId, body, commentDedupeGenerations.current(workspace.urlKey), 'human-comment')
      const prior = commentDedupe.get(key)
      if (prior) {
        // LIN-2208: the dedupe cache protects the COMMENT WRITE (never mint a
        // second comment for an identical resubmission) — it must not also
        // protect a FAILED decision-answer stamp from ever being retried.
        // Pressing Save again with the exact same text is the one natural way
        // an operator retries a failed stamp (the reply text has no reason to
        // differ), so as long as this key's stamp hasn't already succeeded,
        // still attempt it before returning the deduped comment response.
        // `decisionStampDedupe` is what stops that from becoming a THIRD
        // stamp attempt once one has already landed (the pre-existing "a
        // deduped resubmission does not re-stamp" success-path coverage).
        if (!decisionStampDedupe.get(key)) {
          const stampOk = await stampDecisionAnswers(workspace, req.body || {}, { dispatchQueueStore, taskDecisionsStore })
          if (stampOk) decisionStampDedupe.set(key, true)
        }

        // Dedupe-hit ledger repair (LIN-2649 S1, F2): a dedupe hit means the
        // ORIGINAL create's own ledger-record attempt (below) may have failed
        // silently, leaving a Harbour-written comment unrecorded. Re-attempt
        // it here before returning — idempotent upsert, same best-effort
        // discipline as the non-dedupe path, never gates the response.
        if (harbourCommentsStore) {
          try {
            const priorCommentId = prior.comment?.id
            if (priorCommentId) {
              await harbourCommentsStore.record({ urlKey: workspace.urlKey, commentId: priorCommentId })
            }
          } catch (ledgerErr) {
            console.error('Harbour-comments ledger repair failed:', ledgerErr.message)
          }
        }

        return res.status(200).json({ ...prior, deduped: true })
      }

      // Attribution (OQ2): a static fallback line, not a `provider.fetchViewer`
      // round-trip — see the plan's Attribution note for why. Reversible,
      // revisit as its own follow-up if the fallback proves unsatisfying.
      const attributedBody = `${body}\n\n— Ruling recorded via Harbour`

      // Deliberately identifier-agnostic in test mode — it echoes whichever
      // :issueId the caller sent, so every spec's own seeded issueIdentifier
      // is accepted, not one hardcoded fixture.
      const commentCreate = isTestMode
        ? { success: true, comment: { id: `test-comment-${key}`, body: attributedBody, createdAt: new Date().toISOString(), user: { name: 'Harbour' } } }
        : normalizeCommentWrite(await provider.createComment(token, issueId, attributedBody))

      if (!commentCreate.success || !commentCreate.comment) {
        return jsonError(res, 502, 'Comment was not created', { detail: commentCreate || null })
      }

      commentDedupe.set(key, commentCreate)

      // Best-effort Harbour-comments ledger record (LIN-2648, WS1 of LIN-2241):
      // mirrors the stampDecisionAnswers discipline immediately below — a single
      // attempt, caught and logged, never propagated, never retried. The comment
      // already succeeded and is the durable half of this write; a ledger-write
      // failure must never fail it.
      if (harbourCommentsStore) {
        try {
          const newCommentId = commentCreate.comment?.id
          if (newCommentId) {
            await harbourCommentsStore.record({ urlKey: workspace.urlKey, commentId: newCommentId })
          }
        } catch (ledgerErr) {
          console.error('Harbour-comments ledger record failed:', ledgerErr.message)
        }
      }

      // Best-effort answer stamp(s) (LIN-1728 decision 1 / LIN-2197 Phase 5;
      // factored into stampDecisionAnswers, shared with the dedupe-hit retry
      // path above — LIN-2208). Failure is logged only: the comment already
      // succeeded and is the durable half of this write; the stamp is a
      // secondary annotation the rulings predicate tolerates missing (the
      // loop just stays "unanswered" until a later attempt succeeds — LIN-2208
      // above is what makes an identical-text retry one such later attempt).
      const stampOk = await stampDecisionAnswers(workspace, req.body || {}, { dispatchQueueStore, taskDecisionsStore })
      if (stampOk) decisionStampDedupe.set(key, true)

      return res.status(201).json(commentCreate)
    } catch (err) {
      console.error('Workspace-api create comment error:', err.message)
      return jsonError(res, 500, 'Failed to create comment')
    }
  })

  /**
   * Render one issue's detail block for the lazy dashboard (LIN-442).
   *
   * The authenticated homepage now ships only collapsed lines; `renderNode`
   * emits an empty `.details` wrapper and the client fetches the rendered inner
   * HTML here on first expand (mirroring the comments lazy-load). This is what
   * removes the dominant multi-MB per-page payload on large projects.
   *
   * Provider-backed for real workspaces (local in E2E, Linear in prod), with a
   * test-token/testMockData branch for the mock specs (`/test/set-session`),
   * since those render the homepage from fixtures, not the provider API. The
   * returned HTML is byte-identical to what `renderDetails` emitted inline before
   * — same feature flags, provider UI, and prompt containers.
   *
   * @route GET /workspace/:urlKey/api/detail/:issueId
   * @returns {Object} { html } - inner HTML for the issue's `.details` block
   */
  router.get('/workspace/:urlKey/api/detail/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace
    const { issueId } = req.params

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format')
    }

    try {
      // LIN-1903: the dashboard tree merges issues across ALL of a workspace's
      // bindings (LIN-544), but a bare id-only drill-down defaulted to the
      // WORKSPACE's active provider/scope — misrouting a foreign-source row's id
      // to the wrong provider/credential. The client-supplied `source` (the
      // issue's own provenance, LIN-561) lets us resolve that issue's own
      // binding instead, via resolveIssueBinding — bounded to this workspace's
      // OWN bindings, so it can only select among credentials the caller
      // already has access to (LIN-1904).
      const requestedSource = typeof req.query.source === 'string' ? req.query.source : null
      const { provider, callScope } = resolveIssueBinding(workspace, requestedSource)

      // Test mode (test-token + testMockData): the homepage renders from the mock
      // fixtures, not the provider API, so the lazy detail must too — fetching via
      // the Linear provider with 'test-token' would hit the network. Mirrors the
      // prompt route's test-mode branch.
      let issue
      if (process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token') {
        issue = testMockData.issues.find(i => i.id === issueId)
        if (!issue) {
          return notFound.json(res, 'Issue not found')
        }
      } else {
        issue = await provider.fetchIssueFields(callScope, issueId)
      }

      // Custom prompts (non-blocking, fallback to empty) — matches the homepage.
      let customPrompts = []
      try {
        customPrompts = (await customPromptsStore.list(workspace.urlKey)).map(p => ({ id: p.id, name: p.name }))
      } catch (e) { /* non-fatal */ }

      const isLocalhost = ['localhost', '127.0.0.1'].some(h => req.get('host')?.startsWith(h))

      // The same issue can be lazily expanded in two sections at once (e.g. In
      // Progress + its project tree). `section` disambiguates the dispatch
      // disclosure panel ids so the second appearance's "Dispatch ▾" resolves to
      // its OWN panel, not the first one's (LIN-732). Whitelisted to the known
      // render sections; anything else falls back to '' (pre-LIN-732 id scheme).
      const KNOWN_SECTIONS = ['project', 'in-progress', 'recent-activity']
      const section = KNOWN_SECTIONS.includes(req.query.section) ? req.query.section : ''

      const html = renderDetailsContent(issue, {
        isLanding: false,
        openRouterSource: getOpenRouterSource(req),
        urlKey: workspace.urlKey,
        featureFlags: getFeatureFlags(req.session),
        customPrompts,
        isLocalhost,
        provider,
        section
      })

      res.json({ html })
    } catch (error) {
      console.error('Detail fetch error:', error)

      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Token expired or invalid')
      }
      if (error.message?.includes('not found')) {
        return notFound.json(res, error.message)
      }
      jsonError(res, 500, 'Failed to fetch detail', { message: error.message })
    }
  })

  // ===========================================================================
  // Dispatched Sessions API
  // ===========================================================================

  /**
   * GET the dispatched sessions (pipeline Loops) for a single issue.
   *
   * Reads the local dispatch + agent stores only — no Linear call, no access
   * token — so it's cheap and works offline. The `:identifier` is the Linear
   * identifier (e.g. LIN-42), which is the join key the Swipe card already holds.
   * Returns newest-first so the most recent session is at the top.
   *
   * @route GET /workspace/:urlKey/api/sessions/:identifier
   * @returns {Object} { sessions: Array<SessionView> }
   */
  router.get('/workspace/:urlKey/api/sessions/:identifier', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { identifier } = req.params;

    if (!identifier || identifier.length > 100) {
      return badRequest.json(res, 'Invalid issue identifier');
    }
    if (!dispatchQueueStore || !agentStatusStore) {
      return jsonError(res, 503, 'Sessions are not available');
    }

    try {
      const loops = await getLoopsForIssue(workspace.urlKey, identifier, {
        dispatchStore: dispatchQueueStore,
        agentStatusStore
      });
      // getLoopsForIssue returns oldest-first; reverse for newest-first display.
      const sessions = loops.map(toSessionView).reverse();
      res.json({ sessions });
    } catch (error) {
      console.error('Sessions GET error:', error);
      jsonError(res, 500, 'Failed to fetch sessions', { message: error.message });
    }
  });

  // ===========================================================================
  // Recap API (LIN-261)
  // ===========================================================================

  /**
   * GET recap status + body (if fresh).
   *
   * @route GET /workspace/:urlKey/api/recap/:issueId
   * @returns {Object} { status: 'fresh'|'stale'|'missing', recap?, generatedAt?, model? }
   */
  router.get('/workspace/:urlKey/api/recap/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource);

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }
    if (!recapCacheStore) {
      return jsonError(res, 503, 'Recap cache not configured');
    }
    // Capability backstop — clean 422 (never a raw NotImplementedError) for a
    // provider that never implements recommendation context (LIN-1910).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return jsonError(res, 422, "This workspace's provider does not support recap for this issue", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
      });
    }

    try {
      const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
      let context;
      if (isTestMode) {
        context = await buildMockRecapContext(issueId);
        if (!context) return notFound.json(res, 'Issue not found');
      } else {
        context = await issueProvider.fetchRecommendationContext(issueCallScope, issueId);
      }

      const canonicalId = context.issue?.id || issueId;
      const inputHash = hashContext(context);
      const cached = await recapCacheStore.get(workspace.urlKey, canonicalId);

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
        recap: cached.recap,
        generatedAt: cached.generatedAt,
        model: cached.model
      });
    } catch (error) {
      console.error('Recap GET error:', error);
      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Token expired or invalid');
      }
      if (error.message?.includes('not found')) {
        return notFound.json(res, error.message);
      }
      jsonError(res, 500, 'Failed to fetch recap status', { message: error.message });
    }
  });

  /**
   * POST recap generate.
   * Regenerates the recap via Haiku (or configured model) and caches it.
   *
   * @route POST /workspace/:urlKey/api/recap/:issueId
   * @returns {Object} { status: 'fresh', recap, generatedAt, model }
   */
  router.post('/workspace/:urlKey/api/recap/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource);

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }
    if (!recapCacheStore) {
      return jsonError(res, 503, 'Recap cache not configured');
    }
    // Capability backstop — clean 422 (never a raw NotImplementedError) for a
    // provider that never implements recommendation context (LIN-1910).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return jsonError(res, 422, "This workspace's provider does not support recap for this issue", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
      });
    }

    // `isTestMode` (test-token) gates the DATA mock; `mockAi` additionally fires
    // the AI mock for local-provider sessions, whose data comes from the
    // provider (LIN-388). The AI-config + free-tier guards key off `mockAi` so a
    // migrated local session isn't 503'd for lacking an OpenRouter key.
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const mockAi = shouldMockAi(workspace);
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;

    if (!mockAi && !isRecommendationEnabled(sessionApiKey) && !freeTierKey) {
      return jsonError(res, 503, 'AI recap is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', { code: 'AI_NOT_CONFIGURED' });
    }

    if (!mockAi && isFreeTier) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return jsonError(res, 429, check.reason, { freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } });
      }
    }

    // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
    const keepalive = armKeepalive(res);
    try {
      let context;
      if (isTestMode) {
        context = await buildMockRecapContext(issueId);
        if (!context) {
          keepalive.stop();
          return keepalive.send(404, { error: 'Issue not found' });
        }
      } else {
        context = await issueProvider.fetchRecommendationContext(issueCallScope, issueId);
      }

      const canonicalId = context.issue?.id || issueId;
      const inputHash = hashContext(context);
      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recap', forceDefault: isFreeTier });

      let recap;
      let modelUsed;
      if (mockAi) {
        const mocked = buildMockRecap(context);
        recap = mocked;
        modelUsed = selectedModel;
      } else {
        const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined);
        const result = await generateRecap(
          context.issue,
          context,
          { apiKey: apiKeyToUse, model: selectedModel, callMeta: { urlKey: workspace?.urlKey } }
        );
        recap = result.recap;
        modelUsed = result.model;
      }

      await recapCacheStore.put(workspace.urlKey, canonicalId, {
        inputHash,
        recap,
        model: modelUsed
      });
      const stored = await recapCacheStore.get(workspace.urlKey, canonicalId);

      keepalive.stop();
      keepalive.send(200, {
        status: 'fresh',
        recap: stored?.recap ?? recap,
        generatedAt: stored?.generatedAt ?? new Date(),
        model: modelUsed
      });
    } catch (error) {
      keepalive.stop();
      console.error('Recap POST error:', error);
      if (error.response?.status === 401) {
        return keepalive.send(401, { error: 'Token expired or invalid' });
      }
      if (error.message?.includes('not found')) {
        return keepalive.send(404, { error: error.message });
      }
      if (error.message?.includes('OpenRouter')) {
        return keepalive.send(503, { error: 'AI service temporarily unavailable', message: error.message });
      }
      keepalive.send(500, { error: 'Failed to generate recap', message: error.message });
    }
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
    const workspace = req.workspace;
    const { issueId } = req.params;

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }

    try {
      const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
      const issues = isTestMode
        ? testMockData.issues
        : (await getProviderForWorkspace(workspace).fetchProjects(getWorkspaceCallScope(workspace))).issues;

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
      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Token expired or invalid');
      }
      if (error.message?.includes('not found')) {
        return notFound.json(res, error.message);
      }
      jsonError(res, 500, 'Failed to build context', { message: error.message });
    }
  });

  // ===========================================================================
  // Brief API (current-state task brief)
  // ===========================================================================

  /**
   * GET brief status + body (if fresh).
   *
   * @route GET /workspace/:urlKey/api/brief/:issueId
   * @returns {Object} { status: 'fresh'|'stale'|'missing', brief?, generatedAt?, model? }
   */
  router.get('/workspace/:urlKey/api/brief/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource);

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }
    if (!briefCacheStore) {
      return jsonError(res, 503, 'Brief cache not configured');
    }
    // Capability backstop — clean 422 (never a raw NotImplementedError) for a
    // provider that never implements recommendation context (LIN-1910).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return jsonError(res, 422, "This workspace's provider does not support brief for this issue", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
      });
    }

    try {
      const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
      let context;
      if (isTestMode) {
        context = await buildMockRecapContext(issueId);
        if (!context) return notFound.json(res, 'Issue not found');
      } else {
        context = await issueProvider.fetchRecommendationContext(issueCallScope, issueId);
      }

      const canonicalId = context.issue?.id || issueId;
      const inputHash = hashContext(context);
      const cached = await briefCacheStore.get(workspace.urlKey, canonicalId);

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
        brief: cached.brief,
        generatedAt: cached.generatedAt,
        model: cached.model
      });
    } catch (error) {
      console.error('Brief GET error:', error);
      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Token expired or invalid');
      }
      if (error.message?.includes('not found')) {
        return notFound.json(res, error.message);
      }
      jsonError(res, 500, 'Failed to fetch brief status', { message: error.message });
    }
  });

  /**
   * POST brief generate.
   * Regenerates the brief via Haiku (or configured model) and caches it.
   *
   * @route POST /workspace/:urlKey/api/brief/:issueId
   * @returns {Object} { status: 'fresh', brief, generatedAt, model }
   */
  router.post('/workspace/:urlKey/api/brief/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource);

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }
    if (!briefCacheStore) {
      return jsonError(res, 503, 'Brief cache not configured');
    }
    // Capability backstop — clean 422 (never a raw NotImplementedError) for a
    // provider that never implements recommendation context (LIN-1910).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return jsonError(res, 422, "This workspace's provider does not support brief for this issue", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
      });
    }

    // See the recap POST note: `isTestMode` gates the DATA mock, `mockAi` the AI
    // mock (incl. local-provider sessions) and the AI-config/free-tier guards.
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const mockAi = shouldMockAi(workspace);
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;

    if (!mockAi && !isRecommendationEnabled(sessionApiKey) && !freeTierKey) {
      return jsonError(res, 503, 'AI brief is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', { code: 'AI_NOT_CONFIGURED' });
    }

    if (!mockAi && isFreeTier) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return jsonError(res, 429, check.reason, { freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } });
      }
    }

    // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
    const keepalive = armKeepalive(res);
    try {
      let context;
      if (isTestMode) {
        context = await buildMockRecapContext(issueId);
        if (!context) {
          keepalive.stop();
          return keepalive.send(404, { error: 'Issue not found' });
        }
      } else {
        context = await issueProvider.fetchRecommendationContext(issueCallScope, issueId);
      }

      const canonicalId = context.issue?.id || issueId;
      const inputHash = hashContext(context);
      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'brief', forceDefault: isFreeTier });

      let brief;
      let modelUsed;
      if (mockAi) {
        brief = buildMockBrief(context);
        modelUsed = selectedModel;
      } else {
        const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined);
        const result = await generateBrief(
          context.issue,
          context,
          { apiKey: apiKeyToUse, model: selectedModel, callMeta: { urlKey: workspace?.urlKey } }
        );
        brief = result.brief;
        modelUsed = result.model;
      }

      await briefCacheStore.put(workspace.urlKey, canonicalId, {
        inputHash,
        brief,
        model: modelUsed
      });
      const stored = await briefCacheStore.get(workspace.urlKey, canonicalId);

      keepalive.stop();
      keepalive.send(200, {
        status: 'fresh',
        brief: stored?.brief ?? brief,
        generatedAt: stored?.generatedAt ?? new Date(),
        model: modelUsed
      });
    } catch (error) {
      keepalive.stop();
      console.error('Brief POST error:', error);
      if (error.response?.status === 401) {
        return keepalive.send(401, { error: 'Token expired or invalid' });
      }
      if (error.message?.includes('not found')) {
        return keepalive.send(404, { error: error.message });
      }
      if (error.message?.includes('OpenRouter')) {
        return keepalive.send(503, { error: 'AI service temporarily unavailable', message: error.message });
      }
      keepalive.send(500, { error: 'Failed to generate brief', message: error.message });
    }
  });

  /** Build a small deterministic brief (Markdown) for test mode. */
  function buildMockBrief(context) {
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

  /** Build a mock recommendation context from test fixtures. */
  async function buildMockRecapContext(issueId) {
    const mockIssue = testMockData.issues.find(i => i.id === issueId || i.identifier === issueId || i.url?.endsWith(`/${issueId}`));
    if (!mockIssue) return null;
    const project = testMockData.projects.find(p => p.id === mockIssue.project?.id) || null;
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

  /** Build a small deterministic recap for test mode. */
  function buildMockRecap(context) {
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

  // ===========================================================================
  // Scan API (LIN-2197 Phase 4) — the third producer into the operator
  // decision queue (LIN-1721): a human-triggered, single-task triage read.
  //
  // Mirrors the Brief/Recap route pair's shape (context fetch → canonical id
  // → hashContext → store lookup/write) but is neither: the store is
  // task-keyed with no TTL (an unanswered ruling must never silently expire,
  // unlike the 7-day brief/recap caches), and a scan additionally carries a
  // fail-closed Principle 0 gate and an outcome (dismiss) write path.
  // ===========================================================================

  /**
   * GET scan status. `fresh` means the stored row matches the task's CURRENT
   * content hash (so it agrees with what a POST scan would return right now,
   * including any terminal outcome); `stale` means a row exists but for
   * different content (a re-scan is needed to know the current state);
   * `missing` means this task has never been scanned.
   *
   * @route GET /workspace/:urlKey/api/scan/:issueId
   * @returns {Object} { status: 'fresh'|'stale'|'missing', decision?, outcome?, outcomeAt?, scannedAt?, id?, issueId?, basisChanged? } —
   *   `basisChanged` (LIN-2241) rides on the `fresh` and `stale` shapes only,
   *   never on `missing`: tri-state, `true`/`false`/`null`, where `null` means
   *   the question could not be answered (no recorded basis, or one from a
   *   different BASIS_VERSION) and must never be read as `false`.
   *   `stale` carries the same decision fields as `fresh` (LIN-2211): the row is still a live,
   *   answerable/dismissable ruling, only the content hash has moved, so a caller must not treat
   *   `stale` as a bare `{status, scannedAt}` shape.
   */
  router.get('/workspace/:urlKey/api/scan/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource);

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }
    if (!taskDecisionsStore) {
      return jsonError(res, 503, 'Scan store not configured');
    }
    // Capability backstop — clean 422 (never a raw NotImplementedError) for a
    // provider that never implements recommendation context (LIN-1910).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return jsonError(res, 422, "This workspace's provider does not support scan for this issue", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
      });
    }

    try {
      const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
      let context;
      if (isTestMode) {
        context = await buildMockRecapContext(issueId);
        if (!context) return notFound.json(res, 'Issue not found');
      } else {
        context = await issueProvider.fetchRecommendationContext(issueCallScope, issueId);
      }

      const canonicalId = context.issue?.id || issueId;
      if (!UUID_REGEX.test(canonicalId)) {
        // Never let a durable scan record be keyed under a non-canonical
        // fallback (LIN-2197 Phase 2 close-out ledger item 3) — this task's
        // canonical id could not be resolved from the fetched context.
        return jsonError(res, 422, "This task's canonical id could not be resolved; scan requires a canonical identity", {
          code: 'CANONICAL_ID_REQUIRED'
        });
      }
      const inputHash = hashContext(context);
      const cached = await taskDecisionsStore.getStatus(workspace.urlKey, canonicalId, inputHash);

      if (!cached) {
        return res.json({ status: 'missing' });
      }
      // LIN-2241 tier 1: `status` and `basisChanged` answer DIFFERENT questions
      // and are deliberately both reported rather than collapsed. `status:
      // 'stale'` means the stored row is not for this exact content — it moves
      // on a label edit, because `inputHash`/`hashContext` carries labels
      // (lib/recap-cache.js:54). `basisChanged: true` means the content the
      // ruling's judgement actually rests on has moved, which is the signal
      // acceptance criterion 1 requires be free of that nuisance. A row can
      // therefore be `stale` with `basisChanged: false` — relabelled, same
      // question — and that combination is the point, not a contradiction.
      //
      // This route is the ONE producer of the signal, and it is deliberately
      // the live-content path: it already holds a fresh
      // `fetchRecommendationContext`, so the comparison is exact and costs no
      // call this handler was not already making. Both consumers — the
      // per-task scan panel (public/scan.js, which already polls this route)
      // and the rulings card (public/observation.js, on demand when the tab is
      // open) — read it from here rather than re-deriving it, so there is no
      // second, approximate implementation to drift.
      const basisChanged = computeBasisChanged({
        raisedBasisHash: cached.basisHash,
        raisedBasisVersion: cached.basisVersion,
        currentBasisHash: scanBasisHashFromContext(context)
      });
      if (cached.inputHash !== inputHash) {
        return res.json({
          status: 'stale',
          id: cached.id,
          issueId: cached.issueId,
          decision: cached.decision,
          scannedAt: cached.scannedAt,
          outcome: cached.outcome,
          outcomeAt: cached.outcomeAt,
          basisChanged
        });
      }
      return res.json({
        status: 'fresh',
        id: cached.id,
        issueId: cached.issueId,
        decision: cached.decision,
        scannedAt: cached.scannedAt,
        outcome: cached.outcome,
        outcomeAt: cached.outcomeAt,
        basisChanged
      });
    } catch (error) {
      console.error('Scan GET error:', error);
      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Token expired or invalid');
      }
      if (error.message?.includes('not found')) {
        return notFound.json(res, error.message);
      }
      jsonError(res, 500, 'Failed to fetch scan status', { message: error.message });
    }
  });

  /**
   * POST scan: triage this task for an operator-worthy decision. Always
   * calls the LLM (force-regenerate semantics, matching the recap/brief POST
   * routes) — idempotency lives in the STORED `_id` (content-hash-keyed), not
   * in skipping the call. A stored terminal (answered/dismissed) row for the
   * current content is never overwritten by a fresh call (see
   * TaskDecisionsStore.recordScan); everything else about the found-vs-not
   * outcome is decided by lib/scan.js's fail-closed Principle 0 gate and
   * strict parse/validation, not by this route.
   *
   * @route POST /workspace/:urlKey/api/scan/:issueId
   * @returns {Object} { status: 'fresh', id, issueId, decision, scannedAt, outcome, outcomeAt, model }
   */
  router.post('/workspace/:urlKey/api/scan/:issueId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource);

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }
    if (!taskDecisionsStore) {
      return jsonError(res, 503, 'Scan store not configured');
    }
    // Capability backstop — clean 422 (never a raw NotImplementedError) for a
    // provider that never implements recommendation context (LIN-1910).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return jsonError(res, 422, "This workspace's provider does not support scan for this issue", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
      });
    }

    // See the recap/brief POST notes: `isTestMode` gates the DATA mock,
    // `mockAi` the AI mock (incl. local-provider sessions), and the
    // AI-config/free-tier guards.
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const mockAi = shouldMockAi(workspace);
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;

    if (!mockAi && !isRecommendationEnabled(sessionApiKey) && !freeTierKey) {
      return jsonError(res, 503, 'AI scan is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', { code: 'AI_NOT_CONFIGURED' });
    }

    if (!mockAi && isFreeTier) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return jsonError(res, 429, check.reason, { freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } });
      }
    }

    // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
    const keepalive = armKeepalive(res);
    try {
      let context;
      if (isTestMode) {
        context = await buildMockRecapContext(issueId);
        if (!context) {
          keepalive.stop();
          return keepalive.send(404, { error: 'Issue not found' });
        }
      } else {
        context = await issueProvider.fetchRecommendationContext(issueCallScope, issueId);
      }

      const canonicalId = context.issue?.id || issueId;
      if (!UUID_REGEX.test(canonicalId)) {
        keepalive.stop();
        return keepalive.send(422, {
          error: "This task's canonical id could not be resolved; scan requires a canonical identity",
          code: 'CANONICAL_ID_REQUIRED'
        });
      }
      const inputHash = hashContext(context);
      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'scan', forceDefault: isFreeTier });

      let scanResult;
      let modelUsed;
      if (mockAi) {
        // The mock ALSO goes through parseScanResponse (unlike buildMockBrief/
        // buildMockRecap, which bypass their own parse layer) — this feature's
        // whole premise is strict, uniform validation, so a mock response must
        // prove out the same has_decision/isClaimedDecisionValid/parseDecision
        // gate a real one does, not a shortcut around it.
        scanResult = parseScanResponse(buildMockScanText(context), { issueId: canonicalId, inputHash });
        modelUsed = selectedModel;
      } else {
        const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined);
        const generated = await generateScan(
          context.issue,
          context,
          { apiKey: apiKeyToUse, model: selectedModel, issueId: canonicalId, inputHash, callMeta: { urlKey: workspace?.urlKey } }
        );
        scanResult = generated;
        modelUsed = generated.model;
      }

      if (scanResult.outcome === 'fail-closed') {
        // Never send a scan prompt without the Principle 0 gate — and never
        // persist anything when it was skipped, since nothing was actually
        // evaluated (a stored zero-finding here would be a false "found
        // nothing", exactly what this feature exists to prevent).
        keepalive.stop();
        return keepalive.send(503, {
          error: 'Scan rubric is temporarily unavailable; nothing was evaluated',
          code: 'PRINCIPLE_ZERO_UNAVAILABLE'
        });
      }
      if (scanResult.outcome === 'error') {
        // A claimed decision that failed validation, or an unparseable
        // response: persists nothing and asks the operator to retry, rather
        // than risk silently downgrading a real ruling into a zero-finding.
        keepalive.stop();
        return keepalive.send(502, {
          error: 'Scan produced an unusable response; please retry',
          code: 'SCAN_PARSE_FAILED'
        });
      }

      // LIN-2649 WS2: [C-3] scan-time ledger-store null guard. Same fail-open
      // asymmetry as the route-side call site (routes/workspace-api.js's
      // comment-create seams above) — this is the SECOND place it lives, not
      // a re-derivation: a dueBasisHash stored while harbourCommentsStore is
      // absent (nothing filtered) and later compared against one computed
      // while it IS present differs -> a false DUE, never a false not-due,
      // and never a fabricated unknown. `harbourCommentsStore` defaults to
      // null in createWorkspaceApiRoutes, and tests/unit/scan-routes.test.js
      // mounts the real router with no ledger store while driving this exact
      // route end to end — an unguarded call here would be a TypeError on a
      // shipped route.
      const recordedCommentIds = harbourCommentsStore
        ? await harbourCommentsStore.wereRecordedByHarbour(workspace.urlKey, context.comments)
        : new Set();

      // 'decision' or 'zero-finding' — both are normal, persisted outcomes.
      const record = await taskDecisionsStore.recordScan({
        urlKey: workspace.urlKey,
        issueId: canonicalId,
        issueIdentifier: context.issue?.identifier || issueId,
        inputHash,
        // LIN-2241 tier 1. A SECOND, narrower digest — `inputHash` stays the
        // row's identity (buildId → `_id`, and lib/scan.js's decision_id), so
        // it is never narrowed in place; this one records the content the
        // ruling is raised FROM, so a later reader can tell whether that basis
        // has since moved without spending a model call.
        basisHash: scanBasisHashFromContext(context),
        basisVersion: BASIS_VERSION,
        // LIN-2649 WS2: a THIRD, additive digest — the same projection as
        // basisHash with Harbour-ledger-recorded comments filtered out, for
        // "is this scanned task worth spending another scan on?" rather than
        // "has a pending ruling's basis moved?". Computed in the SAME request
        // from the SAME context as basisHash above, so a scan always stores
        // both hashes together and there is exactly one write path to keep
        // in sync.
        dueBasisHash: dueBasisHashFromContext(context, { recordedCommentIds }),
        // LIN-2665 L1: dueBasisHash's OWN version field, never shared with
        // tier-1's basisVersion above — see lib/task-decisions-store.js's
        // [F-2] terminal-row patch for why the split is load-bearing.
        dueBasisVersion: BASIS_VERSION,
        decision: scanResult.outcome === 'decision' ? scanResult.decision : null
      });
      if (!record) {
        keepalive.stop();
        return keepalive.send(500, { error: 'Failed to record scan result' });
      }

      keepalive.stop();
      keepalive.send(200, {
        status: 'fresh',
        id: record.id,
        issueId: record.issueId,
        decision: record.decision,
        scannedAt: record.scannedAt,
        outcome: record.outcome,
        outcomeAt: record.outcomeAt,
        model: modelUsed
      });
    } catch (error) {
      keepalive.stop();
      console.error('Scan POST error:', error);
      if (error.response?.status === 401) {
        return keepalive.send(401, { error: 'Token expired or invalid' });
      }
      if (error.message?.includes('not found')) {
        return keepalive.send(404, { error: error.message });
      }
      if (error.message?.includes('OpenRouter')) {
        return keepalive.send(503, { error: 'AI service temporarily unavailable', message: error.message });
      }
      keepalive.send(500, { error: 'Failed to run scan', message: error.message });
    }
  });

  /**
   * POST dismiss: stamp a specific scan row 'dismissed' — the operator has
   * seen this ruling and does not want it counted as an outstanding
   * decision. Idempotent (TaskDecisionsStore.markOutcome: first stamp wins),
   * so a double-submit can never flip an already-answered row into
   * 'dismissed'. Requires the exact record `id` from a prior GET/POST scan
   * response, not just the task's issueId, so a stale client can't
   * accidentally dismiss whatever happens to be current server-side.
   *
   * LIN-2197 Phase 5 (Phase 4 close-out ledger item L3): when `:issueId` is
   * already UUID-shaped, it IS the canonical id — `markOutcome` filters on
   * `{_id, urlKey, issueId}`, so the row's own stored key is the authority
   * and there is no reason to pay for a provider context fetch just to
   * re-derive an id already in hand. This also fixes the trashed/deleted-task
   * case: a stale ruling on a task the provider can no longer fetch could
   * previously never be dismissed (the fetch 404s before `markOutcome` is
   * ever reached). A non-UUID `:issueId` (an identifier, or a caller that
   * hasn't been updated to pass the canonical id GET/POST scan now return)
   * still resolves it via the context fetch, unchanged.
   *
   * @route POST /workspace/:urlKey/api/scan/:issueId/dismiss
   * @returns {Object} { status: 'fresh', id, issueId, decision, outcome, outcomeAt, scannedAt }
   */
  router.post('/workspace/:urlKey/api/scan/:issueId/dismiss', workspaceFromUrl, json(), async (req, res) => {
    const workspace = req.workspace;
    const { issueId } = req.params;
    const recordId = req.body?.id;

    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }
    if (typeof recordId !== 'string' || !recordId) {
      return badRequest.json(res, 'A scan record id is required');
    }
    if (!taskDecisionsStore) {
      return jsonError(res, 503, 'Scan store not configured');
    }

    try {
      let canonicalId;
      if (UUID_REGEX.test(issueId)) {
        canonicalId = issueId;
      } else {
        const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
        const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource);
        if (!issueProvider.supports('fetchRecommendationContext')) {
          return jsonError(res, 422, "This workspace's provider does not support scan for this issue", {
            code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
          });
        }

        const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
        let context;
        if (isTestMode) {
          context = await buildMockRecapContext(issueId);
          if (!context) return notFound.json(res, 'Issue not found');
        } else {
          context = await issueProvider.fetchRecommendationContext(issueCallScope, issueId);
        }

        canonicalId = context.issue?.id || issueId;
        if (!UUID_REGEX.test(canonicalId)) {
          return jsonError(res, 422, "This task's canonical id could not be resolved; scan requires a canonical identity", {
            code: 'CANONICAL_ID_REQUIRED'
          });
        }
      }

      const record = await taskDecisionsStore.markOutcome({
        urlKey: workspace.urlKey, issueId: canonicalId, id: recordId, outcome: 'dismissed'
      });
      if (!record) {
        return notFound.json(res, 'Scan record not found');
      }

      return res.json({
        status: 'fresh',
        id: record.id,
        issueId: record.issueId,
        decision: record.decision,
        outcome: record.outcome,
        outcomeAt: record.outcomeAt,
        scannedAt: record.scannedAt
      });
    } catch (error) {
      console.error('Scan dismiss error:', error);
      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Token expired or invalid');
      }
      if (error.message?.includes('not found')) {
        return notFound.json(res, error.message);
      }
      jsonError(res, 500, 'Failed to dismiss scan result', { message: error.message });
    }
  });

  /**
   * A small deterministic mock scan response for test mode, mirroring
   * buildMockRecap/buildMockBrief's "derive from context" convention. Unlike
   * those, this returns raw JSON TEXT (not a pre-parsed shape) — see the
   * POST route's mockAi branch for why the mock is deliberately routed
   * through the same parseScanResponse gate as a real LLM response.
   */
  function buildMockScanText(context) {
    const haystack = `${context.issue?.description || ''} ${(context.comments || []).map(c => c.body || '').join(' ')}`;
    const triggersDecision = /\b(waiting|blocked|research|unclear|decide|decision|question)\b/i.test(haystack);
    if (!triggersDecision) {
      return JSON.stringify({ has_decision: false });
    }
    return JSON.stringify({
      has_decision: true,
      question: `How should ${context.issue?.identifier || 'this task'} proceed?`,
      options: [
        { id: 'proceed', label: 'Proceed with the current approach' },
        { id: 'wait', label: 'Wait for the blocker to clear' }
      ],
      recommended: 'wait',
      free_text: false
    });
  }

  /**
   * GET paginated scan-due candidates for a workspace (LIN-2649 WS2/S3): which
   * already-scanned tasks have had their DUE-basis content move since they
   * were last scanned, checked on demand against live provider reads. Pages
   * ACROSS every distinct scanned issueId in the workspace via
   * `taskDecisionsStore.listCandidatesForWorkspace` (keyset-ordered
   * `(scannedAt asc, issueId asc)`), unlike the single-task scan routes above
   * — but reuses this file's same resolve-then-gate capability convention and
   * keepalive precedent.
   *
   * Do not reopen: page size, concurrency, ordering, response shape and the
   * ledger-exclusion rule are the parent LIN-2241/LIN-2649 plan's settled
   * design (LIN-2666).
   *
   * @route GET /workspace/:urlKey/api/scan-due
   * @query {string} [cursor] - opaque base64url-JSON `{scannedAt,issueId}` keyset position;
   *   absent starts at the beginning of the ordering. A decodable-but-stale cursor
   *   (naming a pair no longer present) is NOT an error — the keyset `>` comparison
   *   resumes from the nearest later point.
   * @query {string} [source] - provider binding override, same convention as the routes above
   * @returns {Object} { items, nextCursor, pageCandidateCount, totalCandidateCount } —
   *   `items[]`: { issueId, issueIdentifier, dueStatus: true|false|null, error?: true }.
   *   `dueStatus` is exactly `true`/`false`/`null`; `error` is an orthogonal flag set only
   *   on a per-candidate provider-read failure, never folded into `dueStatus`.
   *   `nextCursor` is the SAME opaque base64url-JSON string the `cursor` query param
   *   above accepts — emitted and accepted are identical, replay it verbatim as
   *   `?cursor=<nextCursor>`; `null` on the last page. (Its inverse decode is above,
   *   at the top of the handler.)
   */
  router.get('/workspace/:urlKey/api/scan-due', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null;
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, requestedSource);

    if (!taskDecisionsStore) {
      return jsonError(res, 503, 'Scan store not configured');
    }
    // [F-4] Capability gate — once per request, BEFORE any store read or
    // provider call: a provider without fetchRecommendationContext fails the
    // WHOLE page with one clean 422, instead of DUE_CHECK_PAGE_SIZE candidates
    // each 422ing individually. Same resolve-then-gate convention as the scan
    // routes above (and the recommend/recap/brief routes elsewhere in this file).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return jsonError(res, 422, "This workspace's provider does not support scan-due checks", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'fetchRecommendationContext', provider: issueProvider.name,
      });
    }

    // Parse the opaque keyset cursor BEFORE any store call. Anything present
    // that fails to decode/parse, or decodes to the wrong shape, is a 400 —
    // a stale-but-decodable cursor is handled entirely inside
    // listCandidatesForWorkspace's keyset comparison, not here.
    let cursor = null;
    if (req.query.cursor !== undefined) {
      try {
        if (typeof req.query.cursor !== 'string') throw new Error('cursor must be a string');
        const decoded = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString('utf8'));
        if (!decoded || typeof decoded !== 'object' || typeof decoded.scannedAt !== 'string' || typeof decoded.issueId !== 'string') {
          throw new Error('cursor has the wrong shape');
        }
        cursor = { scannedAt: decoded.scannedAt, issueId: decoded.issueId };
      } catch {
        return jsonError(res, 400, 'Invalid cursor', { code: 'INVALID_CURSOR' });
      }
    }

    // Force-regenerate-per-candidate always spends up to DUE_CHECK_PAGE_SIZE
    // provider reads; arm a Heroku H12 guard around the store read + fan-out.
    const keepalive = armKeepalive(res);
    try {
      const page = await taskDecisionsStore.listCandidatesForWorkspace(workspace.urlKey, { cursor, limit: DUE_CHECK_PAGE_SIZE });

      const results = await settleWithConcurrency(page.items, DUE_CHECK_CONCURRENCY, async (row) => {
        const context = await issueProvider.fetchRecommendationContext(issueCallScope, row.issueId);
        // LIN-2649 WS2 null-ledger guard — same fail-open asymmetry as the
        // scan-time write path above (this route's second call site, not a
        // re-derivation): an absent harbourCommentsStore means "we cannot
        // tell which comments are Harbour's", not "no comments changed" — an
        // empty set filters nothing, so the worst case is a false DUE, never
        // a false not-due and never a fabricated unknown.
        const recordedCommentIds = harbourCommentsStore
          ? await harbourCommentsStore.wereRecordedByHarbour(workspace.urlKey, context.comments)
          : new Set();
        const currentDueBasisHash = dueBasisHashFromContext(context, { recordedCommentIds });
        return {
          issueId: row.issueId,
          issueIdentifier: row.issueIdentifier,
          dueStatus: dueChanged({
            raisedDueBasisHash: row.dueBasisHash,
            raisedDueBasisVersion: row.dueBasisVersion,
            currentDueBasisHash
          })
        };
      });

      // Per-item failure isolation: one candidate's provider read rejecting
      // (after the page-level capability check already passed) contributes
      // {dueStatus: null, error: true} for THAT row only — settleWithConcurrency's
      // allSettled shape means every other row and the page's 200 are unaffected.
      const items = results.map((result, i) => result.status === 'fulfilled'
        ? result.value
        : { issueId: page.items[i].issueId, issueIdentifier: page.items[i].issueIdentifier, dueStatus: null, error: true });

      keepalive.send(200, {
        items,
        // Symmetric with the cursor decode above (N-A discharge, LIN-2667):
        // emit the SAME base64url-JSON string the `cursor` param accepts, so a
        // client replays it verbatim. Conditional — an unconditional encode
        // would turn a last-page `null` into the string "bnVsbA".
        nextCursor: page.nextCursor ? Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url') : null,
        pageCandidateCount: page.items.length,
        totalCandidateCount: page.totalCandidateCount
      });
    } catch (error) {
      console.error('Scan-due GET error:', error);
      keepalive.send(500, { error: 'Failed to fetch scan-due candidates', message: error.message });
    } finally {
      // Always stop, on the success path, on a settleWithConcurrency rejection
      // (defensive — its allSettled shape shouldn't reject), and on any
      // synchronous throw before the response is sent.
      keepalive.stop();
    }
  });

  // ===========================================================================
  // Image Proxy API
  // ===========================================================================

  /**
   * Proxy image requests to Linear with authentication.
   * LIN-156: Linear-hosted images require auth headers that browsers can't add to img src.
   *
   * @route GET /workspace/:urlKey/api/image
   * @query {string} url - The Linear image URL to fetch
   * @returns {Stream} Image data with appropriate content-type
   */
  router.get('/workspace/:urlKey/api/image', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace
    const imageUrl = req.query.url

    // Validate URL
    if (!imageUrl) {
      return badRequest.json(res, 'Missing url parameter')
    }

    // Only allow HTTPS URLs (security)
    if (!imageUrl.startsWith('https://')) {
      return badRequest.json(res, 'Invalid image URL: must be HTTPS')
    }

    // Only allow Linear-hosted images (security - prevent SSRF)
    // Use exact hostname matching to prevent bypass via evillinear.app
    const allowedHosts = new Set(['uploads.linear.app', 'cdn.linear.app', 'linear.app'])
    let urlObj
    try {
      urlObj = new URL(imageUrl)
      if (!allowedHosts.has(urlObj.hostname)) {
        return badRequest.json(res, 'Invalid image URL: must be from Linear')
      }
      // Prevent path traversal attacks
      if (urlObj.pathname.includes('..')) {
        return badRequest.json(res, 'Invalid image URL: path traversal not allowed')
      }
    } catch {
      return badRequest.json(res, 'Invalid image URL format')
    }

    // Max image size: 10MB to prevent memory exhaustion
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024

    try {
      // LIN-1899: attach the workspace credential ONLY when the active binding
      // is Linear. `workspace.accessToken` is the provider-agnostic scalar
      // mirror, so for a Jira-active workspace this template would send a raw
      // Jira API token to uploads.linear.app — the same cross-provider
      // credential egress LIN-1891 closed on the attachment relay
      // (routes/proxy.js:2477-2479), and this route is the same site class, so
      // it takes that precedent's consequence verbatim: SERVE the asset, WITHHOLD
      // the header. Deliberately degrade rather than refuse (unlike the audit
      // capability above) — a mixed workspace's already-rendered <img> still
      // resolves for genuinely public linear.app assets, and the security
      // property is identical either way: the credential does not leave the
      // system. `linear`-only, never `linear` OR `local` (LIN-1891's rule);
      // legacy providerless workspaces keep their header.
      //
      // Placed at the fetch, AFTER the https-only / exact-host-allowlist /
      // path-traversal checks above — none of which are reordered or relaxed.
      const fetchHeaders = isActiveProviderLinear(workspace)
        ? { Authorization: `Bearer ${workspace.accessToken}` }
        : {}
      const response = await fetch(imageUrl, {
        headers: fetchHeaders,
        // Prevent redirects that could bypass SSRF protection
        redirect: 'error'
      })

      if (!response.ok) {
        return jsonError(res, response.status, 'Failed to fetch image')
      }

      // Check content-length if available
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
      if (contentLength > MAX_IMAGE_SIZE) {
        return jsonError(res, 413, 'Image too large')
      }

      // Read response with size limit
      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
        return jsonError(res, 413, 'Image too large')
      }

      // Security (LIN-682): do NOT relay the upstream content type verbatim — the
      // old `startsWith('image/')` guard let `image/svg+xml` through, and an SVG
      // served inline same-origin executes its embedded script in the operator's
      // session. Sniff the actual bytes and serve only raster images; reject any
      // non-raster body (SVG/HTML/JS) via the existing 400 path. This closes the
      // class for ANY SVG asset reaching the proxy — feedback uploads, legacy
      // tickets, or the LIN-652 attachments gallery — not just new uploads.
      //
      // No `Content-Disposition: attachment`: this is an `<img src>` relay for
      // both the feedback render and the LIN-652 gallery, so attachment would
      // force a download and break legitimate inline raster rendering. The
      // raster allowlist + `nosniff` close the hole while preserving inline use.
      const buffer = Buffer.from(arrayBuffer)
      const rasterType = sniffRasterType(buffer)
      if (!rasterType) {
        return badRequest.json(res, 'Invalid response: not a supported raster image')
      }

      res.set('Content-Type', rasterType)
      res.set('X-Content-Type-Options', 'nosniff')
      res.set('Cache-Control', 'private, max-age=3600')
      res.send(buffer)
    } catch (error) {
      // Handle redirect errors specifically
      if (error.cause?.code === 'ERR_FR_TOO_MANY_REDIRECTS' || error.message?.includes('redirect')) {
        return badRequest.json(res, 'Redirects not allowed')
      }
      console.error('Image proxy error:', error)
      jsonError(res, 500, 'Failed to fetch image')
    }
  })

  // ===========================================================================
  // Feedback intake (LIN-636 route / LIN-635 widget)
  // ===========================================================================
  //
  // POST /workspace/:urlKey/api/feedback creates a fresh ticket from a feedback
  // message — priority, captured page URL + browser, and an optional embedded
  // screenshot — then enqueues a triage-style follow-up. It is the ONLY consumer
  // of the provider `uploadFile` seam (LIN-636); the feedback widget (LIN-635)
  // POSTs here.
  //
  // Body-size exception, scoped to THIS route only: the global
  // `express.json({ limit: '250kb' })` (server.js) is left untouched. That
  // global parser only matches `application/json`, so a larger body sent with a
  // non-JSON content type (e.g. text/plain) passes through it unparsed; the
  // per-route parser below (permissive `type`, raised limit) then parses it.
  // Small `application/json` bodies are already parsed by the global parser and
  // are skipped here, so they keep the 250kb ceiling — the exception cannot leak
  // to other routes.
  const FEEDBACK_BODY_LIMIT = '12mb';
  const MAX_FEEDBACK_IMAGE_BYTES = 10 * 1024 * 1024; // matches the image-proxy ceiling
  const MAX_FEEDBACK_MESSAGE_LENGTH = 10_000;
  const MAX_FEEDBACK_CONTEXT_LENGTH = 2_000; // url / userAgent clamp
  const feedbackBodyParser = json({ type: () => true, limit: FEEDBACK_BODY_LIMIT });

  // The three explicit post-create actions the feedback widget can request
  // (LIN-918). Anything else (including an omitted action) is the legacy plain
  // send, which still honours the per-user `feedbackTriage` flag.
  const FEEDBACK_ACTIONS = new Set(['save', 'triage', 'autopilot']);

  // Shared framing core: a widget-filed feedback ticket is a raw, un-triaged user
  // report, not a scoped task (LIN-918 / LIN-947). Both the persisted description
  // marker (LIN-947, stored ON the ticket) and the autopilot kickoff note (LIN-918,
  // injected into a run) build on this one sentence so the "raw feedback" framing
  // cannot drift apart between the two surfaces.
  const FEEDBACK_ORIGIN_FRAMING =
    'this ticket was filed directly from the in-app feedback widget, so it is an ' +
    'unfiltered user report, not a triaged or scoped task';

  // Feedback-origin brief injected into a feedback → autopilot kickoff (LIN-918).
  // `buildAutopilotKickoff` pins the goal for a scoped run and ignores `goal`, so
  // this framing is threaded in via the dedicated `originNote` seam. It tells the
  // run the ticket is a raw, un-triaged user report whose first job is understanding.
  const FEEDBACK_AUTOPILOT_ORIGIN_NOTE =
    `**Origin — raw feedback:** ${FEEDBACK_ORIGIN_FRAMING}. Before driving toward a fix, ` +
    'your first job is to *understand* it: read the report closely, reproduce or ground the problem ' +
    'against the current code, and work out what is actually being asked. Treat the description as a ' +
    'starting hypothesis, not a specification.';

  // Persisted origin/triage marker written into every widget-filed feedback
  // description (LIN-947). Unlike FEEDBACK_AUTOPILOT_ORIGIN_NOTE — which is only
  // threaded into an autopilot run — this is stored ON the ticket, so the
  // meta-prompt's next-action scorer sees the "raw, un-triaged" signal and routes
  // to `triage` (sort intent, confirm priority, scope) instead of skipping ahead
  // to look-into/research/implement on a report that only looks intentional.
  const FEEDBACK_ORIGIN_TRIAGE_MARKER =
    `**Origin — raw feedback (triage first):** ${FEEDBACK_ORIGIN_FRAMING}. ` +
    'Its natural next step is **triage**: work out what is actually being asked, ' +
    'confirm the real priority, and scope it before any research or implementation.';

  // Clamp an incoming priority to Linear's 0-4 scale (0 = none … 4 = low);
  // anything else falls back to 0 ("No priority").
  function normalizeFeedbackPriority(value) {
    const n = typeof value === 'number' ? value : parseInt(value, 10);
    return Number.isInteger(n) && n >= 0 && n <= 4 ? n : 0;
  }

  /**
   * Resolve the team a feedback ticket should be filed under. Precedence:
   * explicit body `teamId` → `FEEDBACK_TEAM_ID` env → the provider's first team.
   * Returns null when none can be resolved (the caller turns that into a 422).
   */
  async function resolveFeedbackTeamId(provider, token, bodyTeamId) {
    if (typeof bodyTeamId === 'string' && bodyTeamId.trim()) return bodyTeamId.trim();
    if (process.env.FEEDBACK_TEAM_ID) return process.env.FEEDBACK_TEAM_ID;
    if (typeof provider.supports === 'function' && !provider.supports('fetchTeams')) return null;
    try {
      const teams = await provider.fetchTeams(token);
      return (Array.isArray(teams) && teams[0] && teams[0].id) || null;
    } catch (err) {
      console.error('Feedback team resolution failed:', err.message);
      return null;
    }
  }

  // Best-effort triage follow-up after a feedback ticket is filed (LIN-635 S6).
  // Non-fatal: a failure here must not fail the submission — the ticket already
  // exists. Reuses the existing dispatch substrate (no separate queue).
  //
  // Gated behind the per-user `feedbackTriage` flag (default off, LIN-733): the
  // caller only invokes this when the flag is on. When it runs, the triage
  // prompt always carries this workspace's API proxy details (a short-lived,
  // best-effort readWrite token + the standard "Workspace API access" block)
  // so the triage agent can ground itself and update the ticket — the same
  // preamble the proxy dispatch endpoints append.
  async function enqueueFeedbackTriage(workspace, issue, priority, session, baseUrl, overrides = {}) {
    if (!dispatchQueueStore || !issue?.identifier) return;
    try {
      const triageIssue = {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        state: issue.state,
        priority,
        labels: []
      };
      const generated = generatePrompt('triage', triageIssue, { project: null, parent: null, siblings: [] }, {}, getProviderForWorkspace(workspace)?.ui || null);
      const basePrompt = generated?.prompt;
      if (!basePrompt) return;

      // Create the dispatch item through the shared factory (LIN-1139): it
      // resolves model/harness from workspace dispatchDefaults (LIN-1138 — this
      // site takes no user-supplied model/harness, so resolution is purely from
      // workspace defaults) and calls addItem. The proxy-context append always
      // runs here (LIN-733); it moves inside finalizePrompt AFTER the harness is
      // resolved so it can still gate its MCP-token-vs-prose branch on a resolved
      // (workspace-default) claude-code harness (LIN-1155) and hand back the
      // bootstrapToken. A fresh single-use BOOTSTRAP token (LIN-376) is minted per
      // dispatch, never a standing readWrite token; if minting is unavailable/
      // fails, attachProxyContext returns the prompt unchanged so the triage still
      // dispatches (best-effort, like the enqueue).
      //
      // The feedback path now inherits the factory's default harness interpose
      // (LIN-1164, discharging the deferral the LIN-1139 refactor named here):
      // a blank workspace harness resolves to claude-code, so attachProxyContext
      // takes the LIN-1155 MCP-token-field branch — the item carries a
      // bootstrapToken and the prompt no longer embeds Bearer/curl exchange prose.
      // An explicit non-claude-code workspace harness (e.g. opencode) is left
      // untouched by applyDefaultDispatchHarness and keeps token-in-prose delivery.
      await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: workspace.urlKey,
        workspacePreferencesStore,
        kind: 'triage',
        // Optional per-dispatch override from the feedback widget (LIN-1132).
        // Blank/absent falls through to the factory's default resolution
        // (workspace dispatchDefaults → claude-code interpose), byte-identical to
        // before this override path existed.
        model: overrides.model,
        harness: overrides.harness,
        finalizePrompt: (resolvedHarness) => attachProxyContext({
          proxyTokenStore,
          urlKey: workspace.urlKey,
          baseUrl,
          issueIdentifier: issue.identifier,
          prompt: basePrompt,
          label: 'feedback-triage',
          harness: resolvedHarness,
          // LIN-2354: declared provider identity, fallback-free (unlike the
          // getProviderForWorkspace capability-shaping read above this function).
          providerDisplayName: getProvider(workspace.provider)?.ui?.displayName ?? null,
          // LIN-1376: stamp the launching account so the dispatched session's
          // token resolves under LIN-1366 owner-scoping.
          createdBy: session?.accountId || null
        }),
        fields: {
          promptName: 'Triage',
          issueId: issue.id || null,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title || null,
          issueUrl: issue.url || null,
          dispatchedBy: session?.accountId || null,
          target: 'cli'
        }
      });
    } catch (err) {
      console.error('Feedback triage enqueue failed:', err.message);
    }
  }

  // Best-effort autopilot follow-up after a feedback ticket is filed (LIN-918).
  // Mirrors `enqueueFeedbackTriage`: it builds a SCOPED autopilot kickoff for the
  // freshly-created ticket, injects the feedback-origin brief (so the run knows the
  // ticket came straight from the widget and needs understanding — a scoped kickoff
  // ignores `goal`, hence the dedicated `originNote` seam), mints a best-effort
  // readWrite proxy token, and enqueues on the SAME dispatch substrate with
  // `kind: 'autopilot'`. Non-fatal — a failure here must not fail the submission,
  // the ticket already exists. Unlike triage this is NOT flag-gated: the user chose
  // it explicitly in the widget.
  //
  // The kickoff assumes a readWrite token is "supplied alongside this prompt (the
  // +proxy block)", so the `attachProxyContext` mint+append (LIN-1157) is how
  // the run gets its API access — the same append the triage path makes. (The store
  // then appends the "Your autopilot session id" block for `kind: 'autopilot'`.)
  async function enqueueFeedbackAutopilot(workspace, issue, session, baseUrl, overrides = {}) {
    if (!dispatchQueueStore || !issue?.identifier || !baseUrl) return;
    try {
      const kickoff = buildAutopilotKickoff({
        baseUrl,
        issue: { identifier: issue.identifier, title: issue.title },
        originNote: FEEDBACK_AUTOPILOT_ORIGIN_NOTE
      });

      // Create the dispatch item through the shared factory (LIN-1139): it
      // resolves model/harness from workspace dispatchDefaults (LIN-1138 — this
      // site takes no user-supplied model/harness) and calls addItem. The
      // proxy-context append (the "+proxy block" the kickoff refers to for its
      // token) moves inside finalizePrompt AFTER the harness is resolved so it can
      // still gate its MCP-token-vs-prose branch on a resolved (workspace-default)
      // claude-code harness (LIN-1155) and hand back the bootstrapToken. LIN-376: a
      // single-use bootstrap is minted, exchanged by the run for a working token.
      //
      // This path inherits the factory default harness interpose (LIN-1164) — see
      // the triage twin above: a blank workspace harness resolves to claude-code so
      // the bootstrap travels via the MCP bootstrapToken field, while an explicit
      // non-claude-code workspace harness still keeps token-in-prose delivery.
      await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: workspace.urlKey,
        workspacePreferencesStore,
        kind: 'autopilot',
        // Optional per-dispatch override from the feedback widget (LIN-1132).
        // Blank/absent falls through to the factory's default resolution
        // (workspace dispatchDefaults → claude-code interpose), byte-identical to
        // before this override path existed.
        model: overrides.model,
        harness: overrides.harness,
        finalizePrompt: (resolvedHarness) => attachProxyContext({
          proxyTokenStore,
          urlKey: workspace.urlKey,
          baseUrl,
          issueIdentifier: issue.identifier,
          prompt: kickoff,
          label: 'feedback-autopilot',
          harness: resolvedHarness,
          // LIN-2354: declared provider identity, fallback-free (unlike the
          // getProviderForWorkspace capability-shaping reads elsewhere here).
          providerDisplayName: getProvider(workspace.provider)?.ui?.displayName ?? null,
          // LIN-1376: stamp the launching account so the dispatched session's
          // token resolves under LIN-1366 owner-scoping.
          createdBy: session?.accountId || null
        }),
        fields: {
          promptName: `Autopilot — ${issue.identifier}`,
          issueId: issue.id || null,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title || null,
          issueUrl: issue.url || null,
          dispatchedBy: session?.accountId || null,
          target: 'cli'
        }
      });
    } catch (err) {
      console.error('Feedback autopilot enqueue failed:', err.message);
    }
  }

  /**
   * Submit feedback as a new ticket, optionally with an embedded screenshot,
   * then run the widget's chosen post-create action (save / triage / autopilot).
   * @route POST /workspace/:urlKey/api/feedback
   */
  router.post('/workspace/:urlKey/api/feedback', workspaceFromUrl, feedbackBodyParser, async (req, res) => {
    const workspace = req.workspace;
    const provider = getProviderForWorkspace(workspace);
    // Provider call scope: bare token for Linear/local (byte-identical), or a
    // { token, repo } GitHub App credential so createIssue builds a request-time
    // client from the installation token (LIN-713). uploadFile is capability-gated
    // off for GitHub; fetchTeams (via resolveFeedbackTeamId) ignores its arg.
    const token = getWorkspaceCallScope(workspace);
    const { message, title, teamId, projectId, image, url, userAgent } = req.body || {};
    const priority = normalizeFeedbackPriority(req.body?.priority);
    // Explicit post-create action (LIN-918). Only the three known actions branch;
    // anything else (including an omitted `action`) is the legacy plain send.
    const rawAction = typeof req.body?.action === 'string' ? req.body.action : null;
    const action = FEEDBACK_ACTIONS.has(rawAction) ? rawAction : null;

    // Optional per-dispatch execution overrides from the feedback widget
    // (LIN-1132). Validated with the SAME opaque-field helper the dispatch/proxy
    // routes use (type/length/dangerous-chars only, NOT a model registry); blank/
    // absent stays valid and falls through to the factory's default resolution.
    const { model, harness } = req.body || {};
    const modelValidationError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
    if (modelValidationError) {
      return badRequest.json(res, modelValidationError.error);
    }
    const harnessValidationError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
    if (harnessValidationError) {
      return badRequest.json(res, harnessValidationError.error);
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return badRequest.json(res, 'message is required');
    }
    if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
      return badRequest.json(res, 'message exceeds maximum length');
    }

    // Capability gates — clean 422 (never 500) when the workspace's provider
    // can't perform the op, mirroring the proxy write surface.
    if (!provider.supports('createIssue')) {
      return jsonError(res, 422, "This workspace's provider does not support creating tickets", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'createIssue', provider: provider.name,
      });
    }
    if (image && !provider.supports('uploadFile')) {
      return jsonError(res, 422, "This workspace's provider does not support file uploads", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'uploadFile', provider: provider.name,
      });
    }

    const resolvedTeamId = await resolveFeedbackTeamId(provider, token, teamId);
    if (!resolvedTeamId) {
      return jsonError(res, 422, 'Could not resolve a team to file feedback against', {
        code: 'TEAM_UNRESOLVED', provider: provider.name,
      });
    }
    const resolvedProjectId = (typeof projectId === 'string' && projectId.trim())
      ? projectId.trim()
      : (process.env.FEEDBACK_PROJECT_ID || null);

    try {
      let description = message.trim();

      // Capture block — page URL + browser, recorded at submit time (LIN-635
      // S4). Both come from the client; clamp length and let markdown escape
      // them as inline code so they can't break the ticket body.
      const captured = [];
      if (typeof url === 'string' && url.trim()) {
        captured.push(`- **Page:** \`${url.trim().slice(0, MAX_FEEDBACK_CONTEXT_LENGTH)}\``);
      }
      if (typeof userAgent === 'string' && userAgent.trim()) {
        captured.push(`- **Browser:** \`${userAgent.trim().slice(0, MAX_FEEDBACK_CONTEXT_LENGTH)}\``);
      }
      if (captured.length) {
        description += `\n\n---\n${captured.join('\n')}`;
      }

      if (image) {
        const parsed = parseFeedbackImage(image);
        if (!parsed) {
          return badRequest.json(res, 'image must be a base64 data URL');
        }
        if (parsed.bytes.length > MAX_FEEDBACK_IMAGE_BYTES) {
          return jsonError(res, 413, 'image too large');
        }
        const assetUrl = await provider.uploadFile(token, parsed.bytes, {
          contentType: parsed.contentType,
          filename: parsed.filename,
        });
        description += `\n\n![](${assetUrl})`;
      }

      // LIN-1557: an explicit non-default priority the provider's headless
      // write contract (apiWriteFields()) can't honour is folded into the
      // description as visible text instead of being silently dropped, or
      // refusing the whole submission — this is a fire-and-forget human form
      // with no retry loop, so a hard failure would mean the report is never
      // filed at all. 0 ("No priority") is indistinguishable from "unset", so
      // it is never folded or forwarded, only omitted.
      const canSetPriority = provider.apiWriteFields().includes('priority');
      if (priority > 0 && !canSetPriority) {
        description += `\n\n---\n**Reported priority:** ${PRIORITY_OPTION_LABELS[priority]}`;
      }

      // Origin/triage marker (LIN-947) — additive, deterministic, and always
      // appended last so the stored ticket announces itself as raw, un-triaged
      // feedback whose natural next step is triage. This is what activates the
      // meta-prompt's existing triage routing; it does not alter the user
      // message, capture block, or screenshot above.
      description += `\n\n---\n${FEEDBACK_ORIGIN_TRIAGE_MARKER}`;

      // Title resolution (LIN-643). An explicit title always wins (trimmed to
      // 250). Otherwise: when AI is enabled for this user/workspace, generate a
      // concise whole-thought title from the feedback body via the LLM; when AI
      // is off — or generation fails — keep the deterministic first-line slice.
      // Title generation must happen BEFORE provider.createIssue, and never
      // applies the 60-char truncation on the AI path. The post-create triage
      // enqueue below is untouched.
      const fallbackTitle = `Feedback: ${message.trim().split('\n')[0].slice(0, 60)}`;
      let ticketTitle;
      if (typeof title === 'string' && title.trim()) {
        ticketTitle = title.trim().slice(0, 250);
      } else {
        ticketTitle = fallbackTitle;
        // Key resolution mirrors the recommendation path: user OAuth > env >
        // free-tier. When only the shared free-tier key is available the model
        // is clamped to DEFAULT (forceDefault: isFreeTier), matching every other
        // billed call site (the LIN-513 wiring invariant).
        const sessionApiKey = req.session?.openRouterApiKey;
        const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
        const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;
        const aiApiKey = sessionApiKey || getPaidEnvKey() || freeTierKey || null;
        if (aiApiKey) {
          try {
            const model = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore, forceDefault: isFreeTier });
            const generated = await generateFeedbackTitle(message.trim(), { apiKey: aiApiKey, model });
            if (generated) ticketTitle = generated;
          } catch (error) {
            // Best-effort: never block ticket creation on title generation.
            console.error('Feedback AI title generation failed, using fallback:', error.message);
          }
        }
      }

      const createInput = { teamId: resolvedTeamId, title: ticketTitle, description };
      if (resolvedProjectId) createInput.projectId = resolvedProjectId;
      if (priority > 0 && canSetPriority) createInput.priority = priority;

      const result = await provider.createIssue(token, createInput);
      if (!result?.success || !result.issue) {
        return jsonError(res, 502, 'Failed to create feedback ticket');
      }

      // Post-create action (LIN-918) — all branches are best-effort and never
      // fail the submission (the ticket already exists). An explicit widget
      // action wins and is DECOUPLED from the `feedbackTriage` flag:
      //   'save'      → file only, nothing further
      //   'triage'    → always enqueue triage
      //   'autopilot' → enqueue a scoped autopilot run carrying the feedback-origin brief
      // With no explicit action (the legacy plain send) we preserve the old
      // behaviour: triage only when the per-user `feedbackTriage` flag is on.
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      if (action === 'triage') {
        await enqueueFeedbackTriage(workspace, result.issue, priority, req.session, baseUrl, { model, harness });
      } else if (action === 'autopilot') {
        await enqueueFeedbackAutopilot(workspace, result.issue, req.session, baseUrl, { model, harness });
      } else if (!action && getFeatureFlags(req.session).feedbackTriage) {
        await enqueueFeedbackTriage(workspace, result.issue, priority, req.session, baseUrl, { model, harness });
      }

      return res.status(201).json({ success: true, issue: result.issue });
    } catch (error) {
      console.error('Feedback submit error:', error);
      return jsonError(res, 500, 'Failed to submit feedback');
    }
  });

  // ===========================================================================
  // Issue write surface (session-auth) — LIN-1552 / LIN-1504 Session A
  //
  // POST  /workspace/:urlKey/api/issues            → create → 201 {success, issue}
  // PATCH /workspace/:urlKey/api/issues/:issueId    → update → 200 {success, issue}
  //
  // Backend only (no UI). Modeled on POST /workspace/:urlKey/api/feedback above:
  // resolve the workspace provider, take the call-scope token, gate the
  // capability with a clean 422 (never 500), validate fields through the shared
  // seam (lib/issue-write-validation.js), resolve symbolic refs via the shared
  // proxy ref-resolver primitives, perform the provider write, and map a failed
  // write to 502. This is the surface the in-app UI (Session B) will call.
  // ===========================================================================

  // Normalize a provider write result to `{ success, issue }`. Linear/GitHub
  // return that shape already; the local provider returns a bare canonical issue
  // (or null), so without this a successful local write would read as
  // `success: undefined` and wrongly 502. Mirrors proxy.js's normalizeWritePayload.
  function normalizeIssueWrite(result) {
    if (result && typeof result === 'object' && 'success' in result) return result;
    return { success: !!result, issue: result ?? null };
  }

  // Same normalization, keyed 'comment' instead of 'issue' (LIN-2154) — the
  // session-auth comment route's provider.createComment() result can be
  // Linear's `{success, comment}` envelope or a bare comment entity (Local).
  function normalizeCommentWrite(result) {
    if (result && typeof result === 'object' && 'success' in result) return result;
    return { success: !!result, comment: result ?? null };
  }

  // Input-side symbolic-ref resolution, mirroring the proxy write path
  // (routes/proxy.js resolveTeamInput/resolveStateInput/resolveProjectInput): a
  // bare UUID short-circuits before any provider read, so existing UUID payloads
  // pay no network cost; a symbolic ref triggers the scoped list fetch and
  // resolves to a native id (or throws RefResolutionError → clean 422 below).
  async function resolveIssueTeamRef(provider, token, rawRef) {
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    const teams = await provider.fetchTeams(token);
    return resolveTeamRef(teams, localRef);
  }
  async function resolveIssueProjectRef(provider, token, rawRef) {
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    const projects = await provider.fetchProjectsList(token);
    return resolveProjectRef(projects, localRef);
  }
  async function resolveIssueStateRef(provider, token, teamId, rawRef) {
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    // States are team-scoped; without a team we cannot scope the symbolic match,
    // so fail loud (422) rather than guess across teams.
    if (!teamId) {
      throw new RefResolutionError(
        `Cannot resolve state '${localRef}' — the issue's team could not be determined`,
        { status: 422 },
      );
    }
    const states = await provider.states(token, teamId);
    return resolveStateRef(states, localRef);
  }

  // Map a RefResolutionError to a clean 422 (with candidate ids for an ambiguous
  // match). Returns true when handled so the catch can `if (...) return;`.
  function issueRefResolutionFailed(res, err) {
    if (!(err instanceof RefResolutionError)) return false;
    jsonError(res, err.status || 422, err.message, err.candidates ? { candidates: err.candidates } : undefined);
    return true;
  }

  // Map a PartialWriteError (LIN-2012) the same way the proxy route does —
  // same structured envelope, same non-2xx PARTIAL_WRITE code — so a caller
  // sees identical shapes on both lanes. This route has no logEvent-equivalent
  // audit trail today (unlike the proxy lane), so the provider-level
  // console.warn in lib/providers/jira/index.js is what covers this lane;
  // adding one here is a separate, out-of-scope concern.
  function partialWriteFailed(res, err) {
    if (!(err instanceof PartialWriteError)) return false;
    jsonError(res, err.status || 500, err.message, {
      code: 'PARTIAL_WRITE',
      category: 'upstream',
      retryable: true,
      detail: err.cause?.message || null,
      context: { applied: err.applied, failed: err.failed },
    });
    return true;
  }

  /**
   * Create an issue on the workspace provider (session-auth).
   * @route POST /workspace/:urlKey/api/issues
   */
  router.post('/workspace/:urlKey/api/issues', workspaceFromUrl, json(), async (req, res) => {
    const workspace = req.workspace;
    const provider = getProviderForWorkspace(workspace);
    const token = getWorkspaceCallScope(workspace);

    // Capability gate — clean 422 (never 500) when the provider can't create.
    if (!provider.supports('createIssue')) {
      return jsonError(res, 422, "This workspace's provider does not support creating issues", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'createIssue', provider: provider.name,
      });
    }

    const { title, description, teamId, projectId, stateId, priority } = req.body || {};

    // LIN-1972: teamId is only required when the provider's create contract
    // declares it — a teamless provider (Local, GitHub) must never be asked
    // for one. Sourced from createFields(), never supports()/fetchTeams().
    const fields = provider.createFields();
    const requiresTeam = fields.includes('teamId');

    if (requiresTeam && (!teamId || typeof teamId !== 'string')) {
      return badRequest.json(res, 'Valid teamId is required');
    }
    if (!title || typeof title !== 'string') {
      return badRequest.json(res, 'title is required');
    }
    // Shared validation seam (length caps + control-char guard + priority range)
    // — 400 on failure. Unlike the proxy surface, this session-auth surface opts
    // into priority rejection (validatePriority) so a bad priority is a clean 400,
    // not a silent drop (LIN-1552 Session A spec).
    const fieldError = validateIssueWriteFields({ title, description, priority }, { mode: 'create', validatePriority: true });
    if (fieldError) {
      return badRequest.json(res, fieldError);
    }

    // LIN-1973: the restrictive half of the LIN-1972 contract. A submitted
    // stateId/priority the provider's createFields() does NOT declare is now a
    // clean 400, not a silent drop (the one-layer-down forwarding guard below is
    // unchanged and still applies to every OTHER undeclared field). This is safe
    // only now that the inline create form is gone — that form submitted an
    // unconditional priority number for every provider, which would 400 here.
    // Checked by presence, not truthiness, so an explicit `stateId: ''` from a
    // non-form caller is still caught.
    if (stateId !== undefined && !fields.includes('stateId')) {
      return badRequest.json(res, 'stateId is not supported by this provider');
    }
    if (priority !== undefined && !fields.includes('priority')) {
      return badRequest.json(res, 'priority is not supported by this provider');
    }

    try {
      // LIN-1972: a create has no fetched issue to derive a team from (unlike
      // the PATCH path's issueWriteGuard placeholder), so supply provider.name
      // directly when the contract excludes teamId — a real non-empty string
      // every teamless states() implementation accepts and ignores, and one
      // that provably never reaches createIssue since input.teamId is only
      // set below when requiresTeam.
      const resolvedTeamId = requiresTeam
        ? await resolveIssueTeamRef(provider, token, teamId)
        : provider.name;
      const input = {
        title,
        // LIN-1552: stamp the creating account from the session (NOT
        // linearUserId), mirroring the LIN-1376 owner-stamping convention.
        // Pre-existing, unrelated to LIN-1973, and unverifiable offline against
        // a real Linear IssueCreateInput — per LIN-1579 the discharge is the
        // NAMED monitor below (the catch block's own error log), not a bare
        // "watch for a spike".
        createdBy: req.session?.accountId || null,
      };
      if (requiresTeam) input.teamId = resolvedTeamId;
      // LIN-1972: only forward optional fields the provider both declares AND
      // the caller submitted — restrictive but lossless (an undeclared field
      // is already dropped one layer down by every in-tree provider write).
      if (fields.includes('description') && description) input.description = description;
      if (fields.includes('projectId') && projectId) input.projectId = await resolveIssueProjectRef(provider, token, projectId);
      if (fields.includes('stateId') && stateId) input.stateId = await resolveIssueStateRef(provider, token, resolvedTeamId, stateId);
      if (fields.includes('priority') && priority !== undefined && isValidPriority(priority)) input.priority = priority;

      const result = normalizeIssueWrite(await provider.createIssue(token, input));
      if (!result.success || !result.issue) {
        return jsonError(res, 502, 'Issue was not created', { detail: result || null });
      }
      return res.status(201).json({ success: true, issue: result.issue });
    } catch (err) {
      if (issueRefResolutionFailed(res, err)) return;
      // NAMED MONITOR (LIN-1579) for the createdBy stamp above: this is the
      // discharge path for "does Linear ever reject the unconditional
      // createdBy stamp with a 5xx/502", not a bare post-landing "watch for a
      // spike". A createdBy-related rejection surfaces here as a caught error
      // and is logged with this exact message — grep server logs for
      // "Workspace-api create issue error" to check it. No dedicated
      // metric/oplog entry exists for this specific cause; a spike in this
      // log line correlated with Linear-backed workspaces is the signal.
      console.error('Workspace-api create issue error:', err.message);
      return jsonError(res, 500, 'Failed to create issue');
    }
  });

  /**
   * Update an issue on the workspace provider (session-auth). Description edit is
   * a full-body PATCH (replace, not append).
   * @route PATCH /workspace/:urlKey/api/issues/:issueId
   */
  router.patch('/workspace/:urlKey/api/issues/:issueId', workspaceFromUrl, json(), async (req, res) => {
    const workspace = req.workspace;
    // LIN-1904: resolve the issue's own binding via `source` (thread from the
    // edit-link → task-edit → PATCH provenance hop), same helper as the read
    // routes. Guard-read and write both derive from this single pairing, so
    // they cannot land on different bindings (the invariant LIN-1903's review
    // mutation-tested).
    const requestedSource = typeof req.query.source === 'string' ? req.query.source : null
    const { provider, callScope: token } = resolveIssueBinding(workspace, requestedSource);

    if (!provider.supports('updateIssue')) {
      return jsonError(res, 422, "This workspace's provider does not support updating issues", {
        code: 'CAPABILITY_NOT_SUPPORTED', capability: 'updateIssue', provider: provider.name,
      });
    }

    const { issueId } = req.params;
    if (!isValidIssueId(issueId)) {
      return badRequest.json(res, 'Invalid issue ID format');
    }

    // v1 edit fields only: title, description, state/status, priority. `stateId`
    // is the primary field; `state`/`status` are accepted aliases (all resolve
    // through the same symbolic state resolver).
    const { title, description, priority } = req.body || {};
    const stateId = req.body?.stateId ?? req.body?.state ?? req.body?.status;

    const fieldError = validateIssueWriteFields({ title, description, priority }, { mode: 'update', validatePriority: true });
    if (fieldError) {
      return badRequest.json(res, fieldError);
    }

    // Reject a wholly empty body before any provider read (no-network 400).
    const hasUpdatableField = [title, description, stateId, priority].some(v => v !== undefined);
    if (!hasUpdatableField) {
      return badRequest.json(res, 'No valid fields to update');
    }

    try {
      // One guard read serves BOTH the trashed refusal (409) AND the team scope a
      // symbolic stateId needs, mirroring the proxy update path.
      //
      // LIN-1559: `issueWriteGuard` is a ROUTE-INTERNAL read, deliberately off the
      // declared PROVIDER_SURFACE, so the `supports('updateIssue')` gate above
      // cannot speak for it — a provider can pass that gate and still lack this
      // read, which used to throw a TypeError inside this `try` and answer 500.
      // Keyed on method existence (the property this route actually depends on),
      // in this route's own inline 422 idiom rather than importing the proxy's.
      if (typeof provider.issueWriteGuard !== 'function') {
        return jsonError(res, 422, "This workspace's provider does not support updating issues", {
          code: 'CAPABILITY_NOT_SUPPORTED', capability: 'issueWriteGuard', provider: provider.name,
        });
      }
      const guard = await provider.issueWriteGuard(token, issueId);
      if (isTrashed(guard)) {
        return jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      }
      const teamId = guard?.team?.id || null;

      const input = {};
      if (title) input.title = title;
      if (description !== undefined) input.description = description; // full-body replace
      if (stateId) input.stateId = await resolveIssueStateRef(provider, token, teamId, stateId);
      if (priority !== undefined && isValidPriority(priority)) input.priority = priority;

      if (Object.keys(input).length === 0) {
        return badRequest.json(res, 'No valid fields to update');
      }

      const result = normalizeIssueWrite(await provider.updateIssue(token, issueId, input));
      if (!result.success || !result.issue) {
        return jsonError(res, 502, 'Issue was not updated', { detail: result || null });
      }
      return res.json({ success: true, issue: result.issue });
    } catch (err) {
      if (issueRefResolutionFailed(res, err)) return;
      if (partialWriteFailed(res, err)) return;
      console.error('Workspace-api update issue error:', err.message);
      return jsonError(res, 500, 'Failed to update issue');
    }
  });

  // ===========================================================================
  // Custom Prompts API
  // ===========================================================================

  /**
   * Live OpenRouter model catalog (LIN-1111 Session 2) — the JSON source the
   * client-rendered dispatch-exec-controls (public/common.js) fetch once per
   * page load to supplement the static DISPATCH_MODEL_SUGGESTIONS datalist
   * with the full live catalog. Same underlying cache module
   * (lib/openrouter-catalog.js) the Settings server-render path calls
   * directly, so both surfaces share one source of truth (never a fourth
   * duplicated list). Never 500s: a catalog fetch failure resolves to `[]`
   * upstream, so this always returns 200 with whatever's available.
   * @route GET /workspace/:urlKey/api/openrouter/models
   */
  router.get('/workspace/:urlKey/api/openrouter/models', workspaceFromUrl, async (req, res) => {
    try {
      const models = await getModelCatalog({ mock: shouldMockAi(req.workspace) });
      res.json({ models });
    } catch (error) {
      console.error('OpenRouter model catalog endpoint error:', error);
      res.json({ models: [] });
    }
  });

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
