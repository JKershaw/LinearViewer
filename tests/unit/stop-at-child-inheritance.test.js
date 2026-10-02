/**
 * Child-autopilot `stopAt` inheritance (LIN-3245 / LIN-2949 P1a, required
 * correction N1).
 *
 * A child autopilot can be launched two ways, and BOTH must inherit a parent
 * run's `stopAt: 'pr'` boundary through the SAME factory stamp in
 * `createDispatchItem` — never a second lookup in the kickoff route:
 *
 *   - the fused verb: POST /api/proxy/autopilot/kickoff with the parent's
 *     `sessionId`;
 *   - the two-step shape: GET-kickoff text, then plain POST /api/proxy/dispatch
 *     with `kind: 'autopilot'` and the parent's `sessionId`.
 *
 * Scaffolded like tests/unit/close-out-is-the-persons-relay.test.js (a REAL
 * DispatchQueueStore, so the seam actually runs).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function makeStore() {
  return new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
}

function buildApp({ dispatchQueueStore }) {
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
const KICKOFF = '/api/proxy/autopilot/kickoff';

async function seedParent(store, stopAt = 'pr') {
  const run = await store.addItem('acme', { prompt: 'launch the runner', kind: 'autopilot', issueIdentifier: 'LIN-1', stopAt });
  return run._id;
}

describe('LIN-3245 N1 — child autopilot stopAt inheritance', () => {
  test('fused verb: a child kickoff under a stopAt:pr parent is stamped stopAt:pr', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, 'pr');

    const res = await call(app, 'post', KICKOFF, { goal: 'ship it', target: 'cli', sessionId: parentId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const child = await store.getItemStatus('acme', res.body.id);
    assert.equal(child.stopAt, 'pr');
    assert.equal(child.sessionId, parentId, 'sanity: the child row records the parent edge');
  });

  test('two-step shape: plain /dispatch kind:autopilot under a stopAt:pr parent is stamped stopAt:pr', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, 'pr');

    const res = await call(app, 'post', DISPATCH, { prompt: 'kick off the child', kind: 'autopilot', issueIdentifier: 'LIN-1', target: 'cli', sessionId: parentId, force: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const child = await store.getItemStatus('acme', res.body.id);
    assert.equal(child.stopAt, 'pr');
  });

  test('parent without stopAt: the child is NOT stamped (both launch shapes)', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, null);

    const fused = await call(app, 'post', KICKOFF, { goal: 'ship it', target: 'cli', sessionId: parentId });
    assert.equal(fused.status, 201, JSON.stringify(fused.body));
    assert.strictEqual((await store.getItemStatus('acme', fused.body.id)).stopAt, null);

    const twoStep = await call(app, 'post', DISPATCH, { prompt: 'kick off the child', kind: 'autopilot', issueIdentifier: 'LIN-1', target: 'cli', sessionId: parentId, force: true });
    assert.equal(twoStep.status, 201, JSON.stringify(twoStep.body));
    assert.strictEqual((await store.getItemStatus('acme', twoStep.body.id)).stopAt, null);
  });

  test('a non-autopilot kind under a stopAt:pr parent is NOT stamped', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, 'pr');

    const res = await call(app, 'post', DISPATCH, { prompt: 'work on it', kind: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId: parentId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual((await store.getItemStatus('acme', res.body.id)).stopAt, null);
  });

  test('no parent sessionId: an autopilot child is NOT stamped', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const res = await call(app, 'post', DISPATCH, { prompt: 'kick off the child', kind: 'autopilot', issueIdentifier: 'LIN-1', target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual((await store.getItemStatus('acme', res.body.id)).stopAt, null);
  });

  test('chain: a close-out under the stamped child\u2019s own sessionId is refused CLOSE_OUT_IS_THE_PERSONS', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, 'pr');

    const child = await call(app, 'post', DISPATCH, { prompt: 'kick off the child', kind: 'autopilot', issueIdentifier: 'LIN-1', target: 'cli', sessionId: parentId, force: true });
    assert.equal(child.status, 201, JSON.stringify(child.body));
    const childId = child.body.id;
    assert.equal((await store.getItemStatus('acme', childId)).stopAt, 'pr', 'sanity: the child inherited the boundary');

    const closeOut = await call(app, 'post', DISPATCH, { prompt: 'close it out', kind: 'close-out', issueIdentifier: 'LIN-1', target: 'cli', sessionId: childId });
    assert.equal(closeOut.status, 409, JSON.stringify(closeOut.body));
    assert.equal(closeOut.body.code, 'CLOSE_OUT_IS_THE_PERSONS');
  });
});
