/**
 * LIN-3409 item 6 — the Settings mint (POST /workspace/:urlKey/api/proxy/tokens)
 * stamps the session-resolved workspace id on the grant-less token it mints, so
 * proxy halt can owner-check the token's creator. Identity only: grants stay [],
 * lineage stays null, and nothing in the request body can set any of them.
 *
 * Real route factory over the real ProxyTokenStore (as proxy-token-route-ownerless).
 */
process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

function inMemoryCollection() {
  const docs = [];
  const match = (d, q) => Object.entries(q).every(([k, v]) => d[k] === v);
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(q) { return docs.find(d => match(d, q)) || null; },
    find(q = {}) { const r = docs.filter(d => match(d, q)); return { async toArray() { return r.slice(); } }; },
    async updateOne(q, u) {
      const d = docs.find(x => match(x, q));
      if (!d) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(d, u.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne() { return { deletedCount: 0 }; },
    async deleteMany() { return { deletedCount: 0 }; }
  };
}

async function mint(body, { workspaceId = 'ws-session' } = {}) {
  const collection = inMemoryCollection();
  const proxyTokenStore = new ProxyTokenStore({ collection });
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: 'acme', id: workspaceId };
      req.session = { accountId: 'account-A', features: { proxy: true } };
      next();
    },
    getWorkspaceAccessToken: () => null, resolveWorkspaceAccess: () => null,
    getWorkspaceOpenRouterKey: async () => null, workspacePreferencesStore: {}, freeTierStore: {}
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/workspace/acme/api/proxy/tokens`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: res.status, collection };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('a Settings mint stores the session workspace id with no grants and no lineage', async () => {
  const { status, collection } = await mint({ label: 'ops', scope: 'readWrite' });
  assert.equal(status, 201);
  const [doc] = collection._docs;
  assert.equal(doc.workspaceId, 'ws-session');
  assert.deepEqual(doc.grants, []);
  assert.equal(doc.parentTokenId, null);
  assert.equal(doc.lifetimeProfile, null);
  assert.equal(doc.createdBy, 'account-A');
});

test('a bootstrap-flavoured Settings mint is stamped the same way', async () => {
  const { status, collection } = await mint({ label: 'handoff', scope: 'readWrite', bootstrap: true });
  assert.equal(status, 201);
  assert.equal(collection._docs[0].workspaceId, 'ws-session');
  assert.deepEqual(collection._docs[0].grants, []);
});

test('workspaceId, parentTokenId and lifetimeProfile in the body are ignored', async () => {
  const { status, collection } = await mint({
    label: 'x', scope: 'readWrite',
    workspaceId: 'ws-attacker', parentTokenId: 'root', lifetimeProfile: 'worker'
  });
  assert.equal(status, 201);
  const [doc] = collection._docs;
  assert.equal(doc.workspaceId, 'ws-session', 'the id comes from workspaceFromUrl, never the body');
  assert.deepEqual(doc.grants, []);
  assert.equal(doc.parentTokenId, null);
  assert.equal(doc.lifetimeProfile, null);
});

test('a client-named grant is refused as before and mints nothing', async () => {
  const { status, collection } = await mint({
    label: 'x', scope: 'readWrite', workspaceId: 'ws-attacker', grants: ['take', 'dispatch']
  });
  assert.notEqual(status, 201);
  assert.equal(collection._docs.length, 0);
});
