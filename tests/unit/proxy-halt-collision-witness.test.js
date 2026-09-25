/**
 * LIN-2994 Surface 3 / LIN-3025 — route-collision witness.
 *
 * Before routes/proxy-halt.js existed and was mounted strictly ahead of
 * createDispatchRoutes, GET /api/proxy/dispatch/halt was captured by GET
 * /api/proxy/dispatch/:id — routes/proxy-dispatch.js's id guard lets the
 * literal "halt" through as an ordinary id. This witness proves the halt
 * sub-router answers instead, built on the SAME composed harness the DI
 * census and endpoint inventory use (tests/unit/lib/proxy-fake-deps.js's
 * BASE_DEPS/buildApp/call over the real createProxyRoutes), never a bespoke
 * ad-hoc harness.
 *
 * A dispatchQueueStore spy is required, not optional: BASE_DEPS() carries no
 * dispatchQueueStore, so a STILL-captured GET would 503 "Dispatch is not
 * available" (dispatchQueueStore missing) instead of ever calling
 * getItemStatus — a naive "getItemStatus was never called" assertion would
 * then pass for the WRONG reason (research §5: reproduced — without the
 * spy, a captured request's 503 makes that assertion vacuously true).
 * Injecting the spy means a still-captured request would instead 404
 * "Dispatch item not found" with getItemStatus actually called once, so
 * "getItemStatus called 0 times" here is real evidence, not an artifact of
 * a missing dependency.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACME, buildApp, call } from './lib/proxy-fake-deps.js';

function makeDispatchQueueSpy() {
  const getItemStatusCalls = [];
  return {
    store: {
      getItemStatus: async (urlKey, id, opts) => {
        getItemStatusCalls.push([urlKey, id, opts]);
        return null;
      },
    },
    getItemStatusCalls,
  };
}

function makeHaltStoreSpy() {
  const calls = { get: [], set: [], clear: [] };
  return {
    store: {
      getWorkspaceHalt: async (urlKey) => { calls.get.push(urlKey); return null; },
      setWorkspaceHalt: async (urlKey, opts) => { calls.set.push([urlKey, opts]); },
      clearWorkspaceHalt: async (urlKey) => { calls.clear.push(urlKey); },
    },
    calls,
  };
}

describe('LIN-3025: /api/proxy/dispatch/halt is not captured by GET /api/proxy/dispatch/:id', () => {
  test('GET reaches the halt router: halt-shaped JSON body, halt store called with the right urlKey, getItemStatus never called', async () => {
    const dispatchSpy = makeDispatchQueueSpy();
    const haltSpy = makeHaltStoreSpy();
    const app = buildApp({ dispatchQueueStore: dispatchSpy.store, workspaceHaltStore: haltSpy.store });

    const { status, body, contentType } = await call(app, 'GET', '/api/proxy/dispatch/halt');

    assert.equal(status, 200);
    assert.match(contentType || '', /^application\/json/);
    assert.deepEqual(body, { halt: null });
    assert.deepEqual(haltSpy.calls.get, [ACME], 'the halt store must be reached with the right urlKey');
    assert.deepEqual(dispatchSpy.getItemStatusCalls, [], 'getItemStatus must never be called for GET /dispatch/halt');
  });

  test('POST reaches the halt router: setWorkspaceHalt called, getItemStatus never called', async () => {
    const dispatchSpy = makeDispatchQueueSpy();
    const haltSpy = makeHaltStoreSpy();
    const app = buildApp({ dispatchQueueStore: dispatchSpy.store, workspaceHaltStore: haltSpy.store });

    const { status, body } = await call(app, 'POST', '/api/proxy/dispatch/halt', { body: { mode: 'pause' } });

    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.halt.mode, 'pause');
    assert.equal(haltSpy.calls.set.length, 1, 'setWorkspaceHalt must be reached');
    assert.equal(haltSpy.calls.set[0][0], ACME);
    assert.deepEqual(dispatchSpy.getItemStatusCalls, [], 'getItemStatus must never be called for POST /dispatch/halt');
  });

  test('DELETE reaches the halt router: clearWorkspaceHalt called with the right urlKey, getItemStatus never called', async () => {
    const dispatchSpy = makeDispatchQueueSpy();
    const haltSpy = makeHaltStoreSpy();
    const app = buildApp({ dispatchQueueStore: dispatchSpy.store, workspaceHaltStore: haltSpy.store });

    const { status, body } = await call(app, 'DELETE', '/api/proxy/dispatch/halt');

    assert.equal(status, 200);
    assert.deepEqual(body, { success: true });
    assert.deepEqual(haltSpy.calls.clear, [ACME], 'clearWorkspaceHalt must be reached with the right urlKey');
    assert.deepEqual(dispatchSpy.getItemStatusCalls, [], 'getItemStatus must never be called for DELETE /dispatch/halt');
  });
});
