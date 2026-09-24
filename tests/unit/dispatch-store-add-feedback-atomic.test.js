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
 * guards the once-only terminal-wake witness with its own CAS. LIN-1357 re-keyed
 * that witness from a per-edge boolean to a per-(edge, producing item) SET
 * (`updateOne({_id, terminalWakeItems:{$ne:docId}}, {$addToSet:{terminalWakeItems:docId}})`)
 * so a multi-beat stepper's distinct terminal beats sharing one edge each still
 * wake the parent, while the SAME item re-reporting stays suppressed.
 *
 * Three layers, per the plan's test strategy:
 *  - Mock-fidelity: the new operators (`$push`, `$addToSet`, `findOneAndUpdate`,
 *    array-aware `$ne`) added to tests/fixtures/mock-collection.js behave as
 *    the real engines do — otherwise the mock becomes the next false witness.
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
import { digestFeedback } from '../../lib/digest-feedback.js';

const URL_KEY = 'acme';

// LIN-3009: recursively asserts no `undefined` value anywhere in an object —
// the N4 convention pins absence as `null`, never `undefined` (the Mongo
// driver would silently coerce it anyway, but digestFeedback itself must
// already return `null`).
function assertNoUndefined(value, path = 'digest') {
  if (value === undefined) {
    assert.fail(`${path} must not be undefined (N4: use null for an absent field)`);
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) return;
  for (const [key, child] of Object.entries(value)) {
    assertNoUndefined(child, `${path}.${key}`);
  }
}

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
    await collection.insertOne({ _id: 'false-val', someFlag: false });
    await collection.insertOne({ _id: 'true-val', someFlag: true });

    assert.ok(await collection.findOne({ _id: 'absent', someFlag: { $ne: true } }));
    assert.ok(await collection.findOne({ _id: 'false-val', someFlag: { $ne: true } }));
    assert.equal(await collection.findOne({ _id: 'true-val', someFlag: { $ne: true } }), null);
  });

  test('$ne on an array field is membership: matches unless the value is an element (LIN-1357)', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'absent' });
    await collection.insertOne({ _id: 'empty', terminalWakeItems: [] });
    await collection.insertOne({ _id: 'other-member', terminalWakeItems: ['beat-2'] });
    await collection.insertOne({ _id: 'has-member', terminalWakeItems: ['beat-1', 'beat-2'] });

    assert.ok(await collection.findOne({ _id: 'absent', terminalWakeItems: { $ne: 'beat-1' } }), 'absent field matches');
    assert.ok(await collection.findOne({ _id: 'empty', terminalWakeItems: { $ne: 'beat-1' } }), 'empty array matches');
    assert.ok(await collection.findOne({ _id: 'other-member', terminalWakeItems: { $ne: 'beat-1' } }), 'array with a DIFFERENT member matches');
    assert.equal(await collection.findOne({ _id: 'has-member', terminalWakeItems: { $ne: 'beat-1' } }), null, 'array containing the value does not match');
  });

  test('$addToSet adds a new value and is a no-op for an existing one', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a', terminalWakeItems: ['beat-1'] });

    await collection.updateOne({ _id: 'a' }, { $addToSet: { terminalWakeItems: 'beat-2' } });
    assert.deepEqual((await collection.findOne({ _id: 'a' })).terminalWakeItems, ['beat-1', 'beat-2']);

    await collection.updateOne({ _id: 'a' }, { $addToSet: { terminalWakeItems: 'beat-1' } });
    assert.deepEqual((await collection.findOne({ _id: 'a' })).terminalWakeItems, ['beat-1', 'beat-2'], 'a duplicate value is not added again');
  });

  test('$addToSet creates the field when absent (no migration needed)', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a' });

    await collection.updateOne({ _id: 'a' }, { $addToSet: { terminalWakeItems: 'beat-1' } });

    assert.deepEqual((await collection.findOne({ _id: 'a' })).terminalWakeItems, ['beat-1']);
  });

  // LIN-3009: $inc support, added so a production `$inc: { feedbackVersion: 1 }`
  // cannot silently no-op under this mock (it previously had no $inc branch at all).
  test('$inc increments an existing numeric field', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a', feedbackVersion: 3 });

    await collection.updateOne({ _id: 'a' }, { $inc: { feedbackVersion: 1 } });

    assert.equal((await collection.findOne({ _id: 'a' })).feedbackVersion, 4);
  });

  test('$inc creates the field starting from 0 when absent (mirrors Mongo, no migration needed)', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a' });

    await collection.updateOne({ _id: 'a' }, { $inc: { feedbackVersion: 1 } });

    assert.equal((await collection.findOne({ _id: 'a' })).feedbackVersion, 1);
  });

  test('findOneAndUpdate applies $inc alongside $push in the same atomic update, returning the post-increment value', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a', feedback: [] });

    const after = await collection.findOneAndUpdate(
      { _id: 'a' },
      { $push: { feedback: { message: 'x' } }, $inc: { feedbackVersion: 1 } },
      { returnDocument: 'after' }
    );

    assert.deepEqual(after.feedback, [{ message: 'x' }]);
    assert.equal(after.feedbackVersion, 1);
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
    assert.ok((edge.terminalWakeItems || []).includes(child._id), 'the witness set durably records the producing item on the edge');
    assert.equal(edge.terminalWakeItems.length, 1, 'only one entry — the N callers are the SAME producing item, so they CAS-race for one slot');
  });

  test('N concurrent terminals from TWO DISTINCT beat items on one edge each enqueue exactly one wake (LIN-1357)', async () => {
    // The regression this ticket fixes, under real concurrency: a multi-beat
    // stepper's beat 1 and beat 2 are DISTINCT dispatch ids sharing one edge.
    // Each must win its own CAS slot and enqueue its own wake, independent of
    // the other's race.
    const store = freshStore();
    const beat1 = await store.addItem(URL_KEY, {
      prompt: 'stepper beat 1', kind: 'research', issueIdentifier: 'LIN-1357',
      sessionId: 'parent-S1', subscription: 'everything'
    });
    await store.takeItem(beat1._id, URL_KEY, 'token-1');
    const beat2 = await store.addItem(URL_KEY, {
      prompt: 'stepper beat 2', kind: 'research', issueIdentifier: 'LIN-1357',
      followUpTo: beat1._id, sessionId: 'parent-S1', subscription: 'everything', force: true
    });
    await store.takeItem(beat2._id, URL_KEY, 'token-2');

    const N = 10;
    await Promise.all([
      ...Array.from({ length: N }, () =>
        store.addFeedback(beat1._id, URL_KEY, { message: '[done] beat 1 complete' }, 'token-1')),
      ...Array.from({ length: N }, () =>
        store.addFeedback(beat2._id, URL_KEY, { message: '[done] beat 2 complete' }, 'token-2'))
    ]);

    const queued = await store.collection.find({ urlKey: URL_KEY, kind: 'wake' }).toArray();
    assert.equal(queued.length, 2, 'beat 1 and beat 2 each enqueue exactly one wake despite concurrent duplicate terminals');

    const edge = await store.historyCollection.findOne({ _id: beat1._id });
    assert.ok(edge.terminalWakeItems.includes(beat1._id) && edge.terminalWakeItems.includes(beat2._id));
    assert.equal(edge.terminalWakeItems.length, 2, 'exactly the two distinct producing items');
  });
});

// ── LIN-3009: addFeedback keeps feedbackVersion/feedbackDigest current ──────
//
// Phase 1 of LIN-2996 (approved Implementation Plan Revision 5, strategy B+E,
// plan-review a2bc2ab6). addFeedback must `$inc: { feedbackVersion: 1 }` in
// the SAME atomic findOneAndUpdate as the feedback $push (LIN-1343-preserving,
// no read-modify-write), then best-effort persist a materialized
// `feedbackDigest` — its own guarded try/catch, never rethrown, never
// affecting the function's return value, written BEFORE `_notifyWriteForDoc`.
// None of this is implemented yet; every test below is written to fail
// against the current writer for the RIGHT reason (missing feedbackVersion/
// feedbackDigest), not a harness error.

describe('addFeedback: feedbackVersion + feedbackDigest happy path (LIN-3009)', () => {
  test('the atomic findOneAndUpdate increments feedbackVersion by exactly 1, leaving feedbackCount (array length) unchanged', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const res = await store.addFeedback(item._id, URL_KEY, { message: 'hello' }, 'token-a');

    assert.ok(res && res.success);
    assert.equal(res.feedbackCount, 1, 'feedbackCount is still the raw array length, never the version counter');
    const stored = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(stored.feedbackVersion, 1, 'feedbackVersion must be incremented atomically alongside the append');
  });

  test('a second write increments feedbackVersion to 2, independent of feedbackCount growing to 2 as well (never conflated)', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.addFeedback(item._id, URL_KEY, { message: 'one' }, 'token-a');
    const res = await store.addFeedback(item._id, URL_KEY, { message: 'two' }, 'token-a');

    assert.equal(res.feedbackCount, 2);
    const stored = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(stored.feedbackVersion, 2);
  });

  test('the persisted feedbackDigest equals digestFeedback(postWriteDoc) with .version stamped to the post-write feedbackVersion', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.addFeedback(item._id, URL_KEY, { message: '[done] finished the thing' }, 'token-a');

    const stored = store.historyCollection._docs.find(d => d._id === item._id);
    assert.ok(stored.feedbackDigest, 'feedbackDigest must be persisted on a successful write');
    const expected = digestFeedback({ feedback: stored.feedback, dispatchedAt: stored.dispatchedAt }, { now: Date.now() });
    expected.version = stored.feedbackVersion;
    assert.deepStrictEqual(stored.feedbackDigest, expected);
  });

  test('the whole post-write document is passed to digestFeedback (W1) — dispatchedAt drives telemetry.runtime, not just doc.feedback', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    // takenItem/addItem stamps a real dispatchedAt; confirm the digest's runtime
    // actually reflects it (would be null/absent if a bare feedback array were
    // passed instead of the whole doc, per digest-feedback.js's own W1 contract).
    const stored0 = store.historyCollection._docs.find(d => d._id === item._id);
    assert.ok(stored0.dispatchedAt, 'sanity: the item must carry a dispatchedAt for this test to be meaningful');

    await store.addFeedback(item._id, URL_KEY, { message: '[done] finished' }, 'token-a');

    const stored = store.historyCollection._docs.find(d => d._id === item._id);
    assert.ok(stored.feedbackDigest, 'feedbackDigest must be persisted');
    assert.ok(stored.feedbackDigest.telemetry.runtime, 'telemetry.runtime requires dispatchedAt — absent if digestFeedback were fed a bare feedback array instead of the whole doc');
    assert.equal(
      stored.feedbackDigest.telemetry.runtime.dispatchedAt,
      stored0.dispatchedAt.toISOString(),
      'runtime.dispatchedAt must reflect the doc\'s own dispatchedAt, ISO-formatted'
    );
  });
});

describe('addFeedback: feedbackDigest is best-effort — injected failures never break the writer (LIN-3009)', () => {
  test('digestFeedback throwing on a malformed pre-existing feedback entry leaves success, feedbackCount and the append unaffected', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    // Seed a malformed pre-existing entry directly (bypassing addFeedback) —
    // formatFeedbackEntries reads `f.message` on every entry, so a `null`
    // entry throws inside digestFeedback exactly as a corrupted/legacy row
    // would in production. This is a REAL throw path, not a mocked internal.
    const seeded = store.historyCollection._docs.find(d => d._id === item._id);
    seeded.feedback = [null];

    const res = await store.addFeedback(item._id, URL_KEY, { message: 'new entry' }, 'token-a');

    assert.ok(res && res.success, 'addFeedback must still report success when digest generation throws');
    assert.equal(res.feedbackCount, 2, 'feedbackCount (array length) is unaffected by a digest failure');
    const stored = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(stored.feedbackVersion, 1, 'feedbackVersion still increments — only the digest write is guarded/best-effort');
    assert.deepEqual(stored.feedback, [null, { message: 'new entry', url: null, urlLabel: null, timestamp: stored.feedback[1]?.timestamp }], 'the append itself must land unaffected by the digest failure');
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

    const res = await store.addFeedback(item._id, URL_KEY, { message: 'hi' }, 'token-a');

    assert.ok(res && res.success, 'addFeedback must still report success when the guarded digest updateOne rejects');
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

    await store.addFeedback(item._id, URL_KEY, { message: '[done] finished' }, 'token-a');
    // Flush the microtask queue so the onWrite hook (scheduled via
    // Promise.resolve().then(...) inside _notifyWrite) has actually run.
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(sawDigestAtNotifyTime, true, 'the digest write must be awaited BEFORE _notifyWriteForDoc is called, so it is always visible by the time the notify hook fires');
  });
});

describe('addFeedback: feedbackVersion/feedbackDigest under real concurrency (real MangoDB tmpdir, LIN-3009)', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dispatch-store-feedback-version-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`feedback_version_${counter++}`);
    return new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });
  }

  test('N concurrent addFeedback calls: feedbackVersion equals N, and the settled feedbackDigest exists and matches the final version', async () => {
    const store = freshStore();
    const item = await store.addItem(URL_KEY, {
      prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42'
    });
    await store.takeItem(item._id, URL_KEY, 'token-a');

    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.addFeedback(item._id, URL_KEY, { message: `heartbeat ${i}` }, 'token-a')
      )
    );

    assert.ok(results.every(r => r && r.success), 'every concurrent caller still reports success');
    const stored = await store.historyCollection.findOne({ _id: item._id });
    assert.equal(stored.feedback.length, N, 'the atomic append contract (LIN-1343) is unchanged');
    assert.equal(stored.feedbackVersion, N, `feedbackVersion must equal the number of concurrent writers (${N}), each incrementing atomically in the same findOneAndUpdate as its append`);
    // Once all N writers have settled, exactly one of them — whichever ran
    // its guarded digest $set while its own captured version still matched
    // the (by-then-final) stored version — must have won and persisted. A
    // missing digest here would mean every single writer lost its CAS, which
    // is not a real possibility once the last writer's append lands (its own
    // captured version IS the final version at that instant).
    assert.ok(stored.feedbackDigest, 'a feedbackDigest must exist once all concurrent writers have settled');
    assert.equal(stored.feedbackDigest.version, stored.feedbackVersion, 'the settled digest must match the final feedbackVersion — never a stale, lower one');
    assert.equal(stored.feedbackDigest.count, stored.feedback.length);
  });

  test('a deterministic race: writer B fully lands (append + version bump + its own digest persist) between writer A\'s append and A\'s guarded digest persist — A\'s stale digest must lose the CAS, not overwrite B\'s newer one', async () => {
    const db = client.db(`feedback_version_deterministic_race_${counter++}`);
    const collection = db.collection('dispatch-queue');
    const historyCollection = db.collection('dispatch-history');
    // storeA writes through the INTERCEPTED collection; storeB shares the
    // exact same underlying real collections, representing a fully
    // independent concurrent writer. Test seam only — no production hooks —
    // wrapping the collection dependency the store already accepts via its
    // own constructor injection point.
    const storeA = new DispatchQueueStore({ collection, historyCollection });
    const storeB = new DispatchQueueStore({ collection, historyCollection });

    const item = await storeA.addItem(URL_KEY, {
      prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42'
    });
    await storeA.takeItem(item._id, URL_KEY, 'token-a');

    // Intercept the FIRST call to historyCollection.updateOne (writer A's own
    // guarded digest persist, once implemented) and run writer B's ENTIRE
    // addFeedback — append, version bump, and B's own digest persist — to
    // completion before letting A's (now-stale) update proceed. B's own
    // digest updateOne call passes straight through (the flag is already
    // set), so this does not recurse.
    let intercepted = false;
    const realUpdateOne = historyCollection.updateOne.bind(historyCollection);
    historyCollection.updateOne = async (...args) => {
      if (!intercepted) {
        intercepted = true;
        const resB = await storeB.addFeedback(item._id, URL_KEY, { message: 'writer B lands first' }, 'token-a');
        assert.ok(resB && resB.success, 'writer B must land cleanly inside the interception window');
      }
      return realUpdateOne(...args);
    };

    const resA = await storeA.addFeedback(item._id, URL_KEY, { message: 'writer A (stale by the time its digest write runs)' }, 'token-a');
    assert.ok(resA && resA.success);

    assert.ok(intercepted, 'the interception point (historyCollection.updateOne, writer A\'s guarded digest persist) must actually be reached — otherwise this test cannot prove anything about the race');
    const stored = await historyCollection.findOne({ _id: item._id });
    assert.equal(stored.feedback.length, 2, 'both writers\' entries land — the atomic append contract is unaffected by the race');
    assert.equal(stored.feedbackVersion, 2, 'both atomic increments land');
    assert.ok(stored.feedbackDigest, 'B\'s guarded write (matching the CURRENT version at the time it ran) must have persisted a digest');
    assert.equal(stored.feedbackDigest.version, 2, 'the persisted digest must reflect the CURRENT version — never A\'s stale captured version (1)');
    assert.equal(stored.feedbackDigest.count, 2, 'the persisted digest must reflect BOTH entries — proof A\'s stale, 1-entry digest lost the CAS and did not overwrite B\'s newer one');
  });

  test('a real persistence round trip: loop-facing timestamps stay ISO strings, kpi* timestamps stay Date, and no digest field is undefined (N4, W1)', async () => {
    const store = freshStore();
    const item = await store.addItem(URL_KEY, {
      prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42'
    });
    await store.takeItem(item._id, URL_KEY, 'token-a');

    await store.addFeedback(item._id, URL_KEY, { message: '[done] finished the thing' }, 'token-a');

    // A FRESH read — a new query against the real engine, not the in-memory
    // object findOneAndUpdate handed back — so this actually proves the
    // digest round-trips through storage, not just through memory.
    const stored = await store.historyCollection.findOne({ _id: item._id });
    assert.ok(stored.feedbackDigest, 'feedbackDigest must be persisted and survive a fresh read');
    assert.equal(typeof stored.feedbackDigest.terminal.entry.timestamp, 'string', 'loop-facing terminal.entry.timestamp must round-trip as an ISO string (never a raw Date) — the W1 contract');
    assert.ok(stored.feedbackDigest.kpiTerminalEntry.timestamp instanceof Date, 'kpiTerminalEntry.timestamp must round-trip as a raw Date — the V3 kpi* contract, Date type preserved through Mongo');
    assertNoUndefined(stored.feedbackDigest);
  });
});
