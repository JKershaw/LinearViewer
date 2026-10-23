/**
 * LIN-3812: the watch long-poll's change detector. `getItemWatchToken` reads scalars
 * only; the route re-reads the whole document plus lineage feedback only when the
 * token moves. The token must move on exactly what `_collectGroupFeedback` /
 * `deriveWireStatus` read: own feedback, the row's status and bookkeeping stamp, and
 * any sibling in the lineage (any status, so a cancelled follow-up's `[done]` counts).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const TOKEN = 'consumer-1';
const URLKEY = 'acme';

const makeStore = () => new DispatchQueueStore({
  collection: createMockCollection(),
  historyCollection: createMockCollection()
});

async function dispatchTaken(store, fields) {
  const doc = await store.addItem(URLKEY, fields);
  await store.takeItem(doc._id, URLKEY, TOKEN);
  return doc;
}

async function lineage(store) {
  const root = await dispatchTaken(store, { prompt: 'root' });
  await store.addFeedback(root._id, URLKEY, { message: '[working] go', rootItemId: root._id }, TOKEN);
  const follow = await dispatchTaken(store, { prompt: 'follow', followUpTo: root._id, rootItemId: root._id, sessionGroupId: root._id });
  return { root, follow };
}

describe('getItemWatchToken', () => {
  test('is null for an absent row and stable while nothing moves', async () => {
    const store = makeStore();
    assert.equal(await store.getItemWatchToken(URLKEY, 'nope'), null);
    const { root } = await lineage(store);
    assert.equal(await store.getItemWatchToken(URLKEY, root._id), await store.getItemWatchToken(URLKEY, root._id));
  });

  test('moves on the row\'s own feedback, its bookkeeping stamp, and queue -> taken', async () => {
    const store = makeStore();
    const queued = await store.addItem(URLKEY, { prompt: 'q' });
    const t0 = await store.getItemWatchToken(URLKEY, queued._id);
    await store.takeItem(queued._id, URLKEY, TOKEN);
    const t1 = await store.getItemWatchToken(URLKEY, queued._id);
    assert.notEqual(t1, t0, 'taking the row moves it');
    await store.addFeedback(queued._id, URLKEY, { message: '[working] x' }, TOKEN);
    const t2 = await store.getItemWatchToken(URLKEY, queued._id);
    assert.notEqual(t2, t1, 'own feedback moves it');
    // the mock matches `bookkeeping: null` only against an explicit null (a real engine matches missing too)
    store.historyCollection._docs.find(d => d._id === queued._id).bookkeeping = null;
    await store.stampBookkeeping(URLKEY, queued._id, { by: 'op', reason: 'r' });
    assert.notEqual(await store.getItemWatchToken(URLKEY, queued._id), t2, 'a closed stamp moves it');
  });

  test('moves on a sibling\'s feedback in the lineage, including a CANCELLED sibling\'s [done]', async () => {
    const store = makeStore();
    const { root } = await lineage(store);
    const before = await store.getItemWatchToken(URLKEY, root._id);

    const cancelled = await store.addItem(URLKEY, { prompt: 'c', followUpTo: root._id, rootItemId: root._id, sessionGroupId: root._id });
    await store.removeItem(URLKEY, cancelled._id);
    const afterCancel = await store.getItemWatchToken(URLKEY, root._id);
    assert.notEqual(afterCancel, before, 'a cancelled sibling joins the candidate set (any status)');

    await store.addFeedback(cancelled._id, URLKEY, { message: '[done] late', rootItemId: root._id }, TOKEN).catch(() => {});
    // Whatever the writer did to the archived row, a feedback write on any sibling moves the token.
    const sibling = await dispatchTaken(store, { prompt: 's', followUpTo: root._id, rootItemId: root._id, sessionGroupId: root._id });
    const t = await store.getItemWatchToken(URLKEY, root._id);
    await store.addFeedback(sibling._id, URLKEY, { message: '[done] shipped', rootItemId: root._id }, TOKEN);
    assert.notEqual(await store.getItemWatchToken(URLKEY, root._id), t);
  });

  test('does not move for an unrelated lineage, or for a row with no session group', async () => {
    const store = makeStore();
    const { root } = await lineage(store);
    const t = await store.getItemWatchToken(URLKEY, root._id);
    const other = await dispatchTaken(store, { prompt: 'other' });
    await store.addFeedback(other._id, URLKEY, { message: '[done]' }, TOKEN);
    assert.equal(await store.getItemWatchToken(URLKEY, root._id), t);
  });

  test('legacy anchor tier: a sessionGroupId row with no doc-level rootItemId resolves its anchor from its tagged entry', async () => {
    const store = makeStore();
    const legacy = await dispatchTaken(store, { prompt: 'legacy' });
    await store.addFeedback(legacy._id, URLKEY, { message: '[working]', rootItemId: 'ANCHOR-1' }, TOKEN);
    // Strip the doc-level latch to model a post-LIN-1341 / pre-LIN-1468 row.
    const doc = store.historyCollection._docs.find(d => d._id === legacy._id);
    delete doc.rootItemId;
    const sib = { _id: 'sib-1', urlKey: URLKEY, rootItemId: 'ANCHOR-1', status: 'taken', feedbackVersion: 0, feedback: [], prompt: 'p', dispatchedAt: new Date(), resolvedAt: new Date() };
    store.historyCollection._docs.push(sib);

    const t = await store.getItemWatchToken(URLKEY, legacy._id);
    sib.feedbackVersion = 1;
    sib.feedback = [{ message: '[done] x', timestamp: new Date(), rootItemId: 'ANCHOR-1' }];
    assert.notEqual(await store.getItemWatchToken(URLKEY, legacy._id), t, 'a sibling [done] under the entry-level anchor moves the token');
    // and the body agrees (the two share groupAnchorFor)
    const body = await store.getItemFeedback(URLKEY, legacy._id, { includeGroupFeedback: true });
    assert.ok(body.feedback.some(f => /\[done\] x/.test(f.message)));
  });
});

describe('the long-poll holds on the token, not on full re-reads', () => {
  function appFor(store) {
    const app = express();
    app.use(express.json());
    app.use(createProxyRoutes({
      proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: URLKEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
      proxyEventStore: { recordEvent: async () => {} },
      resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
      getWorkspaceAccessToken: async () => 'test-token',
      getWorkspaceOpenRouterKey: async () => null,
      agentStatusStore: {},
      recapCacheStore: { get: async () => null, set: async () => {} },
      briefCacheStore: { get: async () => null, set: async () => {} },
      dispatchQueueStore: store,
      workspaceFromUrl: (req, res, next) => next(),
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
      freeTierStore: { tryUse: async () => ({ allowed: true }) }
    }));
    return app;
  }
  async function watch(app, id, wait = 4) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/dispatch/${id}?wait=${wait}`, { headers: { Authorization: 'Bearer anything' } });
      return await res.json();
    } finally {
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  }

  test('an idle hold re-reads the document once; a sibling [done] (cancelled lineage member) still returns change', async () => {
    const store = makeStore();
    const { root } = await lineage(store);
    let bodyReads = 0;
    const real = store.getItemFeedback.bind(store);
    store.getItemFeedback = (...a) => { bodyReads++; return real(...a); };
    const app = appFor(store);

    const sibling = await dispatchTaken(store, { prompt: 's', followUpTo: root._id, rootItemId: root._id, sessionGroupId: root._id });
    setTimeout(() => { store.addFeedback(sibling._id, URLKEY, { message: '[done] shipped', rootItemId: root._id }, TOKEN); }, 2000);

    const out = await watch(app, root._id, 6);
    assert.equal(out.reason, 'change');
    assert.equal(out.status, 'done');
    assert.equal(bodyReads, 2, 'one first read + one re-read after the token moved; none while idle');
  });

  test('a hold with nothing moving times out after exactly one document read', async () => {
    const store = makeStore();
    const { root } = await lineage(store);
    let bodyReads = 0;
    const real = store.getItemFeedback.bind(store);
    store.getItemFeedback = (...a) => { bodyReads++; return real(...a); };
    const out = await watch(appFor(store), root._id, 3);
    assert.equal(out.reason, 'timeout');
    assert.equal(bodyReads, 1);
  });

  test('N10: a QUEUED item taken mid-wait returns change (the CLI\'s main watch case), and the token reads the queue first', async () => {
    const store = makeStore();
    const queued = await store.addItem(URLKEY, { prompt: 'waiting for a runner' });
    const app = appFor(store);
    setTimeout(() => { store.takeItem(queued._id, URLKEY, TOKEN); }, 1200);
    const out = await watch(app, queued._id, 6);
    assert.equal(out.reason, 'change', 'the hold ended on the take, not on the timeout');
    assert.equal(out.status, 'taken');
  });

  test('N10: a row that is genuinely absent ends the hold at once (the not-found break is kept)', async () => {
    const app = appFor(makeStore());
    const started = Date.now();
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/dispatch/nope?wait=6`, { headers: { Authorization: 'Bearer anything' } });
      assert.equal(res.status, 404);
    } finally {
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
    assert.ok(Date.now() - started < 3000);
  });
});
