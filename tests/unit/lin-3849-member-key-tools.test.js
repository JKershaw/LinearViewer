/**
 * LIN-3849 — key tools have no switch, and keys belong to the workspace.
 *
 * Before: `POST .../api/proxy/tokens` answered 403 unless the viewer's own
 * per-user `proxy` flag was on. Now a workspace MEMBER (not the owner), with no
 * feature flag set at all, can make a read or read-write key. A key that carries
 * grants (runner / driver / agent) is still owner-only: the server's owner check
 * is unchanged.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

const TOKENS_PATH = '/workspace/acme/api/proxy/tokens';

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
    find(query = {}) { return { toArray: async () => docs.filter(d => matches(d, query)) }; },
    _docs: () => docs
  };
}

const MEMBER = async () => ({ status: 'not-owner' });

function harness({ ownerCheck = MEMBER } = {}) {
  const collection = createMockCollection();
  const proxyTokenStore = new ProxyTokenStore({ collection });
  if (ownerCheck !== null) proxyTokenStore.setOwnerCheck(ownerCheck);
  return { collection, proxyTokenStore };
}

function buildApp({ proxyTokenStore, session, workspace }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = workspace || { urlKey: 'acme', id: 'ws-1', provider: 'linear' };
      req.session = session;
      next();
    },
    getWorkspaceAccessToken: () => null,
    resolveWorkspaceAccess: () => null,
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {}, freeTierStore: {}
  }));
  return app;
}

async function call(app, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${TOKENS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const session = (overrides = {}) => ({ accountId: 'account-A', ...overrides });


describe('LIN-3849 — a member makes keys with no flag set', () => {
  for (const scope of ['read', 'readWrite']) {
    test(`a member can make a ${scope} key (201, no grants)`, async () => {
      const { collection, proxyTokenStore } = harness();
      const res = await call(buildApp({ proxyTokenStore, session: session() }), { scope, label: 'mine' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(collection._docs().length, 1);
      assert.ok(!res.body.grants || res.body.grants.length === 0, 'a plain key carries no grants');
    });
  }

  test('a stale stored proxy:false no longer blocks making a key (was 403)', async () => {
    const { proxyTokenStore } = harness();
    const res = await call(buildApp({ proxyTokenStore, session: session({ features: { proxy: false } }) }), { scope: 'read' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  for (const [name, body] of [['runner', { runner: true }], ['driver', { purpose: 'driver' }], ['agent', { purpose: 'agent' }]]) {
    test(`a member is still refused the ${name} key (the grant mint stays owner-only)`, async () => {
      const { collection, proxyTokenStore } = harness();
      const res = await call(buildApp({ proxyTokenStore, session: session() }), body);
      assert.notEqual(res.status, 201, JSON.stringify(res.body));
      assert.ok(res.status >= 400 && res.status < 500, `${res.status} ${JSON.stringify(res.body)}`);
      assert.equal(collection._docs().length, 0, 'nothing written');
    });
  }

  test('the owner still makes a runner key', async () => {
    const { proxyTokenStore } = harness({ ownerCheck: async () => ({ status: 'owner' }) });
    const res = await call(buildApp({ proxyTokenStore, session: session() }), { runner: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.grants, ['take', 'dispatch']);
  });
});
