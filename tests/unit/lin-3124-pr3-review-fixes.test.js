/**
 * LIN-3124 PR3 (#1618) — the review's blockers 1-7 (verdict `71b71694`), each
 * with the verdict's red-today test. Every test here was captured RED against
 * the pre-fix head `a36eec1e` and is GREEN after the fixes (blocker 7's tests
 * are the missing seam coverage: each goes red under the `prior: 'none'`
 * mutation at its seam instead).
 *
 * `ensureValidToken` and `handleUnauthorizedError` live in server.js, which is
 * not import-safe in a unit test, so — like the LIN-1503/1885/2271 harnesses —
 * their REAL bodies are sliced and run in a node:vm context, with the REAL
 * connection seam (`createConnectionAccess`, the lifecycle release, hydration,
 * the stores) and only the provider network and the page render faked.
 *
 * Symbols introduced by the fix are read through module namespaces, so this
 * file still LOADS at the pre-fix head (where they are undefined) and fails on
 * its assertions, not on an import.
 *
 * Run with: node --test tests/unit/lin-3124-pr3-review-fixes.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import express from 'express';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import * as seam from '../../lib/connection-credential.js';
import * as bindingModule from '../../lib/connection-binding.js';
import * as ws from '../../lib/workspace.js';
import { releaseConnectionCredential } from '../../lib/connection-lifecycle.js';
import { REFRESH_STRATEGY, refreshDeclarationFor } from '../../lib/refresh-strategy.js';
import { serviceUnavailable } from '../../lib/errors.js';
import { isDefinitiveRevocation, isTransientRefreshFailure, TokenRefreshError } from '../../lib/token-refresh.js';
import { TOKEN_REFRESH_BUFFER_MS, selectOwnerSessionRow } from '../../lib/workspace-token-resolver.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from '../../lib/credential-lifecycle-events.js';
import { createRefreshOnResolveGate } from '../../lib/refresh-on-resolve-gate.js';
import { refreshOwnerCredential } from '../../lib/workspace-token-refresh.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { createAuthRoutes } from '../../routes/auth.js';
import { createJiraAuthRoutes } from '../../routes/jira-auth.js';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { runRevert } from '../../scripts/revert-connection-backed.js';
import { withResolver } from './lin-3382-resolver-harness.js';

const SERVER_SRC = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
const ACCT = 'acct-review';
const tokenOf = (scope) => (scope && typeof scope === 'object' ? (scope.token ?? scope.accessToken) : scope);

/** A top-level `[async ]function NAME(` of server.js, to its top-level close. */
function sliceServerFunction(name) {
  const asyncStart = SERVER_SRC.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : SERVER_SRC.indexOf(`\nfunction ${name}(`) + 1;
  assert.ok(start > 0, `${name} not found in server.js`);
  return SERVER_SRC.slice(start, SERVER_SRC.indexOf('\n}\n', start) + 2);
}

function makeRes() {
  return {
    statusCode: 200, body: null, redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    redirect(url) { this.redirectedTo = url; return this; },
  };
}

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

/** Wrap named store methods: log calls. */
function spied(store, names, log) {
  const wrapper = Object.create(store);
  for (const name of names) {
    const real = store[name].bind(store);
    wrapper[name] = async (...args) => { log.push(name); return real(...args); };
  }
  return wrapper;
}

describe('LIN-3124 PR3 review fixes (verdict 71b71694)', () => {
  let dir;
  let client;
  let n = 0;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lin3124-review-'));
    client = new MangoClient(dir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  afterEach(() => { delete process.env.CONNECTION_BACKED_WRITES; });

  function stores() {
    const db = client.db(`review_${n++}`);
    return {
      db,
      connectionStore: new ConnectionStore({ collection: db.collection('connections') }),
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
  }

  /**
   * A session with one workspace holding a connection-backed ACTIVE binding
   * (via the real converter), then round-tripped (a fresh request) and hydrated
   * from the store, exactly as the middleware does.
   */
  async function connectionBackedSession(s, { provider = 'linear', scope = 'org-1', token = 'OLD', expiresAt = Date.now() + 3600_000, refreshToken = 'R1', extraBindings = [] } = {}) {
    const credentials = provider === 'github'
      ? { installationId: '9', token, tokenExpiresAt: expiresAt }
      : provider === 'jira'
        ? { token, authType: 'oauth', cloudId: 'cid', tokenExpiresAt: expiresAt }
        : { token, tokenExpiresAt: expiresAt };
    const session = { accountId: ACCT, workspaces: [{ id: 'ws-1', urlKey: 'acme', bindings: extraBindings.map(b => ({ ...b })) }] };
    ws.linkProvider(session.workspaces[0], provider, scope, credentials);
    const out = await seam.convertToConnectionBacked({ connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore, session, accountId: ACCT, workspaceId: 'ws-1', provider, scope, credentials, refreshToken, prior: 'none', writesEnabled: true });
    assert.equal(out.connectionBacked, true);
    const fresh = structuredClone(session);
    await seam.hydrateSession(fresh, { connectionStore: s.connectionStore });
    return { session: fresh, workspace: fresh.workspaces[0], connectionId: out.connectionId };
  }

  function connectionAccessFor(s, refreshConnection) {
    return seam.createConnectionAccess({
      connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore, refreshConnection,
      selectOwnerSessionRow, normalizeProvider: ws.normalizeProvider, fingerprintCredential,
      gate: createRefreshOnResolveGate(), bufferMs: TOKEN_REFRESH_BUFFER_MS,
    });
  }

  /** The shared free identifiers of both sliced server.js functions. */
  function serverContext(s, calls, extra = {}) {
    return vm.createContext({
      REFRESH_STRATEGY, refreshDeclarationFor, normalizeProvider: ws.normalizeProvider, isDefinitiveRevocation, isTransientRefreshFailure,
      rehydrateAfterRefresh: seam.rehydrateAfterRefresh,
      activeConnectionBackedBinding: bindingModule.activeConnectionBackedBinding,
      isConnectionBacked: bindingModule.isConnectionBacked,
      getActiveWorkspace: ws.getActiveWorkspace, getWorkspaceTokenExpiry: ws.getWorkspaceTokenExpiry,
      applyAccessTokenToWorkspace: ws.applyAccessTokenToWorkspace, removeWorkspace: ws.removeWorkspace,
      TOKEN_REFRESH_BUFFER_MS, fingerprintCredential, CREDENTIAL_LIFECYCLE_EVENT_KINDS,
      connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore, releaseConnectionCredential,
      evictReferentFor: () => () => {}, evictWorkspaceTokenPair: () => {}, evictWorkspaceToken: () => {}, evictAllWorkspaceTokens: () => {},
      refreshOnResolveGate: { shouldAttempt: () => true },
      credentialLifecycleEventStore: { recordEvent: async () => {} },
      refreshExchangeFor: () => async () => ({}),
      remintActiveCredential: async () => { calls.legacyRemint = (calls.legacyRemint || 0) + 1; },
      getProviderForWorkspace: () => ({}),
      refreshOwnerCredential: async () => { calls.legacyRefresh = (calls.legacyRefresh || 0) + 1; return null; },
      saveSession: async () => {},
      serviceUnavailable,
      renderErrorPage: (title) => `<${title}>`,
      sendRelinkNotice: (_w, res) => { calls.relink = true; return res.status(401).send('relink'); },
      handleWorkspaceRemoval: async (_session, id, res, deleteDurable) => { calls.removal = { id, deleteDurable }; return res.status(302).send('removed'); },
      renderDashboardAfterRefresh: async (workspace) => {
        calls.renderToken = tokenOf(ws.getWorkspaceCallScope(workspace));
        const active = bindingModule.activeConnectionBackedBinding
          ? bindingModule.activeConnectionBackedBinding(workspace)
          : workspace.bindings.find(b => b.connectionId);
        calls.renderBindingToken = tokenOf(ws.getBindingCallScope(active));
        return 'rendered';
      },
      handleTokenRefreshAndRetry: async () => { throw new Error('legacy retry not expected'); },
      console: { log() {}, warn() {}, error() {} },
      ...extra,
    });
  }

  function runSliced(context, name) {
    return vm.runInContext(`${sliceServerFunction('activeConnectionIdForWorkspace')}\n${sliceServerFunction(name)}\n${name}`, context);
  }

  // ---------------------------------------------------------------------------
  // Blocker 1 — mirror/expiry accessors (+ blocker 4's double gate)
  // ---------------------------------------------------------------------------
  describe('blocker 1: the mirror/expiry accessors serve a connection-backed workspace', () => {
    test('(a) hydrated: the Connection token/expiry; unhydrated: fail closed; legacy: raw E2 unchanged', async () => {
      const s = stores();
      const expiresAt = Date.now() + 1234_000;
      const { workspace } = await connectionBackedSession(s, { token: 'REAL', expiresAt });
      assert.equal(ws.getWorkspaceMirrorToken(workspace), 'REAL');
      assert.equal(ws.getWorkspaceTokenExpiry(workspace), expiresAt);
      const unhydrated = structuredClone(workspace);
      assert.equal(ws.getWorkspaceMirrorToken(unhydrated), undefined);
      assert.equal(ws.getWorkspaceTokenExpiry(unhydrated), undefined);
      const legacy = { provider: 'linear', accessToken: 'NEW-mirror', credentials: { token: 'OLD' }, tokenExpiresAt: 7 };
      assert.equal(ws.getWorkspaceMirrorToken(legacy), 'NEW-mirror');
      assert.equal(ws.getWorkspaceTokenExpiry(legacy), 7);
    });

    test('(b) + blocker 4(b): ensureValidToken on an expiring connection-backed workspace reaches the connection branch and refreshes EXACTLY once', async () => {
      const s = stores();
      const { session, workspace, connectionId } = await connectionBackedSession(s, { token: 'OLD', expiresAt: Date.now() + 60_000 });
      const refreshCalls = [];
      const access = connectionAccessFor(s, async (id) => { refreshCalls.push(id); return { token: 'NEW', expiresAt: Date.now() + 3600_000, provider: 'linear' }; });
      const calls = {};
      const ensureValidToken = runSliced(serverContext(s, calls, { connectionAccess: access }), 'ensureValidToken');
      let nextCalled = false;
      const res = makeRes();
      await ensureValidToken({ session }, res, () => { nextCalled = true; });
      assert.deepEqual(refreshCalls, [connectionId], 'one connection refresh — one gate per attempt');
      assert.equal(calls.legacyRefresh, undefined, 'never the legacy durable refresh');
      assert.equal(nextCalled, true, 'the request proceeds');
      assert.equal(calls.removal, undefined);
      // Blocker 2 (ensureValidToken arm): the rest of the request uses NEW.
      assert.equal(tokenOf(ws.getWorkspaceCallScope(workspace)), 'NEW');
    });

    test('(c) the audit egress and the Linear image relay send the Connection token', async () => {
      const s = stores();
      const { workspace } = await connectionBackedSession(s, { token: 'CONN-TOKEN' });
      const app = express();
      app.use(createWorkspaceApiRoutes({
        workspaceFromUrl: (req, _res, next) => { req.workspace = workspace; req.session = { linearUserId: 'u' }; next(); },
        freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {}, workspacePreferencesStore: {}, customPromptsStore: {},
        recapCacheStore: {}, briefCacheStore: {}, reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {}, proxyTokenStore: {},
      }));
      const realFetch = globalThis.fetch;
      const realEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const outbound = [];
      globalThis.fetch = (input, init) => {
        const u = typeof input === 'string' ? input : input?.url || '';
        if (!u.startsWith('https://')) return realFetch(input, init);
        const h = init?.headers || {};
        outbound.push(typeof h.get === 'function' ? h.get('authorization') : (h.Authorization ?? h.authorization));
        if (u.includes('uploads.linear.app')) {
          return Promise.resolve({ ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => new ArrayBuffer(8) });
        }
        const empty = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
        return Promise.resolve(new Response(JSON.stringify({ data: { teams: empty, projects: empty, workflowStates: empty, issueLabels: empty, issues: empty } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      };
      const server = app.listen(0, '127.0.0.1');
      await new Promise(r => server.once('listening', r));
      try {
        const base = `http://127.0.0.1:${server.address().port}/workspace/acme/api`;
        await realFetch(`${base}/audit`);
        const audited = [...outbound];
        outbound.length = 0;
        await realFetch(`${base}/image?url=${encodeURIComponent('https://uploads.linear.app/a/b.png')}`);
        assert.equal(audited[0], 'CONN-TOKEN', 'audit egress');
        assert.equal(outbound[0], 'Bearer CONN-TOKEN', 'image relay');
      } finally {
        server.close();
        globalThis.fetch = realFetch;
        if (realEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = realEnv;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Blocker 2 — the post-401 retry renders with the refreshed credential
  // ---------------------------------------------------------------------------
  describe('blocker 2: the post-401 retry uses the refreshed token', () => {
    for (const provider of ['linear', 'github']) {
      test(`${provider}: 401 → Connection refresh returns NEW → the retry render calls the provider with NEW`, async () => {
        const s = stores();
        const { session, workspace } = await connectionBackedSession(s, { provider, scope: provider === 'github' ? 'o/r' : 'org-1', token: 'OLD' });
        const access = connectionAccessFor(s, async () => ({ token: 'NEW', expiresAt: Date.now() + 3600_000, provider }));
        const calls = {};
        const handleUnauthorizedError = runSliced(serverContext(s, calls, { connectionAccess: access }), 'handleUnauthorizedError');
        const out = await handleUnauthorizedError(workspace, session, null, null, null, makeRes());
        assert.equal(out, 'rendered');
        assert.equal(calls.renderToken, 'NEW', 'the workspace call scope');
        assert.equal(calls.renderBindingToken, 'NEW', 'the per-binding call scope');
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Blocker 3 — a legacy revoke never reaches a connection-backed sibling
  // ---------------------------------------------------------------------------
  describe('blocker 3: in a mixed container, a legacy invalid_grant leaves the connection-backed sibling intact', () => {
    /** Legacy binding A active (scalar mirror), connection-backed B non-active. */
    async function mixed(s, provider, { expiresAt = Date.now() + 60_000 } = {}) {
      const scopeA = provider === 'jira' ? 'https://a.atlassian.net' : 'org-a';
      const scopeB = provider === 'jira' ? 'https://b.atlassian.net' : 'org-b';
      const legacyCreds = provider === 'jira' ? { token: 'A-tok', authType: 'oauth', cloudId: 'ca', tokenExpiresAt: expiresAt } : { token: 'A-tok', tokenExpiresAt: expiresAt };
      const bCreds = provider === 'jira' ? { token: 'B-tok', authType: 'oauth', cloudId: 'cb', tokenExpiresAt: Date.now() + 3600_000 } : { token: 'B-tok', tokenExpiresAt: Date.now() + 3600_000 };
      const session = { accountId: ACCT, activeWorkspaceId: 'ws-1', workspaces: [{ id: 'ws-1', urlKey: 'acme', bindings: [] }], destroy(cb) { cb && cb(); } };
      const w = session.workspaces[0];
      ws.linkProvider(w, provider, scopeA, legacyCreds);           // A: legacy, active (first link)
      w.bindings.push({ provider, scope: scopeB, credentials: bCreds });
      const out = await seam.convertToConnectionBacked({ connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore, session, accountId: ACCT, workspaceId: 'ws-1', provider, scope: scopeB, credentials: bCreds, refreshToken: 'RB', prior: 'none', writesEnabled: true });
      // B was linked second: re-point the active binding back to legacy A.
      ws.setActiveProvider(w, provider, scopeA);
      assert.equal(w.accessToken, 'A-tok');
      assert.equal(w.activeBinding, undefined);
      await s.ownerCredentialStore.put(ACCT, 'acme', { provider, token: 'A-tok', refreshToken: 'RA', tokenExpiresAt: expiresAt });
      return { session, workspace: w, bConnectionId: out.connectionId };
    }

    async function assertSiblingIntact(s, bConnectionId) {
      assert.ok(await s.connectionStore.readConnectionById(bConnectionId), "B's Connection survives");
      assert.equal((await s.ownerCredentialStore.getByConnection(bConnectionId))?.refreshToken, 'RB', "B's connection-keyed record survives");
    }

    const expired = async () => { throw new TokenRefreshError('invalid_grant', 'EXPIRED'); };

    test('ensureValidToken, non-destructive provider (Jira: legacy A + connection-backed B)', async () => {
      const s = stores();
      const { session, bConnectionId } = await mixed(s, 'jira');
      const calls = {};
      const ensureValidToken = runSliced(serverContext(s, calls, { connectionAccess: connectionAccessFor(s, async () => null), refreshOwnerCredential: expired }), 'ensureValidToken');
      await ensureValidToken({ session }, makeRes(), () => {});
      assert.equal(calls.relink, true);
      await assertSiblingIntact(s, bConnectionId);
    });

    test('ensureValidToken, destructive provider (Linear: legacy org-a + connection-backed org-b)', async () => {
      const s = stores();
      const { session, bConnectionId } = await mixed(s, 'linear');
      const calls = {};
      const ensureValidToken = runSliced(serverContext(s, calls, { connectionAccess: connectionAccessFor(s, async () => null), refreshOwnerCredential: expired }), 'ensureValidToken');
      await ensureValidToken({ session }, makeRes(), () => {});
      await assertSiblingIntact(s, bConnectionId);
    });

    test('handleUnauthorizedError legacy arm (Jira: legacy A + connection-backed B)', async () => {
      const s = stores();
      const { session, workspace, bConnectionId } = await mixed(s, 'jira');
      const calls = {};
      const handleUnauthorizedError = runSliced(serverContext(s, calls, { connectionAccess: connectionAccessFor(s, async () => null), handleTokenRefreshAndRetry: expired }), 'handleUnauthorizedError');
      await handleUnauthorizedError(workspace, session, null, null, null, makeRes());
      assert.equal(calls.relink, true);
      await assertSiblingIntact(s, bConnectionId);
    });

    test('the lifecycle refuses an unscoped revoke', async () => {
      const s = stores();
      const { workspace, bConnectionId } = await mixed(s, 'linear');
      const out = await releaseConnectionCredential({ connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore, workspace, provider: 'linear', mode: 'revoke' });
      assert.deepEqual(out, { released: 0, referents: [] });
      await assertSiblingIntact(s, bConnectionId);
    });
  });

  // ---------------------------------------------------------------------------
  // Blocker 4 — the connection-arm revocation is reachable
  // ---------------------------------------------------------------------------
  describe('blocker 4: a definitive revocation of a connection-backed credential is propagated', () => {
    test('(a) handleUnauthorizedError: invalid_grant deletes the Connection + record and takes the removal path', async () => {
      const s = stores();
      const { session, workspace, connectionId } = await connectionBackedSession(s);
      const access = connectionAccessFor(s, async () => { throw new TokenRefreshError('invalid_grant', 'EXPIRED'); });
      const calls = {};
      const handleUnauthorizedError = runSliced(serverContext(s, calls, { connectionAccess: access }), 'handleUnauthorizedError');
      await handleUnauthorizedError(workspace, session, null, null, null, makeRes());
      assert.equal(await s.connectionStore.readConnectionById(connectionId), null, 'the Connection is deleted');
      assert.equal(await s.ownerCredentialStore.getByConnection(connectionId), null, 'and its connection-keyed record');
      assert.deepEqual(calls.removal, { id: 'ws-1', deleteDurable: true }, 'Linear: removal + re-link prompt');
    });

    test('a transient failure is still a 503 that deletes nothing', async () => {
      const s = stores();
      const { session, workspace, connectionId } = await connectionBackedSession(s);
      const access = connectionAccessFor(s, async () => { throw new TokenRefreshError('blip', 'NETWORK'); });
      const calls = {};
      const res = makeRes();
      await runSliced(serverContext(s, calls, { connectionAccess: access }), 'handleUnauthorizedError')(workspace, session, null, null, null, res);
      assert.equal(res.statusCode, 503);
      assert.ok(await s.connectionStore.readConnectionById(connectionId));
    });

    test('the headless arm keeps its non-throwing contract (a revoked Connection is a miss, not a throw)', async () => {
      const s = stores();
      const { connectionId } = await connectionBackedSession(s, { expiresAt: Date.now() - 1000 });
      const access = connectionAccessFor(s, async () => { throw new TokenRefreshError('invalid_grant', 'EXPIRED'); });
      const out = await access.resolveConnectionBackedAccess({ urlKey: 'acme', ownerAccountId: ACCT, sessions: [] });
      assert.equal(out.result, undefined);
      assert.ok(await s.connectionStore.readConnectionById(connectionId), 'the headless lane never deletes');
    });
  });

  // ---------------------------------------------------------------------------
  // Blocker 5 — a stale activeBinding marker
  // ---------------------------------------------------------------------------
  describe('blocker 5: a stale activeBinding marker never survives or routes', () => {
    function linearProvider() {
      return {
        name: 'linear',
        completeAuth: async () => ({ access_token: 'LIN_NEW', refresh_token: 'R-lin', expires_in: 86400 }),
        fetchOrganization: async () => ({ id: 'org-a', name: 'Org A', urlKey: 'org-a' }),
        fetchViewer: async () => ({ id: 'viewer-a' }),
      };
    }

    test('a legacy Linear re-login over a container whose active binding is connection-backed Jira B ends as a working legacy Linear workspace', async () => {
      const s = stores();
      const saved = Object.fromEntries(['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'].map(k => [k, process.env[k]]));
      for (const k of Object.keys(saved)) process.env[k] = 'set';
      try {
        const acct = await s.accountStore.createAccount();
        await s.accountStore.linkIdentity(acct._id, 'linear', 'viewer-a');
        const container = {
          id: 'org-a', name: 'Org A', urlKey: 'org-a', provider: 'jira', activeBinding: { provider: 'jira', scope: 'https://b.atlassian.net' },
          bindings: [
            { provider: 'linear', scope: 'org-a', credentials: { token: 'LIN_OLD', tokenExpiresAt: 1 } },
            { provider: 'jira', scope: 'https://b.atlassian.net', connectionId: `${acct._id}::jira::https://b.atlassian.net` },
          ],
        };
        const session = {
          accountId: acct._id, workspaces: [container], activeWorkspaceId: 'org-a', oauthState: 'st',
          save(cb) { cb && cb(); }, regenerate(cb) { for (const k of Object.keys(this)) if (typeof this[k] !== 'function') delete this[k]; cb(); },
        };
        const router = createAuthRoutes({ ...withResolver(), provider: linearProvider(), sessionStore: { cleanup: async () => {} }, ...s });
        const res = makeRes();
        await getHandler(router, 'get', '/auth/callback')({ query: { code: 'c', state: 'st' }, session }, res);
        assert.equal(res.redirectedTo, '/workspace/org-a/');
        const w = session.workspaces.find(x => x.id === 'org-a');
        assert.equal(w.provider, 'linear');
        assert.equal(w.activeBinding, undefined, 'the stale marker is gone');
        assert.equal(ws.getWorkspaceToken(w), 'LIN_NEW', 'the fresh Linear credential is served');
        const persisted = seam.sanitizeSessionForPersist(structuredClone({ workspaces: session.workspaces }));
        assert.equal(persisted.workspaces[0].accessToken, 'LIN_NEW', 'and survives the persist sanitizer');
        assert.ok(persisted.workspaces[0].bindings.some(b => b.provider === 'jira' && b.connectionId), 'the Jira binding is kept');
      } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    });

    test("a marker whose provider is not the workspace's active provider is never served by hydration", async () => {
      const s = stores();
      const { session, workspace, connectionId } = await connectionBackedSession(s, { provider: 'jira', scope: 'https://b.atlassian.net', token: 'JIRA-B' });
      // A legacy Linear binding became the active provider, the marker left behind.
      const w = structuredClone(workspace);
      w.provider = 'linear';
      w.accessToken = 'LIN';
      w.credentials = { token: 'LIN' };
      w.bindings.unshift({ provider: 'linear', scope: 'org-a', credentials: { token: 'LIN' } });
      const fresh = { ...session, workspaces: [w] };
      await seam.hydrateSession(fresh, { connectionStore: s.connectionStore });
      assert.equal(bindingModule.readWorkspaceCredential(w), undefined, 'no Jira credential on a Linear workspace');
      assert.equal(ws.getWorkspaceToken(w), 'LIN');
      assert.equal(vm.runInContext(`${sliceServerFunction('activeConnectionIdForWorkspace')}\nactiveConnectionIdForWorkspace`, vm.createContext({ activeConnectionBackedBinding: bindingModule.activeConnectionBackedBinding, isConnectionBacked: bindingModule.isConnectionBacked }))(w), null, `no refresh/revoke routes through ${connectionId}`);
    });
  });

  // ---------------------------------------------------------------------------
  // Blocker 6 — rollback leaves exactly one live copy
  // ---------------------------------------------------------------------------
  describe('blocker 6: after the rollback, one live copy of each rotating refresh token', () => {
    test('convert → revert --execute → expire → the arm finds no Connection and the legacy lane spends R1 exactly once', async () => {
      const s = stores();
      const session = { accountId: ACCT, workspaces: [{ id: 'ws-1', urlKey: 'acme', bindings: [] }] };
      const credentials = { token: 'T0', tokenExpiresAt: Date.now() + 3600_000 };
      ws.linkProvider(session.workspaces[0], 'linear', 'org-1', credentials);
      await seam.convertToConnectionBacked({ connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore, session, accountId: ACCT, workspaceId: 'ws-1', provider: 'linear', scope: 'org-1', credentials, refreshToken: 'R1', prior: 'none', writesEnabled: true });
      await s.db.collection('sessions').insertOne({ _id: 'sid', session: seam.sanitizeSessionForPersist(structuredClone(session)) });
      await runRevert({ db: s.db, execute: true, log: () => {} });

      // Force expiry everywhere a lane could read one.
      const past = Date.now() - 1000;
      await s.db.collection('connections').updateMany({}, { $set: { 'credentials.tokenExpiresAt': past } });
      await s.db.collection('owner-credentials').updateMany({}, { $set: { tokenExpiresAt: past } });

      const spent = [];
      const exchange = async (rt) => { spent.push(rt); return { access_token: `a-${rt}`, refresh_token: `${rt}+`, expires_in: 3600 }; };
      const refresher = seam.createConnectionRefresher({ connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore, resolveExchange: () => exchange });
      const access = connectionAccessFor(s, refresher);
      const sessions = await s.db.collection('sessions').find({}).toArray();
      const arm = await access.resolveConnectionBackedAccess({ urlKey: 'acme', ownerAccountId: ACCT, sessions });
      assert.equal(arm, null, 'the connection-first arm finds no Connection for the reverted workspace');
      await refreshOwnerCredential({ ownerAccountId: ACCT, urlKey: 'acme', provider: 'linear', refreshAccessToken: exchange, store: s.ownerCredentialStore });
      assert.deepEqual(spent, ['R1'], 'R1 is spent exactly once');
    });
  });

  // ---------------------------------------------------------------------------
  // Blocker 7 — "re-link of a legacy binding stays legacy" at every seam
  // ---------------------------------------------------------------------------
  describe('blocker 7: a re-link over an existing legacy binding stays legacy (flag on)', () => {
    async function assertStayedLegacy(s, log, binding, { provider, unitId, accountId }) {
      assert.equal(binding.connectionId, undefined, 'no connectionId');
      assert.ok(binding.credentials, 'credentials present');
      assert.ok(!log.includes('link') && !log.includes('putByConnection'), `no link/putByConnection: ${log}`);
      const row = await s.db.collection('connections').findOne({ _id: `${accountId}::${provider}::${unitId}` });
      assert.ok(row, 'the LIN-3127 dual-write row');
      assert.equal(row.referents, undefined, 'stays un-managed');
    }

    function spiedStores(s, log) {
      return {
        connectionStore: spied(s.connectionStore, ['link', 'put'], log),
        ownerCredentialStore: spied(s.ownerCredentialStore, ['putByConnection', 'put'], log),
      };
    }

    test('routes/auth.js Linear add-source (the add-source conversion seam)', async () => {
      const s = stores();
      const log = [];
      const saved = Object.fromEntries(['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'].map(k => [k, process.env[k]]));
      for (const k of Object.keys(saved)) process.env[k] = 'set';
      try {
        const acct = await s.accountStore.createAccount();
        const session = {
          accountId: acct._id, oauthState: 'st', oauthIntent: { mode: 'add-source', workspaceUrlKey: 'org-a' }, activeWorkspaceId: 'org-a',
          workspaces: [
            { id: 'org-a', urlKey: 'org-a', provider: 'linear', accessToken: 'A', bindings: [{ provider: 'linear', scope: 'org-a', credentials: { token: 'A' } }] },
            { id: 'org-b', urlKey: 'org-b', provider: 'linear', accessToken: 'B-old', bindings: [{ provider: 'linear', scope: 'org-b', credentials: { token: 'B-old' } }] },
          ],
          save(cb) { cb && cb(); },
        };
        const provider = { name: 'linear', completeAuth: async () => ({ access_token: 'B-new', refresh_token: 'RB', expires_in: 86400 }), fetchOrganization: async () => ({ id: 'org-b', name: 'Org B', urlKey: 'org-b' }), fetchViewer: async () => ({ id: 'viewer-b' }) };
        const router = createAuthRoutes({ ...withResolver(), provider, sessionStore: { cleanup: async () => {} }, accountStore: s.accountStore, accountWorkspaceStore: s.accountWorkspaceStore, ...spiedStores(s, log) });
        const res = makeRes();
        await getHandler(router, 'get', '/auth/callback')({ query: { code: 'c', state: 'st' }, session }, res);
        assert.equal(res.redirectedTo, '/workspace/org-a/settings?provider_ok=linear');
        await assertStayedLegacy(s, log, session.workspaces.find(w => w.id === 'org-b').bindings[0], { provider: 'linear', unitId: 'org-b', accountId: acct._id });
        assert.equal((await s.ownerCredentialStore.get(acct._id, 'org-b', 'linear')).refreshToken, 'RB', 'the legacy durable write, as today');
      } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    });

    test('routes/jira-auth.js Jira new-login, existing container', async () => {
      const s = stores();
      const log = [];
      const ENV = ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI'];
      const saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
      for (const k of ENV) process.env[k] = 'set';
      const realFetch = globalThis.fetch;
      const site = { id: 'cid-b', url: 'https://b.atlassian.net', name: 'B' };
      globalThis.fetch = async (url) => (String(url).includes('accessible-resources')
        ? { ok: true, status: 200, json: async () => [site] }
        : { ok: true, status: 200, json: async () => ({ access_token: 'at-new', refresh_token: 'R-new', expires_in: 3600 }) });
      try {
        const acct = await s.accountStore.createAccount();
        await s.accountStore.linkIdentity(acct._id, 'jira', 'atl-human', {});
        const container = { id: 'jira:atl-human', urlKey: 'acme-jira', provider: 'jira', accessToken: 'at-old', bindings: [{ provider: 'jira', scope: site.url, credentials: { token: 'at-old', authType: 'oauth', cloudId: 'cid-b', tokenExpiresAt: 1 } }] };
        const session = { accountId: acct._id, workspaces: [container], activeWorkspaceId: container.id, oauthState: 'n', oauthIntent: { mode: 'new', provider: 'jira' }, save(cb) { cb && cb(null); } };
        const router = createJiraAuthRoutes({ ...withResolver(), provider: { validateCredential: async () => ({ accountId: 'atl-human' }) }, accountStore: s.accountStore, accountWorkspaceStore: s.accountWorkspaceStore, ...spiedStores(s, log) });
        const res = makeRes();
        await getHandler(router, 'get', '/auth/jira/oauth/callback')({ query: { code: 'c', state: 'n' }, session }, res);
        assert.equal(res.redirectedTo, '/workspace/acme-jira/');
        await assertStayedLegacy(s, log, container.bindings[0], { provider: 'jira', unitId: site.url, accountId: acct._id });
      } finally {
        globalThis.fetch = realFetch;
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    });

    describe('lib/github-install-flow.js', () => {
      const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
      let saved;
      beforeEach(() => {
        saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
        const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        Object.assign(process.env, { GITHUB_CLIENT_ID: 'c', GITHUB_CLIENT_SECRET: 's', GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }), GITHUB_APP_SLUG: 'a' });
      });
      afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

      const pending = (mode) => ({ mode, installationId: '9', token: 'ghs-new', login: 'octo', userId: '42', tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(), workspaceUrlKey: 'acme' });
      const legacyGithub = { provider: 'github', scope: 'o/r', credentials: { installationId: '9', token: 'ghs-old', tokenExpiresAt: 1 } };

      async function link(s, log, session) {
        const router = createGitHubAuthRoutes({ ...withResolver(), provider: { name: 'github' }, accountStore: s.accountStore, accountWorkspaceStore: s.accountWorkspaceStore, connectionStore: spiedStores(s, log).connectionStore });
        const res = makeRes();
        await getHandler(router, 'post', '/auth/github/link')({ body: { repo: 'o/r' }, session }, res);
        return res;
      }

      test('add-source seam', async () => {
        const s = stores();
        const log = [];
        const acct = await s.accountStore.createAccount();
        const workspace = { id: 'ws-1', urlKey: 'acme', provider: 'linear', accessToken: 'lin', bindings: [{ provider: 'linear', scope: 'org', credentials: { token: 'lin' } }, structuredClone(legacyGithub)] };
        const session = { accountId: acct._id, githubHumanId: 'h', githubPending: pending('add-source'), workspaces: [workspace], activeWorkspaceId: 'ws-1', save(cb) { cb && cb(); } };
        const res = await link(s, log, session);
        assert.match(res.redirectedTo, /provider_ok=github/);
        await assertStayedLegacy(s, log, workspace.bindings[1], { provider: 'github', unitId: '9', accountId: acct._id });
      });

      test('existing-container seam', async () => {
        const s = stores();
        const log = [];
        const acct = await s.accountStore.createAccount();
        const container = { id: 'github:42', urlKey: 'octo', provider: 'github', accessToken: 'ghs-old', bindings: [structuredClone(legacyGithub)] };
        const session = { accountId: acct._id, githubHumanId: 'h', githubPending: pending('new'), workspaces: [container], activeWorkspaceId: 'github:42', save(cb) { cb && cb(); } };
        const res = await link(s, log, session);
        assert.equal(res.redirectedTo, '/workspace/octo/');
        await assertStayedLegacy(s, log, container.bindings[0], { provider: 'github', unitId: '9', accountId: acct._id });
      });

      test('new-container seam: its prior is structurally `none` — a pre-existing container is routed to the existing-container seam instead', async () => {
        // The new-container seam derives `prior` from the SAME workspaces array
        // the existing-container check just searched, so a legacy binding at the
        // key can never reach it (the `prior: 'none'` mutation there is an
        // equivalent mutant). Pinned here: the pre-existing container is handled
        // by the existing-container seam and no second container is minted.
        const s = stores();
        const log = [];
        const acct = await s.accountStore.createAccount();
        const container = { id: 'github:42', urlKey: 'octo', provider: 'github', accessToken: 'ghs-old', bindings: [structuredClone(legacyGithub)] };
        const session = {
          accountId: acct._id, githubHumanId: 'h', githubPending: pending('new'), workspaces: [container], activeWorkspaceId: 'github:42',
          save(cb) { cb && cb(); }, regenerate() { throw new Error('the new-container seam (regenerate) must not be reached'); },
        };
        await link(s, log, session);
        assert.equal(session.workspaces.length, 1);
        const src = readFileSync(new URL('../../lib/github-install-flow.js', import.meta.url), 'utf8');
        assert.match(src, /const existing = \(req\.session\.workspaces \|\| \[\]\)\.find\(w => w\.id === workspaceId\)\n\s*if \(existing\) \{/);
        assert.match(src, /prior: bindingShapeAt\(workspacesBeforeLogin\.find\(w => w\.id === workspace\.id\), provider\.name, slug\),/);
      });
    });
  });
});
