/**
 * Unit tests for lib/run-summary-cache.js (LIN-509).
 *
 * Run with: node --test tests/unit/run-summary-cache.test.js
 *
 * Coverage:
 *   - stableStringify determinism
 *   - hashLoop stability + sensitivity to summarisable fields only
 *   - RunSummaryCacheStore key format, get/put/delete, TTL expiry
 *   - InMemory fallback
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  stableStringify,
  hashLoop,
  RunSummaryCacheStore,
  InMemoryRunSummaryCacheStore
} from '../../lib/run-summary-cache.js';

const LOOP = {
  loopId: 'd1',
  issueIdentifier: 'LIN-42',
  iteration: 2,
  promptName: 'implementation',
  promptText: 'do the thing',
  stage: 'implement',
  agentState: 'complete',
  foremanSummary: 'done it',
  feedback: [{ message: 'pr opened' }]
};

describe('stableStringify', () => {
  test('sorts keys at every depth', () => {
    assert.equal(
      stableStringify({ b: 1, a: { d: 2, c: 3 } }),
      stableStringify({ a: { c: 3, d: 2 }, b: 1 })
    );
  });
});

describe('hashLoop', () => {
  test('is stable across reordered fields', () => {
    const reordered = { feedback: [{ message: 'pr opened' }], agentState: 'complete', loopId: 'd1', issueIdentifier: 'LIN-42', iteration: 2, promptName: 'implementation', promptText: 'do the thing', stage: 'implement', foremanSummary: 'done it' };
    assert.equal(hashLoop(LOOP), hashLoop(reordered));
  });

  test('changes when a summarisable field changes', () => {
    assert.notEqual(hashLoop(LOOP), hashLoop({ ...LOOP, foremanSummary: 'something else' }));
  });

  test('ignores non-summarisable churn (e.g. workspace tag, timestamps)', () => {
    assert.equal(hashLoop(LOOP), hashLoop({ ...LOOP, workspaceUrlKey: 'ws', dispatchedAt: '2026-01-01' }));
  });

  test('normalises string vs object feedback', () => {
    assert.equal(
      hashLoop({ ...LOOP, feedback: ['pr opened'] }),
      hashLoop({ ...LOOP, feedback: [{ message: 'pr opened' }] })
    );
  });
});

describe('RunSummaryCacheStore', () => {
  function makeCollection() {
    const docs = new Map();
    return {
      async findOne(q) { return docs.get(q._id) || null; },
      async updateOne(filter, update, opts = {}) {
        const existing = docs.get(filter._id);
        if (existing) Object.assign(existing, update.$set);
        else if (opts.upsert) docs.set(filter._id, { _id: filter._id, ...update.$set });
      },
      async deleteOne(q) { docs.delete(q._id); }
    };
  }

  test('key is `${workspaceId}:${loopId}`', () => {
    assert.equal(RunSummaryCacheStore.key('ws', 'd1'), 'ws:d1');
  });

  test('round-trips a summary', async () => {
    const store = new RunSummaryCacheStore({ collection: makeCollection() });
    const summary = { outcome: 'ok', whatHappened: ['a'], blockers: [], next: '' };
    await store.put('ws', 'd1', { inputHash: 'h1', summary, model: 'm' });
    const got = await store.get('ws', 'd1');
    assert.equal(got.inputHash, 'h1');
    assert.deepEqual(got.summary, summary);
    assert.equal(got.model, 'm');
  });

  test('expires entries past TTL (lazy on read)', async () => {
    const store = new RunSummaryCacheStore({ collection: makeCollection(), ttl: 1 });
    await store.put('ws', 'd1', { inputHash: 'h', summary: {}, model: 'm' });
    // Force the stored generatedAt into the past.
    const stale = await store.get('ws', 'd1');
    assert.ok(stale); // fresh now
    const col = store.collection;
    const doc = await col.findOne({ _id: 'ws:d1' });
    doc.generatedAt = new Date(Date.now() - 5000);
    const expired = await store.get('ws', 'd1');
    assert.equal(expired, null);
  });

  test('delete removes the entry', async () => {
    const store = new RunSummaryCacheStore({ collection: makeCollection() });
    await store.put('ws', 'd1', { inputHash: 'h', summary: {}, model: 'm' });
    await store.delete('ws', 'd1');
    assert.equal(await store.get('ws', 'd1'), null);
  });

  test('no-ops without a collection', async () => {
    const store = new RunSummaryCacheStore({});
    await store.put('ws', 'd1', { inputHash: 'h', summary: {}, model: 'm' });
    assert.equal(await store.get('ws', 'd1'), null);
  });
});

describe('InMemoryRunSummaryCacheStore', () => {
  test('round-trips a summary', async () => {
    const store = new InMemoryRunSummaryCacheStore();
    await store.put('ws', 'd1', { inputHash: 'h', summary: { outcome: 'x' }, model: 'm' });
    const got = await store.get('ws', 'd1');
    assert.equal(got.summary.outcome, 'x');
    await store.delete('ws', 'd1');
    assert.equal(await store.get('ws', 'd1'), null);
  });
});
