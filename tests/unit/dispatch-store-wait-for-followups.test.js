/**
 * Unit tests for the waitForFollowUps dispatch plumbing (LIN-797).
 *
 * `waitForFollowUps` is the opt-in completion hold (default false): an ordinary
 * queue field the store records and forwards blindly — the runner owns the
 * behaviour (LIN-795). These tests pin that the field is coerced to a strict
 * boolean, defaults to false, and survives every seam a consumer reads: addItem
 * persistence, the _formatItem seam that poll/take hand to the consumer, and the
 * history records (watch + history list).
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

test('addItem persists waitForFollowUps:true on the stored doc', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'feed me beats', waitForFollowUps: true });

  assert.equal(doc.waitForFollowUps, true);
});

test('addItem defaults waitForFollowUps to false when absent', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task' });

  assert.equal(doc.waitForFollowUps, false);
});

test('addItem coerces a truthy non-boolean to a strict boolean (default false)', async () => {
  const store = makeStore();

  // Only an exact `true` opts in; anything else is the default false. This keeps
  // the stored field a strict boolean even if an upstream forwards a stray value.
  const truthy = await store.addItem('acme', { prompt: 'x', waitForFollowUps: 'yes' });
  const falsy = await store.addItem('acme', { prompt: 'y', waitForFollowUps: 0 });

  assert.equal(truthy.waitForFollowUps, false);
  assert.equal(falsy.waitForFollowUps, false);
});

test('the _formatItem seam (poll/listItems) exposes waitForFollowUps to the consumer', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'feed me beats', waitForFollowUps: true });

  const items = await store.pollAvailable('acme');

  assert.equal(items.length, 1);
  assert.equal(items[0].waitForFollowUps, true);
});

test('takeItem (the other _formatItem path) hands waitForFollowUps to the consumer', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'feed me beats', waitForFollowUps: true });

  const taken = await store.takeItem(created._id, 'acme');

  assert.equal(taken.waitForFollowUps, true);
});

test('waitForFollowUps is carried into history (watch + history list)', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'feed me beats', waitForFollowUps: true });

  // takeItem archives the doc to history.
  await store.takeItem(created._id, 'acme');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.waitForFollowUps, true);

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].waitForFollowUps, true);
});

test('a producer dispatch (no flag) surfaces waitForFollowUps:false through every seam', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'orchestrate', target: 'cli' });

  const [polled] = await store.pollAvailable('acme');
  assert.equal(polled.waitForFollowUps, false);

  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.waitForFollowUps, false);

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.waitForFollowUps, false);
});
