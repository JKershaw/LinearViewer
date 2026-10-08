/**
 * Route-level tests for the `stopAt` run fact intake (LIN-3245 / LIN-2949 P1a).
 *
 * `stopAt` is a DEDICATED, validated body field on
 * POST /workspace/:urlKey/api/dispatch — never derived from `entryRung` or any
 * other measurement. Only the value `'pr'` is accepted, only on a FRESH
 * `kind: 'autopilot'` dispatch that carries an `issueIdentifier`, and never
 * alongside abort/cascade/followUpTo. When accepted it is threaded into the
 * fields block the shared dispatch factory persists via addItem; absent/null
 * stays byte-identical to today.
 *
 * Mirrors the buildApp/call scaffolding in dispatch-route-max-tasks.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';

function buildApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    // LIN-3383: owner-only runner enqueue — this fixture acts as the workspace owner.
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-08-01T00:00:00.000Z', ...item };
      }
    },
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

const PATH = '/workspace/acme/api/dispatch';
const UUID = '11111111-1111-1111-1111-111111111111';

describe('LIN-3245 — POST /workspace/:urlKey/api/dispatch stopAt intake', () => {
  test('no stopAt at all: byte-identical, defaults to null on the row', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.stopAt, null);
    assert.ok(!('stopAt' in res.body.item), 'the 201 shape is unchanged — stopAt is not echoed');
  });

  test('stopAt is never derived from entryRung: a rung with no stopAt still stamps null', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1', entryRung: 'run-task' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.stopAt, null);
  });

  test('a valid stopAt:pr on a fresh autopilot dispatch is persisted', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1', stopAt: 'pr' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.stopAt, 'pr');
  });

  test("another stopAt value is rejected 400 — only 'pr' is accepted", async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1', stopAt: 'merge' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, "stopAt must be 'pr'");
    assert.equal(captured.item, undefined, 'no row is created on refusal');
  });

  test('stopAt:null is explicitly accepted as "no boundary" on any kind', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', issueIdentifier: 'LIN-1', stopAt: null });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.stopAt, null);
  });

  test("stopAt:pr on a non-autopilot kind is rejected 400", async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', issueIdentifier: 'LIN-1', stopAt: 'pr' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, "stopAt requires kind 'autopilot'");
    assert.equal(captured.item, undefined, 'no row is created on refusal');
  });

  test('stopAt:pr without an issueIdentifier is rejected 400', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', stopAt: 'pr' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'stopAt requires issueIdentifier');
    assert.equal(captured.item, undefined, 'no row is created on refusal');
  });

  test('stopAt:pr with abort is rejected 400 (fresh dispatchs only)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { abort: true, abortTo: UUID, stopAt: 'pr' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'stopAt is only valid on a fresh dispatch (not abort, cascade or followUpTo)');
    assert.equal(captured.item, undefined, 'no row is created on refusal');
  });

  test('stopAt:pr with cascade is rejected 400 (fresh dispatchs only)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { abort: true, abortTo: UUID, cascade: true, stopAt: 'pr' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'stopAt is only valid on a fresh dispatch (not abort, cascade or followUpTo)');
    assert.equal(captured.item, undefined, 'no row is created on refusal');
  });

  test('stopAt:pr with followUpTo is rejected 400 (fresh dispatchs only)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1', followUpTo: 'parent-1', stopAt: 'pr' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'stopAt is only valid on a fresh dispatch (not abort, cascade or followUpTo)');
    assert.equal(captured.item, undefined, 'no row is created on refusal');
  });
});
