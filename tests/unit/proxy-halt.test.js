/**
 * LIN-2994 Surface 3 / LIN-3025 — GET/POST/DELETE /api/proxy/dispatch/halt.
 *
 * Drives the routes through the REAL composed proxy router
 * (`createProxyRoutes`, not `createProxyHaltRoutes` in isolation) using the
 * shared `BASE_DEPS`/`buildApp`/`call` harness (tests/unit/lib/proxy-fake-deps.js)
 * — the same discipline the C1 DI-witness corpus uses, so this file proves
 * the mounted behavior rather than the sub-router's own logic in a vacuum.
 *
 * This is a REQUEST-only surface: setting a halt does not itself pause or
 * stop anything (the runner does not yet honor it, pending LIN-2995) —
 * these tests only pin the store-write/read contract and the route's own
 * auth/validation/attribution/error behavior.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACME, BASE_DEPS, buildApp, call } from './lib/proxy-fake-deps.js';

const PATH = '/api/proxy/dispatch/halt';

/** A minimal in-memory stand-in for lib/workspace-halt.js's WorkspaceHaltStore
 * contract: get returns `_id` (stripped by the route), set resolves nothing
 * and takes an injected `now`, clear is harmless on an unset key. */
function makeFakeHaltStore() {
  const byUrlKey = new Map();
  return {
    async getWorkspaceHalt(urlKey) {
      return byUrlKey.has(urlKey) ? { _id: urlKey, ...byUrlKey.get(urlKey) } : null;
    },
    async setWorkspaceHalt(urlKey, { mode, setBy, now }) {
      byUrlKey.set(urlKey, { mode, setAt: now, setBy });
    },
    async clearWorkspaceHalt(urlKey) {
      byUrlKey.delete(urlKey);
    },
  };
}

/** A Proxy that throws on any property access called as a function — used to
 * prove a forbidden dependency is never touched by the halt routes, rather
 * than merely asserting a call-count of zero on a store nothing reaches. */
function makeNeverCalledSpy(label) {
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return (...args) => {
        throw new Error(`${label}.${prop} must never be called by the halt routes`);
      };
    },
  });
}

function readScopeToken({ createdBy = 'u1' } = {}) {
  return {
    ...BASE_DEPS().proxyTokenStore,
    validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'test', scope: 'read', createdBy }),
  };
}

function writeScopeToken({ createdBy = 'u1' } = {}) {
  return {
    ...BASE_DEPS().proxyTokenStore,
    validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'test', scope: 'readWrite', createdBy }),
  };
}

describe('LIN-3025: GET/POST/DELETE /api/proxy/dispatch/halt (composed router)', () => {
  test('GET returns { halt: null } when unset, reflects a POST with no _id leak, then DELETE clears it back to null', async () => {
    const haltStore = makeFakeHaltStore();
    const app = buildApp({ workspaceHaltStore: haltStore });

    const before = await call(app, 'GET', PATH);
    assert.equal(before.status, 200);
    assert.deepEqual(before.body, { halt: null });

    const posted = await call(app, 'POST', PATH, { body: { mode: 'pause' } });
    assert.equal(posted.status, 200);
    assert.deepEqual(posted.body.success, true);
    assert.equal(posted.body.halt.mode, 'pause');
    assert.equal(posted.body.halt.setBy, 'u1');
    assert.ok(posted.body.halt.setAt, 'setAt must be present');

    const after = await call(app, 'GET', PATH);
    assert.equal(after.status, 200);
    assert.deepEqual(after.body, { halt: posted.body.halt });
    assert.equal(after.body.halt._id, undefined, '_id must be stripped from the GET response');

    const deleted = await call(app, 'DELETE', PATH);
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { success: true });

    const afterDelete = await call(app, 'GET', PATH);
    assert.deepEqual(afterDelete.body, { halt: null });
  });

  test('POST mode: "stop" succeeds with the same shape', async () => {
    const app = buildApp({ workspaceHaltStore: makeFakeHaltStore() });
    const { status, body } = await call(app, 'POST', PATH, { body: { mode: 'stop' } });
    assert.equal(status, 200);
    assert.equal(body.halt.mode, 'stop');
  });

  test('POST with an invalid mode is rejected 400 and never reaches the store', async () => {
    const setCalls = [];
    const haltStore = makeFakeHaltStore();
    const app = buildApp({
      workspaceHaltStore: {
        ...haltStore,
        setWorkspaceHalt: async (...args) => { setCalls.push(args); return haltStore.setWorkspaceHalt(...args); },
      },
    });

    const { status, body } = await call(app, 'POST', PATH, { body: { mode: 'resume' } });
    assert.equal(status, 400);
    assert.ok(body.error);
    assert.deepEqual(setCalls, [], 'setWorkspaceHalt must not be called on an invalid mode');
  });

  test('POST with a missing mode is rejected 400 and never reaches the store', async () => {
    const setCalls = [];
    const haltStore = makeFakeHaltStore();
    const app = buildApp({
      workspaceHaltStore: {
        ...haltStore,
        setWorkspaceHalt: async (...args) => { setCalls.push(args); return haltStore.setWorkspaceHalt(...args); },
      },
    });

    const { status } = await call(app, 'POST', PATH, { body: {} });
    assert.equal(status, 400);
    assert.deepEqual(setCalls, []);
  });

  test('GET succeeds with a read-scope token (read scope is enough, as with the agent-status GET)', async () => {
    const app = buildApp({ workspaceHaltStore: makeFakeHaltStore(), proxyTokenStore: readScopeToken() });
    const { status, body } = await call(app, 'GET', PATH);
    assert.equal(status, 200);
    assert.deepEqual(body, { halt: null });
  });

  test('POST with a read-scope token is rejected 403', async () => {
    const app = buildApp({ workspaceHaltStore: makeFakeHaltStore(), proxyTokenStore: readScopeToken() });
    const { status } = await call(app, 'POST', PATH, { body: { mode: 'pause' } });
    assert.equal(status, 403);
  });

  test('DELETE with a read-scope token is rejected 403', async () => {
    const app = buildApp({ workspaceHaltStore: makeFakeHaltStore(), proxyTokenStore: readScopeToken() });
    const { status } = await call(app, 'DELETE', PATH);
    assert.equal(status, 403);
  });

  test('setBy is attributed from the token creator, and an ownerless (createdBy: null) token yields setBy: null', async () => {
    const app = buildApp({
      workspaceHaltStore: makeFakeHaltStore(),
      proxyTokenStore: writeScopeToken({ createdBy: null }),
    });
    const { status, body } = await call(app, 'POST', PATH, { body: { mode: 'pause' } });
    assert.equal(status, 200);
    assert.equal(body.halt.setBy, null);
  });

  test('logEvent is recorded on every handled branch, including a 200 GET (middleware 401/403 are not logged)', async () => {
    const recorded = [];
    const app = buildApp({
      workspaceHaltStore: makeFakeHaltStore(),
      proxyEventStore: {
        ...BASE_DEPS().proxyEventStore,
        recordEvent: async (event) => { recorded.push(event); },
      },
    });

    await call(app, 'GET', PATH);
    await call(app, 'POST', PATH, { body: { mode: 'pause' } });
    await call(app, 'DELETE', PATH);
    await call(app, 'POST', PATH, { body: { mode: 'not-a-mode' } });

    const forHalt = recorded.filter((e) => e.endpoint === PATH);
    const statusesByMethod = forHalt.map((e) => `${e.method} ${e.status}`);
    assert.deepEqual(statusesByMethod, ['GET 200', 'POST 200', 'DELETE 200', 'POST 400']);

    // A read/write-scope 401/403 refusal happens in createProxyRoutes's own
    // middleware, before this route's handler runs, and that middleware
    // never calls logEvent (verified below) — only the handler's own
    // branches are witnessed here.
    const scopeApp = buildApp({ workspaceHaltStore: makeFakeHaltStore(), proxyTokenStore: readScopeToken(), proxyEventStore: { ...BASE_DEPS().proxyEventStore, recordEvent: async (event) => { recorded.push(event); } } });
    const before403 = recorded.length;
    const { status } = await call(scopeApp, 'POST', PATH, { body: { mode: 'pause' } });
    assert.equal(status, 403);
    assert.equal(recorded.length, before403, 'a 403 from requireWriteScope must not call logEvent');
  });

  test('GET: a store throw is a JSON 500, never 503, and does not crash the test process', async () => {
    const recorded = [];
    const app = buildApp({
      workspaceHaltStore: {
        ...makeFakeHaltStore(),
        getWorkspaceHalt: async () => { throw new Error('boom'); },
      },
      proxyEventStore: { ...BASE_DEPS().proxyEventStore, recordEvent: async (event) => { recorded.push(event); } },
    });

    const { status, body } = await call(app, 'GET', PATH);
    assert.equal(status, 500);
    assert.ok(body.error);
    assert.ok(recorded.some((e) => e.endpoint === PATH && e.status === 500));
    assert.ok(!recorded.some((e) => e.endpoint === PATH && e.status === 503), 'a store failure must never log/return 503');
  });

  test('POST: a store throw is a JSON 500, never 503', async () => {
    const recorded = [];
    const app = buildApp({
      workspaceHaltStore: {
        ...makeFakeHaltStore(),
        setWorkspaceHalt: async () => { throw new Error('boom'); },
      },
      proxyEventStore: { ...BASE_DEPS().proxyEventStore, recordEvent: async (event) => { recorded.push(event); } },
    });

    const { status, body } = await call(app, 'POST', PATH, { body: { mode: 'pause' } });
    assert.equal(status, 500);
    assert.ok(body.error);
    assert.ok(recorded.some((e) => e.endpoint === PATH && e.status === 500));
    assert.ok(!recorded.some((e) => e.endpoint === PATH && e.status === 503));
  });

  test('DELETE: a store throw is a JSON 500, never 503', async () => {
    const recorded = [];
    const app = buildApp({
      workspaceHaltStore: {
        ...makeFakeHaltStore(),
        clearWorkspaceHalt: async () => { throw new Error('boom'); },
      },
      proxyEventStore: { ...BASE_DEPS().proxyEventStore, recordEvent: async (event) => { recorded.push(event); } },
    });

    const { status, body } = await call(app, 'DELETE', PATH);
    assert.equal(status, 500);
    assert.ok(body.error);
    assert.ok(recorded.some((e) => e.endpoint === PATH && e.status === 500));
    assert.ok(!recorded.some((e) => e.endpoint === PATH && e.status === 503));
  });

  test('a null workspaceHaltStore (createProxyRoutes\'s own default) is a JSON 500, not a thrown error', async () => {
    const app = buildApp({ workspaceHaltStore: null });
    const { status, body } = await call(app, 'GET', PATH);
    assert.equal(status, 500);
    assert.ok(body.error);
  });

  // LIN-3025 review ledger L3: the POST/DELETE null-store branches. Without
  // the handler's own `!workspaceHaltStore` guard, `null.setWorkspaceHalt()`
  // would throw a TypeError inside the same try and the catch would still
  // answer a JSON 500 + logEvent 500 — so the 500 alone cannot tell the guard
  // from an accident. The guard never reaches the catch's console.error
  // ("Workspace halt … error"), which is what pins it here.
  for (const [method, reqOpts] of [['POST', { body: { mode: 'pause' } }], ['DELETE', {}]]) {
    test(`${method}: a null workspaceHaltStore is a JSON 500 with logEvent 500, handled by the guard (never dereferenced)`, async (t) => {
      const recorded = [];
      const consoleError = t.mock.method(console, 'error', () => {});
      const app = buildApp({
        workspaceHaltStore: null,
        proxyEventStore: { ...BASE_DEPS().proxyEventStore, recordEvent: async (event) => { recorded.push(event); } },
      });

      const { status, body } = await call(app, method, PATH, reqOpts);
      assert.equal(status, 500);
      assert.equal(typeof body.error, 'string');
      assert.ok(body.error.length > 0);
      assert.deepEqual(
        recorded.filter((e) => e.endpoint === PATH).map((e) => `${e.method} ${e.status}`),
        [`${method} 500`],
      );
      const haltStoreErrors = consoleError.mock.calls.filter((c) => /^Workspace halt .* error:/.test(String(c.arguments[0])));
      assert.deepEqual(haltStoreErrors.map((c) => c.arguments.join(' ')), [], 'a null store must be handled by the guard, not by catching a TypeError from dereferencing it');
    });
  }

  test('never touches Linear/provider access, resolveWorkspaceAccess, getWorkspaceAccessToken, or the dispatch queue', async () => {
    const app = buildApp({
      workspaceHaltStore: makeFakeHaltStore(),
      dispatchQueueStore: makeNeverCalledSpy('dispatchQueueStore'),
      provider: makeNeverCalledSpy('provider'),
      resolveWorkspaceAccess: async () => { throw new Error('resolveWorkspaceAccess must never be called by the halt routes'); },
      getWorkspaceAccessToken: async () => { throw new Error('getWorkspaceAccessToken must never be called by the halt routes'); },
    });

    const post = await call(app, 'POST', PATH, { body: { mode: 'pause' } });
    assert.equal(post.status, 200);
    const get = await call(app, 'GET', PATH);
    assert.equal(get.status, 200);
    const del = await call(app, 'DELETE', PATH);
    assert.equal(del.status, 200);
  });
});
