/**
 * Unit tests for the `stopAt` field plumbing (LIN-3245 / LIN-2949 P1a).
 *
 * `stopAt` is the run-boundary fact: `'pr'` means the run stops at its PR and
 * must not dispatch `close-out`. It is an optional, nullable field threaded
 * through the same four run-scoped allowlist sites as `maxTasks`:
 * addItem, _archiveItem, _formatHistoryItem, _formatItem. The
 * `_formatHistoryItem` leg is LOAD-BEARING, not a consistency nicety: the
 * dispatch seam and the child-inheritance seam read the run row through
 * `getItemStatus`, which resolves through that formatter once a kickoff row is
 * archived — which happens within seconds of a real run starting. Dropping the
 * field on any one leg reproduces the LIN-1698/LIN-1751 silent-drop class.
 *
 * Mirrors tests/unit/dispatch-store-task-budget.test.js's pattern for the
 * sibling `maxTasks` field.
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

describe('stopAt field threading (LIN-3245)', () => {
  test('addItem persists stopAt on the stored doc', async () => {
    const store = makeStore();
    const doc = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', stopAt: 'pr' });
    assert.equal(doc.stopAt, 'pr');
  });

  test('addItem defaults stopAt to null (not undefined) when absent', async () => {
    const store = makeStore();
    const doc = await store.addItem('acme', { prompt: 'fresh task' });
    assert.strictEqual(doc.stopAt, null);
  });

  test('the _formatItem seam (poll/take) exposes stopAt to the consumer', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', stopAt: 'pr' });
    const items = await store.pollAvailable('acme');
    assert.equal(items.length, 1);
    assert.equal(items[0].stopAt, 'pr');
  });

  test('stopAt survives through getItemStatus while queued AND after archive', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', stopAt: 'pr' });

    // Queued branch: getItemStatus resolves through _formatItem.
    const queued = await store.getItemStatus('acme', created._id);
    assert.equal(queued.status, 'queued', 'sanity: resolved via the active-queue branch');
    assert.equal(queued.stopAt, 'pr', 'a missing field here makes the dispatch seam silently stop enforcing');

    // takeItem archives the doc to history; getItemStatus then resolves through
    // _formatHistoryItem — the LOAD-BEARING leg.
    await store.takeItem(created._id, 'acme');
    const archived = await store.getItemStatus('acme', created._id);
    assert.equal(archived.status, 'taken', 'sanity: resolved via the history branch, not the active queue');
    assert.equal(archived.stopAt, 'pr', 'a missing field here makes the dispatch seam silently stop enforcing on every archived run');

    const { items } = await store.listHistory('acme');
    assert.equal(items.length, 1);
    assert.equal(items[0].stopAt, 'pr');
  });

  test('a row stamped null reads stopAt:null while queued and after archive', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me' });

    const queued = await store.getItemStatus('acme', created._id);
    assert.strictEqual(queued.stopAt, null);

    const polled = await store.pollAvailable('acme');
    assert.strictEqual(polled[0].stopAt, null);

    await store.takeItem(created._id, 'acme');
    const archived = await store.getItemStatus('acme', created._id);
    assert.strictEqual(archived.stopAt, null);

    const { items } = await store.listHistory('acme');
    assert.strictEqual(items[0].stopAt, null);
  });
});
