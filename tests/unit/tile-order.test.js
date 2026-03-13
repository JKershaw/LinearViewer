/**
 * Unit tests for tile order in UserPreferencesStore
 *
 * Run with: node --test tests/unit/tile-order.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { UserPreferencesStore } from '../../lib/user-preferences.js';

// =============================================================================
// In-memory collection mock (MangoDB-compatible interface)
// =============================================================================

function createMockCollection() {
  let docs = [];

  return {
    async insertOne(doc) {
      docs.push({ ...doc });
      return { insertedId: doc._id };
    },
    async findOne(query) {
      return docs.find(d => {
        return Object.keys(query).every(k => d[k] === query[k]);
      }) || null;
    },
    async updateOne(query, update, options = {}) {
      const idx = docs.findIndex(d => {
        return Object.keys(query).every(k => d[k] === query[k]);
      });
      if (idx === -1 && options.upsert) {
        const newDoc = { ...query };
        if (update.$set) Object.assign(newDoc, update.$set);
        if (update.$setOnInsert) Object.assign(newDoc, update.$setOnInsert);
        docs.push(newDoc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => {
        return Object.keys(query).every(k => d[k] === query[k]);
      });
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    _docs: () => docs,
    _clear: () => { docs = []; }
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('UserPreferencesStore - Tile Order', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new UserPreferencesStore({ collection });
  });

  describe('getTileOrder()', () => {
    test('returns empty array when no preferences exist', async () => {
      const order = await store.getTileOrder('user-1');
      assert.deepStrictEqual(order, []);
    });

    test('returns empty array when preferences exist but no tileOrder', async () => {
      await store.saveUserPreferences('user-1', { modelId: 'test-model' });
      const order = await store.getTileOrder('user-1');
      assert.deepStrictEqual(order, []);
    });

    test('returns empty array when tileOrder is not an array', async () => {
      await store.saveUserPreferences('user-1', { tileOrder: 'invalid' });
      const order = await store.getTileOrder('user-1');
      assert.deepStrictEqual(order, []);
    });

    test('returns saved tile order', async () => {
      const expected = ['3000', 'bm_abc123', '8080'];
      await store.saveUserPreferences('user-1', { tileOrder: expected });
      const order = await store.getTileOrder('user-1');
      assert.deepStrictEqual(order, expected);
    });
  });

  describe('setTileOrder()', () => {
    test('persists tile order for new user', async () => {
      const order = ['3000', '8080'];
      const result = await store.setTileOrder('user-1', order);
      assert.strictEqual(result, true);

      const retrieved = await store.getTileOrder('user-1');
      assert.deepStrictEqual(retrieved, order);
    });

    test('preserves existing preferences when setting tile order', async () => {
      await store.saveUserPreferences('user-1', { modelId: 'test-model', features: { dispatch: true } });
      await store.setTileOrder('user-1', ['3000', '8080']);

      const prefs = await store.getUserPreferences('user-1');
      assert.strictEqual(prefs.modelId, 'test-model');
      assert.deepStrictEqual(prefs.features, { dispatch: true });
      assert.deepStrictEqual(prefs.tileOrder, ['3000', '8080']);
    });

    test('overwrites previous tile order', async () => {
      await store.setTileOrder('user-1', ['3000', '8080']);
      await store.setTileOrder('user-1', ['8080', '3000', 'bm_new']);

      const order = await store.getTileOrder('user-1');
      assert.deepStrictEqual(order, ['8080', '3000', 'bm_new']);
    });

    test('can set empty array', async () => {
      await store.setTileOrder('user-1', ['3000']);
      await store.setTileOrder('user-1', []);

      const order = await store.getTileOrder('user-1');
      assert.deepStrictEqual(order, []);
    });
  });
});
