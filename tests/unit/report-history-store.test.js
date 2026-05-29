/**
 * Unit tests for lib/report-history-store.js
 *
 * Run with: node --test tests/unit/report-history-store.test.js
 *
 * Exercises the real ReportHistoryStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface, so the production cap/TTL/prune logic
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
    if (query.expiresAt?.$lt !== undefined && !(doc.expiresAt < query.expiresAt.$lt)) return false;
    if (query.expiresAt?.$gt !== undefined && !(doc.expiresAt > query.expiresAt.$gt)) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id };
    },
    async findOne(query) {
      return docs.find(d => matches(d, query)) || null;
    },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async updateOne(query, update) {
      const doc = docs.find(d => matches(d, query));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
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

describe('ReportHistoryStore.save / get', () => {
  let store;
  beforeEach(() => { store = new ReportHistoryStore({ collection: createMockCollection() }); });

  test('save round-trips through get', async () => {
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

    const got = await store.get('ws-1', saved.id);
    assert.strictEqual(got.id, saved.id);
    assert.strictEqual(got.narrative.gap, 'gap a');
    // ISO timestamps in the public record shape
    assert.match(got.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('defaults northStar to "" and orientation to []', async () => {
    const saved = await store.save('ws-1', { model: 'm', narrative: sampleNarrative() });
    assert.strictEqual(saved.northStar, '');
    assert.deepStrictEqual(saved.orientation, []);
  });

  test('normalizes a complete narrative (missing layers -> null)', async () => {
    const saved = await store.save('ws-1', { model: 'm', narrative: { technical: 'only tech' } });
    assert.strictEqual(saved.narrative.technical, 'only tech');
    assert.strictEqual(saved.narrative.product, null);
    assert.strictEqual(saved.narrative.gap, null);
  });

  test('get returns null for missing ids', async () => {
    assert.strictEqual(await store.get('ws-1', 'nope'), null);
  });

  test('scopes by workspace', async () => {
    const saved = await store.save('ws-1', { model: 'm', narrative: sampleNarrative() });
    assert.strictEqual(await store.get('ws-2', saved.id), null);
  });
});

describe('ReportHistoryStore.list', () => {
  let store;
  beforeEach(() => { store = new ReportHistoryStore({ collection: createMockCollection() }); });

  test('returns newest-first', async () => {
    const a = await store.save('ws-1', { model: 'm', narrative: sampleNarrative('a') });
    // Force a strictly later timestamp on the second record.
    store.collection._docs.find(d => d._id === a.id).generatedAt = new Date(Date.now() - 10000);
    const b = await store.save('ws-1', { model: 'm', narrative: sampleNarrative('b') });

    const { items, total } = await store.list('ws-1');
    assert.strictEqual(total, 2);
    assert.strictEqual(items[0].id, b.id); // newest first
    assert.strictEqual(items[1].id, a.id);
  });

  test('respects limit', async () => {
    for (let i = 0; i < 3; i++) await store.save('ws-1', { model: 'm', narrative: sampleNarrative(String(i)) });
    const { items, total } = await store.list('ws-1', { limit: 1 });
    assert.strictEqual(total, 3);
    assert.strictEqual(items.length, 1);
  });

  test('filters out expired records', async () => {
    const saved = await store.save('ws-1', { model: 'm', narrative: sampleNarrative() });
    // Manually expire it.
    store.collection._docs.find(d => d._id === saved.id).expiresAt = new Date(Date.now() - 1000);
    const { items, total } = await store.list('ws-1');
    assert.strictEqual(total, 0);
    assert.strictEqual(items.length, 0);
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
    const { total } = await store.list('ws-1');
    assert.strictEqual(total, 3);
    // The two oldest should have been pruned.
    assert.strictEqual(await store.get('ws-1', ids[0]), null);
    assert.strictEqual(await store.get('ws-1', ids[1]), null);
    assert.ok(await store.get('ws-1', ids[4]));
  });
});

describe('ReportHistoryStore.setOrientation (Step 1 contract)', () => {
  let store;
  beforeEach(() => { store = new ReportHistoryStore({ collection: createMockCollection() }); });

  test('writes and normalizes per-task bearings', async () => {
    const saved = await store.save('ws-1', { model: 'm', narrative: sampleNarrative() });
    const updated = await store.setOrientation('ws-1', saved.id, [
      { identifier: 'LIN-301', bearing: 'toward', reason: 'core', archived: false },
      { identifier: 'LIN-300', bearing: 'away', reason: 'tangent', archived: true, extra: 'dropped' }
    ]);
    assert.strictEqual(updated.orientation.length, 2);
    assert.deepStrictEqual(updated.orientation[0], {
      identifier: 'LIN-301', bearing: 'toward', reason: 'core', archived: false
    });
    assert.strictEqual(updated.orientation[1].archived, true);
    assert.strictEqual(updated.orientation[1].extra, undefined);
  });

  test('returns null for a missing report', async () => {
    assert.strictEqual(await store.setOrientation('ws-1', 'nope', []), null);
  });
});

describe('ReportHistoryStore.cleanup / clear', () => {
  test('cleanup removes only expired docs', async () => {
    const store = new ReportHistoryStore({ collection: createMockCollection() });
    const live = await store.save('ws-1', { model: 'm', narrative: sampleNarrative() });
    const dead = await store.save('ws-1', { model: 'm', narrative: sampleNarrative() });
    store.collection._docs.find(d => d._id === dead.id).expiresAt = new Date(Date.now() - 1000);

    const removed = await store.cleanup();
    assert.strictEqual(removed, 1);
    assert.ok(await store.get('ws-1', live.id));
  });

  test('clear removes all docs for a workspace', async () => {
    const store = new ReportHistoryStore({ collection: createMockCollection() });
    await store.save('ws-1', { model: 'm', narrative: sampleNarrative() });
    await store.save('ws-2', { model: 'm', narrative: sampleNarrative() });
    await store.clear('ws-1');
    assert.strictEqual((await store.list('ws-1')).total, 0);
    assert.strictEqual((await store.list('ws-2')).total, 1);
  });
});
