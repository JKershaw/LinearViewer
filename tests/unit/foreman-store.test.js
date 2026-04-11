/**
 * Unit tests for foreman-store.js
 *
 * Run with: node --test tests/unit/foreman-store.test.js
 *
 * Covers the store's listStatus contract — specifically the "no limit means
 * return everything" semantics added to avoid silent truncation for callers
 * like pipeline-loops.js that need the full non-expired set.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ForemanStore } from '../../lib/foreman-store.js';

// Minimal in-memory mock of the MongoDB/MangoDB collection surface the store uses.
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
      return {
        async toArray() {
          return results;
        }
      };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        const doc = docs[i];
        let match = true;
        if (query.urlKey && doc.urlKey !== query.urlKey) match = false;
        if (query.expiresAt?.$lt && !(doc.expiresAt < query.expiresAt.$lt)) match = false;
        if (match) {
          docs.splice(i, 1);
          count++;
        }
      }
      return { deletedCount: count };
    }
  };
}

describe('ForemanStore.listStatus', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new ForemanStore({ collection });
  });

  async function seed(urlKey, count) {
    for (let i = 0; i < count; i++) {
      await store.recordStatus({
        urlKey,
        taskIdentifier: `LIN-${i}`,
        action: 'research',
        status: 'completed',
        summary: `Entry ${i}`
      });
    }
  }

  test('returns empty result when urlKey missing', async () => {
    const result = await store.listStatus('');
    assert.deepStrictEqual(result, { items: [], total: 0 });
  });

  test('returns all entries when limit is omitted (no silent truncation)', async () => {
    // LIN-254: the old signature defaulted limit=20, silently dropping rows
    // beyond the first page. Callers like pipeline-loops.js need the full set.
    await seed('ws-1', 25);

    const result = await store.listStatus('ws-1');
    assert.strictEqual(result.total, 25);
    assert.strictEqual(result.items.length, 25);
  });

  test('returns all entries when only offset=0 is supplied', async () => {
    await seed('ws-1', 30);

    const result = await store.listStatus('ws-1', { offset: 0 });
    assert.strictEqual(result.total, 30);
    assert.strictEqual(result.items.length, 30);
  });

  test('still paginates when limit is supplied', async () => {
    await seed('ws-1', 25);

    const page1 = await store.listStatus('ws-1', { limit: 10 });
    assert.strictEqual(page1.total, 25);
    assert.strictEqual(page1.items.length, 10);

    const page2 = await store.listStatus('ws-1', { limit: 10, offset: 10 });
    assert.strictEqual(page2.total, 25);
    assert.strictEqual(page2.items.length, 10);

    const page3 = await store.listStatus('ws-1', { limit: 10, offset: 20 });
    assert.strictEqual(page3.total, 25);
    assert.strictEqual(page3.items.length, 5);
  });

  test('isolates entries per urlKey', async () => {
    await seed('ws-1', 5);
    await seed('ws-2', 3);

    const ws1 = await store.listStatus('ws-1');
    const ws2 = await store.listStatus('ws-2');
    assert.strictEqual(ws1.total, 5);
    assert.strictEqual(ws2.total, 3);
  });

  test('sorts results newest-first', async () => {
    const base = Date.now();
    // Insert directly with controlled timestamps so order is deterministic.
    for (let i = 0; i < 3; i++) {
      collection._docs.push({
        _id: `id-${i}`,
        urlKey: 'ws-1',
        taskIdentifier: `LIN-${i}`,
        action: 'research',
        status: 'completed',
        summary: `Entry ${i}`,
        timestamp: new Date(base + i * 1000),
        expiresAt: new Date(base + 1000 * 60 * 60 * 24 * 30)
      });
    }

    const result = await store.listStatus('ws-1');
    assert.strictEqual(result.items[0].taskIdentifier, 'LIN-2');
    assert.strictEqual(result.items[1].taskIdentifier, 'LIN-1');
    assert.strictEqual(result.items[2].taskIdentifier, 'LIN-0');
  });

  test('excludes expired entries', async () => {
    const now = Date.now();
    collection._docs.push({
      _id: 'live',
      urlKey: 'ws-1',
      taskIdentifier: 'LIN-live',
      action: 'research',
      status: 'completed',
      summary: 'live',
      timestamp: new Date(now),
      expiresAt: new Date(now + 1000 * 60)
    });
    collection._docs.push({
      _id: 'expired',
      urlKey: 'ws-1',
      taskIdentifier: 'LIN-expired',
      action: 'research',
      status: 'completed',
      summary: 'expired',
      timestamp: new Date(now - 1000 * 60 * 60),
      expiresAt: new Date(now - 1000 * 60)
    });

    const result = await store.listStatus('ws-1');
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.items[0].taskIdentifier, 'LIN-live');
  });
});
