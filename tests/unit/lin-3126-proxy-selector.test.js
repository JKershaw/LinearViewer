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
import { workspaceTokenCacheKey, workspaceTokenCacheBypasses, evictWorkspaceTokenPair } from '../../lib/workspace-token-cache.js';
import { UNSCOPED, TOKEN_REFRESH_BUFFER_MS, selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution } from '../../lib/workspace-token-resolver.js';
import { selectOwnerWorkspaceTokenExcludingSuperseded } from '../../lib/superseded-selection.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from '../../lib/credential-lifecycle-events.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { bindingRefusalResponse, BINDING_INTENT } from '../../lib/workspace.js';
import { makeHoldingCache } from './lin-3126-proxy-harness.js';
import { encodeAttachmentHandle } from '../../lib/proxy-wire.js';

// The proxy limiter is a process-global module-scope instance (60/min) that
// skips only when NODE_ENV==='test'. The ISSUE inverse row drives all 21 sites
// twice, so the whole file must run with the limiter skipped, as the other
// proxy route tests do.
process.env.NODE_ENV = 'test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const PROXY_SRC = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');

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
// (LIN-1507) the three cache rows, on a cache that ACTUALLY HOLDS entries
//
// Review F2: the earlier spy cache always missed on `get`, so the warm-entry,
// eviction and repoA-never-serves-repoB properties were unexercised. These rows
// use a real `createWorkspaceTokenCache` under a recording wrapper.
// ---------------------------------------------------------------------------

describe('(LIN-1507) a warm base entry never serves an ISSUE/selector read, and eviction covers every key', () => {
  const baseKey = workspaceTokenCacheKey('acme', 'acct');
  const blindKey = workspaceTokenCacheKey('acme');

  function twoRepoConnectionAccessLocal() {
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
    });
  }

  function resolverWithHoldingCache() {
    const cache = makeHoldingCache();
    const ownerRow = twoRepoOwnerRow();
    const ownerSession = { accountId: 'acct', workspaces: ownerRow.session.workspaces };
    const { fn } = makeVmResolver({
      sessions: [{ _id: 'sid', session: ownerSession }],
      connectionAccess: twoRepoConnectionAccessLocal(),
      cache,
    });
    return { fn, cache };
  }

  test('(i) a base entry pre-warmed by a no-selector WORKSPACE read does not let a following ISSUE read skip BINDING_REQUIRED', async () => {
    const { fn, cache } = resolverWithHoldingCache();
    const warm = await fn('acme', 'acct', { intent: 'WORKSPACE' });
    assert.deepEqual(warm.scope, { token: 'tok-a', repo: REPO_A }, 'the WORKSPACE read served repoA');
    assert.deepEqual(cache.sets.map(s => s.key), [baseKey], 'the WORKSPACE read warmed the base key');
    cache.gets.length = 0;
    cache.sets.length = 0;

    const issue = await fn('acme', 'acct', { intent: 'ISSUE' });

    assert.equal(issue.token, null);
    assert.equal(issue.reason, 'binding_required', 'the ISSUE read still refuses despite the warm entry');
    assert.deepEqual(cache.gets, [], 'an ISSUE read must NOT read the warm base entry');
    assert.deepEqual(cache.sets, [], 'an ISSUE read must not write');
    assert.ok(cache.inner.get(baseKey), 'the warm base entry is untouched');
  });

  test('(ii) after evictWorkspaceTokenPair every probed key misses (owner-scoped + owner-blind; no new variant survives)', async () => {
    const { cache } = resolverWithHoldingCache();
    const entry = { token: 'tok-a', expiresAt: Date.now() + 3_600_000 };
    assert.equal(cache.set(baseKey, entry), true);
    assert.equal(cache.set(blindKey, entry), true);
    assert.ok(cache.inner.get(baseKey), 'precondition: base key holds');
    assert.ok(cache.inner.get(blindKey), 'precondition: owner-blind key holds');

    evictWorkspaceTokenPair((key) => cache.evict(key), 'acme', 'acct');

    assert.deepEqual([...cache.evicts].sort(), [baseKey, blindKey].sort(), 'both the owner-scoped and owner-blind keys are evicted');
    for (const key of [baseKey, blindKey, `${baseKey}::github`, `${blindKey}::repoB`]) {
      assert.equal(cache.inner.get(key), undefined, `key ${key} must miss after eviction`);
    }
    assert.equal(cache.set(baseKey, entry), false, 'the tombstone refuses a post-evict write');
  });

  test('(iii) a repoB selector resolution is served repoB, never from the warm repoA entry', async () => {
    const { fn, cache } = resolverWithHoldingCache();
    await fn('acme', 'acct', { intent: 'WORKSPACE' }); // warm the repoA base entry
    cache.gets.length = 0;
    cache.sets.length = 0;

    const out = await fn('acme', 'acct', { intent: 'ISSUE', selector: { source: 'github', bindingScope: REPO_B } });

    assert.deepEqual(out.scope, { token: 'tok-a', repo: REPO_B }, 'the selector resolution asks repoB');
    assert.deepEqual(cache.gets, [], 'the selector resolution never reads the (repoA) cache entry');
    assert.deepEqual(cache.sets, [], 'the selector resolution never writes');
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
// (F2/M12) two-connection filter — the selected binding's OWN Connection credential
//
// Review M12: dropping `connections.filter(c => c._id === targetBinding.connectionId)`
// survived every test. On a workspace with bindings on two DIFFERENT
// Connections, selecting the binding on Y must serve Y's credential. The filter
// is load-bearing: without it `selectBestConnection` picks by expiry (X here),
// pairing X's token with Y's repo.
// ---------------------------------------------------------------------------

describe('(F2/M12) a selector on the second Connection uses that Connection\'s credential, never the other', () => {
  const X = 'acct::github::instX';
  const Y = 'acct::github::instY';

  function twoConnectionAccess() {
    return createConnectionAccess({
      connectionStore: {
        readConnectionsByReferent: async () => [
          { _id: X, accountId: 'acct', provider: 'github', unitId: 'instX', credentials: { token: 'tok-x', installationId: 'instX', tokenExpiresAt: Date.now() + 7_200_000 }, referents: [] },
          { _id: Y, accountId: 'acct', provider: 'github', unitId: 'instY', credentials: { token: 'tok-y', installationId: 'instY', tokenExpiresAt: Date.now() + 3_600_000 }, referents: [] },
        ],
      },
      ownerCredentialStore: { getByConnection: async () => null },
      refreshConnection: async () => null,
      resolveCanonicalAccountId: async (id) => id,
      selectOwnerSessionRow: () => ({
        session: {
          workspaces: [{
            urlKey: 'acme',
            provider: 'github',
            bindings: [
              { provider: 'github', scope: REPO_A, connectionId: X },
              { provider: 'github', scope: REPO_B, connectionId: Y },
            ],
            activeBinding: { provider: 'github', scope: REPO_A },
          }],
        },
        workspaceIndex: 0,
      }),
      normalizeProvider: (ws) => ws?.provider || 'linear',
      fingerprintCredential,
      gate: { shouldAttempt: () => true },
      lifecycleEventStore: { recordEvent: async () => {} },
      bufferMs: BUFFER,
    });
  }

  test('ISSUE + repoB selects Y and pairs repoB with tok-y, never the later-expiring tok-x', async () => {
    const out = await twoConnectionAccess().resolveConnectionBackedAccess({
      urlKey: 'acme', ownerAccountId: 'acct', sessions: [], intent: 'ISSUE',
      selector: { source: 'github', bindingScope: REPO_B },
    });
    assert.deepEqual(out.result.scope, { token: 'tok-y', repo: REPO_B });
    assert.equal(out.result.token, 'tok-y');
  });

  test('ISSUE + repoA selects X and pairs repoA with tok-x', async () => {
    const out = await twoConnectionAccess().resolveConnectionBackedAccess({
      urlKey: 'acme', ownerAccountId: 'acct', sessions: [], intent: 'ISSUE',
      selector: { source: 'github', bindingScope: REPO_A },
    });
    assert.deepEqual(out.result.scope, { token: 'tok-x', repo: REPO_A });
  });
});

// ---------------------------------------------------------------------------
// (F2/M5) seam-level undeclared-intent guard — routes/proxy.js normalizeBindingIntent
//
// Review M5: `normalizeBindingIntent` defaulting to WORKSPACE instead of ISSUE
// survived every test. This runs the REAL `normalizeBindingIntent`,
// `resolveProviderAccess` and `workspaceUnavailable` bodies (vm, the same
// technique as the server.js resolveBody harness) with no intent / an
// unrecognised one on a two-binding workspace, and asserts the seam classifies
// it as ISSUE -> binding_required -> the 422 envelope with zero provider client
// calls. Under the M5 default it would instead resolve the default binding
// (repoA) and leak through.
// ---------------------------------------------------------------------------

describe('(F2/M5) undeclared intent fails closed as ISSUE at the seam, 422 with zero client calls', () => {
  /** Blank out comments and string/template bodies, preserving offsets, so braces/parens can be counted. */
  function maskNonCode(src) {
    const out = src.split('');
    let mode = null;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      const next = src[i + 1];
      if (mode === 'line') { if (ch === '\n') mode = null; else out[i] = ' '; continue; }
      if (mode === 'block') { out[i] = ' '; if (ch === '*' && next === '/') { out[i + 1] = ' '; mode = null; i++; } continue; }
      if (mode) {
        out[i] = ' ';
        if (ch === '\\') { out[i + 1] = ' '; i++; continue; }
        if ((mode === 'single' && ch === "'") || (mode === 'double' && ch === '"') || (mode === 'template' && ch === '`')) mode = null;
        continue;
      }
      if (ch === '/' && next === '/') { out[i] = ' '; mode = 'line'; continue; }
      if (ch === '/' && next === '*') { out[i] = ' '; mode = 'block'; continue; }
      if (ch === "'") { out[i] = ' '; mode = 'single'; continue; }
      if (ch === '"') { out[i] = ' '; mode = 'double'; continue; }
      if (ch === '`') { out[i] = ' '; mode = 'template'; continue; }
    }
    return out.join('');
  }

  function extractFunctionSource(src, signature) {
    const start = src.indexOf(signature);
    assert.ok(start >= 0, `${signature} not found in routes/proxy.js`);
    const masked = maskNonCode(src);
    // Scan the parameter list, then brace-match the body (the signature may
    // destructure, e.g. `(urlKey, owner, req, { intent, selector } = {})`).
    let i = masked.indexOf('(', start);
    let paren = 0;
    for (; i < masked.length; i++) {
      if (masked[i] === '(') paren++;
      else if (masked[i] === ')') { paren--; if (paren === 0) { i++; break; } }
    }
    i = masked.indexOf('{', i);
    let depth = 0;
    for (; i < masked.length; i++) {
      if (masked[i] === '{') depth++;
      else if (masked[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error(`unbalanced braces for ${signature}`);
  }

  function makeSeam() {
    const resolverCalls = [];
    const clientCalls = [];
    const resolutionRecords = [];
    const provider = {
      name: 'github',
      ui: { displayName: 'GitHub' },
      issueDetail: async (...args) => { clientCalls.push({ method: 'issueDetail', args }); return null; },
    };
    const resolveWorkspaceAccess = async (urlKey, ownerAccountId, options) => {
      resolverCalls.push(options);
      if (options.intent === 'ISSUE' && !options.selector) {
        return { token: null, reason: 'binding_required', provider: 'github', bindings: [REPO_A, REPO_B], credentialFingerprint: null };
      }
      return { token: 'tok-a', scope: { token: 'tok-a', repo: REPO_A }, reason: 'ok', provider: 'github', credentialFingerprint: 'fp' };
    };
    const stripped = PROXY_SRC;
    const context = vm.createContext({
      BINDING_INTENT,
      DECLARED_BINDING_INTENTS: new Set(Object.values(BINDING_INTENT)),
      TEST_LOCAL_URL_KEY: 'test-workspace',
      localProvider: { name: 'local', ui: {} },
      issueSelectorFromQuery: () => undefined,
      resolveWorkspaceAccess,
      injectedProvider: null,
      getProviderForWorkspace: () => provider,
      recordCredentialResolution: (...args) => resolutionRecords.push(args),
      bindingRefusalResponse,
      logEvent: () => {},
      workspaceUnavailableEnvelope: () => ({}),
      console: { log() {}, warn() {}, error() {} },
      process: { env: {} },
    });
    const script = [
      extractFunctionSource(stripped, 'function normalizeBindingIntent'),
      extractFunctionSource(stripped, 'function workspaceUnavailable'),
      extractFunctionSource(stripped, 'async function resolveProviderAccess'),
      '({ normalizeBindingIntent, resolveProviderAccess, workspaceUnavailable })',
    ].join('\n');
    const seam = vm.runInContext(script, context);
    return { ...seam, resolverCalls, clientCalls, resolutionRecords };
  }

  function fakeRes() {
    const out = { status: null, body: null };
    return {
      out,
      status(code) { out.status = code; return this; },
      json(body) { out.body = body; return this; },
    };
  }

  for (const [label, options] of [['no intent (undefined)', {}], ['an unrecognised intent', { intent: 'WAT' }]]) {
    test(`${label} on the two-binding workspace -> 422 BINDING_REQUIRED, zero client calls`, async () => {
      const seam = makeSeam();
      const req = { proxyUrlKey: 'acme', proxyCreatedBy: 'acct', query: {} };
      const res = fakeRes();

      const result = await seam.resolveProviderAccess('acme', 'acct', req, options);

      assert.equal(seam.resolverCalls[0].intent, 'ISSUE', 'the seam must default a missing/unrecognised intent to ISSUE');
      assert.equal(result.reason, 'binding_required');
      assert.equal(result.token, null);
      assert.equal(result.provider.name, 'github');

      seam.workspaceUnavailable(req, res, '/api/proxy/me', result.reason);
      assert.equal(res.out.status, 422);
      assert.equal(res.out.body.code, 'BINDING_REQUIRED');
      assert.deepEqual(res.out.body.bindings, [REPO_A, REPO_B]);
      assert.deepEqual(seam.clientCalls, [], 'a refusal must reach no provider client call');
      assert.equal(seam.resolutionRecords[0]?.[2]?.credential, null, 'a refusal records no credential');
    });
  }

  test('a recognised WORKSPACE intent still serves the default binding (control)', async () => {
    const seam = makeSeam();
    const req = { proxyUrlKey: 'acme', proxyCreatedBy: 'acct', query: {} };
    const result = await seam.resolveProviderAccess('acme', 'acct', req, { intent: 'WORKSPACE' });
    assert.equal(result.reason, 'ok');
    assert.deepEqual(result.token, { token: 'tok-a', repo: REPO_A });
    assert.equal(seam.resolverCalls[0].intent, 'WORKSPACE');
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
  const ROUTE_RE = /(?:router|app)\.(get|post|patch|put|delete|all)\(/;
  const FN_RE = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/;

  /** First quoted path (array routes: the first alias) or identifier after the `(`. */
  function firstArgToken(lines, i, rest) {
    let candidate = rest;
    let j = i;
    while (!candidate.trim() && j + 1 < lines.length) { j++; candidate = lines[j]; }
    const quoted = candidate.match(/['"]([^'"]+)['"]/);
    if (quoted) return quoted[1];
    const ident = candidate.trim().match(/^([A-Za-z0-9_$]+)/);
    return ident ? ident[1] : '?';
  }

  /**
   * Each site is keyed by its ENCLOSING route (method + first path) or named
   * helper, plus an occurrence index — not by line number, so the pin survives
   * unrelated edits above it while still distinguishing the two call sites in
   * the `/attachments/:id` route and the `applyDescriptionEdit` helper.
   */
  function callSites() {
    const sites = [];
    for (const file of FILES) {
      const src = stripSrcComments(readFileSync(join(__dirname, '../../routes', file), 'utf8'));
      const lines = src.split('\n');
      let context = null;
      const counts = new Map();
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const routeMatch = line.match(ROUTE_RE);
        if (routeMatch) {
          const at = line.indexOf(routeMatch[0]) + routeMatch[0].length;
          context = `${routeMatch[1].toUpperCase()} ${firstArgToken(lines, i, line.slice(at))}`;
          continue;
        }
        const fnMatch = line.match(FN_RE);
        if (fnMatch) { context = `fn:${fnMatch[1]}`; continue; }
        if (line.includes('resolveProviderAccess(') && !line.includes('function resolveProviderAccess')) {
          const n = (counts.get(context) || 0) + 1;
          counts.set(context, n);
          sites.push({ file, line: line.slice(line.indexOf('resolveProviderAccess(')), key: `${file}::${context}#${n}` });
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

  // The plan's call-site table, keyed by (file, enclosing endpoint/helper). A
  // count-only pin cannot catch a count-preserving swap of two sites' intents
  // (review M8c: PATCH issue ISSUE->WORKSPACE AND attachments WORKSPACE->ISSUE);
  // this explicit table does, because each key's intent is checked individually.
  // `CONDITIONAL` is the one dispatch site whose intent is `issueIdentifier ?`.
  const EXPECTED_INTENTS = {
    'proxy-reads.js::GET /api/proxy/me#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/teams#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/projects#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/known-repos#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/issues#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/issues/:issueId#1': 'ISSUE',
    'proxy-reads.js::GET /api/proxy/search#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/states/:teamId#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/labels#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/cycles#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/cycles/:cycleId#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/issues/:issueId/relations#1': 'ISSUE',
    'proxy-reads.js::GET /api/proxy/attachments/:id#1': 'WORKSPACE',
    'proxy-reads.js::GET /api/proxy/attachments/:id#2': 'WORKSPACE',
    'proxy-writes.js::POST /api/proxy/issues#1': 'CREATE',
    'proxy-writes.js::PATCH /api/proxy/issues/:issueId#1': 'ISSUE',
    'proxy-writes.js::fn:applyDescriptionEdit#1': 'ISSUE',
    'proxy-writes.js::POST /api/proxy/issues/:issueId/comments#1': 'ISSUE',
    'proxy-writes.js::DELETE /api/proxy/issues/:issueId/comments/:commentId#1': 'ISSUE',
    'proxy-writes.js::PATCH /api/proxy/issues/:issueId/comments/:commentId#1': 'ISSUE',
    'proxy-writes.js::POST /api/proxy/issues/:issueId/attachments#1': 'ISSUE',
    'proxy-writes.js::POST /api/proxy/issues/:issueId/relations#1': 'ISSUE',
    'proxy-writes.js::DELETE /api/proxy/issues/:issueId/relations/:relationId#1': 'ISSUE',
    'proxy-writes.js::POST /api/proxy/issues/:issueId/labels#1': 'ISSUE',
    'proxy-writes.js::DELETE /api/proxy/issues/:issueId/labels/:labelId#1': 'ISSUE',
    'proxy-compute.js::GET /api/proxy/stack#1': 'WORKSPACE',
    'proxy-compute.js::GET /api/proxy/issues/:identifier/prompt/:templateKey#1': 'ISSUE',
    'proxy-compute.js::GET /api/proxy/issues/:identifier/recommend#1': 'ISSUE',
    'proxy-compute.js::GET /api/proxy/issues/:identifier/recap#1': 'ISSUE',
    'proxy-compute.js::POST /api/proxy/recap/:identifier#1': 'ISSUE',
    'proxy-compute.js::GET /api/proxy/issues/:identifier/brief#1': 'ISSUE',
    'proxy-compute.js::POST /api/proxy/brief/:identifier#1': 'ISSUE',
    'proxy-dispatch.js::POST /api/proxy/dispatch#1': 'CONDITIONAL',
    'proxy-dispatch.js::POST /api/proxy/recommend-and-dispatch#1': 'ISSUE',
    'proxy-kickoff.js::POST /api/proxy/autopilot/kickoff#1': 'ISSUE',
    'proxy-flight-companion.js::POST ENDPOINT#1': 'WORKSPACE',
    'proxy.js::GET /api/proxy/instructions#1': 'WORKSPACE',
  };

  test('every site\'s (file, endpoint) maps to the plan table intent', () => {
    const actual = {};
    for (const { key, line } of sites) {
      if (line.includes('issueIdentifier ?')) { actual[key] = 'CONDITIONAL'; continue; }
      actual[key] = (line.match(/BINDING_INTENT\.(ISSUE|CREATE|WORKSPACE)/) || [])[1];
    }
    assert.deepEqual(actual, EXPECTED_INTENTS, 'per-(file, endpoint) intents must match the plan call-site table');
  });
});

// ---------------------------------------------------------------------------
// Workspace-level no-selector HTTP matrix (the plan's 15 WORKSPACE sites)
// ---------------------------------------------------------------------------

function permissiveGitHubProvider() {
  return {
    name: 'github',
    supports: () => true,
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
    // The `att:` attachments branch resolves the seam, then (with no formal
    // attachment) 404s — a reachable seam call with no egress.
    fetchAttachment: async () => null,
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
    // `/attachments/:id` (`proxy-reads.js:610`/`:693`) — the `att:` branch
    // (site :610) resolves the seam, then 404s because the fake provider has no
    // formal attachment. Its "normal status" here is 404.
    //
    // The `md:` branch (site :693) is deliberately NOT driven: after the seam it
    // proceeds to a REAL egress fetch of the relayed bytes (`customFetch` /
    // `createProxyFetch()`), which the off-network hermetic harness forbids (and
    // the hermetic:proxy arm would route through the configured proxy endpoint).
    // Its seam call is nonetheless pinned as WORKSPACE by the census table, and
    // it shares the exact same intent/selector logic as the driven `att:` path.
    ['GET', `/api/proxy/attachments/${encodeURIComponent(encodeAttachmentHandle('att', 'a1'))}`, 404],
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

// ---------------------------------------------------------------------------
// Inverse row — every ISSUE-intent site (all 21), driven end to end
//
// Plan §5: with no selector on the two-binding workspace each ISSUE site must
// refuse 422 BINDING_REQUIRED with zero client calls; with `source`+`bindingScope`
// = repoB it must ask repoB. Keyed by the SAME (file, endpoint) descriptors as
// the census table above, so a new ISSUE site without a row fails loudly here.
// ---------------------------------------------------------------------------

/** A permissive GitHub provider that RECORDS every method call, so a refusal's zero-client-call property is checkable. */
function recordingGitHubProvider(clientCalls) {
  const base = { ui: { displayName: 'GitHub', name: 'github' }, ...permissiveGitHubProvider() };
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop in target) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          return (...args) => { clientCalls.push({ method: prop, args }); return value.apply(target, args); };
        }
        return value;
      }
      if (typeof prop === 'string') {
        return (...args) => { clientCalls.push({ method: prop, args }); return Promise.resolve(null); };
      }
      return undefined;
    },
  });
}

function buildIssueMatrixApp() {
  const recorded = [];
  const clientCalls = [];
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
    dispatchQueueStore: { getGrantDeclaration: async () => ({ state: 'none' }), addItem: async () => ({ _id: 'd' }) },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: recordingGitHubProvider(clientCalls),
  }));
  return { app, recorded, clientCalls };
}

describe('LIN-3241 inverse row — every ISSUE-intent site refuses without a selector and honours repoB with one', () => {
  // One row per ISSUE-intent census key. `applyDescriptionEdit` is one site
  // reached by two routes; it is driven through `/description/append`.
  const ROWS = [
    ['proxy-reads.js::GET /api/proxy/issues/:issueId#1', 'GET', '/api/proxy/issues/1'],
    ['proxy-reads.js::GET /api/proxy/issues/:issueId/relations#1', 'GET', '/api/proxy/issues/1/relations'],
    ['proxy-writes.js::PATCH /api/proxy/issues/:issueId#1', 'PATCH', '/api/proxy/issues/1', { title: 'x' }],
    ['proxy-writes.js::fn:applyDescriptionEdit#1', 'POST', '/api/proxy/issues/1/description/append', { block: 'x' }],
    ['proxy-writes.js::POST /api/proxy/issues/:issueId/comments#1', 'POST', '/api/proxy/issues/1/comments', { body: 'x' }],
    ['proxy-writes.js::DELETE /api/proxy/issues/:issueId/comments/:commentId#1', 'DELETE', '/api/proxy/issues/1/comments/c1'],
    ['proxy-writes.js::PATCH /api/proxy/issues/:issueId/comments/:commentId#1', 'PATCH', '/api/proxy/issues/1/comments/c1', { body: 'x' }],
    ['proxy-writes.js::POST /api/proxy/issues/:issueId/attachments#1', 'POST', '/api/proxy/issues/1/attachments', { image: 'x' }],
    ['proxy-writes.js::POST /api/proxy/issues/:issueId/relations#1', 'POST', '/api/proxy/issues/1/relations', { relatedIssueId: '2' }],
    ['proxy-writes.js::DELETE /api/proxy/issues/:issueId/relations/:relationId#1', 'DELETE', '/api/proxy/issues/1/relations/r1'],
    ['proxy-writes.js::POST /api/proxy/issues/:issueId/labels#1', 'POST', '/api/proxy/issues/1/labels', { labelId: 'l1' }],
    ['proxy-writes.js::DELETE /api/proxy/issues/:issueId/labels/:labelId#1', 'DELETE', '/api/proxy/issues/1/labels/l1'],
    ['proxy-compute.js::GET /api/proxy/issues/:identifier/prompt/:templateKey#1', 'GET', '/api/proxy/issues/1/prompt/plan'],
    ['proxy-compute.js::GET /api/proxy/issues/:identifier/recommend#1', 'GET', '/api/proxy/issues/1/recommend'],
    ['proxy-compute.js::GET /api/proxy/issues/:identifier/recap#1', 'GET', '/api/proxy/issues/1/recap'],
    ['proxy-compute.js::POST /api/proxy/recap/:identifier#1', 'POST', '/api/proxy/recap/1', {}],
    ['proxy-compute.js::GET /api/proxy/issues/:identifier/brief#1', 'GET', '/api/proxy/issues/1/brief'],
    ['proxy-compute.js::POST /api/proxy/brief/:identifier#1', 'POST', '/api/proxy/brief/1', {}],
    ['proxy-dispatch.js::POST /api/proxy/dispatch#1', 'POST', '/api/proxy/dispatch', { prompt: 'run me', issueIdentifier: 'GB-1' }],
    ['proxy-dispatch.js::POST /api/proxy/recommend-and-dispatch#1', 'POST', '/api/proxy/recommend-and-dispatch', { issueIdentifier: 'GB-1' }],
    ['proxy-kickoff.js::POST /api/proxy/autopilot/kickoff#1', 'POST', '/api/proxy/autopilot/kickoff', { issueIdentifier: 'GB-1' }],
  ];

  test('the row set is exactly the 21 ISSUE-intent census keys', () => {
    const KEYS = new Set(ROWS.map(r => r[0]));
    assert.equal(ROWS.length, 21);
    assert.equal(KEYS.size, 21, 'each ISSUE site has exactly one row');
  });

  for (const [key, method, path, body] of ROWS) {
    test(`${method} ${path} — ${key}`, async () => {
      // No selector: refuse 422 BINDING_REQUIRED with zero client calls.
      const refused = buildIssueMatrixApp();
      const resNone = await callProxy(refused.app, method, path, body);
      assert.equal(resNone.status, 422, `${key}: expected 422, got ${resNone.status} ${JSON.stringify(resNone.body)}`);
      assert.equal(resNone.body?.code, 'BINDING_REQUIRED', `${key}: ${JSON.stringify(resNone.body)}`);
      assert.deepEqual(resNone.body?.bindings, [REPO_A, REPO_B], `${key}`);
      assert.equal(refused.clientCalls.length, 0, `${key}: a refusal must make zero provider client calls`);
      assert.equal(refused.recorded.at(-1)?.options?.intent, 'ISSUE', `${key}: the route must declare the ISSUE intent`);
      assert.equal(refused.recorded.at(-1)?.result?.reason, 'binding_required', `${key}`);

      // Selector repoB: the route resolves the named binding (repoB).
      const selected = buildIssueMatrixApp();
      const query = `?source=github&bindingScope=${encodeURIComponent(REPO_B)}`;
      await callProxy(selected.app, method, path + query, body);
      const resolution = selected.recorded.at(-1);
      assert.equal(resolution?.options?.intent, 'ISSUE', `${key}`);
      assert.equal(resolution?.options?.selector?.bindingScope, REPO_B, `${key}: the query selector must reach the resolver`);
      assert.deepEqual(resolution?.result?.scope, { token: 'tok-a', repo: REPO_B }, `${key}: served with call scope repoB`);
    });
  }
});
