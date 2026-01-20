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
import { fetchProjects, fetchTeams, fetchIssueContext } from './lib/linear.js'
import { buildForest, partitionCompleted, buildInProgressForest, NO_PROJECT_ID } from './lib/tree.js'
import { renderPage, renderErrorPage } from './lib/render.js'
import { parseLandingPage } from './lib/parse-landing.js'
import { refreshAccessToken } from './lib/token-refresh.js'
import { UUID_REGEX, getActiveWorkspace, removeWorkspace, saveSession, updateWorkspaceTokens } from './lib/workspace.js'
import { createAuthRoutes } from './routes/auth.js'
import { createWorkspaceRoutes } from './routes/workspace.js'
import { createOpenRouterAuthRoutes } from './routes/openrouter-auth.js'
import { testMockTeams, testMockData } from './tests/fixtures/mock-data.js'
import { runAudit, computeAuditFromData } from './lib/audit.js'
import { renderFancyPage } from './lib/render-fancy.js'
import { renderSettingsPage } from './lib/render-settings.js'
import { renderPromptsPage } from './lib/render-prompts.js'
import { generatePrompt, hasPrompt, getAvailablePrompts } from './lib/prompt-templates.js'
import { PHASE_LABELS, WORK_ISSUE_LABELS } from './lib/workflow-config.js'
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

// Session middleware configuration:
// - resave: false - don't save session if unmodified
// - saveUninitialized: false - don't create session until something is stored
// - secure cookies only in production (requires HTTPS)
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    secure: process.env.NODE_ENV === 'production'
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
  app.get('/test/set-session', (req, res) => {
    const { tokenExpired, noRefreshToken, multiWorkspace, maxWorkspaces, openRouterConnected } = req.query

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

// Apply middleware to all routes except auth, logout, and workspace routes
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/logout' || req.path.startsWith('/workspace/')) {
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

  // Build tree structure for each project, separating complete from incomplete
  const trees = projects
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(project => {
      const { roots } = forest.get(project.id) || { roots: [] };
      const { incomplete, completed, completedCount } = partitionCompleted(roots);
      return { project, incomplete, completed, completedCount };
    });

  return { trees, inProgressTrees, organizationName, teams, selectedTeamId: teamId };
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
      const html = renderPage(landingTrees, [], landingData.organizationName, { isLanding: true, deployInfo });
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
  const { trees, inProgressTrees, organizationName, teams, selectedTeamId } = await fetchAndPrepareProjects(workspace.accessToken, teamId);
  const html = renderPage(trees, inProgressTrees, organizationName, {
    teams,
    selectedTeamId,
    workspaces: session.workspaces,
    activeWorkspaceId: session.activeWorkspaceId,
    openRouterSource,
    deployInfo
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
 * Home page - renders either landing page or authenticated project view.
 *
 * For unauthenticated users: Shows pre-rendered static landing page.
 * For authenticated users: Fetches projects/issues from Linear API and renders
 * the interactive tree view with "In Progress" section.
 *
 * Query parameters:
 * - team: Optional team ID to filter issues by (or 'all' for all teams)
 */
app.get('/', async (req, res) => {
  // Get active workspace (null if not authenticated)
  const workspace = getActiveWorkspace(req.session)
  const deployInfo = getDeployInfo()

  // Unauthenticated users see the static landing page
  if (!workspace) {
    const html = renderPage(landingTrees, [], landingData.organizationName, { isLanding: true, deployInfo })
    return res.send(html)
  }

  // Parse and validate team filter from query string (must be valid UUID)
  const rawTeam = req.query.team;
  const teamId = rawTeam && rawTeam !== 'all' && UUID_REGEX.test(rawTeam) ? rawTeam : null;

  // Determine OpenRouter connection status for nav bar
  const sessionApiKey = req.session.openRouterApiKey;
  const openRouterSource = sessionApiKey ? 'oauth' : (process.env.OPENROUTER_API_KEY ? 'env' : null);

  try {
    const { trees, inProgressTrees, organizationName, teams, selectedTeamId } = await fetchAndPrepareProjects(workspace.accessToken, teamId);
    const html = renderPage(trees, inProgressTrees, organizationName, {
      teams,
      selectedTeamId,
      workspaces: req.session.workspaces,
      activeWorkspaceId: req.session.activeWorkspaceId,
      openRouterSource,
      deployInfo
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
      actionUrl: '/'
    });
    res.status(500).send(html);
  }
})

// =============================================================================
// Operator Dashboard Routes
// =============================================================================

/**
 * Operator Dashboard page - requires authentication.
 * Displays workspace audit and health check functionality.
 */
app.get('/fancy', (req, res) => {
  const workspace = getActiveWorkspace(req.session);

  // Redirect to home if not authenticated
  if (!workspace) {
    return res.redirect('/');
  }

  const deployInfo = getDeployInfo();

  const html = renderFancyPage(workspace.name || 'Workspace', {
    deployInfo
  });
  res.send(html);
});

/**
 * Settings page - requires authentication.
 * Displays user preferences and AI configuration.
 */
app.get('/settings', (req, res) => {
  const workspace = getActiveWorkspace(req.session);

  // Redirect to home if not authenticated
  if (!workspace) {
    return res.redirect('/');
  }

  // Determine OpenRouter connection status
  const sessionApiKey = req.session.openRouterApiKey;
  const envApiKey = process.env.OPENROUTER_API_KEY;
  const openRouterSource = sessionApiKey ? 'oauth' : (envApiKey ? 'env' : null);
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
    modelError
  });
  res.send(html);
});

/**
 * Prompts page - requires authentication.
 * Displays all prompt templates organized by category.
 */
app.get('/prompts', (req, res) => {
  const workspace = getActiveWorkspace(req.session);

  // Redirect to home if not authenticated
  if (!workspace) {
    return res.redirect('/');
  }

  const deployInfo = getDeployInfo();

  const html = renderPromptsPage(workspace.name || 'Workspace', {
    deployInfo
  });
  res.send(html);
});

/**
 * Save model selection to session.
 * Accepts either a preset model ID or a custom model ID.
 */
app.post('/settings/model', async (req, res) => {
  const workspace = getActiveWorkspace(req.session);

  if (!workspace) {
    return res.redirect('/');
  }

  const { modelId, customModelId } = req.body;

  // Use custom model ID if provided, otherwise use selected preset
  let selectedModel = customModelId?.trim() || modelId;

  // Validate model ID format: provider/model (with optional :variant)
  // Example: anthropic/claude-sonnet-4, meta-llama/llama-3.3-70b-instruct:free
  // Dots allowed for version numbers (e.g., claude-3.5-sonnet) but not consecutive (..)
  const modelIdRegex = /^[a-z0-9-]+\/[a-z0-9.-]+(?::[a-z0-9-]+)?$/i;

  // Validate and provide feedback on failure
  if (!selectedModel) {
    return res.redirect('/settings?error=empty');
  }

  if (selectedModel.length > 100) {
    return res.redirect('/settings?error=too-long');
  }

  // Reject path traversal sequences
  if (selectedModel.includes('..')) {
    return res.redirect('/settings?error=invalid-format');
  }

  if (!modelIdRegex.test(selectedModel)) {
    return res.redirect('/settings?error=invalid-format');
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

  res.redirect('/settings');
});

/**
 * Audit API endpoint - runs a workspace audit and returns JSON.
 * Requires authentication.
 */
app.get('/api/audit', async (req, res) => {
  const workspace = getActiveWorkspace(req.session);

  // Return 401 if not authenticated
  if (!workspace) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

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
// Prompt Generation API
// =============================================================================

/**
 * Generate a prompt for a specific issue and label.
 * Returns a prompt that can be copied and used with Claude Code + Linear MCP.
 *
 * @route GET /api/prompt/:issueId/:labelName
 * @param {string} issueId - The Linear issue ID
 * @param {string} labelName - The label name (must have a prompt template)
 * @returns {Object} { label, promptName, prompt } or error
 */
app.get('/api/prompt/:issueId/:labelName', async (req, res) => {
  const workspace = getActiveWorkspace(req.session)

  // Return 401 if not authenticated
  if (!workspace) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

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
// AI Recommendation API
// =============================================================================

/**
 * Check if recommendation feature is available.
 * Returns feature availability status.
 *
 * @route GET /api/recommend/status
 * @returns {Object} { enabled: boolean }
 */
app.get('/api/recommend/status', (req, res) => {
  const workspace = getActiveWorkspace(req.session)

  if (!workspace) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  // In test mode, always report as enabled for testing
  const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'
  // Check if user has connected OpenRouter via OAuth (session) or if env key is set
  const sessionApiKey = req.session.openRouterApiKey
  res.json({
    enabled: isTestMode || isRecommendationEnabled(sessionApiKey),
    source: sessionApiKey ? 'oauth' : (process.env.OPENROUTER_API_KEY ? 'env' : null)
  })
})

/**
 * Get AI-generated prompt for a task.
 * Analyzes task context and generates a tailored prompt.
 *
 * @route GET /api/recommend/:issueId
 * @param {string} issueId - The Linear issue ID
 * @returns {Object} { reasoning, prompt } or error
 */
app.get('/api/recommend/:issueId', async (req, res) => {
  const workspace = getActiveWorkspace(req.session)

  // Return 401 if not authenticated
  if (!workspace) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const { issueId } = req.params

  // Validate issue ID format (must be valid UUID)
  if (!UUID_REGEX.test(issueId)) {
    return res.status(400).json({ error: 'Invalid issue ID format' })
  }

  // Check if feature is enabled (except in test mode)
  const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'
  const sessionApiKey = req.session.openRouterApiKey
  if (!isTestMode && !isRecommendationEnabled(sessionApiKey)) {
    return res.status(503).json({ error: 'AI recommendation feature is not configured. Connect your OpenRouter account or set OPENROUTER_API_KEY.' })
  }

  try {
    // Use mock data in test mode
    if (isTestMode) {
      const mockIssue = testMockData.issues.find(i => i.id === issueId)
      if (!mockIssue) {
        return res.status(404).json({ error: 'Issue not found' })
      }

      // Generate a mock prompt based on the issue
      const labels = (mockIssue.labels?.nodes || []).map(l => l.name)
      let reasoning = 'Start by getting an overview of what this task involves before deciding on the next steps.'
      let goal = 'Summarize what this task involves and how it fits into the broader project context.'

      // Provide contextual mock prompts based on labels
      if (labels.includes(PHASE_LABELS.BREAKDOWN)) {
        reasoning = 'This task is in the breakdown phase. Breaking it into smaller subtasks will make it easier to plan and execute.'
        goal = 'Break this task into subtasks (1-3 hour chunks each), ordered by dependencies.'
      } else if (labels.includes(PHASE_LABELS.RESEARCH)) {
        reasoning = 'This task is in the research phase. Investigating the options first will help make informed decisions.'
        goal = 'Identify key questions, research systematically, and provide actionable recommendations.'
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

      return res.json({
        reasoning,
        prompt,
        truncated: false,
        completionTokens: null,
        issueUrl: mockIssue.url
      })
    }

    // Fetch issue context from Linear
    const { issue, parent, siblings, project, children, comments } = await fetchIssueContext(workspace.accessToken, issueId)

    // Get AI-generated prompt (pass session API key and model if available)
    const selectedModel = req.session.modelId || DEFAULT_MODEL
    const recommendation = await getRecommendation(issue, { parent, siblings, project, children, comments }, { apiKey: sessionApiKey, model: selectedModel })

    res.json({
      reasoning: recommendation.reasoning,
      prompt: recommendation.prompt,
      truncated: recommendation.truncated,
      completionTokens: recommendation.completionTokens,
      issueUrl: issue.url
    })
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

// =============================================================================
// Server Startup
// =============================================================================
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Linear Projects Viewer running at http://localhost:${PORT}`)
})
