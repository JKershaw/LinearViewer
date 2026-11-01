/**
 * LIN-4080 (beat 3) — queued wakes of a stopped run are cancelled (W4, W6).
 *
 * A `kind:'wake'` row queued to a run that is then stopped must not reach the
 * parent. It is removed with `removeItem`, which archives it as `cancelled`.
 *
 * WHEN: on the `[aborted]` landing, not at enqueue. A `[skipped]` abort is a
 * human-continued session that is still live (the runner refused the cancel), so
 * cancelling its wakes at enqueue would lose them with no way to restore
 * (LIN-4080 approved plan review, note 1). The `[aborted]` landing is keyed on the
 * marker, so the halt sweep's direct `[aborted]` (no abort row) is covered too.
 *
 * WHICH: the wakes addressed to the run the `[aborted]` stops: `abortTo` for an
 * abort row, `runOf(row)` for any other row (a wake resolves through `followUpTo`).
 * Non-wake rows and rows of unstopped runs are never touched.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const TOKEN = 'token-a';
const ABORTED = '[aborted] Cancelled running session (stopped by operator).';

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  return { store: new DispatchQueueStore({ collection, historyCollection }), collection, historyCollection };
}

function autopilot(store) {
  return store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-42' });
}

function worker(store, runId) {
  return store.addItem(URL_KEY, {
    prompt: 'research', kind: 'research', issueIdentifier: 'LIN-42', sessionId: runId, subscription: 'terminal-only'
  });
}

/** A queued wake addressed to `runId` (not yet taken). */
function queuedWake(store, runId) {
  return store.addItem(URL_KEY, { prompt: 'wake', kind: 'wake', followUpTo: runId });
}

async function postOn(store, row, message) {
  await store.takeItem(row._id, URL_KEY, TOKEN);
  return store.addFeedback(row._id, URL_KEY, { message }, TOKEN);
}

/** Wakes addressed to `runId`, split by where they now sit. */
function wakesTo(collection, historyCollection, runId) {
  const pick = (docs) => docs.filter(d => d.kind === 'wake' && d.followUpTo === runId);
  return { queued: pick(collection._docs), archived: pick(historyCollection._docs) };
}

describe('LIN-4080 W4 — a queued wake of a stopped run is cancelled when its [aborted] lands', () => {
  test('plain abort: the queued wake stays queued until the abort\'s [aborted] lands, then archives as cancelled', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    await queuedWake(store, run._id);
    const abort = await store.addItem(URL_KEY, { abort: true, abortTo: run._id, target: 'cli' });

    // Enqueue alone does not cancel (see the file header: a [skipped] would be lost).
    assert.equal(wakesTo(collection, historyCollection, run._id).queued.length, 1);

    await postOn(store, abort, ABORTED);

    const { queued, archived } = wakesTo(collection, historyCollection, run._id);
    assert.equal(queued.length, 0, 'no wake is left queued for the stopped run');
    assert.equal(archived.length, 1);
    assert.equal(archived[0].status, 'cancelled');
  });

  test('cascade: the queued wake to the root is cancelled when the root\'s abort row lands [aborted]', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    await worker(store, run._id);
    await queuedWake(store, run._id);
    await store.expandCascadeAborts(URL_KEY, run._id);
    const rootAbort = [...collection._docs].find(d => d.abort === true && d.abortTo === run._id);

    await postOn(store, rootAbort, ABORTED);

    const { queued, archived } = wakesTo(collection, historyCollection, run._id);
    assert.equal(queued.length, 0);
    assert.equal(archived[0].status, 'cancelled');
  });

  test('halt sweep: the run\'s own [aborted] (no abort row) cancels its queued wake', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    await queuedWake(store, run._id);

    await postOn(store, run, ABORTED);

    const { queued, archived } = wakesTo(collection, historyCollection, run._id);
    assert.equal(queued.length, 0);
    assert.equal(archived[0].status, 'cancelled');
  });

  test('halt sweep when the run\'s current item is a wake row: the [aborted] on that wake cancels the other queued wake', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const current = await queuedWake(store, run._id);
    await queuedWake(store, run._id);
    // The run is on its wake row `current`; the sweep posts `[aborted]` onto it.
    // Taking `current` moves it out of the queue, so the second wake is the queued one.
    await postOn(store, current, ABORTED);

    const { queued, archived } = wakesTo(collection, historyCollection, run._id);
    assert.equal(queued.length, 0, 'the other queued wake is cancelled via followUpTo');
    assert.ok(archived.some(d => d.status === 'cancelled'));
  });
});

describe('LIN-4080 W6 — no over-reach', () => {
  test('a [skipped] abort leaves its target\'s queued wake alone (the target is not stopped)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    await queuedWake(store, run._id);
    const abort = await store.addItem(URL_KEY, { abort: true, abortTo: run._id, target: 'cli' });

    await postOn(store, abort, '[skipped] human-continued session abc (AWAITING_FOLLOWUP).');

    const { queued, archived } = wakesTo(collection, historyCollection, run._id);
    assert.equal(queued.length, 1, 'the live human-continued run keeps its wake');
    assert.equal(archived.length, 0);
  });

  test('a sibling run\'s queued wake is unaffected by another run\'s abort', async () => {
    const { store, collection, historyCollection } = makeStore();
    const stopped = await autopilot(store);
    const live = await autopilot(store);
    await queuedWake(store, stopped._id);
    await queuedWake(store, live._id);
    const abort = await store.addItem(URL_KEY, { abort: true, abortTo: stopped._id, target: 'cli' });

    await postOn(store, abort, ABORTED);

    assert.equal(wakesTo(collection, historyCollection, stopped._id).queued.length, 0);
    assert.equal(wakesTo(collection, historyCollection, live._id).queued.length, 1, 'the live sibling keeps its wake');
  });

  test('a live parent still receives its child\'s [aborted] wake (the child is stopped, the parent is not)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const parent = await autopilot(store);
    const child = await worker(store, parent._id);
    await store.addItem(URL_KEY, { abort: true, abortTo: child._id, target: 'cli' }); // child stopped alone

    await postOn(store, child, ABORTED);

    const { queued } = wakesTo(collection, historyCollection, parent._id);
    assert.equal(queued.length, 1, 'the wake that tells the live parent its child stopped is delivered');
  });

  test('a queued non-wake row of the stopped run is not touched by the cleanup', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const note = await store.addItem(URL_KEY, { prompt: 'note', kind: 'implementation', followUpTo: run._id, rootItemId: run._id });
    const abort = await store.addItem(URL_KEY, { abort: true, abortTo: run._id, target: 'cli' });

    await postOn(store, abort, ABORTED);

    const stillQueued = collection._docs.find(d => d._id === note._id);
    assert.ok(stillQueued, 'a non-wake row is not removed by the wake cleanup');
    assert.equal(historyCollection._docs.filter(d => d._id === note._id).length, 0);
  });
});
