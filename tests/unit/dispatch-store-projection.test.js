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
  const queue = capturing(createMockCollection());
  const store = new DispatchQueueStore({
    collection: queue.collection,
    historyCollection: history.collection
  });
  return {
    store,
    historyCalls: history.calls,
    historyDocs: history.collection._docs,
    queueCalls: queue.calls,
    queueDocs: queue.collection._docs
  };
}

test('listHistory threads projection into find() and drops the excluded field', async () => {
  const { store, historyCalls, historyDocs } = makeStore();
  const dispatchedAt = new Date('2026-06-20T00:00:00.000Z');
  historyDocs.push({
    _id: 'r', urlKey: 'acme', issueIdentifier: 'LIN-1',
    dispatchedAt, resolvedAt: dispatchedAt, status: 'taken',
    prompt: 'a very large prompt body', feedback: [{ message: '[done]', timestamp: dispatchedAt }]
  });

  const result = await store.listHistory('acme', { limit: 100, projection: { prompt: 0 } });

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

test('listHistory without a projection reads the LEAN shape; listHistoryWithBodies passes no find options (LIN-3812)', async () => {
  const { store, historyCalls, historyDocs } = makeStore();
  const dispatchedAt = new Date('2026-06-20T00:00:00.000Z');
  historyDocs.push({
    _id: 'r', urlKey: 'acme', issueIdentifier: 'LIN-1',
    dispatchedAt, resolvedAt: dispatchedAt, status: 'taken',
    prompt: 'full prompt body', feedback: [], feedbackVersion: 0, feedbackDigest: { version: 0 }
  });

  const lean = await store.listHistory('acme', { limit: 100 });
  assert.deepEqual(historyCalls[0].options, { projection: { prompt: 0, feedback: 0 } },
    'the default read drops the prompt and the raw feedback at the query');
  assert.equal(lean.items[0].prompt, null);
  assert.equal(lean.items[0].feedback, undefined);

  const whole = await store.listHistoryWithBodies('acme', { limit: 100 });
  assert.equal(historyCalls[1].options, undefined,
    'the named whole-document read must not pass a projection');
  assert.equal(whole.items[0].prompt, 'full prompt body', 'the full prompt is retained');
});

test('listItems threads projection into find() and drops the excluded field', async () => {
  const { store, queueCalls, queueDocs } = makeStore();
  queueDocs.push({
    _id: 'q', urlKey: 'acme', issueIdentifier: 'LIN-1',
    dispatchedAt: new Date('2026-06-20T00:00:00.000Z'),
    expiresAt: new Date('2999-01-01T00:00:00.000Z'),
    prompt: 'a very large queued prompt body'
  });

  const items = await store.listItems('acme', { projection: { prompt: 0 } });

  assert.equal(queueCalls.length, 1);
  assert.deepEqual(queueCalls[0].options, { projection: { prompt: 0 } },
    'the projection must reach find() so a real DB never transfers the queued prompt');
  assert.equal(items.length, 1);
  assert.equal(items[0].prompt, undefined, 'projected-out prompt is absent from the queued result');
  assert.equal(items[0].issueIdentifier, 'LIN-1', 'metadata the list view needs survives the projection');
});

test('listItems without a projection drops the prompt; listItemsWithPrompt / pollAvailable keep it (LIN-3812)', async () => {
  const { store, queueCalls, queueDocs } = makeStore();
  queueDocs.push({
    _id: 'q', urlKey: 'acme', issueIdentifier: 'LIN-1',
    dispatchedAt: new Date('2026-06-20T00:00:00.000Z'),
    expiresAt: new Date('2999-01-01T00:00:00.000Z'),
    prompt: 'full queued prompt body'
  });

  const lean = await store.listItems('acme');
  assert.deepEqual(queueCalls[0].options, { projection: { prompt: 0 } });
  assert.equal(lean[0].prompt, undefined);

  const whole = await store.listItemsWithPrompt('acme');
  assert.equal(queueCalls[1].options, undefined,
    'a read with the prompt must not pass find options — pollAvailable still gets the prompt');
  assert.equal(whole[0].prompt, 'full queued prompt body', 'the full prompt is retained for consumers');

  const polled = await store.pollAvailable('acme');
  assert.equal(polled[0].prompt, 'full queued prompt body');
});
