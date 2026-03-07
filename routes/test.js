/**
 * Test-only routes for Playwright E2E tests.
 *
 * Allows tests to bypass OAuth and use predictable mock data.
 * Only mounted when NODE_ENV === 'test'.
 */
import { Router } from 'express';
import { isValidFeatureKey } from '../lib/feature-defaults.js';

/**
 * Create test routes with required dependencies.
 * @param {Object} options
 * @param {Object} options.dispatchQueueStore - Dispatch queue store
 * @param {Object} options.dispatchTokenStore - Dispatch token store
 * @param {Object} options.freeTierStore - Free tier usage store
 * @param {Object} options.userPreferencesStore - User preferences store
 * @param {Object} options.proxyTokenStore - Proxy token store
 * @param {Object} options.proxyEventStore - Proxy event store
 * @param {Function} options.getWorkspaceAccessToken - Function to look up workspace access token
 * @returns {Router} Express router
 */
export function createTestRoutes({ dispatchQueueStore, dispatchTokenStore, freeTierStore, userPreferencesStore, proxyTokenStore, proxyEventStore, getWorkspaceAccessToken }) {
  const router = Router();

  // Endpoint to set a test session without going through OAuth flow
  // Query parameters:
  //   ?tokenExpired=true        - Set token expiry in the past
  //   ?noRefreshToken=true      - Omit refresh token
  //   ?multiWorkspace=true      - Set up 2 workspaces
  //   ?maxWorkspaces=true       - Set up 10 workspaces (at limit)
  //   ?openRouterConnected=true - Set up OpenRouter API key in session
  //   ?freeTierEnabled=true     - Simulate free tier mode (no OAuth, no env key)
  router.get('/test/set-session', (req, res) => {
    const { tokenExpired, noRefreshToken, multiWorkspace, maxWorkspaces, openRouterConnected, freeTierEnabled, features } = req.query

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
    req.session.linearUserId = 'test-linear-user-id'

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

    // Set feature flags in session for testing (JSON string of overrides)
    // Validate each key against the whitelist to prevent arbitrary session injection
    if (features) {
      try {
        const parsed = JSON.parse(features)
        const validated = {}
        for (const [key, value] of Object.entries(parsed)) {
          if (isValidFeatureKey(key)) {
            validated[key] = value
          }
        }
        req.session.features = validated
      } catch {
        // Ignore invalid JSON
      }
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
  router.get('/test/clear-session', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).send('session error')
      } else {
        res.send('ok')
      }
    })
  })

  // Endpoint to create a dispatch token for testing
  // Optional query parameter: ?label=custom-label (default: 'test-token')
  router.get('/test/create-dispatch-token', async (req, res) => {
    try {
      const label = req.query.label || 'test-token'
      const { tokenId, token } = await dispatchTokenStore.createToken(
        'test-workspace',
        label
      )
      res.json({ tokenId, token })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear dispatch queue for testing
  router.get('/test/clear-dispatch-queue', async (req, res) => {
    try {
      await dispatchQueueStore.clear('test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear dispatch tokens for testing
  router.get('/test/clear-dispatch-tokens', async (req, res) => {
    try {
      await dispatchTokenStore.clear('test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear free tier usage for testing
  router.get('/test/clear-free-tier', async (req, res) => {
    try {
      await freeTierStore.clear('test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear recent custom prompts for testing
  router.get('/test/clear-recent-prompts', async (req, res) => {
    try {
      const prefs = await userPreferencesStore.getUserPreferences('test-linear-user-id');
      await userPreferencesStore.saveUserPreferences('test-linear-user-id', {
        ...prefs,
        recentCustomPrompts: {}
      });
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint to clear dispatch history for testing
  router.get('/test/clear-dispatch-history', async (req, res) => {
    try {
      await dispatchQueueStore.clearHistory('test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to create a proxy token for testing
  router.get('/test/create-proxy-token', async (req, res) => {
    try {
      const label = req.query.label || 'test-proxy-token'
      const scope = req.query.scope || 'read'
      const result = await proxyTokenStore.createToken('test-workspace', {
        label,
        scope,
        singleUse: req.query.singleUse === 'true'
      })
      res.json({ tokenId: result.tokenId, token: result.token, scope: result.scope })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear proxy tokens for testing
  router.get('/test/clear-proxy-tokens', async (req, res) => {
    try {
      await proxyTokenStore.clear('test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear proxy events for testing
  router.get('/test/clear-proxy-events', async (req, res) => {
    try {
      await proxyEventStore.clear('test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to add free tier usage for testing
  router.get('/test/add-free-tier-usage', async (req, res) => {
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

  // Endpoint to test workspace access token lookup from sessions
  // Uses a non-test-workspace urlKey to bypass the test-mode shortcut
  // and exercise the real session-scanning code path.
  router.get('/test/workspace-token/:urlKey', async (req, res) => {
    try {
      const token = await getWorkspaceAccessToken(req.params.urlKey);
      res.json({ found: !!token });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })

  return router;
}
