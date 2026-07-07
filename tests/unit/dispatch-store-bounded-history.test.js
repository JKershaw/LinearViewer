/**
 * Unit tests for the bounded, index-backed dispatch-history read (LIN-1030).
 *
 * The live H12 was `GET /api/proxy/dispatch`: `listHistory` read the WHOLE 30-day,
 * feedback-bearing history into memory (`find({urlKey}).toArray()`), JS-sorted it,
 * then `.slice(limit)`d — so a `?limit=20`/`limit:200` call still transferred and
 * BSON-deserialised every row and timed out past ~1,000 tasks.
 *
 * The fix pushes `sort`+`skip`+`limit` DOWN into the query (index-backed by the
 * new `{urlKey, resolvedAt:-1}` index) so Mongo returns only the newest N rows,
 * while `total` stays the full matching count so paginating callers are
 * unaffected. These tests pin:
 *   - a limited read reaches the query as sort+skip+limit (NOT a post-read JS slice),
 *   - it returns the newest N by resolvedAt and preserves the full `total`,
 *   - the unlimited path is untouched (whole set, JS-sorted, no limit pushed), and
 *   - a limited read with `{prompt:0}` still carries `feedback[]` (the endpoint
 *     derives status/completedAt/count from it — it must NOT be over-projected out).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

// Wrap a history collection so we can assert which cursor modifiers (sort/skip/
// limit) and countDocuments reached the query — the proof the limit is a real
// query bound, not a JS slice over an already-fully-read set.
function spyingHistory() {
  const mock = createMockCollection();
  const calls = { sort: [], skip: [], limit: [], counts: 0 };
  const collection = {
    ...mock,
    find(query, opts) {
      const cursor = mock.find(query, opts);
      const wrapped = {
        sort(spec) { calls.sort.push(spec); cursor.sort(spec); return wrapped; },
        skip(n) { calls.skip.push(n); cursor.skip(n); return wrapped; },
        limit(n) { calls.limit.push(n); cursor.limit(n); return wrapped; },
        toArray() { return cursor.toArray(); }
      };
      return wrapped;
    },
    async countDocuments(query) { calls.counts++; return mock.countDocuments(query); }
  };
  return { collection, calls, docs: mock._docs };
}

function makeStore() {
  const history = spyingHistory();
  const store = new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: history.collection
  });
  return { store, calls: history.calls, docs: history.docs };
}

// Seed `n` resolved history rows for `acme`, oldest → newest by resolvedAt, each
// carrying a prompt and a feedback transcript so over-fetch/projection is visible.
function seed(docs, urlKey, n) {
  for (let i = 0; i < n; i++) {
    const resolvedAt = new Date(Date.UTC(2026, 5, i + 1)); // Jun 1, Jun 2, ...
    docs.push({
      _id: `d${i}`,
      urlKey,
      issueIdentifier: `LIN-${i}`,
      status: 'taken',
      prompt: `prompt body ${i}`,
      feedback: [{ message: `[done] ${i}`, timestamp: resolvedAt }],
      dispatchedAt: resolvedAt,
      resolvedAt
    });
  }
}

test('a limited read pushes sort+skip+limit into the query (not a JS post-slice)', async () => {
  const { store, calls, docs } = makeStore();
  seed(docs, 'acme', 5);

  const result = await store.listHistory('acme', { limit: 2 });

  // The limit must reach the query, backed by a resolvedAt-descending sort.
  assert.deepEqual(calls.sort, [{ resolvedAt: -1 }],
    'sort by resolvedAt desc must ride into the query so the new index backs it');
  assert.deepEqual(calls.limit, [2], 'limit must reach the query, not stay a JS slice');
  assert.deepEqual(calls.skip, [0], 'offset (default 0) must reach the query');
  assert.equal(calls.counts, 1, 'total comes from an index-only count, not a full read');

  // Newest two by resolvedAt (d4, d3), and total stays the FULL matching count.
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(i => i.id), ['d4', 'd3']);
  assert.equal(result.total, 5, 'total must be the full count so pagination stays correct');
});

test('a limited read with an offset paginates via skip+limit', async () => {
  const { store, calls, docs } = makeStore();
  seed(docs, 'acme', 5);

  const result = await store.listHistory('acme', { limit: 2, offset: 2 });

  assert.deepEqual(calls.skip, [2]);
  assert.deepEqual(calls.limit, [2]);
  assert.deepEqual(result.items.map(i => i.id), ['d2', 'd1'],
    'page 2 of the newest-first order');
  assert.equal(result.total, 5);
});

test('the unlimited path is unchanged: whole set, JS-sorted, no limit pushed', async () => {
  const { store, calls, docs } = makeStore();
  seed(docs, 'acme', 4);

  const result = await store.listHistory('acme');

  assert.equal(calls.limit.length, 0, 'no query limit on the whole-set path');
  assert.equal(calls.counts, 0, 'no separate count on the whole-set path');
  assert.equal(result.items.length, 4);
  assert.deepEqual(result.items.map(i => i.id), ['d3', 'd2', 'd1', 'd0'],
    'still returned newest-first');
  assert.equal(result.total, 4);
});

test('a limited read with {prompt:0} still carries feedback[] (derivation payload)', async () => {
  // Mirrors the /api/proxy/dispatch call: prompt excluded (never returned), but
  // feedback is what status/completedAt/count are derived from — it must survive.
  const { store, docs } = makeStore();
  seed(docs, 'acme', 3);

  const result = await store.listHistory('acme', { limit: 3, projection: { prompt: 0 } });

  assert.equal(result.items.length, 3);
  for (const item of result.items) {
    assert.equal(item.prompt, null, 'prompt is projected out at the query');
    assert.ok(Array.isArray(item.feedback) && item.feedback.length > 0,
      'feedback[] must remain so the endpoint can derive terminal status');
  }
});
