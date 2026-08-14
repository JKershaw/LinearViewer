/**
 * LIN-438 — route-level: the user-facing POST /workspace/:urlKey/api/dispatch
 * accepts, loosely-validates, and forwards the execution `model` field to the
 * dispatch item, mirroring the proxy verbs. `model` is opaque (string + length +
 * dangerous-char checks, no registry) and passed to addItem verbatim; omitted ⇒
 * null (consumer default preserved).
 *
 * The value is observed at the dispatch seam by capturing the item handed to
 * addItem. A stub workspaceFromUrl establishes req.workspace + req.session so the
 * session-authed handler runs without real auth.
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
        return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    // Stub session auth: pin the workspace and a session so the handler runs.
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null
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
const MODEL = 'anthropic/claude-opus-4.8';
const HARNESS = 'opencode';

describe('LIN-438 — user-facing /api/dispatch carries the execution model', () => {
  test('an explicit model is forwarded to the dispatch item', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', model: MODEL });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.model, MODEL);
  });

  test('an omitted model becomes null', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(captured.item.model, null);
  });

  test('a non-string model is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', PATH, { prompt: 'run me', model: 42 });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /model must be a string/);
  });

  test('an over-length model is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', PATH, { prompt: 'run me', model: 'x'.repeat(1001) });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /model exceeds maximum length/);
  });

  test('a model with dangerous control characters is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', PATH, { prompt: 'run me', model: 'anthropic/claude\x00opus' });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /model contains invalid characters/);
  });

  // Beat-2 planning found this router previously accepted `model: 0` silently
  // as absent (`if (model && ...)` short-circuits on a falsy value), while
  // routes/proxy.js rejected it. Now routed through the shared validator, so
  // this falsy-non-string case is rejected here too.
  test('model: 0 (a falsy non-string) is rejected with 400 — the fixed divergence', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', PATH, { prompt: 'run me', model: 0 });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /model must be a string/);
  });
});

describe('LIN-1084 — user-facing /api/dispatch carries the execution harness', () => {
  test('an explicit harness is forwarded to the dispatch item', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', harness: HARNESS });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.harness, HARNESS);
  });

  test('an omitted harness becomes null', async () => {
    // The session route routes through the shared factory (LIN-1139) with
    // applyDefaultHarness:false — it deliberately does NOT interpose the
    // claude-code default (that is scoped to the proxy dispatch boundary,
    // LIN-1159). The dispatch-page UI owns the harness default and offers an
    // explicit "blank -> null" escape hatch (LIN-1111), so a blank harness must
    // stay null here.
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(captured.item.harness, null);
  });

  test('a non-string harness is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', PATH, { prompt: 'run me', harness: 42 });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /harness must be a string/);
  });

  test('an over-length harness is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', PATH, { prompt: 'run me', harness: 'x'.repeat(1001) });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /harness exceeds maximum length/);
  });

  test('a harness with dangerous control characters is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', PATH, { prompt: 'run me', harness: 'opencode\x00' });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /harness contains invalid characters/);
  });

  test('harness: 0 (a falsy non-string) is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', PATH, { prompt: 'run me', harness: 0 });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /harness must be a string/);
  });

  test('model and harness are forwarded together', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', PATH, { prompt: 'run me', model: MODEL, harness: HARNESS });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.model, MODEL);
    assert.equal(captured.item.harness, HARNESS);
  });
});
