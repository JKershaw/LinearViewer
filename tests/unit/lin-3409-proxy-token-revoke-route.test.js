/**
 * LIN-3409 item 7 — DELETE /workspace/:urlKey/api/proxy/tokens/:tokenId through
 * the real handler and the real ProxyTokenStore: revoking a grant-bearing runner
 * credential is the owner's alone (403 RUNNER_OWNER_ONLY, never 404), a member's
 * revoke of a grant-less token stays reachable, and the refusal envelope is the
 * shared one.
 */
process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

function inMemoryCollection() {
  let docs = [];
  const match = (d, q) => Object.entries(q).every(([k, v]) => {
    if (k === '$or') return v.some(sub => match(d, sub));
    return d[k] === v;
  });
  return {
    _docs: () => docs,
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(q) { return docs.find(d => match(d, q)) || null; },
    find(q = {}) { const r = docs.filter(d => match(d, q)); return { async toArray() { return r.slice(); } }; },
    async updateOne() { return { matchedCount: 1, modifiedCount: 1 }; },
    async deleteOne(q) {
      const i = docs.findIndex(d => match(d, q));
      if (i === -1) return { deletedCount: 0 };
      docs.splice(i, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(q) { const n = docs.length; docs = docs.filter(d => !match(d, q)); return { deletedCount: n - docs.length }; }
  };
}

async function setup({ ownerCheck, accountId = 'account-B' }) {
  const collection = inMemoryCollection();
  const proxyTokenStore = new ProxyTokenStore({ collection });
  if (ownerCheck !== undefined) proxyTokenStore.setOwnerCheck(ownerCheck);
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: 'acme', id: 'ws-1' };
      req.session = { accountId, features: { proxy: true } };
      next();
    },
    getWorkspaceAccessToken: () => null, resolveWorkspaceAccess: () => null,
    getWorkspaceOpenRouterKey: async () => null, workspacePreferencesStore: {}, freeTierStore: {}
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const del = async (id) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/workspace/acme/api/proxy/tokens/${id}`, { method: 'DELETE' });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { collection, del, close: () => new Promise(r => server.close(r)) };
}

const seedRunner = (collection, extra = {}) => {
  const doc = {
    _id: crypto.randomUUID(), urlKey: 'acme', tokenHash: 'h' + crypto.randomUUID(),
    label: 'runner', scope: 'readWrite', kind: 'bootstrap', singleUse: true,
    createdBy: 'account-A', grants: ['take', 'dispatch'], parentTokenId: null,
    workspaceId: 'ws-1', createdAt: new Date(), lastUsedAt: null, expiresAt: null, consumed: false, ...extra
  };
  collection._docs().push(doc);
  return doc;
};

test('a member revoking a grant-bearing runner credential gets 403 RUNNER_OWNER_ONLY and it survives', async (t) => {
  const s = await setup({ ownerCheck: async () => ({ status: 'not-owner' }) });
  t.after(s.close);
  const runner = seedRunner(s.collection);
  const res = await s.del(runner._id);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'RUNNER_OWNER_ONLY');
  assert.equal(res.body.error, "Only this workspace's owner can act on its runner.");
  assert.equal(s.collection._docs().length, 1);
});

test('the owner revokes a grant-bearing runner credential', async (t) => {
  const s = await setup({ ownerCheck: async ({ accountId }) => ({ status: accountId === 'account-A' ? 'owner' : 'not-owner' }), accountId: 'account-A' });
  t.after(s.close);
  const runner = seedRunner(s.collection);
  const res = await s.del(runner._id);
  assert.equal(res.status, 200);
  assert.equal(s.collection._docs().length, 0);
});

test('absent root with a grant-bearing child: a member gets 403 (not 404) and the child survives', async (t) => {
  const s = await setup({ ownerCheck: async () => ({ status: 'not-owner' }) });
  t.after(s.close);
  const missingRoot = crypto.randomUUID();
  seedRunner(s.collection, { kind: 'standard', parentTokenId: missingRoot });
  const res = await s.del(missingRoot);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'RUNNER_OWNER_ONLY');
  assert.equal(s.collection._docs().length, 1);
});

test('absent root with no children: 404 and nothing written, member or not', async (t) => {
  const s = await setup({ ownerCheck: async () => ({ status: 'not-owner' }) });
  t.after(s.close);
  const res = await s.del(crypto.randomUUID());
  assert.equal(res.status, 404);
});

test("a member revoking a grant-less token (their own Settings token) still succeeds", async (t) => {
  const s = await setup({ ownerCheck: async () => ({ status: 'not-owner' }) });
  t.after(s.close);
  const plain = seedRunner(s.collection, { grants: [], kind: 'standard', createdBy: 'account-B' });
  const res = await s.del(plain._id);
  assert.equal(res.status, 200);
  assert.equal(s.collection._docs().length, 0);
});

test('fail-closed once for the lane: an unwired owner seam refuses a runner-credential revoke 503 and deletes nothing', async (t) => {
  const s = await setup({ ownerCheck: null });
  t.after(s.close);
  const runner = seedRunner(s.collection);
  const res = await s.del(runner._id);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'OWNER_CHECK_UNAVAILABLE');
  assert.equal(s.collection._docs().length, 1);
});

test('a session with no account id is refused GRANT_OWNERLESS and deletes nothing', async (t) => {
  const s = await setup({ ownerCheck: async () => ({ status: 'owner' }), accountId: null });
  t.after(s.close);
  const runner = seedRunner(s.collection);
  const res = await s.del(runner._id);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'GRANT_OWNERLESS');
  assert.equal(s.collection._docs().length, 1);
});
