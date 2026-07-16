/**
 * Unit tests for lib/saved-chat-store.js (LIN-1008)
 *
 * Run with: node --test tests/unit/saved-chat-store.test.js
 *
 * Exercises the real SavedChatStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface. Covers the behaviours the plan calls out:
 * CRUD, per-user isolation (user A never sees user B's chats), the per-user count
 * cap, title auto-derivation from the first user turn, hard-delete, and the
 * transcript sanitizer (only `{role, content}` user/assistant turns survive).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SavedChatStore } from '../../lib/saved-chat-store.js';

// Minimal in-memory mock of the collection surface the store uses. Supports the
// equality predicates the store issues: _id, urlKey, accountId.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.accountId !== undefined && doc.accountId !== query.accountId) return false;
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

const URL_KEY = 'test-workspace';
const USER_A = 'user-a';
const USER_B = 'user-b';

function sampleTranscript(overrides) {
  return overrides || [
    { role: 'user', content: 'Where do you stand?' },
    { role: 'assistant', content: 'I am in progress.' }
  ];
}

describe('SavedChatStore (LIN-1008)', () => {
  let collection;
  let store;

  beforeEach(() => {
    collection = createMockCollection();
    store = new SavedChatStore({ collection });
  });

  test('create → get round-trips the transcript and metadata', async () => {
    const created = await store.create(URL_KEY, USER_A, {
      taskIdentifier: 'LIN-1',
      transcript: sampleTranscript()
    });
    assert.ok(created.id);
    assert.strictEqual(created.taskIdentifier, 'LIN-1');
    assert.deepStrictEqual(created.transcript, sampleTranscript());

    const fetched = await store.get(URL_KEY, USER_A, created.id);
    assert.strictEqual(fetched.id, created.id);
    assert.deepStrictEqual(fetched.transcript, sampleTranscript());
  });

  test('title is auto-derived from the first user turn (single-lined, clamped)', async () => {
    const created = await store.create(URL_KEY, USER_A, {
      taskIdentifier: 'LIN-1',
      transcript: [
        { role: 'user', content: '  What is\n   blocking   you? ' },
        { role: 'assistant', content: 'nothing' }
      ]
    });
    assert.strictEqual(created.title, 'What is blocking you?');
  });

  test('title falls back to the task identifier when there is no user turn', async () => {
    const created = await store.create(URL_KEY, USER_A, {
      taskIdentifier: 'LIN-42',
      transcript: [{ role: 'assistant', content: 'hi' }]
    });
    assert.strictEqual(created.title, 'Chat about LIN-42');
  });

  test('sanitizes the transcript to {role, content} — drops tool/system/non-string turns', async () => {
    const created = await store.create(URL_KEY, USER_A, {
      taskIdentifier: 'LIN-1',
      transcript: [
        { role: 'user', content: 'hi' },
        { role: 'tool', content: 'breadcrumb' },              // dropped
        { role: 'assistant', content: 'hello', model: 'x' },  // model stripped
        { role: 'assistant', content: { not: 'a string' } },  // dropped
        { role: 'system', content: 'ignore' }                 // dropped
      ]
    });
    assert.deepStrictEqual(created.transcript, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ]);
  });

  test('rejects an empty transcript (never persists a throwaway chat)', async () => {
    await assert.rejects(
      () => store.create(URL_KEY, USER_A, { taskIdentifier: 'LIN-1', transcript: [] }),
      /at least one message/
    );
    await assert.rejects(
      () => store.create(URL_KEY, USER_A, { taskIdentifier: 'LIN-1', transcript: [{ role: 'tool', content: 'x' }] }),
      /at least one message/
    );
  });

  test('list returns metadata only (no transcript), newest-first', async () => {
    const first = await store.create(URL_KEY, USER_A, { taskIdentifier: 'LIN-1', transcript: [{ role: 'user', content: 'first' }] });
    const second = await store.create(URL_KEY, USER_A, { taskIdentifier: 'LIN-2', transcript: [{ role: 'user', content: 'second' }] });

    const list = await store.list(URL_KEY, USER_A);
    assert.strictEqual(list.length, 2);
    // Newest-first: the last-created (or same-ms, higher seq) sorts first.
    assert.strictEqual(list[0].id, second.id);
    assert.strictEqual(list[1].id, first.id);
    // Metadata only — no transcript leaks onto the list.
    assert.strictEqual(list[0].transcript, undefined);
    assert.strictEqual(list[0].turnCount, 1);
    assert.strictEqual(list[0].taskIdentifier, 'LIN-2');
  });

  test('per-user isolation: user A never sees or reads user B\'s chats', async () => {
    const aChat = await store.create(URL_KEY, USER_A, { taskIdentifier: 'LIN-1', transcript: [{ role: 'user', content: 'a' }] });
    const bChat = await store.create(URL_KEY, USER_B, { taskIdentifier: 'LIN-1', transcript: [{ role: 'user', content: 'b' }] });

    const aList = await store.list(URL_KEY, USER_A);
    assert.deepStrictEqual(aList.map(c => c.id), [aChat.id]);

    // A cannot read B's chat by id.
    assert.strictEqual(await store.get(URL_KEY, USER_A, bChat.id), null);
    // …but B can.
    assert.strictEqual((await store.get(URL_KEY, USER_B, bChat.id)).id, bChat.id);
  });

  test('per-user count cap prunes oldest beyond the cap', async () => {
    store = new SavedChatStore({ collection, maxPerUser: 3 });
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const c = await store.create(URL_KEY, USER_A, { taskIdentifier: `LIN-${i}`, transcript: [{ role: 'user', content: `q${i}` }] });
      ids.push(c.id);
    }
    const list = await store.list(URL_KEY, USER_A);
    assert.strictEqual(list.length, 3);
    // The two oldest (ids[0], ids[1]) were pruned; the newest three remain.
    const remaining = new Set(list.map(c => c.id));
    assert.ok(!remaining.has(ids[0]));
    assert.ok(!remaining.has(ids[1]));
    assert.ok(remaining.has(ids[4]));
  });

  test('delete is scoped to the owner and hard-removes the document', async () => {
    const aChat = await store.create(URL_KEY, USER_A, { taskIdentifier: 'LIN-1', transcript: [{ role: 'user', content: 'a' }] });

    // Another user cannot delete it.
    assert.strictEqual(await store.delete(URL_KEY, USER_B, aChat.id), false);
    assert.ok(await store.get(URL_KEY, USER_A, aChat.id));

    // The owner can, and it is gone from the store (hard delete, no tombstone).
    assert.strictEqual(await store.delete(URL_KEY, USER_A, aChat.id), true);
    assert.strictEqual(await store.get(URL_KEY, USER_A, aChat.id), null);
    assert.strictEqual(collection._docs.length, 0);
  });

  test('clear removes all chats for a workspace (test seam)', async () => {
    await store.create(URL_KEY, USER_A, { taskIdentifier: 'LIN-1', transcript: [{ role: 'user', content: 'a' }] });
    await store.create(URL_KEY, USER_B, { taskIdentifier: 'LIN-2', transcript: [{ role: 'user', content: 'b' }] });
    const removed = await store.clear(URL_KEY);
    assert.strictEqual(removed, 2);
    assert.strictEqual(collection._docs.length, 0);
  });

  test('create requires urlKey and accountId', async () => {
    await assert.rejects(() => store.create('', USER_A, { transcript: sampleTranscript() }), /urlKey is required/);
    await assert.rejects(() => store.create(URL_KEY, '', { transcript: sampleTranscript() }), /accountId is required/);
  });
});
