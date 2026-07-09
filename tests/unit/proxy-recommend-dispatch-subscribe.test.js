/**
 * LIN-901 — route-level: POST /api/proxy/recommend-and-dispatch subscription is
 * DECLARED on the edge (LIN-900 §6), never reconstructed from `sessionId`. The old
 * LIN-826 `subscribe` default-on-when-sessioned is removed: an undeclared edge is
 * `terminal-only`, whether or not a sessionId is present. An explicit
 * `subscription: 'everything'` is honoured; any non-enum value is a 400.
 *
 * The default lives in the route (subscriptionResolved), not the store, so it must
 * be observed at the dispatch seam. We drive the deterministic verb-override path
 * (kind set → no LLM/OpenRouter), capturing the item handed to addItem.
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
      // LIN-1175: claude-code (default harness) dispatch now fails closed without a
      // mintable token; give the stub a minting createToken like production.
      createToken: async () => ({ token: "test-bootstrap", kind: "bootstrap", scope: "readWrite" }),
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

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

describe('LIN-901 — recommend-and-dispatch subscription is declared, not reconstructed (§6)', () => {
  test('a sessioned worker with NO declared subscription defaults to terminal-only', async () => {
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
    assert.equal(captured.item.subscription, 'terminal-only', 'sessionId no longer implies a subscription (§6 removes the LIN-826 reconstruction)');
  });

  test('a non-sessioned dispatch with no declared subscription defaults to terminal-only', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscription, 'terminal-only');
  });

  test('an explicit subscription:everything is honoured', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      sessionId: SESSION_ID,
      subscription: 'everything'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscription, 'everything', 'the declared edge is honoured');
  });

  test('an explicit subscription:terminal-only is honoured', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      subscription: 'terminal-only'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscription, 'terminal-only');
  });

  test('rejects an invalid subscription value with 400 (hard enum, no legacy boolean)', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      subscription: 'yes'
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /subscription must be one of/);
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
