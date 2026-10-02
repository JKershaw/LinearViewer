/**
 * LIN-3240 (LIN-3126 slice 1) — acceptance witness, assertion (a): drill-down.
 *
 * Seed: one connection with a workspace bound to TWO repos on it — repoA
 * (active) and repoB (non-active), both connection-backed, each with an issue
 * whose id is the same GitHub NUMBER (`1`), so the id-spaces collide.
 *
 * Assert: `GET /workspace/:urlKey/api/detail/:issueId?source=github&bindingScope=repoB`
 * renders repoB's fields, the recording fake client saw ONLY `{repo: repoB}`,
 * and repoA was never queried.
 *
 * Fails before (recorded run at 5e70882a, pre-beat-4): the route called
 * `resolveIssueBinding(workspace, source)` — provider-name only — which on a
 * same-provider pair returned the ACTIVE binding (repoA) via active-preference/
 * `matches[0]`, so the request asked repoA for issue `1` and rendered repoA's
 * fields (or 404'd), never repoB's. The selector/`bindingScope` param was also
 * unknown to the route, so it was dropped.
 *
 * Slice-2 `describe` below — acceptance witness, assertion (b): the PROXY issue
 * read. Fails before (the slice-2 seam, reproduced by making
 * `routes/proxy.js` `issueSelectorFromQuery` return `undefined` — i.e. with no
 * query-selector input path):
 *     AssertionError [ERR_ASSERTION]: {"code":"BINDING_REQUIRED","provider":"github","bindings":["octo/repoA","octo/repoB"]}
 *     actual: 422
 *     expected: 200
 *   Without the selector input path the repoB request cannot reach the
 *   resolver's selector and is refused; the no-selector assertion already
 *   expects 422, so it stays green. (The earlier arm characterization in
 *   `lin-3126-proxy-selector.test.js` records the pre-slice-2 served-scope fail
 *   as `{token:'tok-a', repo:'99'}` instead of `repo:'octo/repoA'`.)
 *
 * Slice-3 `describe`s below — assertion (c) the dispatch referent, and the
 * effort-read-out half of assertion (a). Fails before (recorded 2026-10-02,
 * `routes/dashboard.js` + `lib/dispatch-store.js` stashed to pre-beat-3):
 *   - stamped effort row: the unfixed read resolved the workspace's active
 *     binding (which refuses on a two-binding workspace), so the provider was
 *     never called:
 *       AssertionError [ERR_ASSERTION]: the provider saw only repoB
 *       + actual - expected
 *       + []
 *       - [ 'octo/repoB' ]
 *   - unstamped effort row: the unfixed read counted 0 skips instead of disclosing:
 *       0 !== 1
 *   The stamped key whose binding no longer resolves likewise failed (skipped 0).
 *
 * Run with: node --test tests/unit/lin-3126-acceptance-witness.test.js
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  REPO_A, REPO_B, installGitHubProvider, makeTwoRepoWorkspace, makeSingleRepoWorkspace, buildWorkspaceApiApp, withServer,
} from './lin-3126-harness.js';
import { makeTwoRepoResolver, buildProxyApp, callProxy, issueDetailProvider } from './lin-3126-proxy-harness.js';
import { setBindingCredential } from '../../lib/connection-binding.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

before(() => { process.env.NODE_ENV = 'test'; });

const ISSUE_A = { id: '1', identifier: 'GA-1', title: 'Repo A issue', description: 'REPO_A_MARKER', state: { name: 'Todo', type: 'unstarted' } };
const ISSUE_B = { id: '1', identifier: 'GB-1', title: 'Repo B issue', description: 'REPO_B_MARKER', state: { name: 'Todo', type: 'unstarted' } };

describe('LIN-3240 acceptance witness (a) — drill-down honours the issue\'s own binding', () => {
  test('selecting repoB renders repoB\'s fields and only ever queries repoB', async () => {
    const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const workspace = makeTwoRepoWorkspace();
    const app = buildWorkspaceApiApp({ workspace });

    const { status, body } = await withServer(app, ({ get }) =>
      get(`/workspace/acme/api/detail/1?source=github&bindingScope=${encodeURIComponent(REPO_B)}`));

    assert.equal(status, 200);
    assert.ok(body.html.includes(ISSUE_B.description), 'repoB\'s fields are rendered');

    const fetches = calls.filter(c => c.method === 'fetchIssueFields');
    assert.deepEqual(fetches.map(c => c.scope.repo), [REPO_B], 'the fake client saw only repoB');
    assert.ok(!calls.some(c => c.scope && c.scope.repo === REPO_A), 'repoA was never queried');
  });

  test('without a selector, the ambiguous two-repo workspace fails closed (422 BINDING_REQUIRED), zero provider calls', async () => {
    const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const workspace = makeTwoRepoWorkspace();
    const app = buildWorkspaceApiApp({ workspace });

    const { status, body } = await withServer(app, ({ get }) => get('/workspace/acme/api/detail/1'));

    assert.equal(status, 422);
    assert.equal(body.code, 'BINDING_REQUIRED');
    assert.deepEqual(body.bindings, [REPO_A, REPO_B]);
    assert.equal(calls.filter(c => c.method === 'fetchIssueFields').length, 0);
  });
});

describe('LIN-3240 review F1 — the /api/detail fragment keeps the validated bindingScope', () => {
  /** One connection-backed binding on repoA (single-binding workspace). */
  function makeSingleRepoWorkspace() {
    const binding = { provider: 'github', scope: REPO_A, connectionId: 'conn-1' };
    setBindingCredential(binding, { installationId: '99', token: 'tok-a' });
    return {
      urlKey: 'acme',
      provider: 'github',
      bindings: [binding],
      activeBinding: { provider: 'github', scope: REPO_A },
    };
  }

  test('a validated bindingScope rides onto the rendered issue: data-binding-scope attrs and the edit/chat hrefs', async () => {
    installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const workspace = makeTwoRepoWorkspace();
    const app = buildWorkspaceApiApp({ workspace, features: { taskChat: true } });

    const { status, body } = await withServer(app, ({ get }) =>
      get(`/workspace/acme/api/detail/1?source=github&bindingScope=${encodeURIComponent(REPO_B)}`));

    assert.equal(status, 200);
    assert.ok(body.html.includes(ISSUE_B.description), 'repoB\'s fields are rendered');
    assert.match(body.html, /data-binding-scope="octo\/repoB"/, 'the rendered issue carries its binding scope');
    assert.ok(
      body.html.includes('/workspace/acme/task/1/edit?source=github&amp;bindingScope=octo%2FrepoB'),
      'the Edit href carries the validated bindingScope beside source'
    );
    assert.ok(
      body.html.includes('/workspace/acme/task-chat?task=GB-1&amp;source=github&amp;bindingScope=octo%2FrepoB'),
      'the task-chat href carries the validated bindingScope beside source'
    );
  });

  test('an unstamped (single-binding) request stays byte-identical: no data-binding-scope, no bindingScope in links', async () => {
    installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const workspace = makeSingleRepoWorkspace();
    const app = buildWorkspaceApiApp({ workspace, features: { taskChat: true } });

    const { status, body } = await withServer(app, ({ get }) => get('/workspace/acme/api/detail/1?source=github'));

    assert.equal(status, 200);
    assert.ok(body.html.includes(ISSUE_A.description), 'repoA\'s fields are rendered');
    assert.ok(!body.html.includes('data-binding-scope'), 'no stamp is emitted when no bindingScope was validated');
    assert.ok(!body.html.includes('bindingScope='), 'links must not gain a bindingScope when none was validated');
    assert.ok(
      body.html.includes('/workspace/acme/task/1/edit?source=github'),
      'the Edit href stays byte-identical to the pre-LIN-3240 source-only form'
    );
  });
});

// ---------------------------------------------------------------------------
// LIN-3241 (LIN-3126 slice 2) acceptance witness, assertion (b): the proxy
// issue read. The plan names THIS file for the slice-2 describe; it drives the
// REAL proxy route over the REAL server.js resolveWorkspaceAccess body + the
// REAL connection-first arm (lin-3126-proxy-harness.js).
// ---------------------------------------------------------------------------

describe('LIN-3241 acceptance witness (b) — proxy issue read honours the issue\'s own binding', () => {
  test('?source=github&bindingScope=repoB asks repoB with call scope {repo:repoB}', async () => {
    const calls = [];
    const { fn } = makeTwoRepoResolver();
    const { app } = buildProxyApp({ resolveWorkspaceAccess: fn, provider: issueDetailProvider(calls) });

    const res = await callProxy(app, 'GET', `/api/proxy/issues/1?source=github&bindingScope=${encodeURIComponent(REPO_B)}`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(calls.map(c => c.repo), [REPO_B], 'the provider saw only repoB');
    assert.equal(calls[0].token, 'tok-a', 'the token is the Connection credential');
  });

  test('without a selector on the two-binding workspace: 422 BINDING_REQUIRED and ZERO provider calls', async () => {
    const calls = [];
    const { fn } = makeTwoRepoResolver();
    const { app } = buildProxyApp({ resolveWorkspaceAccess: fn, provider: issueDetailProvider(calls) });

    const res = await callProxy(app, 'GET', '/api/proxy/issues/1');

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'BINDING_REQUIRED');
    assert.deepEqual(res.body.bindings, [REPO_A, REPO_B]);
    assert.equal(calls.length, 0, 'no provider call on a refusal');
  });
});

// ---------------------------------------------------------------------------
// LIN-3242 (LIN-3126 slice 3) acceptance witness — assertion (c) (the dispatch
// referent) and the effort-read-out half of assertion (a). Same seed as slices
// 1/2: one GitHub Connection, repoA active + repoB non-active. The session and
// proxy lanes must resolve the pair to repoB and persist it; the effort read-out
// must read ONLY repoB for a stamped row and disclose (skip) an unstamped row
// rather than guessing repoA.
// ---------------------------------------------------------------------------

/** A permissive github provider for the proxy dispatch lane. */
function githubDispatchProvider() {
  return {
    name: 'github',
    ui: { displayName: 'GitHub', name: 'github' },
    supports: () => true,
    fetchIssueContext: async (scope, issueId) => ({ issue: { id: issueId, identifier: 'GB-1' } }),
  };
}

function freshStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection(),
  });
}

function buildSessionDispatchApp(workspace, store) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, _res, next) => { req.workspace = workspace; req.session = { linearUserId: 'u1', accountId: 'acct-1' }; next(); },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
  }));
  return app;
}

function buildEffortReadoutApp(workspace, store) {
  const app = express();
  app.use(createDashboardRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = workspace;
      req.session = { workspaces: [{ urlKey: workspace.urlKey, name: 'acme' }], features: {} };
      next();
    },
    dispatchQueueStore: store,
    agentStatusStore: {},
    runSummaryCacheStore: {},
    sessionSummaryCacheStore: {},
    freeTierStore: {},
    getWorkspaceAccessToken: () => 'tok-a',
    fetchIssueContext: async () => ({}),
    fetchWorkspaceIssues: async () => [],
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
  }));
  return app;
}

/** An ELIGIBLE history row (taken + terminal '[done]' feedback). */
function doneHistoryRow({ id, issueIdentifier, issueSource, issueBindingScope }) {
  const completedAt = '2026-09-01T00:30:00.000Z';
  return {
    _id: id, urlKey: 'acme', issueIdentifier, kind: 'plan', status: 'taken',
    dispatchedAt: new Date('2026-09-01T00:00:00.000Z'), resolvedAt: new Date(completedAt),
    feedback: [{ message: '[done] complete', timestamp: completedAt }],
    ...(issueSource != null ? { issueSource } : {}),
    ...(issueBindingScope != null ? { issueBindingScope } : {}),
  };
}

describe('LIN-3242 acceptance witness (c) — the dispatch referent honours the row binding', () => {
  test('session lane: POST /api/dispatch with the pair stores it on the row', async () => {
    installGitHubProvider();
    const workspace = makeTwoRepoWorkspace();
    const store = freshStore();
    const app = buildSessionDispatchApp(workspace, store);

    const { status } = await withServer(app, ({ post }) => post('/workspace/acme/api/dispatch', {
      prompt: 'run me', promptName: 'implementation', issueIdentifier: 'GB-1',
      issueSource: 'github', issueBindingScope: REPO_B,
    }));

    assert.equal(status, 201);
    const doc = store.collection._docs[0];
    assert.equal(doc.issueSource, 'github', 'the stored row carries issueSource');
    assert.equal(doc.issueBindingScope, REPO_B, 'the stored row carries issueBindingScope');
  });

  test('proxy lane: POST /api/proxy/dispatch with the pair resolves repoB and stores it', async () => {
    const { fn } = makeTwoRepoResolver();
    const seen = [];
    const resolveWorkspaceAccess = async (urlKey, ownerAccountId, opts) => {
      const out = await fn(urlKey, ownerAccountId, opts);
      seen.push(out);
      return out;
    };
    const { app, captured } = buildProxyApp({ resolveWorkspaceAccess, provider: githubDispatchProvider() });

    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', {
      prompt: 'run me', issueIdentifier: 'GB-1', issueSource: 'github', issueBindingScope: REPO_B,
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(seen[0].scope, { token: 'tok-a', repo: REPO_B }, 'the seam resolved the named binding repoB');
    assert.equal(captured.item.issueSource, 'github');
    assert.equal(captured.item.issueBindingScope, REPO_B);
  });
});

describe('LIN-3242 acceptance witness (a) — the effort read-out honours the row binding', () => {
  // The effort read-out passes the row's `issueIdentifier` to the provider, so
  // the fake issues' `id`s are the identifiers here (unlike the drill-down lane,
  // which passes the URL issue id).
  const ISSUES = {
    [REPO_A]: { id: 'GA-1', identifier: 'GA-1', description: 'REPO_A_MARKER' },
    [REPO_B]: { id: 'GB-1', identifier: 'GB-1', description: 'REPO_B_MARKER' },
  };

  test('a stamped row reads ONLY repoB and is not skipped', async () => {
    const { calls } = installGitHubProvider({ repoIssues: ISSUES });
    const workspace = makeTwoRepoWorkspace();
    const store = freshStore();
    store.historyCollection._docs.push(doneHistoryRow({
      id: 'rB', issueIdentifier: 'GB-1', issueSource: 'github', issueBindingScope: REPO_B,
    }));
    const app = buildEffortReadoutApp(workspace, store);

    const { status, body } = await withServer(app, ({ get }) => get('/workspace/acme/api/effort-readout'));

    assert.equal(status, 200, JSON.stringify(body));
    const fetches = calls.filter(c => c.method === 'fetchIssueFields');
    assert.deepEqual(fetches.map(c => c.scope.repo), [REPO_B], 'the provider saw only repoB');
    assert.ok(!calls.some(c => c.scope && c.scope.repo === REPO_A), 'repoA was never queried');
    assert.equal(body.completeness.skipped, 0);
  });

  test('an unstamped row on the multi-binding workspace is skipped, never read from repoA', async () => {
    const { calls } = installGitHubProvider({ repoIssues: ISSUES });
    const workspace = makeTwoRepoWorkspace();
    const store = freshStore();
    store.historyCollection._docs.push(doneHistoryRow({ id: 'rX', issueIdentifier: 'GB-1' }));
    const app = buildEffortReadoutApp(workspace, store);

    const { status, body } = await withServer(app, ({ get }) => get('/workspace/acme/api/effort-readout'));

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.completeness.skipped, 1, 'the unstamped row is disclosed as skipped');
    assert.equal(body.completeness.complete, false);
    assert.equal(calls.filter(c => c.method === 'fetchIssueFields').length, 0, 'never guessed from repoA');
  });

  test('a stamped key whose binding no longer resolves is skipped, not thrown', async () => {
    const { calls } = installGitHubProvider({ repoIssues: ISSUES });
    const workspace = makeTwoRepoWorkspace();
    const store = freshStore();
    store.historyCollection._docs.push(doneHistoryRow({
      id: 'rGhost', issueIdentifier: 'GB-1', issueSource: 'github', issueBindingScope: 'octo/ghost',
    }));
    const app = buildEffortReadoutApp(workspace, store);

    const { status, body } = await withServer(app, ({ get }) => get('/workspace/acme/api/effort-readout'));

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.completeness.skipped, 1);
    assert.equal(calls.filter(c => c.method === 'fetchIssueFields').length, 0);
  });

  test('a single-binding workspace keeps today\'s behaviour: an unstamped row reads the sole binding', async () => {
    const { calls } = installGitHubProvider({ repoIssues: ISSUES });
    const workspace = makeSingleRepoWorkspace();
    const store = freshStore();
    store.historyCollection._docs.push(doneHistoryRow({ id: 'rA', issueIdentifier: 'GA-1' }));
    const app = buildEffortReadoutApp(workspace, store);

    const { status, body } = await withServer(app, ({ get }) => get('/workspace/acme/api/effort-readout'));

    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(calls.filter(c => c.method === 'fetchIssueFields').map(c => c.scope.repo), [REPO_A]);
    assert.equal(body.completeness.skipped, 0, 'the sole binding is read, not skipped');
  });
});

