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

import { Router, json } from 'express';
import rateLimit from 'express-rate-limit';
import { createDedupeCache, createGenerationTracker, dedupeKey } from '../lib/proxy-dedupe.js';
import { createCredentialTrail } from '../lib/proxy-credential-trail.js';
import { buildInstructions } from '../lib/proxy-instructions.js';
import { createAgentStatusRoutes } from './proxy-agent-status.js';
import { createTokensAdminRoutes } from './proxy-tokens-admin.js';
import { BYTE_IDENTICAL_ESCALATION_THRESHOLD } from '../lib/rejected-credentials.js';
import { STAGE_PROVIDER_LANE, STAGE_PROXY_TOKEN } from '../lib/proxy-events.js';
import { deriveTerminalStatus, deriveLifecycleStatus, deriveCompletedAt, harvestAbortedTargets, feedbackWithHarvestedAbort, mergeLineageFeedback } from '../lib/dispatch-terminal.js';
import { anchorFor as taskCostAnchorFor, buildTaskCost } from '../lib/task-cost.js';
import { isValidSubscription, DEFAULT_SUBSCRIPTION, SUBSCRIPTION_LEVELS } from '../lib/dispatch-wake.js';
import { validateOpaqueDispatchField, validateSessionId, validateDispatchPayload } from '../lib/dispatch-validation.js';
// LIN-1552: the issue-write validation rules (length caps, control-char guard,
// priority range) now live in one shared module so the session-auth workspace
// API write routes (Session B) consume the same definition and cannot drift.
import {
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_COMMENT_LENGTH,
  DANGEROUS_CHARS_REGEX,
  isValidPriority,
  validateIssueWriteFields,
  validateCommentBody,
} from '../lib/issue-write-validation.js';
import { createDispatchItem, DUPLICATE_DISPATCH_CODE, BUDGET_EXHAUSTED_CODE } from '../lib/dispatch-factory.js';
import { isDanglingReferent, ISSUE_NOT_FOUND_CODE, DANGLING_REFERENT_MESSAGE } from '../lib/dispatch-referent-guard.js';
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
import '../lib/providers/linear/index.js'; // side effect: self-registers the Linear provider into the registry
import { localProvider } from '../lib/providers/local/index.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
// LIN-2239: the canonical ascending priority scale's boundary conversion —
// `priority` (Linear-native, unchanged) stays the wire's authoritative field;
// `priorityLevel` is the additive canonical-scale field this ticket adds.
import { canonicalPriorityToLinear } from '../lib/providers/models.js';
import { applyTrashedSignal, isTrashed } from '../lib/trashed-signal.js';
import { extractPeriodicalGateId, checkPeriodicalReportGate } from '../lib/periodical-report-gate.js';
import { flattenIssue, neutralizeProject, flattenCycle, flattenRelations, decodeAttachmentHandle, relayContentTypeFromName, GITHUB_UPLOAD_HOSTS, collectIssueAttachments } from '../lib/proxy-wire.js';
import { createProxyFetch } from '../lib/proxy-fetch.js';
import { isRecommendationEnabled, getRecommendation, getPaidEnvKey } from '../lib/openrouter.js';
import { resolveRecommendation, describeDescent, armHopSignal } from '../lib/recommend-recurse.js';
import { resolveWorkspaceModel, resolveAiOperationModel } from '../lib/workspace-preferences.js';
import { resolveNorthStarSignal, resolveRoadmapNarrative, classifyReportFreshness, ROADMAP_REPORT_MAX_AGE_DAYS } from '../lib/next-run.js';
import { getNorthStarDocVersion } from '../lib/north-star-resolver.js';
import { generateRecap } from '../lib/recap.js';
import { generateBrief } from '../lib/brief.js';
import { hashContext } from '../lib/recap-cache.js';
import { snapshotFromContext } from '../lib/task-snapshot-store.js';
import { isTerminalState, isBlocked } from '../lib/tree.js';
import { buildTaskStack } from '../lib/task-stack.js';
import { generatePrompt, hasPrompt, isValidDispatchKind, deriveDispatchKind, getPromptDisplayName, PROMPT_TEMPLATES, DISPATCH_KINDS } from '../lib/prompt-templates.js';
import { getPeriodicals } from '../lib/periodicals.js';
import { foldPeriodicalRuns, DEFAULT_HORIZON_MS } from '../lib/periodical-runs.js';
import { PERIODICAL_PROJECTION, PERIODICAL_HISTORY_PROJECTION } from '../lib/dispatch-store.js';
import { parseRepoFromDescription, resolveDispatchRepo, buildPromptFilename } from '../lib/prompt-formatters.js';
import { attachProxyContext, shouldUseMcpTokenField, provisionBootstrapToken } from '../lib/proxy-preamble.js';
import { WORKING_TOKEN_TTL_SECONDS } from '../lib/proxy-tokens.js';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT, AUTOPILOT_VARIANTS, AUTOPILOT_VARIANT_DEFAULT } from '../lib/prompts/autopilot-kickoff.js';
import { buildAutopilotManual } from '../lib/prompts/autopilot-manual.js';
import { buildPassageRunnerKickoff } from '../lib/prompts/passage-runner-kickoff.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { UUID_REGEX, isValidIssueId, requireTeamMembership, TeamNotFoundError } from '../lib/workspace.js';
import {
  parseSourceNamespace,
  resolveStateRef,
  resolveLabelRef,
  resolveProjectRef,
  resolveTeamRef,
  RefResolutionError,
} from '../lib/proxy-ref-resolver.js';
import { appendBlock, replace as replaceInDescription, DescriptionEditError } from '../lib/description-edit.js';
import { PartialWriteError } from '../lib/partial-write-error.js';
import { badRequest, jsonError, notFound, workspaceUnavailableEnvelope, classifyUpstreamError } from '../lib/errors.js';
import { parseFeedbackImage } from '../lib/attachment-upload.js';

/**
 * Resolve the OpenRouter credentials for a proxy LLM call, mirroring
 * resolveRoadmapLLM (routes/workspace-api.js). Free tier is used ONLY when there
 * is no token-creator OAuth key (`sessionApiKey`) and no *usable* server paid key
 * (`getPaidEnvKey()` — trims, so empty/whitespace `OPENROUTER_API_KEY` counts as
 * unset; LIN-961), but `OPENROUTER_FREE_TIER_KEY` is set. On the paid-env path the
 * trimmed `getPaidEnvKey()` is returned as `apiKey` so a blank/whitespace value can
 * never be forwarded to OpenRouter as a bogus auth header; for a clean key the
 * trimmed value equals the raw one, so paid/OAuth/env behavior is unchanged. Model
 * resolution stays on resolveWorkspaceModel; the returned
 * `isFreeTier` is threaded into resolveWorkspaceModel as `forceDefault` at each
 * billed call site so free-tier requests clamp to DEFAULT_MODEL (LIN-513).
 * @param {string|null|undefined} sessionApiKey - Token-creator's OAuth key, if any.
 * @returns {{ apiKey: (string|undefined), isFreeTier: boolean }}
 */
export function resolveProxyLLM(sessionApiKey) {
  const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
  const paidEnvKey = getPaidEnvKey();
  const isFreeTier = !sessionApiKey && !paidEnvKey && !!freeTierKey;
  const apiKey = sessionApiKey || (isFreeTier ? freeTierKey : paidEnvKey);
  return { apiKey, isFreeTier };
}

// LIN-1458: which OpenRouter credential source served a request whose token
// creator's OWN account-keyed read (getWorkspaceOpenRouterKey) came back empty.
// Distinct from OWNERLESS_NOTE (lib/proxy-events.js) and from the LIN-961
// free-tier prose note — exact-equality strings so a future consumer can
// classify by note without substring matching (lib/proxy-events.js's "never
// includes" rule). Kept local rather than exported from lib/proxy-events.js
// because they answer a different question than credentialVerdict does ("which
// OpenRouter credential source served this request", not "is this dispatch/proxy
// token dying") — but their audit rows DO reach credentialVerdict/foldCredentialHealth
// like any other row for the token: exact-equality matching means they never
// increment ownerlessCount, while their status:200 does feed okCount, the same
// shape as the pre-existing LIN-961 free-tier row, and is accepted deliberately.
// See tests/unit/credential-health-predicate.test.js's LIN-1458 case for the pin.
const OPENROUTER_FALLBACK_PAID_NOTE = 'openrouter_key_fallback_paid_env';
const OPENROUTER_FALLBACK_FREE_NOTE = 'openrouter_key_fallback_free_tier';

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
async function resolvePromptIssueContext(provider, accessToken, identifier, isTestMode) {
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
  return await withTimeout(provider.fetchIssueContext(accessToken, identifier), GRAPHQL_TIMEOUT_MS);
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
//
// Exported (LIN-2154) so the session-auth human-lane comment route
// (routes/workspace-api.js) shares this SAME cache instance rather than a
// fresh one that would miss workspace-wide generation bumps below.
export const commentDedupe = createDedupeCache();

/**
 * Per-workspace generation tag for comment dedupe invalidation (LIN-1160,
 * widened to workspace-only keying by LIN-2005).
 *
 * `commentDedupe` above has no delete/invalidate method, and Linear's
 * `commentDelete` mutation returns no comment body — so a delete route has no
 * way to reconstruct the exact `dedupeKey(...)` a prior create would have
 * used, only to invalidate coarsely. `POST .../comments` folds the current
 * tag for the request's workspace into its `dedupeKey(...)` call;
 * `DELETE`/`PATCH .../comments/:commentId` mint a fresh tag on success. Every
 * prior dedupe entry for that WORKSPACE then silently stops matching (cache
 * miss -> fresh mint), regardless of which issue or comment changed.
 *
 * Keyed on workspace (`req.proxyUrlKey`) only, NOT `(urlKey, issueId)`:
 * neither the delete nor the edit route resolves `issueId` to a canonical
 * issue identity (Linear's `updateComment`/`deleteComment` and the Local
 * provider's equivalents take only `commentId`; `issueId` is validated for
 * format only), so a create/delete pair using different id forms for the
 * SAME issue (e.g. `LIN-123` vs its UUID) would bump a different per-issue
 * key than the create used, leaving the create's dedupe entry live and
 * letting a re-create within the TTL echo back a deleted/edited comment as a
 * false fresh success. Keying on workspace alone is immune to id form. The
 * tradeoff is coarser blast radius — a delete/edit on any issue resets every
 * issue's dedupe window in that workspace — never a stale success; the safe
 * direction to err per the LIN-399 no-misleading-success contract.
 *
 * Module scope (not inside `createProxyRoutes`) so a second factory call
 * shares invalidation state with `commentDedupe` rather than diverging from
 * it. Eviction is sized effectively unreachable for workspace cardinality
 * (bounded by resolved tokens, not attacker-controlled input) — unlike
 * `credentialResolutions` below, a lost generation here is not merely a
 * logging fingerprint: falling back to the pre-bump value would resurrect a
 * dedupe entry a bump was meant to kill, so this tracker must never evict in
 * practice.
 *
 * Exported (LIN-2154) alongside `commentDedupe` above for the same reason —
 * the human-lane route folds `commentDedupeGenerations.current(urlKey)` into
 * its own dedupe key so a delete/edit from either lane invalidates both.
 */
export const commentDedupeGenerations = createGenerationTracker();

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

// Module scope (not inside createProxyRoutes) so its budget is
// process-global across every createProxyRoutes() instance, unlike
// proxyLimiter above: two composer calls share one limiter, they don't each
// get their own. Declaring this inside the factory would make it
// per-instance instead, which is a behaviour change (LIN-679 Stage 2 /
// LIN-2534 plan-review R4). Group A's sub-router (routes/proxy-tokens-admin.js)
// receives this instance injected, never redeclares it.
const proxyTokenCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many token creation requests, please try again later' },
  skip: () => process.env.NODE_ENV === 'test'
});

const MAX_SEARCH_LENGTH = 500;
// MAX_NAME_LENGTH / MAX_DESCRIPTION_LENGTH now imported from
// lib/issue-write-validation.js (LIN-1552) — one definition, both write surfaces.

// LIN-583 test-only local-targeting seam. A proxy token minted for this urlKey
// resolves to the LocalProvider (reached with the urlKey as the store partition
// key), so the consumer `/api/proxy/*` data API can run against a local
// workspace for the B2 e2e (LIN-584). Mirrors LOCAL_WORKSPACE_URL_KEY in
// tests/fixtures/local-harness.js; kept inline (not imported) so production code
// never depends on a test fixture. Only consulted under NODE_ENV==='test'.
const TEST_LOCAL_URL_KEY = 'local-workspace';

// LIN-1175: fail-closed 503 message for a claude-code dispatch whose out-of-band
// bootstrap token could not be minted. attachProxyContext refuses (throws with
// proxyAttachFailed) rather than launch a credential-less session; the route
// surfaces this transient, retryable condition instead of a silent bare dispatch.
const PROXY_ATTACH_FAILED_MESSAGE = 'Proxy context was requested but a proxy token could not be created (LIN-1175) — refusing to launch a credential-less session; you may have hit the token rate limit, wait a minute and retry.';

// LIN-376: every handoff (dispatch preamble, feedback, collective, page copy,
// +proxy toggle) embeds a single-use BOOTSTRAP token, never a standing/working
// one. The agent exchanges it at POST /api/proxy/token for a multi-use working
// token. WORKING_TOKEN_TTL_SECONDS is imported from lib/proxy-tokens.js so
// every mint site shares one source of truth — BOOTSTRAP_TOKEN_TTL_SECONDS is
// imported the same way, directly from lib/proxy-tokens.js, by group A's mint
// site in routes/proxy-tokens-admin.js (LIN-679 Stage 2 / LIN-2534).
// MAX_COMMENT_LENGTH now imported from lib/issue-write-validation.js (LIN-1552).

// Dispatch input limits. The prompt/url caps for the POST /dispatch payload now
// live in lib/dispatch-validation.js (shared with the session-auth twin via
// validateDispatchPayload, LIN-1139); MAX_IDENTIFIER_LENGTH remains for the other
// proxy handlers that cap an identifier directly.
const MAX_IDENTIFIER_LENGTH = 100;     // Issue identifiers
// Proxy consumers are remote, so 'local' (Harbour OS, spawns on the server's
// own /dev/tty) is intentionally excluded from the targets they may set.
const VALID_PROXY_DISPATCH_TARGETS = ['cli', 'web', 'dash'];
// LIN-1470: defensive cap on the list endpoint's lineage batch query
// (`rootItemId: {$in: anchors}`). Unlike the 200-row PAGE bound, nothing
// structurally limits how many rows one $in query can match: it spans the
// full 30-day history TTL, not just the current page, and — unlike the
// existing single-anchor equivalent at `_collectGroupFeedback` (the `:id`
// watch endpoint, one anchor per request) — this one fans the same query
// shape out across every anchor on the CURRENT PAGE (up to 200) in one call.
// A hard row-count cap is nonetheless the wrong lever here: the query already
// carries `projection: {prompt: 0}`, so it never touches the multi-KB-to-10MB
// field the H12/503 incidents (f5a94a53/15ca7b47) were actually about — the
// per-row cost is bounded (metadata + a typically-small feedback[]) the same
// way the existing shipped single-anchor query already is. 2000 is a
// generous backstop (10x the page bound) against a pathological outlier
// lineage, not a tuned realistic ceiling — no shipped lineage has come close.
// L3 (review): if a lineage DOES exceed this cap, `listHistory`'s `limit`
// path sorts `{resolvedAt: -1}` and keeps only the newest N, so the oldest
// members of an over-cap lineage are dropped from the merge (and so from
// feedbackCount/status/completedAt derivation). The list handler consumes
// the store's pre-slice `total` to warn — with the exact overshoot — when
// that happens (LIN-1485 → LIN-1494). Accepted as a backstop-of-last-resort,
// not a correctness guarantee at that scale.
// Exported (LIN-1494 F2 tidy) so the tests that exercise this exact cap
// import it instead of hand-mirroring the constant.
export const LINEAGE_QUERY_LIMIT = 2000;

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
        const err = new DOMException('Upstream API request timed out', 'TimeoutError');
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
      reject(new DOMException('Upstream API request timed out', 'TimeoutError'));
    }, ms);
  });
  try {
    return await Promise.race([workFn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// DANGEROUS_CHARS_REGEX (null bytes / dangerous control characters) now imported
// from lib/issue-write-validation.js (LIN-1552).

// The proxy-context preamble (the "Workspace API access" block appended to
// dispatched prompts) now lives in lib/proxy-preamble.js so non-proxy dispatch
// seams (feedback triage) append the byte-identical block (LIN-733). The
// mint-bootstrap + append sequence is consolidated there as attachProxyContext
// (LIN-1157), imported at the top of this file.

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
  // LIN-2079: the REPORTED status is the lifecycle one (terminal, else `blocked`
  // when the lineage is parked on a human). `item.feedback` is already
  // lineage-merged by getItemStatus({includeGroupFeedback:true}).
  // This is the ONLY call site here that moves: `alreadyTerminal`, the long-poll
  // baseline and `dispatchWatchChanged` all deliberately keep calling
  // `deriveTerminalStatus`, because a `blocked` item is NOT terminal and must
  // keep holding the long poll rather than short-circuiting it.
  const terminalStatus = deriveLifecycleStatus(item.feedback);
  const body = {
    id: item.id,
    status: terminalStatus || item.status,
    promptName: item.promptName,
    kind: item.kind || 'custom',
    issueIdentifier: item.issueIdentifier,
    issueUrl: item.issueUrl,
    target: item.target,
    model: item.model || null,
    harness: item.harness || null,
    terminal: item.terminal || null,
    presetName: item.presetName || null,
    followUpTo: item.followUpTo || null,
    force: item.force === true,
    abort: item.abort === true,
    abortTo: item.abortTo || null,
    cascade: item.cascade === true,
    sessionId: item.sessionId || null,
    // Scope bound (LIN-1751): visible on the poll/watch response like every
    // other stored field, so a caller inspecting its own run can see the
    // declared budget without guessing. null ⇒ unbounded.
    maxTasks: item.maxTasks ?? null,
    dispatchedAt: item.dispatchedAt,
    // Attribution (LIN-1948, fix 3b): the detail/watch read is where a human
    // asking "who dispatched this?" actually looks. Paired with the
    // `_formatHistoryItem` fix so the queued and taken halves agree. This is
    // the DETAIL read — `GET /api/proxy/dispatch` (list/poll) re-projects
    // through its own explicit field allow-list, which does not include this
    // and is deliberately left alone.
    dispatchedBy: item.dispatchedBy || null,
    // resolvedAt is take/archive time (when the runner claimed the item), NOT
    // completion. completedAt is the real completion time, null until terminal.
    resolvedAt: item.resolvedAt || null,
    completedAt: deriveCompletedAt(item.feedback),
    feedback: (item.feedback || []).map(f => {
      const entry = {
        message: f.message,
        url: f.url || null,
        urlLabel: f.urlLabel || null,
        timestamp: f.timestamp || null
      };
      // Additive-only (LIN-1297 idiom, matching _formatFeedbackEntries):
      // assign only when present, never emit `rootItemId: null` (LIN-1468).
      if (f.rootItemId) entry.rootItemId = f.rootItemId;
      // Additive-only (LIN-1297 idiom, matching _formatFeedbackEntries):
      // assign only when present, never emit `kind: null` (LIN-1475).
      if (f.kind) entry.kind = f.kind;
      return entry;
    })
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
 * @param {Function} [options.getWorkspaceNorthStar] - Function(urlKey, accountId) resolving the proxy
 *   token creator's durable north-star intent (LIN-1810). Absent → GET /api/proxy/north-star 503s.
 * @param {Function} [options.getNorthStarDocVersionForWorkspace] - Function(urlKey, accountId)
 *   resolving the doc-hash stamp recorded for this workspace's northStar, if any (LIN-2254). Optional
 *   and backward-compatible: absent → GET /api/proxy/north-star's `docVersion.stamped`/`drift` degrade
 *   to `null` rather than 503ing (unlike getWorkspaceNorthStar/reportHistoryStore above).
 * @param {Object} [options.reportHistoryStore] - Durable per-workspace roadmap report history store
 *   (LIN-1810). Absent → GET /api/proxy/north-star 503s.
 * @param {Object} [options.dispatchPresetsStore] - Dispatch presets store (LIN-1390), used by the
 *   autopilot kickoff route to validate an incoming `presetId` and resolve its config's routing
 *   precedence over workspace dispatchDefaults. Absent → `presetId` is accepted but has no effect.
 * @param {Object} [options.provider] - TEST-ONLY provider override (LIN-581). In production this is
 *   unset and the active provider is resolved per-workspace via getProviderForWorkspace inside
 *   resolveProviderAccess. Tests that need a non-registered fake provider (e.g. to observe ref
 *   resolution) inject one here; it wins over registry resolution. The capability gate
 *   (provider.supports -> 422) is reachable both ways: via a real registered provider whose
 *   workspace selects it, and via this injection.
 * @returns {Router} Express router with proxy routes
 */
export function createProxyRoutes({ proxyTokenStore, proxyEventStore, agentStatusStore, recapCacheStore, briefCacheStore, taskSnapshotStore, dispatchQueueStore, llmCallLogStore, workspaceFromUrl, getWorkspaceAccessToken, resolveWorkspaceAccess, getWorkspaceOpenRouterKey, getWorkspaceNorthStar, getNorthStarDocVersionForWorkspace = null, reportHistoryStore, workspacePreferencesStore, dispatchPresetsStore, freeTierStore, provider: injectedProvider = null, rejectedCredentialRegistry = null }) {
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

  // LIN-1985: the structured-error-envelope extra fields for a 401 caused by
  // Harbour's OWN proxy-token check (a bad/missing/expired bearer token, or a
  // bootstrap token already exchanged) — never a workspace/provider fault.
  // The remedy is "mint or re-issue a proxy token," never "reconnect the
  // workspace." Its counterpart is `LINEAR_AUTH` (lib/errors.js's
  // `classifyUpstreamError`, surfaced via `graphqlErrorExtra` below): a 401
  // whose `code` is `LINEAR_AUTH` instead means Linear itself rejected a
  // workspace credential Harbour DID resolve and send — the opposite remedy
  // (escalate to a human / reconnect the workspace, never re-issue the
  // agent's own token). Before this, both classes shared the identical bare
  // `{"error": "..."}` 401 shape, and the distinction (`stage` in
  // `logCredentialRejection`'s console.warn / the persisted proxy-event row)
  // was visible ONLY in Harbour's own logs — invisible to the very agent that
  // has to decide which remedy applies (the LIN-1985 gap).
  const PROXY_TOKEN_REJECTED_EXTRA = { code: 'PROXY_TOKEN_INVALID', category: 'auth', retryable: false, stage: STAGE_PROXY_TOKEN };

  async function authenticateProxyToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return jsonError(res, 401, 'Missing or invalid Authorization header', PROXY_TOKEN_REJECTED_EXTRA);
    }

    const token = authHeader.slice(7);
    if (!token) {
      return jsonError(res, 401, 'Empty token', PROXY_TOKEN_REJECTED_EXTRA);
    }

    try {
      const result = await proxyTokenStore.validateToken(token);
      if (!result) {
        // A rejected CALLER token and a rejected WORKSPACE credential are
        // both 401 and were, until LIN-1985, distinguishable ONLY in Harbour's
        // own logs/audit rows (`stage`) — invisible to the agent that actually
        // has to decide what to do, whose two remedies are opposites (re-issue
        // its own bearer token vs. escalate a dead stored credential to a
        // human). `PROXY_TOKEN_REJECTED_EXTRA`'s `code`/`stage` now ride on
        // the response body itself. This route never reaches logEvent — no
        // workspace is resolved yet, so there is nothing to audit — hence the
        // direct call.
        logCredentialRejection(req, 'auth');
        return jsonError(res, 401, 'Invalid, expired, or consumed token', PROXY_TOKEN_REJECTED_EXTRA);
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
   * `ownerAccountId` (LIN-1366) scopes the underlying token lookup to a single
   * account — forwarded verbatim to `resolveWorkspaceAccess` (typically
   * `req.proxyCreatedBy`, including `null` for a legacy proxy token with no
   * recorded creator, which fails closed rather than falling back owner-blind).
   *
   * LIN-1891: `token` is the provider's structured call scope when the
   * workspace's active binding needs one (a bare string for linear/local,
   * unchanged; `{token, repo}` / `{token, scope}` / `{email, apiToken, site}`
   * for github/github-projects/jira) — substituted in only when a scalar
   * token was already present, so a missing credential still resolves `token:
   * null` and 503s exactly as before.
   *
   * LIN-1980: also stamps `req.resolvedCredentialFingerprint` with the
   * fingerprint of the credential THIS call actually resolved (sourced from
   * `resolveWorkspaceAccess`'s own return value, never from
   * `credentialResolutions` below — that trail is logging-only and can miss
   * or lag a direct caller). `logEvent`'s 401 branch reads it to mark the
   * rejected credential suspect. Stamped before the early TEST_LOCAL_URL_KEY
   * return too, so a local-provider 401 (rare, but possible on a capability
   * decline) never reads a stale fingerprint from a previous request on the
   * same `req`-shaped object in a test harness.
   *
   * LIN-1746 (found by code review): the general path stamps ONLY when
   * `resolveWorkspaceAccess` actually returned a `token` — never on a
   * resolution failure (`session_expired` / `owner_mismatch` / etc., no
   * credential to speak of). An earlier revision stamped unconditionally
   * (`credentialFingerprint ?? null`) even on failure, which left
   * `req.resolvedCredentialFingerprint` merely PRESENT (`null`, not
   * `undefined`) on a request that never reached a provider credential at
   * all — `logEvent`'s `stage` classification below tests presence, not
   * value, so every `workspaceUnavailable()` 503 for the non-ownerless death
   * class was misfiled as `stage: 'provider-lane'` instead of
   * `'proxy-token'`. That polluted `providerLaneOccupancy`'s denominator
   * with zero-fault "evidence" (a 503 is never a 401, so it never counts as
   * faulting, only as occupied) — able to report a false `verdict: 'ok'`
   * from the top-level "primary detector" while the SAME token's workspace
   * credential was 100% dead, exactly the misdiagnosis this ticket's own
   * `workspaceAccess` half exists to prevent. The TEST_LOCAL_URL_KEY branch
   * above is unaffected — it never fails, so it keeps stamping unconditionally.
   *
   * @returns {Promise<{provider: Object, token: (string|Object|null), reason: string}>}
   */
  async function resolveProviderAccess(urlKey, ownerAccountId, req) {
    if (process.env.NODE_ENV === 'test' && urlKey === TEST_LOCAL_URL_KEY) {
      if (req) {
        req.resolvedCredentialFingerprint = null;
        req.resolvedCredentialExpiresAt = null;
        // LIN-2351: stamped here too, for the identical reason LIN-1980
        // duplicated the fingerprint stamp on this branch — a reused
        // `req`-shaped object in a test harness must never read a stale
        // provider name from a prior request.
        // LIN-2354: `declared` mirrors the general branch below — this branch is
        // always resolved (a real local-provider identity, never a fallback).
        req.resolvedProvider = { name: localProvider.name, displayName: localProvider.ui.displayName, declared: localProvider.name };
      }
      return { provider: localProvider, token: urlKey, reason: 'ok' };
    }
    const { token, scope, reason, provider: providerName, source, expiresAt, credentialFingerprint } = await resolveWorkspaceAccess(urlKey, ownerAccountId);
    if (req && token) {
      req.resolvedCredentialFingerprint = credentialFingerprint ?? null;
      // LIN-2216: stamped alongside the fingerprint, on THIS request object —
      // deliberately NOT read back from `credentialResolutions` (a shared,
      // per-(urlKey,ownerAccountId) map that map every resolution overwrites
      // and whose own doc says "never read for anything but logging"; an
      // earlier revision of isTransientProviderAuthFailure read it anyway,
      // which a concurrent request under the same pair could race — found by
      // code review). Per-request storage makes the transient-vs-terminal
      // classification race-free by construction.
      req.resolvedCredentialExpiresAt = Number.isFinite(expiresAt) ? expiresAt : null;
    }
    const activeProvider = injectedProvider || getProviderForWorkspace({ provider: providerName });
    if (req) {
      // LIN-2351: stamp the resolved provider's name so the error-response
      // helpers (graphqlErrorDetail et al.) can attribute a failure to the
      // right backend instead of hardcoding Linear. Guarded on `req` alone,
      // unconditional on `token` — the provider resolves even when the
      // credential does not (a no-token request 503s via workspaceUnavailable
      // before any catch that would read this). `resolvedProvider` is a new
      // field with no existing presence-test anywhere (verified: grep finds
      // zero readers pre-change), so stamping it unconditionally cannot
      // reproduce LIN-1746's failure mode, which required an existing reader
      // keyed on presence of the SAME field being stamped. `activeProvider.ui`
      // is optionally-chained: every real ProviderInterface subclass carries
      // it, but several existing unit-test fixtures inject a bare object
      // (no `.ui` getter) via `injectedProvider` — this must not throw for
      // those, so it falls back to the machine name, the same fallback
      // `ui.displayName` itself uses for a real provider with no override.
      //
      // LIN-2354: `declared` is the PRE-FALLBACK name — `providerName` as
      // returned by `resolveWorkspaceAccess`, before `getProviderForWorkspace`
      // applies `LEGACY_DEFAULT_PROVIDER`. Unlike `displayName` (which always
      // names SOME provider, Linear included, once a fallback applies),
      // `declared` is `null` exactly when nothing was actually declared for this
      // workspace/resolution — the discriminator an identity-asserting sentence
      // needs to distinguish "really Linear" from "unresolved, defaulted to
      // Linear". Additive only: the sole existing reader (`graphqlErrorDetail`,
      // below) reads `.displayName` and is unaffected.
      req.resolvedProvider = {
        name: activeProvider.name,
        displayName: activeProvider.ui?.displayName ?? activeProvider.name,
        declared: providerName ?? null
      };
    }
    // Record WHICH credential this resolution handed out, so a later 401 from the
    // upstream can name it (see recordCredentialResolution / logEvent). Secret-safe
    // and diagnostic-only — nothing downstream reads this, so it can never change
    // which credential is used or whether a request succeeds.
    recordCredentialResolution(urlKey, ownerAccountId, {
      urlKey,
      ownerAccountId,
      provider: providerName,
      credential: token ? (scope ?? token) : null,
      source,
      expiresAt,
    });
    // LIN-1891: substitute the structured call scope for the bare token ONLY
    // where a token was already present — the ternary is load-bearing. It
    // preserves every `if (!token)` guard and the 503 envelope unchanged: a
    // missing credential still 503s (token stays falsy) regardless of what
    // `scope` contains, and `scope ?? token` falls back to the bare token for
    // linear/local (whose scope IS the token, byte-identical) or for any
    // provider-lane site that hasn't been given a structured scope yet.
    return { provider: activeProvider, token: token ? (scope ?? token) : token, reason };
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
    jsonError(res, 422, `This workspace's provider does not support this`, {
      code: 'CAPABILITY_NOT_SUPPORTED',
      capability: method,
      provider: activeProvider.name,
    });
    return true;
  }

  /**
   * Shared refusal responder for the duplicate-dispatch guard (LIN-1656),
   * mirroring `denyIfUnsupported` above: one construction site for the 409 so
   * every creating route replies identically and a new one inherits the shape
   * instead of having to remember it.
   *
   * The BODY itself is built once further up, by `createDispatchItem`, and
   * carried on `err.duplicateDispatch` — `{ code, id, issueIdentifier, kind,
   * dispatchedAt, retryAfter }`. This just labels it, audits it, and picks the
   * right transport. `code` is the programmatic discriminator callers branch on;
   * 409 is already taken on this router by the trashed-issue refusal, so the
   * status alone is not enough to tell them apart.
   *
   * `id` is the load-bearing field: it names the LIVE dispatch, so a refused
   * orchestrator can WATCH that one instead of guessing. This is exactly why the
   * plan chose 409 over a `{deduped:true}` 200 — a wake is addressed to the
   * original dispatcher's edge, so a success shape would leave the second
   * orchestrator standing by forever on an edge it does not own.
   *
   * KEEPALIVE CAVEAT (`lib/http-keepalive.js`). On a long handler the keepalive
   * may already have flushed `200 + Content-Type` before the guard fires, at
   * which point the HTTP status is committed and cannot be changed — `send` then
   * moves the real status into the body as `statusCode`. So a keepalive-armed
   * caller MUST pass its keepalive here rather than touching `res` directly, and
   * the `Retry-After` header is set only while headers are still open (setting one
   * after flush throws ERR_HTTP_HEADERS_SENT and would turn a clean refusal into a
   * crash). The body's `retryAfter` is the authoritative copy either way; the
   * header is the standards-friendly duplicate, matching what `standardHeaders`
   * already emits on the rate limiters.
   *
   * @param {*} err - the caught error (a non-duplicate error passes straight through)
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {string} endpoint - audit-log endpoint tag
   * @param {{send: Function}} [keepalive] - pass when the handler armed one
   * @returns {boolean} true if a refusal was sent (caller returns early)
   */
  function refuseIfDuplicateDispatch(err, req, res, endpoint, keepalive = null) {
    if (!err || !err.duplicateDispatch) return false;
    const refusal = err.duplicateDispatch;
    // The `note` is what makes the guard COUNTABLE, following the
    // `workspaceUnavailable` precedent (LIN-1540 threads its reason so 503s are
    // countable by reason). 409 on this router is already taken by the
    // trashed-issue refusal, so without a note the Proxy page cannot tell "the
    // guard fired 40 times" from "40 writes hit trashed issues" — and the
    // production false-refusal rate is only measurable because of this line.
    // Carries the colliding id, so a refusal is diagnosable from the log alone
    // and not just from the wire body the caller received.
    logEvent(req, endpoint, 409, `${DUPLICATE_DISPATCH_CODE} ${refusal.id}`);
    if (!res.headersSent) {
      res.set('Retry-After', String(refusal.retryAfter));
    }
    if (keepalive) {
      keepalive.send(409, { error: err.message, ...refusal });
    } else {
      jsonError(res, 409, err.message, refusal);
    }
    return true;
  }

  /**
   * Shared refusal responder for the task-budget guard (LIN-1751), mirroring
   * `refuseIfDuplicateDispatch` above in every respect: one construction site
   * for the 409 so a route replies identically and doesn't have to remember the
   * shape, the same keepalive caveat (a long handler may have already flushed
   * `200` via whitespace keepalive before this guard fires), and the same
   * `note` argument to `logEvent` so refusals are countable on the Proxy page.
   *
   * The BODY is built once, in `createDispatchItem`, and carried on
   * `err.budgetExhausted` — `{ code, count, maxTasks, sessionId }`. `code` is
   * the programmatic discriminator (`BUDGET_EXHAUSTED`), distinct from
   * `DUPLICATE_DISPATCH` so a caller branching on 409 bodies can tell the two
   * refusals apart.
   *
   * Wired at the same call sites `refuseIfDuplicateDispatch` is (LIN-1751
   * deliberately matches that existing coverage rather than closing its gap —
   * see the plan): every route that checks the duplicate guard on its
   * `createDispatchItem` catch also checks this one.
   *
   * @param {*} err - the caught error (a non-budget error passes straight through)
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {string} endpoint - audit-log endpoint tag
   * @param {{send: Function}} [keepalive] - pass when the handler armed one
   * @returns {boolean} true if a refusal was sent (caller returns early)
   */
  function refuseIfBudgetExhausted(err, req, res, endpoint, keepalive = null) {
    if (!err || !err.budgetExhausted) return false;
    const refusal = err.budgetExhausted;
    logEvent(req, endpoint, 409, `${BUDGET_EXHAUSTED_CODE} ${refusal.sessionId}`);
    if (keepalive) {
      keepalive.send(409, { error: err.message, ...refusal });
    } else {
      jsonError(res, 409, err.message, refusal);
    }
    return true;
  }

  /**
   * Backstop for the ROUTE-INTERNAL reads a write path calls unconditionally —
   * `issueWriteGuard` / `issueDescription` / `issueLabels` / `updateIssueLabels`
   * (LIN-1559).
   *
   * These are deliberately OFF the declared PROVIDER_SURFACE (route-internal
   * data-fetch, not capabilities), so `denyIfUnsupported` cannot gate them:
   * `supports()` is false for all four on EVERY provider, Linear included. Keyed
   * on plain method EXISTENCE instead, which is the property the route actually
   * depends on. A provider that passes the capability gate for the write itself
   * but lacks the read used to guard it previously threw a TypeError inside the
   * route's `try` and surfaced as a 500 "Linear API request failed" — a server
   * error, naming the wrong backend, for a request that can never succeed. This
   * is how the GitHub bug arose, so the guard is deliberately per-method and
   * provider-agnostic: any future provider that implements a write without its
   * guard reads declines cleanly instead of 500ing.
   *
   * Reuses `denyIfUnsupported`'s exact 422 CAPABILITY_NOT_SUPPORTED envelope +
   * audit write, so callers see one decline shape for "this workspace's provider
   * cannot do this", whichever half is missing.
   *
   * @returns {boolean} true if a decline response was sent (caller returns early)
   */
  function denyIfMissingRead(activeProvider, method, req, res, endpoint) {
    if (typeof activeProvider?.[method] === 'function') return false;
    logEvent(req, endpoint, 422);
    jsonError(res, 422, `This workspace's provider does not support this`, {
      code: 'CAPABILITY_NOT_SUPPORTED',
      capability: method,
      provider: activeProvider?.name,
    });
    return true;
  }

  /**
   * Helper to log a proxy event (fire and forget). `note` is an optional
   * free-text breadcrumb (e.g. the free-tier key-source signal from LIN-961);
   * it is additive and leaves the numeric `status` untouched.
   */
  // Most recent credential resolution per (workspace, owner), for naming the
  // credential a 401 rejected — see lib/proxy-credential-trail.js for the full
  // rationale (2026-08-09 incident write-up, honest limits, eviction policy).
  const { recordCredentialResolution, logCredentialRejection } = createCredentialTrail();

  function logEvent(req, endpoint, status, note = null, { skipWitness = false } = {}) {
    // LIN-2236 (L5.2 of the LIN-2231 design): 503 joins 401 here — every 503
    // this proxy returns already IS a workspace-credential resolution failure
    // (workspaceUnavailable's reasons: store_unreachable / session_expired /
    // not_connected / token_ownerless / owner_mismatch / owner_signed_out),
    // so the rejection-trail machinery (credentialResolutions lookup,
    // rejectedCredentialRegistry) that only ever fired for a 401 (the
    // provider rejecting a credential we DID resolve) was structurally blind
    // to the whole "we couldn't resolve one at all" class. No new plumbing —
    // logCredentialRejection's lookup already keys on (urlKey, createdBy),
    // which every call site already has.
    if (status === 401 || status === 503) {
      logCredentialRejection(req, endpoint);
      // LIN-1980: mark the credential THIS request actually resolved suspect
      // — sourced from `req.resolvedCredentialFingerprint` (stamped at
      // resolution time by resolveProviderAccess / the 9 direct
      // resolveWorkspaceAccess call sites), never from `credentialResolutions`
      // above, which is logging-only and can miss a direct-resolve site. A
      // proxy-token-stage 401, or a 503 where nothing ever resolved (the
      // common owner_mismatch/not_connected/… case), leaves the fingerprint
      // unset, and `markSuspect` fails open on that (no-op) either way.
      //
      // LIN-2216: `status === 503` now has TWO distinct meanings sharing
      // this one branch — a resolution failure (LIN-2236's original case,
      // no fingerprint) and a TRANSIENT provider-lane 401 reclassified by
      // `graphqlErrorStatus` (a fingerprint IS present: a credential
      // resolved, Linear rejected it anyway). The reason label keeps them
      // apart in the registry's own diagnostics without adding a new status
      // code or a new field — `req.resolvedCredentialFingerprint` already
      // distinguishes them, the same presence check `stage` below uses.
      const reason = status === 401
        ? 'provider-401'
        : (req.resolvedCredentialFingerprint ? 'provider-503-transient' : 'workspace-503');
      rejectedCredentialRegistry?.markSuspect(req.resolvedCredentialFingerprint, { reason, now: Date.now() });
    } else if (status >= 200 && status < 300 && req.resolvedCredentialFingerprint && !skipWitness) {
      // LIN-2109: the positive half of the acceptance witness — a genuine
      // 2xx provider-lane response carrying a resolved fingerprint is the
      // sound proof this credential is accepted by the provider, unlike mere
      // exchange success or adoption (see lib/rejected-credentials.js's
      // module doc and `accept()`'s own doc for why those are NOT this
      // signal — LIN-1983's two singleton fingerprints were exchanged,
      // adopted, `accept()`ed, and 401'd immediately). A 503 never reaches
      // here (handled above) precisely because a 503 is a resolution
      // failure, not a provider response — there is nothing to witness.
      //
      // Deliberately 2xx-only, NOT "any non-401" (an earlier revision was):
      // `logEvent` is the single write seam for EVERY proxy response,
      // including one that resolved a credential (so
      // `req.resolvedCredentialFingerprint` is truthy) and then failed a
      // purely LOCAL guard before ever reaching the provider — a malformed
      // issueId (400), an unsupported-capability decline (422,
      // `denyIfUnsupported`), or a duplicate-dispatch/budget refusal (409).
      // None of those contacted the provider at all; witnessing them would
      // record acceptance for a credential nothing ever asked the provider
      // about, poisoning the exact signal this ticket exists to make sound
      // (found by code review; regression-pinned in
      // tests/unit/lin-2109-credential-acceptance-witness.test.js).
      //
      // `skipWitness` (found by a SECOND review pass) covers the same class
      // one level deeper: a 2xx that never reached the provider because a
      // CACHE answered it instead — the comment-create dedupe hit (LIN-399,
      // below) returns a stored prior response without calling
      // `provider.createComment`. Rather than keep hunting the next such
      // site by inspection, callers that know they are serving a cached/
      // local-only 2xx pass this explicitly; new call sites default to
      // witnessing, so an audit gap fails toward "extra witness," never
      // toward silently reintroducing a suspect-401-look-alike gap.
      //
      // Double-optional-chained (not just on the registry, on the METHOD
      // too): `witnessAccepted` is new — an older fake registry (several
      // exist across this suite, implementing only
      // markSuspect/isSuspect/shouldAttemptRefresh/accept) must degrade to a
      // no-op here, not throw and hang the request.
      rejectedCredentialRegistry?.witnessAccepted?.(req.resolvedCredentialFingerprint, Date.now());
    }
    // LIN-2076: `stage` + `credentialFingerprint`, persisted at this single
    // existing write seam instead of discarded (the ticket's own diagnosis:
    // both were already computed by resolveProviderAccess three lines up the
    // call stack and thrown away). `req.resolvedCredentialFingerprint` is
    // stamped by resolveProviderAccess on every branch that actually resolved
    // a credential (pinned by tests/unit/proxy-credential-fingerprint-stamping.test.js)
    // and left `undefined` — never `null` — on a request that never reached
    // one, including a `workspaceUnavailable()` resolution failure (LIN-1746,
    // found by code review: an earlier revision stamped `null` even on that
    // failure, which misfiled it as `provider-lane` here and polluted
    // `providerLaneOccupancy`'s denominator with zero-fault evidence). So
    // presence alone (not the value) is the reliable "did this call actually
    // resolve a provider credential" signal; reusing it here avoids a second,
    // request-scoped flag that could drift from the first.
    const stage = req.resolvedCredentialFingerprint !== undefined ? STAGE_PROVIDER_LANE : STAGE_PROXY_TOKEN;
    proxyEventStore.recordEvent({
      urlKey: req.proxyUrlKey,
      tokenId: req.proxyTokenId,
      tokenLabel: req.proxyTokenLabel,
      method: req.method,
      endpoint,
      status,
      note,
      stage,
      credentialFingerprint: req.resolvedCredentialFingerprint ?? null
    }).catch(err => console.error('Failed to log proxy event:', err));
  }

  /**
   * LIN-1458: records, once per request (never per descent hop —
   * computeRecommendation's internal read never re-fires this because both
   * production callers already pass a pre-resolved sessionApiKey), which
   * OpenRouter credential source served this request when the token creator's
   * OWN account-keyed read came back empty (null). Claims only what
   * resolveProxyLLM's own return values prove: it does NOT claim a split
   * account, and does NOT claim re-authenticating would help (LIN-1413's
   * round-1 blocking defect — any copy written here inherits that
   * constraint). No entry is written for the ordinary creator-key-present
   * path — only the two previously-silent (or prose-only) fallback branches
   * are witnessed here. Call only after the 503 "not configured" gate, so
   * !sessionApiKey && !isFreeTier here always implies a paid env key exists.
   */
  function logOpenRouterCredentialSource(req, endpoint, { sessionApiKey, isFreeTier }) {
    if (sessionApiKey) return;
    logEvent(req, endpoint, 200, isFreeTier ? OPENROUTER_FALLBACK_FREE_NOTE : OPENROUTER_FALLBACK_PAID_NOTE);
  }

  /**
   * Send the structured "workspace not available" 503 envelope (LIN-417).
   * Status stays 503; the body carries code/category/retryable/detail and a
   * safe `context` (public workspace slug only) so an automated caller can
   * decide whether to back off (retryable) or escalate (auth/config).
   * `reason` is threaded unmodified from resolveWorkspaceAccess at every read,
   * write, and compute endpoint (all now share the single raw-token path).
   * It also rides the audit write as the `note` breadcrumb (LIN-1540) so a 503
   * records WHICH reason fired and is countable by reason over the store's
   * 30-day window; the envelope already returns it, so this widens no exposure.
   */
  function workspaceUnavailable(req, res, endpoint, reason) {
    logEvent(req, endpoint, 503, reason);
    return res.status(503).json(workspaceUnavailableEnvelope(reason, req.proxyUrlKey));
  }

  /**
   * LIN-2216: distinguish a TRANSIENT upstream 401 from a genuinely dead
   * credential, using the same retryable-vs-terminal SHAPE as
   * `isDefinitiveRevocation`/`isTransientRefreshFailure` (lib/token-refresh.js,
   * LIN-1545) — that pair classifies an OAuth refresh-EXCHANGE failure
   * (`TokenRefreshError`), which never occurs on this plain-GraphQL-401 path,
   * so this is the analogous split for the error class that DOES occur here,
   * not a reuse of those functions themselves.
   *
   * THREE conditions, all required:
   *
   * 1. `req.resolvedCredentialExpiresAt` — stamped on THIS request object by
   *    `resolveProviderAccess`, at the same seam as the fingerprint stamp —
   *    says THIS request's own resolution believed the credential was still
   *    comfortably live. Deliberately per-request, not read back from
   *    `credentialResolutions` (a SHARED, per-(urlKey,ownerAccountId) trail
   *    whose own doc says "never read for anything but logging"): an earlier
   *    revision read that map here, which a concurrent request under the
   *    same pair could race — request A's error handler could read a LATER
   *    request B's overwritten, live-looking descriptor and misclassify A's
   *    genuine terminal failure as transient (found by code review).
   *
   * 2. NOT already marked suspect. A believed-live credential rejected once
   *    is the exact signature of `lib/workspace-token-cache.js`'s LIN-2216
   *    fix target (a cache entry, or a rotation elsewhere, serving a token
   *    past its real current validity) — a one-off race that resolves
   *    itself on the next fresh resolve. The SAME fingerprint rejected
   *    AGAIN despite still looking live inside its nominal window is no
   *    longer that shape: it looks like a genuine out-of-band revocation
   *    (the user disconnected the workspace mid-token-life) that merely
   *    hasn't reached its recorded expiry yet. Without this check, such a
   *    credential would classify as transient/retryable for the REST of its
   *    nominal lifetime instead of ever escalating (found by code review) —
   *    this bounds the transient grace to essentially one occurrence per
   *    fingerprint, since the first rejection is what marks it suspect via
   *    `logEvent`'s own markSuspect call, immediately after this classifies it.
   *
   * 3. NOT past the byte-identical-rejection escalation threshold (LIN-2327).
   *    `rejectedCredentialRegistry.isPastByteIdenticalThreshold` consults the
   *    fingerprint-only, no-TTL counter that `attemptSuspectCredentialRefresh`
   *    (server.js) bumps whenever a forced refresh comes back byte-identical
   *    to the just-rejected credential. Unlike condition 2, this counter
   *    outlives the suspect mark's TTL by design, so a fingerprint that has
   *    proven itself unrecoverable stays terminal even after suspicion lapses
   *    within the SAME process — otherwise the retryable-503 grace would
   *    re-arm every suspect-TTL window while the underlying credential never
   *    actually changes bytes. The registry is per-process and in-memory
   *    (see lib/rejected-credentials.js's module doc), so a process restart
   *    clears this counter along with every other mark — it does not survive
   *    a restart, and re-arming there is the correct failure direction.
   *
   * @param {import('express').Request} req
   * @returns {boolean} true if this 401 should surface as a retryable 503
   */
  function isTransientProviderAuthFailure(req) {
    const expiresAt = req?.resolvedCredentialExpiresAt;
    const looksLive = typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > Date.now();
    if (!looksLive) return false;
    if (rejectedCredentialRegistry?.isSuspect(req?.resolvedCredentialFingerprint)) return false;
    // LIN-2327: a fingerprint that has come back byte-identical from a
    // forced refresh at least BYTE_IDENTICAL_ESCALATION_THRESHOLD times is
    // never transient, even once its suspect mark has lapsed — otherwise the
    // retryable-503 grace re-arms every suspect-TTL window while the
    // underlying credential never actually changes bytes. This counter is
    // per-process/in-memory, so a process restart clears it and the
    // retryable-503 grace re-arms then too — this classifier change does not
    // prevent that.
    if (rejectedCredentialRegistry?.isPastByteIdenticalThreshold?.(req?.resolvedCredentialFingerprint, BYTE_IDENTICAL_ESCALATION_THRESHOLD)) return false;
    return true;
  }

  /**
   * LIN-2216: the extra JSON fields a data-route auth-shaped (401/503)
   * response carries, alongside the existing `detail` every one of these
   * ~28 catch blocks already sends. Every other status (404/429/400/500) is
   * untouched — `{}` — so this diff changes nothing about their response
   * shape. Reuses `classifyUpstreamError`'s existing `LINEAR_AUTH` code/
   * category (the same vocabulary render-pages.js's human-facing error page
   * and the autopilot/kickoff branch below both use for this exact upstream
   * shape) so a consumer built against docs/proxy-integration.md's
   * documented 503 contract has a machine-matchable field to update against,
   * not just a status-code split it has to infer (found by code review —
   * that doc's Best Practice #4 said "a 503 means re-authenticate", which
   * this ticket's new transient-503 case makes only conditionally true; see
   * the doc update alongside this change).
   *
   * LIN-1985: a genuine (non-transient-reclassified) 401 here always means
   * `stage: 'provider-lane'` — this function is only ever reached from a
   * route's catch block AFTER the route's own `if (!token) return
   * workspaceUnavailable(...)` guard already passed, so the error came from
   * an actual upstream call to `provider.*`, never from a caller-token
   * rejection (that class 401s from `authenticateProxyToken`, before any
   * provider is ever touched — see `PROXY_TOKEN_REJECTED_EXTRA` above, its
   * counterpart). Stamping it explicitly here — rather than leaving the
   * agent to infer stage from `code === 'LINEAR_AUTH'` — is the fix for the
   * LIN-1985 gap: before this, the two failure classes' response bodies
   * were undocumented and easy to conflate (one carried `code`/`category`,
   * the other carried nothing at all, with no field either way that named
   * the distinction directly). Deliberately NOT added to the 503 branch:
   * that status already carries its own richer, already-documented
   * discriminators (`workspaceUnavailableEnvelope`'s per-reason `code`s, or
   * `provider-503-transient`'s `LINEAR_AUTH` — both unambiguously
   * provider-lane by construction, so a same-valued `stage` there would be
   * redundant, not clarifying).
   *
   * @param {*} err
   * @param {number} status - the value `graphqlErrorStatus(err, req)` already returned
   * @returns {{code?: string, category?: string, retryable?: boolean, stage?: string}}
   */
  function graphqlErrorExtra(err, status) {
    if (status !== 401 && status !== 503) return {};
    const classification = classifyUpstreamError(err);
    return {
      code: classification.code,
      category: classification.category,
      retryable: status === 503,
      ...(status === 401 ? { stage: STAGE_PROVIDER_LANE } : {})
    };
  }

  /**
   * Extract the upstream HTTP status from a graphql-request error.
   * graphql-request stores Linear's response status in err.response.status
   * and in err.response.errors[].extensions.statusCode.
   *
   * Maps upstream status to appropriate proxy response status:
   *  - 401/403 from Linear, TRANSIENT (see isTransientProviderAuthFailure)
   *    → 503, retryable — our own records believed this credential was
   *    still live; Linear disagreeing is a stale-serving/rotation-race
   *    signature that resolves itself on the next request, not a dead
   *    credential (LIN-2216)
   *  - 401/403 from Linear, otherwise → 401 (workspace token invalid/expired)
   *  - 404 from Linear     → 404 (resource not found)
   *  - 429 from Linear     → 429 (rate limited)
   *  - a flagged caller error (extensions.userError) → 400 (see below)
   *  - anything else       → 500
   */
  function graphqlErrorStatus(err, req) {
    // AbortSignal.timeout() raises a TimeoutError (name === 'TimeoutError')
    // and manual AbortController.abort() raises AbortError.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 504;
    const status = err.response?.status
      || err.response?.errors?.[0]?.extensions?.statusCode;
    if (status === 401 || status === 403) return isTransientProviderAuthFailure(req) ? 503 : 401;
    if (status === 404) return 404;
    if (status === 429) return 429;
    // Linear reports a CALLER error inside an HTTP 200 GraphQL envelope carrying
    // no `statusCode` at all — e.g. a malformed page cursor:
    //   status: 200, extensions: { code: 'INVALID_INPUT', type: 'invalid input',
    //   userError: true, userPresentableMessage: 'after is not a valid …' }
    // Neither branch above can see that (200 matches nothing, statusCode is
    // undefined), so every such response fell through to 500 — telling an agent
    // "the server broke, back off and retry" about an input only the caller can
    // fix. `userError` is Linear's own explicit "this one is on you" flag, so it
    // maps to 400 on every route, not just /issues: a caller error is a caller
    // error wherever it lands. Deliberately evaluated LAST, after the four
    // mappings above have had their say, so this can only refine a would-be 500
    // — no status this function already returns can move. (LIN-1511)
    if (err.response?.errors?.[0]?.extensions?.userError === true) return 400;
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
   *
   * Within the first bucket, `extensions.userPresentableMessage` is preferred
   * over the top-level `message` when Linear supplies one: it is the same trust
   * class (Linear-authored, on the same `errors[0]`, explicitly named as
   * caller-presentable) but far more actionable — "after is not a valid
   * pagination cursor identifier." instead of the generic "Argument Validation
   * Error", which is precisely the self-diagnosis this policy exists to serve.
   * Only that one string is surfaced: the sibling `extensions.validationErrors`
   * carries the whole echoed variables object and stays server-side. (LIN-1511)
   *
   * `req` (LIN-2351) supplies the resolved provider's display name, stamped by
   * `resolveProviderAccess` onto `req.resolvedProvider`, so the fallback and
   * timeout strings — and the auth-error log line — name the actual backend
   * instead of hardcoding Linear. On a Linear workspace `displayName` is
   * `'Linear'`, so this yields the byte-identical strings this function
   * always returned; when nothing is stamped (an error thrown before
   * `resolveProviderAccess` resolves) the wording stays provider-neutral
   * rather than guessing `'Linear'`.
   */

  /**
   * The declared provider's display name for identity-asserting prose (LIN-2354:
   * the "currently backed by X" clause), or `null` when nothing was actually
   * declared. Deliberately gated on `req.resolvedProvider.declared`, NOT a bare
   * read of `.displayName` — `.displayName` always names some provider (Linear
   * included) once `resolveProviderAccess`'s legacy fallback applies, which is
   * exactly the "unresolved workspace reads as Linear" defect this ticket fixes.
   * `.declared` is the pre-fallback name, `null` only when truly unresolved.
   *
   * @param {import('express').Request} req
   * @returns {string|null}
   */
  function declaredProviderDisplayName(req) {
    return req?.resolvedProvider?.declared ? req.resolvedProvider.displayName : null;
  }

  function graphqlErrorDetail(err, req) {
    const displayName = req?.resolvedProvider?.displayName;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return displayName
        ? `${displayName} API request timed out — the response may be too large or ${displayName} is slow. Try a more specific query.`
        : 'The upstream request timed out — the response may be too large or the provider is slow. Try a more specific query.';
    }

    const gqlError = err.response?.errors?.[0];
    const gqlMessage = gqlError?.extensions?.userPresentableMessage || gqlError?.message;
    if (gqlMessage) {
      const status = err.response?.status || err.response?.errors?.[0]?.extensions?.statusCode;
      if (status === 401 || status === 403) {
        console.error(`${displayName ?? 'Provider'} auth error (HTTP ${status}): ${gqlMessage}`);
      }
      return gqlMessage;
    }

    console.error('GraphQL error detail (suppressed from response):', err.message || 'Unknown error');
    return displayName ? `${displayName} API request failed` : 'The upstream provider request failed';
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

  /**
   * Map a PartialWriteError (LIN-2012) to a non-2xx `PARTIAL_WRITE` response
   * using the existing structured error envelope (code/category/retryable/
   * context — see lib/errors.js's `errorEnvelope`), rather than a bespoke
   * shape. The upstream status rides through (fallback 500) so a retryable
   * 429 partial isn't flattened the same as a non-retryable one. `retryable`
   * is always true here: both Jira writes are idempotent, so re-issuing the
   * same PATCH is the correct recovery, never a rollback. Returns true when
   * handled so callers can `if (partialWriteFailed(...)) return;` from a catch.
   */
  function partialWriteFailed(req, res, endpoint, err) {
    if (!(err instanceof PartialWriteError)) return false;
    const status = err.status || 500;
    logEvent(req, endpoint, status, `PARTIAL_WRITE applied=${err.applied.join(',') || 'none'} failed=${err.failed}`);
    jsonError(res, status, err.message, {
      code: 'PARTIAL_WRITE',
      category: 'upstream',
      retryable: true,
      detail: err.cause?.message || null,
      context: { applied: err.applied, failed: err.failed },
    });
    return true;
  }

  // Group A tokens-admin (LIN-679 Stage 2 / LIN-2534): extracted to
  // routes/proxy-tokens-admin.js, mounted at its original position.
  router.use(createTokensAdminRoutes({ proxyTokenStore, proxyEventStore, workspaceFromUrl, proxyTokenCreationLimiter }));

  // =========================================================================
  // Consumer API - Agent Instructions (llms.txt)
  // =========================================================================

  /**
   * GET /api/proxy/instructions
   * Returns agent-readable instructions for using the proxy API.
   * Authenticated so token is validated and base URL is known.
   *
   * PROVIDER IDENTITY (LIN-2354): this route was synchronous and zero-IO before
   * this change — the one thing that made it the route an agent could always
   * fetch even when a workspace's credential store was degraded. Resolving the
   * declared provider (for the "currently backed by X" clause and the two
   * provider-conditional notes below) adds the route's first IO and its first
   * failure surface. The resolve is wrapped so ANY failure — thrown exception,
   * unexpected shape — degrades to the neutral/unresolved wording, never a 5xx:
   * this route's whole purpose is to answer, not to be the most accurate answer.
   */
  router.get('/api/proxy/instructions', authenticateProxyToken, async (req, res) => {
    const scope = req.proxyTokenScope;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    let declaredDisplayName = null;
    let isDeclaredLinear = false;
    // LIN-2352: requiresTeam mirrors the /api/proxy/issues route's own signal
    // (provider.createFields().includes('teamId')) so this doc body can never
    // claim a teamId contract the route doesn't enforce. Defaults false on an
    // unresolved provider, same convention as isDeclaredLinear above — the
    // false-branch wording below is written to be true whether the provider
    // is genuinely teamless or merely unresolved, preserving the never-5xx
    // neutral-degrade contract.
    let requiresTeam = false;
    try {
      const { provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      declaredDisplayName = declaredProviderDisplayName(req);
      isDeclaredLinear = req.resolvedProvider?.declared === 'linear';
      requiresTeam = provider.createFields().includes('teamId');
    } catch {
      // Stays neutral/unresolved — see the reliability note above.
    }

    logEvent(req, '/api/proxy/instructions', 200);

    const text = buildInstructions({ baseUrl, scope, declaredDisplayName, isDeclaredLinear, requiresTeam });

    res.type('text/plain').send(text);
  });

  /**
   * POST /api/proxy/token  (LIN-376)
   * Exchange a single-use bootstrap token for a multi-use working token.
   *
   * This is the ONE operation a bootstrap token authenticates — `authenticateProxyToken`
   * (via validateToken) rejects a bootstrap on every data endpoint, so a handoff can
   * embed a bootstrap safely and the agent's first real call is this exchange. The
   * working token is returned only in this response body; it never enters the durable
   * prompt/queue/log. Auth is inline (not authenticateProxyToken, which would reject a
   * bootstrap): read the Bearer token and hand it straight to the store's atomic
   * exchange. Rate-limited like every consumer route; the successful exchange is
   * audit-logged against the resolved workspace.
   */
  router.post('/api/proxy/token', proxyLimiter, async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonError(res, 401, 'Missing or invalid Authorization header', PROXY_TOKEN_REJECTED_EXTRA);
    }
    const bootstrap = authHeader.slice(7);
    if (!bootstrap) {
      return jsonError(res, 401, 'Empty token', PROXY_TOKEN_REJECTED_EXTRA);
    }

    try {
      const working = await proxyTokenStore.exchangeBootstrapToken(bootstrap, {
        ttl: WORKING_TOKEN_TTL_SECONDS
      });
      if (!working) {
        // No workspace to attribute a failed exchange to, so it is not audit-logged.
        // LIN-1985: same non-workspace-fault class as authenticateProxyToken's
        // rejections above — the presented (bootstrap) token itself is bad.
        return jsonError(res, 401, 'Invalid, expired, or already-exchanged bootstrap token', PROXY_TOKEN_REJECTED_EXTRA);
      }

      proxyEventStore.recordEvent({
        urlKey: working.urlKey,
        tokenId: working.tokenId,
        tokenLabel: working.label,
        method: 'POST',
        endpoint: '/api/proxy/token',
        status: 200
      }).catch(err => console.error('Failed to log proxy event:', err));

      res.json({
        token: working.token,
        scope: working.scope,
        expiresAt: working.expiresAt,
        notes: 'The bootstrap token you sent has been consumed by this exchange. Use the token above (the "token" field of this response) for all subsequent requests — the bootstrap is now spent and will never authenticate again.'
      });
    } catch (err) {
      console.error('Proxy token exchange error:', err.message);
      jsonError(res, 500, 'Failed to exchange token');
    }
  });

  // =========================================================================
  // Consumer API - Read Endpoints
  // =========================================================================

  /**
   * GET /api/proxy/me
   */
  router.get('/api/proxy/me', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/me', reason);
      }
      if (denyIfUnsupported(provider, 'viewer', req, res, '/api/proxy/me')) return;

      const user = await provider.viewer(token);
      logEvent(req, '/api/proxy/me', 200);
      res.json(user);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/me', status);
      console.error('Proxy /me error:', err.message);
      jsonError(res, status, 'Failed to fetch user info', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/credential-health
   *
   * Consumer-lane provider credential health (LIN-2076 Half B; extended by
   * LIN-1746). Bounded to the token it authenticated with — never
   * workspace-wide token metadata, which is the session-authed
   * `/workspace/:urlKey/api/proxy/credential-health` route's job and stays
   * exactly as it is. Two DIFFERENT questions, both answered from this one
   * self-scoped read:
   *
   * - The top-level fields (LIN-2076): "is Linear rejecting a credential I
   *   DID resolve?" — `providerLaneOccupancy`, a time-bucketed occupancy
   *   rate over this token's own `stage: 'provider-lane'` rows, not a raw
   *   call-count ratio (a caller's own retries would otherwise inflate a
   *   single bad bucket's apparent weight). `verdict: 'unknown'` — never a
   *   false `ok` — until at least `OCCUPANCY_MIN_BUCKETS` distinct buckets
   *   have carried this token's own provider-lane traffic.
   * - `workspaceAccess` (LIN-1746): "can I even resolve a workspace
   *   credential AT ALL?" — the non-ownerless credential-death class
   *   (`session_expired` / `owner_signed_out` / `owner_mismatch` /
   *   `not_connected`) that arrives as a 503 from `workspaceUnavailable()`
   *   BEFORE any provider-lane credential resolves, invisible to the
   *   occupancy read above by construction (that read is stage-filtered).
   *   `recentFailureReasons` tallies this token's own recent 503 reasons;
   *   `verdict: 'unknown'` until the SAME reason has repeated at least
   *   `RECENT_REASON_MIN_STREAK` times — a single failure is genuinely
   *   ambiguous between transient and permanently dead (this ticket's own
   *   framing) — at which point `dominantReason` names it, so a worker can
   *   stop guessing "the workspace is disconnected" and ask for re-dispatch
   *   instead (the exact LIN-1576 misdiagnosis this ticket exists to
   *   prevent).
   *
   * `windowMs` (optional query param) lets a caller widen the look-back for
   * BOTH halves together; clamped server-side (`resolveOccupancyWindow` /
   * `resolveCredentialHealthWindow`) regardless of what is requested.
   */
  router.get('/api/proxy/credential-health', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const requestedWindowMs = req.query.windowMs !== undefined ? parseInt(req.query.windowMs, 10) : undefined;
      // LIN-1746: one query for both halves (found by code review — this
      // route is meant to be cheap enough to poll; two separate finds()
      // against the same collection/tokenId on every call was a needless
      // doubling of I/O once both halves shared one window).
      const { occupancy, workspaceAccess } = await proxyEventStore.listSelfCredentialHealth(req.proxyUrlKey, req.proxyTokenId, { windowMs: requestedWindowMs });
      logEvent(req, '/api/proxy/credential-health', 200);
      res.json({ ...occupancy, workspaceAccess });
    } catch (err) {
      logEvent(req, '/api/proxy/credential-health', 500);
      console.error('Proxy consumer credential-health error:', err.message);
      jsonError(res, 500, 'Failed to read credential health');
    }
  });

  /**
   * GET /api/proxy/teams
   */
  router.get('/api/proxy/teams', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/teams', reason);
      }

      const teams = await provider.fetchTeams(token);
      logEvent(req, '/api/proxy/teams', 200);
      res.json({ teams, truncated: !!teams.truncated });
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/teams', status);
      console.error('Proxy /teams error:', err.message);
      jsonError(res, status, 'Failed to fetch teams', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/projects
   */
  router.get('/api/proxy/projects', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/projects', reason);
      }
      if (denyIfUnsupported(provider, 'projects', req, res, '/api/proxy/projects')) return;

      const projectList = await provider.projects(token);
      logEvent(req, '/api/proxy/projects', 200);
      res.json({ projects: projectList.map(neutralizeProject) });
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/projects', status);
      console.error('Proxy /projects error:', err.message);
      jsonError(res, status, 'Failed to fetch projects', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/issues
   */
  router.get('/api/proxy/issues', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);
      }
      if (denyIfUnsupported(provider, 'issues', req, res, '/api/proxy/issues')) return;

      let teamId = req.query.teamId || null;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 250);
      // Opaque page cursor: pass the previous response's pageInfo.endCursor back
      // as `after` (or the `cursor` alias) to fetch the next slice. Treated
      // verbatim — never parsed/validated here — because its format is
      // provider-defined (Linear = base64 string, Local = stringified offset).
      // Absent → null, i.e. today's first-page behaviour (LIN-1511).
      const after = req.query.after ?? req.query.cursor ?? null;

      // LIN-2025: a well-formed-but-unmatched team id must fail loud instead
      // of silently widening to the whole workspace — an autonomous caller
      // cannot detect a dropped filter (John's ruling, 2026-08-10). Guarded
      // on teamId being present so the hot unfiltered-issues path pays no
      // extra provider round trip; a teamless provider's empty fetchTeams()
      // passes the raw value straight through (F1).
      if (teamId) {
        teamId = requireTeamMembership(await provider.fetchTeams(token), teamId);
      }

      const { nodes, pageInfo } = await provider.issues(token, { teamId, first: limit, after });
      logEvent(req, '/api/proxy/issues', 200);
      res.json({
        issues: nodes.map(flattenIssue),
        pageInfo: {
          hasNextPage: pageInfo.hasNextPage || false,
          endCursor: pageInfo.endCursor || null
        }
      });
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        logEvent(req, '/api/proxy/issues', 404);
        return jsonError(res, 404, `Team not found: ${err.teamId}`, { code: 'TEAM_NOT_FOUND', truncated: err.truncated });
      }
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues', status);
      console.error('Proxy /issues error:', err.message);
      jsonError(res, status, 'Failed to fetch issues', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/issues/:issueId
   */
  router.get('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/:id', reason);
      }
      if (denyIfUnsupported(provider, 'issueDetail', req, res, '/api/proxy/issues/:id')) return;

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
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/:id', status);
      console.error('Proxy /issue error:', err.message);
      jsonError(res, status, 'Failed to fetch issue', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/search
   */
  router.get('/api/proxy/search', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/search', reason);
      }
      if (denyIfUnsupported(provider, 'search', req, res, '/api/proxy/search')) return;

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
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/search', status);
      console.error('Proxy /search error:', err.message);
      jsonError(res, status, 'Failed to search issues', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/states/:teamId
   */
  router.get('/api/proxy/states/:teamId', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/states', reason);
      }
      if (denyIfUnsupported(provider, 'states', req, res, '/api/proxy/states')) return;

      const { teamId } = req.params;
      // LIN-2025: no local format gate — an invalid/unmatched team id is
      // surfaced by the provider itself (caught below), same as any other
      // provider-rejected input on this route.

      // Provider already sorts by board position (drop the route's duplicate sort).
      const stateList = await provider.states(token, teamId);
      logEvent(req, '/api/proxy/states', 200);
      res.json({ states: stateList });
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/states', status);
      console.error('Proxy /states error:', err.message);
      jsonError(res, status, 'Failed to fetch states', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/labels
   */
  router.get('/api/proxy/labels', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/labels', reason);
      }
      if (denyIfUnsupported(provider, 'labels', req, res, '/api/proxy/labels')) return;

      let teamId = req.query.teamId || null;
      // LIN-2025: fail loud on a well-formed-but-unmatched team id rather
      // than silently widening to the whole workspace — see /api/proxy/issues.
      if (teamId) {
        teamId = requireTeamMembership(await provider.fetchTeams(token), teamId);
      }

      const labelList = await provider.labels(token, teamId);
      logEvent(req, '/api/proxy/labels', 200);
      res.json({ labels: labelList });
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        logEvent(req, '/api/proxy/labels', 404);
        return jsonError(res, 404, `Team not found: ${err.teamId}`, { code: 'TEAM_NOT_FOUND', truncated: err.truncated });
      }
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/labels', status);
      console.error('Proxy /labels error:', err.message);
      jsonError(res, status, 'Failed to fetch labels', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/cycles
   * List cycles, optionally filtered by team.
   */
  router.get('/api/proxy/cycles', proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/cycles', reason);
      }
      if (denyIfUnsupported(provider, 'cycles', req, res, '/api/proxy/cycles')) return;

      let teamId = req.query.teamId || null;
      // LIN-2025: fail loud on a well-formed-but-unmatched team id rather
      // than silently widening to the whole workspace — see /api/proxy/issues.
      if (teamId) {
        teamId = requireTeamMembership(await provider.fetchTeams(token), teamId);
      }

      const cycleList = await provider.cycles(token, teamId);
      logEvent(req, '/api/proxy/cycles', 200);
      res.json({ cycles: cycleList });
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        logEvent(req, '/api/proxy/cycles', 404);
        return jsonError(res, 404, `Team not found: ${err.teamId}`, { code: 'TEAM_NOT_FOUND', truncated: err.truncated });
      }
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/cycles', status);
      console.error('Proxy /cycles error:', err.message);
      jsonError(res, status, 'Failed to fetch cycles', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * GET /api/proxy/cycles/:cycleId  (canonical — plural, mirrors the /cycles list)
   * GET /api/proxy/cycle/:cycleId    (forgiving alias, singular)
   * Get cycle detail with issues. Shared :cycleId param across both forms (LIN-528).
   */
  router.get(['/api/proxy/cycles/:cycleId', '/api/proxy/cycle/:cycleId'], proxyLimiter, authenticateProxyToken, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/cycle', reason);
      }
      if (denyIfUnsupported(provider, 'cycleDetail', req, res, '/api/proxy/cycle')) return;

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
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/cycle', status);
      console.error('Proxy /cycle error:', err.message);
      jsonError(res, status, 'Failed to fetch cycle', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/relations', reason);
      }
      if (denyIfUnsupported(provider, 'relations', req, res, '/api/proxy/relations')) return;

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
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/relations', status);
      console.error('Proxy /relations error:', err.message);
      jsonError(res, status, 'Failed to fetch relations', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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
  // Both `md:` and `att:` relay through this SAME host-allowlist — one set, not
  // a parallel reimplementation that could drift. Any URL outside it is a
  // clean, machine-readable rejection; we never silently 500 on the missing
  // capability. Kept in lockstep with discovery's UPLOAD_HOSTS (lib/proxy-
  // wire.js): every host discovery can mint a handle for must be relayable
  // here, or discovery would emit a handle this guard refuses. The GitHub
  // asset hosts are sourced from the SAME exported set so the two allowlists
  // cannot drift (LIN-771). `linear.app` stays relay-only (it is an SSRF
  // allow, not a discovery upload host).
  const ATTACHMENT_ALLOWED_HOSTS = new Set([
    'uploads.linear.app', 'cdn.linear.app', 'linear.app',
    ...GITHUB_UPLOAD_HOSTS,
  ]);
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB — matches /api/image

  // Shared SSRF/allowlist guard (LIN-890) — the SAME logic for both the `md:`
  // and `att:` handle types, so the two paths provably cannot drift into a
  // parallel reimplementation. Returns `{ ok: true, urlObj }` on success or
  // `{ ok: false, reason, message }` on failure; `reason` distinguishes
  // 'host-not-allowed' from the other guard failures so a caller can map it to
  // a distinct error code where that matters (see the `att:` branch below).
  function ssrfGuardUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      return { ok: false, reason: 'not-https', message: 'Invalid attachment URL: must be HTTPS' };
    }
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch {
      return { ok: false, reason: 'bad-format', message: 'Invalid attachment URL format' };
    }
    if (!ATTACHMENT_ALLOWED_HOSTS.has(urlObj.hostname)) {
      return { ok: false, reason: 'host-not-allowed', message: 'Invalid attachment URL: host not allowed' };
    }
    if (urlObj.pathname.includes('..')) {
      return { ok: false, reason: 'path-traversal', message: 'Invalid attachment URL: path traversal not allowed' };
    }
    return { ok: true, urlObj };
  }

  router.get('/api/proxy/attachments/:id', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const endpoint = '/api/proxy/attachments/:id';

    const decoded = decodeAttachmentHandle(req.params.id);
    if (!decoded) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'Invalid attachment handle');
    }

    let fetchUrl, urlObj, nameHint, isGithubAssetHost, token, providerName;

    if (decoded.type === 'att') {
      // `att:` needs an authenticated provider call just to DISCOVER the URL,
      // before any SSRF check can run — unlike `md:`, whose URL is already
      // embedded in the handle. Resolve provider/token first, gate on the
      // capability (422 CAPABILITY_NOT_SUPPORTED for a provider with no
      // formal-attachment node — GitHub Issues included, since it correctly
      // never mints `att:` handles), then look up the attachment.
      const resolved = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (denyIfUnsupported(resolved.provider, 'fetchAttachment', req, res, endpoint)) return;
      if (!resolved.token) {
        return workspaceUnavailable(req, res, endpoint, resolved.reason);
      }
      // Never leave this call outside a catch: Express 4 does not auto-forward
      // an async rejection to error middleware, and this route has no
      // .catch(next) wrapper — an uncaught throw here hangs the request with
      // no response instead of erroring cleanly (LIN-890 close-out). The
      // Linear provider already normalizes its own "Entity not found" case to
      // null (handled by the check below); this catch is the backstop for
      // anything else (auth failure, network error, rate limit, an
      // unnormalized not-found from some other provider).
      let attachment;
      try {
        attachment = await resolved.provider.fetchAttachment(resolved.token, decoded.value);
      } catch (err) {
        const status = graphqlErrorStatus(err, req);
        logEvent(req, endpoint, status);
        console.error('Proxy attachment resolve error:', err.message);
        return jsonError(res, status, 'Failed to resolve attachment', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
      }
      if (!attachment) {
        logEvent(req, endpoint, 404);
        return notFound.json(res, 'Attachment not found');
      }
      const guard = ssrfGuardUrl(attachment.url);
      if (!guard.ok) {
        // Off-allowlist is an EXPECTED, distinct outcome for `att:` — Linear
        // attachments can legitimately point at Figma/Drive/Slack etc, not a
        // caller error — so it gets its own 422, unlike `md:`'s bare 400.
        if (guard.reason === 'host-not-allowed') {
          logEvent(req, endpoint, 422);
          return jsonError(res, 422, 'Attachment host is not in the allowed set', {
            code: 'ATTACHMENT_HOST_NOT_ALLOWED',
          });
        }
        logEvent(req, endpoint, 400);
        return badRequest.json(res, guard.message);
      }
      urlObj = guard.urlObj;
      isGithubAssetHost = GITHUB_UPLOAD_HOSTS.includes(urlObj.hostname);
      token = resolved.token;
      providerName = resolved.provider?.name;
      // The relay's file-type gate needs a filename hint; `att:` handles carry
      // none (unlike `md:`'s `#name=` fragment), so supply the attachment's own
      // title — otherwise every non-image formal attachment would 400 as
      // "unsupported content-type" even after URL resolution succeeds.
      nameHint = attachment.title || null;
      fetchUrl = attachment.url;
    } else {
      // `md:` handle — decoded.value is the source image URL, already embedded
      // in the handle. BYTE-IDENTICAL to before LIN-890: the SSRF guard runs
      // first, and provider/token resolution stays after it — collapsing this
      // into a shared "resolve provider first" flow would change `md:`'s error
      // precedence (an SSRF-invalid URL currently 400s regardless of workspace
      // availability; moving provider resolution earlier would make it 503
      // first when the workspace is also down).
      const imageUrl = decoded.value;
      const guard = ssrfGuardUrl(imageUrl);
      if (!guard.ok) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, guard.message);
      }
      urlObj = guard.urlObj;

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
      isGithubAssetHost = GITHUB_UPLOAD_HOSTS.includes(urlObj.hostname);
      const resolved = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!isGithubAssetHost && !resolved.token) {
        return workspaceUnavailable(req, res, endpoint, resolved.reason);
      }
      token = resolved.token;
      providerName = resolved.provider?.name;

      // Non-image file relay (LIN-750): discovery encodes the filename in a
      // `#name=<filename>` fragment so we can type extension-less upload bytes.
      // The fragment is stripped before egress (it must never reach the asset
      // host); `relayContentTypeFromName` is the sole type-gate and returns null
      // for anything not on the allowlist.
      nameHint = new URLSearchParams(urlObj.hash.replace(/^#/, '')).get('name');
      fetchUrl = imageUrl.split('#')[0];
    }

    const typedFromHint = nameHint ? relayContentTypeFromName(nameHint) : null;
    const isFileRelay = !!typedFromHint && !typedFromHint.startsWith('image/');

    try {
      // Proxy-aware egress: route through the egress proxy when one is
      // configured, exactly like every other Linear call.
      const customFetch = (await createProxyFetch()) || fetch;
      // Auth header by host (LIN-771) AND by provider (LIN-1891) — two
      // INDEPENDENT booleans, checked alongside each other, never collapsed
      // into one condition:
      //   - GitHub asset hosts are public user-content; never send Authorization
      //     regardless of provider, so the workspace token is never leaked
      //     cross-provider (unchanged).
      //   - A Linear-hosted asset gets the bearer token ONLY when the resolved
      //     workspace's own provider is `linear` — deliberately `linear`-only,
      //     never `linear` OR `local`. Every other provider (local, jira,
      //     github, github-projects) sends NO Authorization header when
      //     relaying a Linear-hosted asset: today those workspaces send their
      //     OWN credential to Linear's CDN on every such relay, and stopping
      //     exactly that cross-provider credential egress is why this check
      //     exists. It also sidesteps a `token ? (scope ?? token) : token`
      //     structured scope object (edit 4) ever reaching this template —
      //     `resolveProviderAccess` returns jira/github/github-projects'
      //     {email,apiToken,site}/{token,repo} shape here, which would
      //     otherwise serialize as `Bearer [object Object]`.
      const fetchHeaders = (!isGithubAssetHost && providerName === 'linear')
        ? { Authorization: `Bearer ${token}` }
        : {};
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
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);
      }
      if (denyIfUnsupported(provider, 'createIssue', req, res, '/api/proxy/issues')) return;

      const { teamId, title, description, projectId, stateId, assigneeId, priority, priorityLevel, parentId, cycleId } = req.body;

      // LIN-2239: `priority` (Linear-native) and `priorityLevel` (canonical
      // ascending) both resolve to the SAME provider input field — sending
      // both is refused rather than silently picking one, since silently
      // preferring either would recreate the exact "plausible wrong value,
      // no error" hazard this ticket exists to prevent.
      if (priority !== undefined && priorityLevel !== undefined) {
        logEvent(req, '/api/proxy/issues', 400);
        return badRequest.json(res, 'Provide only one of priority (Linear-native) or priorityLevel (canonical ascending), not both');
      }

      // LIN-2352: teamId is only required when the provider's create contract
      // declares it — sourced from createFields() (LIN-1972's contract; NOT
      // supports()/fetchTeams(), which a teamless-but-writable provider like
      // GitHub/Local can still return non-empty/true for). A teamless
      // provider must never be asked for one. When required, it may be a
      // UUID, a team key (e.g. `LIN`), or a team name (LIN-556); the
      // symbolic→id resolution happens once below so the resolved id can also
      // scope the symbolic stateId.
      const fields = provider.createFields();
      const requiresTeam = fields.includes('teamId');

      if (requiresTeam && (!teamId || typeof teamId !== 'string')) {
        logEvent(req, '/api/proxy/issues', 400);
        return badRequest.json(res, 'Valid teamId is required');
      }

      if (!title || typeof title !== 'string') {
        logEvent(req, '/api/proxy/issues', 400);
        return badRequest.json(res, 'title is required');
      }

      // LIN-1552: length + control-char validation via the shared seam
      // (identical rules/messages/order to the former inline checks).
      const createFieldError = validateIssueWriteFields({ title, description }, { mode: 'create' });
      if (createFieldError) {
        return badRequest.json(res, createFieldError);
      }

      // LIN-2352: a create has no fetched issue to derive a team from, so
      // supply provider.name directly when the contract excludes teamId — a
      // real non-empty string every teamless states() implementation accepts
      // and ignores (mirrors LIN-1972's workspace-api.js reference), keeping
      // resolveStateInput's `if (!teamId) throw 422` guard untripped on
      // either lane.
      const resolvedTeamId = requiresTeam
        ? await resolveTeamInput(provider, token, teamId)
        : provider.name;

      // LIN-1557: `apiWriteFields()` — the provider's headless-door write
      // contract, deliberately separate from `createFields()` (the UI-form
      // descriptor) — governs every OTHER optional field below. A field the
      // caller sent that the provider does not honour is refused with 400
      // instead of being silently forwarded and discarded on a false 201.
      // title stays required unconditionally. teamId is conditionally
      // required per createFields() (LIN-2352, not LIN-1976 — LIN-1976
      // instance 3 is the separate feedback-route lane); its stray-value
      // refusal below is deliberately keyed on the SAME `requiresTeam` signal
      // rather than on apiWriteFields(), since a provider disagreeing between
      // the two lists would otherwise become uncreatable (required by one
      // check, refused by the other).
      const writableFields = provider.apiWriteFields();
      const refuseUnwritable = (field) => {
        logEvent(req, '/api/proxy/issues', 400);
        badRequest.json(res, `${field} is not supported by this provider`);
        return true;
      };

      if (teamId !== undefined && !requiresTeam) return refuseUnwritable('teamId');

      const input = { title };
      if (requiresTeam) input.teamId = resolvedTeamId;
      if (description) input.description = description;
      // LIN-556: projectId / stateId accept symbolic names alongside UUIDs.
      // State is scoped to the just-resolved team so symbolic matches cannot
      // bleed across teams. assigneeId / parentId / cycleId stay UUID-only this
      // ticket (named out of scope in the LIN-556 design record).
      if (projectId) {
        if (!writableFields.includes('projectId')) return refuseUnwritable('projectId');
        input.projectId = await resolveProjectInput(provider, token, projectId);
      }
      if (stateId) {
        if (!writableFields.includes('stateId')) return refuseUnwritable('stateId');
        input.stateId = await resolveStateInput(provider, token, resolvedTeamId, stateId);
      }
      if (assigneeId && UUID_REGEX.test(assigneeId)) {
        if (!writableFields.includes('assigneeId')) return refuseUnwritable('assigneeId');
        input.assigneeId = assigneeId;
      }
      if (parentId && UUID_REGEX.test(parentId)) {
        if (!writableFields.includes('parentId')) return refuseUnwritable('parentId');
        input.parentId = parentId;
      }
      if (cycleId && UUID_REGEX.test(cycleId)) {
        if (!writableFields.includes('cycleId')) return refuseUnwritable('cycleId');
        input.cycleId = cycleId;
      }
      if (priority !== undefined && isValidPriority(priority)) {
        if (!writableFields.includes('priority')) return refuseUnwritable('priority');
        input.priority = priority;
      }
      // LIN-2239: priorityLevel reuses isValidPriority's range check — both
      // scales are integers over the same [0,4] cardinality, just relabeled —
      // then converts to the provider's native scale before it reaches the
      // SAME `input.priority` the block above sets. Gated on the SAME
      // capability (priorityLevel has no independent apiWriteFields entry;
      // it maps onto the provider's existing priority support).
      if (priorityLevel !== undefined && isValidPriority(priorityLevel)) {
        if (!writableFields.includes('priority')) return refuseUnwritable('priorityLevel');
        input.priority = canonicalPriorityToLinear(priorityLevel);
      }

      const issueCreate = normalizeWritePayload(await provider.createIssue(token, input), 'issue');
      if (writeRejected(req, res, '/api/proxy/issues', issueCreate, 'Issue was not created')) return;
      flattenIssue(issueCreate.issue);
      logEvent(req, '/api/proxy/issues', 201);
      res.status(201).json(issueCreate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues', err)) return;
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues', status);
      console.error('Proxy create issue error:', err.message);
      jsonError(res, status, 'Failed to create issue', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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
    // Site 1 (LIN-1559). Returning true also serves the caller's early return.
    if (denyIfMissingRead(activeProvider, 'issueWriteGuard', req, res, endpoint)) return true;
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
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/:id', reason);
      }
      if (denyIfUnsupported(provider, 'updateIssue', req, res, '/api/proxy/issues/:id')) return;

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const { title, description, stateId, assigneeId, priority, priorityLevel, projectId, parentId, cycleId } = req.body;

      // LIN-2239: see the create-route comment — same field, same hazard,
      // same refusal.
      if (priority !== undefined && priorityLevel !== undefined) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'Provide only one of priority (Linear-native) or priorityLevel (canonical ascending), not both');
      }

      // LIN-1552: length + control-char validation via the shared seam
      // (identical rules/messages/order to the former inline checks).
      const updateFieldError = validateIssueWriteFields({ title, description }, { mode: 'update' });
      if (updateFieldError) {
        return badRequest.json(res, updateFieldError);
      }

      // Reject a wholly empty body before any read (preserves the no-network 400
      // for `{}`); the post-resolution check below still catches a body whose
      // only fields are unsupported/dropped.
      const hasUpdatableField = [title, description, stateId, assigneeId, projectId, parentId, cycleId, priority, priorityLevel]
        .some(v => v !== undefined);
      if (!hasUpdatableField) {
        logEvent(req, '/api/proxy/issues/:id', 400);
        return badRequest.json(res, 'No valid fields to update');
      }

      // LIN-556: one guard read serves both the trashed refusal AND the team
      // scope a symbolic stateId needs (e.g. `done` → the team's completed
      // state). Replaces the former post-build refuseIfTrashed call.
      if (denyIfMissingRead(provider, 'issueWriteGuard', req, res, '/api/proxy/issues/:id')) return; // site 2
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
      if (stateId) {
        input.stateId = await resolveStateInput(provider, token, teamId, stateId);
        // LIN-694: report-persistence gate for periodical review tasks. The
        // marker check is free (guard.description was already fetched above
        // for every write); a states() lookup to learn the target's `type`
        // only runs for the rare marked issue, so this adds no cost to the
        // overwhelmingly common (non-periodical) stateId-bearing write.
        const periodicalGateId = extractPeriodicalGateId(guard?.description);
        if (periodicalGateId) {
          let targetStateType = null;
          try {
            const states = await provider.states(token, teamId);
            targetStateType = (states || []).find(s => s.id === input.stateId)?.type || null;
          } catch {
            targetStateType = null; // provider without a states() capability — gate cannot apply
          }
          const gateResult = checkPeriodicalReportGate({
            description: guard?.description,
            comments: guard?.comments?.nodes,
            targetStateType
          });
          if (gateResult.applies && !gateResult.ok) {
            logEvent(req, '/api/proxy/issues/:id', 409);
            return jsonError(res, 409, gateResult.message, { code: gateResult.code });
          }
        }
      }
      if (projectId) input.projectId = await resolveProjectInput(provider, token, projectId);
      if (assigneeId && UUID_REGEX.test(assigneeId)) input.assigneeId = assigneeId;
      if (parentId === null) input.parentId = null;
      else if (parentId && UUID_REGEX.test(parentId)) input.parentId = parentId;
      if (cycleId && UUID_REGEX.test(cycleId)) input.cycleId = cycleId;
      if (priority !== undefined && isValidPriority(priority)) {
        input.priority = priority;
      }
      // LIN-2239: same conversion + capability parity as the create route
      // (update's existing convention is to silently drop an unsupported
      // field rather than 400, so no explicit gate here — an unsupported
      // provider's `updateIssue` already ignores `input.priority`).
      if (priorityLevel !== undefined && isValidPriority(priorityLevel)) {
        input.priority = canonicalPriorityToLinear(priorityLevel);
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
      if (partialWriteFailed(req, res, '/api/proxy/issues/:id', err)) return;
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/:id', status);
      console.error('Proxy update issue error:', err.message);
      jsonError(res, status, 'Failed to update issue', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * Shared read-modify-write for the description edit endpoints. Reads the live
   * body, lets `merge(current)` produce the new body, validates it, and writes.
   * The agent never re-emits the original, so the LIN-398 corruption class cannot
   * recur. `merge` may throw DescriptionEditError for a loud 422.
   */
  async function applyDescriptionEdit(req, res, endpoint, merge) {
    const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
    if (!token) {
      return workspaceUnavailable(req, res, endpoint, reason);
    }
    if (denyIfUnsupported(provider, 'updateIssue', req, res, endpoint)) return;

    const { issueId } = req.params;
    if (!isValidIssueId(issueId)) {
      logEvent(req, endpoint, 400);
      return badRequest.json(res, 'Invalid issue ID format');
    }

    if (denyIfMissingRead(provider, 'issueDescription', req, res, endpoint)) return; // site 3

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
      const status = graphqlErrorStatus(err, req);
      logEvent(req, endpoint, status);
      console.error('Proxy description edit (read) error:', err.message);
      return jsonError(res, status, 'Failed to read issue description', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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
      // A provider that REFUSES the write (Jira's D1 unrenderable-content guard,
      // LIN-1886) throws RefResolutionError with its own status. Map it the same
      // way PATCH /issues/:id does, so a permanent, caller-visible refusal reads
      // as a 422 with its reason — not a 500 telling an agent to back off and
      // retry something that can never succeed.
      if (refResolutionFailed(req, res, endpoint, err)) return;
      // LIN-2012: this is a description-only write (no stateId), so the only
      // partial-write shape reachable here is the confirmation re-read failing
      // after the field PUT already landed — still must not read as a total
      // failure.
      if (partialWriteFailed(req, res, endpoint, err)) return;
      const status = graphqlErrorStatus(err, req);
      logEvent(req, endpoint, status);
      console.error('Proxy description edit (write) error:', err.message);
      jsonError(res, status, 'Failed to update description', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/comments', reason);
      }
      if (denyIfUnsupported(provider, 'createComment', req, res, '/api/proxy/issues/comments')) return;

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }

      const { body } = req.body;
      // LIN-2154: presence/type/dangerous-chars via the shared validator FIRST,
      // then the retained length check — a named, cosmetic exception for a
      // doubly-invalid (over-length AND dangerous-chars) body, which now
      // reports the dangerous-chars message instead of the length one.
      const bodyValidation = validateCommentBody(body, { required: true });
      if (!bodyValidation.valid) {
        if (bodyValidation.error === 'body is required') {
          logEvent(req, '/api/proxy/issues/comments', 400);
        }
        return badRequest.json(res, bodyValidation.error);
      }

      if (body.length > MAX_COMMENT_LENGTH) {
        return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`);
      }

      if (await refuseIfTrashed(provider, token, issueId, req, res, '/api/proxy/issues/comments')) return;

      // Deterministic dedupe (LIN-399): if an identical comment was just
      // created for this issue, return that one instead of minting a duplicate.
      // The generation tag (LIN-1160/LIN-2005) folds in so a delete/edit
      // anywhere in this workspace invalidates every prior dedupe entry in it
      // (see commentDedupeGenerations above).
      //
      // LIN-2154: this stays a 4-argument call. Padding it to 5 (to match the
      // human lane's salted call in routes/workspace-api.js) would change ITS
      // OWN digest stream shape relative to every entry it has ever produced,
      // silently invalidating this lane's live dedupe window — a same-lane
      // regression, not a cross-lane collision risk (dedupeKey's length-prefix
      // scheme is the whole collision guarantee between distinct streams).
      const key = dedupeKey(req.proxyUrlKey, issueId, body, commentDedupeGenerations.current(req.proxyUrlKey));
      const prior = commentDedupe.get(key);
      if (prior) {
        // LIN-2109: skipWitness — this 200 is served from the dedupe cache,
        // never from `provider.createComment` below, so it is not evidence
        // the provider accepted anything on THIS request.
        logEvent(req, '/api/proxy/issues/comments', 200, null, { skipWitness: true });
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
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/comments', status);
      console.error('Proxy create comment error:', err.message);
      jsonError(res, status, 'Failed to create comment', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * DELETE /api/proxy/issues/:issueId/comments/:commentId
   * Remove a comment. The commentId is the comment's own id, exposed on the
   * nodes returned by GET /issues/:id.
   *
   * Note: :issueId is accepted for a consistent URL shape with the other
   * /issue/:issueId/... endpoints, but the delete is keyed solely on
   * commentId (mirrors DELETE .../relations/:relationId exactly). No trashed
   * guard: removing a stray/bad comment from a trashed issue is exactly the
   * use case this endpoint exists for.
   */
  router.delete('/api/proxy/issues/:issueId/comments/:commentId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/comments', reason);
      }
      if (denyIfUnsupported(provider, 'deleteComment', req, res, '/api/proxy/issues/comments')) return;

      const { issueId, commentId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }
      if (!UUID_REGEX.test(commentId)) {
        logEvent(req, '/api/proxy/issues/comments', 400);
        return badRequest.json(res, 'Invalid comment ID format');
      }

      const commentDelete = await provider.deleteComment(token, commentId);
      if (writeRejected(req, res, '/api/proxy/issues/comments', commentDelete, 'Comment was not deleted')) return;
      commentDedupeGenerations.bump(req.proxyUrlKey);
      logEvent(req, '/api/proxy/issues/comments', 200);
      res.json(commentDelete);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/comments', status);
      console.error('Proxy delete comment error:', err.message);
      jsonError(res, status, 'Failed to delete comment', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * PATCH /api/proxy/issues/:issueId/comments/:commentId
   * Edit a comment's body. Same URL-shape note and no-trashed-guard rationale
   * as DELETE above — an edit is a correction to existing content, not new
   * content added to a dead issue.
   */
  router.patch('/api/proxy/issues/:issueId/comments/:commentId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/comments', reason);
      }
      if (denyIfUnsupported(provider, 'updateComment', req, res, '/api/proxy/issues/comments')) return;

      const { issueId, commentId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }
      if (!UUID_REGEX.test(commentId)) {
        logEvent(req, '/api/proxy/issues/comments', 400);
        return badRequest.json(res, 'Invalid comment ID format');
      }

      const { body } = req.body;
      // LIN-2154: same validator-first, length-second order as the create route
      // above (and the same named doubly-invalid-body exception).
      const bodyValidation = validateCommentBody(body, { required: true });
      if (!bodyValidation.valid) {
        if (bodyValidation.error === 'body is required') {
          logEvent(req, '/api/proxy/issues/comments', 400);
        }
        return badRequest.json(res, bodyValidation.error);
      }
      if (body.length > MAX_COMMENT_LENGTH) {
        return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`);
      }

      const commentUpdate = normalizeWritePayload(await provider.updateComment(token, commentId, body), 'comment');
      if (writeRejected(req, res, '/api/proxy/issues/comments', commentUpdate, 'Comment was not updated')) return;
      commentDedupeGenerations.bump(req.proxyUrlKey);
      logEvent(req, '/api/proxy/issues/comments', 200);
      res.status(200).json(commentUpdate);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/comments', status);
      console.error('Proxy update comment error:', err.message);
      jsonError(res, status, 'Failed to update comment', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  // Body-size exception, scoped to THIS route only (mirrors the feedback
  // route's own parser, routes/workspace-api.js): the global
  // `express.json({ limit: '250kb' })` (server.js) only matches
  // `application/json`, so a caller sending the base64 image payload with a
  // non-JSON content type (e.g. `text/plain`) passes through it unparsed; this
  // permissive parser (raised limit) then parses it. A small `application/json`
  // body is already parsed by the global parser by the time it gets here —
  // body-parser no-ops on an already-parsed body — so it keeps the 250kb
  // ceiling and this exception cannot leak to other routes.
  const ATTACHMENT_UPLOAD_BODY_LIMIT = '14mb'; // ~4/3 base64 expansion of MAX_ATTACHMENT_BYTES + JSON overhead
  const attachmentUploadBodyParser = json({ type: () => true, limit: ATTACHMENT_UPLOAD_BODY_LIMIT });
  // Stand-in for the `![](assetUrl)` markdown before the real assetUrl exists
  // (it's only returned by uploadFile itself): comfortably covers "![]()" (4
  // chars) plus a real Linear asset URL, so the pre-upload estimate below never
  // passes a body that the real embed would then push over the limit.
  const ATTACHMENT_EMBED_RESERVE = 200;

  /**
   * POST /api/proxy/issues/:issueId/attachments (LIN-891)
   * Agent-facing upload: attach a base64 raster image to an issue, either as a
   * new comment (default "comment" target) or appended to the description
   * ("description" target). The uploaded asset is embedded as markdown
   * `![](assetUrl)`, so it is immediately readable through the EXISTING `md:`
   * read path (lib/proxy-wire.js) — no new read-side plumbing.
   *
   * Deliberately NOT the human feedback widget's `/api/image` route (session-
   * authed, human-only) — this is a separate Bearer-token route that reuses
   * its underlying primitives end-to-end: `provider.uploadFile()` (LIN-636)
   * and the raster magic-byte sniffing guard (LIN-682, `parseFeedbackImage` /
   * `sniffRasterType`, now shared via lib/attachment-upload.js). No formal
   * `attachmentCreate` mutation exists in this codebase (per LIN-871's
   * research) — this route does not assume one.
   */
  router.post('/api/proxy/issues/:issueId/attachments', proxyLimiter, authenticateProxyToken, requireWriteScope, attachmentUploadBodyParser, async (req, res) => {
    const endpoint = '/api/proxy/issues/:id/attachments';
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, endpoint, reason);
      }
      if (denyIfUnsupported(provider, 'uploadFile', req, res, endpoint)) return;

      const { image, target, body } = req.body || {};
      if (target !== undefined && target !== 'comment' && target !== 'description') {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'target must be "comment" or "description"');
      }
      const resolvedTarget = target || 'comment';
      const writeCapability = resolvedTarget === 'description' ? 'updateIssue' : 'createComment';
      if (denyIfUnsupported(provider, writeCapability, req, res, endpoint)) return;

      const { issueId } = req.params;
      if (!isValidIssueId(issueId)) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'Invalid issue ID format');
      }

      // LIN-2154: shared validator (optional body — the relay's caption is
      // never required). Its native order (type-check then dangerous-chars,
      // both before the length/budget math below) is unchanged by the move.
      const bodyValidation = validateCommentBody(body, { required: false });
      if (!bodyValidation.valid) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, bodyValidation.error);
      }

      if (!image) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'image is required');
      }
      const parsed = parseFeedbackImage(image);
      if (!parsed) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, 'image must be a base64 data URL or { data, contentType?, filename? } decoding to a PNG/JPEG/GIF/WEBP');
      }
      if (parsed.bytes.length > MAX_ATTACHMENT_BYTES) {
        logEvent(req, endpoint, 413);
        return jsonError(res, 413, 'image too large');
      }

      if (await refuseIfTrashed(provider, token, issueId, req, res, endpoint)) return;

      // Pre-validate the projected final length BEFORE uploadFile() runs, using
      // ATTACHMENT_EMBED_RESERVE in place of the not-yet-known assetUrl. This
      // turns an oversized `body` into a 400 with no side effect, instead of
      // the upload running unconditionally and only then discovering (via the
      // post-write check below / inside applyDescriptionEdit) that nothing
      // could reference it — an orphaned, wasted Linear asset per call.
      const bodyBudget = body ? body.length + 2 : 0; // "\n\n" separator before the embed
      if (resolvedTarget === 'description') {
        if (denyIfMissingRead(provider, 'issueDescription', req, res, endpoint)) return; // site 4
        const issue = await provider.issueDescription(token, issueId);
        if (!issue) {
          logEvent(req, endpoint, 404);
          return notFound.json(res, 'Issue not found');
        }
        const currentLength = (issue.description || '').length;
        const separator = currentLength > 0 ? 2 : 0;
        if (currentLength + separator + bodyBudget + ATTACHMENT_EMBED_RESERVE > MAX_DESCRIPTION_LENGTH) {
          logEvent(req, endpoint, 400);
          return badRequest.json(res, 'resulting description exceeds maximum length');
        }
      } else if (bodyBudget + ATTACHMENT_EMBED_RESERVE > MAX_COMMENT_LENGTH) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`);
      }

      const assetUrl = await provider.uploadFile(token, parsed.bytes, {
        contentType: parsed.contentType,
        filename: parsed.filename,
      });
      const markdown = `![](${assetUrl})`;
      const embedded = body ? `${body}\n\n${markdown}` : markdown;

      if (resolvedTarget === 'description') {
        return applyDescriptionEdit(req, res, endpoint, (current) => appendBlock(current, embedded));
      }

      if (embedded.length > MAX_COMMENT_LENGTH) {
        logEvent(req, endpoint, 400);
        return badRequest.json(res, `body exceeds maximum length of ${MAX_COMMENT_LENGTH}`);
      }
      const commentCreate = normalizeWritePayload(await provider.createComment(token, issueId, embedded), 'comment');
      if (writeRejected(req, res, endpoint, commentCreate, 'Comment was not created')) return;
      logEvent(req, endpoint, 201);
      res.status(201).json(commentCreate);
    } catch (err) {
      const status = graphqlErrorStatus(err, req);
      logEvent(req, endpoint, status);
      console.error('Proxy attachment upload error:', err.message);
      jsonError(res, status, 'Failed to upload attachment', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
    }
  });

  /**
   * POST /api/proxy/issues/:issueId/relations
   * Create a relation between issues.
   */
  router.post('/api/proxy/issues/:issueId/relations', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    try {
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/relations', reason);
      }
      if (denyIfUnsupported(provider, 'createRelation', req, res, '/api/proxy/issues/relations')) return;

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
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/relations', status);
      console.error('Proxy create relation error:', err.message);
      jsonError(res, status, 'Failed to create relation', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/relations', reason);
      }
      if (denyIfUnsupported(provider, 'deleteRelation', req, res, '/api/proxy/issues/relations')) return;

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
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/relations', status);
      console.error('Proxy delete relation error:', err.message);
      jsonError(res, status, 'Failed to delete relation', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/labels', reason);
      }
      if (denyIfUnsupported(provider, 'addLabel', req, res, '/api/proxy/issues/labels')) return;

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
      if (denyIfMissingRead(provider, 'issueLabels', req, res, '/api/proxy/issues/labels')) return; // site 5
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

      if (denyIfMissingRead(provider, 'updateIssueLabels', req, res, '/api/proxy/issues/labels')) return; // site 6
      const issueUpdate = await provider.updateIssueLabels(token, issueId, [...currentLabelIds, resolvedLabelId]);
      if (writeRejected(req, res, '/api/proxy/issues/labels', issueUpdate, 'Label was not added')) return;
      flattenIssue(issueUpdate.issue);
      logEvent(req, '/api/proxy/issues/labels', 200);
      res.json(issueUpdate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues/labels', err)) return;
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/labels', status);
      console.error('Proxy add label error:', err.message);
      jsonError(res, status, 'Failed to add label', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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
      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      if (!token) {
        return workspaceUnavailable(req, res, '/api/proxy/issues/labels', reason);
      }
      if (denyIfUnsupported(provider, 'removeLabel', req, res, '/api/proxy/issues/labels')) return;

      const { issueId, labelId } = req.params;
      if (!isValidIssueId(issueId)) {
        return badRequest.json(res, 'Invalid issue ID format');
      }

      // LIN-556: labelId may be a UUID or a label name (case-insensitive).
      const resolvedLabelId = await resolveLabelInput(provider, token, labelId);

      // Fetch current labels (the read half of the label read-modify-write).
      if (denyIfMissingRead(provider, 'issueLabels', req, res, '/api/proxy/issues/labels')) return; // site 7
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

      if (denyIfMissingRead(provider, 'updateIssueLabels', req, res, '/api/proxy/issues/labels')) return; // site 8
      const issueUpdate = await provider.updateIssueLabels(token, issueId, filtered);
      if (writeRejected(req, res, '/api/proxy/issues/labels', issueUpdate, 'Label was not removed')) return;
      flattenIssue(issueUpdate.issue);
      logEvent(req, '/api/proxy/issues/labels', 200);
      res.json(issueUpdate);
    } catch (err) {
      if (refResolutionFailed(req, res, '/api/proxy/issues/labels', err)) return;
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/issues/labels', status);
      console.error('Proxy remove label error:', err.message);
      jsonError(res, status, 'Failed to remove label', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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

  // Charge one free-tier unit for a proxy LLM request about to generate. Returns
  // null when the request may proceed, or a { status, body } rejection carrying
  // the standard 429 envelope when the limit is hit. Caller sends it via res or
  // keepalive.send depending on whether the H12 keepalive is already armed.
  //
  // This is the once-per-request metered choke point (LIN-961): it is only
  // reached when resolveProxyLLM already selected free tier, i.e. neither the
  // token-creator's OAuth key nor a usable paid `OPENROUTER_API_KEY` resolved.
  // That silent fallback is the bug the operator could not diagnose, so make it
  // observable HERE (not inside resolveProxyLLM, which runs per descent hop and
  // would over-log): emit a console.warn + an audited proxy event on EVERY
  // free-tier metered call — the successful charges too, not only the eventual
  // 429 — and, when the limit IS hit, name the real cause in the 429 body via
  // `reason: 'no_paid_key_resolved'` so the message stops pointing only at the
  // quota. Charging/quota behavior itself is unchanged; the additions are purely
  // additive breadcrumbs.
  async function chargeFreeTierOrReject(req, endpoint) {
    console.warn(
      `[LIN-961] Proxy ${endpoint} running on FREE TIER — no paid/OAuth key resolved ` +
      `(workspace ${req.proxyUrlKey}). Set OPENROUTER_API_KEY (non-empty) or connect ` +
      `OpenRouter to use a paid key.`
    );
    logEvent(req, endpoint, 200, 'free-tier fallback: no paid/OAuth key resolved');

    const check = await freeTierStore.tryUse(req.proxyUrlKey);
    if (check.allowed) return null;
    return {
      status: 429,
      body: {
        error: check.reason,
        reason: 'no_paid_key_resolved',
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
  async function computeRecommendation({ urlKey, createdBy, identifier, accessToken, provider, isTestMode, sessionApiKey, deadline, noDescend = false }) {
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
    const context = await fetchWithTimeout((signal) => provider.fetchRecommendationContext(accessToken, identifier, { signal, noDescend }), CONTEXT_FETCH_TIMEOUT_MS);
    const { issue, parent, siblings, project, children, comments, focusedChild, attachments } = context;

    // Resolve the effective key (free-tier when no session/env key) so both
    // recommend surfaces send a valid key. Metering is NOT done here — this runs
    // once per descent hop, so charging here would bill an N-hop descent N units.
    // Resolved BEFORE the model so the free-tier clamp (LIN-513) can force the
    // default model — a free-tier descent must never bill a workspace-preferred model.
    const { apiKey: resolvedApiKey, isFreeTier } = resolveProxyLLM(sessionApiKey);
    const selectedModel = await resolveAiOperationModel({ urlKey, workspacePreferencesStore, opKind: 'recommend', forceDefault: isFreeTier });
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
            providerUi: provider?.ui || null,
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
  function recommendErrorResponse(err, req) {
    if (err.message?.includes('not found')) {
      return { status: 404, body: { error: 'Issue not found' } };
    }
    if (err.message?.includes('OpenRouter')) {
      return { status: 503, body: { error: 'AI service temporarily unavailable', detail: err.message } };
    }
    console.error('Proxy /recommend error:', err.message);
    const status = graphqlErrorStatus(err, req);
    return { status, body: { error: 'Failed to get recommendation', detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) } };
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

  // Group G agent-status (LIN-679 Stage 1 / LIN-2533): extracted to
  // routes/proxy-agent-status.js, mounted at its original position.
  router.use(createAgentStatusRoutes({ agentStatusStore, proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent }));

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

    const kickoff = buildAutopilotKickoff({ baseUrl, goal, mode, variant, standalone: true });
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
   * Body (all optional): { goal?, mode?, variant?, issueIdentifier?, target?, repo?, appendProxyContext?, sessionId?, subscription? }
   *   - issueIdentifier present → SCOPED run ("autopilot until THIS task is
   *     done"): the issue's title is resolved for the goal line and its project
   *     `repo=` is inherited (an explicit caller `repo` wins, mirroring /prompt).
   *   - issueIdentifier absent  → GENERAL run; `goal` focuses the stack walk.
   *   - mode: 'write' (default) | 'readonly'.
   *   - variant: 'standard' (default) | 'stepper' (warm beat-stepping disposition,
   *     LIN-791); orthogonal to mode.
   *   - sessionId + subscription (LIN-813): the coordinator up-chain edge, a GUIDE
   *     capability available to any autopilot contextually (NOT a launch-time
   *     variant — see the operating manual's "Dispatching a child autopilot"). An
   *     autopilot acting as a coordinator that dispatches a CHILD autopilot for a
   *     whole task passes its OWN session id as `sessionId` (the wake target) with
   *     `subscription: 'everything'`, so the child's reports wake the coordinator. A
   *     top-level kickoff omits both (undeclared → 'terminal-only').
   * Dispatches with kind:'autopilot', so addItem appends the session-id self-ref
   * block and the returned id is the session id (LIN-591/LIN-599).
   */
  router.post('/api/proxy/autopilot/kickoff', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/autopilot/kickoff', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    try {
      const { goal, mode, variant, issueIdentifier, target, repo, appendProxyContext, sessionId, subscription, model, harness, presetId, maxTasks } = req.body || {};

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
      const kickoffGoalValidationError = validateOpaqueDispatchField(goal, 'goal', {
        maxLength: MAX_NAME_LENGTH,
        reportReceivedLength: true,
      });
      if (kickoffGoalValidationError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffGoalValidationError.error);
      }
      if (target !== undefined && !VALID_PROXY_DISPATCH_TARGETS.includes(target)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, `target must be one of: ${VALID_PROXY_DISPATCH_TARGETS.join(', ')}`);
      }
      const kickoffRepoValidationError = validateOpaqueDispatchField(repo, 'repo', {
        maxLength: MAX_NAME_LENGTH,
        reportReceivedLength: true,
      });
      if (kickoffRepoValidationError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffRepoValidationError.error);
      }
      if (issueIdentifier !== undefined && !isValidIssueId(issueIdentifier)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, 'Invalid identifier format');
      }
      // Coordinator up-chain wiring (LIN-813): an autopilot acting as a coordinator
      // dispatches a task-altitude CHILD autopilot for a whole task, stamping its
      // OWN session id as `sessionId` (the up-chain wake target) and declaring
      // `subscription: 'everything'` so the child's PENDING/terminal reports wake it.
      // Both are stored + forwarded blindly onto the dispatched item (same contract
      // as POST /dispatch); validate shape only. This is a guide capability, not a
      // variant — any autopilot can use it contextually.
      // Opaque string, not a UUID (LIN-1118) — shared rule, same as POST /dispatch.
      const kickoffSessionIdError = validateSessionId(sessionId);
      if (kickoffSessionIdError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffSessionIdError.error);
      }
      if (subscription !== undefined && !isValidSubscription(subscription)) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, `subscription must be one of: ${SUBSCRIPTION_LEVELS.join(', ')}`);
      }
      // Execution model + harness (LIN-438, LIN-1084): opaque strings, validated
      // via the shared helper (type/length/dangerous-chars only — NOT checked
      // against a model registry). Mirrors POST /dispatch + recommend-and-dispatch.
      const kickoffModelValidationError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
      if (kickoffModelValidationError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffModelValidationError.error);
      }
      const kickoffHarnessValidationError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
      if (kickoffHarnessValidationError) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 400);
        return badRequest.json(res, kickoffHarnessValidationError.error);
      }
      // Selected dispatch preset (LIN-1390): an unknown/invalid id is rejected
      // here, up front — the factory treats a presetId it can't resolve as "no
      // preset" (a defensive fallback for this seam's own store lookup below),
      // not a validation gate, so this is the one place that contract is enforced.
      if (presetId !== undefined && presetId !== null) {
        if (typeof presetId !== 'string' || !presetId.trim()) {
          logEvent(req, '/api/proxy/autopilot/kickoff', 400);
          return badRequest.json(res, 'presetId must be a non-empty string');
        }
        if (dispatchPresetsStore) {
          const preset = await dispatchPresetsStore.get(req.proxyUrlKey, presetId);
          if (!preset) {
            logEvent(req, '/api/proxy/autopilot/kickoff', 400);
            return badRequest.json(res, 'Invalid or unknown presetId');
          }
        }
      }
      // Task budget (LIN-1751): a SCOPE bound on the run — up to this many
      // distinct tasks — enforced deterministically at the dispatch-factory seam
      // (never a cost control; see the kickoff prose). Optional; validated here,
      // up front, following the presetId precedent just above. Absent/null ⇒ no
      // budget, byte-identical to today.
      if (maxTasks !== undefined && maxTasks !== null) {
        if (!Number.isInteger(maxTasks) || maxTasks < 1) {
          logEvent(req, '/api/proxy/autopilot/kickoff', 400);
          return badRequest.json(res, 'maxTasks must be an integer >= 1');
        }
      }

      // Subscription is DECLARED on the edge (LIN-900 §6), never reconstructed from
      // incidental fields: an undeclared edge is `terminal-only`, full stop. (This
      // deliberately removes the old `!!sessionId` derivation — §6 forbids inferring
      // subscription from "has a sessionId". A coordinator that wants every beat
      // declares `subscription: 'everything'` explicitly; the autopilot prompts are
      // the sole declarers.)
      const subscriptionResolved = subscription ?? DEFAULT_SUBSCRIPTION;

      const baseUrl = `${req.protocol}://${req.get('host')}`;

      // SCOPED run: resolve the named issue so the goal line can name it and we
      // can inherit the project repo (mirrors /prompt + recommend-and-dispatch).
      let issue = null;
      let resolvedRepo = repo || null;
      if (issueIdentifier) {
        const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
        // LIN-1980: stamp before any other logic (incl. the !accessToken early
        // return below) so the fingerprint is present even when this request
        // later 401s from a shared credential another site marked suspect.
        if (!accessToken) {
          return workspaceUnavailable(req, res, '/api/proxy/autopilot/kickoff', reason);
        }
        if (denyIfUnsupported(provider, 'fetchIssueContext', req, res, '/api/proxy/autopilot/kickoff')) return;
        const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
        let ctx;
        try {
          ctx = await resolvePromptIssueContext(provider, accessToken, issueIdentifier, isTestMode);
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
        variant: resolvedVariant,
        maxTasks: maxTasks ?? null
      });

      // Create the dispatch item through the shared factory (LIN-1139): it
      // resolves model/harness from workspace dispatchDefaults (LIN-1138 —
      // `autopilot` is a meta-kind ∉ PROMPT_TEMPLATES, so only the workspace-wide
      // default applies), interposes the default harness (LIN-1159), and calls
      // addItem. The proxy-context append is the default ("+proxy block" the
      // kickoff guide refers to); it runs inside finalizePrompt AFTER the harness
      // is resolved so it can gate its MCP-token-vs-prose branch on it (LIN-1155),
      // and hands back the bootstrapToken to carry as a structured field. Opt out
      // with appendProxyContext:false.
      const item = await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: req.proxyUrlKey,
        workspacePreferencesStore,
        dispatchPresetsStore,
        presetId: presetId || null,
        kind: 'autopilot',
        model,
        harness,
        finalizePrompt: async (resolvedHarness) => {
          if (appendProxyContext !== false) {
            // LIN-376: embed a fresh single-use bootstrap, never the caller's own
            // authenticating token. Skips the block if minting fails (graceful).
            // LIN-1155: for the claude-code harness the token is stripped from the
            // prose and returned as `bootstrapToken` to carry on the item instead.
            return attachProxyContext({
              proxyTokenStore,
              urlKey: req.proxyUrlKey,
              baseUrl,
              issueIdentifier: issueIdentifier || null,
              prompt: kickoff,
              label: 'kickoff-bootstrap',
              harness: resolvedHarness,
              createdBy: req.proxyCreatedBy || null,
              // LIN-2354: only resolved when this was a SCOPED kickoff (the
              // `if (issueIdentifier)` block above called resolveProviderAccess,
              // stamping req.resolvedProvider); a goal-only kickoff resolves no
              // provider and correctly stays neutral rather than triggering a
              // fresh resolve just to fill this sentence.
              providerDisplayName: declaredProviderDisplayName(req)
            });
          }
          return { prompt: kickoff, bootstrapToken: null };
        },
        fields: {
          promptName: issue ? `Autopilot (${issue.identifier})` : 'Autopilot (stack walk)',
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
          waitForFollowUps: true,
          // Coordinator up-chain edge (LIN-813): when this kickoff is a CHILD
          // autopilot dispatched by a coordinator, `sessionId` targets the coordinator
          // and a declared `subscription: 'everything'` routes the child's reports back
          // up to it. A top-level kickoff passes neither, so subscription defaults to
          // 'terminal-only' and the standard single-head behavior is unchanged. Stored
          // + forwarded blindly; note `sessionId` here is the PARENT edge — the child's
          // own `_id` is what addItem stamps into its prompt for its own sub-workers,
          // so the two ids stay distinct by construction.
          sessionId: sessionId || null,
          subscription: subscriptionResolved,
          // Scope bound (LIN-1751): stored on the run row so the dispatch-factory
          // seam can enforce it on every later worker dispatch under this run's
          // own id. null ⇒ unbounded, byte-identical to today.
          maxTasks: maxTasks ?? null
        }
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
        dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt,
        maxTasks: item.maxTasks
      });
    } catch (err) {
      // An issue-scoped kickoff (kind 'autopilot') can duplicate like any other
      // fresh dispatch — LIN-1656. A stack-walk kickoff carries no issueIdentifier
      // and can never be refused. Ahead of the generic 500: a 500 here is worse
      // than no guard, since a caller cannot tell it from a real fault.
      if (refuseIfDuplicateDispatch(err, req, res, '/api/proxy/autopilot/kickoff')) return;
      // Task budget reached (LIN-1751) — a kickoff itself is never budget-refused
      // (this route's own dispatch is the run's OWNER row, not a worker dispatch
      // under a budgeted sessionId), but a child-autopilot kickoff dispatched
      // with `sessionId` set to a coordinator's budgeted run can be.
      if (refuseIfBudgetExhausted(err, req, res, '/api/proxy/autopilot/kickoff')) return;
      // Fail closed (LIN-1175): a claude-code dispatch whose out-of-band bootstrap
      // token could not be minted must be REFUSED, never launched credential-less.
      // attachProxyContext flags this as proxyAttachFailed (same convention as the
      // dispatch.js route) — surface it as a transient 503, not a generic 500.
      if (err && err.proxyAttachFailed) {
        logEvent(req, '/api/proxy/autopilot/kickoff', 503);
        return jsonError(res, 503, PROXY_ATTACH_FAILED_MESSAGE);
      }
      // LIN-2216: an upstream provider-auth failure (Linear 401/403) —
      // resolvePromptIssueContext's own try/catch above only catches a
      // "not found" message and rethrows everything else, so this is where
      // it lands. Ahead of the generic 500, same reasoning as the three
      // guards above: a bare 500 cannot be told apart from a real fault, and
      // the caller (often an autopilot at its own dispatch seam) needs to
      // know whether to retry or escalate. `graphqlErrorStatus` carries the
      // SAME transient-vs-terminal classification the data routes now use
      // (LIN-2216: 503 when this router's own bookkeeping believed the
      // credential was still live when Linear rejected it; 401 otherwise) —
      // reused here rather than re-derived, so the two surfaces can never
      // disagree about the same rejection. `classifyUpstreamError` supplies
      // the machine-matchable `code`/`category` — the existing LINEAR_AUTH
      // vocabulary render-pages.js's human-facing error page already uses
      // for this exact upstream shape, not a new taxonomy.
      const authStatus = graphqlErrorStatus(err, req);
      if (authStatus === 401 || authStatus === 503) {
        // LIN-2363: attribute the failure to the backend actually called. This
        // branch built its envelope inline rather than through
        // `graphqlErrorDetail`, so it forwarded `classifyUpstreamError`'s
        // Linear-hardcoded `detail` verbatim — the one `detail` field in this
        // file LIN-2351 did not reach.
        //
        // `req.resolvedProvider.displayName` (NOT `.declared`) is the right read
        // here, and the distinction is deliberate: this is ERROR ATTRIBUTION, not
        // identity assertion. The question is "which backend did we just call and
        // get rejected by", so the post-fallback name is correct — the same read
        // `graphqlErrorDetail` uses, reused rather than re-derived so the two can
        // never disagree about one rejection. (LIN-2354's `.declared` gate is for
        // prose that CLAIMS what a workspace is backed by; that is a different
        // question.) Nothing stamped ⇒ null ⇒ provider-neutral wording, never a
        // guessed "Linear".
        //
        // WHY NOW, given this is latent: `graphqlErrorStatus` above reads only
        // `err.response.status`, while all three non-Linear clients set
        // `err.status` — so a real GitHub/Jira 401 currently maps to 500 and never
        // reaches here (re-verified at HEAD). The moment anyone normalises that
        // shape — the obvious fix, tracked separately — this branch would start
        // telling GitHub and Jira operators that *Linear* rejected their
        // credentials, in the exact field LIN-2351 just cleaned. Fixing the trap
        // before it arms is the whole point.
        //
        // `code`/`category`/`retryable` are untouched: the `LINEAR_*` codes are a
        // published, machine-matchable contract and renaming them is a breaking
        // change needing a deprecation path — LIN-2351's boundary, held here.
        const classification = classifyUpstreamError(err, req.resolvedProvider?.displayName ?? null);
        logEvent(req, '/api/proxy/autopilot/kickoff', authStatus);
        console.error('Proxy autopilot kickoff error:', err.message);
        return jsonError(res, authStatus, 'Failed to dispatch autopilot kickoff', {
          code: classification.code,
          category: classification.category,
          retryable: authStatus === 503,
          detail: classification.detail,
        });
      }
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

  /**
   * GET /api/proxy/passage-runner/prompt
   * Returns the Passage Runner kickoff prompt (docs/passage-runner-prompt.md,
   * preamble stripped) as plain text — for re-reading a part mid-run.
   */
  router.get('/api/proxy/passage-runner/prompt', proxyLimiter, authenticateProxyToken, async (req, res) => {
    logEvent(req, '/api/proxy/passage-runner/prompt', 200);
    res.type('text/plain').send(buildPassageRunnerKickoff());
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
      const { prompt, promptName, kind, issueId, issueIdentifier, issueTitle, issueUrl, target, repo, model, harness, terminal, followUpTo, force, abort, abortTo, cascade, sessionId, periodicalId, waitForFollowUps, queueIfBusy, subscription } = req.body || {};

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
      // Cascade close (LIN-946): a boolean modifier on an abort. When true the
      // abort's `abortTo` names the ROOT session of a subtree; Harbour expands the
      // one call into an abort per discovered descendant session (the recursive
      // sessionId-tree walk lands in a later beat). Like abortTo it is only
      // meaningful alongside abort — reject cascade:true without it rather than
      // storing an inert flag (mirroring the abortTo-requires-abort guard above).
      // Stored + forwarded blindly for now; the walk consumes it, not the runner.
      // This is the proxy-token twin the autopilot actually hits.
      if (cascade !== undefined && typeof cascade !== 'boolean') {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'cascade must be a boolean');
      }
      if (cascade === true && !isAbort) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'cascade requires abort to be true');
      }
      // Validate kind if provided; when omitted it is derived from promptName below.
      if (kind !== undefined && !isValidDispatchKind(kind)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `kind must be one of: ${DISPATCH_KINDS.join(', ')}`);
      }
      // Periodical-template join key (LIN-1825): registry-membership check, not
      // format validation, so it stays route-local rather than routing through
      // validateDispatchPayload (deliberately format-only, never against a
      // model registry). This is the entry point that makes "works from any
      // entry point, including a bare-token agent POST" true — the id must be
      // validated here too, not just at the session route.
      if (periodicalId !== undefined && !getPeriodicals().map(p => p.id).includes(periodicalId)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, 'periodicalId must be one of the known periodical template ids');
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
      // Subscription edge declaration (LIN-900 §6): enum, no legacy boolean.
      if (subscription !== undefined && !isValidSubscription(subscription)) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, `subscription must be one of: ${SUBSCRIPTION_LEVELS.join(', ')}`);
      }

      // Shared payload validation for the two main handlers (LIN-1139): length
      // caps, opaque model/harness (LIN-438/1084), dangerous-char rejection, and
      // the issueId/followUpTo/force/sessionId format + combination rules. Lifted
      // verbatim + in order into validateDispatchPayload so this proxy twin and
      // the session route can't re-drift. The proxy caller keeps its own
      // logEvent(..., 400) on reject — the helper only returns the error
      // structure. The caller-specific checks that DIFFER (prompt-required,
      // target vocab, abort/cascade/kind/waitForFollowUps/queueIfBusy/subscription)
      // already ran above, preserving the original interleaving/first-error.
      const payloadError = validateDispatchPayload(req.body || {});
      if (payloadError) {
        logEvent(req, '/api/proxy/dispatch', 400);
        return badRequest.json(res, payloadError.error);
      }

      // Subscription is DECLARED on the edge (LIN-900 §6), never reconstructed from
      // incidental fields. An undeclared edge is `terminal-only`. This deliberately
      // removes the old LIN-881 `!!sessionId` default-on: §6 forbids inferring
      // subscription from "has a sessionId". A stepper beat that needs its PENDING
      // to wake its head declares `subscription: 'everything'` explicitly (the
      // stepper kickoff body does exactly this); a plain sessioned worker correctly
      // defaults to `terminal-only` and no longer wakes its orchestrator on PENDING.
      // The `buildWakeFollowUp` self-skip `childId === sessionId` still prevents an
      // orchestrator from waking itself.
      const subscriptionResolved = subscription ?? DEFAULT_SUBSCRIPTION;

      // Cascade close (LIN-946): a cascade request is not a single abort — it is a
      // command Harbour expands into one plain abort per session in abortTo's whole
      // descendant subtree (the recursive sessionId-tree walk). The store owns the
      // walk + emission; the runner still executes each cancel and skips
      // human-continued sessions (LIN-951). Handled here, before the prompt-context
      // work below (a cascade carries no prompt). This is the proxy-token twin the
      // autopilot actually hits. INERT: nothing issues a cascade at end-of-run yet.
      if (cascade === true) {
        const result = await dispatchQueueStore.expandCascadeAborts(req.proxyUrlKey, abortTo, {
          target: target || 'cli',
          dispatchedBy: req.proxyCreatedBy || null
        });
        logEvent(req, '/api/proxy/dispatch', 201);
        return res.status(201).json({ success: true, cascade: true, ...result });
      }

      // Dangling-referent guard (LIN-1948, surface 2a). MUST run before
      // createDispatchItem: `finalizePrompt` mints a single-use bootstrap token
      // inside the factory, so refusing afterwards would leak a minted
      // credential and burn a dedupe-window slot for a dispatch that never
      // existed.
      //
      // This route resolves no provider of its own — dispatch has never needed
      // one, and the guard is written to keep that true: every non-definitive
      // outcome allows (see lib/dispatch-referent-guard.js). The added
      // resolution is diagnostic-safe; `resolveProviderAccess`'s
      // `recordCredentialResolution` is explicitly read by nothing downstream.
      // Skipped for aborts/cascades so a cancel can never be blocked by a
      // dangling referent.
      if (!isAbort && issueIdentifier) {
        const { token: referentToken, provider: referentProvider } =
          await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
        if (await isDanglingReferent({ provider: referentProvider, token: referentToken, issueIdentifier })) {
          logEvent(req, '/api/proxy/dispatch', 422, `${ISSUE_NOT_FOUND_CODE} ${issueIdentifier}`);
          return jsonError(res, 422, DANGLING_REFERENT_MESSAGE, {
            code: ISSUE_NOT_FOUND_CODE,
            issueIdentifier,
          });
        }
      }

      // Auto-append the proxy context (workspace API access + reporting channel) by
      // default, so the worker can both read context and report its result.
      // Opt out with appendProxyContext:false (e.g. a self-contained prompt).
      const { appendProxyContext } = req.body || {};
      let finalPrompt = prompt;
      // Follow-up beats (LIN-805): a followUpTo resumes a warm session that already
      // received the proxy-context block on its FIRST beat, so re-appending it on
      // every later beat is redundant and risks confusing the worker. Default the
      // append OFF when followUpTo is set; an explicit appendProxyContext:true still
      // opts back in. Fresh dispatches keep the default-ON behaviour (opt out with
      // appendProxyContext:false). This is the systemic fix — every follow-up
      // consumer benefits, not just one orchestrator. (`/recommend-and-dispatch`
      // accepts no followUpTo, so it needs no equivalent suppression.)
      //
      // LIN-1429: this suppression governs the PROSE APPEND only. Whether a
      // credential is PROVISIONED is now a separate decision, keyed on the resolved
      // harness (see finalizePrompt below) — the follow-up default here means "don't
      // repeat the prose", never "don't mint a credential". Conflating the two was
      // the LIN-1429 bug: a broker-dependent (claude-code/MCP) follow-up needs a
      // live credential even when the prose is (correctly) suppressed, because the
      // original credential died with the window that held it (LIN-1375/1362).
      const isFollowUp = followUpTo !== undefined && followUpTo !== null;
      // The caller's own explicit instruction. Distinct from isFollowUp: an opt-out
      // means "I don't want proxy context"; a follow-up default means only "I
      // already have it".
      const explicitOptOut = appendProxyContext === false;
      // Prose append: unchanged (LIN-805).
      const shouldAppendProxyContext = isFollowUp
        ? appendProxyContext === true
        : !explicitOptOut;

      // Create the dispatch item through the shared factory (LIN-1139): it
      // resolves kind, fills blank model/harness from workspace dispatchDefaults
      // (LIN-1099), interposes the default harness (LIN-1159), and calls addItem.
      // The proxy-context ordering constraint (LIN-1155 — harness resolved BEFORE
      // the append, because attachProxyContext gates its MCP-token-vs-prose branch
      // on the resolved harness) is preserved by the finalizePrompt(resolvedHarness)
      // callback: the factory hands it the resolved harness, it runs the append,
      // and returns { prompt, bootstrapToken } to carry on the item. An abort item
      // carries no prompt, so the append stays guarded on prompt presence (LIN-743).
      const item = await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: req.proxyUrlKey,
        workspacePreferencesStore,
        kind,
        model,
        harness,
        terminal,
        finalizePrompt: async (resolvedHarness) => {
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          if (prompt && shouldAppendProxyContext) {
            // LIN-376: embed a fresh single-use bootstrap, never the caller's own token.
            // LIN-1155: claude-code harness -> token stripped from prose, returned here.
            return attachProxyContext({
              proxyTokenStore,
              urlKey: req.proxyUrlKey,
              baseUrl,
              issueIdentifier: issueIdentifier || null,
              prompt,
              label: 'dispatch-bootstrap',
              harness: resolvedHarness,
              createdBy: req.proxyCreatedBy || null,
              // LIN-2354: only resolved when the dangling-referent guard above ran
              // resolveProviderAccess (`!isAbort && issueIdentifier`), stamping
              // req.resolvedProvider — an unscoped dispatch resolves no provider
              // and correctly stays neutral rather than triggering a fresh resolve.
              providerDisplayName: declaredProviderDisplayName(req)
            });
          }
          // LIN-1429: the prose block may be suppressed for a warm follow-up
          // (LIN-805), but a broker-dependent harness still needs a LIVE
          // credential — the original died with the window that held it
          // (LIN-1375/1362). Provision without appending. Keyed on the RESOLVED
          // harness, never on isFollowUp.
          if (prompt && !explicitOptOut && shouldUseMcpTokenField(resolvedHarness)) {
            const bootstrapToken = await provisionBootstrapToken({
              proxyTokenStore,
              urlKey: req.proxyUrlKey,
              baseUrl,
              label: 'dispatch-bootstrap',
              harness: resolvedHarness,
              createdBy: req.proxyCreatedBy || null
            });
            return { prompt: finalPrompt, bootstrapToken };
          }
          return { prompt: finalPrompt, bootstrapToken: null };
        },
        fields: {
          promptName: promptName || 'Prompt',
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
          cascade: cascade === true,
          sessionId: sessionId || null,
          periodicalId: periodicalId || null,
          waitForFollowUps: waitForFollowUps === true,
          queueIfBusy: queueIfBusy === true,
          subscription: subscriptionResolved
        }
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
        cascade: item.cascade === true,
        sessionId: item.sessionId || null,
        dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt
      });
    } catch (err) {
      // Duplicate-dispatch refusal (LIN-1656) — see the responder. Ahead of the
      // generic 500 so an orchestrator can branch on `code` and adopt the `id`.
      if (refuseIfDuplicateDispatch(err, req, res, '/api/proxy/dispatch')) return;
      // Task-budget refusal (LIN-1751) — see the responder.
      if (refuseIfBudgetExhausted(err, req, res, '/api/proxy/dispatch')) return;
      // Fail closed on a missing out-of-band token (LIN-1175) — see kickoff catch.
      if (err && err.proxyAttachFailed) {
        logEvent(req, '/api/proxy/dispatch', 503);
        return jsonError(res, 503, PROXY_ATTACH_FAILED_MESSAGE);
      }
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
   *
   * `periodicalId` (LIN-1825/LIN-2385): optional periodical-template join key,
   * registry-validated exactly like `POST /api/proxy/dispatch`'s field of the
   * same name. Stamped onto BOTH `createDispatchItem` fields blocks below —
   * the verb-override branch AND the recommendation-derived one — because
   * this fused verb, not `POST /dispatch`, is what every autopilot loop
   * actually calls to continue a tracked task (see `lib/prompts/
   * autopilot-kickoff.js`'s "Trigger the next step"), and the normal trigger
   * carries no `kind`, landing on the recommendation-derived branch.
   */
  router.post('/api/proxy/recommend-and-dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    try {
      const { issueIdentifier, target, repo, repoInherited, model, harness, appendProxyContext, noDescend, kind, sessionId, waitForFollowUps, queueIfBusy, subscription, periodicalId } = req.body || {};

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
      // Harbour-set only on the auto-enqueued wake follow-up); subscription is a
      // declared enum (LIN-900 §6) that defaults to `terminal-only` when omitted.
      if (queueIfBusy !== undefined && typeof queueIfBusy !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'queueIfBusy must be a boolean');
      }
      if (subscription !== undefined && !isValidSubscription(subscription)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, `subscription must be one of: ${SUBSCRIPTION_LEVELS.join(', ')}`);
      }
      const recommendRepoValidationError = validateOpaqueDispatchField(repo, 'repo', {
        maxLength: MAX_NAME_LENGTH,
        reportReceivedLength: true,
      });
      if (recommendRepoValidationError) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, recommendRepoValidationError.error);
      }
      // Inherited-repo marker (LIN-1210): when true, `repo` was merely inherited
      // (e.g. an autopilot orchestrator forwarding a parent project's repo onto a
      // cross-project child fan-out), NOT deliberately chosen for THIS dispatch, so
      // the server-derived child/node repo wins over it (see resolveDispatchRepo).
      // Default false keeps the LIN-537 explicit-caller-repo precedence byte-for-byte.
      if (repoInherited !== undefined && typeof repoInherited !== 'boolean') {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'repoInherited must be a boolean');
      }
      // Execution model + harness (LIN-438, LIN-1084): opaque strings, validated
      // via the shared helper (length + dangerous-chars). NOT a generation-model
      // registry check — these are the consumer's execution-model/harness fields.
      const recommendModelValidationError = validateOpaqueDispatchField(model, 'model', { maxLength: MAX_NAME_LENGTH });
      if (recommendModelValidationError) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, recommendModelValidationError.error);
      }
      const recommendHarnessValidationError = validateOpaqueDispatchField(harness, 'harness', { maxLength: MAX_NAME_LENGTH });
      if (recommendHarnessValidationError) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, recommendHarnessValidationError.error);
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
      // Periodical-template join key (LIN-1825/LIN-2385): registry-membership
      // check, mirroring POST /api/proxy/dispatch's identical guard above and
      // routes/dispatch.js's. This is the fused verb every autopilot loop
      // actually uses to continue a tracked task, so it needs the same
      // stamping capability POST /dispatch already has (LIN-2385 B1) — without
      // it, a periodical's Stage-2 batch/lane dispatch has no way to stamp
      // `periodicalId` on the verb it actually takes.
      if (periodicalId !== undefined && !getPeriodicals().map(p => p.id).includes(periodicalId)) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, 'periodicalId must be one of the known periodical template ids');
      }
      // Autopilot session reference (LIN-591): the autopilot dispatchId that is
      // driving this run, stamped onto the spawned worker so the dashboard can
      // reconstruct the session. This is the verb the autopilot actually drives,
      // so it is the important one. Optional opaque string (LIN-1118, was
      // UUID-only); stored + forwarded blindly, no target restriction (sessions
      // span all targets).
      const recommendSessionIdError = validateSessionId(sessionId);
      if (recommendSessionIdError) {
        logEvent(req, '/api/proxy/recommend-and-dispatch', 400);
        return badRequest.json(res, recommendSessionIdError.error);
      }

      // Resolve the subscription edge once for both dispatch paths below (LIN-900
      // §6): DECLARED on the edge, never reconstructed from `sessionId`. An
      // undeclared edge is `terminal-only` — the old `!!sessionId` default-on is
      // removed (§6 forbids inferring subscription from incidental fields). A
      // caller that wants a worker's every event to wake it declares
      // `subscription: 'everything'`.
      const subscriptionResolved = subscription ?? DEFAULT_SUBSCRIPTION;

      // Recommendation preconditions — identical to GET /recommend.
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);
      // LIN-1980: stamp before any other logic (incl. the !accessToken early
      // return below) so the fingerprint is present even when this request
      // later 401s from a shared credential another site marked suspect.
      if (!accessToken) {
        return workspaceUnavailable(req, res, '/api/proxy/recommend-and-dispatch', reason);
      }
      // Two capability-gated fetchers can serve this route — see the matching
      // comment on GET /recommend above.
      if (denyIfUnsupported(provider, 'fetchIssueContext', req, res, '/api/proxy/recommend-and-dispatch')) return;
      if (denyIfUnsupported(provider, 'fetchRecommendationContext', req, res, '/api/proxy/recommend-and-dispatch')) return;
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';

      // ── Verb-override path (LIN-573) ──────────────────────────────────────
      // When the caller pins `kind`, skip the LLM recommendation + descent
      // entirely: fetch the named issue's context, generate the body
      // deterministically with the chosen template key, and dispatch with that
      // override kind. The wobble this fixes is the *verb*, not the *target*, so
      // the override pins the named issue with NO descent. It is purely
      // deterministic (no OpenRouter call), so it bypasses the LLM-config gate
      // and free-tier metering below. provider?.ui is threaded through (LIN-2353);
      // Linear output stays byte-identical to the /prompt endpoint since its ui
      // is the DEFAULT_PROMPT_UI floor.
      if (kind !== undefined) {
        let ctx;
        try {
          ctx = await resolvePromptIssueContext(provider, accessToken, issueIdentifier, isTestMode);
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
        // path, which already passes the full context. provider?.ui is threaded
        // through (LIN-2353) so a non-Linear provider renders capability-appropriate
        // text; Linear output stays byte-identical.
        const generated = generatePrompt(kind, issue, { parent, siblings, project, children, comments, attachments }, {}, provider?.ui || null);
        if (!generated) {
          logEvent(req, '/api/proxy/recommend-and-dispatch', 500);
          return jsonError(res, 500, 'Failed to generate prompt');
        }

        // The body is server-generated/trusted, so it skips the dangerous-char /
        // length checks the caller-supplied POST /dispatch path runs, and is
        // never returned to the caller — same contract as the LLM-driven path.
        try {
          // Create the dispatch item through the shared factory (LIN-1139): it
          // resolves model/harness from workspace dispatchDefaults (LIN-1099;
          // `kind` is guaranteed set on this verb-override branch), interposes the
          // default harness (LIN-1159), and calls addItem. The proxy-context append
          // runs inside finalizePrompt AFTER the harness is resolved (LIN-1155), so
          // it can gate its MCP-token-vs-prose branch on it and hand back the
          // bootstrapToken to carry as a field. Opt out with appendProxyContext:false.
          const item = await createDispatchItem({
            store: dispatchQueueStore,
            urlKey: req.proxyUrlKey,
            workspacePreferencesStore,
            kind,
            model,
            harness,
            finalizePrompt: async (resolvedHarness) => {
              if (appendProxyContext !== false) {
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                // LIN-376: embed a fresh single-use bootstrap, never the caller's own token.
                // LIN-1155: claude-code harness -> token stripped from prose, returned here.
                return attachProxyContext({
                  proxyTokenStore,
                  urlKey: req.proxyUrlKey,
                  baseUrl,
                  issueIdentifier,
                  prompt: generated.prompt,
                  label: 'dispatch-bootstrap',
                  harness: resolvedHarness,
                  createdBy: req.proxyCreatedBy || null,
                  // LIN-2354: resolveProviderAccess runs unconditionally near the
                  // top of this route, so req.resolvedProvider is always stamped
                  // here.
                  providerDisplayName: declaredProviderDisplayName(req)
                });
              }
              return { prompt: generated.prompt, bootstrapToken: null };
            },
            fields: {
              promptName: generated.name || getPromptDisplayName(kind),
              issueId: null,
              issueIdentifier,
              issueTitle: null,
              issueUrl: null,
              dispatchedBy: req.proxyCreatedBy || null,
              target: target || 'cli',
              // Mirror /prompt's repo resolution: project `repo=` from the
              // description, with an explicit caller repo winning (LIN-537). When
              // the caller marks its repo as inherited (LIN-1210), the named node's
              // own project repo wins over it instead (repoInherited: true).
              repo: resolveDispatchRepo(repo, parseRepoFromDescription(project?.description), { inherited: repoInherited === true }),
              sessionId: sessionId || null,
              // Periodical-template join key (LIN-1825/LIN-2385): validated above.
              periodicalId: periodicalId || null,
              // Push-comms: `subscription` is the declared edge (LIN-900 §6),
              // `terminal-only` unless the caller declares `everything`; queueIfBusy
              // forwarded blindly. Both stored + forwarded, no Harbour-side semantics.
              queueIfBusy: queueIfBusy === true,
              subscription: subscriptionResolved
            }
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
          // Duplicate-dispatch refusal (LIN-1656). This is the verb-OVERRIDE arm,
          // which creates its dispatch BEFORE `armKeepalive` runs, so it replies on
          // plain `res` — no keepalive to thread. (The LLM arm below is armed and
          // must pass one.)
          if (refuseIfDuplicateDispatch(err, req, res, '/api/proxy/recommend-and-dispatch')) return;
          // Task-budget refusal (LIN-1751) — same plain-`res` arm as above.
          if (refuseIfBudgetExhausted(err, req, res, '/api/proxy/recommend-and-dispatch')) return;
          // Fail closed on a missing out-of-band token (LIN-1175) — see kickoff catch.
          if (err && err.proxyAttachFailed) {
            logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
            return jsonError(res, 503, PROXY_ATTACH_FAILED_MESSAGE);
          }
          // LIN-2260: classify an upstream provider-auth failure the same way
          // the read path (and GET /recommend via recommendErrorResponse)
          // already does, instead of collapsing every non-classified throw
          // into an opaque 500 — graphqlErrorStatus() falls back to 500 for
          // anything it doesn't recognize, so a genuinely internal failure is
          // unchanged.
          const status = graphqlErrorStatus(err, req);
          logEvent(req, '/api/proxy/recommend-and-dispatch', status);
          console.error('Proxy recommend-and-dispatch override error:', err.message);
          return jsonError(res, status, 'Failed to dispatch prompt', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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

      // LIN-1458: witness which credential source served this request.
      if (!isTestMode) {
        logOpenRouterCredentialSource(req, '/api/proxy/recommend-and-dispatch', { sessionApiKey, isFreeTier });
      }

      // Charge one free-tier unit ONCE per request (not per descent hop). Charge
      // before resolveRecommendation so an exhausted user gets a clean 429.
      if (isFreeTier && !isTestMode) {
        const rejection = await chargeFreeTierOrReject(req, '/api/proxy/recommend-and-dispatch');
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
            provider,
            isTestMode,
            sessionApiKey,
            deadline: recommendDeadline,
            noDescend: noDescend === true
          })
        }));
      } catch (err) {
        keepalive.stop();
        const { status, body } = recommendErrorResponse(err, req);
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

        // kind provenance: parseRecommendedAction (in computeRecommendation) →
        // recommendedAction → deriveDispatchKind → BOTH the stored item's kind
        // and the response kind (same value); falls back to 'custom' when the
        // action can't be parsed.
        const effectiveKind = deriveDispatchKind(rec.recommendedAction);

        // Create the dispatch item through the shared factory (LIN-1139): it
        // resolves model/harness from workspace dispatchDefaults (LIN-1099, keyed
        // on the recommendation-derived effectiveKind), interposes the default
        // harness (LIN-1159), and calls addItem. The proxy-context append runs
        // inside finalizePrompt AFTER the harness is resolved (LIN-1155), so it can
        // gate its MCP-token-vs-prose branch on it and hand back the bootstrapToken
        // to carry as a field. Opt out with appendProxyContext:false.
        const item = await createDispatchItem({
          store: dispatchQueueStore,
          urlKey: req.proxyUrlKey,
          workspacePreferencesStore,
          kind: effectiveKind,
          model,
          harness,
          finalizePrompt: async (resolvedHarness) => {
            if (appendProxyContext !== false) {
              const baseUrl = `${req.protocol}://${req.get('host')}`;
              // LIN-376: embed a fresh single-use bootstrap, never the caller's own token.
              // LIN-1155: claude-code harness -> token stripped from prose, returned here.
              return attachProxyContext({
                proxyTokenStore,
                urlKey: req.proxyUrlKey,
                baseUrl,
                issueIdentifier: terminalIdentifier,
                prompt: rec.prompt,
                label: 'dispatch-bootstrap',
                harness: resolvedHarness,
                createdBy: req.proxyCreatedBy || null,
                // LIN-2354: resolveProviderAccess runs unconditionally near the
                // top of this route, so req.resolvedProvider is always stamped
                // here.
                providerDisplayName: declaredProviderDisplayName(req)
              });
            }
            return { prompt: rec.prompt, bootstrapToken: null };
          },
          fields: {
            promptName: rec.recommendedAction || 'Prompt',
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
            // On a cross-project descent the terminal child's repo (rec.repo) also
            // wins over a merely *inherited* caller repo (repoInherited: true), so
            // the worker runs in the child project's repo, not the parent's (LIN-1210).
            repo: resolveDispatchRepo(repo, rec.repo, { inherited: repoInherited === true }),
            sessionId: sessionId || null,
            // Periodical-template join key (LIN-1825/LIN-2385): validated above.
            // This is the branch autopilot actually takes on the normal
            // Stage-2-opening trigger (no `kind` override) — see the route's
            // own doc comment above for why both fields blocks must carry it.
            periodicalId: periodicalId || null,
            // Opt-in completion hold (LIN-797), forwarded blindly to the runner.
            waitForFollowUps: waitForFollowUps === true,
            // Push-comms: `subscription` is the declared edge (LIN-900 §6),
            // `terminal-only` unless the caller declares `everything`; queueIfBusy
            // forwarded blindly. Both stored + forwarded, no Harbour-side semantics.
            queueIfBusy: queueIfBusy === true,
            subscription: subscriptionResolved
          }
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
        // Duplicate-dispatch refusal (LIN-1656). Keepalive is ARMED on this arm, so
        // the refusal must ride `keepalive.send` — if the 25s flush already fired,
        // the 200 is committed and the real 409 travels as `statusCode` in the body
        // (same contract as the 503 below). The responder also skips the
        // `Retry-After` header once headers are sent.
        if (refuseIfDuplicateDispatch(err, req, res, '/api/proxy/recommend-and-dispatch', keepalive)) return;
        // Task-budget refusal (LIN-1751) — same keepalive-armed arm as above.
        if (refuseIfBudgetExhausted(err, req, res, '/api/proxy/recommend-and-dispatch', keepalive)) return;
        // Fail closed on a missing out-of-band token (LIN-1175) — see kickoff catch.
        if (err && err.proxyAttachFailed) {
          logEvent(req, '/api/proxy/recommend-and-dispatch', 503);
          return keepalive.send(503, { error: PROXY_ATTACH_FAILED_MESSAGE });
        }
        // LIN-2260: classify an upstream provider-auth failure (retryable
        // 503/LINEAR_AUTH) the same way GET /recommend's recommendErrorResponse
        // already does, instead of collapsing every non-classified throw into
        // an opaque 500 — graphqlErrorStatus() falls back to 500 for anything
        // it doesn't recognize, so a genuinely internal failure is unchanged.
        const status = graphqlErrorStatus(err, req);
        logEvent(req, '/api/proxy/recommend-and-dispatch', status);
        console.error('Proxy recommend-and-dispatch error:', err.message);
        keepalive.send(status, { error: 'Failed to dispatch prompt', detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
      }
    } catch (err) {
      // LIN-2260: same classification as the inner catch arms above — this
      // outer catch-all fronts every non-classified throw the two arms didn't
      // already handle (e.g. a failure before `kind` is known which arm to run).
      const status = graphqlErrorStatus(err, req);
      logEvent(req, '/api/proxy/recommend-and-dispatch', status);
      console.error('Proxy recommend-and-dispatch error:', err.message);
      jsonError(res, status, 'Failed to dispatch prompt', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
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

      // LIN-1470: lineage join. A repoint (follow-up dispatch) mints a NEW row;
      // without this, the original row's feedbackCount/completedAt/status freeze
      // at the point of repoint. Derive each row's lineage anchor per the pinned
      // two-tier precedence — doc-level rootItemId, then the first OWN feedback
      // entry carrying rootItemId, then the row's own id — and batch-fetch every
      // OTHER row sharing an anchor in ONE indexed query (constant in N: 2 reads
      // above + 1 here, never 2+N). NEVER sessionId/sessionGroupId: every worker
      // an autopilot spawns shares its orchestrator's sessionId, so grouping on
      // it would collapse all siblings onto one anchor and reinstate the
      // LIN-1461 production bug. Anchors are null-filtered before the $in query
      // ($in: [null] would mass-mis-group every field-less legacy row); the
      // `?? row.id` fallback means this is defensive rather than reachable today.
      // History-only (queued rows carry no feedback) and deliberately NOT scoped
      // by issueIdentifier — rootItemId already isolates the lineage, and
      // inheriting the issue scope would drop siblings filed under a different
      // issue. `projection: {prompt: 0}` preserved (the H12/503 read-cost guard).
      const anchorFor = item => item.rootItemId ?? item.feedback?.find(f => f.rootItemId)?.rootItemId ?? item.id;

      // LIN-1470 (review F1): only rows that actually RAN join the lineage —
      // i.e. `status === 'taken'`, not merely "not queued". `_archiveItem` is
      // called with exactly three statuses (`taken` dispatch-store.js:678,
      // `cancelled` :635, `expired` :715), so a `!== 'queued'` denylist also
      // swept in cancelled/expired rows, which then inherited a sibling's
      // terminal feedback: a cancelled/expired follow-up reported `done`/a
      // completedAt it never earned, and was routed into `?status=done` while
      // vanishing from `?status=cancelled`/`?status=expired`. The eligible set
      // is exactly the rows that ran, so this is an allowlist, not an
      // extended denylist — it needs no future enumeration as new archived
      // statuses can't be added without also adding an `_archiveItem` call
      // site. Queued rows still opt out for the original beat-4 reason: a
      // still-queued row (e.g. a follow-up reply to a finished session,
      // queued but not yet run) must not inherit an already-completed
      // sibling's terminal feedback. Mirrors the existing precedent at the
      // `:id` watch endpoint (`getItemStatus` returns immediately for the
      // active/queued branch, never calling `_collectGroupFeedback`).
      const historyRows = merged.filter(i => i.status === 'taken');
      const anchors = [...new Set(historyRows.map(anchorFor).filter(Boolean))];

      // LIN-1494 (superseding review F2 on LIN-1470): `listHistory` runs
      // `find()` AND `countDocuments()` under `Promise.all` whenever `limit`
      // is set (lib/dispatch-store.js `if (limit) { ... }` branch). Earlier
      // revisions destructured `{ items }` only and recorded the discarded
      // count as an accepted indexed cost; it is now CONSUMED — the pre-slice
      // `total` is the exact truncation signal for the L3 telemetry below,
      // replacing the `length === cap` proxy that false-positived on a
      // lineage of exactly LINEAGE_QUERY_LIMIT rows and could never report
      // how far over the cap real traffic runs. (The page query's twin count
      // feeds the response's honest `total`/`truncated` the same way.)
      const siblingsByAnchor = new Map();
      if (anchors.length) {
        const { items: lineageSiblings, total: lineageTotal } = await dispatchQueueStore.listHistory(req.proxyUrlKey, {
          rootItemId: { $in: anchors },
          limit: LINEAGE_QUERY_LIMIT,
          projection: { prompt: 0 }
        });
        // L3 (LIN-1485, exactness via LIN-1494): the store's pre-slice count
        // says precisely whether the newest-N cap dropped the oldest members
        // of a lineage — and by how much (the question LIN-1485 named as the
        // point of this telemetry). Exactly-at-cap is complete, not truncated.
        if (lineageTotal > LINEAGE_QUERY_LIMIT) {
          console.warn(`Lineage query exceeded LINEAGE_QUERY_LIMIT (${LINEAGE_QUERY_LIMIT}) for urlKey=${req.proxyUrlKey}, anchors=${anchors.length}, total=${lineageTotal} — result truncated to the newest ${LINEAGE_QUERY_LIMIT}`);
        }
        for (const sib of lineageSiblings) {
          const bucket = siblingsByAnchor.get(sib.rootItemId);
          if (bucket) bucket.push(sib);
          else siblingsByAnchor.set(sib.rootItemId, [sib]);
        }
      }

      // LIN-1261 F2: attribute an abort's terminality to the loop it TARGETS at the
      // proxy read boundary too (same class as the reconstruction path, different
      // consumer). Simple Dispatcher posts `[aborted]` to the abort row's OWN
      // feedback, never to the `abortTo` target's — so without this a lister of the
      // aborted TARGET reads it non-terminal until the 24h stale cutoff. Harvest the
      // abort rows already in `merged` (no extra store call) and derive each item's
      // effective feedback through the SAME shared F1 guard the reconstruction path
      // uses — never overriding a later genuine terminal or rewinding completedAt.
      // NOTE: an issue-scoped list (`?issueIdentifier=`) excludes abort rows at the
      // store (they carry `issueIdentifier: null`), so attribution applies to the
      // unscoped list; the point-read watch + follow-up gate are deliberately not
      // reached here (they need a store seam that finds an abort by target; deferred).
      const abortedTargets = harvestAbortedTargets(merged);

      // Resolve each item's effective status once (terminal marker → done/failed/
      // aborted, else `blocked` when the lineage is parked on a human, else the
      // STORED status) so filtering and the response agree. LIN-2079: this one
      // assignment feeds the reported field, the `?status=` FILTER and `total`,
      // so deriving `blocked` here is a wire-behaviour change by design —
      // `?status=taken` no longer returns parked rows, `?status=blocked` does.
      // LIN-1470: the lineage merge runs BEFORE abort attribution — ordering is
      // load-bearing, since `feedbackWithHarvestedAbort`'s F1 guard only lets an
      // abort win when it is strictly later than the existing terminal, so it
      // must see the true lineage terminal (a later child `[done]`), not just
      // this row's own. `_lineageFeedback` (own + verified siblings) feeds the
      // reported `feedbackCount`; `_terminalFeedback` is `_lineageFeedback` PLUS
      // any harvested abort and feeds `status`/`completedAt` — kept separate so
      // the synthetic abort entry never inflates `feedbackCount`.
      //
      // Review F7: `joinsLineage` (WHICH ROWS may join) says nothing about
      // WHICH FEEDBACK a joined row may inherit — a still-`taken` follow-up
      // dispatched AFTER its parent already finished was absorbing the
      // parent's earlier terminal. The invariant is structural, not another
      // status carve-out: a row is never reported complete before it was
      // itself dispatched. `mergeLineageFeedback` enforces this directly by
      // taking `i.dispatchedAt` as `since` — a sibling entry only counts if
      // its timestamp is at or after this row's own dispatch time.
      const resolved = merged.map(i => {
        // Rows that never ran (queued, cancelled, expired) opt out of the
        // lineage join entirely (see above) — `lineageFeedback` stays this
        // row's own (empty) feedback, same as pre-LIN-1470.
        const joinsLineage = i.status === 'taken';
        const anchor = joinsLineage ? anchorFor(i) : null;
        const siblingRows = anchor ? (siblingsByAnchor.get(anchor) || []).filter(s => s.id !== i.id) : [];
        const lineageFeedback = joinsLineage ? mergeLineageFeedback(i.feedback, siblingRows, anchor, i.dispatchedAt) : (i.feedback || []);
        const terminalFeedback = feedbackWithHarvestedAbort(lineageFeedback, abortedTargets.get(i.id));
        return { ...i, _lineageFeedback: lineageFeedback, _terminalFeedback: terminalFeedback, status: deriveLifecycleStatus(terminalFeedback) || i.status };
      });

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
        completedAt: deriveCompletedAt(i._terminalFeedback),
        // LIN-1470: lineage-wide (own + verified siblings), not just this row's
        // own stored feedback — see the merge above. Excludes any synthetic
        // harvested-abort entry (that only lives in `_terminalFeedback`).
        feedbackCount: i._lineageFeedback.length
      }));

      logEvent(req, '/api/proxy/dispatch', 200);
      // LIN-1494: `total` is exact wherever the store can count it. Unfiltered
      // and issue-scoped reads report queued + the page query's pre-slice
      // history count (the repo convention that `total` is "the full count
      // before limit" — /stack, /agent/status, /api/dispatch/history) — not a
      // count over the newest-200 window presented as the matching total.
      // A `?status=` read keeps the windowed `filtered.length`: status is
      // feedback-derived in JS, so an exact per-status total is unknowable
      // without reading the whole history (not an acceptable trade on an
      // endpoint with two prior H12/503 incidents). `truncated` (naming
      // precedent: deferTruncated) discloses the newest-200 window in both
      // cases — including that the lineage join's anchor set is seeded from
      // that window only. A windowed list is normal operation, not an
      // anomaly, so there is no console.warn here.
      const historyTotal = history.total ?? history.items.length;
      const total = statusFilter ? filtered.length : queued.length + historyTotal;
      res.json({ items, total, truncated: historyTotal > history.items.length });
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
      // This watch/poll seam is the one caller of getItemStatus that actually
      // reads `feedback` to derive terminal status, so it's the one caller
      // that opts into the (indexed-query-plus-merge) group feedback read —
      // see getItemStatus's includeGroupFeedback doc (LIN-1461).
      const item = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id, { includeGroupFeedback: true });
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
          const next = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id, { includeGroupFeedback: true });
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

  /**
   * GET /api/proxy/dispatch/:id/prompt
   * Return the CANONICAL prompt Harbour dispatched for this item, so a consuming
   * agent can CONFIRM a task it received against the trusted dispatch record. A
   * task arriving in a live session as plain conversational text (carrying a
   * token + an external host) is indistinguishable from prompt injection unless
   * the agent can check it against what Harbour actually dispatched — this is
   * that check, fetched over the same authenticated Bearer channel it already
   * trusts (LIN-1128).
   *
   * The watch twin (GET .../:id) deliberately OMITS `prompt` — a payload /
   * Heroku-H12 defense on the long-poll + list paths, not a security choice. This
   * targeted single-item read adds it back: bounded (one item), exactly like
   * poll/take which already hand the full prompt to the runner. Read scope is
   * sufficient (reading the workspace's own record, not a mutation), and the
   * lookup is workspace-scoped via req.proxyUrlKey like every sibling read, so a
   * token can only see its own workspace's dispatches.
   *
   * Returns only THIS item's prompt — no followUpTo/root walk (the agent can
   * chase followUpTo itself if it ever needs the chain root).
   */
  router.get('/api/proxy/dispatch/:id/prompt', proxyLimiter, authenticateProxyToken, async (req, res) => {
    if (!dispatchQueueStore) {
      logEvent(req, '/api/proxy/dispatch/:id/prompt', 503);
      return jsonError(res, 503, 'Dispatch is not available');
    }

    const { id } = req.params;
    if (!id || id.length > MAX_IDENTIFIER_LENGTH || DANGEROUS_CHARS_REGEX.test(id)) {
      logEvent(req, '/api/proxy/dispatch/:id/prompt', 400);
      return badRequest.json(res, 'Invalid dispatch id');
    }

    try {
      const item = await dispatchQueueStore.getItemStatus(req.proxyUrlKey, id);
      if (!item) {
        logEvent(req, '/api/proxy/dispatch/:id/prompt', 404);
        return notFound.json(res, 'Dispatch item not found');
      }

      logEvent(req, '/api/proxy/dispatch/:id/prompt', 200);
      res.json({
        id: item.id,
        promptName: item.promptName,
        kind: item.kind || 'custom',
        prompt: item.prompt || null,
        issueIdentifier: item.issueIdentifier || null,
        issueUrl: item.issueUrl || null,
        target: item.target,
        followUpTo: item.followUpTo || null,
        sessionId: item.sessionId || null,
        dispatchedAt: item.dispatchedAt
      });
    } catch (err) {
      logEvent(req, '/api/proxy/dispatch/:id/prompt', 500);
      console.error('Proxy dispatch prompt read error:', err.message);
      jsonError(res, 500, 'Failed to read dispatch prompt');
    }
  });

  return router;
}
