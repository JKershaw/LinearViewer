/**
 * LIN-2975 — route-level: POST /api/proxy/dispatch accepts an optional
 * `maxTasks` (int >= 1), validating with the exact rule/text
 * routes/dispatch.js already uses, storing it on the created item, and
 * echoing it on the 201 — parity with the session-authenticated route. Before
 * this fix the proxy route silently dropped `maxTasks`, so a launcher could
 * never declare a runner's task pool through the proxy: the field was
 * accepted, ignored, and never persisted.
 *
 * Scaffolded like proxy-kickoff-max-tasks.test.js (installHermeticLinearTransport
 * + a real DispatchQueueStore over createMockCollection + the `test-token`
 * sentinel so the LIN-2886 repo guard's fail-open path is exercised rather
 * than a live Linear call), but targets POST /api/proxy/dispatch itself
 * rather than the kickoff verb.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// LIN-1880: see proxy-kickoff-max-tasks.test.js's identical note — never
// restored for the life of this file, so the dispatch referent guard stays
// fail-open here too.
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function buildApp({ dispatchQueueStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      createToken: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const DISPATCH = '/api/proxy/dispatch';

// Wraps a mock collection's insertOne with a call counter, so a 400 test can
// assert addItem never wrote anything (LIN-2975's pre-write-guard placement).
function makeSpiedStore() {
  const collection = createMockCollection();
  let insertCount = 0;
  const originalInsertOne = collection.insertOne.bind(collection);
  collection.insertOne = async (...args) => {
    insertCount++;
    return originalInsertOne(...args);
  };
  const store = new DispatchQueueStore({ collection, historyCollection: createMockCollection() });
  return { store, getInsertCount: () => insertCount };
}

describe('LIN-2975 — POST /api/proxy/dispatch maxTasks validation', () => {
  test('no maxTasks at all: stored null, byte-identical to today', async () => {
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.maxTasks, null);
  });

  test('maxTasks: null is accepted and treated as no budget', async () => {
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli', maxTasks: null });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.maxTasks, null);
  });

  test('a valid integer maxTasks is accepted, stored, and echoed on the 201', async () => {
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli', maxTasks: 5 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.maxTasks, 5);

    const stored = await store.getItemStatus('acme', res.body.id);
    assert.equal(stored.maxTasks, 5);
  });

  for (const bad of [0, -1, 1.5, '5', true, {}, []]) {
    test(`maxTasks: ${JSON.stringify(bad)} is rejected 400 with the exact text, and addItem never runs`, async () => {
      const { store, getInsertCount } = makeSpiedStore();
      const app = buildApp({ dispatchQueueStore: store });
      const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli', maxTasks: bad });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.error, 'maxTasks must be an integer >= 1');
      assert.equal(getInsertCount(), 0, 'addItem must not write on a rejected maxTasks');
    });
  }
});

describe('LIN-2975 — end-to-end: a custom run declares a pool through the proxy', () => {
  test('a custom run with maxTasks: 2 admits two distinct sessionId-stamped workers, then refuses a third', async () => {
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store });

    // The launcher declares the pool on a plain custom dispatch — exactly the
    // passage-runner launch shape this ticket was filed over (no kickoff verb
    // involved, proving proxy POST /dispatch alone can now bound a run).
    const run = await call(app, 'post', DISPATCH, { prompt: 'launch the runner', target: 'cli', maxTasks: 2 });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    assert.equal(run.body.maxTasks, 2);
    const sessionId = run.body.id;

    const t1 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));

    const t2 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-2', target: 'cli', sessionId
    });
    assert.equal(t2.status, 201, JSON.stringify(t2.body));

    const t3 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-3', target: 'cli', sessionId
    });
    assert.equal(t3.status, 409, JSON.stringify(t3.body));
    assert.equal(t3.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(t3.body.maxTasks, 2);
    assert.equal(t3.body.sessionId, sessionId);
  });
});
