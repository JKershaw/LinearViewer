/**
 * LIN-3238 — DispatchQueueStore.countFreshRunsSince, the read behind the
 * free-tier run limit. Q1 defines a "run": one fresh dispatch row —
 * `followUpTo == null`, `abort != true`, `cascade != true`, `sessionId == null`,
 * `kind != 'wake'`; any other kind/target counts.
 *
 * The read runs on a REAL MangoDB tmpdir (not the inline doubles) so the
 * `$in`/`$ne`/`$gte` predicate and the queue→history read are exercised exactly
 * as the dev/prod backend runs them; a recording wrapper then pins that the
 * whole predicate is pushed into the find (never `countDocuments`).
 *
 * The archive-hop test is the LIN-3130 S2a.2 / LIN-1698 class guard: `_archiveItem`
 * keeps every predicate field, so a fresh row counts once before and after the
 * hop and each excluded variant stays excluded. A dropped field would flip a
 * continuation into the count.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMangoTmpdir, recordingCollection } from '../fixtures/mango-tmpdir.js';

const SINCE = new Date('2026-10-02T00:00:00.000Z');

function row(id, extra = {}) {
  return {
    _id: id,
    urlKey: 'acme',
    prompt: 'work',
    kind: 'implementation',
    issueIdentifier: 'LIN-1',
    dispatchedAt: new Date('2026-10-02T12:00:00.000Z'),
    dispatchedBy: 'acct-1',
    followUpTo: null,
    abort: false,
    cascade: false,
    sessionId: null,
    ...extra
  };
}

describe('countFreshRunsSince — predicate (LIN-3238 Q1)', () => {
  const harness = createMangoTmpdir('lin-3238-run-count-');
  before(() => harness.connect());
  after(() => harness.close());

  let store;
  beforeEach(() => {
    const db = harness.freshDb();
    store = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });
  });

  test('counts a fresh row; excludes every continuation shape', async () => {
    for (const d of [
      row('fresh'),
      row('followup', { followUpTo: 'parent' }),
      row('abort', { abort: true }),
      row('cascade', { cascade: true }),
      row('session', { sessionId: 'run-1' }),
      row('wake', { kind: 'wake' })
    ]) {
      await store.collection.insertOne(d);
    }
    assert.equal(await store.countFreshRunsSince(['acct-1'], SINCE), 1);
  });

  test('any other kind or target counts as a run', async () => {
    for (const d of [
      row('k-plan', { kind: 'plan' }),
      row('k-custom', { kind: 'custom' }),
      row('t-web', { target: 'web' }),
      row('t-dash', { target: 'dash' })
    ]) {
      await store.collection.insertOne(d);
    }
    assert.equal(await store.countFreshRunsSince(['acct-1'], SINCE), 4);
  });

  test('the UTC day boundary is inclusive at `since` and excludes just-before', async () => {
    await store.collection.insertOne(row('at-midnight', { dispatchedAt: SINCE }));
    await store.collection.insertOne(row('just-before', { dispatchedAt: new Date(SINCE.getTime() - 1) }));
    assert.equal(await store.countFreshRunsSince(['acct-1'], SINCE), 1);
  });

  test('spans the merge group and counts no one else', async () => {
    await store.collection.insertOne(row('a', { dispatchedBy: 'a' }));
    await store.collection.insertOne(row('b', { dispatchedBy: 'b' }));
    await store.collection.insertOne(row('c', { dispatchedBy: 'c' }));
    assert.equal(await store.countFreshRunsSince(['a', 'b'], SINCE), 2);
  });

  test('null dispatchedBy is not attributable, so never counted (LIN-1750)', async () => {
    // Attribution is server-stamped (Q2). A null `dispatchedBy` row is a wake or an
    // ownerless legacy token — attributable to nobody, so it must never be charged
    // to a caller. The open residue of LIN-1448 (Done) is LIN-1750 (delete the
    // ownerless compat branch). This pin names LIN-1750 deliberately; do not
    // rename it to LIN-1448.
    await store.collection.insertOne(row('ownerless', { dispatchedBy: null }));
    assert.equal(await store.countFreshRunsSince(['acct-1'], SINCE), 0);
    // An all-null group is not a count at all — the caller must fail closed.
    assert.equal(await store.countFreshRunsSince([null], SINCE), null);
  });

  test('de-dupes a row present in BOTH collections mid-hop', async () => {
    const doc = row('dup-1');
    await store.collection.insertOne(doc);
    await store.historyCollection.insertOne(doc);
    assert.equal(await store.countFreshRunsSince(['acct-1'], SINCE), 1);
  });

  test('a failing read returns null (never a count of 0)', async () => {
    const broken = new DispatchQueueStore({
      collection: { find() { throw new Error('db down'); } },
      historyCollection: { find() { return { toArray: async () => [] }; } }
    });
    assert.equal(await broken.countFreshRunsSince(['acct-1'], SINCE), null);
  });

  test('no usable account list or no since returns null', async () => {
    assert.equal(await store.countFreshRunsSince([], SINCE), null);
    assert.equal(await store.countFreshRunsSince(null, SINCE), null);
    assert.equal(await store.countFreshRunsSince(['acct-1'], null), null);
  });

  test('pushes the whole predicate into the find and never calls countDocuments', async () => {
    const db = harness.freshDb();
    const queue = recordingCollection(db.collection('dispatch-queue'));
    const history = recordingCollection(db.collection('dispatch-history'));
    const recordedStore = new DispatchQueueStore({ collection: queue, historyCollection: history });
    await recordedStore.countFreshRunsSince(['a', 'b'], SINCE);

    for (const rec of [queue.__record, history.__record]) {
      assert.equal(rec.countDocuments.length, 0, 'countFreshRunsSince must not use countDocuments');
      assert.equal(rec.finds.length, 1, 'exactly one find per collection');
      assert.deepEqual(rec.finds[0].query, {
        dispatchedBy: { $in: ['a', 'b'] },
        dispatchedAt: { $gte: SINCE },
        followUpTo: null,
        abort: { $ne: true },
        cascade: { $ne: true },
        sessionId: null,
        kind: { $ne: 'wake' }
      });
    }
  });
});

describe('countFreshRunsSince — archive hop', () => {
  const harness = createMangoTmpdir('lin-3238-run-hop-');
  before(() => harness.connect());
  after(() => harness.close());

  let store;
  beforeEach(() => {
    const db = harness.freshDb();
    store = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });
  });

  test('a fresh row counts once before and after _archiveItem; excluded variants stay excluded', async () => {
    const since = new Date(Date.now() - 60 * 1000);
    const fresh = await store.addItem('acme', {
      prompt: 'work', kind: 'implementation', issueIdentifier: 'LIN-1', dispatchedBy: 'acct-1'
    });
    const variants = [
      await store.addItem('acme', { prompt: 'x', kind: 'implementation', issueIdentifier: 'LIN-1', dispatchedBy: 'acct-1', followUpTo: 'p' }),
      await store.addItem('acme', { prompt: 'x', kind: 'implementation', issueIdentifier: 'LIN-1', dispatchedBy: 'acct-1', abort: true }),
      await store.addItem('acme', { prompt: 'x', kind: 'implementation', issueIdentifier: 'LIN-1', dispatchedBy: 'acct-1', cascade: true }),
      await store.addItem('acme', { prompt: 'x', kind: 'implementation', issueIdentifier: 'LIN-1', dispatchedBy: 'acct-1', sessionId: 'run-1' }),
      await store.addItem('acme', { prompt: 'x', kind: 'wake', issueIdentifier: 'LIN-1', dispatchedBy: 'acct-1' })
    ];

    assert.equal(await store.countFreshRunsSince(['acct-1'], since), 1, 'fresh row counts in the queue');

    // Move every row across the archive hop exactly as takeItem does.
    for (const item of [fresh, ...variants]) {
      const taken = await store.takeItem(item._id, 'acme');
      assert.ok(taken, `row ${item._id} should archive`);
    }

    assert.equal(await store.countFreshRunsSince(['acct-1'], since), 1, 'fresh row still counts in history; variants stay excluded');
  });
});
