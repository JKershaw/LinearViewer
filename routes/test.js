/**
 * Test-only routes for Playwright E2E tests.
 *
 * Allows tests to bypass OAuth and use predictable mock data.
 * Only mounted when NODE_ENV === 'test'.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { isValidFeatureKey, isValidWorkspaceFeatureKey } from '../lib/feature-defaults.js';
import { setWorkspaceFeature } from '../lib/workspace-preferences.js';
import { getProvider } from '../lib/providers/registry.js';
import { defaultLocalSeed, LOCAL_WORKSPACE_URL_KEY } from '../tests/fixtures/local-harness.js';
// Importing the GitHub provider module self-registers it under 'github' (see
// registry.js lifecycle), so the read seam can resolve a `provider: 'github'`
// workspace. The fake client backs the E2E with no network/auth (LIN-178).
import '../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../lib/providers/github/fake-client.js';
import { defaultGitHubSeed, GITHUB_WORKSPACE_URL_KEY, GITHUB_REPO } from '../tests/fixtures/github-harness.js';
// Same self-registration for the GitHub Projects v2 provider (LIN-560): importing
// it registers 'github-projects' so the read seam can resolve a board-backed
// workspace, and its fake GraphQL client backs the E2E with no network/auth.
import '../lib/providers/github-projects/index.js';
import { createFakeGitHubProjectsClient } from '../lib/providers/github-projects/fake-client.js';
import { defaultGitHubProjectsSeed, GITHUB_PROJECTS_WORKSPACE_URL_KEY, GITHUB_PROJECTS_BOARD } from '../tests/fixtures/github-projects-harness.js';
// Same self-registration for the Jira Cloud provider (LIN-1885, Phase 1 of
// LIN-275): importing it registers 'jira' so the read seam can resolve a
// Jira-backed workspace, and its fake REST client backs the E2E with no
// network/auth (never live Jira).
import '../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../lib/providers/jira/fake-client.js';
import { defaultJiraSeed, JIRA_WORKSPACE_URL_KEY, JIRA_SITE } from '../tests/fixtures/jira-harness.js';
import { establishAccount } from '../lib/account-session.js';
import { respondToAccountConflict } from '../lib/account-conflict.js';

/**
 * Create test routes with required dependencies.
 * @param {Object} options
 * @param {Object} options.dispatchQueueStore - Dispatch queue store
 * @param {Object} options.dispatchTokenStore - Dispatch token store
 * @param {Object} options.freeTierStore - Free tier usage store
 * @param {Object} options.userPreferencesStore - User preferences store
 * @param {Object} options.proxyTokenStore - Proxy token store
 * @param {Object} options.proxyEventStore - Proxy event store
 * @param {Object} options.agentStatusStore - Agent status store
 * @param {Object} options.localStore - Local provider's issue/project store (LIN-356)
 * @param {Function} options.getWorkspaceAccessToken - Function to look up workspace access token
 * @returns {Router} Express router
 */
export function createTestRoutes({ dispatchQueueStore, dispatchTokenStore, freeTierStore, userPreferencesStore, workspacePreferencesStore, customPromptsStore, collectiveCharactersStore, collectivePresetsStore, dispatchPresetsStore, proxyTokenStore, proxyEventStore, agentStatusStore, observationSessionsStore, sessionsFeedCache, recapCacheStore, briefCacheStore, runSummaryCacheStore, sessionSummaryCacheStore, reportHistoryStore, shipBiscuitHistoryStore, taskSnapshotStore, taskDecisionsStore, shelvedRulingsStore, savedChatStore, localStore, getWorkspaceAccessToken, accountStore, accountWorkspaceStore, ownerCredentialStore, clearWorkspaceIssuesMemo }) {
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

  // ── Mock Atlassian OAuth token/accessible-resources endpoints (LIN-2001) ───
  // In-process stand-ins for the two direct-`fetch` calls
  // `lib/providers/jira/oauth.js` makes to Atlassian during the OAuth 3LO
  // callback (`postJiraToken`'s POST, `fetchJiraAccessibleResources`'s GET) —
  // same idiom as the Yap block above, enabled by pointing the new
  // JIRA_OAUTH_TEST_BASE env var at `http://localhost:PORT/test/atlassian`
  // (see playwright.config.js). Both are stateless canned responses: in
  // production the token endpoint and the accessible-resources endpoint live
  // on two DIFFERENT hosts with two DIFFERENT path shapes, but the fake only
  // needs its two path SUFFIXES to stay distinct, which one shared base
  // achieves for free. No `myself`/REST-gateway fake is needed here — the
  // identity lookup and the post-redirect dashboard reads both resolve
  // through the existing `clientFactory` seam above once a spec seeds it.
  const JIRA_OAUTH_TEST_CLOUD_ID = 'test-oauth-cloud-id';
  router.post('/test/atlassian/oauth/token', (req, res) => {
    res.json({ access_token: 'fake-oauth-access-token', refresh_token: 'fake-oauth-refresh-token', expires_in: 3600 });
  });
  router.get('/test/atlassian/oauth/token/accessible-resources', (req, res) => {
    res.json([{ id: JIRA_OAUTH_TEST_CLOUD_ID, url: JIRA_SITE, name: 'Acme' }]);
  });

  // Endpoint to set a test session without going through OAuth flow
  // Query parameters:
  //   ?tokenExpired=true        - Set token expiry in the past
  //   ?noRefreshToken=true      - Omit refresh token
  //   ?multiWorkspace=true      - Set up 2 workspaces
  //   ?maxWorkspaces=true       - Set up 10 workspaces (at limit)
  //   ?openRouterConnected=true - Set up OpenRouter API key in session
  //   ?freeTierEnabled=true     - Simulate free tier mode (no OAuth, no env key)
  //   ?urlKey=<workspace>       - Per-worker urlKey for the FIRST workspace
  //                               (LIN-625 S1). Defaults to 'test-workspace' for
  //                               back-compat. The multiWorkspace / maxWorkspaces
  //                               branches derive their sibling keys from the
  //                               per-worker suffix carried by this key (LIN-628),
  //                               so every workspace in the session is partition-
  //                               distinct per worker once workers>1 (S3); without
  //                               a `-wN` suffix the siblings stay second-workspace
  //                               / workspace-N, keeping the default byte-identical.
  router.get('/test/set-session', async (req, res) => {
    const { tokenExpired, noRefreshToken, multiWorkspace, maxWorkspaces, openRouterConnected, freeTierEnabled, features, swimSample, shipSample, patMode, noLinearUser } = req.query
    // Per-worker key for the first workspace; same `?urlKey=` interface the
    // teardown endpoints already use, with the identical 'test-workspace' default.
    const singleUrlKey = req.query.urlKey || 'test-workspace'
    // The per-worker discriminator (`-w<parallelIndex>`, set by the workerUrlKey
    // fixture) that the multi-workspace siblings inherit so they don't collide
    // across parallel workers. Empty for the bare 'test-workspace' default or any
    // custom key, so the multiWorkspace / maxWorkspaces output is unchanged then.
    const workerSuffix = (singleUrlKey.match(/-w\d+$/) || [''])[0]

    // Base workspace configuration - IDs must be valid UUIDs to pass validation.
    // LIN-1524: no `refreshToken` field — Linear session workspaces never carry
    // one anymore. `noRefreshToken` now controls whether a durable record gets
    // seeded (below, once accountId is known), not a session-side field.
    const createWorkspace = (id, name, urlKey) => ({
      id,
      name,
      urlKey,
      accessToken: 'test-token',
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
          `workspace-${i}${workerSuffix}`
        )
      )
    } else if (multiWorkspace) {
      // Create 2 workspaces for switching tests. The first uses the per-worker
      // key verbatim; the second inherits the same worker suffix (LIN-628).
      workspaces = [
        createWorkspace(TEST_UUID_1, 'Test Workspace', singleUrlKey),
        createWorkspace(TEST_UUID_2, 'Second Workspace', `second-workspace${workerSuffix}`)
      ]
    } else {
      // Default: single workspace (urlKey is per-worker-aware; LIN-625 S1)
      workspaces = [
        createWorkspace(TEST_UUID_1, 'Test Workspace', singleUrlKey)
      ]
    }

    // PAT mode: mark first workspace as personal access token. No durable
    // record follows (LIN-1524 close-out Finding #3: PAT gets none, by design
    // — a PAT has no refresh_token to persist).
    if (patMode) {
      workspaces[0].isPAT = true;
      workspaces[0].tokenExpiresAt = Number.MAX_SAFE_INTEGER;
    }

    req.session.workspaces = workspaces
    req.session.activeWorkspaceId = workspaces[0].id
    // `noLinearUser` simulates a session with no user identity (local/GitHub App
    // link path), so specs can exercise the "saved chats unavailable" boundary
    // (LIN-1008). Default establishes an account below, so existing specs are
    // unchanged. Also clears any pre-existing `accountId` (LIN-1353) — a prior
    // `/test/set-session` in the same test session (e.g. a beforeEach chain) may
    // have already established one, and the saved-chat/prompt gates key on
    // `accountId`; leaving a stale accountId behind would make "no identity at
    // all" unfalsifiable. The flag name is retained even though it only clears
    // `accountId` now — it is consumed by test-routes-account-fixtures.test.js
    // and tests/e2e/task-chat.spec.js.
    if (noLinearUser) {
      delete req.session.accountId
    }

    // LIN-1329 fixture re-point (Q4): establish a REAL accountId through the
    // production seam rather than fabricating one, so specs exercising
    // session.accountId run against the same code path production does. Bound
    // to the first workspace only; a real Linear sign-in would bind every
    // workspace the human belongs to, but one binding is enough to prove the
    // fixture goes through the real seam. Skipped for `noLinearUser` (mirrors
    // having no identity to link).
    if (!noLinearUser) {
      await establishAccount(req.session, accountStore, accountWorkspaceStore, 'linear', 'test-linear-user-id', {}, workspaces[0].id)
    }

    // LIN-1524: seed a durable record for every non-PAT Linear workspace,
    // mirroring what a real OAuth connection would have written durably —
    // `noRefreshToken` now controls whether that durable record exists
    // (previously a session-side field), so ensureValidToken's durable-store
    // refresh path has something to find when a spec drives `tokenExpired`.
    // Skipped for `noLinearUser` (no accountId to key on) and any `isPAT`
    // workspace (close-out Finding #3: PAT gets no durable record, by design).
    if (!noLinearUser && !noRefreshToken && ownerCredentialStore) {
      for (const ws of workspaces) {
        if (ws.isPAT) continue
        await ownerCredentialStore.put(req.session.accountId, ws.urlKey, {
          provider: 'linear',
          scope: ws.id,
          token: ws.accessToken,
          refreshToken: 'test-refresh-token',
          tokenExpiresAt: ws.tokenExpiresAt
        })
      }
    }

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

  // LIN-2285 close-out ledger item 2: no E2E coverage exists for the
  // account-merge confirm flow at all (409 offer -> confirm -> redirect).
  // This fixture builds the exact LIN-2285 acceptance scenario — B merged
  // into A before the session starts, a third account C signs in with B's
  // identity and gets offered a merge against the CANONICAL absorber A, not
  // the raw merged id — through the real production seams: `establishAccount`
  // for every identity and the real `respondToAccountConflict` responder for
  // the offer (same function `routes/auth.js` calls on a live conflict). The
  // confirm step itself is deliberately NOT reimplemented here — the spec
  // submits the real `POST /auth/merge/confirm` form the response renders.
  router.get('/test/set-merge-conflict-session', async (req, res) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const baseUrlKey = req.query.urlKey || 'merge-conflict';

    const workspaceFor = (label) => ({
      id: crypto.randomUUID(),
      name: `Merge ${label}`,
      urlKey: `${baseUrlKey}-${label}-${suffix}`,
      accessToken: 'test-token',
      tokenExpiresAt: Date.now() + (24 * 60 * 60 * 1000),
      addedAt: Date.now()
    });

    const wsA = workspaceFor('a');
    const wsB = workspaceFor('b');
    const wsC = workspaceFor('c');

    // A (the canonical absorber) and B (merged into A) are set up on their
    // own throwaway sessions, entirely before this request's own session
    // exists — mirroring "B merged into A before this session ever starts".
    const aResult = await establishAccount({}, accountStore, accountWorkspaceStore, 'linear', `test-merge-a-${suffix}`, {}, wsA.id);
    const bSession = {};
    const bResult = await establishAccount(bSession, accountStore, accountWorkspaceStore, 'linear', `test-merge-b-${suffix}`, {}, wsB.id);
    const merged = await accountStore.mergeAccounts(aResult.accountId, bResult.accountId, { accountWorkspaceStore });
    if (!merged.ok) {
      return res.status(500).send(`fixture setup failed: merge (${merged.reason})`);
    }

    // A THIRD, unrelated account C mints via THIS session.
    req.session.workspaces = [wsC];
    req.session.activeWorkspaceId = wsC.id;
    const cResult = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'linear', `test-merge-c-${suffix}`, {}, wsC.id);
    if (!cResult.ok) {
      return res.status(500).send('fixture setup failed: mint C');
    }

    // Same session signs in with B's identity — B is already merged into A.
    // A genuine conflict: C is a distinct canonical account from A.
    const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'linear', `test-merge-b-${suffix}`, {}, wsB.id);
    if (established.ok || !established.conflict) {
      return res.status(500).send('fixture setup failed: expected a conflict, got ' + JSON.stringify(established));
    }

    return respondToAccountConflict({
      req,
      res,
      established,
      workspace: wsB,
      refreshToken: null,
      mode: 'new',
      returnUrlKey: wsB.urlKey,
      identityLabel: 'Linear',
      reauthUrl: '/auth/linear',
      provider: 'linear',
    });
  });

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

  // Resolve the accountId to clear preferences for: the CURRENT session's
  // account when one is already established, else fall back to the test-token
  // Linear identity's account (LIN-1353 — was a fixed 'test-linear-user-id'
  // string; the store key is now a real minted UUID, so callers that clear
  // BEFORE calling /test/set-session — e.g. dispatch.spec.js's recent/favorite
  // prompts blocks, which pre-clear to purge a prior test's leftovers under the
  // same deterministic Linear identity — must resolve that identity's account
  // through the real seam instead of assuming the old fixed string was the key).
  async function resolveTestPrefsAccountId(req) {
    if (req.session.accountId) return req.session.accountId;
    const account = await accountStore.findAccountByIdentity('linear', 'test-linear-user-id');
    return account?._id || null;
  }

  // Endpoint to clear recent custom prompts for testing.
  // Recents are stored per user (req.session.accountId), so clear the CURRENT
  // session's user when one exists — a local session establishes its own
  // distinct account (LIN-425/LIN-1353). Falls back to the test-token user's
  // account for callers that clear before establishing a session.
  router.get('/test/clear-recent-prompts', async (req, res) => {
    try {
      const accountId = await resolveTestPrefsAccountId(req);
      if (!accountId) return res.send('ok');
      const prefs = await userPreferencesStore.getUserPreferences(accountId);
      await userPreferencesStore.saveUserPreferences(accountId, {
        ...prefs,
        recentCustomPrompts: {}
      });
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint to clear favourite custom prompts for testing (LIN-1011).
  // Mirrors /test/clear-recent-prompts: favourites are stored per session user,
  // so clear the CURRENT session's user when one exists, else the test-token user.
  router.get('/test/clear-favorite-prompts', async (req, res) => {
    try {
      const accountId = await resolveTestPrefsAccountId(req);
      if (!accountId) return res.send('ok');
      const prefs = await userPreferencesStore.getUserPreferences(accountId);
      await userPreferencesStore.saveUserPreferences(accountId, {
        ...prefs,
        favoriteCustomPrompts: {}
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

  // Clear all Collective characters for a workspace (LIN-1048). Mirrors
  // clear-custom-prompts: the store is partitioned by the anchor workspace urlKey.
  router.get('/test/clear-collective-characters', async (req, res) => {
    try {
      if (collectiveCharactersStore) await collectiveCharactersStore.deleteAll(req.query.urlKey || 'test-workspace');
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Seed one Collective character for a workspace so E2E can exercise the picker
  // without going through the define-new UI (LIN-1048). Body is a character
  // record; ?urlKey=<anchor> selects the partition. Defaults to a `custom` kind.
  router.post('/test/seed-collective-character', async (req, res) => {
    try {
      if (!collectiveCharactersStore) return res.status(503).json({ error: 'no collective characters store' });
      const urlKey = req.query.urlKey || 'test-workspace';
      const created = await collectiveCharactersStore.createCustom(urlKey, req.body || {});
      res.json(created);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear all custom Collective presets for a workspace (LIN-1050). Mirrors
  // clear-collective-characters; never touches BUILTIN_PRESETS (not rows here).
  router.get('/test/clear-collective-presets', async (req, res) => {
    try {
      if (collectivePresetsStore) await collectivePresetsStore.deleteAll(req.query.urlKey || 'test-workspace');
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Seed one custom Collective preset for a workspace so E2E can exercise the
  // picker without going through a save flow (LIN-1050). Body is a preset
  // record; ?urlKey=<anchor> selects the partition.
  router.post('/test/seed-collective-preset', async (req, res) => {
    try {
      if (!collectivePresetsStore) return res.status(503).json({ error: 'no collective presets store' });
      const urlKey = req.query.urlKey || 'test-workspace';
      const created = await collectivePresetsStore.createCustom(urlKey, req.body || {});
      res.json(created);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear all dispatch presets for a workspace (LIN-1390). Mirrors
  // clear-collective-presets: the store is partitioned by workspace urlKey and
  // has no builtin half, so a full clear leaves nothing behind.
  router.get('/test/clear-dispatch-presets', async (req, res) => {
    try {
      if (dispatchPresetsStore) await dispatchPresetsStore.deleteAll(req.query.urlKey || 'test-workspace');
      res.send('ok');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Seed one dispatch preset for a workspace so E2E can exercise preset
  // selection without going through a save flow (LIN-1390). Body is
  // { name, config }; ?urlKey=<workspace> selects the partition.
  router.post('/test/seed-dispatch-preset', async (req, res) => {
    try {
      if (!dispatchPresetsStore) return res.status(503).json({ error: 'no dispatch presets store' });
      const urlKey = req.query.urlKey || 'test-workspace';
      const created = await dispatchPresetsStore.createCustom(urlKey, req.body || {});
      res.json(created);
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

  // Read-back sibling for a single dispatch item's raw feedback[] (LIN-2209):
  // proves a write (e.g. a `decision-answer` stamp) actually landed in
  // storage, independent of whatever a render layer chooses to do with it —
  // a rendered-count assertion alone cannot distinguish "the stamp was
  // written and correctly hidden from the transcript" from "the stamp was
  // never written at all". Mirrors /test/task-decisions's read-back
  // precedent (LIN-2217) for the dispatch-store side of the same discipline.
  router.get('/test/dispatch-item', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      const itemId = req.query.itemId
      if (!itemId) return res.status(400).json({ error: 'itemId is required' })
      const item = await dispatchQueueStore.getItemStatus(urlKey, itemId)
      res.json({ ok: true, feedback: item?.feedback || [] })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear the materialized Observation sessions read-model for testing
  // (LIN-623). The derived projection and its source dispatch/agent-status logs are
  // a unit: a test that wipes the source logs must wipe the projection too, else a
  // stale derived doc + backfill marker would mask freshly-seeded runs.
  router.get('/test/clear-observation-sessions', async (req, res) => {
    try {
      if (observationSessionsStore) await observationSessionsStore.clear(req.query.urlKey || 'test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to drop the in-process Observation sessions-feed cache for testing
  // (LIN-799). The LIN-617 feed cache is a process singleton keyed by the
  // connected-workspace set; clearRuns() wipes the source logs + read-model but the
  // cached OUTPUT survived its 5s TTL and served a stale pre-seed feed, racing the
  // first assertion. Resetting state must drop this too. No-op if not wired.
  router.get('/test/clear-sessions-feed-cache', (req, res) => {
    try {
      if (sessionsFeedCache) sessionsFeedCache.clear(req.query.urlKey || 'test-workspace')
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
      // LIN-376: allow minting a single-use bootstrap for the exchange round-trip spec.
      const kind = req.query.kind === 'bootstrap' ? 'bootstrap' : 'standard'
      const result = await proxyTokenStore.createToken(urlKey, {
        label,
        scope,
        kind,
        singleUse: req.query.singleUse === 'true',
        // LIN-1366: the real mint route (POST .../api/proxy/tokens) stamps
        // createdBy from the authenticated session; most specs in this suite
        // mint a proxy token WITHOUT first calling /test/set-session on the
        // same request, so req.session.accountId is often unset here. Before
        // this fix, resolveWorkspaceAccess was owner-blind, so those tokens
        // coincidentally worked by picking up whichever session (e.g. one
        // established by an earlier, unrelated test on the same worker)
        // referenced the target urlKey. Now that resolution is owner-scoped,
        // this must resolve to the SAME canonical test identity those earlier
        // set-session calls establish, via the existing fallback this file
        // already uses for the identical problem (see resolveTestPrefsAccountId
        // below) — never a fabricated or arbitrary id.
        // LIN-1586: ?ownerless=true mints the pre-LIN-1397 shape (no createdBy)
        // so a spec can drive the `no owner · re-issue` badge. Opt-in only —
        // every existing caller keeps the owner-stamped token above, which is
        // what owner-scoped workspace resolution needs.
        createdBy: req.query.ownerless === 'true' ? null : await resolveTestPrefsAccountId(req)
      })
      res.json({ tokenId: result.tokenId, token: result.token, scope: result.scope, kind: result.kind })
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

  // LIN-1586: seed a proxy-event row directly.
  //
  // The genuine `token_ownerless` row cannot be manufactured through the real
  // proxy in tests — NODE_ENV=test short-circuits resolveWorkspaceAccess and
  // resolveProviderAccess, so the 503 path that writes the note is unreachable.
  // Seeding the audit row is therefore how a spec exercises what the Event Log
  // and the health panel DRAW; it makes no claim about how the row is produced.
  router.get('/test/seed-proxy-event', async (req, res) => {
    try {
      const event = await proxyEventStore.recordEvent({
        urlKey: req.query.urlKey || 'test-workspace',
        tokenId: req.query.tokenId || null,
        tokenLabel: req.query.tokenLabel || null,
        method: req.query.method || 'GET',
        endpoint: req.query.endpoint || '/api/proxy/me',
        status: req.query.status ? parseInt(req.query.status, 10) : 200,
        note: req.query.note || null,
        // LIN-2473: `stage` + `credentialFingerprint` are what distinguish a
        // LIN-2216 transient provider-lane rejection (a credential DID
        // resolve; the provider refused it anyway) from a bare resolution
        // failure. `credential-health`'s occupancy fold now turns on exactly
        // that pair, so a spec has to be able to seed the real shape —
        // NODE_ENV=test short-circuits resolveProviderAccess, which is why the
        // genuine row cannot be produced through the live proxy here.
        stage: req.query.stage || null,
        credentialFingerprint: req.query.credentialFingerprint || null
      })
      res.json({ id: event._id, status: event.status, note: event.note, stage: event.stage, credentialFingerprint: event.credentialFingerprint })
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

  // Endpoint to clear agent status for testing
  router.get('/test/clear-agent-status', async (req, res) => {
    try {
      await agentStatusStore.clear(req.query.urlKey || 'test-workspace')
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to seed one agent-status entry for testing (LIN-818): gives the
  // Ship's Biscuit edition model real narrative feedstock so the front-page/index
  // flow can be exercised end-to-end without a live dispatch.
  router.post('/test/seed-agent-status', async (req, res) => {
    try {
      const body = req.body || {}
      const urlKey = body.urlKey || req.query.urlKey || 'test-workspace'
      await agentStatusStore.recordStatus({
        urlKey,
        taskIdentifier: body.taskIdentifier || 'TEST-1',
        action: body.action || 'implement',
        status: body.status || 'completed',
        summary: body.summary || 'Shipped the change and verified it against CI.',
        // Optional: let tests control the timestamp for deterministic ordering/paging.
        timestamp: body.timestamp,
        // LIN-1588: the credential identity LIN-1587 propagates onto the loop
        // (`agentTokenId`/`agentTokenLabel`). Additive and optional — omitted,
        // recordStatus receives undefined and stores null exactly as before, so
        // every existing caller is unchanged. Without this no E2E could produce
        // a loop with a non-null agentTokenId, and the credential surfaces could
        // only ever be exercised in their `unknown` state.
        tokenId: body.tokenId,
        tokenLabel: body.tokenLabel,
        // Also optional, and forwarded for the same reason: `dispatchId` is how a
        // real runner attributes a status entry to its dispatch, and it is the
        // matcher's EXACT branch (lib/pipeline-loops.js `_matchAgentStatusToLoop`).
        // Without it a seeded entry can only window-match, and claiming an item
        // stamps `resolvedAt` — so a row seeded after the take falls outside the
        // window and silently fails to decorate the loop.
        dispatchId: body.dispatchId
      })
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear Ship's Biscuit editions for testing (LIN-818)
  router.get('/test/clear-ship-biscuit', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      if (shipBiscuitHistoryStore) await shipBiscuitHistoryStore.clear(urlKey)
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

  // Endpoint to seed multiple report-history runs for testing (LIN-1675 P3).
  // `/test/clear-report-history` above is clear-only — there is no existing
  // seam to seed several runs with varied `orientation`/`northStar` (needed to
  // exercise the Ship Journey playback: waypoints, coverage, and north-star
  // change markers all derive from MULTIPLE retained runs). This bypasses the
  // LLM-generation save path (`POST /api/roadmap/reports`, which always stamps
  // `generatedAt: new Date()` — see ReportHistoryStore.save) and writes
  // directly via the store's own collection so each record's `generatedAt` can
  // be set explicitly, exactly as deriveJourney's chronological walk needs.
  router.post('/test/seed-report-history', async (req, res) => {
    try {
      if (!reportHistoryStore) return res.status(503).json({ error: 'Report history not configured' })
      const urlKey = req.query.urlKey || req.body?.urlKey || 'test-workspace'
      const records = Array.isArray(req.body?.records) ? req.body.records : []
      const inserted = []
      for (const record of records) {
        const doc = {
          _id: crypto.randomUUID(),
          urlKey,
          generatedAt: new Date(record.generatedAt || Date.now()),
          model: 'test-seed',
          northStar: typeof record.northStar === 'string' ? record.northStar : '',
          narrative: { digest: 'seeded', technical: null, product: null, trajectory: null, northStarReading: null, gap: null },
          orientation: Array.isArray(record.orientation) ? record.orientation : []
        }
        await reportHistoryStore.collection.insertOne(doc)
        inserted.push(doc._id)
      }
      await reportHistoryStore._pruneToCapacity(urlKey)
      res.status(201).json({ inserted })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear the task-snapshot archive for testing (LIN-598)
  router.get('/test/clear-task-snapshots', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      if (taskSnapshotStore) await taskSnapshotStore.clear(urlKey)
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear the task-decisions (scan) store for testing (LIN-2212)
  router.get('/test/clear-task-decisions', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      if (taskDecisionsStore) await taskDecisionsStore.clear(urlKey)
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // LIN-1727: sibling clear route for shelved rulings, same convention.
  router.get('/test/clear-shelved-rulings', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      if (shelvedRulingsStore) await shelvedRulingsStore.clear(urlKey)
      res.send('ok')
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Read sibling to /test/clear-task-decisions (LIN-2217): proves the
  // 'answered' stamp crosses the durable taskDecisions store boundary.
  // First read-back store endpoint in this file — see class docstring.
  router.get('/test/task-decisions', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      const record = taskDecisionsStore ? await taskDecisionsStore.getStatus(urlKey, req.query.issueId) : null
      res.json({ ok: true, record })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Verification sibling to /test/clear-task-decisions (LIN-2270): a
  // workspace-wide count (any issueId, any outcome), so a caller can assert
  // a clear actually left the store empty for that key instead of assuming
  // it did — LIN-2228's original clear silently targeted a urlKey the
  // fixtures never wrote to, and a green suite gave no signal either way.
  router.get('/test/task-decisions-count', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      const count = taskDecisionsStore ? await taskDecisionsStore.count(urlKey) : 0
      res.json({ ok: true, count })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Endpoint to clear saved chats for testing (LIN-1008)
  router.get('/test/clear-saved-chats', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace'
      if (savedChatStore) await savedChatStore.clear(urlKey)
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

  // Endpoint to clear a specific session-summary cache entry for tests (LIN-592).
  // Query params: ?urlKey=...&sessionId=...
  router.get('/test/clear-session-summary-cache', async (req, res) => {
    try {
      const urlKey = req.query.urlKey || 'test-workspace';
      const sessionId = req.query.sessionId;
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }
      if (sessionSummaryCacheStore) await sessionSummaryCacheStore.delete(urlKey, sessionId);
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
      // Per-worker key (LIN-625 S1): accept via query or body, seed/clear against
      // the *passed* key, and default to the fixed local key for un-swept callers.
      const urlKey = req.query.urlKey || body.urlKey || LOCAL_WS_URL_KEY;
      const seed = (Array.isArray(body.projects) || Array.isArray(body.issues))
        ? { projects: body.projects || [], issues: body.issues || [] }
        : defaultLocalSeed(urlKey);

      if (body.features && typeof body.features === 'object') {
        const validated = {}
        for (const [key, value] of Object.entries(body.features)) {
          if (isValidFeatureKey(key)) validated[key] = value
        }
        req.session.features = validated
      }

      await localStore.clear(urlKey);
      await localStore.seed(urlKey, seed);

      // LIN-2226: a second local workspace in the SAME session (cross-workspace
      // task-bound coverage, mirroring LIN-1728 F1's two-Linear-workspace
      // `multiWorkspace` shape) — `append: true` adds this workspace to the
      // existing `session.workspaces` instead of replacing it. Every OTHER
      // caller is byte-identical: append is opt-in and false by default. A
      // fresh id (not the shared LOCAL_WS_UUID every single-workspace local
      // session reuses) avoids two simultaneous entries colliding on `id`.
      const append = body.append === true || req.query.append === 'true';
      const wsId = append ? crypto.randomUUID() : LOCAL_WS_UUID;

      // Token === urlKey: carries no auth, only selects the store partition.
      // No `accessToken: 'test-token'`, so the mock short-circuit never fires.
      const localWorkspace = {
        id: wsId,
        name: 'Local Workspace',
        urlKey,
        provider: 'local',
        credentials: { token: urlKey },
        accessToken: urlKey,
        tokenExpiresAt: Number.MAX_SAFE_INTEGER,
        addedAt: Date.now(),
      };
      // Optional multi-binding shape (LIN-717): when extra bindings are supplied,
      // materialize an explicit bindings[] with the local binding ACTIVE first,
      // so the providers settings switch can be exercised end-to-end. The local
      // binding stays the scalar-mirrored active one; extras are non-active.
      if (Array.isArray(body.extraBindings) && body.extraBindings.length) {
        localWorkspace.bindings = [
          { provider: 'local', scope: urlKey, credentials: { token: urlKey, tokenExpiresAt: Number.MAX_SAFE_INTEGER } },
          ...body.extraBindings,
        ];
      }
      if (append && Array.isArray(req.session.workspaces) && req.session.workspaces.length) {
        // Additive: keep the first (already-established) workspace active —
        // this call only needs the new one to exist in the session so the
        // Rulings feed's cross-workspace merge (`req.session.workspaces`) sees
        // it, not to switch what the page defaults to.
        req.session.workspaces = [...req.session.workspaces, localWorkspace];
      } else {
        req.session.workspaces = [localWorkspace];
        req.session.activeWorkspaceId = wsId;
      }

      // LIN-1329 fixture re-point (Q4): local's identity scope is the urlKey
      // itself (Q6 — freshly-unique per real create, never a false-conflict
      // risk), mirroring routes/workspace.js's POST /workspace/new.
      await establishAccount(req.session, accountStore, accountWorkspaceStore, 'local', urlKey, {}, wsId);

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

      req.session.save(() => res.json({ ok: true, urlKey }));
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
      const created = await provider.createIssue(req.query.urlKey || LOCAL_WS_URL_KEY, {
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
      const removed = localStore ? await localStore.clear(req.query.urlKey || LOCAL_WS_URL_KEY) : 0;
      res.json({ ok: true, removed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })

  // Clear server.js's fetchWorkspaceIssues memo (LIN-2065): every local-provider
  // test session shares one hardcoded workspace id, so a spec reseeding a
  // materially different issue set within the 30s TTL of a prior local-provider
  // fetch needs an explicit reset to avoid reading stale data.
  router.get('/test/clear-workspace-issues-memo', (req, res) => {
    if (clearWorkspaceIssuesMemo) clearWorkspaceIssuesMemo();
    res.send('ok');
  })

  // ---------------------------------------------------------------------------
  // GitHub provider harness (LIN-178) — the abstraction's first FOREIGN backend.
  // Configures the registered `github` singleton with an in-memory fake GitHub
  // client (no network, no auth) and establishes a `provider: 'github'` session
  // whose credential is the REPO SLUG. The dashboard then renders from the fake
  // backend via the real getProviderForWorkspace + getWorkspaceToken read seam —
  // proving the canonical model survives GitHub's hostile schema end-to-end.
  // ---------------------------------------------------------------------------
  const GITHUB_WS_UUID = '44444444-4444-4444-4444-444444444444';
  // Stand-in installation access token (LIN-711/LIN-713): the binding credential
  // is the installation token, NOT the repo slug. The clientFactory seam ignores
  // it (returns the fake), but it travels through the real read/write call scope.
  const GITHUB_INSTALL_TOKEN = 'ghs_fake_installation_token';

  // POST → seeds a custom GitHub-REST-shaped `{ issues, milestones, labels }`
  //        body (falls back to defaultGitHubSeed). GET → seeds the default.
  const setGitHubSession = async (req, res) => {
    try {
      const body = req.body || {};
      const seed = (Array.isArray(body.issues) || Array.isArray(body.milestones))
        ? { issues: body.issues || [], milestones: body.milestones || [], labels: body.labels || [] }
        : defaultGitHubSeed;

      if (body.features && typeof body.features === 'object') {
        const validated = {}
        for (const [key, value] of Object.entries(body.features)) {
          if (isValidFeatureKey(key)) validated[key] = value
        }
        req.session.features = validated
      }

      // Inject a fresh fake backend for this repo. Under the GitHub App model
      // (LIN-711/LIN-713) production authenticates per-request from the binding's
      // installation token, so we wire the `clientFactory` test seam: the
      // request-time client (`_clientForToken`) resolves to the SAME fake,
      // proving the per-request read/write path offline. `client` still backs any
      // bare-string boot call, and `repo` is the "+ Add task" deep-link default.
      const provider = getProvider('github');
      if (!provider) throw new Error('github provider not registered');
      const fake = createFakeGitHubClient({ [GITHUB_REPO]: seed });
      provider.configure({ client: fake, clientFactory: () => fake, repo: GITHUB_REPO });

      // GitHub App binding shape (LIN-711): the credential is an INSTALLATION
      // TOKEN, and the repo is the binding SCOPE (not the token). The read/write
      // seam threads { token, repo } so the provider builds a request-time client
      // from the installation token. Not 'test-token', so the mock short-circuit
      // never fires.
      req.session.workspaces = [{
        id: GITHUB_WS_UUID,
        name: 'GitHub Workspace',
        urlKey: GITHUB_WORKSPACE_URL_KEY,
        provider: 'github',
        bindings: [{
          provider: 'github',
          scope: GITHUB_REPO,
          credentials: { token: GITHUB_INSTALL_TOKEN, installationId: '4242', tokenExpiresAt: Number.MAX_SAFE_INTEGER },
        }],
        credentials: { token: GITHUB_INSTALL_TOKEN, installationId: '4242' },
        accessToken: GITHUB_INSTALL_TOKEN,
        tokenExpiresAt: Number.MAX_SAFE_INTEGER,
        addedAt: Date.now(),
      }];
      req.session.activeWorkspaceId = GITHUB_WS_UUID;

      // LIN-1329 fixture re-point (Q4): `github` identity scope is the human's
      // GitHub user id (Q1), shared with GitHub Projects (Q3) — this fixture's
      // simulated human is distinct from the Projects fixture's.
      await establishAccount(req.session, accountStore, accountWorkspaceStore, 'github', 'test-github-user-id', {}, GITHUB_WS_UUID);

      req.session.save(() => res.json({ ok: true, urlKey: GITHUB_WORKSPACE_URL_KEY, repo: GITHUB_REPO }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  router.get('/test/set-github-session', setGitHubSession);
  router.post('/test/set-github-session', setGitHubSession);

  // Exercise the GitHub provider WRITE path directly (createIssue → fake backend),
  // so a subsequent dashboard load proves the no-proxy write round-trip.
  router.get('/test/github-create-issue', async (req, res) => {
    try {
      const provider = getProvider('github');
      if (!provider) throw new Error('github provider not registered');
      // Exercise the per-request write path: a { repo, token } binding credential
      // (LIN-713), not a bare repo slug — the same scope the proxy/seam threads.
      const created = await provider.createIssue({ repo: GITHUB_REPO, token: GITHUB_INSTALL_TOKEN }, {
        title: req.query.title || 'Created via GitHub provider',
        description: 'created in test',
        labels: [],
      });
      res.json({ ok: true, issue: { id: created.id, identifier: created.identifier, title: created.title } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })

  // ---------------------------------------------------------------------------
  // GitHub Projects v2 provider harness (LIN-560) — a board-shaped backend.
  // Configures the registered `github-projects` singleton with an in-memory fake
  // GraphQL client (no network, no auth) and establishes a
  // `provider: 'github-projects'` session whose binding is scoped to a board
  // (`org/projectNumber`). The dashboard then renders the board through the real
  // getProviderForWorkspace + getWorkspaceCallScope read seam — proving the
  // canonical model maps a Projects v2 board's Status columns offline.
  // ---------------------------------------------------------------------------
  const GITHUB_PROJECTS_WS_UUID = '55555555-5555-5555-5555-555555555555';
  // Stand-in installation access token (mirrors the Issues harness): the binding
  // credential is the installation token, NOT the board slug. The clientFactory
  // seam ignores it (returns the fake) but it travels through the real read scope.
  const GITHUB_PROJECTS_INSTALL_TOKEN = 'ghs_fake_projects_installation_token';

  // POST → seeds a custom `{ seed }` body (the clean board shape, falls back to
  //        defaultGitHubProjectsSeed). GET → seeds the default.
  const setGitHubProjectsSession = async (req, res) => {
    try {
      const body = req.body || {};
      const seed = (body.seed && typeof body.seed === 'object') ? body.seed : defaultGitHubProjectsSeed;

      if (body.features && typeof body.features === 'object') {
        const validated = {}
        for (const [key, value] of Object.entries(body.features)) {
          if (isValidFeatureKey(key)) validated[key] = value
        }
        req.session.features = validated
      }

      // Wire the request-time path: the `clientFactory` test seam resolves the
      // per-request GraphQL client (`_clientForToken`) to the SAME fake, proving
      // the per-request read path offline. `client` backs any bare-string boot call.
      const provider = getProvider('github-projects');
      if (!provider) throw new Error('github-projects provider not registered');
      const fake = createFakeGitHubProjectsClient({ [GITHUB_PROJECTS_BOARD]: seed });
      provider.configure({ client: fake, clientFactory: () => fake });

      // GitHub App binding shape: the credential is an INSTALLATION TOKEN and the
      // board is the binding SCOPE (not the token). The read seam threads
      // { token, scope } so the provider builds a request-time client from the
      // installation token. Not 'test-token', so the mock short-circuit never fires.
      req.session.workspaces = [{
        id: GITHUB_PROJECTS_WS_UUID,
        name: 'GitHub Projects Workspace',
        urlKey: GITHUB_PROJECTS_WORKSPACE_URL_KEY,
        provider: 'github-projects',
        bindings: [{
          provider: 'github-projects',
          scope: GITHUB_PROJECTS_BOARD,
          credentials: { token: GITHUB_PROJECTS_INSTALL_TOKEN, installationId: '4243', tokenExpiresAt: Number.MAX_SAFE_INTEGER },
        }],
        credentials: { token: GITHUB_PROJECTS_INSTALL_TOKEN, installationId: '4243' },
        accessToken: GITHUB_PROJECTS_INSTALL_TOKEN,
        tokenExpiresAt: Number.MAX_SAFE_INTEGER,
        addedAt: Date.now(),
      }];
      req.session.activeWorkspaceId = GITHUB_PROJECTS_WS_UUID;

      // LIN-1329 fixture re-point (Q4): `github` identity scope is the human's
      // GitHub user id (Q1) — SAME identity provider as GitHub Issues (Q3), but
      // this fixture's simulated human is a distinct one from the Issues fixture.
      await establishAccount(req.session, accountStore, accountWorkspaceStore, 'github', 'test-github-projects-user-id', {}, GITHUB_PROJECTS_WS_UUID);

      req.session.save(() => res.json({ ok: true, urlKey: GITHUB_PROJECTS_WORKSPACE_URL_KEY, board: GITHUB_PROJECTS_BOARD }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  router.get('/test/set-github-projects-session', setGitHubProjectsSession);
  router.post('/test/set-github-projects-session', setGitHubProjectsSession);

  // ---------------------------------------------------------------------------
  // Jira Cloud provider harness (LIN-1885, Phase 1 of LIN-275) — a genuinely
  // hostile third-party schema, mirrors the GitHub Projects harness above.
  // Configures the registered `jira` singleton with an in-memory fake REST
  // client (no network, no Basic auth) and establishes a `provider: 'jira'`
  // session whose binding is scoped to a Jira site. The dashboard then renders
  // the site through the real getProviderForWorkspace + getWorkspaceCallScope
  // read seam — proving the statusCategory→canonical mapping offline.
  // ---------------------------------------------------------------------------
  const JIRA_WS_UUID = '66666666-6666-6666-6666-666666666666';
  // Stand-in Basic-auth credential (mirrors the Projects harness's stand-in
  // installation token): the binding credential is {email, apiToken}, NOT the
  // site — the clientFactory seam below (`expectCredential`, LIN-1890 E6b)
  // ASSERTS this shape rather than ignoring it, but it still travels through
  // the real read scope, and it is deliberately NOT 'test-token' so the mock
  // short-circuit never fires.
  const JIRA_EMAIL = 'test-jira-user@example.com';
  const JIRA_API_TOKEN = 'fake_jira_api_token';
  // The OAuth-shaped stand-ins (LIN-1890 E6b). Same discipline as the Basic
  // pair: deliberately not 'test-token', so no mock short-circuit fires.
  const JIRA_OAUTH_ACCESS_TOKEN = 'fake_jira_oauth_access_token';
  const JIRA_CLOUD_ID = '11111111-2222-3333-4444-555555555555';

  // POST → seeds a custom `{ seed }` body (the clean {projects,issues} shape,
  //        falls back to defaultJiraSeed). GET → seeds the default.
  const setJiraSession = async (req, res) => {
    try {
      const body = req.body || {};
      const seed = (body.seed && typeof body.seed === 'object') ? body.seed : defaultJiraSeed;
      // LIN-1890 E6b: `?authType=oauth` seeds the OAUTH binding shape LIN-1887
      // writes (Bearer access token + cloudId), not Phase 1's Basic
      // {email, apiToken}. Default stays Basic so every existing caller — and
      // the production-validated Phase 1 shape — is byte-identical.
      const authType = (body.authType || req.query.authType) === 'oauth' ? 'oauth' : 'basic';

      if (body.features && typeof body.features === 'object') {
        const validated = {}
        for (const [key, value] of Object.entries(body.features)) {
          if (isValidFeatureKey(key)) validated[key] = value
        }
        req.session.features = validated
      }

      // Wire the request-time path: the `clientFactory` test seam resolves the
      // per-request REST client (`_clientForCredential`) to the SAME fake,
      // proving the per-request read path offline. `client` backs any
      // boot-configured call; `site` backs getCreateTaskUrl's fallback.
      const provider = getProvider('jira');
      if (!provider) throw new Error('jira provider not registered');
      const fake = createFakeJiraClient(seed);
      // LIN-1890 E6b — the seam now ASSERTS the credential it is handed.
      //
      // `clientFactory: () => fake` discarded its argument, which made the
      // fixture blind to the whole credential projection: an OAuth binding and a
      // Basic one produced identical observable behaviour, so `?authType=oauth`
      // would have changed nothing a test could see. Checking the shape here
      // turns the fixture into a real assertion about what
      // `getWorkspaceCallScope`/`getBindingCallScope` actually projected, and
      // fails LOUDLY rather than silently serving the fake to a wrong-shaped
      // credential.
      //
      // The check is on the credential's INTERNAL CONSISTENCY, deliberately not
      // against this request's `authType`. `provider.configure` is a
      // PROCESS-LEVEL side effect that outlives the seeding call (the
      // detail-nonactive-binding spec depends on exactly that), so a factory
      // pinned to the last seed's auth shape becomes order-dependent: an OAuth
      // seed in one spec would make a Basic-seeded spec throw. Consistency is
      // the property actually worth asserting anyway — a projection that mixed
      // the two shapes (an OAuth token arriving in `apiToken` with no `email`,
      // which is what a regressed Basic branch produces for an OAuth binding)
      // fails this check regardless of which spec seeded last.
      const expectCredential = (credential) => {
        if (credential?.authType === 'oauth') {
          if (!credential.accessToken || !credential.cloudId) {
            throw new Error(`jira fixture: an OAuth call scope must carry accessToken + cloudId, got ${JSON.stringify(credential)}`);
          }
          if (credential.email || credential.apiToken) {
            throw new Error(`jira fixture: an OAuth call scope must NOT carry Basic fields, got ${JSON.stringify(credential)}`);
          }
        } else {
          if (!credential?.email || !credential?.apiToken) {
            throw new Error(`jira fixture: a Basic call scope must carry email + apiToken, got ${JSON.stringify(credential)}`);
          }
          if (credential.accessToken || credential.cloudId) {
            throw new Error(`jira fixture: a Basic call scope must NOT carry OAuth fields, got ${JSON.stringify(credential)}`);
          }
        }
        return fake;
      };
      provider.configure({ client: fake, clientFactory: expectCredential, site: JIRA_SITE });

      // Jira Basic-auth binding shape (LIN-1885 beat 2): the credential is
      // {email, apiToken} and the SITE is the binding SCOPE (not the token).
      // The read seam threads {email, apiToken, site} so the provider builds a
      // request-time client from the credential. tokenExpiresAt:MAX_SAFE_INTEGER
      // mirrors what routes/jira-auth.js's real link handler writes.
      //
      // The OAuth arm (LIN-1890 E6b) mirrors what `completeJiraNewLogin` writes:
      // `authType: 'oauth'` + `cloudId` in the binding credentials, a REAL finite
      // expiry (never the Basic path's MAX_SAFE_INTEGER sentinel, which on an
      // OAuth binding is the lie LIN-1887 removed), and no `email`.
      const credentials = authType === 'oauth'
        ? { token: JIRA_OAUTH_ACCESS_TOKEN, authType: 'oauth', cloudId: JIRA_CLOUD_ID, tokenExpiresAt: Date.now() + 3600_000 }
        : { token: JIRA_API_TOKEN, email: JIRA_EMAIL, tokenExpiresAt: Number.MAX_SAFE_INTEGER };
      req.session.workspaces = [{
        id: JIRA_WS_UUID,
        name: 'Jira Workspace',
        urlKey: JIRA_WORKSPACE_URL_KEY,
        provider: 'jira',
        bindings: [{
          provider: 'jira',
          scope: JIRA_SITE,
          credentials,
        }],
        credentials: { ...credentials },
        accessToken: credentials.token,
        tokenExpiresAt: credentials.tokenExpiresAt,
        addedAt: Date.now(),
      }];
      req.session.activeWorkspaceId = JIRA_WS_UUID;

      // LIN-1329 fixture re-point: `jira` identity scope is the human's Jira
      // accountId (mirrors routes/jira-auth.js's real establishAccount call).
      await establishAccount(req.session, accountStore, accountWorkspaceStore, 'jira', 'test-jira-account-id', {}, JIRA_WS_UUID);

      req.session.save(() => res.json({ ok: true, urlKey: JIRA_WORKSPACE_URL_KEY, site: JIRA_SITE }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  router.get('/test/set-jira-session', setJiraSession);
  router.post('/test/set-jira-session', setJiraSession);

  return router;
}
