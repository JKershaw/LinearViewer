/**
 * Unit tests for llm-call-log.js (LIN-418)
 *
 * Run with: node --test tests/unit/llm-call-log.test.js
 *
 * Covers the append-only record contract: every call is stored with the
 * captured metadata, non-numeric fields are coerced to null, listing is
 * workspace-scoped and newest-first, and recording never throws (fire-and-forget).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { LlmCallLogStore } from '../../lib/llm-call-log.js';

// Minimal in-memory mock of the MongoDB/MangoDB collection surface.
function createMockCollection() {
  const docs = [];
  return {
    _docs: docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id };
    },
    find(query) {
      const results = docs.filter(doc => {
        if (query.urlKey && doc.urlKey !== query.urlKey) return false;
        if (query.expiresAt?.$gt && !(doc.expiresAt > query.expiresAt.$gt)) return false;
        return true;
      });
      return { async toArray() { return results; } };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        const doc = docs[i];
        let match = true;
        if (query.urlKey && doc.urlKey !== query.urlKey) match = false;
        if (query.expiresAt?.$lt && !(doc.expiresAt < query.expiresAt.$lt)) match = false;
        if (match) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    }
  };
}

describe('LlmCallLogStore.record', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new LlmCallLogStore({ collection });
  });

  test('persists captured metadata', async () => {
    await store.record({
      urlKey: 'acme', feature: 'recommend', issueIdentifier: 'LIN-1',
      model: 'openai/gpt-5.4-mini', provider: 'OpenAI',
      promptTokens: 1200, completionTokens: 300, totalTokens: 1500,
      cost: 0.0042, finishReason: 'stop', durationMs: 1834
    });
    assert.strictEqual(collection._docs.length, 1);
    const doc = collection._docs[0];
    assert.strictEqual(doc.urlKey, 'acme');
    assert.strictEqual(doc.feature, 'recommend');
    assert.strictEqual(doc.model, 'openai/gpt-5.4-mini');
    assert.strictEqual(doc.provider, 'OpenAI');
    assert.strictEqual(doc.cost, 0.0042);
    assert.strictEqual(doc.completionTokens, 300);
    assert.strictEqual(doc.durationMs, 1834);
    assert.ok(doc.timestamp instanceof Date);
    assert.ok(doc.expiresAt instanceof Date);
    assert.ok(doc.expiresAt > doc.timestamp);
    assert.ok(typeof doc._id === 'string' && doc._id.length > 0);
  });

  test('coerces missing/non-numeric fields to null', async () => {
    await store.record({ feature: 'recap' });
    const doc = collection._docs[0];
    assert.strictEqual(doc.urlKey, null);
    assert.strictEqual(doc.model, null);
    assert.strictEqual(doc.provider, null);
    assert.strictEqual(doc.promptTokens, null);
    assert.strictEqual(doc.completionTokens, null);
    assert.strictEqual(doc.cost, null);
    assert.strictEqual(doc.durationMs, null);
  });

  test('NaN/Infinity numbers become null', async () => {
    await store.record({ cost: NaN, promptTokens: Infinity, completionTokens: 'x' });
    const doc = collection._docs[0];
    assert.strictEqual(doc.cost, null);
    assert.strictEqual(doc.promptTokens, null);
    assert.strictEqual(doc.completionTokens, null);
  });

  test('works (and does not throw) without a collection', async () => {
    const noColl = new LlmCallLogStore({});
    const doc = await noColl.record({ feature: 'brief', cost: 0.01 });
    assert.strictEqual(doc.feature, 'brief');
    assert.strictEqual(doc.cost, 0.01);
  });

  test('never throws when the collection insert fails (fire-and-forget)', async () => {
    const flaky = new LlmCallLogStore({
      collection: { async insertOne() { throw new Error('mongo down'); } }
    });
    const doc = await flaky.record({ feature: 'recommend' });
    assert.strictEqual(doc.feature, 'recommend'); // returns the doc despite the error
  });
});

describe('LlmCallLogStore.listCalls', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new LlmCallLogStore({ collection });
  });

  test('is workspace-scoped and newest-first', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', model: 'm1' });
    await new Promise(r => setTimeout(r, 2));
    await store.record({ urlKey: 'acme', feature: 'brief', model: 'm2' });
    await store.record({ urlKey: 'other', feature: 'recap', model: 'm3' });

    const { items, total } = await store.listCalls('acme');
    assert.strictEqual(total, 2);
    assert.strictEqual(items[0].feature, 'brief'); // newest first
    assert.strictEqual(items[1].feature, 'recommend');
    assert.ok(items.every(i => i.model && typeof i.timestamp === 'string'));
  });

  test('returns empty for unknown workspace or missing urlKey', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend' });
    assert.deepStrictEqual(await store.listCalls('nope'), { items: [], total: 0 });
    assert.deepStrictEqual(await store.listCalls(), { items: [], total: 0 });
  });
});

describe('LlmCallLogStore.summarize', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new LlmCallLogStore({ collection });
  });

  test('totals calls/cost/tokens and breaks down by feature (busiest first)', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', cost: 0.01, totalTokens: 100 });
    await store.record({ urlKey: 'acme', feature: 'recommend', cost: 0.02, totalTokens: 200 });
    await store.record({ urlKey: 'acme', feature: 'brief', cost: 0.005, totalTokens: 50 });
    await store.record({ urlKey: 'other', feature: 'recap', cost: 1, totalTokens: 999 }); // different workspace

    const s = await store.summarize('acme');
    assert.strictEqual(s.totalCalls, 3);
    assert.ok(Math.abs(s.totalCost - 0.035) < 1e-9);
    assert.strictEqual(s.totalTokens, 350);
    assert.strictEqual(s.byFeature[0].feature, 'recommend'); // busiest first
    assert.strictEqual(s.byFeature[0].calls, 2);
    assert.ok(Math.abs(s.byFeature[0].cost - 0.03) < 1e-9);
    assert.strictEqual(s.byFeature[1].feature, 'brief');
    assert.ok(s.lastCallAt);
  });

  test('records missing cost/tokens are skipped, not counted as zero understatement', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', cost: 0.01, totalTokens: 100 });
    await store.record({ urlKey: 'acme', feature: 'task-chat' }); // no cost/tokens reported
    const s = await store.summarize('acme');
    assert.strictEqual(s.totalCalls, 2);
    assert.ok(Math.abs(s.totalCost - 0.01) < 1e-9);
    assert.strictEqual(s.totalTokens, 100);
  });

  test('empty for unknown workspace, missing urlKey, or no collection', async () => {
    const empty = { totalCalls: 0, totalCost: 0, totalTokens: 0, byFeature: [], lastCallAt: null };
    assert.deepStrictEqual(await store.summarize('nope'), empty);
    assert.deepStrictEqual(await store.summarize(), empty);
    assert.deepStrictEqual(await new LlmCallLogStore({}).summarize('acme'), empty);
  });
});
