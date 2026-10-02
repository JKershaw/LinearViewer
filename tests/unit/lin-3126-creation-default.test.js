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
