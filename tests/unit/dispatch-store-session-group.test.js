/**
 * Unit tests for the durable session-group id plumbing (LIN-1341).
 *
 * `sessionGroupId` is the id readers group follow-ups by, O(1), instead of
 * walking the followUpTo chain. The store mints it at `addItem` per the
 * precedence rule: an inherited parent group (passed in by the caller, e.g.
 * `createDispatchItem`'s follow-up inheritance seam) ?? this item's own
 * `sessionId` ?? this doc's own freshly-minted `_id`. These tests pin that
 * precedence and that the field survives every seam a reader depends on:
 * addItem persistence, archive-to-history, the getItemStatus/_formatItem/
 * _formatHistoryItem read shapes, and the listItems/listHistory query filters.
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

test('a fresh root dispatch (no followUpTo, no sessionId) mints sessionGroupId as its own doc id', async () => {
  const store = makeStore();
  const doc = await store.addItem('acme', { prompt: 'do the thing' });
  assert.equal(doc.sessionGroupId, doc._id);
});

test('an autopilot worker (sessionId set, no explicit sessionGroupId) uses its sessionId as the group', async () => {
  const store = makeStore();
  const doc = await store.addItem('acme', { prompt: 'work', sessionId: 'ap-1' });
  assert.equal(doc.sessionGroupId, 'ap-1');
});

test('an explicit sessionGroupId (as a follow-up inheritance seam would pass) wins over sessionId and own id', async () => {
  const store = makeStore();
  const doc = await store.addItem('acme', { prompt: 'reply', sessionId: 'ap-1', sessionGroupId: 'inherited-group' });
  assert.equal(doc.sessionGroupId, 'inherited-group');
});

test('sessionGroupId is carried into history on archive (takeItem)', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'do the thing' });

  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.sessionGroupId, created.sessionGroupId);

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.sessionGroupId, created.sessionGroupId);
});

test('the _formatItem seam (poll/listItems) exposes sessionGroupId to the consumer', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'do the thing', sessionId: 'ap-2' });

  const items = await store.pollAvailable('acme');

  assert.equal(items.length, 1);
  assert.equal(items[0].sessionGroupId, 'ap-2');
});

test('listItems({ sessionGroupId }) restricts to one durable group', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'a', sessionGroupId: 'grp-1' });
  await store.addItem('acme', { prompt: 'b', sessionGroupId: 'grp-2' });

  const items = await store.listItems('acme', { sessionGroupId: 'grp-1' });
  assert.equal(items.length, 1);
  assert.equal(items[0].sessionGroupId, 'grp-1');
});

test('listHistory({ sessionGroupId }) restricts to one durable group', async () => {
  const store = makeStore();
  const a = await store.addItem('acme', { prompt: 'a', sessionGroupId: 'grp-1' });
  const b = await store.addItem('acme', { prompt: 'b', sessionGroupId: 'grp-2' });
  await store.takeItem(a._id, 'acme');
  await store.takeItem(b._id, 'acme');

  const { items } = await store.listHistory('acme', { sessionGroupId: 'grp-1' });
  assert.equal(items.length, 1);
  assert.equal(items[0].sessionGroupId, 'grp-1');
});

test('a pre-field row (sessionGroupId absent) round-trips as null everywhere, never throws', async () => {
  // Simulates a doc written before LIN-1341 by inserting directly, bypassing
  // addItem's minting.
  const store = makeStore();
  await store.collection.insertOne({
    _id: 'legacy-1', urlKey: 'acme', prompt: 'old', promptName: 'Prompt', kind: 'custom',
    dispatchedAt: new Date(), target: 'cli', expiresAt: new Date(Date.now() + 100000)
  });

  const items = await store.listItems('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].sessionGroupId, null);

  const status = await store.getItemStatus('acme', 'legacy-1');
  assert.equal(status.sessionGroupId, null);
});
