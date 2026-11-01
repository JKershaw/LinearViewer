/**
 * LIN-4080 (beat 3) — admission refuses work into a stopped run (W2, W6).
 *
 * `createDispatchItem` refuses a NON-abort dispatch whose `sessionId` or
 * `followUpTo` names a stopped run, with a tagged 409 `RUN_STOPPED`. It is
 * decided from recorded aborts only (`isRunStopped`), never the workspace halt:
 * a halt-wide refusal would reject a reply to a finished run the sweep never
 * touched (LIN-4080 adaptation 3). `force: true` does not bypass it for a
 * non-person caller; a person's forced reply is the one exception (ruling
 * human-force-only, see lin-4080-person-forced-followup). Abort rows are exempt:
 * stopping a stopped run stays a no-op.
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

async function abortRow(store, targetId) {
  return store.addItem(URL_KEY, { abort: true, abortTo: targetId, target: 'cli' });
}

/** Post a message on a row as the runner does (take, then feedback). */
async function postOn(store, row, message) {
  await store.takeItem(row._id, URL_KEY, TOKEN);
  return store.addFeedback(row._id, URL_KEY, { message }, TOKEN);
}

/** Every row of the workspace, queue and history, for "nothing was created" checks. */
function allRows(store) {
  return [...store.collection._docs, ...store.historyCollection._docs];
}

function dispatch(store, fields, { kind = 'research', prompt = 'do the next step' } = {}) {
  return createDispatchItem({ store, urlKey: URL_KEY, kind, prompt, fields: { issueIdentifier: 'LIN-42', ...fields } });
}

describe('LIN-4080 W2 — a dispatch into a stopped run is refused RUN_STOPPED', () => {
  test('a fresh worker whose sessionId names a stopped run is refused 409 RUN_STOPPED', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await abortRow(store, run._id);
    const before = allRows(store).length;

    await assert.rejects(
      () => dispatch(store, { sessionId: run._id }),
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.runStopped?.code, 'RUN_STOPPED');
        assert.equal(err.runStopped?.id, run._id);
        assert.match(err.message, /stopped/);
        assert.match(err.message, /new run/);
        return true;
      }
    );
    assert.equal(allRows(store).length, before, 'no row is written for a refused dispatch');
  });

  test('a follow-up whose followUpTo names a stopped run is refused RUN_STOPPED', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await abortRow(store, run._id);

    await assert.rejects(
      () => dispatch(store, { followUpTo: run._id, rootItemId: run._id }, { kind: 'implementation' }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
  });

  test('force:true does NOT bypass RUN_STOPPED for a non-person caller', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await abortRow(store, run._id);

    await assert.rejects(
      () => dispatch(store, { followUpTo: run._id, rootItemId: run._id, force: true }, { kind: 'implementation' }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
    await assert.rejects(
      () => dispatch(store, { sessionId: run._id, force: true }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
  });

  test('a run stopped by an [aborted] landing (halt-sweep shape, no abort row) is refused too', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await postOn(store, run, '[aborted] Cancelled running session (stopped by operator).');

    await assert.rejects(
      () => dispatch(store, { sessionId: run._id }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
  });
});

describe('LIN-4080 W2 — what is still admitted', () => {
  test('an abort row is admitted even when its target run is stopped (exempt)', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await abortRow(store, run._id);

    const item = await createDispatchItem({
      store,
      urlKey: URL_KEY,
      kind: 'implementation',
      prompt: 'stop it',
      fields: { abort: true, abortTo: run._id, target: 'cli' }
    });
    assert.equal(item.abort, true);
    assert.equal(item.abortTo, run._id);
  });

  test('a fresh dispatch carrying neither sessionId nor followUpTo is admitted while a run is stopped', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await abortRow(store, run._id);

    const item = await createDispatchItem({
      store,
      urlKey: URL_KEY,
      kind: 'autopilot',
      prompt: 'a fresh run',
      fields: { issueIdentifier: 'LIN-43' }
    });
    assert.ok(item._id, 'a fresh run is admitted');
  });

  test('a [skipped] abort does not stop the run: a follow-up to it is admitted', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    const abort = await abortRow(store, run._id);
    await postOn(store, abort, '[skipped] human-continued session abc (AWAITING_FOLLOWUP).');

    const item = await dispatch(store, { followUpTo: run._id, rootItemId: run._id }, { kind: 'implementation' });
    assert.ok(item._id);
  });

  test('a live run is admitted (control)', async () => {
    const store = makeStore();
    const run = await autopilot(store);

    const item = await dispatch(store, { sessionId: run._id });
    assert.ok(item._id);
  });

  test('a stop recorded in another workspace does not refuse this one', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    await store.addItem('other', { abort: true, abortTo: run._id, target: 'cli' });

    const item = await dispatch(store, { sessionId: run._id });
    assert.ok(item._id);
  });

  test('a failed stopped-run read fails open: the dispatch is admitted', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    store.isRunStopped = async () => { throw new Error('store read failed'); };

    const item = await dispatch(store, { sessionId: run._id });
    assert.ok(item._id, 'a read fault never turns into a refusal');
  });
});

describe('LIN-4080 W6 — no halt-wide refusal', () => {
  test('under an active halt `stop`, a reply to a FINISHED run is still admitted', async () => {
    const store = makeStore();
    const finished = await autopilot(store);
    await postOn(store, finished, '[done] shipped');
    store.setHaltReader(() => ({ mode: 'stop' }));

    const item = await dispatch(store, { followUpTo: finished._id, rootItemId: finished._id }, { kind: 'implementation' });
    assert.ok(item._id, 'the sweep never touched this run, so the reply is admitted');
  });

  test('under an active halt `stop`, a fresh run is admitted', async () => {
    const store = makeStore();
    store.setHaltReader(() => ({ mode: 'stop' }));

    const item = await createDispatchItem({
      store,
      urlKey: URL_KEY,
      kind: 'autopilot',
      prompt: 'a fresh run',
      fields: { issueIdentifier: 'LIN-44' }
    });
    assert.ok(item._id);
  });
});
