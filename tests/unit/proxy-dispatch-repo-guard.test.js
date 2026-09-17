/**
 * LIN-2886 — repo override validation at the Harbour seam, route-level.
 *
 * Pins the ticket's own "Done when" criteria against the real HTTP routes
 * (not just the pure lib/dispatch-repo-guard.js unit tests):
 *   - a dispatch with an unknown repo gets 422 with the known list, and
 *     NO item is queued (mirrors LIN-1948's referent-guard test discipline —
 *     a 422 with a row still written would be a silent regression invisible
 *     in the response body);
 *   - a URL form of a known repo is accepted and stored as the basename;
 *   - the fail-open cases get equal billing: no provider/capability/a
 *     throwing fetch must never turn into a dispatch outage.
 *
 * Covers both enqueue seams the ticket names: POST /api/proxy/dispatch and
 * POST /api/proxy/recommend-and-dispatch (verb-override branch, which is
 * deterministic and needs no LLM/OpenRouter mock).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { UNKNOWN_REPO_CODE } from '../../lib/dispatch-repo-guard.js';

// `token === 'test-token'` (set below) drives the route's own isTestMode
// short-circuit — issue/project context for `recommend-and-dispatch` comes
// from tests/fixtures/mock-data.js's TEST-1 fixture, never from this fake
// provider. The fake provider only needs to serve `fetchProjects` (LIN-2886's
// own repo-inventory read) and `supports`.
function fakeProvider({ projects = [], supportsFetchProjects = true, throws = false } = {}) {
  return {
    name: 'linear',
    supports: (method) => (method === 'fetchProjects' ? supportsFetchProjects : true),
    fetchProjects: async () => {
      if (throws) throw new Error('provider outage');
      return { projects };
    }
  };
}

function buildApp(captured, { provider } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    provider,
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.calls = (captured.calls || 0) + 1;
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-09-17T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-2886 — POST /api/proxy/dispatch repo validation', () => {
  test('an unknown repo is refused 422 with the known list, and NO item is queued', async () => {
    const captured = {};
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }, { content: 'repo=simple-dispatcher' }] });
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'do the thing', repo: 'some-typo' });

    assert.equal(res.status, 422);
    assert.equal(res.body.code, UNKNOWN_REPO_CODE);
    assert.deepEqual(res.body.knownRepos.sort(), ['LinearViewer', 'simple-dispatcher']);
    assert.equal(captured.calls, undefined, 'addItem must never be called on a refusal');
  });

  test('a known basename is accepted verbatim', async () => {
    const captured = {};
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }] });
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'do the thing', repo: 'LinearViewer' });

    assert.equal(res.status, 201);
    assert.equal(captured.item.repo, 'LinearViewer');
  });

  test('a URL form of a known repo is accepted and stored as the basename', async () => {
    const captured = {};
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }] });
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing',
      repo: 'https://github.com/JKershaw/LinearViewer.git'
    });

    assert.equal(res.status, 201);
    assert.equal(captured.item.repo, 'LinearViewer');
  });

  test('no repo supplied: unaffected, no fetchProjects call at all', async () => {
    const captured = {};
    let fetchProjectsCalls = 0;
    const provider = fakeProvider({ projects: [] });
    const realFetchProjects = provider.fetchProjects;
    provider.fetchProjects = async (...args) => { fetchProjectsCalls++; return realFetchProjects(...args); };
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'do the thing' });

    assert.equal(res.status, 201);
    assert.equal(captured.item.repo, null);
    assert.equal(fetchProjectsCalls, 0, 'validation must not run when no repo was supplied');
  });

  test('FAIL-OPEN: provider does not support fetchProjects — the dispatch still succeeds, repo forwarded unvalidated', async () => {
    const captured = {};
    const provider = fakeProvider({ supportsFetchProjects: false });
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'do the thing', repo: 'whatever-value' });

    assert.equal(res.status, 201);
    assert.equal(captured.item.repo, 'whatever-value', 'unvalidated repo is forwarded verbatim, never rejected');
  });

  test('FAIL-OPEN: fetchProjects throws — the dispatch still succeeds, repo forwarded unvalidated', async () => {
    const captured = {};
    const provider = fakeProvider({ throws: true });
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'do the thing', repo: 'whatever-value' });

    assert.equal(res.status, 201);
    assert.equal(captured.item.repo, 'whatever-value');
  });

  test('an abort is never blocked by repo validation, even with a bogus repo', async () => {
    const captured = {};
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }] });
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      abort: true, abortTo: '123e4567-e89b-12d3-a456-426614174000', repo: 'not-a-real-repo'
    });
    assert.notEqual(res.status, 422);
  });
});

describe('LIN-2886 — POST /api/proxy/recommend-and-dispatch repo validation (verb-override branch)', () => {
  test('an unknown repo is refused 422 with the known list, and NO item is queued', async () => {
    const captured = {};
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }] });
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'review', repo: 'some-typo'
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.code, UNKNOWN_REPO_CODE);
    assert.deepEqual(res.body.knownRepos, ['LinearViewer']);
    assert.equal(captured.calls, undefined, 'addItem must never be called on a refusal');
  });

  test('a URL form of a known repo is accepted and stored as the basename', async () => {
    const captured = {};
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }] });
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'review', repo: 'JKershaw/LinearViewer'
    });

    assert.equal(res.status, 201);
    assert.equal(captured.item.repo, 'LinearViewer');
  });

  test('FAIL-OPEN: fetchProjects throws — the dispatch still succeeds, repo forwarded unvalidated', async () => {
    const captured = {};
    const provider = fakeProvider({ throws: true });
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'review', repo: 'whatever-value'
    });

    assert.equal(res.status, 201);
    assert.equal(captured.item.repo, 'whatever-value');
  });
});
