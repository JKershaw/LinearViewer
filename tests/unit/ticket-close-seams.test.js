/**
 * LIN-3366: the four ticket-write seams that call the closer.
 *   1. PATCH /api/proxy/issues/:id            (routes/proxy-writes.js)
 *   2. PATCH /workspace/:urlKey/api/issues/:id (routes/workspace-api.js)
 *   3. the close-out check's Done write        (routes/workspace-api.js)
 *   4. POST /api/proxy/issues/:id/relations type=duplicate
 * Each is composed with the REAL `createOnTicketWrite`, so "fires" means the
 * closer is invoked: once for a terminal write, never for a non-terminal one.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { CloseOutEventsStore } from '../../lib/close-out-events-store.js';
import { createOnTicketWrite } from '../../lib/ticket-close-closer.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const tick = () => new Promise(r => setImmediate(r));
const ISSUE_UUID = '33333333-3333-3333-3333-333333333333';
const STATES = [{ id: 'state-done', name: 'Done', type: 'completed' }, { id: 'state-wip', name: 'In Progress', type: 'started' }];

function makeCloser({ reject = false } = {}) {
  const closed = [];
  const onTicketWrite = createOnTicketWrite({
    dispatchStore: {},
    closeRows: async (a) => { closed.push(a.ticket); if (reject) throw new Error('closer exploded'); return {}; }
  });
  return { onTicketWrite, closed };
}

async function http(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, text: await res.text() };
  } finally {
    await new Promise(r => server.close(r));
  }
}

// ── proxy seams (1 and 4) ───────────────────────────────────────────────────
function proxyProvider({ writtenState = (input) => STATES.find(s => s.id === input.stateId), contextState = { type: 'completed' } } = {}) {
  const reads = [];
  const provider = {
    name: 'fake', supports: () => true,
    async issueWriteGuard() { return { id: 'iss-1', trashed: false, team: { id: '11111111-1111-1111-1111-111111111111' } }; },
    async states() { return STATES; },
    async updateIssue(_t, issueId, input) {
      const state = writtenState(input);
      return { success: true, issue: { id: 'iss-1', identifier: 'ACME-1', ...(state ? { state: { type: state.type } } : {}) } };
    },
    async createRelation() { return { success: true, issueRelation: { id: 'rel-1' } }; },
    async fetchIssueContext(_t, id) { reads.push(id); return { issue: { id: 'iss-1', identifier: 'ACME-1', state: contextState } }; }
  };
  return { provider, reads };
}
function proxyApp(provider, onTicketWrite) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null, workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider, ...(onTicketWrite ? { onTicketWrite } : {})
  }));
  return app;
}

describe('seam 1: PATCH /api/proxy/issues/:id', () => {
  test('fires the closer once for a terminal write, judged by the WRITTEN type (a symbolic stateId proves nothing)', async () => {
    const { provider } = proxyProvider();
    const { onTicketWrite, closed } = makeCloser();
    const r = await http(proxyApp(provider, onTicketWrite), 'PATCH', `/api/proxy/issues/${ISSUE_UUID}`, { stateId: 'state-done' });
    await tick();
    assert.equal(r.status, 200);
    assert.deepEqual(closed, [{ issueId: 'iss-1', identifier: 'ACME-1', stateType: 'completed' }]);
  });
  test('a non-terminal write, and a write with no stateId, never reach the closer', async () => {
    const { provider } = proxyProvider();
    const { onTicketWrite, closed } = makeCloser();
    const app = proxyApp(provider, onTicketWrite);
    await http(app, 'PATCH', `/api/proxy/issues/${ISSUE_UUID}`, { stateId: 'state-wip' });
    await http(app, 'PATCH', `/api/proxy/issues/${ISSUE_UUID}`, { title: 'new title' });
    await tick();
    assert.deepEqual(closed, []);
  });
  test('a payload with no state falls back to exactly one read-back', async () => {
    const { provider, reads } = proxyProvider({ writtenState: () => null });
    const { onTicketWrite, closed } = makeCloser();
    await http(proxyApp(provider, onTicketWrite), 'PATCH', `/api/proxy/issues/${ISSUE_UUID}`, { stateId: 'state-done' });
    await tick();
    assert.equal(reads.length, 1);
    assert.equal(closed.length, 1);
  });
  test('the response body is byte-identical with the dep absent and present; a rejecting closer does not fail the request', async () => {
    const { provider } = proxyProvider();
    const absent = await http(proxyApp(provider), 'PATCH', `/api/proxy/issues/${ISSUE_UUID}`, { stateId: 'state-done' });
    const present = await http(proxyApp(provider, makeCloser().onTicketWrite), 'PATCH', `/api/proxy/issues/${ISSUE_UUID}`, { stateId: 'state-done' });
    const rejecting = await http(proxyApp(provider, makeCloser({ reject: true }).onTicketWrite), 'PATCH', `/api/proxy/issues/${ISSUE_UUID}`, { stateId: 'state-done' });
    await tick();
    assert.equal(present.text, absent.text);
    assert.equal(rejecting.status, 200);
    assert.equal(rejecting.text, absent.text);
  });
});

describe('seam 4: POST /api/proxy/issues/:id/relations', () => {
  test('type=duplicate reads the ticket back once and closes only if it is now terminal', async () => {
    const terminal = proxyProvider({ contextState: { type: 'duplicate' } });
    const a = makeCloser();
    const r = await http(proxyApp(terminal.provider, a.onTicketWrite), 'POST', `/api/proxy/issues/${ISSUE_UUID}/relations`, { type: 'duplicate', relatedIssueId: '44444444-4444-4444-4444-444444444444' });
    await tick();
    assert.equal(r.status, 201);
    assert.equal(terminal.reads.length, 1);
    assert.deepEqual(a.closed, [{ issueId: 'iss-1', identifier: 'ACME-1', stateType: 'duplicate' }]);

    const open = proxyProvider({ contextState: { type: 'started' } });
    const b = makeCloser();
    await http(proxyApp(open.provider, b.onTicketWrite), 'POST', `/api/proxy/issues/${ISSUE_UUID}/relations`, { type: 'duplicate', relatedIssueId: '44444444-4444-4444-4444-444444444444' });
    await tick();
    assert.equal(open.reads.length, 1);
    assert.deepEqual(b.closed, []);
  });
  test('blocks / related relations do not fire the seam (no read-back at all)', async () => {
    const { provider, reads } = proxyProvider({ contextState: { type: 'completed' } });
    const { onTicketWrite, closed } = makeCloser();
    const app = proxyApp(provider, onTicketWrite);
    for (const type of ['blocks', 'related']) {
      await http(app, 'POST', `/api/proxy/issues/${ISSUE_UUID}/relations`, { type, relatedIssueId: '44444444-4444-4444-4444-444444444444' });
    }
    await tick();
    assert.equal(reads.length, 0);
    assert.deepEqual(closed, []);
  });
});

// ── seam 2: session-auth PATCH ───────────────────────────────────────────────
describe('seam 2: PATCH /workspace/:urlKey/api/issues/:id', () => {
  const NAME = 'ticket-close-seam-fake';
  function app2(onTicketWrite, { state } = {}) {
    registerProvider({
      name: NAME, supports: (c) => ['updateIssue'].includes(c),
      async issueWriteGuard() { return { id: 'iss-1', trashed: false, team: { id: 'team-x' } }; },
      async states() { return STATES; },
      async updateIssue(_t, id, input) { const s = STATES.find(x => x.id === input.stateId); return { success: true, issue: { id: 'iss-1', identifier: id, ...(s || state ? { state: { type: (s || state).type } } : {}) } }; },
      async fetchIssueContext() { return { issue: { id: 'iss-1', identifier: 'LIN-5', state: { type: 'canceled' } } }; }
    });
    const app = express();
    app.use(express.json());
    app.use(createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey, provider: NAME, accessToken: 't' }; req.session = { accountId: 'a' }; next(); },
      freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {}, workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
      customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {}, reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {},
      ...(onTicketWrite ? { onTicketWrite } : {})
    }));
    return app;
  }
  test('fires once for a terminal state write, never for non-terminal or a non-state edit; the body is unchanged by the dep', async () => {
    const { onTicketWrite, closed } = makeCloser();
    const app = app2(onTicketWrite);
    const withDep = await http(app, 'PATCH', '/workspace/acme/api/issues/LIN-5', { stateId: 'state-done' });
    await http(app, 'PATCH', '/workspace/acme/api/issues/LIN-5', { stateId: 'state-wip' });
    await http(app, 'PATCH', '/workspace/acme/api/issues/LIN-5', { title: 'x' });
    await tick();
    assert.deepEqual(closed, [{ issueId: 'iss-1', identifier: 'LIN-5', stateType: 'completed' }]);
    const without = await http(app2(), 'PATCH', '/workspace/acme/api/issues/LIN-5', { stateId: 'state-done' });
    assert.equal(withDep.text, without.text);
    const rejecting = await http(app2(makeCloser({ reject: true }).onTicketWrite), 'PATCH', '/workspace/acme/api/issues/LIN-5', { stateId: 'state-done' });
    await tick();
    assert.equal(rejecting.status, 200);
  });
});

// ── seam 3: the close-out caller ─────────────────────────────────────────────
describe('seam 3: close-out check Done write', () => {
  const harness = createMangoTmpdir('lin-3366-seam3-');
  before(() => harness.connect());
  after(() => harness.close());
  const PR_A = 'https://github.com/acme/widget/pull/41';
  const merged = { readable: true, repo: 'acme/widget', number: 41, state: 'closed', merged: true, head: { ref: 'f', sha: 'aaaaaaa' }, ref: 'aaaaaaa', checks: [] };
  const reviewBody = '## Review\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | none |\n\n**Verdict: Approve**';
  const comment = (body, createdAt) => ({ body, createdAt, user: 'reviewer' });
  function build({ withMarkDone, onTicketWrite }) {
    const collection = harness.freshDb().collection('close-out-events');
    const provider = {
      async fetchIssueComments() { return [comment(PR_A, '2026-07-01T00:00:00.000Z'), comment(reviewBody, '2026-07-02T00:00:00.000Z')]; },
      async fetchIssueContext() { return { issue: { id: 'iss-1', identifier: 'LIN-1', team: { id: 'team-1' }, state: { type: 'completed' } } }; },
      async issueWriteGuard() { return { team: { id: 'team-1' } }; },
      async states() { return [{ id: 'st-done', name: 'Done', type: 'completed' }]; },
      async updateIssue(_s, id) { return { success: true, issue: { id, identifier: 'LIN-1', state: { type: 'completed' } } }; }
    };
    const router = createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      closeOutEventsStore: new CloseOutEventsStore({ collection }),
      onTicketWrite,
      closeOut: {
        resolveProvider: () => ({ provider, callScope: 'scope' }),
        readPrStatus: async () => merged, isStopAtRun: async () => 'pr', runnerReady: () => true,
        ...(withMarkDone ? { markDone: withMarkDone } : {})
      }
    });
    return router;
  }
  async function check(router) {
    const layer = router.stack.find(l => l.route?.path === '/workspace/:urlKey/api/run-evidence/:issueIdentifier/check' && l.route.methods.post);
    const res = { statusCode: 200, jsonBody: null, status(c) { this.statusCode = c; return this; }, json(b) { this.jsonBody = b; return this; } };
    await layer.route.stack[layer.route.stack.length - 1].handle({
      session: { accountId: 'acct-1', workspaces: ['ws'] }, workspace: { urlKey: 'ws', id: 'ws', accessToken: 't' },
      params: { urlKey: 'ws', issueIdentifier: 'LIN-1' }, query: {}, body: {}
    }, res, (e) => { if (e) throw e; });
    return res;
  }

  test('fires with the default markDone (its {success, issue} payload is unwrapped; no read-back needed), and exactly once per merge', async () => {
    const { onTicketWrite, closed } = makeCloser();
    const router = build({ onTicketWrite });
    const first = await check(router);
    await check(router);
    await check(router);
    await tick();
    assert.equal(first.jsonBody.done, true);
    assert.deepEqual(closed, [{ issueId: 'iss-1', identifier: 'LIN-1', stateType: 'completed' }], 'doneAt branch never re-fires');
  });
  test('fires with a seam.markDone that returns nothing (one read-back), and not when Done was not written', async () => {
    const { onTicketWrite, closed } = makeCloser();
    await check(build({ onTicketWrite, withMarkDone: async () => undefined }));
    await tick();
    assert.equal(closed.length, 1);
  });
  test('a failed Done write does not fire the closer', async () => {
    const { onTicketWrite, closed } = makeCloser();
    const res = await check(build({ onTicketWrite, withMarkDone: async () => { throw new Error('down'); } }));
    await tick();
    assert.equal(res.jsonBody.done, false);
    assert.deepEqual(closed, []);
  });
});
