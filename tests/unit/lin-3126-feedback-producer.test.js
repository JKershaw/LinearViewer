/**
 * LIN-3126 residual (Beat-1 producer sweep) — the feedback triage / autopilot
 * dispatch rows are the LAST issue-addressed row producers that bypassed the
 * factory's §5.5a pair inheritance (they carry no `followUpTo`), so the route
 * must stamp the created issue's own binding pair onto `fields`.
 *
 * The stamped pair is taken from the SAME `resolveDefaultBindingSelection`
 * result that produced the creation target (`provider`/`callScope`), so the
 * binding the issue is actually created in and the pair stamped on the row can
 * never drift. These tests assert that link directly: the provider call scope
 * the fake records for `createIssue` equals the row's `issueBindingScope`.
 *
 * Without the pair, the run page for a feedback-triage/autopilot run on a
 * two-binding connection-backed workspace renders a pair-less reply box, and a
 * reply / Close out then 422s `BINDING_REQUIRED` — the same fail-closed class
 * the wake fix (W1) closes.
 *
 * Fails before on the unfixed route (no `...overrides.bindingPair` spread):
 *   - the triage/autopilot row carries no `issueSource`/`issueBindingScope`
 *
 * Run with: node --test tests/unit/lin-3126-feedback-producer.test.js
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import {
  REPO_A, REPO_B, installGitHubProvider, makeTwoRepoWorkspace,
  buildWorkspaceApiApp, withServer,
} from './lin-3126-harness.js';

before(() => { process.env.NODE_ENV = 'test'; });

const ISSUE_A = { id: '1', identifier: 'GA-1', title: 'Repo A issue', description: 'A', state: { name: 'Todo', type: 'unstarted' } };
const ISSUE_B = { id: '1', identifier: 'GB-1', title: 'Repo B issue', description: 'B', state: { name: 'Todo', type: 'unstarted' } };

const prefsStore = { getWorkspacePreferences: async () => ({}) };

// A real dispatch store, so the assertions read the PERSISTED row (the shape a
// reader joins against), not the raw `fields` object — `addItem` writes the
// selector pair sparsely (a null drops the key).
function newStore() {
  return new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
}

function fakeProxyTokenStore(token = 'rw-token') {
  return {
    async mintGrantBootstrap(args) { return { token, scope: 'readWrite', grants: args.grants }; },
    async createToken(urlKey, options) { return { token, scope: options?.scope }; },
  };
}

function workspaceWithId(workspace) {
  workspace.id = 'ws-acme';
  return workspace;
}

function createdScope(calls) {
  const creates = calls.filter(c => c.method === 'createIssue');
  assert.equal(creates.length, 1, 'exactly one createIssue call');
  return creates[0].scope;
}

async function postedTriage(app, body) {
  return withServer(app, ({ post }) => post('/workspace/acme/api/feedback', body));
}

async function persistedRow(store) {
  const rows = await store.collection.find({}).toArray();
  assert.equal(rows.length, 1, 'one dispatch row enqueued');
  return rows[0];
}

describe('LIN-3126 producer sweep — feedback triage/autopilot rows carry the pair', () => {
  test('triage on the DEFAULT binding stamps the SAME binding the issue was created in', async () => {
    const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const workspace = workspaceWithId(makeTwoRepoWorkspace());
    const store = newStore();
    const app = buildWorkspaceApiApp({
      workspace, dispatchQueueStore: store, workspacePreferencesStore: prefsStore,
      proxyTokenStore: fakeProxyTokenStore(),
    });

    const { status } = await postedTriage(app, { message: 'something broke', teamId: 'team-1', action: 'triage' });
    assert.equal(status === 201 || status === 200, true, `unexpected status ${status}`);

    const row = await persistedRow(store);
    // The creation target and the stamped pair are ONE source: the pair's scope
    // equals the provider call scope the issue was actually created in.
    assert.equal(createdScope(calls).repo, REPO_A, 'issue created on repoA');
    assert.equal(row.issueSource, 'github', 'triage row carries the created issue source');
    assert.equal(row.issueBindingScope, createdScope(calls).repo, 'pair scope equals the creation binding');
    assert.equal(row.issueBindingScope, REPO_A, 'triage row carries repoA');
  });

  test('autopilot on the DEFAULT binding stamps the SAME binding the issue was created in', async () => {
    const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const workspace = workspaceWithId(makeTwoRepoWorkspace());
    const store = newStore();
    const app = buildWorkspaceApiApp({
      workspace, dispatchQueueStore: store, workspacePreferencesStore: prefsStore,
      proxyTokenStore: fakeProxyTokenStore(),
    });

    const { status } = await postedTriage(app, { message: 'something broke', teamId: 'team-1', action: 'autopilot' });
    assert.equal(status === 201 || status === 200, true, `unexpected status ${status}`);

    const row = await persistedRow(store);
    assert.equal(createdScope(calls).repo, REPO_A, 'issue created on repoA');
    assert.equal(row.issueSource, 'github', 'autopilot row carries the created issue source');
    assert.equal(row.issueBindingScope, createdScope(calls).repo, 'pair scope equals the creation binding');
  });

  test('an explicit validated repoB selector creates AND stamps repoB (link holds off-default)', async () => {
    const { calls } = installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const workspace = workspaceWithId(makeTwoRepoWorkspace());
    const store = newStore();
    const app = buildWorkspaceApiApp({
      workspace, dispatchQueueStore: store, workspacePreferencesStore: prefsStore,
      proxyTokenStore: fakeProxyTokenStore(),
    });

    const { status } = await postedTriage(app, {
      message: 'something broke', teamId: 'team-1', action: 'triage',
      source: 'github', bindingScope: REPO_B,
    });
    assert.equal(status === 201 || status === 200, true, `unexpected status ${status}`);

    const row = await persistedRow(store);
    // The off-default case is where a pair sourced from the active/default
    // binding (rather than the creation target) would drift and fail.
    assert.equal(createdScope(calls).repo, REPO_B, 'issue created on repoB');
    assert.equal(row.issueSource, 'github', 'triage row carries the selected source');
    assert.equal(row.issueBindingScope, createdScope(calls).repo, 'pair scope equals the creation binding');
    assert.equal(row.issueBindingScope, REPO_B, 'triage row carries repoB');
  });

  test('a legacy/marker-less workspace adds NO pair key (sparse, S0)', async () => {
    // No bindings → `selectDefaultBinding` falls through, so the row must stay
    // byte-identical (no pair keys).
    installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A } });
    const workspace = workspaceWithId({ urlKey: 'acme', provider: 'github' });
    const store = newStore();
    const app = buildWorkspaceApiApp({
      workspace, dispatchQueueStore: store, workspacePreferencesStore: prefsStore,
      proxyTokenStore: fakeProxyTokenStore(),
    });

    const { status } = await postedTriage(app, { message: 'something broke', teamId: 'team-1', action: 'triage' });
    assert.equal(status === 201 || status === 200, true, `unexpected status ${status}`);

    const row = await persistedRow(store);
    assert.ok(!('issueSource' in row), 'no issueSource key invented on a legacy workspace');
    assert.ok(!('issueBindingScope' in row), 'no issueBindingScope key invented on a legacy workspace');
  });
});
