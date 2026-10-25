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
  const findOpts = [];
  return {
    collection: {
      ...collection,
      find(query, options) {
        queries.push(query);
        findOpts.push(options);
        return collection.find(query, options);
      }
    },
    queries,
    findOpts
  };
}

function makeStore() {
  const main = capturing(createMockCollection());
  const history = capturing(createMockCollection());
  const store = new DispatchQueueStore({
    collection: main.collection,
    historyCollection: history.collection
  });
  return {
    store,
    mainQueries: main.queries,
    historyQueries: history.queries,
    mainFindOpts: main.findOpts,
    historyFindOpts: history.findOpts
  };
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

  // LIN-3812: the lean read self-heals rows whose digest is null (a fresh archive) with an
  // `_id $in` re-read; the scoped query itself is still exactly one.
  assert.equal(historyQueries.filter(q => !q._id).length, 1);
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

  const result = await store.listHistory('acme', { limit: 100 });

  assert.equal(historyQueries.filter(q => !q._id).length, 1);
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

  assert.equal(history.queries.filter(q => !q._id).length, 1);
  assert.deepEqual(history.queries[0].dispatchedAt, { $gte: since },
    'the since window must ride into the query so a real DB filters server-side');
  assert.equal(result.total, 1, 'only the in-window row is materialised');
  assert.equal(result.items[0].id, 'r');
});

// LIN-1656: the duplicate-dispatch guard's read. Two properties matter and both
// are asserted on the QUERY, not just the result — a lookup that filtered in JS
// would return the same answers here while scanning the whole workspace on a real
// DB, and a missing clause is the difference between refusing a duplicate and
// refusing legitimate work.
test('findRecentFreshDispatch pushes the whole predicate into BOTH collections', async () => {
  const { store, mainQueries, historyQueries } = makeStore();
  const since = new Date('2026-07-26T11:55:00.000Z');

  await store.findRecentFreshDispatch('acme', {
    issueIdentifier: 'LIN-1',
    kind: 'implementation',
    since
  });

  assert.equal(mainQueries.length, 1, 'the live queue must be read');
  assert.equal(historyQueries.length, 1,
    'history must be read too — a claimed dispatch has already left the queue, which is the common case');

  for (const query of [mainQueries[0], historyQueries[0]]) {
    assert.equal(query.urlKey, 'acme');
    assert.equal(query.issueIdentifier, 'LIN-1');
    assert.equal(query.kind, 'implementation',
      'kind is mandatory — same-issue different-kind pairs are the normal pipeline');
    assert.strictEqual(query.followUpTo, null, 'a follow-up is the INTENDED second dispatch');
    assert.deepEqual(query.abort, { $ne: true }, 'a cascade emits one abort per descendant by design');
    assert.deepEqual(query.dispatchedAt, { $gte: since },
      'the window must ride into the query — and it keys on dispatchedAt, never status');
  }
});

test('findRecentFreshDispatch projects the prompt away on both reads', async () => {
  const { store, mainFindOpts, historyFindOpts } = makeStore();

  await store.findRecentFreshDispatch('acme', {
    issueIdentifier: 'LIN-1', kind: 'plan', since: new Date(0)
  });

  // An untrimmed dispatch doc carries an 8-30 KB prompt this caller never reads;
  // the cost contract is asserted, not merely intended.
  assert.deepEqual(mainFindOpts[0], { projection: { prompt: 0 } });
  assert.deepEqual(historyFindOpts[0], { projection: { prompt: 0 } });
});

test('findRecentFreshDispatch returns the NEWEST match across the two collections, as a real Date', async () => {
  const { store } = makeStore();
  const base = new Date('2026-07-26T12:00:00.000Z');
  const row = (id, dispatchedAt) => ({
    _id: id, urlKey: 'acme', issueIdentifier: 'LIN-1', kind: 'implementation',
    followUpTo: null, abort: false, prompt: 'x', dispatchedAt
  });
  await store.collection.insertOne(row('older-queued', base));
  await store.historyCollection.insertOne(row('newer-archived', new Date(base.getTime() + 60_000)));

  const hit = await store.findRecentFreshDispatch('acme', {
    issueIdentifier: 'LIN-1', kind: 'implementation', since: new Date(base.getTime() - 1000)
  });

  assert.equal(hit.id, 'newer-archived');
  // NOT the formatters' ISO string: the guard does date arithmetic on this, and a
  // string comparison inside a date comparison is a silent-wrong-answer shape.
  assert.ok(hit.dispatchedAt instanceof Date);
  assert.equal(hit.dispatchedAt.getTime(), base.getTime() + 60_000);
});

test('findRecentFreshDispatch returns null when its required inputs are missing', async () => {
  const { store, mainQueries } = makeStore();
  assert.equal(await store.findRecentFreshDispatch('acme', { kind: 'plan', since: new Date(0) }), null);
  assert.equal(await store.findRecentFreshDispatch('acme', { issueIdentifier: 'LIN-1', since: new Date(0) }), null);
  assert.equal(await store.findRecentFreshDispatch(null, { issueIdentifier: 'LIN-1', kind: 'plan', since: new Date(0) }), null);
  assert.equal(mainQueries.length, 0, 'an unkeyable lookup must not issue a query at all');
});

test('findRecentFreshDispatch: a cancelled row (an Undo) does not block the same stage again (LIN-3968 ruling)', async () => {
  const { store, mainQueries, historyQueries } = makeStore();
  const base = new Date('2026-10-25T12:00:00.000Z');
  const row = (id, extra) => ({
    _id: id, urlKey: 'acme', issueIdentifier: 'LIN-1', kind: 'review',
    followUpTo: null, abort: false, prompt: 'x', dispatchedAt: base, ...extra
  });
  await store.historyCollection.insertOne(row('undone', { status: 'cancelled' }));
  const since = new Date(base.getTime() - 1000);

  assert.equal(await store.findRecentFreshDispatch('acme', { issueIdentifier: 'LIN-1', kind: 'review', since }), null,
    'the person undid it; nothing ran, so re-running the stage is not a duplicate');
  for (const query of [mainQueries[0], historyQueries[0]]) {
    assert.deepEqual(query.status, { $ne: 'cancelled' }, 'the exemption rides into both reads');
  }

  // Every other archived row still counts: taken (the LIN-1594 pile included).
  await store.historyCollection.insertOne(row('taken', { status: 'taken' }));
  assert.equal((await store.findRecentFreshDispatch('acme', { issueIdentifier: 'LIN-1', kind: 'review', since })).id, 'taken');
});

test('findRecentFreshDispatch: a row whose session ended failed, aborted or expired does not block the stage again (LIN-3968 DECISION, option a)', async () => {
  const { store } = makeStore();
  const base = new Date('2026-10-25T12:00:00.000Z');
  const since = new Date(base.getTime() - 1000);
  const row = (id, extra) => ({
    _id: id, urlKey: 'acme', issueIdentifier: 'LIN-1', kind: 'review',
    followUpTo: null, abort: false, prompt: 'x', dispatchedAt: base, ...extra
  });
  const find = () => store.findRecentFreshDispatch('acme', { issueIdentifier: 'LIN-1', kind: 'review', since });

  // Ended rows: the archived status says so.
  for (const status of ['failed', 'aborted', 'expired']) {
    await store.historyCollection.insertOne(row(`status-${status}`, { status }));
    assert.equal(await find(), null, `a ${status} row ran no work to duplicate`);
  }

  // The LIN-1594 pile: a row still `taken` whose runner posted a terminal failure marker. Only the feedback says it ended.
  const failedMarker = [{ message: '[failed] Review could not finish', timestamp: base }];
  await store.historyCollection.insertOne(row('taken-failed', { status: 'taken', feedback: failedMarker }));
  assert.equal(await find(), null, 'a taken row whose latest terminal marker is [failed] is an ended session');
  await store.historyCollection.insertOne(row('taken-aborted', { status: 'taken', feedback: [{ message: '[aborted] Stopped by the person', timestamp: base }] }));
  assert.equal(await find(), null, 'a taken row whose latest terminal marker is [aborted] is an ended session');

  // A session that completed still counts: its stage ran, so a second run is a duplicate.
  await store.historyCollection.insertOne(row('taken-done', { status: 'taken', feedback: [{ message: '[done] Review written', timestamp: base }] }));
  assert.equal((await find()).id, 'taken-done');
});

test('findRecentFreshDispatch: a row still in flight keeps counting, even after a failed one (LIN-3968)', async () => {
  const { store } = makeStore();
  const base = new Date('2026-10-25T12:00:00.000Z');
  const since = new Date(base.getTime() - 1000);
  const row = (id, extra) => ({
    _id: id, urlKey: 'acme', issueIdentifier: 'LIN-1', kind: 'review',
    followUpTo: null, abort: false, prompt: 'x', dispatchedAt: base, ...extra
  });
  await store.historyCollection.insertOne(row('failed-earlier', { status: 'failed' }));
  await store.collection.insertOne(row('queued-now', {}));

  assert.equal((await store.findRecentFreshDispatch('acme', { issueIdentifier: 'LIN-1', kind: 'review', since })).id, 'queued-now',
    'a queued row has not ended; the guard protects it');
});
