/**
 * LIN-4241: the settled-ruling guard at the store. `markDecisionAnswered` is a
 * check-and-stamp on the `feedbackVersion` CAS: a decision already answered or
 * dismissed on an item is refused with `{success: false, alreadySettled: true}`
 * and gets no second stamp. `isDecisionSettled` is the read-only pre-check the
 * routes run before they write a comment or answer a dismissal.
 *
 * Witnesses (each observed failing before the change, then passing after it):
 *   - a second answer is refused and adds no stamp;
 *   - answer-then-dismiss and dismiss-then-answer are both refused;
 *   - a withdrawn decision is NOT settled (the guard does not cover it);
 *   - concurrent answers to one decision stamp exactly once, the rest report settled;
 *   - the pre-check reads settlement without writing anything.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const URL_KEY = 'acme';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection(),
  });
}

async function takenItem(store) {
  const item = await store.addItem(URL_KEY, {
    prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42'
  });
  await store.takeItem(item._id, URL_KEY, 'token-a');
  return item;
}

const stampsOf = (store, itemId) =>
  (store.historyCollection._docs.find(d => d._id === itemId).feedback || [])
    .filter(e => e.kind === 'decision-answer');

describe('LIN-4241: markDecisionAnswered refuses a settled decision', () => {
  test('a second answer to the same decision is refused: alreadySettled, no second stamp', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const first = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    assert.ok(first && first.success);

    const second = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    assert.deepEqual(second, { success: false, alreadySettled: true });
    assert.equal(stampsOf(store, item._id).length, 1, 'exactly one decision-answer stamp');
  });

  test('answer then dismiss of the same decision: the dismiss is refused, the answer stands', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    const dismiss = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1', 'dismissed');

    assert.deepEqual(dismiss, { success: false, alreadySettled: true });
    const stamps = stampsOf(store, item._id);
    assert.equal(stamps.length, 1);
    assert.deepEqual(JSON.parse(stamps[0].message), { decision_id: 'd-1' }, 'the answer stamp is untouched, with no dismissed outcome added');
  });

  test('dismiss then answer of the same decision: the answer is refused', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1', 'dismissed');
    const answer = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');

    assert.deepEqual(answer, { success: false, alreadySettled: true });
    assert.equal(stampsOf(store, item._id).length, 1);
  });

  test('a different decision on the same item is not settled by the first: both answer', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    const other = await store.markDecisionAnswered(item._id, URL_KEY, 'd-2');

    assert.ok(other && other.success, 'settlement is per decision id, not per item');
    assert.equal(stampsOf(store, item._id).length, 2);
  });

  test('a withdrawn decision is NOT settled: it can still be answered (the guard does not cover withdrawals)', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const withdrawn = await store.markDecisionWithdrawn(item._id, URL_KEY, 'd-1', 'ticket closed');
    assert.ok(withdrawn && withdrawn.success);
    assert.equal(await store.isDecisionSettled(item._id, URL_KEY, 'd-1'), false, 'a withdrawal is not a settlement');

    const answer = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    assert.ok(answer && answer.success, 'the answer lands on a withdrawn decision, as it did before this guard');
  });

  test('concurrent answers to one decision: exactly one stamp; every other caller reports settled', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.markDecisionAnswered(item._id, URL_KEY, 'd-race'))
    );

    const winners = results.filter(r => r && r.success);
    const losers = results.filter(r => r && r.alreadySettled);
    assert.equal(winners.length, 1, 'exactly one caller stamps');
    assert.equal(losers.length, 7, 'every other caller is refused as settled');
    assert.equal(stampsOf(store, item._id).length, 1, 'one stamp in the stored feedback');
  });
});

describe('LIN-4241: isDecisionSettled is a read-only pre-check', () => {
  test('false before any stamp, true after, and it writes nothing', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    const before = store.historyCollection._docs.find(d => d._id === item._id).feedbackVersion;

    assert.equal(await store.isDecisionSettled(item._id, URL_KEY, 'd-1'), false);
    assert.equal(store.historyCollection._docs.find(d => d._id === item._id).feedbackVersion, before, 'the pre-check does not bump feedbackVersion');

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1', 'dismissed');
    assert.equal(await store.isDecisionSettled(item._id, URL_KEY, 'd-1'), true, 'a dismissal settles too');
  });

  test('false for an item in another workspace or an unknown item (the caller then proceeds as before)', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');

    assert.equal(await store.isDecisionSettled(item._id, 'other-workspace', 'd-1'), false);
    assert.equal(await store.isDecisionSettled('no-such-item', URL_KEY, 'd-1'), false);
  });
});
