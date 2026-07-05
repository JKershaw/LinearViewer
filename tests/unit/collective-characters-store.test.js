/**
 * Unit tests for lib/collective-characters-store.js (LIN-1048)
 *
 * Run with: node --test tests/unit/collective-characters-store.test.js
 *
 * Exercises the real CollectiveCharactersStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface. Mirrors the custom-prompts store's
 * guarantees plus this store's own dimensions: UUID ids, per-urlKey isolation,
 * the custom cap-20 throw, the recent rolling-evict, the kind field, deleteAll,
 * and the custom↔recent identity rules (no double-list; save promotes in place).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { CollectiveCharactersStore } from '../../lib/collective-characters-store.js';

// Minimal in-memory mock of the collection surface the store uses: insertOne,
// find().toArray(), findOne, updateOne({$set}), deleteOne, deleteMany. Matches on
// the equality predicates the store issues (_id, urlKey).
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
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
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

const URL_KEY = 'anchor-workspace';
const REPO = 'bound-repo';

function character(overrides = {}) {
  return {
    workspaceUrlKey: REPO,
    workspaceName: 'Bound Repo',
    name: 'Skeptic',
    role: 'Skeptic',
    lens: 'what could go wrong',
    objective: 'find the flaw',
    value: 'healthy doubt',
    disposition: 'probing',
    ...overrides,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('CollectiveCharactersStore (LIN-1048)', () => {
  let collection;
  let store;

  beforeEach(() => {
    collection = createMockCollection();
    store = new CollectiveCharactersStore({ collection });
  });

  test('createCustom → get round-trips all five persona fields + binding, UUID id', async () => {
    const created = await store.createCustom(URL_KEY, character());
    assert.ok(UUID_RE.test(created.id), 'id is a UUID');
    assert.strictEqual(created.kind, 'custom');
    assert.strictEqual(created.workspaceUrlKey, REPO);
    assert.strictEqual(created.value, 'healthy doubt'); // the fifth field is not dropped
    for (const f of ['role', 'lens', 'objective', 'value', 'disposition']) {
      assert.ok(created[f], `persona field ${f} present`);
    }
    const fetched = await store.get(URL_KEY, created.id);
    assert.strictEqual(fetched.id, created.id);
    assert.strictEqual(fetched.value, 'healthy doubt');
  });

  test('never stores a proxy token', async () => {
    const created = await store.createCustom(URL_KEY, { ...character(), proxyToken: 'lin_secret' });
    assert.strictEqual(created.proxyToken, undefined);
    assert.strictEqual(collection._docs[0].proxyToken, undefined);
  });

  test('per-urlKey isolation: list only returns the workspace partition', async () => {
    await store.createCustom(URL_KEY, character({ role: 'A' }));
    await store.createCustom('other-workspace', character({ role: 'B' }));
    const list = await store.list(URL_KEY);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].role, 'A');
  });

  test('createCustom caps at 20 and throws on overflow', async () => {
    store = new CollectiveCharactersStore({ collection, maxCustom: 20 });
    for (let i = 0; i < 20; i++) {
      await store.createCustom(URL_KEY, character({ role: `role-${i}`, name: `n-${i}` }));
    }
    await assert.rejects(
      () => store.createCustom(URL_KEY, character({ role: 'role-21', name: 'n-21' })),
      /maximum of 20/
    );
    assert.strictEqual((await store.list(URL_KEY)).length, 20);
  });

  test('recordRecent keeps a rolling window and evicts the oldest', async () => {
    store = new CollectiveCharactersStore({ collection, maxRecent: 10 });
    const ids = [];
    for (let i = 0; i < 12; i++) {
      const rec = await store.recordRecent(URL_KEY, character({ role: `recent-${i}`, name: `r-${i}` }));
      ids.push(rec.id);
    }
    const list = await store.list(URL_KEY);
    assert.strictEqual(list.length, 10, 'window holds at most 10 recents');
    const remaining = new Set(list.map(c => c.id));
    // The two oldest were evicted; the newest survives.
    assert.ok(!remaining.has(ids[0]));
    assert.ok(!remaining.has(ids[1]));
    assert.ok(remaining.has(ids[11]));
    assert.ok(list.every(c => c.kind === 'recent'));
  });

  test('recordRecent never throws (missing binding → null, no insert)', async () => {
    const result = await store.recordRecent(URL_KEY, { role: 'no-repo' });
    assert.strictEqual(result, null);
    assert.strictEqual((await store.list(URL_KEY)).length, 0);
  });

  test('recordRecent dedupes by identity — a repeat touch does not double-list', async () => {
    const first = await store.recordRecent(URL_KEY, character());
    const second = await store.recordRecent(URL_KEY, character());
    assert.strictEqual(first.id, second.id, 'same identity → same record');
    assert.strictEqual((await store.list(URL_KEY)).length, 1);
  });

  test('saving a recent promotes it to custom in place (no double-list)', async () => {
    const recent = await store.recordRecent(URL_KEY, character());
    assert.strictEqual(recent.kind, 'recent');
    const saved = await store.createCustom(URL_KEY, character());
    assert.strictEqual(saved.id, recent.id, 'same identity → same record, flipped kind');
    assert.strictEqual(saved.kind, 'custom');
    const list = await store.list(URL_KEY);
    assert.strictEqual(list.length, 1, 'promotion does not create a second row');
    assert.strictEqual(list[0].kind, 'custom');
  });

  test('a saved custom does not count a later recordRecent as a new recent', async () => {
    store = new CollectiveCharactersStore({ collection, maxRecent: 10 });
    const saved = await store.createCustom(URL_KEY, character());
    const recorded = await store.recordRecent(URL_KEY, character()); // dispatched the saved one
    assert.strictEqual(recorded.id, saved.id);
    assert.strictEqual(recorded.kind, 'custom', 'stays custom — a dispatch does not demote it');
    assert.strictEqual((await store.list(URL_KEY)).length, 1);
  });

  test('delete removes a single character; deleteAll clears the partition', async () => {
    const a = await store.createCustom(URL_KEY, character({ role: 'A', name: 'A' }));
    await store.createCustom(URL_KEY, character({ role: 'B', name: 'B' }));

    assert.strictEqual(await store.delete(URL_KEY, a.id), true);
    assert.strictEqual(await store.get(URL_KEY, a.id), null);
    assert.strictEqual((await store.list(URL_KEY)).length, 1);

    assert.strictEqual(await store.deleteAll(URL_KEY), true);
    assert.strictEqual((await store.list(URL_KEY)).length, 0);
    assert.strictEqual(collection._docs.length, 0);
  });

  test('createCustom requires urlKey and a workspaceUrlKey binding', async () => {
    await assert.rejects(() => store.createCustom('', character()), /urlKey is required/);
    await assert.rejects(() => store.createCustom(URL_KEY, { role: 'x' }), /workspaceUrlKey is required/);
  });
});
