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
import { fetchProjects } from './lib/linear.js'
import { buildForest, partitionCompleted } from './lib/tree.js'
import { renderPage } from './lib/render.js'
import { parseLandingPage } from './lib/parse-landing.js'
import { refreshAccessToken, needsRefresh, calculateExpiresAt } from './lib/token-refresh.js'

// =============================================================================
// Constants
// =============================================================================
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_REFRESH_MAX_WAIT_RETRIES = 50; // Max retries for concurrent request waiting
const TOKEN_REFRESH_WAIT_DELAY_MS = 100; // Delay between retries when waiting

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
    req.session.accessToken = 'test-token'
    req.session.refreshToken = 'test-refresh-token'
    req.session.tokenExpiresAt = Date.now() + (24 * 60 * 60 * 1000) // 24 hours from now
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
const testMockData = {
  organizationName: 'Test Workspace',
  projects: [
    { id: 'proj-alpha', name: 'Project Alpha', content: 'First test project', url: 'https://linear.app/test/project/proj-alpha', sortOrder: 1 },
    { id: 'proj-beta', name: 'Project Beta', content: 'Second test project', url: 'https://linear.app/test/project/proj-beta', sortOrder: 2 }
  ],
  issues: [
    { id: 'issue-1', title: 'Parent task in progress', description: 'This is a parent task', estimate: 5, priority: 2, sortOrder: 1, createdAt: '2024-01-01T00:00:00Z', dueDate: '2024-02-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-1', parent: null, project: { id: 'proj-alpha' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Alice' }, labels: { nodes: [{ name: 'feature' }] } },
    { id: 'issue-2', title: 'Child task todo', description: 'A child task', estimate: 2, priority: 3, sortOrder: 2, createdAt: '2024-01-02T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-2', parent: { id: 'issue-1' }, project: { id: 'proj-alpha' }, state: { name: 'Todo', type: 'unstarted' }, assignee: null, labels: { nodes: [] } },
    { id: 'issue-3', title: 'Completed task', description: 'This task is done', estimate: 1, priority: 4, sortOrder: 3, createdAt: '2024-01-03T00:00:00Z', dueDate: null, completedAt: '2024-01-10T00:00:00Z', url: 'https://linear.app/test/issue/TEST-3', parent: null, project: { id: 'proj-alpha' }, state: { name: 'Done', type: 'completed' }, assignee: { name: 'Bob' }, labels: { nodes: [{ name: 'bug' }] } },
    { id: 'issue-4', title: 'Beta task in progress', description: 'An in-progress task in Beta', estimate: 3, priority: 1, sortOrder: 1, createdAt: '2024-01-04T00:00:00Z', dueDate: '2024-03-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-4', parent: null, project: { id: 'proj-beta' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Charlie' }, labels: { nodes: [{ name: 'urgent' }] } },
    { id: 'issue-5', title: 'Beta todo task', description: 'A todo task in Beta', estimate: null, priority: 0, sortOrder: 2, createdAt: '2024-01-05T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-5', parent: null, project: { id: 'proj-beta' }, state: { name: 'Backlog', type: 'backlog' }, assignee: null, labels: { nodes: [] } }
  ]
}

// =============================================================================
// Token Refresh Middleware
// =============================================================================
// Automatically refreshes access tokens before they expire (5-minute buffer).
// Prevents race conditions with tokenRefreshInProgress flag.

/**
 * Middleware to ensure access token is valid before each authenticated request.
 * Automatically refreshes token if it's expired or about to expire (5-minute buffer).
 */
async function ensureValidToken(req, res, next) {
  // Skip if no access token (unauthenticated user)
  if (!req.session.accessToken) {
    return next();
  }

  // Skip if no refresh token (shouldn't happen with new flow)
  if (!req.session.refreshToken) {
    return next();
  }

  // Check if token needs refresh (5-minute buffer)
  if (!needsRefresh(req.session.tokenExpiresAt)) {
    return next();
  }

  // Prevent concurrent refresh attempts
  if (req.session.tokenRefreshInProgress) {
    // Track retry attempts to prevent infinite loops
    if (!req._tokenRefreshRetries) req._tokenRefreshRetries = 0;

    if (req._tokenRefreshRetries >= TOKEN_REFRESH_MAX_WAIT_RETRIES) {
      console.error('Token refresh timeout - exceeded max retries');
      // Reset and let the 401 handler deal with it
      delete req._tokenRefreshRetries;
      return next();
    }

    req._tokenRefreshRetries++;
    // Wait briefly and recheck (simple approach for concurrent requests)
    return setTimeout(() => ensureValidToken(req, res, next), TOKEN_REFRESH_WAIT_DELAY_MS);
  }

  try {
    // Set flag and save it before starting refresh
    req.session.tokenRefreshInProgress = true;
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });

    const tokenData = await refreshAccessToken(req.session.refreshToken);

    // Update session with new tokens and remove the flag
    req.session.accessToken = tokenData.access_token;
    req.session.refreshToken = tokenData.refresh_token;
    req.session.tokenExpiresAt = calculateExpiresAt(tokenData.expires_in);
    delete req.session.tokenRefreshInProgress; // Remove flag entirely

    // Save session before proceeding
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });

    console.log('Token refreshed successfully');
    next();
  } catch (error) {
    // Clean up flag on error
    delete req.session.tokenRefreshInProgress;
    // Best effort to persist the cleanup
    await new Promise((resolve) => {
      req.session.save(() => resolve());
    }).catch(() => {}); // Ignore save errors during cleanup

    console.error('Token refresh failed:', error);

    // If refresh token expired/invalid, clear session and redirect to landing
    if (error.code === 'EXPIRED' || error.code === 'INVALID') {
      return req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        res.redirect('/');
      });
    }

    // For network errors, allow request to proceed (will fail with 401 if needed)
    next();
  }
}

// Apply middleware to all routes except auth and logout routes
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/logout') {
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
    state
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
 * 3. Store the access token in the session
 */
app.get('/auth/callback', async (req, res) => {
  // Clean up expired sessions before proceeding (must await to avoid race conditions)
  await sessionStore.cleanup()

  const { code, state, error } = req.query

  // Handle user denial or OAuth errors
  if (error) {
    return res.status(400).send(`<pre>OAuth error: ${error}</pre>`)
  }

  // Validate state token matches what we stored (CSRF protection)
  if (state !== req.session.oauthState) {
    return res.status(400).send('<pre>Invalid state parameter</pre>')
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
      return res.status(400).send(`<pre>Token error: ${data.error || 'Unknown error'}</pre>`)
    }

    // Store access token, refresh token, and expiration in session
    req.session.accessToken = data.access_token;
    req.session.refreshToken = data.refresh_token;
    req.session.tokenExpiresAt = calculateExpiresAt(data.expires_in || 86400);
    delete req.session.oauthState; // Clean up CSRF token after use
    req.session.save(() => {
      res.redirect('/');
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    const errorMessage = process.env.NODE_ENV === 'production'
      ? 'Authentication error occurred'
      : err.message;
    res.status(500).send(`<pre>Error: ${errorMessage}</pre>`);
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
// Main Application Route
// =============================================================================

/**
 * Helper function to fetch and prepare project data for rendering.
 * Handles both test mode and real API calls.
 *
 * @param {string} accessToken - The access token for Linear API
 * @returns {Promise<{trees, inProgressIssues, organizationName}>} Prepared data for rendering
 */
async function fetchAndPrepareProjects(accessToken) {
  // Use mock data in test mode to avoid hitting Linear API
  const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
  const { organizationName, projects, issues } = isTestMode
    ? testMockData
    : await fetchProjects(accessToken);

  // Build issue tree structure (parent-child relationships)
  const forest = buildForest(issues);

  // Extract in-progress issues for the dedicated "In Progress" section
  // Sorted by priority (urgent first) with creation date as tiebreaker
  const inProgressIssues = issues
    .filter(i => i.state?.type === 'started')
    .map(issue => ({
      ...issue,
      projectName: projects.find(p => p.id === issue.project?.id)?.name
    }))
    .sort((a, b) => {
      // Priority: 1=Urgent, 2=High, 3=Medium, 4=Low, 0=None
      // Lower number = higher priority, but 0 (none) should sort last
      const aPriority = a.priority || 5;
      const bPriority = b.priority || 5;
      if (aPriority !== bPriority) return aPriority - bPriority;
      // Tiebreaker: createdAt (oldest first, matching Linear's default)
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

  // Build tree structure for each project, separating complete from incomplete
  const trees = projects
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(project => {
      const { roots } = forest.get(project.id) || { roots: [] };
      const { incomplete, completed, completedCount } = partitionCompleted(roots);
      return { project, incomplete, completed, completedCount };
    });

  return { trees, inProgressIssues, organizationName };
}

/**
 * Home page - renders either landing page or authenticated project view.
 *
 * For unauthenticated users: Shows pre-rendered static landing page.
 * For authenticated users: Fetches projects/issues from Linear API and renders
 * the interactive tree view with "In Progress" section.
 */
app.get('/', async (req, res) => {
  // Unauthenticated users see the static landing page
  if (!req.session.accessToken) {
    const html = renderPage(landingTrees, [], landingData.organizationName, { isLanding: true })
    return res.send(html)
  }

  try {
    const { trees, inProgressIssues, organizationName } = await fetchAndPrepareProjects(req.session.accessToken);
    const html = renderPage(trees, inProgressIssues, organizationName);
    res.send(html);
  } catch (error) {
    console.error('Error fetching projects:', error)

    // If token is invalid/expired (401), attempt refresh and retry
    if (error.response?.status === 401 && req.session.refreshToken) {
      try {
        // Attempt to refresh the token
        const tokenData = await refreshAccessToken(req.session.refreshToken);
        req.session.accessToken = tokenData.access_token;
        req.session.refreshToken = tokenData.refresh_token;
        req.session.tokenExpiresAt = calculateExpiresAt(tokenData.expires_in);

        // Save session with new tokens
        await new Promise((resolve, reject) => {
          req.session.save((err) => err ? reject(err) : resolve());
        });

        console.log('Token refreshed after 401, retrying request');

        // Retry the request with the new token
        const { trees, inProgressIssues, organizationName } = await fetchAndPrepareProjects(req.session.accessToken);
        const html = renderPage(trees, inProgressIssues, organizationName);
        return res.send(html);
      } catch (refreshError) {
        // Refresh failed, clear session and show landing page
        console.error('Token refresh failed after 401:', refreshError);
        return req.session.destroy((err) => {
          if (err) console.error('Session destroy error:', err);
          const html = renderPage(landingTrees, [], landingData.organizationName, { isLanding: true });
          res.send(html);
        });
      }
    }

    // If 401 but no refresh token, or other errors, clear session and show landing
    if (error.response?.status === 401) {
      return req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        const html = renderPage(landingTrees, [], landingData.organizationName, { isLanding: true });
        res.send(html);
      });
    }

    const errorMessage = process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : error.message;
    res.status(500).send(`<pre>Error: ${errorMessage}</pre>`);
  }
})

// =============================================================================
// Server Startup
// =============================================================================
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Linear Projects Viewer running at http://localhost:${PORT}`)
})
