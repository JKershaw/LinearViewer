/**
 * LIN-4080 (beat 5) — ruling `lin4078-human-followup-revive`: human-force-only.
 *
 * A stopped run takes no more work, with one exception. A PERSON's follow-up
 * into a stopped run is admitted when it carries `force: true`, and the stored
 * row is stamped `personOriginated: true`. "A person" is decided server-side:
 * the session-authenticated entrance (the reply box, routes/dispatch.js ->
 * enterSessionDispatch) passes `personOriginated: true` to createDispatchItem.
 * The flag never comes from the request body. Every other path stays refused
 * with 409 RUN_STOPPED even with `force: true`:
 *  - a `sessionId` (join) dispatch, from anyone;
 *  - a follow-up from a proxy token (an agent or the runner);
 *  - a `kind:'wake'` row (a wake never reaches the factory; the guard refuses it too);
 *  - a `ci-wake-sweep` or orchestrator follow-up (no person flag);
 *  - a person's follow-up WITHOUT `force`.
 * Live (never-stopped) runs are untouched, and the stamp is set only on the
 * admitted person-forced row (the exception, not every person follow-up).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

function autopilot(store) {
  return store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-42' });
}

async function stoppedRun(store) {
  const run = await autopilot(store);
  await store.addItem(URL_KEY, { abort: true, abortTo: run._id, target: 'cli' });
  return run;
}

function rowsOf(store) {
  return [...store.collection._docs, ...store.historyCollection._docs];
}

/** A dispatch through the real factory. `personOriginated` is the server-set parameter. */
function dispatch(store, fields, { kind = 'implementation', personOriginated, prompt = 'reply' } = {}) {
  return createDispatchItem({
    store,
    urlKey: URL_KEY,
    kind,
    prompt,
    personOriginated,
    fields: { issueIdentifier: 'LIN-42', ...fields }
  });
}

describe('LIN-4080 ruling — a person\'s forced follow-up into a stopped run is admitted', () => {
  test('the session-authenticated reply (personOriginated, force:true, followUpTo a stopped run) is admitted and stamped', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);

    const item = await dispatch(
      store,
      { followUpTo: run._id, rootItemId: run._id, force: true },
      { personOriginated: true }
    );

    assert.ok(item._id, 'the person\'s forced reply is admitted');
    const stored = rowsOf(store).find(d => d._id === item._id);
    assert.equal(stored.personOriginated, true, 'the stored row is stamped personOriginated: true');
  });

  test('a live run\'s person follow-up is admitted and NOT stamped (the stamp marks the exception only)', async () => {
    const store = makeStore();
    const live = await autopilot(store);

    const item = await dispatch(
      store,
      { followUpTo: live._id, rootItemId: live._id, force: true },
      { personOriginated: true }
    );

    const stored = rowsOf(store).find(d => d._id === item._id);
    assert.equal('personOriginated' in stored, false);
  });
});

describe('LIN-4080 ruling — every other path into a stopped run stays refused, even with force:true', () => {
  test('the same request from a proxy token (no person flag) is refused 409 RUN_STOPPED', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);

    await assert.rejects(
      () => dispatch(store, { followUpTo: run._id, rootItemId: run._id, force: true }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
  });

  test('a body that supplies personOriginated is ignored: the flag never comes from the request (proxy shape)', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);
    const before = rowsOf(store).length;

    await assert.rejects(
      () => dispatch(store, { followUpTo: run._id, rootItemId: run._id, force: true, personOriginated: true }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
    assert.equal(rowsOf(store).length, before, 'no row is written');
  });

  test('a person\'s follow-up WITHOUT force is still refused', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);

    await assert.rejects(
      () => dispatch(store, { followUpTo: run._id, rootItemId: run._id, force: false }, { personOriginated: true }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
  });

  test('a sessionId (join) dispatch is refused even from a person with force:true', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);

    await assert.rejects(
      () => dispatch(store, { sessionId: run._id, force: true }, { kind: 'research', personOriginated: true }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
  });

  test('a person follow-up that also joins a stopped sessionId is refused (the join is never admitted)', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);

    await assert.rejects(
      () => dispatch(store, { followUpTo: run._id, sessionId: run._id, rootItemId: run._id, force: true }, { personOriginated: true }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
  });

  test('a kind:wake row is refused even from a person with force:true (wakes never revive a run)', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);

    await assert.rejects(
      () => dispatch(store, { followUpTo: run._id, rootItemId: run._id, force: true }, { kind: 'wake', personOriginated: true }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
  });

  test('a ci-wake-sweep-shaped follow-up (force from the tail, no person flag) is refused', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);

    await assert.rejects(
      () => dispatch(store, { followUpTo: run._id, rootItemId: run._id, force: true }, { kind: 'custom' }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
  });

  test('an orchestrator dispatch (sessionId of the stopped run, force:true, no person flag) is refused', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);

    await assert.rejects(
      () => dispatch(store, { sessionId: run._id, force: true }, { kind: 'research' }),
      (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED'
    );
  });
});

describe('LIN-4080 ruling — the stamp is never taken from the request body', () => {
  test('a fresh row whose body supplies personOriginated is stored without the stamp', async () => {
    const store = makeStore();

    const item = await dispatch(store, { personOriginated: true }, { kind: 'research' });

    const stored = rowsOf(store).find(d => d._id === item._id);
    assert.equal('personOriginated' in stored, false);
  });
});

describe('LIN-4080 ruling — the person stamp reaches the runner (SD\'s LIN-4082 reads it from the item)', () => {
  async function admitPersonForced(store) {
    const run = await stoppedRun(store);
    const item = await dispatch(
      store,
      { followUpTo: run._id, rootItemId: run._id, force: true },
      { personOriginated: true }
    );
    return { run, item };
  }

  test('the poll shape (listItemsWithPrompt -> _formatItem) carries personOriginated: true on the admitted row', async () => {
    const store = makeStore();
    const { item } = await admitPersonForced(store);

    const polled = (await store.listItemsWithPrompt(URL_KEY)).find(i => i.id === item._id);
    assert.ok(polled, 'the admitted row is in the poll');
    assert.equal(polled.personOriginated, true);
  });

  test('the take shape (takeItem result) carries personOriginated: true', async () => {
    const store = makeStore();
    const { item } = await admitPersonForced(store);

    const taken = await store.takeItem(item._id, URL_KEY);
    assert.ok(taken, 'the row is taken');
    assert.equal(taken.personOriginated, true);
  });

  test('the history shape (_formatHistoryItem, after the take) still carries personOriginated: true', async () => {
    const store = makeStore();
    const { item } = await admitPersonForced(store);
    await store.takeItem(item._id, URL_KEY);

    const { items } = await store.listHistory(URL_KEY, { limit: 50 });
    const archived = items.find(i => i.id === item._id);
    assert.ok(archived, 'the taken row is in history');
    assert.equal(archived.personOriginated, true);
  });

  test('an ordinary row\'s items (poll, take, history) do NOT carry the key at all', async () => {
    const store = makeStore();
    const run = await autopilot(store);
    const ordinary = await dispatch(store, { followUpTo: run._id, rootItemId: run._id, force: true }, { personOriginated: true });

    const polled = (await store.listItemsWithPrompt(URL_KEY)).find(i => i.id === ordinary._id);
    assert.equal('personOriginated' in polled, false, 'poll');
    const taken = await store.takeItem(ordinary._id, URL_KEY);
    assert.equal('personOriginated' in taken, false, 'take');
    const archived = (await store.listHistory(URL_KEY, { limit: 50 })).items.find(i => i.id === ordinary._id);
    assert.equal('personOriginated' in archived, false, 'history');
  });
});
