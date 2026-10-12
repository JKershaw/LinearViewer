/**
 * Unit tests for DispatchQueueStore.countPilotEligible (LIN-3200 P4).
 *
 * The count is the ordinal read behind the file-pointer arm rule. The
 * LOAD-BEARING property is the READ ORDER: queue then history, sequentially —
 * NOT `Promise.all` (the plan's member M3/1a). A row missed by the count can
 * flip the parity of one dispatch, so the order test below is the acceptance
 * witness: it fails under history-first and under simultaneous reads.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const harness = createMangoTmpdir('lin-3526-pilot-count-');
before(() => harness.connect());
after(() => harness.close());

function makeStore() {
  const db = harness.freshDb();
  return new DispatchQueueStore({
    collection: db.collection('dispatch-queue'),
    historyCollection: db.collection('dispatch-history')
  });
}

function eligible(extra = {}) {
  return { prompt: 'work', kind: 'implementation', issueIdentifier: 'LIN-3000', ...extra };
}

describe('countPilotEligible — predicate', () => {
  test('counts implementation rows across queue and history', async () => {
    const store = makeStore();
    const a = await store.addItem('acme', eligible());
    const b = await store.addItem('acme', eligible({ issueIdentifier: 'LIN-3001' }));
    await store.addItem('acme', eligible({ issueIdentifier: 'LIN-3002' }));
    await store.takeItem(b._id, 'acme'); // archive one to history
    assert.equal(await store.countPilotEligible('acme'), 3);
    assert.ok(a._id);
  });

  test('excludes each ineligible clause: review kind, follow-up, abort, no issue', async () => {
    const store = makeStore();
    await store.addItem('acme', eligible()); // counted
    await store.addItem('acme', { prompt: 'x', kind: 'review', issueIdentifier: 'LIN-1' });
    await store.addItem('acme', { prompt: 'x', kind: 'implementation', issueIdentifier: 'LIN-1', followUpTo: 'p' });
    await store.addItem('acme', { prompt: 'x', kind: 'implementation', issueIdentifier: 'LIN-1', abort: true });
    await store.addItem('acme', { prompt: 'x', kind: 'implementation', issueIdentifier: null });
    assert.equal(await store.countPilotEligible('acme'), 1);
  });

  test('de-dupes a row present in BOTH collections', async () => {
    const store = makeStore();
    const doc = {
      _id: 'dup-1', urlKey: 'acme', kind: 'implementation', issueIdentifier: 'LIN-9',
      followUpTo: null, abort: false, dispatchedAt: new Date()
    };
    await store.collection.insertOne(doc);
    await store.historyCollection.insertOne(doc);
    assert.equal(await store.countPilotEligible('acme'), 1);
  });

  test('scopes to urlKey', async () => {
    const store = makeStore();
    await store.addItem('acme', eligible());
    await store.addItem('other', eligible());
    assert.equal(await store.countPilotEligible('acme'), 1);
  });

  test('empty urlKey ⇒ null', async () => {
    const store = makeStore();
    assert.equal(await store.countPilotEligible(''), null);
  });
});

describe('countPilotEligible — read order (M3 acceptance witness)', () => {
  test('queue is read, fully, BEFORE history is queried; a mover row is counted once', async () => {
    // A row that is in the queue at the first read and in history by the second
    // (an external take between them). Queue-then-history sees it in the first
    // read and de-dupes the second — count 1. History-first sees it in neither
    // — count 0. Promise.all would query history before the queue read resolves.
    const row = {
      _id: 'mover-1', urlKey: 'acme', kind: 'implementation', issueIdentifier: 'LIN-7',
      followUpTo: null, abort: false, dispatchedAt: new Date()
    };
    // R4c: both collections are REAL. The row starts in the real queue; the race
    // hook does the external take for real (deleteOne from the queue, insertOne
    // into history) right after the queue's first read resolves its rows.
    const db = harness.freshDb();
    const realQueue = db.collection('dispatch-queue');
    const realHistory = db.collection('dispatch-history');
    await realQueue.insertOne(row);

    let moved = false;
    let queueSettled = false;
    let historyQueryRaisedBeforeQueueSettled = false;

    const queue = {
      find(query, opts) {
        const cursor = realQueue.find(query, opts);
        return {
          async toArray() {
            const snapshot = await cursor.toArray();
            if (!moved) {
              moved = true;
              await realQueue.deleteOne({ _id: row._id });
              await realHistory.insertOne(row);
            }
            queueSettled = true;
            return snapshot;
          }
        };
      }
    };
    const history = {
      find(query, opts) {
        historyQueryRaisedBeforeQueueSettled = queueSettled ? historyQueryRaisedBeforeQueueSettled : true;
        return realHistory.find(query, opts);
      }
    };
    const store = new DispatchQueueStore({ collection: queue, historyCollection: history });

    assert.equal(await store.countPilotEligible('acme'), 1);
    assert.equal(
      historyQueryRaisedBeforeQueueSettled,
      false,
      'history must be queried only after the queue read has resolved (fails under Promise.all)'
    );
  });

  test('residual pin: a row absent from both reads makes the count one low (R2/R3)', async () => {
    const store = makeStore();
    await store.addItem('acme', eligible({ issueIdentifier: 'LIN-A' }));
    const lost = await store.addItem('acme', eligible({ issueIdentifier: 'LIN-B' }));
    assert.equal(await store.countPilotEligible('acme'), 2);
    // A swallowed archive failure removes the row from both collections for
    // good; nothing in the rows shows it. This documents the residual so a
    // future change cannot hide it.
    await store.collection.deleteOne({ _id: lost._id });
    assert.equal(await store.countPilotEligible('acme'), 1);
  });
});
