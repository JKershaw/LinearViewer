/**
 * Unit tests for lib/ship-biscuit-history-store.js (LIN-818, V1).
 *
 * Run with: node --test tests/unit/ship-biscuit-history-store.test.js
 *
 * Exercises the real ShipBiscuitHistoryStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface (mirroring report-history-store.test.js), so the
 * production save/list/getLatest/cap/isolation logic is what's under test.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ShipBiscuitHistoryStore } from '../../lib/ship-biscuit-history-store.js';

function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    }
  };
}

function sampleEdition(tag = '') {
  return {
    model: 'mock',
    window: 'week',
    since: '2026-07-02T00:00:00.000Z',
    workspaceName: 'Acme',
    isQuiet: false,
    frontPage: { lede: 'A busy week ' + tag },
    index: [
      { id: 'art-1', section: 'The Wire', headline: 'Headline ' + tag, dek: 'A teaser.', weight: 5,
        sourceRefs: [{ id: 'session:s1', kind: 'session', headline: 'seed', snapshot: { outcome: 'completed cleanly' } }] }
    ],
    weather: { totalCalls: 3, totalCost: 0.01, totalTokens: 900, byFeature: [] }
  };
}

describe('ShipBiscuitHistoryStore.save', () => {
  let store;
  beforeEach(() => { store = new ShipBiscuitHistoryStore({ collection: createMockCollection() }); });

  test('assigns an id + generatedAt and returns the record', async () => {
    const rec = await store.save('ws1', sampleEdition('a'));
    assert.ok(rec.id);
    assert.ok(rec.generatedAt);
    assert.strictEqual(rec.window, 'week');
    assert.strictEqual(rec.frontPage.lede, 'A busy week a');
    assert.strictEqual(rec.index.length, 1);
    // The sourceRef snapshot is persisted by value (§B grounding survives).
    assert.strictEqual(rec.index[0].sourceRefs[0].snapshot.outcome, 'completed cleanly');
  });

  test('returns null when urlKey is missing', async () => {
    assert.strictEqual(await store.save('', sampleEdition()), null);
  });

  test('normalizes a quiet edition with an empty index', async () => {
    const rec = await store.save('ws1', { model: 'quiet', window: 'day', isQuiet: true, frontPage: { lede: 'Quiet.' }, index: [] });
    assert.strictEqual(rec.isQuiet, true);
    assert.strictEqual(rec.index.length, 0);
  });
});

describe('ShipBiscuitHistoryStore.getLatest / get / list', () => {
  let store;
  beforeEach(() => { store = new ShipBiscuitHistoryStore({ collection: createMockCollection() }); });

  test('getLatest returns the newest edition', async () => {
    const first = await store.save('ws1', sampleEdition('first'));
    await new Promise(r => setTimeout(r, 5));
    const second = await store.save('ws1', sampleEdition('second'));
    const latest = await store.getLatest('ws1');
    assert.strictEqual(latest.id, second.id);
    assert.notStrictEqual(latest.id, first.id);
  });

  test('get fetches a specific edition by id', async () => {
    const rec = await store.save('ws1', sampleEdition('x'));
    const fetched = await store.get('ws1', rec.id);
    assert.strictEqual(fetched.id, rec.id);
    assert.strictEqual(fetched.frontPage.lede, 'A busy week x');
  });

  test('list returns newest-first summaries without bodies', async () => {
    await store.save('ws1', sampleEdition('1'));
    await new Promise(r => setTimeout(r, 5));
    await store.save('ws1', sampleEdition('2'));
    const { items, total } = await store.list('ws1');
    assert.strictEqual(total, 2);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].articleCount, 1);
    assert.strictEqual(items[0].frontPage, undefined, 'summary omits the body');
  });

  test('getLatest returns null for a workspace with no editions', async () => {
    assert.strictEqual(await store.getLatest('empty'), null);
  });
});

describe('ShipBiscuitHistoryStore — workspace isolation', () => {
  test('editions never leak across workspaces', async () => {
    const store = new ShipBiscuitHistoryStore({ collection: createMockCollection() });
    await store.save('ws1', sampleEdition('one'));
    await store.save('ws2', sampleEdition('two'));

    const ws1 = await store.list('ws1');
    const ws2 = await store.list('ws2');
    assert.strictEqual(ws1.total, 1);
    assert.strictEqual(ws2.total, 1);

    const latest1 = await store.getLatest('ws1');
    assert.strictEqual(latest1.frontPage.lede, 'A busy week one');
    // A cross-workspace get is refused.
    assert.strictEqual(await store.get('ws2', latest1.id), null);
  });
});

describe('ShipBiscuitHistoryStore — capacity cap', () => {
  test('prunes to the newest maxEditions per workspace', async () => {
    const store = new ShipBiscuitHistoryStore({ collection: createMockCollection(), maxEditions: 3 });
    for (let i = 0; i < 5; i++) {
      await store.save('ws1', sampleEdition(String(i)));
      await new Promise(r => setTimeout(r, 2));
    }
    const { total } = await store.list('ws1');
    assert.strictEqual(total, 3);
  });
});

describe('ShipBiscuitHistoryStore.clear', () => {
  test('removes all editions for a workspace', async () => {
    const store = new ShipBiscuitHistoryStore({ collection: createMockCollection() });
    await store.save('ws1', sampleEdition());
    await store.save('ws1', sampleEdition());
    const removed = await store.clear('ws1');
    assert.strictEqual(removed, 2);
    assert.strictEqual((await store.list('ws1')).total, 0);
  });
});
