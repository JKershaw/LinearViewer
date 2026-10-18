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
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { isHeartbeatRequest } from '../../lib/consumer-heartbeat-ingest.js';
import { getConsumerLastSeenAt } from '../../lib/consumer-poll-warning.js';
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

// LIN-3647: a heartbeat is not a poll. Real token stores behind both doors; the
// "did not touch" assertions wait for a control token's fire-and-forget write.
describe('heartbeat routes do not refresh lastUsedAt (LIN-3647)', () => {
  let dStore, pStore;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const lastUsed = async (s, token) => (await s.collection.findOne({ tokenHash: s._hashToken(token) })).lastUsedAt;
  async function until(fn) { for (let i = 0; i < 200 && !(await fn()); i++) await wait(5); return fn(); }

  beforeEach(async () => {
    const tokens = client.db('linear-viewer');
    await tokens.collection('dispatch-tokens-3647').deleteMany({});
    await tokens.collection('proxy-tokens-3647').deleteMany({});
    dStore = new DispatchTokenStore({ collection: tokens.collection('dispatch-tokens-3647') });
    pStore = new ProxyTokenStore({ collection: tokens.collection('proxy-tokens-3647') });
  });

  function dApp() {
    const app = express();
    app.use(express.json({ limit: '250kb' }));
    app.use(createDispatchRoutes({
      dispatchQueueStore: { pollAvailable: async () => [] },
      dispatchTokenStore: dStore,
      workspaceFromUrl: (req, res, next) => next(),
      userPreferencesStore: {},
      consumerHeartbeatStore: store
    }));
    return app;
  }
  // The real store behind the door; only grants are stubbed (public createToken cannot mint them).
  const pApp = () => buildApp({
    consumerHeartbeatStore: store,
    proxyTokenStore: {
      validateToken: async (t, o) => { const r = await pStore.validateToken(t, o); return r && { ...r, grants: ['take'] }; },
      listTokens: async () => [], describeRejectionCause: async () => null
    }
  });

  // Control tokens live in ANOTHER workspace so getConsumerLastSeenAt('acme') never counts them.
  async function settled(s, control) {
    await s.validateToken(control);
    assert.ok(await until(() => lastUsed(s, control)), 'control write landed');
  }
  const seen = () => getConsumerLastSeenAt({ listTokens: (u) => dStore.listTokens(u) }, 'acme');
  const poll = async (app, path, token) => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    try {
      return (await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: { Authorization: `Bearer ${token}` } })).status;
    } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  };

  test('dispatch door: heartbeats (any routable spelling) leave lastUsedAt null; a poll stamps it', async () => {
    const { token } = await dStore.createToken('acme', 'sd', 'a');
    const control = (await dStore.createToken('ctl', 'control', 'a')).token;
    for (const path of ['/api/dispatch/heartbeat', '/api/dispatch/heartbeat/', '/API/Dispatch/Heartbeat?x=1']) {
      assert.equal((await post(dApp(), path, { body: beat(), token })).status, 204, path);
    }
    await settled(dStore, control);
    assert.equal(await lastUsed(dStore, token), null, 'heartbeats did not touch');
    assert.equal(await seen(), null, 'consumer reads as never polled');

    assert.equal(await poll(dApp(), '/api/dispatch/poll', token), 200);
    assert.ok(await until(() => lastUsed(dStore, token)), 'a non-heartbeat call still touches');
    assert.notEqual(await seen(), null);
  });

  test('runner door: heartbeats leave lastUsedAt null; a non-heartbeat runner call stamps it', async () => {
    const { token } = await pStore.createToken('acme', { label: 'kit' });
    const control = (await pStore.createToken('ctl', { label: 'control' })).token;
    for (const path of ['/api/proxy/runner/heartbeat', '/api/proxy/runner/heartbeat/', '/API/proxy/Runner/HEARTBEAT']) {
      assert.equal((await post(pApp(), path, { body: beat({ consumerKind: 'runner-kit' }), token })).status, 204, path);
    }
    await settled(pStore, control);
    assert.equal(await lastUsed(pStore, token), null, 'heartbeats did not touch');

    assert.equal(await poll(pApp(), '/api/proxy/runner/poll', token), 200);
    assert.ok(await until(() => lastUsed(pStore, token)), 'a non-heartbeat call still touches');
  });

  test('isHeartbeatRequest matches only the two heartbeat paths', () => {
    const yes = ['/api/dispatch/heartbeat', '/api/proxy/runner/heartbeat/', '/Api/Proxy/Runner/Heartbeat?a=b'];
    const no = ['/api/dispatch/poll', '/api/proxy/heartbeats', '/api/proxy/runner/take/x', '/api/dispatch/heartbeat/x', '/x/api/dispatch/heartbeat'];
    for (const u of yes) assert.equal(isHeartbeatRequest({ originalUrl: u }), true, u);
    for (const u of no) assert.equal(isHeartbeatRequest({ originalUrl: u }), false, u);
  });
});
