/**
 * Linear API proxy routes.
 *
 * Two types of endpoints:
 * 1. User-facing API (workspace-prefixed, session auth):
 *    - Token management (CRUD)
 *    - Event log listing
 *
 * 2. Consumer API (proxy token auth):
 *    - Read endpoints (viewer, teams, projects, issues, search, etc.)
 *    - Write endpoints (create/update issues, comments, relations, labels)
 *    - Agent instructions endpoint (llms.txt)
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createDedupeCache, dedupeKey } from '../lib/proxy-dedupe.js';
import { deriveTerminalStatus, deriveCompletedAt } from '../lib/dispatch-terminal.js';
// The entire consumer-API surface — reads (LIN-308), writes + write-guard reads
// (LIN-309), and the compute-endpoint fetchers — sources through a provider; the
// route owns no GraphQL. Provider SELECTION for the consumer read + write data
// API is per-workspace (LIN-581): resolveProviderAccess resolves the active
// provider from the workspace's own `provider` field via getProviderForWorkspace
// (the same resolution the dashboard render surfaces use), so the route holds NO
// Linear-bound read imports on its data path — `localProvider` (or any other
// registered provider) can back `/api/proxy/*` for its workspace, and the
// capability gate (provider.supports -> 422) is now a real runtime path, not
// only a test-injected one. The lib/linear.js shim stays the frozen back-compat
// surface for the dashboard fetchers only.
//
// The compute/task-automation fetchers (fetchProjects/fetchIssueContext/
// fetchRecommendationContext) remain statically Linear-bound: they feed the
// LLM-driven stack/recommend/recap/brief/prompt endpoints, not the read data
// path, and are out of scope for the per-workspace selection work (LIN-581).
import {
  fetchProjects, fetchIssueContext, fetchRecommendationContext,
} from '../lib/providers/linear/index.js';
import { localProvider } from '../lib/providers/local/index.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
import { applyTrashedSignal, isTrashed } from '../lib/trashed-signal.js';
import { flattenIssue, neutralizeProject, flattenCycle, flattenRelations, decodeAttachmentHandle, relayContentTypeFromName, GITHUB_UPLOAD_HOSTS, collectIssueAttachments } from '../lib/proxy-wire.js';
import { createProxyFetch } from '../lib/proxy-fetch.js';
import { isRecommendationEnabled, getRecommendation } from '../lib/openrouter.js';
import { resolveRecommendation, describeDescent, armHopSignal } from '../lib/recommend-recurse.js';
import { resolveWorkspaceModel } from '../lib/workspace-preferences.js';
import { generateRecap } from '../lib/recap.js';
import { generateBrief } from '../lib/brief.js';
import { hashContext } from '../lib/recap-cache.js';
import { snapshotFromContext } from '../lib/task-snapshot-store.js';
import { buildForest, partitionCompleted, buildInProgressForest, buildRecentActivityForest, isTerminalState, isBlocked, NO_PROJECT_ID } from '../lib/tree.js';
import { flattenTrees, sortIssuesForSwipe, applyBlockingOrder, clusterByParent, computeGraphFeatures, computeOffPageBlockers, buildWhy } from '../lib/render-swipe.js';
import { generatePrompt, hasPrompt, isValidDispatchKind, deriveDispatchKind, getPromptDisplayName, PROMPT_TEMPLATES, DISPATCH_KINDS } from '../lib/prompt-templates.js';
import { parseRepoFromDescription, buildPromptFilename } from '../lib/prompt-formatters.js';
import { buildProxyContextPreamble } from '../lib/proxy-preamble.js';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT, AUTOPILOT_VARIANTS, AUTOPILOT_VARIANT_DEFAULT } from '../lib/prompts/autopilot-kickoff.js';
import { buildAutopilotManual } from '../lib/prompts/autopilot-manual.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { UUID_REGEX, isValidIssueId } from '../lib/workspace.js';
import {
  parseSourceNamespace,
  resolveStateRef,
  resolveLabelRef,
  resolveProjectRef,
  resolveTeamRef,
  RefResolutionError,
} from '../lib/proxy-ref-resolver.js';
import { appendBlock, replace as replaceInDescription, DescriptionEditError } from '../lib/description-edit.js';
import { badRequest, jsonError, notFound, unauthorized, workspaceUnavailableEnvelope } from '../lib/errors.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';

/**
 * Resolve the OpenRouter credentials for a proxy LLM call, mirroring
 * resolveRoadmapLLM (routes/workspace-api.js). Free tier is used ONLY when there
 * is no token-creator OAuth key (`sessionApiKey`) and no server `OPENROUTER_API_KEY`,
 * but `OPENROUTER_FREE_TIER_KEY` is set. `apiKey` is left undefined on the env-key
 * path so getRecommendation/generateRecap/generateBrief fall back to
 * `process.env.OPENROUTER_API_KEY` exactly as before — paid/OAuth/env behavior is
 * unchanged. Model resolution stays on resolveWorkspaceModel; the returned
 * `isFreeTier` is threaded into resolveWorkspaceModel as `forceDefault` at each
 * billed call site so free-tier requests clamp to DEFAULT_MODEL (LIN-513).
 * @param {string|null|undefined} sessionApiKey - Token-creator's OAuth key, if any.
 * @returns {{ apiKey: (string|undefined), isFreeTier: boolean }}
 */
export function resolveProxyLLM(sessionApiKey) {
  const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
  const isFreeTier = !sessionApiKey && !process.env.OPENROUTER_API_KEY && !!freeTierKey;
  const apiKey = sessionApiKey || (isFreeTier ? freeTierKey : undefined);
  return { apiKey, isFreeTier };
}

// Lazy-load test fixtures only in test mode to avoid production dependency on test files
let testMockData = null;
async function getTestMockData() {
  if (!testMockData) {
    const mod = await import('../tests/fixtures/mock-data.js');
    testMockData = mod.testMockData;
  }
  return testMockData;
}

/**
 * Resolve the issue + prompt context for deterministic, server-side prompt
 * generation. This is the shared seam behind both GET .../prompt/:templateKey
 * and the recommend-and-dispatch `kind` override (LIN-573): the caller picks the
 * verb, the server writes the body via generatePrompt(...) over this context.
 *
 * Returns { issue, parent, siblings, project, children, comments } shaped exactly
 * as the /prompt handler expects, or null when the issue can't be found in test
 * mode. In live mode fetchIssueContext throws on a missing issue; callers map
 * that to a 404.
 */
async function resolvePromptIssueContext(accessToken, identifier, isTestMode) {
  if (isTestMode) {
    const mockData = await getTestMockData();
    const mockIssue = mockData.issues.find(i =>
      i.id === identifier || i.identifier === identifier
    );
    if (!mockIssue) return null;
    const mockProject = mockData.projects.find(p => p.id === mockIssue.project?.id);
    return {
      issue: {
        id: mockIssue.id,
        identifier: mockIssue.identifier || 'TEST-1',
        title: mockIssue.title,
        description: mockIssue.description || '',
        state: mockIssue.state || { name: 'Todo', type: 'unstarted' },
        labels: (mockIssue.labels?.nodes || []).map(l => l.name),
        url: mockIssue.url || ''
      },
      parent: null,
      siblings: [],
      project: mockProject ? { name: mockProject.name, description: mockProject.content } : null,
      children: mockData.issues.filter(i => i.parent?.id === mockIssue.id).map(i => ({
        id: i.id, identifier: i.identifier, title: i.title, state: i.state
      })),
      comments: [],
      // Mirror production: fetchIssueContext carries top-level `attachments`
      // (LIN-772) via the shared collector, so the test-mode mock must too — else
      // a route-level test of the /prompt + verb-override paths can't observe the
      // Attachments section the LIN-776 fix restores. Fixture TEST-1 carries a
      // formal attachment node, so no new fixture is needed.
      attachments: collectIssueAttachments({
        description: mockIssue.description || '',
        formalAttachmentNodes: mockIssue.attachments
      })
    };
  }
  return await withTimeout(fetchIssueContext(accessToken, identifier), GRAPHQL_TIMEOUT_MS);
}

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

// Short-window dedupe for non-idempotent comment creates (LIN-399). An
// identical (workspace + issue + body) create arriving within the window
// collapses to the first comment instead of minting a duplicate, so a
// consumer that retries after a lost response gets the original back.
const commentDedupe = createDedupeCache();

// Rate limiters
// Note: proxyLimiter is applied before authenticateProxyToken on consumer
// endpoints intentionally. This ensures unauthenticated/malicious requests
// are counted against the per-IP limit, mitigating DoS attacks that would
// otherwise bypass rate limiting by failing at auth.
const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many proxy requests, please try again later' },
  skip: () => process.env.NODE_ENV === 'test'
});

const proxyTokenCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many token creation requests, please try again later' },
  skip: () => process.env.NODE_ENV === 'test'
});

const MAX_NAME_LENGTH = 1000;
const MAX_SEARCH_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 100000;

// LIN-583 test-only local-targeting seam. A proxy token minted for this urlKey
// resolves to the LocalProvider (reached with the urlKey as the store partition
// key), so the consumer `/api/proxy/*` data API can run against a local
// workspace for the B2 e2e (LIN-584). Mirrors LOCAL_WORKSPACE_URL_KEY in
// tests/fixtures/local-harness.js; kept inline (not imported) so production code
// never depends on a test fixture. Only consulted under NODE_ENV==='test'.
const TEST_LOCAL_URL_KEY = 'local-workspace';

// LIN-525 #5: the +proxy toggle auto-mints a 'prompt-proxy' readWrite token on
// every page-load session that dispatches. To stop these standing credentials
// from accumulating for the 90-day default TTL, give them a short TTL so they
// self-prune. 48h comfortably outlives the 24h dispatch-queue item lifetime
// plus the agent run that consumes the token, while bounding the exposure window.
const PROMPT_PROXY_LABEL = 'prompt-proxy';
const PROMPT_PROXY_TOKEN_TTL_SECONDS = 48 * 60 * 60;
const MAX_COMMENT_LENGTH = 50000;

// Dispatch input limits (mirror routes/dispatch.js, the session-auth twin).
const MAX_PROMPT_LENGTH = 10000000;    // 10MB max for prompt content
const MAX_URL_LENGTH = 8000;           // URLs (covers long query strings)
const MAX_IDENTIFIER_LENGTH = 100;     // Issue identifiers
// Proxy consumers are remote, so 'local' (Harbour OS, spawns on the server's
// own /dev/tty) is intentionally excluded from the targets they may set.
const VALID_PROXY_DISPATCH_TARGETS = ['cli', 'web', 'dash'];

// Timeout for individual GraphQL requests to Linear.
// Prevents the proxy from hanging silently when Linear is slow or payloads are large,
// which causes downstream "stream idle timeout" errors in CLI clients like curl.
const GRAPHQL_TIMEOUT_MS = 25_000;

// Longer timeout for Linear endpoints that make multiple sequential GraphQL
// calls (e.g. the projects + issues fetch behind /stack-style pagination).
// The OpenRouter generation leg is NOT capped by this — it has its own, much
// larger budget (LLM_TIMEOUT_MS) so a slow-but-healthy generation isn't killed.
const MULTI_REQUEST_TIMEOUT_MS = 50_000;

// Budget for the OpenRouter LLM generation leg on recommendation-style endpoints
// (recommend/recap/brief). Generation routinely runs tens of seconds and varies
// with provider routing and output size; the previous 50s cap surfaced as
// intermittent 504s whose root cause was this leg, not Linear (the error text
// misattributed it). The armed keepalive (http-keepalive.js) writes a heartbeat
// space every 15s after its 25s flush, so the socket stays alive for an
// arbitrarily long wait — the keepalive, not this number, is what keeps Heroku's
// H12 at bay. This cap is therefore just a generous backstop against a genuinely
// hung generation.
const LLM_TIMEOUT_MS = 180_000;

// Backstop for the Linear context fetch on recommendation-style endpoints
// (recommend/recap/brief/status). These fetches run behind an armed keepalive
// (http-keepalive.js flushes a 200 + heartbeat at 25s and then holds the
// connection open), so a 25s cap on the fetch would fire at the same instant
// the keepalive starts covering for slowness — surfacing a 504 on healthy large
// epics instead of letting the request complete. A larger budget keeps the cap
// as a backstop for a genuinely hung Linear while letting normal large epics
// finish. Paired with an AbortSignal so a trip actually cancels the request.
const CONTEXT_FETCH_TIMEOUT_MS = 45_000;

// Shared cross-hop budget for the recommend recursion (LIN-329). Each defer hop is
// a Linear fetch + an LLM routing reply, but a deferring reply emits NO prompt body
// (the cost contract), so it is far cheaper than the single terminal prompt. A
// ~10-deep descent is therefore ≈ 10 short replies + 1 full prompt — comfortably
// inside this budget. resolveRecommendation checks it BETWEEN hops (a shared
// deadline, not per-call); each individual hop is still bounded by the per-call
// CONTEXT_FETCH/LLM caps above, and the armed keepalive holds the socket open.
const RECOMMEND_DESCENT_BUDGET_MS = LLM_TIMEOUT_MS;

/**
 * Race a promise against a timeout. Throws a TimeoutError if the promise
 * doesn't settle within `ms` milliseconds, giving the same error shape as
 * AbortSignal.timeout() so graphqlErrorStatus() maps it to 504.
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const err = new DOMException('Linear API request timed out', 'TimeoutError');
        reject(err);
      }, ms);
    })
  ]);
}

/**
 * Like withTimeout, but cancels the underlying work via AbortSignal when the
 * deadline passes instead of leaving the HTTP request running orphaned. workFn
 * receives the signal to thread into fetch (e.g. fetchRecommendationContext).
 * Clears its timer on settle so a fast success doesn't abort a later request,
 * and preserves the TimeoutError shape so graphqlErrorStatus()/graphqlErrorDetail()
 * still map a trip to a 504.
 */
async function fetchWithTimeout(workFn, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException('Linear API request timed out', 'TimeoutError'));
    }, ms);
  });
  try {
    return await Promise.race([workFn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Pattern to detect null bytes and dangerous control characters
const DANGEROUS_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/** Max length of the deterministic one-line headline in the `/stack` digest view. */
const STACK_HEADLINE_MAX = 140;

/**
 * Reduce a task description to a single deterministic headline line for the
 * `/stack?view=digest` projection. Takes the first non-empty line and truncates
 * it — no LLM, cheap and exact, so orientation stays light and reproducible.
 * @param {string|null|undefined} description - Full task description
 * @returns {string} One-line headline (possibly empty)
 */
function toStackHeadline(description) {
  if (!description || typeof description !== 'string') return '';
  const firstLine = description.split('\n').map(s => s.trim()).find(s => s.length > 0) || '';
  if (firstLine.length <= STACK_HEADLINE_MAX) return firstLine;
  return firstLine.slice(0, STACK_HEADLINE_MAX - 1).trimEnd() + '…';
}

// The proxy-context preamble (the "Workspace API access" block appended to
// dispatched prompts) now lives in lib/proxy-preamble.js so non-proxy dispatch
// seams (feedback triage) append the byte-identical block (LIN-733).
// buildProxyContextPreamble is imported at the top of this file.

// Terminal-marker detection (the runner prefixes "[done]"/"[failed]"/… onto its
// final feedback entry while the queue status stays 'taken') lives in the shared
// lib/dispatch-terminal.js so the dashboard Loop feed (LIN-509) derives the same
// terminal truth from the same regex. Imported at the top of this file.

// Long-poll tuning for GET /api/proxy/dispatch/:id?wait=Ns (LIN-392).
// DISPATCH_WAIT_MAX_S caps the hold below the ~60s ceiling that armKeepalive
// (flush at 25s) buys us past Heroku's 30s H12; the re-check interval bounds
// worst-case detection latency. Module-level so tests can drive the loop at
// short `wait` values instead of real-time waits.
const DISPATCH_WAIT_MAX_S = 50;
const DISPATCH_WAIT_POLL_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Shapes a store item into the watch-endpoint response body. Shared by the
// immediate short-poll and the long-poll.
//
// `meta` (long-poll only) makes the response self-describing about WHY it
// returned, so a held-the-full-window return is distinguishable from a
// short-circuit — they were previously byte-identical, which made a working
// 50s hold look like a fast empty return to a caller with no wall-clock on its
// own calls. `reason` ∈ 'terminal' (already done before the hold), 'change'
// (status transition or new feedback during the hold), 'timeout' (held the full
// window, nothing new); `waitedMs` is how long the handler actually held. Omitted
// on the plain short-poll (no `?wait`) so that path stays byte-identical.
function formatDispatchWatch(item, meta = null) {
  const terminalStatus = deriveTerminalStatus(item.feedback);
  const body = {
    id: item.id,
    status: terminalStatus || item.status,
    promptName: item.promptName,
    kind: item.kind || 'custom',
    issueIdentifier: item.issueIdentifier,
    issueUrl: item.issueUrl,
    target: item.target,
    followUpTo: item.followUpTo || null,
    force: item.force === true,
    abort: item.abort === true,
    abortTo: item.abortTo || null,
    sessionId: item.sessionId || null,
    dispatchedAt: item.dispatchedAt,
    // resolvedAt is take/archive time (when the runner claimed the item), NOT
    // completion. completedAt is the real completion time, null until terminal.
    resolvedAt: item.resolvedAt || null,
    completedAt: deriveCompletedAt(item.feedback),
    feedback: (item.feedback || []).map(f => ({
      message: f.message,
      url: f.url || null,
      urlLabel: f.urlLabel || null,
      timestamp: f.timestamp || null
    }))
  };
  if (meta) {
    body.reason = meta.reason;
    body.waitedMs = meta.waitedMs;
  }
  return body;
}

// A dispatch item has "changed" for long-poll purposes when its derived
// terminal status appears (or shifts — last-marker-wins is not monotonic) or
// new feedback arrives. Compared against a baseline snapshot captured on the
// handler's first read.
function dispatchWatchChanged(baseline, item) {
  return (
    (deriveTerminalStatus(item.feedback) || item.status) !== baseline.status ||
    (item.feedback || []).length !== baseline.feedbackLength
  );
}

// =============================================================================
// GraphQL Queries
//
// The route owns no GraphQL: read queries moved to the Linear provider in
// LIN-308, and the write mutations + write-guard reads moved there in LIN-309.
// The endpoints call provider methods (capability-gated for writes) instead.
// =============================================================================

/**
 * Creates proxy routes with injected dependencies.
 *
 * @param {Object} options - Dependencies
 * @param {Object} options.proxyTokenStore - Proxy token storage instance
 * @param {Object} options.proxyEventStore - Proxy event storage instance
 * @param {Object} options.agentStatusStore - Agent status storage instance
 * @param {Object} options.recapCacheStore - Recap cache storage instance
 * @param {Object} options.briefCacheStore - Brief cache storage instance
 * @param {Function} options.workspaceFromUrl - Middleware to validate workspace
 * @param {Function} options.getWorkspaceAccessToken - Function to get workspace access token by urlKey (token-only)
 * @param {Function} options.resolveWorkspaceAccess - Function returning { token, reason } for actionable error envelopes (LIN-417)
 * @param {Function} options.getWorkspaceOpenRouterKey - Function to get OpenRouter API key from workspace sessions
 * @param {Object} [options.provider] - TEST-ONLY provider override (LIN-581). In production this is
 *   unset and the active provider is resolved per-workspace via getProviderForWorkspace inside
 *   resolveProviderAccess. Tests that need a non-registered fake provider (e.g. to observe ref
 *   resolution) inject one here; it wins over registry resolution. The capability gate
 *   (provider.supports -> 422) is reachable both ways: via a real registered provider whose
 *   workspace selects it, and via this injection.
 * @returns {Router} Express router with proxy routes
 */
export function createProxyRoutes({ proxyTokenStore, proxyEventStore, agentStatusStore, recapCacheStore, briefCacheStore, taskSnapshotStore, dispatchQueueStore, workspaceFromUrl, getWorkspaceAccessToken, resolveWorkspaceAccess, getWorkspaceOpenRouterKey, workspacePreferencesStore, freeTierStore, provider: injectedProvider = null }) {
  const router = Router();

  /**
   * Capture a task-history snapshot (LIN-598), fire-and-forget. Called at the
   * recap/brief read seams right after the existing `hashContext(context)`, so
   * it reuses the already-computed `context` + `inputHash` — no second fetch or
   * hash. The store is hash-gated, so a write happens only when the observed
   * slice actually changed; an unchanged re-read is a no-op. Never awaited on the
   * response path (mirrors agentStatusStore.onWrite, LIN-623), so a slow or
   * failing capture cannot affect proxy latency or the response.
   */
  function captureTaskSnapshot({ urlKey, identifier, context, canonicalId, inputHash }) {
    if (!taskSnapshotStore) return;
    Promise.resolve()
      .then(() => taskSnapshotStore.captureIfChanged({
        urlKey,
        taskIdentifier: context?.issue?.identifier || identifier,
        canonicalId,
        inputHash,
        snapshot: snapshotFromContext(context)
      }))
      .catch(err => console.error('task-snapshot capture error:', err?.message || err));
  }

  // =========================================================================
  // Proxy Token Authentication Middleware
  // =========================================================================

  async function authenticateProxyToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return unauthorized.json(res, 'Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    if (!token) {
      return unauthorized.json(res, 'Empty token');
    }

    try {
      const result = await proxyTokenStore.validateToken(token);
      if (!result) {
        return unauthorized.json(res, 'Invalid, expired, or consumed token');
      }

      req.proxyTokenId = result.tokenId;
      req.proxyUrlKey = result.urlKey;
      req.proxyTokenLabel = result.label;
      req.proxyTokenScope = result.scope;
      req.proxyCreatedBy = result.createdBy;
      next();
    } catch (err) {
      console.error('Proxy token validation error:', err.message);
      return jsonError(res, 500, 'Authentication error');
    }
  }

  /**
   * Middleware to require write scope.
   */
  function requireWriteScope(req, res, next) {
    if (req.proxyTokenScope !== 'readWrite') {
      return jsonError(res, 403, 'This endpoint requires a read-write token');
    }
    next();
  }

  /**
   * Per-request provider + token resolution for the consumer data API (reads +
   * writes). Provider SELECTION is per-workspace (LIN-581): `resolveWorkspaceAccess`
   * surfaces the workspace's own `provider` name alongside the session-derived OAuth
   * access token, and `getProviderForWorkspace` resolves it from the registry — the
   * same resolution the dashboard render surfaces use. A workspace with no explicit
   * provider falls back to Linear (the registry's legacy default), so the historical
   * Linear path stays byte-identical, while a workspace bound to another provider now
   * actually hits that provider (and its capability gate) in production rather than
   * only under test injection.
   *
   * Two narrower seams remain:
   *   - `injectedProvider` (TEST-ONLY): a fake/non-registered provider passed to
   *     createProxyRoutes wins over registry resolution, so a test can observe a
   *     bespoke provider without registering it.
   *   - the known local workspace under NODE_ENV=test resolves to the LocalProvider,
   *     reached with the urlKey itself as the store partition key ("the token IS the
   *     urlKey" for local) — what lets `/api/proxy/*` target a local workspace for the
   *     B2 e2e (LIN-584). Never fires in production.
   *
   * @returns {Promise<{provider: Object, token: (string|null), reason: string}>}
   */
  async function resolveProviderAccess(urlKey) {
    if (process.env.NODE_ENV === 'test' && urlKey === TEST_LOCAL_URL_KEY) {
      return { provider: localProvider, token: urlKey, reason: 'ok' };
    }
    const { token, reason, provider: providerName } = await resolveWorkspaceAccess(urlKey);
    const activeProvider = injectedProvider || getProviderForWorkspace({ provider: providerName });
    return { provider: activeProvider, token, reason };
  }

  /**
   * Capability gate for the consumer-API writes (LIN-309). Consults the resolved
   * provider's capability descriptor BEFORE the write so an unsupported provider
   * declines cleanly (422 + machine-readable code) instead of bubbling the
   * provider's NotImplementedError up to an opaque 500. `provider.supports(...)`
   * is the "never 500" path the provider interface documents. The provider is
   * passed in (not the closure default) so the gate reflects the workspace the
   * write will actually hit (LIN-583).
   *
   * For Linear (every write supported) this is always a pass — a no-op gate that
   * keeps behaviour byte-identical, mirroring the LIN-308 read re-pointing.
   *
   * @returns {boolean} true if a capability-decline response was sent (caller returns early)
   */
  function denyIfUnsupported(activeProvider, method, req, res, endpoint) {
    if (activeProvider.supports(method)) return false;
    logEvent(req, endpoint, 422);
    jsonError(res, 422, `This workspace's provider does not support this write`, {
      code: 'CAPABILITY_NOT_SUPPORTED',
      capability: method,
      provider: activeProvider.name,
    });
    return true;
  }

  /**
   * Helper to log a proxy event (fire and forget).
   */
  function logEvent(req, endpoint, status) {
    proxyEventStore.recordEvent({
      urlKey: req.proxyUrlKey,
      tokenId: req.proxyTokenId,
      tokenLabel: req.proxyTokenLabel,
      method: req.method,
      endpoint,
      status
    }).catch(err => console.error('Failed to log proxy event:', err));
  }

  /**
   * Send the structured "workspace not available" 503 envelope (LIN-417).
   * Status stays 503; the body carries code/category/retryable/detail and a
   * safe `context` (public workspace slug only) so an automated caller can
   * decide whether to back off (retryable) or escalate (auth/config).
   * `reason` is threaded unmodified from resolveWorkspaceAccess at every read,
   * write, and compute endpoint (all now share the single raw-token path).
   */
  function workspaceUnavailable(req, res, endpoint, reason) {
    logEvent(req, endpoint, 503);
    return res.status(503).json(workspaceUnavailableEnvelope(reason, req.proxyUrlKey));
  }

  /**
   * Extract the upstream HTTP status from a graphql-request error.
   * graphql-request stores Linear's response status in err.response.status
   * and in err.response.errors[].extensions.statusCode.
   *
   * Maps upstream status to appropriate proxy response status:
   *  - 401/403 from Linear → 401 (workspace token invalid/expired)
   *  - 404 from Linear     → 404 (resource not found)
   *  - 429 from Linear     → 429 (rate limited)
   *  - anything else       → 500
   */
  function graphqlErrorStatus(err) {
    // AbortSignal.timeout() raises a TimeoutError (name === 'TimeoutError')
    // and manual AbortController.abort() raises AbortError.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 504;
    const status = err.response?.status
      || err.response?.errors?.[0]?.extensions?.statusCode;
    if (status === 401 || status === 403) return 401;
    if (status === 404) return 404;
    if (status === 429) return 429;
    return 500;
  }

  /**
   * Extract a human-readable error message from a GraphQL error.
   *
   * graphql-request splits errors into two buckets:
   *  - err.response.errors[].message  → originated from Linear's GraphQL
   *    response. These describe resource state or API misuse and are safe
   *    to pass through — callers (especially autonomous agents) need them
   *    to self-diagnose.
   *  - err.message                    → network / fetch / parse failure,
   *    potentially containing internal stack traces or proxy-level details.
   *    Log server-side and return a generic message to the caller.
   */
  function graphqlErrorDetail(err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return 'Linear API request timed out — the response may be too large or Linear is slow. Try a more specific query.';
    }

    const gqlMessage = err.response?.errors?.[0]?.message;
    if (gqlMessage) {
      const status = err.response?.status || err.response?.errors?.[0]?.extensions?.statusCode;
      if (status === 401 || status === 403) {
        console.error(`Linear auth error (HTTP ${status}): ${gqlMessage}`);
      }
      return gqlMessage;
    }

    console.error('GraphQL error detail (suppressed from response):', err.message || 'Unknown error');
    return 'Linear API request failed';
  }

  /**
   * Guard a Linear write mutation's result before reporting success.
   *
   * Linear's *Create/*Update/*Delete payloads carry a `success` boolean. A
   * falsy one (or a missing payload) must never ride on a 2xx — autonomous
   * agents need an authoritative signal, and a misleading success is exactly
   * what drives a confused retry (LIN-399). On rejection this sends a 502 and
   * returns true so the caller can `return` early.
   *
   * @returns {boolean} true if a failure response was sent
   */
  function writeRejected(req, res, endpoint, payload, errorMessage) {
    if (payload && payload.success === true) return false;
    logEvent(req, endpoint, 502);
    jsonError(res, 502, errorMessage, { detail: payload || null });
    return true;
  }

  /**
   * Normalize a provider write result into the `{ success, <entityKey> }`
   * envelope the route echoes and `writeRejected` guards (LIN-584).
   *
   * Linear's mutation methods already return that envelope (Linear's
   * *Create/*Update payloads carry a `success` boolean), so they pass through
   * BYTE-IDENTICAL — the Linear proxy path is unchanged. Providers whose write
   * methods return the bare canonical entity instead (LocalProvider's LIN-356
   * create/update methods, which stay bare for their non-proxy callers; the
   * GitHub provider) are wrapped here: a truthy entity is a landed write, a
   * null/undefined one (e.g. updateIssue on a missing target) is a rejected
   * write that `writeRejected` will surface as a 502. This keeps the proxy
   * write path provider-agnostic without forcing every provider onto Linear's
   * payload shape.
   *
   * @param {*} result - the provider's write return value
   * @param {string} entityKey - the payload key Linear uses ('issue'|'comment'|'issueRelation')
   * @returns {{success: boolean}} the normalized envelope
   */
  function normalizeWritePayload(result, entityKey) {
    if (result && typeof result === 'object' && 'success' in result) return result;
    return { success: !!result, [entityKey]: result ?? null };
  }

  // =========================================================================
  // LIN-556: input-side reference resolution for the write paths.
  //
  // Each helper applies the two resolver layers from lib/proxy-ref-resolver.js:
  // (1) strip/validate an optional `<source>:` namespace, then (2) resolve the
  // local-part to a native id. A bare UUID short-circuits BEFORE any provider
  // read, so existing UUID payloads are byte-identical and pay no extra network
  // cost; only a genuinely symbolic ref triggers the scoped list fetch. A
  // RefResolutionError bubbles to the route's catch, which maps it to a clean
  // 422 (see refResolutionFailed).
  // =========================================================================

  async function resolveTeamInput(activeProvider, token, rawRef) {
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    const teams = await activeProvider.fetchTeams(token);
    return resolveTeamRef(teams, localRef);
  }

  async function resolveStateInput(activeProvider, token, teamId, rawRef) {
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    // States are team-scoped in Linear; without a team we cannot scope the
    // symbolic match, so fail loud rather than guess across teams.
    if (!teamId) {
      throw new RefResolutionError(
        `Cannot resolve state '${localRef}' — the issue's team could not be determined`,
        { status: 422 },
      );
    }
    const states = await activeProvider.states(token, teamId);
    return resolveStateRef(states, localRef);
  }

  async function resolveProjectInput(activeProvider, token, rawRef) {
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    const projects = await activeProvider.fetchProjectsList(token);
    return resolveProjectRef(projects, localRef);
  }

  async function resolveLabelInput(activeProvider, token, rawRef) {
    const { localRef } = parseSourceNamespace(rawRef);
    if (UUID_REGEX.test(localRef)) return localRef;
    const labels = await activeProvider.labels(token, null);
    return resolveLabelRef(labels, localRef);
  }

  /**
   * Map a RefResolutionError to a clean 422 (with candidate ids for an ambiguous
   * match). Returns true when it handled the error so callers can
   * `if (refResolutionFailed(...)) return;` from inside a catch.
   */
  function refResolutionFailed(req, res, endpoint, err) {
    if (!(err instanceof RefResolutionError)) return false;
    logEvent(req, endpoint, err.status);
    jsonError(res, err.status, err.message, err.candidates ? { candidates: err.candidates } : undefined);
    return true;
  }

  // =========================================================================
  // User-Facing API (Session Auth) - Token Management
  // =========================================================================

  /**
   * POST /workspace/:urlKey/api/proxy/tokens
   * Create a new proxy token.
   */
  router.post('/workspace/:urlKey/api/proxy/tokens', proxyTokenCreationLimiter, workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    // LIN-525 #2: token minting is gated on the proxy feature flag (defense in
    // depth — independent of the UI). The proxy page that mints tokens
    // is itself flag-gated, so a mint request on a flag-off session means a
    // stale global +proxy toggle is trying to inject where no button is shown.
    if (getFeatureFlags(req.session).proxy !== true) {
      return jsonError(res, 403, 'Proxy feature is not enabled for this workspace');
    }

    try {
      const { label, scope, singleUse } = req.body || {};

      if (label && label.length > MAX_NAME_LENGTH) {
        return badRequest.json(res, `label exceeds maximum length of ${MAX_NAME_LENGTH}`);
      }

      if (scope && !['read', 'readWrite'].includes(scope)) {
        return badRequest.json(res, 'scope must be "read" or "readWrite"');
      }

      // LIN-525 #5: short-TTL the auto-minted prompt-proxy tokens so they
      // self-prune instead of standing for the 90-day default.
      const isPromptProxy = (label || '') === PROMPT_PROXY_LABEL;

      const result = await proxyTokenStore.createToken(workspace.urlKey, {
        label: label || 'default',
        scope: scope || 'read',
        singleUse: singleUse === true || singleUse === 'true',
        createdBy: req.session?.linearUserId || null,
        ...(isPromptProxy ? { ttl: PROMPT_PROXY_TOKEN_TTL_SECONDS } : {})
      });

      res.status(201).json({
        success: true,
        tokenId: result.tokenId,
        token: result.token,
        label: result.label,
        scope: result.scope,
        singleUse: result.singleUse,
        message: 'Token created. Save this token now - it cannot be retrieved later.'
      });
    } catch (err) {
      console.error('Create proxy token error:', err.message);
      jsonError(res, 500, 'Failed to create token');
    }
  });

  /**
   * GET /workspace/:urlKey/api/proxy/tokens
   * List all proxy tokens for this workspace.
   */
  router.get('/workspace/:urlKey/api/proxy/tokens', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const tokens = await proxyTokenStore.listTokens(workspace.urlKey);
      res.json({ tokens });
    } catch (err) {
      console.error('List proxy tokens error:', err.message);
      jsonError(res, 500, 'Failed to list tokens');
    }
  });

  /**
   * DELETE /workspace/:urlKey/api/proxy/tokens/:tokenId
   * Revoke a proxy token.
   */
  router.delete('/workspace/:urlKey/api/proxy/tokens/:tokenId', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;
    const { tokenId } = req.params;

    if (!UUID_REGEX.test(tokenId)) {
      return badRequest.json(res, 'Invalid token ID format');
    }

    try {
      const revoked = await proxyTokenStore.revokeToken(workspace.urlKey, tokenId);
      if (!revoked) {
        return notFound.json(res, 'Token not found');
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Revoke proxy token error:', err.message);
      jsonError(res, 500, 'Failed to revoke token');
    }
  });

  /**
   * GET /workspace/:urlKey/api/proxy/events
   * List recent proxy events for this workspace.
   */
  router.get('/workspace/:urlKey/api/proxy/events', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;

    try {
      const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 100) : 50;
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const result = await proxyEventStore.listEvents(workspace.urlKey, { limit, offset });
      res.json(result);
    } catch (err) {
      console.error('List proxy events error:', err.message);
      jsonError(res, 500, 'Failed to list events');
    }
  });

  // =========================================================================
  // Consumer API - Agent Instructions (llms.txt)
  // =========================================================================

  /**
   * GET /api/proxy/instructions
   * Returns agent-readable instructions for using the proxy API.
   * Authenticated so token is validated and base URL is known.
   */
  router.get('/api/proxy/instructions', authenticateProxyToken, (req, res) => {
    const scope = req.proxyTokenScope;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    logEvent(req, '/api/proxy/instructions', 200);

    const readEndpoints = `
## Read Endpoints

GET ${baseUrl}/api/proxy/me
  → Current authenticated user
  → { "id": "...", "name": "Jane Doe", "email": "jane@example.com" }

GET ${baseUrl}/api/proxy/teams
  → List all teams
  → { "teams": [{ "id": "...", "name": "Engineering", "key": "ENG" }] }

GET ${baseUrl}/api/proxy/projects
  → List active projects
  → { "projects": [{ "id": "...", "name": "..." }] }

GET ${baseUrl}/api/proxy/issues?teamId={teamId}&limit={n}
  → List issues (optionally filter by team, default limit 50, max 250)
  → { "issues": [{ "id": "...", "identifier": "LIN-1", "title": "...",
                   "state": { "name": "In Progress", "type": "started" },
                   "labels": ["bug"], "priority": 2, "priorityLabel": "High",
                   "team": { "id": "...", "name": "Engineering" }, "teamId": "...",
                   "cycle": { "id": "...", "number": 12 } }] }

GET ${baseUrl}/api/proxy/issues/{issueId}
  → Full issue detail; issueId: UUID or identifier like "LIN-123"
  → {
      "id": "...", "identifier": "LIN-123", "title": "...", "description": "...",
      "state": { "name": "In Progress", "type": "started" },
      "trashed": false,
      "labels":   ["bug"],
      "priority": 2, "priorityLabel": "High",
      "team":     { "id": "...", "name": "Engineering" }, "teamId": "...",
      "children": [{ "id": "...", "identifier": "LIN-124", "title": "..." }],
      "parent":   { "id": "...", "identifier": "LIN-100", "title": "..." },
      "comments": [{ "id": "...", "body": "...", "createdAt": "..." }]
    }
  → labels / children / comments / relations are plain arrays (never wrapped);
    labels are plain name strings. The same flat convention holds everywhere.
  → team is the issue's owning team as { id, name }, with a flat "teamId" mirror —
    feed teamId straight to /states/{teamId} and /labels?teamId= without a /teams
    lookup. priorityLabel is the human-readable priority name (Urgent/High/Medium/
    Low/No priority) matching the 0–4 "priority". Both are present on list/search
    results and issue detail.
  → TRASHED ISSUES: deleted issues are soft-deleted (recoverable for ~30 days).
    A deleted issue vanishes from every list/search/child collection but STILL resolves by ID,
    carrying its stale pre-deletion state. When that happens this endpoint sets
    "trashed": true AND overrides the reported state to
    { "name": "Trashed", "type": "canceled" } so you cannot mistake a deleted
    ghost for live work. Key off state.type ("canceled" ⇒ terminal, do not act)
    and read "trashed" to tell a deleted issue from a user-canceled one. The
    task-automation endpoints (recommend/recap/brief/prompt) refuse a trashed target
    with 404; the write endpoints refuse with 409.

GET ${baseUrl}/api/proxy/search?q={query}
  → Search issues by text (max 50 results)
  → { "issues": [ /* same flat shape as /issues — including parent, team/teamId, and priority/priorityLabel; children/comments/relations not included — call /issue/{id} for full hierarchy */ ] }

GET ${baseUrl}/api/proxy/states/{teamId}
  → Workflow states for a team
  → { "states": [{ "id": "...", "name": "In Progress", "type": "started", "position": 1 }] }

GET ${baseUrl}/api/proxy/labels?teamId={teamId}
  → Labels (id, name, color); optional team filter
  → { "labels": [{ "id": "...", "name": "bug", "color": "#f00" }] }

GET ${baseUrl}/api/proxy/cycles?teamId={teamId}
  → Cycles (optional team filter)
  → { "cycles": [{ "id": "...", "number": 12, "startsAt": "...", "endsAt": "..." }] }

GET ${baseUrl}/api/proxy/cycles/{cycleId}
  → Cycle detail with issues, progress, and scope history

GET ${baseUrl}/api/proxy/issues/{issueId}/relations
  → Issue relations (blocks, blocked-by, related, duplicate)
  → { "trashed": false,
      "relations":        [{ "id": "...", "type": "blocks", "relatedIssue": { "id": "...", "identifier": "LIN-9" } }],
      "inverseRelations": [{ "id": "...", "type": "blocks", "issue": { "id": "...", "identifier": "LIN-7" } }] }
  → "trashed": true means the issue itself has been soft-deleted (this query has
    no root state to override, so the flag is the only signal). Relations are
    still returned so you can see what a now-deleted issue was related to.
  → relations / inverseRelations are plain arrays, same flat convention as
    relations on /issue/{id}. \`relatedIssue\` is the target of an outgoing
    relation; \`issue\` is the source of an inverse (e.g. blocked-by) one.
    Each entry's \`id\` is the relation id — pass it to DELETE .../relations/{id}.
  → This pairs with POST/DELETE /issues/{issueId}/relations below, so the whole
    relations surface (read + write) lives under one issue-scoped path.

GET ${baseUrl}/api/proxy/attachments/{id}
  → Relay the bytes for an attachment. {id} is the opaque attachment handle from
    an issue/comment "attachments" entry (NOT a URL — the proxy never exposes
    backend URLs). The bytes are fetched server-side, authed, and SSRF-guarded.
    Images stream back with their image/* content-type; non-image text/source
    files (markdown, text, and common source files) stream back with a text
    content-type plus Content-Disposition: attachment.
  → SCOPE: handles beginning "md:" (markdown-embedded images AND markdown-linked
    non-image files) resolve. Handles beginning "att:" (formal attachment
    entities) are NOT fetchable yet and return
    422 { "code": "ATTACHMENT_FETCH_NOT_SUPPORTED" } — a later slice adds them.
    A response whose type is neither an image nor an allowlisted text/source file
    is rejected (400), as is an oversized (>10MB) one.

Issue-scoped paths are canonical as /issues/{id}/... — relations (above),
recommend / recap / brief (below), and comments (write section) all nest under
the issue. Legacy flat forms (e.g. /relations/{id}, /recap/{id}, /comments/{id})
still resolve as forgiving aliases, but prefer the nested form shown here.

## Task Automation Endpoints

GET ${baseUrl}/api/proxy/stack?limit={n}
  → Sorted task stack (default 5, max 50). Top-level shape:
  → { "tasks": [...], "total": 98 }
  → Each task has a FLAT shape. Expect \`state.name\`, \`parent.identifier\`,
    \`children\` (NOT \`subtasks\`), and \`labels\` as a plain string array:
  → {
      "id": "...",
      "identifier": "LIN-296",
      "title": "...",
      "description": "...",
      "priority": 1,
      "state":    { "name": "In Progress", "type": "started" },
      "labels":   ["milestone-x"],
      "project":  { "name": "Safety & Security" },
      "parent":   { "id": "...", "identifier": "LIN-295", "title": "..." },
      "children": [{ "id": "...", "identifier": "LIN-297", "title": "...", "state": { "type": "unstarted" } }],
      "blocksIds": []
    }
  → \`parent\` and \`project\` are null when absent. \`children\` is [] when there are none.

GET ${baseUrl}/api/proxy/stack?limit={n}&view=digest
  → Compact orientation projection: same sorted stack, but each task drops the full
    \`description\` for a deterministic one-line \`headline\`, and \`children\`/\`blocks\` are
    counts (not arrays). Use this to orient over the whole stack cheaply, then fetch full
    detail (\`/brief/{id}\` or the full \`/stack\`) only for the task you pick.
  → Each line also carries deterministic ranking features (computed in-set, no LLM):
    \`downstreamUnblocks\` (how many tasks this one transitively unblocks),
    \`criticalPathLen\` (longest dependency chain through it), an optional \`heldBy\`
    (off-page blockers that forced this line's position when a small \`limit\` hides
    them), and a compact \`why\` array summarizing why it ranks where it does. The
    ordering itself factors \`downstreamUnblocks\`/\`criticalPathLen\` in (just below
    state, above priority), so the order is explainable, not just opaque.
  → { "tasks": [{ "identifier": "LIN-296", "title": "...", "headline": "...", "state": {...},
      "labels": [...], "priority": 1, "section": "in-progress", "blocks": 0, "children": 2,
      "downstreamUnblocks": 6, "criticalPathLen": 4, "heldBy": ["LIN-412"],
      "why": ["bug", "unblocks 6", "critical path 4", "held by LIN-412"],
      "parent": { "identifier": "LIN-295" } }], "total": 98, "view": "digest" }

GET ${baseUrl}/api/proxy/issues/{identifier}/recommend
  → AI-generated prompt recommendation (requires OpenRouter on the server; >25s responses
    stream whitespace-keepalive bytes inside a single 200 response, which JSON.parse ignores)
  → { "identifier": "LIN-123", "reasoning": "...", "prompt": "...", "truncated": false, "repo": "owner/name" }
  → Add ?format=md to download the bare prompt as a markdown file instead of JSON
    (Content-Type: text/markdown, Content-Disposition: attachment). Useful when the
    prompt is too large to paste — save it straight to a .md file:
      curl -H "Authorization: Bearer YOUR_TOKEN" "${baseUrl}/api/proxy/issues/LIN-123/recommend?format=md" -o LIN-123-recommend.md
  → Add ?noDescend=1 to recommend the named issue's OWN next step WITHOUT descending into an
    open child. Use it to drive a parent whose work lives in its own description/checklist while
    a child stays open or is separately tracked (otherwise the engine routes into that child).

GET ${baseUrl}/api/proxy/issues/{identifier}/recap
  → Cached AI recap; auto-regenerates when stale. Pass \`?noRefresh=1\` to skip regeneration.
  → { "status": "fresh" | "stale" | "missing",
      "identifier": "LIN-123",
      "recap": { "done": "...", "pending": "...", "deviations": "..." },
      "generatedAt": "2026-04-20T12:00:00Z",
      "model": "..." }

POST ${baseUrl}/api/proxy/recap/{identifier}
  → Force-regenerate the recap and return the fresh result (same shape as GET above).

GET ${baseUrl}/api/proxy/issues/{identifier}/brief
  → Current-state task brief: a distilled, present-tense version of the task
    (Current / Constraints / Open questions / Changelog) for use as starting context.
    Auto-regenerates when stale. Pass \`?noRefresh=1\` to skip regeneration.
  → { "status": "fresh" | "stale" | "missing",
      "identifier": "LIN-123",
      "brief": "## Current\\n...\\n## Constraints\\n...\\n## Open questions\\n...\\n## Changelog\\n...",
      "generatedAt": "2026-04-20T12:00:00Z",
      "model": "..." }
  → \`brief\` is fixed-section Markdown (not structured fields); read it before the
    full description — it supersedes stale wording and folds in comments/subtask state.

POST ${baseUrl}/api/proxy/brief/{identifier}
  → Force-regenerate the brief and return the fresh result (same shape as GET above).

GET ${baseUrl}/api/proxy/agent/status   (alias: /api/proxy/foreman/status — deprecated)
  → Recent agent status entries
  → { "items": [{ "id": "...", "taskIdentifier": "LIN-42", "action": "research",
                   "status": "completed", "summary": "...", "timestamp": "..." }], "total": 7 }

GET ${baseUrl}/api/proxy/autopilot/manual
  → Autopilot operating manual / handbook (plain text, not JSON) — the disposition
    behind the loop. Composed inline into the kickoff; fetch here to re-read a part.`;

    const writeEndpoints = scope === 'readWrite' ? `

## Write Endpoints

Success responses wrap the affected entity (e.g. { "success": true, "issue": {...} }) —
read the documented shape rather than assuming the entity comes back top-level. The
response is authoritative: a 2xx with "success": true means the write landed; a non-2xx
(or "success": false) means it did not. Do NOT blind-retry a create on a lost/empty
response — if you got no clean response, re-read (search or GET the issue) to confirm
before retrying. Identical comment creates are additionally deduped server-side within a
short window: a repeat of the same (issue + body) returns the original comment with
"deduped": true (HTTP 200) instead of minting a duplicate, so a confirming retry is safe.

POST ${baseUrl}/api/proxy/issues
  Body: { "teamId": "...", "title": "...", "description": "...", "projectId": "...", "stateId": "...", "assigneeId": "...", "priority": 0-4, "cycleId": "...", "parentId": "..." }
  → Create a new issue; set parentId (UUID) to create as a sub-issue. Returns 201:
  → { "success": true, "issue": { /* the SAME flat shape as GET /issues/{id} (minus children/comments/relations): id, identifier, title, description, state, labels, priority, priorityLabel, team, teamId, project, parent, cycle, estimate, dueDate, … */ } }
  → The echo is self-verifying: it reflects the post-write state of every field the request set, so you do NOT need a follow-up GET to confirm the mutation landed.
  → teamId/stateId/projectId accept symbolic refs, not just UUIDs: teamId as a team key (e.g. LIN) or name; stateId as a keyword (done/in-progress/todo/backlog/canceled/duplicate) or state name; projectId as a project name. Ambiguous or unknown names fail with 422 (UUID is the unambiguous escape hatch).

PATCH ${baseUrl}/api/proxy/issues/{issueId}
  Body: { "title": "...", "description": "...", "stateId": "...", "assigneeId": "...", "priority": 0-4, "cycleId": "...", "parentId": "...|null" }
  → Update an existing issue; set cycleId to assign/move to a cycle; set parentId to a UUID to re-parent, or null to promote to top-level
  → stateId/projectId accept symbolic refs too: stateId as a keyword (done/in-progress/todo/backlog/canceled/duplicate) or state name (scoped to the issue's team), projectId as a project name. Ambiguous/unknown names → 422.
  → { "success": true, "issue": { /* the SAME flat shape as GET /issues/{id} (minus children/comments/relations) — self-verifying: every mutable field (priority/priorityLabel, labels, parent, project, assignee, state, cycle, estimate, team/teamId) reflects the post-write state, so no follow-up GET is needed */ } }
  → Passing "description" here REPLACES the whole body. For anything other than a deliberate full rewrite, prefer the two splice endpoints below — they let you supply only the new content, so you never re-emit (and risk corrupting) the existing body.

POST ${baseUrl}/api/proxy/issues/{issueId}/description/append
  Body: { "block": "..." }
  → Append a block to the END of the description. The existing body is preserved byte-for-byte; "block" is added after a blank line. Use this to add findings, notes, or a new section. Returns the same { "success": true, "issue": {...} } shape as PATCH.

POST ${baseUrl}/api/proxy/issues/{issueId}/description/replace
  Body: { "oldString": "...", "newString": "..." }
  → Replace ONE occurrence of "oldString" with "newString" in the description (surgical edit). Same old_string/new_string semantics as a code editor: quote a span you copied from GET /issue/{id}. Matching is normalised — Linear stores markdown punctuation backslash-escaped (e.g. \\#\\#, \\*\\*), so quoting either the escaped bytes or the rendered text works.
  → Fails LOUD, never a silent no-op: 422 { "code": "NOT_FOUND" } if the span is absent, 422 { "code": "NOT_UNIQUE", "matchCount": N } if it appears more than once (quote a longer, unique span). On NOT_FOUND, re-read the description; to swap many occurrences at once, rewrite the whole body via PATCH instead.
  → Returns { "success": true, "issue": {...} }.

POST ${baseUrl}/api/proxy/issues/{issueId}/comments
  Body: { "body": "..." }
  → Add a comment to an issue. Returns 201:
  → { "success": true, "comment": { "id": "...", "body": "...", "createdAt": "...", "user": { "name": "..." } } }
  → Deduped within a short window: a repeat of the same (issue + body) returns the
    original comment with "deduped": true and HTTP 200 (not 201) — no duplicate is created.

POST ${baseUrl}/api/proxy/issues/{issueId}/relations
  Body: { "type": "blocks|related|duplicate", "relatedIssueId": "..." }
  → Create a relation between issues. Returns 201:
  → { "success": true, "issueRelation": { "type": "blocks", "issue": { "id": "...", "identifier": "LIN-7" }, "relatedIssue": { "id": "...", "identifier": "LIN-9" } } }

DELETE ${baseUrl}/api/proxy/issues/{issueId}/relations/{relationId}
  → Remove a relation. relationId is the relation's own id (the \`id\` field on
    each node from GET /issues/{issueId}/relations or GET /issue/{id}), NOT an issue id.
  → { "success": true }

POST ${baseUrl}/api/proxy/issues/{issueId}/labels
  Body: { "labelId": "..." }
  → Add a label to an issue (idempotent). labelId accepts a UUID or the label name (case-insensitive), e.g. "bug".
  → { "success": true, "issue": { "id": "...", "identifier": "LIN-123", "labels": ["bug"] } }
  → When the label is already present: { "success": true, "message": "Label already present" }

DELETE ${baseUrl}/api/proxy/issues/{issueId}/labels/{labelId}
  → Remove a label from an issue (idempotent). {labelId} accepts a UUID or the label name (case-insensitive).
  → { "success": true, "issue": { "id": "...", "identifier": "LIN-123", "labels": [...] } }
  → When the label is not present: { "success": true, "message": "Label not present" }

POST ${baseUrl}/api/proxy/agent/status   (alias: /api/proxy/foreman/status — deprecated)
  Body: { "taskIdentifier": "LIN-42", "action": "research", "status": "completed", "summary": "...", "dispatchId": "..." }
  → Record an agent status update (dispatchId optional: pass the dispatch-history item ID from /api/dispatch/take to enable exact loop-reconstruction join). Returns 201:
  → { "success": true }
  → The legacy /api/proxy/foreman/status path remains a forgiving alias for existing consumers, but agent/status is canonical.

## Dispatch Endpoints

POST ${baseUrl}/api/proxy/dispatch
  Body: { "prompt": "...", "promptName": "...", "kind": "implementation", "issueId": "...", "issueIdentifier": "LIN-42", "issueTitle": "...", "issueUrl": "...", "target": "cli|web|dash", "repo": "...", "followUpTo": "...", "force": false, "abort": false, "abortTo": "...", "sessionId": "...", "waitForFollowUps": false, "appendProxyContext": true }
  → Queue a prompt for the workspace's dispatch consumer (the runner). Only "prompt" is required; target defaults to "cli". ("local"/Harbour OS is not available to proxy consumers.)
  → "kind" is a stable task classification (research/plan/implementation/review/etc. — the prompt-template keys, plus "custom"). Optional: when omitted it is derived from "promptName", falling back to "custom". Read it instead of inferring the task type from promptName or the prompt body.
  → "followUpTo" (optional) resumes an existing session: pass the "id" of an earlier dispatch and "prompt" becomes a follow-up instruction to that same session. cli/web only, same workspace. The runner owns session liveness — if the session is gone it posts terminal "[failed] no live session to resume". Use sparingly: only when the prior session ran cleanly and naturally suggests the next step (e.g. confirm CI is green, update Linear/git); any wobble → dispatch a fresh session instead.
  → "force" (optional, default false) is a cli/web follow-up modifier: it overrides the runner's active-session guard so a "followUpTo" can resume a session that is wedged or sleeping in an active phase (Claude infra wobble, long-running sleep) instead of being rejected by the busy-session liveness gate. Setting it asserts the prior process is effectively dead — see LIN-546 for the collision contract it bypasses. Only meaningful with "followUpTo": "force": true without one is rejected (400). The runner reads it as "item.force" off the polled/claimed item. See LIN-559.
  → "abort" (optional, default false) requests an abort/cancel/close of an existing session instead of running a prompt: set "abort": true and "abortTo" to the "id" of the dispatch whose session should be cancelled. "prompt" is NOT required for an abort, and the consumer flips the running session to a terminal cancelled state. The abort item's OWN "target" must be poll-eligible (cli/web/dash) — eligibility is the abort item's target, NOT the substrate of the session being aborted (so you can abort a "dash" session with a "cli" abort item). Mutually exclusive with "followUpTo". See LIN-743.
  → "abortTo" (required when "abort" is true) is the dispatch id (UUID) of the session to abort. Stored + forwarded blindly; the consumer owns session liveness.
  → "sessionId" (optional) is the autopilot dispatch id that spawned this worker. Pass it on every worker dispatch the autopilot fans out so the run reconstructs as one session across all touched tasks (incl. epic descent / breakdown spin-offs). UUID, stored + forwarded blindly, ANY target (unlike followUpTo). See LIN-591.
  → "waitForFollowUps" (optional boolean, default false; cli/web only) is the opt-in completion hold: when true the runner holds the session open at completion to receive in-session follow-ups (beats) instead of finalizing. The runner owns the behaviour — this flag is stored + forwarded blindly. Set it for a worker you intend to keep feeding in-session; leave it false (omit) for an orchestrator/sub-orchestrator that must finalize normally and stay free to run its own watch loop. See LIN-795/LIN-797.
  → By default a proxy-context block is appended to the prompt so the worker inherits this workspace's API access. Reporting is handled by the runner's Stop hook, not the prompt. Set "appendProxyContext": false to opt out.
  → { "id": "...", "status": "queued", "promptName": "...", "kind": "implementation", "issueIdentifier": "...", "target": "cli", "abort": false, "abortTo": null, "sessionId": null, "dispatchedAt": "..." }

POST ${baseUrl}/api/proxy/recommend-and-dispatch
  Body: { "issueIdentifier": "LIN-42", "target": "cli|web|dash", "repo": "...", "appendProxyContext": true, "noDescend": false, "kind": "review", "sessionId": "...", "waitForFollowUps": false }
  → Fused verb: runs /recommend and forwards the recommended prompt straight into a dispatch, server-side. "issueIdentifier" is required; target defaults to "cli".
  → "sessionId" (optional) is the autopilot dispatch id driving this run; stamp it on every fan-out so the whole multi-task run reconstructs as one session. UUID, any target. See LIN-591.
  → The prompt body NEVER returns to you — you only get the task header. This keeps the prompt out of your context (the point of the verb); learn what was chosen from "kind"/"promptName", then watch the item via GET /dispatch/{id}.
  → "kind" is derived from the recommendation's own action signal (falling back to "custom") — no need to read the prompt to classify the task.
  → Set "noDescend": true to dispatch the named issue's OWN next step and NOT descend into an open child (deterministic). Use it to drive a parent whose deliverables live in its own description while a child is out of scope / separately tracked; the dispatched item then references the parent, and "deferredVia" is just [parent].
  → "waitForFollowUps" (optional boolean, default false; cli/web only) is threaded onto the dispatched item, same meaning as on POST /dispatch — the opt-in completion hold. Set it when this dispatch is a worker you intend to keep feeding in-session; leave it false for an orchestrator/sub-orchestrator. See LIN-795/LIN-797.
  → VERB OVERRIDE — pass "kind" (a prompt template key: plan, implementation, review, research, design, breakdown, look-into, triage, scoping, spike, context, retro, blocked) to PIN the step when the engine's chosen verb is demonstrably wrong. The server still WRITES the body — you pick the verb, never the words. Override pins the NAMED issue with NO descent and skips the LLM entirely; response carries "override": true. Use sparingly and only on a clear engine miss (see the autopilot manual); it is not the everyday path. Invalid keys (incl. defer/custom/autopilot/periodical) get a 400.
  → { "id": "...", "status": "queued", "kind": "plan", "promptName": "plan", "issueIdentifier": "...", "target": "cli", "sessionId": null, "dispatchedAt": "..." }

POST ${baseUrl}/api/proxy/autopilot/kickoff
  Body: { "goal": "...", "mode": "write|readonly", "variant": "standard|stepper", "issueIdentifier": "LIN-42", "target": "cli|web|dash", "repo": "...", "appendProxyContext": true }
  → Fused launch verb: builds the Autopilot kickoff AND dispatches it in one call — the single verb that actually STARTS a run from a goal (no need to GET the kickoff text and POST it back). The receiving session becomes the Autopilot orchestrator. All fields optional.
  → Omit "issueIdentifier" for a GENERAL run ("goal" focuses the stack walk); pass it for a SCOPED run ("autopilot until THIS task is done") — the project "repo=" is then inherited unless you pass "repo". "mode" defaults to "write" ("readonly" = investigation only).
  → "variant" defaults to "standard" (the normal orchestrator). "stepper" swaps in the warm single-session, beat-stepping disposition: it decomposes the task's worker prompt into 3–6 ordered beats and drip-feeds them into ONE session over followUpTo+force, judging and challenging each beat before advancing. Orthogonal to "mode" — they compose.
  → The stepper kickoff body instructs each beat to carry BOTH "subscribe": true AND "waitForFollowUps": true — the two orthogonal halves of the warm drip (LIN-845). "subscribe" is the up-chain wake (the worker's stop boundary, incl. [pending], wakes the orchestrator); "waitForFollowUps" is the worker-side hold (the worker parks at AWAITING_FOLLOWUP instead of finalizing). Both are needed: with the hold absent the worker finalizes after beat 1, so beat 2's followUpTo+force falls back to a cold claude --resume instead of an in-session warm follow-on.
  → Dispatched as kind:"autopilot", so the returned "id" IS this run's session id. Pass that id as "sessionId" on every worker dispatch the run fans out (the kickoff body also tells the run its own id). The orchestrator itself is launched WITHOUT "waitForFollowUps" (default false) so it finalizes normally and stays free to run its watch loop.
  → The prompt body NEVER returns to you — only the header. The GET twin (GET /api/proxy/autopilot/kickoff?goal=&mode=&variant=) stays a text-only preview/inspect form that does NOT enqueue anything.
  → { "id": "...", "sessionId": "...", "status": "queued", "kind": "autopilot", "promptName": "Autopilot (stack walk)", "mode": "write", "variant": "standard", "issueIdentifier": null, "target": "cli", "dispatchedAt": "..." }

GET ${baseUrl}/api/proxy/dispatch?issueIdentifier={LIN-42}&status={queued|taken|done|failed|aborted}&limit={n}
  → List your dispatch items (live queue + recent history), newest first. All query params optional. Use this to find an item's id when you only know the issue.
  → { "items": [{ "id": "...", "status": "queued|taken|done|failed|aborted", "kind": "implementation", "issueIdentifier": "...", "feedbackCount": 1, ... }], "total": N }

GET ${baseUrl}/api/proxy/dispatch/{id}
  → Watch a dispatched item: whether it is still queued or has been taken by the runner, plus any feedback posted back. Poll this after dispatching.
  → { "id": "...", "status": "queued|taken|done|failed|aborted", "kind": "implementation", "feedback": [{ "message": "...", "url": "...", "timestamp": "..." }], ... }
  → status is terminal (done/failed/aborted) once the runner posts a "[done]"/"[failed]"/"[aborted]" feedback marker; until then it is queued or taken. Poll until status is terminal.
  → completedAt is the real completion time (timestamp of the terminal marker), null until terminal. resolvedAt is take/archive time (lands seconds after dispatch) — do NOT read it as completion.
  → Feedback is free-form text — read it (e.g. the final recap) for the detail; status gives you the terminal signal without parsing prose.

## Shell Tip

When posting bodies with markdown (backticks, quotes, special chars), use a file to avoid shell escaping issues:
  cat > /tmp/body.json << 'PAYLOAD'
  {"body":"Content with \`backticks\` and 'quotes' here"}
  PAYLOAD
  curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" -d @/tmp/body.json URL` : '';

    const text = `# Workspace API Proxy

Use this proxy to read and modify the issues, projects, and related data of the workspace that issued your token. The API is source-neutral — one contract across providers; this workspace is currently backed by Linear.

## Authentication

All requests require:
  Authorization: Bearer YOUR_TOKEN

Your token scope: ${scope}
${scope === 'read' ? '(Read-only — you can query but not modify data)' : '(Read-write — you can query and modify data)'}

## Example

curl -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/me
${readEndpoints}${writeEndpoints}

## Response Shapes

One convention across every endpoint, so you can branch on the same fields everywhere:

- **Success is the HTTP status.** Any 2xx is success; any non-2xx is failure. There is no
  partial state — a write never returns 2xx with a falsy success flag.
- **Reads** return the data directly: a single resource as the object itself
  (e.g. GET /me, GET /issues/{id}, GET /cycles/{id}), a collection under a named key
  (e.g. { "issues": [...] }, { "teams": [...] }). Nested collections (labels,
  children, comments, relations) are always plain arrays — never a {nodes:[...]}
  wrapper — and labels are plain name strings.
- **Writes** return { "success": true, ...} — issue/comment/relation/label writes nest the
  affected entity under a named key ({ "success": true, "issue": {...} }); other writes
  (dispatch, token) carry their fields alongside "success": true. A write that does not land
  is a non-2xx, never a 2xx.
- **Errors** are always { "error": "<message>", "detail"?: "<upstream detail>" } with a non-2xx
  status. "detail" carries the provider or AI upstream's own message when there is one.

## Error Codes

400 - Validation error (bad/missing field, malformed ID)
401 - Invalid, expired, or consumed token
403 - Endpoint requires read-write token (yours is read-only)
404 - Resource not found (includes a trashed target on the task-automation endpoints)
409 - Refusing to modify a trashed (soft-deleted) issue (write endpoints)
429 - Rate limited (max 60 requests/minute)
500 - Internal server error
502 - Upstream write was rejected (the create/update did not land)
503 - Workspace or AI service unavailable

## Notes

- All responses are JSON (except \`/api/proxy/autopilot/manual\` and \`/api/proxy/instructions\`, which are plain text).
- Issue IDs can be UUIDs or identifiers (e.g., "LIN-123").
- Dates are ISO 8601 format.
- Rate limit: 60 requests per minute.

## Client Notes

- **Validate Content-Type before parsing.** If the body is empty or
  \`Content-Type\` isn't \`application/json\`, it's almost always transient
  client-side network flakiness, not a proxy error. Safe to retry once for
  reads (GET). For a create (POST issues/comments/relations), do NOT
  blind-retry on an empty/lost response — the write may have already landed.
  Re-read (search or GET the issue) to confirm first. Identical comment
  creates are deduped server-side within a short window, so a confirming
  retry of the same body returns the original (\`"deduped": true\`) rather
  than a duplicate.
- **\`/api/proxy/recommend\` can exceed 25s.** The server emits whitespace
  heartbeats inside a single 200 response to stay inside Heroku's router
  cap. \`JSON.parse\` ignores interior whitespace, so a plain
  \`response.json()\` works — just don't set a client-side timeout below
  ~60s for this endpoint.
- **Status-vs-body on long-running endpoints.** Once a long-running
  response has started streaming keepalive bytes, the HTTP status is
  committed as 200; any error is conveyed in the body as
  \`{ "error": "...", "statusCode": 5xx }\`. Check for an \`error\` key
  before trusting \`200\`.
- **\`/stack\` uses a flat shape — the same one every endpoint now uses.** Use
  \`task.state.name\`, \`task.parent?.identifier\`, and \`task.children\` — do NOT
  expect \`state.nodes\`, \`parentIdentifier\`, or \`subtasks\`.
`;

    res.type('text/plain').send(text);
  });

  // =========================================================================
  // Consumer API - Read Endpoints
  // =========================================================================

  /**
   * GET /api/proxy/me
   */
  router.get('/api/proxy/me', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/me', reason);
      }

      const user = await provider.viewer(token);
      logEvent(req, '/api/proxy/me', 200);
      res.json(user);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/me', status);
      console.error('Proxy /me error:', err.message);
      jsonError(res, status, 'Failed to fetch user info', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/teams
   */
  router.get('/api/proxy/teams', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/teams', reason);
      }

      const teams = await provider.fetchTeams(token);
      logEvent(req, '/api/proxy/teams', 200);
      res.json({ teams });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/teams', status);
      console.error('Proxy /teams error:', err.message);
      jsonError(res, status, 'Failed to fetch teams', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/projects
   */
  router.get('/api/proxy/projects', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/projects', reason);
      }

      const projectList = await provider.projects(token);
      logEvent(req, '/api/proxy/projects', 200);
      res.json({ projects: projectList.map(neutralizeProject) });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/projects', status);
      console.error('Proxy /projects error:', err.message);
      jsonError(res, status, 'Failed to fetch projects', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/issues
   */
  router.get('/api/proxy/issues', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);
      }

      const teamId = req.query.teamId;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 250);

      if (teamId && !UUID_REGEX.test(teamId)) {
        logEvent(req, '/api/proxy/issues', 400);
        return badRequest.json(res, 'Invalid teamId format');
      }

      const { nodes, pageInfo } = await provider.issues(token, { teamId: teamId || null, first: limit, after: null });
      logEvent(req, '/api/proxy/issues', 200);
      res.json({
        issues: nodes.map(flattenIssue),
        pageInfo: {
          hasNextPage: pageInfo.hasNextPage || false,
          endCursor: pageInfo.endCursor || null
        }
      });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues', status);
      console.error('Proxy /issues error:', err.message);
      jsonError(res, status, 'Failed to fetch issues', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/issues/:issueId
   */
  router.get('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/:id', reason);
      }

      const { issueId } = req.params;

      // Allow UUID or identifier (e.g., "LIN-123")
      if (!isValidIssueId(issueId)) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const issue = await provider.issueDetail(token, issueId);
      if (!issue) {
        logEvent(req, '/api/proxy/issues/:id', 404);
        return notFound.json(res, 'Issue not found');
      }

      if (issue.comments?.nodes) {
        issue.comments.nodes.sort((a, b) => {
          const ta = new Date(a.createdAt).getTime();
          const tb = new Date(b.createdAt).getTime();
          return (isNaN(ta) ? 0 : ta) - (isNaN(tb) ? 0 : tb);
        });
      }

      // LIN-401: a trashed issue still resolves by ID with a stale pre-deletion
      // state. Override it to a terminal Trashed/canceled state + trashed flag so
      // a consumer cannot mistake the ghost for live work.
      applyTrashedSignal(issue);

      logEvent(req, '/api/proxy/issues/:id', 200);
      res.json(flattenIssue(issue));
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/:id', status);
      console.error('Proxy /issue error:', err.message);
      jsonError(res, status, 'Failed to fetch issue', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/search
   */
  router.get('/api/proxy/search', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/search', reason);
      }

      const query = req.query.q;
      if (!query || typeof query !== 'string') {
        logEvent(req, '/api/proxy/search', 400);
        return badRequest.json(res, 'q query parameter is required');
      }

      if (query.length > MAX_SEARCH_LENGTH) {
        logEvent(req, '/api/proxy/search', 400);
        return badRequest.json(res, `Search query too long (max ${MAX_SEARCH_LENGTH})`);
      }

      const results = await provider.search(token, query, { first: 50 });
      logEvent(req, '/api/proxy/search', 200);
      res.json({ issues: results.map(flattenIssue) });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/search', status);
      console.error('Proxy /search error:', err.message);
      jsonError(res, status, 'Failed to search issues', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/states/:teamId
   */
  router.get('/api/proxy/states/:teamId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/states', reason);
      }

      const { teamId } = req.params;
      if (!UUID_REGEX.test(teamId)) {
        logEvent(req, '/api/proxy/states', 400);
        return badRequest.json(res, 'Invalid team ID format');
      }

      // Provider already sorts by board position (drop the route's duplicate sort).
      const stateList = await provider.states(token, teamId);
      logEvent(req, '/api/proxy/states', 200);
      res.json({ states: stateList });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/states', status);
      console.error('Proxy /states error:', err.message);
      jsonError(res, status, 'Failed to fetch states', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/labels
   */
  router.get('/api/proxy/labels', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/labels', reason);
      }

      const teamId = req.query.teamId;
      if (teamId && !UUID_REGEX.test(teamId)) {
        logEvent(req, '/api/proxy/labels', 400);
        return badRequest.json(res, 'Invalid team ID format');
      }

      const labelList = await provider.labels(token, teamId || null);
      logEvent(req, '/api/proxy/labels', 200);
      res.json({ labels: labelList });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/labels', status);
      console.error('Proxy /labels error:', err.message);
      jsonError(res, status, 'Failed to fetch labels', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/cycles
   * List cycles, optionally filtered by team.
   */
  router.get('/api/proxy/cycles', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/cycles', reason);
      }

      const teamId = req.query.teamId;
      if (teamId && !UUID_REGEX.test(teamId)) {
        logEvent(req, '/api/proxy/cycles', 400);
        return badRequest.json(res, 'Invalid team ID format');
      }

      const cycleList = await provider.cycles(token, teamId || null);
      logEvent(req, '/api/proxy/cycles', 200);
      res.json({ cycles: cycleList });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/cycles', status);
      console.error('Proxy /cycles error:', err.message);
      jsonError(res, status, 'Failed to fetch cycles', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/cycles/:cycleId  (canonical — plural, mirrors the /cycles list)
   * GET /api/proxy/cycle/:cycleId    (forgiving alias, singular)
   * Get cycle detail with issues. Shared :cycleId param across both forms (LIN-528).
   */
  router.get(['/api/proxy/cycles/:cycleId', '/api/proxy/cycle/:cycleId'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/cycle', reason);
      }

      const { cycleId } = req.params;
      if (!UUID_REGEX.test(cycleId)) {
        logEvent(req, '/api/proxy/cycle', 400);
        return badRequest.json(res, 'Invalid cycle ID format');
      }

      const cycle = await provider.cycleDetail(token, cycleId);
      if (!cycle) {
        logEvent(req, '/api/proxy/cycle', 404);
        return notFound.json(res, 'Cycle not found');
      }

      logEvent(req, '/api/proxy/cycle', 200);
      res.json(flattenCycle(cycle));
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/cycle', status);
      console.error('Proxy /cycle error:', err.message);
      jsonError(res, status, 'Failed to fetch cycle', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * GET /api/proxy/issues/:issueId/relations  (canonical — heals the read/write split-brain;
   *     the write form already lives at POST /issues/:issueId/relations)
   * GET /api/proxy/relations/:issueId           (forgiving alias, original flat form)
   * Shared :issueId param across both forms (LIN-528).
   */
  router.get(['/api/proxy/issues/:issueId/relations', '/api/proxy/relations/:issueId'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/relations', reason);
      }

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        logEvent(req, '/api/proxy/relations', 400);
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const issueRelations = await provider.relations(token, issueId);
      if (!issueRelations) {
        logEvent(req, '/api/proxy/relations', 404);
        return notFound.json(res, 'Issue not found');
      }

      // LIN-401: this query selects only relations (no root state to override),
      // so a trashed target is signalled by a top-level `trashed: true` flag.
      // The relations themselves are still returned — a consumer may legitimately
      // want to see what a now-deleted issue was related to.
      logEvent(req, '/api/proxy/relations', 200);
      // Plain arrays (no {nodes} wrapper) to match /issues/{id} and the rest of
      // the read surface — one flat convention across every endpoint (LIN-310).
      res.json({
        trashed: isTrashed(issueRelations),
        ...flattenRelations(issueRelations)
      });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/relations', status);
      console.error('Proxy /relations error:', err.message);
      jsonError(res, status, 'Failed to fetch relations', { detail: graphqlErrorDetail(err) });
    }
  });

  // =========================================================================
  // GET /api/proxy/attachments/:id — Bearer-authed image byte-relay (LIN-650)
  // =========================================================================
  //
  // External consumers hold an OPAQUE attachment handle (LIN-649), never a
  // backend URL — the proxy is deliberately source-neutral and strips asset
  // URLs — and their *proxy* token 401s against the asset host, so they cannot
  // fetch image bytes directly. This relay decodes the handle and fetches the
  // bytes server-side, authenticating BY PROVIDER/HOST (LIN-771): Linear asset
  // hosts get the workspace bearer token; GitHub user-content hosts are public and
  // fetched with no auth so the workspace token is never sent cross-provider. The
  // consumer is the external automation agent reading task/comment image
  // attachments (direct beneficiary; no other endpoint changes).
  //
  // `md:` markdown handles resolve here. The URL is recovered by
  // `decodeAttachmentHandle`, SSRF-guarded against the host allowlist
  // (mirrors the LIN-156 `/api/image` guard model: https-only, exact-host
  // allowlist, no path traversal, no redirects, 10 MB cap), then fetched through
  // the proxy-aware egress path. Two media classes are accepted (LIN-750):
  //   - images: recognised by the upstream `image/*` content-type;
  //   - non-image text/source files: recognised by the `#name=<filename>` hint the
  //     discovery layer encoded in the handle (upload URLs are extension-less and
  //     upstream often serves octet-stream, so the hint is authoritative), gated
  //     to a small allowlist (`relayContentTypeFromName`).
  // A content-type that is neither an allowlisted file nor an image is rejected
  // cleanly (never a 500).
  //
  // SAFE-DOWNLOAD CONTRACT (LIN-774): regardless of class, EVERY relayed byte is
  // served as a forced download — `Content-Disposition: attachment` +
  // `X-Content-Type-Options: nosniff` with a neutral `application/octet-stream`
  // content-type. The relay never preserves the upstream content-type and never
  // serves anything inline, so `image/svg+xml` (which would otherwise sniff/render
  // as active markup) cannot become a stored-XSS vector. The security boundary is
  // the host-allowlist + size cap + this download-coercion — NOT a per-extension
  // type-allowlist (the file-extension gate above is an access filter, not the
  // thing standing between bytes and inline execution).
  //
  // `att:` formal-attachment handles are NOT byte-resolvable in this slice — the
  // wire dropped their URL and there is no provider fetch seam yet — so they get
  // a clean 422 + machine-readable code, intentionally deferred to a follow-up.
  // Any other shape is a 400. We never silently 500 on the missing capability.
  // Kept in lockstep with discovery's UPLOAD_HOSTS (lib/proxy-wire.js): every host
  // discovery can mint a handle for must be relayable here, or discovery would emit
  // a handle this guard refuses. The GitHub asset hosts are sourced from the SAME
  // exported set so the two allowlists cannot drift (LIN-771). `linear.app` stays
  // relay-only (it is an SSRF allow, not a discovery upload host).
  const ATTACHMENT_ALLOWED_HOSTS = new Set([
    'uploads.linear.app', 'cdn.linear.app', 'linear.app',
    ...GITHUB_UPLOAD_HOSTS,
  ]);
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB — matches /api/image

  router.get('/api/proxy/attachments/:id', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const endpoint = '/api/proxy/attachments/:id';

    const decoded = decodeAttachmentHandle(req.params.id);
    if (!decoded) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'Invalid attachment handle');
    }

    // `att:` formal-attachment byte-resolution is deferred (needs a new
    // capability-gated provider.fetchAttachment seam). Name the gap; don't 500.
    if (decoded.type === 'att') {
      logEvent(req, endpoint, 422);
      return jsonError(res, 422, 'Formal attachment byte-resolution is not supported yet', {
        code: 'ATTACHMENT_FETCH_NOT_SUPPORTED',
        handleType: 'att',
      });
    }

    // `md:` handle — decoded.value is the source image URL. SSRF-guard it exactly
    // as /api/image does before any egress.
    const imageUrl = decoded.value;
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith('https://')) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'Invalid attachment URL: must be HTTPS');
    }
    let urlObj;
    try {
      urlObj = new URL(imageUrl);
    } catch {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'Invalid attachment URL format');
    }
    if (!ATTACHMENT_ALLOWED_HOSTS.has(urlObj.hostname)) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'Invalid attachment URL: must be from Linear');
    }
    if (urlObj.pathname.includes('..')) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'Invalid attachment URL: path traversal not allowed');
    }

    // Resolve the fetch auth BY PROVIDER/HOST (LIN-771). Historically the relay
    // sent the workspace's Linear bearer token to every asset host — correct for
    // Linear, but a token-leak hazard for GitHub user-content. We instead key off
    // the asset host (which uniquely identifies its provider):
    //   - Linear hosts  → authenticated with the workspace token (unchanged: the
    //     asset host requires it). Resolved through the shared provider/token seam
    //     so an unavailable workspace still yields the structured 503 envelope.
    //   - GitHub asset hosts → public user-content CDNs; fetched WITHOUT any auth
    //     header so the workspace token is never sent cross-provider. A workspace
    //     token is therefore not required to relay them.
    // Known gap, sequenced with S4/S5 (LIN-773/774, relay safety): the signed
    // `private-user-images.githubusercontent.com` form and the `github.com/
    // user-attachments/assets/<id>` form 302-redirect to the real bytes, which the
    // `redirect: 'error'` SSRF guard below rejects (a clean 400, never a 500).
    // Redirect-safe relaying of those is owned by S5; `user-images.
    // githubusercontent.com` serves bytes directly and works today.
    const isGithubAssetHost = GITHUB_UPLOAD_HOSTS.includes(urlObj.hostname);
    const { token, reason } = await resolveProviderAccess(req.proxyUrlKey);
    if (!isGithubAssetHost && !token) {
      return workspaceUnavailable(req, res, endpoint, reason);
    }

    // Non-image file relay (LIN-750): discovery encodes the filename in a
    // `#name=<filename>` fragment so we can type extension-less upload bytes.
    // The fragment is stripped before egress (it must never reach the asset
    // host); `relayContentTypeFromName` is the sole type-gate and returns null
    // for anything not on the allowlist.
    const nameHint = new URLSearchParams(urlObj.hash.replace(/^#/, '')).get('name');
    const typedFromHint = nameHint ? relayContentTypeFromName(nameHint) : null;
    const isFileRelay = !!typedFromHint && !typedFromHint.startsWith('image/');
    const fetchUrl = imageUrl.split('#')[0];

    try {
      // Proxy-aware egress: route through the egress proxy when one is
      // configured, exactly like every other Linear call.
      const customFetch = (await createProxyFetch()) || fetch;
      // Auth header by host: Linear asset hosts require the workspace bearer token
      // (unchanged); GitHub user-content is public, so send no Authorization and
      // never leak the workspace token cross-provider (LIN-771).
      const fetchHeaders = isGithubAssetHost ? {} : { Authorization: `Bearer ${token}` };
      const response = await customFetch(fetchUrl, {
        method: 'GET',
        headers: fetchHeaders,
        redirect: 'error', // a redirect could bypass the SSRF allowlist
      });

      if (!response.ok) {
        logEvent(req, endpoint, response.status);
        return jsonError(res, response.status, 'Failed to fetch attachment');
      }

      // Type-gate. Images keep the original upstream-`image/*` contract; file
      // relays are typed from the (allowlisted) filename hint. Anything else is
      // rejected cleanly — never a 500.
      const upstreamType = response.headers.get('content-type') || '';
      if (!isFileRelay && !upstreamType.startsWith('image/')) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'Invalid response: unsupported content-type');
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_ATTACHMENT_BYTES) {
        logEvent(req, endpoint, 413);
        return jsonError(res, 413, 'Attachment too large');
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_ATTACHMENT_BYTES) {
        logEvent(req, endpoint, 413);
        return jsonError(res, 413, 'Attachment too large');
      }

      // Safe-download contract for ALL relayed bytes (LIN-774). Force download
      // with a neutral content-type + nosniff so nothing — most dangerously
      // `image/svg+xml` — can be sniffed back into a renderable/executable type or
      // served inline. We deliberately do NOT preserve the upstream content-type
      // (image or file): the upstream `image/*`/file class is used only to admit
      // the bytes (the gate above), never to type the response.
      const rawName = nameHint || urlObj.pathname.split('/').pop() || 'attachment';
      const safeName = rawName.replace(/[^\w.\- ]/g, '_') || 'attachment';
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="${safeName}"`);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'private, max-age=3600');
      logEvent(req, endpoint, 200);
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      // redirect: 'error' surfaces as a thrown fetch error on the native path.
      if (error.cause?.code === 'ERR_FR_TOO_MANY_REDIRECTS' || error.message?.includes('redirect')) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'Redirects not allowed');
      }
      console.error('Proxy attachment relay error:', error.message);
      logEvent(req, endpoint, 502);
      jsonError(res, 502, 'Failed to fetch attachment');
    }
  });

  // =========================================================================
  // Consumer API - Write Endpoints
  // =========================================================================

  /**
   * POST /api/proxy/issues
   * Create a new issue.
   */
  router.post('/api/proxy/issues', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (denyIfUnsupported(provider, 'createIssue', req, res, '/api/proxy/issues')) return;
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);
      }

      const { teamId, title, description, projectId, stateId, assigneeId, priority, parentId, cycleId } = req.body;

      // teamId is required and may be a UUID, a team key (e.g. `LIN`), or a team
      // name (LIN-556); the symbolic→id resolution happens once below so the
      // resolved id can also scope the symbolic stateId.
      if (!teamId || typeof teamId !== 'string') {
        logEvent(req, '/api/proxy/issues', 400);
        return badRequest.json(res, 'Valid teamId is required');
      }

      if (!title || typeof title !== 'string') {
        logEvent(req, '/api/proxy/issues', 400);
        return badRequest.json(res, 'title is required');
      }

      if (title.length > MAX_NAME_LENGTH) {
        return badRequest.json(res, `title exceeds maximum length of ${MAX_NAME_LENGTH}`);
      }

      if (description && description.length > MAX_DESCRIPTION_LENGTH) {
        return badRequest.json(res, 'description exceeds maximum length');
      }

      if (DANGEROUS_CHARS_REGEX.test(title)) {
        return badRequest.json(res, 'title contains invalid characters');
      }

      if (description && DANGEROUS_CHARS_REGEX.test(description)) {
        return badRequest.json(res, 'description contains invalid characters');
      }

      const resolvedTeamId = await resolveTeamInput(provider, token, teamId);

      const input = { teamId: resolvedTeamId, title };
      if (description) input.description = description;
      // LIN-556: projectId / stateId accept symbolic names alongside UUIDs.
      // State is scoped to the just-resolved team so symbolic matches cannot
      // bleed across teams. assigneeId / parentId / cycleId stay UUID-only this
      // ticket (named out of scope in the LIN-556 design record).
      if (projectId) input.projectId = await resolveProjectInput(provider, token, projectId);
      if (stateId) input.stateId = await resolveStateInput(provider, token, resolvedTeamId, stateId);
      if (assigneeId && UUID_REGEX.test(assigneeId)) input.assigneeId = assigneeId;
      if (parentId && UUID_REGEX.test(parentId)) input.parentId = parentId;
      if (cycleId && UUID_REGEX.test(cycleId)) input.cycleId = cycleId;
      if (priority !== undefined && Number.isInteger(priority) && priority >= 0 && priority <= 4) {
        input.priority = priority;
      }

      const issueCreate = normalizeWritePayload(await provider.createIssue(token, input), 'issue');
      if (writeRejected(req, res, '/api/proxy/issues', issueCreate, 'Issue was not created')) return;
      flattenIssue(issueCreate.issue);
      logEvent(req, '/api/proxy/issues', 201);
      res.status(201).json(issueCreate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues', err)) return;
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues', status);
      console.error('Proxy create issue error:', err.message);
      jsonError(res, status, 'Failed to create issue', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * PATCH /api/proxy/issues/:issueId
   * Update an issue.
   */
  /**
   * LIN-401: refuse a write whose target is a trashed (soft-deleted) issue.
   * Returns true (and sends a 409) when the issue is trashed, so the caller can
   * `if (await refuseIfTrashed(...)) return;` before mutating. A missing issue
   * (null) is NOT refused here — the mutation proceeds and Linear's own
   * not-found error maps to the usual status, preserving existing behaviour.
   */
  async function refuseIfTrashed(activeProvider, token, issueId, req, res, endpoint) {
    const issue = await activeProvider.issueWriteGuard(token, issueId);
    if (isTrashed(issue)) {
      logEvent(req, endpoint, 409);
      jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      return true;
    }
    return false;
  }

  router.patch('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (denyIfUnsupported(provider, 'updateIssue', req, res, '/api/proxy/issues/:id')) return;
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/:id', reason);
      }

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const { title, description, stateId, assigneeId, priority, projectId, parentId, cycleId } = req.body;

      if (title && title.length > MAX_NAME_LENGTH) {
        return badRequest.json(res, `title exceeds maximum length of ${MAX_NAME_LENGTH}`);
      }

      if (title && DANGEROUS_CHARS_REGEX.test(title)) {
        return badRequest.json(res, 'title contains invalid characters');
      }

      if (description && description.length > MAX_DESCRIPTION_LENGTH) {
        return badRequest.json(res, 'description exceeds maximum length');
      }

      if (description && DANGEROUS_CHARS_REGEX.test(description)) {
        return badRequest.json(res, 'description contains invalid characters');
      }

      // Reject a wholly empty body before any read (preserves the no-network 400
      // for `{}`); the post-resolution check below still catches a body whose
      // only fields are unsupported/dropped.
      const hasUpdatableField = [title, description, stateId, assigneeId, projectId, parentId, cycleId, priority]
        .some(v => v !== undefined);
      if (!hasUpdatableField) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'No valid fields to update');
      }

      // LIN-556: one guard read serves both the trashed refusal AND the team
      // scope a symbolic stateId needs (e.g. `done` → the team's completed
      // state). Replaces the former post-build refuseIfTrashed call.
      const guard = await provider.issueWriteGuard(token, issueId);
      if (isTrashed(guard)) {
        logEvent(req, '/api/proxy/issues/:id', 409);
        return jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      }
      const teamId = guard?.team?.id || null;

      const input = {};
      if (title) input.title = title;
      if (description !== undefined) input.description = description;
      // LIN-556: stateId / projectId accept symbolic names alongside UUIDs;
      // state is scoped to the issue's team. assigneeId / parentId / cycleId
      // stay UUID-only this ticket (named out of scope in the design record).
      if (stateId) input.stateId = await resolveStateInput(provider, token, teamId, stateId);
      if (projectId) input.projectId = await resolveProjectInput(provider, token, projectId);
      if (assigneeId && UUID_REGEX.test(assigneeId)) input.assigneeId = assigneeId;
      if (parentId === null) input.parentId = null;
      else if (parentId && UUID_REGEX.test(parentId)) input.parentId = parentId;
      if (cycleId && UUID_REGEX.test(cycleId)) input.cycleId = cycleId;
      if (priority !== undefined && Number.isInteger(priority) && priority >= 0 && priority <= 4) {
        input.priority = priority;
      }

      if (Object.keys(input).length === 0) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'No valid fields to update');
      }

      const issueUpdate = normalizeWritePayload(await provider.updateIssue(token, issueId, input), 'issue');
      if (writeRejected(req, res, '/api/proxy/issues/:id', issueUpdate, 'Issue was not updated')) return;
      flattenIssue(issueUpdate.issue);
      logEvent(req, '/api/proxy/issues/:id', 200);
      res.json(issueUpdate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues/:id', err)) return;
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/:id', status);
      console.error('Proxy update issue error:', err.message);
      jsonError(res, status, 'Failed to update issue', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * Shared read-modify-write for the description edit endpoints. Reads the live
   * body, lets `merge(current)` produce the new body, validates it, and writes.
   * The agent never re-emits the original, so the LIN-398 corruption class cannot
   * recur. `merge` may throw DescriptionEditError for a loud 422.
   */
  async function applyDescriptionEdit(req, res, endpoint, merge) {
    const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
    if (denyIfUnsupported(provider, 'updateIssue', req, res, endpoint)) return;
    if (!token) {
      return workspaceUnavailable(req, res, endpoint, reason);
    }

    const { issueId } = req.params;
    if (!isValidIssueId(issueId)) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'Invalid issue ID format');
    }

    let newDescription;
    try {
      const issue = await provider.issueDescription(token, issueId);
      if (!issue) {
        logEvent(req, endpoint, 404);
        return notFound.json(res, 'Issue not found');
      }
      if (isTrashed(issue)) {
        logEvent(req, endpoint, 409);
        return jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      }
      newDescription = merge(issue.description || '');
    } catch (err) {
      if (err instanceof DescriptionEditError) {
        logEvent(req, endpoint, 422);
        return jsonError(res, 422, err.message, { code: err.code, matchCount: err.matchCount });
      }
      const status = graphqlErrorStatus(err);
      logEvent(req, endpoint, status);
      console.error('Proxy description edit (read) error:', err.message);
      return jsonError(res, status, 'Failed to read issue description', { detail: graphqlErrorDetail(err) });
    }

    if (newDescription.length > MAX_DESCRIPTION_LENGTH) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'resulting description exceeds maximum length');
    }
    if (DANGEROUS_CHARS_REGEX.test(newDescription)) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'resulting description contains invalid characters');
    }

    try {
      const issueUpdate = normalizeWritePayload(await provider.updateIssue(token, issueId, { description: newDescription }), 'issue');
      flattenIssue(issueUpdate.issue);
      logEvent(req, endpoint, 200);
      res.json(issueUpdate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, endpoint, status);
      console.error('Proxy description edit (write) error:', err.message);
      jsonError(res, status, 'Failed to update description', { detail: graphqlErrorDetail(err) });
    }
  }

  /**
   * POST /api/proxy/issues/:issueId/description/append
   * Append a block to the end of an issue's description. The agent supplies only
   * the new content; the existing body is preserved byte-for-byte.
   */
  router.post('/api/proxy/issues/:issueId/description/append', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const endpoint = '/api/proxy/issues/:id/description/append';
    const { block } = req.body;
    if (!block || typeof block !== 'string') {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'block is required');
    }
    if (block.length > MAX_DESCRIPTION_LENGTH) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'block exceeds maximum length');
    }
    if (DANGEROUS_CHARS_REGEX.test(block)) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'block contains invalid characters');
    }
    return applyDescriptionEdit(req, res, endpoint, (current) => appendBlock(current, block));
  });

  /**
   * POST /api/proxy/issues/:issueId/description/replace
   * Replace a single, uniquely-matched span in an issue's description. Matching is
   * normalised (backslash-unescaped) on both sides and fails loud (422) when the
   * span is missing or ambiguous. Full rewrites stay on PATCH .../issues/:id.
   */
  router.post('/api/proxy/issues/:issueId/description/replace', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const endpoint = '/api/proxy/issues/:id/description/replace';
    const { oldString, newString } = req.body;
    if (!oldString || typeof oldString !== 'string') {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'oldString is required');
    }
    if (typeof newString !== 'string') {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'newString is required');
    }
    if (newString.length > MAX_DESCRIPTION_LENGTH) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'newString exceeds maximum length');
    }
    if (DANGEROUS_CHARS_REGEX.test(newString)) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'newString contains invalid characters');
    }
    return applyDescriptionEdit(req, res, endpoint, (current) => replaceInDescription(current, oldString, newString));
  });

  /**
   * POST /api/proxy/issues/:issueId/comments  (canonical — nested issue-scoped form)
   * POST /api/proxy/comments/:issueId           (forgiving alias, flat form)
   * Add a comment to an issue. Shared :issueId param across both forms (LIN-528).
   */
  router.post(['/api/proxy/issues/:issueId/comments', '/api/proxy/comments/:issueId'], proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (denyIfUnsupported(provider, 'createComment', req, res, '/api/proxy/issues/comments')) return;
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/comments', reason);
      }

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const { body } = req.body;
      if (!body || typeof body !== 'string') {
        logEvent(req, '/api/proxy/issues/comments', 400);
        return badRequest.json(res, 'body is required');
      }

      if (body.length > MAX_COMMENT_LENGTH) {
        return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`);
      }

      if (DANGEROUS_CHARS_REGEX.test(body)) {
        return badRequest.json(res, 'body contains invalid characters');
      }

      if (await refuseIfTrashed(provider, token, issueId, req, res, '/api/proxy/issues/comments')) return;

      // Deterministic dedupe (LIN-399): if an identical comment was just
      // created for this issue, return that one instead of minting a duplicate.
      const key = dedupeKey(req.proxyUrlKey, issueId, body);
      const prior = commentDedupe.get(key);
      if (prior) {
        logEvent(req, '/api/proxy/issues/comments', 200);
        return res.status(200).json({ ...prior, deduped: true });
      }

      const commentCreate = normalizeWritePayload(await provider.createComment(token, issueId, body), 'comment');

      // Surface a clear failure instead of a misleading 201 when Linear
      // reports the write did not land.
      if (writeRejected(req, res, '/api/proxy/issues/comments', commentCreate, 'Comment was not created')) return;

      commentDedupe.set(key, commentCreate);
      logEvent(req, '/api/proxy/issues/comments', 201);
      res.status(201).json(commentCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/comments', status);
      console.error('Proxy create comment error:', err.message);
      jsonError(res, status, 'Failed to create comment', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * POST /api/proxy/issues/:issueId/relations
   * Create a relation between issues.
   */
  router.post('/api/proxy/issues/:issueId/relations', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (denyIfUnsupported(provider, 'createRelation', req, res, '/api/proxy/issues/relations')) return;
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/relations', reason);
      }

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const { type, relatedIssueId } = req.body;
      const validTypes = ['blocks', 'blocked-by', 'duplicate', 'related'];
      if (!type || !validTypes.includes(type)) {
        logEvent(req, '/api/proxy/issues/relations', 400);
        return badRequest.json(res, `type must be one of: ${validTypes.join(', ')}`);
      }

      if (!relatedIssueId || !isValidIssueId(relatedIssueId)) {
        return badRequest.json(res, 'Valid relatedIssueId is required');
      }

      if (await refuseIfTrashed(provider, token, issueId, req, res, '/api/proxy/issues/relations')) return;

      // The provider owns the blocked-by → inverse-blocks sugar (ids swapped).
      const issueRelationCreate = normalizeWritePayload(await provider.createRelation(token, issueId, { type, relatedIssueId }), 'issueRelation');
      if (writeRejected(req, res, '/api/proxy/issues/relations', issueRelationCreate, 'Relation was not created')) return;
      logEvent(req, '/api/proxy/issues/relations', 201);
      res.status(201).json(issueRelationCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/relations', status);
      console.error('Proxy create relation error:', err.message);
      jsonError(res, status, 'Failed to create relation', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * DELETE /api/proxy/issues/:issueId/relations/:relationId
   * Remove a relation. The relationId is the IssueRelation's own id, which is
   * exposed on the nodes returned by GET /relations/:issueId and GET /issue/:id.
   *
   * Note: :issueId is accepted for a consistent URL shape with the other
   * /issue/:issueId/... endpoints, but the delete is keyed solely on relationId
   * (Linear deletes by relation id, not by the issue pair). It is validated for
   * format but not otherwise used.
   */
  router.delete('/api/proxy/issues/:issueId/relations/:relationId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (denyIfUnsupported(provider, 'deleteRelation', req, res, '/api/proxy/issues/relations')) return;
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/relations', reason);
      }

      const { issueId, relationId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }
      if (!UUID_REGEX.test(relationId)) {
        logEvent(req, '/api/proxy/issues/relations', 400);
        return badRequest.json(res, 'Invalid relation ID format');
      }

      const issueRelationDelete = await provider.deleteRelation(token, relationId);
      if (writeRejected(req, res, '/api/proxy/issues/relations', issueRelationDelete, 'Relation was not removed')) return;
      logEvent(req, '/api/proxy/issues/relations', 200);
      res.json(issueRelationDelete);
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/relations', status);
      console.error('Proxy delete relation error:', err.message);
      jsonError(res, status, 'Failed to delete relation', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * POST /api/proxy/issues/:issueId/labels
   * Add a label to an issue.
   *
   * Note: This performs a Read-Modify-Write cycle (fetch current labels, then
   * update with the new set) because Linear's GraphQL API requires sending the
   * full label ID array. Concurrent label modifications (e.g. from the Linear
   * UI and this proxy simultaneously) could overwrite each other. This is an
   * inherent limitation of Linear's label API — there is no atomic add/remove.
   */
  router.post('/api/proxy/issues/:issueId/labels', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (denyIfUnsupported(provider, 'addLabel', req, res, '/api/proxy/issues/labels')) return;
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/labels', reason);
      }

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const { labelId } = req.body;
      if (!labelId || typeof labelId !== 'string') {
        logEvent(req, '/api/proxy/issues/labels', 400);
        return badRequest.json(res, 'Valid labelId is required');
      }

      // LIN-556: labelId may be a UUID or a label name (case-insensitive).
      const resolvedLabelId = await resolveLabelInput(provider, token, labelId);

      // Fetch current labels (the read half of the label read-modify-write).
      const issue = await provider.issueLabels(token, issueId);
      if (!issue) {
        logEvent(req, '/api/proxy/issues/labels', 404);
        return notFound.json(res, 'Issue not found');
      }
      if (isTrashed(issue)) {
        logEvent(req, '/api/proxy/issues/labels', 409);
        return jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      }

      const currentLabelIds = (issue.labels?.nodes || []).map(l => l.id);
      if (currentLabelIds.includes(resolvedLabelId)) {
        logEvent(req, '/api/proxy/issues/labels', 200);
        return res.json({ success: true, message: 'Label already present' });
      }

      const issueUpdate = await provider.updateIssueLabels(token, issueId, [...currentLabelIds, resolvedLabelId]);
      if (writeRejected(req, res, '/api/proxy/issues/labels', issueUpdate, 'Label was not added')) return;
      flattenIssue(issueUpdate.issue);
      logEvent(req, '/api/proxy/issues/labels', 200);
      res.json(issueUpdate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues/labels', err)) return;
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/labels', status);
      console.error('Proxy add label error:', err.message);
      jsonError(res, status, 'Failed to add label', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * DELETE /api/proxy/issues/:issueId/labels/:labelId
   * Remove a label from an issue.
   *
   * Note: Same Read-Modify-Write race condition caveat as the add-label
   * endpoint above. See POST /labels comment for details.
   */
  router.delete('/api/proxy/issues/:issueId/labels/:labelId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey);
      if (denyIfUnsupported(provider, 'removeLabel', req, res, '/api/proxy/issues/labels')) return;
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/labels', reason);
      }

      const { issueId, labelId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }

      // LIN-556: labelId may be a UUID or a label name (case-insensitive).
      const resolvedLabelId = await resolveLabelInput(provider, token, labelId);

      // Fetch current labels (the read half of the label read-modify-write).
      const issue = await provider.issueLabels(token, issueId);
      if (!issue) {
        logEvent(req, '/api/proxy/issues/labels', 404);
        return notFound.json(res, 'Issue not found');
      }
      if (isTrashed(issue)) {
        logEvent(req, '/api/proxy/issues/labels', 409);
        return jsonError(res, 409, 'Issue is trashed; refusing to modify a deleted issue');
      }

      const currentLabelIds = (issue.labels?.nodes || []).map(l => l.id);
      const filtered = currentLabelIds.filter(id => id !== resolvedLabelId);

      if (filtered.length === currentLabelIds.length) {
        logEvent(req, '/api/proxy/issues/labels', 200);
        return res.json({ success: true, message: 'Label not present' });
      }

      const issueUpdate = await provider.updateIssueLabels(token, issueId, filtered);
      if (writeRejected(req, res, '/api/proxy/issues/labels', issueUpdate, 'Label was not removed')) return;
      flattenIssue(issueUpdate.issue);
      logEvent(req, '/api/proxy/issues/labels', 200);
      res.json(issueUpdate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues/labels', err)) return;
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/issues/labels', status);
      console.error('Proxy remove label error:', err.message);
      jsonError(res, status, 'Failed to remove label', { detail: graphqlErrorDetail(err) });
    }
  });

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
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/stack', reason);
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 50);

      // Fetch projects and issues (use mock data in test mode)
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      let projects, issues;
      if (isTestMode) {
        const mockData = await getTestMockData();
        projects = [...mockData.projects];
        issues = [...mockData.issues];
      } else {
        ({ projects, issues } = await withTimeout(fetchProjects(accessToken), MULTI_REQUEST_TIMEOUT_MS));
      }

      // Build tree structure
      const forest = buildForest(issues);
      if (forest.has(NO_PROJECT_ID)) {
        projects.push({
          id: NO_PROJECT_ID,
          name: 'No Project',
          content: null,
          url: null,
          sortOrder: Number.MAX_SAFE_INTEGER
        });
      }

      const inProgressTrees = buildInProgressForest(issues, projects);
      const recentActivityTrees = buildRecentActivityForest(issues, projects, 1);
      const trees = projects
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(project => {
          const { roots } = forest.get(project.id) || { roots: [] };
          const { incomplete } = partitionCompleted(roots);
          return { project, incomplete };
        });

      // Flatten and deduplicate (same as swipe view)
      const projectIssues = flattenTrees(trees, 'project');
      const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
      const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

      const seenIds = new Set();
      const allIssues = [];
      for (const issue of inProgressIssues) {
        if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
      }
      for (const issue of projectIssues) {
        if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
      }
      for (const issue of recentIssues) {
        if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
      }

      // Build parent/child relationships (flat throughout; this is already the
      // neutral flat wire shape the rest of the API now aligns onto).
      const cardById = new Map(allIssues.map(i => [i.id, i]));
      const childrenMap = new Map();
      for (const issue of allIssues) {
        if (issue.parentId && cardById.has(issue.parentId)) {
          const parent = cardById.get(issue.parentId);
          issue.parentIdentifier = parent.identifier;
          issue.parentTitle = parent.title;
          if (!childrenMap.has(issue.parentId)) childrenMap.set(issue.parentId, []);
          childrenMap.get(issue.parentId).push({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            state: { type: issue.stateType }
          });
        }
      }
      for (const [parentId, children] of childrenMap) {
        const parent = cardById.get(parentId);
        if (parent) parent.children = children;
      }

      // Compute transitive graph features (LIN-391) BEFORE the sort — they are
      // sort-keys (downstreamUnblocks/criticalPathLen) and also stamped onto the
      // digest line. Same ordering as the swipe view (renderSwipePage), which
      // runs the identical pipeline.
      computeGraphFeatures(allIssues);
      sortIssuesForSwipe(allIssues);
      const sortedIssues = clusterByParent(applyBlockingOrder(allIssues));

      // Trim to limit and project to the neutral flat wire shape. Agents assume
      // `state.name`, `parent.identifier`, `children` (not `subtasks`), so we
      // expose that shape uniformly here. Internal flat fields remain
      // available only to this handler.
      //
      // `?view=digest` returns a compact, orientation-grade projection: it drops
      // the (potentially large) full `description` in favour of a deterministic
      // one-line `headline`, and replaces the `children`/`blocksIds` arrays with
      // counts. This lets a light orchestrator (Autopilot) get a sense of the
      // whole stack at a glance without holding every task's full body in
      // context — then drill into one task's detail (full description / `/brief`)
      // only for the item it picks. See docs/autopilot-kickoff.md.
      const sliced = sortedIssues.slice(0, limit);
      // Off-page blockers (LIN-391): direct blockers pushed beyond the slice that
      // still shaped a visible line's position. Derived from final post-cluster
      // positions; no transitive closure stored.
      const offPageBlockers = computeOffPageBlockers(sortedIssues, limit);
      const isDigest = req.query.view === 'digest';
      const tasks = isDigest
        ? sliced.map(issue => {
            const heldBy = offPageBlockers.get(issue.id) || [];
            return {
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
              headline: toStackHeadline(issue.description),
              priority: issue.priority,
              state: { name: issue.stateName, type: issue.stateType },
              labels: issue.labels || [],
              section: issue.section || null,
              assignee: issue.assignee || null,
              project: issue.projectName ? { name: issue.projectName } : null,
              parent: issue.parentId
                ? { identifier: issue.parentIdentifier || null }
                : null,
              blocks: (issue.blocksIds || []).length,
              children: (issue.children || []).length,
              // Explainability (LIN-391): transitive features + compact `why`.
              downstreamUnblocks: issue.downstreamUnblocks || 0,
              criticalPathLen: issue.criticalPathLen || 0,
              ...(heldBy.length > 0 ? { heldBy } : {}),
              why: buildWhy(issue, heldBy)
            };
          })
        : sliced.map(issue => {
            const heldBy = offPageBlockers.get(issue.id) || [];
            return {
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
              description: issue.description,
              priority: issue.priority,
              state: { name: issue.stateName, type: issue.stateType },
              labels: issue.labels || [],
              project: issue.projectName ? { name: issue.projectName } : null,
              parent: issue.parentId
                ? { id: issue.parentId, identifier: issue.parentIdentifier || null, title: issue.parentTitle || null }
                : null,
              children: issue.children || [],
              blocksIds: issue.blocksIds || [],
              // Same computed scalars as digest, for full/digest consistency (LIN-391).
              downstreamUnblocks: issue.downstreamUnblocks || 0,
              criticalPathLen: issue.criticalPathLen || 0,
              ...(heldBy.length > 0 ? { heldBy } : {})
            };
          });

      logEvent(req, '/api/proxy/stack', 200);
      res.json({ tasks, total: sortedIssues.length, view: isDigest ? 'digest' : 'full' });
    } catch (err) {
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/stack', status);
      console.error('Proxy /stack error:', err.message);
      jsonError(res, status, 'Failed to fetch task stack', { detail: graphqlErrorDetail(err) });
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
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/prompt', reason);
      }

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
      const ctx = await resolvePromptIssueContext(accessToken, identifier, isTestMode);
      if (!ctx) {
        logEvent(req, '/api/proxy/prompt', 404);
        return notFound.json(res, 'Issue not found');
      }
      const { issue, parent, siblings, project, children, comments, attachments } = ctx;

      // Generate the prompt. Forward `attachments` so generatePrompt's
      // formatAttachmentsSection post-pass surfaces the worker-facing Attachments
      // section (LIN-776) — fetchIssueContext now carries it at top-level (LIN-772),
      // and dropping it here is what silently hid the section on this route.
      const result = generatePrompt(templateKey, issue, { parent, siblings, project, children, comments, attachments }, {});

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
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/prompt', status);
      console.error('Proxy /prompt error:', err.message);
      jsonError(res, status, 'Failed to generate prompt', { detail: graphqlErrorDetail(err) });
    }
  });

  // Charge one free-tier unit for a proxy LLM request about to generate. Returns
  // null when the request may proceed, or a { status, body } rejection carrying
  // the standard 429 envelope when the limit is hit. Caller sends it via res or
  // keepalive.send depending on whether the H12 keepalive is already armed.
  async function chargeFreeTierOrReject(urlKey) {
    const check = await freeTierStore.tryUse(urlKey);
    if (check.allowed) return null;
    return {
      status: 429,
      body: {
        error: check.reason,
        freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt }
      }
    };
  }

  /**
   * Shared, test-mode-aware recommendation compute used by both GET /recommend
   * and the fused POST /recommend-and-dispatch verb. Returns
   * { identifier, reasoning, prompt, truncated, repo, recommendedAction }.
   *
   * Does NOT manage keepalive — the calling handler arms it around this call
   * (the test-mode path resolves immediately, so arming is harmless there).
   * May throw (issue-not-found / OpenRouter / graphql); callers map the error
   * with recommendErrorResponse(). `sessionApiKey` may be passed in to avoid a
   * second key lookup when the caller already resolved it for its precheck.
   */
  async function computeRecommendation({ urlKey, createdBy, identifier, accessToken, isTestMode, sessionApiKey, deadline, noDescend = false }) {
    if (sessionApiKey === undefined) {
      sessionApiKey = await getWorkspaceOpenRouterKey(urlKey, createdBy);
    }

    if (isTestMode) {
      const mockData = await getTestMockData();
      // Find mock issue by UUID or identifier
      const mockIssue = mockData.issues.find(i =>
        i.id === identifier || i.identifier === identifier
      );
      if (!mockIssue) {
        throw new Error('Issue not found');
      }

      const labels = (mockIssue.labels?.nodes || []).map(l => l.name);
      const issueIdentifier = mockIssue.identifier || mockIssue.url?.split('/').pop() || 'ISSUE';

      let reasoning = 'Analyzing the task to determine the best approach.';
      let goal = 'Understand what this task involves and plan the next steps.';
      // recommendedAction mirrors the live meta-prompt's `→ **<name>**` signal so
      // the fused verb's `kind` plumbing is exercised in E2E: bug→bug,
      // blocked→blocked, started→implement, else plan.
      let recommendedAction = 'plan';

      // A node with an incomplete child defers to it (LIN-327), so the recommend
      // recursion (resolveRecommendation) is exercised end-to-end in E2E: a parent
      // resolves to its actionable descendant, not a parent-framed prompt. The `bug`
      // label and a blocking RELATIONSHIP (LIN-357: blocked is the relationship, not a
      // label) still take precedence so the existing routes stay covered.
      const mockChildren = mockData.issues.filter(i => i.parent?.id === mockIssue.id);
      const focusChild = mockChildren.find(c => c.state?.type !== 'completed' && c.state?.type !== 'canceled');

      if (labels.includes('bug')) {
        reasoning = 'This is a bug. Investigating systematically will help find the root cause.';
        goal = 'Identify reproduction steps, hypothesize causes, and suggest a fix.';
        recommendedAction = 'bug';
      } else if (isBlocked(mockIssue)) {
        reasoning = 'This task is blocked. Analyzing the blocker to find a way forward.';
        goal = 'Identify the blocker and recommend how to unblock.';
        recommendedAction = 'blocked';
      } else if (!noDescend && focusChild) {
        // No prompt body on defer — the cost contract (mirrors getRecommendation).
        // noDescend (LIN-365) skips this container branch so the parent's own work is
        // recommended even with an open child (mirrors the live focusedChild suppression).
        return {
          identifier: issueIdentifier,
          reasoning: `${issueIdentifier} is a container; the actionable work lives in ${focusChild.identifier}.`,
          prompt: null,
          truncated: false,
          repo: parseRepoFromDescription(mockData.projects.find(p => p.id === mockIssue.project?.id)?.content),
          recommendedAction: 'defer',
          deferTo: focusChild.identifier
        };
      } else if (mockIssue.state?.type === 'started') {
        reasoning = 'Task is in progress. Checking what work remains.';
        goal = 'Continue implementation and update progress.';
        recommendedAction = 'implement';
      }

      const mockProject = mockData.projects.find(p => p.id === mockIssue.project?.id);

      return {
        identifier: issueIdentifier,
        reasoning,
        prompt: `Help me with task ${issueIdentifier}\n\n## Context\n\n**Status:** ${mockIssue.state?.name || 'Unknown'}\n${labels.length > 0 ? `**Labels:** ${labels.join(', ')}` : ''}\n\n## Goal\n\n${goal}`,
        truncated: false,
        repo: parseRepoFromDescription(mockProject?.content),
        recommendedAction,
        deferTo: null
      };
    }

    // Live path. Fetch issue context with two-tier support for parent tasks,
    // then the AI recommendation. Uses a longer timeout since this makes a
    // Linear API call + an OpenRouter LLM call.
    const context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal, noDescend }), CONTEXT_FETCH_TIMEOUT_MS);
    const { issue, parent, siblings, project, children, comments, focusedChild, attachments } = context;

    // Resolve the effective key (free-tier when no session/env key) so both
    // recommend surfaces send a valid key. Metering is NOT done here — this runs
    // once per descent hop, so charging here would bill an N-hop descent N units.
    // Resolved BEFORE the model so the free-tier clamp (LIN-513) can force the
    // default model — a free-tier descent must never bill a workspace-preferred model.
    const { apiKey: resolvedApiKey, isFreeTier } = resolveProxyLLM(sessionApiKey);
    const selectedModel = await resolveWorkspaceModel({ urlKey, workspacePreferencesStore, forceDefault: isFreeTier });
    // Cancel the in-flight LLM call when its deadline trips instead of racing and
    // leaving it running orphaned (fetchWithTimeout vs withTimeout, LIN-346 surface 5).
    // getRecommendation now honors options.signal (gap #2). The per-hop deadline guard
    // (gap #3) bounds each hop by the REMAINING shared descent budget so a stalled hop
    // can't overrun it — released on settle so the timer can't leak across hops.
    const hop = armHopSignal({ deadline });
    let recommendation;
    try {
      recommendation = await fetchWithTimeout(
        (signal) => getRecommendation(
          issue,
          // Forward `attachments` (LIN-777) so getRecommendation's meta-prompt
          // (formatIssueContext → formatAttachmentsSection) surfaces the worker-facing
          // ## Attachments section. fetchRecommendationContext carries it at top level
          // (LIN-772/773); dropping it here silently hid the section on the LLM
          // recommendation path autopilot drives by default — the sibling of the
          // deterministic LIN-776 fix. `focusedChild` stays (the meta path reads it).
          { parent, siblings, project, children, comments, focusedChild, attachments },
          {
            apiKey: resolvedApiKey,
            model: selectedModel,
            featureFlags: {},
            signal: AbortSignal.any([signal, hop.signal]),
            callMeta: { urlKey, feature: 'recommend', issueIdentifier: issue.identifier }
          }
        ),
        LLM_TIMEOUT_MS
      );
    } finally {
      hop.release();
    }

    return {
      identifier: issue.identifier,
      reasoning: recommendation.reasoning,
      prompt: recommendation.prompt,
      truncated: recommendation.truncated,
      repo: parseRepoFromDescription(project?.description),
      recommendedAction: recommendation.recommendedAction,
      // deferTo (LIN-327) drives the recommend recursion (resolveRecommendation).
      deferTo: recommendation.deferTo || null,
      // This node's own state + its children (with state) let the resolver guard
      // the descent against terminal nodes (LIN-353) without an extra fetch — both
      // are already in hand from the context fetched for this hop.
      state: issue.state,
      children
    };
  }

  /**
   * Map a recommendation error to { status, body }. Shared by GET /recommend
   * and POST /recommend-and-dispatch so both surfaces report issue-not-found /
   * OpenRouter / graphql failures identically.
   */
  function recommendErrorResponse(err) {
    if (err.message?.includes('not found')) {
      return { status: 404, body: { error: 'Issue not found' } };
    }
    if (err.message?.includes('OpenRouter')) {
      return { status: 503, body: { error: 'AI service temporarily unavailable', detail: err.message } };
    }
    console.error('Proxy /recommend error:', err.message);
    return { status: graphqlErrorStatus(err), body: { error: 'Failed to get recommendation', detail: graphqlErrorDetail(err) } };
  }

  /**
   * GET /api/proxy/issues/:identifier/recommend  (canonical — nested issue-scoped)
   * GET /api/proxy/recommend/:identifier           (forgiving alias, flat form)
   * Returns an AI-generated prompt recommendation for an issue.
   * Uses the token creator's OAuth key (if available) or server-side OPENROUTER_API_KEY.
   * Shared :identifier param across both forms (LIN-528).
   */
  router.get(['/api/proxy/issues/:identifier/recommend', '/api/proxy/recommend/:identifier'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recommend', reason);
      }

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

      // Charge one free-tier unit ONCE per request (not per descent hop — that
      // would overbill a multi-hop container). resolveRecommendation does the
      // generation below; charge before it so an exhausted user gets a clean 429.
      // Skipped on the kind-override path (LIN-839): it makes no LLM call.
      if (kind === undefined && isFreeTier && !isTestMode) {
        const rejection = await chargeFreeTierOrReject(req.proxyUrlKey);
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
          // `{}` for provider.ui keeps Linear output byte-identical to /prompt.
          let ctx;
          try {
            ctx = await resolvePromptIssueContext(accessToken, identifier, isTestMode);
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
          const generated = generatePrompt(kind, issue, { parent, siblings, project, children, comments, attachments }, {});
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
        const { status, body } = recommendErrorResponse(err);
        logEvent(req, '/api/proxy/recommend', status);
        keepalive.send(status, body);
      }
    } catch (err) {
      const { status, body } = recommendErrorResponse(err);
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
   * GET /api/proxy/issues/:identifier/recap  (canonical — nested issue-scoped)
   * GET /api/proxy/recap/:identifier           (forgiving alias, flat form)
   * Returns the AI-generated recap (done/pending/deviations) for an issue.
   * Auto-regenerates when missing or stale unless `?noRefresh=1` is passed.
   * Shared :identifier param across both forms (LIN-528). POST /recap/:identifier
   * (force-regenerate) is intentionally left flat-only — out of scope for LIN-528.
   */
  router.get(['/api/proxy/issues/:identifier/recap', '/api/proxy/recap/:identifier'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recap', reason);
      }
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
          context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
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

        // Charge one free-tier unit only now that generation is guaranteed.
        if (isFreeTier && !isTestMode) {
          const rejection = await chargeFreeTierOrReject(req.proxyUrlKey);
          if (rejection) {
            keepalive.stop();
            logEvent(req, '/api/proxy/recap', 429);
            return keepalive.send(rejection.status, rejection.body);
          }
        }

        const selectedModel = await resolveWorkspaceModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore, forceDefault: isFreeTier });
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
          status = graphqlErrorStatus(err);
          body = { error: 'Failed to fetch recap', detail: graphqlErrorDetail(err) };
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
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recap', reason);
      }
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

      if (isFreeTier && !isTestMode) {
        const rejection = await chargeFreeTierOrReject(req.proxyUrlKey);
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
          context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        }

        const canonicalId = context.issue?.id || identifier;
        const inputHash = hashContext(context);
        captureTaskSnapshot({ urlKey: req.proxyUrlKey, identifier, context, canonicalId, inputHash });

        const selectedModel = await resolveWorkspaceModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore, forceDefault: isFreeTier });
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
          status = graphqlErrorStatus(err);
          body = { error: 'Failed to fetch recap', detail: graphqlErrorDetail(err) };
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
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/recap', status);
      console.error('Proxy /recap POST error:', err.message);
      jsonError(res, status, 'Failed to generate recap', { detail: graphqlErrorDetail(err) });
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
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/brief', reason);
      }
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
          context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
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

        // Charge one free-tier unit only now that generation is guaranteed.
        if (isFreeTier && !isTestMode) {
          const rejection = await chargeFreeTierOrReject(req.proxyUrlKey);
          if (rejection) {
            keepalive.stop();
            logEvent(req, '/api/proxy/brief', 429);
            return keepalive.send(rejection.status, rejection.body);
          }
        }

        const selectedModel = await resolveWorkspaceModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore, forceDefault: isFreeTier });
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
          status = graphqlErrorStatus(err);
          body = { error: 'Failed to fetch brief', detail: graphqlErrorDetail(err) };
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
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/brief', reason);
      }
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

      if (isFreeTier && !isTestMode) {
        const rejection = await chargeFreeTierOrReject(req.proxyUrlKey);
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
          context = await fetchWithTimeout((signal) => fetchRecommendationContext(accessToken, identifier, { signal }), CONTEXT_FETCH_TIMEOUT_MS);
        }

        const canonicalId = context.issue?.id || identifier;
        const inputHash = hashContext(context);
        captureTaskSnapshot({ urlKey: req.proxyUrlKey, identifier, context, canonicalId, inputHash });

        const selectedModel = await resolveWorkspaceModel({ urlKey: req.proxyUrlKey, workspacePreferencesStore, forceDefault: isFreeTier });
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
          status = graphqlErrorStatus(err);
          body = { error: 'Failed to generate brief', detail: graphqlErrorDetail(err) };
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
      const status = graphqlErrorStatus(err);
      logEvent(req, '/api/proxy/brief', status);
      console.error('Proxy /brief POST error:', err.message);
      jsonError(res, status, 'Failed to generate brief', { detail: graphqlErrorDetail(err) });
    }
  });

  /**
   * POST /api/proxy/agent/status  (canonical)
   * POST /api/proxy/foreman/status  (forgiving alias, deprecated — pre-LIN-533 name)
   * Record an agent status update. Shared handler across both forms (LIN-528 pattern).
   */
  router.post(['/api/proxy/agent/status', '/api/proxy/foreman/status'], proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    const { taskIdentifier, action, status, summary, dispatchId } = req.body;

    if (!taskIdentifier || typeof taskIdentifier !== 'string') {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'taskIdentifier is required');
    }
    if (!action || typeof action !== 'string') {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'action is required');
    }
    if (!status || typeof status !== 'string') {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'status is required');
    }
    if (!summary || typeof summary !== 'string') {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'summary is required');
    }
    if (summary.length > 10000) {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'summary exceeds max length (10000)');
    }
    if (taskIdentifier.length > 200 || action.length > 200 || status.length > 200) {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'Field exceeds max length (200)');
    }

    // dispatchId is optional. When present it must be a non-empty string ≤200 chars
    // (same cap as other field inputs). Enables exact-match loop join in LIN-245;
    // absence is back-compatible and consumers fall back to timestamp-window matching.
    if (dispatchId !== undefined && dispatchId !== null) {
      if (typeof dispatchId !== 'string' || dispatchId.length === 0) {
        logEvent(req, '/api/proxy/agent/status', 400);
        return badRequest.json(res, 'dispatchId must be a non-empty string');
      }
      if (dispatchId.length > 200) {
        logEvent(req, '/api/proxy/agent/status', 400);
        return badRequest.json(res, 'Field exceeds max length (200)');
      }
      if (DANGEROUS_CHARS_REGEX.test(dispatchId)) {
        logEvent(req, '/api/proxy/agent/status', 400);
        return badRequest.json(res, 'Input contains invalid characters');
      }
    }

    if (DANGEROUS_CHARS_REGEX.test(taskIdentifier) || DANGEROUS_CHARS_REGEX.test(action) ||
        DANGEROUS_CHARS_REGEX.test(status) || DANGEROUS_CHARS_REGEX.test(summary)) {
      logEvent(req, '/api/proxy/agent/status', 400);
      return badRequest.json(res, 'Input contains invalid characters');
    }

    try {
      await agentStatusStore.recordStatus({
        urlKey: req.proxyUrlKey,
        taskIdentifier,
        action,
        status,
        summary,
        // Attribute the write to the posting token so the UI can group
        // entries into sessions. Label is snapshotted so it survives revocation.
        tokenId: req.proxyTokenId,
        tokenLabel: req.proxyTokenLabel,
        ...(dispatchId ? { dispatchId } : {})
      });

      logEvent(req, '/api/proxy/agent/status', 201);
      res.status(201).json({ success: true });
    } catch (err) {
      logEvent(req, '/api/proxy/agent/status', 500);
      console.error('Agent status post error:', err.message);
      jsonError(res, 500, 'Failed to record status');
    }
  });

  /**
   * GET /api/proxy/agent/status  (canonical)
   * GET /api/proxy/foreman/status  (forgiving alias, deprecated — pre-LIN-533 name)
   * List recent agent status entries. Optional filters: tokenId (session) +
   * taskIdentifier (task thread). Shared handler across both forms (LIN-528 pattern).
   */
  router.get(['/api/proxy/agent/status', '/api/proxy/foreman/status'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const filters = {};
      if (req.query.tokenId) {
        const raw = String(req.query.tokenId);
        if (raw.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(raw)) {
          logEvent(req, '/api/proxy/agent/status', 400);
          return badRequest.json(res, 'Invalid tokenId');
        }
        filters.tokenId = raw;
      }
      if (req.query.taskIdentifier) {
        const raw = String(req.query.taskIdentifier);
        if (raw.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(raw)) {
          logEvent(req, '/api/proxy/agent/status', 400);
          return badRequest.json(res, 'Invalid taskIdentifier');
        }
        filters.taskIdentifier = raw;
      }

      const result = await agentStatusStore.listStatus(req.proxyUrlKey, { limit, offset, ...filters });

      logEvent(req, '/api/proxy/agent/status', 200);
      res.json(result);
    } catch (err) {
      logEvent(req, '/api/proxy/agent/status', 500);
      console.error('Agent status list error:', err.message);
      jsonError(res, 500, 'Failed to list status');
    }
  });

  /**
   * GET /api/proxy/autopilot/kickoff
   * Returns the Autopilot kickoff prompt as plain text — the briefing that
   * turns the receiving session into the Autopilot orchestrator (it dispatches
   * work to a separate worker and judges completion from external evidence).
   * General (stack-walk) by default; `?goal=` supplies a focus, `?mode=readonly`
   * restricts to investigation/research prompts, `?variant=stepper` swaps in the
   * beat-stepping disposition.
   */
  router.get('/api/proxy/autopilot/kickoff', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const mode = AUTOPILOT_MODES.includes(req.query.mode) ? req.query.mode : AUTOPILOT_MODE_DEFAULT;
    const variant = AUTOPILOT_VARIANTS.includes(req.query.variant) ? req.query.variant : AUTOPILOT_VARIANT_DEFAULT;
    const goal = typeof req.query.goal === 'string' ? req.query.goal.slice(0, 1000) : '';

    logEvent(req, '/api/proxy/autopilot/kickoff', 200);

    const kickoff = buildAutopilotKickoff({ baseUrl, goal, mode, variant });
    res.type('text/plain').send(kickoff);
  });

  /**
   * POST /api/proxy/autopilot/kickoff
   * Fused launch verb (LIN-569): build the Autopilot kickoff AND enqueue it in
   * one call, returning the dispatch id — which IS the run's session id. This is
   * the single verb that actually *starts* a run from a goal. It collapses the
   * UI's old two-step round-trip (GET the kickoff → ship the whole body back via
   * POST /dispatch) into one server-side composition, the same fusion shape as
   * POST /recommend-and-dispatch: the prompt body is generated server-side and
   * never returned to the caller. The GET twin above stays the text-only
   * preview/inspect form.
   *
   * Body (all optional): { goal?, mode?, variant?, issueIdentifier?, target?, repo?, appendProxyContext? }
   *   - issueIdentifier present → SCOPED run ("autopilot until THIS task is
   *     done"): the issue's title is resolved for the goal line and its project
   *     `repo=` is inherited (an explicit caller `repo` wins, mirroring /prompt).
   *   - issueIdentifier absent  → GENERAL run; `goal` focuses the stack walk.
   *   - mode: 'write' (default) | 'readonly'.
   *   - variant: 'standard' (default) | 'stepper' (warm beat-stepping disposition,
   *     LIN-791); orthogonal to mode.
   * Dispatches with kind:'autopilot', so addItem appends the session-id self-ref
   * block and the returned id is the session id (LIN-591/LIN-599).
   */
  router.post('/api/proxy/autopilot/kickoff', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/autopilot/kickoff', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    try {
      const { goal, mode, variant, issueIdentifier, target, repo, appendProxyContext } = req.body || {};

      // Validate caller-supplied inputs. (The composed body is server-generated
      // and trusted, so only these raw inputs are checked — same split as the
      // recommend-and-dispatch override path.)
      const resolvedMode = mode === undefined ? AUTOPILOT_MODE_DEFAULT : mode;
      if (!AUTOPILOT_MODES.includes(resolvedMode)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, `mode must be one of: ${AUTOPILOT_MODES.join(', ')}`);
      }
      const resolvedVariant = variant === undefined ? AUTOPILOT_VARIANT_DEFAULT : variant;
      if (!AUTOPILOT_VARIANTS.includes(resolvedVariant)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, `variant must be one of: ${AUTOPILOT_VARIANTS.join(', ')}`);
      }
      if (goal !== undefined && (typeof goal !== 'string' || goal.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(goal))) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, 'goal is invalid');
      }
      if (target !== undefined && !VALID_PROXY_DISPATCH_TARGETS.includes(target)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, `target must be one of: ${VALID_PROXY_DISPATCH_TARGETS.join(', ')}`);
      }
      if (repo !== undefined && (typeof repo !== 'string' || repo.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(repo))) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, 'repo is invalid');
      }
      if (issueIdentifier !== undefined && !isValidIssueId(issueIdentifier)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;

      // SCOPED run: resolve the named issue so the goal line can name it and we
      // can inherit the project repo (mirrors /prompt + recommend-and-dispatch).
      let issue = null;
      let resolvedRepo = repo || null;
      if (issueIdentifier) {
        const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
        if (!accessToken) {
          return workspaceUnavailable(req, res, '/api/proxy/autopilot/kickoff', reason);
        }
        const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
        let ctx;
        try {
          ctx = await resolvePromptIssueContext(accessToken, issueIdentifier, isTestMode);
        } catch (err) {
          if (err.message?.includes('not found')) {
            logEvent(req, '/api/proxy/autopilot/kickoff', 404);
            return notFound.json(res, 'Issue not found');
          }
          throw err;
        }
        if (!ctx) {
          logEvent(req, '/api/proxy/autopilot/kickoff', 404);
          return notFound.json(res, 'Issue not found');
        }
        issue = { identifier: ctx.issue.identifier, title: ctx.issue.title };
        resolvedRepo = repo || parseRepoFromDescription(ctx.project?.description) || null;
      }

      const kickoff = buildAutopilotKickoff({
        baseUrl,
        issue,
        goal: typeof goal === 'string' ? goal : '',
        mode: resolvedMode,
        variant: resolvedVariant
      });

      // Append the proxy context (workspace API access + bearer token + reporting
      // channel) by default — the kickoff guide refers the autopilot to "the
      // +proxy block" for its concrete token. Opt out with appendProxyContext:false.
      let finalPrompt = kickoff;
      if (appendProxyContext !== false) {
        const bearerToken = (req.headers.authorization || '').slice(7);
        finalPrompt = kickoff + buildProxyContextPreamble({
          baseUrl,
          token: bearerToken,
          issueIdentifier: issueIdentifier || null
        });
      }

      const item = await dispatchQueueStore.addItem(req.proxyUrlKey, {
        prompt: finalPrompt,
        promptName: issue ? `Autopilot (${issue.identifier})` : 'Autopilot (stack walk)',
        kind: 'autopilot',
        issueIdentifier: issueIdentifier || null,
        dispatchedBy: req.proxyCreatedBy || null,
        target: target || 'cli',
        repo: resolvedRepo,
        // Park the orchestrator holdable (LIN-826). Under push-based comms the
        // subscribed children run independently to terminal and then WAKE the
        // parent with a follow-up (the LIN-826 auto-enqueue), so the orchestrator
        // must stop at a holdable AWAITING_FOLLOWUP point to receive those wakes
        // instead of polling. This inverts the old "free the producer" rule only
        // for the subscribed case; Phase 2 retires that rule in the prose.
        waitForFollowUps: true
      });

      logEvent(req, '/api/proxy/autopilot/kickoff', 201);
      res.status(201).json({
        success: true,
        // The dispatch id IS the autopilot session id (LIN-591/LIN-599); surface
        // it under both names so callers can use whichever reads clearer.
        id: item._id,
        sessionId: item._id,
        status: 'queued',
        kind: item.kind,
        promptName: item.promptName,
        mode: resolvedMode,
        variant: resolvedVariant,
        issueIdentifier: item.issueIdentifier,
        target: item.target,
        dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt
      });
    } catch (err) {
      logEvent(req, '/api/proxy/autopilot/kickoff', 500);
      console.error('Proxy autopilot kickoff error:', err.message);
      jsonError(res, 500, 'Failed to dispatch autopilot kickoff');
    }
  });

  /**
   * GET /api/proxy/autopilot/manual
   * Returns the Autopilot operating manual (the "handbook") as plain text — the
   * portable senior-lead disposition that sits beside the kickoff's mechanics.
   * The kickoff composes this same text inline, so this endpoint is for re-reading
   * a part mid-run (and for humans / other consumers).
   */
  router.get('/api/proxy/autopilot/manual', proxyLimiter, authenticateProxyToken, async (req, res) => {
    logEvent(req, '/api/proxy/autopilot/manual', 200);
    res.type('text/plain').send(buildAutopilotManual());
  });

  // ===========================================================================
  // Dispatch Endpoints (proxy-token twin of routes/dispatch.js)
  // ===========================================================================

  /**
   * POST /api/proxy/dispatch
   * Queue a prompt for the workspace's dispatch consumer (the runner).
   * Proxy-token equivalent of POST /workspace/:urlKey/api/dispatch — same
   * body shape and validation, but scoped by the token's workspace and
   * requiring readWrite scope. Excludes target 'local' (Harbour OS spawns on
   * the server's own tty, which a remote consumer can't drive). This is the
   * write half the autopilot orchestrator uses to dispatch a chosen task.
   */
  router.post('/api/proxy/dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    try {
      const { prompt, promptName, kind, issueId, issueIdentifier, issueTitle, issueUrl, target, repo, followUpTo, force, abort, abortTo, sessionId, waitForFollowUps, queueIfBusy, subscribe } = req.body || {};

      // Abort verb (LIN-743): an abort item cancels/closes an existing session
      // (named by abortTo) instead of running a prompt — it carries no prompt and
      // skips the prompt-required check. abort and followUpTo are mutually exclusive.
      const isAbort = abort === true;
      if (isAbort && followUpTo !== undefined && followUpTo !== null) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'abort and followUpTo are mutually exclusive');
      }

      if (!isAbort && (!prompt || typeof prompt !== 'string')) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'prompt is required and must be a string');
      }
      if (target !== undefined && !VALID_PROXY_DISPATCH_TARGETS.includes(target)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `target must be one of: ${VALID_PROXY_DISPATCH_TARGETS.join(', ')}`);
      }

      // Abort eligibility (LIN-743): the abort item's OWN target must be
      // poll-eligible — NOT derived from the aborted session's substrate. The
      // proxy target set (cli/web/dash) is already exactly the poll-eligible set,
      // so the check above suffices; here we only enforce abortTo's presence/shape.
      if (isAbort) {
        if (!abortTo || !UUID_REGEX.test(abortTo)) {
          logEvent(req, '/api/proxy/dispatch', 400);
          return badRequest.json(res, 'abortTo is required and must be a UUID when abort is true');
        }
      } else if (abortTo !== undefined && abortTo !== null) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'abortTo requires abort to be true');
      }
      // Validate kind if provided; when omitted it is derived from promptName below.
      if (kind !== undefined && !isValidDispatchKind(kind)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `kind must be one of: ${DISPATCH_KINDS.join(', ')}`);
      }
      // Opt-in completion hold (LIN-797): boolean, default false. Stored +
      // forwarded blindly — the runner owns the behaviour (see LIN-795).
      if (waitForFollowUps !== undefined && typeof waitForFollowUps !== 'boolean') {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'waitForFollowUps must be a boolean');
      }
      // Push-based inter-session comms (LIN-826): stored + forwarded blindly,
      // exactly like waitForFollowUps/force — no Harbour-side semantics.
      if (queueIfBusy !== undefined && typeof queueIfBusy !== 'boolean') {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'queueIfBusy must be a boolean');
      }
      if (subscribe !== undefined && typeof subscribe !== 'boolean') {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'subscribe must be a boolean');
      }

      if (prompt && prompt.length > MAX_PROMPT_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH}`);
      }
      if (promptName && promptName.length > MAX_NAME_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `promptName exceeds maximum length of ${MAX_NAME_LENGTH}`);
      }
      if (issueIdentifier && issueIdentifier.length > MAX_IDENTIFIER_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `issueIdentifier exceeds maximum length of ${MAX_IDENTIFIER_LENGTH}`);
      }
      if (issueTitle && issueTitle.length > MAX_NAME_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `issueTitle exceeds maximum length of ${MAX_NAME_LENGTH}`);
      }
      if (issueUrl && issueUrl.length > MAX_URL_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `issueUrl exceeds maximum length of ${MAX_URL_LENGTH}`);
      }
      if (repo && repo.length > MAX_NAME_LENGTH) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `repo exceeds maximum length of ${MAX_NAME_LENGTH}`);
      }

      if (prompt && DANGEROUS_CHARS_REGEX.test(prompt)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'prompt contains invalid characters');
      }
      if (promptName && DANGEROUS_CHARS_REGEX.test(promptName)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'promptName contains invalid characters');
      }
      if (issueTitle && DANGEROUS_CHARS_REGEX.test(issueTitle)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'issueTitle contains invalid characters');
      }
      if (repo && DANGEROUS_CHARS_REGEX.test(repo)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'repo contains invalid characters');
      }
      if (issueId && !UUID_REGEX.test(issueId)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'Invalid issueId format');
      }
      // Follow-up reference (LIN-415): the original dispatchId whose session
      // the downstream dispatcher should resume. Optional UUID; stored +
      // forwarded blindly (no liveness check here). cli/web only — resuming a
      // dash session is undefined.
      if (followUpTo !== undefined && followUpTo !== null) {
        if (!UUID_REGEX.test(followUpTo)) {
          logEvent(req, '/api/proxy/dispatch', 400);
          return badRequest.json(res, 'Invalid followUpTo format');
        }
        const followUpTarget = target || 'cli';
        if (!['cli', 'web'].includes(followUpTarget)) {
          logEvent(req, '/api/proxy/dispatch', 400);
          return badRequest.json(res, 'followUpTo is only supported for cli/web targets');
        }
      }

      // Force-resume flag (LIN-559): overrides the runner's active-session
      // liveness guard so a follow-up can resume a wedged/sleeping session. Only
      // meaningful alongside followUpTo (the human asserts the prior process is
      // dead — see LIN-546), so reject force:true without it rather than storing
      // an inert flag. force:false / omitted is always fine. The runner reads
      // item.force off the polled/claimed item.
      if (force !== undefined && typeof force !== 'boolean') {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'force must be a boolean');
      }
      if (force === true && (followUpTo === undefined || followUpTo === null)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'force requires followUpTo');
      }

      // Autopilot session reference (LIN-591): the autopilot dispatchId that
      // spawned this worker, used to group workers into one session. Optional
      // UUID; stored + forwarded blindly. Unlike followUpTo there is NO target
      // restriction — sessions span all targets.
      if (sessionId !== undefined && sessionId !== null) {
        if (!UUID_REGEX.test(sessionId)) {
          logEvent(req, '/api/proxy/dispatch', 400);
          return badRequest.json(res, 'Invalid sessionId format');
        }
      }

      // Auto-append the proxy context (workspace API access + reporting channel) by
      // default, so the worker can both read context and report its result.
      // Opt out with appendProxyContext:false (e.g. a self-contained prompt).
      const { appendProxyContext } = req.body || {};
      let finalPrompt = prompt;
      // An abort item carries no prompt, so there is nothing to append the proxy
      // context to — guard on prompt presence (LIN-743).
      if (prompt && appendProxyContext !== false) {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const bearerToken = (req.headers.authorization || '').slice(7);
        finalPrompt = prompt + buildProxyContextPreamble({
          baseUrl,
          token: bearerToken,
          issueIdentifier: issueIdentifier || null
        });
      }

      const item = await dispatchQueueStore.addItem(req.proxyUrlKey, {
        prompt: finalPrompt,
        promptName: promptName || 'Prompt',
        kind: kind || deriveDispatchKind(promptName),
        issueId: issueId || null,
        issueIdentifier: issueIdentifier || null,
        issueTitle: issueTitle || null,
        issueUrl: issueUrl || null,
        dispatchedBy: req.proxyCreatedBy || null,
        target: target || 'cli',
        repo: repo || null,
        followUpTo: followUpTo || null,
        force: force === true,
        abort: isAbort,
        abortTo: isAbort ? abortTo : null,
        sessionId: sessionId || null,
        waitForFollowUps: waitForFollowUps === true,
        queueIfBusy: queueIfBusy === true,
        subscribe: subscribe === true
      });

      logEvent(req, '/api/proxy/dispatch', 201);
      res.status(201).json({
        success: true,
        id: item._id,
        status: 'queued',
        promptName: item.promptName,
        kind: item.kind,
        issueIdentifier: item.issueIdentifier,
        target: item.target,
        abort: item.abort === true,
        abortTo: item.abortTo || null,
        sessionId: item.sessionId || null,
        dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt
      });
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch', 500);
      console.error('Proxy dispatch error:', err.message);
      jsonError(res, 500, 'Failed to dispatch prompt');
    }
  });

  /**
   * POST /api/proxy/recommend-and-dispatch
   * Fused verb (LIN-321): run /recommend and forward the recommended prompt
   * straight into a dispatch, SERVER-SIDE, returning only the task header.
   * The prompt body never reaches the caller, so the orchestrator's context-
   * economy rule (autopilot invariant 4) becomes mechanical instead of a rule
   * it must remember. `kind` is derived from the recommendation's own action
   * signal — no need to read the prompt to classify the task.
   *
   * Optional verb override (LIN-573): when the caller supplies `kind` (a
   * PROMPT_TEMPLATES key), the LLM recommendation + descent is bypassed and the
   * body is generated deterministically for the NAMED issue with that template —
   * "autopilot picks the verb, never the words." The body is still server-
   * generated and never returned; only the verb key is caller-supplied. Omitting
   * `kind` leaves the original LLM-driven behaviour byte-identical.
   */
  router.post('/api/proxy/recommend-and-dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    try {
      const { issueIdentifier, target, repo, appendProxyContext, noDescend, kind, sessionId, waitForFollowUps, queueIfBusy, subscribe } = req.body || {};

      // Validate caller-supplied inputs. (Only the server-generated prompt skips
      // the dangerous-char/length checks — see the dispatch step below.)
      if (!issueIdentifier || typeof issueIdentifier !== 'string') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'issueIdentifier is required and must be a string');
      }
      if (!isValidIssueId(issueIdentifier)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }
      if (target !== undefined && !VALID_PROXY_DISPATCH_TARGETS.includes(target)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, `target must be one of: ${VALID_PROXY_DISPATCH_TARGETS.join(', ')}`);
      }
      if (noDescend !== undefined && typeof noDescend !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'noDescend must be a boolean');
      }
      // Opt-in completion hold (LIN-797): boolean, default false. Threaded through
      // to the dispatched item and forwarded blindly — the runner owns the behaviour.
      if (waitForFollowUps !== undefined && typeof waitForFollowUps !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'waitForFollowUps must be a boolean');
      }
      // Push-based inter-session comms (LIN-826): stored + forwarded blindly,
      // exactly like waitForFollowUps. queueIfBusy is never defaulted here (it is
      // Harbour-set only on the auto-enqueued wake follow-up); subscribe defaults
      // ON for a fresh sessioned worker below so the orchestrator needs no new
      // prompt instruction — an explicit caller value (incl. false) always wins.
      if (queueIfBusy !== undefined && typeof queueIfBusy !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'queueIfBusy must be a boolean');
      }
      if (subscribe !== undefined && typeof subscribe !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'subscribe must be a boolean');
      }
      if (repo !== undefined && (typeof repo !== 'string' || repo.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(repo))) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'repo is invalid');
      }
      // Optional verb override (LIN-573). When present, the caller pins the step
      // and the server still writes the body — "autopilot picks the verb, never
      // the words." Validate with hasPrompt() (PROMPT_TEMPLATES keys only), NOT
      // isValidDispatchKind(): the latter admits body-less meta-kinds (defer/
      // custom/autopilot/periodical) that have no generate() and would dispatch
      // an empty prompt. The caller never supplies prompt text — only the key.
      if (kind !== undefined && (typeof kind !== 'string' || !hasPrompt(kind))) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, `kind must be a valid prompt template key: ${Object.keys(PROMPT_TEMPLATES).join(', ')}`);
      }
      // Autopilot session reference (LIN-591): the autopilot dispatchId that is
      // driving this run, stamped onto the spawned worker so the dashboard can
      // reconstruct the session. This is the verb the autopilot actually drives,
      // so it is the important one. Optional UUID; stored + forwarded blindly,
      // no target restriction (sessions span all targets).
      if (sessionId !== undefined && sessionId !== null && !UUID_REGEX.test(sessionId)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'Invalid sessionId format');
      }

      // Resolve the subscribe edge once for both dispatch paths below (LIN-826).
      // V1 "fresh sessioned worker" = a sessionId is present: recommend-and-dispatch
      // has no followUpTo/abort verb, so those exclusion arms (sessionId && !followUpTo
      // && !abort) are always satisfied here. Default ON so the autopilot fan-out
      // subscribes to each worker with no new prompt instruction; an explicit caller
      // `subscribe` (true OR false) overrides the default.
      const subscribeResolved = typeof subscribe === 'boolean' ? subscribe : !!sessionId;

      // Recommendation preconditions — identical to GET /recommend.
      const { token: accessToken, reason } = await resolveWorkspaceAccess(req.proxyUrlKey);
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recommend-and-dispatch', reason);
      }
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';

      // ── Verb-override path (LIN-573) ──────────────────────────────────────
      // When the caller pins `kind`, skip the LLM recommendation + descent
      // entirely: fetch the named issue's context, generate the body
      // deterministically with the chosen template key, and dispatch with that
      // override kind. The wobble this fixes is the *verb*, not the *target*, so
      // the override pins the named issue with NO descent. It is purely
      // deterministic (no OpenRouter call), so it bypasses the LLM-config gate
      // and free-tier metering below. Linear output stays byte-identical to the
      // /prompt endpoint by passing `{}` for provider.ui.
      if (kind !== undefined) {
        let ctx;
        try {
          ctx = await resolvePromptIssueContext(accessToken, issueIdentifier, isTestMode);
        } catch (err) {
          if (err.message?.includes('not found')) {
            logEvent(req, '/api/proxy/recommend-and-dispatch', 404);
            return notFound.json(res, 'Issue not found');
          }
          throw err;
        }
        if (!ctx) {
          logEvent(req, '/api/proxy/recommend-and-dispatch', 404);
          return notFound.json(res, 'Issue not found');
        }

        const { issue, parent, siblings, project, children, comments, attachments } = ctx;
        // Forward `attachments` (LIN-776): the verb-override dispatch path must
        // surface the same Attachments section as the LLM recommend-and-dispatch
        // path, which already passes the full context. Keep `{}` for provider.ui —
        // the Attachments section emits no "Linear" literal, so Linear output stays
        // byte-identical.
        const generated = generatePrompt(kind, issue, { parent, siblings, project, children, comments, attachments }, {});
        if (!generated) {
          logEvent(req, '/api/proxy/recommend-and-dispatch', 500);
          return jsonError(res, 500, 'Failed to generate prompt');
        }

        // The body is server-generated/trusted, so it skips the dangerous-char /
        // length checks the caller-supplied POST /dispatch path runs, and is
        // never returned to the caller — same contract as the LLM-driven path.
        let finalPrompt = generated.prompt;
        if (appendProxyContext !== false) {
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          const bearerToken = (req.headers.authorization || '').slice(7);
          finalPrompt = generated.prompt + buildProxyContextPreamble({
            baseUrl,
            token: bearerToken,
            issueIdentifier
          });
        }

        try {
          const item = await dispatchQueueStore.addItem(req.proxyUrlKey, {
            prompt: finalPrompt,
            promptName: generated.name || getPromptDisplayName(kind),
            kind,
            issueId: null,
            issueIdentifier,
            issueTitle: null,
            issueUrl: null,
            dispatchedBy: req.proxyCreatedBy || null,
            target: target || 'cli',
            // Mirror /prompt's repo resolution: project `repo=` from the
            // description, with an explicit caller repo winning (LIN-537).
            repo: repo || parseRepoFromDescription(project?.description) || null,
            sessionId: sessionId || null,
            // Push-comms (LIN-826): subscribe defaults ON for a sessioned worker
            // so its terminal events wake the orchestrator; queueIfBusy forwarded
            // blindly. Both stored + forwarded, no Harbour-side semantics.
            queueIfBusy: queueIfBusy === true,
            subscribe: subscribeResolved
          });

          // Record the override so it can feed heuristic improvement — the
          // engine's verb was demonstrably wrong here (LIN-573). The distinct
          // endpoint tag keeps these auditable in the proxy event log.
          logEvent(req, `/api/proxy/recommend-and-dispatch (override:${kind})`, 201);
          return res.status(201).json({
            success: true,
            id: item._id,
            status: 'queued',
            kind: item.kind,
            promptName: item.promptName,
            issueIdentifier: item.issueIdentifier,
            target: item.target,
            sessionId: item.sessionId || null,
            dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt,
            // The override pins the named issue with no descent — surface that
            // explicitly so callers can distinguish it from the LLM-driven path.
            override: true
          });
        } catch (err) {
          logEvent(req, '/api/proxy/recommend-and-dispatch', 500);
          console.error('Proxy recommend-and-dispatch override error:', err.message);
          return jsonError(res, 500, 'Failed to dispatch prompt');
        }
      }

      const sessionApiKey = await getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);
      // A free-tier-only deployment is accepted via isFreeTier. computeRecommendation
      // resolves the effective key per hop; here we only gate and meter.
      const { isFreeTier } = resolveProxyLLM(sessionApiKey);
      if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !isFreeTier) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
        return jsonError(res, 503, 'AI recommendations not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.');
      }

      // Charge one free-tier unit ONCE per request (not per descent hop). Charge
      // before resolveRecommendation so an exhausted user gets a clean 429.
      if (isFreeTier && !isTestMode) {
        const rejection = await chargeFreeTierOrReject(req.proxyUrlKey);
        if (rejection) {
          logEvent(req, '/api/proxy/recommend-and-dispatch', 429);
          return res.status(rejection.status).json(rejection.body);
        }
      }

      // /recommend is slow (Linear + OpenRouter) — arm keepalive before computing.
      const keepalive = armKeepalive(res);

      let rec, deferredVia, deferTruncated, deferStopReason;
      try {
        // Resolve `defer` to a terminal actionable node server-side (LIN-329) so
        // Autopilot can fire this verb on ANY task — node or leaf — and get the
        // actionable descendant's prompt + kind, never a `defer` to act on.
        const recommendDeadline = Date.now() + RECOMMEND_DESCENT_BUDGET_MS;
        ({ recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
          startIdentifier: issueIdentifier,
          deadline: recommendDeadline,
          // noDescend (LIN-365): dispatch the named node's OWN work, never an open child.
          noDescend: noDescend === true,
          computeOne: (id) => computeRecommendation({
            urlKey: req.proxyUrlKey,
            createdBy: req.proxyCreatedBy,
            identifier: id,
            accessToken,
            isTestMode,
            sessionApiKey,
            deadline: recommendDeadline,
            noDescend: noDescend === true
          })
        }));
      } catch (err) {
        keepalive.stop();
        const { status, body } = recommendErrorResponse(err);
        logEvent(req, '/api/proxy/recommend-and-dispatch', status);
        return keepalive.send(status, body);
      }

      // The descent should always terminate on a real action carrying a prompt.
      // If it stopped abnormally (depth cap / cycle / unresolved child / timeout)
      // it may have halted on a `defer` with no prompt — surface that anomaly
      // rather than dispatching an empty prompt. `defer` must never reach dispatch.
      if (rec.recommendedAction === 'defer' || !rec.prompt) {
        keepalive.stop();
        logEvent(req, '/api/proxy/recommend-and-dispatch', 422);
        return keepalive.send(422, {
          error: 'Recommendation did not resolve to an actionable task',
          deferredVia,
          deferTruncated,
          deferStopReason
        });
      }

      try {
        // The recommended prompt is server-generated/trusted, so we forward it
        // verbatim and intentionally SKIP the DANGEROUS_CHARS/length checks the
        // caller-supplied POST /dispatch path runs. The prompt body is never
        // returned to the caller — that is the whole point of this verb.
        // The dispatched item references the TERMINAL actionable node (rec.identifier),
        // not the parent the caller named — the worker should inherit context for the
        // task it is actually working on (LIN-327). For a leaf these are identical.
        const terminalIdentifier = rec.identifier || issueIdentifier;
        let finalPrompt = rec.prompt;
        if (appendProxyContext !== false) {
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          const bearerToken = (req.headers.authorization || '').slice(7);
          finalPrompt = rec.prompt + buildProxyContextPreamble({
            baseUrl,
            token: bearerToken,
            issueIdentifier: terminalIdentifier
          });
        }

        // kind provenance: parseRecommendedAction (in computeRecommendation) →
        // recommendedAction → deriveDispatchKind → BOTH the stored item's kind
        // and the response kind (same value); falls back to 'custom' when the
        // action can't be parsed.
        const item = await dispatchQueueStore.addItem(req.proxyUrlKey, {
          prompt: finalPrompt,
          promptName: rec.recommendedAction || 'Prompt',
          kind: deriveDispatchKind(rec.recommendedAction),
          issueId: null,
          issueIdentifier: terminalIdentifier,
          issueTitle: null,
          issueUrl: null,
          dispatchedBy: req.proxyCreatedBy || null,
          target: target || 'cli',
          // Inherit the server-resolved repo (terminal node's project `repo=`)
          // when the caller omits one; an explicit caller repo still wins. repo
          // is functional execution context (working directory), so this fused
          // verb must propagate it, not just the display header fields (LIN-537).
          repo: repo || rec.repo || null,
          sessionId: sessionId || null,
          // Opt-in completion hold (LIN-797), forwarded blindly to the runner.
          waitForFollowUps: waitForFollowUps === true,
          // Push-comms (LIN-826): subscribe defaults ON for a sessioned worker so
          // its terminal events wake the orchestrator; queueIfBusy forwarded
          // blindly. Both stored + forwarded, no Harbour-side semantics.
          queueIfBusy: queueIfBusy === true,
          subscribe: subscribeResolved
        });

        keepalive.stop();
        logEvent(req, '/api/proxy/recommend-and-dispatch', 201);
        // Task header ONLY — no prompt body. deferredVia + descent are additive
        // (LIN-327): they let Autopilot read the descent ("LIN-318 → LIN-297
        // (research) · dispatched") from the structured header, never a prompt body.
        const descent = describeDescent(deferredVia, rec);
        keepalive.send(201, {
          success: true,
          id: item._id,
          status: 'queued',
          kind: item.kind,
          promptName: item.promptName,
          issueIdentifier: item.issueIdentifier,
          target: item.target,
          sessionId: item.sessionId || null,
          dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt,
          deferredVia,
          deferTruncated,
          ...(descent ? { descent: `${descent} · dispatched` } : {})
        });
      } catch (err) {
        keepalive.stop();
        logEvent(req, '/api/proxy/recommend-and-dispatch', 500);
        console.error('Proxy recommend-and-dispatch error:', err.message);
        keepalive.send(500, { error: 'Failed to dispatch prompt' });
      }
    } catch (err) {
      logEvent(req, '/api/proxy/recommend-and-dispatch', 500);
      console.error('Proxy recommend-and-dispatch error:', err.message);
      jsonError(res, 500, 'Failed to dispatch prompt');
    }
  });

  /**
   * GET /api/proxy/dispatch
   * List the workspace's dispatch items across both the live queue (status
   * 'queued') and recent history (taken/cancelled/expired, with feedback),
   * newest first. Lets the orchestrator discover its own in-flight items
   * without having to remember every id it dispatched. Optional filters:
   *   ?issueIdentifier=LIN-42   exact match on the issue identifier
   *   ?status=queued|taken|...  exact match on lifecycle status
   *   ?limit=N                  cap (default 20, max 100)
   */
  router.get('/api/proxy/dispatch', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    let issueIdentifier = null;
    if (req.query.issueIdentifier !== undefined) {
      issueIdentifier = String(req.query.issueIdentifier);
      if (issueIdentifier.length > MAX_IDENTIFIER_LENGTH || DANGEROUS_CHARS_REGEX.test(issueIdentifier)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'Invalid issueIdentifier');
      }
    }

    let statusFilter = null;
    if (req.query.status !== undefined) {
      statusFilter = String(req.query.status);
      if (statusFilter.length > MAX_NAME_LENGTH || DANGEROUS_CHARS_REGEX.test(statusFilter)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'Invalid status');
      }
    }

    try {
      // Live queue (still 'queued') + resolved history (with feedback), merged.
      // When scoped to one issue, push `issueIdentifier` into both store reads
      // (LIN-613/LIN-615 index-backed predicate) instead of fetching the whole
      // workspace and filtering in JS. The 200-history bound is preserved.
      //
      // This list response is metadata-only — it never returns `prompt`, only
      // status/feedback-derived fields. So exclude `prompt` at the query (the
      // LIN-623 lean-feed pattern): for an unscoped read the whole-workspace
      // 30-day history carries a multi-KB-to-10-MB prompt per row, and
      // transferring + BSON-deserialising all of them is what pushes a busy
      // workspace's read past the 30s router timeout into a 503. Column
      // exclusion only — same rows, correctness-identical.
      const scopeOpts = issueIdentifier ? { issueIdentifier } : {};
      const [queued, history] = await Promise.all([
        dispatchQueueStore.listItems(req.proxyUrlKey, { ...scopeOpts, projection: { prompt: 0 } }),
        dispatchQueueStore.listHistory(req.proxyUrlKey, { limit: 200, ...scopeOpts, projection: { prompt: 0 } })
      ]);

      const merged = [
        ...queued.map(i => ({ ...i, status: 'queued', feedback: [] })),
        ...history.items
      ];

      // Resolve each item's effective status once (terminal marker → done/failed/
      // aborted, else the lifecycle status) so filtering and the response agree.
      const resolved = merged.map(i => ({ ...i, status: deriveTerminalStatus(i.feedback) || i.status }));

      // `status` is derived from feedback (not stored), so it stays a JS filter;
      // `issueIdentifier` is already enforced at the store layer above.
      const filtered = resolved.filter(i =>
        (!statusFilter || i.status === statusFilter)
      );

      filtered.sort((a, b) => {
        const at = new Date(a.dispatchedAt || 0).getTime();
        const bt = new Date(b.dispatchedAt || 0).getTime();
        return bt - at;
      });

      const items = filtered.slice(0, limit).map(i => ({
        id: i.id,
        status: i.status,
        promptName: i.promptName,
        kind: i.kind || 'custom',
        issueIdentifier: i.issueIdentifier,
        issueUrl: i.issueUrl,
        target: i.target,
        dispatchedAt: i.dispatchedAt,
        // resolvedAt = take/archive time; completedAt = real completion (null until terminal).
        resolvedAt: i.resolvedAt || null,
        completedAt: deriveCompletedAt(i.feedback),
        feedbackCount: (i.feedback || []).length
      }));

      logEvent(req, '/api/proxy/dispatch', 200);
      res.json({ items, total: filtered.length });
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch', 500);
      console.error('Proxy dispatch list error:', err.message);
      jsonError(res, 500, 'Failed to list dispatch items');
    }
  });

  /**
   * GET /api/proxy/dispatch/:id
   * Watch a dispatched item: report whether it is still queued or has been
   * taken by the runner, plus any feedback the runner has posted. This is the
   * poll half of the autopilot loop — the orchestrator reads feedback here to
   * decide its next step. Feedback is free-form by design; the orchestrator
   * (the judge) reads it rather than relying on a structured "done" flag.
   *
   * Optional ?wait=Ns (LIN-392) turns this into a server-side long-poll: the
   * handler holds the request open (re-checking the store every ~1.5s) and
   * returns the instant the derived status transitions or new feedback arrives,
   * else returns the current snapshot at a ~50s cap so the caller simply calls
   * again. This collapses the autopilot watch loop to a no-sleep/no-backoff
   * `do { GET ...?wait=50 } while (!terminal)`. No ?wait preserves today's
   * immediate short-poll, byte-for-byte.
   */
  router.get('/api/proxy/dispatch/:id', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch/:id', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    const { id } = req.params;
    if (!id || id.length > MAX_IDENTIFIER_LENGTH || DANGEROUS_CHARS_REGEX.test(id)) {
      logEvent(req, '/api/proxy/dispatch/:id', 400);
      return badRequest.json(res, 'Invalid dispatch id');
    }

    // Parse + clamp ?wait. Garbage / non-positive → 0 → unchanged short-poll.
    const waitSeconds = Math.min(
      Math.max(0, Math.floor(Number(req.query.wait)) || 0),
      DISPATCH_WAIT_MAX_S
    );

    try {
      const item = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id);
      if (!item) {
        logEvent(req, '/api/proxy/dispatch/:id', 404);
        return notFound.json(res, 'Dispatch item not found');
      }

      // First read short-circuits: no wait requested, or already terminal.
      // (The terminal short-circuit also keeps re-polling a finished item free
      // — the caller can re-verify without ever incurring the hold.)
      let current = item;
      const alreadyTerminal = deriveTerminalStatus(current.feedback) !== null;
      if (waitSeconds > 0) {
        // Long-poll path. The response carries `reason`/`waitedMs` so the caller
        // can tell WHY it came back (see formatDispatchWatch) — a terminal item
        // short-circuits with no hold; otherwise we hold and report 'change' vs
        // 'timeout'.
        if (alreadyTerminal) {
          logEvent(req, '/api/proxy/dispatch/:id', 200);
          return res.json(formatDispatchWatch(current, { reason: 'terminal', waitedMs: 0 }));
        }
        // Hold the request open. armKeepalive flushes 200 + JSON whitespace at
        // 25s so the connection survives Heroku's 30s H12 while we wait; the
        // baseline is this first (non-terminal) read, so a change that already
        // landed is reflected in the baseline AND in whatever we ultimately
        // return — the caller never loses data, only an early return.
        const keepalive = armKeepalive(res);
        const baseline = {
          status: deriveTerminalStatus(current.feedback) || current.status,
          feedbackLength: (current.feedback || []).length
        };
        const waitStart = Date.now();
        const deadline = waitStart + waitSeconds * 1000;
        let reason = 'timeout'; // default: held the full window, nothing new
        while (Date.now() < deadline) {
          await sleep(DISPATCH_WAIT_POLL_MS);
          if (res.writableEnded || res.destroyed) {
            keepalive.stop();
            return; // client gave up
          }
          const next = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id);
          if (!next) break; // item expired mid-wait; return last known snapshot
          current = next;
          if (dispatchWatchChanged(baseline, current)) { reason = 'change'; break; }
        }
        keepalive.stop();
        logEvent(req, '/api/proxy/dispatch/:id', 200);
        return keepalive.send(200, formatDispatchWatch(current, { reason, waitedMs: Date.now() - waitStart }));
      }

      logEvent(req, '/api/proxy/dispatch/:id', 200);
      res.json(formatDispatchWatch(current));
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch/:id', 500);
      console.error('Proxy dispatch watch error:', err.message);
      jsonError(res, 500, 'Failed to read dispatch item');
    }
  });

  return router;
}
