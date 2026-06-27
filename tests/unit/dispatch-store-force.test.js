/**
 * Unit tests for the force-resume flag plumbing (LIN-559).
 *
 * `force` is an ordinary boolean carried alongside `followUpTo`: when true the
 * runner bypasses its active-session liveness guard so a wedged/sleeping session
 * can still be resumed. The store records and forwards it blindly; these tests
 * pin that the flag survives every seam a consumer reads — addItem persistence,
 * the _formatItem seam that poll/take hand to the consumer, and the history
 * records — and that it defaults to false (never undefined).
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

const FOLLOW_UP_TO = '11111111-1111-4111-8111-111111111111';

test('addItem persists force:true on the stored doc', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'resume please', followUpTo: FOLLOW_UP_TO, force: true });

  assert.equal(doc.force, true);
});

test('addItem defaults force to false (not undefined) when absent', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task' });

  assert.equal(doc.force, false);
});

test('addItem coerces a falsy/omitted force to a strict boolean false', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task', force: undefined });

  assert.strictEqual(doc.force, false);
});

test('the _formatItem seam (poll/listItems) exposes force to the consumer', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'resume please', followUpTo: FOLLOW_UP_TO, force: true });

  const items = await store.pollAvailable('acme');

  assert.equal(items.length, 1);
  assert.equal(items[0].force, true);
});

test('takeItem (the other _formatItem path) hands force to the consumer', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'resume please', followUpTo: FOLLOW_UP_TO, force: true });

  const taken = await store.takeItem(created._id, 'acme');

  assert.equal(taken.force, true);
});

test('force is carried into history (watch status + history list)', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'resume please', followUpTo: FOLLOW_UP_TO, force: true });

  // takeItem archives the doc to history.
  await store.takeItem(created._id, 'acme');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.force, true);

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].force, true);
});

test('a plain (non-force) follow-up reads force:false at every seam', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'resume please', followUpTo: FOLLOW_UP_TO });

  const polled = await store.pollAvailable('acme');
  assert.equal(polled[0].force, false);

  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.force, false);

  const { items } = await store.listHistory('acme');
  assert.equal(items[0].force, false);
});
