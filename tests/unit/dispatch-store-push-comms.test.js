/**
 * Unit tests for the push-comms dispatch plumbing (LIN-826 / LIN-900 §6).
 *
 * `queueIfBusy` (boolean) and `subscription` (enum 'everything'|'terminal-only')
 * are the push-based inter-session comms fields the store records and forwards
 * blindly, exactly like `waitForFollowUps`/`force` — Harbour owns no semantics (the
 * runner reads queueIfBusy; Harbour reads subscription only when building the wake
 * follow-up). These tests pin that queueIfBusy stays a strict boolean, that
 * `subscription` is stored/forwarded as its declared enum string and defaults to
 * `terminal-only` for an undeclared edge (§6), and that both survive every seam a
 * consumer reads: addItem persistence, the _formatItem seam poll/take hand to the
 * consumer, and the history records.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { DEFAULT_SUBSCRIPTION } from '../../lib/dispatch-wake.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

test('addItem persists queueIfBusy:true and the declared subscription on the stored doc', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'wake me', queueIfBusy: true, subscription: 'everything' });

  assert.equal(doc.queueIfBusy, true);
  assert.equal(doc.subscription, 'everything');
});

test('addItem defaults queueIfBusy false and subscription to terminal-only when absent (§6)', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task' });

  assert.equal(doc.queueIfBusy, false);
  assert.equal(doc.subscription, 'terminal-only');
  assert.equal(doc.subscription, DEFAULT_SUBSCRIPTION, 'the undeclared-edge default is the single source of truth');
});

test('addItem coerces queueIfBusy to a strict boolean and forwards the declared subscription verbatim', async () => {
  const store = makeStore();

  // queueIfBusy: only an exact `true` opts in. subscription: the store forwards
  // the declared enum blindly (route-layer validation is the gate) and falls back
  // to terminal-only when omitted.
  const truthy = await store.addItem('acme', { prompt: 'x', queueIfBusy: 'yes', subscription: 'terminal-only' });
  const falsy = await store.addItem('acme', { prompt: 'y', queueIfBusy: 0 });

  assert.equal(truthy.queueIfBusy, false);
  assert.equal(truthy.subscription, 'terminal-only');
  assert.equal(falsy.queueIfBusy, false);
  assert.equal(falsy.subscription, 'terminal-only', 'undeclared → terminal-only');
});

test('the _formatItem seam (poll/listItems) exposes both fields to the consumer', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'wake me', queueIfBusy: true, subscription: 'everything' });

  const items = await store.pollAvailable('acme');

  assert.equal(items.length, 1);
  assert.equal(items[0].queueIfBusy, true);
  assert.equal(items[0].subscription, 'everything');
});

test('takeItem (the other _formatItem path) hands both fields to the consumer', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'wake me', queueIfBusy: true, subscription: 'everything' });

  const taken = await store.takeItem(created._id, 'acme');

  assert.equal(taken.queueIfBusy, true);
  assert.equal(taken.subscription, 'everything');
});

test('both fields are carried into history (watch + history list)', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'wake me', queueIfBusy: true, subscription: 'everything' });

  // takeItem archives the doc to history.
  await store.takeItem(created._id, 'acme');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.queueIfBusy, true);
  assert.equal(status.subscription, 'everything');

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].queueIfBusy, true);
  assert.equal(items[0].subscription, 'everything');
});

test('a plain dispatch (no fields) surfaces queueIfBusy false + terminal-only through every seam', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'orchestrate', target: 'cli' });

  const [polled] = await store.pollAvailable('acme');
  assert.equal(polled.queueIfBusy, false);
  assert.equal(polled.subscription, 'terminal-only');

  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.queueIfBusy, false);
  assert.equal(taken.subscription, 'terminal-only');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.queueIfBusy, false);
  assert.equal(status.subscription, 'terminal-only');
});

test('the two fields are independent (one set does not imply the other)', async () => {
  const store = makeStore();

  const onlyQueue = await store.addItem('acme', { prompt: 'a', queueIfBusy: true });
  const onlySub = await store.addItem('acme', { prompt: 'b', subscription: 'everything' });

  assert.equal(onlyQueue.queueIfBusy, true);
  assert.equal(onlyQueue.subscription, 'terminal-only');
  assert.equal(onlySub.queueIfBusy, false);
  assert.equal(onlySub.subscription, 'everything');
});
