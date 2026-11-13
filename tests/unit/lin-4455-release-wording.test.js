/**
 * LIN-4455 (piece 5 of LIN-4447), beat 4: the held wake's release wording is not the store's.
 *
 * A release has no request on its three common paths, all of which reach
 * `_archiveItem` → `_releaseIfHeld` → `releaseHeldWake`: a cancel (`removeItem`), an expiry
 * (`cleanup()`), and the stopped-run cleanup (an `[aborted]` that stops the run cancels the
 * queued holder). So the wording is late-bound into the store (`setHeldWakeReleaseNote`, the
 * `setWakeCredentialProvisionerFactory` pattern), and the one release that does have a hook
 * (`_applyWakeHook`'s re-release) takes `wakeHook.releaseNote`. An unbound store says the
 * holder "did not run" in words that name no feature.
 *
 * Store-level, on a bare DispatchQueueStore over mock collections: no leftover step is
 * created, so whatever wording appears came from the binding under test (or the default).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const DONE = '[done] Built LIN-7. PR https://github.com/o/r/pull/12 is green.';
const UNBOUND = (status) => `The step holding this wake did not run (its row was ${status}). The build's own outcome follows.`;

/**
 * A taken run, a taken build reporting to it with its [done] in history (written directly,
 * so no wake was minted), and a queued row holding the build's wake.
 */
async function heldWorld({ bind } = {}) {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  const calls = [];
  if (bind) store.setHeldWakeReleaseNote((args) => { calls.push(args); return bind(args); });
  const runRow = await store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-7', dispatchedBy: 'owner' });
  await store.takeItem(runRow._id, URL_KEY, 'orchestrator');
  const buildRow = await store.addItem(URL_KEY, {
    prompt: 'build it', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
    target: 'cli', dispatchedBy: 'owner', subscription: 'terminal-only', sessionId: runRow._id
  });
  await store.takeItem(buildRow._id, URL_KEY, 'token-a');
  historyCollection._docs.find((d) => d._id === buildRow._id).feedback = [{ message: DONE, timestamp: new Date().toISOString() }];
  const holder = await store.addItem(URL_KEY, { prompt: 'hold', kind: 'custom', issueIdentifier: 'LIN-7', followUpTo: buildRow._id, heldWakeFor: buildRow._id });
  const wakes = () => [...collection._docs, ...historyCollection._docs].filter((d) => d.kind === 'wake' && d.followUpTo === runRow._id);
  return { store, collection, historyCollection, runRow, buildRow, holder, calls, wakes };
}

const firstLine = (wake) => wake.prompt.split('\n')[0];
const bound = ({ status }) => `BOUND: the holder was ${status}.`;

describe('the late-bound release wording is used on every requestless release', () => {
  test('cancel (removeItem)', async () => {
    const w = await heldWorld({ bind: bound });
    await w.store.removeItem(URL_KEY, w.holder._id);
    assert.equal(w.wakes().length, 1);
    assert.equal(firstLine(w.wakes()[0]), 'BOUND: the holder was cancelled.');
    assert.ok(w.wakes()[0].prompt.includes(`Outcome: ${DONE}`), 'the build\'s own outcome follows');
    assert.deepEqual(w.calls.map((c) => c.status), ['cancelled']);
  });

  test('expiry (cleanup)', async () => {
    const w = await heldWorld({ bind: bound });
    w.collection._docs.find((d) => d._id === w.holder._id).expiresAt = new Date(Date.now() - 1000);
    await w.store.cleanup();
    assert.equal(w.wakes().length, 1);
    assert.equal(firstLine(w.wakes()[0]), 'BOUND: the holder was expired.');
    assert.deepEqual(w.calls.map((c) => c.status), ['expired']);
  });

  test('the stopped-run cleanup: the bound wording is asked for, and the stopped-parent gate mints nothing', async () => {
    const w = await heldWorld({ bind: bound });
    const abort = await w.store.addItem(URL_KEY, { abort: true, abortTo: w.runRow._id, target: 'cli' });
    await w.store.takeItem(abort._id, URL_KEY, 'token-a');
    await w.store.addFeedback(abort._id, URL_KEY, { message: '[aborted] Cancelled running session.' }, 'token-a');
    assert.equal(w.historyCollection._docs.find((d) => d._id === w.holder._id)?.status, 'cancelled', 'the holder was cancelled by the cleanup');
    assert.deepEqual(w.calls.map((c) => c.status), ['cancelled'], 'the release went through the bound wording');
    assert.equal(w.wakes().length, 0, 'a stopped run gets no wake');
  });
});

describe('an unbound store uses the stated default', () => {
  for (const end of ['cancelled', 'expired']) {
    test(`${end}: "did not run", naming no feature`, async () => {
      const w = await heldWorld();
      if (end === 'cancelled') await w.store.removeItem(URL_KEY, w.holder._id);
      else {
        w.collection._docs.find((d) => d._id === w.holder._id).expiresAt = new Date(Date.now() - 1000);
        await w.store.cleanup();
      }
      assert.equal(w.wakes().length, 1);
      assert.equal(firstLine(w.wakes()[0]), UNBOUND(end));
    });
  }

  test('binding null restores the default', async () => {
    const w = await heldWorld({ bind: bound });
    w.store.setHeldWakeReleaseNote(null);
    await w.store.removeItem(URL_KEY, w.holder._id);
    assert.equal(firstLine(w.wakes()[0]), UNBOUND('cancelled'));
  });

  test('a bound wording that throws falls back to the default; the release still wakes', async () => {
    const w = await heldWorld({ bind: () => { throw new Error('boom'); } });
    await w.store.removeItem(URL_KEY, w.holder._id);
    assert.equal(w.wakes().length, 1);
    assert.equal(firstLine(w.wakes()[0]), UNBOUND('cancelled'));
  });
});

describe('the re-release with a hook takes wakeHook.releaseNote', () => {
  test('a withhold that names an archived holder releases it in the hook\'s words, not the bound ones', async () => {
    const w = await heldWorld({ bind: bound });
    // Archive the holder without the store's own release: straight into history as cancelled.
    const queued = w.collection._docs.findIndex((d) => d._id === w.holder._id);
    const [doc] = w.collection._docs.splice(queued, 1);
    const archived = { ...doc, status: 'cancelled' };
    w.historyCollection._docs.push(archived);
    // The build re-reports; the hook withholds and names the archived holder to release.
    const build = w.historyCollection._docs.find((d) => d._id === w.buildRow._id);
    build.feedback = [];
    const hook = async () => ({ outcome: 'withhold', reason: 'held', release: archived });
    hook.releaseNote = ({ status }) => `HOOK: the holder was ${status}.`;
    // addFeedback needs the build taken in the queue's eyes: it reads history for a taken row.
    await w.store.addFeedback(w.buildRow._id, URL_KEY, { message: DONE }, 'token-a', undefined, { wakeHook: hook });
    assert.equal(w.wakes().length, 1);
    assert.equal(firstLine(w.wakes()[0]), 'HOOK: the holder was cancelled.');
    assert.deepEqual(w.calls, [], 'the bound wording was not asked');
  });
});
