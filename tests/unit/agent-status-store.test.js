/**
 * Unit tests for agent-status-store.js
 *
 * Run with: node --test tests/unit/agent-status-store.test.js
 *
 * Covers the store's listStatus contract — specifically the "no limit means
 * return everything" semantics added to avoid silent truncation for callers
 * like pipeline-loops.js that need the full retained set.
 *
 * LIN-3162 (LIN-3157 A2): the listStatus reads moved to database-side
 * filter/sort/skip/limit + countDocuments, and the expiry predicate was
 * replaced by the shared 30-day read horizon on `timestamp`. Those query tests
 * run on a REAL MangoDB tmpdir (see tests/fixtures/mango-tmpdir.js): the
 * previous inline double ignored unknown operators and had a `toArray()`-only
 * cursor with no `countDocuments`, so `$or`/`$exists` matching, sort/skip/limit
 * chaining and countDocuments would all have passed vacuously against it.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { createMangoTmpdir, recordingCollection } from '../fixtures/mango-tmpdir.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('AgentStatusStore.listStatus (real MangoDB tmpdir, LIN-3162 A2)', () => {
  let harness;
  let raw;
  let collection;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3162-agent-status-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('foreman-status');
    collection = recordingCollection(raw);
    store = new AgentStatusStore({ collection });
  });

  // Realistic document: expiresAt derived from timestamp (the pre-A2 stamp
  // discipline). `seedRaw` inserts exactly the fields given, for the
  // lifetime-retention / no-stamp shapes A2 must handle.
  async function seed({ tokenId, expiresAt, ...doc }) {
    const timestamp = doc.timestamp || new Date();
    const out = {
      urlKey: 'ws-1',
      taskIdentifier: 'LIN-1',
      action: 'research',
      status: 'completed',
      summary: 's',
      ...doc,
      timestamp
    };
    if ('tokenId' in doc || tokenId !== undefined) out.tokenId = tokenId;
    out.expiresAt = expiresAt !== undefined
      ? expiresAt
      : new Date(timestamp.getTime() + 30 * DAY_MS);
    await raw.insertOne(out);
    return out;
  }

  async function seedRaw(doc) {
    await raw.insertOne(doc);
    return doc;
  }

  const lastQuery = () => collection.__record.finds.at(-1)?.query;

  test('returns empty result when urlKey missing', async () => {
    const result = await store.listStatus('');
    assert.deepStrictEqual(result, { items: [], total: 0 });
    assert.strictEqual(collection.__record.finds.length, 0, 'no query for a missing urlKey');
  });

  test('returns all entries when limit is omitted (no silent truncation)', async () => {
    for (let i = 0; i < 25; i++) await seed({ _id: `x${i}`, timestamp: new Date(Date.now() - i * 1000) });
    const result = await store.listStatus('ws-1');
    assert.strictEqual(result.total, 25);
    assert.strictEqual(result.items.length, 25);
  });

  test('returns all entries when only offset=0 is supplied', async () => {
    for (let i = 0; i < 30; i++) await seed({ _id: `x${i}`, timestamp: new Date(Date.now() - i * 1000) });
    const result = await store.listStatus('ws-1', { offset: 0 });
    assert.strictEqual(result.total, 30);
    assert.strictEqual(result.items.length, 30);
  });

  test('still paginates when limit is supplied', async () => {
    for (let i = 0; i < 25; i++) await seed({ _id: `x${i}`, timestamp: new Date(Date.now() - i * 1000) });

    const page1 = await store.listStatus('ws-1', { limit: 10 });
    assert.strictEqual(page1.total, 25);
    assert.strictEqual(page1.items.length, 10);

    const page2 = await store.listStatus('ws-1', { limit: 10, offset: 10 });
    assert.strictEqual(page2.total, 25);
    assert.strictEqual(page2.items.length, 10);

    const page3 = await store.listStatus('ws-1', { limit: 10, offset: 20 });
    assert.strictEqual(page3.total, 25);
    assert.strictEqual(page3.items.length, 5);
  });

  test('has no default horizon bound: an un-scoped read pages over full retained history (LIN-3163 B)', async () => {
    const now = Date.now();
    await seedRaw({ _id: 'inside', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 5 * DAY_MS) });
    await seedRaw({ _id: 'outside-horizon', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 40 * DAY_MS) });

    const { items, total } = await store.listStatus('ws-1');
    const q = lastQuery();
    assert.strictEqual(q.timestamp, undefined, 'the default 30-day `since` bound is gone from the paged list');
    assert.strictEqual(q.expiresAt, undefined, 'the expiry predicate is gone');
    assert.strictEqual(total, 2, 'both rows are read over the full retained history');
    assert.deepStrictEqual(items.map(i => i.id), ['inside', 'outside-horizon']);
  });

  test('windows by a since predicate, pushed into the query, excluding older entries (LIN-622 preserved)', async () => {
    const now = Date.now();
    await seed({ _id: 'recent', timestamp: new Date(now) });
    await seed({ _id: 'old', timestamp: new Date(now - 45 * DAY_MS) });
    const since = new Date(now - 30 * DAY_MS);

    const result = await store.listStatus('ws-1', { since });
    assert.deepStrictEqual(lastQuery().timestamp, { $gte: since });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.items[0].id, 'recent');
  });

  test('windows by an until predicate (exclusive) alongside since (LIN-1494 preserved)', async () => {
    const now = Date.now();
    await seed({ _id: 'newest', timestamp: new Date(now) });
    await seed({ _id: 'mid', timestamp: new Date(now - 60 * 60 * 1000) });
    await seed({ _id: 'old', timestamp: new Date(now - 2 * 60 * 60 * 1000) });
    await seed({ _id: 'at-until', timestamp: new Date(now - 30 * 60 * 1000) });
    const since = new Date(now - 7 * DAY_MS);
    const until = new Date(now - 30 * 60 * 1000);

    const result = await store.listStatus('ws-1', { since, until });
    assert.deepStrictEqual(lastQuery().timestamp, { $gte: since, $lt: until });
    assert.strictEqual(result.total, 2);
    assert.deepStrictEqual(result.items.map(i => i.id), ['mid', 'old']);
  });

  test('until alone forms its own query bound with no default since; total stays pre-slice under limit (LIN-3163 B)', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) await seed({ _id: `d-${i}`, timestamp: new Date(now - i * 1000) });
    const until = new Date(now - 500);

    const result = await store.listStatus('ws-1', { until, limit: 2 });
    const q = lastQuery();
    // B: no default `since` is injected when only `until` is supplied.
    assert.strictEqual(q.timestamp.$gte, undefined, 'no default since when only until is given');
    assert.strictEqual(q.timestamp.$lt.getTime(), until.getTime());
    assert.strictEqual(result.total, 4, 'the pre-slice count, not the limited page size');
    assert.strictEqual(result.items.length, 2);
  });

  test('until alone reaches a >30d row (lifetime retention, LIN-3163 B)', async () => {
    const now = Date.now();
    // A row older than 30 days, well inside an `until` bound of an hour ago.
    await seedRaw({ _id: 'ancient', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 40 * DAY_MS) });
    // A row after the `until` bound, which must stay excluded.
    await seedRaw({ _id: 'after-until', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 60 * 1000) });
    const until = new Date(now - 60 * 60 * 1000);

    const result = await store.listStatus('ws-1', { until });
    assert.strictEqual(result.total, 1, 'the >30d row is read: no default horizon is injected');
    assert.deepStrictEqual(result.items.map(i => i.id), ['ancient']);
  });

  test('isolates entries per urlKey', async () => {
    for (let i = 0; i < 5; i++) await seed({ _id: `a${i}`, urlKey: 'ws-1' });
    for (let i = 0; i < 3; i++) await seed({ _id: `b${i}`, urlKey: 'ws-2' });
    assert.strictEqual((await store.listStatus('ws-1')).total, 5);
    assert.strictEqual((await store.listStatus('ws-2')).total, 3);
  });

  test('sorts results newest-first', async () => {
    const base = Date.now();
    for (let i = 0; i < 3; i++) {
      await seed({ _id: `id-${i}`, taskIdentifier: `LIN-${i}`, timestamp: new Date(base + i * 1000) });
    }
    const result = await store.listStatus('ws-1');
    assert.deepStrictEqual(result.items.map(i => i.taskIdentifier), ['LIN-2', 'LIN-1', 'LIN-0']);
  });

  // ---------------------------------------------------------------------------
  // A2 neutrality: the horizon keys on timestamp, not the expiry stamp.
  // ---------------------------------------------------------------------------

  test('includes a row older than 30 days in the paged list (LIN-3163 B visibility change)', async () => {
    const now = Date.now();
    const future = new Date(now + 365 * DAY_MS);
    await seedRaw({ _id: 'still-stamped', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 31 * DAY_MS), expiresAt: future });
    await seedRaw({ _id: 'inside', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 29 * DAY_MS), expiresAt: future });

    const result = await store.listStatus('ws-1');
    assert.strictEqual(result.total, 2, 'listStatus now pages over the full retained history');
    assert.deepStrictEqual(result.items.map(i => i.id), ['inside', 'still-stamped']);
  });

  test('returns a row with NO expiresAt field when it is inside the horizon (A2)', async () => {
    const now = Date.now();
    await seedRaw({ _id: 'no-stamp', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 5 * DAY_MS) });

    const result = await store.listStatus('ws-1');
    assert.strictEqual(result.total, 1, 'a row with no expiry stamp must remain readable');
    assert.strictEqual(result.items[0].id, 'no-stamp');
  });

  // ---------------------------------------------------------------------------
  // Same-millisecond ordering: `_id` descending (an accepted A2 change).
  // ---------------------------------------------------------------------------

  test('orders same-millisecond rows by _id descending and pages without duplicates or gaps (A2)', async () => {
    const now = Date.now();
    const ts = new Date(now - 1000);
    // Inserted in an order that differs from _id-desc: c, a, b.
    for (const id of ['c', 'a', 'b']) {
      await seedRaw({ _id: id, urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: ts, expiresAt: new Date(now + DAY_MS) });
    }

    const p0 = await store.listStatus('ws-1', { limit: 1, offset: 0 });
    const p1 = await store.listStatus('ws-1', { limit: 1, offset: 1 });
    const p2 = await store.listStatus('ws-1', { limit: 1, offset: 2 });

    assert.deepStrictEqual([p0.items[0].id, p1.items[0].id, p2.items[0].id], ['c', 'b', 'a']);
    assert.strictEqual(new Set([p0.items[0].id, p1.items[0].id, p2.items[0].id]).size, 3, 'no duplicates across pages');
    assert.strictEqual(p0.total, 3);
  });

  // ---------------------------------------------------------------------------
  // tokenId: equality + `__unattributed__` sentinel, now composed into the query.
  // ---------------------------------------------------------------------------

  describe('tokenId filtering', () => {
    test('a given tokenId is an equality match in the query and returns only that token’s rows (A2)', async () => {
      await seed({ _id: 'm', tokenId: undefined, timestamp: new Date() }); // missing
      await seed({ _id: 'n', tokenId: null, timestamp: new Date() });
      await seed({ _id: 'e', tokenId: '', timestamp: new Date() });
      await seed({ _id: 't1', tokenId: 'tok-1', timestamp: new Date() });
      await seed({ _id: 't2', tokenId: 'tok-2', timestamp: new Date() });

      const result = await store.listStatus('ws-1', { tokenId: 'tok-1' });
      assert.strictEqual(lastQuery().tokenId, 'tok-1', 'tokenId must be a query predicate, not a post-filter');
      assert.deepStrictEqual(result.items.map(i => i.id), ['t1']);
      assert.strictEqual(result.total, 1);
    });

    test('__unattributed__ matches missing, null and "" tokenId but no populated token (A2)', async () => {
      await seed({ _id: 'm', tokenId: undefined, timestamp: new Date() });
      await seed({ _id: 'n', tokenId: null, timestamp: new Date() });
      await seed({ _id: 'e', tokenId: '', timestamp: new Date() });
      await seed({ _id: 't1', tokenId: 'tok-1', timestamp: new Date() });
      await seed({ _id: 't2', tokenId: 'tok-2', timestamp: new Date() });

      const result = await store.listStatus('ws-1', { tokenId: '__unattributed__' });
      assert.deepStrictEqual(
        result.items.map(i => i.id).sort(),
        ['e', 'm', 'n'],
        'the sentinel must return exactly the unattributed shapes and no populated token'
      );
      assert.strictEqual(result.total, 3);
    });

    test('the sentinel query uses $or over missing/null/empty, not a JS post-filter (A2)', async () => {
      await seed({ _id: 'm', tokenId: undefined, timestamp: new Date() });
      await store.listStatus('ws-1', { tokenId: '__unattributed__' });
      const q = lastQuery();
      assert.ok(Array.isArray(q.$or) && q.$or.length === 3, 'the sentinel must be a three-arm $or predicate');
      assert.deepStrictEqual(q.$or, [{ tokenId: { $exists: false } }, { tokenId: null }, { tokenId: '' }]);
    });

    test('the sentinel composes with taskIdentifier, dispatchId and since (A2)', async () => {
      const now = Date.now();
      await seedRaw({ _id: 'match', urlKey: 'ws-1', taskIdentifier: 'LIN-9', dispatchId: 'disp-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 1000) });
      await seedRaw({ _id: 'wrong-task', urlKey: 'ws-1', taskIdentifier: 'LIN-8', dispatchId: 'disp-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 1000) });
      await seedRaw({ _id: 'wrong-dispatch', urlKey: 'ws-1', taskIdentifier: 'LIN-9', dispatchId: 'disp-2', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 1000) });
      await seedRaw({ _id: 'too-old', urlKey: 'ws-1', taskIdentifier: 'LIN-9', dispatchId: 'disp-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 40 * DAY_MS) });
      await seedRaw({ _id: 'attributed', urlKey: 'ws-1', taskIdentifier: 'LIN-9', dispatchId: 'disp-1', tokenId: 'tok-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 1000) });

      const result = await store.listStatus('ws-1', {
        tokenId: '__unattributed__',
        taskIdentifier: 'LIN-9',
        dispatchId: 'disp-1',
        since: new Date(now - 30 * DAY_MS)
      });
      assert.deepStrictEqual(result.items.map(i => i.id), ['match'], 'all three predicates must compose in the query');
    });
  });

  // ---------------------------------------------------------------------------
  // Pushdowns preserved (LIN-613 taskIdentifier, LIN-2934 D1 dispatchId).
  // ---------------------------------------------------------------------------

  describe('taskIdentifier pushdown', () => {
    test('pushes taskIdentifier into the collection query (not a JS post-filter)', async () => {
      for (let i = 0; i < 5; i++) await seed({ _id: `x${i}`, taskIdentifier: `LIN-${i}` });
      assert.strictEqual(lastQuery(), undefined);
      await store.listStatus('ws-1', { taskIdentifier: 'LIN-3' });
      assert.strictEqual(lastQuery().taskIdentifier, 'LIN-3');
    });

    test('returns only the requested issue’s entries', async () => {
      for (let i = 0; i < 5; i++) await seed({ _id: `x${i}`, taskIdentifier: `LIN-${i}` });
      const result = await store.listStatus('ws-1', { taskIdentifier: 'LIN-2' });
      assert.strictEqual(result.total, 1);
      assert.strictEqual(result.items[0].taskIdentifier, 'LIN-2');
    });

    test('omitting taskIdentifier leaves it out of the query (workspace-wide read)', async () => {
      await seed({ _id: 'x', taskIdentifier: 'LIN-1' });
      await store.listStatus('ws-1');
      assert.ok(!('taskIdentifier' in lastQuery()), 'unscoped reads must not carry a taskIdentifier predicate');
    });
  });

  describe('dispatchId pushdown', () => {
    test('pushes dispatchId into the collection query (not a JS post-filter)', async () => {
      await seed({ _id: 'x', dispatchId: 'disp-3' });
      await store.listStatus('ws-1', { dispatchId: 'disp-3' });
      assert.strictEqual(lastQuery().dispatchId, 'disp-3');
    });

    test('returns only the requested dispatch’s entries', async () => {
      await seed({ _id: 'a', taskIdentifier: 'LIN-1', dispatchId: 'disp-1' });
      await seed({ _id: 'b', taskIdentifier: 'other-task', dispatchId: 'disp-1' });
      await seed({ _id: 'c', taskIdentifier: 'LIN-2', dispatchId: 'disp-2' });
      const result = await store.listStatus('ws-1', { dispatchId: 'disp-1' });
      assert.strictEqual(result.total, 2);
      assert.ok(result.items.every(item => item.dispatchId === 'disp-1'));
    });

    test('omitting dispatchId leaves it out of the query (workspace-wide read)', async () => {
      await seed({ _id: 'x', dispatchId: 'disp-3' });
      await store.listStatus('ws-1');
      assert.ok(!('dispatchId' in lastQuery()), 'unscoped reads must not carry a dispatchId predicate');
    });
  });

  // ---------------------------------------------------------------------------
  // Database-side paging proof: the ticket requires sort/skip/limit +
  // countDocuments, and that the cursor never materialise the whole window.
  // ---------------------------------------------------------------------------

  describe('database-side paging (A2)', () => {
    async function seedWindow(n) {
      for (let i = 0; i < n; i++) await seed({ _id: `x${i}`, timestamp: new Date(Date.now() - i * 1000) });
    }

    test('issues find().sort().skip().limit() and materialises at most `limit` rows', async () => {
      await seedWindow(25);
      const { total } = await store.listStatus('ws-1', { limit: 5, offset: 10 });
      const cursor = collection.__record.cursors.at(-1);
      assert.deepStrictEqual(cursor.sorts, [{ timestamp: -1, _id: -1 }], 'sort must be pushed into the cursor');
      assert.deepStrictEqual(cursor.skips, [10]);
      assert.deepStrictEqual(cursor.limits, [5]);
      assert.strictEqual(cursor.materialized, 5, 'only the page may be materialised, not the whole window');
      assert.strictEqual(total, 25);
    });

    test('takes `total` from countDocuments, not from a materialised array length', async () => {
      await seedWindow(25);
      const { total } = await store.listStatus('ws-1', { limit: 5 });
      assert.strictEqual(collection.__record.countDocuments.length, 1, 'exactly one countDocuments call');
      assert.strictEqual(total, 25);
      assert.strictEqual(collection.__record.countDocuments[0].query.urlKey, 'ws-1');
    });

    test('offset with no limit issues skip with no limit and returns the rest', async () => {
      await seedWindow(25);
      const { items, total } = await store.listStatus('ws-1', { offset: 10 });
      const cursor = collection.__record.cursors.at(-1);
      assert.deepStrictEqual(cursor.skips, [10]);
      assert.deepStrictEqual(cursor.limits, [], 'no limit on the unlimited path');
      assert.strictEqual(items.length, 15);
      assert.strictEqual(cursor.materialized, 15);
      assert.strictEqual(total, 25);
    });
  });
});

// ---------------------------------------------------------------------------
// C4 #7 (treatment H, permanent): summaries over the reporting window.
// No external callers today — pinned so they cannot become lifetime scans.
// ---------------------------------------------------------------------------

describe('AgentStatusStore listSessions/listTaskThreads read the reporting window (LIN-3162 A2)', () => {
  let harness;
  let raw;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3162-agent-sessions-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('foreman-status');
    store = new AgentStatusStore({ collection: raw });
  });

  const DAY_MS = 24 * 60 * 60 * 1000;

  test('listSessions counts rows with no expiresAt that are inside the horizon', async () => {
    const now = Date.now();
    await raw.insertOne({ _id: 'a', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - DAY_MS) });
    const { sessions } = await store.listSessions('ws-1');
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].itemCount, 1);
  });

  test('listSessions excludes a row older than the horizon even with a live stamped expiry', async () => {
    const now = Date.now();
    await raw.insertOne({ _id: 'old', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 40 * DAY_MS), expiresAt: new Date(now + 365 * DAY_MS) });
    const { sessions } = await store.listSessions('ws-1');
    assert.deepStrictEqual(sessions, []);
  });

  test('listTaskThreads counts rows with no expiresAt that are inside the horizon', async () => {
    const now = Date.now();
    await raw.insertOne({ _id: 'a', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - DAY_MS) });
    const { tasks } = await store.listTaskThreads('ws-1');
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].itemCount, 1);
  });

  test('listTaskThreads excludes a row older than the horizon even with a live stamped expiry', async () => {
    const now = Date.now();
    await raw.insertOne({ _id: 'old', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'a', status: 'completed', summary: 's', timestamp: new Date(now - 40 * DAY_MS), expiresAt: new Date(now + 365 * DAY_MS) });
    const { tasks } = await store.listTaskThreads('ws-1');
    assert.deepStrictEqual(tasks, []);
  });
});

// ---------------------------------------------------------------------------
// LIN-3163 (B): lifetime retention — no expiry stamp, no evictor.
// ---------------------------------------------------------------------------

describe('AgentStatusStore lifetime retention (LIN-3163 B)', () => {
  let harness;
  let raw;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3163-agent-status-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('foreman-status');
    store = new AgentStatusStore({ collection: raw });
  });

  test('recordStatus writes no expiresAt stamp', async () => {
    const doc = await store.recordStatus({ urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'research', status: 'completed', summary: 's' });
    assert.ok(!('expiresAt' in doc), 'a lifetime-retained status row carries no expiresAt stamp');
    const stored = await raw.findOne({ _id: doc._id });
    assert.ok(!('expiresAt' in stored), 'the persisted row carries no expiresAt stamp');
  });

  test('the cleanup evictor is gone', () => {
    assert.strictEqual(typeof AgentStatusStore.prototype.cleanup, 'undefined', 'cleanup must be deleted from the store');
    assert.strictEqual(typeof store.cleanup, 'undefined');
  });
});
