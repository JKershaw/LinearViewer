/**
 * Unit tests for abort dispatch plumbing (LIN-743).
 *
 * An abort is an ordinary queue item carrying the abort verb (`abort: true` +
 * `abortTo`, the dispatchId of the session to cancel) and NO prompt. The store
 * records and forwards both fields blindly; these tests pin that they survive
 * every seam a consumer reads — addItem persistence (incl. the prompt-optional
 * relaxation), the _formatItem seam that poll/take hand to the consumer, and the
 * history records — mirroring the follow-up tests.
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

test('addItem persists abort + abortTo on the stored doc (no prompt)', async () => {
  const store = makeStore();
  const abortTo = '11111111-1111-4111-8111-111111111111';

  const doc = await store.addItem('acme', { abort: true, abortTo, target: 'cli' });

  assert.equal(doc.abort, true);
  assert.equal(doc.abortTo, abortTo);
  assert.equal(doc.prompt, null);
});

test('addItem defaults abort to false and abortTo to null for a normal dispatch', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task' });

  assert.equal(doc.abort, false);
  assert.equal(doc.abortTo, null);
});

test('addItem still requires a prompt when not an abort', async () => {
  const store = makeStore();

  await assert.rejects(() => store.addItem('acme', {}), /urlKey and prompt are required/);
});

test('the _formatItem seam (poll/listItems) exposes abort + abortTo to the consumer', async () => {
  const store = makeStore();
  const abortTo = '22222222-2222-4222-8222-222222222222';
  await store.addItem('acme', { abort: true, abortTo });

  const items = await store.pollAvailable('acme');

  assert.equal(items.length, 1);
  assert.equal(items[0].abort, true);
  assert.equal(items[0].abortTo, abortTo);
});

test('takeItem (the other _formatItem path) hands abort + abortTo to the consumer', async () => {
  const store = makeStore();
  const abortTo = '33333333-3333-4333-8333-333333333333';
  const created = await store.addItem('acme', { abort: true, abortTo });

  const taken = await store.takeItem(created._id, 'acme');

  assert.equal(taken.abort, true);
  assert.equal(taken.abortTo, abortTo);
});

test('abort + abortTo are carried into history (watch + history list)', async () => {
  const store = makeStore();
  const abortTo = '44444444-4444-4444-8444-444444444444';
  const created = await store.addItem('acme', { abort: true, abortTo });

  // takeItem archives the doc to history.
  await store.takeItem(created._id, 'acme');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.abort, true);
  assert.equal(status.abortTo, abortTo);

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].abort, true);
  assert.equal(items[0].abortTo, abortTo);
});

// --- Cascade modifier (LIN-946) -------------------------------------------
// `cascade` rides alongside abort/abortTo: abortTo names a subtree ROOT and
// cascade:true marks the abort for Harbour-side subtree expansion (the recursive
// walk lands in a later beat). Beat 1 is wire acceptance only — the store records
// and forwards the flag blindly through every seam, exactly like abort/abortTo.

test('addItem persists cascade alongside abort + abortTo', async () => {
  const store = makeStore();
  const abortTo = '55555555-5555-4555-8555-555555555555';

  const doc = await store.addItem('acme', { abort: true, abortTo, cascade: true, target: 'cli' });

  assert.equal(doc.abort, true);
  assert.equal(doc.abortTo, abortTo);
  assert.equal(doc.cascade, true);
});

test('addItem defaults cascade to false (plain abort and normal dispatch)', async () => {
  const store = makeStore();
  const abortTo = '66666666-6666-4666-8666-666666666666';

  const plainAbort = await store.addItem('acme', { abort: true, abortTo });
  assert.equal(plainAbort.cascade, false);

  const normal = await store.addItem('acme', { prompt: 'fresh task' });
  assert.equal(normal.cascade, false);
});

test('the _formatItem seam (poll/listItems) exposes cascade to the consumer', async () => {
  const store = makeStore();
  const abortTo = '77777777-7777-4777-8777-777777777777';
  await store.addItem('acme', { abort: true, abortTo, cascade: true });

  const items = await store.pollAvailable('acme');

  assert.equal(items.length, 1);
  assert.equal(items[0].cascade, true);
});

test('cascade is carried through takeItem and into history', async () => {
  const store = makeStore();
  const abortTo = '88888888-8888-4888-8888-888888888888';
  const created = await store.addItem('acme', { abort: true, abortTo, cascade: true });

  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.cascade, true);

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.cascade, true);

  const { items } = await store.listHistory('acme');
  assert.equal(items[0].cascade, true);
});

test('end-to-end: an abort item references an earlier dispatch by id', async () => {
  const store = makeStore();

  // 1. Dispatch a normal item.
  const original = await store.addItem('acme', { prompt: 'do the thing', target: 'dash' });

  // 2. Abort it with a cli abort item — eligibility is keyed off the abort item's
  //    own target, independent of the aborted session's substrate (here 'dash').
  const abortItem = await store.addItem('acme', {
    abort: true,
    abortTo: original._id,
    target: 'cli'
  });

  assert.equal(abortItem.abortTo, original._id);

  // The consumer sees the linkage when it polls/takes the abort item.
  const taken = await store.takeItem(abortItem._id, 'acme');
  assert.equal(taken.abort, true);
  assert.equal(taken.abortTo, original._id);
});
