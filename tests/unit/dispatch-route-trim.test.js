/**
 * Route-level tests for PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim
 * (LIN-2147, graceful trim).
 *
 * Mirrors the buildApp/call scaffolding in dispatch-route-preset-crud.test.js,
 * with a REAL DispatchQueueStore (backed by the shared mock-collection
 * fixture) rather than a fake, since the route delegates straight to
 * `trimSessionBudget` and the point of this file is proving the HTTP
 * surface (status codes, body validation, session attribution) wired onto
 * that store method correctly — the method's own logic is covered in
 * tests/unit/dispatch-store-trim.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function buildApp({ dispatchQueueStore, accountId = 'account-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1', accountId };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: null,
    dispatchPresetsStore: null
  }));
  return app;
}

async function call(app, method, path, body) {
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

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

const UUID = '11111111-1111-1111-1111-111111111111';

describe('PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim (LIN-2147)', () => {
  test('rejects a non-UUID sessionId', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res = await call(app, 'patch', '/workspace/acme/api/dispatch/not-a-uuid/trim', { maxTasks: 2 });
    assert.equal(res.status, 400);
  });

  test('rejects a missing/non-integer maxTasks', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res1 = await call(app, 'patch', `/workspace/acme/api/dispatch/${UUID}/trim`, {});
    assert.equal(res1.status, 400);
    const res2 = await call(app, 'patch', `/workspace/acme/api/dispatch/${UUID}/trim`, { maxTasks: 'two' });
    assert.equal(res2.status, 400);
    const res3 = await call(app, 'patch', `/workspace/acme/api/dispatch/${UUID}/trim`, { maxTasks: 0 });
    assert.equal(res3.status, 400);
  });

  test('404s an unknown run', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res = await call(app, 'patch', `/workspace/acme/api/dispatch/${UUID}/trim`, { maxTasks: 2 });
    assert.equal(res.status, 404);
  });

  test('409s a non-downward trim (bound already at or below the requested value)', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot', maxTasks: 5 });
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'patch', `/workspace/acme/api/dispatch/${created._id}/trim`, { maxTasks: 8 });
    assert.equal(res.status, 409);
  });

  test('succeeds, returns the updated item, and attributes the trim to the session\'s accountId', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot', maxTasks: 10 });
    const app = buildApp({ dispatchQueueStore: store, accountId: 'user-42' });
    const res = await call(app, 'patch', `/workspace/acme/api/dispatch/${created._id}/trim`, { maxTasks: 3 });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.item.maxTasks, 3);
    assert.equal(res.body.item.trimHistory.length, 1);
    assert.equal(res.body.item.trimHistory[0].by, 'user-42');
  });

  test('a run in a DIFFERENT workspace 404s — no cross-workspace trim', async () => {
    const store = makeStore();
    const created = await store.addItem('other-workspace', { prompt: 'kickoff', kind: 'autopilot', maxTasks: 10 });
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'patch', `/workspace/acme/api/dispatch/${created._id}/trim`, { maxTasks: 2 });
    assert.equal(res.status, 404);
  });
});

describe('PATCH .../trim — maxSessionsPerTask sibling bound (LIN-2934)', () => {
  test('rejects a body with neither maxTasks nor maxSessionsPerTask', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res = await call(app, 'patch', `/workspace/acme/api/dispatch/${UUID}/trim`, {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'At least one of maxTasks or maxSessionsPerTask is required');
  });

  test('trims maxSessionsPerTask alone, independent of maxTasks', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot', maxTasks: 10, maxSessionsPerTask: 10 });
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'patch', `/workspace/acme/api/dispatch/${created._id}/trim`, { maxSessionsPerTask: 3 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.item.maxSessionsPerTask, 3);
    assert.equal(res.body.item.maxTasks, 10, 'trimming the sibling bound must not touch maxTasks');
  });

  test('trims both bounds in one call', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot', maxTasks: 10, maxSessionsPerTask: 10 });
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'patch', `/workspace/acme/api/dispatch/${created._id}/trim`, { maxTasks: 4, maxSessionsPerTask: 3 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.item.maxTasks, 4);
    assert.equal(res.body.item.maxSessionsPerTask, 3);
  });

  test('409s a non-downward maxSessionsPerTask trim even when maxTasks is omitted', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot', maxSessionsPerTask: 5 });
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'patch', `/workspace/acme/api/dispatch/${created._id}/trim`, { maxSessionsPerTask: 8 });
    assert.equal(res.status, 409);
  });

  test('rejects a non-integer maxSessionsPerTask', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res = await call(app, 'patch', `/workspace/acme/api/dispatch/${UUID}/trim`, { maxSessionsPerTask: 0 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'maxSessionsPerTask must be a positive integer');
  });
});
