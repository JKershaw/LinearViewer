/**
 * LIN-3129 S1 step 6 — `requireGrant`, and the `req.proxyTokenGrants` stamp that
 * `authenticateProxyToken` now sets.
 *
 * Part A exercises the pure middleware factory on a tiny express app. Part B
 * runs the REAL `createProxyRoutes` auth over a REAL ProxyTokenStore and reads
 * the stamped `req.proxyTokenGrants` through a capture middleware mounted ahead
 * of the router (the same `req` object is threaded through).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';
import { requireGrant } from '../../lib/require-grant.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createProxyRoutes } from '../../routes/proxy.js';

// ---------------------------------------------------------------------------
// Part A — the middleware factory
// ---------------------------------------------------------------------------

function appWithGrants(grants, name) {
  const app = express();
  app.get(`/${name}`, (req, res, next) => {
    req.proxyTokenGrants = grants;
    next();
  }, requireGrant(name), (req, res) => res.json({ ok: true }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-3129 — requireGrant middleware', () => {
  test('grant present → next (200)', async () => {
    const res = await get(appWithGrants(['take', 'dispatch'], 'take'), '/take');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  test('grant absent, empty, missing or non-array → 403 with the exact code body', async () => {
    for (const grants of [undefined, [], ['dispatch'], 'take']) {
      const res = await get(appWithGrants(grants, 'take'), '/take');
      assert.equal(res.status, 403, `grants=${JSON.stringify(grants)}`);
      assert.equal(res.body.code, 'TAKE_GRANT_REQUIRED');
      assert.equal(res.body.category, 'auth');
      assert.equal(res.body.retryable, false);
      assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0, 'jsonError carries a message');
    }
  });

  test('dispatch grant uses the DISPATCH_GRANT_REQUIRED code', async () => {
    const denied = await get(appWithGrants(['take'], 'dispatch'), '/dispatch');
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'DISPATCH_GRANT_REQUIRED');

    const allowed = await get(appWithGrants(['take', 'dispatch'], 'dispatch'), '/dispatch');
    assert.equal(allowed.status, 200);
  });

  test('an unknown grant name throws at factory time (a programming error caught at mount)', () => {
    assert.throws(() => requireGrant('admin'), /unknown grant/i);
    assert.throws(() => requireGrant(''), /unknown grant/i);
  });
});

// ---------------------------------------------------------------------------
// Part B — authenticateProxyToken stamps req.proxyTokenGrants
// ---------------------------------------------------------------------------

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

function buildStampApp(store) {
  const app = express();
  app.use(express.json());
  let captured = null;
  // The same `req` object flows through the router, so capture it up front and
  // read the stamps after the real authenticateProxyToken has run.
  app.use((req, res, next) => { captured = req; next(); });
  app.use(createProxyRoutes({
    proxyTokenStore: store,
    proxyEventStore: { recordEvent: async () => {}, listEvents: async () => ({ events: [], total: 0 }), listCredentialHealth: async () => ({ tokens: [] }) },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { app, captured: () => captured };
}

async function probeInstructions(app, token) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/instructions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    await res.text();
    return res.status;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function seedOwnerlessWithGrants(store, plain) {
  await store.collection.insertOne({
    _id: crypto.randomUUID(), urlKey: 'acme',
    tokenHash: crypto.createHash('sha256').update(plain).digest('hex'),
    label: 'legacy', scope: 'readWrite', kind: 'standard', singleUse: false,
    createdBy: null, grants: ['take', 'dispatch'], parentTokenId: null,
    workspaceId: null, createdAt: new Date(), lastUsedAt: null, expiresAt: null, consumed: false
  });
}

describe('LIN-3129 — authenticateProxyToken stamps req.proxyTokenGrants', () => {
  test('a grant-bearing working token stamps [take, dispatch]', async () => {
    const store = new ProxyTokenStore({ collection: createMockCollection() });
    store.setOwnerCheck(async () => ({ status: 'owner' }));
    const bootstrap = await store.mintGrantBootstrap({
      urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: ['take', 'dispatch']
    });
    const working = await store.exchangeBootstrapToken(bootstrap.token);

    const { app, captured } = buildStampApp(store);
    const status = await probeInstructions(app, working.token);

    assert.equal(status, 200);
    assert.deepEqual(captured().proxyTokenGrants, ['take', 'dispatch']);
    assert.equal(captured().proxyTokenScope, 'readWrite');
  });

  test('a plain token stamps []', async () => {
    const store = new ProxyTokenStore({ collection: createMockCollection() });
    const { token } = await store.createToken('acme', { scope: 'readWrite', createdBy: 'account-A' });

    const { app, captured } = buildStampApp(store);
    const status = await probeInstructions(app, token);

    assert.equal(status, 200);
    assert.deepEqual(captured().proxyTokenGrants, []);
  });

  test('an ownerless document with stored grants stamps [] (no authority)', async () => {
    const store = new ProxyTokenStore({ collection: createMockCollection() });
    const plain = 'ownerless-' + crypto.randomUUID();
    await seedOwnerlessWithGrants(store, plain);

    const { app, captured } = buildStampApp(store);
    const status = await probeInstructions(app, plain);

    assert.equal(status, 200);
    assert.deepEqual(captured().proxyTokenGrants, []);
  });
});
