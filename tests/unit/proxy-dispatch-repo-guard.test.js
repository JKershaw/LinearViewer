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

// Deliberately NOT 'test-token': the routes' own `isTestMode` sentinel
// (`process.env.NODE_ENV === 'test' && accessToken === 'test-token'`) makes
// LIN-2886's repo-validation call skip its provider entirely (LIN-1880's
// hermetic no-live-network CI guard — a real `provider.fetchProjectsList` call
// under the shared `test-token` scope would reach the live Linear API from
// every OTHER pre-existing test that dispatches with a `repo`). These tests
// exist specifically to exercise that validation, so they use a distinct
// scope precisely to opt OUT of the isTestMode short-circuit — meaning the
// route resolves issue/project context via THIS fake provider's own
// `fetchIssueContext`, never the tests/fixtures/mock-data.js TEST-1 fixture.
const REPO_GUARD_TEST_SCOPE = 'repo-guard-test-scope';

function fakeProvider({ projects = [], supportsFetchProjects = true, throws = false } = {}) {
  return {
    name: 'linear',
    supports: (method) => (method === 'fetchProjectsList' ? supportsFetchProjects : true),
    fetchProjectsList: async () => {
      if (throws) throw new Error('provider outage');
      return projects;
    },
    // Only reached by the recommend-and-dispatch verb-override branch, since
    // isTestMode is false for this scope — a minimal happy-path issue context.
    fetchIssueContext: async () => ({
      issue: { identifier: 'LIN-9', title: 'Test issue', description: '', state: { type: 'started' } },
      parent: null, siblings: [], project: { description: 'repo=LinearViewer' }, children: [], comments: [], attachments: []
    })
  };
}

function buildApp(captured, { provider, token = REPO_GUARD_TEST_SCOPE } = {}) {
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
    resolveWorkspaceAccess: async () => ({ token, reason: 'ok' }),
    getWorkspaceAccessToken: async () => token,
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

  test('no repo supplied: unaffected, no fetchProjectsList call at all', async () => {
    const captured = {};
    let fetchProjectsListCalls = 0;
    const provider = fakeProvider({ projects: [] });
    const realFetchProjectsList = provider.fetchProjectsList;
    provider.fetchProjectsList = async (...args) => { fetchProjectsListCalls++; return realFetchProjectsList(...args); };
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'do the thing' });

    assert.equal(res.status, 201);
    assert.equal(captured.item.repo, null);
    assert.equal(fetchProjectsListCalls, 0, 'validation must not run when no repo was supplied');
  });

  test('FAIL-OPEN: provider does not support fetchProjectsList — the dispatch still succeeds, repo forwarded unvalidated', async () => {
    const captured = {};
    const provider = fakeProvider({ supportsFetchProjects: false });
    const app = buildApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'do the thing', repo: 'whatever-value' });

    assert.equal(res.status, 201);
    assert.equal(captured.item.repo, 'whatever-value', 'unvalidated repo is forwarded verbatim, never rejected');
  });

  test('FAIL-OPEN: fetchProjectsList throws — the dispatch still succeeds, repo forwarded unvalidated', async () => {
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
  // Real refuse/accept behavior for this exact `validateDispatchRepo` call is
  // already pinned exhaustively by the pure lib tests (dispatch-repo-guard.test.js)
  // and by the identical wiring pattern's route-level tests above on plain
  // POST /api/proxy/dispatch. Route-testing it AGAIN here would require driving
  // this branch's `resolvePromptIssueContext` in LIVE (non-isTestMode) mode,
  // which triggers an unrelated PRE-EXISTING timer leak in routes/proxy.js's
  // own `withTimeout` (GRAPHQL_TIMEOUT_MS = 25s, never cleared on the winning
  // race branch) and adds a genuine ~25s tax to this file for no new coverage.
  // Out of scope to fix here — this suite deliberately never exercises that
  // live path. What IS unique to this route is the hermetic-safety behavior
  // below.

  // LIN-1880 hermetic guard, this route's own angle: under the app's
  // `isTestMode` sentinel (accessToken === 'test-token'), the repo-validation
  // call site passes `provider: null` (see routes/proxy-dispatch.js), so a
  // repo is forwarded UNVALIDATED and the injected provider's `fetchProjectsList`
  // is never invoked — proving this route doesn't reach real network under
  // test-mode dispatches, the exact class of regression that broke CI once
  // already in this ticket's own history. Deliberately the ONLY test on this
  // route that drives `resolvePromptIssueContext`'s fast isTestMode path
  // (the built-in TEST-1 fixture, tests/fixtures/mock-data.js) — the live
  // (non-isTestMode) path is exercised by the refuse case above and by the
  // identical `validateDispatchRepo` wiring already proven on plain
  // POST /api/proxy/dispatch, so this suite doesn't pay for a second slow
  // live-mode issue-context round trip through a route-level test here.
  test('isTestMode: repo is forwarded unvalidated, fetchProjectsList never called', async () => {
    const captured = {};
    let fetchProjectsListCalls = 0;
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }] });
    const realFetchProjectsList = provider.fetchProjectsList;
    provider.fetchProjectsList = async (...args) => { fetchProjectsListCalls++; return realFetchProjectsList(...args); };
    const app = buildApp(captured, { provider, token: 'test-token' });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'review', repo: 'not-a-known-repo-at-all'
    });

    assert.equal(res.status, 201);
    assert.equal(captured.item.repo, 'not-a-known-repo-at-all');
    assert.equal(fetchProjectsListCalls, 0, 'validation must not touch the provider under isTestMode');
  });
});
