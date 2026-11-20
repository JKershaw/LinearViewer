/**
 * LIN-4496 (finding ee29d305, review of PR #2469): the held-run reading's witness on the REAL dispatch queue. The
 * sequence is the one the leftover hook runs (lib/dispatch-leftover-hook.js): a build row is added and taken, its
 * held wake is claimed (the stamp goes on the producing row), and the leftover is queued with `heldWakeFor` = the build.
 * The reading must then count that build's leftover as held. The earlier fixtures encoded the wrong shape (the claim
 * read as a reason not to hold, and a `stage` field dispatch rows do not carry), so they passed while production
 * read zero held runs. This test drives the store, not a hand-written row.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { heldRunsOf, heldRunReading } from '../../scripts/stability-measures-core.mjs';

const URL_KEY = 'acme';
const ASOF = '2026-11-20T12:00:00.000Z';
const hoursBefore = (h) => new Date(Date.parse(ASOF) - h * 3600000).toISOString();

function fresh() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  // The rows as the reading reads them: queue and history together.
  const rows = () => [...collection._docs, ...historyCollection._docs];
  return { store, rows };
}

// A task LIN-7 (task-7) with one hand-off addressed to the implementation stage, which the held build answers to.
const records = [
  { id: 'task-7', kind: 'task', state: 'open', ref: 'LIN-7', openedAt: hoursBefore(10) },
  { id: 'finding-1', kind: 'finding', state: 'open', to: 'implementation', in: 'task-7', openedAt: hoursBefore(2) }
];

describe('the held-run witness on the real dispatch queue (LIN-4496 finding ee29d305)', () => {
  test('add -> take -> claim the held wake -> enqueue the leftover: the leftover is a held run, and the reading counts it', async () => {
    const { store, rows } = fresh();
    const build = await store.addItem(URL_KEY, { prompt: 'build it', kind: 'implementation', issueIdentifier: 'LIN-7', target: 'cli' });
    await store.takeItem(build._id, URL_KEY, 'token-a');
    assert.equal(await store.claimHeldWake(URL_KEY, build._id), true, 'the hook wins the claim');
    const leftover = await store.addItem(URL_KEY, {
      prompt: 'leftover', kind: 'leftover', issueIdentifier: 'LIN-7', target: 'cli', followUpTo: build._id, heldWakeFor: build._id
    });

    // The producer is stamped, and that stamp is what makes its leftover held (not the reason it is not).
    const held = heldRunsOf(rows());
    assert.deepEqual(held.map((h) => h.leftover._id), [leftover._id], 'the queued leftover is a held run');
    assert.equal(held[0].producer._id, build._id);

    const reading = heldRunReading({ records, queryLog: [], dispatchRows: rows(), asOf: ASOF });
    assert.equal(reading.held, 1);
    assert.equal(reading.addressed, 1, 'the implementation-stage hand-off answers to the held build (its kind is implementation)');
    assert.equal(reading.censored, 1, 'nobody read it: censored at asOf, not zero');
  });

  test('a skip gives the claim back: with no leftover queued, nothing is held', async () => {
    const { store, rows } = fresh();
    const build = await store.addItem(URL_KEY, { prompt: 'build it', kind: 'implementation', issueIdentifier: 'LIN-7', target: 'cli' });
    await store.takeItem(build._id, URL_KEY, 'token-a');
    assert.equal(await store.claimHeldWake(URL_KEY, build._id), true);
    await store.releaseHeldWakeClaim(URL_KEY, build._id);
    assert.deepEqual(heldRunsOf(rows()), [], 'an unclaimed producer with no leftover holds nothing');
    const reading = heldRunReading({ records, queryLog: [], dispatchRows: rows(), asOf: ASOF });
    assert.equal(reading.held, 0, 'a reading of 0, from a real empty hold, not a missing one');
  });
});
