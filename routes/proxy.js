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
import { createDedupeCache, createGenerationTracker } from '../lib/proxy-dedupe.js';
import { createCredentialTrail } from '../lib/proxy-credential-trail.js';
import { buildInstructions } from '../lib/proxy-instructions.js';
import { createAgentStatusRoutes } from './proxy-agent-status.js';
import { createRulingsRoutes } from './proxy-rulings.js';
import { createTokensAdminRoutes } from './proxy-tokens-admin.js';
import { createTokenExchangeRoutes } from './proxy-token-exchange.js';
import { createReadRoutes } from './proxy-reads.js';
import { createProxyWriteRoutes } from './proxy-writes.js';
import { createComputeRoutes } from './proxy-compute.js';
import { createKickoffRoutes } from './proxy-kickoff.js';
import { createDispatchRoutes } from './proxy-dispatch.js';
import { BYTE_IDENTICAL_ESCALATION_THRESHOLD } from '../lib/rejected-credentials.js';
import { STAGE_PROVIDER_LANE, STAGE_PROXY_TOKEN } from '../lib/proxy-events.js';
import { graphqlErrorExtra, graphqlErrorDetail, declaredProviderDisplayName } from '../lib/proxy-graphql-errors.js';
import { deriveTerminalStatus, deriveLifecycleStatus, deriveCompletedAt, harvestAbortedTargets, feedbackWithHarvestedAbort, mergeLineageFeedback } from '../lib/dispatch-terminal.js';
import { anchorFor as taskCostAnchorFor, buildTaskCost } from '../lib/task-cost.js';
import { isValidSubscription, DEFAULT_SUBSCRIPTION, SUBSCRIPTION_LEVELS } from '../lib/dispatch-wake.js';
import { validateOpaqueDispatchField, validateSessionId, validateDispatchPayload } from '../lib/dispatch-validation.js';
// LIN-1552: the issue-write validation rules (length caps, control-char guard,
// priority range) now live in one shared module so the session-auth workspace
// API write routes (Session B) consume the same definition and cannot drift.
import {
  MAX_NAME_LENGTH,
  DANGEROUS_CHARS_REGEX,
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
import { collectIssueAttachments } from '../lib/proxy-wire.js';
import { isRecommendationEnabled, getRecommendation, getPaidEnvKey } from '../lib/openrouter.js';
import { resolveRecommendation, describeDescent, armHopSignal } from '../lib/recommend-recurse.js';
import { resolveWorkspaceModel, resolveAiOperationModel } from '../lib/workspace-preferences.js';
import { resolveNorthStarSignal, resolveRoadmapNarrative, classifyReportFreshness, ROADMAP_REPORT_MAX_AGE_DAYS } from '../lib/next-run.js';
import { getNorthStarDocVersion } from '../lib/north-star-resolver.js';
import { generateRecap } from '../lib/recap.js';
import { generateBrief } from '../lib/brief.js';
import { hashContext } from '../lib/recap-cache.js';
import { snapshotFromContext } from '../lib/task-snapshot-store.js';
import { isBlocked } from '../lib/tree.js';
import { buildTaskStack } from '../lib/task-stack.js';
import { generatePrompt, hasPrompt, isValidDispatchKind, deriveDispatchKind, getPromptDisplayName, PROMPT_TEMPLATES, DISPATCH_KINDS } from '../lib/prompt-templates.js';
import { getPeriodicals } from '../lib/periodicals.js';
import { foldPeriodicalRuns, DEFAULT_HORIZON_MS } from '../lib/periodical-runs.js';
import { PERIODICAL_PROJECTION, PERIODICAL_HISTORY_PROJECTION } from '../lib/dispatch-store.js';
import { parseRepoFromDescription, resolveDispatchRepo, buildPromptFilename } from '../lib/prompt-formatters.js';
import { attachProxyContext, shouldUseMcpTokenField, provisionBootstrapToken } from '../lib/proxy-preamble.js';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT, AUTOPILOT_VARIANTS, AUTOPILOT_VARIANT_DEFAULT } from '../lib/prompts/autopilot-kickoff.js';
import { buildAutopilotManual } from '../lib/prompts/autopilot-manual.js';
import { buildPassageRunnerKickoff } from '../lib/prompts/passage-runner-kickoff.js';
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
import { PartialWriteError } from '../lib/partial-write-error.js';
import { badRequest, jsonError, notFound, workspaceUnavailableEnvelope, classifyUpstreamError } from '../lib/errors.js';

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
// token. WORKING_TOKEN_TTL_SECONDS is imported directly from
// lib/proxy-tokens.js by group C's exchange site in
// routes/proxy-token-exchange.js (LIN-679 Stage 2 / LIN-2535), same pattern as
// BOOTSTRAP_TOKEN_TTL_SECONDS, imported the same way by group A's mint site in
// routes/proxy-tokens-admin.js (LIN-679 Stage 2 / LIN-2534).
// MAX_COMMENT_LENGTH now imported from lib/issue-write-validation.js (LIN-1552).

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
export function createProxyRoutes({ proxyTokenStore, proxyEventStore, agentStatusStore, recapCacheStore, briefCacheStore, taskSnapshotStore, dispatchQueueStore, llmCallLogStore, taskDecisionsStore = null, shelvedRulingsStore = null, dismissalSuggestionsStore = null, sessionsFeedCache = null, workspaceFromUrl, resolveWorkspaceAccess, getWorkspaceOpenRouterKey, getWorkspaceNorthStar, getNorthStarDocVersionForWorkspace = null, reportHistoryStore, workspacePreferencesStore, dispatchPresetsStore, freeTierStore, provider: injectedProvider = null, rejectedCredentialRegistry = null }) {
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

        // LIN-1938 S2/S3: a read-only lookup so the 401 can say WHY, and so
        // the recognized-expired case leaves an audit row at all — until now
        // this branch never reached `logEvent`/`recordEvent`, so an expired
        // working token was invisible both to the agent (bare "invalid,
        // expired, or consumed") and to an operator (no row anywhere). An
        // unrecognized bearer (garbage/never-issued) has no `urlKey` to
        // attribute a row to, so it gets neither field nor a row — only a
        // recognized token document earns either.
        const descriptor = await proxyTokenStore.describeRejectionCause(token);
        const extra = descriptor
          ? {
              ...PROXY_TOKEN_REJECTED_EXTRA,
              proxyTokenState: descriptor.state,
              ...(descriptor.state === 'expired' ? { proxyTokenExpiredAt: descriptor.expiresAt } : {})
            }
          : PROXY_TOKEN_REJECTED_EXTRA;

        if (descriptor) {
          proxyEventStore.recordEvent({
            urlKey: descriptor.urlKey,
            tokenId: null,
            tokenLabel: null,
            method: req.method,
            endpoint: req.originalUrl,
            status: 401,
            stage: STAGE_PROXY_TOKEN,
            note: descriptor.state
          }).catch(err => console.error('Failed to log proxy-token rejection event:', err));
        }

        return jsonError(res, 401, 'Invalid, expired, or consumed token', extra);
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

  // Group C token-exchange (LIN-679 Stage 2 / LIN-2535): extracted to
  // routes/proxy-token-exchange.js, mounted at its original position.
  router.use(createTokenExchangeRoutes({ proxyTokenStore, proxyEventStore, proxyLimiter, PROXY_TOKEN_REJECTED_EXTRA }));

  // Group D reads (LIN-679 Stage 3a / LIN-2536): extracted to
  // routes/proxy-reads.js, mounted at its original position.
  router.use(createReadRoutes({ proxyLimiter, authenticateProxyToken, resolveProviderAccess, denyIfUnsupported, logEvent, workspaceUnavailable, graphqlErrorStatus, proxyEventStore }));

  // Group E writes (LIN-679 Stage 3b / LIN-2537): extracted to
  // routes/proxy-writes.js, mounted at its original position.
  router.use(createProxyWriteRoutes({ proxyLimiter, commentDedupe, commentDedupeGenerations, authenticateProxyToken, requireWriteScope, resolveProviderAccess, denyIfUnsupported, denyIfMissingRead, workspaceUnavailable, graphqlErrorStatus, writeRejected, resolveTeamInput, resolveStateInput, resolveProjectInput, resolveLabelInput, refResolutionFailed, partialWriteFailed, logEvent }));

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

  // Group F compute (LIN-679 Stage 4 / LIN-2538): extracted to
  // routes/proxy-compute.js, mounted at its original position.
  router.use(createComputeRoutes({ recapCacheStore, briefCacheStore, taskSnapshotStore, dispatchQueueStore, llmCallLogStore, getWorkspaceOpenRouterKey, getWorkspaceNorthStar, getNorthStarDocVersionForWorkspace, reportHistoryStore, workspacePreferencesStore, proxyLimiter, authenticateProxyToken, resolveProviderAccess, denyIfUnsupported, logEvent, logOpenRouterCredentialSource, workspaceUnavailable, graphqlErrorStatus, captureTaskSnapshot, chargeFreeTierOrReject, computeRecommendation, recommendErrorResponse, resolveProxyLLM, resolvePromptIssueContext, withTimeout, LINEAGE_QUERY_LIMIT, RECOMMEND_DESCENT_BUDGET_MS, LLM_TIMEOUT_MS, getTestMockData, fetchWithTimeout, CONTEXT_FETCH_TIMEOUT_MS }));


  // Group G agent-status (LIN-679 Stage 1 / LIN-2533): extracted to
  // routes/proxy-agent-status.js, mounted at its original position.
  router.use(createAgentStatusRoutes({ agentStatusStore, proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent }));

  // LIN-2444: the consumer-API rulings surface — a workspace-scoped READ of
  // unanswered decisions, plus a PROPOSE-a-dismissal write. Deliberately no
  // proxy dismiss: per John's ruling an agent may recommend a dismissal and
  // never perform one, so `decision-answer` stays absent from
  // FEEDBACK_ENTRY_KINDS (LIN-1728) and this router never reaches
  // markDecisionAnswered. See routes/proxy-rulings.js.
  router.use(createRulingsRoutes({ proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent, dispatchQueueStore, agentStatusStore, taskDecisionsStore, shelvedRulingsStore, dismissalSuggestionsStore, sessionsFeedCache }));

  // Group H kickoff (LIN-679 Stage 5 / LIN-2539): extracted to
  // routes/proxy-kickoff.js, mounted at its original position.
  router.use(createKickoffRoutes({ proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent, dispatchQueueStore, dispatchPresetsStore, workspacePreferencesStore, proxyTokenStore, resolveProviderAccess, workspaceUnavailable, denyIfUnsupported, resolvePromptIssueContext, refuseIfDuplicateDispatch, refuseIfBudgetExhausted, graphqlErrorStatus, VALID_PROXY_DISPATCH_TARGETS, PROXY_ATTACH_FAILED_MESSAGE }));

  // Group I dispatch (LIN-679 Stage 6 / LIN-2540): extracted to
  // routes/proxy-dispatch.js, mounted at its original position.
  router.use(createDispatchRoutes({ authenticateProxyToken, chargeFreeTierOrReject, computeRecommendation, denyIfUnsupported, dispatchQueueStore, getWorkspaceOpenRouterKey, graphqlErrorStatus, LINEAGE_QUERY_LIMIT, logEvent, logOpenRouterCredentialSource, proxyLimiter, PROXY_ATTACH_FAILED_MESSAGE, proxyTokenStore, recommendErrorResponse, RECOMMEND_DESCENT_BUDGET_MS, refuseIfBudgetExhausted, refuseIfDuplicateDispatch, requireWriteScope, resolvePromptIssueContext, resolveProviderAccess, resolveProxyLLM, VALID_PROXY_DISPATCH_TARGETS, workspacePreferencesStore, workspaceUnavailable }));

  return router;
}
