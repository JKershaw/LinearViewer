/**
 * Harbour - Express Server
 *
 * Main entry point for the application. Handles:
 * - OAuth 2.0 authentication with Linear
 * - Session management (MongoDB in production, file-based in development)
 * - Fetching and rendering projects/issues from Linear API
 * - Serving static landing page for unauthenticated users
 */
import 'dotenv/config'
import express from 'express'
import { installAsyncErrorForwarding } from './lib/async-errors.js'

// Make Express 4 forward async-handler rejections to the error middleware
// (LIN-609). Must run before any route/Layer is created. See lib/async-errors.js.
installAsyncErrorForwarding()
import session from 'express-session'
import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { ensureIndexes } from './lib/db-indexes.js'
import { MongoSessionStore } from './lib/session-store.js'
import { UserPreferencesStore, VALID_THEMES, setThemeCookie } from './lib/user-preferences.js'
import { getWorkspaceOpenRouterKey as resolveOpenRouterKey } from './lib/openrouter-key-resolver.js'
import { UNSCOPED, selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution } from './lib/workspace-token-resolver.js'
import { refreshOwnerWorkspaceToken } from './lib/workspace-token-refresh.js'
import { createWorkspaceTokenCache, workspaceTokenCacheKey, evictWorkspaceTokenPair, evictAllWorkspaceTokens } from './lib/workspace-token-cache.js'
import { WorkspacePreferencesStore } from './lib/workspace-preferences.js'
import { DispatchQueueStore } from './lib/dispatch-store.js'
import { CustomPromptsStore } from './lib/custom-prompts-store.js'
import { CollectiveCharactersStore } from './lib/collective-characters-store.js'
import { CollectivePresetsStore } from './lib/collective-presets-store.js'
import { DispatchPresetsStore } from './lib/dispatch-presets-store.js'
import { DispatchTokenStore } from './lib/dispatch-tokens.js'
import { HarbourFeedbackTokenStore } from './lib/harbour-feedback-tokens.js'
import { ProxyTokenStore } from './lib/proxy-tokens.js'
import { ProxyEventStore } from './lib/proxy-events.js'
import { AgentStatusStore } from './lib/agent-status-store.js'
import { ObservationSessionsStore } from './lib/observation-sessions-store.js'
import { createObservationMaterializer } from './lib/observation-sessions-materializer.js'
import { createWorkspaceTitleResolver } from './lib/workspace-title-resolver.js'
import { FreeTierStore } from './lib/free-tier-store.js'
import { RecapCacheStore } from './lib/recap-cache.js'
import { BriefCacheStore } from './lib/brief-cache.js'
import { RunSummaryCacheStore } from './lib/run-summary-cache.js'
import { AccountStore } from './lib/account-store.js'
import { WorkspaceStore } from './lib/workspace-store.js'
import { AccountWorkspaceStore } from './lib/account-workspace-store.js'
import { OwnerCredentialStore } from './lib/owner-credential-store.js'
import { SessionSummaryCacheStore, hashSession } from './lib/session-summary-cache.js'
import { generateSessionSummary, childLoops, DEFAULT_SESSION_SUMMARY_MODEL } from './lib/session-summary.js'
import { ReportHistoryStore } from './lib/report-history-store.js'
import { ShipBiscuitHistoryStore } from './lib/ship-biscuit-history-store.js'
import { TaskSnapshotStore } from './lib/task-snapshot-store.js'
import { SavedChatStore } from './lib/saved-chat-store.js'
import { LlmCallLogStore } from './lib/llm-call-log.js'
import { PromptTraceStore } from './lib/prompt-trace-store.js'
import { getProvider, getProviderForWorkspace, getAllProviders } from './lib/providers/registry.js'
import { NotImplementedError } from './lib/providers/interface.js'
import './lib/providers/linear/index.js' // side effect: self-registers the Linear provider into the registry
import { localProvider } from './lib/providers/local/index.js' // side effect: self-registers the Local provider; store injected below
import './lib/providers/github/index.js' // side effect: self-registers the GitHub provider so its OAuth router mounts (LIN-541)
import './lib/providers/github-projects/index.js' // side effect: self-registers the GitHub Projects v2 provider (LIN-560)
import { LocalStore } from './lib/local-store.js'
import { buildForest, partitionCompleted, buildInProgressForest, buildRecentActivityForest, NO_PROJECT_ID, PERIODICALS_PROJECT_ID } from './lib/tree.js'
import { isHiddenState } from './lib/providers/state-map.js'
import { buildPeriodicalNodes } from './lib/periodicals.js'
import { parseRepoFromDescription } from './lib/prompt-formatters.js'
import { renderPage, renderErrorPage, renderUpstreamAwareErrorPage, renderWorkspaceNotFoundPage } from './lib/render.js'
import { isAuthError, clientErrorStatus, clientErrorMessage } from './lib/errors.js'
import { renderLandingPage } from './lib/render-landing.js'
import { isGitHubConfigured } from './lib/providers/github/app-auth.js'
import { parseLandingPage } from './lib/parse-landing.js'
import { refreshAccessToken } from './lib/token-refresh.js'
import { UUID_REGEX, getActiveWorkspace, getWorkspaceByUrlKey, validateWorkspaceUrlKey, removeWorkspace, saveSession, rotateOwnerCredential, getWorkspaceToken, getBindingsForWorkspace, getBindingCallScope, getWorkspaceCallScope, linkProvider, unlinkProvider, setActiveProvider, remintActiveCredential } from './lib/workspace.js'
import { createWorkspaceRoutes } from './routes/workspace.js'
import { createEnsurePATSession } from './lib/pat-session.js'
import { createOpenRouterAuthRoutes } from './routes/openrouter-auth.js'
import { createDispatchRoutes } from './routes/dispatch.js'
import { createProxyRoutes } from './routes/proxy.js'
import { createTestRoutes } from './routes/test.js'
import { createWorkspaceApiRoutes, shouldMockAi } from './routes/workspace-api.js'
import { getModelCatalog } from './lib/openrouter-catalog.js'
import { createLegacyRedirects } from './routes/legacy-redirects.js'
import { testMockTeams, testMockData } from './tests/fixtures/mock-data.js'
import { swimSampleData } from './tests/fixtures/swim-sample-data.js'
import { shipDenseSampleData } from './tests/fixtures/ship-dense-sample-data.js'
import { renderAuditPage } from './lib/render-audit.js'
import { renderPrivacyPolicy, renderTermsOfService } from './lib/render-legal.js'
import { renderStyleguide } from './lib/render-styleguide.js'
import { renderKpisPage } from './lib/render-kpis.js'
import { collectKpiStats } from './lib/kpi-stats.js'
import { renderSettingsPage } from './lib/render-settings.js'
import { renderPromptsPage } from './lib/render-prompts.js'
import { renderCustomPromptsPage } from './lib/render-custom-prompts.js'
import { renderDispatchPage } from './lib/render-dispatch.js'
import { renderSwipePage } from './lib/render-swipe.js'
import { renderSwimPage } from './lib/render-swim.js'
import { renderShipPage } from './lib/render-ship.js'
import { createCollectiveRoutes } from './routes/collective.js'
import { createDashboardRoutes, sessionIsTerminal } from './routes/dashboard.js'
import { createSessionsFeedCache } from './lib/sessions-feed-cache.js'
import { fetchIssueContext } from './lib/linear.js'
import { createTaskChatRoutes } from './routes/task-chat.js'
import { createNextRunRoutes } from './routes/next-run.js'
import { createLiveConsoleRoutes } from './routes/live-console.js'
import { createFlightCompanionRoutes } from './routes/flight-companion.js'
import { createShipBiscuitRoutes } from './routes/ship-biscuit.js'
import { yapClientFromEnv } from './lib/yap-client.js'
import { getLoopsForWorkspace } from './lib/pipeline-loops.js'
import { buildSessionCounts } from './lib/sessions-view.js'
import { renderRoadmapPage } from './lib/render-roadmap.js'
import { buildRoadmapModel } from './lib/roadmap.js'
import { renderProxyPage } from './lib/render-proxy.js'
import { AVAILABLE_MODELS, setLlmCallRecorder, setPromptTraceRecorder, getPaidEnvKey, hasPaidEnvKey, getFreeTierModelConfigWarning } from './lib/openrouter.js'
import { resolveWorkspaceModel, resolveAiOperationModel, getWorkspaceFeatures, isWorkspaceFeatureEnabled, setWorkspaceFeature, resolveDispatchDefaults, AI_OPERATION_KINDS } from './lib/workspace-preferences.js'
import { getFeatureFlags, isValidFeatureKey, isValidWorkspaceFeatureKey, WORKSPACE_FEATURES } from './lib/feature-defaults.js'
import { DISPATCH_DEFAULT_KINDS } from './lib/prompt-templates.js'
import { validateOpaqueDispatchField, MAX_NAME_LENGTH } from './lib/dispatch-validation.js'
import { getDeployInfo } from './lib/deploy-info.js'

// =============================================================================
// Environment Variable Validation
// =============================================================================
// Validate required environment variables at startup to fail fast with clear errors
const oauthEnvVars = ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'];

// SESSION_SECRET defaults for easy local development (override in production)
const DEFAULT_SESSION_SECRET = 'dev-secret-change-in-production';
if (!process.env.SESSION_SECRET) {
  console.warn('Warning: SESSION_SECRET not set, using default (not secure for production)');
  process.env.SESSION_SECRET = DEFAULT_SESSION_SECRET;
}

// OAuth vars: warn at startup but don't exit — show errors in web UI instead
if (process.env.NODE_ENV !== 'test') {
  const missingVars = oauthEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    console.warn(`Warning: Missing OAuth environment variables: ${missingVars.join(', ')}`);
    console.warn('The app will start, but Linear OAuth login will be unavailable until these are set.');
  }

  // OPENROUTER_API_KEY foot-gun (LIN-961): a present-but-empty/whitespace value
  // is silently treated as unset and every proxy LLM call falls back to the free
  // tier — surfacing later only as a misleading "Daily limit reached" 429. Catch
  // it at boot rather than at first 429.
  if (process.env.OPENROUTER_API_KEY !== undefined && !getPaidEnvKey()) {
    console.warn('Warning: OPENROUTER_API_KEY is set but empty/whitespace — it will be treated as unset.');
    console.warn('Proxy LLM calls will fall back to the free tier (OPENROUTER_FREE_TIER_KEY) if configured, else fail.');
  }

  // OPENROUTER_FREE_TIER_MODEL foot-gun (LIN-1333): the resolver fails closed, so an
  // uncurated id degrades silently to DEFAULT_MODEL and the operator never learns
  // their setting was ignored. Surface it at boot, where they'll see it.
  const freeTierModelWarning = getFreeTierModelConfigWarning();
  if (freeTierModelWarning) {
    console.warn(`Warning: ${freeTierModelWarning}`);
  }
}

// Personal Access Token mode: auto-authenticate without OAuth
if (process.env.LINEAR_ACCESS_TOKEN) {
  console.log('PAT mode: LINEAR_ACCESS_TOKEN is set. Users will be auto-authenticated.');
}

// =============================================================================
// Constants
// =============================================================================
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

// =============================================================================
// Landing Page Setup
// =============================================================================
// Pre-render static content for unauthenticated users from content/landing.md.
// This is parsed once at startup to avoid re-parsing on every request.
const landingData = parseLandingPage('./content/landing.md')
// LIN-769: same cancelled-hiding as the live dashboard, applied to the static
// preview so the two surfaces stay consistent.
const landingForest = buildForest(landingData.issues.filter(issue => !isHiddenState(issue)))
const landingTrees = landingData.projects
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map(project => {
    const { roots } = landingForest.get(project.id) || { roots: [] }
    const { incomplete, completed, completedCount } = partitionCompleted(roots)
    return { project, incomplete, completed, completedCount }
  })

// The bespoke landing showcase (LIN-980) owns the brand hero itself; it gates
// the GitHub CTA on the SAME `isGitHubConfigured()` predicate as the
// /auth/github route guard and the settings add affordance (LIN-761), threaded
// per-request at the render call sites below so the three can never disagree.

// =============================================================================
// Database & Session Setup
// =============================================================================
// Uses MongoDB in production (via MONGODB_URI) or MangoDB (file-based) in development.
// MangoDB stores data in ./data by default; HARBOUR_DATA_DIR overrides it so an out-of-tree
// caller — the full-system hermetic test suite — can point each run at an isolated temp dir and
// never read or clobber a developer's real ./data. Unset preserves today's behaviour exactly.
const dbClient = process.env.MONGODB_URI
  ? new MongoClient(process.env.MONGODB_URI)
  : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')

await dbClient.connect()
const db = dbClient.db('linear-viewer')

// Boot-time index creation (LIN-610). Idempotent — running on every boot is the
// deploy mechanism (no migration framework). Best-effort per index, so a failed
// build can never wedge startup. Must run after connect and before app.listen.
await ensureIndexes(db)
const sessionsCollection = db.collection('sessions')
const userPreferencesCollection = db.collection('user-preferences')

const sessionStore = new MongoSessionStore({
  collection: sessionsCollection,
  ttl: SESSION_TTL_SECONDS
})

const userPreferencesStore = new UserPreferencesStore({
  collection: userPreferencesCollection
})

// Workspace preferences (LIN-283): shared across all users of a Linear org,
// keyed by urlKey. Holds the workspace AI model selection so that UI and
// proxy traffic use the same model.
const workspacePreferencesCollection = db.collection('workspace-preferences')
const workspacePreferencesStore = new WorkspacePreferencesStore({
  collection: workspacePreferencesCollection
})

// Custom prompts (workspace-scoped)
const customPromptsCollection = db.collection('custom-prompts')
const customPromptsStore = new CustomPromptsStore({
  collection: customPromptsCollection
})

// Collective characters (personas the user picks for the experimental Collective
// discussion, LIN-1048). Partitioned by the anchor workspace urlKey; each record
// carries its own repo binding. Mirrors the custom-prompts store shape.
const collectiveCharactersCollection = db.collection('collective-characters')
const collectiveCharactersStore = new CollectiveCharactersStore({
  collection: collectiveCharactersCollection
})

// Collective preset meetings (LIN-1050, S4). Custom rows only — the 6 built-in
// seed presets are frozen module constants (lib/collective-preset-defs.js), not
// rows in this collection. Partitioned by the anchor workspace urlKey, mirrors
// the collective characters store shape minus its recent/auto-record half.
const collectivePresetsCollection = db.collection('collective-presets')
const collectivePresetsStore = new CollectivePresetsStore({
  collection: collectivePresetsCollection
})

// Dispatch presets (LIN-1390 S1). Workspace-scoped, reusable dispatch
// model/harness routing configs a user can select at dispatch time (or an
// autopilot item inherits from its anchor); no built-in half, and — unlike
// the collective preset store above — presets here are editable in place.
const dispatchPresetsCollection = db.collection('dispatch-presets')
const dispatchPresetsStore = new DispatchPresetsStore({
  collection: dispatchPresetsCollection
})

// Local provider backing store (LIN-356). One scope-partitioned collection
// holds projects + issues for `provider: 'local'` workspaces. Injecting it here
// keeps registration import-driven (the import above self-registers the
// provider) while the store/collection is wired at boot like every other store.
// No-op for Linear/legacy workspaces — getProviderForWorkspace only resolves
// 'local' for a workspace that opts in via its provider field.
const localIssuesCollection = db.collection('local-issues')
const localStore = new LocalStore({ collection: localIssuesCollection })
localProvider.configure({ store: localStore })

// Dispatch queue collections
const dispatchQueueCollection = db.collection('dispatch-queue')
const dispatchTokensCollection = db.collection('dispatch-tokens')
const dispatchHistoryCollection = db.collection('dispatch-history')

const dispatchQueueStore = new DispatchQueueStore({
  collection: dispatchQueueCollection,
  historyCollection: dispatchHistoryCollection,
  ttl: 24 * 60 * 60 // 24 hours
})

const dispatchTokenStore = new DispatchTokenStore({
  collection: dispatchTokensCollection
})

// Short-TTL single-use tokens that authorise repo-level Claude hooks to
// post feedback against a specific Harbour dispatch item. Bound to the
// itemId at mint time, so leak surface is one feedback POST per item.
const harbourFeedbackTokensCollection = db.collection('harbour-feedback-tokens')
const harbourFeedbackTokenStore = new HarbourFeedbackTokenStore({
  collection: harbourFeedbackTokensCollection
})

// Proxy collections
const proxyTokensCollection = db.collection('proxy-tokens')
const proxyEventsCollection = db.collection('proxy-events')

const proxyTokenStore = new ProxyTokenStore({
  collection: proxyTokensCollection
})

const proxyEventStore = new ProxyEventStore({
  collection: proxyEventsCollection
})

// Agent status tracking
const agentStatusCollection = db.collection('foreman-status')
const agentStatusStore = new AgentStatusStore({
  collection: agentStatusCollection
})

// Observation sessions read-model (LIN-623): a durable, materialized projection of
// the autopilot sessions the Observation feed renders, so the hot poll is a cheap
// per-workspace lookup that survives deploys instead of replaying 30 days of logs.
// The materializer keeps it current via the stores' onWrite hooks. The hook is
// assigned AFTER the materializer is built (it depends on both stores) — `onWrite`
// is read at call time, so late assignment closes the dependency cycle cleanly.
const observationSessionsCollection = db.collection('observation-sessions')
const observationSessionsStore = new ObservationSessionsStore({
  collection: observationSessionsCollection
})
const observationMaterializer = createObservationMaterializer({
  dispatchStore: dispatchQueueStore,
  agentStatusStore,
  observationSessionsStore,
  // LIN-962: resolve real task titles at the read/serve seam so Observation
  // Level-2 cards whose loops lack `issueTitle` show a title, not a bare
  // identifier. Off the hot poll path; `resolveWorkspaceTitles` is a hoisted
  // fn declared below (safe to reference here — invoked only at write time).
  resolveWorkspaceTitles
})
// Shared Observation sessions-feed cache (LIN-617). One process-wide instance,
// passed to BOTH the dashboard router (which reads it on the /sessions path) and
// the test router (which exposes a /test/clear-* invalidation seam), so the E2E
// reset can drop the cached feed and not race a stale pre-seed payload (LIN-799).
const sessionsFeedCache = createSessionsFeedCache()
// Fire-and-forget recompute on every feed-relevant dispatch/status write.
dispatchQueueStore.onWrite = ({ urlKey, sessionId, issueIdentifier }) =>
  observationMaterializer.rebuildForWrite(urlKey, { sessionId, issueIdentifier })
agentStatusStore.onWrite = ({ urlKey, issueIdentifier }) =>
  observationMaterializer.rebuildForWrite(urlKey, { issueIdentifier })

// Free tier usage tracking
const freeTierCollection = db.collection('free-tier-usage')
const freeTierStore = new FreeTierStore({
  collection: freeTierCollection,
  dailyLimit: parseInt(process.env.FREE_TIER_DAILY_LIMIT, 10) || 20,
  hourlyLimit: parseInt(process.env.FREE_TIER_HOURLY_LIMIT, 10) || 50
})

// Recap cache (LIN-261): AI-generated task recaps, keyed on context hash
const recapCacheCollection = db.collection('recap-cache')
const recapCacheStore = new RecapCacheStore({
  collection: recapCacheCollection
})

// Run summary cache (LIN-509): AI-generated short summaries of autopilot runs
// (Loops), keyed `${workspaceId}:${loopId}`. 30-day TTL matches loop retention.
const runSummaryCacheCollection = db.collection('run-summary-cache')
const runSummaryCacheStore = new RunSummaryCacheStore({
  collection: runSummaryCacheCollection
})

// Session summary cache (LIN-592): AI-generated one-sentence rollups of whole
// autopilot sessions (orchestrator + spawned workers), keyed
// `${workspaceId}:${sessionId}`. 30-day TTL matches loop/run-summary retention.
const sessionSummaryCacheCollection = db.collection('session-summary-cache')
const sessionSummaryCacheStore = new SessionSummaryCacheStore({
  collection: sessionSummaryCacheCollection
})

// Background session-summary precompute (LIN-632). Late-wired into the observation
// materializer now that both the summary cache and the run-summary cache exist:
// whenever a session is (re)materialized AND is terminal, generate its one-sentence
// rollup ahead of time so the first user click is a cache hit. This runs at WRITE
// time with NO user session, so it resolves an OpenRouter key server-side
// (OPENROUTER_API_KEY → free-tier) and SKIPS cleanly when neither is configured —
// never blocking, never throwing into the read-model write it rode in on.
observationMaterializer.precomputeSessionSummary = async (urlKey, session) => {
  if (!sessionSummaryCacheStore || !session?.sessionId) return;
  if (process.env.NODE_ENV === 'test') return;       // tests stay offline (no LLM)
  if (!sessionIsTerminal(session)) return;            // only terminal sessions are cacheable
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_FREE_TIER_KEY;
  if (!apiKey) return;                                // no server-side key → skip gracefully

  // Skip if a fresh summary for this exact input is already cached.
  const inputHash = hashSession(session)
  const cached = await sessionSummaryCacheStore.get(urlKey, session.sessionId)
  if (cached && cached.inputHash === inputHash) return

  // Gather already-cached child run-summary outcomes for richer context — never
  // generate per child (the one-LLM-call cost contract).
  const childOutcomes = {}
  if (runSummaryCacheStore) {
    for (const loop of childLoops(session)) {
      const c = await runSummaryCacheStore.get(urlKey, loop.loopId)
      if (c?.summary?.outcome) childOutcomes[loop.loopId] = c.summary.outcome
    }
  }

  const { summary, model } = await generateSessionSummary(session, { apiKey, model: DEFAULT_SESSION_SUMMARY_MODEL, childOutcomes })
  await sessionSummaryCacheStore.put(urlKey, session.sessionId, { inputHash, summary, model })
}

// Brief cache: AI-generated current-state task briefs, keyed on context hash
const briefCacheCollection = db.collection('brief-cache')
const briefCacheStore = new BriefCacheStore({
  collection: briefCacheCollection
})

// Report history (LIN-299): durable per-workspace roadmap report runs
const reportHistoryCollection = db.collection('report-history')
const reportHistoryStore = new ReportHistoryStore({
  collection: reportHistoryCollection
})

// Ship's Biscuit editions (LIN-818): durable per-workspace generated newspaper
// editions (front page + index). No TTL, per-workspace count-capped, modelled on
// report-history above.
const shipBiscuitHistoryCollection = db.collection('ship-biscuit-editions')
const shipBiscuitHistoryStore = new ShipBiscuitHistoryStore({
  collection: shipBiscuitHistoryCollection
})

// Task snapshot archive (LIN-598): append-only per-task history of the observed
// issue slice. Captured fire-and-forget at the proxy recap/brief read seams
// (which already compute hashContext), hash-gated so a write happens only on a
// real change. Durable + per-task count-capped (no TTL), like report-history.
const taskSnapshotCollection = db.collection('task-snapshots')
const taskSnapshotStore = new TaskSnapshotStore({
  collection: taskSnapshotCollection
})

// Saved chats (LIN-1008): durable, resumable task-chat transcripts, private per
// {urlKey, accountId}. Content-bearing → session-auth only: deliberately NOT
// passed to createProxyRoutes / createWorkspaceApiRoutes / kpi-stats below (the
// prompt-trace privacy boundary), only into the task-chat + test route factories.
const savedChatsCollection = db.collection('saved-chats')
const savedChatStore = new SavedChatStore({
  collection: savedChatsCollection
})

// LLM call log (LIN-418): per-call metadata (model, provider, tokens, cost, time).
// Registered as the openrouter client's recorder hook so every LLM call is logged
// without the client importing the store.
const llmCallLogCollection = db.collection('llm-call-log')
const llmCallLogStore = new LlmCallLogStore({
  collection: llmCallLogCollection
})
setLlmCallRecorder((call) => llmCallLogStore.record(call))

// Prompt traces (LIN-578): content-bearing sibling of the metadata log above.
// Captures the full AI recommendation generation (rendered input + output) for
// debug/eval. Registered as the openrouter client's trace recorder hook so both
// recommendation seams persist a trace without the client importing the store.
// Session-auth read only — NEVER exposed on the proxy token-auth surface or /kpis.
const promptTraceCollection = db.collection('prompt-traces')
const promptTraceStore = new PromptTraceStore({
  collection: promptTraceCollection
})
setPromptTraceRecorder((trace) => promptTraceStore.record(trace))

// Accounts (LIN-1327): the durable human-tied account record; identities attach
// per (provider, scope). Wired into every sign-in path's `establishAccount` call
// as of LIN-1329 (Phase C) — see lib/account-session.js.
const accountsCollection = db.collection('accounts')
const accountStore = new AccountStore({ collection: accountsCollection })

// Durable workspaces (LIN-1328, Phase B). `workspaceStore` itself stays INERT —
// deliberately passed to NO route factory and no session read site — until
// LIN-1330 (Phase D) moves reads off the session `workspaces` blob onto it.
// `accountWorkspaceStore` (the account↔workspace membership edge) is DIFFERENT:
// LIN-1329 (Phase C) wires every sign-in path to bind the account to the
// session workspace's existing id via `establishAccount`, independent of
// whether a durable `Workspace` document exists yet.
const workspacesCollection = db.collection('workspaces')
const workspaceStore = new WorkspaceStore({ collection: workspacesCollection })
const accountWorkspacesCollection = db.collection('account-workspaces')
const accountWorkspaceStore = new AccountWorkspaceStore({ collection: accountWorkspacesCollection })

// Durable owner-scoped Linear credential (LIN-1523, Session 1 of LIN-1501).
// Additive-only in this session: dual-written alongside the session-only
// credential (never instead of it) via rotateOwnerCredential/
// persistOwnerCredential at every rotation/acquisition site — ensureValidToken
// and handleTokenRefreshAndRetry below, the off-session refresh path
// (refreshOwnerWorkspaceToken), and both OAuth-callback branches
// (routes/auth.js). No read path is wired to it yet — that is Session 2
// (LIN-1524). Plaintext `refreshToken` at rest is accepted conditionally for
// this phase only — see LIN-1522, which owns encryption/retention for this
// collection.
const ownerCredentialsCollection = db.collection('owner-credentials')
const ownerCredentialStore = new OwnerCredentialStore({ collection: ownerCredentialsCollection })

// =============================================================================
// Process-level safety net (LIN-608)
// =============================================================================
// On modern Node an unhandled promise rejection (or an uncaught exception) can
// terminate the process — on Heroku the dyno dies and the next requests get the
// generic "Application error" page until it restarts. Async route handlers that
// are invoked as `(req, res) => handleX(...)` are the main escape hatch: Express
// never awaits the returned promise, so a rejection there is "unhandled". We log
// it loudly (so failures surface) and keep the process alive rather than letting
// one bad request take down the whole server. Route-level errors are still routed
// to the Express error middleware below via `.catch(next)`; this is the backstop
// for anything that slips past that.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
})

// =============================================================================
// Express App Configuration
// =============================================================================
const app = express()

// Trust Heroku's proxy for X-Forwarded-* headers (required for secure cookies)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}

// Force HTTPS in production by checking the X-Forwarded-Proto header
// (set by reverse proxies like Heroku)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.hostname}${req.url}`)
  }
  next()
})

app.use(express.static('public'))
app.use(express.urlencoded({ extended: false }))
app.use(express.json({ limit: '250kb' }))

// Session middleware configuration:
// - resave: false - don't save session if unmodified
// - saveUninitialized: false - don't create session until something is stored
// - secure cookies only in production (requires HTTPS)
// - sameSite: 'lax' - CSRF protection (prevents cookies on cross-origin POST)
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}))

// =============================================================================
// Test Mode Setup
// =============================================================================
if (process.env.NODE_ENV === 'test') {
  app.use(createTestRoutes({ dispatchQueueStore, dispatchTokenStore, freeTierStore, userPreferencesStore, workspacePreferencesStore, customPromptsStore, collectiveCharactersStore, collectivePresetsStore, dispatchPresetsStore, proxyTokenStore, proxyEventStore, agentStatusStore, observationSessionsStore, sessionsFeedCache, recapCacheStore, briefCacheStore, runSummaryCacheStore, sessionSummaryCacheStore, reportHistoryStore, shipBiscuitHistoryStore, taskSnapshotStore, savedChatStore, localStore, getWorkspaceAccessToken, accountStore, accountWorkspaceStore, ownerCredentialStore }))
}

// =============================================================================
// OpenRouter Source Helper
// =============================================================================

/**
 * Determines the source of the OpenRouter API key for the current request.
 * Priority: user OAuth key > server env key > free tier key > null
 *
 * @param {Object} req - Express request object
 * @returns {'oauth'|'env'|'free'|null} The source of the API key
 */
function getOpenRouterSource(req) {
  if (req.session.openRouterApiKey) return 'oauth';
  // hasPaidEnvKey() trims, so a blank/whitespace OPENROUTER_API_KEY is NOT
  // classified as a paid `env` source (LIN-961). This keeps the operator-facing
  // status honest: the footer can no longer read a blank key as `env` while the
  // token-authed proxy path silently runs on the free tier — the exact
  // divergence that hid this bug.
  if (hasPaidEnvKey()) return 'env';
  if (process.env.OPENROUTER_FREE_TIER_KEY || req.session.freeTierEnabled) return 'free';
  return null;
}

// =============================================================================
// PAT (Personal Access Token) Auto-Login Middleware
// =============================================================================
// When LINEAR_ACCESS_TOKEN is set and the user has no session, auto-create one.

app.use(createEnsurePATSession({ accountStore, accountWorkspaceStore }));

// =============================================================================
// Token Refresh Middleware
// =============================================================================
// Automatically refreshes access tokens before they expire (5-minute buffer).
// Simplified approach: concurrent requests may both refresh, but this is harmless.

/**
 * Middleware to ensure access token is valid before each authenticated request.
 * Automatically refreshes token if it's expired or about to expire (5-minute buffer).
 * Works with multi-workspace sessions - refreshes active workspace token only.
 */
async function ensureValidToken(req, res, next) {
  const workspace = getActiveWorkspace(req.session)
  if (!workspace) return next()

  // PAT tokens never expire — skip refresh
  if (workspace.isPAT) return next()

  // Check if token needs refresh (5-minute buffer)
  const needsTokenRefresh = workspace.tokenExpiresAt - Date.now() < TOKEN_REFRESH_BUFFER_MS
  if (!needsTokenRefresh) return next()

  try {
    // Provider-aware refresh / re-mint seam (LIN-712, widened to github-projects
    // in LIN-1499 Phase 1/D2). GitHub App installation tokens carry NO
    // refresh_token — they are RE-MINTED from the App JWT + installationId — so
    // a GitHub-family workspace must NOT be routed through Linear's refresh
    // endpoint. Before this widening, a github-projects workspace fell to the
    // `else` below and called refreshAccessToken(undefined), which throws into
    // the catch and destroys the workspace/session — every github-projects
    // workspace was deleted within ~1h of creation, guaranteed. Branch on
    // provider: GitHub-family re-mints via the provider seam; everything else
    // (Linear, and the legacy undefined-provider default) keeps the
    // refresh_token exchange below, byte-for-byte unchanged. (PAT/local never
    // reach here — PAT is skipped above and local carries a MAX expiry, so
    // needsTokenRefresh stays false.) Switching GitHub-family providers to a
    // real ~1h expiry means those bindings flow through this middleware for
    // the first time — that is intended, not a regression.
    if (workspace.provider === 'github' || workspace.provider === 'github-projects') {
      await remintActiveCredential(workspace, getProviderForWorkspace(workspace))
    } else {
      // LIN-1524: Linear's rotating credential lives ONLY in the durable
      // store now — `workspace.refreshToken` is never written anymore, so it
      // is read from there instead. A miss (no durable record, or one with no
      // refreshToken) is a deliberate, explicit failure — not a silent
      // no-op — so it falls into the SAME catch below that a real
      // `refreshAccessToken` failure always has: remove the workspace, evict,
      // possibly destroy the session. This is the read-side of close-out
      // Finding #4's legacy no-`accountId` session (a guaranteed durable
      // read-miss, since `store.get` fails closed on a missing accountId) —
      // it degrades to exactly today's pre-cutover failure mode, not a new one.
      const durableRecord = await ownerCredentialStore.get(req.session.accountId, workspace.urlKey)
      if (!durableRecord?.refreshToken) {
        throw new Error(`No durable Linear credential to refresh workspace ${workspace.id}`)
      }
      const newTokens = await refreshAccessToken(durableRecord.refreshToken)

      // Update workspace tokens (session-side accessToken/tokenExpiresAt
      // mirror only, LIN-1524) + persist the rotated refreshToken durably
      // (LIN-1523/1524's rotation seam).
      await rotateOwnerCredential({ accountId: req.session.accountId, workspace, tokenData: newTokens, store: ownerCredentialStore })
    }

    await saveSession(req.session)
    console.log(`Token refreshed for workspace ${workspace.id}`)
    next()
  } catch (error) {
    console.error(`Token refresh failed for workspace ${workspace.id}:`, error)

    // LIN-1507: capture accountId BEFORE any session mutation below — destroy()
    // (the remaining===0 arm) wipes it, and LIN-1524 close-out Finding #1 needs
    // it in BOTH arms, not just the destroy one.
    const accountId = req.session.accountId

    // Remove failed workspace
    const remaining = removeWorkspace(req.session, workspace.id)

    // LIN-1524 close-out Finding #1: this failed workspace's durable credential
    // must not outlive its session-side removal — `workspace` is gone from
    // session.workspaces after removeWorkspace above regardless of `remaining`,
    // so the durable delete belongs here, before the branch, not only in the
    // destroy arm below.
    await ownerCredentialStore.delete(accountId, workspace.urlKey)

    if (remaining > 0) {
      // Switch to another workspace
      await saveSession(req.session)
      return res.redirect('/')
    }

    // No workspaces left, destroy session.
    evictWorkspaceTokenPair(evictWorkspaceToken, workspace.urlKey, accountId)
    req.session.destroy(() => res.redirect('/'))
  }
}

// Apply middleware to all routes except auth and logout
// Note: workspace routes need token refresh too (they access Linear API)
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/logout' || req.path === '/privacy' || req.path === '/terms' || req.path === '/styleguide' || req.path === '/kpis') {
    return next();
  }
  ensureValidToken(req, res, next);
});

// =============================================================================
// Route Mounting
// =============================================================================
// Mount extracted route modules
// LIN-561: mount every registered provider's auth router, not just Linear's.
// Providers that don't implement getAuthRouter (the base throws
// NotImplementedError) are skipped — so today, with only Linear providing one,
// this mounts exactly the Linear OAuth router as before (behaviour-identical).
for (const provider of getAllProviders()) {
  let authRouter
  try {
    authRouter = provider.getAuthRouter({ sessionStore, userPreferencesStore, accountStore, accountWorkspaceStore, evictWorkspaceToken, ownerCredentialStore })
  } catch (err) {
    if (err instanceof NotImplementedError) continue
    throw err
  }
  app.use(authRouter)
}
app.use(createWorkspaceRoutes({ localStore, accountStore, accountWorkspaceStore, evictWorkspaceToken, ownerCredentialStore }))
app.use(createOpenRouterAuthRoutes({ userPreferencesStore }))
// Note: Dispatch routes mounted after workspaceFromUrl middleware is defined

// =============================================================================
// Main Application Route
// =============================================================================

/**
 * Helper function to fetch and prepare project data for rendering.
 * Handles both test mode and real API calls.
 *
 * Resolves the provider and credential token from the workspace (LIN-356), so a
 * non-Linear workspace's dashboard reads route through its own provider rather
 * than being hardcoded to Linear. The test-mode mock short-circuit is preserved:
 * `getWorkspaceToken` returns the legacy `accessToken` ('test-token') for the
 * E2E mock workspaces, and resolves to `false` for any non-Linear workspace.
 *
 * @param {import('./lib/workspace.js').Workspace} workspace - The workspace whose provider/token serve the reads
 * @param {string|null} teamId - Optional team ID to filter issues by
 * @returns {Promise<{trees, inProgressTrees, organizationName, teams, selectedTeamId}>} Prepared data for rendering
 */
async function fetchAndPrepareProjects(workspace, teamId = null, mockOverride = null, urlKey = null, { slim = false } = {}) {
  // Fan out across ALL of the workspace's provider bindings and merge the
  // results, rather than resolving a single provider (LIN-544). A legacy/Linear
  // workspace has exactly one synthesized binding here, so the merge is a no-op
  // and the output stays byte-identical (pinned by render.test.js parity test).
  // The merge keys collision-safely on `<source>:<id>` inside buildForest, and
  // the source badge is rendered downstream when >1 source is present.
  const bindings = getBindingsForWorkspace(workspace);

  // Org-level metadata (org name, team selector) comes from the primary
  // (active) binding only — the merged dashboard still presents ONE workspace
  // identity; only the issue/project lists fan out across sources.
  let teams = [];
  let organizationName = 'Projects';
  const mergedProjects = [];
  const mergedIssues = [];

  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    const isPrimary = i === 0;
    const provider = getProvider(binding.provider);
    const bindingToken = binding.credentials?.token;
    // The per-call read scope: the bare token for Linear/local (byte-identical),
    // or a { token, repo } credential for a GitHub App binding so the provider
    // builds a request-time client from the installation token (LIN-713) — the
    // boot client is never configured in production.
    const bindingScope = getBindingCallScope(binding);
    // Use mock data in test mode to avoid hitting the provider API
    const isTestMode = process.env.NODE_ENV === 'test' && bindingToken === 'test-token';

    // Fetch teams (primary binding only)
    const bindingTeams = isTestMode
      ? testMockTeams
      : await provider.fetchTeams(bindingScope);

    // Fetch projects and issues (filtered by team if specified).
    // `slim` (LIN-442) is the homepage's description-trim: it only reaches the
    // dashboard + its token-refresh retry, never swim/ship/swipe, which keep the
    // full query.
    let { organizationName: orgName, projects, issues } = isTestMode
      ? (mockOverride || testMockData)
      : await provider.fetchProjects(bindingScope, teamId, { slim });

    // In test mode, manually filter issues by team
    if (isTestMode && teamId) {
      issues = issues.filter(i => i.team?.id === teamId);
    }

    if (isPrimary) {
      teams = bindingTeams;
      organizationName = orgName;
    }
    mergedProjects.push(...projects);
    mergedIssues.push(...issues);
  }

  // Multi-source workspace → render a per-task source badge (suppressed for a
  // single-provider workspace so the Linear-only render stays byte-identical).
  const showSource = bindings.length > 1;

  // Defensive copy before the synthetic-group injections below (No Project,
  // Periodicals) push onto `projects`. In production `fetchProjects` returns a
  // fresh array each call, but in test mode `projects` is the shared
  // `testMockData.projects` const — mutating it in place leaks a duplicate
  // Periodicals/No-Project entry into every later request (LIN-345).
  let projects = [...mergedProjects];
  // LIN-769: hide cancelled issues from the dashboard entirely, mirroring how
  // trashed issues never enter the rendered list (they are excluded from Linear
  // collections; cancelled ones are not, so we drop them here). Filtering at this
  // single pre-forest seam hides them from the project tree, the in-progress
  // ancestor context, and the recent-activity feed at once — without touching the
  // shared terminal/glyph helpers, so completed (✓) and duplicate stay visible.
  const issues = mergedIssues.filter(issue => !isHiddenState(issue));

  // Build issue tree structure (parent-child relationships)
  const forest = buildForest(issues);

  // Resolve the workspace-scoped `periodicals` flag (mechanism: LIN-340;
  // consumer: LIN-341). The read site was wired in by LIN-340 — this is where
  // LIN-341 actually consumes it to gate the synthetic group below. Off (and a
  // no-op) whenever urlKey is absent, which keeps the prototype swipe/swim/ship
  // views — and the unauthenticated/landing paths — on unchanged behaviour.
  let periodicalsEnabled = false;
  if (urlKey) {
    periodicalsEnabled = await isWorkspaceFeatureEnabled({
      urlKey,
      featureKey: WORKSPACE_FEATURES.PERIODICALS,
      store: workspacePreferencesStore
    });
  }

  // Add virtual "No Project" if there are issues without a project
  if (forest.has(NO_PROJECT_ID)) {
    projects.push({
      id: NO_PROJECT_ID,
      name: 'No Project',
      content: null,
      url: null,
      sortOrder: Number.MAX_SAFE_INTEGER // Always sort last
    });
  }

  // LIN-341: inject the synthetic Periodicals group behind the workspace flag.
  // Mirrors the "No Project" virtual-project pattern: a synthetic project entry
  // (so the trees mapping renders it) plus a forest entry holding the periodical
  // template rows. Templates are app-only and never written to Linear.
  if (periodicalsEnabled) {
    projects.push({
      id: PERIODICALS_PROJECT_ID,
      name: 'Periodicals',
      content: null,
      url: null,
      sortOrder: Number.MAX_SAFE_INTEGER // Sort last, alongside "No Project"
    });
    forest.set(PERIODICALS_PROJECT_ID, { roots: buildPeriodicalNodes() });
  }

  // Build in-progress tree with ancestor chains for context
  const inProgressTrees = buildInProgressForest(issues, projects);

  // Build recent activity tree (completed in last 7 days)
  const recentActivityTrees = buildRecentActivityForest(issues, projects, 1);

  // Build tree structure for each project, separating complete from incomplete
  const trees = projects
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(project => {
      const { roots } = forest.get(project.id) || { roots: [] };
      const { incomplete, completed, completedCount } = partitionCompleted(roots);
      return { project, incomplete, completed, completedCount };
    });

  return { trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId: teamId, periodicalsEnabled, showSource };
}

/**
 * Handles workspace removal after authentication failure.
 * Removes the workspace from session, then either redirects to switch
 * workspace or shows the landing page if no workspaces remain.
 */
async function handleWorkspaceRemoval(session, workspaceId, res) {
  // LIN-1507: capture the workspace's urlKey BEFORE removeWorkspace() drops it
  // from session.workspaces — by the time `remaining === 0` below, it's gone.
  const removedWorkspace = session.workspaces?.find(w => w.id === workspaceId);
  const remaining = removeWorkspace(session, workspaceId);
  const deployInfo = getDeployInfo()

  // LIN-1524 close-out Finding #1: the removed workspace's durable credential
  // must not outlive its session-side removal — belongs here, before the
  // branch, since `removedWorkspace` is gone from session.workspaces either way.
  if (removedWorkspace) {
    await ownerCredentialStore.delete(session.accountId, removedWorkspace.urlKey);
  }

  if (remaining > 0) {
    await saveSession(session);
    return res.redirect('/');
  }

  // accountId is still live here — only `workspaces`/`activeWorkspaceId` were
  // touched above, and destroy()'s callback runs after the session data is gone.
  if (removedWorkspace) {
    evictWorkspaceTokenPair(evictWorkspaceToken, removedWorkspace.urlKey, session.accountId);
  }

  return new Promise((resolve) => {
    session.destroy((err) => {
      if (err) console.error('Session destroy error:', err);
      const html = renderLandingPage({ deployInfo, githubEnabled: isGitHubConfigured(), freeTierEnabled: !!process.env.OPENROUTER_FREE_TIER_KEY });
      res.send(html);
      resolve();
    });
  });
}

/**
 * Attempts to refresh an expired token and retry the request. `refreshToken`
 * is passed explicitly (LIN-1524) — Linear's rotating credential lives in the
 * durable store now, not on `workspace`, and the caller (handleUnauthorizedError)
 * already fetched the durable record to decide whether to call this at all.
 */
async function handleTokenRefreshAndRetry(workspace, session, teamId, openRouterSource, res, refreshToken) {
  const tokenData = await refreshAccessToken(refreshToken);
  await rotateOwnerCredential({ accountId: session.accountId, workspace, tokenData, store: ownerCredentialStore });
  await saveSession(session);
  console.log('Token refreshed after 401, retrying request');

  // Load custom prompts (non-blocking, fallback to empty)
  let customPrompts = [];
  try {
    customPrompts = (await customPromptsStore.list(workspace.urlKey)).map(p => ({ id: p.id, name: p.name }));
  } catch (e) { /* non-fatal */ }

  const deployInfo = getDeployInfo()
  // Pass urlKey so the periodicals group renders consistently after a token
  // refresh, matching the primary dashboard route (LIN-341).
  const { trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId, showSource } = await fetchAndPrepareProjects(workspace, teamId, null, workspace.urlKey, { slim: true });
  const html = renderPage(trees, inProgressTrees, recentActivityTrees, organizationName, {
    teams,
    selectedTeamId,
    workspaces: session.workspaces,
    openRouterSource,
    deployInfo,
    urlKey: workspace.urlKey,
    featureFlags: getFeatureFlags(session),
    customPrompts,
    showSource
  });
  return res.send(html);
}

/**
 * Handles 401 Unauthorized errors from the Linear API.
 */
async function handleUnauthorizedError(workspace, session, teamId, openRouterSource, res) {
  // PAT tokens cannot be refreshed — show a clear error
  if (workspace.isPAT) {
    const html = renderErrorPage('Access Token Invalid',
      'Your LINEAR_ACCESS_TOKEN is no longer valid. Please check the token and restart the server.', {
        action: 'Try again',
        actionUrl: '/'
      });
    // LIN-1507: this destroys the WHOLE session, not just the dead-PAT
    // workspace — and a PAT session is NOT guaranteed single-workspace: OAuth
    // login preserves and appends to session.workspaces rather than replacing
    // it (routes/auth.js's mode:'new' callback restores existingWorkspaces
    // before upsertWorkspace), so a PAT session can accumulate a co-resident
    // OAuth workspace (CLAUDE.md: "OAuth still works alongside PAT"). Evicting
    // only `workspace` would leave that co-resident workspace's cached token
    // outliving the session for up to the full TTL — the exact defect this
    // ticket exists to close. Evict every workspace on the session, the same
    // treatment as /logout, capturing before destroy() wipes the data.
    evictAllWorkspaceTokens(evictWorkspaceToken, session.workspaces, session.accountId);
    session.destroy(() => res.status(401).send(html));
    return;
  }

  // LIN-1524 (folding in LIN-1503's mandatory predicate half): re-point at the
  // durable record instead of the session-side `workspace.refreshToken`,
  // which Linear no longer carries — that gate would now be permanently
  // false for Linear too, and every 401 would delete the workspace instead of
  // refreshing it (the same LIN-1499 destructive-mode defect class, this time
  // for Linear). Provider-blindness itself is UNCHANGED and stays exactly as
  // broken as before for GitHub-family (no durable record ever exists for it,
  // so this still evaluates false and falls through to removal) — LIN-1503
  // remains filed separately for that broader fix; this is only the one
  // re-point this cutover makes mandatory.
  const durableRecord = await ownerCredentialStore.get(session.accountId, workspace.urlKey);
  if (durableRecord?.refreshToken) {
    try {
      return await handleTokenRefreshAndRetry(workspace, session, teamId, openRouterSource, res, durableRecord.refreshToken);
    } catch (refreshError) {
      console.error('Token refresh failed after 401:', refreshError);
      return handleWorkspaceRemoval(session, workspace.id, res);
    }
  }

  return handleWorkspaceRemoval(session, workspace.id, res);
}

/**
 * Home page - renders landing page or redirects to workspace.
 *
 * For unauthenticated users: Shows pre-rendered static landing page.
 * For authenticated users: Redirects to active workspace URL.
 */
app.get('/', (req, res) => {
  const workspace = req.session.workspaces?.[0]
  const deployInfo = getDeployInfo()

  // Authenticated users redirect to their first workspace
  if (workspace) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/`)
  }

  // Show setup notice on localhost when nothing is configured
  const isLocalhost = ['localhost', '127.0.0.1'].some(h => req.get('host')?.startsWith(h))
  const hasNoAuth = !process.env.LINEAR_ACCESS_TOKEN && oauthEnvVars.some(v => !process.env[v])
  const setupNotice = (isLocalhost && hasNoAuth) ? 'setup' : null

  // Unauthenticated users see the bespoke Harbour showcase landing (LIN-980).
  const html = renderLandingPage({ deployInfo, setupNotice, githubEnabled: isGitHubConfigured(), freeTierEnabled: !!process.env.OPENROUTER_FREE_TIER_KEY })
  res.send(html)
})

/**
 * Landing swipe page - unauthenticated preview of the swipe view.
 *
 * Renders the swipe view with static landing page data so visitors can
 * explore the UI before signing in.
 *
 * For authenticated users: Redirects to their workspace swipe page.
 */
app.get('/swipe/:identifier?', (req, res) => {
  const workspace = req.session.workspaces?.[0]

  if (workspace) {
    const dest = req.params.identifier
      ? `/workspace/${encodeURIComponent(workspace.urlKey)}/swipe/${encodeURIComponent(req.params.identifier)}`
      : `/workspace/${encodeURIComponent(workspace.urlKey)}/swipe`
    return res.redirect(dest)
  }

  const html = renderSwipePage(
    { projectTrees: landingTrees, inProgressTrees: [], recentActivityTrees: [] },
    { isLanding: true, deployInfo: getDeployInfo(), initialIdentifier: req.params.identifier || null }
  )
  res.send(html)
})

/**
 * Landing swim page - unauthenticated preview of the swim lanes view.
 *
 * Renders the swim view with static landing page data so visitors can
 * explore the UI before signing in.
 *
 * For authenticated users: Redirects to their workspace swim page.
 */
app.get('/swim', (req, res) => {
  const workspace = req.session.workspaces?.[0]

  if (workspace) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/swim`)
  }

  const html = renderSwimPage(
    { projectTrees: landingTrees, inProgressTrees: [], recentActivityTrees: [] },
    { isLanding: true, deployInfo: getDeployInfo() }
  )
  res.send(html)
})

/**
 * Landing ship page — unauthenticated preview of the radial Ship view.
 * For authenticated users: redirects to their workspace ship page.
 * Prototype: not linked from navigation.
 */
app.get('/ship', (req, res) => {
  const workspace = req.session.workspaces?.[0]

  if (workspace) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/ship`)
  }

  const html = renderShipPage(
    { projectTrees: landingTrees, inProgressTrees: [], recentActivityTrees: [] },
    { isLanding: true, deployInfo: getDeployInfo() }
  )
  res.send(html)
})

// =============================================================================
// Legal Pages (public, no auth required)
// =============================================================================

app.get('/privacy', (req, res) => {
  res.send(renderPrivacyPolicy({ deployInfo: getDeployInfo() }))
})

app.get('/terms', (req, res) => {
  res.send(renderTermsOfService({ deployInfo: getDeployInfo() }))
})

// Static design-token reference + visual-regression baseline (LIN-457).
// Deliberately deterministic: no deployInfo, no live data.
app.get('/styleguide', (req, res) => {
  res.send(renderStyleguide())
})

// =============================================================================
// KPIs Page (public, no auth required, intentionally unlinked)
// =============================================================================
// Instance-wide aggregate stats. collectKpiStats() is the privacy boundary —
// it returns only counts and app-defined labels, never workspace data.
//
// The collection is served stale-while-revalidate behind a single-flight lock:
// once warmed, the route ALWAYS responds instantly from cache and refreshes in
// the background, so a slow DB read can never block the request or trip the 30s
// router timeout (the old behaviour: a >30s read died before it could fill the
// cache, so every request re-ran the read and timed out — a death spiral). Only
// a cold cache (process just booted) awaits the first computation. The
// single-flight lock collapses concurrent refreshes into one DB read.
const KPI_CACHE_MS = 60 * 1000
let kpiCache = { at: 0, stats: null }
let kpiInflight = null

async function refreshKpiStats() {
  const startedAt = Date.now()
  const stats = await collectKpiStats({
    sessions: sessionsCollection,
    userPreferences: userPreferencesCollection,
    workspacePreferences: workspacePreferencesCollection,
    customPrompts: customPromptsCollection,
    localIssues: localIssuesCollection,
    dispatchQueue: dispatchQueueCollection,
    dispatchHistory: dispatchHistoryCollection,
    dispatchTokens: dispatchTokensCollection,
    proxyTokens: proxyTokensCollection,
    proxyEvents: proxyEventsCollection,
    agentStatus: agentStatusCollection,
    freeTier: freeTierCollection,
    recapCache: recapCacheCollection,
    briefCache: briefCacheCollection,
    reportHistory: reportHistoryCollection
  }, { dbBackend: process.env.MONGODB_URI ? 'mongodb' : 'mangodb' })
  const ms = Date.now() - startedAt
  if (ms > 5000) console.warn(`KPI stats collection slow: ${ms}ms`)
  else console.log(`KPI stats collected in ${ms}ms`)
  kpiCache = { at: Date.now(), stats }
  return stats
}

// Single-flight: collapse concurrent (re)fills into one in-flight DB read.
function refreshKpiStatsOnce() {
  if (!kpiInflight) {
    kpiInflight = refreshKpiStats().finally(() => { kpiInflight = null })
  }
  return kpiInflight
}

app.get('/kpis', async (req, res) => {
  try {
    const fresh = kpiCache.stats && Date.now() - kpiCache.at <= KPI_CACHE_MS
    if (!fresh) {
      if (kpiCache.stats) {
        // Warm but stale: serve the last good snapshot now, refresh in the
        // background. Never await — the request must not block on the DB read.
        refreshKpiStatsOnce().catch(err => console.error('KPI background refresh failed:', err))
      } else {
        // Cold cache (fresh boot): nothing to serve yet, so await the first fill.
        await refreshKpiStatsOnce()
      }
    }
    res.send(renderKpisPage(kpiCache.stats, { deployInfo: getDeployInfo() }))
  } catch (error) {
    console.error('Failed to render KPIs page:', error)
    if (kpiCache.stats) {
      // Degrade to the last good snapshot rather than erroring the whole page.
      res.send(renderKpisPage(kpiCache.stats, { deployInfo: getDeployInfo() }))
    } else {
      res.status(500).send(renderErrorPage('Error', 'Could not load instance KPIs. Please try again.'))
    }
  }
})

// =============================================================================
// Workspace-Prefixed Routes
// =============================================================================

/**
 * Middleware to extract and validate workspace from URL.
 * Sets req.workspace for use by route handlers.
 */
function workspaceFromUrl(req, res, next) {
  try {
    const { urlKey } = req.params

    // Validate urlKey format FIRST (before any other checks)
    // This prevents information disclosure about auth state for invalid URLs
    if (!validateWorkspaceUrlKey(urlKey)) {
      // For API routes, return JSON error
      if (req.path.includes('/api/')) {
        return res.status(400).json({ error: 'Invalid workspace URL' })
      }
      // For page routes, show error page (urlKey is sanitized by validation failure)
      return res.status(404).send(renderWorkspaceNotFoundPage('invalid', []))
    }

    // Check if user is authenticated (has any workspaces)
    if (!req.session.workspaces || req.session.workspaces.length === 0) {
      // For API routes, return JSON error
      if (req.path.includes('/api/')) {
        return res.status(401).json({ error: 'Not authenticated' })
      }
      // For page routes, redirect to login
      return res.redirect('/')
    }

    // Find workspace in session
    const workspace = getWorkspaceByUrlKey(req.session, urlKey)
    if (!workspace) {
      return res.status(404).send(renderWorkspaceNotFoundPage(urlKey, req.session.workspaces || []))
    }

    req.workspace = workspace
    next()
  } catch (error) {
    console.error('Error in workspaceFromUrl middleware:', error)
    if (req.path.includes('/api/')) {
      return res.status(500).json({ error: 'Internal server error' })
    }
    return res.status(500).send(renderErrorPage('Error', 'An unexpected error occurred'))
  }
}

// Mount dispatch routes (requires workspaceFromUrl middleware)
app.use(createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl, userPreferencesStore, harbourFeedbackTokenStore, workspacePreferencesStore, dispatchPresetsStore, proxyTokenStore }))

// Mount proxy routes
// resolveWorkspaceAccess: looks up a workspace access token from active sessions
// AND recovers WHY a lookup failed, so callers can surface an actionable signal
// (LIN-417) instead of an opaque null. Returns { token, reason, provider }:
//   ok               → token present (success path)
//   store_unreachable → session store find() threw (dyno booting post-deploy) — transient
//   session_expired   → a session referenced this workspace but its token expired — re-auth
//   not_connected     → no session references this workspace — never connected
//   owner_mismatch    → the owner has no live token, but a DIFFERENT account does. A
//                       SIGNAL, not a proof: it fires both when the owner account genuinely
//                       no longer holds this workspace (re-auth cannot fix it) and when the
//                       owner's own token merely lapsed while a legitimate colleague on the
//                       same workspace is live (re-auth CAN fix it). The session data cannot
//                       tell those apart — do not claim it can; see detectOwnerAccountMismatch
//                       and lib/errors.js's hedged owner_mismatch detail (LIN-1413)
//   owner_signed_out  → the owner has no session row at all (not scoped to this workspace).
//                       Reclassified from not_connected: honest about the real remedy (sign
//                       in again, or issue a fresh token) instead of implying the workspace
//                       was never connected. Also a SIGNAL, not proof of permanent loss — see
//                       detectOwnerSignedOut and lib/errors.js's owner_signed_out detail
//                       (LIN-1506). Unreachable whenever owner_mismatch also fires — that
//                       reason wins the overlap; see classifyWorkspaceFailure's ordering.
// `provider` is the matched workspace's provider name (e.g. 'linear'), or null
// when no session referenced the workspace. It lets the session-less consumer
// proxy resolve the provider per workspace via getProviderForWorkspace (LIN-581),
// instead of hardwiring Linear. It is captured from any session that referenced
// the workspace — even one whose token expired — so the proxy's capability gate
// (which runs BEFORE the token check on writes) still sees the right provider.
// In test mode, returns { token: 'test-token', reason: 'ok' } for 'test-workspace'.
// Uses a short-lived cache (30s) to avoid scanning sessions on every proxy request.
// The cache only ever holds successes, so it never masks a failure reason.
//
// ownerAccountId (LIN-1366) scopes token selection to a single account — pass the
// UNSCOPED sentinel (the default) for the legacy owner-blind selection
// getWorkspaceAccessToken/routes/test.js still rely on. An explicit owner (incl.
// null, for a legacy proxy token with no creator) is forwarded verbatim to the
// pure selector in lib/workspace-token-resolver.js, which never lets one account
// borrow another's token. The cache is owner-keyed so a scoped lookup can never
// return a different owner's cached token.
const TOKEN_CACHE_TTL_MS = 30 * 1000; // 30 seconds
const workspaceTokenCache = createWorkspaceTokenCache({ ttlMs: TOKEN_CACHE_TTL_MS });

// LIN-1507: prompt (not 30s-fuzzy) cache eviction. Threaded into every
// session-destruction call site so a revoked session's cached token is gone
// immediately rather than served for up to TOKEN_CACHE_TTL_MS after the
// session row is deleted. Takes the pre-computed cache key (see
// workspaceTokenCacheKey) — this wrapper never derives a key itself.
function evictWorkspaceToken(key) {
  workspaceTokenCache.evict(key);
}

// LIN-1373: TTL-preserving persist-back for refresh-on-resolve. Deliberately
// NOT sessionStore.set() (lib/session-store.js's MongoSessionStore.set), which
// ALWAYS rewrites `expires` to now+30d on every write — routing a background
// agent's refresh through it would silently roll a continuously-polled
// session's TTL forward on every resolve, extending its credential-at-rest
// lifetime toward effectively permanent. That is the durable/no-TTL posture
// LIN-1367's `(c)` deferred; this writes only the refreshed session content,
// leaving the row's existing `expires` — and so the session's original
// 30-day-from-last-human-activity lifetime — untouched. This is the line that
// keeps LIN-1373 inside LIN-1367's settled `(b)` envelope.
function persistSessionRow(sid, session) {
  return sessionsCollection.updateOne({ _id: sid }, { $set: { session } });
}

async function resolveWorkspaceAccess(urlKey, ownerAccountId = UNSCOPED) {
  if (process.env.NODE_ENV === 'test' && urlKey === 'test-workspace') {
    return { token: 'test-token', reason: 'ok', provider: 'linear' };
  }

  const cacheKey = workspaceTokenCacheKey(urlKey, ownerAccountId);

  // Check cache first — the factory already applies TTL internally and
  // returns undefined on a miss/expiry, so only the freshness-vs-expiry
  // check (business logic, not cache mechanics) stays here.
  const cached = workspaceTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return { token: cached.token, reason: 'ok', provider: cached.provider };
  }

  // Look up the access token from the sessions collection, scoped to
  // ownerAccountId (or owner-blind for UNSCOPED) via the pure selector.
  try {
    const sessions = await sessionsCollection.find({}).toArray();
    const selected = selectOwnerWorkspaceToken(sessions, urlKey, ownerAccountId);

    if (selected.token) {
      workspaceTokenCache.set(cacheKey, { token: selected.token, expiresAt: selected.expiresAt, provider: selected.provider });
      return { token: selected.token, reason: 'ok', provider: selected.provider };
    }

    // LIN-1373 refresh-on-resolve, widened LIN-1524: the selector above only
    // ever READS sessions, so a headless proxy token stopped resolving the
    // instant its creator's Linear access token lapsed — only human web
    // activity (ensureValidToken, above) ever refreshed it. `selected.token`
    // is already known falsy here (we returned above if it were truthy), so
    // the predicate is really `ownerAccountId !== UNSCOPED` — written as
    // `!selected.token && ...` to state the intent at the call site: attempt
    // a durable refresh whenever no token resolved AND there's a single owner
    // to refresh on behalf of. LIN-1524 is what makes this reachable for
    // BOTH `session_expired` (a session row exists, expired) and
    // `not_connected` (no session row at all — e.g. after logout): Linear's
    // rotating credential now lives in the durable store regardless of which
    // one applies, so a bare `session_expired` gate would have wrongly kept
    // `not_connected` — the whole point of this ticket — falling straight to
    // a 503 forever. Never for UNSCOPED (legacy owner-blind) callers — there
    // is no single owner to refresh on behalf of. Any failure (nothing to
    // refresh, or the refresh itself failing) falls straight through to the
    // untouched classification below — never a 500, never cached.
    if (!selected.token && ownerAccountId !== UNSCOPED) {
      try {
        const refreshed = await refreshOwnerWorkspaceToken({
          sessions,
          urlKey,
          ownerAccountId,
          refreshAccessToken,
          persistSession: persistSessionRow,
          resolveProvider: getProviderForWorkspace,
          store: ownerCredentialStore
        });
        if (refreshed) {
          workspaceTokenCache.set(cacheKey, { token: refreshed.token, expiresAt: refreshed.expiresAt, provider: refreshed.provider });
          return { token: refreshed.token, reason: 'ok', provider: refreshed.provider };
        }
      } catch (err) {
        console.error(`Token refresh-on-resolve failed for workspace ${urlKey}:`, err);
      }
    }

    // LIN-1413/LIN-1506: after the selector failed and refresh-on-resolve has
    // already been given its chance (both above), reclassify WHY no token
    // resolved into the most honest reason the session data supports —
    // owner_mismatch (a DIFFERENT account holds a live token for this
    // workspace) or owner_signed_out (the owner has no session row at all).
    // Neither is proof the owner lost the workspace, and ordering is
    // load-bearing (owner_mismatch wins any overlap) — see
    // classifyWorkspaceFailure's docstring in lib/workspace-token-resolver.js.
    const reason = classifyWorkspaceFailure({ sessions, urlKey, ownerAccountId, selectedReason: selected.reason });

    // Diagnostic log on EVERY non-ok resolution (not just owner_mismatch, which
    // was the only case that logged before). A bare `not_connected` is genuinely
    // ambiguous — a null-owner token (createdBy:null) and an owner who is signed
    // in but has no session for THIS workspace (the multi-device fork) produce
    // the identical code — so without this breadcrumb a WORKSPACE_NOT_CONNECTED
    // incident is un-diagnosable from the logs. The summary is secret-safe: only
    // the caller's OWN owner id and public workspace slugs, never another
    // account's id or any token bytes (see describeWorkspaceResolution's privacy
    // contract; same boundary lib/errors.js enforces on the wire).
    const diag = describeWorkspaceResolution(sessions, urlKey, ownerAccountId);
    console.warn(`[workspace-access] resolution failed`, {
      selectedReason: selected.reason,
      finalReason: reason,
      ...diag
    });

    // reason/provider are already the right shape for the workspaceUnavailable
    // 503 envelope — see lib/workspace-token-resolver.js.
    return { token: selected.token, reason, provider: selected.provider };
  } catch (err) {
    console.error('Error looking up workspace access token:', err);
    return { token: null, reason: 'store_unreachable', provider: null };
  }
}

// Thin wrapper preserving the token-only contract for existing callers
// (routes/test.js). Unchanged behaviour.
async function getWorkspaceAccessToken(urlKey) {
  return (await resolveWorkspaceAccess(urlKey)).token;
}

// Short-lived in-process memo for the workspace issue set (LIN-632). The
// session-context drill-in fetches ALL of a workspace's projects+issues live
// from Linear; without this, every repeat drill-in (and the 5s observation poll
// behind it) refetched the whole workspace. A ~30s TTL is longer than the poll
// cadence so warm drill-ins reuse, but short enough to stay fresh. Keyed by
// workspace id (urlKey fallback). Bypassed in test mode (deterministic mock).
const WORKSPACE_ISSUES_MEMO_TTL_MS = 30 * 1000;
const _workspaceIssuesMemo = new Map(); // key → { issues, cachedAt }

// Load a workspace's canonical issue set (the dashboard session-context endpoint,
// LIN-593). Mirrors the Context API's data path: test-token workspaces read the
// Linear-shaped mock, real ones read through the provider. Returns [] defensively.
async function fetchWorkspaceIssues(workspace) {
  if (!workspace) return [];
  const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
  if (isTestMode) return testMockData.issues;

  const memoKey = workspace.id || workspace.urlKey;
  if (memoKey) {
    const hit = _workspaceIssuesMemo.get(memoKey);
    if (hit && Date.now() - hit.cachedAt < WORKSPACE_ISSUES_MEMO_TTL_MS) {
      return hit.issues;
    }
  }
  const { issues } = await getProviderForWorkspace(workspace).fetchProjects(getWorkspaceCallScope(workspace));
  const result = issues || [];
  if (memoKey) _workspaceIssuesMemo.set(memoKey, { issues: result, cachedAt: Date.now() });
  return result;
}

// LIN-962: the off-session title-resolution glue (session scan → latest-expiring-
// token workspace pick → memoized fetchWorkspaceIssues → {identifier → title} map)
// lives in lib/workspace-title-resolver.js so its REAL wiring is unit-testable with
// a fake Linear client (not a reimplementation). Constructed with the real deps
// here; behaviour is byte-identical to the former inline functions.
const _workspaceTitleResolver = createWorkspaceTitleResolver({
  sessionsCollection,
  fetchWorkspaceIssues,
  tokenRefreshBufferMs: TOKEN_REFRESH_BUFFER_MS
});

// Hoisted wrapper so the materializer wiring earlier in source order can reference
// `resolveWorkspaceTitles` (invoked only at write time, long after this const is
// assigned during module init).
function resolveWorkspaceTitles(urlKey) {
  return _workspaceTitleResolver.resolveWorkspaceTitles(urlKey);
}

// getWorkspaceOpenRouterKey: thin server-env wrapper around the extracted resolver
// (lib/openrouter-key-resolver.js, LIN-1352). The `urlKey === 'test-workspace'`
// short-circuit is a server/test-env concern, not part of the resolver's identity,
// so it stays here rather than in the injectable seam (whose mandated signature
// omits urlKey). Authorization is already enforced by the workspace-scoped proxy
// token's creator binding.
async function getWorkspaceOpenRouterKey(urlKey, accountId) {
  if (process.env.NODE_ENV === 'test' && urlKey === 'test-workspace') {
    return null;
  }

  return resolveOpenRouterKey(userPreferencesStore, accountId);
}

app.use(createProxyRoutes({ proxyTokenStore, proxyEventStore, agentStatusStore, recapCacheStore, briefCacheStore, taskSnapshotStore, dispatchQueueStore, workspaceFromUrl, getWorkspaceAccessToken, resolveWorkspaceAccess, getWorkspaceOpenRouterKey, workspacePreferencesStore, dispatchPresetsStore, freeTierStore }))

// Mount workspace API routes (audit, prompts, recommendations, comments, images)
app.use(createWorkspaceApiRoutes({ workspaceFromUrl, freeTierStore, getOpenRouterSource, userPreferencesStore, workspacePreferencesStore, customPromptsStore, recapCacheStore, briefCacheStore, reportHistoryStore, dispatchQueueStore, agentStatusStore, promptTraceStore, proxyTokenStore }))

// Mount collective routes (experimental cross-project discussion — LIN-450).
// yapClient is null when YAP_BASE_URL is unset; the routes degrade gracefully.
const yapClient = yapClientFromEnv()
app.use(createCollectiveRoutes({ workspaceFromUrl, dispatchQueueStore, proxyTokenStore, collectiveCharactersStore, collectivePresetsStore, yapClient, getOpenRouterSource, getDeployInfo, workspacePreferencesStore }))

// Mount dashboard routes (experimental combined realtime autopilot dashboard — LIN-509).
// Merges Mongo-only Loop reads across session.workspaces; Linear is hydrated lazily
// (drill-down only), never fanned out per poll.
app.use(createDashboardRoutes({ workspaceFromUrl, dispatchQueueStore, agentStatusStore, observationSessionsStore, observationMaterializer, sessionsFeedCache, runSummaryCacheStore, sessionSummaryCacheStore, briefCacheStore, recapCacheStore, freeTierStore, getWorkspaceAccessToken, fetchIssueContext, fetchWorkspaceIssues, getOpenRouterSource, getDeployInfo, workspacePreferencesStore }))

// Mount task-chat routes (experimental "talk to a task" conversation).
app.use(createTaskChatRoutes({ workspaceFromUrl, freeTierStore, workspacePreferencesStore, getOpenRouterSource, getDeployInfo, savedChatStore, recapCacheStore, briefCacheStore, dispatchQueueStore, agentStatusStore, proxyTokenStore }))

// Mount next-run routes (experimental "suggest the next autopilot run" — LIN-603).
app.use(createNextRunRoutes({ workspaceFromUrl, freeTierStore, workspacePreferencesStore, getOpenRouterSource, getDeployInfo, reportHistoryStore }))

// Mount flight-companion routes (experimental prototype for LIN-751 realtime chat — LIN-922).
app.use(createFlightCompanionRoutes({ workspaceFromUrl, getOpenRouterSource, getDeployInfo }))

// Mount live-console routes (experimental ambient "watch the swarm" feed — LIN-1436).
app.use(createLiveConsoleRoutes({ workspaceFromUrl, agentStatusStore, dispatchQueueStore, getOpenRouterSource, getDeployInfo }))

// The Ship's Biscuit (experimental, LIN-818): flag-gated LLM-set newspaper — a
// deterministic edition model over the wired event stores + one editor-in-chief
// call → durable front page + index. Mirrors next-run's free-tier/model wiring.
app.use(createShipBiscuitRoutes({ workspaceFromUrl, freeTierStore, workspacePreferencesStore, getOpenRouterSource, getDeployInfo, observationSessionsStore, agentStatusStore, llmCallLogStore, taskSnapshotStore, reportHistoryStore, shipBiscuitHistoryStore }))

/**
 * Workspace project view - renders the interactive tree view.
 *
 * Query parameters:
 * - team: Optional team ID to filter issues by (or 'all' for all teams)
 */
app.get('/workspace/:urlKey/', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace
  const deployInfo = getDeployInfo()

  // Parse and validate team filter from query string (must be valid UUID)
  const rawTeam = req.query.team;
  let teamId = rawTeam && rawTeam !== 'all' && UUID_REGEX.test(rawTeam) ? rawTeam : null;

  // Remember team selection per {user, workspace} (LIN-727). An explicit ?team=
  // param (including 'all') is the source of truth and is persisted; when the
  // param is absent we restore the prior selection so leaving a workspace and
  // returning preserves the filter. Best-effort: persistence never blocks the page.
  const accountId = req.session.accountId;
  if (accountId) {
    if (rawTeam !== undefined) {
      userPreferencesStore.setSelectedTeam(accountId, workspace.urlKey, teamId)
        .catch(err => console.error('Failed to persist team selection:', err));
    } else {
      try {
        const remembered = await userPreferencesStore.getSelectedTeam(accountId, workspace.urlKey);
        if (remembered && UUID_REGEX.test(remembered)) teamId = remembered;
      } catch (err) {
        console.error('Failed to read remembered team selection:', err);
      }
    }
  }

  // Determine OpenRouter connection status for nav bar
  const openRouterSource = getOpenRouterSource(req);

  try {
    // Load custom prompts (non-blocking, fallback to empty)
    let customPrompts = [];
    try {
      customPrompts = (await customPromptsStore.list(workspace.urlKey)).map(p => ({ id: p.id, name: p.name }));
    } catch (e) { /* non-fatal */ }

    const { trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId, showSource } = await fetchAndPrepareProjects(workspace, teamId, null, workspace.urlKey, { slim: true });
    const isLocalhost = ['localhost', '127.0.0.1'].some(h => req.get('host')?.startsWith(h));
    const html = renderPage(trees, inProgressTrees, recentActivityTrees, organizationName, {
      teams,
      selectedTeamId,
      workspaces: req.session.workspaces,
      openRouterSource,
      deployInfo,
      urlKey: workspace.urlKey,
      featureFlags: getFeatureFlags(req.session),
      customPrompts,
      isLocalhost,
      showSource
    });
    res.send(html);
  } catch (error) {
    console.error('Error fetching projects:', error);

    // Handle 401 Unauthorized - attempt refresh or remove workspace
    if (isAuthError(error)) {
      return handleUnauthorizedError(workspace, req.session, teamId, openRouterSource, res);
    }

    // Generic error - show a classified, self-diagnosing error page so an
    // upstream Linear-connectivity blip reads as transient ("try again"),
    // distinct from an internal bug, and carries a safe diagnostic to quote.
    console.error('Main route error:', error);
    const html = renderUpstreamAwareErrorPage(error, {
      defaultMessage: 'Could not load your projects. Please try again or re-authenticate.',
      action: 'Try again',
      actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/`
    });
    res.status(500).send(html);
  }
})

// =============================================================================
// Workspace-Prefixed Dashboard Routes
// =============================================================================

/**
 * Swipe page - mobile-first task card swiping with prompts.
 * Displays tasks as swipeable cards with integrated prompt generation.
 */
app.get('/workspace/:urlKey/swipe/:identifier?', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const openRouterSource = getOpenRouterSource(req);

  // Parse team filter (same as main dashboard)
  const rawTeam = req.query.team;
  const teamId = rawTeam && rawTeam !== 'all' && UUID_REGEX.test(rawTeam) ? rawTeam : null;

  try {
    // Load custom prompts (non-blocking, fallback to empty)
    let customPrompts = [];
    try {
      customPrompts = (await customPromptsStore.list(workspace.urlKey)).map(p => ({ id: p.id, name: p.name }));
    } catch (e) { /* non-fatal */ }

    // Fetch projects and dispatched-session counts in parallel. The counts feed
    // each card's "Dispatched Sessions [N]" header (no per-card fetch). Counts
    // are non-critical — a store hiccup must never break the page, so fall back
    // to an empty map.
    const [{ trees, inProgressTrees, recentActivityTrees, organizationName }, allLoops] = await Promise.all([
      fetchAndPrepareProjects(workspace, teamId),
      getLoopsForWorkspace(workspace.urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore }).catch(() => [])
    ]);
    const sessionCounts = buildSessionCounts(allLoops);
    const isLocalhost = ['localhost', '127.0.0.1'].some(h => req.get('host')?.startsWith(h));
    const html = renderSwipePage(
      { projectTrees: trees, inProgressTrees, recentActivityTrees, organizationName },
      {
        deployInfo,
        urlKey: workspace.urlKey,
        openRouterSource,
        workspaces: req.session.workspaces,
        featureFlags: getFeatureFlags(req.session),
        customPrompts,
        initialIdentifier: req.params.identifier || null,
        isLocalhost,
        sessionCounts
      }
    );
    res.send(html);
  } catch (error) {
    console.error('Swipe page error:', error);

    if (isAuthError(error)) {
      return handleUnauthorizedError(workspace, req.session, teamId, openRouterSource, res);
    }

    const html = renderUpstreamAwareErrorPage(error, {
      defaultMessage: 'Could not load your tasks. Please try again.',
      action: 'Try again',
      actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/swipe`
    });
    res.status(500).send(html);
  }
});

/**
 * Swim page - requires authentication.
 * Displays tasks in horizontal swim lanes for sequencing and parallelism.
 * Prototype: not linked from navigation.
 */
app.get('/workspace/:urlKey/swim', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const openRouterSource = getOpenRouterSource(req);
  const rawTeam = req.query.team;
  const teamId = rawTeam && rawTeam !== 'all' && UUID_REGEX.test(rawTeam) ? rawTeam : null;

  try {
    // Use swim sample data if session flag is set (for E2E tests/screenshots)
    const mockOverride = req.session.swimSample ? swimSampleData : null;
    const { trees, inProgressTrees, recentActivityTrees, organizationName } = await fetchAndPrepareProjects(workspace, teamId, mockOverride);
    const html = renderSwimPage(
      { projectTrees: trees, inProgressTrees, recentActivityTrees, organizationName },
      {
        deployInfo,
        urlKey: workspace.urlKey,
        openRouterSource,
        workspaces: req.session.workspaces,
        featureFlags: getFeatureFlags(req.session)
      }
    );
    res.send(html);
  } catch (error) {
    console.error('Swim page error:', error);

    if (isAuthError(error)) {
      return handleUnauthorizedError(workspace, req.session, teamId, openRouterSource, res);
    }

    const html = renderUpstreamAwareErrorPage(error, {
      defaultMessage: 'Could not load your tasks. Please try again.',
      action: 'Try again',
      actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/swim`
    });
    res.status(500).send(html);
  }
});

/**
 * Ship page - requires authentication.
 * Radial view: in-progress items at the centre, everything else orbiting by priority and sector.
 * Prototype: not linked from navigation.
 */
app.get('/workspace/:urlKey/ship', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const openRouterSource = getOpenRouterSource(req);

  // Gate: ship is an experimental, in-development view surfaced via Settings
  // (LIN-496). When the flag is off, redirect to settings — mirrors collective.
  if (getFeatureFlags(req.session).ship !== true) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
  }

  const rawTeam = req.query.team;
  const teamId = rawTeam && rawTeam !== 'all' && UUID_REGEX.test(rawTeam) ? rawTeam : null;

  try {
    // shipSample = dense fixture (8 projects, 6 WIP, ~36 cards) for density tests.
    // swimSample = leaner fixture reused from the swim view.
    const mockOverride = req.session.shipSample ? shipDenseSampleData
      : req.session.swimSample ? swimSampleData
      : null;
    const { trees, inProgressTrees, recentActivityTrees, organizationName } =
      await fetchAndPrepareProjects(workspace, teamId, mockOverride);

    // Orientation mode (LIN-301): a pure read of the newest saved roadmap report
    // that actually carries bearings (LIN-1228) — no LLM call on the ship side
    // (see LIN-298). getLatest() would return the newest report regardless of
    // whether it has orientation, which hides the last known-good bearings
    // behind a degraded regenerated report (no north star / free tier / stream
    // failure save orientation: []); getLatestWithOrientation() skips those.
    // The client maps the saved bearings to angles; absence (no report has ever
    // had bearings) just leaves the toggle inert.
    const latestReport = await reportHistoryStore.getLatestWithOrientation(workspace.urlKey);

    const html = renderShipPage(
      { projectTrees: trees, inProgressTrees, recentActivityTrees, organizationName },
      {
        deployInfo,
        urlKey: workspace.urlKey,
        openRouterSource,
        workspaces: req.session.workspaces,
        featureFlags: getFeatureFlags(req.session),
        orientation: latestReport?.orientation || [],
        orientationMeta: latestReport
          ? { generatedAt: latestReport.generatedAt, northStar: latestReport.northStar, model: latestReport.model }
          : null
      }
    );
    res.send(html);
  } catch (error) {
    console.error('Ship page error:', error);

    if (isAuthError(error)) {
      return handleUnauthorizedError(workspace, req.session, teamId, openRouterSource, res);
    }

    const html = renderUpstreamAwareErrorPage(error, {
      defaultMessage: 'Could not load your tasks. Please try again.',
      action: 'Try again',
      actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/ship`
    });
    res.status(500).send(html);
  }
});

/**
 * Roadmap page - requires authentication.
 * Displays projected timeline, velocity, critical paths, and AI narrative.
 */
app.get('/workspace/:urlKey/roadmap', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const openRouterSource = getOpenRouterSource(req);
  const featureFlags = getFeatureFlags(req.session);

  if (!featureFlags.roadmap) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/`);
  }

  const rawTeam = req.query.team;
  const teamId = rawTeam && rawTeam !== 'all' && UUID_REGEX.test(rawTeam) ? rawTeam : null;

  try {
    // Fetch raw data — roadmap needs raw issues for velocity/queue calculations.
    // In test mode the mock 'test-token' can't reach real Linear, so honor the
    // same testMockData arm fetchAndPrepareProjects and the dispatch route use.
    // LIN-409 migrated the roadmap *e2e* happy-path to a genuine 'local' provider
    // session and dropped this arm from the route; the visual maker deliberately
    // stays on the test-token mock fixtures (not local), so without it this route
    // auth-errors and the roadmap baseline silently captured the landing page.
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const { organizationName, projects, issues } = isTestMode
      ? testMockData
      : await getProviderForWorkspace(workspace).fetchProjects(getWorkspaceCallScope(workspace), teamId);

    // Build roadmap model from deterministic layer
    const roadmapModel = buildRoadmapModel(projects, issues);

    const html = renderRoadmapPage(
      { roadmapModel, organizationName },
      {
        deployInfo,
        urlKey: workspace.urlKey,
        openRouterSource,
        workspaces: req.session.workspaces,
        featureFlags,
        availableModels: AVAILABLE_MODELS
      }
    );
    res.send(html);
  } catch (error) {
    console.error('Roadmap page error:', error);

    if (isAuthError(error)) {
      return handleUnauthorizedError(workspace, req.session, teamId, openRouterSource, res);
    }

    const html = renderUpstreamAwareErrorPage(error, {
      defaultMessage: 'Could not load your roadmap. Please try again.',
      action: 'Try again',
      actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/roadmap`
    });
    res.status(500).send(html);
  }
});

/**
 * Operator Dashboard page - requires authentication.
 * Displays workspace audit and health check functionality.
 */
app.get('/workspace/:urlKey/audit', workspaceFromUrl, (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const openRouterSource = getOpenRouterSource(req);

  const html = renderAuditPage(workspace.name || 'Workspace', {
    deployInfo,
    urlKey: workspace.urlKey,
    openRouterSource,
    workspaces: req.session.workspaces,
    featureFlags: getFeatureFlags(req.session)
  });
  res.send(html);
});

/**
 * Settings page - requires authentication.
 * Displays user preferences and AI configuration.
 */
/**
 * Translate provider-action redirect query params into a settings-page notice
 * for the Providers section (LIN-634). The provider-action POST handlers redirect
 * back with one of these flags; the renderer escapes the text, so the derived
 * messages (not raw query echoes) keep it injection-safe.
 * @param {Object} query - req.query
 * @returns {{type: 'ok'|'fail'|'blocked', text: string}|null}
 */
function providerNoticeFromQuery(query = {}) {
  if (query.provider_blocked) {
    return { type: 'blocked', text: `Adding ${query.provider_blocked} is not available yet.` };
  }
  if (query.provider_removed) {
    return { type: 'ok', text: `Removed ${query.provider_removed} binding.` };
  }
  if (query.provider_switched) {
    return { type: 'ok', text: `Switched active provider to ${query.provider_switched}.` };
  }
  if (query.provider_ok) {
    return { type: 'ok', text: `${query.provider_ok} credentials are valid.` };
  }
  if (query.provider_fail) {
    return { type: 'fail', text: `${query.provider_fail} credentials failed validation.` };
  }
  if (query.provider_error) {
    return { type: 'fail', text: 'Provider action could not be completed.' };
  }
  return null;
}

app.get('/workspace/:urlKey/settings', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;

  // Determine OpenRouter connection status
  const openRouterSource = getOpenRouterSource(req);
  const deployInfo = getDeployInfo();

  // Get current workspace model selection (helper handles default)
  const currentModel = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore });

  // Get current workspace-scoped feature flags (helper handles defaults).
  // Read from WorkspacePreferencesStore, NOT from session — these are
  // workspace-scoped, not per-user.
  const workspaceFeatures = await getWorkspaceFeatures({ urlKey: workspace.urlKey, store: workspacePreferencesStore });

  // Check for model validation error from redirect
  const modelError = req.query.error;

  // LLM usage KPIs (LIN-418): aggregate per-call metadata over the retained window.
  const llmStats = await llmCallLogStore.summarize(workspace.urlKey);

  // Provider bindings for the Providers management section (LIN-634). Shape each
  // binding with its provider's human displayName (registry); the masked-token
  // and active-marker presentation lives in the renderer. Mark the binding whose
  // provider matches the workspace's active pointer AND whose credential is the one
  // mirrored into the scalar fields — provider-name alone would mark two same-provider
  // bindings active at once (mirrors remintActiveCredential's active-binding match).
  const providerBindings = getBindingsForWorkspace(workspace).map(b => ({
    provider: b.provider,
    scope: b.scope,
    displayName: getProvider(b.provider)?.ui?.displayName || b.provider,
    token: b.credentials?.token,
    active: b.provider === workspace.provider && b.credentials?.token === workspace.accessToken,
  }));
  const providerNotice = providerNoticeFromQuery(req.query);

  // Dispatch model/harness defaults (LIN-1095): the model/harness dispatched
  // agents execute WITH, distinct from currentModel above (which writes
  // prompts). Own read of workspacePreferencesStore — currentModel/
  // workspaceFeatures above already read it via their own established helpers
  // (resolveWorkspaceModel/getWorkspaceFeatures, used at ~20 other call sites),
  // so this stays a separate, targeted read rather than reshaping those.
  const dispatchDefaultsPrefs = await workspacePreferencesStore.getWorkspacePreferences(workspace.urlKey);
  const dispatchDefaults = dispatchDefaultsPrefs.dispatchDefaults || {};
  const dispatchDefaultsError = req.query.dispatchDefaultsError || null;

  // Dispatch presets (LIN-1391 S7): named, workspace-scoped saved routing
  // configs, listed beside Dispatch defaults. Non-fatal on failure — the
  // section just renders empty, mirroring the dispatchDefaults read above.
  let dispatchPresets = [];
  try {
    dispatchPresets = dispatchPresetsStore ? await dispatchPresetsStore.list(workspace.urlKey) : [];
  } catch (e) {
    // Non-fatal
  }

  // AI model overrides (LIN-1145): per-operation model overrides read from the
  // same prefs object as dispatchDefaults, keyed under aiModelOverrides.
  const aiModelOverrides = dispatchDefaultsPrefs.aiModelOverrides || {};
  const aiOverridesError = req.query.aiOverridesError || null;

  // Live OpenRouter model catalog (LIN-1111 Session 2): the same cache module
  // the dispatch-time client controls fetch via /api/openrouter/models, called
  // here directly since Settings renders server-side. Supplements (never
  // replaces) the static DISPATCH_MODEL_SUGGESTIONS datalist in
  // renderDispatchDefaultsSection. Mocked in tests via the same predicate that
  // gates the AI recommendation mock, so this never makes a live network call
  // during automated test runs.
  const dispatchModelCatalog = await getModelCatalog({ mock: shouldMockAi(workspace) });

  const html = renderSettingsPage(workspace.name || 'Workspace', {
    openRouterConnected: !!(openRouterSource === 'oauth' || openRouterSource === 'env'),
    openRouterSource,
    deployInfo,
    currentModel,
    availableModels: AVAILABLE_MODELS,
    modelError,
    urlKey: workspace.urlKey,
    workspaces: req.session.workspaces,
    featureFlags: getFeatureFlags(req.session),
    workspaceFeatures,
    llmStats,
    providerBindings,
    providerNotice,
    dispatchDefaults,
    dispatchDefaultsError,
    dispatchModelCatalog,
    aiModelOverrides,
    aiOverridesError,
    dispatchPresets,
    // Gate the GitHub add affordance on the SAME shared predicate the /auth/github
    // route guard and landing hero use (LIN-761), so the settings page never offers
    // an add that would 503/hang on a server where GitHub isn't fully configured.
    githubEnabled: isGitHubConfigured()
  });
  res.send(html);
});

/**
 * Prompts page - requires authentication.
 * Displays all prompt templates organized by category.
 */
app.get('/workspace/:urlKey/prompts', workspaceFromUrl, (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const openRouterSource = getOpenRouterSource(req);

  const html = renderPromptsPage(workspace.name || 'Workspace', {
    deployInfo,
    urlKey: workspace.urlKey,
    openRouterSource,
    workspaces: req.session.workspaces,
    featureFlags: getFeatureFlags(req.session)
  });
  res.send(html);
});

/**
 * Custom Prompts page - requires authentication.
 * Allows users to create, edit, and delete custom prompt templates.
 */
app.get('/workspace/:urlKey/prompts/custom', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const openRouterSource = getOpenRouterSource(req);

  // Load user's custom prompts
  let customPrompts = [];
  try {
    customPrompts = await customPromptsStore.list(workspace.urlKey);
  } catch (e) {
    // Non-fatal: page works without existing prompts
  }

  const html = renderCustomPromptsPage(workspace.name || 'Workspace', {
    customPrompts,
    deployInfo,
    urlKey: workspace.urlKey,
    openRouterSource,
    workspaces: req.session.workspaces,
    featureFlags: getFeatureFlags(req.session)
  });
  res.send(html);
});

/**
 * Dispatch page - requires authentication and dispatch feature flag.
 * Displays dispatch prompt, queue, tokens, and history.
 */
app.get('/workspace/:urlKey/dispatch', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const openRouterSource = getOpenRouterSource(req);
  const featureFlags = getFeatureFlags(req.session);

  // Guard: dispatch feature must be enabled
  if (featureFlags.dispatch !== true) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
  }

  // Fetch project repos for the repo selector
  let projectRepos = [];
  try {
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const projects = isTestMode ? testMockData.projects : await getProviderForWorkspace(workspace).fetchProjectsList(getWorkspaceCallScope(workspace));
    projectRepos = projects
      .map(p => ({ name: p.name, repo: parseRepoFromDescription(p.content) }))
      .filter(p => p.repo);
  } catch (e) {
    // Non-fatal: dispatch page works without repo selector
  }

  const isLocalhost = ['localhost', '127.0.0.1'].some(h => req.get('host')?.startsWith(h));

  // Workspace-wide dispatch defaults (LIN-1094), used only for the model/harness
  // placeholder nicety (LIN-1096) — non-load-bearing, so a failed read just
  // leaves the controls with generic placeholders.
  let dispatchDefaults = { model: null, harness: null };
  try {
    dispatchDefaults = await resolveDispatchDefaults({ urlKey: workspace.urlKey, store: workspacePreferencesStore });
  } catch (e) {
    // Non-fatal
  }

  const html = renderDispatchPage(workspace.name || 'Workspace', {
    deployInfo,
    urlKey: workspace.urlKey,
    openRouterSource,
    workspaces: req.session.workspaces,
    featureFlags,
    projectRepos,
    isLocalhost,
    dispatchDefaults
  });
  res.send(html);
});

/**
 * Proxy page - requires authentication and proxy feature flag.
 * Displays proxy token management, agent prompt, and event log.
 */
app.get('/workspace/:urlKey/proxy', workspaceFromUrl, (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const openRouterSource = getOpenRouterSource(req);
  const featureFlags = getFeatureFlags(req.session);

  // Guard: proxy feature must be enabled
  if (featureFlags.proxy !== true) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
  }

  const html = renderProxyPage(workspace.name || 'Workspace', {
    deployInfo,
    urlKey: workspace.urlKey,
    openRouterSource,
    workspaces: req.session.workspaces,
    featureFlags,
    baseUrl: `${req.protocol}://${req.get('host')}`
  });
  res.send(html);
});

/**
 * Save the workspace AI model selection.
 * Persists to the workspace preferences store so all LLM call sites
 * (UI + proxy) see the same value.
 * Accepts either a preset model ID or a custom model ID.
 */
app.post('/workspace/:urlKey/settings/model', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;

  const { modelId, customModelId } = req.body;

  // Use custom model ID if provided, otherwise use selected preset
  let selectedModel = customModelId?.trim() || modelId;

  // Validate model ID format: provider/model (with optional :variant)
  // Example: anthropic/claude-sonnet-4, meta-llama/llama-3.3-70b-instruct:free
  // Dots allowed for version numbers (e.g., claude-3.5-sonnet) but not consecutive (..)
  const modelIdRegex = /^[a-z0-9-]+\/[a-z0-9.-]+(?::[a-z0-9-]+)?$/i;

  // Validate and provide feedback on failure
  if (!selectedModel) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?error=empty`);
  }

  if (selectedModel.length > 100) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?error=too-long`);
  }

  // Reject path traversal sequences
  if (selectedModel.includes('..')) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?error=invalid-format`);
  }

  if (!modelIdRegex.test(selectedModel)) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?error=invalid-format`);
  }

  // Validation passed — save the model to workspace preferences.
  // This is workspace-scoped (shared across all users of the org) so the
  // selection applies to both UI and proxy/agent traffic.
  try {
    const existingPrefs = await workspacePreferencesStore.getWorkspacePreferences(workspace.urlKey);
    const ok = await workspacePreferencesStore.saveWorkspacePreferences(workspace.urlKey, {
      ...existingPrefs,
      modelId: selectedModel
    });
    if (!ok) throw new Error('saveWorkspacePreferences returned false');
  } catch (err) {
    console.error('Failed to save workspace model preference:', err);
    return res.status(500).send(renderErrorPage('Settings Error', 'Failed to save model preference. Please try again.', {
      action: 'Back to settings',
      actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/settings`
    }));
  }

  res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
});

/**
 * Save workspace-wide + per-prompt-type dispatch model/harness defaults (LIN-1095).
 * Distinct from /settings/model above: that selects the model used to WRITE
 * prompts; this selects the model/harness dispatched agents EXECUTE with,
 * consumed at dispatch time via resolveDispatchDefaults() (LIN-1094). Both
 * fields stay opaque strings (no registry), validated with the same shared
 * validateOpaqueDispatchField() the dispatch/proxy routes use (LIN-1084).
 * Persists via the same read-merge-write discipline as /settings/model so
 * dispatchDefaults never clobbers modelId/features.
 */
app.post('/workspace/:urlKey/settings/dispatch-defaults', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const settingsUrl = `/workspace/${encodeURIComponent(workspace.urlKey)}/settings`;

  const readField = (key) => (req.body[key] || '').trim() || undefined;
  // The free-text "custom harness" input was removed in LIN-1282; the harness is
  // now only ever the select's value (one of the two real harnesses, or blank).
  const readHarness = (selectKey) => (req.body[selectKey] || '').trim() || undefined;

  let hasFieldError = false;
  const validate = (value, name) => {
    if (validateOpaqueDispatchField(value, name, { maxLength: MAX_NAME_LENGTH })) {
      hasFieldError = true;
    }
  };

  const model = readField('defaultModel');
  const harness = readHarness('defaultHarnessSelect');
  validate(model, 'model');
  validate(harness, 'harness');

  // byKind is scoped to DISPATCH_DEFAULT_KINDS (the PROMPT_TEMPLATES step-kinds
  // plus `autopilot`, LIN-1278), both by only ever reading these specific field
  // names (any other posted field is simply never looked at) and defensively at
  // read time in resolveDispatchDefaults.
  const byKind = {};
  for (const kind of DISPATCH_DEFAULT_KINDS) {
    const kindModel = readField(`kind__${kind}__Model`);
    const kindHarness = readHarness(`kind__${kind}__HarnessSelect`);
    validate(kindModel, 'model');
    validate(kindHarness, 'harness');
    if (kindModel || kindHarness) {
      byKind[kind] = {};
      if (kindModel) byKind[kind].model = kindModel;
      if (kindHarness) byKind[kind].harness = kindHarness;
    }
  }

  if (hasFieldError) {
    return res.redirect(`${settingsUrl}?dispatchDefaultsError=invalid-field`);
  }

  const dispatchDefaults = {};
  if (model) dispatchDefaults.model = model;
  if (harness) dispatchDefaults.harness = harness;
  if (Object.keys(byKind).length) dispatchDefaults.byKind = byKind;

  try {
    const existingPrefs = await workspacePreferencesStore.getWorkspacePreferences(workspace.urlKey);
    const ok = await workspacePreferencesStore.saveWorkspacePreferences(workspace.urlKey, {
      ...existingPrefs,
      dispatchDefaults
    });
    if (!ok) throw new Error('saveWorkspacePreferences returned false');
  } catch (err) {
    console.error('Failed to save workspace dispatch defaults:', err);
    return res.status(500).send(renderErrorPage('Settings Error', 'Failed to save dispatch defaults. Please try again.', {
      action: 'Back to settings',
      actionUrl: settingsUrl
    }));
  }

  res.redirect(settingsUrl);
});

/**
 * Save per-operation AI model overrides (LIN-1145).
 * Each of the 6 AI_OPERATION_KINDS gets an optional model override stored
 * under prefs.aiModelOverrides.byKind[op].model. Blank rows signal "inherit
 * the global default" and are NOT stored as empty-string overrides — they
 * are simply omitted from the byKind map. Uses the same session-auth +
 * read-merge-write discipline as /settings/model so aiModelOverrides
 * never clobbers modelId/features/dispatchDefaults.
 */
app.post('/workspace/:urlKey/settings/ai-model-overrides', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const settingsUrl = `/workspace/${encodeURIComponent(workspace.urlKey)}/settings`;
  const modelIdRegex = /^[a-z0-9-]+\/[a-z0-9.-]+(?::[a-z0-9-]+)?$/i;
  const MAX_LENGTH = 100;

  let hasFieldError = false;

  const byKind = {};
  for (const kind of AI_OPERATION_KINDS) {
    const fieldName = `byKind__${kind}__model`;
    const customFieldName = `${fieldName}Custom`;
    const custom = (req.body[customFieldName] || '').trim();
    const select = (req.body[fieldName] || '').trim();
    const model = custom || select || '';

    if (!model) continue;

    if (model.length > MAX_LENGTH || model.includes('..') || !modelIdRegex.test(model)) {
      hasFieldError = true;
      break;
    }

    byKind[kind] = { model };
  }

  if (hasFieldError) {
    return res.redirect(`${settingsUrl}?aiOverridesError=invalid-format`);
  }

  try {
    const existingPrefs = await workspacePreferencesStore.getWorkspacePreferences(workspace.urlKey);
    const aiModelOverrides = Object.keys(byKind).length ? { byKind } : {};
    const ok = await workspacePreferencesStore.saveWorkspacePreferences(workspace.urlKey, {
      ...existingPrefs,
      aiModelOverrides
    });
    if (!ok) throw new Error('saveWorkspacePreferences returned false');
  } catch (err) {
    console.error('Failed to save workspace AI model overrides:', err);
    return res.status(500).send(renderErrorPage('Settings Error', 'Failed to save AI model overrides. Please try again.', {
      action: 'Back to settings',
      actionUrl: settingsUrl
    }));
  }

  res.redirect(settingsUrl);
});

/**
 * Toggle a workspace-scoped feature flag on or off (LIN-340).
 * Accepts { feature, enabled } in body.
 *
 * Mirrors the model handler above: persists to the workspace preferences store
 * (shared across all users of the org), then redirects back to settings. It
 * deliberately does NOT touch session.features, getFeatureFlags(session), or the
 * per-user UserPreferencesStore — workspace features are a separate contract.
 */
app.post('/workspace/:urlKey/settings/workspace-features', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const { feature, enabled } = req.body;

  // Validate workspace feature key
  if (!feature || !isValidWorkspaceFeatureKey(feature)) {
    return res.status(400).json({ error: 'Invalid workspace feature key' });
  }

  const isEnabled = enabled === 'true' || enabled === true;

  // Persist to the workspace preferences store. setWorkspaceFeature preserves
  // every other workspace preference key (e.g. modelId) and every other
  // workspace feature flag while flipping just this one.
  try {
    const ok = await setWorkspaceFeature({
      urlKey: workspace.urlKey,
      featureKey: feature,
      enabled: isEnabled,
      store: workspacePreferencesStore
    });
    if (!ok) throw new Error('setWorkspaceFeature returned false');
  } catch (err) {
    console.error('Failed to save workspace feature toggle:', err);
    return res.status(500).send(renderErrorPage('Settings Error', 'Failed to save workspace feature. Please try again.', {
      action: 'Back to settings',
      actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/settings`
    }));
  }

  // AJAX requests get JSON; regular form submissions get redirect. This is only
  // the response shape the settings-page toggle client (app.js) expects for ALL
  // settings toggles — persistence above is exclusively to workspacePreferencesStore,
  // never to session.features or the per-user store.
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    res.json({ ok: true, feature, enabled: isEnabled });
  } else {
    res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
  }
});

/**
 * Toggle a feature flag on or off.
 * Accepts { feature, enabled } in body.
 * Saves to session and persists to UserPreferencesStore.
 */
app.post('/workspace/:urlKey/settings/features', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const { feature, enabled } = req.body;

  // Validate feature key
  if (!feature || !isValidFeatureKey(feature)) {
    return res.status(400).json({ error: 'Invalid feature key' });
  }

  const isEnabled = enabled === 'true' || enabled === true;

  // Save to session
  if (!req.session.features) {
    req.session.features = {};
  }
  req.session.features[feature] = isEnabled;

  try {
    await saveSession(req.session);
  } catch (err) {
    console.error('Failed to save feature toggle:', err);
    return res.status(500).send(renderErrorPage('Settings Error', 'Failed to save feature toggle. Please try again.', {
      action: 'Back to settings',
      actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/settings`
    }));
  }

  // Best-effort persist to user preferences store for cross-device sync.
  // Non-fatal: session is the authoritative source; preferences are for convenience
  // across devices. If this fails, the toggle still works for the current session.
  if (req.session.accountId) {
    try {
      const existingPrefs = await userPreferencesStore.getUserPreferences(req.session.accountId);
      const existingFeatures = existingPrefs.features || {};
      await userPreferencesStore.saveUserPreferences(req.session.accountId, {
        ...existingPrefs,
        features: {
          ...existingFeatures,
          [feature]: isEnabled
        }
      });
    } catch (err) {
      console.error('Failed to persist feature toggle to preferences store:', err);
    }
  }

  // AJAX requests get JSON; regular form submissions get redirect
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    res.json({ ok: true, feature, enabled: isEnabled });
  } else {
    res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
  }
});

/**
 * Set the global light/dark theme preference (LIN-785).
 *
 * Mirrors the feature-toggle handler above: validate, write the session, set the
 * pre-paint `theme` cookie (the transport the shared shell reads before paint),
 * best-effort persist to UserPreferencesStore for cross-device durability, then
 * JSON for XHR / redirect for a plain form submit. Accepts { theme } in the body.
 */
app.post('/workspace/:urlKey/settings/theme', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const { theme } = req.body;

  if (!VALID_THEMES.includes(theme)) {
    return res.status(400).json({ error: 'Invalid theme' });
  }

  // Session + the pre-paint cookie are the authoritative, immediate path.
  req.session.theme = theme;
  try {
    await saveSession(req.session);
  } catch (err) {
    console.error('Failed to save theme preference:', err);
    return res.status(500).json({ error: 'Failed to save theme preference' });
  }
  setThemeCookie(res, theme);

  // Best-effort durable persist for cross-device sync (non-fatal: the cookie +
  // session already carry the choice for this device/session).
  if (req.session.accountId) {
    try {
      const existingPrefs = await userPreferencesStore.getUserPreferences(req.session.accountId);
      await userPreferencesStore.saveUserPreferences(req.session.accountId, {
        ...existingPrefs,
        theme
      });
    } catch (err) {
      console.error('Failed to persist theme preference to preferences store:', err);
    }
  }

  // AJAX requests get JSON; regular form submissions get redirect
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    res.json({ ok: true, theme });
  } else {
    res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
  }
});

// =============================================================================
// Provider management (LIN-634)
// =============================================================================
//
// Full POST→redirect forms (NOT the XHR feature-toggle flow) that manage a
// workspace's provider bindings over the LIN-562 binding seams. Every mutation of
// the session-backed bindings is persisted with saveSession. The interactive
// add-source linking (GitHub OAuth, the generic oauthIntent.mode:'existing'
// find-or-create branch) is blocked on LIN-541/544 and only scaffolded here.

/**
 * Remove one provider binding from the active workspace. Uses unlinkProvider
 * (per-binding) — never removeWorkspace, which would delete the whole workspace.
 */
app.post('/workspace/:urlKey/settings/providers/remove', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const settingsUrl = `/workspace/${encodeURIComponent(workspace.urlKey)}/settings`;
  const { provider, scope } = req.body;

  if (!provider || !scope) {
    return res.redirect(`${settingsUrl}?provider_error=invalid`);
  }

  // LIN-1524 close-out Finding #2: unlinkProvider no-ops on an unmatched
  // (provider, scope) — it returns `workspace` unchanged in both the removed
  // and no-op cases, so its return value carries no removal signal.
  // getBindingsForWorkspace is NOT safe for this before/after comparison: it
  // SYNTHESIZES a phantom binding whenever `workspace.bindings` is empty/absent
  // (by design, for legacy un-migrated workspaces), so a real removal that
  // empties `workspace.bindings` to `[]` would read back as an unchanged
  // count. The reliable signal is reference identity on the RAW
  // `workspace.bindings` array: unlinkProvider only ever reassigns it (always
  // to a new array, via `.filter()`) on an actual removal, and leaves it
  // byte-identical (same reference, including both undefined) on a no-op.
  const bindingsBefore = workspace.bindings;
  unlinkProvider(workspace, provider, scope);
  const bindingRemoved = workspace.bindings !== bindingsBefore;

  // LIN-1523: unlinking the active Linear binding revokes its durable
  // credential too — the existing session-side delete (inside unlinkProvider,
  // untouched, unlinkProvider stays a pure/sync mutator) stays; this is
  // ADDITIVE alongside it, not a replacement. Scoped to 'linear' only: the
  // durable store is Linear-only by design, so unlinking a non-Linear
  // provider (e.g. github) must not touch it. Gated on `bindingRemoved` too
  // (LIN-1524 close-out Finding #2): a POST with `provider=linear` and a
  // non-matching `scope` must not destroy a durable record whose session
  // binding is still intact.
  if (provider === 'linear' && bindingRemoved) {
    await ownerCredentialStore.delete(req.session.accountId, workspace.urlKey);
  }

  try {
    await saveSession(req.session);
  } catch (err) {
    console.error('Failed to persist provider removal:', err);
    return res.status(500).send(renderErrorPage('Settings Error', 'Failed to remove provider. Please try again.', {
      action: 'Back to settings',
      actionUrl: settingsUrl
    }));
  }

  res.redirect(`${settingsUrl}?provider_removed=${encodeURIComponent(provider)}`);
});

/**
 * Switch the active provider of the viewed workspace to an existing binding
 * (LIN-717). The coexistence fix: bindings already survive an add-source, but
 * nothing could re-point the single active provider the views render. Mirrors the
 * /providers/remove POST→redirect pattern; setActiveProvider moves the active
 * pointer + scalar credential mirror atomically, no-op on an unknown binding.
 */
app.post('/workspace/:urlKey/settings/providers/switch', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const settingsUrl = `/workspace/${encodeURIComponent(workspace.urlKey)}/settings`;
  const { provider, scope } = req.body;

  if (!provider || !scope) {
    return res.redirect(`${settingsUrl}?provider_error=invalid`);
  }

  setActiveProvider(workspace, provider, scope);

  try {
    await saveSession(req.session);
  } catch (err) {
    console.error('Failed to persist provider switch:', err);
    return res.status(500).send(renderErrorPage('Settings Error', 'Failed to switch provider. Please try again.', {
      action: 'Back to settings',
      actionUrl: settingsUrl
    }));
  }

  res.redirect(`${settingsUrl}?provider_switched=${encodeURIComponent(provider)}`);
});

/**
 * Refresh / test a provider binding's auth. Validates the EXISTING credential via
 * a lightweight provider read (fetchViewer, falling back to fetchOrganization) —
 * it invents no new auth mechanism. Reports ok/fail back through the redirect.
 */
app.post('/workspace/:urlKey/settings/providers/refresh', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const settingsUrl = `/workspace/${encodeURIComponent(workspace.urlKey)}/settings`;
  const { provider, scope } = req.body;

  if (!provider || !scope) {
    return res.redirect(`${settingsUrl}?provider_error=invalid`);
  }

  const token = getWorkspaceToken(workspace, provider, scope);
  const providerInstance = getProvider(provider);
  // Validate the EXISTING credential via the first lightweight read the provider
  // actually implements — Linear has fetchViewer, the local provider exposes
  // fetchProjectsList. We invent no new auth mechanism; a successful read means
  // the binding's token authenticates.
  const READ_PROBES = ['fetchViewer', 'fetchOrganization', 'fetchProjectsList'];
  let ok = false;
  if (providerInstance && token) {
    const probe = READ_PROBES.find(m => providerInstance.supports(m));
    if (probe) {
      try {
        await providerInstance[probe](token);
        ok = true;
      } catch (err) {
        ok = false;
      }
    }
  }

  res.redirect(`${settingsUrl}?provider_${ok ? 'ok' : 'fail'}=${encodeURIComponent(provider)}`);
});

/**
 * Add a provider source. Routes an OAuth provider into its auth-begin flow. The
 * GitHub add-source path (LIN-541) carries `mode=add-source` so its callback
 * links the new binding onto THIS workspace rather than creating a new one.
 */
app.post('/workspace/:urlKey/settings/providers/add', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;
  const settingsUrl = `/workspace/${encodeURIComponent(workspace.urlKey)}/settings`;
  const { provider } = req.body;

  // GitHub OAuth begin in add-source mode. Carry the VIEWED workspace's urlKey
  // (this :urlKey route context) so the callback binds onto THIS workspace, not
  // the session's active one — a multi-workspace user viewing A while B is active
  // must bind onto A (LIN-541).
  if (provider === 'github') {
    return res.redirect(`/auth/github?mode=add-source&workspace=${encodeURIComponent(workspace.urlKey)}`);
  }

  // GitHub Projects add-source (LIN-560 Session 2) — the board-picker sibling of
  // the Issues flow, on the same shared GitHub App. Carries the same add-source
  // mode + viewed-workspace urlKey so the callback binds onto THIS workspace.
  if (provider === 'github-projects') {
    return res.redirect(`/auth/github-projects?mode=add-source&workspace=${encodeURIComponent(workspace.urlKey)}`);
  }

  // Linear add-source (LIN-1351): connect an ADDITIONAL Linear org for the
  // signed-in user. Unlike GitHub (which binds a source onto THIS workspace), a
  // 2nd Linear org IS its own workspace — its callback links the org's org-scoped
  // identity onto the CURRENT account without regenerating. Carry the VIEWED
  // workspace's urlKey so the post-link redirect returns to its settings page.
  if (provider === 'linear') {
    return res.redirect(`/auth/linear?mode=add-source&workspace=${encodeURIComponent(workspace.urlKey)}`);
  }

  return res.redirect(`${settingsUrl}?provider_error=unsupported-add`);
});

// =============================================================================
// Legacy Route Redirects
// =============================================================================
app.use(createLegacyRedirects())

// =============================================================================
// Global Error Handler (LIN-608)
// =============================================================================
// Final 4-arg Express error-handling middleware. Any error passed to next(err) —
// including a rejected promise from an async handler wrapped with `.catch(next)`
// (see routes/dashboard.js) — lands here and surfaces as a visible 500 instead of
// crashing the dyno or silently hanging the request. Must be registered last,
// after every route.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  const wantsJson = req.path.includes('/api/') ||
    req.xhr ||
    (req.headers.accept || '').includes('application/json')

  // Honor a client error (4xx) the error already carries — most importantly a
  // malformed / oversized request body, which body-parser throws with
  // `type: 'entity.parse.failed'` / `status: 400` (or `entity.too.large` / 413)
  // BEFORE any route handler runs, so it can only be caught here (LIN-1158).
  // Surfacing it as 500 misleads callers into thinking the server/provider is
  // broken and floods the logs with bogus "Unhandled route error" stacks.
  const clientStatus = clientErrorStatus(err)
  if (clientStatus !== null) {
    // Quiet, single-line log — this is bad input, not a server fault.
    console.warn('Client request error:', req.method, req.originalUrl, '-', clientStatus, err?.type || err?.message)
    const message = clientErrorMessage(clientStatus, err)
    if (wantsJson) {
      res.status(clientStatus).json({ error: message })
    } else {
      res.status(clientStatus).send(renderErrorPage(message, message, { action: 'Go back', actionUrl: req.originalUrl || '/' }))
    }
    return
  }

  // Genuinely unexpected error → full stack + 500 (unchanged path).
  console.error('Unhandled route error:', req.method, req.originalUrl, '-', err?.stack || err)
  if (wantsJson) {
    res.status(500).json({ error: 'Internal server error' })
  } else {
    // Helpful themed fallback page instead of a raw host crash / plain text (LIN-609).
    res.status(500).send(renderErrorPage(
      'Something went wrong',
      'An unexpected error occurred while handling your request. This has been logged. Please try again.',
      { action: 'Try again', actionUrl: req.originalUrl || '/' }
    ))
  }
})

// =============================================================================
// Server Startup
// =============================================================================
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Harbour running at http://localhost:${PORT}`)

  // Start periodic cleanup of expired items (every hour)
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
  setInterval(async () => {
    try {
      const removedCount = await dispatchQueueStore.cleanup()
      if (removedCount > 0) {
        console.log(`Dispatch queue cleanup: removed ${removedCount} expired items`)
      }
    } catch (err) {
      console.error('Dispatch queue cleanup error:', err)
    }
    try {
      const removedCount = await freeTierStore.cleanup()
      if (removedCount > 0) {
        console.log(`Free tier cleanup: removed ${removedCount} expired records`)
      }
    } catch (err) {
      console.error('Free tier cleanup error:', err)
    }
    try {
      const removedCount = await proxyTokenStore.cleanup()
      if (removedCount > 0) {
        console.log(`Proxy token cleanup: removed ${removedCount} expired/consumed tokens`)
      }
    } catch (err) {
      console.error('Proxy token cleanup error:', err)
    }
    try {
      const removedCount = await proxyEventStore.cleanup()
      if (removedCount > 0) {
        console.log(`Proxy event cleanup: removed ${removedCount} expired events`)
      }
    } catch (err) {
      console.error('Proxy event cleanup error:', err)
    }
    try {
      const removedCount = await agentStatusStore.cleanup()
      if (removedCount > 0) {
        console.log(`Agent status cleanup: removed ${removedCount} expired entries`)
      }
    } catch (err) {
      console.error('Agent status cleanup error:', err)
    }
    try {
      const removedCount = await observationSessionsStore.cleanup()
      if (removedCount > 0) {
        console.log(`Observation sessions cleanup: removed ${removedCount} expired derived docs`)
      }
    } catch (err) {
      console.error('Observation sessions cleanup error:', err)
    }
    try {
      const removedCount = await harbourFeedbackTokenStore.cleanup()
      if (removedCount > 0) {
        console.log(`Harbour feedback token cleanup: removed ${removedCount} expired tokens`)
      }
    } catch (err) {
      console.error('Harbour feedback token cleanup error:', err)
    }
  }, CLEANUP_INTERVAL_MS)
})
