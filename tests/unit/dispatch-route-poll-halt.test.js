/**
 * LIN-3024 — GET /api/dispatch/poll: additive `halt` key, bounded read +
 * last-known cache fallback (Surface 2 of LIN-2994).
 *
 * The halt read runs alongside `pollAvailable`, bounded ONLY by an injectable
 * local timeout (`haltReadTimeoutMs`, default ~1.5s in production). On
 * timeout or store-read failure it falls back to the shared
 * `WorkspaceHaltStore`'s synchronous last-known cache (LIN-3024 beat 1); with
 * a cold cache the key is simply omitted. `pollAvailable` itself is never
 * timed out, and its own rejection still returns today's 500 — a halt-read
 * failure must never reach that same path (a naive `Promise.all` would be a
 * bug here).
 *
 * Mirrors the buildApp/call scaffolding of dispatch-broker-token.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { WorkspaceHaltStore } from '../../lib/workspace-halt.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const PATH = '/api/dispatch/poll';
const TOKEN = 'good-token';
const URL_KEY = 'acme';
const ITEMS = [{ id: 'item-1' }];

function buildApp({ workspaceHaltStore, haltReadTimeoutMs, pollAvailable, urlKey = URL_KEY } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      pollAvailable: pollAvailable || (async () => ITEMS)
    },
    dispatchTokenStore: {
      validateToken: async (token) => {
        if (token === TOKEN) return { urlKey, label: 'runner', createdBy: 'acct' };
        return null;
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    userPreferencesStore: {},
    workspaceHaltStore: workspaceHaltStore ?? null,
    ...(haltReadTimeoutMs !== undefined ? { haltReadTimeoutMs } : {})
  }));
  return app;
}

async function call(app, token = TOKEN) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = {};
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    const started = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}${PATH}`, { headers });
    const elapsedMs = Date.now() - started;
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, text, elapsedMs };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// A store whose getWorkspaceHalt() never resolves, to exercise the bounded
// race without a real (or fake) clock — the read simply hangs forever, and
// the injected timeout is what has to win.
function neverResolvingHaltStore({ lastKnown = null } = {}) {
  return {
    getWorkspaceHalt: () => new Promise(() => {}),
    getLastKnownHalt: () => lastKnown
  };
}

describe('LIN-3024 — GET /api/dispatch/poll: no halt store / no halt set', () => {
  test('null workspaceHaltStore -> exact raw {items} body (existing harness compat)', async () => {
    const app = buildApp({ workspaceHaltStore: null });
    const res = await call(app);

    assert.equal(res.status, 200);
    assert.equal(res.text, JSON.stringify({ items: ITEMS }), 'no halt: null, no stray keys');
  });

  test('a real store with nothing ever set -> exact raw {items} body', async () => {
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    const app = buildApp({ workspaceHaltStore });
    const res = await call(app);

    assert.equal(res.status, 200);
    assert.equal(res.text, JSON.stringify({ items: ITEMS }));
  });
});

describe('LIN-3024 — GET /api/dispatch/poll: live halt', () => {
  test('a halt set on the store -> exact projected {mode,setAt,setBy}, no _id', async () => {
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    const setAt = new Date('2026-01-01T00:00:00.000Z');
    await workspaceHaltStore.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now: setAt });

    const app = buildApp({ workspaceHaltStore });
    const res = await call(app);

    assert.equal(res.status, 200);
    assert.equal(
      res.text,
      JSON.stringify({ items: ITEMS, halt: { mode: 'pause', setAt: setAt.toISOString(), setBy: 'alice' } }),
      'exact key order/shape, and no _id leak'
    );
  });
});

describe('LIN-3024 — GET /api/dispatch/poll: halt-read failure fallback', () => {
  test('warm cache (via a prior successful read) + a failing read -> cached halt, 200', async () => {
    const collection = createMockCollection();
    const workspaceHaltStore = new WorkspaceHaltStore({ collection });
    const setAt = new Date('2026-01-01T00:00:00.000Z');
    await workspaceHaltStore.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now: setAt });
    await workspaceHaltStore.getWorkspaceHalt(URL_KEY); // warms via a read too

    collection.findOne = async () => { throw new Error('sentinel: findOne failed'); };
    const app = buildApp({ workspaceHaltStore });
    const res = await call(app);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { items: ITEMS, halt: { mode: 'pause', setAt: setAt.toISOString(), setBy: 'alice' } });
  });

  test('write-only warming: setWorkspaceHalt alone (no prior poll) still warms the fallback', async () => {
    const collection = createMockCollection();
    const workspaceHaltStore = new WorkspaceHaltStore({ collection });
    const setAt = new Date('2026-01-01T00:00:00.000Z');
    await workspaceHaltStore.setWorkspaceHalt(URL_KEY, { mode: 'stop', setBy: 'bob', now: setAt });

    collection.findOne = async () => { throw new Error('sentinel: findOne failed'); };
    const app = buildApp({ workspaceHaltStore });
    const res = await call(app);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { items: ITEMS, halt: { mode: 'stop', setAt: setAt.toISOString(), setBy: 'bob' } });
  });

  test('set -> clear -> a failing read omits the key (200, exact {items})', async () => {
    const collection = createMockCollection();
    const workspaceHaltStore = new WorkspaceHaltStore({ collection });
    await workspaceHaltStore.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice' });
    await workspaceHaltStore.clearWorkspaceHalt(URL_KEY);

    collection.findOne = async () => { throw new Error('sentinel: findOne failed'); };
    const app = buildApp({ workspaceHaltStore });
    const res = await call(app);

    assert.equal(res.status, 200);
    assert.equal(res.text, JSON.stringify({ items: ITEMS }));
  });

  test('cold cache + a failing read -> 200, key omitted', async () => {
    const collection = createMockCollection();
    collection.findOne = async () => { throw new Error('sentinel: findOne failed'); };
    const workspaceHaltStore = new WorkspaceHaltStore({ collection });

    const app = buildApp({ workspaceHaltStore });
    const res = await call(app);

    assert.equal(res.status, 200);
    assert.equal(res.text, JSON.stringify({ items: ITEMS }));
  });

  test('urlKey isolation: a failing read only falls back for the workspace that was warmed', async () => {
    const collection = createMockCollection();
    const workspaceHaltStore = new WorkspaceHaltStore({ collection });
    const setAt = new Date('2026-01-01T00:00:00.000Z');
    await workspaceHaltStore.setWorkspaceHalt('workspace-a', { mode: 'pause', setBy: 'alice', now: setAt });

    collection.findOne = async () => { throw new Error('sentinel: findOne failed'); };

    const warmedApp = buildApp({ workspaceHaltStore, urlKey: 'workspace-a' });
    const coldApp = buildApp({ workspaceHaltStore, urlKey: 'workspace-b' });

    const warmedRes = await call(warmedApp);
    const coldRes = await call(coldApp);

    assert.deepEqual(warmedRes.body, { items: ITEMS, halt: { mode: 'pause', setAt: setAt.toISOString(), setBy: 'alice' } });
    assert.equal(coldRes.text, JSON.stringify({ items: ITEMS }), 'the other urlKey must not see workspace-a\'s halt');
  });
});

describe('LIN-3024 — GET /api/dispatch/poll: bounded timeout', () => {
  test('a halt read slower than the injected timeout falls back to the cached value within the bound', async () => {
    const workspaceHaltStore = neverResolvingHaltStore({
      lastKnown: { mode: 'pause', setAt: '2026-01-01T00:00:00.000Z', setBy: 'alice' }
    });
    const app = buildApp({ workspaceHaltStore, haltReadTimeoutMs: 40 });

    const res = await call(app);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { items: ITEMS, halt: { mode: 'pause', setAt: '2026-01-01T00:00:00.000Z', setBy: 'alice' } });
    assert.ok(res.elapsedMs < 1000, `expected the bounded read to win well under 1s, took ${res.elapsedMs}ms`);
  });

  test('a halt read slower than the injected timeout, with a cold cache, omits the key within the bound', async () => {
    const workspaceHaltStore = neverResolvingHaltStore({ lastKnown: null });
    const app = buildApp({ workspaceHaltStore, haltReadTimeoutMs: 40 });

    const res = await call(app);

    assert.equal(res.status, 200);
    assert.equal(res.text, JSON.stringify({ items: ITEMS }));
    assert.ok(res.elapsedMs < 1000, `expected the bounded read to win well under 1s, took ${res.elapsedMs}ms`);
  });

  test('a slow pollAvailable is NOT timed out by the (short) halt-read bound', async () => {
    const SLOW_MS = 150;
    const pollAvailable = () => new Promise(resolve => setTimeout(() => resolve(ITEMS), SLOW_MS));
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    const app = buildApp({ workspaceHaltStore, haltReadTimeoutMs: 20, pollAvailable });

    const res = await call(app);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { items: ITEMS });
    assert.ok(res.elapsedMs >= SLOW_MS, `pollAvailable must be allowed to take its full ${SLOW_MS}ms, only took ${res.elapsedMs}ms`);
  });
});

describe('LIN-3024 — GET /api/dispatch/poll: pollAvailable failure is untouched', () => {
  test('pollAvailable rejecting still returns 500, regardless of the halt store', async () => {
    const pollAvailable = async () => { throw new Error('boom'); };
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    const app = buildApp({ workspaceHaltStore, pollAvailable });

    const res = await call(app);

    assert.equal(res.status, 500);
  });

  // beat 3: `itemsPromise` used to be created and left dangling (no handler
  // attached) while `await readHaltForPoll(...)` was still in flight. If
  // pollAvailable rejected during that window, Node saw an unhandled
  // rejection before the handler ever reached `await itemsPromise` — a
  // spurious "Unhandled promise rejection" in production (server.js:781's
  // global handler) and a hard crash under Node's default
  // --unhandled-rejections=throw in a bare test process.
  test('pollAvailable rejects promptly while the halt read is still pending -> 500, no unhandledRejection', async (t) => {
    const unhandled = [];
    const onUnhandledRejection = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);
    t.after(() => process.off('unhandledRejection', onUnhandledRejection));

    const pollAvailable = async () => { throw new Error('boom'); };
    // A halt read that resolves on a real timer (a macrotask), so it is
    // still pending when pollAvailable's rejection microtask settles.
    const workspaceHaltStore = {
      getWorkspaceHalt: () => new Promise(resolve => setTimeout(() => resolve(null), 50)),
      getLastKnownHalt: () => null
    };
    const app = buildApp({ workspaceHaltStore, pollAvailable, haltReadTimeoutMs: 1000 });

    const res = await call(app);
    // Give the event loop a further turn so a would-be unhandledRejection
    // (which Node raises shortly after the offending microtask, not
    // synchronously) has a chance to fire before we assert on it.
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.equal(res.status, 500);
    assert.deepEqual(unhandled, [], `expected no unhandledRejection, got ${unhandled.map(e => e?.message)}`);
  });
});
