/**
 * LIN-3383 — the Dispatch route and Collective are owner-only for runner targets.
 *
 * (The other gated entries are covered beside their own fixtures:
 *  feedback-route.test.js, lin-3254-run-proposals-apply.test.js,
 *  lin-3254-follow-up-dispatch-extraction.test.js, lin-3254-run-scoped-chat.test.js.)
 *
 * For each: a non-owner member is refused and the store is never written; the
 * owner still enqueues; dash/local keep today's behaviour.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createCollectiveRoutes } from '../../routes/collective.js';

const OWNER_WS = { urlKey: 'alpha', name: 'Alpha', id: 'ws-alpha' };
const OTHER_WS = { urlKey: 'bravo', name: 'Bravo', id: 'ws-bravo' };
const UUID = '11111111-2222-4333-8444-555555555555';

/** Owner of ws-alpha is acct-owner; nobody we know owns ws-bravo's runner. */
const owners = { 'ws-alpha': 'acct-owner', 'ws-bravo': 'acct-someone-else' };
const ownerCheck = async ({ workspaceId, accountId }) => {
  const owner = owners[workspaceId];
  if (!owner) return { status: 'no-owner' };
  return { status: owner === accountId ? 'owner' : 'not-owner' };
};

function makeQueue() {
  const calls = { addItem: [], expandCascadeAborts: [] };
  return {
    calls,
    store: {
      async addItem(urlKey, item) { calls.addItem.push({ urlKey, item }); return { _id: `d${calls.addItem.length}`, dispatchedAt: '2026-10-08T00:00:00.000Z', ...item }; },
      async getGrantDeclaration() { return { state: 'none' }; },
      async getItemStatus() { return null; },
      async expandCascadeAborts(urlKey, root, opts) { calls.expandCascadeAborts.push({ urlKey, root, opts }); return { aborted: [] }; }
    }
  };
}

async function call(app, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(r => server.close(r));
  }
}

function dispatchApp({ queue, accountId, check = ownerCheck }) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: queue.store,
    dispatchTokenStore: {},
    workspaceOwnerCheck: check,
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, id: 'ws-alpha' };
      req.session = { accountId, linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null
  }));
  return app;
}

const PATH = '/workspace/alpha/api/dispatch';
const WIRE = (res) => ({ status: res.status, code: res.body.code, category: res.body.category, retryable: res.body.retryable, error: res.body.error });

describe('LIN-3383 — POST /workspace/:urlKey/api/dispatch', () => {
  const requests = [
    ['a fresh dispatch (no target = cli)', { prompt: 'do it' }],
    ['a fresh dispatch to web', { prompt: 'do it', target: 'web' }],
    ['a follow-up', { prompt: 'again', followUpTo: UUID }],
    ['an abort', { abort: true, abortTo: UUID }],
    ['a cascade abort', { abort: true, abortTo: UUID, cascade: true }]
  ];

  for (const [name, body] of requests) {
    test(`${name}: a non-owner is refused 403 and nothing is written`, async () => {
      const queue = makeQueue();
      const res = await call(dispatchApp({ queue, accountId: 'acct-member' }), PATH, body);
      assert.deepEqual(WIRE(res), {
        status: 403,
        code: 'RUNNER_ENQUEUE_OWNER_ONLY',
        category: 'auth',
        retryable: false,
        error: "Only this workspace's owner can queue work for its runner."
      });
      assert.equal(queue.calls.addItem.length, 0, 'addItem never called');
      assert.equal(queue.calls.expandCascadeAborts.length, 0, 'expandCascadeAborts never called');
    });

    test(`${name}: the owner still enqueues`, async () => {
      const queue = makeQueue();
      const res = await call(dispatchApp({ queue, accountId: 'acct-owner' }), PATH, body);
      assert.ok(res.status === 201 || res.status === 200, JSON.stringify(res.body));
      assert.equal(queue.calls.addItem.length + queue.calls.expandCascadeAborts.length, 1);
    });
  }

  test('dash is unchanged for a non-owner: a dash dispatch and a dash abort still enqueue', async () => {
    const queue = makeQueue();
    const app = dispatchApp({ queue, accountId: 'acct-member' });
    const fresh = await call(app, PATH, { prompt: 'dash run', target: 'dash' });
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
    const abort = await call(app, PATH, { abort: true, abortTo: UUID, target: 'dash' });
    assert.equal(abort.status, 201, JSON.stringify(abort.body));
    assert.equal(queue.calls.addItem.length, 2);
  });

  test('a seam that is unwired or throws fails closed (503), nothing written', async () => {
    for (const check of [null, async () => { throw new Error('down'); }]) {
      const queue = makeQueue();
      const res = await call(dispatchApp({ queue, accountId: 'acct-owner', check }), PATH, { prompt: 'x' });
      assert.equal(res.status, 503);
      assert.equal(res.body.code, 'OWNER_CHECK_UNAVAILABLE');
      assert.equal(queue.calls.addItem.length, 0);
    }
  });

  test('no session account fails closed (503 GRANT_OWNERLESS)', async () => {
    const queue = makeQueue();
    const res = await call(dispatchApp({ queue, accountId: undefined }), PATH, { prompt: 'x' });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'GRANT_OWNERLESS');
    assert.equal(queue.calls.addItem.length, 0);
  });

  test('a body-supplied workspace or account cannot choose who is checked', async () => {
    const queue = makeQueue();
    const res = await call(dispatchApp({ queue, accountId: 'acct-member' }), PATH, { prompt: 'x', workspaceId: 'ws-alpha', accountId: 'acct-owner', dispatchedBy: 'acct-owner' });
    assert.equal(res.status, 403);
    assert.equal(queue.calls.addItem.length, 0);
  });
});

describe('LIN-3383 — POST /workspace/:urlKey/collective/start', () => {
  function collectiveApp({ queue, accountId }) {
    const app = express();
    app.use(express.json());
    app.use(createCollectiveRoutes({
      workspaceOwnerCheck: ownerCheck,
      dispatchQueueStore: queue.store,
      proxyTokenStore: null,
      yapClient: { baseUrl: 'https://yap.test' },
      getOpenRouterSource: () => null,
      getDeployInfo: () => ({}),
      workspacePreferencesStore: undefined,
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: req.params.urlKey };
        req.session = { accountId, features: { collective: true }, workspaces: [OWNER_WS, OTHER_WS] };
        next();
      }
    }));
    return app;
  }
  const START = '/workspace/alpha/collective/start';
  const characters = [{ workspaceUrlKey: 'alpha' }, { workspaceUrlKey: 'bravo' }];

  test('only the participant the session does not own is ok:false; the owned seat still launches', async () => {
    const queue = makeQueue();
    const res = await call(collectiveApp({ queue, accountId: 'acct-owner' }), START, { channel: '#room', characters, target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const byKey = Object.fromEntries(res.body.dispatched.map(d => [d.urlKey, d]));
    assert.equal(byKey.alpha.ok, true);
    assert.equal(byKey.bravo.ok, false);
    assert.equal(byKey.bravo.code, 'RUNNER_ENQUEUE_OWNER_ONLY');
    assert.deepEqual(queue.calls.addItem.map(c => c.urlKey), ['alpha'], 'nothing enqueued for the unowned workspace');
  });

  test('a non-owner of every seat launches nothing', async () => {
    const queue = makeQueue();
    const res = await call(collectiveApp({ queue, accountId: 'acct-member' }), START, { channel: '#room', characters, target: 'web' });
    assert.equal(res.status, 201);
    assert.ok(res.body.dispatched.every(d => d.ok === false && d.code === 'RUNNER_ENQUEUE_OWNER_ONLY'));
    assert.equal(queue.calls.addItem.length, 0);
  });
});
