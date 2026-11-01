/**
 * LIN-4080 (beat 2) — the wake-mint gate in `addFeedback`.
 *
 * A child's terminal (or `[pending]`) mints a wake to its parent run. When that
 * run is stopped, the wake is never minted (W1: a cascade-aborted run is not
 * revived by its child's `[aborted]`). The gate reads two things:
 *  - recorded stop: `isRunStopped(urlKey, parent)` (abort rows, lineage `[aborted]`);
 *  - workspace halt `stop` through the late-bound halt reader (W5). Only `stop`
 *    counts, never `pause`; a throwing or null read fails open (not halted).
 *
 * The gate sits before the grant lookup, the provisioning call and the
 * `terminalWakeItems` CAS, so a blocked wake burns neither the once-only
 * witness nor a wake credential (the burn-before-decide invariant).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const TOKEN = 'token-a';
const STOPPED_MESSAGE = '[aborted] Cancelled running session (stopped by operator).';

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  return { store: new DispatchQueueStore({ collection, historyCollection }), collection, historyCollection };
}

function autopilot(store) {
  return store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-42' });
}

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

/** Wake rows addressed to `parentId`, across queue and history. */
function wakesTo(collection, historyCollection, parentId) {
  return [...collection._docs, ...historyCollection._docs]
    .filter(d => d.kind === 'wake' && d.followUpTo === parentId);
}

/** Take a child and post a message on it, as the runner does; `provision` is the mint seam. */
async function postOn(store, row, message, provision) {
  await store.takeItem(row._id, URL_KEY, TOKEN);
  return store.addFeedback(row._id, URL_KEY, { message }, TOKEN, provision);
}

describe('LIN-4080 W1 — a child terminal from a stopped run mints no wake', () => {
  test('after a cascade abort of the run, the child\'s [aborted] mints no wake to the run', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    await store.expandCascadeAborts(URL_KEY, run._id);

    await postOn(store, child, STOPPED_MESSAGE);

    assert.equal(wakesTo(collection, historyCollection, run._id).length, 0, 'no wake addressed to the stopped run');
    const landed = historyCollection._docs.find(d => d._id === child._id);
    assert.equal(landed.feedback.length, 1, 'the child\'s own feedback still lands');
  });

  test('after a plain abort of the run, the child\'s [done] mints no wake to the run', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    await store.addItem(URL_KEY, { abort: true, abortTo: run._id, target: 'cli' });

    await postOn(store, child, '[done] shipped');

    assert.equal(wakesTo(collection, historyCollection, run._id).length, 0);
  });

  test('control: the same [done] mints the wake when the run was never stopped', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);

    await postOn(store, child, '[done] shipped');

    assert.equal(wakesTo(collection, historyCollection, run._id).length, 1);
  });

  test('a [pending] beat of a stopped run is blocked too (the unguarded branch)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id, { subscription: 'everything' });
    await store.addItem(URL_KEY, { abort: true, abortTo: run._id, target: 'cli' });

    await postOn(store, child, '[pending] paused, not done');

    assert.equal(wakesTo(collection, historyCollection, run._id).length, 0);
  });
});

describe('LIN-4080 W5 — the workspace halt blocks wake minting only while it is `stop`', () => {
  test('halt `stop` blocks the wake while the run is live', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    store.setHaltReader(() => ({ mode: 'stop' }));

    await postOn(store, child, '[done] shipped');

    assert.equal(wakesTo(collection, historyCollection, run._id).length, 0);
  });

  test('halt `pause` does not block the wake', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    store.setHaltReader(() => ({ mode: 'pause' }));

    await postOn(store, child, '[done] shipped');

    assert.equal(wakesTo(collection, historyCollection, run._id).length, 1);
  });

  test('a throwing halt read fails open: the wake mints', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    store.setHaltReader(() => { throw new Error('halt store unreachable'); });

    await postOn(store, child, '[done] shipped');

    assert.equal(wakesTo(collection, historyCollection, run._id).length, 1);
  });

  test('a null halt read fails open: the wake mints', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    store.setHaltReader(async () => null);

    await postOn(store, child, '[done] shipped');

    assert.equal(wakesTo(collection, historyCollection, run._id).length, 1);
  });

  test('after the halt clears, a merely-live run is mintable again', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const first = await worker(store, run._id);
    const second = await worker(store, run._id);

    let halt = { mode: 'stop' };
    store.setHaltReader(() => halt);
    await postOn(store, first, '[done] during the halt');
    assert.equal(wakesTo(collection, historyCollection, run._id).length, 0);

    halt = null;
    await postOn(store, second, '[done] after the halt cleared');
    assert.equal(wakesTo(collection, historyCollection, run._id).length, 1);
  });

  test('after the halt clears, a run stopped by a recorded abort still mints nothing', async () => {
    const { store, collection, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    await store.addItem(URL_KEY, { abort: true, abortTo: run._id, target: 'cli' });
    store.setHaltReader(() => null);

    await postOn(store, child, '[done] shipped');

    assert.equal(wakesTo(collection, historyCollection, run._id).length, 0);
  });
});

describe('LIN-4080 — burn-before-decide: a blocked wake consumes nothing', () => {
  test('a blocked wake calls neither the grant lookup nor the provisioning seam, and burns no witness', async () => {
    const { store, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    await store.addItem(URL_KEY, { abort: true, abortTo: run._id, target: 'cli' });
    let grantLookups = 0;
    let provisions = 0;
    store.getGrantDeclaration = async () => { grantLookups += 1; return null; };

    await postOn(store, child, '[done] shipped', async () => { provisions += 1; return { token: 'tok' }; });

    assert.equal(grantLookups, 0, 'no grant lookup for a wake that is never minted');
    assert.equal(provisions, 0, 'no wake credential provisioned for a wake that is never minted');
    const edge = historyCollection._docs.find(d => d._id === child._id);
    assert.equal(edge.terminalWakeItems?.includes(child._id) ?? false, false, 'the once-only CAS is not burned');
    assert.equal(edge.wakeWitnessMeta, undefined, 'no witness is seeded');
  });

  test('control: an unblocked wake does reach the grant lookup and the provisioning seam', async () => {
    const { store, historyCollection } = makeStore();
    const run = await autopilot(store);
    const child = await worker(store, run._id);
    let grantLookups = 0;
    let provisions = 0;
    store.getGrantDeclaration = async () => { grantLookups += 1; return null; };

    await postOn(store, child, '[done] shipped', async () => { provisions += 1; return { token: 'tok' }; });

    assert.equal(grantLookups, 1);
    assert.equal(provisions, 1);
    const edge = historyCollection._docs.find(d => d._id === child._id);
    assert.ok(edge.terminalWakeItems.includes(child._id), 'the once-only CAS is burned on a real mint');
    assert.ok(edge.wakeWitnessMeta, 'the witness is seeded on a real mint');
  });
});
