/**
 * LIN-556 — route-level proof that the proxy write paths resolve LLM-friendly and
 * provider-namespaced references to native ids before mutating, while existing
 * UUID payloads stay byte-identical.
 *
 * Uses a fake provider so resolution is observed through the recorded mutation
 * input rather than the network. The capability gate (`supports`) is a pass for
 * every method, matching the production Linear surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const TEAM_UUID = '11111111-1111-1111-1111-111111111111';
const DONE_UUID = '22222222-2222-2222-2222-222222222222';
const STARTED_UUID = '33333333-3333-3333-3333-333333333333';
const PROJECT_UUID = '44444444-4444-4444-4444-444444444444';
const BUG_UUID = '55555555-5555-5555-5555-555555555555';
const ISSUE_UUID = '66666666-6666-6666-6666-666666666666';

function makeProvider(overrides = {}) {
  const calls = {};
  const provider = {
    name: 'linear',
    supports: () => true,
    // LIN-1557: the headless write-door accept-list the create route gates
    // optional fields against. Full contract by default, matching this fake's
    // "everything works" posture (mirrors real LinearProvider.apiWriteFields()).
    apiWriteFields: () => ['title', 'description', 'teamId', 'projectId', 'stateId', 'assigneeId', 'priority', 'parentId', 'cycleId'],
    fetchTeams: async () => [{ id: TEAM_UUID, name: 'Linear Team', key: 'LIN' }],
    states: async (_t, teamId) => {
      calls.statesTeamId = teamId;
      return [
        { id: STARTED_UUID, name: 'In Progress', type: 'started' },
        { id: DONE_UUID, name: 'Done', type: 'completed' },
      ];
    },
    labels: async (_t, teamId) => {
      calls.labelsTeamId = teamId;
      return [{ id: BUG_UUID, name: 'bug' }];
    },
    cycles: async (_t, teamId) => {
      calls.cyclesTeamId = teamId;
      return [];
    },
    issues: async (_t, opts) => {
      calls.issuesTeamId = opts?.teamId;
      return { nodes: [], pageInfo: {} };
    },
    fetchProjectsList: async () => [{ id: PROJECT_UUID, name: 'Providers & API Unification' }],
    issueWriteGuard: async () => ({ id: ISSUE_UUID, trashed: false, team: { id: TEAM_UUID } }),
    issueLabels: async () => ({ id: ISSUE_UUID, trashed: false, labels: { nodes: [] } }),
    updateIssueLabels: async (_t, _id, labelIds) => {
      calls.labelIds = labelIds;
      return { success: true, issue: { id: ISSUE_UUID, identifier: 'LIN-1', labels: { nodes: [] } } };
    },
    createIssue: async (_t, input) => {
      calls.createInput = input;
      return { success: true, issue: { id: ISSUE_UUID, identifier: 'LIN-1' } };
    },
    updateIssue: async (_t, _id, input) => {
      calls.updateInput = input;
      return { success: true, issue: { id: ISSUE_UUID, identifier: 'LIN-1' } };
    },
    ...overrides,
  };
  return { provider, calls };
}

function buildApp(provider) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return app;
}

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test('POST /issues: symbolic teamId/stateId/projectId resolve to native ids', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), '/api/proxy/issues', {
    method: 'POST',
    body: { teamId: 'LIN', title: 'hi', stateId: 'done', projectId: 'Providers & API Unification' },
  });
  assert.equal(status, 201);
  assert.equal(calls.createInput.teamId, TEAM_UUID);
  assert.equal(calls.createInput.stateId, DONE_UUID);
  assert.equal(calls.createInput.projectId, PROJECT_UUID);
  // state resolution must be scoped to the resolved team
  assert.equal(calls.statesTeamId, TEAM_UUID);
});

test('POST /issues: existing UUID payload is byte-identical (no resolution drift)', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), '/api/proxy/issues', {
    method: 'POST',
    body: { teamId: TEAM_UUID, title: 'hi', stateId: DONE_UUID, projectId: PROJECT_UUID },
  });
  assert.equal(status, 201);
  assert.equal(calls.createInput.teamId, TEAM_UUID);
  assert.equal(calls.createInput.stateId, DONE_UUID);
  assert.equal(calls.createInput.projectId, PROJECT_UUID);
});

test('POST /issues: linear: namespace prefix is accepted and stripped', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), '/api/proxy/issues', {
    method: 'POST',
    body: { teamId: 'linear:LIN', title: 'hi', stateId: 'linear:done' },
  });
  assert.equal(status, 201);
  assert.equal(calls.createInput.teamId, TEAM_UUID);
  assert.equal(calls.createInput.stateId, DONE_UUID);
});

test('POST /issues: a non-active provider namespace is rejected with 422', async () => {
  const { provider } = makeProvider();
  const { status, body } = await request(buildApp(provider), '/api/proxy/issues', {
    method: 'POST',
    body: { teamId: 'github:42', title: 'hi' },
  });
  assert.equal(status, 422);
  assert.match(body.error, /not active/);
});

test('POST /issues: an unresolvable state name fails loud (422), not a silent drop', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), '/api/proxy/issues', {
    method: 'POST',
    body: { teamId: 'LIN', title: 'hi', stateId: 'nonsense-state' },
  });
  assert.equal(status, 422);
  assert.equal(calls.createInput, undefined); // never reached the mutation
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

test('PATCH /issues/:id: symbolic stateId resolves, scoped to the issue team', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), `/api/proxy/issues/${ISSUE_UUID}`, {
    method: 'PATCH',
    body: { stateId: 'in-progress' },
  });
  assert.equal(status, 200);
  assert.equal(calls.updateInput.stateId, STARTED_UUID);
  assert.equal(calls.statesTeamId, TEAM_UUID);
});

test('PATCH /issues/:id: literal state name resolves case-insensitively', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), `/api/proxy/issues/${ISSUE_UUID}`, {
    method: 'PATCH',
    body: { stateId: 'done' },
  });
  assert.equal(status, 200);
  assert.equal(calls.updateInput.stateId, DONE_UUID);
});

test('PATCH /issues/:id: empty body still 400 with no provider read', async () => {
  let guardCalled = false;
  const { provider } = makeProvider({ issueWriteGuard: async () => { guardCalled = true; return null; } });
  const { status } = await request(buildApp(provider), `/api/proxy/issues/${ISSUE_UUID}`, {
    method: 'PATCH',
    body: {},
  });
  assert.equal(status, 400);
  assert.equal(guardCalled, false);
});

test('PATCH /issues/:id: a trashed issue is refused (409) before resolution', async () => {
  const { provider } = makeProvider({
    issueWriteGuard: async () => ({ id: ISSUE_UUID, trashed: true, team: { id: TEAM_UUID } }),
  });
  const { status } = await request(buildApp(provider), `/api/proxy/issues/${ISSUE_UUID}`, {
    method: 'PATCH',
    body: { stateId: 'done' },
  });
  assert.equal(status, 409);
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test('POST /issues/:id/labels: a label name resolves to its id', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), `/api/proxy/issues/${ISSUE_UUID}/labels`, {
    method: 'POST',
    body: { labelId: 'bug' },
  });
  assert.equal(status, 200);
  assert.deepEqual(calls.labelIds, [BUG_UUID]);
});

test('DELETE /issues/:id/labels/:labelId: a label name path param resolves to its id', async () => {
  const { provider, calls } = makeProvider({
    issueLabels: async () => ({ id: ISSUE_UUID, trashed: false, labels: { nodes: [{ id: BUG_UUID, name: 'bug' }] } }),
  });
  const { status } = await request(buildApp(provider), `/api/proxy/issues/${ISSUE_UUID}/labels/bug`, {
    method: 'DELETE',
  });
  assert.equal(status, 200);
  assert.deepEqual(calls.labelIds, []);
});

// ---------------------------------------------------------------------------
// LIN-2025: team-ref membership on the three agent-facing reads.
// The fake provider's fetchTeams() returns exactly one real team (TEAM_UUID),
// so a well-formed but different id is "well-formed but unmatched" — the
// exact case John's ruling requires to fail loud rather than silently widen.
// ---------------------------------------------------------------------------

const UNMATCHED_TEAM_UUID = '77777777-7777-7777-7777-777777777777';

test('GET /issues: a matched teamId resolves and reaches the provider', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), `/api/proxy/issues?teamId=${TEAM_UUID}`);
  assert.equal(status, 200);
  assert.equal(calls.issuesTeamId, TEAM_UUID);
});

test('GET /issues: a well-formed but unmatched teamId fails loud (404 TEAM_NOT_FOUND), provider.issues never called', async () => {
  const { provider, calls } = makeProvider();
  const { status, body } = await request(buildApp(provider), `/api/proxy/issues?teamId=${UNMATCHED_TEAM_UUID}`);
  assert.equal(status, 404);
  assert.equal(body.code, 'TEAM_NOT_FOUND');
  assert.equal(calls.issuesTeamId, undefined);
});

test('GET /issues: no teamId never calls fetchTeams (hot unfiltered path pays no extra round trip)', async () => {
  let fetchTeamsCalled = false;
  const { provider, calls } = makeProvider({
    fetchTeams: async () => { fetchTeamsCalled = true; return [{ id: TEAM_UUID }]; },
  });
  const { status } = await request(buildApp(provider), '/api/proxy/issues');
  assert.equal(status, 200);
  assert.equal(fetchTeamsCalled, false);
  assert.equal(calls.issuesTeamId, null);
});

test('GET /issues: a teamless provider (empty fetchTeams) passes any teamId through unvalidated (F1)', async () => {
  const { provider, calls } = makeProvider({ fetchTeams: async () => [] });
  const { status } = await request(buildApp(provider), `/api/proxy/issues?teamId=${UNMATCHED_TEAM_UUID}`);
  assert.equal(status, 200);
  assert.equal(calls.issuesTeamId, UNMATCHED_TEAM_UUID);
});

test('GET /labels: a well-formed but unmatched teamId fails loud (404 TEAM_NOT_FOUND), provider.labels never called', async () => {
  const { provider, calls } = makeProvider();
  const { status, body } = await request(buildApp(provider), `/api/proxy/labels?teamId=${UNMATCHED_TEAM_UUID}`);
  assert.equal(status, 404);
  assert.equal(body.code, 'TEAM_NOT_FOUND');
  // The refusal is local and pre-provider — the point of the ruling is that the
  // filter is never dropped on the way to the provider, not merely that the
  // response carries a 404 (implementation-review finding 5).
  assert.equal(calls.labelsTeamId, undefined);
});

test('GET /labels: a matched teamId resolves and reaches the provider', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), `/api/proxy/labels?teamId=${TEAM_UUID}`);
  assert.equal(status, 200);
  assert.equal(calls.labelsTeamId, TEAM_UUID);
});

test('GET /cycles: a well-formed but unmatched teamId fails loud (404 TEAM_NOT_FOUND), provider.cycles never called', async () => {
  const { provider, calls } = makeProvider();
  const { status, body } = await request(buildApp(provider), `/api/proxy/cycles?teamId=${UNMATCHED_TEAM_UUID}`);
  assert.equal(status, 404);
  assert.equal(body.code, 'TEAM_NOT_FOUND');
  assert.equal(calls.cyclesTeamId, undefined);
});

test('GET /cycles: a matched teamId resolves and reaches the provider', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), `/api/proxy/cycles?teamId=${TEAM_UUID}`);
  assert.equal(status, 200);
  assert.equal(calls.cyclesTeamId, TEAM_UUID);
});

// LIN-2025: states/:teamId dropped its local format gate entirely — an
// invalid/unmatched id is now the PROVIDER's problem, surfaced through the
// route's existing graphqlErrorStatus/graphqlErrorDetail error mapping. Proven
// by observing the raw, unvalidated id reach `provider.states` (never a local
// short-circuit) and by the route relaying a provider-thrown error untouched.
test('GET /states/:teamId: no local gate — the raw id reaches the provider unvalidated', async () => {
  const { provider, calls } = makeProvider();
  const { status } = await request(buildApp(provider), `/api/proxy/states/${UNMATCHED_TEAM_UUID}`);
  assert.equal(status, 200);
  assert.equal(calls.statesTeamId, UNMATCHED_TEAM_UUID);
});

test('GET /states/:teamId: a provider-thrown error is relayed via the existing error mapping, not swallowed by a local gate', async () => {
  const graphqlError = Object.assign(new Error('boom'), { response: { status: 400, errors: [{ extensions: { userError: true } }] } });
  const { provider } = makeProvider({
    states: async () => { throw graphqlError; },
  });
  const { status } = await request(buildApp(provider), `/api/proxy/states/${UNMATCHED_TEAM_UUID}`);
  assert.equal(status, 400);
});

// ---------------------------------------------------------------------------
// LIN-2025: the motivating case, at ROUTE level rather than helper level —
// a non-UUID team id. Every case above uses UUIDs, which the old UUID_REGEX
// gates also passed; only a Jira-shaped key (LIN-2018 remaps Jira team ids to
// real project keys like "ENG") proves the format gate is genuinely gone and
// the membership check is what decides. The ticket's Testing section asked for
// this by name; the implementation review discharged it with a throwaway probe
// (finding 4) and these are that probe's four cases, landed.
// ---------------------------------------------------------------------------

function makeJiraShapedProvider(overrides = {}) {
  return makeProvider({
    fetchTeams: async () => [{ id: 'ENG', name: 'Engineering', key: 'ENG' }],
    ...overrides,
  });
}

test('GET /issues: a matched non-UUID team key (Jira-shaped) reaches the provider', async () => {
  const { provider, calls } = makeJiraShapedProvider();
  const { status } = await request(buildApp(provider), '/api/proxy/issues?teamId=ENG');
  assert.equal(status, 200);
  assert.equal(calls.issuesTeamId, 'ENG');
});

test('GET /labels: a matched non-UUID team key passes through; an unmatched one 404s without calling the provider', async () => {
  const matched = makeJiraShapedProvider();
  const okRes = await request(buildApp(matched.provider), '/api/proxy/labels?teamId=ENG');
  assert.equal(okRes.status, 200);
  assert.equal(matched.calls.labelsTeamId, 'ENG');

  const unmatched = makeJiraShapedProvider();
  const { status, body } = await request(buildApp(unmatched.provider), '/api/proxy/labels?teamId=OPS');
  assert.equal(status, 404);
  assert.equal(body.code, 'TEAM_NOT_FOUND');
  assert.equal(unmatched.calls.labelsTeamId, undefined);
});

test('GET /cycles: an unmatched non-UUID team key 404s without calling the provider', async () => {
  const { provider, calls } = makeJiraShapedProvider();
  const { status, body } = await request(buildApp(provider), '/api/proxy/cycles?teamId=OPS');
  assert.equal(status, 404);
  assert.equal(body.code, 'TEAM_NOT_FOUND');
  assert.equal(calls.cyclesTeamId, undefined);
});

test('GET /states/:teamId: a non-UUID team key reaches the provider (gate-free — was a hard 400 before)', async () => {
  const { provider, calls } = makeJiraShapedProvider();
  const { status } = await request(buildApp(provider), '/api/proxy/states/ENG');
  assert.equal(status, 200);
  assert.equal(calls.statesTeamId, 'ENG');
});

// ---------------------------------------------------------------------------
// LIN-2033 A2: the TEAM_NOT_FOUND refusal must disclose whether the team list
// it was checked against was itself truncated (e.g. Jira's fetchTeams() past
// the 500-project cap, LIN-2033 F1) — a rejection that confidently says "no
// such team" while the checked list was capped is exactly the failure the
// ticket exists to close.
// ---------------------------------------------------------------------------

function makeTruncatedTeamProvider(overrides = {}) {
  return makeProvider({
    fetchTeams: async () => {
      const teams = [{ id: TEAM_UUID, name: 'Linear Team', key: 'LIN' }];
      teams.truncated = true;
      return teams;
    },
    ...overrides,
  });
}

test('GET /issues: TEAM_NOT_FOUND discloses truncated:false against an untruncated list', async () => {
  const { provider } = makeProvider();
  const { status, body } = await request(buildApp(provider), `/api/proxy/issues?teamId=${UNMATCHED_TEAM_UUID}`);
  assert.equal(status, 404);
  assert.equal(body.truncated, false);
});

test('GET /issues: TEAM_NOT_FOUND discloses truncated:true against a capped list', async () => {
  const { provider } = makeTruncatedTeamProvider();
  const { status, body } = await request(buildApp(provider), `/api/proxy/issues?teamId=${UNMATCHED_TEAM_UUID}`);
  assert.equal(status, 404);
  assert.equal(body.code, 'TEAM_NOT_FOUND');
  assert.equal(body.truncated, true);
});

test('GET /labels: TEAM_NOT_FOUND discloses truncated:true against a capped list', async () => {
  const { provider } = makeTruncatedTeamProvider();
  const { status, body } = await request(buildApp(provider), `/api/proxy/labels?teamId=${UNMATCHED_TEAM_UUID}`);
  assert.equal(status, 404);
  assert.equal(body.truncated, true);
});

test('GET /cycles: TEAM_NOT_FOUND discloses truncated:true against a capped list', async () => {
  const { provider } = makeTruncatedTeamProvider();
  const { status, body } = await request(buildApp(provider), `/api/proxy/cycles?teamId=${UNMATCHED_TEAM_UUID}`);
  assert.equal(status, 404);
  assert.equal(body.truncated, true);
});
