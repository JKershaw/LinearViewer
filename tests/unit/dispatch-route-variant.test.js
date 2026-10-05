/**
 * Route-level tests for the `variant` run fact intake (LIN-3248 N2).
 *
 * `variant` is a DEDICATED, validated body field on
 * POST /workspace/:urlKey/api/dispatch — never sniffed from `promptName` (a
 * real stepper kickoff is named `Autopilot (LIN-NNNN)`). Only `'standard'` or
 * `'stepper'` is accepted, only on a FRESH `kind: 'autopilot'` dispatch, and
 * never alongside abort/cascade/followUpTo. When accepted it is threaded into
 * the fields block the shared dispatch factory persists via addItem; absent/null
 * stays null, which the page reads as unknown and fails the seam-guard promise
 * closed.
 *
 * Mirrors the scaffolding in dispatch-route-stop-at.test.js.
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
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-08-01T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
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

describe('LIN-3248 — POST /workspace/:urlKey/api/dispatch variant intake', () => {
  test('no variant at all: defaults to null on the row (page reads unknown, promise closed)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.variant, null);
    assert.ok(!('variant' in res.body.item), 'the 201 shape is unchanged — variant is not echoed');
  });

  test("a valid variant:'stepper' on a fresh autopilot dispatch is persisted", async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1', variant: 'stepper' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.variant, 'stepper');
  });

  test("a valid variant:'standard' is persisted", async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1', variant: 'standard' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.variant, 'standard');
  });

  test('another variant value is rejected 400', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1', variant: 'mystery' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, "variant must be 'standard' or 'stepper'");
    assert.equal(captured.item, undefined, 'no row is created on refusal');
  });

  test('variant on a non-autopilot kind is rejected 400', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', issueIdentifier: 'LIN-1', variant: 'stepper' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, "variant requires kind 'autopilot'");
    assert.equal(captured.item, undefined, 'no row is created on refusal');
  });

  test('variant with abort is rejected 400 (fresh dispatch only)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { abort: true, abortTo: UUID, variant: 'stepper' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'variant is only valid on a fresh dispatch (not abort, cascade or followUpTo)');
    assert.equal(captured.item, undefined, 'no row is created on refusal');
  });

  test('variant with followUpTo is rejected 400 (fresh dispatch only)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', issueIdentifier: 'LIN-1', followUpTo: 'parent-1', variant: 'stepper' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'variant is only valid on a fresh dispatch (not abort, cascade or followUpTo)');
    assert.equal(captured.item, undefined, 'no row is created on refusal');
  });
});
