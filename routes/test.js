/**
 * Test-only routes for Playwright E2E tests.
 *
 * Allows tests to bypass OAuth and use predictable mock data.
 * Only mounted when NODE_ENV === 'test'.
 */
import { Router } from 'express';
import { isValidFeatureKey, isValidWorkspaceFeatureKey } from '../lib/feature-defaults.js';
import { setWorkspaceFeature } from '../lib/workspace-preferences.js';
import { getProvider } from '../lib/providers/registry.js';
import { defaultLocalSeed, LOCAL_WORKSPACE_URL_KEY } from '../tests/fixtures/local-harness.js';

/**
 * Create test routes with required dependencies.
 * @param {Object} options
 * @param {Object} options.dispatchQueueStore - Dispatch queue store
 * @param {Object} options.dispatchTokenStore - Dispatch token store
 * @param {Object} options.freeTierStore - Free tier usage store
 * @param {Object} options.userPreferencesStore - User preferences store
 * @param {Object} options.proxyTokenStore - Proxy token store
 * @param {Object} options.proxyEventStore - Proxy event store
 * @param {Object} options.foremanStore - Foreman status store
 * @param {Object} options.localStore - Local provider's issue/project store (LIN-356)
 * @param {Function} options.getWorkspaceAccessToken - Function to look up workspace access token
 * @returns {Router} Express router
 */
export function createTestRoutes({ dispatchQueueStore, dispatchTokenStore, freeTierStore, userPreferencesStore, workspacePreferencesStore, customPromptsStore, proxyTokenStore, proxyEventStore, foremanStore, recapCacheStore, briefCacheStore, runSummaryCacheStore, reportHistoryStore, localStore, getWorkspaceAccessToken }) {
  const router = Router();

  // ── Mock Yap server (LIN-450) ─────────────────────────────────────────────
  // A tiny in-memory stand-in for the Yap chat server so the Collective live
  // view can be exercised deterministically in e2e without real network egress.
  // Enabled by pointing YAP_BASE_URL at `http://localhost:PORT/test/yap`
  // (see playwright.config.js). say→poll round-trips through a per-channel ring.
  const yapBuffers = new Map(); // channel -> { messages: [], nextId }
  const yapChannel = (name) => {
    if (!yapBuffers.has(name)) yapBuffers.set(name, { messages: [], nextId: 1 });
    return yapBuffers.get(name);
  };
  router.post('/test/yap/api/join', (req, res) => {
    const buf = yapChannel(req.body?.channel || '#test');
    res.json({ recent: buf.messages.slice(-50), cursor: buf.nextId - 1 });
  });
  router.post('/test/yap/api/say', (req, res) => {
    // Mirror real Yap: the say request carries `message`, but stored/polled
    // messages expose the body as `text`.
    const { channel = '#test', nick = 'anon', message = '', type } = req.body || {};
    const buf = yapChannel(channel);
    const id = buf.nextId++;
    const entry = { id, channel, nick, text: message, type: type || 'message', timestamp: Date.now() };
    buf.messages.push(entry);
    res.json({ id, timestamp: entry.timestamp });
  });
  router.post('/test/yap/api/poll', (req, res) => {
    const { channel = '#test', since_id = 0 } = req.body || {};
    const buf = yapChannel(channel);
    const messages = buf.messages.filter(m => m.id > since_id);
    res.json({ messages, mentions: [], cursor: buf.nextId - 1, truncated: false });
  });
  router.post('/test/yap/api/history', (req, res) => {
    const buf = yapChannel(req.body?.channel || '#test');
    const limit = req.body?.limit;
    res.json({ messages: limit ? buf.messages.slice(-limit) : buf.messages });
  });
  router.get('/test/yap/clear', (req, res) => { yapBuffers.clear(); res.send('ok'); });

  // Endpoint to set a test session without going through OAuth flow
  // Query parameters:
  //   ?tokenExpired=true        - Set token expiry in the past
  //   ?noRefreshToken=true      - Omit refresh token
  //   ?multiWorkspace=true      - Set up 2 workspaces
  //   ?maxWorkspaces=true       - Set up 10 workspaces (at limit)
  //   ?openRouterConnected=true - Set up OpenRouter API key in session
  //   ?freeTierEnabled=true     - Simulate free tier mode (no OAuth, no env key)
  router.get('/test/set-session', (req, res) => {
    const { tokenExpired, noRefreshToken, multiWorkspace, maxWorkspaces, openRouterConnected, freeTierEnabled, features, swimSample, shipSample, patMode } = req.query

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

    // PAT mode: mark first workspace as personal access token
    if (patMode) {
      workspaces[0].isPAT = true;
      workspaces[0].tokenExpiresAt = Number.MAX_SAFE_INTEGER;
      delete workspaces[0].refreshToken;
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

    // Set swim sample data flag for swim page testing/screenshots
    if (swimSample) {
      req.session.swimSample = true
    } else {
      delete req.session.swimSample
    }

    // Dense ship sample (8 projects, 6 WIP, ~36 cards) for stress-testing the
    // Ship view's layout at realistic density.
    if (shipSample) {
      req.session.shipSample = true
    } else {
      delete req.session.shipSample
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
  // Optional query parameters: ?label=custom-label (default: 'test-token'),
  //   ?urlKey=<workspace> (default 'test-workspace' for back-compat; LIN-387
  //   lets the pipeline-scenarios suite scope tokens to 'local-workspace').
  router.get('/test/create-dispatch-token', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      const label = req.query.label || 'test-token'
      const { tokenId, token } = await dispatchTokenStore.createToken(
        urlKey,
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
      await dispatchQueueStore.clear(req.query.urlKey || 'test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear dispatch tokens for testing
  router.get('/test/clear-dispatch-tokens', async (req, res) => {
    try {
      await dispatchTokenStore.clear(req.query.urlKey || 'test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear free tier usage for testing
  router.get('/test/clear-free-tier', async (req, res) => {
    try {
      // urlKey-parameterized (default test-workspace) so a migrated local spec
      // can clear/charge its OWN workspace's free-tier counter (LIN-405).
      await freeTierStore.clear(req.query.urlKey || 'test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear recent custom prompts for testing.
  // Recents are stored per user (req.session.linearUserId), so clear the CURRENT
  // session's user when one exists — a local session uses 'test-local-user-id',
  // not the 'test-linear-user-id' the test-token path uses (LIN-425). Falls back
  // to the test-token user for callers that clear before establishing a session.
  router.get('/test/clear-recent-prompts', async (req, res) => {
    try {
      const userId = req.session.linearUserId || 'test-linear-user-id';
      const prefs = await userPreferencesStore.getUserPreferences(userId);
      await userPreferencesStore.saveUserPreferences(userId, {
        ...prefs,
        recentCustomPrompts: {}
      });
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint to clear custom prompts for testing
  // Optional ?urlKey=<workspace> (default 'test-workspace' for back-compat).
  // The store is partitioned by workspace urlKey and /api/prompts/custom
  // reads/writes the ACTIVE workspace, so local-session specs must pass
  // ?urlKey=local-workspace to clear the partition they actually use.
  router.get('/test/clear-custom-prompts', async (req, res) => {
    try {
      await customPromptsStore.deleteAll(req.query.urlKey || 'test-workspace');
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint to clear dispatch history for testing
  router.get('/test/clear-dispatch-history', async (req, res) => {
    try {
      await dispatchQueueStore.clearHistory(req.query.urlKey || 'test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to create a proxy token for testing
  // Optional ?urlKey=<workspace> (default 'test-workspace' for back-compat).
  router.get('/test/create-proxy-token', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      const label = req.query.label || 'test-proxy-token'
      const scope = req.query.scope || 'read'
      const result = await proxyTokenStore.createToken(urlKey, {
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
      await proxyTokenStore.clear(req.query.urlKey || 'test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear proxy events for testing
  router.get('/test/clear-proxy-events', async (req, res) => {
    try {
      await proxyEventStore.clear(req.query.urlKey || 'test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear foreman status for testing
  router.get('/test/clear-foreman-status', async (req, res) => {
    try {
      await foremanStore.clear(req.query.urlKey || 'test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear report history for testing
  router.get('/test/clear-report-history', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      if (reportHistoryStore) await reportHistoryStore.clear(urlKey)
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to add free tier usage for testing
  router.get('/test/add-free-tier-usage', async (req, res) => {
    try {
      const count = parseInt(req.query.count, 10) || 1
      const urlKey = req.query.urlKey || 'test-workspace'
      for (let i = 0; i < count; i++) {
        await freeTierStore.recordUsage(urlKey)
      }
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear a specific recap cache entry for tests.
  // Query params: ?urlKey=...&issueId=...
  router.get('/test/clear-recap-cache', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace';
      const issueId = req.query.issueId;
      if (!issueId) {
        return res.status(400).json({ error: 'issueId required' });
      }
      await recapCacheStore.delete(urlKey, issueId);
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint to clear a specific run-summary cache entry for tests (LIN-509).
  // Query params: ?urlKey=...&loopId=...
  router.get('/test/clear-run-summary-cache', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace';
      const loopId = req.query.loopId;
      if (!loopId) {
        return res.status(400).json({ error: 'loopId required' });
      }
      if (runSummaryCacheStore) await runSummaryCacheStore.delete(urlKey, loopId);
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint to clear a specific brief cache entry for tests.
  // Query params: ?urlKey=...&issueId=...
  router.get('/test/clear-brief-cache', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace';
      const issueId = req.query.issueId;
      if (!issueId) {
        return res.status(400).json({ error: 'issueId required' });
      }
      await briefCacheStore.delete(urlKey, issueId);
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint to seed/clear the workspace model preference for tests.
  // Query params: ?modelId=<id>  → save, or omit/empty → delete
  router.get('/test/set-workspace-model', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace';
      const modelId = req.query.modelId || '';
      if (modelId) {
        const existing = await workspacePreferencesStore.getWorkspacePreferences(urlKey);
        await workspacePreferencesStore.saveWorkspacePreferences(urlKey, {
          ...existing,
          modelId
        });
      } else {
        await workspacePreferencesStore.deleteWorkspacePreferences(urlKey);
      }
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint to toggle a workspace feature flag for tests (LIN-341).
  // Query params: ?key=periodicals&value=true|false  (urlKey defaults to test-workspace)
  router.get('/test/set-workspace-feature', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace';
      const featureKey = req.query.key;
      if (!isValidWorkspaceFeatureKey(featureKey)) {
        return res.status(400).json({ error: `invalid workspace feature key: ${featureKey}` });
      }
      const enabled = req.query.value === 'true';
      await setWorkspaceFeature({ urlKey, featureKey, enabled, store: workspacePreferencesStore });
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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

  // ---------------------------------------------------------------------------
  // Local provider harness (LIN-356) — a GENUINE second provider with no
  // `test-token` mock short-circuit. The local workspace's token is its own
  // urlKey (the store partition key), so `accessToken === 'test-token'` is
  // false everywhere and the dashboard renders from the seeded LocalStore via
  // the real getProviderForWorkspace + getWorkspaceToken read seam (#382).
  // ---------------------------------------------------------------------------
  const LOCAL_WS_URL_KEY = LOCAL_WORKSPACE_URL_KEY;
  const LOCAL_WS_UUID = '33333333-3333-3333-3333-333333333333';

  // Seed the local store and establish a `provider: 'local'` session.
  //
  // GET  → seeds the shared defaultLocalSeed (back-compat / no body).
  // POST → seeds a custom `{ projects, issues }` body, letting specs seed
  //        exactly the data they assert on (LIN-378 reusable harness). Falls
  //        back to defaultLocalSeed when the body carries no projects/issues.
  //        An optional `features` object sets session feature flags, validated
  //        against the same whitelist as /test/set-session.
  const setLocalSession = async (req, res) => {
    try {
      if (!localStore) throw new Error('localStore not wired into test routes');

      const body = req.body || {};
      const seed = (Array.isArray(body.projects) || Array.isArray(body.issues))
        ? { projects: body.projects || [], issues: body.issues || [] }
        : defaultLocalSeed;

      if (body.features && typeof body.features === 'object') {
        const validated = {}
        for (const [key, value] of Object.entries(body.features)) {
          if (isValidFeatureKey(key)) validated[key] = value
        }
        req.session.features = validated
      }

      await localStore.clear(LOCAL_WS_URL_KEY);
      await localStore.seed(LOCAL_WS_URL_KEY, seed);

      // Token === urlKey: carries no auth, only selects the store partition.
      // No `accessToken: 'test-token'`, so the mock short-circuit never fires.
      req.session.workspaces = [{
        id: LOCAL_WS_UUID,
        name: 'Local Workspace',
        urlKey: LOCAL_WS_URL_KEY,
        provider: 'local',
        credentials: { token: LOCAL_WS_URL_KEY },
        accessToken: LOCAL_WS_URL_KEY,
        tokenExpiresAt: Number.MAX_SAFE_INTEGER,
        addedAt: Date.now(),
      }];
      req.session.activeWorkspaceId = LOCAL_WS_UUID;
      req.session.linearUserId = 'test-local-user-id';

      // Optionally provision a mock OpenRouter key, mirroring /test/set-session
      // (L93-97). Honored from query (GET) or body (POST). Superset/no-op by
      // default: absent → delete, so existing local specs are unchanged. This is
      // how a local session can clear resolveRoadmapLLM's apiKey 503 gate without
      // exempting the gate itself.
      const openRouterConnected = req.query.openRouterConnected || (req.body && req.body.openRouterConnected);
      if (openRouterConnected) {
        req.session.openRouterApiKey = 'test-openrouter-key';
      } else {
        delete req.session.openRouterApiKey;
      }

      // Optionally simulate free-tier mode (no key, session flag), mirroring
      // /test/set-session (L100-103). Needed for the recommend free-tier block,
      // which charges via the session flag — CI sets no OPENROUTER_FREE_TIER_KEY,
      // so the env-key gate never fires (LIN-405). Superset/no-op by default.
      const freeTierEnabled = req.query.freeTierEnabled || (req.body && req.body.freeTierEnabled);
      if (freeTierEnabled) {
        req.session.freeTierEnabled = true;
      } else {
        delete req.session.freeTierEnabled;
      }

      req.session.save(() => res.json({ ok: true, urlKey: LOCAL_WS_URL_KEY }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  router.get('/test/set-local-session', setLocalSession);
  router.post('/test/set-local-session', setLocalSession);

  // Exercise the provider WRITE path directly (the gap this provider exists to
  // close): create an issue through the registered Local provider — not the
  // proxy — so a subsequent dashboard load proves the no-proxy write round-trip.
  router.get('/test/local-create-issue', async (req, res) => {
    try {
      const provider = getProvider('local');
      if (!provider) throw new Error('local provider not registered');
      const created = await provider.createIssue(LOCAL_WS_URL_KEY, {
        title: req.query.title || 'Created via provider',
        projectId: 'local-proj-1',
        state: { name: 'Todo', type: 'unstarted' },
      });
      res.json({ ok: true, issue: { id: created.id, identifier: created.identifier, title: created.title } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })

  // Clear the local store partition (test teardown / isolation).
  router.get('/test/clear-local-store', async (req, res) => {
    try {
      const removed = localStore ? await localStore.clear(LOCAL_WS_URL_KEY) : 0;
      res.json({ ok: true, removed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })

  return router;
}
