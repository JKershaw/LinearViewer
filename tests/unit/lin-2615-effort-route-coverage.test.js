/**
 * LIN-2615 review gate items 1 + 2 + the kickoff blocking finding.
 *
 * The review's mutation G showed all five route -> `createDispatchItem`
 * `effort` forwards could be severed at once with a fully green suite:
 * `effort` was proven reaching the consumer payload only from
 * `createDispatchItem` INWARD (unit tests on the factory/resolver), never
 * from the wire. These tests close that: real HTTP requests against each
 * write verb, observed at the `addItem` seam, so a severed route-level
 * forward (or a missing kickoff validation call) goes red here.
 *
 * Also closes the kickoff ingress-validation gap itself (the review's sole
 * blocking finding): `POST /api/proxy/autopilot/kickoff` now validates
 * `effort` exactly like `model`/`harness`, mirroring the other three write
 * verbs' malformed-input behavior instead of silently persisting it.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';

const EFFORT = 'high';

function buildProxyApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' })
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

function buildDispatchApp(captured) {
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

describe('LIN-2615 — POST /api/proxy/dispatch forwards effort to the factory (route -> factory, not factory-only)', () => {
  test('an explicit effort reaches the item captured at addItem', async () => {
    const captured = {};
    const app = buildProxyApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', effort: EFFORT });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.effort, EFFORT);
  });

  test('an omitted effort becomes null', async () => {
    const captured = {};
    const app = buildProxyApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(captured.item.effort, null);
  });

  test('a non-string effort is rejected with 400', async () => {
    const app = buildProxyApp({});
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', effort: 42 });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /effort must be a string/);
  });
});

describe('LIN-2615 — POST /api/proxy/recommend-and-dispatch forwards effort on BOTH creation branches', () => {
  test('an explicit effort reaches the item (verb-override branch, kind supplied)', async () => {
    const captured = {};
    const app = buildProxyApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', effort: EFFORT
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'verb-override path must dispatch an item');
    assert.equal(captured.item.effort, EFFORT);
  });

  test('an invalid effort is rejected with 400 (verb-override branch\'s own inline validation)', async () => {
    const app = buildProxyApp({});
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', effort: 'x'.repeat(1001)
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /effort exceeds maximum length/);
  });

  // Recommendation-derived branch (no `kind` -> LLM descent resolves the
  // action). Mirrors proxy-dispatch-model.test.js's TEST-14 fixture, whose
  // test-token short-circuit resolves a started, childless issue straight to
  // an `implement` action, landing on the SECOND addItem site.
  test('an explicit effort reaches the item (recommendation-derived branch, no kind supplied)', async () => {
    const captured = {};
    const app = buildProxyApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14', effort: EFFORT
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'recommendation-derived path must dispatch an item');
    // Proves the descent branch was actually taken, not the verb-override one.
    assert.equal(captured.item.issueIdentifier, 'TEST-14');
    assert.equal(captured.item.effort, EFFORT);
  });

  test('an omitted effort becomes null (recommendation-derived branch)', async () => {
    const captured = {};
    const app = buildProxyApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', { issueIdentifier: 'TEST-14' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'recommendation-derived path must dispatch an item');
    assert.strictEqual(captured.item.effort, null);
  });
});

describe('LIN-2615 — POST /workspace/:urlKey/api/dispatch forwards effort', () => {
  test('an explicit effort reaches the item captured at addItem', async () => {
    const captured = {};
    const app = buildDispatchApp(captured);
    const res = await call(app, 'post', '/workspace/acme/api/dispatch', { prompt: 'run me', effort: EFFORT });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.effort, EFFORT);
  });

  test('an omitted effort becomes null', async () => {
    const captured = {};
    const app = buildDispatchApp(captured);
    const res = await call(app, 'post', '/workspace/acme/api/dispatch', { prompt: 'run me' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(captured.item.effort, null);
  });
});

describe('LIN-2615 — POST /api/proxy/autopilot/kickoff: effort parity fix (the review\'s blocking finding)', () => {
  test('an explicit effort reaches the item captured at addItem (parity, no new fan-out)', async () => {
    const captured = {};
    const app = buildProxyApp(captured);
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', { goal: 'ship it', target: 'cli', effort: EFFORT });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.effort, EFFORT);
  });

  test('an omitted effort becomes null', async () => {
    const captured = {};
    const app = buildProxyApp(captured);
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', { goal: 'ship it', target: 'cli' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(captured.item.effort, null);
  });

  // The blocking finding itself: before the fix, kickoff forwarded `effort`
  // to createDispatchItem with NO validation call, so these three malformed
  // shapes were silently persisted rather than rejected — the exact
  // asymmetry the review's live-execution table demonstrated against the
  // other three write verbs.
  test('a non-string effort is rejected with 400 (was: silently persisted)', async () => {
    const app = buildProxyApp({});
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', { goal: 'ship it', target: 'cli', effort: { evil: true } });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /effort must be a string/);
  });

  test('an over-length effort is rejected with 400 (was: silently persisted)', async () => {
    const app = buildProxyApp({});
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', { goal: 'ship it', target: 'cli', effort: 'x'.repeat(1001) });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /effort exceeds maximum length/);
  });

  test('an effort with a control character is rejected with 400 (was: silently persisted, reachable by a runner as a CLI arg)', async () => {
    const app = buildProxyApp({});
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', { goal: 'ship it', target: 'cli', effort: 'high\x00rm -rf' });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /effort contains invalid characters/);
  });

  test('an unknown-but-well-formed effort level is still accepted (fail-soft, never a 400)', async () => {
    const captured = {};
    const app = buildProxyApp(captured);
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', { goal: 'ship it', target: 'cli', effort: 'turbo' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.effort, 'turbo');
  });

  test('an unknown level is logged, matching the other three write verbs (close-out symmetry nit)', async () => {
    // Log observability only — the caller-observable contract is already
    // pinned by the fail-soft test above. Pinned because the runtime-served
    // `## Effort` docs describe the warning as a property of every write verb.
    const captured = {};
    const app = buildProxyApp(captured);
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', { goal: 'ship it', target: 'cli', effort: 'turbo' });
      assert.equal(res.status, 201);
    } finally {
      console.warn = realWarn;
    }
    assert.ok(
      warnings.some(w => w.includes('Unknown dispatch effort level: turbo')),
      `expected an unknown-effort warning, got: ${JSON.stringify(warnings)}`
    );
  });

  test('a known level is NOT warned about (the warn is out-of-set only, not every dispatch)', async () => {
    const captured = {};
    const app = buildProxyApp(captured);
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      await call(app, 'post', '/api/proxy/autopilot/kickoff', { goal: 'ship it', target: 'cli', effort: 'high' });
    } finally {
      console.warn = realWarn;
    }
    assert.ok(!warnings.some(w => w.includes('Unknown dispatch effort level')), JSON.stringify(warnings));
  });
});
