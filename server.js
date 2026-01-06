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
import crypto from 'crypto'
import express from 'express'
import session from 'express-session'
import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { MongoSessionStore } from './lib/session-store.js'
import { fetchProjects, fetchTeams, fetchOrganization } from './lib/linear.js'
import { buildForest, partitionCompleted, buildInProgressForest } from './lib/tree.js'
import { renderPage, renderErrorPage } from './lib/render.js'
import { parseLandingPage } from './lib/parse-landing.js'
import { refreshAccessToken, calculateExpiresAt } from './lib/token-refresh.js'

// =============================================================================
// Constants
// =============================================================================
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry
const MAX_WORKSPACES = 10; // Maximum workspaces per session

// =============================================================================
// Multi-Workspace Helper Functions
// =============================================================================

/**
 * Get the active workspace from session.
 * If activeWorkspaceId is out of sync, syncs to first workspace.
 */
function getActiveWorkspace(session) {
  if (!session.workspaces?.length) return null;
  const active = session.workspaces.find(w => w.id === session.activeWorkspaceId);
  if (!active) {
    // Sync activeWorkspaceId if it's out of sync
    session.activeWorkspaceId = session.workspaces[0].id;
    return session.workspaces[0];
  }
  return active;
}

/**
 * Add or update a workspace in session.
 * Updates existing workspace if same org ID, otherwise adds new.
 * Throws if MAX_WORKSPACES limit reached.
 */
function upsertWorkspace(session, workspace) {
  session.workspaces = session.workspaces || [];
  const index = session.workspaces.findIndex(w => w.id === workspace.id);
  if (index >= 0) {
    // Update existing (re-auth for same workspace)
    session.workspaces[index] = { ...session.workspaces[index], ...workspace };
  } else {
    // Add new (check limit)
    if (session.workspaces.length >= MAX_WORKSPACES) {
      throw new Error(`Maximum of ${MAX_WORKSPACES} workspaces allowed`);
    }
    session.workspaces.push(workspace);
  }
}

/**
 * Remove a workspace from session.
 * Updates activeWorkspaceId if removed workspace was active.
 * Returns number of remaining workspaces.
 */
function removeWorkspace(session, workspaceId) {
  session.workspaces = session.workspaces?.filter(w => w.id !== workspaceId) || [];

  // If removed workspace was active, switch to first remaining
  if (session.activeWorkspaceId === workspaceId) {
    session.activeWorkspaceId = session.workspaces[0]?.id || null;
  }

  return session.workspaces.length;
}

/**
 * Promisified session save.
 */
function saveSession(session) {
  return new Promise((resolve, reject) => {
    session.save(err => err ? reject(err) : resolve())
  })
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
  app.get('/test/set-session', (req, res) => {
    // Use new workspace schema for test sessions
    const testWorkspace = {
      id: 'test-workspace-id',
      name: 'Test Workspace',
      urlKey: 'test-workspace',
      accessToken: 'test-token',
      refreshToken: 'test-refresh-token',
      tokenExpiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours from now
      addedAt: Date.now()
    }

    req.session.workspaces = [testWorkspace]
    req.session.activeWorkspaceId = testWorkspace.id

    // Explicitly save session before responding to ensure it's persisted
    req.session.save((err) => {
      if (err) {
        res.status(500).send('session error')
      } else {
        res.send('ok')
      }
    })
  })
}

// Mock data matching Linear API structure for testing
const testMockTeams = [
  { id: 'team-eng', name: 'Engineering', key: 'ENG' },
  { id: 'team-design', name: 'Design', key: 'DES' }
]

const testMockData = {
  organizationName: 'Test Workspace',
  projects: [
    { id: 'proj-alpha', name: 'Project Alpha', content: 'First test project', url: 'https://linear.app/test/project/proj-alpha', sortOrder: 1 },
    { id: 'proj-beta', name: 'Project Beta', content: 'Second test project', url: 'https://linear.app/test/project/proj-beta', sortOrder: 2 }
  ],
  issues: [
    { id: 'issue-1', title: 'Parent task in progress', description: 'This is a parent task', estimate: 5, priority: 2, sortOrder: 1, createdAt: '2024-01-01T00:00:00Z', dueDate: '2024-02-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-1', parent: null, project: { id: 'proj-alpha' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Alice' }, labels: { nodes: [{ name: 'feature' }] }, team: { id: 'team-eng' } },
    { id: 'issue-2', title: 'Child task todo', description: 'A child task', estimate: 2, priority: 3, sortOrder: 2, createdAt: '2024-01-02T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-2', parent: { id: 'issue-1' }, project: { id: 'proj-alpha' }, state: { name: 'Todo', type: 'unstarted' }, assignee: null, labels: { nodes: [] }, team: { id: 'team-eng' } },
    { id: 'issue-3', title: 'Completed task', description: 'This task is done', estimate: 1, priority: 4, sortOrder: 3, createdAt: '2024-01-03T00:00:00Z', dueDate: null, completedAt: '2024-01-10T00:00:00Z', url: 'https://linear.app/test/issue/TEST-3', parent: null, project: { id: 'proj-alpha' }, state: { name: 'Done', type: 'completed' }, assignee: { name: 'Bob' }, labels: { nodes: [{ name: 'bug' }] }, team: { id: 'team-eng' } },
    { id: 'issue-4', title: 'Beta task in progress', description: 'An in-progress task in Beta', estimate: 3, priority: 1, sortOrder: 1, createdAt: '2024-01-04T00:00:00Z', dueDate: '2024-03-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-4', parent: null, project: { id: 'proj-beta' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Charlie' }, labels: { nodes: [{ name: 'urgent' }] }, team: { id: 'team-design' } },
    { id: 'issue-5', title: 'Beta todo task', description: 'A todo task in Beta', estimate: null, priority: 0, sortOrder: 2, createdAt: '2024-01-05T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-5', parent: null, project: { id: 'proj-beta' }, state: { name: 'Backlog', type: 'backlog' }, assignee: null, labels: { nodes: [] }, team: { id: 'team-design' } }
  ]
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
// OAuth 2.0 Routes
// =============================================================================
// Implements Authorization Code flow with Linear:
// 1. /auth/linear - Initiates OAuth by redirecting to Linear's authorize page
// 2. /auth/callback - Exchanges authorization code for access token
// 3. /logout - Destroys session and clears access token

/**
 * Step 1: Initiate OAuth flow
 * Generates a CSRF-prevention state token, stores it in session,
 * and redirects user to Linear's OAuth authorization page.
 */
app.get('/auth/linear', async (req, res) => {
  // Clean up expired sessions before proceeding (must await to avoid race conditions)
  await sessionStore.cleanup()

  // Generate random state token to prevent CSRF attacks
  const state = crypto.randomUUID()
  req.session.oauthState = state

  const params = new URLSearchParams({
    client_id: process.env.LINEAR_CLIENT_ID,
    redirect_uri: process.env.LINEAR_REDIRECT_URI,
    response_type: 'code',
    scope: 'read',  // Read-only access to Linear data
    state,
    prompt: 'consent'  // Always show consent screen with workspace picker
  })

  req.session.save(() => {
    res.redirect(`https://linear.app/oauth/authorize?${params}`)
  })
})

/**
 * Step 2: Handle OAuth callback
 * Linear redirects here after user authorizes. We:
 * 1. Validate the state token to prevent CSRF
 * 2. Exchange the authorization code for an access token
 * 3. Fetch organization info to identify the workspace
 * 4. Store workspace in session (supports multiple workspaces)
 */
app.get('/auth/callback', async (req, res) => {
  // Clean up expired sessions before proceeding (must await to avoid race conditions)
  await sessionStore.cleanup()

  const { code, state, error } = req.query

  // Handle user denial or OAuth errors
  if (error) {
    const errorMessages = {
      'access_denied': 'You cancelled the authorization request.',
      'invalid_request': 'The authorization request was invalid.',
      'unauthorized_client': 'This application is not authorized.',
      'server_error': 'Linear encountered an error. Please try again.',
    };
    const message = errorMessages[error] || `Authorization failed: ${error}`;
    const html = renderErrorPage('Authorization Cancelled', message, {
      action: 'Try again',
      actionUrl: '/auth/linear'
    });
    return res.status(400).send(html);
  }

  // Validate state token matches what we stored (CSRF protection)
  if (state !== req.session.oauthState) {
    const html = renderErrorPage('Session Expired', 'Your session expired or was invalid. This can happen if you took too long to authorize, or if your browser restarted.', {
      action: 'Try again',
      actionUrl: '/auth/linear'
    });
    return res.status(400).send(html);
  }

  try {
    // Exchange authorization code for access token
    const response = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.LINEAR_CLIENT_ID,
        client_secret: process.env.LINEAR_CLIENT_SECRET,
        redirect_uri: process.env.LINEAR_REDIRECT_URI,
        code
      })
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Token exchange error:', data.error);
      const html = renderErrorPage('Authentication Failed', 'Could not complete authentication with Linear. Please try again.', {
        action: 'Try again',
        actionUrl: '/auth/linear'
      });
      return res.status(400).send(html);
    }

    // Fetch organization info to identify workspace
    let org;
    try {
      org = await fetchOrganization(data.access_token);
    } catch (orgError) {
      console.error('Failed to fetch organization:', orgError);
      const html = renderErrorPage('Connection Error', 'Could not fetch workspace information from Linear. Please try again.', {
        action: 'Try again',
        actionUrl: '/auth/linear'
      });
      return res.status(500).send(html);
    }

    // Build workspace object
    const workspace = {
      id: org.id,
      name: org.name,
      urlKey: org.urlKey || org.name,  // Fallback to name if urlKey missing
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: calculateExpiresAt(data.expires_in || 86400),
      addedAt: Date.now()
    }

    // Add/update workspace in session
    try {
      upsertWorkspace(req.session, workspace);
    } catch (limitError) {
      const html = renderErrorPage('Workspace Limit Reached', 'You have reached the maximum number of connected workspaces. Please remove one before adding another.', {
        action: 'Go to dashboard',
        actionUrl: '/'
      });
      return res.status(400).send(html);
    }

    req.session.activeWorkspaceId = workspace.id
    delete req.session.oauthState  // Clean up CSRF token after use

    await saveSession(req.session)
    res.redirect('/')
  } catch (err) {
    console.error('OAuth callback error:', err);
    const html = renderErrorPage('Something Went Wrong', 'An unexpected error occurred during authentication. Please try again.', {
      action: 'Try again',
      actionUrl: '/auth/linear'
    });
    res.status(500).send(html);
  }
})

/**
 * Step 3: Logout
 * Destroys the session, effectively logging the user out.
 */
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error during logout:', err);
    }
    res.redirect('/');
  });
});

// =============================================================================
// Workspace Management Routes
// =============================================================================

/**
 * Switch active workspace (POST to avoid state change via GET)
 */
app.post('/workspace/:id/switch', async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) {
    return res.status(400).send('Invalid workspace ID');
  }

  const workspace = req.session.workspaces?.find(w => w.id === req.params.id);
  if (!workspace) {
    return res.status(404).send('Workspace not found');
  }

  req.session.activeWorkspaceId = workspace.id;
  await saveSession(req.session);
  res.redirect('/');
})

/**
 * Remove a workspace (POST for safety)
 */
app.post('/workspace/:id/remove', async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) {
    return res.status(400).send('Invalid workspace ID');
  }

  // If only one workspace, just logout entirely
  if (req.session.workspaces?.length <= 1) {
    return req.session.destroy(() => res.redirect('/'));
  }

  removeWorkspace(req.session, req.params.id);
  await saveSession(req.session);
  res.redirect('/');
})

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
