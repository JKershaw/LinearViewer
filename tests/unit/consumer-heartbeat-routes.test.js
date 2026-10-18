/**
 * LIN-1952: both heartbeat POST doors (dispatch token, runner `take` grant) and
 * the proxy GET, over real HTTP with a real ConsumerHeartbeatStore.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { ConsumerHeartbeatStore } from '../../lib/consumer-heartbeat-store.js';
import { ACME, buildApp, call } from './lib/proxy-fake-deps.js';

const beat = (extra = {}) => ({
  schema: 1, consumerKind: 'simple-dispatcher', instanceId: 'inst-1',
  sentAt: new Date().toISOString(), intervalMs: 60000, loadAvg1: 0.5, activeSessionCount: 2, ...extra
});

let dir, client, collection, store;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'consumer-heartbeat-routes-'));
  client = new MangoClient(dir);
  await client.connect();
  collection = client.db('linear-viewer').collection('consumer-heartbeats');
});
after(async () => {
  if (client?.close) await client.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await collection.deleteMany({});
  store = new ConsumerHeartbeatStore({ collection });
});

async function post(app, path, { body, token = 'good', raw } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers, body: raw ?? JSON.stringify(body)
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, text };
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
}

function dispatchApp() {
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  app.use(createDispatchRoutes({
    dispatchQueueStore: {},
    dispatchTokenStore: {
      validateToken: async (t) => (t === 'good' ? { urlKey: 'acme', label: 'sd', createdBy: 'a', tokenId: 'tok-sd' } : null)
    },
    workspaceFromUrl: (req, res, next) => next(),
    userPreferencesStore: {},
    consumerHeartbeatStore: store
  }));
  return app;
}

function runnerApp(grants = ['take']) {
  return buildApp({
    consumerHeartbeatStore: store,
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 'tok-kit', urlKey: ACME, label: 'kit', scope: 'readWrite', createdBy: 'u1', grants }),
      listTokens: async () => [], describeRejectionCause: async () => null
    }
  });
}

describe('POST /api/dispatch/heartbeat', () => {
  const PATH = '/api/dispatch/heartbeat';
  test('no credential is 401 and nothing is written', async () => {
    const res = await post(dispatchApp(), PATH, { body: beat(), token: null });
    assert.equal(res.status, 401);
    assert.equal(await collection.countDocuments({}), 0);
  });
  test('a bad token is 401', async () => {
    assert.equal((await post(dispatchApp(), PATH, { body: beat(), token: 'bad' })).status, 401);
  });
  test('a valid beat is 204 and stores urlKey, instanceId and the sending tokenId', async () => {
    const res = await post(dispatchApp(), PATH, { body: beat() });
    assert.equal(res.status, 204);
    assert.equal(res.text, '');
    const doc = await collection.findOne({ _id: 'acme::inst-1' });
    assert.equal(doc.tokenId, 'tok-sd');
    assert.equal(doc.fields.activeSessionCount, 2);
  });
  test('an invalid beat is 400 with the error envelope and nothing stored', async () => {
    const res = await post(dispatchApp(), PATH, { body: { schema: 1, hostname: 'laptop-canary' } });
    assert.equal(res.status, 400);
    assert.equal(typeof res.body.error, 'string');
    assert.ok(!res.text.includes('laptop-canary'), 'the 400 never echoes the body');
    assert.equal(await collection.countDocuments({}), 0);
  });
  test('an oversize body is 400, not 413 or 204', async () => {
    const res = await post(dispatchApp(), PATH, { body: beat({ version: 'x', padding: 'y'.repeat(5000) }) });
    assert.equal(res.status, 400);
    assert.equal(await collection.countDocuments({}), 0);
  });
  test('a store failure is 500 with the envelope', async () => {
    store.record = async () => { throw new Error('db down'); };
    const real = console.error; console.error = () => {};
    try {
      const res = await post(dispatchApp(), PATH, { body: beat() });
      assert.equal(res.status, 500);
    } finally { console.error = real; }
  });
});

describe('POST /api/proxy/runner/heartbeat', () => {
  const PATH = '/api/proxy/runner/heartbeat';
  test('a take-grant token is 204 and records its proxy tokenId', async () => {
    const res = await post(runnerApp(), PATH, { body: beat({ consumerKind: 'runner-kit' }) });
    assert.equal(res.status, 204);
    const doc = await collection.findOne({ _id: `${ACME}::inst-1` });
    assert.equal(doc.tokenId, 'tok-kit');
    assert.equal(doc.consumerKind, 'runner-kit');
  });
  test('a token without the take grant is refused 403 before the handler', async () => {
    const res = await post(runnerApp([]), PATH, { body: beat() });
    assert.equal(res.status, 403);
    assert.equal(await collection.countDocuments({}), 0);
  });
  test('an invalid beat is 400', async () => {
    assert.equal((await post(runnerApp(), PATH, { body: { schema: 2 } })).status, 400);
  });
  test('an oversize body is 400', async () => {
    assert.equal((await post(runnerApp(), PATH, { body: beat({ padding: 'y'.repeat(5000) }) })).status, 400);
  });
});

describe('GET /api/proxy/heartbeats', () => {
  const readApp = (scope = 'read') => buildApp({
    consumerHeartbeatStore: store,
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 'r', urlKey: ACME, label: 'r', scope, createdBy: 'u1', grants: [] }),
      listTokens: async () => [], describeRejectionCause: async () => null
    }
  });

  test('a read-scope token with no grants lists its workspace, with ageMs and stale', async () => {
    const now = Date.now();
    await store.record({ urlKey: ACME, tokenId: 't', parsed: { ...beat({ instanceId: 'fresh' }), sentAt: new Date(now).toISOString() }, now: new Date(now - 10_000) });
    await store.record({ urlKey: ACME, tokenId: 't', parsed: { ...beat({ instanceId: 'stalled', intervalMs: 1000 }), sentAt: new Date(now).toISOString() }, now: new Date(now - 60_000) });
    const res = await call(readApp(), 'GET', '/api/proxy/heartbeats');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.heartbeats.map(h => h.instanceId), ['fresh', 'stalled']);
    const [fresh, stalled] = res.body.heartbeats;
    assert.ok(fresh.ageMs >= 10_000 && fresh.ageMs < 20_000);
    assert.equal(fresh.stale, false);
    assert.equal(stalled.stale, true);
    assert.equal(fresh.consumerKind, 'simple-dispatcher');
    assert.equal(fresh.fields.activeSessionCount, 2);
    assert.equal(typeof fresh.clockSkewMs, 'number');
  });

  test('is scoped to the token workspace', async () => {
    await store.record({ urlKey: 'other-ws', tokenId: 't', parsed: beat({ instanceId: 'elsewhere' }) });
    const res = await call(readApp(), 'GET', '/api/proxy/heartbeats');
    assert.deepEqual(res.body, { heartbeats: [] });
  });

  test('an expired doc is not returned even before cleanup runs', async () => {
    await store.record({ urlKey: ACME, tokenId: 't', parsed: beat(), now: new Date(Date.now() - 16 * 60 * 1000) });
    assert.equal(await collection.countDocuments({}), 1);
    assert.deepEqual((await call(readApp(), 'GET', '/api/proxy/heartbeats')).body, { heartbeats: [] });
  });

  test('a store failure is a 500', async () => {
    store.listLive = async () => { throw new Error('down'); };
    const real = console.error; console.error = () => {};
    try { assert.equal((await call(readApp(), 'GET', '/api/proxy/heartbeats')).status, 500); } finally { console.error = real; }
  });
});
