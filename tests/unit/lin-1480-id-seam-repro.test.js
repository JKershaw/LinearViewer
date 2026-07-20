/**
 * LIN-1480 BEAT 3 — RESEARCH EVIDENCE, NOT A FIX.
 *
 * Executes the hypothesis that `GET /api/proxy/dispatch/:id` reports a still-
 * RUNNING follow-up as terminal by inheriting its predecessor's earlier
 * `[done]` through `_collectGroupFeedback`'s unguarded lineage merge
 * (lib/dispatch-store.js:508-510).
 *
 * Harness shape lifted from tests/unit/dispatch-watch-root-item-id.test.js
 * (real DispatchQueueStore over mock collections, driven through the real
 * proxy router) + the lineage seeding idiom from
 * tests/unit/dispatch-store-feedback-group.test.js:64.
 *
 * This file is EVIDENCE for the research pass. It is deliberately NOT proposed
 * as the regression test's final home — the plan/implementation pass owns that.
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
  const server = app.listen(0);
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

// Dispatch + take, emulating dispatch-factory.js's followUpTo inheritance seam
// (the store itself never performs that inheritance).
async function dispatchTaken(store, { prompt, followUpTo, rootItemId, sessionGroupId }) {
  const doc = await store.addItem(URLKEY, { prompt, followUpTo, rootItemId, sessionGroupId });
  await store.takeItem(doc._id, URLKEY, TOKEN);
  return doc;
}

describe('LIN-1480 — :id seam lineage merge has no forward-only guard', () => {

  test('POSITIVE: running follow-up dispatched AFTER predecessor [done] reports terminal', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    // --- Predecessor A: runs and completes.
    const a = await dispatchTaken(store, { prompt: 'original task' });
    await store.addFeedback(a._id, URLKEY,
      { message: '[done] Task completed in 45s', rootItemId: a._id }, TOKEN);

    // Backdate A's whole run by 10 minutes. This is the PRODUCTION shape: the
    // LIN-1004 reply box / autopilot's "follow up only after a flawless
    // session" both dispatch the follow-up long after the predecessor
    // finished. It also puts the delta far outside any clock-jitter range.
    const TEN_MIN = 10 * 60 * 1000;
    const aRaw = await store.historyCollection.findOne({ _id: a._id, urlKey: URLKEY });
    for (const f of aRaw.feedback) f.timestamp = new Date(Date.parse(f.timestamp) - TEN_MIN);
    aRaw.dispatchedAt = new Date(Date.parse(aRaw.dispatchedAt) - TEN_MIN);

    const aDoc = await store.historyCollection.findOne({ _id: a._id, urlKey: URLKEY });
    const aTerminalTs = aDoc.feedback.find(f => f.message.startsWith('[done]')).timestamp;

    await tick(); // ensure B is dispatched strictly AFTER A completed

    // --- Follow-up B: dispatched after A finished, STILL RUNNING.
    const b = await dispatchTaken(store, {
      prompt: 'follow-up task',
      followUpTo: a._id,
      rootItemId: a._id,              // inherited anchor (dispatch-factory.js:216)
      sessionGroupId: aDoc.sessionGroupId
    });
    await store.addFeedback(b._id, URLKEY,
      { message: '[heartbeat] still working, 3 tools used', rootItemId: a._id }, TOKEN);

    const bDoc = await store.historyCollection.findOne({ _id: b._id, urlKey: URLKEY });

    const res = await call(app, `/api/proxy/dispatch/${b._id}?wait=5`);

    console.log('\n===== LIN-1480 POSITIVE CASE =====');
    console.log('A id                :', a._id);
    console.log('B id                :', b._id);
    console.log('A [done] timestamp  :', new Date(aTerminalTs).toISOString());
    console.log('B dispatchedAt      :', new Date(bDoc.dispatchedAt).toISOString());
    console.log('B archived status   :', bDoc.status);
    console.log('B own feedback      :', bDoc.feedback.map(f => f.message));
    console.log('--- VERBATIM RESPONSE BODY ---');
    console.log(JSON.stringify(res.body, null, 2));
    console.log('elapsedMs (wait=5)  :', res.elapsedMs);

    const completedMs = Date.parse(res.body.completedAt);
    const dispatchedMs = Date.parse(res.body.dispatchedAt);
    console.log('completedAt - dispatchedAt (ms):', completedMs - dispatchedMs);
    console.log('==================================\n');

    assert.equal(res.status, 200);
    // Observed behaviour of HEAD — asserting what IS, to pin the defect.
    assert.equal(res.body.status, 'done', 'a still-running row reports done');
    assert.ok(res.body.completedAt, 'inherits a completedAt it never produced');
    assert.ok(completedMs < dispatchedMs, 'completedAt predates its own dispatchedAt');
    assert.equal(res.body.reason, 'terminal', 'long-poll short-circuits for a live session');
    assert.ok(res.elapsedMs < 2000, 'returned immediately rather than holding 5s');
  });

  test('CONTROL 1: follow-up dispatched BEFORE predecessor terminal must NOT trip the anomaly', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    // A runs but has NOT finished yet.
    const a = await dispatchTaken(store, { prompt: 'original task' });
    const aDoc = await store.historyCollection.findOne({ _id: a._id, urlKey: URLKEY });

    // B dispatched WHILE A is still going — legitimate lineage inheritance.
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

    const completedMs = Date.parse(res.body.completedAt);
    const dispatchedMs = Date.parse(res.body.dispatchedAt);

    console.log('\n===== CONTROL 1 (legitimate forward inheritance) =====');
    console.log('B dispatchedAt      :', new Date(bDoc.dispatchedAt).toISOString());
    console.log('returned status     :', res.body.status);
    console.log('returned completedAt:', res.body.completedAt);
    console.log('completedAt - dispatchedAt (ms):', completedMs - dispatchedMs);
    console.log('=====================================================\n');

    assert.equal(res.status, 200);
    // Inheritance still happens (that is LIN-1461's intended behaviour)...
    assert.equal(res.body.status, 'done');
    // ...but the forward-only anomaly must NOT be present here.
    assert.ok(completedMs > dispatchedMs,
      'CONTROL FAILED: the anomaly assertion fires even on a legitimate case');
  });

  test('CONTROL 2: a running row OUTSIDE the lineage stays taken (isolates the join as the cause)', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const a = await dispatchTaken(store, { prompt: 'original task' });
    await store.addFeedback(a._id, URLKEY,
      { message: '[done] Task completed in 45s', rootItemId: a._id }, TOKEN);

    await tick();

    // C is its OWN lineage — no inherited rootItemId.
    const c = await dispatchTaken(store, { prompt: 'unrelated task' });
    await store.addFeedback(c._id, URLKEY,
      { message: '[heartbeat] still working', rootItemId: c._id }, TOKEN);

    const res = await call(app, `/api/proxy/dispatch/${c._id}`);

    console.log('\n===== CONTROL 2 (no shared lineage) =====');
    console.log('returned status     :', res.body.status);
    console.log('returned completedAt:', res.body.completedAt);
    console.log('=========================================\n');

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'taken', 'CONTROL FAILED: reports terminal with no lineage sibling');
    assert.equal(res.body.completedAt, null);
  });
});
