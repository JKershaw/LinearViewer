// =============================================================================
// Session-auth issue write routes (LIN-1552 / LIN-1504 Session A)
//   POST  /workspace/:urlKey/api/issues
//   PATCH /workspace/:urlKey/api/issues/:issueId
// =============================================================================
//
// Drives both routes end-to-end against a fake provider (mirroring the harness in
// tests/unit/feedback-route.test.js), asserting the spec:
//   - 201 create happy path → { success, issue }, createdBy stamped from accountId
//   - 200 update happy path → { success, issue } (full-body description PATCH)
//   - 400 validation (over-length title, control-char description, bad priority)
//   - 422 CAPABILITY_NOT_SUPPORTED when supports(...) is false (never 500)
//   - 409 when the update target is a trashed issue (before any provider write)
//   - 502 when the provider write returns !success

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

const PROVIDER_NAME = 'issue-write-fake';
const TEAM_UUID = '00000000-0000-0000-0000-0000000000aa';
const ISSUE_ID = 'LIN-900';

// A controllable fake provider registered under a dedicated name; the route
// resolves it via getProviderForWorkspace(workspace) when workspace.provider
// matches. Per-test overrides tune capabilities, the write result, and the
// write-guard (trashed) read.
function makeFakeProvider(overrides = {}) {
  const calls = {
    createIssue: [], updateIssue: [], issueWriteGuard: [],
    fetchTeams: [], fetchProjectsList: [], states: [],
  };
  const caps = overrides.caps || { createIssue: true, updateIssue: true };
  // LIN-1972: this stub is a plain object literal, not a ProviderInterface
  // subclass, so it has no inherited createFields() — the route now calls it
  // unconditionally, so every test needs a real contract. Defaults to the
  // full Linear-shaped contract (every field declared) so pre-existing tests,
  // which submit teamId/projectId/stateId/priority freely, are unaffected;
  // tests exercising the teamless/narrowed path pass their own override.
  const createFieldsResult = overrides.createFields
    || ['title', 'description', 'teamId', 'projectId', 'stateId', 'priority'];
  const provider = {
    name: PROVIDER_NAME,
    supports: (cap) => caps[cap] === true,
    createFields: () => createFieldsResult,
    async createIssue(token, input) {
      calls.createIssue.push(input);
      if (overrides.createIssue) return overrides.createIssue(input);
      return { success: true, issue: { id: 'iss-1', identifier: 'LIN-900', title: input.title, description: input.description ?? null } };
    },
    async updateIssue(token, issueId, input) {
      calls.updateIssue.push({ issueId, input });
      if (overrides.updateIssue) return overrides.updateIssue(issueId, input);
      return { success: true, issue: { id: 'iss-1', identifier: issueId, ...input } };
    },
    async issueWriteGuard(token, issueId) {
      calls.issueWriteGuard.push(issueId);
      if (overrides.issueWriteGuard) return overrides.issueWriteGuard(issueId);
      return { id: 'iss-1', trashed: false, team: { id: 'team-x' } };
    },
    // Scoped list reads the symbolic-ref wrappers (resolveIssueTeamRef/
    // resolveIssueProjectRef/resolveIssueStateRef) call before resolving a
    // non-UUID ref (LIN-1556). Recorded so tests can assert the wrapper wired
    // the scoped fetch to the RESOLVED id, not the symbolic string — the
    // `states` call records its `teamId` argument, mirroring the twin's
    // `calls.statesTeamId` idiom (tests/unit/proxy-ref-resolution-routes.test.js).
    async fetchTeams(token) {
      calls.fetchTeams.push(token);
      if (overrides.fetchTeams) return overrides.fetchTeams();
      return [];
    },
    async fetchProjectsList(token) {
      calls.fetchProjectsList.push(token);
      if (overrides.fetchProjectsList) return overrides.fetchProjectsList();
      return [];
    },
    async states(token, teamId) {
      calls.states.push({ token, teamId });
      if (overrides.states) return overrides.states(teamId);
      return [];
    },
  };
  return { provider, calls };
}

function buildApp({ provider, session } = {}) {
  registerProvider(provider);
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'ws-token' };
      // Session carries BOTH ids so the createdBy test proves accountId wins.
      req.session = session || { accountId: 'acct-1', linearUserId: 'user-1' };
      next();
    },
    // Factory signature — none used by the issue write routes.
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {},
  });
  app.use(router);
  return app;
}

async function call(app, method, path, payload) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body = {};
    try { body = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

const postIssue = (app, payload, urlKey = 'acme') => call(app, 'POST', `/workspace/${urlKey}/api/issues`, payload);
const patchIssue = (app, issueId, payload, urlKey = 'acme') => call(app, 'PATCH', `/workspace/${urlKey}/api/issues/${issueId}`, payload);

// ---------------------------------------------------------------------------
// POST /workspace/:urlKey/api/issues
// ---------------------------------------------------------------------------
describe('POST /workspace/:urlKey/api/issues (create)', () => {
  test('201 happy path → { success, issue }; createdBy stamped from accountId, not linearUserId', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const { status, body } = await postIssue(app, { teamId: TEAM_UUID, title: 'Add a widget', description: 'body', priority: 2 });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.issue.identifier, 'LIN-900');
    assert.strictEqual(calls.createIssue.length, 1);
    const input = calls.createIssue[0];
    assert.strictEqual(input.title, 'Add a widget');
    assert.strictEqual(input.description, 'body');
    assert.strictEqual(input.priority, 2);
    assert.strictEqual(input.teamId, TEAM_UUID);
    // The load-bearing assertion: createdBy comes from session.accountId.
    assert.strictEqual(input.createdBy, 'acct-1');
    assert.notStrictEqual(input.createdBy, 'user-1'); // NOT linearUserId
  });

  test('400 when teamId is missing', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postIssue(buildApp({ provider }), { title: 'no team' });
    assert.strictEqual(status, 400);
    assert.match(body.error, /teamId/i);
  });

  test('400 when title is missing', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID });
    assert.strictEqual(status, 400);
    assert.match(body.error, /title is required/i);
  });

  test('400 over-length title', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID, title: 'x'.repeat(1001) });
    assert.strictEqual(status, 400);
    assert.match(body.error, /title exceeds maximum length/i);
  });

  test('400 control-char in description', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID, title: 'ok', description: 'bad\x00body' });
    assert.strictEqual(status, 400);
    assert.match(body.error, /description contains invalid characters/i);
  });

  test('400 out-of-range priority (driven through the shared validator)', async () => {
    const { provider, calls } = makeFakeProvider();
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID, title: 'ok', priority: 9 });
    assert.strictEqual(status, 400);
    assert.match(body.error, /priority must be an integer between 0 and 4/i);
    assert.strictEqual(calls.createIssue.length, 0); // rejected before the provider write
  });

  test('422 CAPABILITY_NOT_SUPPORTED when supports(createIssue) is false — never 500', async () => {
    const { provider } = makeFakeProvider({ caps: { createIssue: false, updateIssue: true } });
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID, title: 'ok' });
    assert.strictEqual(status, 422);
    assert.notStrictEqual(status, 500);
    assert.strictEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.strictEqual(body.capability, 'createIssue');
    assert.strictEqual(body.provider, PROVIDER_NAME);
  });

  test('502 when the provider write returns !success', async () => {
    const { provider } = makeFakeProvider({ createIssue: () => ({ success: false }) });
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID, title: 'ok' });
    assert.strictEqual(status, 502);
    assert.match(body.error, /not created/i);
  });
});

// ---------------------------------------------------------------------------
// createFields() capability contract (LIN-1972)
// ---------------------------------------------------------------------------
describe('POST /workspace/:urlKey/api/issues — createFields() capability contract (LIN-1972)', () => {
  test('regression pin: a GitHub-shaped payload with no undeclared fields still 200s', async () => {
    // GitHub's real contract: ['title', 'description', 'projectId'] — no teamId,
    // no stateId, no priority. LIN-1973 replaced the inline form (which always
    // submitted an unconditional priority number, GitHub-undeclared or not) with
    // the capability-derived /task/new page, which never submits a control the
    // provider didn't declare — so this is the shape it actually sends now.
    const { provider, calls } = makeFakeProvider({
      createFields: ['title', 'description', 'projectId'],
    });

    const { status, body } = await postIssue(buildApp({ provider }), {
      title: 'GitHub-shaped create',
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(calls.createIssue.length, 1);
    const input = calls.createIssue[0];
    assert.strictEqual('teamId' in input, false);
    assert.strictEqual('priority' in input, false);
  });

  test('Local create: declared non-UUID stateId + no submitted teamId resolves via the provider.name placeholder, no 422', async () => {
    // Local's real contract: ['title', 'description', 'projectId', 'stateId', 'priority']
    // — no teamId. Local's state ids (backlog/started/…) are never UUIDs, so this
    // exercises resolveIssueStateRef's symbolic path with the non-null placeholder
    // team supplied in place of a real (nonexistent) teamId.
    const STATE_UUID = '00000000-0000-0000-0000-0000000000dd';
    const { provider, calls } = makeFakeProvider({
      createFields: ['title', 'description', 'projectId', 'stateId', 'priority'],
      states: (teamId) => [{ id: STATE_UUID, name: 'Started', type: 'started' }],
    });

    const { status, body } = await postIssue(buildApp({ provider }), {
      title: 'Local create', stateId: 'started',
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.notStrictEqual(status, 422);
    assert.strictEqual(calls.createIssue.length, 1);
    assert.strictEqual(calls.createIssue[0].stateId, STATE_UUID);
    assert.strictEqual('teamId' in calls.createIssue[0], false); // placeholder never transmitted
    // The proving assertion: states() was scoped to the provider.name
    // placeholder (PROVIDER_NAME), not a real team — and it was never falsy,
    // which is what would have 422'd inside resolveIssueStateRef.
    assert.strictEqual(calls.states.length, 1);
    assert.strictEqual(calls.states[0].teamId, PROVIDER_NAME);
  });

  test('400 teamId is NOT required when the provider contract excludes it', async () => {
    const { provider, calls } = makeFakeProvider({ createFields: ['title', 'description'] });
    const { status, body } = await postIssue(buildApp({ provider }), { title: 'no team needed' });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(calls.createIssue.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Undeclared-field rejection (LIN-1973, restrictive half of LIN-1972's contract)
// ---------------------------------------------------------------------------
// Safe only now that the inline form (which submitted an unconditional priority
// for every provider) is gone — see routes/task-create.js and the removal of
// renderInlineCreateForm in lib/render.js.
describe('POST /workspace/:urlKey/api/issues — undeclared stateId/priority is REJECTED (LIN-1973)', () => {
  test('a submitted stateId the provider does NOT declare is 400, not silently dropped', async () => {
    const { provider, calls } = makeFakeProvider({
      createFields: ['title', 'description', 'projectId'], // GitHub-shaped: no stateId
    });
    const { status, body } = await postIssue(buildApp({ provider }), {
      title: 'attempt undeclared state', stateId: 'started',
    });
    assert.strictEqual(status, 400);
    assert.match(body.error, /stateId/i);
    assert.strictEqual(calls.createIssue.length, 0, 'rejected before any provider write');
  });

  test('a submitted priority the provider does NOT declare is 400, not silently dropped', async () => {
    const { provider, calls } = makeFakeProvider({
      createFields: ['title', 'description', 'projectId'], // GitHub-shaped: no priority
    });
    const { status, body } = await postIssue(buildApp({ provider }), {
      title: 'attempt undeclared priority', priority: 2,
    });
    assert.strictEqual(status, 400);
    assert.match(body.error, /priority/i);
    assert.strictEqual(calls.createIssue.length, 0);
  });

  test('priority: 0 (falsy but present) is still caught — presence, not truthiness, gates the rejection', async () => {
    const { provider, calls } = makeFakeProvider({
      createFields: ['title', 'description', 'projectId'],
    });
    const { status } = await postIssue(buildApp({ provider }), {
      title: 'falsy undeclared priority', priority: 0,
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(calls.createIssue.length, 0);
  });

  test('a DECLARED stateId/priority is unaffected — still forwarded, no 400', async () => {
    const { provider, calls } = makeFakeProvider(); // full Linear-shaped contract
    const { status, body } = await postIssue(buildApp({ provider }), {
      teamId: TEAM_UUID, title: 'declared fields', stateId: '00000000-0000-0000-0000-0000000000dd', priority: 1,
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(calls.createIssue.length, 1);
  });

  test('an out-of-range priority still 400s via the existing range validator BEFORE the new undeclared-field gate', async () => {
    // Documents the pre-existing exception the LIN-1972 review flagged:
    // validateIssueWriteFields(..., {validatePriority: true}) runs first and
    // already 400s an out-of-range priority even for a provider that doesn't
    // declare priority at all (GitHub) — unchanged by this landing. The new
    // gate only adds coverage for an IN-RANGE-but-undeclared value.
    const { provider, calls } = makeFakeProvider({
      createFields: ['title', 'description', 'projectId'],
    });
    const { status, body } = await postIssue(buildApp({ provider }), {
      title: 'out of range and undeclared', priority: 99,
    });
    assert.strictEqual(status, 400);
    assert.match(body.error, /priority must be an integer between 0 and 4/i);
    assert.strictEqual(calls.createIssue.length, 0);
  });
});

// ---------------------------------------------------------------------------
// PATCH /workspace/:urlKey/api/issues/:issueId
// ---------------------------------------------------------------------------
describe('PATCH /workspace/:urlKey/api/issues/:issueId (update)', () => {
  test('200 happy path → { success, issue }; full-body description PATCH is forwarded', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const { status, body } = await patchIssue(app, ISSUE_ID, { title: 'renamed', description: 'REPLACED body', priority: 1 });

    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(calls.updateIssue.length, 1);
    const { issueId, input } = calls.updateIssue[0];
    assert.strictEqual(issueId, ISSUE_ID);
    assert.strictEqual(input.title, 'renamed');
    assert.strictEqual(input.description, 'REPLACED body'); // full replace, not append
    assert.strictEqual(input.priority, 1);
  });

  test('400 empty body (no valid fields) — no provider read', async () => {
    const { provider, calls } = makeFakeProvider();
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, {});
    assert.strictEqual(status, 400);
    assert.match(body.error, /no valid fields/i);
    assert.strictEqual(calls.issueWriteGuard.length, 0);
  });

  test('400 over-length title', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { title: 'x'.repeat(1001) });
    assert.strictEqual(status, 400);
    assert.match(body.error, /title exceeds maximum length/i);
  });

  test('400 control-char in description', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { description: 'bad\x1Fbody' });
    assert.strictEqual(status, 400);
    assert.match(body.error, /description contains invalid characters/i);
  });

  test('400 out-of-range priority', async () => {
    const { provider, calls } = makeFakeProvider();
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { priority: -1 });
    assert.strictEqual(status, 400);
    assert.match(body.error, /priority must be an integer between 0 and 4/i);
    assert.strictEqual(calls.updateIssue.length, 0);
  });

  test('422 CAPABILITY_NOT_SUPPORTED when supports(updateIssue) is false — never 500', async () => {
    const { provider } = makeFakeProvider({ caps: { createIssue: true, updateIssue: false } });
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { title: 'x' });
    assert.strictEqual(status, 422);
    assert.notStrictEqual(status, 500);
    assert.strictEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.strictEqual(body.capability, 'updateIssue');
    assert.strictEqual(body.provider, PROVIDER_NAME);
  });

  test('409 when the update target is trashed — rejected BEFORE any provider write', async () => {
    const { provider, calls } = makeFakeProvider({ issueWriteGuard: () => ({ id: 'iss-1', trashed: true }) });
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { title: 'x' });
    assert.strictEqual(status, 409);
    assert.match(body.error, /trashed/i);
    assert.strictEqual(calls.updateIssue.length, 0); // no write happened
  });

  test('502 when the provider write returns !success', async () => {
    const { provider } = makeFakeProvider({ updateIssue: () => ({ success: false }) });
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { title: 'x' });
    assert.strictEqual(status, 502);
    assert.match(body.error, /not updated/i);
  });

  test('422 when the provider lacks issueWriteGuard — never 500 (LIN-1559 site 9)', async () => {
    // `issueWriteGuard` is a ROUTE-INTERNAL read, deliberately off the declared
    // PROVIDER_SURFACE, so the supports('updateIssue') gate above cannot speak for
    // it: a provider can pass that gate and still lack this read. It used to throw
    // a TypeError inside the route's try and answer 500 "Failed to update issue".
    // This is the workspace-api twin of the proxy backstop.
    const { provider, calls } = makeFakeProvider();
    delete provider.issueWriteGuard;

    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { title: 'x' });

    assert.strictEqual(status, 422);
    assert.notStrictEqual(status, 500);
    assert.strictEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.strictEqual(body.capability, 'issueWriteGuard');
    assert.strictEqual(body.provider, PROVIDER_NAME);
    assert.strictEqual(calls.updateIssue.length, 0); // declined before any write
  });

  test('the guard read is NOT declared on the capability surface (it is gated on existence)', async () => {
    // Guards the inverse mistake: gating site 9 on supports('issueWriteGuard')
    // would decline EVERY update on every provider, since these reads are
    // deliberately undeclared (LIN-1557 owns the declaration question). A
    // provider that implements the read but does not declare it must still write.
    const { provider } = makeFakeProvider();
    assert.strictEqual(provider.supports('issueWriteGuard'), false);
    const { status } = await patchIssue(buildApp({ provider }), ISSUE_ID, { title: 'x' });
    assert.strictEqual(status, 200);
  });
});

// ---------------------------------------------------------------------------
// Symbolic reference resolution (LIN-1556 — LIN-1552 ledger follow-up)
//
// Proves the wrapper wiring (resolveIssueTeamRef/resolveIssueProjectRef/
// resolveIssueStateRef in routes/workspace-api.js) end-to-end: a scoped list
// fetch (fetchTeams/fetchProjectsList/states) happens for a non-UUID ref, and
// the RESOLVED native id — not the symbolic string — reaches the provider
// write. A bare 201/200 status proves nothing here (a wrapper that silently
// forwarded the raw string would also pass), so every case additionally
// asserts the recorded write input and/or the recorded `states(token, teamId)`
// scoping argument.
// ---------------------------------------------------------------------------
describe('symbolic reference resolution (LIN-1556)', () => {
  const RESOLVED_TEAM_UUID = '00000000-0000-0000-0000-0000000000bb';
  const PROJECT_UUID = '00000000-0000-0000-0000-0000000000cc';
  const STATE_UUID = '00000000-0000-0000-0000-0000000000dd';
  const GUARD_TEAM_UUID = '00000000-0000-0000-0000-0000000000ee';

  test('POST create-happy: symbolic team/project/state resolve to native ids; states scoped to the RESOLVED team', async () => {
    const { provider, calls } = makeFakeProvider({
      fetchTeams: () => [{ id: RESOLVED_TEAM_UUID, name: 'Linear Team', key: 'LIN' }],
      fetchProjectsList: () => [{ id: PROJECT_UUID, name: 'Product' }],
      states: () => [{ id: STATE_UUID, name: 'In Progress', type: 'started' }],
    });

    const { status, body } = await postIssue(buildApp({ provider }), {
      teamId: 'LIN', title: 'Add a widget', projectId: 'Product', stateId: 'in-progress',
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(calls.createIssue.length, 1);
    const input = calls.createIssue[0];
    assert.strictEqual(input.teamId, RESOLVED_TEAM_UUID);
    assert.strictEqual(input.projectId, PROJECT_UUID);
    assert.strictEqual(input.stateId, STATE_UUID);
    assert.strictEqual(calls.fetchTeams.length, 1);
    assert.strictEqual(calls.fetchProjectsList.length, 1);
    assert.strictEqual(calls.states.length, 1);
    // The proving assertion: states was scoped to the RESOLVED team id, not
    // the symbolic 'LIN' the request sent.
    assert.strictEqual(calls.states[0].teamId, RESOLVED_TEAM_UUID);
  });

  test('POST create-unmatched: unresolvable stateId → 422, never 500, no write', async () => {
    const { provider, calls } = makeFakeProvider({ states: () => [] });

    const { status, body } = await postIssue(buildApp({ provider }), {
      teamId: TEAM_UUID, title: 'ok', stateId: 'nonsense',
    });

    assert.strictEqual(status, 422);
    assert.notStrictEqual(status, 500);
    assert.match(body.error, /no state matches reference 'nonsense'/i);
    assert.strictEqual(body.candidates, undefined);
    assert.strictEqual(calls.createIssue.length, 0);
  });

  test('POST create-ambiguous-project: two distinct-id matches → 422 with candidates, no write', async () => {
    const AMBIG_1 = '00000000-0000-0000-0000-0000000000f1';
    const AMBIG_2 = '00000000-0000-0000-0000-0000000000f2';
    const { provider, calls } = makeFakeProvider({
      fetchProjectsList: () => [{ id: AMBIG_1, name: 'Product' }, { id: AMBIG_2, name: 'product' }],
    });

    const { status, body } = await postIssue(buildApp({ provider }), {
      teamId: TEAM_UUID, title: 'ok', projectId: 'Product',
    });

    assert.strictEqual(status, 422);
    assert.notStrictEqual(status, 500);
    assert.match(body.error, /ambiguous project reference 'Product'/i);
    assert.deepEqual(body.candidates, [{ id: AMBIG_1, name: 'Product' }, { id: AMBIG_2, name: 'product' }]);
    assert.strictEqual(calls.createIssue.length, 0);
  });

  test('POST UUID control: bare-UUID refs never touch fetchTeams/fetchProjectsList/states', async () => {
    const { provider, calls } = makeFakeProvider();

    const { status } = await postIssue(buildApp({ provider }), {
      teamId: TEAM_UUID, title: 'ok', projectId: '00000000-0000-0000-0000-0000000000f9', stateId: STATE_UUID,
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(calls.fetchTeams.length, 0);
    assert.strictEqual(calls.fetchProjectsList.length, 0);
    assert.strictEqual(calls.states.length, 0);
  });

  test('PATCH happy: symbolic stateId resolves against the GUARD team, not create-style team resolution', async () => {
    const { provider, calls } = makeFakeProvider({
      issueWriteGuard: () => ({ id: 'iss-1', trashed: false, team: { id: GUARD_TEAM_UUID } }),
      states: () => [{ id: STATE_UUID, name: 'In Progress', type: 'started' }],
    });

    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { stateId: 'in-progress' });

    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(calls.updateIssue.length, 1);
    assert.strictEqual(calls.updateIssue[0].input.stateId, STATE_UUID);
    assert.strictEqual(calls.states.length, 1);
    assert.strictEqual(calls.states[0].teamId, GUARD_TEAM_UUID);
  });

  test('PATCH ambiguous state: two distinct-id matches → 422 with candidates, no write', async () => {
    const AMBIG_1 = '00000000-0000-0000-0000-0000000000a1';
    const AMBIG_2 = '00000000-0000-0000-0000-0000000000a2';
    const { provider, calls } = makeFakeProvider({
      issueWriteGuard: () => ({ id: 'iss-1', trashed: false, team: { id: GUARD_TEAM_UUID } }),
      states: () => [{ id: AMBIG_1, name: 'In Progress', type: 'started' }, { id: AMBIG_2, name: 'Doing', type: 'started' }],
    });

    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { stateId: 'in-progress' });

    assert.strictEqual(status, 422);
    assert.notStrictEqual(status, 500);
    assert.match(body.error, /ambiguous state reference 'in-progress'/i);
    assert.deepEqual(body.candidates, [{ id: AMBIG_1, name: 'In Progress' }, { id: AMBIG_2, name: 'Doing' }]);
    assert.strictEqual(calls.updateIssue.length, 0);
  });

  test('PATCH teamless guard: symbolic stateId with no guard.team → 422 BEFORE any states read (ledger item 3)', async () => {
    const { provider, calls } = makeFakeProvider({
      issueWriteGuard: () => ({ id: 'iss-1', trashed: false }), // no `team`
    });

    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { stateId: 'in-progress' });

    assert.strictEqual(status, 422);
    assert.notStrictEqual(status, 500);
    assert.match(body.error, /the issue's team could not be determined/i);
    // The proving assertion: the guard rejects before any scoped read is
    // attempted, not merely that the write never happened.
    assert.strictEqual(calls.states.length, 0);
    assert.strictEqual(calls.updateIssue.length, 0);
  });
});
