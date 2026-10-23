/**
 * LIN-3699 — a token-store FAILURE is a retryable 503; only a REJECTED token is a 401.
 *
 * Before: the stores' outer `catch` returned `null`, the same value that means
 * "unknown / expired", so a database blip answered the dispatch 401 bare (no code,
 * no `retryable`) and the proxy 401 `retryable:false`. simple-dispatcher latches a
 * workspace dead on `retryable:false`, so the dispatch 401 can only gain that field
 * once store errors have left it: both land together, and the ordering witness
 * below pins it.
 *
 * Real DispatchTokenStore / ProxyTokenStore over a fake collection whose methods
 * throw on demand, driven through the real routes. No live services.
 */
process.env.NODE_ENV = 'test';

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { runCommand } from '../../lib/runner-kit/runner.mjs';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { buildApp } from './lib/proxy-fake-deps.js';

const BOOM = new Error('MongoNetworkError: connection closed');

/** A mock collection whose named methods throw while `fail[method]` is truthy (a number counts down). */
function faultyCollection() {
  const inner = createMockCollection();
  const fail = {};
  const wrapped = new Proxy(inner, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return (...args) => {
        const f = fail[prop];
        if (f) {
          if (typeof f === 'number') fail[prop] = f - 1;
          return Promise.reject(BOOM);
        }
        return value.apply(target, args);
      };
    }
  });
  return { collection: wrapped, fail };
}

async function serve(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const errBody = async (res) => ({ status: res.status, body: await res.json() });

function dispatchApp(dispatchTokenStore, extra = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: { pollAvailable: async () => [], takeItem: async () => null, addFeedback: async () => null },
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => next(),
    userPreferencesStore: {},
    ...extra
  }));
  return app;
}

// Silence the expected store-failure log lines.
const quiet = () => mock.method(console, 'error', () => {});

describe('stores: null means rejected, a store failure throws', () => {
  test('DispatchTokenStore.validateToken: unknown and expired are null, a findOne failure rethrows', async () => {
    const { collection, fail } = faultyCollection();
    const store = new DispatchTokenStore({ collection });
    assert.equal(await store.validateToken('never-issued'), null);
    const expired = await store.createToken('acme', 'old', 'acct-1', { ttlSeconds: 1 });
    await collection.updateOne({ _id: expired.tokenId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await store.validateToken(expired.token), null);
    const live = await store.createToken('acme', 'live', 'acct-1');
    assert.ok(await store.validateToken(live.token));
    const q = quiet();
    try {
      fail.findOne = true;
      await assert.rejects(store.validateToken(live.token), /connection closed/);
    } finally { q.mock.restore(); }
  });

  test('DispatchTokenStore.validateToken: a lastUsedAt write failure is not a validation failure', async () => {
    const { collection, fail } = faultyCollection();
    const store = new DispatchTokenStore({ collection });
    const t = await store.createToken('acme', 'live', 'acct-1');
    fail.updateOne = true;
    const q = quiet();
    try {
      assert.ok(await store.validateToken(t.token));
      await new Promise((r) => setImmediate(r));
    } finally { q.mock.restore(); }
  });

  test('ProxyTokenStore.validateToken: unknown, bootstrap, expired and consumed are null; a findOne failure rethrows', async () => {
    const { collection, fail } = faultyCollection();
    const store = new ProxyTokenStore({ collection });
    assert.equal(await store.validateToken('never-issued'), null);
    const boot = await store.createToken('acme', { kind: 'bootstrap', createdBy: 'acct-1', singleUse: true });
    assert.equal(await store.validateToken(boot.token), null);
    const one = await store.createToken('acme', { singleUse: true, createdBy: 'acct-1' });
    assert.ok(await store.validateToken(one.token));
    assert.equal(await store.validateToken(one.token), null);
    const live = await store.createToken('acme', { createdBy: 'acct-1' });
    const q = quiet();
    try {
      fail.findOne = true;
      await assert.rejects(store.validateToken(live.token), /connection closed/);
    } finally { q.mock.restore(); }
  });
});

describe('dispatch auth: 401 rejected vs 503 store failure', () => {
  async function setup() {
    const { collection, fail } = faultyCollection();
    const store = new DispatchTokenStore({ collection });
    const live = await store.createToken('acme', 'live', 'acct-1');
    const expired = await store.createToken('acme', 'old', 'acct-1');
    await collection.updateOne({ _id: expired.tokenId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    return { store, fail, live: live.token, expired: expired.token };
  }

  test('unknown, expired and missing tokens: 401 with a stable code, retryable:false, message unchanged', async () => {
    const { store, live, expired } = await setup();
    await serve(dispatchApp(store), async (base) => {
      const poll = `${base}/api/dispatch/poll`;
      const cases = [
        [await errBody(await fetch(poll, bearer('nope'))), 'Invalid or expired token'],
        [await errBody(await fetch(poll, bearer(expired))), 'Invalid or expired token'],
        // `Empty token` is unreachable over HTTP (the server trims a trailing-space header), so its envelope is pinned in the coverage test.
        [await errBody(await fetch(poll)), 'Missing or invalid Authorization header']
      ];
      for (const [{ status, body }, error] of cases) {
        assert.equal(status, 401, error);
        assert.equal(body.error, error);
        assert.equal(body.code, 'DISPATCH_TOKEN_INVALID');
        assert.equal(body.category, 'auth');
        assert.equal(body.retryable, false);
        assert.equal(body.detail, error);
      }
      assert.equal((await fetch(poll, bearer(live))).status, 200);
    });
  });

  test('a store failure: 503 retryable:true, and the same token works once the store recovers', async () => {
    const { store, fail, live } = await setup();
    const q = quiet();
    try {
      await serve(dispatchApp(store), async (base) => {
        fail.findOne = 1;
        const { status, body } = await errBody(await fetch(`${base}/api/dispatch/poll`, bearer(live)));
        assert.equal(status, 503);
        assert.equal(body.code, 'DISPATCH_TOKEN_STORE_UNAVAILABLE');
        assert.equal(body.category, 'upstream');
        assert.equal(body.retryable, true);
        assert.equal((await fetch(`${base}/api/dispatch/poll`, bearer(live))).status, 200);
      });
    } finally { q.mock.restore(); }
  });

  // The ordering hazard: a dispatch body with `retryable:false` latches the consumer dead.
  test('ordering witness: a dispatch-token lookup failure never answers retryable:false on any dispatch route', async () => {
    const { store, fail, live } = await setup();
    const q = quiet();
    try {
      await serve(dispatchApp(store), async (base) => {
        fail.findOne = true;
        const id = '11111111-1111-4111-8111-111111111111';
        const routes = [
          ['GET', '/api/dispatch/poll'],
          ['POST', '/api/dispatch/broker-token'],
          ['POST', '/api/dispatch/heartbeat'],
          ['POST', `/api/dispatch/take/${id}`],
          ['POST', `/api/dispatch/feedback/${id}`]
        ];
        for (const [method, route] of routes) {
          const res = await fetch(`${base}${route}`, { method, ...bearer(live), ...(method === 'POST' ? { headers: { Authorization: `Bearer ${live}`, 'Content-Type': 'application/json' }, body: '{}' } : {}) });
          const body = await res.json();
          assert.equal(res.status, 503, route);
          assert.notEqual(body.retryable, false, route);
          assert.equal(body.retryable, true, route);
        }
      });
    } finally { q.mock.restore(); }
  });
});

describe('proxy auth: 401 rejected vs 503 store failure', () => {
  test('a store failure on a data endpoint: 503 PROXY_TOKEN_STORE_UNAVAILABLE, retryable:true, no stage', async () => {
    const { collection, fail } = faultyCollection();
    const store = new ProxyTokenStore({ collection });
    const t = await store.createToken('acme', { createdBy: 'acct-1' });
    const q = quiet();
    try {
      await serve(buildApp({ proxyTokenStore: store }), async (base) => {
        fail.findOne = 1;
        const { status, body } = await errBody(await fetch(`${base}/api/proxy/teams`, bearer(t.token)));
        assert.equal(status, 503);
        assert.equal(body.code, 'PROXY_TOKEN_STORE_UNAVAILABLE');
        assert.equal(body.category, 'upstream');
        assert.equal(body.retryable, true);
        assert.ok(!('stage' in body), 'stage:proxy-token means re-issue; a blip must not carry it');
        const again = await fetch(`${base}/api/proxy/teams`, bearer(t.token));
        assert.notEqual(again.status, 401);
        assert.notEqual(again.status, 503);
      });
    } finally { q.mock.restore(); }
  });

  test('an unknown token is still 401 PROXY_TOKEN_INVALID retryable:false', async () => {
    const { collection } = faultyCollection();
    const store = new ProxyTokenStore({ collection });
    await serve(buildApp({ proxyTokenStore: store }), async (base) => {
      const { status, body } = await errBody(await fetch(`${base}/api/proxy/teams`, bearer('nope')));
      assert.equal(status, 401);
      assert.equal(body.code, 'PROXY_TOKEN_INVALID');
      assert.equal(body.retryable, false);
      assert.equal(body.stage, 'proxy-token');
    });
  });
});

describe('POST /api/proxy/token (bootstrap exchange)', () => {
  async function setup() {
    const { collection, fail } = faultyCollection();
    const store = new ProxyTokenStore({ collection });
    const boot = await store.createToken('acme', { kind: 'bootstrap', createdBy: 'acct-1', singleUse: true });
    return { store, fail, collection, boot: boot.token, bootId: boot.tokenId };
  }
  const exchange = (base, token) => fetch(`${base}/api/proxy/token`, { method: 'POST', ...bearer(token) });

  test('a failure BEFORE the consume (findOne, then the consume write): 503 retryable, the bootstrap stays live', async () => {
    const { store, fail, collection, boot, bootId } = await setup();
    const q = quiet();
    try {
      await serve(buildApp({ proxyTokenStore: store }), async (base) => {
        for (const method of ['findOne', 'updateOne']) {
          fail[method] = 1;
          const { status, body } = await errBody(await exchange(base, boot));
          assert.equal(status, 503, method);
          assert.equal(body.code, 'PROXY_TOKEN_STORE_UNAVAILABLE');
          assert.equal(body.retryable, true);
          assert.ok(!('stage' in body));
          assert.equal((await collection.findOne({ _id: bootId })).consumed, false, method);
        }
        const ok = await exchange(base, boot);
        assert.equal(ok.status, 200, 'a retry after the store recovers succeeds');
        assert.ok((await ok.json()).token);
      });
    } finally { q.mock.restore(); }
  });

  test('a failure AFTER the consume (the working-token insert): stays 401, the bootstrap is spent, a retry 401s too', async () => {
    const { store, fail, collection, boot, bootId } = await setup();
    const q = quiet();
    try {
      await serve(buildApp({ proxyTokenStore: store }), async (base) => {
        fail.insertOne = 1;
        const first = await errBody(await exchange(base, boot));
        assert.equal(first.status, 401);
        assert.equal(first.body.code, 'PROXY_TOKEN_INVALID');
        assert.equal(first.body.retryable, false);
        assert.equal((await collection.findOne({ _id: bootId })).consumed, true);
        assert.equal((await exchange(base, boot)).status, 401);
      });
    } finally { q.mock.restore(); }
  });

  test('unknown and already-exchanged bootstraps are 401 retryable:false', async () => {
    const { store, boot } = await setup();
    await serve(buildApp({ proxyTokenStore: store }), async (base) => {
      assert.equal((await exchange(base, 'nope')).status, 401);
      assert.equal((await exchange(base, boot)).status, 200);
      const { status, body } = await errBody(await exchange(base, boot));
      assert.equal(status, 401);
      assert.equal(body.retryable, false);
    });
  });
});

describe('runner kit login wording (5xx only changes)', () => {
  async function login(status) {
    const home = mkdtempSync(join(tmpdir(), 'lin3699-'));
    try {
      const stdin = `- baseUrl: https://harbour.test\n- urlKey: acme\n- ownerAccountId: acct-1\n- bootstrap: boot\n`;
      const fetchImpl = async () => new Response('{}', { status });
      await runCommand(['login'], { home, stdin, fetchImpl });
      return null;
    } catch (err) { return err.message; } finally { rmSync(home, { recursive: true, force: true }); }
  }

  test('503 says Harbour could not check the bootstrap; 401 keeps "mint a new one"', async () => {
    assert.match(await login(503), /HTTP 503 \(Harbour could not check the bootstrap; retry login\)/);
    assert.doesNotMatch(await login(503), /mint a new one/);
    assert.match(await login(401), /HTTP 401 \(a bootstrap works once and lives 1h; mint a new one on \/runner\)/);
  });
});

// ── Coverage: every status/code pair an auth middleware can emit is documented and in the contract ──
// Drives each middleware through every state it can reach over HTTP (missing, rejected, expired,
// store failure) and collects (status, error, code). A pair with no row in the document that
// owns that surface, or no `auth` row in contract.json, fails. (`Empty token` cannot be sent
// over HTTP: the server trims a trailing-space header, so that branch is unreachable.)
describe('every auth status/code pair is documented and in the contract', () => {
  const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
  const tableRows = (doc) => {
    const at = doc.lastIndexOf('| 401 | `Missing or invalid Authorization header`');
    assert.ok(at > 0, 'the Error Handling table is still where the test looks');
    return doc.slice(at).split('\n').filter((l) => l.startsWith('| ')).slice(0, 40);
  };
  const dispatchRows = tableRows(read('docs/dispatch-integration.md'));
  const proxyRows = tableRows(read('docs/proxy-integration.md'));
  const contract = JSON.parse(read('lib/runner-kit/contract.json')).rows.filter((r) => r.area === 'auth');

  async function collect() {
    const seen = [];
    const q = quiet();
    try {
      // dispatch
      const d = faultyCollection();
      const dStore = new DispatchTokenStore({ collection: d.collection });
      const live = (await dStore.createToken('acme', 'live', 'acct-1')).token;
      const old = await dStore.createToken('acme', 'old', 'acct-1');
      await d.collection.updateOne({ _id: old.tokenId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      await serve(dispatchApp(dStore), async (base) => {
        const url = `${base}/api/dispatch/poll`;
        for (const init of [{}, bearer('nope'), bearer(old.token)]) seen.push({ surface: 'dispatch', ...(await errBody(await fetch(url, init))) });
        d.fail.findOne = true;
        seen.push({ surface: 'dispatch', ...(await errBody(await fetch(url, bearer(live)))) });
      });
      // proxy and exchange
      const p = faultyCollection();
      const pStore = new ProxyTokenStore({ collection: p.collection });
      const pLive = (await pStore.createToken('acme', { createdBy: 'acct-1' })).token;
      const pOld = await pStore.createToken('acme', { createdBy: 'acct-1' });
      await p.collection.updateOne({ _id: pOld.tokenId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const boot = (await pStore.createToken('acme', { kind: 'bootstrap', createdBy: 'acct-1', singleUse: true })).token;
      await serve(buildApp({ proxyTokenStore: pStore }), async (base) => {
        const url = `${base}/api/proxy/teams`;
        for (const init of [{}, bearer('nope'), bearer(pOld.token)]) seen.push({ surface: 'proxy', ...(await errBody(await fetch(url, init))) });
        const ex = (init) => fetch(`${base}/api/proxy/token`, { method: 'POST', ...init });
        seen.push({ surface: 'exchange', ...(await errBody(await ex({}))) });
        seen.push({ surface: 'exchange', ...(await errBody(await ex(bearer('nope')))) });
        p.fail.findOne = true;
        seen.push({ surface: 'proxy', ...(await errBody(await fetch(url, bearer(pLive)))) });
        seen.push({ surface: 'exchange', ...(await errBody(await ex(bearer(boot)))) });
      });
    } finally { q.mock.restore(); }
    return seen.map(({ surface, status, body }) => ({ surface, status, error: body.error, code: body.code, retryable: body.retryable }));
  }

  test('each emitted pair has a row in its own document and an auth row in contract.json', async () => {
    const pairs = await collect();
    assert.ok(pairs.length >= 11);
    for (const { surface, status, error, code, retryable } of pairs) {
      const id = `${surface} ${status} ${code} "${error}"`;
      assert.ok(code, `${id}: every auth reply carries a code`);
      assert.equal(retryable, status >= 500, `${id}: retryable mirrors the status class`);
      const rows = surface === 'dispatch' ? dispatchRows : proxyRows;
      assert.ok(
        rows.some((r) => r.startsWith(`| ${status} |`) && (r.includes(`\`${error}\``) || r.includes(`\`${code}\``))),
        `${id}: no ${surface === 'dispatch' ? 'dispatch' : 'proxy'}-integration Error Handling row`
      );
      assert.ok(
        contract.some((r) => r.item.surface === surface && r.item.status === status && r.item.code === code && r.item.retryable === retryable),
        `${id}: no auth row in contract.json`
      );
    }
  });

  test('every auth contract row is a pair the middlewares emit (no stale rows)', async () => {
    const pairs = await collect();
    for (const r of contract) {
      assert.ok(
        pairs.some((x) => x.surface === r.item.surface && x.status === r.item.status && x.code === r.item.code),
        `contract row "${r.case}" matches nothing the middlewares emit`
      );
    }
  });
});
