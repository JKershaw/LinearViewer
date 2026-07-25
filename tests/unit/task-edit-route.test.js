/**
 * Unit tests for routes/task-edit.js (LIN-1565).
 *
 * Run with: node --test tests/unit/task-edit-route.test.js
 *
 * Exercises the handler directly (bypassing the workspaceFromUrl middleware)
 * against a fake provider registered in the real registry — the pattern
 * tests/unit/dashboard-routes.test.js uses for the sibling drill-down page.
 *
 * The branches worth pinning are the ones a happy-path E2E can never reach:
 *   - `ui.inlineEdit` false → redirect to the dashboard (NOT to Settings; this
 *     is a drill-down page, so there is nothing for a user to enable)
 *   - a malformed id → 400 before any provider read
 *   - an unknown id → 404 with a rendered body, never a crash
 *   - `states()` throwing or being unsupported → still 200, degraded to the
 *     text input. This is the guard that keeps the dropdown from being able to
 *     take the page down, and it is the reason the read is BOTH capability-gated
 *     and try/caught.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createTaskEditRoutes } from '../../routes/task-edit.js';
import { registerProvider } from '../../lib/providers/registry.js';
// Side-effect import: the shared nav resolves the legacy default provider.
import '../../lib/providers/linear/index.js';

const ISSUE = {
  id: '11111111-2222-3333-4444-555555555555',
  identifier: 'LIN-42',
  title: 'Fix the thing',
  description: 'body',
  state: { name: 'In Progress', type: 'started' },
  priority: 2,
  team: { id: 'team-1' },
};

/**
 * Register a fake provider under a unique name and return that name, so tests
 * never contend over one shared registry slot.
 */
let providerSeq = 0;
function fakeProvider({
  inlineEdit = true,
  supportsStates = true,
  states = async () => [{ id: 'started', name: 'In Progress', position: 2 }],
  fetchIssueFields = async () => ISSUE,
} = {}) {
  const name = `fake-task-edit-${++providerSeq}`;
  registerProvider({
    name,
    ui: { inlineEdit },
    supports: (cap) => (cap === 'states' ? supportsStates : true),
    states,
    fetchIssueFields,
  });
  return name;
}

function getHandler(router) {
  const layer = router.stack.find(l => l.route?.path === '/workspace/:urlKey/task/:issueId/edit' && l.route.methods.get);
  assert.ok(layer, 'GET /workspace/:urlKey/task/:issueId/edit is registered');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRouter() {
  return createTaskEditRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({}),
  });
}

async function call({ provider, urlKey = 'acme', issueId = ISSUE.id }) {
  const req = {
    session: { workspaces: [], features: {} },
    workspace: { urlKey, provider, accessToken: 'tok' },
    params: { urlKey, issueId },
    query: {},
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

describe('GET /workspace/:urlKey/task/:issueId/edit', () => {
  test('renders the edit page for a provider with in-app edit support', async () => {
    const res = await call({ provider: fakeProvider() });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.includes('data-testid="task-edit-form"'));
    assert.ok(res.body.includes(`data-issue-id="${ISSUE.id}"`));
  });

  test('resolves an identifier as readily as a UUID (no resolver hop)', async () => {
    let seen = null;
    const provider = fakeProvider({ fetchIssueFields: async (_scope, id) => { seen = id; return ISSUE; } });
    const res = await call({ provider, issueId: 'LIN-42' });
    assert.strictEqual(seen, 'LIN-42', 'the raw param is handed to the provider unchanged');
    assert.strictEqual(res.statusCode, 200);
    // …but the form still carries the canonical id from the fetched record.
    assert.ok(res.body.includes(`data-issue-id="${ISSUE.id}"`));
  });

  test('redirects to the DASHBOARD (not Settings) when ui.inlineEdit is false', async () => {
    const res = await call({ provider: fakeProvider({ inlineEdit: false }) });
    assert.strictEqual(res.redirectedTo, '/workspace/acme/');
    assert.strictEqual(res.body, null, 'no page is rendered for a read-only provider');
  });

  test('gates BEFORE the provider read (a read-only provider costs no round trip)', async () => {
    let called = false;
    const provider = fakeProvider({
      inlineEdit: false,
      fetchIssueFields: async () => { called = true; return ISSUE; },
    });
    await call({ provider });
    assert.strictEqual(called, false);
  });

  test('400s a malformed issue id before any provider read', async () => {
    let called = false;
    const provider = fakeProvider({ fetchIssueFields: async () => { called = true; return ISSUE; } });
    const res = await call({ provider, issueId: 'not a valid id!' });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(called, false);
  });

  test('404s an unknown / cross-workspace issue with a rendered body', async () => {
    const provider = fakeProvider({
      fetchIssueFields: async (_scope, id) => { throw new Error(`Issue not found: ${id}`); },
    });
    const res = await call({ provider, issueId: 'LIN-999' });
    assert.strictEqual(res.statusCode, 404);
    assert.ok(res.body.includes('data-testid="task-edit-not-found"'));
    assert.ok(res.body.startsWith('<!DOCTYPE html>'), 'a page, not a stack trace');
  });

  test('500s (not 404s) a genuine upstream failure', async () => {
    const provider = fakeProvider({
      fetchIssueFields: async () => { throw new Error('Upstream 503'); },
    });
    const res = await call({ provider });
    assert.strictEqual(res.statusCode, 500);
  });
});

describe('state control degradation', () => {
  test('a states() that throws still renders 200 with the text-input fallback', async () => {
    const provider = fakeProvider({ states: async () => { throw new Error('boom'); } });
    const res = await call({ provider });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(/<input[^>]*name="stateId"/.test(res.body), 'degraded to the text input');
    assert.ok(!/<select[^>]*name="stateId"/.test(res.body));
  });

  test('a provider that does not declare states() renders the text-input fallback', async () => {
    let called = false;
    const provider = fakeProvider({
      supportsStates: false,
      states: async () => { called = true; return []; },
    });
    const res = await call({ provider });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(called, false, 'the capability gate short-circuits the read');
    assert.ok(/<input[^>]*name="stateId"/.test(res.body));
  });

  test('a states() returning a non-array is treated as no states', async () => {
    const provider = fakeProvider({ states: async () => null });
    const res = await call({ provider });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(/<input[^>]*name="stateId"/.test(res.body));
  });

  test('passes the issue\'s team id through to states() (Linear needs a non-null team)', async () => {
    let seenTeam = 'unset';
    const provider = fakeProvider({ states: async (_scope, teamId) => { seenTeam = teamId; return []; } });
    await call({ provider });
    assert.strictEqual(seenTeam, 'team-1');
  });

  test('passes null when the issue carries no team, without throwing', async () => {
    let seenTeam = 'unset';
    const provider = fakeProvider({
      fetchIssueFields: async () => ({ ...ISSUE, team: undefined }),
      states: async (_scope, teamId) => { seenTeam = teamId; return []; },
    });
    const res = await call({ provider });
    assert.strictEqual(seenTeam, null);
    assert.strictEqual(res.statusCode, 200);
  });

  test('renders a real <select> when states are available', async () => {
    const res = await call({ provider: fakeProvider() });
    assert.ok(/<select[^>]*name="stateId"/.test(res.body));
  });
});
