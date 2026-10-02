/**
 * Unit tests for lib/funnel-event-store.js (LIN-2952).
 *
 * Run with: node --test tests/unit/funnel-event-store.test.js
 *
 * Covers the append-only record contract and the first-per-account read on a
 * real MangoDB engine: the frozen vocabulary, server-side time stamping,
 * vocabulary rejection with no write, non-throwing writes, surfaced read
 * failures, and the
 * per-step / per-group / windowed first-event semantics. Holds identifiers and
 * app-defined labels only.
 */
import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert';
import {
  FunnelEventStore, FUNNEL_STEPS, INSTRUMENTED_STEPS, validateFunnelEvent
} from '../../lib/funnel-event-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const EVENT = { accountId: 'acct-1', urlKey: 'ws', issueId: 'uuid-1', issueIdentifier: 'LIN-1', step: 'merge-clicked' };

async function recordInOrder(store, events) {
  for (const event of events) {
    await store.record(event);
    await new Promise(resolve => setTimeout(resolve, 3));
  }
}

const harness = createMangoTmpdir('lin-2952-funnel-');
before(() => harness.connect());
after(() => harness.close());

describe('vocabulary', () => {
  test('is frozen, and merge-clicked is the one step — not yet instrumented', () => {
    assert.deepStrictEqual([...FUNNEL_STEPS], ['merge-clicked']);
    assert.deepStrictEqual([...INSTRUMENTED_STEPS], []);
    assert.ok(Object.isFrozen(FUNNEL_STEPS) && Object.isFrozen(INSTRUMENTED_STEPS));
  });

  test('validateFunnelEvent accepts a valid event and names every missing/invalid field', () => {
    assert.strictEqual(validateFunnelEvent(EVENT), null);
    assert.strictEqual(validateFunnelEvent({ ...EVENT, issueId: null, issueIdentifier: null }), null);
    assert.strictEqual(validateFunnelEvent({ ...EVENT, accountId: undefined }), 'accountId is required');
    assert.strictEqual(validateFunnelEvent({ ...EVENT, urlKey: '' }), 'urlKey is required');
    assert.strictEqual(validateFunnelEvent({ ...EVENT, step: 'login' }), `step must be one of ${FUNNEL_STEPS.join(', ')}`);
    assert.strictEqual(validateFunnelEvent({ ...EVENT, issueId: 42 }), 'issueId must be a string');
    assert.strictEqual(validateFunnelEvent({ ...EVENT, issueIdentifier: 42 }), 'issueIdentifier must be a string');
  });
});

describe('FunnelEventStore.record', () => {
  let store;
  let raw;

  beforeEach(() => {
    raw = harness.freshDb().collection('funnel-events');
    store = new FunnelEventStore({ collection: raw });
  });

  test('stamps the time server-side, returns the doc, and persists exactly the app-defined fields', async () => {
    const before = Date.now();
    const doc = await store.record(EVENT);
    assert.ok(doc?._id);
    assert.ok(doc.at instanceof Date);
    assert.ok(doc.at.getTime() >= before);
    assert.deepStrictEqual(
      { accountId: doc.accountId, urlKey: doc.urlKey, issueId: doc.issueId, issueIdentifier: doc.issueIdentifier, step: doc.step },
      { accountId: 'acct-1', urlKey: 'ws', issueId: 'uuid-1', issueIdentifier: 'LIN-1', step: 'merge-clicked' }
    );
    const persisted = await raw.find({}).toArray();
    assert.strictEqual(persisted.length, 1);
    assert.strictEqual(persisted[0]._id, doc._id);
    assert.strictEqual(persisted[0].step, 'merge-clicked');
  });

  test('defaults optional identifiers to null and rejects an unknown step with no write', async () => {
    const doc = await store.record({ accountId: 'acct-1', urlKey: 'ws', step: 'merge-clicked' });
    assert.strictEqual(doc.issueId, null);
    assert.strictEqual(doc.issueIdentifier, null);

    assert.strictEqual(await store.record({ ...EVENT, step: 'not-a-step' }), null);
    assert.strictEqual((await raw.find({}).toArray()).length, 1, 'an invalid event writes nothing');
  });

  test('with no collection returns the doc unpersisted (never throws)', async () => {
    const orphan = new FunnelEventStore({});
    const doc = await orphan.record(EVENT);
    assert.ok(doc?._id);
    return assert.ok(doc.at instanceof Date);
  });

  test('a failing collection never throws: the doc is still returned', async () => {
    const failing = new FunnelEventStore({ collection: { insertOne: async () => { throw new Error('db down'); } } });
    const doc = await failing.record(EVENT);
    assert.ok(doc?._id);
  });
});

describe('FunnelEventStore.firstPerAccount', () => {
  let store;

  beforeEach(() => {
    store = new FunnelEventStore({ collection: harness.freshDb().collection('funnel-events') });
  });

  test('returns the earliest event per account, oldest first, and no account twice', async () => {
    const firstB = await store.record({ ...EVENT, accountId: 'acct-b' });
    await new Promise(resolve => setTimeout(resolve, 3));
    const firstA = await store.record({ ...EVENT, accountId: 'acct-a' });
    await new Promise(resolve => setTimeout(resolve, 3));
    await store.record({ ...EVENT, accountId: 'acct-b' });
    await store.record({ ...EVENT, accountId: 'acct-a' });

    const rows = await store.firstPerAccount({ step: 'merge-clicked' });
    assert.deepStrictEqual(rows.map(r => r.accountId), ['acct-b', 'acct-a'], 'oldest first, one row per account');
    assert.strictEqual(rows[0].at, firstB.at.toISOString(), 'the FIRST event per account, not the latest');
    assert.strictEqual(rows[1].at, firstA.at.toISOString());
    for (const row of rows) {
      assert.deepStrictEqual(Object.keys(row).sort(), ['accountId', 'at', 'step']);
      assert.equal(row.step, 'merge-clicked');
    }
  });

  test('scopes to an account group; an empty group or unknown step reads nothing', async () => {
    await recordInOrder(store, [
      { ...EVENT, accountId: 'in-group' },
      { ...EVENT, accountId: 'stranger' },
    ]);
    const rows = await store.firstPerAccount({ accountIds: ['in-group'], step: 'merge-clicked' });
    assert.deepStrictEqual(rows.map(r => r.accountId), ['in-group']);
    assert.deepStrictEqual(await store.firstPerAccount({ accountIds: [], step: 'merge-clicked' }), []);
    assert.deepStrictEqual(await store.firstPerAccount({ step: 'login' }), []);
  });

  test('filters by step: a foreign step written straight to the collection is not returned', async () => {
    await store.collection.insertOne({ _id: 'foreign', accountId: 'acct-x', urlKey: 'ws', step: 'login', at: new Date() });
    await store.record({ ...EVENT, accountId: 'acct-y' });
    assert.deepStrictEqual(
      (await store.firstPerAccount({ step: 'merge-clicked' })).map(r => r.accountId),
      ['acct-y']
    );
  });

  test('since bounds presence in the window, not the first-ever event', async () => {
    await recordInOrder(store, [
      { ...EVENT, accountId: 'acct-old' },
    ]);
    const cutoff = new Date();
    await new Promise(resolve => setTimeout(resolve, 3));
    await recordInOrder(store, [
      { ...EVENT, accountId: 'acct-old' },
      { ...EVENT, accountId: 'acct-new' },
    ]);
    const rows = await store.firstPerAccount({ step: 'merge-clicked', since: cutoff });
    assert.deepStrictEqual(rows.map(r => r.accountId), ['acct-old', 'acct-new']);
    // The account's earliest in-window event is returned (not a pre-window time).
    assert.ok(new Date(rows[0].at).getTime() >= cutoff.getTime(), 'the returned time is the in-window event');
  });

  test('a failing collection surfaces the read failure (rejects), never a false []', async () => {
    const failing = new FunnelEventStore({ collection: { find: () => { throw new Error('db down'); } } });
    await assert.rejects(failing.firstPerAccount({ step: 'merge-clicked' }), /db down/);
  });
});
