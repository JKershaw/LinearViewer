/**
 * Unit tests for LIN-1343: DispatchQueueStore#addFeedback's atomic append +
 * terminal-wake CAS.
 *
 * `addFeedback` used to read the history doc, rebuild `feedback` in JS, then
 * write the whole array back with an unguarded `$set`. Concurrent callers on
 * the same itemId raced on that stale snapshot: 20 concurrent calls against a
 * real MangoDB store landed 1/20 entries while every caller received
 * `{success:true}`. The fix replaces that with one atomic
 * `findOneAndUpdate({...}, {$push:{feedback:entry}}, {returnDocument:'after'})`,
 * folding the ownership/status/token/workspace checks into the filter, and
 * guards the once-only terminal-wake witness with its own CAS
 * (`updateOne({_id, terminalWakeEnqueued:{$ne:true}}, {$set:{...:true}})`).
 *
 * Three layers, per the plan's test strategy:
 *  - Mock-fidelity: the new operators (`$push`, `findOneAndUpdate`, `$ne`) added
 *    to tests/fixtures/mock-collection.js behave as the real engines do —
 *    otherwise the mock becomes the next false witness.
 *  - Rejection regressions (mock): wrong token / wrong urlKey / non-taken
 *    status / unknown item all return `null` and write nothing — asserted on
 *    the STORED document, never the response, per the ticket's acceptance rule.
 *  - Concurrency pins (REAL MangoDB tmpdir, not the mock): a mock's
 *    findOneAndUpdate is one synchronous JS body, so it is atomic BY
 *    CONSTRUCTION and would pass vacuously. This race spans two awaited
 *    engine ops, so it reproduces on MangoDB without needing real `mongod` or
 *    `MONGODB_TEST_URI` (precedent: LIN-1338's account-store.test.js runs
 *    against a real MangoDB tmpdir instance for the same reason).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

// ── Mock fidelity ────────────────────────────────────────────────────────────

describe('mock-collection: additive LIN-1343 operator support', () => {
  test('updateOne $push appends to an existing array', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a', feedback: [{ message: 'first' }] });

    await collection.updateOne({ _id: 'a' }, { $push: { feedback: { message: 'second' } } });

    const doc = await collection.findOne({ _id: 'a' });
    assert.deepEqual(doc.feedback, [{ message: 'first' }, { message: 'second' }]);
  });

  test('updateOne $push creates the field when absent (no migration needed)', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a' });

    await collection.updateOne({ _id: 'a' }, { $push: { feedback: { message: 'first' } } });

    const doc = await collection.findOne({ _id: 'a' });
    assert.deepEqual(doc.feedback, [{ message: 'first' }]);
  });

  test('findOneAndUpdate returns null on no match, writing nothing', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a', status: 'available' });

    const result = await collection.findOneAndUpdate(
      { _id: 'a', status: 'taken' },
      { $push: { feedback: { message: 'x' } } },
      { returnDocument: 'after' }
    );

    assert.equal(result, null);
    const doc = await collection.findOne({ _id: 'a' });
    assert.ok(!('feedback' in doc), 'no write landed on a non-matching filter');
  });

  test('findOneAndUpdate honours returnDocument: "after" (the default this ticket relies on)', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a', feedback: [] });

    const after = await collection.findOneAndUpdate(
      { _id: 'a' },
      { $push: { feedback: { message: 'x' } } },
      { returnDocument: 'after' }
    );

    assert.deepEqual(after.feedback, [{ message: 'x' }]);
  });

  test('findOneAndUpdate honours returnDocument: "before"', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a', feedback: [{ message: 'existing' }] });

    const before = await collection.findOneAndUpdate(
      { _id: 'a' },
      { $push: { feedback: { message: 'new' } } },
      { returnDocument: 'before' }
    );

    assert.deepEqual(before.feedback, [{ message: 'existing' }], 'reflects the pre-update state');
    const after = await collection.findOne({ _id: 'a' });
    assert.deepEqual(after.feedback, [{ message: 'existing' }, { message: 'new' }], 'the write itself still landed');
  });

  test('$ne matches an absent field and a false field, but not a true field', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'absent' });
    await collection.insertOne({ _id: 'false-val', terminalWakeEnqueued: false });
    await collection.insertOne({ _id: 'true-val', terminalWakeEnqueued: true });

    assert.ok(await collection.findOne({ _id: 'absent', terminalWakeEnqueued: { $ne: true } }));
    assert.ok(await collection.findOne({ _id: 'false-val', terminalWakeEnqueued: { $ne: true } }));
    assert.equal(await collection.findOne({ _id: 'true-val', terminalWakeEnqueued: { $ne: true } }), null);
  });
});

// ── Rejection regressions (mock; assert the stored doc, not the response) ───

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  return new DispatchQueueStore({ collection, historyCollection });
}

async function takenItem(store, overrides = {}) {
  const item = await store.addItem(URL_KEY, {
    prompt: 'do the thing',
    kind: 'implementation',
    issueIdentifier: 'LIN-42',
    ...overrides
  });
  await store.takeItem(item._id, URL_KEY, 'token-a');
  return item;
}

describe('addFeedback rejection regressions (LIN-1343) — null + no write lands', () => {
  test('wrong token returns null and stores nothing', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const res = await store.addFeedback(item._id, URL_KEY, { message: 'x' }, 'wrong-token');

    assert.equal(res, null);
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.ok(!('feedback' in doc), 'the field is never even created on rejection');
  });

  test('wrong urlKey (workspace) returns null and stores nothing', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const res = await store.addFeedback(item._id, 'some-other-workspace', { message: 'x' }, 'token-a');

    assert.equal(res, null);
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.ok(!('feedback' in doc));
  });

  test('non-"taken" status returns null and stores nothing', async () => {
    const store = makeStore();
    // Directly seed an archived-but-not-taken doc (e.g. expired), bypassing
    // addItem/takeItem — mirrors how other suites (kpi-stats.test.js,
    // pipeline-loops.test.js) fabricate history rows with an arbitrary status.
    await store.historyCollection.insertOne({
      _id: 'expired-1',
      urlKey: URL_KEY,
      status: 'expired',
      takenByTokenLabel: null
    });

    const res = await store.addFeedback('expired-1', URL_KEY, { message: 'x' }, 'token-a');

    assert.equal(res, null);
    const doc = store.historyCollection._docs.find(d => d._id === 'expired-1');
    assert.ok(!('feedback' in doc));
  });

  test('unknown item id returns null', async () => {
    const store = makeStore();

    const res = await store.addFeedback('does-not-exist', URL_KEY, { message: 'x' }, 'token-a');

    assert.equal(res, null);
  });
});

// ── Concurrency pins (real MangoDB tmpdir — see file header for why) ────────

describe('addFeedback concurrency (real MangoDB tmpdir, LIN-1343)', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dispatch-store-feedback-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`feedback_${counter++}`);
    return new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });
  }

  test('N concurrent addFeedback calls on one item all persist (stored feedback.length === N)', async () => {
    const store = freshStore();
    const item = await store.addItem(URL_KEY, {
      prompt: 'do the thing',
      kind: 'implementation',
      issueIdentifier: 'LIN-42'
    });
    await store.takeItem(item._id, URL_KEY, 'token-a');

    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.addFeedback(item._id, URL_KEY, { message: `heartbeat ${i}` }, 'token-a')
      )
    );

    // The old bug: every caller reported success while only 1/20 landed. The
    // acceptance witness is the STORED array, never the response.
    assert.ok(results.every(r => r && r.success), 'every concurrent caller still reports success');
    const stored = await store.historyCollection.findOne({ _id: item._id });
    assert.equal(stored.feedback.length, N, `all ${N} concurrent entries must be stored, not just the last writer`);
  });

  test('N concurrent duplicate terminal feedback on one edge enqueue exactly one wake', async () => {
    const store = freshStore();
    const child = await store.addItem(URL_KEY, {
      prompt: 'do the thing',
      kind: 'implementation',
      issueIdentifier: 'LIN-42',
      sessionId: 'parent-S1',
      subscription: 'everything'
    });
    await store.takeItem(child._id, URL_KEY, 'token-a');

    const N = 20;
    await Promise.all(
      Array.from({ length: N }, () =>
        store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a')
      )
    );

    const queued = await store.collection.find({ urlKey: URL_KEY, kind: 'wake' }).toArray();
    assert.equal(queued.length, 1, `exactly one wake must be enqueued for ${N} concurrent duplicate terminals`);

    const edge = await store.historyCollection.findOne({ _id: child._id });
    assert.equal(edge.terminalWakeEnqueued, true, 'the witness is durably set on the edge');
  });
});
