/**
 * LIN-376 — POST /api/proxy/token exchanges a single-use bootstrap token for a
 * multi-use working token.
 *
 * This is the ONE operation a bootstrap authenticates: authenticateProxyToken
 * rejects a bootstrap on every data endpoint (proved at the store level in
 * proxy-tokens.test.js), so a handoff can embed a bootstrap safely and the
 * agent's first real call is this exchange. Covered here: a valid exchange
 * returns the working token shape and audit-logs it; a second exchange 401s
 * (consumed); a non-bootstrap/invalid token 401s; missing auth 401s.
 *
 * A REAL ProxyTokenStore over an in-memory collection backs the routes so the
 * endpoint is exercised end-to-end through the store's atomic consume.
 *
 * Set NODE_ENV before importing the routes so the module-level rate-limiter
 * skips apply.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

function createMockCollection() {
  let docs = [];
  const match = (d, query) => Object.keys(query).every(k => {
    if (typeof query[k] === 'object' && query[k] !== null) return true; // skip operators
    return d[k] === query[k];
  });
  return {
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => match(d, query)) || null; },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => match(d, query));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async find() { return { async toArray() { return docs.slice(); } }; },
    async deleteOne(query) {
      const idx = docs.findIndex(d => match(d, query));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany() { return { deletedCount: 0 }; }
  };
}

function buildApp(tokenStore, events) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: tokenStore,
    proxyEventStore: { recordEvent: async (e) => { events.push(e); } },
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
  return app;
}

async function post(app, path, bearer) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = {};
    if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-376 — POST /api/proxy/token (bootstrap exchange)', () => {
  let store, events, app;
  beforeEach(() => {
    store = new ProxyTokenStore({ collection: createMockCollection() });
    events = [];
    app = buildApp(store, events);
  });

  test('exchanges a valid bootstrap for a working token and audit-logs it', async () => {
    const boot = await store.createToken('acme', { kind: 'bootstrap', scope: 'readWrite' });
    const res = await post(app, '/api/proxy/token', boot.token);

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.scope, 'readWrite');
    assert.ok(res.body.token && res.body.token !== boot.token, 'working token is a fresh secret');
    assert.ok(res.body.expiresAt, 'working token carries an expiry');
    assert.ok(res.body.notes, 'response includes notes field for LLM guidance');
    assert.match(res.body.notes, /bootstrap.*consumed|spent|single.use/i, 'notes warns the bootstrap is spent');

    // The working token authenticates data endpoints; the bootstrap never did.
    const working = await store.validateToken(res.body.token);
    assert.ok(working && working.scope === 'readWrite');
    assert.equal(await store.validateToken(boot.token), null, 'bootstrap never validates on data endpoints');

    // Success is audit-logged against the resolved workspace.
    assert.ok(events.some(e => e.endpoint === '/api/proxy/token' && e.status === 200 && e.urlKey === 'acme'));
  });

  test('a second exchange of the same bootstrap 401s (consumed)', async () => {
    const boot = await store.createToken('acme', { kind: 'bootstrap' });
    const first = await post(app, '/api/proxy/token', boot.token);
    assert.equal(first.status, 200);
    const second = await post(app, '/api/proxy/token', boot.token);
    assert.equal(second.status, 401, `expected 401, got ${second.status}`);
  });

  test('a standard (non-bootstrap) token cannot be exchanged', async () => {
    const std = await store.createToken('acme', { scope: 'readWrite' });
    const res = await post(app, '/api/proxy/token', std.token);
    assert.equal(res.status, 401, `expected 401, got ${res.status}`);
  });

  test('an unknown token 401s', async () => {
    const res = await post(app, '/api/proxy/token', 'not-a-real-token');
    assert.equal(res.status, 401);
  });

  test('missing Authorization header 401s', async () => {
    const res = await post(app, '/api/proxy/token', undefined);
    assert.equal(res.status, 401);
  });
});
