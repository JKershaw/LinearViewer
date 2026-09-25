/**
 * LIN-2994 Surface 4 / LIN-3026 — GET/POST/DELETE
 * /workspace/:urlKey/api/dispatch/halt.
 *
 * Drives the routes through the REAL composed `createDispatchRoutes` router
 * (not the handlers in isolation), the same discipline
 * `tests/unit/dispatch-route-preset-crud.test.js` and
 * `tests/unit/proxy-halt.test.js` use — this file proves the routes as
 * mounted (including their position relative to
 * `DELETE /workspace/:urlKey/api/dispatch/:itemId`), not a handler in a
 * vacuum.
 *
 * This is a REQUEST-only surface (Decision 4, best-effort): setting a halt
 * does not itself pause or stop anything — the runner does not yet honor it
 * (pending LIN-2995). These tests only pin the route's own
 * auth/validation/attribution/error/ordering contract.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { WorkspaceHaltStore } from '../../lib/workspace-halt.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const PATH = `/workspace/${URL_KEY}/api/dispatch/halt`;

/** A minimal in-memory stand-in for WorkspaceHaltStore's contract, used where
 * a test needs to force a specific method to throw (mirrors
 * tests/unit/proxy-halt.test.js's makeFakeHaltStore). */
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

function buildApp({ workspaceHaltStore, accountId = 'acct-1', removeItem, urlKey = URL_KEY } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      removeItem: removeItem || (async () => { throw new Error('removeItem must not be reached by these tests'); }),
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      // `accountId: null` means "session present, but no accountId" (the
      // no-owner case) — distinct from the default param filling in
      // 'acct-1' for an *omitted* option.
      req.session = accountId === null ? {} : { accountId };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: null,
    workspaceHaltStore: workspaceHaltStore ?? null,
  }));
  return app;
}

async function call(app, method, path = PATH, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-3026: GET/POST/DELETE /workspace/:urlKey/api/dispatch/halt (composed router)', () => {
  test('GET returns { halt: null } when unset, reflects a POST with no _id leak, then DELETE clears it back to null', async () => {
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    const app = buildApp({ workspaceHaltStore });

    const before = await call(app, 'GET');
    assert.equal(before.status, 200);
    assert.deepEqual(before.body, { halt: null });

    const posted = await call(app, 'POST', PATH, { mode: 'pause' });
    assert.equal(posted.status, 200);
    assert.equal(posted.body.success, true);
    assert.equal(posted.body.halt.mode, 'pause');
    assert.equal(posted.body.halt.setBy, 'acct-1');
    assert.ok(posted.body.halt.setAt, 'setAt must be present');
    assert.equal(posted.body.halt._id, undefined, '_id must never appear in the POST response');

    const after = await call(app, 'GET');
    assert.equal(after.status, 200);
    assert.deepEqual(after.body, { halt: posted.body.halt });
    assert.equal(after.body.halt._id, undefined, '_id must be stripped from the GET response');

    const deleted = await call(app, 'DELETE');
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { success: true });

    const afterDelete = await call(app, 'GET');
    assert.deepEqual(afterDelete.body, { halt: null });
  });

  test('POST mode: "stop" succeeds with the same shape', async () => {
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    const app = buildApp({ workspaceHaltStore });
    const { status, body } = await call(app, 'POST', PATH, { mode: 'stop' });
    assert.equal(status, 200);
    assert.equal(body.halt.mode, 'stop');
  });

  describe('POST: 400 on an invalid mode, before any write', () => {
    for (const mode of [undefined, 'PAUSE', 'resume', 42, null, '']) {
      test(`mode = ${JSON.stringify(mode)}`, async () => {
        const setCalls = [];
        const workspaceHaltStore = {
          ...makeFakeHaltStore(),
        };
        workspaceHaltStore.setWorkspaceHalt = async (...args) => { setCalls.push(args); };
        const app = buildApp({ workspaceHaltStore });

        const { status, body } = await call(app, 'POST', PATH, { mode });
        assert.equal(status, 400);
        assert.ok(body.error);
        assert.deepEqual(setCalls, [], 'setWorkspaceHalt must never be called on an invalid mode');
      });
    }
  });

  describe('setBy attribution', () => {
    test('session with accountId -> setBy is that accountId', async () => {
      const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
      const app = buildApp({ workspaceHaltStore, accountId: 'acct-42' });
      const { body } = await call(app, 'POST', PATH, { mode: 'pause' });
      assert.equal(body.halt.setBy, 'acct-42');
    });

    test('session without accountId -> setBy is null', async () => {
      const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
      const app = buildApp({ workspaceHaltStore, accountId: null });
      const { body } = await call(app, 'POST', PATH, { mode: 'pause' });
      assert.equal(body.halt.setBy, null);
    });
  });

  test('DELETE is idempotent: clearing an already-unset halt still returns { success: true }', async () => {
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    const app = buildApp({ workspaceHaltStore });
    const { status, body } = await call(app, 'DELETE');
    assert.equal(status, 200);
    assert.deepEqual(body, { success: true });
  });

  // The core route-ordering witness (LIN-2994 Surface 4 / class (a) of the
  // plan's capture sweep): DELETE .../dispatch/halt must be handled by this
  // file's own halt route, not fall through to the UUID-gated
  // `DELETE .../dispatch/:itemId` route registered just below it.
  describe('DELETE .../dispatch/halt is not captured by DELETE .../dispatch/:itemId', () => {
    test('set a halt, DELETE it: exact success body, the queue item-delete path is never reached, follow-up GET is null', async () => {
      const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
      let removeItemCalls = 0;
      const app = buildApp({
        workspaceHaltStore,
        removeItem: async () => { removeItemCalls++; return true; },
      });

      const posted = await call(app, 'POST', PATH, { mode: 'pause' });
      assert.equal(posted.status, 200);

      const deleted = await call(app, 'DELETE');
      assert.equal(deleted.status, 200);
      assert.deepEqual(deleted.body, { success: true }, 'must be the halt route\'s own success body, not the :itemId route\'s');
      assert.equal(removeItemCalls, 0, 'dispatchQueueStore.removeItem must never be called by DELETE .../dispatch/halt');

      const afterDelete = await call(app, 'GET');
      assert.deepEqual(afterDelete.body, { halt: null });
    });

    // Negative control: proves the UUID guard on :itemId is still intact and
    // that this test harness would actually notice a routing regression —
    // without it, a broken ordering fix could accidentally make EVERY DELETE
    // succeed and the positive witness above would false-pass.
    test('negative control: DELETE .../dispatch/not-a-uuid still 400s on the :itemId route\'s own UUID guard', async () => {
      const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
      const app = buildApp({ workspaceHaltStore });
      const { status, body } = await call(app, 'DELETE', `/workspace/${URL_KEY}/api/dispatch/not-a-uuid`);
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid item ID format');
    });
  });

  describe('null workspaceHaltStore -> 503 on all three verbs (dashboard house style; matches routes/dispatch.js:840,926,961,1231)', () => {
    for (const [method, body] of [['GET', undefined], ['POST', { mode: 'pause' }], ['DELETE', undefined]]) {
      test(method, async () => {
        const app = buildApp({ workspaceHaltStore: null });
        const { status, body: respBody } = await call(app, method, PATH, body);
        assert.equal(status, 503);
        assert.ok(respBody.error);
      });
    }
  });

  describe('a store throw is a JSON 500, not a crash', () => {
    test('GET', async () => {
      const workspaceHaltStore = { ...makeFakeHaltStore(), getWorkspaceHalt: async () => { throw new Error('boom'); } };
      const app = buildApp({ workspaceHaltStore });
      const { status, body } = await call(app, 'GET');
      assert.equal(status, 500);
      assert.ok(body.error);
    });

    test('POST', async () => {
      const workspaceHaltStore = { ...makeFakeHaltStore(), setWorkspaceHalt: async () => { throw new Error('boom'); } };
      const app = buildApp({ workspaceHaltStore });
      const { status, body } = await call(app, 'POST', PATH, { mode: 'pause' });
      assert.equal(status, 500);
      assert.ok(body.error);
    });

    test('DELETE', async () => {
      const workspaceHaltStore = { ...makeFakeHaltStore(), clearWorkspaceHalt: async () => { throw new Error('boom'); } };
      const app = buildApp({ workspaceHaltStore });
      const { status, body } = await call(app, 'DELETE');
      assert.equal(status, 500);
      assert.ok(body.error);
    });
  });
});
