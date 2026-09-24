/**
 * Unit tests for the `maxTasks` field plumbing and `countDistinctTasksForSession`
 * (LIN-1751).
 *
 * Mirrors tests/unit/dispatch-store-preset-fields.test.js's pattern for the
 * sibling presetConfig/presetName fields: `maxTasks` is an optional, nullable
 * field threaded through the full 5-place allowlist (addItem, _archiveItem,
 * _formatItem, _formatHistoryItem — formatDispatchWatch lives in routes/proxy.js
 * and is covered separately). The `_formatHistoryItem` leg is LOAD-BEARING, not
 * a consistency nicety: the budget guard's anchor read (`getItemStatus`)
 * resolves through it once a kickoff row is archived, which happens within
 * seconds of a real run starting.
 *
 * `countDistinctTasksForSession` mirrors tests/unit/dispatch-store-issue-scope.test.js's
 * `findRecentFreshDispatch` pattern: the predicate is asserted on the QUERY
 * reaching both collections, not just the result, since a lookup that filtered
 * in JS would return the same answers here while scanning the whole workspace
 * on a real DB.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

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
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

function makeCapturingStore() {
  const main = capturing(createMockCollection());
  const history = capturing(createMockCollection());
  const store = new DispatchQueueStore({
    collection: main.collection,
    historyCollection: history.collection
  });
  return { store, mainQueries: main.queries, historyQueries: history.queries, mainFindOpts: main.findOpts, historyFindOpts: history.findOpts };
}

describe('maxTasks field threading (LIN-1751)', () => {
  test('addItem persists maxTasks on the stored doc', async () => {
    const store = makeStore();
    const doc = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 50 });
    assert.equal(doc.maxTasks, 50);
  });

  test('addItem defaults maxTasks to null (not undefined) when absent', async () => {
    const store = makeStore();
    const doc = await store.addItem('acme', { prompt: 'fresh task' });
    assert.strictEqual(doc.maxTasks, null);
  });

  test('the _formatItem seam (poll/take) exposes maxTasks to the consumer', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 50 });
    const items = await store.pollAvailable('acme');
    assert.equal(items.length, 1);
    assert.equal(items[0].maxTasks, 50);
  });

  test('a dispatch with no maxTasks reads maxTasks:null at every seam', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me' });

    const polled = await store.pollAvailable('acme');
    assert.strictEqual(polled[0].maxTasks, null);

    await store.takeItem(created._id, 'acme');
    const status = await store.getItemStatus('acme', created._id);
    assert.strictEqual(status.maxTasks, null);

    const { items } = await store.listHistory('acme');
    assert.strictEqual(items[0].maxTasks, null);
  });

  test('maxTasks is carried into history — the LOAD-BEARING leg (LIN-1698 failure class)', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 25 });

    // takeItem archives the doc to history — a kickoff row is typically
    // archived within seconds of a real run starting, so the budget guard's
    // anchor read (getItemStatus) must resolve maxTasks through the ARCHIVED
    // branch (_formatHistoryItem), not only the still-queued branch.
    await store.takeItem(created._id, 'acme');

    const status = await store.getItemStatus('acme', created._id);
    assert.equal(status.status, 'taken', 'sanity: resolved via the history branch, not the active queue');
    assert.equal(status.maxTasks, 25, 'a missing field here makes the budget guard silently stop enforcing');

    const { items } = await store.listHistory('acme');
    assert.equal(items.length, 1);
    assert.equal(items[0].maxTasks, 25);
  });

  test('echo honesty: getItemStatus and _formatItem agree on maxTasks — while still queued', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 10 });
    const watch = await store.getItemStatus('acme', created._id);
    assert.equal(watch.status, 'queued', 'sanity: resolved via the active-queue branch');
    const taken = await store.takeItem(created._id, 'acme');
    assert.equal(watch.maxTasks, taken.maxTasks);
  });

  test('echo honesty: getItemStatus and _formatItem agree on maxTasks — once archived', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxTasks: 10 });
    const taken = await store.takeItem(created._id, 'acme');
    const watch = await store.getItemStatus('acme', created._id);
    assert.equal(watch.status, 'taken', 'sanity: resolved via the history branch');
    assert.equal(watch.maxTasks, taken.maxTasks);
  });

  // LIN-2934 R2: the sibling of the `maxTasks` LOAD-BEARING archive-hop test
  // above, for `maxSessionsPerTask`. Review found this leg untested — a
  // mutation dropping `maxSessionsPerTask` from `_archiveItem`'s allowlist
  // survived the full 19-file budget suite (M11) even though the identical
  // mutation on `maxTasks` fails 3 tests, including the one right above this.
  test('maxSessionsPerTask is carried into history — the LOAD-BEARING leg (LIN-1698 failure class)', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxSessionsPerTask: 4 });

    // takeItem archives the doc to history — a kickoff row is typically
    // archived within seconds of a real run starting, so the budget guard's
    // anchor read (getItemStatus) must resolve maxSessionsPerTask through the
    // ARCHIVED branch (_formatHistoryItem), not only the still-queued branch.
    await store.takeItem(created._id, 'acme');

    const status = await store.getItemStatus('acme', created._id);
    assert.equal(status.status, 'taken', 'sanity: resolved via the history branch, not the active queue');
    assert.equal(status.maxSessionsPerTask, 4, 'a missing field here makes the sessions-per-task guard silently stop enforcing');

    const { items } = await store.listHistory('acme');
    assert.equal(items.length, 1);
    assert.equal(items[0].maxSessionsPerTask, 4);
  });

  test('echo honesty: getItemStatus and _formatItem agree on maxSessionsPerTask — once archived', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', maxSessionsPerTask: 6 });
    const taken = await store.takeItem(created._id, 'acme');
    const watch = await store.getItemStatus('acme', created._id);
    assert.equal(watch.status, 'taken', 'sanity: resolved via the history branch');
    assert.equal(watch.maxSessionsPerTask, taken.maxSessionsPerTask);
  });
});

describe('countDistinctTasksForSession (LIN-1751)', () => {
  test('pushes the whole predicate into BOTH collections', async () => {
    const { store, mainQueries, historyQueries } = makeCapturingStore();

    await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-1');

    assert.equal(mainQueries.length, 1, 'the live queue must be read');
    assert.equal(historyQueries.length, 1,
      'history must be read too — the run\'s earlier task dispatches have usually already been claimed');

    for (const query of [mainQueries[0], historyQueries[0]]) {
      assert.equal(query.urlKey, 'acme');
      assert.equal(query.sessionId, 'run-1');
      assert.strictEqual(query.followUpTo, null, 'a follow-up beat is the intended continuation, never a new task');
      assert.deepEqual(query.abort, { $ne: true }, 'a cascade abort is coordination, not a task');
      assert.deepEqual(query.issueIdentifier, { $ne: null }, 'only issue-bearing rows are tasks');
      assert.ok(!('status' in query), 'must never filter on status (LIN-1594)');
    }
  });

  test('projects down to _id and issueIdentifier only on both reads', async () => {
    // LIN-2934 (F3): `_id` is projected too, so `taskDispatches` can de-dupe by
    // `_id` across the queue+history union without a second read.
    const { store, mainFindOpts, historyFindOpts } = makeCapturingStore();
    await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-1');
    assert.deepEqual(mainFindOpts[0], { projection: { _id: 1, issueIdentifier: 1 } });
    assert.deepEqual(historyFindOpts[0], { projection: { _id: 1, issueIdentifier: 1 } });
  });

  test('counts DISTINCT issueIdentifiers, deduping repeat dispatches for the same task', async () => {
    const store = makeStore();
    // The same task (LIN-1) dispatched 3 times (research, plan, implementation) —
    // a real run's normal pipeline — plus one other task (LIN-2).
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-2', sessionId: 'run-1' });

    const result = await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-1');
    assert.equal(result.count, 2, 'two DISTINCT tasks, not four dispatches');
    assert.equal(result.alreadyCounted, true, 'LIN-1 already has dispatches under this session');
    // LIN-2934: taskDispatches counts DISPATCHES to the candidate task, not
    // distinct tasks — the opposite of `count` — so it reports 3, not 2.
    assert.equal(result.taskDispatches, 3, 'LIN-1 was dispatched 3 times under this session');
  });

  test('taskDispatches is 0 for a genuinely new task, and unaffected by other tasks\' dispatch counts (LIN-2934)', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });

    const result = await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-99');
    assert.equal(result.taskDispatches, 0, 'LIN-99 has never been dispatched under this session');
  });

  test('taskDispatches de-duplicates by _id across a queue/history archive-overlap window (LIN-2934, F3)', async () => {
    const store = makeStore();
    const item = await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });

    // Simulate the `cleanup()` archive window: `_archiveItem` has inserted the
    // doc into history, but the matching `deleteMany` on the queue hasn't run
    // yet — so the SAME row (same `_id`) is briefly present in BOTH
    // collections. A flat length over the unioned results would double-count
    // it; taskDispatches must not.
    await store.historyCollection.insertOne({ ...item, status: 'expired' });
    assert.equal((await store.listItems('acme')).length, 2, 'the queue row was not actually removed yet (simulated overlap)');

    const result = await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-1');
    assert.equal(result.taskDispatches, 2, 'the overlapping row must be counted once, by _id, not twice');
  });

  test('alreadyCounted is false for a genuinely new task', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });

    const result = await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-99');
    assert.equal(result.count, 1);
    assert.equal(result.alreadyCounted, false, 'LIN-99 has no prior dispatch under this session');
  });

  test('reads BOTH queue and history — a claimed dispatch has already left the queue', async () => {
    const store = makeStore();
    const item = await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });
    await store.takeItem(item._id, 'acme');
    assert.equal((await store.listItems('acme')).length, 0, 'the dispatch must have left the queue');

    const result = await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-1');
    assert.equal(result.count, 1, 'a history-only task dispatch must still count');
    assert.equal(result.alreadyCounted, true);
  });

  test('excludes followUpTo beats, aborts, and issue-less rows — coordination is never a task', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });
    // A follow-up beat on the same task — must not be double-counted, and a
    // followUpTo row on a DIFFERENT (hypothetical) task must not count either.
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1', followUpTo: 'some-anchor' });
    // A cascade abort.
    await store.addItem('acme', { prompt: null, abort: true, abortTo: 'some-session', sessionId: 'run-1' });
    // An issue-less row (e.g. a stack-walk kickoff dispatched under this sessionId).
    await store.addItem('acme', { prompt: 'x', sessionId: 'run-1' });

    const result = await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-1');
    assert.equal(result.count, 1, 'only the one fresh, issue-bearing row counts');
    assert.equal(result.taskDispatches, 1, 'taskDispatches excludes the same rows, for the same reasons');
  });

  test('never filters on status — a stale "taken" row still counts (LIN-1594)', async () => {
    const store = makeStore();
    const item = await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });
    await store.takeItem(item._id, 'acme');
    const result = await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-1');
    assert.equal(result.count, 1);
  });

  test('a different sessionId is a different run — never counted together', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-1', sessionId: 'run-1' });
    await store.addItem('acme', { prompt: 'x', issueIdentifier: 'LIN-2', sessionId: 'run-2' });

    const result = await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-1');
    assert.equal(result.count, 1);
  });

  test('returns null when required inputs are missing, and issues no query', async () => {
    const { store, mainQueries } = makeCapturingStore();
    assert.equal(await store.countDistinctTasksForSession('acme', null, 'LIN-1'), null);
    assert.equal(await store.countDistinctTasksForSession(null, 'run-1', 'LIN-1'), null);
    assert.equal(mainQueries.length, 0, 'an unkeyable lookup must not issue a query at all');
  });

  test('returns null on a read error rather than throwing (the caller decides fail-open vs fail-closed)', async () => {
    const brokenCollection = {
      find() {
        return { toArray: async () => { throw new Error('db unavailable'); } };
      }
    };
    const store = new DispatchQueueStore({ collection: brokenCollection, historyCollection: createMockCollection() });
    const result = await store.countDistinctTasksForSession('acme', 'run-1', 'LIN-1');
    assert.strictEqual(result, null);
  });
});
