/**
 * LIN-3130 S2a (beat 3) — dispatch ownership (takenByTokenId), the archive
 * allowlist, consumer recency, and the take/feedback races.
 *
 * Store-level tests run against a REAL MangoDB tmpdir instance
 * (`@jkershaw/mangodb`), not `createMockCollection`: the legacy ownership
 * branch relies on Mongo's `{ field: null }` matching an ABSENT field, and the
 * hand-rolled mock's plain equality (`value === null`) does NOT reproduce that
 * (`undefined === null` is false). MangoDB does (verified directly:
 * `{takenByTokenId: null}` → ['absent','null'], `{$exists:false}` → ['absent']).
 * Route-level tests drive the REAL `createProxyRoutes` / `createDispatchRoutes`
 * composers over HTTP against that same store, with a REAL `ProxyTokenStore`
 * whose runner credential is minted via `mintGrantBootstrap` + exchange.
 *
 * The CI-only real-`mongod` semantics pin lives in
 * tests/unit/lin-3130-taken-by-token-id-mongo.test.js (mongo:8.0 arm).
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { RUNNER_GRANTS } from '../../lib/proxy-scopes.js';
import { getConsumerLastSeenAt } from '../../lib/consumer-poll-warning.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { buildApp, call, ACME } from './lib/proxy-fake-deps.js';

let dbDir;
let client;
let counter = 0;

before(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'lin3130-ownership-'));
  client = new MangoClient(dbDir);
  await client.connect();
});

after(async () => {
  if (client?.close) await client.close();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
});

function freshDb() {
  return client.db(`ownership_${counter++}`);
}

function freshDispatchStore(db) {
  return new DispatchQueueStore({
    collection: db.collection('dispatch-queue'),
    historyCollection: db.collection('dispatch-history'),
  });
}

function freshProxyTokenStore(db) {
  const store = new ProxyTokenStore({ collection: db.collection('proxy-tokens') });
  store.setOwnerCheck(async () => ({ status: 'owner' }));
  return store;
}

function freshDispatchTokenStore(db) {
  return new DispatchTokenStore({ collection: db.collection('dispatch-tokens') });
}

const RUNNER_LABEL = 'runner-label';

// The runner credential: an owner-minted grant bootstrap, exchanged to a
// working token that carries grants ['take','dispatch'] — exactly S2b's
// production shape, built here through the S1 seam.
async function mintRunnerWorking(proxyTokenStore, { label = RUNNER_LABEL } = {}) {
  const bootstrap = await proxyTokenStore.mintGrantBootstrap({
    urlKey: ACME,
    workspaceId: 'ws-1',
    ownerAccountId: 'acct-A',
    grants: RUNNER_GRANTS,
    label,
  });
  assert.ok(bootstrap?.token, 'mintGrantBootstrap returned a bootstrap');
  const working = await proxyTokenStore.exchangeBootstrapToken(bootstrap.token);
  assert.ok(working?.token, 'the runner bootstrap exchanged for a working token');
  assert.deepEqual(working.grants, ['take', 'dispatch'], 'the working runner token carries both grants');
  return working;
}

function runnerApp({ proxyTokenStore, dispatchQueueStore, dispatchTokenStore, sessionsFeedCache = null }) {
  return buildApp({ proxyTokenStore, dispatchQueueStore, dispatchTokenStore, sessionsFeedCache });
}

function dispatchApp({ dispatchQueueStore, dispatchTokenStore, proxyTokenStore = null }) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore,
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => next(),
    userPreferencesStore: {},
    proxyTokenStore,
  }));
  return app;
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function historyDoc(store, id) {
  return store.historyCollection.findOne({ _id: id });
}

// ── Ownership: runner take stores takenByTokenId; feedback keys on it ────────

describe('LIN-3130 — runner take records takenByTokenId; feedback ownership branches', () => {
  test('runner take archives takenByTokenId + label; runner feedback succeeds', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);
    const proxyTokenStore = freshProxyTokenStore(db);
    const dispatchTokenStore = freshDispatchTokenStore(db);
    const working = await mintRunnerWorking(proxyTokenStore);
    const app = runnerApp({ proxyTokenStore, dispatchQueueStore: store, dispatchTokenStore });

    const item = await store.addItem(ACME, { prompt: 'do the thing', kind: 'implementation' });
    const take = await call(app, 'POST', `/api/proxy/runner/take/${item._id}`, { headers: bearer(working.token), body: {} });
    assert.equal(take.status, 200, JSON.stringify(take.body));

    const hist = await historyDoc(store, item._id);
    assert.equal(hist.takenByTokenId, working.tokenId, 'the taking runner tokenId is archived');
    assert.equal(hist.takenByTokenLabel, RUNNER_LABEL);

    const fb = await call(app, 'POST', `/api/proxy/runner/feedback/${item._id}`, { headers: bearer(working.token), body: { message: '[done] shipped' } });
    assert.equal(fb.status, 200, JSON.stringify(fb.body));
    const after = await historyDoc(store, item._id);
    assert.equal(after.feedback.length, 1, 'the real runner bearer posts feedback');
  });

  test('F3: a dispatch token carrying the runner label gets 404 on a runner-taken item and appends nothing', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);
    const proxyTokenStore = freshProxyTokenStore(db);
    const dispatchTokenStore = freshDispatchTokenStore(db);
    const working = await mintRunnerWorking(proxyTokenStore, { label: RUNNER_LABEL });
    const runner = runnerApp({ proxyTokenStore, dispatchQueueStore: store, dispatchTokenStore });
    const dispatcher = dispatchApp({ dispatchQueueStore: store, dispatchTokenStore });

    const item = await store.addItem(ACME, { prompt: 'do', kind: 'implementation' });
    await call(runner, 'POST', `/api/proxy/runner/take/${item._id}`, { headers: bearer(working.token), body: {} });

    // A member's dispatch token with the runner's free-text label — the exact
    // false-positive the legacy `takenByTokenId: null` clause blocks.
    const { token: dispatchToken } = await dispatchTokenStore.createToken(ACME, RUNNER_LABEL, 'account-B');
    const fb = await call(dispatcher, 'POST', `/api/dispatch/feedback/${item._id}`, { headers: bearer(dispatchToken), body: { message: '[done] from the wrong token' } });
    assert.equal(fb.status, 404, `a label-sharing dispatch token must NOT own a runner-taken item: ${JSON.stringify(fb.body)}`);

    const hist = await historyDoc(store, item._id);
    assert.ok(!hist.feedback || hist.feedback.length === 0, 'no entry appended on the 404');
  });

  test('legacy-taken row with takenByTokenId ABSENT accepts its legacy token (200)', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);
    const dispatchTokenStore = freshDispatchTokenStore(db);
    const dispatcher = dispatchApp({ dispatchQueueStore: store, dispatchTokenStore });

    // Seeded raw, pre-S2a shape: no takenByTokenId field at all.
    const legacyId = '11111111-1111-4111-8111-111111111111';
    await store.historyCollection.insertOne({
      _id: legacyId, urlKey: ACME, status: 'taken', takenByTokenLabel: 'legacy-label', feedback: [],
    });
    const { token } = await dispatchTokenStore.createToken(ACME, 'legacy-label', 'account-A');

    const fb = await call(dispatcher, 'POST', `/api/dispatch/feedback/${legacyId}`, { headers: bearer(token), body: { message: 'legacy ok' } });
    assert.equal(fb.status, 200, `the legacy branch must match an ABSENT field: ${JSON.stringify(fb.body)}`);
  });

  test('the runner bearer on that legacy row gets 404 (runner branch keys on its own tokenId)', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);
    const proxyTokenStore = freshProxyTokenStore(db);
    const dispatchTokenStore = freshDispatchTokenStore(db);
    const working = await mintRunnerWorking(proxyTokenStore);
    const runner = runnerApp({ proxyTokenStore, dispatchQueueStore: store, dispatchTokenStore });

    const legacyId = '22222222-2222-4222-8222-222222222222';
    await store.historyCollection.insertOne({
      _id: legacyId, urlKey: ACME, status: 'taken', takenByTokenLabel: 'legacy-label', feedback: [],
    });

    const fb = await call(runner, 'POST', `/api/proxy/runner/feedback/${legacyId}`, { headers: bearer(working.token), body: { message: 'x' } });
    assert.equal(fb.status, 404, 'a runner token does not own a legacy row');
  });

  test('a dispatch-token bearer on a runner route is 401 (different store)', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);
    const proxyTokenStore = freshProxyTokenStore(db);
    const dispatchTokenStore = freshDispatchTokenStore(db);
    const app = runnerApp({ proxyTokenStore, dispatchQueueStore: store, dispatchTokenStore });
    const { token: dispatchToken } = await dispatchTokenStore.createToken(ACME, 'consumer', 'account-A');

    const res = await call(app, 'GET', '/api/proxy/runner/poll', { headers: bearer(dispatchToken) });
    assert.equal(res.status, 401, `a dispatch token must not authenticate to the proxy runner: ${JSON.stringify(res.body)}`);
  });
});

// ── Archive allowlist + formatter unchanged ─────────────────────────────────

describe('LIN-3130 — archive hop carries takenByTokenId; formatter output unchanged', () => {
  test('runner take persists takenByTokenId; legacy (tokenId-less) take persists explicit null', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);

    const runnerItem = await store.addItem(ACME, { prompt: 'r', kind: 'implementation' });
    await store.takeItem(runnerItem._id, ACME, RUNNER_LABEL, 'tok-runner-1');
    const runnerHist = await historyDoc(store, runnerItem._id);
    assert.equal(runnerHist.takenByTokenId, 'tok-runner-1');

    const legacyItem = await store.addItem(ACME, { prompt: 'l', kind: 'implementation' });
    await store.takeItem(legacyItem._id, ACME, 'legacy-label');
    const legacyHist = await historyDoc(store, legacyItem._id);
    assert.ok(Object.prototype.hasOwnProperty.call(legacyHist, 'takenByTokenId'), 'explicit null must be written, not omitted');
    assert.equal(legacyHist.takenByTokenId, null);
  });

  test('_formatHistoryItem does NOT expose takenByTokenId, and its key set is identical for runner and legacy rows', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);

    const runnerItem = await store.addItem(ACME, { prompt: 'r', kind: 'implementation' });
    await store.takeItem(runnerItem._id, ACME, RUNNER_LABEL, 'tok-runner-1');
    const legacyItem = await store.addItem(ACME, { prompt: 'l', kind: 'implementation' });
    await store.takeItem(legacyItem._id, ACME, 'legacy-label');

    const runnerFormatted = store._formatHistoryItem(await historyDoc(store, runnerItem._id));
    const legacyFormatted = store._formatHistoryItem(await historyDoc(store, legacyItem._id));

    assert.ok(!('takenByTokenId' in runnerFormatted), 'takenByTokenId must be storage-only');
    assert.ok(!('takenByTokenId' in legacyFormatted));
    assert.deepEqual(
      Object.keys(runnerFormatted).sort(),
      Object.keys(legacyFormatted).sort(),
      'the formatter output shape must not depend on the presence of the stored field'
    );
  });
});

// ── Races ────────────────────────────────────────────────────────────────────

describe('LIN-3130 — atomic claim and append races', () => {
  test('20-way concurrent runner take on one item -> exactly one 200', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);
    const proxyTokenStore = freshProxyTokenStore(db);
    const dispatchTokenStore = freshDispatchTokenStore(db);
    const working = await mintRunnerWorking(proxyTokenStore);
    const app = runnerApp({ proxyTokenStore, dispatchQueueStore: store, dispatchTokenStore });

    const item = await store.addItem(ACME, { prompt: 'race', kind: 'implementation' });
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      call(app, 'POST', `/api/proxy/runner/take/${item._id}`, { headers: bearer(working.token), body: {} })
    ));
    assert.equal(results.filter(r => r.status === 200).length, 1, 'findOneAndDelete is atomic — one taker');
    assert.equal(results.filter(r => r.status === 404).length, 19);
  });

  test('runner vs dispatch token race on one item -> exactly one 200 total', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);
    const proxyTokenStore = freshProxyTokenStore(db);
    const dispatchTokenStore = freshDispatchTokenStore(db);
    const working = await mintRunnerWorking(proxyTokenStore);
    const { token: dispatchToken } = await dispatchTokenStore.createToken(ACME, 'consumer', 'account-A');
    const runner = runnerApp({ proxyTokenStore, dispatchQueueStore: store, dispatchTokenStore });
    const dispatcher = dispatchApp({ dispatchQueueStore: store, dispatchTokenStore });

    const item = await store.addItem(ACME, { prompt: 'race', kind: 'implementation' });
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => call(runner, 'POST', `/api/proxy/runner/take/${item._id}`, { headers: bearer(working.token), body: {} })),
      ...Array.from({ length: 10 }, () => call(dispatcher, 'POST', `/api/dispatch/take/${item._id}`, { headers: bearer(dispatchToken), body: {} })),
    ]);
    assert.equal(results.filter(r => r.status === 200).length, 1, 'one atomic claim wins across both consumers');
  });

  test('20 concurrent runner feedback writes all land (LIN-1343 preserved)', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);
    const proxyTokenStore = freshProxyTokenStore(db);
    const dispatchTokenStore = freshDispatchTokenStore(db);
    const working = await mintRunnerWorking(proxyTokenStore);
    const app = runnerApp({ proxyTokenStore, dispatchQueueStore: store, dispatchTokenStore });

    const item = await store.addItem(ACME, { prompt: 'fb', kind: 'implementation' });
    await call(app, 'POST', `/api/proxy/runner/take/${item._id}`, { headers: bearer(working.token), body: {} });

    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      call(app, 'POST', `/api/proxy/runner/feedback/${item._id}`, { headers: bearer(working.token), body: { message: `heartbeat ${i}` } })
    ));
    assert.ok(results.every(r => r.status === 200), 'every concurrent writer succeeds');
    const hist = await historyDoc(store, item._id);
    assert.equal(hist.feedback.length, 20, 'all 20 concurrent entries land');
  });
});

// ── Consumer recency ─────────────────────────────────────────────────────────

describe('LIN-3130 — consumer recency folds in grant-bearing take tokens', () => {
  const TAKE_TOKEN = { grants: ['take'], lastUsedAt: '2026-03-03T00:00:00.000Z' };

  test('a runner-only workspace (no dispatch tokens) reports the take token\'s lastUsedAt, not "never"', async () => {
    const dispatchStore = { listTokens: async () => [] };
    const proxyStore = { listTokens: async () => [TAKE_TOKEN] };
    assert.equal(await getConsumerLastSeenAt(dispatchStore, ACME, proxyStore), '2026-03-03T00:00:00.000Z');
  });

  test('a non-take proxy token does not count as a consumer', async () => {
    const dispatchStore = { listTokens: async () => [] };
    const proxyStore = { listTokens: async () => [{ grants: ['dispatch'], lastUsedAt: '2026-03-03T00:00:00.000Z' }] };
    assert.equal(await getConsumerLastSeenAt(dispatchStore, ACME, proxyStore), null);
  });

  test('the maximum spans dispatch and take tokens', async () => {
    const dispatchStore = { listTokens: async () => [{ lastUsedAt: '2026-01-01T00:00:00.000Z' }] };
    const proxyStore = { listTokens: async () => [TAKE_TOKEN] };
    assert.equal(await getConsumerLastSeenAt(dispatchStore, ACME, proxyStore), '2026-03-03T00:00:00.000Z');
  });

  test('omitting proxyTokenStore stays dispatch-token-only (2-arg contract unchanged)', async () => {
    const dispatchStore = { listTokens: async () => [] };
    assert.equal(await getConsumerLastSeenAt(dispatchStore, ACME), null);
    assert.equal(await getConsumerLastSeenAt(dispatchStore, ACME, null), null);
  });

  test('createDispatchItem threads proxyTokenStore into the stamped consumerLastSeenAt', async () => {
    const captured = {};
    const store = { addItem: async (urlKey, item) => { captured.item = item; return { _id: 'item-1', ...item }; } };
    await createDispatchItem({
      store,
      urlKey: ACME,
      prompt: 'x',
      dispatchTokenStore: { listTokens: async () => [] },
      proxyTokenStore: { listTokens: async () => [TAKE_TOKEN] },
    });
    assert.equal(captured.item.consumerLastSeenAt, '2026-03-03T00:00:00.000Z');

    const captured2 = {};
    const store2 = { addItem: async (urlKey, item) => { captured2.item = item; return { _id: 'item-2', ...item }; } };
    await createDispatchItem({ store: store2, urlKey: ACME, prompt: 'x', dispatchTokenStore: { listTokens: async () => [] } });
    assert.equal(captured2.item.consumerLastSeenAt, null, 'no proxyTokenStore -> dispatch-only, unchanged');
  });
});

// ── Wake provisioning regression ────────────────────────────────────────────

describe('LIN-3130 — wake provisioning through runner feedback yields a grant-less child bootstrap', () => {
  test('a terminal runner feedback enqueues a wake whose bootstrap exchanges to a grant-less token', async () => {
    const db = freshDb();
    const store = freshDispatchStore(db);
    const proxyTokenStore = freshProxyTokenStore(db);
    const dispatchTokenStore = freshDispatchTokenStore(db);
    const working = await mintRunnerWorking(proxyTokenStore);
    const app = runnerApp({ proxyTokenStore, dispatchQueueStore: store, dispatchTokenStore });

    const parent = await store.addItem(ACME, { prompt: 'parent work', kind: 'implementation', harness: 'claude-code' });
    const child = await store.addItem(ACME, {
      prompt: 'child work', kind: 'implementation', harness: 'claude-code',
      sessionId: parent._id, subscription: 'terminal-only',
    });
    await call(app, 'POST', `/api/proxy/runner/take/${child._id}`, { headers: bearer(working.token), body: {} });

    const fb = await call(app, 'POST', `/api/proxy/runner/feedback/${child._id}`, { headers: bearer(working.token), body: { message: '[done] shipped' } });
    assert.equal(fb.status, 200, JSON.stringify(fb.body));

    const wakes = await store.collection.find({ kind: 'wake' }).toArray();
    assert.equal(wakes.length, 1, 'the runner feedback enqueued exactly one wake');
    assert.ok(wakes[0].bootstrapToken, 'the wake carries its own minted bootstrap');

    const exchanged = await proxyTokenStore.exchangeBootstrapToken(wakes[0].bootstrapToken);
    assert.ok(exchanged?.token, 'the wake bootstrap exchanges');
    const validated = await proxyTokenStore.validateToken(exchanged.token);
    assert.ok(validated, 'the wake working token validates');
    assert.deepEqual(validated.grants, [], 'the wake child bootstrap is grant-LESS (S2b owns minting take)');
  });
});
