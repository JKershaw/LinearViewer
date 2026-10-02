/**
 * LIN-3240 (LIN-3126 slice 1) fix round 2 — server-side selector hops.
 *
 * Review findings covered here:
 *   - F2 / M9: task-chat POST turn resolves the issue's OWN binding from
 *     `source`+`bindingScope` (and the page route carries `defaultBindingScope`
 *     through to the rendered data so the client can prefill it).
 *   - F2 / M10: task-edit GET resolves the issue's OWN binding from the
 *     `source`+`bindingScope` provenance its Edit link carries and stamps it
 *     onto the form.
 *   - F3 / M8: `/api/context/:issueId` reaches the issue's own binding from the
 *     forwarded selector; single-binding/no-selector stays unchanged.
 *
 * Run with: node --test tests/unit/lin-3126-binding-hops.test.js
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPO_A, REPO_B, installGitHubProvider, makeTwoRepoWorkspace, makeSingleRepoWorkspace,
  makeMixedProviderWorkspace, buildTaskChatApp, buildTaskEditApp, buildWorkspaceApiApp, withServer,
} from './lin-3126-harness.js';
import { setFetchImpl } from '../../lib/openrouter.js';

before(() => { process.env.NODE_ENV = 'test'; });

const ISSUE_A = { id: '1', identifier: 'GA-1', title: 'Repo A issue', description: 'REPO_A_MARKER', state: { name: 'Todo', type: 'unstarted' } };
const ISSUE_B = { id: '1', identifier: 'GB-1', title: 'Repo B issue', description: 'REPO_B_MARKER', state: { name: 'Todo', type: 'unstarted' } };

/** A github fake whose `fetchProjects` returns ONLY the named scope's issues. */
function installScopedGithub(repoIssues) {
  const { provider, calls } = installGitHubProvider({ repoIssues });
  provider.fetchProjects = async (scope) => {
    calls.push({ method: 'fetchProjects', scope });
    const issue = repoIssues[scope.repo];
    return { projects: [], issues: issue ? [issue] : [], truncated: false };
  };
  return { provider, calls };
}

describe('LIN-3240 F2 — task-chat page hop carries the binding stamp', () => {
  test('the page emits defaultBindingScope when the Chat link carried one', async () => {
    installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const app = buildTaskChatApp({ workspace: makeTwoRepoWorkspace() });

    const { status, text } = await withServer(app, ({ get }) =>
      get('/workspace/acme/task-chat?task=GB-1&source=github&bindingScope=octo%2FrepoB'));

    assert.equal(status, 200);
    assert.ok(text.includes('"defaultBindingScope":"octo/repoB"'), 'the rendered page data carries the stamp');
    assert.ok(text.includes('"defaultSource":"github"'), 'the source hint still rides beside it');
  });

  test('an unstamped page stays byte-identical: no defaultBindingScope key', async () => {
    installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const app = buildTaskChatApp({ workspace: makeTwoRepoWorkspace() });

    const { status, text } = await withServer(app, ({ get }) =>
      get('/workspace/acme/task-chat?task=GB-1&source=github'));

    assert.equal(status, 200);
    assert.ok(!text.includes('defaultBindingScope'), 'no stamp key is emitted when the link carried none');
  });
});

describe('LIN-3240 F2/M9 — task-chat POST turn resolves the issue\'s own binding', () => {
  test('bindingScope=repoB resolves repoB (M9: ignoring it 422s on a two-repo workspace)', async () => {
    const { provider, calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const seen = [];
    provider.fetchRecommendationContext = async (scope, issueId) => {
      seen.push({ scope, issueId });
      throw new Error('stop-after-scope');
    };
    const app = buildTaskChatApp({ workspace: makeTwoRepoWorkspace(), sessionOverrides: { openRouterApiKey: 'test-key' } });

    const { status } = await withServer(app, ({ post }) =>
      post('/workspace/acme/api/task-chat/1?source=github&bindingScope=octo%2FrepoB', { question: 'where do you stand?' }));

    assert.notEqual(status, 422, 'a valid bindingScope must not refuse');
    assert.deepEqual(seen.map(c => c.scope.repo), [REPO_B], 'the turn fetched repoB\'s context');
    assert.equal(calls.filter(c => c.method === 'fetchRecommendationContext').length, 0, 'the real recording fake was bypassed by the override');
  });
});

describe('LIN-3240 F2/M10 — task-edit GET recruits the issue\'s own binding', () => {
  test('bindingScope=repoB reads repoB and stamps the form (M10)', async () => {
    const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const app = buildTaskEditApp({ workspace: makeTwoRepoWorkspace() });

    const { status, text } = await withServer(app, ({ get }) =>
      get('/workspace/acme/task/1/edit?source=github&bindingScope=octo%2FrepoB'));

    assert.equal(status, 200);
    const reads = calls.filter(c => c.method === 'fetchIssueFields');
    assert.deepEqual(reads.map(c => c.scope.repo), [REPO_B], 'the edit page read repoB');
    assert.ok(text.includes('data-binding-scope="octo/repoB"'), 'the form carries the binding stamp');
  });
});

describe('LIN-3240 F3/M8 — /api/context reaches the issue\'s own binding', () => {
  test('two-repo + bindingScope=repoB reads repoB only (M8)', async () => {
    const { calls } = installScopedGithub({ [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B });
    const app = buildWorkspaceApiApp({ workspace: makeTwoRepoWorkspace() });

    const { status } = await withServer(app, ({ get }) =>
      get(`/workspace/acme/api/context/1?source=github&bindingScope=${encodeURIComponent(REPO_B)}`));

    assert.equal(status, 200);
    const reads = calls.filter(c => c.method === 'fetchProjects');
    assert.deepEqual(reads.map(c => c.scope.repo), [REPO_B], 'the context read used repoB');
  });

  test('two-repo with no selector fails closed (422 BINDING_REQUIRED)', async () => {
    const { calls } = installScopedGithub({ [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B });
    const app = buildWorkspaceApiApp({ workspace: makeTwoRepoWorkspace() });

    const { status, body } = await withServer(app, ({ get }) => get('/workspace/acme/api/context/1'));

    assert.equal(status, 422);
    assert.equal(body.code, 'BINDING_REQUIRED');
    assert.equal(calls.filter(c => c.method === 'fetchProjects').length, 0);
  });

  test('single-binding with no selector is unchanged: reads its sole binding', async () => {
    const { calls } = installScopedGithub({ [REPO_A]: ISSUE_A });
    const app = buildWorkspaceApiApp({ workspace: makeSingleRepoWorkspace() });

    const { status } = await withServer(app, ({ get }) => get('/workspace/acme/api/context/1'));

    assert.equal(status, 200);
    const reads = calls.filter(c => c.method === 'fetchProjects');
    assert.deepEqual(reads.map(c => c.scope.repo), [REPO_A]);
  });
});

/**
 * LIN-3240 review R1 / LIN-2371 — the task-chat persona must name the ROW's
 * declared provider, not the workspace's active one, on a mixed-provider
 * workspace.
 *
 * This is a BEHAVIOUR witness, not a source-text grep (`lin-2371-…` pins the
 * derivation text, which stayed green while the value was always
 * `workspace.provider`). It drives the real POST handler end to end: the
 * provider context fetch, the real `buildTaskChatMessages`, and the real
 * `streamChat` — intercepted at the module's own `setFetchImpl` seam (LIN-1848)
 * so the OUTGOING system message is the observable. A non-tool-capable model id
 * keeps the turn on the plain streaming branch. Mutation (R1-orphan): make
 * `declaredSource` always `workspace.provider` → the GitHub row names Linear →
 * red.
 */
function openRouterSseResponse() {
  const sse = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  return {
    ok: true,
    status: 200,
    // Non-streaming shape too, so the witness holds regardless of whether the
    // process has a proxy env set (`useStreaming` in lib/openrouter.js).
    json: async () => ({ model: 'test/plain-model', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }),
    text: async () => sse,
    body: new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(sse)); controller.close(); },
    }),
  };
}

async function drivePersonaTurn(query) {
  const captured = [];
  setFetchImpl(async (url, opts) => {
    captured.push({ url, body: JSON.parse(opts.body) });
    return openRouterSseResponse();
  });
  try {
    const app = buildTaskChatApp({
      workspace: makeMixedProviderWorkspace(),
      sessionOverrides: { openRouterApiKey: 'test-key' },
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({ modelId: 'test/plain-model' }) },
    });
    const res = await withServer(app, ({ post }) =>
      post(`/workspace/acme/api/task-chat/1${query}`, { question: 'where do you stand?' }));
    const system = captured[0]?.body?.messages?.find(m => m.role === 'system')?.content || '';
    return { res, system, captured };
  } finally {
    setFetchImpl(null);
  }
}

describe('LIN-3240 R1 — task-chat persona names the row\'s declared provider', () => {
  test('a mixed-provider workspace + ?source=github gets a GitHub-named persona', async () => {
    installGitHubProvider({ repoIssues: { [REPO_B]: ISSUE_B } });
    const { res, system } = await drivePersonaTurn('?source=github&bindingScope=octo%2FrepoB');

    assert.notEqual(res.status, 422, 'the Github row must resolve, not refuse');
    assert.match(system, /^You ARE a single GitHub Issues task, speaking for yourself/,
      'the persona must name the row\'s actual provider, not the Linear-active workspace');
    assert.doesNotMatch(system, /single Linear task/, 'the workspace provider must not leak onto a foreign row');
  });

  test('an unmatched / absent source falls back to the workspace provider', async () => {
    installGitHubProvider({ repoIssues: { [REPO_B]: ISSUE_B } });
    const { system } = await drivePersonaTurn('');

    assert.match(system, /^You ARE a single Linear task, speaking for yourself/,
      'with no selector the persona names the workspace provider');
  });
});
