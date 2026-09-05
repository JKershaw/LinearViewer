/**
 * Unit tests for lib/harbour-comments-store.js (LIN-2648, WS1 of LIN-2241)
 *
 * Run with: node --test tests/unit/harbour-comments-store.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { HarbourCommentsStore } from '../../lib/harbour-comments-store.js';

// Modelled on tests/unit/shelved-rulings-store.test.js's hand-rolled mock
// collection, extended to support $setOnInsert (record()'s idempotent
// first-write semantics) and an $in filter on an arbitrary field (LIN-2664 F1:
// wereRecordedByHarbour's batch read filters on `_id` — the `${urlKey}::${commentId}`
// composition, not a separate `urlKey`/`commentId` field pair).
function createMockCollection() {
  const docs = [];
  function matchesField(docValue, queryValue) {
    if (queryValue && typeof queryValue === 'object' && Array.isArray(queryValue.$in)) {
      return queryValue.$in.includes(docValue);
    }
    return docValue === queryValue;
  }
  function matches(doc, query) {
    for (const key of Object.keys(query)) {
      if (!matchesField(doc[key], query[key])) return false;
    }
    return true;
  }
  return {
    _docs: docs,
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async updateOne(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) {
        Object.assign(docs[idx], update.$set || {});
        // $setOnInsert must NOT apply on an existing doc — that is the whole
        // point of the clause (preserve first-write recordedAt).
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (opts.upsert) {
        docs.push({ ...(update.$set || {}), ...(update.$setOnInsert || {}) });
        return { matchedCount: 0, modifiedCount: 0, upsertedId: update.$set?._id };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
  };
}

const NOW = new Date('2026-09-05T12:00:00.000Z');
const LATER = new Date('2026-09-06T12:00:00.000Z');

describe('HarbourCommentsStore.record', () => {
  let collection, store;
  beforeEach(() => {
    collection = createMockCollection();
    store = new HarbourCommentsStore({ collection });
  });

  test('records a comment id with a recordedAt timestamp', async () => {
    const record = await store.record({ urlKey: 'acme', commentId: 'c-1', now: NOW });
    assert.ok(record);
    assert.strictEqual(record.urlKey, 'acme');
    assert.strictEqual(record.commentId, 'c-1');
    assert.strictEqual(record.recordedAt, NOW.toISOString());
  });

  test('rejects missing urlKey/commentId, never throws', async () => {
    assert.strictEqual(await store.record({ commentId: 'c-1' }), null);
    assert.strictEqual(await store.record({ urlKey: 'acme' }), null);
    assert.strictEqual(await store.record({}), null);
  });

  test('an unconfigured store degrades to null, never throws', async () => {
    const unconfigured = new HarbourCommentsStore({});
    assert.strictEqual(await unconfigured.record({ urlKey: 'acme', commentId: 'c-1' }), null);
  });

  test('recording the same (urlKey, commentId) twice is idempotent and preserves the ORIGINAL recordedAt', async () => {
    // Acceptance witness: without $setOnInsert (e.g. a plain $set of
    // recordedAt on every call), this assertion fails because the second
    // record() call would move the timestamp to LATER. Verified by mutation:
    // swapping $setOnInsert for $set in the store's record() makes this
    // test's recordedAt assertion fail (LATER.toISOString() instead of NOW's).
    await store.record({ urlKey: 'acme', commentId: 'c-1', now: NOW });
    const second = await store.record({ urlKey: 'acme', commentId: 'c-1', now: LATER });
    assert.strictEqual(second.recordedAt, NOW.toISOString(), 'recordedAt must not move on a duplicate record()');
    assert.strictEqual(collection._docs.length, 1, 'a duplicate record must not create a second row');
  });
});

describe('HarbourCommentsStore — no TTL, the ledger is permanent', () => {
  test('a stored record carries no ttl/expiry field', async () => {
    const collection = createMockCollection();
    const store = new HarbourCommentsStore({ collection });
    await store.record({ urlKey: 'acme', commentId: 'c-1', now: NOW });
    const raw = collection._docs[0];
    for (const forbidden of ['ttl', 'expiresAt', 'expireAt', 'expireAfterSeconds']) {
      assert.ok(!Object.prototype.hasOwnProperty.call(raw, forbidden), `${forbidden} must not be a ledger field`);
    }
  });

  test('a comment recorded long ago is still reported as recorded, regardless of how much time has passed', async () => {
    const collection = createMockCollection();
    const store = new HarbourCommentsStore({ collection });
    const longAgo = new Date('2020-01-01T00:00:00.000Z');
    await store.record({ urlKey: 'acme', commentId: 'ancient-comment', now: longAgo });
    const result = await store.wereRecordedByHarbour('acme', ['ancient-comment']);
    assert.ok(result.has('ancient-comment'), 'no TTL means an old record is never treated as expired');
  });
});

describe('HarbourCommentsStore keying — (urlKey, commentId), matching the LIN-2291/LIN-2262 discipline', () => {
  test('two workspaces sharing the same commentId do not collide', async () => {
    const collection = createMockCollection();
    const store = new HarbourCommentsStore({ collection });

    await store.record({ urlKey: 'ws-a', commentId: 'shared-id', now: NOW });
    await store.record({ urlKey: 'ws-b', commentId: 'shared-id', now: LATER });

    assert.strictEqual(collection._docs.length, 2, 'each workspace must get its own row');
    const recordedInA = await store.wereRecordedByHarbour('ws-a', ['shared-id']);
    const recordedInB = await store.wereRecordedByHarbour('ws-b', ['shared-id']);
    assert.ok(recordedInA.has('shared-id'));
    assert.ok(recordedInB.has('shared-id'));

    // Scoping is real, not just non-colliding storage: a THIRD workspace that
    // never recorded this id must not see it as recorded.
    const recordedInC = await store.wereRecordedByHarbour('ws-c', ['shared-id']);
    assert.ok(!recordedInC.has('shared-id'), 'an unrelated workspace must not see another workspace\'s recorded id');
  });
});

describe('HarbourCommentsStore.wereRecordedByHarbour — batch/set-membership read', () => {
  let collection, store;
  beforeEach(async () => {
    collection = createMockCollection();
    store = new HarbourCommentsStore({ collection });
    await store.record({ urlKey: 'acme', commentId: 'recorded-1', now: NOW });
    await store.record({ urlKey: 'acme', commentId: 'recorded-2', now: NOW });
  });

  test('mixed recorded/unrecorded input returns exactly the recorded subset', async () => {
    const result = await store.wereRecordedByHarbour('acme', ['recorded-1', 'unrecorded-1', 'recorded-2', 'unrecorded-2']);
    assert.deepStrictEqual(result, new Set(['recorded-1', 'recorded-2']));
  });

  test('a recorded id reports true (is a member); an unrecorded id reports false (is not)', async () => {
    const result = await store.wereRecordedByHarbour('acme', ['recorded-1', 'unrecorded-1']);
    assert.strictEqual(result.has('recorded-1'), true);
    assert.strictEqual(result.has('unrecorded-1'), false);
  });

  test('empty input returns an empty Set without touching the collection', async () => {
    let touched = false;
    const spiedCollection = { ...collection, find(query) { touched = true; return collection.find(query); } };
    const spiedStore = new HarbourCommentsStore({ collection: spiedCollection });
    const result = await spiedStore.wereRecordedByHarbour('acme', []);
    assert.deepStrictEqual(result, new Set());
    assert.strictEqual(touched, false, 'an empty id list must short-circuit before any read');

    assert.deepStrictEqual(await store.wereRecordedByHarbour('acme', undefined), new Set());
  });

  test('an unconfigured store degrades to an empty Set, never throws', async () => {
    const unconfigured = new HarbourCommentsStore({});
    assert.deepStrictEqual(await unconfigured.wereRecordedByHarbour('acme', ['recorded-1']), new Set());
  });
});

describe('HarbourCommentsStore.wereRecordedByHarbour — the id || commentId precedence', () => {
  let collection, store;
  beforeEach(async () => {
    collection = createMockCollection();
    store = new HarbourCommentsStore({ collection });
    // Simulates: recorded at the createComment seam using the create-response's
    // own `id` field (GitHub/Jira/Local shape) — the ledger key is a bare string.
    await store.record({ urlKey: 'acme', commentId: 'other-provider-id', now: NOW });
    // Simulates: recorded using a Linear create-response id.
    await store.record({ urlKey: 'acme', commentId: 'linear-comment-id', now: NOW });
  });

  test('resolves a Linear-shaped comment (no `id`, only `commentId`) via the fallback', async () => {
    const result = await store.wereRecordedByHarbour('acme', [
      { commentId: 'linear-comment-id', body: 'hello' } // no `id` at all — the Linear shape
    ]);
    assert.ok(result.has('linear-comment-id'));
  });

  test('prefers `id` over `commentId` when both are present, matching scanBasisFromContext exactly', async () => {
    // Acceptance witness (mutation, since a direct pre-fix failure needs no
    // provider to emit both fields in practice): swapping the store's
    // `resolveCommentId` import for a bare `c => c?.commentId` (dropping the
    // `id` preference) makes this assertion fail, resolving to 'wrong-id'
    // instead of 'other-provider-id' and reporting `false` here.
    const result = await store.wereRecordedByHarbour('acme', [
      { id: 'other-provider-id', commentId: 'wrong-id', body: 'hello' }
    ]);
    assert.ok(result.has('other-provider-id'));
  });

  test('accepts an already-resolved plain string id, same as a comment-like object', async () => {
    const byObject = await store.wereRecordedByHarbour('acme', [{ commentId: 'linear-comment-id' }]);
    const byString = await store.wereRecordedByHarbour('acme', ['linear-comment-id']);
    assert.deepStrictEqual(byObject, byString);
  });

  test('an entry resolving to no id (neither field present) is filtered out, never a false match', async () => {
    const result = await store.wereRecordedByHarbour('acme', [{ body: 'no id at all' }, 'linear-comment-id']);
    assert.deepStrictEqual(result, new Set(['linear-comment-id']));
  });
});
