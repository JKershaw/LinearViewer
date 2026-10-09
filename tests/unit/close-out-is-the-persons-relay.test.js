/**
 * Relay tests for the run-boundary refusal (LIN-3245 / LIN-2949 P1a).
 *
 * `createDispatchItem` throws `err.closeOutRefusal` (code
 * `CLOSE_OUT_IS_THE_PERSONS`) when a fresh close-out dispatch is bound to a run
 * row carrying `stopAt: 'pr'`. That refusal only reaches a caller where a
 * `refuseIf…` handler is wired. This file pins every one of those catch sites:
 *
 *   1. POST /api/proxy/dispatch                                (plain)
 *   2. POST /api/proxy/recommend-and-dispatch, verb-override    (non-keepalive)
 *   3. POST /api/proxy/recommend-and-dispatch, LLM-derived      (keepalive)
 *   4. POST /api/proxy/autopilot/kickoff                        (relay of the tag)
 *   5. POST /workspace/:urlKey/api/dispatch                     (session sibling)
 *
 * Each asserts the 409 code and that no row was created. Scaffolded like
 * tests/unit/proxy-dispatch-max-tasks.test.js (a REAL DispatchQueueStore so the
 * seam actually runs) and tests/unit/dispatch-route-max-tasks.test.js's
 * buildRealApp for the session route.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

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

function buildProxyApp({ dispatchQueueStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1', grants: ['dispatch'], workspaceId: 'ws-acme' }),
      createToken: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' }),
      mintGrantBootstrap: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' })
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

function buildSessionApp(store) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    // LIN-3383: owner-only runner enqueue — this fixture acts as the workspace owner.
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { accountId: 'u1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined
  }));
  return app;
}

async function call(app, method, path, body, authed = true) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: authed ? { Authorization: 'Bearer anything' } : {} };
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
const RECOMMEND_DISPATCH = '/api/proxy/recommend-and-dispatch';
const KICKOFF = '/api/proxy/autopilot/kickoff';
const SESSION_PATH = '/workspace/acme/api/dispatch';

// Seed a run row directly (the proxy route intentionally does NOT accept a
// `stopAt` body field — only the session ladder route does, in beat 2), so the
// seam has a real run row to resolve via getItemStatus.
async function seedStopAtRun(store, stopAt = 'pr') {
  const run = await store.addItem('acme', { prompt: 'launch the runner', kind: 'autopilot', issueIdentifier: 'LIN-1', stopAt });
  return run._id;
}

// A real store whose addItem throws the factory's run-boundary refusal. Used
// ONLY where the route's own verb cannot produce a close-out (kickoff, and the
// LLM-derived keepalive arm) — the refusal is injected at the exact seam
// createDispatchItem would throw it, and the relay is what is under test.
function makeRefusingStore() {
  const { store, getInsertCount } = makeSpiedStore();
  store.addItem = async () => {
    const err = new Error('This run stops at its PR — close-out is the person\'s to send');
    err.closeOutRefusal = { code: 'CLOSE_OUT_IS_THE_PERSONS', sessionId: 'run-1' };
    err.status = 409;
    throw err;
  };
  return { store, getInsertCount };
}

describe('LIN-3245 — run-boundary refusal relay', () => {
  test('1. plain /api/proxy/dispatch relays the refusal', async () => {
    const { store, getInsertCount } = makeSpiedStore();
    const app = buildProxyApp({ dispatchQueueStore: store });
    const sessionId = await seedStopAtRun(store);
    const before = getInsertCount();

    const res = await call(app, 'post', DISPATCH, { prompt: 'close it out', kind: 'close-out', issueIdentifier: 'LIN-1', sessionId });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'CLOSE_OUT_IS_THE_PERSONS');
    assert.equal(res.body.sessionId, sessionId);
    assert.equal(getInsertCount(), before, 'no row is created on refusal');
  });

  test('2. /api/proxy/recommend-and-dispatch verb-override (non-keepalive) relays the refusal', async () => {
    const { store, getInsertCount } = makeSpiedStore();
    const app = buildProxyApp({ dispatchQueueStore: store });
    const sessionId = await seedStopAtRun(store);
    const before = getInsertCount();

    const res = await call(app, 'post', RECOMMEND_DISPATCH, { kind: 'close-out', issueIdentifier: 'TEST-1', sessionId });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'CLOSE_OUT_IS_THE_PERSONS');
    assert.equal(getInsertCount(), before, 'no row is created on refusal');
  });

  test('3. /api/proxy/recommend-and-dispatch LLM-derived (keepalive) relays the refusal', async () => {
    const { store, getInsertCount } = makeRefusingStore();
    const app = buildProxyApp({ dispatchQueueStore: store });
    const before = getInsertCount();

    // No `kind`: the test-token descent lands on the keepalive-armed arm.
    const res = await call(app, 'post', RECOMMEND_DISPATCH, { issueIdentifier: 'TEST-14' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'CLOSE_OUT_IS_THE_PERSONS');
    assert.equal(getInsertCount(), before, 'no row is created on refusal');
  });

  test('4. /api/proxy/autopilot/kickoff relays the tag', async () => {
    const { store, getInsertCount } = makeRefusingStore();
    const app = buildProxyApp({ dispatchQueueStore: store });
    const before = getInsertCount();

    const res = await call(app, 'post', KICKOFF, { goal: 'ship it', target: 'cli' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'CLOSE_OUT_IS_THE_PERSONS');
    assert.equal(getInsertCount(), before, 'no row is created on refusal');
  });

  test('5. session POST /workspace/:urlKey/api/dispatch relays the refusal', async () => {
    const { store, getInsertCount } = makeSpiedStore();
    const app = buildSessionApp(store);

    // The run itself is created through the session route's own validated
    // `stopAt` intake (beat 2), then its close-out is refused.
    const run = await call(app, 'post', SESSION_PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1', stopAt: 'pr' }, false);
    assert.equal(run.status, 201, JSON.stringify(run.body));
    const sessionId = run.body.item.id;
    const before = getInsertCount();

    const res = await call(app, 'post', SESSION_PATH, { prompt: 'close it out', kind: 'close-out', issueIdentifier: 'LIN-1', sessionId }, false);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'CLOSE_OUT_IS_THE_PERSONS');
    assert.equal(res.body.sessionId, sessionId);
    assert.equal(getInsertCount(), before, 'no row is created on refusal');
  });
});
