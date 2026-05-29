/**
 * Unit tests for lib/report-history-store.js
 *
 * Run with: node --test tests/unit/report-history-store.test.js
 *
 * Exercises the real ReportHistoryStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface, so the production save/list/cap logic
 * (not a simplified stand-in) is what's under test.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ReportHistoryStore } from '../../lib/report-history-store.js';

// Minimal in-memory mock of the collection surface the store uses.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id };
    },
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

function sampleNarrative(tag = '') {
  return {
    technical: 'tech ' + tag,
    product: 'product ' + tag,
    trajectory: 'trajectory ' + tag,
    northStarReading: 'ns reading ' + tag,
    gap: 'gap ' + tag
  };
}

describe('ReportHistoryStore.save', () => {
  let store;
  beforeEach(() => { store = new ReportHistoryStore({ collection: createMockCollection() }); });

  test('save returns the stored record (ISO timestamp, defaults applied)', async () => {
    const saved = await store.save('ws-1', {
      model: 'anthropic/claude-x',
      northStar: 'be useful',
      narrative: sampleNarrative('a')
    });
    assert.ok(saved.id);
    assert.strictEqual(saved.model, 'anthropic/claude-x');
    assert.strictEqual(saved.northStar, 'be useful');
    assert.strictEqual(saved.narrative.technical, 'tech a');
    assert.deepStrictEqual(saved.orientation, []);
    assert.match(saved.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('defaults northStar to "" and orientation to []', async () => {
    const saved = await store.save('ws-1', { model: 'm', narrative: sampleNarrative() });
    assert.strictEqual(saved.northStar, '');
    assert.deepStrictEqual(saved.orientation, []);
  });

  test('normalizes a partial narrative (missing layers -> null)', async () => {
    const saved = await store.save('ws-1', { model: 'm', narrative: { technical: 'only tech' } });
    assert.strictEqual(saved.narrative.technical, 'only tech');
    assert.strictEqual(saved.narrative.product, null);
    assert.strictEqual(saved.narrative.gap, null);
  });

  test('accepts and normalizes the Step 1 orientation field shape', async () => {
    const saved = await store.save('ws-1', {
      model: 'm',
      narrative: sampleNarrative(),
      orientation: [
        { identifier: 'LIN-301', bearing: 'N', reason: 'core', archived: false },
        { identifier: 'LIN-300', bearing: 'S', reason: 'tangent', archived: true, extra: 'dropped' }
      ]
    });
    assert.strictEqual(saved.orientation.length, 2);
    assert.deepStrictEqual(saved.orientation[0], {
      identifier: 'LIN-301', bearing: 'N', reason: 'core', archived: false
    });
    assert.strictEqual(saved.orientation[1].archived, true);
    assert.strictEqual(saved.orientation[1].extra, undefined);
  });
});

describe('ReportHistoryStore.list', () => {
  let store;
  beforeEach(() => { store = new ReportHistoryStore({ collection: createMockCollection() }); });

  test('returns newest-first', async () => {
    const a = await store.save('ws-1', { model: 'm', narrative: sampleNarrative('a') });
    store.collection._docs.find(d => d._id === a.id).generatedAt = new Date(Date.now() - 10000);
    const b = await store.save('ws-1', { model: 'm', narrative: sampleNarrative('b') });

    const { items, total } = await store.list('ws-1');
    assert.strictEqual(total, 2);
    assert.strictEqual(items[0].id, b.id);
    assert.strictEqual(items[1].id, a.id);
  });

  test('respects limit', async () => {
    for (let i = 0; i < 3; i++) await store.save('ws-1', { model: 'm', narrative: sampleNarrative(String(i)) });
    const { items, total } = await store.list('ws-1', { limit: 1 });
    assert.strictEqual(total, 3);
    assert.strictEqual(items.length, 1);
  });

  test('scopes by workspace', async () => {
    await store.save('ws-1', { model: 'm', narrative: sampleNarrative() });
    assert.strictEqual((await store.list('ws-2')).total, 0);
  });
});

describe('ReportHistoryStore capacity cap', () => {
  test('prunes to the newest N when the cap is exceeded', async () => {
    const store = new ReportHistoryStore({ collection: createMockCollection(), maxReports: 3 });
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const r = await store.save('ws-1', { model: 'm', narrative: sampleNarrative(String(i)) });
      ids.push(r.id);
      // Small real delay so each generatedAt is strictly later, making the
      // newest-first prune order deterministic (the prune runs inside save()).
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const { items, total } = await store.list('ws-1');
    assert.strictEqual(total, 3);
    const survivingIds = items.map(r => r.id);
    assert.ok(!survivingIds.includes(ids[0])); // two oldest pruned
    assert.ok(!survivingIds.includes(ids[1]));
    assert.ok(survivingIds.includes(ids[4]));  // newest kept
  });
});

describe('ReportHistoryStore.clear', () => {
  test('removes all docs for a workspace only', async () => {
    const store = new ReportHistoryStore({ collection: createMockCollection() });
    await store.save('ws-1', { model: 'm', narrative: sampleNarrative() });
    await store.save('ws-2', { model: 'm', narrative: sampleNarrative() });
    await store.clear('ws-1');
    assert.strictEqual((await store.list('ws-1')).total, 0);
    assert.strictEqual((await store.list('ws-2')).total, 1);
  });
});
