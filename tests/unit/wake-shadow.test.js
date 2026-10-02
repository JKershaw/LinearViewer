/**
 * Unit tests for the LIN-3257 (M1 shadow) wake-shadow recording + proxy reads.
 *
 * Layers:
 *  - the wake-shadow MODULE (lib/wake-shadow.js): record/read the verdict, the
 *    per-day tally and the per-edge prior, over the shared mock collection.
 *  - the STORE seam (addFeedback): a minted wake is classified and recorded, and
 *    the per-wake + tally reads work through DispatchQueueStore.
 *  - NO-SUPPRESSION CHARACTERIZATION: the wake descriptor / delivery is
 *    byte-identical with and without the shadow collection, and a throwing
 *    shadow write still delivers the wake and returns the same result.
 *  - the PROXY reads: GET /api/proxy/wake-shadow and the `wakeShadow` field on
 *    GET /api/proxy/dispatch/{id}, over the real express app.
 *
 * The classifier's pure classes are pinned in tests/unit/dispatch-wake.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { recordWakeShadow, readWakeShadowTally, wakeShadowVerdictId } from '../../lib/wake-shadow.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

function makeStore({ shadow = true } = {}) {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const wakeShadowCollection = shadow ? createMockCollection() : null;
  const store = new DispatchQueueStore({ collection, historyCollection, wakeShadowCollection });
  return { store, collection, historyCollection, wakeShadowCollection };
}

async function takenChild(store, overrides = {}) {
  const child = await store.addItem(URL_KEY, {
    prompt: 'do the thing',
    kind: 'implementation',
    issueIdentifier: 'LIN-42',
    sessionId: 'parent-S1',
    subscription: 'everything',
    ...overrides
  });
  await store.takeItem(child._id, URL_KEY, 'token-a');
  return child;
}

function wakeRows(collection, historyCollection) {
  const active = collection._docs.filter(d => d.kind === 'wake');
  const archived = historyCollection ? historyCollection._docs.filter(d => d.kind === 'wake') : [];
  return [...active, ...archived];
}

// ── lib/wake-shadow.js: the storage contract ─────────────────────────────────

describe('lib/wake-shadow.js — record + read', () => {
  test('records a verdict, bumps the tally, and stores the edge prior', async () => {
    const c = createMockCollection();
    const day = new Date('2026-10-02T12:00:00.000Z');
    const verdict = await recordWakeShadow(c, {
      urlKey: URL_KEY,
      wakeRowId: 'wake-1',
      edgeId: 'edge-1',
      producingItemId: 'prod-1',
      marker: 'pending',
      message: '[pending] waiting on LIN-3257',
      now: day
    });
    assert.deepEqual(verdict, { wouldSkip: false, reason: 'first-pause' });

    const verdictDoc = c._docs.find(d => d._id === wakeShadowVerdictId('wake-1'));
    assert.ok(verdictDoc, 'a verdict doc is written');
    assert.equal(verdictDoc.wouldSkip, false);
    assert.equal(verdictDoc.reason, 'first-pause');
    assert.equal(verdictDoc.day, '2026-10-02');

    const tally = c._docs.find(d => d._id === 'tally:acme:2026-10-02');
    assert.equal(tally.minted, 1);
    assert.equal(tally.wouldSkip, 0);
    assert.equal(tally.byReason['first-pause'], 1);
  });

  test('a second identical pause marks wouldSkip with the repeat reason', async () => {
    const c = createMockCollection();
    const now = new Date('2026-10-02T12:00:00.000Z');
    await recordWakeShadow(c, { urlKey: URL_KEY, wakeRowId: 'w1', edgeId: 'e1', marker: 'pending', message: '[pending] waiting 12 min', now });
    const verdict = await recordWakeShadow(c, { urlKey: URL_KEY, wakeRowId: 'w2', edgeId: 'e1', marker: 'pending', message: '[pending] waiting 15 min', now });
    assert.deepEqual(verdict, { wouldSkip: true, reason: 'repeat-same-message' });
    const tally = c._docs.find(d => d._id === 'tally:acme:2026-10-02');
    assert.equal(tally.minted, 2);
    assert.equal(tally.wouldSkip, 1);
    assert.equal(tally.byReason['repeat-same-message'], 1);
  });

  test('a terminal wake resets the prior, so the next pause is first-pause', async () => {
    const c = createMockCollection();
    const now = new Date('2026-10-02T12:00:00.000Z');
    await recordWakeShadow(c, { urlKey: URL_KEY, wakeRowId: 'w1', edgeId: 'e1', marker: 'pending', message: '[pending] waiting', now });
    const terminal = await recordWakeShadow(c, { urlKey: URL_KEY, wakeRowId: 'w2', edgeId: 'e1', marker: 'done', message: '[done] shipped', now });
    assert.deepEqual(terminal, { wouldSkip: false, reason: 'terminal' });
    const next = await recordWakeShadow(c, { urlKey: URL_KEY, wakeRowId: 'w3', edgeId: 'e1', marker: 'pending', message: '[pending] waiting', now });
    assert.deepEqual(next, { wouldSkip: false, reason: 'first-pause' });
  });

  test('readWakeShadowTally buckets by UTC day and applies the days window', async () => {
    const c = createMockCollection();
    await recordWakeShadow(c, { urlKey: URL_KEY, wakeRowId: 'a', edgeId: 'e1', marker: 'done', message: '[done] x', now: new Date('2026-09-30T12:00:00.000Z') });
    await recordWakeShadow(c, { urlKey: URL_KEY, wakeRowId: 'b', edgeId: 'e1', marker: 'pending', message: '[pending] wait', now: new Date('2026-10-01T12:00:00.000Z') });
    await recordWakeShadow(c, { urlKey: URL_KEY, wakeRowId: 'c', edgeId: 'e1', marker: 'pending', message: '[pending] wait', now: new Date('2026-10-02T12:00:00.000Z') });

    const seven = await readWakeShadowTally(c, URL_KEY, { days: 7, now: new Date('2026-10-02T18:00:00.000Z') });
    assert.deepEqual(seven.days.map(d => d.day), ['2026-09-30', '2026-10-01', '2026-10-02'], 'all in range, oldest first');
    assert.equal(seven.totals.minted, 3);
    assert.equal(seven.totals.wouldSkip, 1, 'only the same-target repeat on 10-02 is a wouldSkip');
    assert.equal(seven.totals.share, 1 / 3);

    const one = await readWakeShadowTally(c, URL_KEY, { days: 1, now: new Date('2026-10-02T18:00:00.000Z') });
    assert.deepEqual(one.days.map(d => d.day), ['2026-10-02'], 'the window excludes the earlier days');
    assert.equal(one.totals.minted, 1);
    assert.equal(one.totals.wouldSkip, 1);
  });

  test('an absent collection degrades to a no-op / empty summary', async () => {
    const verdict = await recordWakeShadow(null, { urlKey: URL_KEY, wakeRowId: 'x', marker: 'pending', message: '[pending] x' });
    assert.equal(verdict, null);
    const tally = await readWakeShadowTally(null, URL_KEY);
    assert.deepEqual(tally, { days: [], totals: { minted: 0, wouldSkip: 0, share: 0, byReason: {} } });
  });
});

// ── The addFeedback seam ─────────────────────────────────────────────────────

describe('addFeedback — shadow recording at mint time', () => {
  test('a minted pause wake records its verdict and per-wake read', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[pending] waiting on LIN-3257' }, 'token-a');
    assert.ok(res && res.success);

    const [wake] = wakeRows(collection, historyCollection);
    assert.ok(wake, 'the wake was minted');
    const shadow = await store.getWakeShadow(URL_KEY, wake._id);
    assert.deepEqual(shadow, { wouldSkip: false, reason: 'first-pause' });

    const tally = await store.getWakeShadowTally(URL_KEY);
    assert.equal(tally.totals.minted, 1);
    assert.equal(tally.totals.byReason['first-pause'], 1);
  });

  test('a repeat pause on the same edge marks wouldSkip true', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);

    await store.addFeedback(child._id, URL_KEY, { message: '[pending] not done - waiting 12 min' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[pending] Not done - waiting 15 min' }, 'token-a');

    const wakes = wakeRows(collection, historyCollection);
    assert.equal(wakes.length, 2, 'every pause mints a wake (no suppression)');
    const shadows = await Promise.all(wakes.map(w => store.getWakeShadow(URL_KEY, w._id)));
    assert.deepEqual(shadows.map(s => s.wouldSkip), [false, true]);
    assert.equal(shadows[1].reason, 'repeat-same-message');
    const tally = await store.getWakeShadowTally(URL_KEY);
    assert.equal(tally.totals.wouldSkip, 1);
  });

  test('a changed target is recorded target-changed, never wouldSkip', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);
    await store.addFeedback(child._id, URL_KEY, { message: '[pending] waiting on LIN-1' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[pending] waiting on LIN-2' }, 'token-a');
    const wakes = wakeRows(collection, historyCollection);
    const shadow = await store.getWakeShadow(URL_KEY, wakes[1]._id);
    assert.deepEqual(shadow, { wouldSkip: false, reason: 'target-changed' });
  });

  test('a terminal wake is recorded terminal; the next pause is first-pause', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);
    await store.addFeedback(child._id, URL_KEY, { message: '[pending] waiting' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[pending] waiting again' }, 'token-a');
    const wakes = wakeRows(collection, historyCollection);
    const byReason = await Promise.all(wakes.map(w => store.getWakeShadow(URL_KEY, w._id)));
    assert.deepEqual(byReason.map(s => s.reason), ['first-pause', 'terminal', 'first-pause']);
  });

  test('getWakeShadow returns null for a non-wake row and when no collection is wired', async () => {
    const { store } = makeStore({ shadow: false });
    const child = await takenChild(store);
    await store.addFeedback(child._id, URL_KEY, { message: '[done] x' }, 'token-a');
    assert.equal(await store.getWakeShadow(URL_KEY, child._id), null, 'non-wake row');

    const noShadow = makeStore({ shadow: false });
    const c2 = await takenChild(noShadow.store);
    await noShadow.store.addFeedback(c2._id, URL_KEY, { message: '[pending] wait' }, 'token-a');
    const [wake] = wakeRows(noShadow.collection, noShadow.historyCollection);
    assert.equal(await noShadow.store.getWakeShadow(URL_KEY, wake._id), null, 'no collection → null');
  });
});

// ── No-suppression characterization ──────────────────────────────────────────

function captureWakeDescriptors(store) {
  const calls = [];
  const original = store.addItem.bind(store);
  store.addItem = async (urlKey, item) => {
    if (item && item.kind === 'wake') calls.push(JSON.parse(JSON.stringify(item)));
    return original(urlKey, item);
  };
  return calls;
}

describe('no-suppression characterization', () => {
  test('the minted wake descriptor and the addFeedback result are identical with and without the shadow', async () => {
    async function run(shadow) {
      const { store } = makeStore({ shadow });
      const child = await takenChild(store);
      const calls = captureWakeDescriptors(store);
      const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
      return { calls, res };
    }
    const withShadow = await run(true);
    const withoutShadow = await run(false);
    // `producingItemId` is a freshly minted UUID in each run — strip it; every
    // field that fixes delivery (prompt, followUpTo, sessionId, queueIfBusy,
    // kind, issueIdentifier, subscription, producingItemAttempt) must match.
    const normalize = (calls) => calls.map(c => { const { producingItemId, ...rest } = c; return rest; });
    assert.deepEqual(normalize(withShadow.calls), normalize(withoutShadow.calls), 'the wake descriptor is byte-identical');
    assert.deepEqual(withShadow.res, withoutShadow.res, 'the addFeedback result is identical');
    assert.equal(withShadow.calls.length, 1);
  });

  test('a throwing shadow write still delivers the wake and returns the same result', async () => {
    const { store, collection, historyCollection, wakeShadowCollection } = makeStore();
    const child = await takenChild(store);
    const calls = captureWakeDescriptors(store);
    wakeShadowCollection.updateOne = async () => { throw new Error('shadow storage down'); };

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    assert.deepEqual(res, { success: true, feedbackCount: 1 }, 'delivery result is unaffected');
    assert.equal(calls.length, 1, 'the wake was still enqueued');
    assert.equal(wakeRows(collection, historyCollection).length, 1);
  });

  test('the shadow never suppresses: every pause on an everything edge still mints a wake', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);
    for (const msg of ['[pending] waiting 1 min', '[pending] waiting 2 min', '[pending] waiting 3 min']) {
      await store.addFeedback(child._id, URL_KEY, { message: msg }, 'token-a');
    }
    const wakes = wakeRows(collection, historyCollection);
    assert.equal(wakes.length, 3, 'all three repeats were delivered');
    const shadows = await Promise.all(wakes.map(w => store.getWakeShadow(URL_KEY, w._id)));
    assert.deepEqual(shadows.map(s => s.wouldSkip), [false, true, true], 'the shadow marks but does not suppress');
  });
});

// ── The proxy reads ──────────────────────────────────────────────────────────

function buildProxyApp({ dispatchQueueStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1', grants: [], workspaceId: 'ws-acme' }),
      createToken: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' }),
      mintGrantBootstrap: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer anything' } });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('proxy wake-shadow reads (LIN-3257)', () => {
  test('GET /api/proxy/wake-shadow returns the per-day tally and totals', async () => {
    const { store } = makeStore();
    const child = await takenChild(store);
    await store.addFeedback(child._id, URL_KEY, { message: '[pending] waiting 1 min' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[pending] waiting 2 min' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');

    const app = buildProxyApp({ dispatchQueueStore: store });
    const { status, body } = await get(app, '/api/proxy/wake-shadow');
    assert.equal(status, 200);
    assert.equal(body.totals.minted, 3);
    assert.equal(body.totals.wouldSkip, 1);
    assert.equal(typeof body.totals.share, 'number');
    assert.equal(body.days.length, 1, 'all three landed in one UTC day');
    assert.equal(body.days[0].minted, 3);
  });

  test('the watch response carries wakeShadow on a wake row and null on a non-wake row', async () => {
    const { store } = makeStore();
    const child = await takenChild(store);
    await store.addFeedback(child._id, URL_KEY, { message: '[pending] waiting on LIN-3257' }, 'token-a');
    const [wake] = wakeRows(store.collection, store.historyCollection);

    const app = buildProxyApp({ dispatchQueueStore: store });
    const wakeRes = await get(app, `/api/proxy/dispatch/${wake._id}`);
    assert.equal(wakeRes.status, 200);
    assert.deepEqual(wakeRes.body.wakeShadow, { wouldSkip: false, reason: 'first-pause' });

    const nonWakeRes = await get(app, `/api/proxy/dispatch/${child._id}`);
    assert.equal(nonWakeRes.status, 200);
    assert.equal(nonWakeRes.body.wakeShadow, null);
  });

  test('GET /api/proxy/wake-shadow degrades to an empty summary with no shadow collection', async () => {
    const { store } = makeStore({ shadow: false });
    const app = buildProxyApp({ dispatchQueueStore: store });
    const { status, body } = await get(app, '/api/proxy/wake-shadow');
    assert.equal(status, 200);
    assert.deepEqual(body, { days: [], totals: { minted: 0, wouldSkip: 0, share: 0, byReason: {} } });
  });

  test('the tally route clamps days and never writes', async () => {
    const { store, wakeShadowCollection } = makeStore();
    const child = await takenChild(store);
    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    const before = wakeShadowCollection._docs.length;
    const app = buildProxyApp({ dispatchQueueStore: store });
    const { status, body } = await get(app, '/api/proxy/wake-shadow?days=9999');
    assert.equal(status, 200);
    assert.ok(body.totals.minted >= 1);
    assert.equal(wakeShadowCollection._docs.length, before, 'the read wrote nothing');
  });
});
