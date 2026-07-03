/**
 * Unit tests for lib/proxy-events.js (ProxyEventStore)
 *
 * Run with: node --test tests/unit/proxy-events-store.test.js
 *
 * Exercises the real ProxyEventStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface. Focus (LIN-961): the optional `note`
 * breadcrumb round-trips through recordEvent → listEvents while the numeric
 * `status` is left untouched, and legacy events without a note read back as null.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ProxyEventStore } from '../../lib/proxy-events.js';

// Minimal in-memory mock of the collection surface the store uses.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.expiresAt?.$gt !== undefined && !(doc.expiresAt > query.expiresAt.$gt)) return false;
    if (query.expiresAt?.$lt !== undefined && !(doc.expiresAt < query.expiresAt.$lt)) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteMany(query) {
      let n = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); n++; }
      }
      return { deletedCount: n };
    }
  };
}

describe('ProxyEventStore note breadcrumb (LIN-961)', () => {
  let store, collection;
  beforeEach(() => {
    collection = createMockCollection();
    store = new ProxyEventStore({ collection });
  });

  test('records and reads back a free-tier breadcrumb note without touching status', async () => {
    await store.recordEvent({
      urlKey: 'ws1',
      endpoint: '/api/proxy/recommend',
      status: 200,
      note: 'free-tier fallback: no paid/OAuth key resolved'
    });
    const { items } = await store.listEvents('ws1');
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].status, 200);
    assert.strictEqual(items[0].note, 'free-tier fallback: no paid/OAuth key resolved');
  });

  test('an event without a note reads back note:null (backward compatible)', async () => {
    await store.recordEvent({ urlKey: 'ws1', endpoint: '/api/proxy/issues', status: 200 });
    const { items } = await store.listEvents('ws1');
    assert.strictEqual(items[0].note, null);
  });

  test('a legacy doc missing the note field entirely still lists as note:null', async () => {
    // Simulate a pre-LIN-961 document with no `note` key at all.
    collection._docs.push({
      _id: 'legacy-1',
      urlKey: 'ws1',
      endpoint: '/api/proxy/recap',
      status: 429,
      timestamp: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2099-01-01T00:00:00Z')
    });
    const { items } = await store.listEvents('ws1');
    assert.strictEqual(items[0].note, null);
    assert.strictEqual(items[0].status, 429);
  });
});
