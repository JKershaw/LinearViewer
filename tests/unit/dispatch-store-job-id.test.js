/**
 * LIN-3853 review F3 — the dispatch row records the job id it was routed as.
 *
 * `addItem` whitelists fields, so without the sparse `jobId` spread the factory's
 * stamp is silently dropped. Written with the same sparse idiom as `issueSource`:
 * stored and archived when present, never a key when absent or null.
 *
 * Run with: node --test tests/unit/dispatch-store-job-id.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection(),
  });
}

describe('LIN-3853 — dispatch-store persists jobId', () => {
  test('addItem stores jobId on the queue doc', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'p', jobId: 'implementation' });
    assert.equal(store.collection._docs[0].jobId, 'implementation');
  });

  test('jobId survives the take → history hop', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'p', jobId: 'implementation' });
    await store.takeItem(created._id, 'acme');
    assert.equal(store.historyCollection._docs[0].jobId, 'implementation');
  });

  for (const [label, extra] of [['absent', {}], ['null', { jobId: null }]]) {
    test(`a ${label} jobId adds no key to the queue or history doc`, async () => {
      const store = makeStore();
      const created = await store.addItem('acme', { prompt: 'p', ...extra });
      assert.equal('jobId' in store.collection._docs[0], false);
      await store.takeItem(created._id, 'acme');
      assert.equal('jobId' in store.historyCollection._docs[0], false);
    });
  }
});
