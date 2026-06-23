/**
 * Unit tests for projection pushdown on the lean Observation feed read (LIN-623).
 *
 * The cold `/observation` sessions feed was slow because `listHistory` returned
 * FULL history documents for the whole workspace — including the heavy `prompt`
 * body (~8–30 KB/row) the lean feed never reads. LIN-622's `lean` flag only
 * dropped `prompt`/`feedback` from the OUTPUT loops, *after* the docs were
 * already fetched. These tests pin the read-path fix: `listHistory` now accepts a
 * Mongo `projection` and passes it straight to `find()`, so the lean feed's
 * `{ prompt: 0 }` excludes the field at the query (never transferred), while a
 * read without `projection` stays byte-identical for every other caller.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

// Capture both the query AND the find options so we can assert the projection
// rides into the collection call, while still delegating to the real mock (which
// honours exclusion projections) so we also see the field actually dropped.
function capturing(collection) {
  const calls = [];
  return {
    collection: {
      ...collection,
      find(query, options) {
        calls.push({ query, options });
        return collection.find(query, options);
      }
    },
    calls
  };
}

function makeStore() {
  const history = capturing(createMockCollection());
  const store = new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: history.collection
  });
  return { store, historyCalls: history.calls, historyDocs: history.collection._docs };
}

test('listHistory threads projection into find() and drops the excluded field', async () => {
  const { store, historyCalls, historyDocs } = makeStore();
  const dispatchedAt = new Date('2026-06-20T00:00:00.000Z');
  historyDocs.push({
    _id: 'r', urlKey: 'acme', issueIdentifier: 'LIN-1',
    dispatchedAt, resolvedAt: dispatchedAt, status: 'taken',
    prompt: 'a very large prompt body', feedback: [{ message: '[done]', timestamp: dispatchedAt }]
  });

  const result = await store.listHistory('acme', { projection: { prompt: 0 } });

  assert.equal(historyCalls.length, 1);
  assert.deepEqual(historyCalls[0].options, { projection: { prompt: 0 } },
    'the projection must reach find() so a real DB never transfers the field');
  // The excluded field comes back null (the projection dropped it from the doc);
  // everything else — crucially `feedback` — is retained.
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].prompt, null, 'projected-out prompt is absent from the result');
  assert.ok(Array.isArray(result.items[0].feedback) && result.items[0].feedback.length === 1,
    'feedback (telemetry source) survives a prompt-only projection');
});

test('listHistory without a projection passes no find options (full-document read)', async () => {
  const { store, historyCalls, historyDocs } = makeStore();
  const dispatchedAt = new Date('2026-06-20T00:00:00.000Z');
  historyDocs.push({
    _id: 'r', urlKey: 'acme', issueIdentifier: 'LIN-1',
    dispatchedAt, resolvedAt: dispatchedAt, status: 'taken',
    prompt: 'full prompt body', feedback: []
  });

  const result = await store.listHistory('acme');

  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0].options, undefined,
    'a non-lean read must not pass a projection — full document, byte-identical');
  assert.equal(result.items[0].prompt, 'full prompt body', 'the full prompt is retained');
});
