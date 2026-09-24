/**
 * Unit tests for DispatchQueueStore#markDecisionAnswered (LIN-1728, decision 1).
 *
 * markDecisionAnswered is deliberately NOT addFeedback: it carries no
 * `status: 'taken'` / `takenByTokenLabel` gate, because a human Save
 * authenticates via session auth, not a runner token, and cannot satisfy
 * that precondition. `'decision-answer'` is kept OUT of FEEDBACK_ENTRY_KINDS
 * so the runner-facing sanitize step (routes/dispatch.js) can never accept
 * it — this store method is the only write path. These tests pin both the
 * write behaviour and that structural asymmetry.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { DispatchQueueStore, FEEDBACK_ENTRY_KINDS } from '../../lib/dispatch-store.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { digestFeedback } from '../../lib/digest-feedback.js';

const URL_KEY = 'acme';

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  return new DispatchQueueStore({ collection, historyCollection });
}

async function takenItem(store, urlKey = URL_KEY) {
  const item = await store.addItem(urlKey, {
    prompt: 'do the thing',
    kind: 'implementation',
    issueIdentifier: 'LIN-42'
  });
  await store.takeItem(item._id, urlKey, 'token-a');
  return item;
}

// LIN-3009: recursively asserts no `undefined` value anywhere in an object —
// the N4 convention pins absence as `null`, never `undefined`.
function assertNoUndefined(value, path = 'digest') {
  if (value === undefined) {
    assert.fail(`${path} must not be undefined (N4: use null for an absent field)`);
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) return;
  for (const [key, child] of Object.entries(value)) {
    assertNoUndefined(child, `${path}.${key}`);
  }
}

describe('markDecisionAnswered (LIN-1728)', () => {
  test('"decision-answer" is NOT a recognized FEEDBACK_ENTRY_KINDS member', () => {
    assert.ok(!FEEDBACK_ENTRY_KINDS.includes('decision-answer'),
      'decision-answer must stay out of the runner-writable kind vocabulary — markDecisionAnswered is the only write path');
  });

  test('succeeds regardless of item status/takenByTokenLabel — no runner-token gate', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    // Simulate the item having moved past 'taken' (e.g. completed) and being
    // owned by a DIFFERENT token label than any caller here supplies.
    // addFeedback's filter (`{ status: 'taken', takenByTokenLabel: tokenLabel }`)
    // would refuse to match this doc; markDecisionAnswered carries no such gate.
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    doc.status = 'completed';
    doc.takenByTokenLabel = 'some-other-token';

    const res = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    assert.ok(res && res.success);

    const updated = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(updated.feedback.length, 1);
    assert.equal(updated.feedback[0].kind, 'decision-answer');
    assert.deepEqual(JSON.parse(updated.feedback[0].message), { decision_id: 'd-1' });
    assert.ok(updated.feedback[0].timestamp instanceof Date);
  });

  test('refuses on a urlKey mismatch (wrong workspace)', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const res = await store.markDecisionAnswered(item._id, 'some-other-workspace', 'd-1');
    assert.strictEqual(res, null);

    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.ok(!doc.feedback || doc.feedback.length === 0, 'no entry written on a workspace mismatch');
  });

  test('refuses on an unknown itemId', async () => {
    const store = makeStore();
    await takenItem(store);

    const res = await store.markDecisionAnswered('not-a-real-id', URL_KEY, 'd-1');
    assert.strictEqual(res, null);
  });

  test('a second stamp appends rather than overwrites — feedback stays append-only', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    const res = await store.markDecisionAnswered(item._id, URL_KEY, 'd-2');
    assert.ok(res && res.success);
    assert.equal(res.feedbackCount, 2);

    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(doc.feedback.length, 2);
    assert.deepEqual(JSON.parse(doc.feedback[0].message), { decision_id: 'd-1' });
    assert.deepEqual(JSON.parse(doc.feedback[1].message), { decision_id: 'd-2' });
  });

  // LIN-2225: a loop-backed ruling has no separate outcome column the way a
  // scan-produced task decision does, so a Rulings-page dismiss reuses this
  // SAME stamp with an explicit outcome — these pin that the two outcomes are
  // both written under the unchanged 'decision-answer' kind (so every existing
  // "hide this from the transcript" reader keeps working unmodified) while
  // staying distinguishable in the stamp's own message.
  test('outcome "dismissed" tags the stamp but keeps the same kind', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const res = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1', 'dismissed');
    assert.ok(res && res.success);

    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(doc.feedback[0].kind, 'decision-answer');
    assert.deepEqual(JSON.parse(doc.feedback[0].message), { decision_id: 'd-1', outcome: 'dismissed' });
  });

  test('omitting outcome (the pre-LIN-2225 call shape) writes the byte-identical {decision_id} message', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(doc.feedback[0].message, '{"decision_id":"d-1"}');
  });

  test('any outcome other than "dismissed" (including "answered") falls back to the plain {decision_id} shape', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1', 'answered');
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.deepEqual(JSON.parse(doc.feedback[0].message), { decision_id: 'd-1' });
  });

  // LIN-2754 Track B: option_id is a second, independent conditional key —
  // present whenever supplied, regardless of what `outcome` resolves to — so
  // it rides the bare {decision_id} shape too (outcome left undefined, the
  // shape Track C's stampDecisionAnswers actually calls this with).
  test('option_id rides the bare {decision_id} shape when supplied with outcome: undefined', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1', undefined, 'opt-1');
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.deepEqual(JSON.parse(doc.feedback[0].message), { decision_id: 'd-1', option_id: 'opt-1' });
  });

  test('option_id is absent from the message when not supplied', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1', 'dismissed');
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.deepEqual(JSON.parse(doc.feedback[0].message), { decision_id: 'd-1', outcome: 'dismissed' });
  });
});

// ── Regression: the runner-facing feedback route must never accept this kind ──

function buildApp({ dispatchQueueStore, dispatchTokenStore }) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore,
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; next(); },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    proxyTokenStore: null
  }));
  return app;
}

async function call(app, method, path, body, bearerToken) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (bearerToken) opts.headers['Authorization'] = `Bearer ${bearerToken}`;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-1728: runner feedback route rejects kind:"decision-answer"', () => {
  test('a runner-token POST with kind:"decision-answer" is silently dropped, not persisted', async () => {
    const collection = createMockCollection();
    const historyCollection = createMockCollection();
    const dispatchQueueStore = new DispatchQueueStore({ collection, historyCollection });
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });

    const { token } = await dispatchTokenStore.createToken(URL_KEY, 'consumer', 'account-A');
    const item = await dispatchQueueStore.addItem(URL_KEY, {
      prompt: 'do the thing',
      kind: 'implementation',
      issueIdentifier: 'LIN-42'
    });
    await dispatchQueueStore.takeItem(item._id, URL_KEY, 'consumer');

    const app = buildApp({ dispatchQueueStore, dispatchTokenStore });
    const res = await call(
      app, 'post', `/api/dispatch/feedback/${item._id}`,
      { message: '{"decision_id":"d-1"}', kind: 'decision-answer' },
      token
    );

    assert.equal(res.status, 200, JSON.stringify(res.body));
    const doc = [...collection._docs, ...historyCollection._docs].find(d => d._id === item._id);
    assert.ok(!('kind' in doc.feedback[0]), 'a runner token must never be able to write a decision-answer stamp via the feedback route');
  });
});

// ── LIN-3009: markDecisionAnswered keeps feedbackVersion/feedbackDigest current ──
//
// Same Phase 1 contract as addFeedback: `$inc: { feedbackVersion: 1 }` in the
// SAME atomic findOneAndUpdate as the feedback $push, then a best-effort
// guarded feedbackDigest persist before `_notifyWriteForDoc`, never rethrown,
// never affecting the return value. Not implemented yet — every test below
// must fail against the current writer for the RIGHT reason.

describe('markDecisionAnswered: feedbackVersion + feedbackDigest happy path (LIN-3009)', () => {
  test('the atomic findOneAndUpdate increments feedbackVersion by exactly 1, leaving feedbackCount (array length) unchanged', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const res = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');

    assert.ok(res && res.success);
    assert.equal(res.feedbackCount, 1, 'feedbackCount is still the raw array length, never the version counter');
    const stored = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(stored.feedbackVersion, 1, 'feedbackVersion must be incremented atomically alongside the append');
  });

  test('a second stamp increments feedbackVersion to 2, independent of feedbackCount growing to 2 as well (never conflated)', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    const res = await store.markDecisionAnswered(item._id, URL_KEY, 'd-2');

    assert.equal(res.feedbackCount, 2);
    const stored = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(stored.feedbackVersion, 2);
  });

  test('the persisted feedbackDigest equals digestFeedback(postWriteDoc) with .version stamped to the post-write feedbackVersion', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');

    const stored = store.historyCollection._docs.find(d => d._id === item._id);
    assert.ok(stored.feedbackDigest, 'feedbackDigest must be persisted on a successful write');
    const expected = digestFeedback({ feedback: stored.feedback, dispatchedAt: stored.dispatchedAt }, { now: Date.now() });
    expected.version = stored.feedbackVersion;
    assert.deepStrictEqual(stored.feedbackDigest, expected);
  });
});

describe('markDecisionAnswered: feedbackDigest is best-effort — injected failures never break the writer (LIN-3009)', () => {
  test('digestFeedback throwing on a malformed pre-existing feedback entry leaves success, feedbackCount and the append unaffected', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    // Seed a malformed pre-existing entry directly (bypassing markDecisionAnswered)
    // — formatFeedbackEntries reads `f.message` on every entry, so a `null`
    // entry throws inside digestFeedback exactly as a corrupted/legacy row
    // would in production. This is a REAL throw path, not a mocked internal.
    const seeded = store.historyCollection._docs.find(d => d._id === item._id);
    seeded.feedback = [null];

    const res = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');

    assert.ok(res && res.success, 'markDecisionAnswered must still report success when digest generation throws');
    assert.equal(res.feedbackCount, 2, 'feedbackCount (array length) is unaffected by a digest failure');
    const stored = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(stored.feedbackVersion, 1, 'feedbackVersion still increments — only the digest write is guarded/best-effort');
    assert.equal(stored.feedback[0], null, 'the append itself must land unaffected by the digest failure');
    assert.equal(stored.feedback[1].kind, 'decision-answer');
    assert.ok(!('feedbackDigest' in stored) || stored.feedbackDigest == null, 'a thrown digest generation must never partially persist a digest');
  });

  test('a rejecting guarded digest update (historyCollection.updateOne throws) leaves success and the append unaffected, and _notifyWriteForDoc still runs', async () => {
    const historyCollection = createMockCollection();
    historyCollection.updateOne = async () => { throw new Error('simulated digest persistence failure'); };
    const collection = createMockCollection();
    let notified = false;
    const store = new DispatchQueueStore({
      collection,
      historyCollection,
      onWrite: () => { notified = true; }
    });
    const item = await store.addItem(URL_KEY, {
      prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42', sessionId: 'S1'
    });
    await store.takeItem(item._id, URL_KEY, 'token-a');

    const res = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');

    assert.ok(res && res.success, 'markDecisionAnswered must still report success when the guarded digest updateOne rejects');
    assert.equal(res.feedbackCount, 1);
    const stored = historyCollection._docs.find(d => d._id === item._id);
    assert.equal(stored.feedbackVersion, 1, 'append + version bump land even though the guarded digest updateOne rejects');

    await new Promise(resolve => setImmediate(resolve));
    assert.ok(notified, '_notifyWriteForDoc must still run after a digest persistence failure (fire-and-forget onWrite hook)');
  });

  test('the feedbackDigest is already persisted by the time _notifyWriteForDoc\'s onWrite hook fires (ordering: digest write before notify)', async () => {
    const collection = createMockCollection();
    const historyCollection = createMockCollection();
    let itemId;
    let sawDigestAtNotifyTime = null;
    const store = new DispatchQueueStore({
      collection,
      historyCollection,
      onWrite: () => {
        const stored = historyCollection._docs.find(d => d._id === itemId);
        sawDigestAtNotifyTime = !!(stored && stored.feedbackDigest);
      }
    });
    const item = await store.addItem(URL_KEY, {
      prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42', sessionId: 'S1'
    });
    itemId = item._id;
    await store.takeItem(item._id, URL_KEY, 'token-a');

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(sawDigestAtNotifyTime, true, 'the digest write must be awaited BEFORE _notifyWriteForDoc is called, so it is always visible by the time the notify hook fires');
  });
});

describe('markDecisionAnswered: feedbackVersion/feedbackDigest under real concurrency (real MangoDB tmpdir, LIN-3009)', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dispatch-store-decision-version-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`decision_version_${counter++}`);
    return new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });
  }

  test('N concurrent markDecisionAnswered calls: feedbackVersion equals N, and the settled feedbackDigest exists and matches the final version', async () => {
    const store = freshStore();
    const item = await store.addItem(URL_KEY, {
      prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42'
    });
    await store.takeItem(item._id, URL_KEY, 'token-a');

    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.markDecisionAnswered(item._id, URL_KEY, `d-${i}`)
      )
    );

    assert.ok(results.every(r => r && r.success), 'every concurrent caller still reports success');
    const stored = await store.historyCollection.findOne({ _id: item._id });
    assert.equal(stored.feedback.length, N, 'the atomic append contract is unchanged');
    assert.equal(stored.feedbackVersion, N, `feedbackVersion must equal the number of concurrent writers (${N}), each incrementing atomically in the same findOneAndUpdate as its append`);
    assert.ok(stored.feedbackDigest, 'a feedbackDigest must exist once all concurrent writers have settled');
    assert.equal(stored.feedbackDigest.version, stored.feedbackVersion, 'the settled digest must match the final feedbackVersion — never a stale, lower one');
    assert.equal(stored.feedbackDigest.count, stored.feedback.length);
  });

  test('a deterministic race: writer B fully lands (append + version bump + its own digest persist) between writer A\'s append and A\'s guarded digest persist — A\'s stale digest must lose the CAS, not overwrite B\'s newer one', async () => {
    const db = client.db(`decision_version_deterministic_race_${counter++}`);
    const collection = db.collection('dispatch-queue');
    const historyCollection = db.collection('dispatch-history');
    const storeA = new DispatchQueueStore({ collection, historyCollection });
    const storeB = new DispatchQueueStore({ collection, historyCollection });

    const item = await storeA.addItem(URL_KEY, {
      prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42'
    });
    await storeA.takeItem(item._id, URL_KEY, 'token-a');

    let intercepted = false;
    const realUpdateOne = historyCollection.updateOne.bind(historyCollection);
    historyCollection.updateOne = async (...args) => {
      if (!intercepted) {
        intercepted = true;
        const resB = await storeB.markDecisionAnswered(item._id, URL_KEY, 'd-B');
        assert.ok(resB && resB.success, 'writer B must land cleanly inside the interception window');
      }
      return realUpdateOne(...args);
    };

    const resA = await storeA.markDecisionAnswered(item._id, URL_KEY, 'd-A');
    assert.ok(resA && resA.success);

    assert.ok(intercepted, 'the interception point (historyCollection.updateOne, writer A\'s guarded digest persist) must actually be reached — otherwise this test cannot prove anything about the race');
    const stored = await historyCollection.findOne({ _id: item._id });
    assert.equal(stored.feedback.length, 2, 'both writers\' entries land — the atomic append contract is unaffected by the race');
    assert.equal(stored.feedbackVersion, 2, 'both atomic increments land');
    assert.ok(stored.feedbackDigest, 'B\'s guarded write (matching the CURRENT version at the time it ran) must have persisted a digest');
    assert.equal(stored.feedbackDigest.version, 2, 'the persisted digest must reflect the CURRENT version — never A\'s stale captured version (1)');
    assert.equal(stored.feedbackDigest.count, 2, 'the persisted digest must reflect BOTH entries — proof A\'s stale, 1-entry digest lost the CAS and did not overwrite B\'s newer one');
  });

  test('a real persistence round trip: no digest field is undefined, and the digest reflects the decision-answer stamp (N4, W1)', async () => {
    const store = freshStore();
    const item = await store.addItem(URL_KEY, {
      prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42'
    });
    await store.takeItem(item._id, URL_KEY, 'token-a');

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');

    // A FRESH read — a new query against the real engine, not the in-memory
    // object findOneAndUpdate handed back — so this actually proves the
    // digest round-trips through storage, not just through memory.
    const stored = await store.historyCollection.findOne({ _id: item._id });
    assert.ok(stored.feedbackDigest, 'feedbackDigest must be persisted and survive a fresh read');
    assert.equal(stored.feedbackDigest.answeredDecisionId, 'd-1', 'the digest must reflect the decision-answer stamp just written');
    assertNoUndefined(stored.feedbackDigest);
  });
});
