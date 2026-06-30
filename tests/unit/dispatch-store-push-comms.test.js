/**
 * Unit tests for the push-comms dispatch plumbing (LIN-826).
 *
 * `queueIfBusy` and `subscribe` are the two push-based inter-session comms flags:
 * ordinary queue fields the store records and forwards blindly, exactly like
 * `waitForFollowUps`/`force` — Harbour owns no semantics (the runner reads
 * queueIfBusy; Harbour reads subscribe only when building the wake follow-up).
 * These tests pin that each is coerced to a strict boolean, defaults to false,
 * and survives every seam a consumer reads: addItem persistence, the _formatItem
 * seam that poll/take hand to the consumer, and the history records.
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

test('addItem persists queueIfBusy:true and subscribe:true on the stored doc', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'wake me', queueIfBusy: true, subscribe: true });

  assert.equal(doc.queueIfBusy, true);
  assert.equal(doc.subscribe, true);
});

test('addItem defaults both flags to false when absent', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task' });

  assert.equal(doc.queueIfBusy, false);
  assert.equal(doc.subscribe, false);
});

test('addItem coerces truthy non-booleans to a strict boolean (default false)', async () => {
  const store = makeStore();

  // Only an exact `true` opts in; anything else is the default false — keeps the
  // stored fields strict booleans even if an upstream forwards a stray value.
  const truthy = await store.addItem('acme', { prompt: 'x', queueIfBusy: 'yes', subscribe: 1 });
  const falsy = await store.addItem('acme', { prompt: 'y', queueIfBusy: 0, subscribe: '' });

  assert.equal(truthy.queueIfBusy, false);
  assert.equal(truthy.subscribe, false);
  assert.equal(falsy.queueIfBusy, false);
  assert.equal(falsy.subscribe, false);
});

test('the _formatItem seam (poll/listItems) exposes both flags to the consumer', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'wake me', queueIfBusy: true, subscribe: true });

  const items = await store.pollAvailable('acme');

  assert.equal(items.length, 1);
  assert.equal(items[0].queueIfBusy, true);
  assert.equal(items[0].subscribe, true);
});

test('takeItem (the other _formatItem path) hands both flags to the consumer', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'wake me', queueIfBusy: true, subscribe: true });

  const taken = await store.takeItem(created._id, 'acme');

  assert.equal(taken.queueIfBusy, true);
  assert.equal(taken.subscribe, true);
});

test('both flags are carried into history (watch + history list)', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'wake me', queueIfBusy: true, subscribe: true });

  // takeItem archives the doc to history.
  await store.takeItem(created._id, 'acme');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.queueIfBusy, true);
  assert.equal(status.subscribe, true);

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].queueIfBusy, true);
  assert.equal(items[0].subscribe, true);
});

test('a plain dispatch (no flags) surfaces both as false through every seam', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'orchestrate', target: 'cli' });

  const [polled] = await store.pollAvailable('acme');
  assert.equal(polled.queueIfBusy, false);
  assert.equal(polled.subscribe, false);

  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.queueIfBusy, false);
  assert.equal(taken.subscribe, false);

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.queueIfBusy, false);
  assert.equal(status.subscribe, false);
});

test('the two flags are independent (one set does not imply the other)', async () => {
  const store = makeStore();

  const onlyQueue = await store.addItem('acme', { prompt: 'a', queueIfBusy: true });
  const onlySub = await store.addItem('acme', { prompt: 'b', subscribe: true });

  assert.equal(onlyQueue.queueIfBusy, true);
  assert.equal(onlyQueue.subscribe, false);
  assert.equal(onlySub.queueIfBusy, false);
  assert.equal(onlySub.subscribe, true);
});
