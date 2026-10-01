/**
 * Unit tests for DispatchQueueStore.countPilotEligible (LIN-3200 P4).
 *
 * The count is the ordinal read behind the file-pointer arm rule. The
 * LOAD-BEARING property is the READ ORDER: queue then history, sequentially —
 * NOT `Promise.all` (the plan's member M3/1a). A row missed by the count can
 * flip the parity of one dispatch, so the order test below is the acceptance
 * witness: it fails under history-first and under simultaneous reads.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
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
    let phase = 0;
    let queueSettled = false;
    let historyQueryRaisedBeforeQueueSettled = false;

    const queue = {
      find(query, opts) {
        return {
          async toArray() {
            const snapshot = phase === 0 ? [row] : [];
            phase = 1;
            queueSettled = true;
            return snapshot;
          }
        };
      }
    };
    const history = {
      find(query, opts) {
        historyQueryRaisedBeforeQueueSettled = queueSettled ? historyQueryRaisedBeforeQueueSettled : true;
        return {
          async toArray() {
            return phase === 0 ? [] : [row];
          }
        };
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
