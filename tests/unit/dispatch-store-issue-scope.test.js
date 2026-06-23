/**
 * Unit tests for issue-scoped dispatch-store reads (LIN-613).
 *
 * Opening "Dispatched Sessions" for a single issue used to download the whole
 * workspace's queue + 30-day history and filter in JS — the read that timed out
 * on large workspaces. listItems/listHistory now accept an `issueIdentifier`
 * option that is pushed DOWN into the collection query, so the read is bounded by
 * the {urlKey, issueIdentifier} index. These tests pin both behaviours:
 *   - the predicate rides into the query sent to the collection (pushdown), and
 *   - only the requested issue's rows come back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

// Wrap the shared mock so we can assert what query reached `find()` while still
// getting realistic top-level-equality matching from the underlying mock.
function capturing(collection) {
  const queries = [];
  return {
    collection: {
      ...collection,
      find(query) {
        queries.push(query);
        return collection.find(query);
      }
    },
    queries
  };
}

function makeStore() {
  const main = capturing(createMockCollection());
  const history = capturing(createMockCollection());
  const store = new DispatchQueueStore({
    collection: main.collection,
    historyCollection: history.collection
  });
  return { store, mainQueries: main.queries, historyQueries: history.queries };
}

test('listItems pushes issueIdentifier into the query', async () => {
  const { store, mainQueries } = makeStore();
  await store.addItem('acme', { prompt: 'a', issueIdentifier: 'LIN-1' });
  await store.addItem('acme', { prompt: 'b', issueIdentifier: 'LIN-2' });
  mainQueries.length = 0;

  const items = await store.listItems('acme', { issueIdentifier: 'LIN-1' });

  assert.equal(mainQueries.length, 1);
  assert.equal(mainQueries[0].issueIdentifier, 'LIN-1',
    'the issue filter must be in the query so a real DB uses the index');
  assert.equal(items.length, 1);
  assert.equal(items[0].issueIdentifier, 'LIN-1');
});

test('listItems without an issueIdentifier leaves it out of the query', async () => {
  const { store, mainQueries } = makeStore();
  await store.addItem('acme', { prompt: 'a', issueIdentifier: 'LIN-1' });
  await store.addItem('acme', { prompt: 'b', issueIdentifier: 'LIN-2' });
  mainQueries.length = 0;

  const items = await store.listItems('acme');

  assert.equal(mainQueries.length, 1);
  assert.ok(!('issueIdentifier' in mainQueries[0]),
    'unscoped reads must not carry an issueIdentifier predicate');
  assert.equal(items.length, 2);
});

test('listHistory pushes issueIdentifier into the query and returns only that issue', async () => {
  const { store, historyQueries } = makeStore();
  // Archive items for two issues by cancelling them (moves queue → history).
  const a = await store.addItem('acme', { prompt: 'a', issueIdentifier: 'LIN-1' });
  const b = await store.addItem('acme', { prompt: 'b', issueIdentifier: 'LIN-2' });
  await store.removeItem('acme', a._id);
  await store.removeItem('acme', b._id);
  historyQueries.length = 0;

  const result = await store.listHistory('acme', { issueIdentifier: 'LIN-1' });

  assert.equal(historyQueries.length, 1);
  assert.equal(historyQueries[0].issueIdentifier, 'LIN-1');
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].issueIdentifier, 'LIN-1');
});

test('listHistory without an issueIdentifier returns the whole workspace history', async () => {
  const { store, historyQueries } = makeStore();
  const a = await store.addItem('acme', { prompt: 'a', issueIdentifier: 'LIN-1' });
  const b = await store.addItem('acme', { prompt: 'b', issueIdentifier: 'LIN-2' });
  await store.removeItem('acme', a._id);
  await store.removeItem('acme', b._id);
  historyQueries.length = 0;

  const result = await store.listHistory('acme');

  assert.equal(historyQueries.length, 1);
  assert.ok(!('issueIdentifier' in historyQueries[0]));
  assert.equal(result.total, 2);
});

// LIN-622: the feed read windows history to the 30-day lookback with a `since`
// predicate, pushed into the query so rows older than the window (and any
// cleanup-lag backlog) are never materialised — bounding peak memory.
test('listHistory pushes a since window into the query and excludes older rows', async () => {
  const history = capturing(createMockCollection());
  const store = new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: history.collection
  });
  const recent = new Date('2026-06-20T00:00:00.000Z');
  const ancient = new Date('2026-01-01T00:00:00.000Z'); // cleanup-lag backlog
  // Insert history docs directly so we control dispatchedAt (addItem stamps now).
  history.collection._docs.push(
    { _id: 'r', urlKey: 'acme', issueIdentifier: 'LIN-1', dispatchedAt: recent, resolvedAt: recent, status: 'taken', feedback: [] },
    { _id: 'o', urlKey: 'acme', issueIdentifier: 'LIN-1', dispatchedAt: ancient, resolvedAt: ancient, status: 'taken', feedback: [] }
  );

  const since = new Date('2026-05-24T00:00:00.000Z');
  const result = await store.listHistory('acme', { since });

  assert.equal(history.queries.length, 1);
  assert.deepEqual(history.queries[0].dispatchedAt, { $gte: since },
    'the since window must ride into the query so a real DB filters server-side');
  assert.equal(result.total, 1, 'only the in-window row is materialised');
  assert.equal(result.items[0].id, 'r');
});
