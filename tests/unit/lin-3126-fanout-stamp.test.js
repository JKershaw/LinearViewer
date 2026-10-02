/**
 * LIN-3240 (LIN-3126 slice 1) — fan-out binding stamp (review F4 / ledger L4).
 *
 * `server.js`'s `fetchAndPrepareProjects` fan-out is the ROOT of the whole
 * selector chain: it stamps each merged issue row with `bindingScope`
 * (`binding.scope`) when — and only when — the workspace has MORE THAN ONE
 * binding and that row's binding is connection-backed. A single-binding
 * workspace and a legacy connection-less workspace stay UNSTAMPED, which is
 * what keeps their rendered output byte-identical.
 *
 * server.js is not import-safe in a unit test (Mongo + `app.listen()` at module
 * load — the same documented constraint behind lin-2006-refresh-truncation's vm
 * harness), so this slices the real function body out of server.js and runs it
 * in a node:vm context. It injects the REAL binding accessors
 * (`getBindingsForWorkspace` / `getBindingCredentials` / `getBindingCallScope`
 * from lib/workspace.js and `isConnectionBacked` from
 * lib/connection-binding.js) and fakes only the provider reads and the
 * downstream forest builders. The `issues` array handed to the stubbed
 * `buildForest` is the observation point — it is exactly the merged, stamped
 * row set the real render path would consume.
 *
 * Mutation M7 ("server.js fan-out stamp disabled") must go red here.
 *
 * Run with: node --test tests/unit/lin-3126-fanout-stamp.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

import { getBindingsForWorkspace, getBindingCredentials, getBindingCallScope } from '../../lib/workspace.js';
import { isConnectionBacked, setBindingCredential } from '../../lib/connection-binding.js';
import { REPO_A, REPO_B } from './lin-3126-harness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

function sliceFetchAndPrepareProjects() {
  const startMarker = 'async function fetchAndPrepareProjects(workspace, teamId = null, mockOverride = null, urlKey = null, { slim = false, assigneeName = null } = {}) {';
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected fetchAndPrepareProjects in server.js — if this fails the function was moved and this harness needs re-anchoring');
  const endMarker = '\n/**\n * Handles workspace removal after authentication failure.';
  const endIdx = SERVER_SRC.indexOf(endMarker, startIdx);
  assert.notEqual(endIdx, -1, 'expected the handleWorkspaceRemoval docstring bounding fetchAndPrepareProjects — if this fails the function was moved/reformatted and this harness needs re-anchoring');
  const body = SERVER_SRC.slice(startIdx, endIdx);
  assert.equal(
    (body.match(/{/g) || []).length,
    (body.match(/}/g) || []).length,
    'the sliced fetchAndPrepareProjects must be brace-balanced — if this fails the function was reformatted and this harness needs re-anchoring'
  );
  return body;
}

/**
 * Execute the real fan-out with the real binding accessors and a fake provider
 * whose `fetchProjects(scope)` returns `issuesByScope[scope.repo]`. Returns the
 * issues array the fan-out handed to `buildForest`.
 */
async function runFanout({ workspace, issuesByScope }) {
  let capturedIssues = null;
  const fakeProvider = {
    fetchTeams: async () => [],
    fetchProjects: async (scope) => ({
      organizationName: 'Projects',
      projects: [],
      issues: issuesByScope[scope.repo] || [],
      truncated: false,
    }),
  };
  const context = vm.createContext({
    getBindingsForWorkspace,
    getBindingCredentials,
    getBindingCallScope,
    isConnectionBacked,
    getProvider: () => fakeProvider,
    matchTeamId: (teams, teamId) => teamId,
    isHiddenState: () => false,
    buildForest: (issues) => { capturedIssues = issues; return new Map(); },
    buildInProgressForest: () => [],
    buildRecentActivityForest: () => [],
    partitionCompleted: () => ({ incomplete: [], completed: [], completedCount: 0 }),
    NO_PROJECT_ID: '__no_project__',
    // Not 'test', so the real provider branch (the one under test) runs.
    process: { env: { NODE_ENV: 'production' } },
  });
  const script = `${sliceFetchAndPrepareProjects()}\nfetchAndPrepareProjects`;
  const fn = vm.runInContext(script, context);
  await fn(workspace, null, null, null, {});
  return capturedIssues;
}

function connectionBackedWorkspace(bindings, activeScope = bindings[0].scope) {
  for (const b of bindings) setBindingCredential(b, { installationId: '99', token: `tok-${b.scope}` });
  return {
    urlKey: 'acme',
    provider: 'github',
    bindings,
    activeBinding: { provider: 'github', scope: activeScope },
  };
}

const ISSUE_A = { id: '1', identifier: 'GA-1', title: 'Repo A issue' };
const ISSUE_B = { id: '1', identifier: 'GB-1', title: 'Repo B issue' };

test('F4/L4: a two-repo connection-backed workspace stamps each row with its own binding.scope', async () => {
  const workspace = connectionBackedWorkspace([
    { provider: 'github', scope: REPO_A, connectionId: 'conn-1' },
    { provider: 'github', scope: REPO_B, connectionId: 'conn-1' },
  ]);

  const issues = await runFanout({
    workspace,
    issuesByScope: { [REPO_A]: [ISSUE_A], [REPO_B]: [ISSUE_B] },
  });

  assert.equal(issues.length, 2);
  const a = issues.find(i => i.identifier === 'GA-1');
  const b = issues.find(i => i.identifier === 'GB-1');
  assert.equal(a.bindingScope, REPO_A, 'the repoA row carries repoA\'s scope');
  assert.equal(b.bindingScope, REPO_B, 'the repoB row carries repoB\'s scope');
});

test('F4/L4: a single-binding connection-backed workspace stays unstamped', async () => {
  const workspace = connectionBackedWorkspace([
    { provider: 'github', scope: REPO_A, connectionId: 'conn-1' },
  ]);

  const issues = await runFanout({ workspace, issuesByScope: { [REPO_A]: [ISSUE_A] } });

  assert.equal(issues.length, 1);
  assert.ok(!('bindingScope' in issues[0]), 'a single-binding workspace row must not gain a bindingScope stamp');
});

test('F4/L4: a legacy connection-less workspace stays unstamped', async () => {
  // No `bindings` array → getBindingsForWorkspace synthesizes one legacy
  // binding from the scalar mirror. No `connectionId`, so `isConnectionBacked`
  // is false and the row must not be stamped.
  const workspace = { urlKey: 'legacy', id: REPO_A, provider: 'github', accessToken: 'tok-legacy' };

  const issues = await runFanout({ workspace, issuesByScope: { [REPO_A]: [ISSUE_A] } });

  assert.equal(issues.length, 1);
  assert.ok(!('bindingScope' in issues[0]), 'a legacy connection-less workspace row must not gain a bindingScope stamp');
});

test('F4/L4: multiple LEGACY (connection-less) bindings stay unstamped — the isConnectionBacked guard holds', async () => {
  // A defensive shape: >1 binding but none connection-backed. The stamp must be
  // gated on `isConnectionBacked`, not on binding count alone.
  const bindings = [
    { provider: 'github', scope: REPO_A, credentials: { token: 'tok-a' } },
    { provider: 'github', scope: REPO_B, credentials: { token: 'tok-b' } },
  ];
  const workspace = { urlKey: 'legacy2', provider: 'github', bindings, activeBinding: { provider: 'github', scope: REPO_A } };

  const issues = await runFanout({ workspace, issuesByScope: { [REPO_A]: [ISSUE_A], [REPO_B]: [ISSUE_B] } });

  assert.equal(issues.length, 2);
  assert.ok(issues.every(i => !('bindingScope' in i)), 'a connection-less shipping shape must never be stamped');
});
