/**
 * LIN-1825 Beat 2 — route-level: both dispatch-creation entry points accept
 * an optional `periodicalId`, validate it against the live periodicals
 * registry (lib/periodicals.js getPeriodicals()) before it reaches the
 * store, and thread it into the `fields:` block the shared factory persists
 * via addItem — mirroring the `maxTasks` validation pattern (LIN-1737).
 *
 *   - POST /workspace/:urlKey/api/dispatch (session auth, routes/dispatch.js)
 *   - POST /api/proxy/dispatch (bearer token, routes/proxy.js) — the entry
 *     point that makes "works from any entry point, including a bare-token
 *     agent POST" true; skipping validation here would silently drop/accept
 *     a bad id for exactly the unbounded direct-dispatch case.
 *
 * The round-trip test uses the REAL DispatchQueueStore (not a captured-item
 * stub) and reads back through listItems() — never the raw addItem() doc —
 * per the same read-path discipline as the Beat 1 store tests.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const KNOWN_ID = 'documentation-review';
const UNKNOWN_ID = 'not-a-real-template';

async function call(app, method, path, body, headers = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { ...headers } };
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

// ---------------------------------------------------------------------------
// routes/dispatch.js — session-auth
// ---------------------------------------------------------------------------

function buildDispatchApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-08-02T00:00:00.000Z', ...item };
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

const DISPATCH_PATH = '/workspace/acme/api/dispatch';

describe('LIN-1825 Beat 2 — POST /workspace/:urlKey/api/dispatch periodicalId', () => {
  test('no periodicalId at all: byte-identical, defaults to null', async () => {
    const captured = {};
    const res = await call(buildDispatchApp(captured), 'post', DISPATCH_PATH, { prompt: 'run me', kind: 'implementation' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, null);
  });

  test('a valid periodicalId is persisted onto the fields block', async () => {
    const captured = {};
    const res = await call(buildDispatchApp(captured), 'post', DISPATCH_PATH, { prompt: 'run me', kind: 'periodical', periodicalId: KNOWN_ID });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, KNOWN_ID);
  });

  test('an unknown/typo periodicalId is rejected 400 with the exact error text', async () => {
    const captured = {};
    const res = await call(buildDispatchApp(captured), 'post', DISPATCH_PATH, { prompt: 'run me', kind: 'periodical', periodicalId: UNKNOWN_ID });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'periodicalId must be one of the known periodical template ids');
    assert.equal(captured.item, undefined, 'a rejected dispatch must never reach addItem');
  });
});

// ---------------------------------------------------------------------------
// routes/proxy.js — bearer-token consumer API (the direct-agent entry point)
// ---------------------------------------------------------------------------

function buildProxyApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
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
        return { _id: 'disp-1', dispatchedAt: '2026-08-02T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

const AUTH = { Authorization: 'Bearer anything' };

describe('LIN-1825 Beat 2 — POST /api/proxy/dispatch periodicalId (direct-agent entry point)', () => {
  test('no periodicalId at all: byte-identical, defaults to null', async () => {
    const captured = {};
    const res = await call(buildProxyApp(captured), 'post', '/api/proxy/dispatch', { prompt: 'run me', kind: 'implementation' }, AUTH);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, null);
  });

  test('a valid periodicalId is persisted onto the fields block', async () => {
    const captured = {};
    const res = await call(buildProxyApp(captured), 'post', '/api/proxy/dispatch', { prompt: 'run me', kind: 'periodical', periodicalId: KNOWN_ID }, AUTH);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, KNOWN_ID);
  });

  test('an unknown/typo periodicalId is rejected 400 with the exact error text', async () => {
    const captured = {};
    const res = await call(buildProxyApp(captured), 'post', '/api/proxy/dispatch', { prompt: 'run me', kind: 'periodical', periodicalId: UNKNOWN_ID }, AUTH);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'periodicalId must be one of the known periodical template ids');
    assert.equal(captured.item, undefined, 'a rejected dispatch must never reach addItem');
  });
});

// ---------------------------------------------------------------------------
// End-to-end round trip through the REAL store, both entry points, read back
// via listItems() — never the raw addItem() doc.
// ---------------------------------------------------------------------------

function buildProxyAppWithRealStore(store) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
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
    dispatchQueueStore: store,
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

describe('LIN-1825 Beat 2 — direct proxy dispatch (no UI) round-trips through the real store', () => {
  test('a bare readWrite proxy-token POST with { kind: "periodical", periodicalId, prompt } survives to listItems()', async () => {
    const store = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildProxyAppWithRealStore(store);

    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'run the periodical', kind: 'periodical', periodicalId: KNOWN_ID
    }, AUTH);
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const items = await store.listItems('acme');
    assert.equal(items.length, 1);
    assert.equal(items[0].periodicalId, KNOWN_ID);
    assert.equal(items[0].kind, 'periodical');
  });
});

// ---------------------------------------------------------------------------
// LIN-2385 B6 — POST /api/proxy/recommend-and-dispatch has TWO
// createDispatchItem `fields` blocks (the verb-override branch, `kind` set,
// and the recommendation-derived branch, `kind` omitted — the branch every
// autopilot loop's normal "Trigger the next step" call actually takes). Both
// must carry `periodicalId`, or the stamping capability is wired onto the
// rare path and silently dropped on the everyday one — reproducing, on the
// fused verb, the exact defect this beat exists to close.
//
// TEST-1 / TEST-14 mirror tests/unit/proxy-dispatch-defaults.test.js's own
// fixtures for these two branches: with `kind` set, the verb-override branch
// short-circuits before the LLM; TEST-14 (no `kind`) resolves via the
// test-token short-circuit to an `implement` action, landing on the
// recommendation-derived branch.
// ---------------------------------------------------------------------------

function buildRecommendApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
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
        return { _id: 'disp-1', dispatchedAt: '2026-08-30T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

describe('LIN-2385 B6 — POST /api/proxy/recommend-and-dispatch stamps periodicalId on BOTH createDispatchItem branches', () => {
  test('verb-override branch (kind set): a valid periodicalId is persisted onto the fields block', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', periodicalId: KNOWN_ID
    }, AUTH);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'verb-override path must dispatch an item');
    assert.strictEqual(captured.item.periodicalId, KNOWN_ID);
  });

  test('verb-override branch (kind set): no periodicalId defaults to null', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation'
    }, AUTH);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, null);
  });

  test('verb-override branch (kind set): an unknown/typo periodicalId is rejected 400, parity with POST /dispatch', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', periodicalId: UNKNOWN_ID
    }, AUTH);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'periodicalId must be one of the known periodical template ids');
    assert.equal(captured.item, undefined, 'a rejected dispatch must never reach addItem');
  });

  // TEST-14: no `kind` in the request body — resolves via the test-token
  // short-circuit to an `implement` action, landing on the
  // recommendation-derived `createDispatchItem` call, never the
  // verb-override one (see tests/unit/proxy-dispatch-defaults.test.js's own
  // comment establishing this fixture's branch).
  test('recommendation-derived branch (no kind — the everyday autopilot trigger): a valid periodicalId is persisted onto the fields block', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14', periodicalId: KNOWN_ID
    }, AUTH);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'recommendation-derived path must dispatch an item');
    assert.equal(captured.item.kind, 'implementation', 'sanity: this must be the recommendation-derived branch, not the override one');
    assert.strictEqual(captured.item.periodicalId, KNOWN_ID);
  });

  test('recommendation-derived branch (no kind): no periodicalId defaults to null', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14'
    }, AUTH);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.periodicalId, null);
  });

  test('recommendation-derived branch (no kind): an unknown/typo periodicalId is rejected 400', async () => {
    const captured = {};
    const app = buildRecommendApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14', periodicalId: UNKNOWN_ID
    }, AUTH);

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'periodicalId must be one of the known periodical template ids');
    assert.equal(captured.item, undefined, 'a rejected dispatch must never reach addItem');
  });
});
