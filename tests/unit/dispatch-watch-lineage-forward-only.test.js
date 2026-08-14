/**
 * LIN-1480 — `GET /api/proxy/dispatch/:id`'s lineage merge (`_collectGroupFeedback`,
 * lib/dispatch-store.js) must not report a still-RUNNING follow-up as terminal by
 * inheriting a predecessor's earlier `[done]`. The invariant: a row's `completedAt`,
 * when non-null, is never earlier than that row's own `dispatchedAt`.
 *
 * Fixed by routing `_collectGroupFeedback` through the same `mergeLineageFeedback`
 * forward-only guard (lib/dispatch-terminal.js) LIN-1470 already applies on the
 * list endpoint (`GET /api/proxy/dispatch`), so both surfaces share one definition
 * of the invariant.
 *
 * Harness lifted from tests/unit/dispatch-watch-root-item-id.test.js (real
 * DispatchQueueStore over mock collections, driven through the real proxy router)
 * + the lineage seeding idiom from tests/unit/dispatch-store-feedback-group.test.js.
 * Cases 1 and 3 are cherry-picked from the evidence branch
 * `lin-1480-repro-evidence` @ `3c162f4b` (tests/unit/lin-1480-id-seam-repro.test.js),
 * with case 1's positive assertion INVERTED (the evidence file asserts the bug is
 * present; this file asserts it is fixed).
 *
 * This is deliberately NOT folded into LIN-1470's proxy-dispatch-lineage-join.test.js
 * matrix — that file drives the list endpoint over a fake store/fixture harness and
 * cannot exercise `_collectGroupFeedback`'s real-store merge at all.
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

function buildApp({ dispatchQueueStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: URLKEY, label: 'test', scope: 'readWrite', createdBy: 'u1' })
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

async function call(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const started = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: 'Bearer anything' }
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, elapsedMs: Date.now() - started };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const makeStore = () => new DispatchQueueStore({
  collection: createMockCollection(),
  historyCollection: createMockCollection()
});

const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));

// Dispatch + take, emulating dispatch-factory.js's followUpTo/rootItemId
// inheritance seam (the store itself never performs that inheritance).
async function dispatchTaken(store, { prompt, followUpTo, rootItemId, sessionGroupId }) {
  const doc = await store.addItem(URLKEY, { prompt, followUpTo, rootItemId, sessionGroupId });
  await store.takeItem(doc._id, URLKEY, TOKEN);
  return doc;
}

describe('LIN-1480 — :id watch seam lineage merge is forward-only', () => {

  test('case 1 (fix-proving): running follow-up dispatched AFTER predecessor [done] reports taken/null, not the predecessor\'s terminal', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    // --- Predecessor A: runs and completes.
    const a = await dispatchTaken(store, { prompt: 'original task' });
    await store.addFeedback(a._id, URLKEY,
      { message: '[done] Task completed in 45s', rootItemId: a._id }, TOKEN);

    // Backdate A's whole run by 10 minutes — the production shape (LIN-1004
    // reply box / autopilot's "follow up only after a flawless session" both
    // dispatch the follow-up long after the predecessor finished).
    const TEN_MIN = 10 * 60 * 1000;
    const aRaw = await store.historyCollection.findOne({ _id: a._id, urlKey: URLKEY });
    for (const f of aRaw.feedback) f.timestamp = new Date(Date.parse(f.timestamp) - TEN_MIN);
    aRaw.dispatchedAt = new Date(Date.parse(aRaw.dispatchedAt) - TEN_MIN);

    await tick(); // ensure B is dispatched strictly AFTER A completed

    // --- Follow-up B: dispatched after A finished, STILL RUNNING (only a
    // non-terminal own heartbeat) — the ordinary case, since findTerminalFeedback
    // scans backward past B's own heartbeats to A's [done] if not guarded.
    const b = await dispatchTaken(store, {
      prompt: 'follow-up task',
      followUpTo: a._id,
      rootItemId: a._id,
      sessionGroupId: aRaw.sessionGroupId
    });
    await store.addFeedback(b._id, URLKEY,
      { message: '[heartbeat] still working, 3 tools used', rootItemId: a._id }, TOKEN);

    const bDoc = await store.historyCollection.findOne({ _id: b._id, urlKey: URLKEY });
    const res = await call(app, `/api/proxy/dispatch/${b._id}`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'taken', 'a still-running row must not report done');
    assert.equal(res.body.completedAt, null, 'must not inherit a completedAt it never produced');
    assert.deepEqual(res.body.feedback.map(f => f.message), ['[heartbeat] still working, 3 tools used'],
      'must report only its OWN feedback, not the predecessor\'s [done]');
    assert.ok(Date.parse(bDoc.dispatchedAt) > 0);
  });

  test('case 2 (fix-proving): same shape with ?wait=1 actually holds — no false-terminal short-circuit', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const a = await dispatchTaken(store, { prompt: 'original task' });
    await store.addFeedback(a._id, URLKEY,
      { message: '[done] Task completed in 45s', rootItemId: a._id }, TOKEN);
    const TEN_MIN = 10 * 60 * 1000;
    const aRaw = await store.historyCollection.findOne({ _id: a._id, urlKey: URLKEY });
    for (const f of aRaw.feedback) f.timestamp = new Date(Date.parse(f.timestamp) - TEN_MIN);
    aRaw.dispatchedAt = new Date(Date.parse(aRaw.dispatchedAt) - TEN_MIN);

    await tick();

    const b = await dispatchTaken(store, {
      prompt: 'follow-up task',
      followUpTo: a._id,
      rootItemId: a._id,
      sessionGroupId: aRaw.sessionGroupId
    });
    await store.addFeedback(b._id, URLKEY,
      { message: '[heartbeat] still working', rootItemId: a._id }, TOKEN);

    const res = await call(app, `/api/proxy/dispatch/${b._id}?wait=1`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.notEqual(res.body.reason, 'terminal', 'must not short-circuit as terminal for a live session');
    assert.notEqual(res.body.waitedMs, 0, 'must actually hold the long-poll, not return instantly');
    assert.ok(res.elapsedMs > 500, `expected the request to hold near the 1s wait, took ${res.elapsedMs}ms`);
  });

  test('case 3 (negative control): follow-up dispatched BEFORE predecessor terminal still inherits it', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const a = await dispatchTaken(store, { prompt: 'original task' });
    const aDoc = await store.historyCollection.findOne({ _id: a._id, urlKey: URLKEY });

    // B dispatched WHILE A is still going — legitimate lineage inheritance
    // (LIN-1461's case). Must survive the forward-only guard: the sibling
    // entry's timestamp is at/after B's own dispatchedAt.
    const b = await dispatchTaken(store, {
      prompt: 'follow-up task',
      followUpTo: a._id,
      rootItemId: a._id,
      sessionGroupId: aDoc.sessionGroupId
    });

    await tick(); // A's terminal lands AFTER B was dispatched

    await store.addFeedback(a._id, URLKEY,
      { message: '[done] Task completed in 45s', rootItemId: a._id }, TOKEN);

    const bDoc = await store.historyCollection.findOne({ _id: b._id, urlKey: URLKEY });
    const res = await call(app, `/api/proxy/dispatch/${b._id}`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'done', 'legitimate forward inheritance must still work');
    const completedMs = Date.parse(res.body.completedAt);
    const dispatchedMs = Date.parse(bDoc.dispatchedAt);
    assert.ok(completedMs >= dispatchedMs, 'CONTROL FAILED: completedAt precedes dispatchedAt on a legitimate case');
  });

  test('case 4 (negative control): a running row OUTSIDE the lineage stays taken/null', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const a = await dispatchTaken(store, { prompt: 'original task' });
    await store.addFeedback(a._id, URLKEY,
      { message: '[done] Task completed in 45s', rootItemId: a._id }, TOKEN);

    await tick();

    // C is its own, unrelated lineage.
    const c = await dispatchTaken(store, { prompt: 'unrelated task' });
    await store.addFeedback(c._id, URLKEY,
      { message: '[heartbeat] still working', rootItemId: c._id }, TOKEN);

    const res = await call(app, `/api/proxy/dispatch/${c._id}`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'taken', 'CONTROL FAILED: an unrelated running row must not inherit a sibling terminal');
    assert.equal(res.body.completedAt, null);
  });

  test('case 5 (negative control): a row with its OWN terminal inside a lineage reports its own completion', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    // A is the row under test — it has its OWN [done]. B is a STILL-RUNNING
    // sibling dispatched after A finished, contributing only a non-terminal
    // heartbeat — so the only terminal entry in the merge is A's own, proving
    // it is not blanked out by an over-aggressive since-guard that (wrongly)
    // also filtered "own" feedback. (A later sibling that itself completes is
    // legitimately reflected on the lineage's root id — see the multi-hop
    // coverage in dispatch-store-feedback-group.test.js — so is deliberately
    // not the shape exercised here.)
    const a = await dispatchTaken(store, { prompt: 'original task' });
    await store.addFeedback(a._id, URLKEY,
      { message: '[done] Task completed in 45s', rootItemId: a._id }, TOKEN);
    const aDoc = await store.historyCollection.findOne({ _id: a._id, urlKey: URLKEY });
    const aCompletedAt = aDoc.feedback.find(f => f.message.startsWith('[done]')).timestamp;

    await tick();

    const b = await dispatchTaken(store, {
      prompt: 'later sibling',
      followUpTo: a._id,
      rootItemId: a._id,
      sessionGroupId: aDoc.sessionGroupId
    });
    await store.addFeedback(b._id, URLKEY,
      { message: '[heartbeat] still working', rootItemId: a._id }, TOKEN);

    const res = await call(app, `/api/proxy/dispatch/${a._id}`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'done', 'CONTROL FAILED: a row\'s own terminal must always survive the merge');
    assert.equal(Date.parse(res.body.completedAt), Date.parse(aCompletedAt.toISOString ? aCompletedAt.toISOString() : aCompletedAt));
  });

  test('case 6 (invariant guard): completedAt, when non-null, is never earlier than dispatchedAt', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const a = await dispatchTaken(store, { prompt: 'original task' });
    await store.addFeedback(a._id, URLKEY,
      { message: '[done] Task completed', rootItemId: a._id }, TOKEN);
    const TEN_MIN = 10 * 60 * 1000;
    const aRaw = await store.historyCollection.findOne({ _id: a._id, urlKey: URLKEY });
    for (const f of aRaw.feedback) f.timestamp = new Date(Date.parse(f.timestamp) - TEN_MIN);
    aRaw.dispatchedAt = new Date(Date.parse(aRaw.dispatchedAt) - TEN_MIN);

    await tick();

    const b = await dispatchTaken(store, {
      prompt: 'follow-up task',
      followUpTo: a._id,
      rootItemId: a._id,
      sessionGroupId: aRaw.sessionGroupId
    });
    await store.addFeedback(b._id, URLKEY,
      { message: '[heartbeat] still working', rootItemId: a._id }, TOKEN);
    const bDoc = await store.historyCollection.findOne({ _id: b._id, urlKey: URLKEY });

    const res = await call(app, `/api/proxy/dispatch/${b._id}`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    if (res.body.completedAt !== null) {
      assert.ok(Date.parse(res.body.completedAt) >= Date.parse(bDoc.dispatchedAt),
        `completedAt (${res.body.completedAt}) precedes dispatchedAt (${bDoc.dispatchedAt})`);
    }
  });

  test('case 7 (cross-surface consistency): list endpoint and :id endpoint agree on status and completedAt for the same row', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const a = await dispatchTaken(store, { prompt: 'original task' });
    await store.addFeedback(a._id, URLKEY,
      { message: '[done] Task completed in 45s', rootItemId: a._id }, TOKEN);
    const TEN_MIN = 10 * 60 * 1000;
    const aRaw = await store.historyCollection.findOne({ _id: a._id, urlKey: URLKEY });
    for (const f of aRaw.feedback) f.timestamp = new Date(Date.parse(f.timestamp) - TEN_MIN);
    aRaw.dispatchedAt = new Date(Date.parse(aRaw.dispatchedAt) - TEN_MIN);

    await tick();

    const b = await dispatchTaken(store, {
      prompt: 'follow-up task',
      followUpTo: a._id,
      rootItemId: a._id,
      sessionGroupId: aRaw.sessionGroupId
    });
    await store.addFeedback(b._id, URLKEY,
      { message: '[heartbeat] still working', rootItemId: a._id }, TOKEN);

    const [listRes, idRes] = await Promise.all([
      call(app, '/api/proxy/dispatch'),
      call(app, `/api/proxy/dispatch/${b._id}`)
    ]);

    assert.equal(listRes.status, 200, JSON.stringify(listRes.body));
    assert.equal(idRes.status, 200, JSON.stringify(idRes.body));

    const listRow = listRes.body.items.find(i => i.id === b._id);
    assert.ok(listRow, 'the follow-up row must appear in the list response');

    assert.equal(listRow.status, idRes.body.status, 'list and :id must agree on status for the same row');
    assert.equal(listRow.completedAt, idRes.body.completedAt, 'list and :id must agree on completedAt for the same row');
    // Pin the actual invariant here too, not just cross-surface agreement.
    assert.equal(listRow.status, 'taken');
    assert.equal(listRow.completedAt, null);
  });
});
