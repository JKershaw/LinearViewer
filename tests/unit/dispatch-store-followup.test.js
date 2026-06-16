/**
 * Unit tests for follow-up dispatch plumbing (LIN-415).
 *
 * A follow-up is an ordinary queue item carrying one optional field, `followUpTo`
 * — the original dispatchId whose session the downstream dispatcher should resume.
 * The store records and forwards it blindly; these tests pin that the field
 * survives every seam a consumer reads: addItem persistence, the _formatItem seam
 * that poll/take hand to the consumer, and the history records.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

test('addItem persists followUpTo on the stored doc', async () => {
  const store = makeStore();
  const followUpTo = '11111111-1111-4111-8111-111111111111';

  const doc = await store.addItem('acme', { prompt: 'resume please', followUpTo });

  assert.equal(doc.followUpTo, followUpTo);
});

test('addItem defaults followUpTo to null when absent', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task' });

  assert.equal(doc.followUpTo, null);
});

test('the _formatItem seam (poll/listItems) exposes followUpTo to the consumer', async () => {
  const store = makeStore();
  const followUpTo = '22222222-2222-4222-8222-222222222222';
  await store.addItem('acme', { prompt: 'resume please', followUpTo });

  const items = await store.pollAvailable('acme');

  assert.equal(items.length, 1);
  assert.equal(items[0].followUpTo, followUpTo);
});

test('takeItem (the other _formatItem path) hands followUpTo to the consumer', async () => {
  const store = makeStore();
  const followUpTo = '33333333-3333-4333-8333-333333333333';
  const created = await store.addItem('acme', { prompt: 'resume please', followUpTo });

  const taken = await store.takeItem(created._id, 'acme');

  assert.equal(taken.followUpTo, followUpTo);
});

test('end-to-end manual-review path: a second item references the first by id', async () => {
  const store = makeStore();

  // 1. Dispatch a custom item.
  const original = await store.addItem('acme', { prompt: 'do the thing', target: 'cli' });

  // 2. Dispatch a follow-up whose followUpTo points at the first item's id.
  const followUp = await store.addItem('acme', {
    prompt: 'now confirm CI is green',
    target: 'cli',
    followUpTo: original._id
  });

  assert.equal(followUp.followUpTo, original._id);

  // The consumer sees the linkage when it polls/takes the follow-up.
  const taken = await store.takeItem(followUp._id, 'acme');
  assert.equal(taken.followUpTo, original._id);
});

test('followUpTo is carried into history (watch + history list)', async () => {
  const store = makeStore();
  const followUpTo = '44444444-4444-4444-8444-444444444444';
  const created = await store.addItem('acme', { prompt: 'resume please', followUpTo });

  // takeItem archives the doc to history.
  await store.takeItem(created._id, 'acme');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.followUpTo, followUpTo);

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].followUpTo, followUpTo);
});
