/**
 * LIN-826 — route-level: POST /api/proxy/recommend-and-dispatch defaults
 * `subscribe:true` for a fresh sessioned worker so the autopilot fan-out
 * subscribes to each worker with no new prompt instruction, while keeping the
 * flag overridable and leaving a non-sessioned dispatch unsubscribed.
 *
 * The default lives in the route (subscribeResolved), not the store, so it must
 * be observed at the dispatch seam. We drive the deterministic verb-override
 * path (kind set → no LLM/OpenRouter), capturing the item handed to addItem.
 *
 * Set NODE_ENV before importing the routes so the test-mode short-circuit
 * (token === 'test-token') and module-level rate-limiter skips apply.
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
    workspacePreferencesStore: {},
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

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

describe('LIN-826 — recommend-and-dispatch subscribe default', () => {
  test('defaults subscribe:true when a sessionId is present (fresh sessioned worker)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      sessionId: SESSION_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'verb-override path must dispatch an item');
    assert.equal(captured.item.sessionId, SESSION_ID);
    assert.equal(captured.item.subscribe, true, 'a sessioned worker subscribes by default');
  });

  test('does NOT subscribe when there is no sessionId (a non-sessioned dispatch has no parent edge)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscribe, false, 'no sessionId → no subscribe default');
  });

  test('an explicit subscribe:false overrides the sessioned default', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      sessionId: SESSION_ID,
      subscribe: false
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscribe, false, 'explicit subscribe:false wins over the default');
  });

  test('an explicit subscribe:true on a non-sessioned dispatch is honoured', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      subscribe: true
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscribe, true, 'explicit subscribe:true wins even without a sessionId');
  });

  test('rejects a non-boolean subscribe with 400', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      subscribe: 'yes'
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test('queueIfBusy is forwarded blindly and never defaulted on this path', async () => {
    const captured = {};
    const app = buildApp(captured);

    // Omitted → false (not defaulted true even for a sessioned worker).
    await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', sessionId: SESSION_ID
    });
    assert.equal(captured.item.queueIfBusy, false, 'queueIfBusy is not defaulted on recommend-and-dispatch');

    // Explicit true → forwarded.
    await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', sessionId: SESSION_ID, queueIfBusy: true
    });
    assert.equal(captured.item.queueIfBusy, true, 'explicit queueIfBusy:true is forwarded');
  });
});
