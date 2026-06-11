/**
 * Linear Projects Viewer - Express Server
 *
 * Main entry point for the application. Handles:
 * - OAuth 2.0 authentication with Linear
 * - Session management (MongoDB in production, file-based in development)
 * - Fetching and rendering projects/issues from Linear API
 * - Serving static landing page for unauthenticated users
 */
import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { MongoSessionStore } from './lib/session-store.js'
import { UserPreferencesStore } from './lib/user-preferences.js'
import { WorkspacePreferencesStore } from './lib/workspace-preferences.js'
import { DispatchQueueStore } from './lib/dispatch-store.js'
import { CustomPromptsStore } from './lib/custom-prompts-store.js'
import { DispatchTokenStore } from './lib/dispatch-tokens.js'
import { HarbourFeedbackTokenStore } from './lib/harbour-feedback-tokens.js'
import { ProxyTokenStore } from './lib/proxy-tokens.js'
import { ProxyEventStore } from './lib/proxy-events.js'
import { ForemanStore } from './lib/foreman-store.js'
import { FreeTierStore } from './lib/free-tier-store.js'
import { RecapCacheStore } from './lib/recap-cache.js'
import { BriefCacheStore } from './lib/brief-cache.js'
import { ReportHistoryStore } from './lib/report-history-store.js'
import { getProvider, getProviderForWorkspace } from './lib/providers/registry.js'
import './lib/providers/linear/index.js' // side effect: self-registers the Linear provider into the registry
import { localProvider } from './lib/providers/local/index.js' // side effect: self-registers the Local provider; store injected below
import { LocalStore } from './lib/local-store.js'
import { buildForest, partitionCompleted, buildInProgressForest, buildRecentActivityForest, NO_PROJECT_ID, PERIODICALS_PROJECT_ID } from './lib/tree.js'
import { buildPeriodicalNodes } from './lib/periodicals.js'
import { parseRepoFromDescription } from './lib/prompt-formatters.js'
import { renderPage, renderErrorPage, renderWorkspaceNotFoundPage } from './lib/render.js'
import { parseLandingPage } from './lib/parse-landing.js'
import { refreshAccessToken } from './lib/token-refresh.js'
import { UUID_REGEX, getActiveWorkspace, getWorkspaceByUrlKey, validateWorkspaceUrlKey, removeWorkspace, saveSession, updateWorkspaceTokens, getWorkspaceToken } from './lib/workspace.js'
import { createWorkspaceRoutes } from './routes/workspace.js'
import { createOpenRouterAuthRoutes } from './routes/openrouter-auth.js'
import { createDispatchRoutes } from './routes/dispatch.js'
import { createProxyRoutes } from './routes/proxy.js'
import { createTestRoutes } from './routes/test.js'
import { createWorkspaceApiRoutes } from './routes/workspace-api.js'
import { createLegacyRedirects } from './routes/legacy-redirects.js'
import { testMockTeams, testMockData } from './tests/fixtures/mock-data.js'
import { swimSampleData } from './tests/fixtures/swim-sample-data.js'
import { shipDenseSampleData } from './tests/fixtures/ship-dense-sample-data.js'
import { renderAuditPage } from './lib/render-audit.js'
import { renderPrivacyPolicy, renderTermsOfService } from './lib/render-legal.js'
import { renderKpisPage } from './lib/render-kpis.js'
import { collectKpiStats } from './lib/kpi-stats.js'
import { renderSettingsPage } from './lib/render-settings.js'
import { renderPromptsPage } from './lib/render-prompts.js'
import { renderCustomPromptsPage } from './lib/render-custom-prompts.js'
import { renderDispatchPage } from './lib/render-dispatch.js'
import { renderSwipePage } from './lib/render-swipe.js'
import { renderSwimPage } from './lib/render-swim.js'
import { renderShipPage } from './lib/render-ship.js'
import { createPipelineRoutes } from './routes/pipeline.js'
import { getLoopsForWorkspace } from './lib/pipeline-loops.js'
import { buildSessionCounts } from './lib/sessions-view.js'
import { renderRoadmapPage } from './lib/render-roadmap.js'
import { buildRoadmapModel } from './lib/roadmap.js'
import { renderProxyPage } from './lib/render-proxy.js'
import { renderForemanPage } from './lib/render-foreman.js'
import { AVAILABLE_MODELS } from './lib/openrouter.js'
import { resolveWorkspaceModel, getWorkspaceFeatures, isWorkspaceFeatureEnabled, setWorkspaceFeature } from './lib/workspace-preferences.js'
import { getFeatureFlags, isValidFeatureKey, isValidWorkspaceFeatureKey, WORKSPACE_FEATURES } from './lib/feature-defaults.js'

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

/**
 * Get Heroku deploy information from environment variables.
 * Requires `heroku labs:enable runtime-dyno-metadata` to be enabled.
 * @returns {Object} Deploy info object with version, createdAt, commit
 */
function getDeployInfo() {
  return {
    version: process.env.HEROKU_RELEASE_VERSION || null,
    createdAt: process.env.HEROKU_RELEASE_CREATED_AT || null,
    commit: process.env.HEROKU_BUILD_COMMIT || null
  }
}

// =============================================================================
// Landing Page Setup
// =============================================================================
// Pre-render static content for unauthenticated users from content/landing.md.
// This is parsed once at startup to avoid re-parsing on every request.
const landingData = parseLandingPage('./content/landing.md')
const landingForest = buildForest(landingData.issues)
const landingTrees = landingData.projects
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map(project => {
    const { roots } = landingForest.get(project.id) || { roots: [] }
    const { incomplete, completed, completedCount } = partitionCompleted(roots)
    return { project, incomplete, completed, completedCount }
  })

// =============================================================================
// Database & Session Setup
// =============================================================================
// Uses MongoDB in production (via MONGODB_URI) or MangoDB (file-based) in development.
// MangoDB stores data in ./data directory for easy local development without MongoDB.
const dbClient = process.env.MONGODB_URI
  ? new MongoClient(process.env.MONGODB_URI)
  : new MangoClient('./data')

await dbClient.connect()
const db = dbClient.db('linear-viewer')
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

// Foreman status tracking
const foremanStatusCollection = db.collection('foreman-status')
const foremanStore = new ForemanStore({
  collection: foremanStatusCollection
})

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
  app.use(createTestRoutes({ dispatchQueueStore, dispatchTokenStore, freeTierStore, userPreferencesStore, workspacePreferencesStore, customPromptsStore, proxyTokenStore, proxyEventStore, foremanStore, recapCacheStore, briefCacheStore, reportHistoryStore, localStore, getWorkspaceAccessToken }))
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
  if (process.env.OPENROUTER_API_KEY) return 'env';
  if (process.env.OPENROUTER_FREE_TIER_KEY || req.session.freeTierEnabled) return 'free';
  return null;
}

// =============================================================================
// PAT (Personal Access Token) Auto-Login Middleware
// =============================================================================
// When LINEAR_ACCESS_TOKEN is set and the user has no session, auto-create one.

async function ensurePATSession(req, res, next) {
  const pat = process.env.LINEAR_ACCESS_TOKEN;
  if (!pat) return next();
  if (req.session.workspaces?.length > 0) return next();

  // Skip routes that don't need auth
  if (req.path.startsWith('/auth/') || req.path === '/logout' ||
      req.path.startsWith('/test/') || req.path === '/privacy' ||
      req.path === '/terms') {
    return next();
  }

  try {
    const provider = getProvider('linear');
    const [org, viewer] = await Promise.all([
      provider.fetchOrganization(pat),
      provider.fetchViewer(pat)
    ]);

    const workspace = {
      id: org.id,
      name: org.name,
      urlKey: org.urlKey || org.name,
      addedAt: Date.now(),
      accessToken: pat,
      isPAT: true,
      tokenExpiresAt: Number.MAX_SAFE_INTEGER
    };

    req.session.workspaces = [workspace];
    req.session.activeWorkspaceId = workspace.id;
    req.session.linearUserId = viewer.id;

    await saveSession(req.session);
    console.log(`PAT session created for workspace: ${org.name} (${org.urlKey})`);
    next();
  } catch (error) {
    console.error('PAT auto-login failed:', error.message);
    next();
  }
}

app.use(ensurePATSession);

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
    const newTokens = await refreshAccessToken(workspace.refreshToken)

    // Update workspace tokens
    updateWorkspaceTokens(workspace, newTokens)

    await saveSession(req.session)
    console.log(`Token refreshed for workspace ${workspace.id}`)
    next()
  } catch (error) {
    console.error(`Token refresh failed for workspace ${workspace.id}:`, error)

    // Remove failed workspace
    const remaining = removeWorkspace(req.session, workspace.id)

    if (remaining > 0) {
      // Switch to another workspace
      await saveSession(req.session)
      return res.redirect('/')
    }

    // No workspaces left, destroy session
    req.session.destroy(() => res.redirect('/'))
  }
}

// Apply middleware to all routes except auth and logout
// Note: workspace routes need token refresh too (they access Linear API)
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/logout' || req.path === '/privacy' || req.path === '/terms' || req.path === '/kpis') {
    return next();
  }
  ensureValidToken(req, res, next);
});

// =============================================================================
// Route Mounting
// =============================================================================
// Mount extracted route modules
app.use(getProvider('linear').getAuthRouter({ sessionStore, userPreferencesStore }))
app.use(createWorkspaceRoutes({ localStore }))
app.use(createOpenRouterAuthRoutes())
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
async function fetchAndPrepareProjects(workspace, teamId = null, mockOverride = null, urlKey = null) {
  const provider = getProviderForWorkspace(workspace);
  const accessToken = getWorkspaceToken(workspace);
  // Use mock data in test mode to avoid hitting the provider API
  const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';

  // Fetch teams
  const teams = isTestMode
    ? testMockTeams
    : await provider.fetchTeams(accessToken);

  // Fetch projects and issues (filtered by team if specified)
  let { organizationName, projects, issues } = isTestMode
    ? (mockOverride || testMockData)
    : await provider.fetchProjects(accessToken, teamId);

  // In test mode, manually filter issues by team
  if (isTestMode && teamId) {
    issues = issues.filter(i => i.team?.id === teamId);
  }

  // Defensive copy before the synthetic-group injections below (No Project,
  // Periodicals) push onto `projects`. In production `fetchProjects` returns a
  // fresh array each call, but in test mode `projects` is the shared
  // `testMockData.projects` const — mutating it in place leaks a duplicate
  // Periodicals/No-Project entry into every later request (LIN-345).
  projects = [...projects];

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

  return { trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId: teamId, periodicalsEnabled };
}

/**
 * Handles workspace removal after authentication failure.
 * Removes the workspace from session, then either redirects to switch
 * workspace or shows the landing page if no workspaces remain.
 */
async function handleWorkspaceRemoval(session, workspaceId, res) {
  const remaining = removeWorkspace(session, workspaceId);
  const deployInfo = getDeployInfo()

  if (remaining > 0) {
    await saveSession(session);
    return res.redirect('/');
  }

  return new Promise((resolve) => {
    session.destroy((err) => {
      if (err) console.error('Session destroy error:', err);
      const html = renderPage(landingTrees, [], [], landingData.organizationName, { isLanding: true, deployInfo });
      res.send(html);
      resolve();
    });
  });
}

/**
 * Attempts to refresh an expired token and retry the request.
 */
async function handleTokenRefreshAndRetry(workspace, session, teamId, openRouterSource, res) {
  const tokenData = await refreshAccessToken(workspace.refreshToken);
  updateWorkspaceTokens(workspace, tokenData);
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
  const { trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId } = await fetchAndPrepareProjects(workspace, teamId, null, workspace.urlKey);
  const html = renderPage(trees, inProgressTrees, recentActivityTrees, organizationName, {
    teams,
    selectedTeamId,
    workspaces: session.workspaces,
    openRouterSource,
    deployInfo,
    urlKey: workspace.urlKey,
    featureFlags: getFeatureFlags(session),
    customPrompts
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
    session.destroy(() => res.status(401).send(html));
    return;
  }

  if (workspace.refreshToken) {
    try {
      return await handleTokenRefreshAndRetry(workspace, session, teamId, openRouterSource, res);
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

  // Unauthenticated users see the static landing page
  const html = renderPage(landingTrees, [], [], landingData.organizationName, { isLanding: true, deployInfo, setupNotice })
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

// =============================================================================
// KPIs Page (public, no auth required, intentionally unlinked)
// =============================================================================
// Instance-wide aggregate stats. collectKpiStats() is the privacy boundary —
// it returns only counts and app-defined labels, never workspace data. The
// 60-second cache keeps the public route from hammering the DB.
const KPI_CACHE_MS = 60 * 1000
let kpiCache = { at: 0, stats: null }

app.get('/kpis', async (req, res) => {
  try {
    if (!kpiCache.stats || Date.now() - kpiCache.at > KPI_CACHE_MS) {
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
        foremanStatus: foremanStatusCollection,
        freeTier: freeTierCollection,
        recapCache: recapCacheCollection,
        briefCache: briefCacheCollection,
        reportHistory: reportHistoryCollection
      }, { dbBackend: process.env.MONGODB_URI ? 'mongodb' : 'mangodb' })
      kpiCache = { at: Date.now(), stats }
    }
    res.send(renderKpisPage(kpiCache.stats, { deployInfo: getDeployInfo() }))
  } catch (error) {
    console.error('Failed to render KPIs page:', error)
    res.status(500).send(renderErrorPage('Error', 'Could not load instance KPIs. Please try again.'))
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
app.use(createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl, userPreferencesStore, harbourFeedbackTokenStore }))

// Mount proxy routes
// resolveWorkspaceAccess: looks up a workspace access token from active sessions
// AND recovers WHY a lookup failed, so callers can surface an actionable signal
// (LIN-417) instead of an opaque null. Returns { token, reason }:
//   ok               → token present (success path)
//   store_unreachable → session store find() threw (dyno booting post-deploy) — transient
//   session_expired   → a session referenced this workspace but its token expired — re-auth
//   not_connected     → no session references this workspace — never connected
// In test mode, returns { token: 'test-token', reason: 'ok' } for 'test-workspace'.
// Uses a short-lived cache (30s) to avoid scanning sessions on every proxy request.
// The cache only ever holds successes, so it never masks a failure reason.
const _tokenCache = new Map(); // urlKey -> { token, expiresAt, cachedAt }
const TOKEN_CACHE_TTL_MS = 30 * 1000; // 30 seconds

async function resolveWorkspaceAccess(urlKey) {
  if (process.env.NODE_ENV === 'test' && urlKey === 'test-workspace') {
    return { token: 'test-token', reason: 'ok' };
  }

  // Check cache first
  const cached = _tokenCache.get(urlKey);
  if (cached && Date.now() - cached.cachedAt < TOKEN_CACHE_TTL_MS) {
    // Only return if the token hasn't expired
    if (cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return { token: cached.token, reason: 'ok' };
    }
  }

  // Look up the access token from the sessions collection
  // Find the workspace with the latest-expiring token
  try {
    const sessions = await sessionsCollection.find({}).toArray();
    let bestToken = null;
    let bestExpiry = 0;
    let sawUrlKey = false; // did any session reference this workspace at all?

    for (const s of sessions) {
      const data = typeof s.session === 'string' ? JSON.parse(s.session) : s.session;
      const ws = data?.workspaces?.find(w => w.urlKey === urlKey);
      if (!ws) continue;
      sawUrlKey = true;
      if (ws.accessToken && ws.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
        if (ws.tokenExpiresAt > bestExpiry) {
          bestToken = ws.accessToken;
          bestExpiry = ws.tokenExpiresAt;
        }
      }
    }

    if (bestToken) {
      _tokenCache.set(urlKey, { token: bestToken, expiresAt: bestExpiry, cachedAt: Date.now() });
      return { token: bestToken, reason: 'ok' };
    }

    // No usable token. A row referenced this workspace but its token was expired
    // (auth / needs re-auth) vs no row referenced it at all (never connected).
    return { token: null, reason: sawUrlKey ? 'session_expired' : 'not_connected' };
  } catch (err) {
    console.error('Error looking up workspace access token:', err);
    return { token: null, reason: 'store_unreachable' };
  }
}

// Thin wrapper preserving the token-only contract for existing callers
// (pipeline-state.js, routes/pipeline.js, routes/test.js). Unchanged behaviour.
async function getWorkspaceAccessToken(urlKey) {
  return (await resolveWorkspaceAccess(urlKey)).token;
}

// getWorkspaceOpenRouterKey: looks up an OpenRouter API key from active sessions
// for the token creator's session. Only returns a key when the linearUserId matches,
// preventing one user's proxy token from consuming another user's OpenRouter quota.
// Uses a short-lived cache (30s) keyed by urlKey+linearUserId.
const _openRouterKeyCache = new Map(); // "urlKey:linearUserId" -> { key, cachedAt }
const OPENROUTER_KEY_CACHE_TTL_MS = 30 * 1000; // 30 seconds

async function getWorkspaceOpenRouterKey(urlKey, linearUserId) {
  if (process.env.NODE_ENV === 'test' && urlKey === 'test-workspace') {
    return null;
  }

  // Without a creator user ID, we can't safely resolve a personal OAuth key
  if (!linearUserId) {
    return null;
  }

  const cacheKey = `${urlKey}:${linearUserId}`;

  // Check cache first
  const cached = _openRouterKeyCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < OPENROUTER_KEY_CACHE_TTL_MS) {
    return cached.key;
  }

  try {
    const sessions = await sessionsCollection.find({}).toArray();

    for (const s of sessions) {
      const data = typeof s.session === 'string' ? JSON.parse(s.session) : s.session;
      // Only use the key from the token creator's own session
      if (data?.linearUserId !== linearUserId) continue;
      const ws = data?.workspaces?.find(w => w.urlKey === urlKey);
      if (ws && data.openRouterApiKey) {
        _openRouterKeyCache.set(cacheKey, { key: data.openRouterApiKey, cachedAt: Date.now() });
        return data.openRouterApiKey;
      }
    }

    _openRouterKeyCache.set(cacheKey, { key: null, cachedAt: Date.now() });
  } catch (err) {
    console.error('Error looking up workspace OpenRouter key:', err);
  }
  return null;
}

app.use(createProxyRoutes({ proxyTokenStore, proxyEventStore, foremanStore, recapCacheStore, briefCacheStore, dispatchQueueStore, workspaceFromUrl, getWorkspaceAccessToken, resolveWorkspaceAccess, getWorkspaceOpenRouterKey, workspacePreferencesStore }))

// Mount workspace API routes (audit, prompts, recommendations, comments, images)
app.use(createWorkspaceApiRoutes({ workspaceFromUrl, freeTierStore, getOpenRouterSource, userPreferencesStore, workspacePreferencesStore, customPromptsStore, recapCacheStore, briefCacheStore, reportHistoryStore, dispatchQueueStore, foremanStore }))

// Mount pipeline routes (page + JSON polling)
app.use(createPipelineRoutes({ workspaceFromUrl, getWorkspaceAccessToken, dispatchQueueStore, foremanStore, getOpenRouterSource, getDeployInfo, handleUnauthorizedError }))

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
  const teamId = rawTeam && rawTeam !== 'all' && UUID_REGEX.test(rawTeam) ? rawTeam : null;

  // Determine OpenRouter connection status for nav bar
  const openRouterSource = getOpenRouterSource(req);

  try {
    // Load custom prompts (non-blocking, fallback to empty)
    let customPrompts = [];
    try {
      customPrompts = (await customPromptsStore.list(workspace.urlKey)).map(p => ({ id: p.id, name: p.name }));
    } catch (e) { /* non-fatal */ }

    const { trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId } = await fetchAndPrepareProjects(workspace, teamId, null, workspace.urlKey);
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
      isLocalhost
    });
    res.send(html);
  } catch (error) {
    console.error('Error fetching projects:', error);

    // Handle 401 Unauthorized - attempt refresh or remove workspace
    if (error.response?.status === 401) {
      return handleUnauthorizedError(workspace, req.session, teamId, openRouterSource, res);
    }

    // Generic error - show error page
    console.error('Main route error:', error);
    const html = renderErrorPage('Something Went Wrong', 'Could not load your projects. Please try again or re-authenticate.', {
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
      getLoopsForWorkspace(workspace.urlKey, { dispatchStore: dispatchQueueStore, foremanStore }).catch(() => [])
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

    if (error.response?.status === 401) {
      return handleUnauthorizedError(workspace, req.session, teamId, openRouterSource, res);
    }

    const html = renderErrorPage('Something Went Wrong', 'Could not load your tasks. Please try again.', {
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

    if (error.response?.status === 401) {
      return handleUnauthorizedError(workspace, req.session, teamId, openRouterSource, res);
    }

    const html = renderErrorPage('Something Went Wrong', 'Could not load your tasks. Please try again.', {
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

    // Orientation mode (LIN-301): a pure read of the latest saved roadmap report
    // — no LLM call on the ship side (see LIN-298). The client maps these saved
    // bearings to angles; absence (no report yet) just leaves the toggle inert.
    const latestReport = await reportHistoryStore.getLatest(workspace.urlKey);

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

    if (error.response?.status === 401) {
      return handleUnauthorizedError(workspace, req.session, teamId, openRouterSource, res);
    }

    const html = renderErrorPage('Something Went Wrong', 'Could not load your tasks. Please try again.', {
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
    // Fetch raw data — roadmap needs raw issues for velocity/queue calculations
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token';
    const { organizationName, projects, issues } = isTestMode
      ? testMockData
      : await getProviderForWorkspace(workspace).fetchProjects(getWorkspaceToken(workspace), teamId);

    // Build roadmap model from deterministic layer
    const roadmapModel = buildRoadmapModel(projects, issues);

    const html = renderRoadmapPage(
      { roadmapModel, organizationName },
      {
        deployInfo,
        urlKey: workspace.urlKey,
        openRouterSource,
        workspaces: req.session.workspaces,
        featureFlags
      }
    );
    res.send(html);
  } catch (error) {
    console.error('Roadmap page error:', error);

    if (error.response?.status === 401) {
      return handleUnauthorizedError(workspace, req.session, teamId, openRouterSource, res);
    }

    const html = renderErrorPage('Something Went Wrong', 'Could not load your roadmap. Please try again.', {
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
    workspaceFeatures
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
    const projects = isTestMode ? testMockData.projects : await getProviderForWorkspace(workspace).fetchProjectsList(getWorkspaceToken(workspace));
    projectRepos = projects
      .map(p => ({ name: p.name, repo: parseRepoFromDescription(p.content) }))
      .filter(p => p.repo);
  } catch (e) {
    // Non-fatal: dispatch page works without repo selector
  }

  const isLocalhost = ['localhost', '127.0.0.1'].some(h => req.get('host')?.startsWith(h));

  const html = renderDispatchPage(workspace.name || 'Workspace', {
    deployInfo,
    urlKey: workspace.urlKey,
    openRouterSource,
    workspaces: req.session.workspaces,
    featureFlags,
    projectRepos,
    isLocalhost
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
 * Foreman page - requires authentication and proxy feature flag.
 * Displays foreman playbook, status log, and stack preview.
 */
app.get('/workspace/:urlKey/foreman', workspaceFromUrl, (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const openRouterSource = getOpenRouterSource(req);
  const featureFlags = getFeatureFlags(req.session);

  // Guard: proxy feature must be enabled (foreman uses proxy tokens)
  if (featureFlags.proxy !== true) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
  }

  const html = renderForemanPage(workspace.name || 'Workspace', {
    deployInfo,
    urlKey: workspace.urlKey,
    openRouterSource,
    workspaces: req.session.workspaces,
    featureFlags
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
  if (req.session.linearUserId) {
    try {
      const existingPrefs = await userPreferencesStore.getUserPreferences(req.session.linearUserId);
      const existingFeatures = existingPrefs.features || {};
      await userPreferencesStore.saveUserPreferences(req.session.linearUserId, {
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

// =============================================================================
// Legacy Route Redirects
// =============================================================================
app.use(createLegacyRedirects())

// =============================================================================
// Server Startup
// =============================================================================
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Linear Projects Viewer running at http://localhost:${PORT}`)

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
      const removedCount = await foremanStore.cleanup()
      if (removedCount > 0) {
        console.log(`Foreman status cleanup: removed ${removedCount} expired entries`)
      }
    } catch (err) {
      console.error('Foreman status cleanup error:', err)
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
