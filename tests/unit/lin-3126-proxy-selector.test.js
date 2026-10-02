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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
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
    const guardedSetLines = body.split('\n').filter(l => l.includes('if (!bypassTokenCache) workspaceTokenCache.set(cacheKey'));
    assert.ok(setLines.length > 0, 'expected cache writes inside resolveWorkspaceAccess');
    assert.equal(
      guardedSetLines.length,
      setLines.length,
      'every cache write must be guarded by `if (!bypassTokenCache)`: an ISSUE/selector resolution must perform no get and no set'
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
    return { status: res.status, body: await res.json() };
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

