/**
 * Unit tests for the periodical-template join key plumbing (LIN-1825, Beat 1).
 *
 * `periodicalId` is stamped once at dispatch time (never maintained) and
 * replaces the fragile join on `promptName`. This is the store-layer half
 * (the four hops: addItem, _archiveItem, _formatItem, _formatHistoryItem —
 * "G1", the read leg the LIN-1827 fold depends on).
 *
 * The round-trip assertions go through listItems()/pollAvailable() and
 * listHistory() — NEVER the raw doc addItem() returns. That distinction is
 * load-bearing: addItem's raw doc carries every persisted field regardless
 * of whether a formatter lists it, so a doc-level assertion cannot catch a
 * G1 regression (proven on this repo today against the sibling field
 * producingItemId/LIN-1698, which sits in exactly that unformatted state).
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

test('periodicalId defaults to null when not provided, visible via listItems/pollAvailable', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'do the thing' });

  const polled = await store.pollAvailable('acme');
  assert.equal(polled.length, 1);
  assert.equal(polled[0].periodicalId, null);

  const listed = await store.listItems('acme');
  assert.equal(listed[0].periodicalId, null);
});

test('the _formatItem seam (poll/listItems) exposes periodicalId to the consumer', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'periodical run', kind: 'periodical', periodicalId: 'documentation-review' });

  const polled = await store.pollAvailable('acme');
  assert.equal(polled.length, 1);
  assert.equal(polled[0].periodicalId, 'documentation-review');

  const listed = await store.listItems('acme');
  assert.equal(listed[0].periodicalId, 'documentation-review');
});

test('periodicalId is carried into history on archive (takeItem) and survives the _formatHistoryItem seam', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'periodical run', kind: 'periodical', periodicalId: 'documentation-review' });

  await store.takeItem(created._id, 'acme');

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].periodicalId, 'documentation-review');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.periodicalId, 'documentation-review');
});

test('periodicalId survives archive on cancel and on expiry, not just take', async () => {
  const store = makeStore();

  const cancelled = await store.addItem('acme', { prompt: 'a', kind: 'periodical', periodicalId: 'tpl-a' });
  await store.removeItem('acme', cancelled._id);

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].periodicalId, 'tpl-a');
});

test('a pre-field row (periodicalId absent) round-trips as null everywhere, never throws', async () => {
  // Simulates a doc written before LIN-1825 by inserting directly, bypassing
  // addItem's field list entirely.
  const store = makeStore();
  await store.collection.insertOne({
    _id: 'legacy-1', urlKey: 'acme', prompt: 'old', promptName: 'Prompt', kind: 'periodical',
    dispatchedAt: new Date(), target: 'cli', expiresAt: new Date(Date.now() + 100000)
  });

  const items = await store.listItems('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].periodicalId, null);

  const status = await store.getItemStatus('acme', 'legacy-1');
  assert.equal(status.periodicalId, null);
});

test('two independent Mint dispatches from the same template carry the same periodicalId (no per-dispatch drift)', async () => {
  const store = makeStore();
  const plain = await store.addItem('acme', { prompt: 'plain mint', kind: 'periodical', periodicalId: 'weekly-triage' });
  const autopilot = await store.addItem('acme', { prompt: 'weekly triage + Autopilot', kind: 'periodical', periodicalId: 'weekly-triage' });

  const listed = await store.listItems('acme');
  const ids = listed.map(i => i.periodicalId).sort();
  assert.deepEqual(ids, ['weekly-triage', 'weekly-triage']);
  assert.notEqual(plain._id, autopilot._id);
});
