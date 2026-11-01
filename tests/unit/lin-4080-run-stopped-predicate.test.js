/**
 * LIN-4080 (beat 2) — the derived, never-stored `isRunStopped(urlKey, runId)`.
 *
 * A run is stopped when recorded evidence says someone stopped it:
 *  - an abort row targets the run (plain, cascade-emitted, pending or
 *    `[aborted]`), unless that row's terminal is `[skipped]` (a human is still
 *    in the session, so nothing ended);
 *  - or a row of the run's own lineage carries `[aborted]` (the run's own row,
 *    a follow-up of it, or a wake addressed to it: the halt sweep posts
 *    `[aborted]` straight onto whatever row the run is on, with no abort row).
 *
 * Lineage resolution: a `kind:'wake'` row belongs to the run its `followUpTo`
 * names; every other row belongs to `anchorFor(row)`. The wake rule matters
 * because a wake row's doc `rootItemId` is not the parent's at creation, and a
 * feedback `rootItemId` can re-point it later (LIN-4080 adaptation 4).
 *
 * The stop is sticky (a later `[done]` does not un-stop a run), scoped by
 * urlKey, and the workspace halt is NOT part of this predicate: halt is read
 * only by the wake-mint gate (LIN-4080 adaptation 5).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const TOKEN = 'token-a';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

/** A run's autopilot row: its own id is the run id. */
function autopilot(store, urlKey = URL_KEY) {
  return store.addItem(urlKey, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-42' });
}

/** A worker the run dispatched: its `sessionId` names the run. */
function worker(store, runId, overrides = {}) {
  return store.addItem(URL_KEY, {
    prompt: 'research',
    kind: 'research',
    issueIdentifier: 'LIN-42',
    sessionId: runId,
    subscription: 'terminal-only',
    ...overrides
  });
}

/** A plain abort row naming `targetId` (what Stop writes). */
function abortRow(store, targetId, urlKey = URL_KEY) {
  return store.addItem(urlKey, { abort: true, abortTo: targetId, target: 'cli' });
}

/** Take a row (queue -> history) and post a message onto it, as the runner does. */
async function postOn(store, row, message, urlKey = URL_KEY) {
  await store.takeItem(row._id, urlKey, TOKEN);
  return store.addFeedback(row._id, urlKey, { message }, TOKEN);
}

describe('LIN-4080 isRunStopped — recorded aborts', () => {
  test('a plain abort row targeting the run stops it (a pending abort counts)', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await abortRow(store, run._id);
    assert.equal(await store.isRunStopped(URL_KEY, run._id), true);
  });

  test('a cascade-emitted abort stops the run and its descendants', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    await store.expandCascadeAborts(URL_KEY, run._id);
    assert.equal(await store.isRunStopped(URL_KEY, run._id), true);
    assert.equal(await store.isRunStopped(URL_KEY, child._id), true);
  });

  test('[skipped] on the abort row does NOT stop the run (human-continued session)', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    const abort = await abortRow(store, run._id);
    await postOn(store, abort, '[skipped] human-continued session abc (AWAITING_FOLLOWUP).');
    assert.equal(await store.isRunStopped(URL_KEY, run._id), false);
  });

  test('[aborted] on the abort row stops the run', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    const abort = await abortRow(store, run._id);
    await postOn(store, abort, '[aborted] Cancelled running session abc.');
    assert.equal(await store.isRunStopped(URL_KEY, run._id), true);
  });

  test('a run nothing has touched is not stopped', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await worker(store, run._id);
    assert.equal(await store.isRunStopped(URL_KEY, run._id), false);
  });

  test('an abort recorded against another run does not stop this one', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    const other = await autopilot(store);
    await abortRow(store, other._id);
    assert.equal(await store.isRunStopped(URL_KEY, run._id), false);
    assert.equal(await store.isRunStopped(URL_KEY, other._id), true);
  });

  test('an abort in another workspace does not stop this run (urlKey scoping)', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await abortRow(store, run._id, 'other');
    assert.equal(await store.isRunStopped(URL_KEY, run._id), false);
  });
});

describe('LIN-4080 isRunStopped — lineage [aborted] (halt-shape, W3/W5/W6)', () => {
  test('an [aborted] on the run\'s own row stops it', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await postOn(store, run, '[aborted] Cancelled running session (stopped by operator).');
    assert.equal(await store.isRunStopped(URL_KEY, run._id), true);
  });

  test('an [aborted] on a follow-up of the run stops it', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    // The factory's followUpTo inheritance stamps the run's rootItemId; addItem
    // alone would fall back to the follow-up's own id, so the test names it.
    const followUp = await store.addItem(URL_KEY, {
      prompt: 'note', kind: 'implementation', followUpTo: run._id, rootItemId: run._id
    });
    await postOn(store, followUp, '[aborted] Cancelled running session (stopped by operator).');
    assert.equal(await store.isRunStopped(URL_KEY, run._id), true);
  });

  test('an [aborted] on a wake row addressed to the run stops it (halt-sweep shape, no abort row)', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    // A wake row carries no inherited rootItemId: its own id is its anchor.
    const wake = await store.addItem(URL_KEY, { prompt: 'wake', kind: 'wake', followUpTo: run._id });
    await postOn(store, wake, '[aborted] Cancelled running session (stopped by operator).');
    assert.equal(await store.isRunStopped(URL_KEY, run._id), true);
  });

  test('a wake row resolves through followUpTo, not a doc rootItemId that names another run', async () => {
    const store = makeStore();
    const live = await autopilot(store);
    const stopped = await autopilot(store);
    const wake = await store.addItem(URL_KEY, { prompt: 'wake', kind: 'wake', followUpTo: live._id });
    // The halt sweep's feedback carries a rootItemId, which $sets the wake row's
    // doc rootItemId to the STOPPED run. The wake still belongs to `live`.
    await store.takeItem(wake._id, URL_KEY, TOKEN);
    await store.addFeedback(wake._id, URL_KEY, {
      message: '[aborted] Cancelled running session (stopped by operator).',
      rootItemId: stopped._id
    }, TOKEN);
    assert.equal(await store.isRunStopped(URL_KEY, stopped._id), false, 'not stopped by a wake that is not its own');
    assert.equal(await store.isRunStopped(URL_KEY, live._id), true, 'stopped by its own wake row');
  });

  test('an [aborted] on a child worker does NOT stop the parent run (W6: no over-reach)', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    await postOn(store, child, '[aborted] Cancelled running session (stopped by operator).');
    assert.equal(await store.isRunStopped(URL_KEY, run._id), false);
    assert.equal(await store.isRunStopped(URL_KEY, child._id), true);
  });

  test('the stop is sticky: a later [done] on the run does not un-stop it', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await postOn(store, run, '[aborted] Cancelled running session (stopped by operator).');
    await store.addFeedback(run._id, URL_KEY, { message: '[done] late report' }, TOKEN);
    assert.equal(await store.isRunStopped(URL_KEY, run._id), true);
  });

  test('the workspace halt is not part of the predicate (it gates wake minting only)', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    store.setHaltReader(() => ({ mode: 'stop' }));
    assert.equal(await store.isRunStopped(URL_KEY, run._id), false);
  });
});
