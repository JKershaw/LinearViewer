/**
 * LIN-4198 beat 3: both usage routes over HTTP, against a real MangoDB.
 *
 *   POST /api/dispatch/usage/:itemId      (consumer dispatch token; createDispatchRoutes)
 *   POST /api/proxy/runner/usage/:id      (runner proxy token, `take` grant; createProxyRoutes)
 *
 * Both lanes run the same cases. The composers are the real ones, the stores are real, and
 * the ownership rule is the feedback rule, so a token that did not take the item gets a 404
 * exactly as feedback answers it.
 *
 * Run with: node --test tests/unit/lin-4198-usage-routes.test.js
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
import { HarbourFeedbackTokenStore } from '../../lib/harbour-feedback-tokens.js';
import { RUNNER_GRANTS } from '../../lib/proxy-scopes.js';
import { requestUsageStoreFor, USAGE_MAX_RECORDS_PER_CALL } from '../../lib/request-usage-intake.js';
import { buildApp, ACME } from './lib/proxy-fake-deps.js';

let dbDir;
let client;
let counter = 0;

before(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'lin4198-usage-routes-'));
  client = new MangoClient(dbDir);
  await client.connect();
});

after(async () => {
  if (client?.close) await client.close();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
});

/** A fresh database with the request-usage index the real boot tier declares (lib/db-indexes.js). */
async function freshWorld() {
  const db = client.db(`usage_routes_${counter++}`);
  const dispatchQueueStore = new DispatchQueueStore({
    collection: db.collection('dispatch-queue'),
    historyCollection: db.collection('dispatch-history')
  });
  const proxyTokenStore = new ProxyTokenStore({ collection: db.collection('proxy-tokens') });
  proxyTokenStore.setOwnerCheck(async () => ({ status: 'owner' }));
  const dispatchTokenStore = new DispatchTokenStore({ collection: db.collection('dispatch-tokens') });
  // The raw collection comes from the store the app builds, so this file never names it.
  const usage = requestUsageStoreFor(db);
  const records = usage.collection;
  await records.createIndex({ urlKey: 1, rootItemId: 1, requestId: 1 }, { unique: true });
  await records.createIndex({ urlKey: 1, rootItemId: 1 });
  const harbour = new HarbourFeedbackTokenStore({ collection: db.collection('harbour-feedback-tokens') });
  return { db, dispatchQueueStore, proxyTokenStore, dispatchTokenStore, usage, harbour, history: db.collection('dispatch-history'), records };
}

// ── HTTP plumbing (no default credential: the auth cases need to send none) ─────────────

async function call(app, method, path, { body, headers } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { ...headers } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

function dispatchApp(world) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: world.dispatchQueueStore,
    dispatchTokenStore: world.dispatchTokenStore,
    harbourFeedbackTokenStore: world.harbour,
    workspaceFromUrl: (req, res, next) => next(),
    userPreferencesStore: {},
    proxyTokenStore: world.proxyTokenStore,
    requestUsageStore: world.usage
  }));
  return app;
}

function runnerApp(world) {
  return buildApp({
    proxyTokenStore: world.proxyTokenStore,
    dispatchQueueStore: world.dispatchQueueStore,
    dispatchTokenStore: world.dispatchTokenStore,
    requestUsageStore: world.usage
  });
}

// ── the two credentials ────────────────────────────────────────────────────────────────

const RUNNER_LABEL = 'runner-label';

async function mintRunner(world, label = RUNNER_LABEL) {
  const bootstrap = await world.proxyTokenStore.mintGrantBootstrap({
    urlKey: ACME, workspaceId: 'ws-1', ownerAccountId: 'acct-A', grants: RUNNER_GRANTS, label
  });
  return world.proxyTokenStore.exchangeBootstrapToken(bootstrap.token);
}

// ── the two lanes, with the same cases each ───────────────────────────────────────────

const LANES = [
  {
    name: 'dispatch',
    path: (id) => `/api/dispatch/usage/${id}`,
    app: (world) => dispatchApp(world),
    /** Takes an item as the consumer token and returns { id, headers } for posting usage. */
    async takeAs(world) {
      const { token } = await world.dispatchTokenStore.createToken(ACME, 'consumer', 'account-A');
      const item = await world.dispatchQueueStore.addItem(ACME, { prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-7' });
      await world.dispatchQueueStore.takeItem(item._id, ACME, 'consumer');
      return { id: item._id, headers: bearer(token) };
    },
    /** A credential that did not take the item: a consumer token with another label. */
    async otherHeaders(world) {
      const { token } = await world.dispatchTokenStore.createToken(ACME, 'someone-else', 'account-B');
      return bearer(token);
    },
    /** A queued item nobody has taken, and a credential to try it with. */
    async untaken(world) {
      const { token } = await world.dispatchTokenStore.createToken(ACME, 'consumer', 'account-A');
      const item = await world.dispatchQueueStore.addItem(ACME, { prompt: 'queued', kind: 'implementation' });
      return { id: item._id, headers: bearer(token) };
    }
  },
  {
    name: 'runner',
    path: (id) => `/api/proxy/runner/usage/${id}`,
    app: (world) => runnerApp(world),
    async takeAs(world) {
      const working = await mintRunner(world);
      const item = await world.dispatchQueueStore.addItem(ACME, { prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-7' });
      const app = runnerApp(world);
      const take = await call(app, 'POST', `/api/proxy/runner/take/${item._id}`, { headers: bearer(working.token), body: {} });
      assert.equal(take.status, 200, `the runner takes the item first: ${JSON.stringify(take.body)}`);
      return { id: item._id, headers: bearer(working.token) };
    },
    async otherHeaders(world) {
      const other = await mintRunner(world, 'a-different-runner');
      return bearer(other.token);
    },
    async untaken(world) {
      const working = await mintRunner(world);
      const item = await world.dispatchQueueStore.addItem(ACME, { prompt: 'queued', kind: 'implementation' });
      return { id: item._id, headers: bearer(working.token) };
    }
  }
];

const rec = (requestId, tokens = {}, extra = {}) => ({
  requestId,
  harness: 'claude-code',
  model: 'claude-haiku-5-5',
  effort: 'high',
  lane: 'build',
  agent: 'main',
  inputTokens: 100,
  outputTokens: 10,
  ...tokens,
  ...extra
});

for (const lane of LANES) {
  describe(`POST ${lane.name === 'dispatch' ? '/api/dispatch/usage/:itemId' : '/api/proxy/runner/usage/:id'}`, () => {
    test('no credential is a 401 and nothing is written', async () => {
      const world = await freshWorld();
      const { id } = await lane.takeAs(world);
      const out = await call(lane.app(world), 'POST', lane.path(id), { body: { records: [rec('m')] } });
      assert.equal(out.status, 401, JSON.stringify(out.body));
      assert.equal(await world.records.countDocuments({}), 0);
    });

    test('a malformed item id is a 400 before anything else', async () => {
      const world = await freshWorld();
      const { headers } = await lane.takeAs(world);
      const out = await call(lane.app(world), 'POST', lane.path('not-a-uuid'), { headers, body: { records: [] } });
      assert.equal(out.status, 400);
      assert.deepEqual(out.body, { error: 'Invalid item ID format' });
    });

    test('a credential that did not take the item gets a 404 and writes nothing', async () => {
      const world = await freshWorld();
      const { id } = await lane.takeAs(world);
      const headers = await lane.otherHeaders(world);
      const out = await call(lane.app(world), 'POST', lane.path(id), { headers, body: { records: [rec('m')] } });
      assert.equal(out.status, 404, JSON.stringify(out.body));
      assert.equal(out.body.error, 'Item not found or usage not allowed');
      assert.equal(await world.records.countDocuments({}), 0);
    });

    test('an item nobody has taken is a 404 for its own credential, and writes nothing', async () => {
      const world = await freshWorld();
      const { id, headers } = await lane.untaken(world);
      const out = await call(lane.app(world), 'POST', lane.path(id), { headers, body: { records: [rec('m')] } });
      assert.equal(out.status, 404);
      assert.equal(await world.records.countDocuments({}), 0);
    });

    test(`more than ${USAGE_MAX_RECORDS_PER_CALL} records is refused whole with a 400, and nothing is written`, async () => {
      const world = await freshWorld();
      const { id, headers } = await lane.takeAs(world);
      const records = Array.from({ length: USAGE_MAX_RECORDS_PER_CALL + 1 }, (_, i) => rec(`m${i}`));
      const out = await call(lane.app(world), 'POST', lane.path(id), { headers, body: { records } });
      assert.equal(out.status, 400);
      assert.deepEqual(out.body, { error: `records exceeds the maximum of ${USAGE_MAX_RECORDS_PER_CALL} per call` });
      assert.equal(await world.records.countDocuments({}), 0);
    });

    test('a missing or non-array records is a 400', async () => {
      const world = await freshWorld();
      const { id, headers } = await lane.takeAs(world);
      for (const body of [{}, { records: 'nope' }]) {
        const out = await call(lane.app(world), 'POST', lane.path(id), { headers, body });
        assert.equal(out.status, 400);
        assert.deepEqual(out.body, { error: 'records is required and must be an array' });
      }
    });

    test('a mixed batch stores the valid records and reports the invalid ones with reasons, without failing the others', async () => {
      const world = await freshWorld();
      const { id, headers } = await lane.takeAs(world);
      const out = await call(lane.app(world), 'POST', lane.path(id), {
        headers,
        body: { records: [rec('good-1'), rec('bad', { inputTokens: -3 }), rec('good-2'), { inputTokens: 5 }] }
      });
      assert.equal(out.status, 200, JSON.stringify(out.body));
      assert.deepEqual(out.body.applied, ['good-1', 'good-2']);
      assert.deepEqual(out.body.rejected, [
        { requestId: 'bad', reason: 'inputTokens must be a finite non-negative number' },
        { requestId: null, reason: 'requestId is required' }
      ]);
      const stored = (await world.records.find({}).toArray()).map((r) => r.requestId).sort();
      assert.deepEqual(stored, ['good-1', 'good-2']);
    });

    test('a zero-token record is reported as applied and NOT stored', async () => {
      const world = await freshWorld();
      const { id, headers } = await lane.takeAs(world);
      const out = await call(lane.app(world), 'POST', lane.path(id), {
        headers,
        body: { records: [{ requestId: 'synthetic', model: '<synthetic>', harness: 'claude-code' }] }
      });
      assert.equal(out.status, 200);
      assert.deepEqual(out.body, { applied: ['synthetic'], rejected: [] });
      assert.equal(await world.records.countDocuments({ requestId: 'synthetic' }), 0);
    });

    test('a prompt over 2,000,000 tokens is rejected with its reason, and a record at the bound is stored', async () => {
      const world = await freshWorld();
      const { id, headers } = await lane.takeAs(world);
      const out = await call(lane.app(world), 'POST', lane.path(id), {
        headers,
        body: { records: [
          rec('running-total', { inputTokens: 1_500_000, cacheReadInputTokens: 600_000 }),
          rec('at-bound', { inputTokens: 2_000_000, outputTokens: 1 })
        ] }
      });
      assert.equal(out.status, 200, JSON.stringify(out.body));
      assert.deepEqual(out.body.applied, ['at-bound']);
      assert.equal(out.body.rejected.length, 1);
      assert.equal(out.body.rejected[0].requestId, 'running-total');
      assert.match(out.body.rejected[0].reason, /prompt tokens 2100000 exceed 2000000/);
      assert.equal(await world.records.countDocuments({ requestId: 'running-total' }), 0);
      assert.equal(await world.records.countDocuments({ requestId: 'at-bound' }), 1);
    });

    test('a rootItemId in the body is ignored: the record is anchored on the taken row', async () => {
      const world = await freshWorld();
      const { id, headers } = await lane.takeAs(world);
      const hist = await world.history.findOne({ _id: id });
      const anchor = hist.rootItemId ?? hist._id;
      const elsewhere = '00000000-0000-4000-8000-00000000beef';
      const out = await call(lane.app(world), 'POST', lane.path(id), {
        headers,
        body: { rootItemId: elsewhere, records: [rec('m')] }
      });
      assert.equal(out.status, 200);
      const doc = await world.records.findOne({ requestId: 'm' });
      assert.equal(doc.rootItemId, anchor, 'the body named a different lineage; the row decides');
      assert.notEqual(doc.rootItemId, elsewhere);
    });

    test('the stored record carries the posting row’s itemId and issueIdentifier', async () => {
      const world = await freshWorld();
      const { id, headers } = await lane.takeAs(world);
      await call(lane.app(world), 'POST', lane.path(id), { headers, body: { records: [rec('m')] } });
      const doc = await world.records.findOne({ requestId: 'm' });
      assert.equal(doc.itemId, id);
      assert.equal(doc.issueIdentifier, 'LIN-7');
    });

    test('reposting a request leaves one document; a larger repost grows it; a smaller one does not shrink it', async () => {
      const world = await freshWorld();
      const { id, headers } = await lane.takeAs(world);
      const app = lane.app(world);
      await call(app, 'POST', lane.path(id), { headers, body: { records: [rec('msg', { outputTokens: 10 })] } });
      await call(app, 'POST', lane.path(id), { headers, body: { records: [rec('msg', { outputTokens: 500 })] } });
      await call(app, 'POST', lane.path(id), { headers, body: { records: [rec('msg', { outputTokens: 20 })] } });
      const docs = await world.records.find({ requestId: 'msg' }).toArray();
      assert.equal(docs.length, 1, 'one document per request');
      assert.equal(docs[0].outputTokens, 500, 'the largest value is kept; the smaller repost did not shrink it');
    });
  });
}

// ── the deliberate deviation from feedback's token auth (LIN-4198 beat 3, pinned here in beat 4) ──
//
// Feedback accepts a single-use Harbour OS feedback token first. The usage route does NOT: that token is
// spent by its first successful call, and a runner posts usage in batches against one item, so the second
// batch would be refused. The refusal must also leave the token unspent. These tests pin both halves.
describe('POST /api/dispatch/usage/:itemId refuses the single-use Harbour OS feedback token, and the refusal does not spend it', () => {
  test('a Harbour OS feedback token on its own legacy self-take is a 401, nothing is stored, and the token is still claimable', async () => {
    const world = await freshWorld();
    // The item is taken under the 'harbour' label: the only row a Harbour OS feedback token could own.
    const item = await world.dispatchQueueStore.addItem(ACME, { prompt: 'harbour self-take', kind: 'implementation', issueIdentifier: 'LIN-8' });
    await world.dispatchQueueStore.takeItem(item._id, ACME, 'harbour');
    const { token } = await world.harbour.mintToken(item._id, ACME);

    const out = await call(dispatchApp(world), 'POST', `/api/dispatch/usage/${item._id}`, {
      headers: bearer(token),
      body: { records: [rec('from-harbour')] }
    });
    assert.equal(out.status, 401, `the usage route must not accept a Harbour OS feedback token: ${JSON.stringify(out.body)}`);
    assert.equal(await world.records.countDocuments({}), 0, 'the refused call stores nothing');

    const stillClaimable = await world.harbour.validateAndConsume(token, item._id);
    assert.ok(stillClaimable, 'the refused call did not spend the single-use token');
    assert.equal(stillClaimable.itemId, item._id);
  });

  test('the same token is still spendable on feedback, so the refusal is specific to the usage route', async () => {
    const world = await freshWorld();
    const item = await world.dispatchQueueStore.addItem(ACME, { prompt: 'harbour self-take', kind: 'implementation' });
    await world.dispatchQueueStore.takeItem(item._id, ACME, 'harbour');
    const { token } = await world.harbour.mintToken(item._id, ACME);
    // Feedback still consumes the token on its first successful call, which is what makes it single-use.
    const fb = await call(dispatchApp(world), 'POST', `/api/dispatch/feedback/${item._id}`, { headers: bearer(token), body: { message: '[done] ok' } });
    assert.equal(fb.status, 200, JSON.stringify(fb.body));
    assert.equal(await world.harbour.validateAndConsume(token, item._id), null, 'feedback spent the token');
  });
});
