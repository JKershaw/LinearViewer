/**
 * LIN-4377 / LIN-4383 (witness A6): the held-wake claim's persisted field is declared in
 * code, beside the other sparse run-row keys (`lib/dispatch-fields.js`), and the claim
 * pair reads and writes it through that constant.
 *
 * `claimHeldWake` is one compare-and-set on the producing row's history doc (the
 * `_mintWake` idiom); `releaseHeldWakeClaim` clears the stamp to `null`, which the claim's
 * filter reads as unclaimed. No migration from the old `leftoverClaimedAt` name: an old
 * stamp is not read, so a row stuck on one before the rename can be claimed again.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { HELD_WAKE_CLAIMED_AT } from '../../lib/dispatch-fields.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

async function takenRow() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  const row = await store.addItem(URL_KEY, { prompt: 'build it', kind: 'implementation', issueIdentifier: 'LIN-7', target: 'cli' });
  await store.takeItem(row._id, URL_KEY, 'token-a');
  const doc = () => historyCollection._docs.find(d => d._id === row._id);
  return { store, row, doc };
}

describe('A6 — the held-wake claim field is the exported constant', () => {
  test('the constant names the field', () => {
    assert.strictEqual(HELD_WAKE_CLAIMED_AT, 'heldWakeClaimedAt');
  });

  test('claimHeldWake stamps the field the constant names, and only that one', async () => {
    const { store, row, doc } = await takenRow();
    assert.strictEqual(doc()[HELD_WAKE_CLAIMED_AT], undefined, 'unclaimed: the sparse key is absent');
    assert.strictEqual(await store.claimHeldWake(URL_KEY, row._id), true);
    assert.ok(doc()[HELD_WAKE_CLAIMED_AT] instanceof Date, 'stamped');
    assert.ok(!('leftoverClaimedAt' in doc()), 'the old name is never written');
    assert.strictEqual(await store.claimHeldWake(URL_KEY, row._id), false, 'a second claim loses');
  });

  test('releaseHeldWakeClaim clears the field to null, and the next claim wins', async () => {
    const { store, row, doc } = await takenRow();
    await store.claimHeldWake(URL_KEY, row._id);
    await store.releaseHeldWakeClaim(URL_KEY, row._id);
    assert.strictEqual(doc()[HELD_WAKE_CLAIMED_AT], null);
    assert.strictEqual(await store.claimHeldWake(URL_KEY, row._id), true);
  });

  test('no migration: a row stamped under the old name can be claimed', async () => {
    const { store, row, doc } = await takenRow();
    doc().leftoverClaimedAt = new Date(0); // a stamp written before the rename
    assert.strictEqual(await store.claimHeldWake(URL_KEY, row._id), true);
  });
});
