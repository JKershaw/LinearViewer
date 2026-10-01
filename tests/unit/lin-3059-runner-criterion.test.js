/**
 * LIN-3129 S1 step 7 (LIN-3059 F1) — the runner criterion test.
 *
 * THE test LIN-2884 MUST KEEP GREEN once it gates `dispatch` with
 * `requireGrant('dispatch')`: a grant-bearing runner working token can still
 * enqueue via `POST /api/proxy/dispatch`. Its twin is the gate itself (LIN-3136):
 * an ordinary `readWrite` token without the grant is refused.
 *
 * File-local harness (no BASE_DEPS — S1 leaves tests/unit/lib/proxy-fake-deps.js
 * untouched): installHermeticLinearTransport, a REAL ProxyTokenStore over an
 * in-memory collection, and an addItem-ONLY dispatchQueueStore (the route answers
 * 503 "Dispatch is not available" without one, and the referent guard fails open
 * on an addItem-only store). The grant-bearing bootstrap is minted with a fake
 * owner check and exchanged through the route `POST /api/proxy/token`.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { RUNNER_GRANTS } from '../../lib/proxy-scopes.js';

function createMockCollection() {
  let docs = [];
  const matches = (d, query) => Object.keys(query).every(k => {
    if (k === '$or') return query.$or.some(sub => matches(d, sub));
    const val = query[k];
    if (val && typeof val === 'object') {
      if ('$lt' in val && '$ne' in val) {
        return d[k] !== val.$ne && d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      }
      if ('$lt' in val) return d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      return true;
    }
    return d[k] === val;
  });
  return {
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query) {
      const before = docs.length;
      docs = docs.filter(d => !matches(d, query));
      return { deletedCount: before - docs.length };
    },
    find(query) { return { toArray: async () => docs.filter(d => matches(d, query)) }; },
    _docs: () => docs
  };
}

function buildApp(store, captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: store,
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    // addItem-ONLY: the referent guard fails open on a store without the read
    // capability (LIN-1656), which is exactly this file's documented setup.
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-09-28T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, { token, body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const opts = { method: method.toUpperCase(), headers };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function newGrantStore() {
  const store = new ProxyTokenStore({ collection: createMockCollection() });
  store.setOwnerCheck(async () => ({ status: 'owner' }));
  return store;
}

describe('LIN-3059 criterion — a grant-bearing runner token can dispatch', () => {
  test('mint → exchange (route) → POST /api/proxy/dispatch = 201', async () => {
    const store = await newGrantStore();
    const captured = {};
    const app = buildApp(store, captured);

    // 1. Owner-checked runner bootstrap.
    const bootstrap = await store.mintGrantBootstrap({
      urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: RUNNER_GRANTS
    });
    assert.ok(bootstrap?.token, 'mintGrantBootstrap returned a bootstrap token');

    // 2–4. Exchange through the REAL route; assert the working credential shape.
    const exchanged = await call(app, 'post', '/api/proxy/token', { token: bootstrap.token });
    assert.equal(exchanged.status, 200, JSON.stringify(exchanged.body));
    assert.equal(exchanged.body.scope, 'readWrite');
    assert.deepEqual(exchanged.body.grants, ['take', 'dispatch']);

    // 5. Enqueue with that working token.
    const dispatched = await call(app, 'post', '/api/proxy/dispatch', {
      token: exchanged.body.token,
      body: { prompt: 'run me', kind: 'implementation' }
    });
    assert.equal(dispatched.status, 201, JSON.stringify(dispatched.body));
    assert.ok(captured.item, 'the fake queue saw the dispatched item');
    assert.match(captured.item.prompt, /run me/, 'the prompt reached the queue (proxy context may be appended)');
  });

  test('twin: a plain readWrite token is refused 403 DISPATCH_GRANT_REQUIRED (the LIN-2884 gate, LIN-3136)', async () => {
    const store = await newGrantStore();
    const captured = {};
    const app = buildApp(store, captured);
    const { token } = await store.createToken('acme', { scope: 'readWrite', createdBy: 'account-A' });

    const dispatched = await call(app, 'post', '/api/proxy/dispatch', {
      token,
      body: { prompt: 'run me', kind: 'implementation' }
    });
    assert.equal(dispatched.status, 403, JSON.stringify(dispatched.body));
    assert.equal(dispatched.body.code, 'DISPATCH_GRANT_REQUIRED');
    assert.equal(captured.item, undefined, 'the ordinary readWrite token enqueues nothing');
  });
});
