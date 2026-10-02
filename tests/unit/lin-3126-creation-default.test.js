/**
 * LIN-3240 (LIN-3126 slice 1) — creation defaults + scan-due.
 *
 * Creation targets the EXPLICIT default binding (the LIN-3124 active marker's
 * binding): `task-create`, `POST /api/issues` and the feedback create. A
 * non-default target requires an explicit, validated `source`+`bindingScope`;
 * absent means the default, never a silent pick. `scan-due` is a workspace-level
 * batch → `resolveDefaultBinding`, so it never 422s for ambiguity.
 *
 * Run with: node --test tests/unit/lin-3126-creation-default.test.js
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPO_A, REPO_B, installGitHubProvider, makeTwoRepoWorkspace, makeSingleRepoWorkspace,
  buildWorkspaceApiApp, buildTaskCreateApp, withServer,
} from './lin-3126-harness.js';
import { makeTwoRepoResolver, buildProxyApp, callProxy, createIssueProvider } from './lin-3126-proxy-harness.js';

before(() => { process.env.NODE_ENV = 'test'; });

const ISSUE_A = { id: '1', identifier: 'GA-1', title: 'Repo A issue', description: 'REPO_A_MARKER', state: { name: 'Todo', type: 'unstarted' } };
const ISSUE_B = { id: '1', identifier: 'GB-1', title: 'Repo B issue', description: 'REPO_B_MARKER', state: { name: 'Todo', type: 'unstarted' } };

function recorder() {
  const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
  return { calls, workspace: makeTwoRepoWorkspace() };
}

describe('LIN-3240 creation — explicit default binding', () => {
  test('POST /api/issues with no selector creates on the DEFAULT binding (repoA)', async () => {
    const { calls, workspace } = recorder();
    const app = buildWorkspaceApiApp({ workspace });
    const { status } = await withServer(app, ({ post }) => post('/workspace/acme/api/issues', { title: 'New task' }));
    assert.equal(status, 201);
    const creates = calls.filter(c => c.method === 'createIssue');
    assert.deepEqual(creates.map(c => c.scope.repo), [REPO_A]);
  });

  test('POST /api/issues with an explicit validated selector creates on repoB', async () => {
    const { calls, workspace } = recorder();
    const app = buildWorkspaceApiApp({ workspace });
    const { status } = await withServer(app, ({ post }) =>
      post('/workspace/acme/api/issues', { title: 'New task', source: 'github', bindingScope: REPO_B }));
    assert.equal(status, 201);
    const creates = calls.filter(c => c.method === 'createIssue');
    assert.deepEqual(creates.map(c => c.scope.repo), [REPO_B]);
  });

  test('POST /api/issues with an unknown selector refuses 422 UNKNOWN_BINDING, never a silent default', async () => {
    const { calls, workspace } = recorder();
    const app = buildWorkspaceApiApp({ workspace });
    const { status, body } = await withServer(app, ({ post }) =>
      post('/workspace/acme/api/issues', { title: 'New task', source: 'github', bindingScope: 'octo/ghost' }));
    assert.equal(status, 422);
    assert.equal(body.code, 'UNKNOWN_BINDING');
    assert.deepEqual(body.bindings, [REPO_A, REPO_B]);
    assert.equal(calls.filter(c => c.method === 'createIssue').length, 0);
  });

  // LIN-3240 review F8 / autopilot ruling: a source-only selector is a valid
  // creation hint and must not newly 422 a single-binding workspace.
  test('POST /api/issues?source=github on a SINGLE-binding workspace creates on that binding (no 422) (F8)', async () => {
    const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A } });
    const workspace = makeSingleRepoWorkspace();
    const app = buildWorkspaceApiApp({ workspace });
    const { status } = await withServer(app, ({ post }) =>
      post('/workspace/acme/api/issues?source=github', { title: 'New task' }));
    assert.equal(status, 201);
    const creates = calls.filter(c => c.method === 'createIssue');
    assert.deepEqual(creates.map(c => c.scope.repo), [REPO_A]);
  });

  test('POST /api/issues?source=github on a TWO-repo workspace creates on the default binding, no ambiguity 422 (F8)', async () => {
    const { calls, workspace } = recorder();
    const app = buildWorkspaceApiApp({ workspace });
    const { status } = await withServer(app, ({ post }) =>
      post('/workspace/acme/api/issues?source=github', { title: 'New task' }));
    assert.equal(status, 201);
    const creates = calls.filter(c => c.method === 'createIssue');
    assert.deepEqual(creates.map(c => c.scope.repo), [REPO_A]);
  });

  test('POST /api/feedback with no selector creates on the DEFAULT binding (repoA)', async () => {
    const { calls, workspace } = recorder();
    const app = buildWorkspaceApiApp({ workspace });
    const { status } = await withServer(app, ({ post }) => post('/workspace/acme/api/feedback', { message: 'something broke', teamId: 'team-1' }));
    assert.equal(status === 201 || status === 200, true, `unexpected status ${status}`);
    const creates = calls.filter(c => c.method === 'createIssue');
    assert.deepEqual(creates.map(c => c.scope.repo), [REPO_A]);
  });

  test('GET /task/new renders against the DEFAULT binding (repoA) — no silent pick needed', async () => {
    const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B }, createFields: ['teamId'] });
    const workspace = makeTwoRepoWorkspace();
    const app = buildTaskCreateApp({ workspace });
    const { status } = await withServer(app, ({ get }) => get('/workspace/acme/task/new'));
    assert.equal(status, 200);
    // createFields(['teamId']) → the page reads the default binding's teams.
    const teamScopes = calls.filter(c => c.method === 'fetchTeams');
    assert.deepEqual(teamScopes.map(c => c.scope.repo), [REPO_A]);
  });
});

describe('LIN-3240 scan-due — workspace-level default', () => {
  const candidateStore = {
    listCandidatesForWorkspace: async () => ({
      items: [{ issueId: '1', issueIdentifier: 'GB-1', dueBasisHash: 'raised-hash', dueBasisVersion: 1 }],
      nextCursor: null,
      totalCandidateCount: 1,
    }),
  };

  test('GET /api/scan-due with no selector serves the default binding and does NOT 422', async () => {
    const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const workspace = makeTwoRepoWorkspace();
    const app = buildWorkspaceApiApp({ workspace, taskDecisionsStore: candidateStore });

    const { status, body } = await withServer(app, ({ get }) => get('/workspace/acme/api/scan-due'));
    assert.equal(status, 200, `scan-due must not 422 for ambiguity; got ${status}`);
    assert.ok(Array.isArray(body.items));
    const checks = calls.filter(c => c.method === 'fetchRecommendationContext');
    assert.deepEqual(checks.map(c => c.scope.repo), [REPO_A], 'served the default binding');
  });

  test('GET /api/scan-due with an explicit validated selector serves repoB', async () => {
    const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const workspace = makeTwoRepoWorkspace();
    const app = buildWorkspaceApiApp({ workspace, taskDecisionsStore: candidateStore });

    const { status } = await withServer(app, ({ get }) =>
      get(`/workspace/acme/api/scan-due?source=github&bindingScope=${encodeURIComponent(REPO_B)}`));
    assert.equal(status, 200);
    const checks = calls.filter(c => c.method === 'fetchRecommendationContext');
    assert.deepEqual(checks.map(c => c.scope.repo), [REPO_B]);
  });
});

// ---------------------------------------------------------------------------
// LIN-3241 (LIN-3126 slice 2) — the plan's "creation-default proxy row".
//
// CREATE-selector decision (LIN-3241 review F2): the plan's §3 per-intent table
// says a CREATE selector is "honoured only if it validates", but the plan's
// slice-2 class-bounding row for THIS site is explicit:
//
//   "Proxy `POST /issues` (`proxy-writes.js:78-80`) | **Deliberate default**
//    (S2), `CREATE` intent | Creation keeps the explicit default binding;
//    never refused for ambiguity"
//
// No route provides a CREATE selector: `issueSelectorFromQuery` is ISSUE-only
// and `proxy-writes.js:80` passes none. Slice 3 (LIN-3242) owns the DISPATCH
// issue selector pair (`issueSource`/`issueBindingScope`), not
// `POST /api/proxy/issues`. So the create-selector input is DEFERRED (stated in
// the PR body) and today's behaviour is pinned: a selector-like query on CREATE
// is ignored and creation lands on the explicit default.
// ---------------------------------------------------------------------------

describe('LIN-3241 proxy creation — POST /api/proxy/issues (CREATE) stays on the explicit default', () => {
  test('with no selector: creates on the default binding (repoA), never refused for ambiguity', async () => {
    const calls = [];
    const { fn } = makeTwoRepoResolver();
    const { app } = buildProxyApp({ resolveWorkspaceAccess: fn, provider: createIssueProvider(calls) });

    const res = await callProxy(app, 'POST', '/api/proxy/issues', { title: 'New task' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.notEqual(res.body?.code, 'BINDING_REQUIRED');
    assert.deepEqual(calls.map(c => c.scope.repo), [REPO_A]);
  });

  test('a selector-like query is IGNORED (CREATE reads no query selector) — still repoA', async () => {
    const calls = [];
    const recorded = [];
    const { fn } = makeTwoRepoResolver();
    const resolveWorkspaceAccess = async (urlKey, ownerAccountId, options) => {
      recorded.push(options);
      return fn(urlKey, ownerAccountId, options);
    };
    const { app } = buildProxyApp({ resolveWorkspaceAccess, provider: createIssueProvider(calls) });

    const res = await callProxy(
      app, 'POST',
      `/api/proxy/issues?source=github&bindingScope=${encodeURIComponent(REPO_B)}`,
      { title: 'New task' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(recorded.at(-1)?.intent, 'CREATE');
    assert.equal(recorded.at(-1)?.selector, undefined, 'CREATE must not read a selector from the query');
    assert.deepEqual(calls.map(c => c.scope.repo), [REPO_A]);
  });
});
