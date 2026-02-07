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
import { DispatchQueueStore } from './lib/dispatch-store.js'
import { DispatchTokenStore } from './lib/dispatch-tokens.js'
import { FreeTierStore } from './lib/free-tier-store.js'
import { fetchProjects, fetchTeams, fetchIssueContext, fetchRecommendationContext, fetchIssueComments } from './lib/linear.js'
import { buildForest, partitionCompleted, buildInProgressForest, buildRecentActivityForest, NO_PROJECT_ID } from './lib/tree.js'
import { renderPage, renderErrorPage, renderWorkspaceNotFoundPage } from './lib/render.js'
import { parseLandingPage } from './lib/parse-landing.js'
import { refreshAccessToken } from './lib/token-refresh.js'
import { UUID_REGEX, getActiveWorkspace, getWorkspaceByUrlKey, validateWorkspaceUrlKey, removeWorkspace, saveSession, updateWorkspaceTokens } from './lib/workspace.js'
import { createAuthRoutes } from './routes/auth.js'
import { createWorkspaceRoutes } from './routes/workspace.js'
import { createOpenRouterAuthRoutes } from './routes/openrouter-auth.js'
import { createDispatchRoutes } from './routes/dispatch.js'
import { testMockTeams, testMockData } from './tests/fixtures/mock-data.js'
import { runAudit, computeAuditFromData } from './lib/audit.js'
import { renderAuditPage } from './lib/render-audit.js'
import { renderSettingsPage } from './lib/render-settings.js'
import { renderPromptsPage } from './lib/render-prompts.js'
import { generatePrompt, hasPrompt, getAvailablePrompts } from './lib/prompt-templates.js'
import { PREPARING_LABEL, WORK_ISSUE_LABELS } from './lib/workflow-config.js'
import { isRecommendationEnabled, getRecommendation, DEFAULT_MODEL, AVAILABLE_MODELS } from './lib/openrouter.js'

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

// OAuth vars only required in non-test mode (tests use mock auth)
if (process.env.NODE_ENV !== 'test') {
  for (const envVar of oauthEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Error: Missing required environment variable: ${envVar}`);
      process.exit(1);
    }
  }
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

// Dispatch queue collections
const dispatchQueueCollection = db.collection('dispatch-queue')
const dispatchTokensCollection = db.collection('dispatch-tokens')

const dispatchQueueStore = new DispatchQueueStore({
  collection: dispatchQueueCollection,
  ttl: 24 * 60 * 60 // 24 hours
})

const dispatchTokenStore = new DispatchTokenStore({
  collection: dispatchTokensCollection
})

// Free tier usage tracking
const freeTierCollection = db.collection('free-tier-usage')
const freeTierStore = new FreeTierStore({
  collection: freeTierCollection,
  dailyLimit: parseInt(process.env.FREE_TIER_DAILY_LIMIT, 10) || 5,
  hourlyLimit: parseInt(process.env.FREE_TIER_HOURLY_LIMIT, 10) || 50
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
app.use(express.json())

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
// Test-only routes and mock data for Playwright E2E tests.
// Allows tests to bypass OAuth and use predictable mock data.
if (process.env.NODE_ENV === 'test') {
  // Endpoint to set a test session without going through OAuth flow
  // Query parameters:
  //   ?tokenExpired=true        - Set token expiry in the past
  //   ?noRefreshToken=true      - Omit refresh token
  //   ?multiWorkspace=true      - Set up 2 workspaces
  //   ?maxWorkspaces=true       - Set up 10 workspaces (at limit)
  //   ?openRouterConnected=true - Set up OpenRouter API key in session
  //   ?freeTierEnabled=true     - Simulate free tier mode (no OAuth, no env key)
  app.get('/test/set-session', (req, res) => {
    const { tokenExpired, noRefreshToken, multiWorkspace, maxWorkspaces, openRouterConnected, freeTierEnabled } = req.query

    // Base workspace configuration - IDs must be valid UUIDs to pass validation
    const createWorkspace = (id, name, urlKey) => ({
      id,
      name,
      urlKey,
      accessToken: 'test-token',
      refreshToken: noRefreshToken ? null : 'test-refresh-token',
      tokenExpiresAt: tokenExpired
        ? Date.now() - (60 * 60 * 1000)  // 1 hour in the past
        : Date.now() + (24 * 60 * 60 * 1000),  // 24 hours from now
      addedAt: Date.now()
    })

    // Test UUIDs (valid format for workspace validation)
    const TEST_UUID_1 = '11111111-1111-1111-1111-111111111111'
    const TEST_UUID_2 = '22222222-2222-2222-2222-222222222222'

    let workspaces
    if (maxWorkspaces) {
      // Create 10 workspaces (at the limit) with valid UUIDs
      workspaces = Array.from({ length: 10 }, (_, i) =>
        createWorkspace(
          `${i}${i}${i}${i}${i}${i}${i}${i}-${i}${i}${i}${i}-${i}${i}${i}${i}-${i}${i}${i}${i}-${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`,
          `Workspace ${i}`,
          `workspace-${i}`
        )
      )
    } else if (multiWorkspace) {
      // Create 2 workspaces for switching tests
      workspaces = [
        createWorkspace(TEST_UUID_1, 'Test Workspace', 'test-workspace'),
        createWorkspace(TEST_UUID_2, 'Second Workspace', 'second-workspace')
      ]
    } else {
      // Default: single workspace
      workspaces = [
        createWorkspace(TEST_UUID_1, 'Test Workspace', 'test-workspace')
      ]
    }

    req.session.workspaces = workspaces
    req.session.activeWorkspaceId = workspaces[0].id

    // Set or clear OpenRouter API key in session based on flag
    if (openRouterConnected) {
      req.session.openRouterApiKey = 'test-openrouter-key'
    } else {
      delete req.session.openRouterApiKey
    }

    // Set free tier mode flag in session for testing
    if (freeTierEnabled) {
      req.session.freeTierEnabled = true
    } else {
      delete req.session.freeTierEnabled
    }

    // Explicitly save session before responding to ensure it's persisted
    req.session.save((err) => {
      if (err) {
        res.status(500).send('session error')
      } else {
        res.send('ok')
      }
    })
  })

  // Endpoint to clear session (for testing logout and unauthenticated states)
  app.get('/test/clear-session', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).send('session error')
      } else {
        res.send('ok')
      }
    })
  })

  // Endpoint to create a dispatch token for testing
  app.get('/test/create-dispatch-token', async (req, res) => {
    try {
      const { tokenId, token } = await dispatchTokenStore.createToken(
        'test-workspace',
        'test-token'
      )
      res.json({ tokenId, token })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear dispatch queue for testing
  app.get('/test/clear-dispatch-queue', async (req, res) => {
    try {
      await dispatchQueueStore.clear('test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear dispatch tokens for testing
  app.get('/test/clear-dispatch-tokens', async (req, res) => {
    try {
      await dispatchTokenStore.clear('test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear free tier usage for testing
  app.get('/test/clear-free-tier', async (req, res) => {
    try {
      await freeTierStore.clear('test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to add free tier usage for testing
  app.get('/test/add-free-tier-usage', async (req, res) => {
    try {
      const count = parseInt(req.query.count, 10) || 1
      for (let i = 0; i < count; i++) {
        await freeTierStore.recordUsage('test-workspace')
      }
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}

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
  if (req.path.startsWith('/auth/') || req.path === '/logout') {
    return next();
  }
  ensureValidToken(req, res, next);
});

// =============================================================================
// Route Mounting
// =============================================================================
// Mount extracted route modules
app.use(createAuthRoutes({ sessionStore, userPreferencesStore }))
app.use(createWorkspaceRoutes())
app.use(createOpenRouterAuthRoutes())
// Note: Dispatch routes mounted after workspaceFromUrl middleware is defined

// =============================================================================
// Main Application Route
// =============================================================================

/**
 * Helper function to fetch and prepare project data for rendering.
 * Handles both test mode and real API calls.
 *
 * @param {string} accessToken - The access token for Linear API
 * @param {string|null} teamId - Optional team ID to filter issues by
 * @returns {Promise<{trees, inProgressTrees, organizationName, teams, selectedTeamId}>} Prepared data for rendering
 */
async function fetchAndPrepareProjects(accessToken, teamId = null) {
  // Use mock data in test mode to avoid hitting Linear API
  const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';

  // Fetch teams
  const teams = isTestMode
    ? testMockTeams
    : await fetchTeams(accessToken);

  // Fetch projects and issues (filtered by team if specified)
  let { organizationName, projects, issues } = isTestMode
    ? testMockData
    : await fetchProjects(accessToken, teamId);

  // In test mode, manually filter issues by team
  if (isTestMode && teamId) {
    issues = issues.filter(i => i.team?.id === teamId);
  }

  // Build issue tree structure (parent-child relationships)
  const forest = buildForest(issues);

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

  return { trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId: teamId };
}

/**
 * Handles workspace removal after authentication failure.
 * Removes the workspace from session, then either redirects to switch
 * workspace or shows the landing page if no workspaces remain.
 *
 * @param {Object} session - Express session object
 * @param {string} workspaceId - ID of workspace to remove
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
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
 * On success, renders the project page with fresh data.
 *
 * @param {Object} workspace - Workspace object with tokens
 * @param {Object} session - Express session object
 * @param {string|null} teamId - Optional team filter
 * @param {string|null} openRouterSource - OpenRouter connection source
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 * @throws {Error} If token refresh or retry fails
 */
async function handleTokenRefreshAndRetry(workspace, session, teamId, openRouterSource, res) {
  const tokenData = await refreshAccessToken(workspace.refreshToken);
  updateWorkspaceTokens(workspace, tokenData);
  await saveSession(session);
  console.log('Token refreshed after 401, retrying request');

  const deployInfo = getDeployInfo()
  const { trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId } = await fetchAndPrepareProjects(workspace.accessToken, teamId);
  const html = renderPage(trees, inProgressTrees, recentActivityTrees, organizationName, {
    teams,
    selectedTeamId,
    workspaces: session.workspaces,
    openRouterSource,
    deployInfo,
    urlKey: workspace.urlKey
  });
  return res.send(html);
}

/**
 * Handles 401 Unauthorized errors from the Linear API.
 * If a refresh token exists, attempts to refresh and retry.
 * On failure or if no refresh token, removes the workspace.
 *
 * @param {Object} workspace - Workspace object with tokens
 * @param {Object} session - Express session object
 * @param {string|null} teamId - Optional team filter
 * @param {string|null} openRouterSource - OpenRouter connection source
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
async function handleUnauthorizedError(workspace, session, teamId, openRouterSource, res) {
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

  // Unauthenticated users see the static landing page
  const html = renderPage(landingTrees, [], [], landingData.organizationName, { isLanding: true, deployInfo })
  res.send(html)
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
app.use(createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl }))

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
  const sessionApiKey = req.session.openRouterApiKey;
  const openRouterSource = sessionApiKey ? 'oauth' : (process.env.OPENROUTER_API_KEY ? 'env' : ((process.env.OPENROUTER_FREE_TIER_KEY || req.session.freeTierEnabled) ? 'free' : null));

  try {
    const { trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId } = await fetchAndPrepareProjects(workspace.accessToken, teamId);
    const html = renderPage(trees, inProgressTrees, recentActivityTrees, organizationName, {
      teams,
      selectedTeamId,
      workspaces: req.session.workspaces,
      openRouterSource,
      deployInfo,
      urlKey: workspace.urlKey
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
 * Operator Dashboard page - requires authentication.
 * Displays workspace audit and health check functionality.
 */
app.get('/workspace/:urlKey/audit', workspaceFromUrl, (req, res) => {
  const workspace = req.workspace;
  const deployInfo = getDeployInfo();
  const sessionApiKey = req.session.openRouterApiKey;
  const envApiKey = process.env.OPENROUTER_API_KEY;
  const openRouterSource = sessionApiKey ? 'oauth' : (envApiKey ? 'env' : ((process.env.OPENROUTER_FREE_TIER_KEY || req.session.freeTierEnabled) ? 'free' : null));

  const html = renderAuditPage(workspace.name || 'Workspace', {
    deployInfo,
    urlKey: workspace.urlKey,
    openRouterSource,
    workspaces: req.session.workspaces
  });
  res.send(html);
});

/**
 * Settings page - requires authentication.
 * Displays user preferences and AI configuration.
 */
app.get('/workspace/:urlKey/settings', workspaceFromUrl, (req, res) => {
  const workspace = req.workspace;

  // Determine OpenRouter connection status
  const sessionApiKey = req.session.openRouterApiKey;
  const envApiKey = process.env.OPENROUTER_API_KEY;
  const openRouterSource = sessionApiKey ? 'oauth' : (envApiKey ? 'env' : ((process.env.OPENROUTER_FREE_TIER_KEY || req.session.freeTierEnabled) ? 'free' : null));
  const deployInfo = getDeployInfo();

  // Get current model selection (from session or default)
  const currentModel = req.session.modelId || DEFAULT_MODEL;

  // Check for model validation error from redirect
  const modelError = req.query.error;

  const html = renderSettingsPage(workspace.name || 'Workspace', {
    openRouterConnected: !!(sessionApiKey || envApiKey),
    openRouterSource,
    deployInfo,
    currentModel,
    availableModels: AVAILABLE_MODELS,
    modelError,
    urlKey: workspace.urlKey,
    workspaces: req.session.workspaces
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
  const sessionApiKey = req.session.openRouterApiKey;
  const envApiKey = process.env.OPENROUTER_API_KEY;
  const openRouterSource = sessionApiKey ? 'oauth' : (envApiKey ? 'env' : ((process.env.OPENROUTER_FREE_TIER_KEY || req.session.freeTierEnabled) ? 'free' : null));

  const html = renderPromptsPage(workspace.name || 'Workspace', {
    deployInfo,
    urlKey: workspace.urlKey,
    openRouterSource,
    workspaces: req.session.workspaces
  });
  res.send(html);
});

/**
 * Save model selection to session.
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

  // Validation passed - save the model
  req.session.modelId = selectedModel;
  try {
    await saveSession(req.session);
  } catch (err) {
    console.error('Failed to save model preference:', err);
    // Continue to redirect - model will still work for this session
  }

  // Persist preference to user preferences store for cross-device sync
  if (req.session.linearUserId) {
    try {
      // Get existing preferences and merge with new model selection
      const existingPrefs = await userPreferencesStore.getUserPreferences(req.session.linearUserId);
      await userPreferencesStore.saveUserPreferences(req.session.linearUserId, {
        ...existingPrefs,
        modelId: selectedModel
      });
    } catch (err) {
      console.error('Failed to persist model preference:', err);
      // Non-fatal: preference still works in session
    }
  }

  res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
});

/**
 * Audit API endpoint - runs a workspace audit and returns JSON.
 * Requires authentication.
 */
app.get('/workspace/:urlKey/api/audit', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace;

  try {
    // Use mock audit data in test mode
    if (process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token') {
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

    const report = await runAudit(workspace.accessToken);
    res.json(report);
  } catch (error) {
    console.error('Audit error:', error);

    // Handle 401 from Linear API
    if (error.response?.status === 401) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }

    res.status(500).json({ error: 'Audit failed', message: error.message });
  }
});

// =============================================================================
// Workspace-Prefixed Prompt Generation API
// =============================================================================

/**
 * Generate a prompt for a specific issue and label.
 * Returns a prompt that can be copied and used with Claude Code + Linear MCP.
 *
 * @route GET /workspace/:urlKey/api/prompt/:issueId/:labelName
 * @param {string} issueId - The Linear issue ID
 * @param {string} labelName - The label name (must have a prompt template)
 * @returns {Object} { label, promptName, prompt } or error
 */
app.get('/workspace/:urlKey/api/prompt/:issueId/:labelName', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace

  const { issueId, labelName } = req.params

  // Validate issue ID format (must be valid UUID)
  if (!UUID_REGEX.test(issueId)) {
    return res.status(400).json({ error: 'Invalid issue ID format' })
  }

  // Check if label has a prompt template
  if (!hasPrompt(labelName)) {
    return res.status(404).json({ error: `No prompt template for label: ${labelName}` })
  }

  try {
    // Use mock data in test mode
    if (process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token') {
      const mockIssue = testMockData.issues.find(i => i.id === issueId)
      if (!mockIssue) {
        return res.status(404).json({ error: 'Issue not found' })
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

      const result = generatePrompt(labelName, {
        ...mockIssue,
        identifier,
        labels
      }, {
        parent: mockParent ? {
          id: mockParent.id,
          identifier: mockParent.url.split('/').pop(),
          title: mockParent.title,
          state: mockParent.state
        } : null,
        siblings: mockSiblings,
        project: mockProject ? { name: mockProject.name, description: mockProject.content } : null,
        children: mockChildren
      })

      return res.json({
        label: labelName,
        promptName: result.name,
        prompt: result.prompt
      })
    }

    // Fetch issue context from Linear
    const { issue, parent, siblings, project, children, comments } = await fetchIssueContext(workspace.accessToken, issueId)

    // Generate the prompt
    const result = generatePrompt(labelName, issue, { parent, siblings, project, children, comments })

    if (!result) {
      return res.status(500).json({ error: 'Failed to generate prompt' })
    }

    res.json({
      label: labelName,
      promptName: result.name,
      prompt: result.prompt
    })
  } catch (error) {
    console.error('Prompt generation error:', error)

    // Handle 401 from Linear API
    if (error.response?.status === 401) {
      return res.status(401).json({ error: 'Token expired or invalid' })
    }

    // Handle issue not found
    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message })
    }

    res.status(500).json({ error: 'Failed to generate prompt', message: error.message })
  }
})

// =============================================================================
// Workspace-Prefixed AI Recommendation API
// =============================================================================

/**
 * Check if recommendation feature is available.
 * Returns feature availability status.
 *
 * @route GET /workspace/:urlKey/api/recommend/status
 * @returns {Object} { enabled: boolean }
 */
app.get('/workspace/:urlKey/api/recommend/status', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace

  // In test mode, always report as enabled for testing
  const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'
  // Check if user has connected OpenRouter via OAuth (session) or if env key is set
  const sessionApiKey = req.session.openRouterApiKey

  // Determine source: oauth > env > free > null
  let source = null
  if (sessionApiKey) {
    source = 'oauth'
  } else if (process.env.OPENROUTER_API_KEY) {
    source = 'env'
  } else if (process.env.OPENROUTER_FREE_TIER_KEY || req.session.freeTierEnabled) {
    source = 'free'
  }

  const enabled = isTestMode || isRecommendationEnabled(sessionApiKey) || !!process.env.OPENROUTER_FREE_TIER_KEY || !!req.session.freeTierEnabled

  const result = { enabled, source }

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
app.get('/workspace/:urlKey/api/recommend/:issueId', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace

  const { issueId } = req.params

  // Validate issue ID format (must be valid UUID)
  if (!UUID_REGEX.test(issueId)) {
    return res.status(400).json({ error: 'Invalid issue ID format' })
  }

  // Check if feature is enabled (except in test mode)
  const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'
  const sessionApiKey = req.session.openRouterApiKey
  const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY
  const isFreeTier = !sessionApiKey && !process.env.OPENROUTER_API_KEY && !!freeTierKey
  if (!isTestMode && !isRecommendationEnabled(sessionApiKey) && !freeTierKey) {
    return res.status(503).json({ error: 'AI recommendation feature is not configured. Connect your OpenRouter account or set OPENROUTER_API_KEY.' })
  }

  // Check free tier rate limits before proceeding
  if (!isTestMode && isFreeTier) {
    const check = await freeTierStore.canUse(workspace.urlKey)
    if (!check.allowed) {
      return res.status(429).json({
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

  try {
    // Use mock data in test mode
    if (isTestMode) {
      const mockIssue = testMockData.issues.find(i => i.id === issueId)
      if (!mockIssue) {
        return res.status(404).json({ error: 'Issue not found' })
      }

      // Check free tier limits in test mode when session has freeTierEnabled flag
      const testIsFreeTier = req.session.freeTierEnabled && !req.session.openRouterApiKey && !process.env.OPENROUTER_API_KEY
      if (testIsFreeTier) {
        const check = await freeTierStore.canUse(workspace.urlKey)
        if (!check.allowed) {
          return res.status(429).json({
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

      // Provide contextual mock prompts based on labels (simplified 3-label system)
      if (labels.includes(PREPARING_LABEL)) {
        reasoning = 'This task needs preparation before implementation. Research, breakdown, or design work is needed.'
        goal = 'Complete the necessary preparation work so this task is ready for implementation.'
      } else if (labels.includes(WORK_ISSUE_LABELS.BLOCKED)) {
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

      // Record free tier usage in test mode
      if (testIsFreeTier) {
        await freeTierStore.recordUsage(workspace.urlKey)
      }

      const result = {
        reasoning,
        prompt,
        truncated: false,
        completionTokens: null,
        issueUrl: mockIssue.url
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

      return res.json(result)
    }

    // Fetch issue context from Linear (uses two-tier context for parent tasks)
    const context = await fetchRecommendationContext(workspace.accessToken, issueId)
    const { issue, parent, siblings, project, children, comments, focusedChild } = context

    // Get AI-generated prompt (pass session API key, free tier key, and model if available)
    const selectedModel = req.session.modelId || DEFAULT_MODEL
    const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined)
    const recommendation = await getRecommendation(issue, { parent, siblings, project, children, comments, focusedChild }, { apiKey: apiKeyToUse, model: selectedModel })

    // Record free tier usage after successful API call
    if (isFreeTier) {
      await freeTierStore.recordUsage(workspace.urlKey)
    }

    const result = {
      reasoning: recommendation.reasoning,
      prompt: recommendation.prompt,
      truncated: recommendation.truncated,
      completionTokens: recommendation.completionTokens,
      issueUrl: issue.url
    }

    // Include free tier metadata
    if (isFreeTier) {
      const usage = await freeTierStore.getUsage(workspace.urlKey)
      result.freeTier = {
        used: true,
        remaining: usage.remaining,
        limit: usage.limit,
        resetsAt: usage.resetsAt
      }
    }

    res.json(result)
  } catch (error) {
    console.error('Recommendation error:', error)

    // Handle 401 from Linear API
    if (error.response?.status === 401) {
      return res.status(401).json({ error: 'Token expired or invalid' })
    }

    // Handle issue not found
    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message })
    }

    // Handle OpenRouter errors
    if (error.message?.includes('OpenRouter')) {
      return res.status(503).json({ error: 'AI service temporarily unavailable', message: error.message })
    }

    res.status(500).json({ error: 'Failed to get recommendation', message: error.message })
  }
})

/**
 * Fetch comments for a specific issue.
 * LIN-156: Lightweight endpoint for fetching issue comments.
 *
 * @route GET /workspace/:urlKey/api/comments/:issueId
 * @param {string} issueId - The Linear issue ID
 * @returns {Object} { comments: Array<{id, body, createdAt, user}> }
 */
app.get('/workspace/:urlKey/api/comments/:issueId', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace
  const { issueId } = req.params

  // Validate issue ID format (must be valid UUID)
  if (!issueId || !UUID_REGEX.test(issueId)) {
    return res.status(400).json({ error: 'Invalid issue ID format' })
  }

  try {
    // Use mock data in test mode
    const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'
    if (isTestMode) {
      const mockIssue = testMockData.issues.find(i => i.id === issueId)
      if (!mockIssue) {
        return res.status(404).json({ error: 'Issue not found' })
      }
      // Return mock comments for test mode
      return res.json({
        comments: [
          { id: 'comment-1', body: 'This is a test comment with **markdown**.', createdAt: '2024-01-15T10:00:00Z', user: 'Alice' },
          { id: 'comment-2', body: 'Second comment with `code`.', createdAt: '2024-01-16T14:30:00Z', user: 'Bob' }
        ]
      })
    }

    const comments = await fetchIssueComments(workspace.accessToken, issueId)
    res.json({ comments })
  } catch (error) {
    console.error('Comments fetch error:', error)

    if (error.response?.status === 401) {
      return res.status(401).json({ error: 'Token expired or invalid' })
    }

    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message })
    }

    res.status(500).json({ error: 'Failed to fetch comments', message: error.message })
  }
})

/**
 * Proxy image requests to Linear with authentication.
 * LIN-156: Linear-hosted images require auth headers that browsers can't add to img src.
 *
 * @route GET /workspace/:urlKey/api/image
 * @query {string} url - The Linear image URL to fetch
 * @returns {Stream} Image data with appropriate content-type
 */
app.get('/workspace/:urlKey/api/image', workspaceFromUrl, async (req, res) => {
  const workspace = req.workspace
  const imageUrl = req.query.url

  // Validate URL
  if (!imageUrl) {
    return res.status(400).json({ error: 'Missing url parameter' })
  }

  // Only allow HTTPS URLs (security)
  if (!imageUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Invalid image URL: must be HTTPS' })
  }

  // Only allow Linear-hosted images (security - prevent SSRF)
  // Use exact hostname matching to prevent bypass via evillinear.app
  const allowedHosts = new Set(['uploads.linear.app', 'cdn.linear.app', 'linear.app'])
  let urlObj
  try {
    urlObj = new URL(imageUrl)
    if (!allowedHosts.has(urlObj.hostname)) {
      return res.status(400).json({ error: 'Invalid image URL: must be from Linear' })
    }
    // Prevent path traversal attacks
    if (urlObj.pathname.includes('..')) {
      return res.status(400).json({ error: 'Invalid image URL: path traversal not allowed' })
    }
  } catch {
    return res.status(400).json({ error: 'Invalid image URL format' })
  }

  // Max image size: 10MB to prevent memory exhaustion
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024

  try {
    const response = await fetch(imageUrl, {
      headers: {
        Authorization: `Bearer ${workspace.accessToken}`
      },
      // Prevent redirects that could bypass SSRF protection
      redirect: 'error'
    })

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch image' })
    }

    // Validate content-type is an image (prevent serving HTML/JS through proxy)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'Invalid response: not an image' })
    }

    // Check content-length if available
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
    if (contentLength > MAX_IMAGE_SIZE) {
      return res.status(413).json({ error: 'Image too large' })
    }

    // Read response with size limit
    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
      return res.status(413).json({ error: 'Image too large' })
    }

    res.set('Content-Type', contentType)
    res.set('Cache-Control', 'private, max-age=3600')
    res.send(Buffer.from(arrayBuffer))
  } catch (error) {
    // Handle redirect errors specifically
    if (error.cause?.code === 'ERR_FR_TOO_MANY_REDIRECTS' || error.message?.includes('redirect')) {
      return res.status(400).json({ error: 'Redirects not allowed' })
    }
    console.error('Image proxy error:', error)
    res.status(500).json({ error: 'Failed to fetch image' })
  }
})

// =============================================================================
// Legacy Route Redirects (backward compatibility)
// =============================================================================

/**
 * Helper to create redirect functions for legacy routes.
 */
function redirectToWorkspace(page) {
  return (req, res) => {
    const workspace = getActiveWorkspace(req.session)
    if (workspace) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/${page}`)
    }
    res.redirect('/')
  }
}

// Legacy page routes - redirect to workspace-prefixed versions
app.get('/audit', redirectToWorkspace('audit'))
app.get('/settings', redirectToWorkspace('settings'))
app.get('/prompts', redirectToWorkspace('prompts'))

// Legacy POST route for settings model
app.post('/settings/model', (req, res) => {
  const workspace = getActiveWorkspace(req.session)
  if (workspace) {
    // Re-submit to the workspace-prefixed route (redirect loses POST data, so we'll handle directly)
    return res.redirect(307, `/workspace/${encodeURIComponent(workspace.urlKey)}/settings/model`)
  }
  res.redirect('/')
})

// Legacy API routes - redirect to workspace-prefixed versions
app.get('/api/audit', (req, res) => {
  const workspace = getActiveWorkspace(req.session)
  if (workspace) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/api/audit`)
  }
  res.status(401).json({ error: 'Not authenticated' })
})

app.get('/api/prompt/:issueId/:labelName', (req, res) => {
  const workspace = getActiveWorkspace(req.session)
  if (workspace) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/api/prompt/${req.params.issueId}/${encodeURIComponent(req.params.labelName)}`)
  }
  res.status(401).json({ error: 'Not authenticated' })
})

app.get('/api/recommend/status', (req, res) => {
  const workspace = getActiveWorkspace(req.session)
  if (workspace) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/api/recommend/status`)
  }
  res.status(401).json({ error: 'Not authenticated' })
})

app.get('/api/recommend/:issueId', (req, res) => {
  const workspace = getActiveWorkspace(req.session)
  if (workspace) {
    return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/api/recommend/${req.params.issueId}`)
  }
  res.status(401).json({ error: 'Not authenticated' })
})

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
  }, CLEANUP_INTERVAL_MS)
})
