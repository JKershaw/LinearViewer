/**
 * Unit tests for lib/run-proposals-store.js (LIN-3254 S4).
 *
 * Run with: node --test tests/unit/run-proposals-store.test.js
 *
 * Exercises the real RunProposalsStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface (the same harness shape
 * tests/unit/saved-chat-store.test.js uses). Covers the behaviours beat 2
 * calls out: create/list/get, cross-workspace isolation, the compare-and-set
 * (dispatch-once) guard, decline-after-apply, the prompt cap and the
 * write-time secret scan.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RunProposalsStore } from '../../lib/run-proposals-store.js';
import { MAX_PROMPT_LENGTH } from '../../lib/dispatch-validation.js';

// Minimal in-memory mock of the collection surface the store uses. Supports the
// equality predicates the store issues: _id, urlKey, runId, status.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.runId !== undefined && doc.runId !== query.runId) return false;
    if (query.status !== undefined && doc.status !== query.status) return false;
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
      Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
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

const URL_KEY = 'acme';
const OTHER_KEY = 'globex';
const RUN_ID = 'run-1';

const base = { urlKey: URL_KEY, runId: RUN_ID, stepLoopId: 'loop-9', prompt: 'add a test' };

describe('RunProposalsStore (LIN-3254)', () => {
  let collection;
  let store;

  beforeEach(() => {
    collection = createMockCollection();
    store = new RunProposalsStore({ collection });
  });

  test('create → get round-trips the schema and defaults to proposed', async () => {
    const created = await store.create(base);

    assert.ok(created.id);
    assert.strictEqual(created.urlKey, URL_KEY);
    assert.strictEqual(created.runId, RUN_ID);
    assert.strictEqual(created.stepLoopId, 'loop-9');
    assert.strictEqual(created.prompt, 'add a test');
    assert.strictEqual(created.status, 'proposed');
    assert.ok(created.proposedAt);
    assert.strictEqual(created.decidedAt, null);
    assert.strictEqual(created.appliedItemId, null);

    const fetched = await store.get(URL_KEY, RUN_ID, created.id);
    assert.deepStrictEqual(fetched, created);
  });

  test('create rejects a missing urlKey / runId / empty prompt', async () => {
    await assert.rejects(() => store.create({ runId: RUN_ID, prompt: 'p' }), /urlKey is required/);
    await assert.rejects(() => store.create({ urlKey: URL_KEY, prompt: 'p' }), /runId is required/);
    await assert.rejects(() => store.create({ urlKey: URL_KEY, runId: RUN_ID, prompt: '   ' }), /non-empty prompt/);
  });

  test('list returns only the run\'s proposals, newest-first', async () => {
    const first = await store.create({ ...base, prompt: 'first' });
    await new Promise((r) => setTimeout(r, 2));
    const second = await store.create({ ...base, prompt: 'second' });

    const rows = await store.list(URL_KEY, RUN_ID);
    assert.deepStrictEqual(rows.map(r => r.id), [second.id, first.id]);

    assert.deepStrictEqual(await store.list(URL_KEY, 'other-run'), []);
    assert.deepStrictEqual(await store.list(OTHER_KEY, RUN_ID), []);
  });

  test('every read/write is scoped by urlKey — another workspace never sees the row', async () => {
    const created = await store.create(base);

    assert.strictEqual(await store.get(OTHER_KEY, RUN_ID, created.id), null);
    assert.strictEqual(await store.apply(OTHER_KEY, RUN_ID, created.id, 'item-x'), null);
    assert.strictEqual(await store.decline(OTHER_KEY, RUN_ID, created.id), null);
    // Still proposed under its own workspace.
    assert.strictEqual((await store.get(URL_KEY, RUN_ID, created.id)).status, 'proposed');
  });

  test('every read/write is scoped by runId too', async () => {
    const created = await store.create(base);

    assert.strictEqual(await store.get(URL_KEY, 'other-run', created.id), null);
    assert.strictEqual(await store.apply(URL_KEY, 'other-run', created.id, 'item-x'), null);
  });

  test('apply compare-and-sets proposed → applied once; a second apply fails', async () => {
    const created = await store.create(base);

    const applied = await store.apply(URL_KEY, RUN_ID, created.id, 'dispatch-1');
    assert.strictEqual(applied.status, 'applied');
    assert.strictEqual(applied.appliedItemId, 'dispatch-1');
    assert.ok(applied.decidedAt);

    const again = await store.apply(URL_KEY, RUN_ID, created.id, 'dispatch-2');
    assert.strictEqual(again, null, 'a double Apply must not match the now-applied row');

    const stored = await store.get(URL_KEY, RUN_ID, created.id);
    assert.strictEqual(stored.appliedItemId, 'dispatch-1', 'the second dispatch id never lands');
  });

  test('decline compare-and-sets proposed → declined once; a second decline fails', async () => {
    const created = await store.create(base);

    const declined = await store.decline(URL_KEY, RUN_ID, created.id);
    assert.strictEqual(declined.status, 'declined');
    assert.strictEqual(declined.appliedItemId, null);
    assert.ok(declined.decidedAt);

    assert.strictEqual(await store.decline(URL_KEY, RUN_ID, created.id), null);
  });

  test('decline after apply fails (the row is no longer proposed)', async () => {
    const created = await store.create(base);
    await store.apply(URL_KEY, RUN_ID, created.id, 'dispatch-1');

    assert.strictEqual(await store.decline(URL_KEY, RUN_ID, created.id), null);
    assert.strictEqual((await store.get(URL_KEY, RUN_ID, created.id)).status, 'applied');
  });

  test('apply after decline fails', async () => {
    const created = await store.create(base);
    await store.decline(URL_KEY, RUN_ID, created.id);

    assert.strictEqual(await store.apply(URL_KEY, RUN_ID, created.id, 'dispatch-1'), null);
    assert.strictEqual((await store.get(URL_KEY, RUN_ID, created.id)).status, 'declined');
  });

  test('a prompt over the follow-up path\'s cap is rejected on write, nothing stored', async () => {
    const tooLong = 'x'.repeat(MAX_PROMPT_LENGTH + 1);

    await assert.rejects(() => store.create({ ...base, prompt: tooLong }),
      /prompt exceeds maximum length/);
    assert.strictEqual(collection._docs.length, 0);
  });

  test('a prompt that scans as a secret is rejected on write, nothing stored', async () => {
    const secret = `please use ghp_${'a'.repeat(36)} to push`;

    await assert.rejects(() => store.create({ ...base, prompt: secret }), /looks like a secret/);
    assert.strictEqual(collection._docs.length, 0, 'a rejected proposal is never stored');
  });

  test('clear removes a workspace\'s proposals', async () => {
    await store.create(base);
    await store.create({ ...base, urlKey: OTHER_KEY });

    assert.strictEqual(await store.clear(URL_KEY), 1);
    assert.deepStrictEqual(await store.list(URL_KEY, RUN_ID), []);
    assert.strictEqual((await store.list(OTHER_KEY, RUN_ID)).length, 1);
  });
});
