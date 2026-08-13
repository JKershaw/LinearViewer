/**
 * Unit tests for routes/task-create.js (LIN-1973).
 *
 * Run with: node --test tests/unit/task-create-route.test.js
 *
 * Exercises the handler directly (bypassing the workspaceFromUrl middleware)
 * against a fake provider registered in the real registry — the pattern
 * tests/unit/task-edit-route.test.js uses for the sibling drill-down page.
 *
 * The branches worth pinning are the ones a happy-path E2E can never reach:
 *   - `ui.inlineCreate` false → redirect to the dashboard (NOT Settings)
 *   - the gate short-circuits BEFORE any provider read (no round trip)
 *   - team/project/state reads are capability-gated AND try/caught to [] —
 *     the page always 200s, never 500s, over an unavailable option list
 *   - the states() read is SKIPPED entirely (no network call) when the
 *     provider requires a team and none has resolved yet
 *   - an unmatched ?projectId=/?teamId= never leaks into the resolved teamId
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createTaskCreateRoutes } from '../../routes/task-create.js';
import { registerProvider } from '../../lib/providers/registry.js';
// Side-effect import: the shared nav resolves the legacy default provider.
import '../../lib/providers/linear/index.js';
import { JiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';

let providerSeq = 0;
function fakeProvider({
  inlineCreate = true,
  createFields = () => ['title', 'description', 'teamId', 'projectId', 'stateId', 'priority'],
  fetchTeams = async () => [{ id: 'team-1', name: 'Engineering', key: 'ENG' }],
  fetchProjectsList = async () => [{ id: 'proj-1', name: 'Roadmap' }],
  states = async () => [{ id: 'started', name: 'In Progress', position: 2 }],
} = {}) {
  const name = `fake-task-create-${++providerSeq}`;
  registerProvider({
    name,
    ui: { inlineCreate },
    supports: () => true,
    createFields,
    fetchTeams,
    fetchProjectsList,
    states,
  });
  return name;
}

function getHandler(router) {
  const layer = router.stack.find(l => l.route?.path === '/workspace/:urlKey/task/new' && l.route.methods.get);
  assert.ok(layer, 'GET /workspace/:urlKey/task/new is registered');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRouter() {
  return createTaskCreateRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({}),
  });
}

async function call({ provider, urlKey = 'acme', query = {} }) {
  const req = {
    session: { workspaces: [], features: {} },
    workspace: { urlKey, provider, accessToken: 'tok' },
    params: { urlKey },
    query,
    get: () => 'localhost',
  };
  const res = {
    statusCode: 200,
    body: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    send(b) { this.body = b; return this; },
    redirect(url) { this.redirectedTo = url; return this; },
  };
  await getHandler(makeRouter())(req, res);
  return res;
}

describe('GET /workspace/:urlKey/task/new', () => {
  test('renders the create page for a provider with in-app create support', async () => {
    const res = await call({ provider: fakeProvider() });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.includes('data-testid="task-create-form"'));
  });

  test('redirects to the DASHBOARD (not Settings) when ui.inlineCreate is false', async () => {
    const res = await call({ provider: fakeProvider({ inlineCreate: false }) });
    assert.strictEqual(res.redirectedTo, '/workspace/acme/');
    assert.strictEqual(res.body, null, 'no page is rendered for a read-only provider');
  });

  test('gates BEFORE any provider read (a read-only provider costs no round trip)', async () => {
    let called = false;
    const provider = fakeProvider({
      inlineCreate: false,
      fetchTeams: async () => { called = true; return []; },
    });
    await call({ provider });
    assert.strictEqual(called, false);
  });

  test('a field NOT in createFields() is never fetched (GitHub: no teams/states read)', async () => {
    let teamsCalled = false;
    let statesCalled = false;
    const provider = fakeProvider({
      createFields: () => ['title', 'description', 'projectId'],
      fetchTeams: async () => { teamsCalled = true; return []; },
      states: async () => { statesCalled = true; return []; },
    });
    const res = await call({ provider });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(teamsCalled, false);
    assert.strictEqual(statesCalled, false);
  });
});

describe('option-list degradation (never 500 over an unavailable list)', () => {
  test('a fetchTeams() that throws still renders 200 with the fallback', async () => {
    const provider = fakeProvider({ fetchTeams: async () => { throw new Error('boom'); } });
    const res = await call({ provider });
    assert.strictEqual(res.statusCode, 200);
  });

  test('a fetchProjectsList() that throws still renders 200 with the fallback', async () => {
    const provider = fakeProvider({ fetchProjectsList: async () => { throw new Error('boom'); } });
    const res = await call({ provider });
    assert.strictEqual(res.statusCode, 200);
  });

  test('a states() that throws still renders 200 with the fallback', async () => {
    const provider = fakeProvider({ states: async () => { throw new Error('boom'); } });
    const res = await call({ provider, query: { teamId: 'team-1' } });
    assert.strictEqual(res.statusCode, 200);
  });

  test('a non-array read is treated as an empty list, not a crash', async () => {
    const provider = fakeProvider({ fetchTeams: async () => null, fetchProjectsList: async () => null });
    const res = await call({ provider });
    assert.strictEqual(res.statusCode, 200);
  });

  // LIN-2032 gap 1 (LIN-2018 review ledger item 3): mirrors the equivalent
  // addition in tests/unit/task-edit-route.test.js — the generic 'a states()
  // that throws' test above proves this route's OWN try/catch works for any
  // error; this proves the REAL JiraProvider's specific 403 (missing Browse
  // Projects permission) actually degrades through it too.
  test('a REAL Jira getProjectStatuses 403 (missing Browse Projects) still degrades to the fallback', async () => {
    const jiraClient = createFakeJiraClient({ projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }] });
    jiraClient.getProjectStatuses = async () => {
      const err = new Error('Jira API GET /rest/api/3/project/ENG/statuses failed: Forbidden — missing Browse Projects permission');
      err.status = 403;
      throw err;
    };
    // `client` (not just `clientFactory`) is set directly: this harness's
    // `scope` is the fake provider's bare 'tok' string (mirrors Linear), not a
    // Jira `{email,apiToken,site}` credential object, so `_clientFor` takes
    // its boot-configured-client fallback branch, same as a real single-tenant
    // DI setup.
    const realJiraProvider = new JiraProvider({ client: jiraClient, clientFactory: () => jiraClient, site: 'https://acme.atlassian.net' });
    const provider = fakeProvider({
      states: (scope, teamId) => realJiraProvider.states(scope, teamId),
    });
    const res = await call({ provider, query: { teamId: 'team-1' } });
    assert.strictEqual(res.statusCode, 200);
  });
});

describe('team/state circularity (Linear)', () => {
  test('states() is SKIPPED (no network call) when teamId is required and unresolved', async () => {
    let called = false;
    const provider = fakeProvider({ states: async () => { called = true; return []; } });
    await call({ provider });
    assert.strictEqual(called, false);
  });

  test('an unmatched ?teamId= does not resolve — states() is still skipped', async () => {
    let called = false;
    const provider = fakeProvider({ states: async () => { called = true; return []; } });
    await call({ provider, query: { teamId: 'does-not-exist' } });
    assert.strictEqual(called, false);
  });

  test('a MATCHED ?teamId= resolves and scopes the states() read', async () => {
    let seenTeam = 'unset';
    const provider = fakeProvider({ states: async (_scope, teamId) => { seenTeam = teamId; return []; } });
    const res = await call({ provider, query: { teamId: 'team-1' } });
    assert.strictEqual(seenTeam, 'team-1');
    assert.strictEqual(res.statusCode, 200);
  });

  test('a teamless provider (no teamId in createFields()) scopes states() with null, no team gate', async () => {
    let seenTeam = 'unset';
    const provider = fakeProvider({
      createFields: () => ['title', 'description', 'projectId', 'stateId'],
      states: async (_scope, teamId) => { seenTeam = teamId; return []; },
    });
    await call({ provider });
    assert.strictEqual(seenTeam, null);
  });
});

describe('genuine upstream failure', () => {
  test('500s (rendered error page, not a crash) when a read throws outside the per-field guards', async () => {
    // createFields() itself throwing is outside loadOptionList's try/catch —
    // exercises the route's own outer try/catch.
    const provider = fakeProvider({ createFields: () => { throw new Error('Upstream 503'); } });
    const res = await call({ provider });
    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.body.startsWith('<!DOCTYPE html>'), 'a page, not a stack trace');
  });
});
