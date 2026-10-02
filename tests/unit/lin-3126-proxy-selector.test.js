/**
 * LIN-3241 (LIN-3126 slice 2) — connection-first arm characterization.
 *
 * Surface (A): `createConnectionAccess.resolveConnectionBackedAccess` /
 * `connectionResolveResult`. On a GitHub connection-backed workspace the arm
 * used to project `connection.unitId` (the App INSTALLATION id) as the repo, so
 * the provider call scope was `{token, repo: '<installationId>'}` — the wrong
 * repo for every binding on that Connection. The arm must read the owner's
 * session-row workspace binding and project that binding's `scope` (the real
 * `owner/name` repo); `unitId` stays Connection identity only.
 *
 * This is the slice-2 "arm characterization" seed: the rest of the slice-2 rows
 * (selector/ISSUE/WORKSPACE matrix, cache bypass, refusal mapping, census pin)
 * are added by the later beats to this same file.
 *
 * Fails-before (recorded at LIN-3240 merge, 0924b595, before the arm fix):
 *     result.scope -> { token: 'tok-a', repo: '99' }
 *     AssertionError [ERR_ASSERTION]: expected { token: 'tok-a', repo: 'octo/repoA' },
 *     got { token: 'tok-a', repo: '99' }
 *
 * Run with: node --test tests/unit/lin-3126-proxy-selector.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { fingerprintCredential, CREDENTIAL_SOURCES } from '../../lib/credential-diagnostics.js';
import { workspaceTokenCacheKey, workspaceTokenCacheBypasses } from '../../lib/workspace-token-cache.js';
import { UNSCOPED, TOKEN_REFRESH_BUFFER_MS, selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution } from '../../lib/workspace-token-resolver.js';
import { selectOwnerWorkspaceTokenExcludingSuperseded } from '../../lib/superseded-selection.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from '../../lib/credential-lifecycle-events.js';
import { createProxyRoutes } from '../../routes/proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

const REPO_A = 'octo/repoA';
const REPO_B = 'octo/repoB';
const INSTALLATION_ID = '99';
const CONNECTION_ID = 'acct::github::99';
const BUFFER = 5 * 60 * 1000;
const future = () => Date.now() + 3_600_000;

/** A live GitHub Connection whose `unitId` is the App installation id, not a repo. */
function githubConnection() {
  return {
    _id: CONNECTION_ID,
    accountId: 'acct',
    provider: 'github',
    unitId: INSTALLATION_ID,
    credentials: { token: 'tok-a', installationId: INSTALLATION_ID, tokenExpiresAt: future() },
    referents: [],
  };
}

/** The owner's session-row workspace: repoA active, repoB beside it, one Connection. */
function twoRepoOwnerRow() {
  return {
    session: {
      workspaces: [{
        urlKey: 'acme',
        provider: 'github',
        bindings: [
          { provider: 'github', scope: REPO_A, connectionId: CONNECTION_ID },
          { provider: 'github', scope: REPO_B, connectionId: CONNECTION_ID },
        ],
        activeBinding: { provider: 'github', scope: REPO_A },
      }],
    },
    workspaceIndex: 0,
  };
}

function accessWith({ connections, ownerRow }) {
  return createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => connections },
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => ownerRow,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
  });
}

describe('LIN-3241 arm characterization — the connection-first arm projects the binding scope, never the installation id', () => {
  test('GitHub connection-backed workspace: call scope repo is the active binding repo, not unitId', async () => {
    const access = accessWith({ connections: [githubConnection()], ownerRow: twoRepoOwnerRow() });

    const out = await access.resolveConnectionBackedAccess({ urlKey: 'acme', ownerAccountId: 'acct', sessions: [] });

    assert.ok(out?.result, 'the live owner Connection is served');
    assert.deepEqual(
      out.result.scope,
      { token: 'tok-a', repo: REPO_A },
      'the call scope carries the real default repo, not the installation id'
    );
    assert.notEqual(out.result.scope.repo, INSTALLATION_ID, 'unitId must stay Connection identity only');
  });
});

// ---------------------------------------------------------------------------
// (B) ISSUE / selector resolutions bypass workspaceTokenCache (LIN-3241)
// ---------------------------------------------------------------------------

describe('(B) workspaceTokenCacheBypasses — ISSUE and selector resolutions are uncached (fail closed)', () => {
  test('absent options (a non-proxy caller) keeps caching, byte-identical', async () => {
    const mod = await import('../../lib/workspace-token-cache.js');
    assert.equal(typeof mod.workspaceTokenCacheBypasses, 'function', 'the bypass predicate must be exported');
    assert.equal(mod.workspaceTokenCacheBypasses(undefined), false);
    assert.equal(mod.workspaceTokenCacheBypasses(null), false);
  });

  test('a missing intent fails closed as ISSUE -> bypass', async () => {
    const { workspaceTokenCacheBypasses } = await import('../../lib/workspace-token-cache.js');
    assert.equal(workspaceTokenCacheBypasses({}), true);
    assert.equal(workspaceTokenCacheBypasses({ selector: undefined }), true);
  });

  test('an unrecognised intent fails closed as ISSUE -> bypass', async () => {
    const { workspaceTokenCacheBypasses } = await import('../../lib/workspace-token-cache.js');
    assert.equal(workspaceTokenCacheBypasses({ intent: 'WAT' }), true);
    assert.equal(workspaceTokenCacheBypasses({ intent: null }), true);
  });

  test('ISSUE bypasses with and without a selector', async () => {
    const { workspaceTokenCacheBypasses } = await import('../../lib/workspace-token-cache.js');
    assert.equal(workspaceTokenCacheBypasses({ intent: 'ISSUE' }), true);
    assert.equal(workspaceTokenCacheBypasses({ intent: 'ISSUE', selector: { source: 'github', bindingScope: REPO_B } }), true);
  });

  test('a selector-bearing resolution bypasses even for CREATE / WORKSPACE', async () => {
    const { workspaceTokenCacheBypasses } = await import('../../lib/workspace-token-cache.js');
    assert.equal(workspaceTokenCacheBypasses({ intent: 'CREATE', selector: { source: 'github', bindingScope: REPO_A } }), true);
    assert.equal(workspaceTokenCacheBypasses({ intent: 'WORKSPACE', selector: { source: 'github', bindingScope: REPO_B } }), true);
  });

  test('no-selector CREATE / WORKSPACE keeps caching', async () => {
    const { workspaceTokenCacheBypasses } = await import('../../lib/workspace-token-cache.js');
    assert.equal(workspaceTokenCacheBypasses({ intent: 'CREATE' }), false);
    assert.equal(workspaceTokenCacheBypasses({ intent: 'WORKSPACE' }), false);
  });
});

describe('(B) server.js resolveWorkspaceAccess wires the bypass through the real cache', () => {
  function extractResolveWorkspaceAccessBody(src) {
    const start = src.indexOf('async function resolveWorkspaceAccess');
    assert.ok(start >= 0, 'async function resolveWorkspaceAccess not found in server.js');
    const end = src.indexOf('\n}', start);
    assert.ok(end >= 0, "could not find resolveWorkspaceAccess's top-level closing brace");
    return src.slice(start, end + 2);
  }

  test('the cache read and every cache write are guarded by the bypass decision', () => {
    const body = extractResolveWorkspaceAccessBody(SERVER_SRC);

    assert.ok(
      /const bypassTokenCache = workspaceTokenCacheBypasses\(options\)/.test(body),
      'resolveWorkspaceAccess must key the bypass on its options argument'
    );
    assert.match(
      body,
      /bypassTokenCache \? undefined : workspaceTokenCache\.get\(cacheKey\)/,
      'the cache read must be short-circuited to undefined when bypassing'
    );
    const setLines = body.split('\n').filter(l => l.includes('workspaceTokenCache.set(cacheKey'));
    const guardedSetLines = body.split('\n').filter(l => /if \(!bypassTokenCache[^)]*\) workspaceTokenCache\.set\(cacheKey/.test(l));
    assert.ok(setLines.length > 0, 'expected cache writes inside resolveWorkspaceAccess');
    assert.equal(
      guardedSetLines.length,
      setLines.length,
      'every cache write must be guarded by `if (!bypassTokenCache…)`: an ISSUE/selector resolution must perform no get and no set'
    );
  });
});

// ---------------------------------------------------------------------------
// (C) + (D) refusal -> 422, and the dispatch referent guard surfaces it
// ---------------------------------------------------------------------------

const REFUSAL = { token: null, reason: 'binding_required', provider: 'github', bindings: [REPO_A, REPO_B] };

function buildProxyApp(resolveWorkspaceAccess) {
  const captured = {};
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      mintGrantBootstrap: async () => ({ token: 'b', kind: 'bootstrap', scope: 'readWrite' }),
      createToken: async () => ({ token: 'b', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: 'acme',
        label: 'test', scope: 'readWrite', createdBy: 'acct-owner',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess,
    getWorkspaceAccessToken: async () => null,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      getGrantDeclaration: async () => ({ state: 'none' }),
      addItem: async (urlKey, item) => { captured.item = item; return { _id: 'disp-1', ...item }; },
    },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: { name: 'github', supports: () => true, viewer: async () => ({ id: 'u1' }) },
  }));
  return { app, captured };
}

async function callProxy(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    const opts = { method, headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed, text };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('(C) workspaceUnavailable maps binding refusals to 422, not a 503', () => {
  test('GET /api/proxy/me with reason binding_required -> 422 {code, provider, bindings}', async () => {
    const { app } = buildProxyApp(async () => REFUSAL);
    const res = await callProxy(app, 'GET', '/api/proxy/me');

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'BINDING_REQUIRED');
    assert.equal(res.body.provider, 'github');
    assert.deepEqual(res.body.bindings, [REPO_A, REPO_B]);
  });

  test('unknown_binding -> 422 with the UNKNOWN_BINDING code', async () => {
    const { app } = buildProxyApp(async () => ({ ...REFUSAL, reason: 'unknown_binding' }));
    const res = await callProxy(app, 'GET', '/api/proxy/me');

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'UNKNOWN_BINDING');
  });

  test('a normal non-binding failure keeps the 503 envelope (no regression)', async () => {
    const { app } = buildProxyApp(async () => ({ token: null, reason: 'not_connected' }));
    const res = await callProxy(app, 'GET', '/api/proxy/me');

    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'WORKSPACE_NOT_CONNECTED');
  });
});

describe('(D) the dispatch referent guard surfaces a refusal before isDanglingReferent', () => {
  test('POST /api/proxy/dispatch with an issue on a refusal -> 422, no dispatch enqueued', async () => {
    const { app, captured } = buildProxyApp(async () => REFUSAL);
    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', { prompt: 'run me', issueIdentifier: 'GA-1' });

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'BINDING_REQUIRED');
    assert.deepEqual(res.body.bindings, [REPO_A, REPO_B]);
    assert.equal(captured.item, undefined, 'a refused dispatch must not enqueue');
  });
});

// ---------------------------------------------------------------------------
// (E) selector validation: the connection-first arm picks the NAMED binding
// ---------------------------------------------------------------------------

describe('(E) the connection arm resolves the binding by intent/selector (slice-1 resolvers, never re-created)', () => {
  function armAccess(overrides = {}) {
    return createConnectionAccess({
      connectionStore: { readConnectionsByReferent: async () => [githubConnection()] },
      ownerCredentialStore: { getByConnection: async () => null },
      refreshConnection: async () => null,
      resolveCanonicalAccountId: async (id) => id,
      selectOwnerSessionRow: () => twoRepoOwnerRow(),
      normalizeProvider: (ws) => ws?.provider || 'linear',
      fingerprintCredential,
      gate: { shouldAttempt: () => true },
      lifecycleEventStore: { recordEvent: async () => {} },
      bufferMs: BUFFER,
      ...overrides,
    });
  }
  const call = (access, intent, selector) =>
    access.resolveConnectionBackedAccess({ urlKey: 'acme', ownerAccountId: 'acct', sessions: [], intent, selector });

  test('ISSUE + selector repoB selects repoB, not the active repoA', async () => {
    const out = await call(armAccess(), 'ISSUE', { source: 'github', bindingScope: REPO_B });
    assert.deepEqual(out.result.scope, { token: 'tok-a', repo: REPO_B });
    assert.equal(out.result.provider, 'github');
  });

  test('ISSUE without a selector on the two-binding workspace refuses BINDING_REQUIRED (never matches[0])', async () => {
    const out = await call(armAccess(), 'ISSUE', undefined);
    assert.equal(out.result.token, null);
    assert.equal(out.result.reason, 'binding_required');
    assert.equal(out.result.provider, 'github');
    assert.deepEqual(out.result.bindings, [REPO_A, REPO_B]);
  });

  test('ISSUE + unknown selector refuses UNKNOWN_BINDING', async () => {
    const out = await call(armAccess(), 'ISSUE', { source: 'github', bindingScope: 'octo/ghost' });
    assert.equal(out.result.token, null);
    assert.equal(out.result.reason, 'unknown_binding');
    assert.deepEqual(out.result.bindings, [REPO_A, REPO_B]);
  });

  test('WORKSPACE without a selector serves the explicit default (active repoA), never refusing for ambiguity', async () => {
    const out = await call(armAccess(), 'WORKSPACE', undefined);
    assert.deepEqual(out.result.scope, { token: 'tok-a', repo: REPO_A });
  });

  test('CREATE without a selector serves the explicit default (active repoA)', async () => {
    const out = await call(armAccess(), 'CREATE', undefined);
    assert.deepEqual(out.result.scope, { token: 'tok-a', repo: REPO_A });
  });

  test('a selector naming another owner\'s binding is UNKNOWN_BINDING (bindings are the owner workspace\'s own)', async () => {
    const out = await call(armAccess(), 'ISSUE', { source: 'github', bindingScope: 'someone-else/repo' });
    assert.equal(out.result.reason, 'unknown_binding');
  });

  test('B1: the selector is selection-only — the credential comes from the Connection, and bindingScope never becomes token/fingerprint', async () => {
    const CRAFTED = 'looks-like-a-token';
    const binding = { provider: 'github', scope: CRAFTED, connectionId: CONNECTION_ID };
    const ownerRow = {
      session: { workspaces: [{
        urlKey: 'acme', provider: 'github', bindings: [binding],
        activeBinding: { provider: 'github', scope: CRAFTED },
      }] },
      workspaceIndex: 0,
    };
    const out = await call(armAccess({ selectOwnerSessionRow: () => ownerRow }), 'ISSUE', { source: 'github', bindingScope: CRAFTED });

    assert.deepEqual(out.result.scope, { token: 'tok-a', repo: CRAFTED }, 'the structured scope pairs the Connection credential with the selected repo');
    assert.equal(out.result.token, 'tok-a', 'the token is the Connection credential, never the selector');
    assert.notEqual(out.result.token, CRAFTED);
    assert.equal(out.result.credentialFingerprint, fingerprintCredential(out.result.scope));
    assert.notEqual(out.result.credentialFingerprint, CRAFTED);
  });
});

// ---------------------------------------------------------------------------
// (B behavioural) the real resolveWorkspaceAccess body, vm-executed
// ---------------------------------------------------------------------------

function stripSrcComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function extractResolveBody(src) {
  const start = src.indexOf('async function resolveWorkspaceAccess');
  assert.ok(start >= 0, 'async function resolveWorkspaceAccess not found in server.js');
  const end = src.indexOf('\n}', start);
  assert.ok(end >= 0, "could not find resolveWorkspaceAccess's top-level closing brace");
  return src.slice(start, end + 2);
}

function makeSpyCache() {
  return {
    gets: [],
    sets: [],
    get(key) { this.gets.push(key); return undefined; },
    set(key, value) { this.sets.push({ key, value }); return true; },
  };
}

/** Execute the REAL server.js resolveWorkspaceAccess body with injected collaborators. */
function makeVmResolver({ sessions = [], connectionAccess = { resolveConnectionBackedAccess: async () => null }, cache = makeSpyCache() } = {}) {
  const context = vm.createContext({
    UNSCOPED, TOKEN_REFRESH_BUFFER_MS,
    selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution,
    selectOwnerWorkspaceTokenExcludingSuperseded,
    rejectedCredentialRegistry: createRejectedCredentialRegistry(),
    CREDENTIAL_SOURCES, fingerprintCredential, CREDENTIAL_LIFECYCLE_EVENT_KINDS,
    accountStore: { resolveCanonicalAccountId: async (id) => id },
    workspaceTokenCacheKey,
    workspaceTokenCacheBypasses,
    sessionsCollection: { find: () => ({ toArray: async () => sessions }) },
    workspaceTokenCache: cache,
    ownerCredentialStore: { get: async () => null },
    refreshOnResolveGate: { shouldAttempt: () => false },
    credentialLifecycleEventStore: { recordEvent: async () => {} },
    attemptSuspectCredentialRefresh: async () => null,
    connectionAccess,
    console: { log() {}, warn() {}, error() {} },
    process: { env: {} },
  });
  const script = extractResolveBody(SERVER_SRC) + '\nresolveWorkspaceAccess';
  const fn = vm.runInContext(script, context);
  return { fn, cache };
}

function legacyLinearSessions() {
  return [{
    _id: 'sid-1',
    session: {
      accountId: 'acct',
      workspaces: [{ urlKey: 'acme', provider: 'linear', accessToken: 'lin-token', tokenExpiresAt: Date.now() + 10_000_000 }],
    },
  }];
}

describe('(B behavioural) ISSUE/selector resolutions make zero cache calls; no-selector CREATE/WORKSPACE use only the base key', () => {
  test('ISSUE intent (no selector) performs no workspaceTokenCache get and no set', async () => {
    const { fn, cache } = makeVmResolver({ sessions: legacyLinearSessions() });
    const result = await fn('acme', 'acct', { intent: 'ISSUE' });

    assert.equal(result.token, 'lin-token', 'the ISSUE resolution still resolves a token — only the CACHE is bypassed');
    assert.deepEqual(cache.gets, [], 'no cache get on an ISSUE resolution');
    assert.deepEqual(cache.sets, [], 'no cache set on an ISSUE resolution');
  });

  test('a selector-bearing WORKSPACE resolution performs no cache get and no set', async () => {
    const { fn, cache } = makeVmResolver({ sessions: legacyLinearSessions() });
    await fn('acme', 'acct', { intent: 'WORKSPACE', selector: { source: 'linear', bindingScope: 'org-1' } });

    assert.deepEqual(cache.gets, []);
    assert.deepEqual(cache.sets, []);
  });

  test('a no-selector WORKSPACE resolution does get/set the BASE key, and only that key', async () => {
    const { fn, cache } = makeVmResolver({ sessions: legacyLinearSessions() });
    const result = await fn('acme', 'acct', { intent: 'WORKSPACE' });
    const baseKey = workspaceTokenCacheKey('acme', 'acct');

    assert.equal(result.token, 'lin-token');
    assert.deepEqual(cache.gets, [baseKey], 'exactly one get, the base (urlKey, owner) key');
    assert.deepEqual(cache.sets.map(s => s.key), [baseKey], 'exactly one set, the base key — no new key variant');
  });

  test('a no-selector CREATE resolution does get/set the BASE key, and only that key', async () => {
    const { fn, cache } = makeVmResolver({ sessions: legacyLinearSessions() });
    await fn('acme', 'acct', { intent: 'CREATE' });

    assert.deepEqual(cache.gets, [workspaceTokenCacheKey('acme', 'acct')]);
    assert.deepEqual(cache.sets.map(s => s.key), [workspaceTokenCacheKey('acme', 'acct')]);
  });

  test('absent options (a non-proxy caller) keeps caching the base key', async () => {
    const { fn, cache } = makeVmResolver({ sessions: legacyLinearSessions() });
    await fn('acme', 'acct');
    assert.deepEqual(cache.gets, [workspaceTokenCacheKey('acme', 'acct')]);
  });
});

// ---------------------------------------------------------------------------
// Acceptance witness (b): GET /api/proxy/issues/:id?source=github&bindingScope=repoB
// ---------------------------------------------------------------------------

function buildAcceptanceApp() {
  const calls = [];
  const ownerRow = twoRepoOwnerRow();
  const ownerSession = {
    accountId: 'acct-owner',
    workspaces: ownerRow.session.workspaces,
  };
  const connectionAccess = createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => [githubConnection()] },
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => ownerRow,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
  });
  const { fn } = makeVmResolver({ sessions: [{ _id: 'sid', session: ownerSession }], connectionAccess });

  const provider = {
    name: 'github',
    supports: () => true,
    issueDetail: async (scope, issueId) => {
      calls.push(scope);
      return { id: issueId, identifier: 'GB-1', title: 'repoB', description: 'REPO_B_MARKER', state: { name: 'Todo', type: 'unstarted' } };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      mintGrantBootstrap: async () => ({ token: 'b', kind: 'bootstrap', scope: 'readWrite' }),
      createToken: async () => ({ token: 'b', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: 'acme',
        label: 'test', scope: 'readWrite', createdBy: 'acct',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: fn,
    getWorkspaceAccessToken: async () => null,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: { getGrantDeclaration: async () => ({ state: 'none' }), addItem: async () => ({ _id: 'd' }) },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return { app, calls };
}
describe('LIN-3241 acceptance witness (b) — proxy issue read honours the issue\'s own binding', () => {
  test('?source=github&bindingScope=repoB asks repoB with call scope {repo:repoB}', async () => {
    const { app, calls } = buildAcceptanceApp();
    const res = await callProxy(app, 'GET', `/api/proxy/issues/1?source=github&bindingScope=${encodeURIComponent(REPO_B)}`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(calls.map(c => c.repo), [REPO_B], 'the provider saw only repoB');
    assert.equal(calls[0].token, 'tok-a', 'the token is the Connection credential');
  });

  test('without a selector on the two-binding workspace: 422 BINDING_REQUIRED and ZERO provider calls', async () => {
    const { app, calls } = buildAcceptanceApp();
    const res = await callProxy(app, 'GET', '/api/proxy/issues/1');

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'BINDING_REQUIRED');
    assert.deepEqual(res.body.bindings, [REPO_A, REPO_B]);
    assert.equal(calls.length, 0, 'no provider call on a refusal');
  });
});

// ---------------------------------------------------------------------------
// (F1) post-logout: no owner session row must keep the pre-PR arm path
//
// Review F1: every proxy call now carries an intent, so the arm always ran a
// slice-1 selection against `ownerWorkspace`. With no owner session row
// (logout/session expiry while a 48h proxy token is still live) the selection
// fell through and the arm returned null BEFORE reading any Connection, so
// every proxy route regressed to 503 `owner_signed_out`. The plan says "absent
// means unchanged behaviour"; the D12 headless arm is documented as "today's
// post-logout behaviour". So a null `ownerWorkspace` keeps the pre-PR arm path.
// ---------------------------------------------------------------------------

function linearNoOwnerConnectionAccess() {
  const EXPIRES_AT = Date.now() + 3_600_000;
  return createConnectionAccess({
    connectionStore: {
      readConnectionsByReferent: async () => [{
        _id: 'acct::linear::org',
        accountId: 'acct',
        provider: 'linear',
        unitId: 'org',
        credentials: { token: 'lin-tok', tokenExpiresAt: EXPIRES_AT },
        referents: [],
      }],
    },
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => null,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
  });
}

describe('(F1) no owner session row — the arm keeps the pre-PR path (served from the Connection)', () => {
  for (const intent of ['WORKSPACE', 'CREATE', 'ISSUE']) {
    test(`intent ${intent} with no owner row still serves the live Connection (not owner_signed_out)`, async () => {
      const { fn } = makeVmResolver({ connectionAccess: linearNoOwnerConnectionAccess(), sessions: [] });
      const baseline = await fn('acme', 'acct');
      const result = await fn('acme', 'acct', { intent });

      assert.equal(result.token, 'lin-tok', 'the live Connection credential is served, as before the PR');
      assert.notEqual(result.reason, 'owner_signed_out');
      assert.deepEqual(result, baseline, `intent ${intent} must be byte-identical to the pre-PR absent-options result`);
    });
  }

  test('absent options (the pre-PR baseline) is unchanged', async () => {
    const { fn } = makeVmResolver({ connectionAccess: linearNoOwnerConnectionAccess(), sessions: [] });
    const result = await fn('acme', 'acct');
    assert.equal(result.token, 'lin-tok');
  });
});

// ---------------------------------------------------------------------------
// (F3) refreshConnectionForSuspect projects the binding scope, never unitId
//
// Review F3: `refreshConnectionForSuspect` called `connectionResolveResult`
// with no `bindingScope`, so it fell back to `connection.unitId` — the GitHub
// App installation id. The recovered credential feeds
// `resolveWorkspaceAccess`'s cache-hit `recovered` path, which re-sets the base
// key for no-selector CREATE/WORKSPACE, so a suspect recovery could serve
// `repo: <installationId>` for the TTL. It must project the owner binding's
// scope (via `bindingScopeForConnection` + the owner workspace) instead.
// ---------------------------------------------------------------------------

function githubSuspectAccess({ ownerRow }) {
  return createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => [githubConnection()] },
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection: async () => ({ token: 'tok-new', expiresAt: future(), provider: 'github' }),
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => ownerRow ?? null,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
  });
}

describe('(F3) refreshConnectionForSuspect projects the binding scope, never the installation id', () => {
  test('GitHub suspect recovery returns the binding repo, not connection.unitId', async () => {
    const row = twoRepoOwnerRow();
    const access = githubSuspectAccess({ ownerRow: row });
    const out = await access.refreshConnectionForSuspect({
      urlKey: 'acme',
      ownerAccountId: 'acct',
      provider: 'github',
      loadSessions: async () => [{ _id: 'sid', session: { workspaces: row.session.workspaces } }],
    });

    assert.equal(out.token, 'tok-new');
    assert.deepEqual(out.scope, { token: 'tok-new', repo: REPO_A });
    assert.notEqual(out.scope.repo, INSTALLATION_ID, 'a recovered GitHub credential must not regress to the installation id');
  });
});

// ---------------------------------------------------------------------------
// (F) census pin — all 37 resolveProviderAccess call sites declare a literal
// ---------------------------------------------------------------------------

describe('(F) census pin — every resolveProviderAccess call site declares a literal BINDING_INTENT.*', () => {
  const FILES = [
    'proxy-reads.js', 'proxy-writes.js', 'proxy-compute.js', 'proxy-dispatch.js',
    'proxy-kickoff.js', 'proxy-flight-companion.js', 'proxy.js',
  ];
  function callSites() {
    const sites = [];
    for (const file of FILES) {
      const src = stripSrcComments(readFileSync(join(__dirname, '../../routes', file), 'utf8'));
      for (const line of src.split('\n')) {
        if (line.includes('resolveProviderAccess(') && !line.includes('function resolveProviderAccess')) {
          sites.push({ file, line: line.slice(line.indexOf('resolveProviderAccess(')) });
        }
      }
    }
    return sites;
  }
  const sites = callSites();

  test('there are exactly 37 call sites', () => {
    assert.equal(sites.length, 37, JSON.stringify(sites.map(s => s.file)));
  });

  test('every site passes a literal BINDING_INTENT.* (the dispatch site a ternary of two)', () => {
    for (const { file, line } of sites) {
      assert.match(line, /BINDING_INTENT\.(ISSUE|CREATE|WORKSPACE)/, `${file}: no literal intent in "${line.trim()}"`);
      if (!line.includes('issueIdentifier ?')) {
        const literals = line.match(/BINDING_INTENT\.(ISSUE|CREATE|WORKSPACE)/g) || [];
        assert.equal(literals.length, 1, `${file}: expected exactly one literal: "${line.trim()}"`);
        assert.match(line, /\{ intent: BINDING_INTENT\./, `${file}: the literal must be the intent option: "${line.trim()}"`);
      }
    }
    const conditional = sites.filter(s => s.line.includes('issueIdentifier ?'));
    assert.equal(conditional.length, 1, 'exactly one conditional dispatch call site');
    assert.match(conditional[0].line, /BINDING_INTENT\.ISSUE\s*:\s*BINDING_INTENT\.WORKSPACE/);
  });

  test('the effective intent counts match the plan table (ISSUE 21, CREATE 1, WORKSPACE 15)', () => {
    let issue = 0, create = 0, workspace = 0;
    for (const { line } of sites) {
      if (line.includes('issueIdentifier ?')) { issue++; continue; }
      if (/BINDING_INTENT\.ISSUE/.test(line)) issue++;
      else if (/BINDING_INTENT\.CREATE/.test(line)) create++;
      else workspace++;
    }
    assert.deepEqual({ issue, create, workspace }, { issue: 21, create: 1, workspace: 15 });
  });
});

// ---------------------------------------------------------------------------
// Workspace-level no-selector HTTP matrix (the plan's 15 WORKSPACE sites)
// ---------------------------------------------------------------------------

function permissiveGitHubProvider() {
  return {
    name: 'github',
    supports: (cap) => cap !== 'fetchAttachment',
    createFields: () => [],
    viewer: async () => ({ id: 'u1' }),
    fetchTeams: async () => [],
    projects: async () => [],
    fetchProjectsList: async () => [{ content: 'repo=octo/repoA' }],
    fetchProjects: async () => ({ projects: [], issues: [] }),
    issues: async () => ({ nodes: [], pageInfo: {} }),
    search: async () => [],
    states: async () => [],
    labels: async () => [],
    cycles: async () => [],
    cycleDetail: async () => ({ id: 'cyc-1' }),
    issueDetail: async () => null,
    relations: async () => null,
  };
}

/** A proxy app whose resolver is the REAL vm-executed resolveWorkspaceAccess over the real arm, recording each resolution. */
function buildWorkspaceMatrixApp(provider = permissiveGitHubProvider()) {
  const recorded = [];
  const ownerRow = twoRepoOwnerRow();
  const ownerSession = { accountId: 'acct', workspaces: ownerRow.session.workspaces };
  const connectionAccess = createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => [githubConnection()] },
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => ownerRow,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
  });
  const { fn } = makeVmResolver({ sessions: [{ _id: 'sid', session: ownerSession }], connectionAccess });
  const resolveWorkspaceAccess = async (urlKey, ownerAccountId, options) => {
    const result = await fn(urlKey, ownerAccountId, options);
    recorded.push({ options, result });
    return result;
  };
  const captured = {};
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      mintGrantBootstrap: async () => ({ token: 'b', kind: 'bootstrap', scope: 'readWrite' }),
      createToken: async () => ({ token: 'b', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: 'acme',
        label: 'test', scope: 'readWrite', createdBy: 'acct',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess,
    getWorkspaceAccessToken: async () => null,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      getGrantDeclaration: async () => ({ state: 'none' }),
      addItem: async (urlKey, item) => { captured.item = item; return { _id: 'disp-1', ...item }; },
    },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return { app, recorded, captured };
}

describe('LIN-3241 matrix — every WORKSPACE-intent route with no selector serves the explicit default and never refuses', () => {
  // One row per WORKSPACE-intent site that the existing proxy harness can drive
  // end-to-end. `expected` is the route's normal status.
  const ROWS = [
    ['GET', '/api/proxy/me', 200],
    ['GET', '/api/proxy/teams', 200],
    ['GET', '/api/proxy/projects', 200],
    ['GET', '/api/proxy/known-repos', 200],
    ['GET', '/api/proxy/issues', 200],
    ['GET', '/api/proxy/search?q=x', 200],
    ['GET', '/api/proxy/states/LIN', 200],
    ['GET', '/api/proxy/labels', 200],
    ['GET', '/api/proxy/cycles', 200],
    ['GET', '/api/proxy/cycles/00000000-0000-0000-0000-000000000000', 200],
    ['GET', '/api/proxy/stack', 200],
    ['GET', '/api/proxy/instructions', 200],
    // The repo-only dispatch takes the WORKSPACE branch of the conditional site.
    ['POST', '/api/proxy/dispatch', 201, { prompt: 'run me', repo: REPO_A }],
    // Flight Companion turn: resolveProviderAccess runs before the message-length
    // guard, so a >2000-char message is the cheapest branch that exercises the
    // site without the turn core. Its "normal status" is 400.
    ['POST', '/api/proxy/flight-companion/turn', 400, { message: 'x'.repeat(2001) }],
  ];

  for (const [method, path, expected, body] of ROWS) {
    test(`${method} ${path} -> ${expected}, resolver intent WORKSPACE, default repoA, no binding refusal`, async () => {
      const { app, recorded } = buildWorkspaceMatrixApp();
      const res = await callProxy(app, method, path, body);

      assert.equal(res.status, expected, JSON.stringify(res.body));
      assert.notEqual(res.body?.code, 'BINDING_REQUIRED', 'a WORKSPACE route must never refuse for ambiguity');
      assert.notEqual(res.body?.code, 'UNKNOWN_BINDING');
      const resolution = recorded.at(-1);
      assert.ok(resolution, 'the resolver must have been invoked');
      assert.equal(resolution.options?.intent, 'WORKSPACE', 'the route must declare the WORKSPACE intent');
      assert.deepEqual(resolution.result?.scope, { token: 'tok-a', repo: REPO_A }, 'the route serves the explicit default (active repoA)');
    });
  }

  test('a bindingScope query on a WORKSPACE route is ignored (it never reads a selector)', async () => {
    const { app, recorded } = buildWorkspaceMatrixApp();
    const res = await callProxy(app, 'GET', `/api/proxy/teams?source=github&bindingScope=${encodeURIComponent(REPO_B)}`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(recorded.at(-1).options.selector, undefined, 'WORKSPACE must not read a selector from the query');
    assert.deepEqual(recorded.at(-1).result.scope, { token: 'tok-a', repo: REPO_A });
  });
});
