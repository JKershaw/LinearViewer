/**
 * LIN-4212: request records posted by a `kind:'wake'` row before that row's first tagged
 * feedback are stamped with the wake row's own id, so a read keyed by the lineage root
 * never finds them. These witnesses pin the fix shape F′ (read by the posting row's
 * `itemId`, relabelled to its current anchor, one record per requestId).
 *
 * Real MangoDB over a tmpdir (tests/fixtures/mango-tmpdir.js). The lanes drive the real
 * DispatchQueueStore and the real shared intake (postUsage), which is what both routes
 * call; the routes themselves only add auth and the 404/400 mapping.
 *
 * Each witness is labelled `[red on HEAD]`, `[green on HEAD]` or `[guard]` in its name.
 * A `[guard]` passes before and after the fix by design; it pins a behaviour the fix must
 * keep, so a mutation that breaks it turns it red.
 *
 * Run with: node --test tests/unit/lin-4212-wake-records-stranded.test.js
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { postUsage } from '../../lib/request-usage-intake.js';
import * as usageStoreModule from '../../lib/request-usage-store.js';
import { RequestUsageStore, REQUEST_USAGE_COLLECTION } from '../../lib/request-usage-store.js';
import { INDEX_SPECS, tierOf, sameKeySpec } from '../../lib/db-indexes.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const URL_KEY = 'ws-a';
const RUNNER = { label: 'runner-label', tokenId: 'tok-runner' };
const DISPATCH = { label: 'dispatch-label', tokenId: null };
const NOW = new Date('2026-11-04T08:10:00.000Z');

const rec = (requestId, tokens = {}) => ({
  requestId,
  harness: 'claude-code',
  model: 'claude-haiku-5-5',
  effort: 'high',
  lane: 'build',
  agent: 'main',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheCreation1hInputTokens: 0,
  cacheReadInputTokens: 0,
  ...tokens
});

const requestIdsOf = (rows) => rows.map((r) => r.requestId).sort();

const harness = createMangoTmpdir('lin-4212-wake-');
before(() => harness.connect());
after(() => harness.close());

let db, queue, history, raw, store;

beforeEach(async () => {
  db = harness.freshDb();
  queue = db.collection('dispatch-queue');
  history = db.collection('dispatch-history');
  raw = db.collection(REQUEST_USAGE_COLLECTION);
  // The declared specs, as ensureIndexes builds them.
  await raw.createIndex({ urlKey: 1, rootItemId: 1, requestId: 1 }, { unique: true });
  await raw.createIndex({ urlKey: 1, rootItemId: 1 });
  store = new RequestUsageStore({ collection: raw, historyCollection: history });
});

const dispatchStore = () => new DispatchQueueStore({ collection: queue, historyCollection: history });

/** An autopilot root row: its own id is its lineage anchor. */
async function mintRoot(ds) {
  const root = await ds.addItem(URL_KEY, { prompt: 'root', kind: 'autopilot' });
  return root._id;
}

/** A wake row of lineage `rootId`, taken by `lane`; its own id is its anchor until latched. */
async function mintAndTakeWake(ds, rootId, lane) {
  const wake = await ds.addItem(URL_KEY, { prompt: 'wake', kind: 'wake', followUpTo: rootId });
  await ds.takeItem(wake._id, URL_KEY, lane.label, lane.tokenId);
  return wake._id;
}

/** The first tagged feedback that latches the producer's root onto the wake row. */
async function latch(ds, itemId, rootId, lane) {
  await ds.addFeedback(itemId, URL_KEY, { message: 'first tagged feedback', rootItemId: rootId }, lane.label, null, { takenByTokenId: lane.tokenId });
}

const post = (ds, itemId, lane, records) => postUsage({
  dispatchQueueStore: ds,
  store,
  itemId,
  urlKey: URL_KEY,
  tokenLabel: lane.label,
  takenByTokenId: lane.tokenId,
  body: { records },
  now: NOW
});

describe('LIN-4212 W1: a wake row\'s pre-latch records are read under the lineage root', () => {
  for (const [name, lane] of [['runner proxy lane', RUNNER], ['dispatch lane', DISPATCH]]) {
    test(`[red on HEAD] ${name}: 3 records posted before the first tagged feedback are returned for the root`, async () => {
      const ds = dispatchStore();
      const rootId = await mintRoot(ds);
      const wakeId = await mintAndTakeWake(ds, rootId, lane);

      const outcome = await post(ds, wakeId, lane, [rec('m1', { inputTokens: 10 }), rec('m2', { outputTokens: 5 }), rec('m3', { inputTokens: 7 })]);
      assert.equal(outcome.status, 200);
      await latch(ds, wakeId, rootId, lane);

      const rows = await store.listForAnchors(URL_KEY, [rootId]);
      assert.deepEqual(requestIdsOf(rows), ['m1', 'm2', 'm3']);
    });
  }
});

describe('LIN-4212 W2: returned records carry the posting row\'s current anchor', () => {
  test('[red on HEAD] every returned record has rootItemId equal to the root, never the wake id', async () => {
    const ds = dispatchStore();
    const rootId = await mintRoot(ds);
    const wakeId = await mintAndTakeWake(ds, rootId, DISPATCH);
    await post(ds, wakeId, DISPATCH, [rec('m1', { inputTokens: 1 })]);
    await latch(ds, wakeId, rootId, DISPATCH);

    const [row] = await store.listForAnchors(URL_KEY, [rootId]);
    assert.ok(row, 'the record is returned under the root');
    assert.equal(row.rootItemId, rootId);
    assert.notEqual(row.rootItemId, wakeId);
  });

  test('[red on HEAD] a stored stamp that differs from the row\'s current anchor is not the label returned', async () => {
    // A record whose stored stamp is a stale id, posted by a row now anchored at R.
    await history.insertOne({ _id: 'row-now', urlKey: URL_KEY, status: 'taken', abort: false, rootItemId: 'R', takenByTokenLabel: 'lbl', takenByTokenId: null });
    await raw.insertOne({ urlKey: URL_KEY, rootItemId: 'stale-stamp', requestId: 'm1', itemId: 'row-now', inputTokens: 4, at: NOW, updatedAt: NOW });

    const rows = await store.listForAnchors(URL_KEY, ['R']);
    assert.deepEqual(requestIdsOf(rows), ['m1']);
    assert.equal(rows[0].rootItemId, 'R', 'relabelled to the posting row\'s current anchor, not the stamp');
  });
});

describe('LIN-4212 W3: one record per requestId', () => {
  test('[green on HEAD] a request posted before and after the latch is one record, with the larger output', async () => {
    const ds = dispatchStore();
    const rootId = await mintRoot(ds);
    const wakeId = await mintAndTakeWake(ds, rootId, DISPATCH);
    await post(ds, wakeId, DISPATCH, [rec('m', { outputTokens: 80 })]);
    await latch(ds, wakeId, rootId, DISPATCH);
    await post(ds, wakeId, DISPATCH, [rec('m', { outputTokens: 90 })]);

    const rows = await store.listForAnchors(URL_KEY, [rootId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outputTokens, 90);
  });

  test('[green on HEAD] a re-post by the next item in the same lineage does not double count', async () => {
    const ds = dispatchStore();
    const rootId = await mintRoot(ds);
    const wakeId = await mintAndTakeWake(ds, rootId, DISPATCH);
    await post(ds, wakeId, DISPATCH, [rec('m', { outputTokens: 80 })]);
    await latch(ds, wakeId, rootId, DISPATCH);
    await post(ds, wakeId, DISPATCH, [rec('m', { outputTokens: 90 })]);
    // A follow-up of the same lineage, carrying the root as its inherited anchor.
    const follow = await ds.addItem(URL_KEY, { prompt: 'follow', kind: 'implementation', followUpTo: rootId, rootItemId: rootId });
    await ds.takeItem(follow._id, URL_KEY, DISPATCH.label, DISPATCH.tokenId);
    await post(ds, follow._id, DISPATCH, [rec('m', { outputTokens: 100 })]);

    const rows = await store.listForAnchors(URL_KEY, [rootId]);
    assert.equal(rows.length, 1, 'one record per requestId');
    assert.equal(rows[0].outputTokens, 100);
  });
});

describe('LIN-4212 W4: the fold is order independent and grow-only [red on HEAD: function absent]', () => {
  const rowsFixture = () => [
    { rootItemId: 'R', requestId: 'm', itemId: 'row-b', at: new Date('2026-11-04T08:00:00Z'), inputTokens: 5, outputTokens: 10, costUsd: 0.2 },
    { rootItemId: 'R', requestId: 'm', itemId: 'row-a', at: new Date('2026-11-04T08:00:00Z'), inputTokens: 5, outputTokens: 30, costUsd: 0.1 },
    { rootItemId: 'R', requestId: 'n', itemId: 'row-a', at: new Date('2026-11-04T09:00:00Z'), inputTokens: 1, outputTokens: 1 }
  ];

  test('[red on HEAD] oneRecordPerRequest is exported and folds to one record per (rootItemId, requestId)', () => {
    assert.equal(typeof usageStoreModule.oneRecordPerRequest, 'function', 'oneRecordPerRequest must be exported from lib/request-usage-store.js');
    const folded = usageStoreModule.oneRecordPerRequest(rowsFixture());
    assert.deepEqual(folded.map((r) => r.requestId).sort(), ['m', 'n']);
  });

  test('[red on HEAD] shuffled input folds to the identical result, including on the equal-at tie', () => {
    assert.equal(typeof usageStoreModule.oneRecordPerRequest, 'function', 'oneRecordPerRequest must be exported');
    const base = usageStoreModule.oneRecordPerRequest(rowsFixture());
    const reversed = usageStoreModule.oneRecordPerRequest(rowsFixture().reverse());
    assert.deepEqual(reversed, base);
  });

  test('[red on HEAD] the fold keeps the earliest at, takes $max on usage, and never shrinks costUsd', () => {
    assert.equal(typeof usageStoreModule.oneRecordPerRequest, 'function', 'oneRecordPerRequest must be exported');
    const [m] = usageStoreModule.oneRecordPerRequest(rowsFixture()).filter((r) => r.requestId === 'm');
    assert.equal(m.at.getTime(), new Date('2026-11-04T08:00:00Z').getTime());
    assert.equal(m.outputTokens, 30);
    assert.equal(m.costUsd, 0.2);
  });

  test('[red on HEAD] a tie on at resolves to the smallest itemId (the rule the store states)', () => {
    assert.equal(typeof usageStoreModule.oneRecordPerRequest, 'function', 'oneRecordPerRequest must be exported');
    const [m] = usageStoreModule.oneRecordPerRequest(rowsFixture()).filter((r) => r.requestId === 'm');
    assert.equal(m.itemId, 'row-a');
  });
});

describe('LIN-4212 W5: a never-latched wake stays in its own lineage [green on HEAD]', () => {
  test('records under the wake id return for the wake id, not for a root that never latched', async () => {
    const ds = dispatchStore();
    const rootId = await mintRoot(ds);
    const wakeId = await mintAndTakeWake(ds, rootId, DISPATCH);
    await post(ds, wakeId, DISPATCH, [rec('w1', { inputTokens: 2 })]);

    assert.deepEqual(requestIdsOf(await store.listForAnchors(URL_KEY, [wakeId])), ['w1']);
    assert.deepEqual(await store.listForAnchors(URL_KEY, [rootId]), []);
  });
});

describe('LIN-4212 W6: a pruned row\'s records disappear (retention invariant) [red on HEAD]', () => {
  test('deleting an ordinary row and a wake row from history removes their records from every anchor', async () => {
    const ds = dispatchStore();
    const ordinary = await ds.addItem(URL_KEY, { prompt: 'p', kind: 'implementation' });
    await ds.takeItem(ordinary._id, URL_KEY, DISPATCH.label, DISPATCH.tokenId);
    await post(ds, ordinary._id, DISPATCH, [rec('o1', { inputTokens: 3 })]);

    const rootId = await mintRoot(ds);
    const wakeId = await mintAndTakeWake(ds, rootId, DISPATCH);
    await post(ds, wakeId, DISPATCH, [rec('w1', { inputTokens: 4 })]);

    await history.deleteMany({ _id: { $in: [ordinary._id, wakeId] } });

    assert.deepEqual(await store.listForAnchors(URL_KEY, [ordinary._id]), [], 'the ordinary row\'s record is gone with its row');
    assert.deepEqual(await store.listForAnchors(URL_KEY, [wakeId]), [], 'the wake row\'s record is gone with its row');
  });
});

describe('LIN-4212 W7: a row re-pointed twice follows its current anchor [red on HEAD]', () => {
  test('A to B to C: the record is returned under C only, once, even when the caller passes A, B and C', async () => {
    const ds = dispatchStore();
    const row = await ds.addItem(URL_KEY, { prompt: 'p', kind: 'implementation' });
    await ds.takeItem(row._id, URL_KEY, DISPATCH.label, DISPATCH.tokenId);
    const A = row._id;
    await post(ds, row._id, DISPATCH, [rec('m', { inputTokens: 6 })]);

    await history.updateOne({ _id: row._id }, { $set: { rootItemId: 'B' } });
    await history.updateOne({ _id: row._id }, { $set: { rootItemId: 'C' } });
    await post(ds, row._id, DISPATCH, [rec('m', { inputTokens: 6 })]);

    const rows = await store.listForAnchors(URL_KEY, [A, 'B', 'C']);
    assert.equal(rows.length, 1, 'one record, not one per stamp');
    assert.equal(rows[0].rootItemId, 'C');
    assert.deepEqual(await store.listForAnchors(URL_KEY, [A]), [], 'the old anchor no longer returns it');
  });
});

describe('LIN-4212 W8: workspace isolation in both queries [red on HEAD for the hostile case]', () => {
  test('[green on HEAD] two workspaces share an anchor id and neither sees the other', async () => {
    await history.insertOne({ _id: 'a-row', urlKey: 'ws-a', status: 'taken', abort: false, rootItemId: 'R', takenByTokenLabel: 'l', takenByTokenId: null });
    await history.insertOne({ _id: 'b-row', urlKey: 'ws-b', status: 'taken', abort: false, rootItemId: 'R', takenByTokenLabel: 'l', takenByTokenId: null });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'R', itemId: 'a-row', records: [rec('a1', { inputTokens: 1 })], now: NOW });
    await store.upsertRecords({ urlKey: 'ws-b', rootItemId: 'R', itemId: 'b-row', records: [rec('b1', { inputTokens: 1 })], now: NOW });

    assert.deepEqual(requestIdsOf(await store.listForAnchors('ws-a', ['R'])), ['a1']);
    assert.deepEqual(requestIdsOf(await store.listForAnchors('ws-b', ['R'])), ['b1']);
  });

  test('[red on HEAD] a ws-a record whose itemId is a ws-b row\'s id is not returned for ws-a', async () => {
    await history.insertOne({ _id: 'b-only', urlKey: 'ws-b', status: 'taken', abort: false, rootItemId: 'R', takenByTokenLabel: 'l', takenByTokenId: null });
    await store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'R', itemId: 'b-only', records: [rec('x1', { inputTokens: 1 })], now: NOW });

    assert.deepEqual(await store.listForAnchors('ws-a', ['R']), [], 'ws-a has no member row with that id');
  });

  test('[guard] a ws-b record whose itemId is a ws-a member id is not returned for ws-a', async () => {
    await history.insertOne({ _id: 'a-member', urlKey: 'ws-a', status: 'taken', abort: false, rootItemId: 'R', takenByTokenLabel: 'l', takenByTokenId: null });
    await store.upsertRecords({ urlKey: 'ws-b', rootItemId: 'R', itemId: 'a-member', records: [rec('y1', { inputTokens: 1 })], now: NOW });

    assert.deepEqual(await store.listForAnchors('ws-a', ['R']), []);
  });
});

describe('LIN-4212 W9: the loader is independent of the caller\'s rows [red on HEAD]', () => {
  test('called with only the root id and no rows held, it returns the wake-posted records', async () => {
    const ds = dispatchStore();
    const rootId = await mintRoot(ds);
    const wakeId = await mintAndTakeWake(ds, rootId, DISPATCH);
    await post(ds, wakeId, DISPATCH, [rec('m1', { inputTokens: 1 }), rec('m2', { inputTokens: 2 })]);
    await latch(ds, wakeId, rootId, DISPATCH);

    assert.deepEqual(requestIdsOf(await store.listForAnchors(URL_KEY, [rootId])), ['m1', 'm2']);
  });
});

describe('LIN-4212 W10: a posting row outside isMember still counts [guard]', () => {
  test('an abort row that has records is still resolved as a member', async () => {
    await history.insertOne({ _id: 'abort-row', urlKey: URL_KEY, status: 'taken', abort: true, rootItemId: 'R', takenByTokenLabel: DISPATCH.label, takenByTokenId: null });
    const ds = dispatchStore();
    const outcome = await post(ds, 'abort-row', DISPATCH, [rec('q1', { inputTokens: 1 })]);
    assert.equal(outcome.status, 200);

    assert.deepEqual(requestIdsOf(await store.listForAnchors(URL_KEY, ['R'])), ['q1']);
  });
});

describe('LIN-4212 W11: a record whose itemId has no row is dropped, not guessed [red on HEAD]', () => {
  test('an orphan record is absent under its stamp', async () => {
    await raw.insertOne({ urlKey: URL_KEY, rootItemId: 'R', requestId: 'orphan', itemId: 'ghost-row', inputTokens: 9, at: NOW, updatedAt: NOW });

    assert.deepEqual(await store.listForAnchors(URL_KEY, ['R']), []);
  });
});

describe('LIN-4212 W12: a body cannot choose the lineage [guard]', () => {
  test('a body naming another itemId and rootItemId is stored and read under the posting row only', async () => {
    const ds = dispatchStore();
    const rootId = await mintRoot(ds);
    const wakeId = await mintAndTakeWake(ds, rootId, DISPATCH);
    await latch(ds, wakeId, rootId, DISPATCH);
    // A real taken row of ANOTHER lineage (OTHER), so the forged itemId names a genuine member row.
    const OTHER = 'other-lineage';
    await history.insertOne({ _id: 'other-row', urlKey: URL_KEY, status: 'taken', abort: false, rootItemId: OTHER, takenByTokenLabel: 'other-label', takenByTokenId: null });
    await store.upsertRecords({ urlKey: URL_KEY, rootItemId: OTHER, itemId: 'other-row', records: [rec('o-own', { inputTokens: 2 })], now: NOW });
    const forged = { ...rec('f1', { inputTokens: 5 }), itemId: 'other-row', rootItemId: OTHER };

    const outcome = await post(ds, wakeId, DISPATCH, [forged]);
    assert.deepEqual(outcome.body.applied, ['f1']);

    const doc = await raw.findOne({ requestId: 'f1' });
    assert.equal(doc.itemId, wakeId, 'the stored itemId is the posting row, not the body');
    assert.equal(doc.rootItemId, rootId, 'the stored stamp is the posting row\'s anchor, not the body');
    assert.deepEqual(requestIdsOf(await store.listForAnchors(URL_KEY, [rootId])), ['f1']);
    assert.deepEqual(requestIdsOf(await store.listForAnchors(URL_KEY, [OTHER])), ['o-own'], 'the other lineage does not gain the forged record');
  });
});

describe('LIN-4212 W13: the constructor refuses a missing history handle [red on HEAD]', () => {
  test('a store without historyCollection refuses to start', () => {
    assert.throws(() => new RequestUsageStore({ collection: raw }), /historyCollection is required/);
  });
});

describe('LIN-4212 W14: the {urlKey, itemId} index is declared at boot tier [red on HEAD]', () => {
  test('the record index on itemId is declared on request-usage, and the rootItemId lookup stays', () => {
    const specs = INDEX_SPECS.filter((s) => s.collection === REQUEST_USAGE_COLLECTION);
    const byItem = specs.find((s) => sameKeySpec(s.keySpec, { urlKey: 1, itemId: 1 }));
    const byRoot = specs.find((s) => sameKeySpec(s.keySpec, { urlKey: 1, rootItemId: 1 }));
    assert.ok(byItem, 'the {urlKey, itemId} spec');
    assert.equal(tierOf(byItem), 'boot');
    assert.ok(byRoot, 'the {urlKey, rootItemId} spec stays until LIN-4217');
  });
});

describe('LIN-4212 guard: the loader issues no query for an empty anchor list or a falsy urlKey [red on HEAD for falsy urlKey]', () => {
  const spyCollection = () => {
    const calls = [];
    return { calls, find: (...args) => { calls.push(args); return { toArray: async () => [] }; } };
  };

  test('[guard] an empty anchor list sends no history or record query', async () => {
    const rawSpy = spyCollection();
    const histSpy = spyCollection();
    const s = new RequestUsageStore({ collection: rawSpy, historyCollection: histSpy });
    assert.deepEqual(await s.listForAnchors(URL_KEY, []), []);
    assert.equal(rawSpy.calls.length + histSpy.calls.length, 0);
  });

  test('[red on HEAD] a falsy urlKey returns [] and sends no query', async () => {
    const rawSpy = spyCollection();
    const histSpy = spyCollection();
    const s = new RequestUsageStore({ collection: rawSpy, historyCollection: histSpy });
    assert.deepEqual(await s.listForAnchors('', ['R']), []);
    assert.deepEqual(await s.listForAnchors(undefined, ['R']), []);
    assert.equal(rawSpy.calls.length + histSpy.calls.length, 0);
  });
});

describe('LIN-4212 W4b: the fold keeps the latest updatedAt (the post-time coverage read depends on it)', () => {
  test('a split request folds to the latest updatedAt of its documents, in either input order', () => {
    const early = { rootItemId: 'R', requestId: 'm', itemId: 'row-a', at: new Date('2026-11-04T08:00:00Z'), updatedAt: new Date('2026-11-04T08:01:00Z'), outputTokens: 1 };
    const late = { rootItemId: 'R', requestId: 'm', itemId: 'row-b', at: new Date('2026-11-04T08:00:00Z'), updatedAt: new Date('2026-11-04T08:09:00Z'), outputTokens: 2 };
    assert.equal(typeof usageStoreModule.oneRecordPerRequest, 'function', 'oneRecordPerRequest must be exported');
    const forward = usageStoreModule.oneRecordPerRequest([early, late]);
    const backward = usageStoreModule.oneRecordPerRequest([late, early]);
    assert.equal(forward[0].updatedAt.getTime(), new Date('2026-11-04T08:09:00Z').getTime());
    assert.deepEqual(backward, forward);
  });
});
