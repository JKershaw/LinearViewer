/**
 * Unit tests for agent-status-store.js
 *
 * Run with: node --test tests/unit/agent-store.test.js
 *
 * Covers the store's listStatus contract — specifically the "no limit means
 * return everything" semantics added to avoid silent truncation for callers
 * like pipeline-loops.js that need the full non-expired set.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AgentStatusStore } from '../../lib/agent-status-store.js';

// Minimal in-memory mock of the MongoDB/MangoDB collection surface the store uses.
function createMockCollection() {
  const docs = [];
  const capturedQueries = [];
  return {
    _docs: docs,
    _queries: capturedQueries,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id };
    },
    find(query) {
      capturedQueries.push(query);
      const results = docs.filter(doc => {
        if (query.urlKey && doc.urlKey !== query.urlKey) return false;
        if (query.expiresAt?.$gt && !(doc.expiresAt > query.expiresAt.$gt)) return false;
        // Honour top-level equality on taskIdentifier so this mock mirrors real
        // MangoDB/MongoDB query matching (LIN-613 pushes this filter into the query).
        if (query.taskIdentifier && doc.taskIdentifier !== query.taskIdentifier) return false;
        // Honour the 30-day `since` window (LIN-622) the feed read pushes down,
        // and the exclusive `until` upper bound (LIN-1494) the live-console
        // history cursor pushes down.
        if (query.timestamp?.$gte && !(doc.timestamp >= query.timestamp.$gte)) return false;
        if (query.timestamp?.$lt && !(doc.timestamp < query.timestamp.$lt)) return false;
        return true;
      });
      return {
        async toArray() {
          return results;
        }
      };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        const doc = docs[i];
        let match = true;
        if (query.urlKey && doc.urlKey !== query.urlKey) match = false;
        if (query.expiresAt?.$lt && !(doc.expiresAt < query.expiresAt.$lt)) match = false;
        if (match) {
          docs.splice(i, 1);
          count++;
        }
      }
      return { deletedCount: count };
    }
  };
}

describe('AgentStatusStore.listStatus', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new AgentStatusStore({ collection });
  });

  async function seed(urlKey, count) {
    for (let i = 0; i < count; i++) {
      await store.recordStatus({
        urlKey,
        taskIdentifier: `LIN-${i}`,
        action: 'research',
        status: 'completed',
        summary: `Entry ${i}`
      });
    }
  }

  test('returns empty result when urlKey missing', async () => {
    const result = await store.listStatus('');
    assert.deepStrictEqual(result, { items: [], total: 0 });
  });

  test('returns all entries when limit is omitted (no silent truncation)', async () => {
    // LIN-254: the old signature defaulted limit=20, silently dropping rows
    // beyond the first page. Callers like pipeline-loops.js need the full set.
    await seed('ws-1', 25);

    const result = await store.listStatus('ws-1');
    assert.strictEqual(result.total, 25);
    assert.strictEqual(result.items.length, 25);
  });

  test('returns all entries when only offset=0 is supplied', async () => {
    await seed('ws-1', 30);

    const result = await store.listStatus('ws-1', { offset: 0 });
    assert.strictEqual(result.total, 30);
    assert.strictEqual(result.items.length, 30);
  });

  test('still paginates when limit is supplied', async () => {
    await seed('ws-1', 25);

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

  test('windows by a since predicate, pushed into the query, excluding older entries (LIN-622)', async () => {
    const base = Date.now();
    const expiresAt = new Date(base + 1000 * 60 * 60 * 24 * 30);
    collection._docs.push(
      { _id: 'recent', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'research', status: 'completed', summary: 'r', timestamp: new Date(base), expiresAt },
      { _id: 'old', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'research', status: 'completed', summary: 'o', timestamp: new Date(base - 1000 * 60 * 60 * 24 * 45), expiresAt }
    );
    const since = new Date(base - 1000 * 60 * 60 * 24 * 30);

    const result = await store.listStatus('ws-1', { since });

    const query = collection._queries[collection._queries.length - 1];
    assert.deepStrictEqual(query.timestamp, { $gte: since },
      'the since window must ride into the query so a real DB filters server-side');
    assert.strictEqual(result.total, 1, 'only the in-window entry is materialised');
    assert.strictEqual(result.items[0].id, 'recent');
  });

  test('windows by an until predicate (exclusive), pushed into the query alongside since (LIN-1494)', async () => {
    // The live-console history cursor: paging past a capped read only works
    // if the upper bound rides into the QUERY — otherwise every "view more"
    // re-reads the same newest-N rows and hasMore=true loops on empty pages.
    const base = Date.now();
    const expiresAt = new Date(base + 1000 * 60 * 60 * 24 * 30);
    collection._docs.push(
      { _id: 'newest', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'research', status: 'completed', summary: 'n', timestamp: new Date(base), expiresAt },
      { _id: 'mid', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'research', status: 'completed', summary: 'm', timestamp: new Date(base - 1000 * 60 * 60), expiresAt },
      { _id: 'old', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'research', status: 'completed', summary: 'o', timestamp: new Date(base - 1000 * 60 * 60 * 2), expiresAt },
      { _id: 'at-until', urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'research', status: 'completed', summary: 'a', timestamp: new Date(base - 1000 * 60 * 30), expiresAt }
    );
    const since = new Date(base - 1000 * 60 * 60 * 24 * 7);
    const until = new Date(base - 1000 * 60 * 30); // excludes 'newest' AND 'at-until' (exclusive bound)

    const result = await store.listStatus('ws-1', { since, until });

    const query = collection._queries[collection._queries.length - 1];
    assert.deepStrictEqual(query.timestamp, { $gte: since, $lt: until },
      'both bounds must ride into ONE timestamp predicate so a real DB filters server-side');
    assert.strictEqual(result.total, 2, 'total counts the [since, until) window pre-slice');
    assert.deepStrictEqual(result.items.map(i => i.id), ['mid', 'old'], 'newest-first within the window; at/after until excluded');
  });

  test('until alone forms its own query bound; total stays pre-slice under limit', async () => {
    const base = Date.now();
    const expiresAt = new Date(base + 1000 * 60 * 60 * 24 * 30);
    for (let i = 0; i < 5; i++) {
      collection._docs.push({ _id: `d-${i}`, urlKey: 'ws-1', taskIdentifier: 'LIN-1', action: 'research', status: 'completed', summary: `s${i}`, timestamp: new Date(base - i * 1000), expiresAt });
    }
    const until = new Date(base - 500); // excludes only the newest (d-0)

    const result = await store.listStatus('ws-1', { until, limit: 2 });

    const query = collection._queries[collection._queries.length - 1];
    assert.deepStrictEqual(query.timestamp, { $lt: until }, 'until without since is a bare $lt bound');
    assert.strictEqual(result.total, 4, 'the pre-slice windowed count, not the limited page size');
    assert.strictEqual(result.items.length, 2);
  });

  test('isolates entries per urlKey', async () => {
    await seed('ws-1', 5);
    await seed('ws-2', 3);

    const ws1 = await store.listStatus('ws-1');
    const ws2 = await store.listStatus('ws-2');
    assert.strictEqual(ws1.total, 5);
    assert.strictEqual(ws2.total, 3);
  });

  test('sorts results newest-first', async () => {
    const base = Date.now();
    // Insert directly with controlled timestamps so order is deterministic.
    for (let i = 0; i < 3; i++) {
      collection._docs.push({
        _id: `id-${i}`,
        urlKey: 'ws-1',
        taskIdentifier: `LIN-${i}`,
        action: 'research',
        status: 'completed',
        summary: `Entry ${i}`,
        timestamp: new Date(base + i * 1000),
        expiresAt: new Date(base + 1000 * 60 * 60 * 24 * 30)
      });
    }

    const result = await store.listStatus('ws-1');
    assert.strictEqual(result.items[0].taskIdentifier, 'LIN-2');
    assert.strictEqual(result.items[1].taskIdentifier, 'LIN-1');
    assert.strictEqual(result.items[2].taskIdentifier, 'LIN-0');
  });

  test('excludes expired entries', async () => {
    const now = Date.now();
    collection._docs.push({
      _id: 'live',
      urlKey: 'ws-1',
      taskIdentifier: 'LIN-live',
      action: 'research',
      status: 'completed',
      summary: 'live',
      timestamp: new Date(now),
      expiresAt: new Date(now + 1000 * 60)
    });
    collection._docs.push({
      _id: 'expired',
      urlKey: 'ws-1',
      taskIdentifier: 'LIN-expired',
      action: 'research',
      status: 'completed',
      summary: 'expired',
      timestamp: new Date(now - 1000 * 60 * 60),
      expiresAt: new Date(now - 1000 * 60)
    });

    const result = await store.listStatus('ws-1');
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.items[0].taskIdentifier, 'LIN-live');
  });

  // LIN-613: opening "Dispatched Sessions" for ONE issue must not pull the whole
  // workspace's 30-day status log and filter in JS — that full read is what timed
  // out on large workspaces. The per-task filter must ride into the query so the
  // {urlKey, taskIdentifier} index bounds the read.
  describe('taskIdentifier pushdown', () => {
    test('pushes taskIdentifier into the collection query (not a JS post-filter)', async () => {
      await seed('ws-1', 5);
      collection._queries.length = 0;

      await store.listStatus('ws-1', { taskIdentifier: 'LIN-3' });

      assert.strictEqual(collection._queries.length, 1, 'exactly one query issued');
      assert.strictEqual(
        collection._queries[0].taskIdentifier,
        'LIN-3',
        'the per-task filter must be in the query sent to the store, so a real DB ' +
        'uses the {urlKey, taskIdentifier} index instead of scanning the workspace'
      );
    });

    test('returns only the requested issue’s entries', async () => {
      await seed('ws-1', 5); // LIN-0..LIN-4
      const result = await store.listStatus('ws-1', { taskIdentifier: 'LIN-2' });
      assert.strictEqual(result.total, 1);
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].taskIdentifier, 'LIN-2');
    });

    test('omitting taskIdentifier leaves it out of the query (workspace-wide read)', async () => {
      await seed('ws-1', 3);
      collection._queries.length = 0;

      await store.listStatus('ws-1');

      assert.strictEqual(collection._queries.length, 1);
      assert.ok(
        !('taskIdentifier' in collection._queries[0]),
        'unscoped reads must not carry a taskIdentifier predicate'
      );
    });

    test('still respects the unattributed tokenId post-filter alongside the query', async () => {
      // tokenId stays a JS post-filter (its __unattributed__ sentinel has no
      // query equivalent); it must compose with the pushed-down taskIdentifier.
      await store.recordStatus({ urlKey: 'ws-1', taskIdentifier: 'LIN-9', action: 'a', status: 'completed', summary: 's', tokenId: 'tok-1' });
      await store.recordStatus({ urlKey: 'ws-1', taskIdentifier: 'LIN-9', action: 'a', status: 'completed', summary: 's' }); // unattributed

      const attributed = await store.listStatus('ws-1', { taskIdentifier: 'LIN-9', tokenId: 'tok-1' });
      assert.strictEqual(attributed.total, 1);
      assert.strictEqual(attributed.items[0].tokenId, 'tok-1');

      const unattributed = await store.listStatus('ws-1', { taskIdentifier: 'LIN-9', tokenId: '__unattributed__' });
      assert.strictEqual(unattributed.total, 1);
      assert.strictEqual(unattributed.items[0].tokenId, undefined);
    });
  });
});
