/**
 * LIN-598 — Task-history capture seam (proxy).
 *
 * Pins the capture contract end-to-end through the real proxy router: a brief
 * read at the existing `hashContext` seam writes exactly ONE snapshot, and a
 * second identical read (same observed slice → same inputHash) writes NONE. Also
 * checks the read surface (`GET .../snapshots` and `/snapshots/diff`).
 *
 * Mounts createProxyRoutes with mocked deps so the test-mode brief path
 * (token === 'test-token' + fixture context) runs offline, exactly like
 * proxy-route-aliases.test.js. Capture is fire-and-forget on the response path,
 * so reads poll the store briefly after each request.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { TaskSnapshotStore } from '../../lib/task-snapshot-store.js';

const FIXTURE_ID = 'TEST-1'; // exists in tests/fixtures/mock-data.js (canonical id 'issue-1')

function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.taskIdentifier !== undefined && doc.taskIdentifier !== query.taskIdentifier) return false;
    if (query.canonicalId !== undefined && doc.canonicalId !== query.canonicalId) return false;
    return true;
  }
  return {
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    }
  };
}

function buildApp(taskSnapshotStore) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, put: async () => {} },
    briefCacheStore: { get: async () => null, put: async () => {} },
    taskSnapshotStore,
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: method.toUpperCase(),
      headers: { Authorization: 'Bearer anything' }
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// Capture is fire-and-forget; give the microtask chain a few ticks to settle.
async function waitForCount(store, identifier, expected, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const { total } = await store.list('acme', identifier);
    if (total >= expected) return total;
    await new Promise(r => setTimeout(r, 5));
  }
  return (await store.list('acme', identifier)).total;
}

describe('proxy brief read → task-snapshot capture (LIN-598)', () => {
  let store;
  let app;
  beforeEach(() => {
    store = new TaskSnapshotStore({ collection: createMockCollection() });
    app = buildApp(store);
  });

  test('a brief read captures exactly one snapshot', async () => {
    const res = await call(app, 'get', `/api/proxy/issues/${FIXTURE_ID}/brief`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const total = await waitForCount(store, FIXTURE_ID, 1);
    assert.equal(total, 1);

    const { items } = await store.list('acme', FIXTURE_ID);
    assert.equal(items[0].taskIdentifier, FIXTURE_ID);
    assert.equal(items[0].canonicalId, 'issue-1');
    assert.equal(typeof items[0].snapshot.title, 'string');
    assert.ok(items[0].inputHash);
  });

  test('a second identical read captures no new snapshot (hash-gated)', async () => {
    await call(app, 'get', `/api/proxy/issues/${FIXTURE_ID}/brief`);
    await waitForCount(store, FIXTURE_ID, 1);

    await call(app, 'get', `/api/proxy/issues/${FIXTURE_ID}/brief`);
    // Allow any (incorrect) second write to land before asserting it did NOT.
    await new Promise(r => setTimeout(r, 60));

    const { total } = await store.list('acme', FIXTURE_ID);
    assert.equal(total, 1);
  });

  test('the read surface lists snapshots and diffs the two latest', async () => {
    await call(app, 'get', `/api/proxy/issues/${FIXTURE_ID}/brief`);
    await waitForCount(store, FIXTURE_ID, 1);

    const list = await call(app, 'get', `/api/proxy/issues/${FIXTURE_ID}/snapshots`);
    assert.equal(list.status, 200);
    assert.equal(list.body.identifier, FIXTURE_ID);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.snapshots.length, 1);

    const diff = await call(app, 'get', `/api/proxy/issues/${FIXTURE_ID}/snapshots/diff`);
    assert.equal(diff.status, 200);
    assert.equal(diff.body.changed, false); // only one snapshot → nothing to compare
  });

  test('snapshots endpoint 400s on a malformed identifier', async () => {
    const res = await call(app, 'get', '/api/proxy/issues/not!valid/snapshots');
    assert.equal(res.status, 400);
  });
});
