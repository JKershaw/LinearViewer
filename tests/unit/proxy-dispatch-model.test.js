/**
 * LIN-438 — route-level: the execution `model` field is accepted, validated
 * loosely (like `repo`), and forwarded blindly to the dispatch item on BOTH proxy
 * write verbs: POST /api/proxy/dispatch and POST /api/proxy/recommend-and-dispatch.
 *
 * `model` is the EXECUTION model the consumer/runner passes to its own CLI, NOT
 * the server-side generation model — so the server must NOT registry-check it. It
 * is opaque: string + length + dangerous-char validation only, then passed to
 * addItem verbatim. Omitted/null preserves the consumer default.
 *
 * The value is observed at the dispatch seam by capturing the item handed to
 * addItem. NODE_ENV=test applies the test-token short-circuit (skips the LLM on
 * the verb-override recommend-and-dispatch path) and the module-level rate limiter.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

function buildApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
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
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const MODEL = 'anthropic/claude-opus-4.8';
const HARNESS = 'opencode';

describe('LIN-438 — POST /api/proxy/dispatch carries the execution model', () => {
  test('an explicit model is forwarded to the dispatch item verbatim', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', model: MODEL });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.model, MODEL);
  });

  test('an OpenRouter-style id (slash + dots) is not parsed or registry-checked', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', model: 'openai/gpt-5.4-mini' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.model, 'openai/gpt-5.4-mini');
  });

  test('an omitted model becomes null (consumer default preserved)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(captured.item.model, null);
  });

  test('a non-string model is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', model: 123 });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /model must be a string/);
  });

  test('an over-length model is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', model: 'x'.repeat(1001) });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /model exceeds maximum length/);
  });

  test('a model with dangerous control characters is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', model: 'anthropic/claude\x00opus' });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /model contains invalid characters/);
  });
});

describe('LIN-438 — POST /api/proxy/recommend-and-dispatch carries the execution model', () => {
  test('an explicit model is forwarded to the dispatch item (verb-override path)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', model: MODEL
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'verb-override path must dispatch an item');
    assert.equal(captured.item.model, MODEL);
  });

  test('an omitted model becomes null', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(captured.item.model, null);
  });

  test('an invalid model is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', model: 'x'.repeat(1001)
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    // Routed through the shared validateOpaqueDispatchField helper (LIN-1084),
    // so the message now matches POST /dispatch's specific over-length wording
    // rather than the old generic "model is invalid".
    assert.match(res.body.error, /model exceeds maximum length/);
  });

  // ── Recommendation-derived branch (LIN-438 close-out ledger discharge) ──────
  // recommend-and-dispatch has TWO addItem sites: the verb-override branch
  // (kind set, exercised above) and the recommendation-derived branch (no kind →
  // LLM descent resolves the action, then dispatches). The review's close-out
  // ledger flagged that the second branch — though byte-identical to the first —
  // was never test-driven. These tests drive it: with NO `kind`, the test-token
  // short-circuit in computeRecommendation resolves a started, childless fixture
  // (TEST-14) to an `implement` action carrying a real prompt, so the descent
  // terminates on the recommendation-derived addItem seam rather than the
  // verb-override one.
  test('an explicit model is forwarded to the dispatch item (recommendation-derived path)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14', model: MODEL
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'recommendation-derived path must dispatch an item');
    // Prove we actually took the descent branch, not the verb-override one: the
    // recommendation-derived path never carries the caller's kind (there is none)
    // and stamps the terminal identifier it resolved to.
    assert.equal(captured.item.issueIdentifier, 'TEST-14');
    assert.equal(captured.item.model, MODEL);
  });

  test('an omitted model becomes null (recommendation-derived path)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'recommendation-derived path must dispatch an item');
    assert.strictEqual(captured.item.model, null);
  });
});

describe('LIN-1084 — POST /api/proxy/dispatch carries the execution harness', () => {
  test('an explicit harness is forwarded to the dispatch item verbatim', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', harness: HARNESS });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.harness, HARNESS);
  });

  test('an omitted harness becomes null (consumer default preserved)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(captured.item.harness, null);
  });

  test('a non-string harness is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', harness: 123 });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /harness must be a string/);
  });

  test('an over-length harness is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', harness: 'x'.repeat(1001) });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /harness exceeds maximum length/);
  });

  test('a harness with dangerous control characters is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', harness: 'opencode\x00' });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /harness contains invalid characters/);
  });

  test('model and harness are forwarded together', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', model: MODEL, harness: HARNESS });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.model, MODEL);
    assert.equal(captured.item.harness, HARNESS);
  });
});

describe('LIN-1084 — POST /api/proxy/recommend-and-dispatch carries the execution harness', () => {
  test('an explicit harness is forwarded to the dispatch item (verb-override path)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', harness: HARNESS
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'verb-override path must dispatch an item');
    assert.equal(captured.item.harness, HARNESS);
  });

  test('an omitted harness becomes null', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(captured.item.harness, null);
  });

  test('an invalid harness is rejected with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', harness: 'x'.repeat(1001)
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /harness exceeds maximum length/);
  });

  test('an explicit harness is forwarded to the dispatch item (recommendation-derived path)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14', harness: HARNESS
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'recommendation-derived path must dispatch an item');
    assert.equal(captured.item.issueIdentifier, 'TEST-14');
    assert.equal(captured.item.harness, HARNESS);
  });

  test('an omitted harness becomes null (recommendation-derived path)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'recommendation-derived path must dispatch an item');
    assert.strictEqual(captured.item.harness, null);
  });
});

describe('LIN-1084 — model:0 validation divergence is fixed on both endpoints', () => {
  // Beat-2 planning found routes/proxy.js rejected `model: 0` (a falsy
  // non-string) while routes/dispatch.js silently accepted it as absent. Both
  // proxy endpoints now route through the same shared validator as
  // routes/dispatch.js, so all three should reject `model: 0` identically.
  test('POST /api/proxy/dispatch rejects model: 0', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', model: 0 });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /model must be a string/);
  });

  test('POST /api/proxy/recommend-and-dispatch rejects model: 0', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', model: 0
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /model must be a string/);
  });
});
