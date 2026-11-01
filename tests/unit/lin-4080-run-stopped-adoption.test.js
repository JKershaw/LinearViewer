/**
 * LIN-4080 (beat 3) — the duplicate guard never adopts a stopped run's row (W3).
 *
 * `findRecentFreshDispatch` feeds `guardDuplicate`: a fresh dispatch for the
 * same issue and kind inside 5 minutes is refused 409 DUPLICATE_DISPATCH and
 * handed the existing row's id to adopt. A row whose orchestrator (`sessionId`)
 * is a stopped run must not be handed out: the new autopilot would adopt a child
 * whose wakes can never reach it (the LIN-4077 incident). `[skipped]` is not a
 * stop, so its row is still adopted.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
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

function autopilot(store) {
  return store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-42' });
}

/** A research step an orchestrator dispatched: fresh, sessionId names its run. */
function research(store, runId) {
  return store.addItem(URL_KEY, {
    prompt: 'research',
    kind: 'research',
    issueIdentifier: 'LIN-42',
    sessionId: runId
  });
}

/** A new autopilot's research dispatch, through the real factory and its duplicate guard. */
function newResearch(store, runId) {
  return createDispatchItem({
    store,
    urlKey: URL_KEY,
    kind: 'research',
    prompt: 'research again',
    fields: { issueIdentifier: 'LIN-42', sessionId: runId }
  });
}

describe('LIN-4080 W3 — a new autopilot is not handed a stopped run\'s research row', () => {
  test('the new autopilot is admitted as its own row, not refused DUPLICATE_DISPATCH with the dead run\'s child', async () => {
    const store = makeStore();
    const a = await autopilot(store);
    const r = await research(store, a._id);
    await store.addItem(URL_KEY, { abort: true, abortTo: a._id, target: 'cli' }); // plain abort: A stopped, R still live
    const b = await autopilot(store);

    const item = await newResearch(store, b._id);

    assert.notEqual(item._id, r._id, 'not adopted: the dead run\'s child is not handed out');
    assert.equal(item.sessionId, b._id, 'the new research reports to the new autopilot');
  });

  test('control: with the first run still live, the new research is refused and adopts the live row', async () => {
    const store = makeStore();
    const a = await autopilot(store);
    const r = await research(store, a._id);
    const b = await autopilot(store);

    await assert.rejects(
      () => newResearch(store, b._id),
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.duplicateDispatch?.code, 'DUPLICATE_DISPATCH');
        assert.equal(err.duplicateDispatch?.id, r._id, 'the live run\'s row is adopted');
        return true;
      }
    );
  });

  test('a [skipped] abort does not drop the row: a human-continued run is still adopted', async () => {
    const store = makeStore();
    const a = await autopilot(store);
    const r = await research(store, a._id);
    const abort = await store.addItem(URL_KEY, { abort: true, abortTo: a._id, target: 'cli' });
    await store.takeItem(abort._id, URL_KEY, TOKEN);
    await store.addFeedback(abort._id, URL_KEY, { message: '[skipped] human-continued session abc' }, TOKEN);
    const b = await autopilot(store);

    await assert.rejects(
      () => newResearch(store, b._id),
      (err) => err.duplicateDispatch?.id === r._id
    );
  });
});

describe('LIN-4080 W3 — findRecentFreshDispatch selects only a live run\'s row', () => {
  const since = () => new Date(Date.now() - 5 * 60 * 1000);

  test('a candidate whose sessionId run is stopped is not returned', async () => {
    const store = makeStore();
    const a = await autopilot(store);
    await research(store, a._id);
    await store.addItem(URL_KEY, { abort: true, abortTo: a._id, target: 'cli' });

    const found = await store.findRecentFreshDispatch(URL_KEY, { issueIdentifier: 'LIN-42', kind: 'research', since: since() });
    assert.equal(found, null);
  });

  test('the newest candidate is a stopped run\'s row: the live run\'s older row is returned instead', async () => {
    const store = makeStore();
    const live = await autopilot(store);
    const liveRow = await research(store, live._id);
    const dead = await autopilot(store);
    await research(store, dead._id); // newest candidate, its run is stopped below
    await store.addItem(URL_KEY, { abort: true, abortTo: dead._id, target: 'cli' });

    const found = await store.findRecentFreshDispatch(URL_KEY, { issueIdentifier: 'LIN-42', kind: 'research', since: since() });
    assert.equal(found?.id, liveRow._id);
  });

  test('a failed stopped-run read yields null (fail open, the guard admits)', async () => {
    const store = makeStore();
    const a = await autopilot(store);
    await research(store, a._id);
    store.isRunStopped = async () => { throw new Error('store read failed'); };

    const found = await store.findRecentFreshDispatch(URL_KEY, { issueIdentifier: 'LIN-42', kind: 'research', since: since() });
    assert.equal(found, null);
  });
});
