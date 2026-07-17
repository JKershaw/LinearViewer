/**
 * Unit tests for lib/dispatch-presets-store.js (LIN-1390 S1)
 *
 * Run with: node --test tests/unit/dispatch-presets-store.test.js
 *
 * Exercises the real DispatchPresetsStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface: create/list/get/update/delete,
 * per-urlKey isolation, the custom cap-N throw, config shape validation, and
 * that (unlike collective presets) there is no builtin half to merge/protect.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DispatchPresetsStore } from '../../lib/dispatch-presets-store.js';

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
    async updateOne(query, update) {
      const doc = docs.find(d => matches(d, query));
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1 };
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
    },
  };
}

const URL_KEY = 'ws-1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function presetInput(overrides = {}) {
  return {
    name: 'My Preset',
    config: { model: 'anthropic/claude-opus-4.8', harness: 'opencode' },
    ...overrides,
  };
}

describe('DispatchPresetsStore (LIN-1390 S1)', () => {
  let collection;
  let store;

  beforeEach(() => {
    collection = createMockCollection();
    store = new DispatchPresetsStore({ collection });
  });

  test('createCustom -> get round-trips name/config, UUID id, no kind field', async () => {
    const created = await store.createCustom(URL_KEY, presetInput());
    assert.ok(UUID_RE.test(created.id), 'id is a UUID');
    assert.strictEqual(created.name, 'My Preset');
    assert.deepStrictEqual(created.config, { model: 'anthropic/claude-opus-4.8', harness: 'opencode' });

    const fetched = await store.get(URL_KEY, created.id);
    assert.strictEqual(fetched.id, created.id);
    assert.strictEqual(fetched.name, 'My Preset');
  });

  test('createCustom defaults config to {} when omitted', async () => {
    const created = await store.createCustom(URL_KEY, { name: 'Bare' });
    assert.deepStrictEqual(created.config, {});
  });

  test('list() returns only custom rows — no builtin half', async () => {
    await store.createCustom(URL_KEY, presetInput());
    const list = await store.list(URL_KEY);
    assert.strictEqual(list.length, 1);
  });

  test('list() with no urlKey returns empty (no builtins to fall back to)', async () => {
    const list = await store.list('');
    assert.deepStrictEqual(list, []);
  });

  test('per-urlKey isolation: list only returns the workspace partition', async () => {
    await store.createCustom(URL_KEY, presetInput({ name: 'A' }));
    await store.createCustom('other-workspace', presetInput({ name: 'B' }));
    const list = await store.list(URL_KEY);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, 'A');
  });

  test('createCustom caps at maxCustom and throws on overflow', async () => {
    store = new DispatchPresetsStore({ collection, maxCustom: 3 });
    for (let i = 0; i < 3; i++) {
      await store.createCustom(URL_KEY, presetInput({ name: `p-${i}` }));
    }
    await assert.rejects(
      () => store.createCustom(URL_KEY, presetInput({ name: 'p-overflow' })),
      /maximum of 3/
    );
    const list = await store.list(URL_KEY);
    assert.strictEqual(list.length, 3);
  });

  test('createCustom requires urlKey', async () => {
    await assert.rejects(() => store.createCustom('', presetInput()), /urlKey is required/);
  });

  test('createCustom rejects missing/blank name', async () => {
    await assert.rejects(() => store.createCustom(URL_KEY, presetInput({ name: '' })), /Name is required/);
    await assert.rejects(() => store.createCustom(URL_KEY, presetInput({ name: '   ' })), /Name is required/);
  });

  test('createCustom rejects an over-long name', async () => {
    await assert.rejects(
      () => store.createCustom(URL_KEY, presetInput({ name: 'x'.repeat(51) })),
      /50 characters or less/
    );
  });

  test('createCustom rejects a non-object config', async () => {
    await assert.rejects(() => store.createCustom(URL_KEY, presetInput({ config: 'nope' })), /config must be an object/);
    await assert.rejects(() => store.createCustom(URL_KEY, presetInput({ config: [] })), /config must be an object/);
  });

  test('createCustom rejects non-string model/harness and non-object byKind', async () => {
    await assert.rejects(() => store.createCustom(URL_KEY, presetInput({ config: { model: 5 } })), /config.model must be a string/);
    await assert.rejects(() => store.createCustom(URL_KEY, presetInput({ config: { harness: 5 } })), /config.harness must be a string/);
    await assert.rejects(() => store.createCustom(URL_KEY, presetInput({ config: { byKind: 'nope' } })), /config.byKind must be an object/);
  });

  test('update() point-writes name/config and returns the updated record', async () => {
    const created = await store.createCustom(URL_KEY, presetInput());
    const updated = await store.update(URL_KEY, created.id, { name: 'Renamed', config: { model: 'x' } });
    assert.strictEqual(updated.name, 'Renamed');
    assert.deepStrictEqual(updated.config, { model: 'x' });

    const fetched = await store.get(URL_KEY, created.id);
    assert.strictEqual(fetched.name, 'Renamed');
  });

  test('update() with a partial payload leaves the omitted field unchanged', async () => {
    const created = await store.createCustom(URL_KEY, presetInput({ name: 'Original', config: { model: 'm', harness: 'h' } }));
    const updated = await store.update(URL_KEY, created.id, { config: { model: 'm2' } });
    assert.strictEqual(updated.name, 'Original');
    assert.deepStrictEqual(updated.config, { model: 'm2' });
  });

  test('update() returns null for an unknown id or cross-workspace id', async () => {
    const created = await store.createCustom(URL_KEY, presetInput());
    assert.strictEqual(await store.update(URL_KEY, 'no-such-id', { name: 'x' }), null);
    assert.strictEqual(await store.update('other-workspace', created.id, { name: 'x' }), null);
  });

  test('update() re-validates and rejects an invalid name/config', async () => {
    const created = await store.createCustom(URL_KEY, presetInput());
    await assert.rejects(() => store.update(URL_KEY, created.id, { name: '' }), /Name is required/);
    await assert.rejects(() => store.update(URL_KEY, created.id, { config: 'nope' }), /config must be an object/);
  });

  test('delete removes a preset; deleteAll clears the partition', async () => {
    const a = await store.createCustom(URL_KEY, presetInput({ name: 'A' }));
    await store.createCustom(URL_KEY, presetInput({ name: 'B' }));

    assert.strictEqual(await store.delete(URL_KEY, a.id), true);
    assert.strictEqual(await store.get(URL_KEY, a.id), null);

    await store.deleteAll(URL_KEY);
    const list = await store.list(URL_KEY);
    assert.strictEqual(list.length, 0);
  });

  test('delete returns false for an unknown id', async () => {
    assert.strictEqual(await store.delete(URL_KEY, 'no-such-id'), false);
  });
});
