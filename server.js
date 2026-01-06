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
import { fetchProjects, fetchTeams } from './lib/linear.js'
import { buildForest, partitionCompleted, buildInProgressForest } from './lib/tree.js'
import { renderPage, renderErrorPage } from './lib/render.js'
import { parseLandingPage } from './lib/parse-landing.js'
import { refreshAccessToken, calculateExpiresAt } from './lib/token-refresh.js'
import { UUID_REGEX, getActiveWorkspace, removeWorkspace, saveSession } from './lib/workspace.js'
import { createAuthRoutes } from './routes/auth.js'
import { createWorkspaceRoutes } from './routes/workspace.js'
import { testMockTeams, testMockData } from './tests/fixtures/mock-data.js'

// =============================================================================
// Environment Variable Validation
// =============================================================================
// Validate required environment variables at startup to fail fast with clear errors
const requiredEnvVars = ['SESSION_SECRET'];
const oauthEnvVars = ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'];

// SESSION_SECRET is always required (even in test mode, sessions need a secret)
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
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

const sessionStore = new MongoSessionStore({
  collection: sessionsCollection,
  ttl: SESSION_TTL_SECONDS
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
  //   ?tokenExpired=true     - Set token expiry in the past
  //   ?noRefreshToken=true   - Omit refresh token
  //   ?multiWorkspace=true   - Set up 2 workspaces
  //   ?maxWorkspaces=true    - Set up 10 workspaces (at limit)
  app.get('/test/set-session', (req, res) => {
    const { tokenExpired, noRefreshToken, multiWorkspace, maxWorkspaces } = req.query

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
    workspace.accessToken = newTokens.access_token
    workspace.refreshToken = newTokens.refresh_token
    workspace.tokenExpiresAt = calculateExpiresAt(newTokens.expires_in)

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
app.use(createAuthRoutes({ sessionStore }))
app.use(createWorkspaceRoutes())

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

  // Unauthenticated users see the static landing page
  if (!workspace) {
    const html = renderPage(landingTrees, [], landingData.organizationName, { isLanding: true })
    return res.send(html)
  }

  // Parse and validate team filter from query string (must be valid UUID)
  const rawTeam = req.query.team;
  const teamId = rawTeam && rawTeam !== 'all' && UUID_REGEX.test(rawTeam) ? rawTeam : null;

  try {
    const { trees, inProgressTrees, organizationName, teams, selectedTeamId } = await fetchAndPrepareProjects(workspace.accessToken, teamId);
    const html = renderPage(trees, inProgressTrees, organizationName, {
      teams,
      selectedTeamId,
      workspaces: req.session.workspaces,
      activeWorkspaceId: req.session.activeWorkspaceId
    });
    res.send(html);
  } catch (error) {
    console.error('Error fetching projects:', error)

    // If token is invalid/expired (401), attempt refresh and retry
    if (error.response?.status === 401 && workspace.refreshToken) {
      try {
        // Attempt to refresh the token
        const tokenData = await refreshAccessToken(workspace.refreshToken);
        workspace.accessToken = tokenData.access_token;
        workspace.refreshToken = tokenData.refresh_token;
        workspace.tokenExpiresAt = calculateExpiresAt(tokenData.expires_in);

        await saveSession(req.session);
        console.log('Token refreshed after 401, retrying request');

        // Retry the request with the new token
        const { trees, inProgressTrees, organizationName, teams, selectedTeamId } = await fetchAndPrepareProjects(workspace.accessToken, teamId);
        const html = renderPage(trees, inProgressTrees, organizationName, {
          teams,
          selectedTeamId,
          workspaces: req.session.workspaces,
          activeWorkspaceId: req.session.activeWorkspaceId
        });
        return res.send(html);
      } catch (refreshError) {
        // Refresh failed, remove this workspace
        console.error('Token refresh failed after 401:', refreshError);
        const remaining = removeWorkspace(req.session, workspace.id);

        if (remaining > 0) {
          await saveSession(req.session);
          return res.redirect('/');
        }

        return req.session.destroy((err) => {
          if (err) console.error('Session destroy error:', err);
          const html = renderPage(landingTrees, [], landingData.organizationName, { isLanding: true });
          res.send(html);
        });
      }
    }

    // If 401 but no refresh token, remove workspace and show landing or switch
    if (error.response?.status === 401) {
      const remaining = removeWorkspace(req.session, workspace.id);

      if (remaining > 0) {
        await saveSession(req.session);
        return res.redirect('/');
      }

      return req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        const html = renderPage(landingTrees, [], landingData.organizationName, { isLanding: true });
        res.send(html);
      });
    }

    console.error('Main route error:', error);
    const html = renderErrorPage('Something Went Wrong', 'Could not load your projects. Please try again or re-authenticate.', {
      action: 'Try again',
      actionUrl: '/'
    });
    res.status(500).send(html);
  }
})

// =============================================================================
// Server Startup
// =============================================================================
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Linear Projects Viewer running at http://localhost:${PORT}`)
})
