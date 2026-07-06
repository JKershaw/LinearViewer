/**
 * Unit tests for lib/collective-presets-store.js (LIN-1050, S4)
 *
 * Run with: node --test tests/unit/collective-presets-store.test.js
 *
 * Exercises the real CollectivePresetsStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface: create/list/get/delete, per-urlKey
 * isolation, the custom cap-N throw, the seat-cap + facilitator validation
 * at save time, rejecting invalid presets, and that built-ins are merged
 * into list() but are neither stored rows nor deletable.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { CollectivePresetsStore } from '../../lib/collective-presets-store.js';
import { BUILTIN_PRESETS, MAX_PRESET_SEATS } from '../../lib/collective-preset-defs.js';

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
    },
  };
}

const URL_KEY = 'anchor-workspace';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function roster(overrides = {}) {
  return [
    { name: 'Chair', role: 'r', lens: 'l', objective: 'o', value: 'v', disposition: 'd', isFacilitator: true },
    { name: 'Voice', role: 'r2', lens: 'l2', objective: 'o2', value: 'v2', disposition: 'd2' },
    ...(overrides.extraSeats || []),
  ];
}

function preset(overrides = {}) {
  return {
    name: 'My Preset',
    objective: 'do the thing',
    exitCondition: 'thing is done',
    defaultTopic: 'the thing',
    roster: roster(),
    ...overrides,
  };
}

describe('CollectivePresetsStore (LIN-1050)', () => {
  let collection;
  let store;

  beforeEach(() => {
    collection = createMockCollection();
    store = new CollectivePresetsStore({ collection });
  });

  test('createCustom -> get round-trips the bundle, UUID id, kind custom', async () => {
    const created = await store.createCustom(URL_KEY, preset());
    assert.ok(UUID_RE.test(created.id), 'id is a UUID');
    assert.strictEqual(created.kind, 'custom');
    assert.strictEqual(created.name, 'My Preset');
    assert.strictEqual(created.roster.length, 2);

    const fetched = await store.get(URL_KEY, created.id);
    assert.strictEqual(fetched.id, created.id);
    assert.strictEqual(fetched.objective, 'do the thing');
  });

  test('list() merges BUILTIN_PRESETS with custom rows', async () => {
    await store.createCustom(URL_KEY, preset());
    const list = await store.list(URL_KEY);
    assert.strictEqual(list.length, BUILTIN_PRESETS.length + 1);
    for (const b of BUILTIN_PRESETS) {
      assert.ok(list.some(p => p.id === b.id), `${b.name} present in list`);
    }
  });

  test('list() with no urlKey still returns built-ins', async () => {
    const list = await store.list('');
    assert.strictEqual(list.length, BUILTIN_PRESETS.length);
  });

  test('get() resolves a builtin: id to the frozen constant', async () => {
    const b = BUILTIN_PRESETS[0];
    const fetched = await store.get(URL_KEY, b.id);
    assert.strictEqual(fetched, b);
  });

  test('per-urlKey isolation: list only returns the workspace partition (plus built-ins)', async () => {
    await store.createCustom(URL_KEY, preset({ name: 'A' }));
    await store.createCustom('other-workspace', preset({ name: 'B' }));
    const list = await store.list(URL_KEY);
    const custom = list.filter(p => p.kind === 'custom');
    assert.strictEqual(custom.length, 1);
    assert.strictEqual(custom[0].name, 'A');
  });

  test('createCustom caps at maxCustom and throws on overflow', async () => {
    store = new CollectivePresetsStore({ collection, maxCustom: 3 });
    for (let i = 0; i < 3; i++) {
      await store.createCustom(URL_KEY, preset({ name: `p-${i}` }));
    }
    await assert.rejects(
      () => store.createCustom(URL_KEY, preset({ name: 'p-overflow' })),
      /maximum of 3/
    );
    const custom = (await store.list(URL_KEY)).filter(p => p.kind === 'custom');
    assert.strictEqual(custom.length, 3);
  });

  test('createCustom rejects a roster over MAX_PRESET_SEATS', async () => {
    const bigRoster = Array.from({ length: MAX_PRESET_SEATS + 1 }, (_, i) => ({
      name: `n${i}`, role: 'r', lens: 'l', objective: 'o', value: 'v', disposition: 'd',
      isFacilitator: i === 0,
    }));
    await assert.rejects(
      () => store.createCustom(URL_KEY, preset({ roster: bigRoster })),
      /between 1 and/
    );
  });

  test('createCustom rejects zero or multiple facilitators', async () => {
    await assert.rejects(
      () => store.createCustom(URL_KEY, preset({ roster: roster().map(s => ({ ...s, isFacilitator: false })) })),
      /exactly one facilitator/
    );
    await assert.rejects(
      () => store.createCustom(URL_KEY, preset({ roster: roster().map(s => ({ ...s, isFacilitator: true })) })),
      /exactly one facilitator/
    );
  });

  test('createCustom rejects a seat carrying a workspaceUrlKey', async () => {
    const bound = roster();
    bound[0] = { ...bound[0], workspaceUrlKey: 'some-repo' };
    await assert.rejects(
      () => store.createCustom(URL_KEY, preset({ roster: bound })),
      /repo-agnostic/
    );
  });

  test('createCustom rejects missing meeting fields', async () => {
    await assert.rejects(() => store.createCustom(URL_KEY, preset({ name: '' })), /name/);
    await assert.rejects(() => store.createCustom(URL_KEY, preset({ objective: '' })), /objective/);
    await assert.rejects(() => store.createCustom(URL_KEY, preset({ exitCondition: '' })), /exitCondition/);
    await assert.rejects(() => store.createCustom(URL_KEY, preset({ defaultTopic: '' })), /defaultTopic/);
  });

  test('createCustom requires urlKey', async () => {
    await assert.rejects(() => store.createCustom('', preset()), /urlKey is required/);
  });

  test('delete removes a custom preset; deleteAll clears the partition (never touches built-ins)', async () => {
    const a = await store.createCustom(URL_KEY, preset({ name: 'A' }));
    await store.createCustom(URL_KEY, preset({ name: 'B' }));

    assert.strictEqual(await store.delete(URL_KEY, a.id), true);
    assert.strictEqual(await store.get(URL_KEY, a.id), null);

    await store.deleteAll(URL_KEY);
    const list = await store.list(URL_KEY);
    assert.strictEqual(list.length, BUILTIN_PRESETS.length, 'only built-ins remain');
  });

  test('delete no-ops on a builtin: id', async () => {
    const b = BUILTIN_PRESETS[0];
    const result = await store.delete(URL_KEY, b.id);
    assert.strictEqual(result, false);
    const list = await store.list(URL_KEY);
    assert.ok(list.some(p => p.id === b.id), 'built-in survives the delete call');
  });
});
