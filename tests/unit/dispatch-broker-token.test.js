/**
 * LIN-1397 — POST /api/dispatch/broker-token: the new consumer-dispatch-token-
 * authenticated endpoint the Simple Dispatcher stall-failsafe reaper calls to
 * mint a fresh single-use bootstrap when re-arming a broker-armed session's
 * local credential broker at refire time.
 *
 * Key behaviors pinned here:
 *  - Valid dispatch token with a non-null createdBy -> 201, mints a
 *    kind:'bootstrap'/scope:'readWrite' proxy token scoped to the dispatch
 *    token's own urlKey, with createdBy stamped from the dispatch token owner.
 *  - Dispatch token with createdBy: null (pre-LIN-1397 / never re-minted) ->
 *    503 WORKSPACE_NOT_CONNECTED, fails BEFORE attempting a mint (never a
 *    null-owner success path).
 *  - Invalid/absent Authorization -> 401, no mint attempted.
 *  - proxyTokenStore absent -> 503 (endpoint not configured), no crash.
 *  - Mint throws / returns no token -> 503, fail-closed.
 *
 * Mirrors the buildApp/call scaffolding of dispatch-route-proxy-context.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';

const PATH = '/api/dispatch/broker-token';

function buildApp(opts = {}) {
  const dispatchTokenStore = opts.dispatchTokenStore || {
    validateToken: async (token) => {
      if (token === 'good-token') return { urlKey: 'acme', label: 'refire', createdBy: 'account-A' };
      if (token === 'no-owner-token') return { urlKey: 'acme', label: 'legacy', createdBy: null };
      return null;
    }
  };
  const proxyTokenStore = 'proxyTokenStore' in opts
    ? opts.proxyTokenStore
    : {
        createToken: async (urlKey, options) => ({
          tokenId: 'pt-1',
          token: 'minted-bootstrap',
          label: options.label,
          scope: options.scope,
          kind: options.kind,
          expiresAt: '2026-07-20T00:00:00.000Z',
          _urlKey: urlKey,
          _createdBy: options.createdBy
        })
      };

  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {},
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => next(),
    userPreferencesStore: {},
    proxyTokenStore
  }));
  return app;
}

async function call(app, path, token) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = {};
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-1397 — POST /api/dispatch/broker-token', () => {
  test('valid token with an owner -> 201, mints a scoped bootstrap with createdBy stamped', async () => {
    const captured = [];
    const proxyTokenStore = {
      createToken: async (urlKey, options) => {
        captured.push({ urlKey, options });
        return { token: 'minted-bootstrap', expiresAt: '2026-07-20T00:00:00.000Z' };
      }
    };
    const res = await call(buildApp({ proxyTokenStore }), PATH, 'good-token');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.token, 'minted-bootstrap');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].urlKey, 'acme');
    assert.equal(captured[0].options.kind, 'bootstrap');
    assert.equal(captured[0].options.scope, 'readWrite');
    assert.equal(captured[0].options.createdBy, 'account-A');
  });

  test('dispatch token with no owner -> 503 WORKSPACE_NOT_CONNECTED, no mint attempted', async () => {
    let mintCalled = false;
    const proxyTokenStore = { createToken: async () => { mintCalled = true; return { token: 'x' }; } };
    const res = await call(buildApp({ proxyTokenStore }), PATH, 'no-owner-token');
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'WORKSPACE_NOT_CONNECTED');
    assert.equal(mintCalled, false, 'never mints a null-owner bootstrap');
  });

  test('missing Authorization -> 401', async () => {
    const res = await call(buildApp(), PATH, undefined);
    assert.equal(res.status, 401);
  });

  test('invalid token -> 401', async () => {
    const res = await call(buildApp(), PATH, 'garbage');
    assert.equal(res.status, 401);
  });

  test('proxyTokenStore absent -> 503, no crash', async () => {
    const res = await call(buildApp({ proxyTokenStore: null }), PATH, 'good-token');
    assert.equal(res.status, 503);
  });

  test('mint throws -> 503 fail-closed', async () => {
    const proxyTokenStore = { createToken: async () => { throw new Error('boom'); } };
    const res = await call(buildApp({ proxyTokenStore }), PATH, 'good-token');
    assert.equal(res.status, 503);
  });

  test('mint returns no token -> 503 fail-closed', async () => {
    const proxyTokenStore = { createToken: async () => ({ token: null }) };
    const res = await call(buildApp({ proxyTokenStore }), PATH, 'good-token');
    assert.equal(res.status, 503);
  });
});
