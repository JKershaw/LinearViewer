/**
 * LIN-1698 (Phase 1) — durable wake witness.
 *
 * The pre-fix `terminalWakeItems` set recorded "a wake was constructed for
 * this producing item" — never "the parent was told" — and any downstream
 * failure (the `addItem` enqueue throwing, the mint never completing) left no
 * durable trace. This is Phase 1's scope only: a durable, queryable witness.
 * It does NOT add a reconciliation sweep, interval wiring, or a re-mint
 * attempt-reservation CAS — see the ticket's revision 5 plan for why those are
 * spun out to a follow-up ticket.
 *
 * Three behaviors pinned here, per the plan's §6 testing strategy:
 *  - `wakeWitnessMeta` is seeded ATOMICALLY with the existing `terminalWakeItems`
 *    CAS (one write, not two) on a successful mint.
 *  - failed-but-present: an `addItem` throw during enqueue leaves the witness
 *    exactly as seeded (`attempt: 0, mintedWakeId: null`) — NOT rolled back.
 *    This is the owner's ruling (revision 5), which superseded an earlier
 *    compensating-`$pull` design (revisions 1-3); regressing back to a
 *    rollback would silently reopen this ticket's own root cause, so its
 *    absence is asserted explicitly.
 *  - `producingItemId`/`producingItemAttempt` survive both the live
 *    dispatch-queue write and the `_archiveItem` allowlist hop to
 *    dispatch-history — the same silent-drop failure class this ticket
 *    exists to close, reproduced inside the fix if either allowlist entry
 *    were missed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  return { store, collection, historyCollection };
}

function wakeItems(collection, historyCollection) {
  return [...collection._docs, ...historyCollection._docs].filter(d => d.kind === 'wake');
}

async function takenChild(store, overrides = {}) {
  const child = await store.addItem(URL_KEY, {
    prompt: 'do the thing',
    kind: 'implementation',
    issueIdentifier: 'LIN-42',
    subscription: 'terminal-only',
    ...overrides
  });
  await store.takeItem(child._id, URL_KEY, 'token-a');
  return child;
}

describe('LIN-1698 Phase 1 — wakeWitnessMeta seeded atomically with the terminalWakeItems CAS', () => {
  test('a successful mint seeds {feedbackIndex, attempt: 0, mintedWakeId, lastAttemptAt} in the same write as the CAS', async () => {
    const { store, collection, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation' });
    const child = await takenChild(store, { sessionId: parent._id });

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    assert.ok(res && res.success);

    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1, 'exactly one wake minted');
    const mintedWakeId = wakes[0]._id;

    // This child has no followUpTo, so it IS its own edge doc.
    const edge = historyCollection._docs.find(d => d._id === child._id);
    assert.ok(edge.terminalWakeItems?.includes(child._id), 'the once-only CAS witness is set');
    assert.ok(edge.wakeWitnessMeta, 'edge doc carries wakeWitnessMeta');

    const witness = edge.wakeWitnessMeta[child._id];
    assert.ok(witness, 'a witness entry exists, keyed by the producing item id');
    assert.equal(witness.feedbackIndex, 0, 'indexes the single (just-appended) feedback entry');
    assert.equal(witness.attempt, 0, 'the implicit live-path slot');
    assert.equal(witness.mintedWakeId, mintedWakeId, 'stamped with the actually-minted wake row\'s own id');
    assert.ok(witness.lastAttemptAt instanceof Date, 'timestamped');
  });

  test('feedbackIndex reflects the witnessed entry\'s position when it is not the first feedback entry', async () => {
    const { store, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation' });
    const child = await takenChild(store, { sessionId: parent._id });

    await store.addFeedback(child._id, URL_KEY, { message: 'heartbeat 1' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: 'heartbeat 2' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');

    const edge = historyCollection._docs.find(d => d._id === child._id);
    const witness = edge.wakeWitnessMeta[child._id];
    assert.equal(witness.feedbackIndex, 2, 'the terminal is the third (index 2) entry');
  });

  test('a non-wake row carries no producingItemId/producingItemAttempt (additive-only, no behavior change)', async () => {
    const { store, historyCollection } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: 'plain manual dispatch', kind: 'implementation' });
    await store.takeItem(item._id, URL_KEY, 'token-a');

    const archived = historyCollection._docs.find(d => d._id === item._id);
    assert.equal(archived.producingItemId, null);
    assert.equal(archived.producingItemAttempt, null);
  });
});

describe('LIN-1698 Phase 1 — failed-but-present: an addItem throw during mint is NOT rolled back', () => {
  test('the witness (terminalWakeItems AND wakeWitnessMeta) stays exactly as seeded across an addItem throw', async (t) => {
    const errMock = t.mock.method(console, 'error', () => {});
    const { store, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation' });
    const child = await takenChild(store, { sessionId: parent._id });

    // Force the enqueue step inside _mintWake to throw, without touching the
    // parent/child setup above (which also goes through store.addItem).
    const originalAddItem = store.addItem.bind(store);
    store.addItem = async (urlKey, item) => {
      if (item.kind === 'wake') throw new Error('boom-enqueue-failure');
      return originalAddItem(urlKey, item);
    };

    // Pre-LIN-1698 (unchanged) contract: an addItem throw during enqueue
    // propagates to addFeedback's outer catch, which swallows it and returns
    // null — this is W1 from the ticket's own forensics. Phase 1 does not
    // change this control flow; it only makes the witness durable across it.
    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    assert.equal(res, null);
    assert.ok(errMock.mock.calls.length >= 1, 'the failure is logged via the existing outer catch');

    const edge = historyCollection._docs.find(d => d._id === child._id);
    assert.ok(
      edge.terminalWakeItems?.includes(child._id),
      'CAS witness stays set — no compensating $pull (the owner-superseded revision 1-3 design)'
    );
    const witness = edge.wakeWitnessMeta[child._id];
    assert.ok(witness, 'wakeWitnessMeta stays present — durable evidence a wake was owed');
    assert.equal(witness.attempt, 0, 'left exactly as seeded');
    assert.equal(witness.mintedWakeId, null, 'never reached the success stamp — failed but present, never rolled back');
  });

  test('a retry after the throw does NOT self-heal: the SAME producing item cannot re-win the CAS (Phase 1 ships no re-mint)', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { store, collection, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation' });
    const child = await takenChild(store, { sessionId: parent._id });

    const originalAddItem = store.addItem.bind(store);
    store.addItem = async (urlKey, item) => {
      if (item.kind === 'wake') throw new Error('boom-enqueue-failure');
      return originalAddItem(urlKey, item);
    };
    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');

    // Restore normal addItem and re-report the SAME terminal beat item.
    store.addItem = originalAddItem;
    const res2 = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped (re-reported)' }, 'token-a');
    assert.ok(res2 && res2.success, 'the feedback append itself still succeeds on re-report');

    // The CAS witness was already set on the FIRST (failed) attempt, so the
    // re-report loses the CAS race for this producing item — exactly the
    // pre-existing 'already-woke-for-this-item' guard. Phase 1 explicitly
    // ships no re-mint / attempt-reservation CAS (out of scope; see the
    // ticket's §1 out-of-scope list) — a durably-lost wake stays lost until
    // the spun-out reconciliation-sweep ticket lands.
    assert.equal(wakeItems(collection, historyCollection).length, 0, 'no wake minted — the CAS was already spent on the failed attempt');
  });
});

describe('LIN-1698 Phase 1 — producingItemId/producingItemAttempt survive queue write AND the archive hop', () => {
  test('present on the live dispatch-queue row before claim, and on the dispatch-history row after archival', async () => {
    const { store, collection, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation' });
    const child = await takenChild(store, { sessionId: parent._id });

    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');

    const queuedWake = collection._docs.find(d => d.kind === 'wake');
    assert.ok(queuedWake, 'the wake is live in dispatch-queue before claim');
    assert.equal(queuedWake.producingItemId, child._id, 'threaded via addItem\'s field list');
    assert.equal(queuedWake.producingItemAttempt, 0);

    await store.takeItem(queuedWake._id, URL_KEY, 'consumer-token');

    assert.ok(!collection._docs.some(d => d._id === queuedWake._id), 'the wake is gone from the active queue after claim');
    const archivedWake = historyCollection._docs.find(d => d._id === queuedWake._id);
    assert.ok(archivedWake, 'the wake is archived to dispatch-history after claim');
    assert.equal(archivedWake.producingItemId, child._id, 'survives the _archiveItem allowlist hop — the load-bearing edit');
    assert.equal(archivedWake.producingItemAttempt, 0);
  });
});

describe('LIN-1698 Phase 1 — structural pin: the CAS and the witness seed are ONE write', () => {
  // Review ledger item 2. Every other assertion in this file reads the mock's
  // RESULT, and the mock applies an update atomically by construction — so a
  // future refactor that split the seed into a second `updateOne` would leave
  // all of them green while silently reopening this ticket's root cause (a
  // witness that can exist without its CAS, or a CAS without its witness).
  // Nothing behavioural can catch that; only the call shape can. Hence a spy.
  test('the terminalWakeItems CAS call carries $addToSet AND the wakeWitnessMeta $set in the same update object', async (t) => {
    const { store, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation' });
    const child = await takenChild(store, { sessionId: parent._id });

    const updateSpy = t.mock.method(historyCollection, 'updateOne');

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    assert.ok(res && res.success);

    // The CAS is identified by its once-only filter, not by call order.
    const casCalls = updateSpy.mock.calls.filter(
      c => c.arguments[0]?.terminalWakeItems?.$ne !== undefined
    );
    assert.equal(casCalls.length, 1, 'exactly one CAS write per terminal mint');

    const [filter, update] = casCalls[0].arguments;
    assert.equal(filter.terminalWakeItems.$ne, child._id, 'keyed per producing item (LIN-1355/LIN-1357)');
    assert.equal(update.$addToSet?.terminalWakeItems, child._id, 'the CAS half');
    assert.deepEqual(
      Object.keys(update.$set || {}),
      [`wakeWitnessMeta.${child._id}`],
      'the witness seed rides the SAME update object — one write, not two'
    );

    // And no OTHER write may seed a witness: the only other permitted
    // wakeWitnessMeta write is the best-effort mintedWakeId/lastAttemptAt
    // enrichment stamp, which touches leaves under an ALREADY-seeded entry.
    const otherWitnessWrites = updateSpy.mock.calls
      .filter(c => c !== casCalls[0])
      .flatMap(c => Object.keys(c.arguments[1]?.$set || {}))
      .filter(k => k.startsWith('wakeWitnessMeta.'));
    assert.ok(
      otherWitnessWrites.every(k => k.split('.').length > 2),
      `only leaf enrichment may write the witness outside the CAS; saw ${JSON.stringify(otherWitnessWrites)}`
    );
  });
});

describe('mock-collection: dot-path $set support (LIN-1698)', () => {
  test('a dot-path $set creates nested structure without clobbering sibling keys', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a', wakeWitnessMeta: { x: { attempt: 0 } } });

    await collection.updateOne({ _id: 'a' }, { $set: { 'wakeWitnessMeta.y': { attempt: 0, mintedWakeId: null } } });

    const doc = await collection.findOne({ _id: 'a' });
    assert.deepEqual(doc.wakeWitnessMeta.x, { attempt: 0 }, 'sibling key untouched');
    assert.deepEqual(doc.wakeWitnessMeta.y, { attempt: 0, mintedWakeId: null });
  });

  test('a deep dot-path $set updates a single leaf, leaving sibling leaves untouched', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a', wakeWitnessMeta: { x: { attempt: 0, mintedWakeId: null, feedbackIndex: 0 } } });

    await collection.updateOne({ _id: 'a' }, { $set: { 'wakeWitnessMeta.x.mintedWakeId': 'wake-123' } });

    const doc = await collection.findOne({ _id: 'a' });
    assert.equal(doc.wakeWitnessMeta.x.mintedWakeId, 'wake-123');
    assert.equal(doc.wakeWitnessMeta.x.feedbackIndex, 0, 'sibling leaf untouched');
  });

  test('$addToSet and a dot-path $set compose in ONE update (mirrors the CAS + witness seed write)', async () => {
    const collection = createMockCollection();
    await collection.insertOne({ _id: 'a', terminalWakeItems: [] });

    await collection.updateOne(
      { _id: 'a' },
      { $addToSet: { terminalWakeItems: 'beat-1' }, $set: { 'wakeWitnessMeta.beat-1': { attempt: 0 } } }
    );

    const doc = await collection.findOne({ _id: 'a' });
    assert.deepEqual(doc.terminalWakeItems, ['beat-1']);
    assert.deepEqual(doc.wakeWitnessMeta['beat-1'], { attempt: 0 });
  });
});
