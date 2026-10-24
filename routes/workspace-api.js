/**
 * Workspace-prefixed API routes.
 *
 * Handles all /workspace/:urlKey/api/* endpoints:
 * - Audit: Run workspace audit
 * - Prompts: moved to workspace-api-prompts.js (LIN-3842): GET /api/prompt/:issueId/:labelName and both GET /api/autopilot-prompt
 * - Recommendations: AI-generated prompts via OpenRouter
 * - Issue reads (GET comments, detail, image): moved to workspace-api-issue-read.js (LIN-3872)
 * - Issue writes (POST comments, POST issues, PATCH issues): moved to workspace-api-issue-write.js (LIN-3876)
 *
 * Shape (LIN-3596): every route is registered explicitly, in the order below, as a
 * thin handler over a small set of shared steps. The steps sit in two places:
 *   - module level, where they need no dependency (`refuseFreeTier`, `scanRow`, `loadContext`, ...;
 *     `openIssue`, `refuseCapability`, `failureOf` and `isTestToken` live in workspace-api-steps.js, shared with workspace-api-prompts.js, workspace-api-issue-read.js and workspace-api-issue-write.js);
 *   - inside `createWorkspaceApiRoutes`, where they close over the injected stores.
 * The AI pre-flight calls (`resolveChatCredential`, `checkFreeTierGate`, the
 * `forceDefault` model clamp) are deliberately NOT shared: each route names its own,
 * because the source-text censuses scan this file for every one of them.
 *
 * Test-mode builders (mock recommendation, recap, brief, scan, audit data, ...) live
 * in lib/workspace-api-mocks.js.
 */
import { resolveRunnerOwnerRefusal } from '../lib/runner-owner-gate.js';
import { Router, json } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { badRequest, jsonError, keepaliveError, notFound, unauthorized } from '../lib/errors.js';
import { getProviderForWorkspace, getProvider } from '../lib/providers/registry.js';
import '../lib/providers/linear/index.js'; // side effect: self-registers the Linear provider into the registry
import { createRoadmapRoutes } from './workspace-api-roadmap.js';
import { createPromptsRoutes } from './workspace-api-prompts.js';
import { registerIssueReadRoutes } from './workspace-api-issue-read.js';
import { registerIssueWriteRoutes } from './workspace-api-issue-write.js';
export { decisionStampDedupe } from './workspace-api-issue-write.js';
import { isTestToken, failureOf, openIssue, refuseCapability } from './workspace-api-steps.js';
import { generatePrompt } from '../lib/prompt-templates.js';
import { PRIORITY_OPTION_LABELS } from '../lib/render.js';
import { attachProxyContext, isCodedGrantRefusal, codedGrantRefusalResponse } from '../lib/proxy-preamble.js';
import { buildAutopilotKickoff } from '../lib/prompts/autopilot-kickoff.js';
import { isRecommendationEnabled, getRecommendation, getRecommendationStream, getModelDisplayName, streamChat } from '../lib/openrouter.js';
import { isRetryableRunLimit } from '../lib/plan-allowance.js';
import { resolveChatCredential, isAiUnavailable, checkFreeTierGate, buildRunGate, isFlagFreeTier, freeTierRefusalBlock } from '../lib/chat-request.js';
import { getModelCatalog, isFreeModel } from '../lib/openrouter-catalog.js';
import { resolveRecommendation, armHopSignal } from '../lib/recommend-recurse.js';
import { prepareRecommendationInput } from '../lib/recommendation-input.js';
import { parseFeedbackImage } from '../lib/attachment-upload.js';
import { resolveAiOperationModel } from '../lib/workspace-preferences.js';
import { createDispatchItem } from '../lib/dispatch-factory.js';
import { validateOpaqueDispatchField, MAX_NAME_LENGTH } from '../lib/dispatch-validation.js';
import { generateRecap } from '../lib/recap.js';
import { generateBrief } from '../lib/brief.js';
import { generateScan, parseScanResponse, buildScanMessages, isExplicitRetirementSignal, extractScanPayload } from '../lib/scan.js';
import { generateFeedbackTitle } from '../lib/feedback-title.js';
import { readRunEvidence } from '../lib/run-evidence.js';
import { closeOutSetsDone } from '../lib/run-closeout-state.js';
import { recordMergedPrs } from '../lib/close-out-merges.js';
import { readCloseOutChain, closeOutNotReady, closeOutNotReadyRefusal } from '../lib/close-out-readiness.js';
import { buildContextGraph } from '../lib/context-graph.js';
import { hashContext } from '../lib/recap-cache.js';
import { scanBasisHashFromContext, dueBasisHashFromContext, dueChanged, basisChanged as computeBasisChanged, BASIS_VERSION } from '../lib/scan-fingerprint.js';
import { settleWithConcurrency } from './dashboard.js';
import { getLoopsForIssue } from '../lib/pipeline-loops.js';
import { toSessionView } from '../lib/sessions-view.js';
import { runAudit, computeAuditFromData } from '../lib/audit.js';
import { UUID_REGEX, getWorkspaceToken, resolveIssueBinding, isActiveProviderLinear } from '../lib/workspace.js';
import { resolveStateRef } from '../lib/proxy-ref-resolver.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { requestFeatureFlags } from '../lib/run-controls.js';
import { armKeepalive, armSseKeepalive, clientGoneSignal } from '../lib/http-keepalive.js';
import { testMockData } from '../lib/sample-data/mock-data.js';
import { shouldMockAi } from '../lib/should-mock-ai.js';
import { sendSSE } from '../lib/sse.js';
import { publicOrigin } from '../lib/public-origin.js';
import {
  generateMockRecommendation,
  buildMockRecommendationHop,
  planMockDescent,
  buildMockRecapContext,
  buildMockRecap,
  buildMockBrief,
  buildMockScanText,
  buildMockFeedbackTitle,
  buildMockAuditData,
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

// GET /api/scan-due paging + fan-out bounds (LIN-2649 WS2/S3). Page size
// mirrors BASIS_CHECK_MAX_PER_PAGE (public/observation.js) and its reasoning
// — each check fetches live task context, so N candidates is N provider
// reads. Concurrency mirrors pumpBasisChecks's shape, server-side over the
// DB-sourced candidate list.
const DUE_CHECK_PAGE_SIZE = 40;
const DUE_CHECK_CONCURRENCY = 5;

// ===========================================================================
// Shared steps that need no dependency
// ===========================================================================

const refuseFreeTier = (res, check) => jsonError(res, 429, check.reason, freeTierRefusalBlock(check));

const aiNotConfigured = (res, noun) =>
  jsonError(res, 503, `AI ${noun} is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.`, { code: 'AI_NOT_CONFIGURED' });

// Never let a durable scan record be keyed under a non-canonical fallback
// (LIN-2197 Phase 2 close-out ledger item 3). Spread into jsonError / keepaliveError.
const CANONICAL_ID_REFUSAL = [422, "This task's canonical id could not be resolved; scan requires a canonical identity", { code: 'CANONICAL_ID_REQUIRED' }];

/** The catch tail of the keepalive routes: stop the keepalive, log, and reply through it with the ladder's answer. */
function keepaliveFailure(keepalive, label, error, fallbackMessage, arms) {
  keepalive.stop();
  console.error(label, error);
  keepaliveError(keepalive, ...failureOf(error, fallbackMessage, arms));
}

/**
 * The context a recommend-family route works from: the fixtures under a test token,
 * otherwise the provider's. `missing` is true only when the fixture issue is absent;
 * a provider's answer is taken as given.
 */
async function loadContext(workspace, issueId, { provider, callScope }) {
  if (isTestToken(workspace)) {
    const context = buildMockRecapContext(issueId);
    return { context, missing: !context };
  }
  return { context: await provider.fetchRecommendationContext(callScope, issueId), missing: false };
}

/**
 * The scan routes' common first steps: the task's context and the canonical id a durable
 * scan record is keyed under (LIN-2197 Phase 2 close-out ledger item 3: never a
 * non-canonical fallback). A refusal comes back as `[status, message, extra]` for the
 * route to reply with, plain or through its keepalive.
 */
async function loadScanSubject(workspace, issueId, binding) {
  const { context, missing } = await loadContext(workspace, issueId, binding);
  if (missing) return { refusal: [404, 'Issue not found'] };
  const canonicalId = context.issue?.id || issueId;
  if (!UUID_REGEX.test(canonicalId)) return { refusal: CANONICAL_ID_REFUSAL };
  return { context, canonicalId };
}

/** The non-null slice of a scan row the scan routes return; `raw` keeps absent fields absent (retire, unretire). */
function scanRow(record, { raw = false } = {}) {
  const orNull = (value) => (raw ? value : (value ?? null));
  return {
    id: record.id,
    issueId: record.issueId,
    decision: record.decision,
    scannedAt: record.scannedAt,
    outcome: record.outcome,
    outcomeAt: record.outcomeAt,
    outcomeReason: orNull(record.outcomeReason),
    outcomeBasisHash: orNull(record.outcomeBasisHash),
  };
}

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

// retire's two ways to find the row not stamped, as `[status, message, extras]`
// for the response helpers. `markOutcome` returns null for a row pruned or
// replaced (`_pruneToCapacity`, a superseding scan), and a record that is not
// 'self-resolved' when first-stamp-wins hit an already-terminal row — reachable
// with no client bug, since the route's own re-scan runs before its write and
// leaves a window for a dismiss/answer/earlier retire to land first.
const RETIRE_ROW_GONE = [404, 'This ruling no longer exists — it may have been pruned or superseded by a newer scan', { code: 'ROW_GONE' }];
const RETIRE_ALREADY_TERMINAL = [409, 'This ruling changed while the check was running and was not retired', { code: 'ALREADY_TERMINAL' }];

// The raw model text of retire's re-scan, or null when the scan prompt could not
// be built (the Principle 0 gate was skipped). Deliberately not `generateScan`,
// whose own `has_decision !== true` collapse is right for raising and wrong for
// retiring (see lib/scan.js).
async function rawRetireRescan({ context, workspace, apiKey, model }) {
  const messages = buildScanMessages(context.issue, context);
  if (!messages) return null;
  let text = '';
  await streamChat(
    messages,
    {
      apiKey, model, maxTokens: 1000, temperature: 0,
      callMeta: { feature: 'scan-retire', issueIdentifier: context.issue?.identifier || null, urlKey: workspace?.urlKey }
    },
    (type, data) => { if (type === 'token' && data?.token) text += data.token; }
  );
  return text;
}

// ===========================================================================
// Feedback intake constants (LIN-636 route / LIN-635 widget)
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
// per-route parser below (raised limit) then parses it. LIN-3635: that parser
// matches `text/plain` ONLY — the one type the widget sends — rather than every
// content type, so an arbitrary-type 12mb body is no longer buffered. Small
// `application/json` bodies are already parsed by the global parser (larger
// ones are refused 413 there), so they keep the 250kb ceiling — the exception
// cannot leak to other routes.
// Open question (LIN-3635): the widget caps images at 7 MB (~9.4 MB base64), so
// this could drop to ~10mb; left at 12mb to preserve current behaviour.
const FEEDBACK_BODY_LIMIT = '12mb';

// LIN-3635 (June review M3): per-ACCOUNT request budget on feedback intake, IP
// fallback when there is no session account (same keying as
// `defaultCopyTokenCreationLimiter`, routes/proxy.js). Not per-IP alone: the
// route is session-authenticated, so the abuser is an account and an office NAT
// would share one budget. 5 / 10 min is a judgment call for a human filing
// feedback (<= 30/hour/account, under the 50/hour free-tier net, so one account
// cannot exhaust the net through this route alone); the net's per-account share
// is LIN-3422. Exported so a test can drive the same instance. Mounted BEFORE
// workspaceFromUrl and the body parser; the skip is for the test environment only.
export const feedbackSubmitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feedback submissions, please try again later' },
  keyGenerator: (req) => req.session?.accountId
    ? `account:${req.session.accountId}`
    : ipKeyGenerator(req.ip),
  skip: () => process.env.NODE_ENV === 'test'
});
const MAX_FEEDBACK_IMAGE_BYTES = 10 * 1024 * 1024; // matches the image-proxy ceiling
const MAX_FEEDBACK_MESSAGE_LENGTH = 10_000;
const MAX_FEEDBACK_CONTEXT_LENGTH = 2_000; // url / userAgent clamp

// The three explicit post-create actions the feedback widget can request
// (LIN-918). Anything else (including an omitted action) is the legacy plain
// send, which files the ticket only (LIN-3848 removed the `feedbackTriage` flag).
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
// A scoped kickoff now also appends a non-empty caller `goal` as additional
// context (LIN-2818), but this call site passes none — it threads the framing in
// via the dedicated `originNote` seam, which stays the distinct, system-authored
// carrier. It tells the run the ticket is a raw, un-triaged user report whose
// first job is understanding.
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

// Linear's priority scale is 0 (none) … 4 (low); anything outside it, or not a
// number, files as 0 ("No priority").
function normalizeFeedbackPriority(value) {
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  const inScale = Number.isInteger(parsed) && parsed >= 0 && parsed <= 4;
  return inScale ? parsed : 0;
}

/**
 * The team a feedback ticket is filed under, or null when none can be found (the
 * caller answers that with a 422). First hit wins: an explicit body `teamId`,
 * then the `FEEDBACK_TEAM_ID` env, then the provider's first team.
 */
async function resolveFeedbackTeamId(provider, token, bodyTeamId) {
  const explicit = typeof bodyTeamId === 'string' ? bodyTeamId.trim() : '';
  if (explicit) return explicit;
  if (process.env.FEEDBACK_TEAM_ID) return process.env.FEEDBACK_TEAM_ID;
  const cannotListTeams = typeof provider.supports === 'function' && !provider.supports('fetchTeams');
  if (cannotListTeams) return null;
  try {
    const teams = await provider.fetchTeams(token);
    return (Array.isArray(teams) && teams[0]?.id) || null;
  } catch (err) {
    console.error('Feedback team resolution failed:', err.message);
    return null;
  }
}

// A factory run-limit refusal (LIN-3238) in the M4 feedback-widget shape
// `{ launched:false, code, retryable, message }`. RUN_LIMIT_REACHED is terminal;
// RUN_LIMIT_UNVERIFIED (the count could not be read) is retryable. `null` for
// any other error, so the caller keeps its existing logging path. The ticket is
// already filed — this only says why no run started.
function runLimitRefusal(err) {
  const limit = err ? err.runLimit : null;
  if (!limit) return null;
  return {
    launched: false,
    code: limit.code,
    retryable: isRetryableRunLimit(limit.code),
    message: limit.error
  };
}

// The first 400 a feedback body earns before any provider is consulted, or null:
// the model / harness overrides (LIN-1132), then the message.
function feedbackBodyRefusal({ model, harness, message }) {
  const override = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH })
    || validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
  if (override) return override.error;
  if (!message || typeof message !== 'string' || !message.trim()) return 'message is required';
  if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) return 'message exceeds maximum length';
  return null;
}

// The page URL and browser captured at submit time (LIN-635 S4), as a markdown
// tail for the ticket body. Both come from the client, so each is length-clamped
// and fenced as inline code so it cannot break the body. '' when neither was sent.
function feedbackCaptureBlock({ url, userAgent }) {
  const bullets = [['Page', url], ['Browser', userAgent]]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `- **${label}:** \`${value.trim().slice(0, MAX_FEEDBACK_CONTEXT_LENGTH)}\``);
  return bullets.length ? `\n\n---\n${bullets.join('\n')}` : '';
}

// ===========================================================================
// Close-out helpers (LIN-3248, P3 of LIN-2949)
// ===========================================================================

// A usable close-out/run-evidence identifier: present and at most 100 chars.
const validCloseOutIdentifier = (identifier) => !!identifier && identifier.length <= 100;

// The signed-in person's own session: an authenticated session (workspaceFromUrl
// already required one) and NOT a worker/proxy token. Computed from the
// request, never from the body, so the route can never be handed
// `byPersonCheck: true`.
function isPersonSession(req) {
  return !!req.session?.accountId && !req.proxyTokenId && !req.proxyUrlKey;
}

// Set the tracker issue Done. Resolves the issue's team, its completed
// workflow state, then transitions it. Throws on failure so the caller can
// record the error and retry on the next check.
async function defaultMarkDone({ provider, callScope, issueIdentifier }) {
  const { issue } = await provider.fetchIssueContext(callScope, issueIdentifier);
  const issueRef = issue?.id || issueIdentifier;
  const teamOf = (record) => record?.team?.id || null;

  let teamId = teamOf(issue);
  if (!teamId && typeof provider.issueWriteGuard === 'function') {
    teamId = teamOf(await provider.issueWriteGuard(callScope, issueRef));
  }
  if (!teamId) throw new Error('could not resolve the issue team for Done');

  const states = await provider.states(callScope, teamId);
  const completedId = (states || []).find((state) => state?.type === 'completed')?.id;
  return provider.updateIssue(callScope, issueRef, { stateId: completedId || resolveStateRef(states, 'Done') });
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
export function createWorkspaceApiRoutes({ workspaceFromUrl, freeTierStore, getOpenRouterSource, userPreferencesStore, workspacePreferencesStore, customPromptsStore, recapCacheStore, briefCacheStore, reportHistoryStore, dispatchQueueStore, agentStatusStore, promptTraceStore, proxyTokenStore, taskDecisionsStore, harbourCommentsStore = null, sessionsFeedCache = null, ownerCredentialStore = null, adoptConnectionCredential = null, accountStore = null, runEvidence = null, closeOutEventsStore = null, closeOut = null, workspaceOwnerCheck = null, onTicketWrite = null, installationTokenFor = null }) {
  const router = Router();

  // The test-token DATA mock charges the free tier on its own (the AI-gate above it is
  // scoped to !isTestMode). Returns the denying check, or null when the call may proceed.
  const chargeTestFreeTier = async (workspace, session) => {
    if (!isFlagFreeTier({ sessionApiKey: session.openRouterApiKey, sessionFreeTierFlag: session.freeTierEnabled })) return null;
    const check = await freeTierStore.tryUse(workspace.urlKey);
    return check.allowed ? null : check;
  };

  // LIN-2649 WS2: the ledger-store null guard, in one place for both of its call sites
  // (the scan-time write and the scan-due check). An absent harbourCommentsStore means
  // "we cannot tell which comments are Harbour's", not "no comments changed" — an empty
  // set filters nothing, so the worst case is a false DUE, never a false not-due and
  // never a fabricated unknown (a dueBasisHash stored with the store absent and later
  // compared with one computed while it IS present differs). `harbourCommentsStore`
  // defaults to null in createWorkspaceApiRoutes, and tests/unit/scan-routes.test.js
  // mounts the real router with no ledger store while driving the scan route end to
  // end — an unguarded call would be a TypeError on a shipped route.
  const recordedByHarbour = async (workspace, comments) => (harbourCommentsStore
    ? harbourCommentsStore.wereRecordedByHarbour(workspace.urlKey, comments)
    : new Set());

  // Prompt-traces, custom-prompts and prompt-generation API endpoints (LIN-2246 /
  // LIN-3842: extracted to workspace-api-prompts.js). Mounted first; the groups'
  // literal path prefixes (/prompt-traces, /prompts/custom, /prompt/, /autopilot-prompt)
  // are disjoint from every other group's, so mount order is not load-bearing here.
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
        return res.json(computeAuditFromData(buildMockAuditData()));
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
        return refuseCapability(res, workspace.provider, 'audit', 'this');
      }

      const report = await runAudit(getWorkspaceToken(workspace));
      res.json(report);
    } catch (error) {
      console.error('Audit error:', error);
      jsonError(res, ...failureOf(error, 'Audit failed', { notFound: false }));
    }
  });

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
  registerIssueWriteRoutes(router, { workspaceFromUrl, dispatchQueueStore, taskDecisionsStore, harbourCommentsStore, sessionsFeedCache, ownerCredentialStore, adoptConnectionCredential, onTicketWrite });

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
        agentStatusStore,
        noPrompt: true // toSessionView never reads promptText (LIN-3812)
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

  // The canonical id dismiss and unretire act on. When `:issueId` is already
  // UUID-shaped it IS the canonical id — `markOutcome` filters on `{_id, urlKey,
  // issueId}`, so the row's own stored key is the authority and there is no reason
  // to pay for a provider context fetch just to re-derive an id already in hand.
  // This also fixes the trashed/deleted-task case: a stale ruling on a task the
  // provider can no longer fetch could previously never be dismissed (the fetch
  // 404s before `markOutcome` is ever reached). A non-UUID `:issueId` (an
  // identifier, or a caller that hasn't been updated to pass the canonical id
  // GET/POST scan now return) still resolves it via the context fetch. Returns
  // null after replying when it cannot be resolved.
  const resolveCanonicalScanId = async (req, res, workspace, issueId) => {
    if (UUID_REGEX.test(issueId)) return issueId;

    const binding = resolveIssueBinding(workspace, req.query.source);
    if (!binding.provider.supports('fetchRecommendationContext')) {
      refuseCapability(res, binding.provider.name, 'fetchRecommendationContext', 'scan for this issue');
      return null;
    }

    const subject = await loadScanSubject(workspace, issueId, binding);
    if (subject.refusal) {
      jsonError(res, ...subject.refusal);
      return null;
    }
    return subject.canonicalId;
  };

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
    const issue = openIssue(req, res, { store: taskDecisionsStore, storeName: 'Scan store', capability: 'scan' });
    if (!issue) return;
    const { workspace, issueId } = issue;

    try {
      const subject = await loadScanSubject(workspace, issueId, issue);
      if (subject.refusal) return jsonError(res, ...subject.refusal);
      const { context, canonicalId } = subject;

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
      return res.json({
        status: cached.inputHash !== inputHash ? 'stale' : 'fresh',
        ...scanRow(cached),
        basisChanged
      });
    } catch (error) {
      console.error('Scan GET error:', error);
      jsonError(res, ...failureOf(error, 'Failed to fetch scan status'));
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
    const issue = openIssue(req, res, { store: taskDecisionsStore, storeName: 'Scan store', capability: 'scan' });
    if (!issue) return;
    const { workspace, issueId } = issue;

    // LIN-3126 residual / LIN-3335: persist the validated kind-only `issueSource`
    // onto the durable scan row so a later rulings anchor
    // (lib/unanswered-decisions.js) and a scan-due item can hand the browser the
    // issue's own provider. Only a non-blank source is stored — a legacy scan
    // adds no key (sparse, byte-identical).
    const scanBindingPair = (
      typeof req.query.source === 'string' && req.query.source.trim()
    )
      ? { issueSource: req.query.source.trim() }
      : {};

    // See the recap/brief POST notes: `isTestMode` gates the DATA mock,
    // `mockAi` the AI mock (incl. local-provider sessions), and the
    // AI-config/free-tier guards.
    const mockAi = shouldMockAi(workspace);
    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
    const { apiKey: apiKeyToUse, isFreeTier } = credential;

    if (isAiUnavailable({ credential, mockAi })) {
      return aiNotConfigured(res, 'scan');
    }

    if (!mockAi && isFreeTier) {
      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
      if (check) {
        return refuseFreeTier(res, check);
      }
    }

    // Force-regenerate always calls OpenRouter; arm a Heroku H12 guard.
    const keepalive = armKeepalive(res);
    try {
      const subject = await loadScanSubject(workspace, issueId, issue);
      if (subject.refusal) return keepaliveError(keepalive, ...subject.refusal);
      const { context, canonicalId } = subject;

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
        return keepaliveError(keepalive, 503, 'Scan rubric is temporarily unavailable; nothing was evaluated', {
          code: 'PRINCIPLE_ZERO_UNAVAILABLE'
        });
      }
      if (scanResult.outcome === 'error') {
        // A claimed decision that failed validation, or an unparseable
        // response: persists nothing and asks the operator to retry, rather
        // than risk silently downgrading a real ruling into a zero-finding.
        return keepaliveError(keepalive, 502, 'Scan produced an unusable response; please retry', {
          code: 'SCAN_PARSE_FAILED'
        });
      }

      // LIN-2649 WS2: [C-3] scan-time ledger-store null guard (see recordedByHarbour).
      const recordedCommentIds = await recordedByHarbour(workspace, context.comments);

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
        decision: scanResult.outcome === 'decision' ? scanResult.decision : null,
        // LIN-3126 residual: the issue's own binding pair, stored only when a
        // complete validated selector was supplied (see `scanBindingPair`).
        ...scanBindingPair
      });
      if (!record) {
        return keepaliveError(keepalive, 500, 'Failed to record scan result');
      }

      keepalive.send(200, { status: 'fresh', ...scanRow(record), model: modelUsed });
    } catch (error) {
      keepaliveFailure(keepalive, 'Scan POST error:', error, 'Failed to run scan', { openRouter: true });
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
   * LIN-2197 Phase 5 (Phase 4 close-out ledger item L3): the canonical id comes
   * from resolveCanonicalScanId (UUID fast path; a context fetch otherwise).
   *
   * @route POST /workspace/:urlKey/api/scan/:issueId/dismiss
   * @returns {Object} { status: 'fresh', id, issueId, decision, outcome, outcomeAt, scannedAt }
   */
  router.post('/workspace/:urlKey/api/scan/:issueId/dismiss', workspaceFromUrl, json(), async (req, res) => {
    const found = openIssue(req, res, { recordId: true, store: taskDecisionsStore, storeName: 'Scan store', bind: false });
    if (!found) return;
    const { workspace, issueId, recordId } = found;

    try {
      const canonicalId = await resolveCanonicalScanId(req, res, workspace, issueId);
      if (!canonicalId) return;

      const record = await taskDecisionsStore.markOutcome({
        urlKey: workspace.urlKey, issueId: canonicalId, id: recordId, outcome: 'dismissed'
      });
      if (!record) {
        return notFound.json(res, 'Scan record not found');
      }
      // LIN-2755: uniform invalidation on every ruling write — taskDecisionsStore
      // is read live (not cached), so this is defensive/uniform rather than
      // fixing an observable staleness bug.
      if (sessionsFeedCache) sessionsFeedCache.clear(workspace.urlKey);

      return res.json({ status: 'fresh', ...scanRow(record) });
    } catch (error) {
      console.error('Scan dismiss error:', error);
      jsonError(res, ...failureOf(error, 'Failed to dismiss scan result'));
    }
  });

  /**
   * POST retire (LIN-2650 WS4): re-scan a task SERVER-SIDE and, only if that
   * fresh check finds an EXPLICIT, well-formed "nothing pending" signal,
   * stamp the row named in the request body 'self-resolved'. Never trusts a
   * client-supplied verdict — the ONLY input to the retirement decision is
   * the raw text THIS call's own re-scan produces.
   *
   * Deliberately does NOT call `generateScan`/`recordScan` (John's
   * option-(a) ruling: no second row). It reuses POST scan's first three
   * steps verbatim (provider/capability resolution, `fetchRecommendationContext`,
   * `hashContext`) and then diverges: `buildScanMessages` (same fail-closed
   * discipline as raising) → `streamChat` directly for the raw model text →
   * `isExplicitRetirementSignal(raw)`, never `generateScan`'s own
   * `has_decision !== true` collapse, which is right for raising and wrong
   * for retiring (see `lib/scan.js`). Carries the SAME `mockAi` branch POST
   * scan does, so mock-mode tests can reach both signal shapes deterministically.
   *
   * `markOutcome`'s three return shapes map to three distinct responses —
   * fail loud, never a silent no-op, on a row that changed underneath this
   * call:
   *   - `null` (row pruned/replaced, `_pruneToCapacity` or a superseding
   *     scan) → 404 `ROW_GONE`
   *   - a record with `outcome !== 'self-resolved'` (first-stamp-wins caught
   *     an already-terminal row — reachable without any client bug, since
   *     this route's OWN re-scan runs before its `markOutcome` call, leaving
   *     a window for a dismiss/answer/earlier-retire to land first) → 409
   *     `ALREADY_TERMINAL`
   *   - a record with `outcome === 'self-resolved'` (the write happened) →
   *     200, success shape
   *
   * @route POST /workspace/:urlKey/api/scan/:issueId/retire
   * @body {string} id - the existing row's `_id`, from a prior GET/POST scan result
   * @returns {Object} 200 `{ retired: true, id, issueId, decision, outcome: 'self-resolved',
   *   outcomeAt, outcomeReason, outcomeBasisHash, scannedAt }` on retirement;
   *   200 `{ retired: false, reason }` when the rescan found nothing to retire;
   *   404 `ROW_GONE` / 409 `ALREADY_TERMINAL` on a row that can't be (or
   *   wasn't) stamped; 502 `SCAN_PARSE_FAILED` on a genuine parse/model
   *   failure; 503 `PRINCIPLE_ZERO_UNAVAILABLE` fail-closed — same shapes
   *   POST scan already uses for the latter two.
   */
  router.post('/workspace/:urlKey/api/scan/:issueId/retire', workspaceFromUrl, json(), async (req, res) => {
    const issue = openIssue(req, res, { recordId: true, store: taskDecisionsStore, storeName: 'Scan store', capability: 'scan' });
    if (!issue) return;
    const { workspace, issueId, recordId } = issue;

    const mockAi = shouldMockAi(workspace);
    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
    const { apiKey: apiKeyToUse, isFreeTier } = credential;

    if (isAiUnavailable({ credential, mockAi })) {
      return aiNotConfigured(res, 'scan');
    }
    if (!mockAi && isFreeTier) {
      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
      if (check) {
        return refuseFreeTier(res, check);
      }
    }

    // Retire always re-scans, so — unlike dismiss's UUID fast path — it needs
    // fresh content every time, never just the stored row.
    const keepalive = armKeepalive(res);
    try {
      const subject = await loadScanSubject(workspace, issueId, issue);
      if (subject.refusal) return keepaliveError(keepalive, ...subject.refusal);
      const { context, canonicalId } = subject;

      const inputHash = hashContext(context);
      const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'scan-retire', forceDefault: isFreeTier });

      // The raw text of THIS call's own re-scan is the only input to the
      // retirement decision — nothing the client sent, which is just the row `id`.
      const rescanned = mockAi
        ? buildMockScanText(context)
        : await rawRetireRescan({ context, workspace, apiKey: apiKeyToUse, model });
      if (rescanned === null) {
        // Same fail-closed discipline as raising: no scan prompt without the
        // Principle 0 gate, and the row is untouched when it was skipped.
        return keepaliveError(keepalive, 503, 'Scan rubric is temporarily unavailable; nothing was evaluated', {
          code: 'PRINCIPLE_ZERO_UNAVAILABLE'
        });
      }

      if (!isExplicitRetirementSignal(rescanned)) {
        keepalive.stop();
        // A genuine parse/model failure: the same shape POST scan uses.
        if (extractScanPayload(rescanned).payload === null) {
          return keepaliveError(keepalive, 502, 'Scan produced an unusable response; please retry', { code: 'SCAN_PARSE_FAILED' });
        }
        // A live decision, or absent/malformed input alike — all four of the
        // ticket's negative cases collapse to "leave it standing".
        return keepalive.send(200, { retired: false, reason: 'The rescan did not find an explicit "nothing pending" signal — the ruling stands.' });
      }

      const record = await taskDecisionsStore.markOutcome({
        urlKey: workspace.urlKey, issueId: canonicalId, id: recordId,
        outcome: 'self-resolved',
        outcomeReason: `Retired automatically: a rescan on ${new Date().toISOString()} found no pending decision.`,
        // The same formula as `inputHash`, over the SAME context: "what was
        // checked when this was retired", not a fourth hash scheme.
        outcomeBasisHash: inputHash
      });

      keepalive.stop();
      const unstamped = !record ? RETIRE_ROW_GONE : record.outcome !== 'self-resolved' ? RETIRE_ALREADY_TERMINAL : null;
      if (unstamped) return keepaliveError(keepalive, ...unstamped);

      // LIN-2755: uniform invalidation on every ruling write, only past the race
      // check above (this call's own write must have landed). The store is read
      // live, so this is defensive rather than a fix for observable staleness.
      sessionsFeedCache?.clear(workspace.urlKey);
      return keepalive.send(200, { retired: true, ...scanRow(record, { raw: true }) });
    } catch (error) {
      keepaliveFailure(keepalive, 'Scan retire error:', error, 'Failed to retire scan result', { openRouter: true });
    }
  });

  /**
   * POST unretire (LIN-2650 WS4): reverse a 'self-resolved' outcome, over
   * `reverseOutcome`'s fail-loud thrown-error contract. No re-scan, no LLM
   * call — this route's only job is the reverse write, so it mirrors
   * dismiss's canonical-id resolution (UUID fast path; a context fetch only
   * for a non-UUID `:issueId`), not retire's always-fresh-context shape.
   *
   * @route POST /workspace/:urlKey/api/scan/:issueId/unretire
   * @body {string} id - the row's `_id`
   * @returns {Object} 200 `{ status: 'fresh', id, issueId, decision, outcome: null,
   *   outcomeAt: null, outcomeReason: null, outcomeBasisHash: null, scannedAt }`;
   *   404 `ROW_GONE` when the row is pruned/replaced; 409 `NOT_SELF_RESOLVED`
   *   when it isn't currently self-resolved.
   */
  router.post('/workspace/:urlKey/api/scan/:issueId/unretire', workspaceFromUrl, json(), async (req, res) => {
    const found = openIssue(req, res, { recordId: true, store: taskDecisionsStore, storeName: 'Scan store', bind: false });
    if (!found) return;
    const { workspace, issueId, recordId } = found;

    try {
      const canonicalId = await resolveCanonicalScanId(req, res, workspace, issueId);
      if (!canonicalId) return;

      const record = await taskDecisionsStore.reverseOutcome({ urlKey: workspace.urlKey, issueId: canonicalId, id: recordId });
      // LIN-2755: uniform invalidation on every ruling write — reverseOutcome's
      // fail-loud contract means reaching here is already a genuine success
      // (a failure throws, caught below, never invalidating). taskDecisionsStore
      // is read live (not cached), so this is defensive/uniform rather than
      // fixing an observable staleness bug.
      if (sessionsFeedCache) sessionsFeedCache.clear(workspace.urlKey);

      return res.json({ status: 'fresh', ...scanRow(record, { raw: true }) });
    } catch (error) {
      if (error.message === 'reverseOutcome: row not found (pruned or replaced)') {
        return jsonError(res, 404, 'This ruling no longer exists — it may have been pruned or superseded by a newer scan', { code: 'ROW_GONE' });
      }
      if (error.message === 'reverseOutcome: row is not self-resolved') {
        return jsonError(res, 409, 'This ruling is not currently self-resolved and cannot be un-retired', { code: 'NOT_SELF_RESOLVED' });
      }
      console.error('Scan unretire error:', error);
      jsonError(res, ...failureOf(error, 'Failed to un-retire scan result', { notFound: false }));
    }
  });

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
    // LIN-3240 / LIN-3335: scan-due is a WORKSPACE-LEVEL batch (no :issueId).
    // It uses the source-only default binding, so it never 422s for ambiguity.
    const { provider: issueProvider, callScope: issueCallScope } = resolveIssueBinding(workspace, null);

    if (!taskDecisionsStore) {
      return jsonError(res, 503, 'Scan store not configured');
    }
    // [F-4] Capability gate — once per request, BEFORE any store read or
    // provider call: a provider without fetchRecommendationContext fails the
    // WHOLE page with one clean 422, instead of DUE_CHECK_PAGE_SIZE candidates
    // each 422ing individually. Same resolve-then-gate convention as the scan
    // routes above (and the recommend/recap/brief routes elsewhere in this file).
    if (!issueProvider.supports('fetchRecommendationContext')) {
      return refuseCapability(res, issueProvider.name, 'fetchRecommendationContext', 'scan-due checks');
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

      // LIN-3126 residual / LIN-3335: the row's own kind-only source, recorded when it
      // was scanned, rides the item so the client's bulk-scan POST can forward it
      // (public/observation.js startDueBulkScan). SPARSE — a row with no source emits no key.
      const sourceOf = (row) => (row.issueSource != null ? { source: row.issueSource } : {});

      const results = await settleWithConcurrency(page.items, DUE_CHECK_CONCURRENCY, async (row) => {
        const context = await issueProvider.fetchRecommendationContext(issueCallScope, row.issueId);
        // LIN-2649 WS2 null-ledger guard — this route's second call site of
        // recordedByHarbour: a false DUE at worst, never a false not-due.
        const recordedCommentIds = await recordedByHarbour(workspace, context.comments);
        const currentDueBasisHash = dueBasisHashFromContext(context, { recordedCommentIds });
        return {
          issueId: row.issueId,
          issueIdentifier: row.issueIdentifier,
          dueStatus: dueChanged({
            raisedDueBasisHash: row.dueBasisHash,
            raisedDueBasisVersion: row.dueBasisVersion,
            currentDueBasisHash
          }),
          ...sourceOf(row),
        };
      });

      // Per-item failure isolation: one candidate's provider read rejecting
      // (after the page-level capability check already passed) contributes
      // {dueStatus: null, error: true} for THAT row only — settleWithConcurrency's
      // allSettled shape means every other row and the page's 200 are unaffected.
      const items = results.map((result, i) => result.status === 'fulfilled'
        ? result.value
        : {
            issueId: page.items[i].issueId,
            issueIdentifier: page.items[i].issueIdentifier,
            dueStatus: null,
            error: true,
            ...sourceOf(page.items[i])
          });

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
      keepaliveError(keepalive, 500, 'Failed to fetch scan-due candidates', { message: error.message });
    } finally {
      // Always stop, on the success path, on a settleWithConcurrency rejection
      // (defensive — its allSettled shape shouldn't reject), and on any
      // synchronous throw before the response is sent.
      keepalive.stop();
    }
  });

  // ===========================================================================
  // Feedback intake (LIN-636 route / LIN-635 widget) — constants above
  // ===========================================================================

  const feedbackBodyParser = json({ type: 'text/plain', limit: FEEDBACK_BODY_LIMIT });

  // What both post-create follow-ups hand `attachProxyContext`: the workspace
  // proxy block for the filed ticket. LIN-2354 / LIN-2804: provider identity and
  // capability summary come from the declared provider, fallback-free (unlike
  // the capability-shaping `getProviderForWorkspace` read elsewhere). LIN-1376:
  // `createdBy` stamps the launching account so the dispatched session's token
  // resolves under LIN-1366 owner-scoping.
  function feedbackProxyContext({ workspace, issue, baseUrl, session, label, prompt, harness }) {
    const declared = getProvider(workspace.provider)?.ui ?? null;
    return {
      proxyTokenStore,
      urlKey: workspace.urlKey,
      baseUrl,
      issueIdentifier: issue.identifier,
      prompt,
      label,
      harness,
      providerDisplayName: declared?.displayName ?? null,
      providerUi: declared,
      createdBy: session?.accountId || null
    };
  }

  // Why a follow-up that threw produced no run (LIN-3238 free-tier run limit),
  // logged once and handed back in the widget's `{ launched:false, ... }` shape.
  // `null` for any failure the caller should log as a plain enqueue error.
  function reportUnlaunched(lane, err, workspace, issue) {
    const refusal = runLimitRefusal(err);
    if (!refusal) return null;
    console.warn(`Feedback ${lane} not launched: ${refusal.code} (urlKey=${workspace.urlKey}, issue=${issue.identifier})`);
    return refusal;
  }

  // Best-effort triage follow-up after a feedback ticket is filed (LIN-635 S6),
  // on the existing dispatch substrate. Non-fatal: the ticket already exists, so
  // a failure here must not fail the submission. The caller invokes it only for
  // the explicit 'triage' action (LIN-733; the `feedbackTriage` flag was removed
  // in LIN-3848); the prompt always carries this workspace's API proxy block, as the proxy dispatch
  // endpoints' preamble does.
  async function enqueueFeedbackTriage(workspace, issue, priority, session, baseUrl, overrides = {}) {
    if (!dispatchQueueStore || !issue?.identifier) return;
    try {
      const { prompt: basePrompt } = generatePrompt(
        'triage',
        { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url, state: issue.state, priority, labels: [] },
        { project: null, parent: null, siblings: [] },
        {},
        getProviderForWorkspace(workspace)?.ui || null
      ) || {};
      if (!basePrompt) return;

      // LIN-1139 factory: model/harness resolve from workspace dispatchDefaults
      // (LIN-1138 — no user-supplied pair here beyond the widget override below,
      // LIN-1132) and a blank harness interposes claude-code (LIN-1164). The
      // proxy block is appended inside finalizePrompt, after the harness is
      // known, so its MCP-token-vs-prose branch can follow it (LIN-1155); a
      // single-use bootstrap token is minted per dispatch (LIN-376) and a failed
      // mint leaves the prompt unchanged, so triage still dispatches.
      await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: workspace.urlKey,
        workspacePreferencesStore,
        proxyTokenStore,
        kind: 'triage',
        // LIN-3238 free-tier run gate, built by the route at the dispatch point;
        // a refusal leaves the filed ticket intact.
        runGate: overrides.runGate || null,
        model: overrides.model,
        harness: overrides.harness,
        finalizePrompt: (harness) => attachProxyContext(
          feedbackProxyContext({ workspace, issue, baseUrl, session, harness, prompt: basePrompt, label: 'feedback-triage' })
        ),
        fields: {
          promptName: 'Triage',
          issueId: issue.id || null,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title || null,
          issueUrl: issue.url || null,
          dispatchedBy: session?.accountId || null,
          target: 'cli',
          // LIN-3126 residual / LIN-3335: the created issue's own kind-only source,
          // so a reply/Close out on this run resolves the same provider. `?? null`,
          // never a `fields` spread (the LIN-3138 census forbids one here).
          issueSource: overrides.bindingPair?.issueSource ?? null
        }
      });
      return null;
    } catch (err) {
      const unlaunched = reportUnlaunched('triage', err, workspace, issue);
      if (unlaunched) return unlaunched;
      console.error('Feedback triage enqueue failed:', err.message);
      return null;
    }
  }

  // Best-effort autopilot follow-up (LIN-918): a SCOPED kickoff for the new
  // ticket carrying the feedback-origin brief through the dedicated `originNote`
  // seam (LIN-2818 lets a kickoff also take a caller `goal`; this system-authored
  // framing stays separate). Same substrate as triage with `kind: 'autopilot'`,
  // and not flag-gated — the user chose it in the widget. The kickoff relies on
  // the +proxy block for API access, so `attachProxyContext` (LIN-1157) mints it
  // here; the store appends the autopilot session-id block.
  //
  // LIN-3136 M4: the run holds the dispatch grant, owner-checked for the
  // submitting session. Resolves `{ launched: true }`, or `{ launched: false,
  // code, retryable, message }` when the run limit or that owner-checked mint
  // refuses (no grant-less fallback); every other failure is swallowed as null.
  async function enqueueFeedbackAutopilot(workspace, issue, session, baseUrl, overrides = {}) {
    if (!dispatchQueueStore || !issue?.identifier || !baseUrl) return null;
    try {
      const kickoff = buildAutopilotKickoff({
        baseUrl,
        issue: { identifier: issue.identifier, title: issue.title },
        originNote: FEEDBACK_AUTOPILOT_ORIGIN_NOTE,
        providerUi: getProvider(workspace.provider)?.ui ?? null
      });

      // Same factory contract as the triage twin: LIN-1139/1138 defaults, the
      // LIN-1164 harness interpose, LIN-376 single-use bootstrap minted inside
      // finalizePrompt once the harness is resolved (LIN-1155).
      await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: workspace.urlKey,
        workspacePreferencesStore,
        proxyTokenStore,
        kind: 'autopilot',
        // LIN-3238: a refusal leaves the filed ticket intact and mints nothing.
        runGate: overrides.runGate || null,
        model: overrides.model,
        harness: overrides.harness,
        finalizePrompt: (harness) => attachProxyContext({
          ...feedbackProxyContext({ workspace, issue, baseUrl, session, harness, prompt: kickoff, label: 'feedback-autopilot' }),
          // LIN-3136 M4: an orchestrator launch, owner-checked for this session.
          declaredGrants: ['dispatch'],
          declaredSite: 'M4',
          grantOwnerAccountId: session?.accountId || null,
          workspaceId: workspace.id
        }),
        fields: {
          promptName: `Autopilot — ${issue.identifier}`,
          issueId: issue.id || null,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title || null,
          issueUrl: issue.url || null,
          dispatchedBy: session?.accountId || null,
          target: 'cli',
          // Same created-issue kind-only source as the triage twin (LIN-3126/3335).
          issueSource: overrides.bindingPair?.issueSource ?? null
        }
      });
      return { launched: true };
    } catch (err) {
      // The run-limit check precedes the grant branch: a run-limit THROW is not
      // a coded grant refusal.
      const unlaunched = reportUnlaunched('autopilot', err, workspace, issue);
      if (unlaunched) return unlaunched;
      if (isCodedGrantRefusal(err)) {
        const refusal = codedGrantRefusalResponse(err, 'an autopilot launch credential');
        console.warn(`Feedback autopilot not launched: ${refusal.code} (urlKey=${workspace.urlKey}, issue=${issue.identifier})`);
        return { launched: false, code: refusal.code, retryable: refusal.retryable, message: refusal.error };
      }
      console.error('Feedback autopilot enqueue failed:', err.message);
      return null;
    }
  }

  // Title resolution (LIN-643). An explicit title always wins (trimmed to
  // 250). Otherwise: when AI is enabled for this user/workspace, generate a
  // concise whole-thought title from the feedback body via the LLM; when AI
  // is off — or generation fails — keep the deterministic first-line slice.
  // Title generation must happen BEFORE provider.createIssue, and never
  // applies the 60-char truncation on the AI path. The post-create triage
  // enqueue is untouched. LIN-3635: the live LLM call is charged to the hourly
  // free-tier net (`checkFreeTierGate`) when it would bill the shared key; a
  // refusal or gate fault keeps the first-line title (the ticket is never
  // refused). Explicit titles and the mock path spend nothing, so are not charged.
  async function resolveFeedbackTitle(req, workspace, { title, message }) {
    if (typeof title === 'string' && title.trim()) {
      return title.trim().slice(0, 250);
    }
    let ticketTitle = `Feedback: ${message.trim().split('\n')[0].slice(0, 60)}`;
    // Key resolution mirrors the recommendation path: user OAuth > env >
    // free-tier. When only the shared free-tier key is available the model
    // is clamped to DEFAULT (forceDefault: isFreeTier), matching every other
    // billed call site (the LIN-513 wiring invariant).
    const mockAi = shouldMockAi(workspace);
    const { apiKey: aiApiKey, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session?.openRouterApiKey });
    if (mockAi || aiApiKey) {
      try {
        if (mockAi) {
          // LIN-2981: a test-mode/local session never reaches the live
          // streamChat call this wraps, matching the other AI call sites in
          // this file that already branch on shouldMockAi.
          ticketTitle = buildMockFeedbackTitle(message);
        } else {
          // A throw from the gate (store fault) lands in the catch below:
          // fail closed, no LLM call, fallback title.
          const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
          if (check) {
            console.warn(`Feedback AI title skipped, free-tier gate refused (urlKey=${workspace.urlKey}): ${check.reason}`);
            return ticketTitle;
          }
          const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'feedback-title', forceDefault: isFreeTier });
          const generated = await generateFeedbackTitle(message.trim(), { apiKey: aiApiKey, model, callMeta: { urlKey: workspace.urlKey } });
          if (generated) ticketTitle = generated;
        }
      } catch (error) {
        // Best-effort: never block ticket creation on title generation.
        console.error('Feedback AI title generation failed, using fallback:', error.message);
      }
    }
    return ticketTitle;
  }

  /**
   * Submit feedback as a new ticket, optionally with an embedded screenshot,
   * then run the widget's chosen post-create action (save / triage / autopilot).
   * @route POST /workspace/:urlKey/api/feedback
   */
  router.post('/workspace/:urlKey/api/feedback', feedbackSubmitLimiter, workspaceFromUrl, feedbackBodyParser, async (req, res) => {
    const { workspace } = req;
    // LIN-3240 (LIN-3126 §2) / LIN-3335: creation targets the workspace's default
    // (active) binding; the pair-era selector is gone, so `null` is the
    // source-only default. Provider call scope: a bare token for Linear/local
    // (byte-identical), or a { token, repo } GitHub App credential so createIssue
    // builds a request-time client from the installation token (LIN-713).
    // uploadFile is capability-gated off for GitHub; fetchTeams (via
    // resolveFeedbackTeamId) ignores its arg.
    const { provider, callScope: token } = resolveIssueBinding(workspace, null);
    const body = req.body || {};

    // The 400s that need no provider, first-error order: the widget's optional
    // per-dispatch model / harness overrides (LIN-1132) — checked with the opaque-
    // field helper the dispatch and proxy routes use (type, length, dangerous
    // characters; NOT a model registry; blank or absent is valid and falls
    // through to the factory's default) — then the message itself.
    const bodyRefusal = feedbackBodyRefusal(body);
    if (bodyRefusal) return badRequest.json(res, bodyRefusal);
    const { message, title, teamId, projectId, image, url, userAgent, model, harness } = body;
    const priority = normalizeFeedbackPriority(body.priority);

    // Clean 422 (never 500) when the workspace's provider can't do the op,
    // mirroring the proxy write surface.
    if (!provider.supports('createIssue')) {
      return refuseCapability(res, provider.name, 'createIssue', 'creating tickets');
    }
    if (image && !provider.supports('uploadFile')) {
      return refuseCapability(res, provider.name, 'uploadFile', 'file uploads');
    }

    const resolvedTeamId = await resolveFeedbackTeamId(provider, token, teamId);
    if (!resolvedTeamId) {
      return jsonError(res, 422, 'Could not resolve a team to file feedback against', {
        code: 'TEAM_UNRESOLVED', provider: provider.name,
      });
    }
    const resolvedProjectId = (typeof projectId === 'string' && projectId.trim()) || process.env.FEEDBACK_PROJECT_ID || null;

    try {
      // The message, then the page / browser capture block (LIN-635 S4).
      const parts = [message.trim() + feedbackCaptureBlock({ url, userAgent })];

      if (image) {
        const parsed = parseFeedbackImage(image);
        if (!parsed) return badRequest.json(res, 'image must be a base64 data URL');
        if (parsed.bytes.length > MAX_FEEDBACK_IMAGE_BYTES) return jsonError(res, 413, 'image too large');
        const assetUrl = await provider.uploadFile(token, parsed.bytes, {
          contentType: parsed.contentType,
          filename: parsed.filename,
        });
        parts.push(`![](${assetUrl})`);
      }

      // LIN-1557: an explicit non-default priority the provider's headless write
      // contract (apiWriteFields()) can't honour is folded into the description as
      // visible text, not dropped silently or refused — this is a fire-and-forget
      // human form with no retry loop, so a hard failure would mean the report is
      // never filed. 0 ("No priority") is indistinguishable from "unset", so it is
      // never folded or forwarded.
      const canSetPriority = provider.apiWriteFields().includes('priority');
      if (priority > 0 && !canSetPriority) {
        parts.push(`---\n**Reported priority:** ${PRIORITY_OPTION_LABELS[priority]}`);
      }

      // Origin/triage marker (LIN-947): always last, so the stored ticket announces
      // itself as raw, un-triaged feedback and the meta-prompt's triage routing
      // activates. It never alters the message, capture block or screenshot above.
      parts.push(`---\n${FEEDBACK_ORIGIN_TRIAGE_MARKER}`);

      const createInput = {
        teamId: resolvedTeamId,
        title: await resolveFeedbackTitle(req, workspace, { title, message }),
        description: parts.join('\n\n'),
      };
      if (resolvedProjectId) createInput.projectId = resolvedProjectId;
      if (priority > 0 && canSetPriority) createInput.priority = priority;

      const created = await provider.createIssue(token, createInput);
      if (!created?.success || !created.issue) {
        return jsonError(res, 502, 'Failed to create feedback ticket');
      }

      // Post-create action (LIN-918); every branch is best-effort and never fails
      // the submission, the ticket already existing. An explicit widget action picks the lane: 'save' files only,
      // 'triage' always enqueues triage, 'autopilot' enqueues a scoped autopilot run
      // carrying the feedback-origin brief. With none (the legacy plain send) the
      // ticket is filed only (LIN-3848).
      const baseUrl = publicOrigin(req);
      // LIN-3238 Q10 free-tier run gate: the title step's `isFreeTier` is scoped to
      // it, so re-derive it at the dispatch point. It goes to both enqueue helpers
      // through `overrides`; a refusal leaves the filed ticket intact and reports
      // why no run started.
      const { isFreeTier: feedbackIsFreeTier } = resolveChatCredential({ sessionApiKey: req.session?.openRouterApiKey });
      const runGate = buildRunGate({ isFreeTier: feedbackIsFreeTier, freeTierStore, accountId: req.session?.accountId, accountStore });
      // LIN-3126 residual (producer sweep) / LIN-3335: the feedback rows are
      // issue-addressed and never reach the factory's §5.5a source inheritance (no
      // `followUpTo`), so each carries the created issue's kind-only source — from
      // the SAME resolved binding that produced `provider` / `token`, so the source
      // the issue is created in and the stamped one cannot drift. Selection-only
      // provenance, never a credential (B1).
      const overrides = { model, harness, runGate, bindingPair: provider?.name ? { issueSource: provider.name } : {} };

      // LIN-3383: both lanes enqueue a `cli` row for the owner's runner, so only the
      // workspace owner may start one. Checked only when a lane will actually run —
      // a plain filed ticket reports no refusal and a non-owner's feedback still
      // saves. A refusal skips the enqueue and rides the `{launched:false, code,
      // retryable, message}` response block below.
      // Only the three known actions branch (`save` names no lane); anything else,
      // an omitted action included, is the legacy plain send.
      const action = FEEDBACK_ACTIONS.has(body.action) ? body.action : null;
      const lane = action === 'save' ? null : action;
      const laneRefusal = lane && await resolveRunnerOwnerRefusal({
        ownerCheck: workspaceOwnerCheck,
        workspaceId: workspace.id,
        accountId: req.session?.accountId,
        target: 'cli'
      });
      let launch = null;
      if (laneRefusal) {
        launch = { launched: false, code: laneRefusal.code, retryable: laneRefusal.retryable, message: laneRefusal.error };
      } else if (lane === 'triage') {
        launch = await enqueueFeedbackTriage(workspace, created.issue, priority, req.session, baseUrl, overrides);
      } else if (lane === 'autopilot') {
        launch = await enqueueFeedbackAutopilot(workspace, created.issue, req.session, baseUrl, overrides);
      }

      // LIN-3136 M4 / LIN-3238: the ticket is filed either way. A refused run launch
      // (autopilot keeps its key, triage gets a new one) is reported so the widget
      // can say why; every other outcome leaves the response as it was.
      return res.status(201).json({
        success: true,
        issue: created.issue,
        ...(launch?.launched === false ? { [lane]: launch } : {})
      });
    } catch (error) {
      console.error('Feedback submit error:', error);
      return jsonError(res, 500, 'Failed to submit feedback');
    }
  });

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

  /**
   * Run evidence (LIN-3247, P2 of LIN-2949). The data half of the page seam:
   * returns `{ state, evidence, ledger, closeOut }` for a run's issue. The PR
   * URL comes from the run's OWN tracker comments (newest first); the live PR
   * state comes from the shared fail-open reader (never throws — unreadable →
   * `state: 'unknown'`). This fabricates nothing: `deriveCloseOutState` and the
   * press are P3.
   *
   * @route GET /workspace/:urlKey/api/run-evidence/:issueIdentifier
   */
  router.get('/workspace/:urlKey/api/run-evidence/:issueIdentifier', workspaceFromUrl, async (req, res) => {
    const { issueIdentifier } = req.params;
    if (!validCloseOutIdentifier(issueIdentifier)) return badRequest.json(res, 'Invalid issue identifier');

    const seam = runEvidence || {};
    const source = typeof req.query.source === 'string' ? req.query.source : null;
    try {
      const { provider, callScope } = (seam.resolveProvider || resolveIssueBinding)(req.workspace, source);
      const { state, evidence, ledger, closeOut: closeOutModel } = await readRunEvidence({
        issueIdentifier,
        provider,
        callScope,
        viewerIsOwner: (seam.viewerIsOwner || (() => true))(req),
        urlKey: req.workspace.urlKey,
        workspaceId: req.workspace.id,
        installationTokenFor,
        readPrStatus: seam.readPrStatus || undefined,
        githubFetch: seam.githubFetch || null,
      });
      res.json({ state, evidence, ledger, closeOut: closeOutModel });
    } catch (error) {
      console.error('Run evidence error:', error);
      jsonError(res, 500, 'Failed to build run evidence', { message: error.message });
    }
  });

  // ===========================================================================
  // Close-out (LIN-3248, P3 of LIN-2949)
  // ===========================================================================

  // Answers the close-out POST routes' two refusals — a bad identifier, then a
  // caller that is not the signed-in person's own session (never a worker or
  // proxy token) — and says whether it answered.
  function refusedCloseOutRequest(req, res, what) {
    if (!validCloseOutIdentifier(req.params.issueIdentifier)) {
      badRequest.json(res, 'Invalid issue identifier');
    } else if (!req.session?.accountId) {
      unauthorized.json(res, 'Not authenticated');
    } else if (!isPersonSession(req)) {
      jsonError(res, 403, `The close-out ${what} must use the signed-in person's own session`, { code: 'PERSON_SESSION_REQUIRED' });
    } else {
      return false;
    }
    return true;
  }

  // Stamp the merge's Done outcome on its stored event (when there is one).
  const stampMergeDone = (workspace, mergedEvent, outcome) => (
    mergedEvent && closeOutEventsStore
      ? closeOutEventsStore.stampDone({
        urlKey: workspace.urlKey, prUrl: mergedEvent.prUrl, headSha: mergedEvent.headSha, by: mergedEvent.by, ...outcome,
      })
      : null
  );

  // R1: set Done only when all four bounds hold (the caller checks them). F2: write
  // it once per merge — skip when this merge already carries a successful `doneAt`,
  // and retry only after a failed attempt. Returns what the response reports.
  async function settleDone({ workspace, provider, callScope, issueIdentifier, seam, mergedEvent }) {
    if (mergedEvent?.doneAt) {
      // already written for this merge; never repeat the provider write
      return { done: true, doneNow: false, doneError: null, mergedEvent };
    }
    try {
      const written = await (seam.markDone || defaultMarkDone)({ provider, callScope, issueIdentifier });
      // Seam 3 (LIN-3366): fires only on this fresh write, never on the
      // `doneAt` branch above, so a merge that already carries `doneAt` never
      // re-fires. `defaultMarkDone` returns `{success, issue}`; the helper unwraps.
      if (onTicketWrite) {
        void Promise.resolve()
          .then(() => onTicketWrite({ urlKey: workspace.urlKey, written, readBack: () => provider.fetchIssueContext(callScope, issueIdentifier) }))
          .catch(e => console.error('[ticket-closer] seam 3 failure:', e?.message || e));
      }
      const stamped = await stampMergeDone(workspace, mergedEvent, { doneAt: new Date(), doneError: null });
      return { done: true, doneNow: true, doneError: null, mergedEvent: stamped || mergedEvent };
    } catch (err) {
      const doneError = err?.message || 'could not set the task Done';
      await stampMergeDone(workspace, mergedEvent, { doneAt: null, doneError });
      return { done: false, doneNow: false, doneError, mergedEvent };
    }
  }

  /**
   * Close-out check (LIN-3248, P3 of LIN-2949). The page calls this on load and
   * on tab focus, only while the close-out state is `ready`. It re-reads the PR
   * live, derives the close-out state with `deriveCloseOutState` (never P2's
   * looser `closeOut.status`), records a `{ by: 'person' }` event when a PR is
   * merged, and sets Done only within R1's bounds — all on the signed-in
   * person's own provider session, never a worker or proxy token. Returns
   * `done` (a Done is recorded for the merge) and `doneNow` (THIS call wrote
   * the tracker's Done) so the client reloads only on the real transition.
   *
   * @route POST /workspace/:urlKey/api/run-evidence/:issueIdentifier/check
   */
  router.post('/workspace/:urlKey/api/run-evidence/:issueIdentifier/check', workspaceFromUrl, json(), async (req, res) => {
    if (refusedCloseOutRequest(req, res, 'check')) return;

    const { workspace } = req;
    const { issueIdentifier } = req.params;
    const seam = closeOut || {};
    const source = [req.body?.source, req.query.source].find((v) => typeof v === 'string') ?? null;

    try {
      // LIN-3634: the read chain is `lib/close-out-readiness.js`, shared with the
      // dispatch guard. Same order as before: comments, PR urls, every PR status,
      // ledger, stop-at, then `deriveCloseOutState`.
      const { provider, callScope, prUrls, prStatuses, ledger, stopAt, state } = await readCloseOutChain({
        workspace,
        issueIdentifier,
        source,
        store: dispatchQueueStore,
        seam,
        runnerReady: seam.runnerReady ? !!seam.runnerReady(req) : (await requestFeatureFlags(req)).runControls === true,
        owner: true,
        byPersonCheck: true,
        installationTokenFor,
      });

      // B1' (review `a1845467`): `done` is true on EVERY later call once a merge
      // is recorded, so a client that reloads on `done` loops on a reopened task
      // (Done recorded, tracker back to In Progress). `doneNow` is true only on
      // the call that actually wrote the provider's Done, so the client reloads
      // on the real transition, never on a page that merely reports the record.
      let outcome = { done: false, doneNow: false, doneError: null };
      let recorded = [];

      // Close-out is a stop-at-PR surface only: a normal run records and sets
      // nothing here.
      if (stopAt === 'pr') {
        const merges = await recordMergedPrs({ store: closeOutEventsStore, workspace, accountId: req.session.accountId, issueIdentifier, prUrls, prStatuses, ledger });
        recorded = merges.recorded;
        let { mergedEvent } = merges;

        const prIndex = Math.max(merges.mergedPrIndex, 0);
        if (state.status === 'merged' && closeOutSetsDone({ prStatuses, prIndex, review: ledger, byPersonCheck: true })) {
          ({ mergedEvent, ...outcome } = await settleDone({ workspace, provider, callScope, issueIdentifier, seam, mergedEvent }));
        }

        // Show a press-then-merge as a close-out merge.
        if (mergedEvent?.by === 'close-out') {
          state.mergedBy = 'close-out';
          state.message = 'the pull request was merged by close-out';
        }
      }

      return res.json({ state, recorded, done: outcome.done, doneNow: outcome.doneNow, doneError: outcome.doneError });
    } catch (error) {
      console.error('Close-out check error:', error);
      jsonError(res, 500, 'Failed to check close-out state', { message: error.message });
    }
  });

  /**
   * Close-out press record (LIN-3248, P3 of LIN-2949). The press itself goes
   * through the existing dispatch path (GET /api/prompt/:issueId/close-out +
   * window.dispatchPrompt); this route only records what that path dispatched.
   * No new dispatch route.
   *
   * @route POST /workspace/:urlKey/api/run-evidence/:issueIdentifier/close-out-press
   */
  router.post('/workspace/:urlKey/api/run-evidence/:issueIdentifier/close-out-press', workspaceFromUrl, json(), async (req, res) => {
    if (refusedCloseOutRequest(req, res, 'press')) return;

    const { urlKey } = req.workspace;
    const { prUrl, headSha, dispatchId } = req.body || {};
    try {
      // LIN-3395: once the PR's merge is on record, a press (e.g. from a stale
      // tab after a self-merge) is refused before anything is written, so the
      // next check cannot add a second `close-out` event or a second Done write.
      if (closeOutEventsStore && await closeOutEventsStore.hasMergedEvent({ urlKey, prUrl })) {
        return jsonError(res, 409, 'This pull request is already merged; the close-out press was not recorded', { code: 'CLOSE_OUT_ALREADY_MERGED' });
      }
      // LIN-3657: the dispatch lane refuses a head-moved close-out (LIN-3634); the
      // press asks the same question so it never records one. The guard keeps
      // `closeOutNotReady`'s scope (the task's sole open PR, not `prUrl`) and fails
      // open on an unreadable read. Source: the request's, else the named dispatch
      // row's (the clients' press body carries none; the row is what their dispatch
      // call stamped), and only when that row is this task's.
      let source = [req.body?.source, req.query.source].find((v) => typeof v === 'string') ?? null;
      if (source === null && typeof dispatchId === 'string' && typeof dispatchQueueStore?.getItemStatus === 'function') {
        const row = await Promise.resolve(dispatchQueueStore.getItemStatus(urlKey, dispatchId)).catch(() => null);
        if (row?.issueIdentifier === req.params.issueIdentifier) source = row.issueSource ?? null;
      }
      const notReady = await closeOutNotReady({ workspace: req.workspace, issueIdentifier: req.params.issueIdentifier, source, store: dispatchQueueStore, seam: closeOut || {}, installationTokenFor });
      if (notReady) {
        const refusal = closeOutNotReadyRefusal(notReady);
        return jsonError(res, 409, refusal.error, refusal.extra);
      }
      const event = closeOutEventsStore && await closeOutEventsStore.record({
        accountId: req.session.accountId,
        urlKey,
        issueId: null,
        issueIdentifier: req.params.issueIdentifier,
        by: 'press',
        dispatchId,
        prUrl,
        headSha: headSha ?? null,
        merged: false,
        openItems: { inside: 0, outside: 0, unknown: 0, total: 0 },
      });
      if (!event) return badRequest.json(res, 'Invalid close-out press');
      return res.status(201).json({
        success: true,
        event: { id: event._id, by: event.by, dispatchId: event.dispatchId, prUrl: event.prUrl, headSha: event.headSha },
      });
    } catch (error) {
      console.error('Close-out press record error:', error);
      jsonError(res, 500, 'Failed to record close-out press', { message: error.message });
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
