/**
 * LIN-4178: the lineage identity read over the raw collections (lineageIdentityOfRows, lib/dispatch-store.js).
 *
 * Run with: node --test tests/unit/lineage-identity-read.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { lineageIdentityOfRows, findLineageIdentity, UnboundedHistoryReadError, LINEAGE_IDENTITY_BATCH_SIZE } from '../../lib/dispatch-store.js';
import { LINEAGE_IDENTITY_PROJECTION } from '../../lib/dispatch-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

/** A collection that records every find and answers from `rows` by the query's own filter. */
function recordingCollection(rows) {
  const calls = [];
  return {
    calls,
    find(query, opts) {
      calls.push({ query, opts });
      const hit = rows.filter(r => r.urlKey === query.urlKey && query.rootItemId.$in.includes(r.rootItemId));
      return { toArray: async () => hit };
    },
  };
}

describe('lineageIdentityOfRows: the query shape', () => {
  test('one query per urlKey and batch, over both collections, always with urlKey and the identity projection', async () => {
    const anchors = Array.from({ length: LINEAGE_IDENTITY_BATCH_SIZE + 3 }, (_, i) => `a${i}`);
    const history = recordingCollection([]);
    const queue = recordingCollection([]);
    await lineageIdentityOfRows([history, queue], [
      ...anchors.map(rootItemId => ({ urlKey: 'ws-1', rootItemId })),
      { urlKey: 'ws-2', rootItemId: 'b0' },
    ]);
    for (const collection of [history, queue]) {
      assert.equal(collection.calls.length, 3, 'ws-1 in two batches, ws-2 in one');
      for (const { query, opts } of collection.calls) {
        assert.ok(typeof query.urlKey === 'string', 'every query names its workspace (the index leads with urlKey)');
        assert.ok(query.rootItemId.$in.length <= LINEAGE_IDENTITY_BATCH_SIZE, 'a batch is at most LINEAGE_IDENTITY_BATCH_SIZE anchors');
        assert.deepEqual(opts.projection, LINEAGE_IDENTITY_PROJECTION);
        assert.equal('since' in query, false, 'never windowed by time');
        assert.equal(opts.limit, undefined, 'never capped');
      }
    }
  });

  test('an anchor is looked up once per workspace however many rows name it', async () => {
    const history = recordingCollection([]);
    await lineageIdentityOfRows([history], [
      { urlKey: 'ws', rootItemId: 'r' }, { urlKey: 'ws', rootItemId: 'r' }, { urlKey: 'ws', rootItemId: 'r' },
    ]);
    assert.equal(history.calls.length, 1);
    assert.deepEqual(history.calls[0].query.rootItemId.$in, ['r']);
  });

  test('rows without a urlKey or a rootItemId are not looked up, and no rows means no read', async () => {
    const history = recordingCollection([]);
    await lineageIdentityOfRows([history], [{ rootItemId: 'r' }, { urlKey: 'ws' }, null]);
    assert.equal(history.calls.length, 0);
    assert.deepEqual(await lineageIdentityOfRows([history], []), []);
    assert.equal(history.calls.length, 0);
  });

  test('a founder in both collections is returned once, and a missing collection is skipped', async () => {
    const founder = { _id: 'f', urlKey: 'ws', rootItemId: 'f', issueIdentifier: 'LIN-42', kind: 'implementation', status: 'taken', abort: false, dispatchedAt: new Date() };
    const found = await lineageIdentityOfRows([recordingCollection([founder]), recordingCollection([founder])], [{ urlKey: 'ws', rootItemId: 'f' }]);
    assert.equal(found.length, 1);
    const onlyHistory = await lineageIdentityOfRows([recordingCollection([founder])], [{ urlKey: 'ws', rootItemId: 'f' }]);
    assert.equal(onlyHistory.length, 1);
  });
});

describe('findLineageIdentity: the one implementation carries the bounded-read guard (LIN-4201)', () => {
  test('a query with a urlKey but no rootItemId and no issueIdentifier is rejected, and nothing is read', async () => {
    const history = recordingCollection([]);
    const queue = recordingCollection([]);
    await assert.rejects(() => findLineageIdentity([history, queue], { urlKey: 'ws' }), UnboundedHistoryReadError);
    assert.equal(history.calls.length, 0, 'the guard fires before any find');
    assert.equal(queue.calls.length, 0, 'the guard fires before any find');
  });
});

describe('lineageIdentityOfRows on a real engine: a workspace never reads another workspace\'s founders', () => {
  const harness = createMangoTmpdir('lin-4178-founder-');
  before(() => harness.connect());
  after(() => harness.close());
  let db;
  beforeEach(() => { db = harness.freshDb(); });

  test('the same anchor in two workspaces is looked up per workspace', async () => {
    const history = db.collection('dispatch-history');
    const queue = db.collection('dispatch-queue');
    const at = new Date('2026-06-01T00:00:00.000Z');
    await history.insertMany([
      { _id: 'shared-a', urlKey: 'ws-a', rootItemId: 'shared', issueIdentifier: 'LIN-A', kind: 'implementation', status: 'taken', abort: false, dispatchedAt: at, prompt: 'secret A' },
      { _id: 'shared-b', urlKey: 'ws-b', rootItemId: 'shared', issueIdentifier: 'LIN-B', kind: 'implementation', status: 'taken', abort: false, dispatchedAt: at, prompt: 'secret B' },
    ]);
    await queue.insertOne({ _id: 'q-a', urlKey: 'ws-a', rootItemId: 'queued-a', issueIdentifier: 'LIN-Q', kind: 'implementation', status: 'queued', abort: false, dispatchedAt: at });

    const found = await lineageIdentityOfRows([history, queue], [
      { urlKey: 'ws-a', rootItemId: 'shared' },
      { urlKey: 'ws-a', rootItemId: 'queued-a' },
    ]);
    const ids = found.map(r => r._id).sort();
    assert.deepEqual(ids, ['q-a', 'shared-a'], 'ws-a\'s own founder and queue row, never ws-b\'s');
    for (const r of found) {
      assert.equal(r.prompt, undefined, 'the identity projection carries no prompt');
      assert.ok(!('feedback' in r), 'and no feedback');
    }
  });
});
