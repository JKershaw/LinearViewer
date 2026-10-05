/**
 * LIN-3126 residual (review `5902c5c1`, "What CI Did Not Prove" items 2 and the
 * scan-due join): pin the server→client joins on a two-repo, connection-backed
 * GitHub workspace that the review's mutation table found unpinned.
 *
 *   - `POST /api/scan/:issueId` persists the validated selector pair onto the
 *     durable scan row (`...scanBindingPair`, routes/workspace-api.js:2851).
 *   - `GET /api/scan-due` emits each candidate's stored pair
 *     (routes/workspace-api.js:3408-3409).
 *
 * The workspace reuses the slice-1 harness (`lin-3126-harness.js`): repoA active
 * + repoB non-active on one Connection, each binding hydrated. `accessToken:
 * 'test-token'` under NODE_ENV=test flips the route's data + AI mocks on, so the
 * scan POST reaches the real `recordScan` write without a network call — the
 * binding resolution itself is the real strict resolver.
 *
 * Run with: node --test tests/unit/lin-3126-residual-joins.test.js
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import {
  REPO_A, REPO_B, installGitHubProvider, makeTwoRepoWorkspace, makeSingleRepoWorkspace,
  buildWorkspaceApiApp, withServer,
} from './lin-3126-harness.js';

before(() => { process.env.NODE_ENV = 'test'; });

const ISSUE_A = { id: '1', identifier: 'GA-1', title: 'Repo A issue', description: 'A', state: { name: 'Todo', type: 'unstarted' } };
const ISSUE_B = { id: '1', identifier: 'GB-1', title: 'Repo B issue', description: 'B', state: { name: 'Todo', type: 'unstarted' } };

// `TEST-6` is the mock-data fixture whose canonical id resolves to a UUID and
// whose scan text raises a decision (tests/unit/scan-routes.test.js's own
// DECISION_ISSUE). Its canonical id is what `recordScan` keys the row on.
const FIXTURE_ISSUE = 'TEST-6';
const CANONICAL_ID = '66666666-6666-6666-6666-666666666666';

function twoRepoWorkspaceWithMockRoute() {
  installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
  const workspace = makeTwoRepoWorkspace();
  workspace.accessToken = 'test-token';
  return workspace;
}

const prefsStore = { getWorkspacePreferences: async () => ({}) };

describe('LIN-3126 residual join — the scan POST persists the selector pair', () => {
  test('a validated ?source=&bindingScope= is stored on the durable scan row', async () => {
    const workspace = twoRepoWorkspaceWithMockRoute();
    const store = new TaskDecisionsStore({ collection: createMockCollection() });
    const app = buildWorkspaceApiApp({ workspace, taskDecisionsStore: store, workspacePreferencesStore: prefsStore });

    const { status } = await withServer(app, ({ post }) =>
      post(`/workspace/acme/api/scan/${FIXTURE_ISSUE}?source=github&bindingScope=${encodeURIComponent(REPO_B)}`));
    assert.equal(status, 200, 'the scan persisted');

    const row = await store.getStatus('acme', CANONICAL_ID);
    assert.ok(row, 'the scan row exists');
    assert.equal(row.issueSource, 'github', 'issueSource persisted');
    assert.equal(row.issueBindingScope, REPO_B, 'issueBindingScope persisted');
  });

  test('a scan with no selector stays sparse — no pair keys on the row (byte-identical)', async () => {
    // A single-binding workspace: an ISSUE read with no selector resolves to
    // its one binding, so the scan persists — and must store no pair (the
    // sparse legacy shape), exactly as before the residual.
    installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A } });
    const workspace = makeSingleRepoWorkspace();
    workspace.accessToken = 'test-token';
    const store = new TaskDecisionsStore({ collection: createMockCollection() });
    const app = buildWorkspaceApiApp({ workspace, taskDecisionsStore: store, workspacePreferencesStore: prefsStore });

    const { status } = await withServer(app, ({ post }) => post(`/workspace/acme/api/scan/${FIXTURE_ISSUE}`));
    assert.equal(status, 200);

    const row = await store.getStatus('acme', CANONICAL_ID);
    assert.ok(row, 'the scan row exists');
    assert.ok(!('issueSource' in row), 'no issueSource key invented');
    assert.ok(!('issueBindingScope' in row), 'no issueBindingScope key invented');
  });
});

describe('LIN-3126 residual join — scan-due emits each row pair', () => {
  function candidateStore(rows) {
    return { listCandidatesForWorkspace: async () => ({ items: rows, nextCursor: null, totalCandidateCount: rows.length }) };
  }

  test('a stamped candidate emits source+bindingScope; an unstamped sibling emits neither', async () => {
    installGitHubProvider({ repoIssues: { [REPO_A]: ISSUE_A, [REPO_B]: ISSUE_B } });
    const workspace = makeTwoRepoWorkspace();
    const rows = [
      { issueId: '1', issueIdentifier: 'GB-1', dueBasisHash: 'raised-hash', dueBasisVersion: 1, issueSource: 'github', issueBindingScope: REPO_B },
      { issueId: '2', issueIdentifier: 'GA-1', dueBasisHash: 'raised-hash', dueBasisVersion: 1 },
    ];
    const app = buildWorkspaceApiApp({ workspace, taskDecisionsStore: candidateStore(rows) });

    const { status, body } = await withServer(app, ({ get }) => get('/workspace/acme/api/scan-due'));
    assert.equal(status, 200);
    const byId = Object.fromEntries(body.items.map((i) => [i.issueIdentifier, i]));
    assert.equal(byId['GB-1'].source, 'github', 'stamped row emits source');
    assert.equal(byId['GB-1'].bindingScope, REPO_B, 'stamped row emits bindingScope');
    assert.ok(!('source' in byId['GA-1']), 'unstamped row emits no source key');
    assert.ok(!('bindingScope' in byId['GA-1']), 'unstamped row emits no bindingScope key');
  });
});
