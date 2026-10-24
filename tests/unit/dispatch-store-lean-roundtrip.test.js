/**
 * LIN-3812 — the store's new queries against a REAL MangoDB tmpdir (the mock is not
 * evidence for engine semantics): the lean exclusion projections, `countDocuments` on
 * the queue, the watch token's `{_id: {$ne}}` sibling read with an exclusion
 * projection, and the lineage queries (`updateMany` with `$lte`/`$ne`/`null`, `$nin`,
 * `lineageStatus: null`, `_id: {$gt}` paging).
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const URL_KEY = 'acme';
const TOKEN = 'consumer-1';

describe('lean default + lineage queries (real MangoDB tmpdir, LIN-3812)', () => {
  let dbDir, client, store, history, queue, n = 0;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dispatch-store-lean-roundtrip-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    const db = client.db(`lean_${n++}`);
    history = db.collection('dispatch-history');
    queue = db.collection('dispatch-queue');
    store = new DispatchQueueStore({ collection: queue, historyCollection: history });
    store._notifyWriteForDoc = () => {};
  });
  const take = async (fields = {}) => {
    const doc = await store.addItem(URL_KEY, { prompt: 'a long prompt body', issueIdentifier: 'LIN-1', ...fields });
    await store.takeItem(doc._id, URL_KEY, TOKEN);
    return doc._id;
  };

  test('countItems is a countDocuments over the live queue', async () => {
    assert.equal(await store.countItems(URL_KEY), 0);
    await store.addItem(URL_KEY, { prompt: 'a' });
    await store.addItem(URL_KEY, { prompt: 'b' });
    assert.equal(await store.countItems(URL_KEY), 2);
    assert.equal(await store.countItems('other'), 0);
  });

  test('the lean reads carry no prompt and no feedback[]; the named readers carry them', async () => {
    const id = await take();
    await store.addFeedback(id, URL_KEY, { message: '[working] beat' }, TOKEN);
    const lean = await store.getItemStatus(URL_KEY, id);
    assert.equal(lean.prompt, null);
    assert.equal(lean.feedback, undefined);
    assert.ok(lean.feedbackDigest, 'a fresh, self-healed digest');
    const page = await store.listHistory(URL_KEY, { limit: 5 });
    assert.equal(page.items[0].prompt, null);
    assert.equal(page.items[0].feedback, undefined);
    assert.equal((await store.getItemPrompt(URL_KEY, id)).prompt, 'a long prompt body');
    assert.equal((await store.getItemFeedback(URL_KEY, id)).feedback.length, 1);
  });

  test('the watch token: queue -> taken moves it, and the sibling read ({_id: {$ne}} + exclusion projection) sees a lineage sibling', async () => {
    const queued = await store.addItem(URL_KEY, { prompt: 'q' });
    const t0 = await store.getItemWatchToken(URL_KEY, queued._id);
    await store.takeItem(queued._id, URL_KEY, TOKEN);
    const t1 = await store.getItemWatchToken(URL_KEY, queued._id);
    assert.notEqual(t1, t0);
    const root = await take({ sessionGroupId: 'g1' });
    await store.addFeedback(root, URL_KEY, { message: 'beat', rootItemId: root }, TOKEN);
    const before = await store.getItemWatchToken(URL_KEY, root);
    const sibling = await take({ sessionGroupId: 'g1', followUpTo: root, rootItemId: root });
    await store.addFeedback(sibling, URL_KEY, { message: '[done] x', rootItemId: root }, TOKEN);
    assert.notEqual(await store.getItemWatchToken(URL_KEY, root), before, 'a sibling [done] moves the root\'s token');
  });

  test('lineage queries: fan-out updateMany ($lte/$ne/null), $nin closer, lineageStatus: null, _id paging', async () => {
    const root = await take();
    const child = await take({ followUpTo: root, rootItemId: root });
    await store.addFeedback(child, URL_KEY, { message: '[working] beat', rootItemId: root }, TOKEN);
    assert.equal((await history.findOne({ _id: root })).lineageFeedbackCount, 1, 'fan-out reached the modern root once');
    const done = await take();
    await store.addFeedback(done, URL_KEY, { message: '[done] x', rootItemId: done }, TOKEN);
    await store.stampBookkeeping(URL_KEY, done, { by: 'op', reason: 'handed-on' });
    assert.equal((await history.findOne({ _id: done })).lineageStatus, 'done', '$nin kept the terminal');
    await store.stampBookkeeping(URL_KEY, root, { by: 'op', reason: 'handed-on' });
    assert.equal((await history.findOne({ _id: root })).lineageStatus, 'closed');
    const running = await store.listHistoryLineageRows(URL_KEY, { status: 'taken', limit: 10 });
    assert.deepEqual(running.items.map(i => i.id), [child]);
    assert.equal(running.total, 1);
    assert.equal((await store.listHistoryLineageRows(URL_KEY, { status: 'closed', limit: 10 })).total, 1);
  });
});
