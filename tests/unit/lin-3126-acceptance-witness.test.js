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
 * Run with: node --test tests/unit/lin-3126-acceptance-witness.test.js
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPO_A, REPO_B, installGitHubProvider, makeTwoRepoWorkspace, buildWorkspaceApiApp, withServer,
} from './lin-3126-harness.js';

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
