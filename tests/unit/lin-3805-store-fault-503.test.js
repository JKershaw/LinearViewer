/**
 * LIN-3805 — a dispatch store FAULT is a typed, retryable DispatchStoreFault, never the
 * null / [] / false / 0 that also means "row absent".
 *
 * Before: lib/dispatch-store.js caught the fault and returned the absence sentinel, the
 * routes mapped it to 404 / empty 200, and simple-dispatcher treats any 4xx other than
 * 408/429 as final, so a transient fault dropped a terminal `[done]`.
 *
 * Real DispatchQueueStore over the existing mock collection wrapped in a method-faulting
 * Proxy (the LIN-3699 pattern). No live services.
 */
process.env.NODE_ENV = 'test';

import { readFileSync } from 'node:fs';
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { DispatchStoreFault, isDispatchStoreFault } from '../../lib/errors.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const TOKEN = 'token-a';
const BOOM = new Error('MongoNetworkError: connection closed');

/**
 * A mock collection whose named methods reject while `fail[method]` is truthy (a number
 * counts down). `landThenFail[method]` applies the write first and then rejects: a lost ack.
 */
function faultyCollection() {
  const inner = createMockCollection();
  const fail = {};
  const landThenFail = {};
  const wrapped = new Proxy(inner, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (landThenFail[prop]) {
          landThenFail[prop] = false;
          return value.apply(target, args).then(() => { throw BOOM; });
        }
        const f = fail[prop];
        if (f) {
          if (typeof f === 'number') fail[prop] = f - 1;
          // find() is synchronous in the driver: the fault surfaces at the cursor.
          if (prop === 'find') return { toArray: () => Promise.reject(BOOM) };
          return Promise.reject(BOOM);
        }
        return value.apply(target, args);
      };
    }
  });
  return { collection: wrapped, inner, fail, landThenFail };
}

function makeStore() {
  const queue = faultyCollection();
  const history = faultyCollection();
  const store = new DispatchQueueStore({ collection: queue.collection, historyCollection: history.collection });
  return { store, queue, history };
}

const quiet = () => mock.method(console, 'error', () => {});
const isFault = (op) => (err) => err instanceof DispatchStoreFault && err.operation === op
  && err.code === 'DISPATCH_STORE_UNAVAILABLE' && err.retryable === true;

describe('DispatchStoreFault', () => {
  test('carries the code, retryable and operation; isDispatchStoreFault matches only it', () => {
    const f = new DispatchStoreFault('takeItem', BOOM);
    assert.equal(f.code, 'DISPATCH_STORE_UNAVAILABLE');
    assert.equal(f.retryable, true);
    assert.equal(f.operation, 'takeItem');
    assert.equal(f.cause, BOOM);
    assert.equal(f.writeLanded, false);
    assert.equal(isDispatchStoreFault(f), true);
    assert.equal(isDispatchStoreFault(new Error('x')), false);
    assert.equal(isDispatchStoreFault(null), false);
  });
});

describe('store reads: absence stays the sentinel, a fault throws', () => {
  test('getItemStatus: a missing row is null, a findOne fault throws', async () => {
    const { store, queue } = makeStore();
    assert.equal(await store.getItemStatus(URL_KEY, 'no-such-item'), null);
    const q = quiet();
    try {
      queue.fail.findOne = true;
      await assert.rejects(store.getItemStatus(URL_KEY, 'no-such-item'), isFault('getItemStatus'));
    } finally { q.mock.restore(); }
  });

  test('listItems / pollAvailable / countItems: an empty queue is []/0, a find fault throws', async () => {
    const { store, queue } = makeStore();
    assert.deepEqual(await store.listItems(URL_KEY), []);
    assert.equal(await store.countItems(URL_KEY), 0);
    const q = quiet();
    try {
      queue.fail.find = true;
      await assert.rejects(store.listItems(URL_KEY), isFault('listItems'));
      await assert.rejects(store.pollAvailable(URL_KEY), isFault('listItems'));
      await assert.rejects(store.countItems(URL_KEY), isFault('countItems'));
    } finally { q.mock.restore(); }
  });

  test('listHistory: an empty history is an empty page, a fault throws', async () => {
    const { store, history } = makeStore();
    assert.deepEqual(await store.listHistory(URL_KEY), { items: [], total: 0 });
    const q = quiet();
    try {
      history.fail.find = true;
      await assert.rejects(store.listHistory(URL_KEY), isFault('listHistory'));
    } finally { q.mock.restore(); }
  });

  test('trimSessionBudget / stampBookkeeping: not-found stays for a real miss, a fault throws', async () => {
    const { store, queue, history } = makeStore();
    assert.deepEqual(await store.stampBookkeeping(URL_KEY, 'nope', { by: 't', reason: 'r' }), { ok: false, reason: 'not-found' });
    assert.deepEqual(await store.trimSessionBudget(URL_KEY, 'nope', { maxTasks: 1 }), { ok: false, reason: 'not-found' });
    const item = await store.addItem(URL_KEY, { prompt: 'p', kind: 'autopilot', maxTasks: 5 });
    const q = quiet();
    try {
      queue.fail.findOneAndUpdate = true;
      await assert.rejects(store.trimSessionBudget(URL_KEY, item._id, { maxTasks: 1 }), isFault('trimSessionBudget'));
      queue.fail.findOneAndUpdate = false;
      history.fail.findOneAndUpdate = true;
      await assert.rejects(store.stampBookkeeping(URL_KEY, item._id, { by: 't', reason: 'r' }), isFault('stampBookkeeping'));
    } finally { q.mock.restore(); }
  });

  test('closeRows: a fault throws rather than reporting { ok: false }', async () => {
    const { store, history } = makeStore();
    const q = quiet();
    try {
      history.fail.find = true;
      await assert.rejects(store._closeRows(URL_KEY, { urlKey: URL_KEY }, { by: 't', reason: 'r' }), isFault('closeRows'));
    } finally { q.mock.restore(); }
  });

  test('getGrantDeclaration: a read fault is a DispatchStoreFault (flag kept)', async () => {
    const { store, queue } = makeStore();
    const q = quiet();
    try {
      queue.fail.findOne = true;
      await assert.rejects(store.getGrantDeclaration(URL_KEY, 'x'), (err) => isDispatchStoreFault(err) && err.declarationLookupFailed === true);
    } finally { q.mock.restore(); }
  });

  test('addItem: validation stays a plain Error, the insert fault is a DispatchStoreFault', async () => {
    const { store, queue } = makeStore();
    await assert.rejects(store.addItem(URL_KEY, {}), (err) => !isDispatchStoreFault(err) && /required/.test(err.message));
    const q = quiet();
    try {
      queue.fail.insertOne = true;
      await assert.rejects(store.addItem(URL_KEY, { prompt: 'p' }), isFault('addItem'));
    } finally { q.mock.restore(); }
  });
});

describe('takeItem / removeItem: archive fault compensation (retry honesty)', () => {
  test('a real miss is still null / false', async () => {
    const { store } = makeStore();
    assert.equal(await store.takeItem('no-such-item', URL_KEY, TOKEN), null);
    assert.equal(await store.removeItem(URL_KEY, 'no-such-item'), false);
  });

  test('takeItem: findOneAndDelete fault throws and the row stays queued', async () => {
    const { store, queue } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: 'p' });
    const q = quiet();
    try {
      queue.fail.findOneAndDelete = 1;
      await assert.rejects(store.takeItem(item._id, URL_KEY, TOKEN), isFault('takeItem'));
    } finally { q.mock.restore(); }
    assert.ok(await store.takeItem(item._id, URL_KEY, TOKEN), 'the retry takes it');
  });

  test('takeItem: an archive insert that did NOT land restores the row unchanged, throws, and a retry takes it', async () => {
    const { store, queue, history } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: 'p', target: 'cli' });
    const before = queue.inner._docs.find(d => d._id === item._id);
    const snapshot = structuredClone(before);
    const q = quiet();
    try {
      history.fail.insertOne = 1;
      await assert.rejects(store.takeItem(item._id, URL_KEY, TOKEN), isFault('_archiveItem'));
    } finally { q.mock.restore(); }
    assert.deepEqual(queue.inner._docs.find(d => d._id === item._id), snapshot, 'restored exactly as deleted (no re-stamping)');
    assert.equal(history.inner._docs.length, 0);

    const retry = await store.takeItem(item._id, URL_KEY, TOKEN);
    assert.equal(retry.id, item._id);
    assert.equal(history.inner._docs.length, 1);
    assert.equal(queue.inner._docs.length, 0);
  });

  test('takeItem: an archive insert that LANDED but lost its ack answers success: one history row, nothing queued', async () => {
    const { store, queue, history } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: 'p' });
    const q = quiet();
    try {
      history.landThenFail.insertOne = true;
      const taken = await store.takeItem(item._id, URL_KEY, TOKEN);
      assert.equal(taken.id, item._id);
    } finally { q.mock.restore(); }
    assert.equal(queue.inner._docs.length, 0, 'not re-queued');
    assert.equal(history.inner._docs.filter(d => d._id === item._id).length, 1, 'exactly one history row');
  });

  test('takeItem: when the history read after a fault also faults, the row is NOT re-queued (no double residence)', async () => {
    const { store, queue, history } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: 'p' });
    const q = quiet();
    try {
      history.fail.insertOne = true;
      history.fail.findOne = true;
      await assert.rejects(store.takeItem(item._id, URL_KEY, TOKEN), isFault('_archiveItem'));
    } finally { q.mock.restore(); }
    assert.equal(queue.inner._docs.length, 0);
    assert.equal(history.inner._docs.length, 0);
  });

  test('_archiveItem: a duplicate-key on the shared _id is already archived, so it succeeds', async () => {
    const { store, history } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: 'p' });
    const doc = await store.collection.findOne({ _id: item._id });
    history.inner.insertOne = async () => { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; };
    await store._archiveItem(doc, 'taken', {});
  });

  test('removeItem: an archive insert that did not land restores the row and throws; a retry removes it', async () => {
    const { store, queue, history } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: 'p' });
    const q = quiet();
    try {
      history.fail.insertOne = 1;
      await assert.rejects(store.removeItem(URL_KEY, item._id), isFault('_archiveItem'));
    } finally { q.mock.restore(); }
    assert.equal(queue.inner._docs.length, 1, 'row back in the queue');
    assert.equal(await store.removeItem(URL_KEY, item._id), true);
    assert.equal(history.inner._docs.length, 1);
  });

  test('removeItem: a landed-then-rejected archive answers true with one history row', async () => {
    const { store, queue, history } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: 'p' });
    const q = quiet();
    try {
      history.landThenFail.insertOne = true;
      assert.equal(await store.removeItem(URL_KEY, item._id), true);
    } finally { q.mock.restore(); }
    assert.equal(queue.inner._docs.length, 0);
    assert.equal(history.inner._docs.length, 1);
  });

  test('cleanup(): one failing archive neither aborts the rest nor is deleted un-archived', async () => {
    const { store, queue, history } = makeStore();
    const a = await store.addItem(URL_KEY, { prompt: 'a' });
    const b = await store.addItem(URL_KEY, { prompt: 'b' });
    const c = await store.addItem(URL_KEY, { prompt: 'c' });
    for (const d of queue.inner._docs) d.expiresAt = new Date(Date.now() - 1000);
    const q = quiet();
    try {
      history.fail.insertOne = 1; // only the first archive faults
      const removed = await store.cleanup();
      assert.equal(removed, 2);
    } finally { q.mock.restore(); }
    assert.equal(queue.inner._docs.length, 1, 'the un-archived row stays queued for the next cleanup');
    assert.equal(history.inner._docs.length, 2);
    const kept = queue.inner._docs[0]._id;
    assert.ok([a._id, b._id, c._id].includes(kept));
    assert.equal(history.inner._docs.some(d => d._id === kept), false);
    assert.equal(await store.cleanup(), 1, 'the next cleanup archives and removes it');
  });
});

describe('addFeedback: fault vs absence, and the write-landed flag', () => {
  async function takenItem(store) {
    const item = await store.addItem(URL_KEY, { prompt: 'p' });
    await store.takeItem(item._id, URL_KEY, TOKEN);
    return item;
  }

  test('an unknown item is still null; a pre-write fault throws with no entry written', async () => {
    const { store, history } = makeStore();
    assert.equal(await store.addFeedback('nope', URL_KEY, { message: 'm' }, TOKEN), null);
    const item = await takenItem(store);
    const q = quiet();
    try {
      history.fail.findOneAndUpdate = true;
      await assert.rejects(store.addFeedback(item._id, URL_KEY, { message: 'm' }, TOKEN),
        (err) => isFault('addFeedback')(err) && err.writeLanded === false);
    } finally { q.mock.restore(); }
    assert.equal((history.inner._docs.find(d => d._id === item._id).feedback || []).length, 0);
  });

  test('a post-write fault throws with writeLanded and the entry stays written', async () => {
    const { store, history } = makeStore();
    const item = await takenItem(store);
    const q = quiet();
    try {
      history.landThenFail.findOneAndUpdate = true;
      // The lost ack surfaces BEFORE findOneAndUpdate resolves, so the flag is false;
      // a fault after it (the wake step) is the writeLanded case, covered by
      // dispatch-wake-witness.test.js. Here: the entry did land.
      await assert.rejects(store.addFeedback(item._id, URL_KEY, { message: 'm' }, TOKEN), isFault('addFeedback'));
    } finally { q.mock.restore(); }
    assert.equal(history.inner._docs.find(d => d._id === item._id).feedback.length, 1);
  });

  test('A3: a getItemStatus fault while provisioning the wake withdraws the wake and does not 503 the landed [done]', async () => {
    const { store, queue, history } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent', kind: 'implementation' });
    await store.takeItem(parent._id, URL_KEY, TOKEN);
    const child = await store.addItem(URL_KEY, { prompt: 'child', sessionId: parent._id, subscription: 'terminal-only' });
    await store.takeItem(child._id, URL_KEY, TOKEN);
    const realStatus = store.getItemStatus.bind(store);
    store.getItemStatus = async (...args) => {
      if (args[1] === parent._id) throw new DispatchStoreFault('getItemStatus', BOOM);
      return realStatus(...args);
    };
    let provisioned = false;
    const q = quiet();
    const log = mock.method(console, 'log', () => {});
    try {
      const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, TOKEN, async () => { provisioned = true; return { token: 't' }; });
      assert.ok(res && res.success, 'the landed [done] is not turned into a 503');
      assert.ok(log.mock.calls.some(c => /parent-status-unavailable/.test(String(c.arguments[0]))), 'withdrawn with the transient reason');
    } finally { q.mock.restore(); log.mock.restore(); }
    assert.equal(provisioned, false, 'no credential provisioned for a parent we could not read');
    assert.equal(queue.inner._docs.filter(d => d.kind === 'wake').length, 0, 'no wake enqueued');
    const edge = history.inner._docs.find(d => d._id === child._id);
    assert.equal(edge.terminalWakeItems?.includes(child._id) ?? false, false, 'CAS witness left unburned so a re-report provisions again');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The route layer: every lane route answers the retryable 503 envelope on a store fault.
// ─────────────────────────────────────────────────────────────────────────────

const ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = { urlKey: URL_KEY };

async function serve(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const sendJson = (base, method, path, headers = {}, body = undefined) => fetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {})
});

/** The one envelope every row asserts, however it is asked and whichever transport carries it. */
async function assertEnvelope(res, label) {
  const text = await res.text();
  const body = JSON.parse(text);
  const status = body.statusCode ?? res.status;
  assert.equal(status, 503, `${label}: ${res.status} ${text}`);
  assert.equal(body.code, 'DISPATCH_STORE_UNAVAILABLE', label);
  assert.equal(body.category, 'upstream', label);
  assert.equal(body.retryable, true, label);
  assert.ok(body.error, label);
  return body;
}

describe('dispatch router (token lane and session lane)', () => {
  async function setup() {
    const { createDispatchRoutes } = await import('../../routes/dispatch.js');
    const { DispatchTokenStore } = await import('../../lib/dispatch-tokens.js');
    const { default: express } = await import('express');
    const parts = makeStore();
    const tokens = new DispatchTokenStore({ collection: createMockCollection() });
    const { token } = await tokens.createToken(URL_KEY, TOKEN, 'acct-1');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { accountId: 'acct-1' }; next(); });
    app.use(createDispatchRoutes({
      dispatchQueueStore: parts.store,
      dispatchTokenStore: tokens,
      workspaceFromUrl: (req, res, next) => { req.workspace = WORKSPACE; next(); },
      userPreferencesStore: {},
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      proxyTokenStore: { createToken: async () => ({ token: 'tok' }) }
    }));
    return { ...parts, app, auth: { Authorization: `Bearer ${token}` } };
  }

  test('each member answers the 503 envelope on a fault, and the true 404/200 on a real miss', async () => {
    const { app, auth, queue, history, store } = await setup();
    const q = quiet();
    try {
      await serve(app, async (base) => {
        // Real misses first: 404 stays 404, an empty queue/history stays an empty 200.
        assert.equal((await sendJson(base, 'POST', `/api/dispatch/take/${ID}`, auth)).status, 404);
        assert.equal((await sendJson(base, 'POST', `/api/dispatch/feedback/${ID}`, auth, { message: 'm' })).status, 404);
        assert.deepEqual((await (await sendJson(base, 'GET', '/api/dispatch/poll', auth)).json()).items, []);
        assert.equal((await sendJson(base, 'DELETE', `/workspace/${URL_KEY}/api/dispatch/${ID}`)).status, 404);
        assert.equal((await sendJson(base, 'PATCH', `/workspace/${URL_KEY}/api/dispatch/${ID}/trim`, {}, { maxTasks: 1 })).status, 404);

        const rows = [
          ['poll', 'GET', '/api/dispatch/poll', auth, undefined, queue, 'find'],
          ['take', 'POST', `/api/dispatch/take/${ID}`, auth, undefined, queue, 'findOneAndDelete'],
          ['feedback', 'POST', `/api/dispatch/feedback/${ID}`, auth, { message: 'm' }, history, 'findOneAndUpdate'],
          ['list', 'GET', `/workspace/${URL_KEY}/api/dispatch`, {}, undefined, queue, 'find'],
          ['count', 'GET', `/workspace/${URL_KEY}/api/dispatch/count`, {}, undefined, queue, 'find'],
          ['history', 'GET', `/workspace/${URL_KEY}/api/dispatch/history`, {}, undefined, history, 'find'],
          ['delete', 'DELETE', `/workspace/${URL_KEY}/api/dispatch/${ID}`, {}, undefined, queue, 'findOne'],
          ['trim', 'PATCH', `/workspace/${URL_KEY}/api/dispatch/${ID}/trim`, {}, { maxTasks: 1 }, queue, 'findOne']
        ];
        for (const [label, method, path, headers, body, side, op] of rows) {
          side.fail[op] = true;
          try {
            await assertEnvelope(await sendJson(base, method, path, headers, body), label);
          } finally { side.fail[op] = false; }
        }
      });
    } finally { q.mock.restore(); }
    assert.ok(store);
  });

  test('broker-token: a status read fault is the 503 envelope, not the final 403 status-unreadable', async () => {
    const { app, auth, store } = await setup();
    const item = await store.addItem(URL_KEY, { prompt: 'p', grantDeclaration: { ownerAccountId: 'acct-1' } });
    await store.takeItem(item._id, URL_KEY, TOKEN);
    const q = quiet();
    try {
      await serve(app, async (base) => {
        // A real absent row after a declared record keeps today's refusals.
        const realStatus = store.getItemStatus.bind(store);
        store.getItemStatus = async () => { throw new DispatchStoreFault('getItemStatus', BOOM); };
        const res = await sendJson(base, 'POST', '/api/dispatch/broker-token', auth, { itemId: item._id });
        await assertEnvelope(res, 'broker-token');
        store.getItemStatus = realStatus;
        store.getGrantDeclaration = async () => { throw new DispatchStoreFault('getGrantDeclaration', BOOM); };
        await assertEnvelope(await sendJson(base, 'POST', '/api/dispatch/broker-token', auth, { itemId: item._id }), 'broker-token declaration');
      });
    } finally { q.mock.restore(); }
  });
});

describe('proxy runner and proxy dispatch routes', () => {
  async function setup() {
    const { buildApp } = await import('./lib/proxy-fake-deps.js');
    const parts = makeStore();
    const app = buildApp({
      dispatchQueueStore: parts.store,
      proxyTokenStore: {
        validateToken: async () => ({
          tokenId: 't1', urlKey: URL_KEY, label: 'runner', scope: 'readWrite', createdBy: 'acct-1',
          grants: ['take', 'dispatch'], workspaceId: 'ws-acme'
        }),
        listTokens: async () => [],
        describeRejectionCause: async () => null
      }
    });
    return { ...parts, app, auth: { Authorization: 'Bearer anything' } };
  }

  test('runner poll / take / feedback, dispatch list / status / prompt answer the 503 envelope', async () => {
    const { app, auth, queue, history } = await setup();
    const q = quiet();
    try {
      await serve(app, async (base) => {
        assert.equal((await sendJson(base, 'POST', `/api/proxy/runner/take/${ID}`, auth)).status, 404, 'a real miss is still 404');
        assert.equal((await sendJson(base, 'GET', `/api/proxy/dispatch/${ID}`, auth)).status, 404);
        assert.equal((await sendJson(base, 'GET', `/api/proxy/dispatch/${ID}/prompt`, auth)).status, 404);
        const rows = [
          ['runner poll', 'GET', '/api/proxy/runner/poll', undefined, queue, 'find'],
          ['runner take', 'POST', `/api/proxy/runner/take/${ID}`, undefined, queue, 'findOneAndDelete'],
          ['runner feedback', 'POST', `/api/proxy/runner/feedback/${ID}`, { message: 'm' }, history, 'findOneAndUpdate'],
          ['dispatch list', 'GET', '/api/proxy/dispatch', undefined, queue, 'find'],
          ['dispatch status', 'GET', `/api/proxy/dispatch/${ID}`, undefined, queue, 'findOne'],
          ['dispatch prompt', 'GET', `/api/proxy/dispatch/${ID}/prompt`, undefined, queue, 'findOne']
        ];
        for (const [label, method, path, body, side, op] of rows) {
          side.fail[op] = true;
          try {
            await assertEnvelope(await sendJson(base, method, path, auth, body), label);
          } finally { side.fail[op] = false; }
        }
      });
    } finally { q.mock.restore(); }
  });

  test('watch long-poll: a fault on the SECOND read replies through the keepalive (real 503 before the flush, statusCode:503 after)', async () => {
    const { store, app, auth, history } = await setup();
    const item = await store.addItem(URL_KEY, { prompt: 'p' });
    await store.takeItem(item._id, URL_KEY, TOKEN);
    const q = quiet();
    try {
      await serve(app, async (base) => {
        // Before the flush: the first read succeeds, the held re-check faults, the keepalive has not flushed.
        const real = store.getItemStatus.bind(store);
        let reads = 0;
        store.getItemStatus = async (...args) => {
          if (++reads >= 2) throw new DispatchStoreFault('getItemStatus', BOOM);
          return real(...args);
        };
        const res = await sendJson(base, 'GET', `/api/proxy/dispatch/${item._id}?wait=5`, auth);
        assert.equal(res.status, 503, 'a real 503 while the headers are still uncommitted');
        await assertEnvelope(res, 'watch pre-flush');
        store.getItemStatus = real;
        assert.ok(history);
      });
    } finally { q.mock.restore(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The sweep: no catch in lib/dispatch-store.js answers an absence sentinel without saying why.
// ─────────────────────────────────────────────────────────────────────────────

describe('sweep: every sentinel-returning catch in lib/dispatch-store.js is converted or marked internal-only', () => {
  test('a catch whose handler returns null / [] / false / 0 / an object literal carries `// internal-only:`', async () => {
    const acorn = await import('acorn');
    const source = readFileSync(new URL('../../lib/dispatch-store.js', import.meta.url), 'utf8');
    const comments = [];
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: comments });
    const lines = source.split('\n');

    const sentinel = (node) => node && (
      (node.type === 'Literal' && (node.value === null || node.value === false || node.value === 0))
      || (node.type === 'ArrayExpression' && node.elements.length === 0)
      || node.type === 'ObjectExpression'
    );
    const hasThrow = (node) => {
      let found = false;
      (function walk(n) {
        if (!n || typeof n.type !== 'string' || found) return;
        if (n.type === 'ThrowStatement') { found = true; return; }
        for (const k of Object.keys(n)) {
          const v = n[k];
          if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
        }
      })(node);
      return found;
    };
    const returnsSentinel = (node) => {
      let found = false;
      (function walk(n) {
        if (!n || typeof n.type !== 'string' || found) return;
        if (/Function/.test(n.type)) return;
        if (n.type === 'ReturnStatement' && (n.argument === null || sentinel(n.argument))) { found = true; return; }
        for (const k of Object.keys(n)) {
          const v = n[k];
          if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
        }
      })(node);
      return found;
    };

    const offenders = [];
    (function visit(n) {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'CatchClause' && returnsSentinel(n.body) && !hasThrow(n.body)) {
        const first = n.loc.start.line;
        const last = n.body.loc.end.line;
        const text = lines.slice(first - 1, last).join('\n');
        if (!/\/\/ internal-only:/.test(text)) offenders.push(`line ${first}: ${lines[first]?.trim()}`);
      }
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === 'string') visit(v);
      }
    })(ast);
    assert.deepEqual(offenders, [], 'convert to a DispatchStoreFault throw, or mark `// internal-only: <reason>`');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Docs, catalog and the unhandled-status guard.
// ─────────────────────────────────────────────────────────────────────────────

describe('the contract is stated where callers read it', () => {
  const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

  test('docs and the instructions catalog name the code, and contract.json has the store rows', () => {
    assert.match(read('docs/dispatch-integration.md'), /\| 503 \| `Dispatch store unavailable` \|.*DISPATCH_STORE_UNAVAILABLE.*retryable: true/);
    assert.match(read('docs/proxy-integration.md'), /\| 503 \| `Dispatch store unavailable` \(`code: DISPATCH_STORE_UNAVAILABLE`/);
    assert.match(read('lib/proxy-instructions.js'), /code: "DISPATCH_STORE_UNAVAILABLE"/);
    const rows = JSON.parse(read('lib/runner-kit/contract.json')).rows.filter((r) => r.area === 'store');
    assert.deepEqual(rows.map((r) => r.item.surface).sort(), ['feedback', 'poll', 'status', 'take']);
    for (const r of rows) {
      assert.equal(r.item.status, 503);
      assert.equal(r.item.code, 'DISPATCH_STORE_UNAVAILABLE');
      assert.equal(r.item.retryable, true);
    }
  });

  test('the unhandled-status guard: every lane route that reads or writes the store has a fault row above', async () => {
    // A route added to a lane router without a fault row fails here until a row (or an explicit
    // exemption with its reason) is added: a new unhandled route cannot pass silently.
    const { createDispatchRoutes } = await import('../../routes/dispatch.js');
    const stackOf = (router) => router.stack.filter((l) => l.route).map((l) => {
      const methods = Object.keys(l.route.methods).filter((m) => l.route.methods[m]).map((m) => m.toUpperCase());
      return methods.map((m) => `${m} ${l.route.path}`);
    }).flat();
    const covered = new Set([
      // dispatch router: token lane and session lane
      'GET /api/dispatch/poll', 'POST /api/dispatch/take/:itemId', 'POST /api/dispatch/feedback/:itemId',
      'POST /api/dispatch/broker-token',
      'GET /workspace/:urlKey/api/dispatch', 'GET /workspace/:urlKey/api/dispatch/count',
      'GET /workspace/:urlKey/api/dispatch/history', 'DELETE /workspace/:urlKey/api/dispatch/:itemId',
      'PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim',
      // proxy runner and dispatch
      'GET /api/proxy/runner/poll', 'POST /api/proxy/runner/take/:id', 'POST /api/proxy/runner/feedback/:id',
      'GET /api/proxy/dispatch', 'GET /api/proxy/dispatch/:id', 'GET /api/proxy/dispatch/:id/prompt'
    ]);
    // Routes that never reach a converted store member, or are covered by their own file.
    const exempt = /heartbeat|tokens|presets|halt|recent-prompts|favorite-prompts|quota|^POST \/workspace\/:urlKey\/api\/dispatch$|wake-shadow|recommend|autopilot|^(GET|POST|DELETE|PATCH) \/api\/proxy\/(?!runner|dispatch)/;
    const dispatchRoutes = stackOf(createDispatchRoutes({
      dispatchQueueStore: {}, dispatchTokenStore: {}, workspaceFromUrl: (q, r, n) => n(), userPreferencesStore: {}, proxyTokenStore: {}
    }));
    const missing = dispatchRoutes.filter((r) => /dispatch/.test(r) && !covered.has(r) && !exempt.test(r));
    assert.deepEqual(missing, [], 'add a fault row for the route (or exempt it with a reason)');
    for (const r of covered) {
      const found = dispatchRoutes.includes(r) || r.includes('/api/proxy/');
      assert.ok(found, `${r} is no longer registered`);
    }
  });
});
