/**
 * LIN-4377 / LIN-4383 (witnesses A2, A3, A4): the store's held-wake primitives are keyed
 * on `heldWakeFor`, and the injected wake hook can only withhold or reword a wake the
 * plan already owed.
 *
 * A2. The stopped-run cleanup cancels a QUEUED row in the stopped run's lineage because
 *     it carries `heldWakeFor`, never because of its kind, and never cancels a queued row
 *     without the field. The query is `{heldWakeFor: {$exists: true}}`: `{$ne: null}`
 *     would match an absent field in the test mock (`undefined !== null`) and cancel
 *     every queued row in the lineage. Plus the mock's own `$exists` cases.
 * A3. A `[pending]` through `addFeedback` with the real leftover hook, in a lineage that
 *     holds nothing, delivers the same wake as with no hook and logs no `[leftover]` line
 *     (the hook now sees every marker; it must return quietly on a pending).
 * A4. A hook answering `rewrite` when `_planWake` owed no wake leaves the wake null: the
 *     hook never creates a wake the plan did not owe.
 * M5. With no wake owed (`wakeFollowUp: null`), the real hook's outcome wake reads
 *     neither the holder nor the producer, on a `[pending]` or a `[failed]` (slice item 7).
 * M8. `heldWakeHolderOf` recognises a holder by `heldWakeFor`, never by kind, on the doc
 *     itself and along the `custom` walk (slice item 2).
 *
 * Store-level, on a real DispatchQueueStore over mock collections.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createLeftoverStep } from '../../lib/dispatch-leftover-hook.js';

const URL_KEY = 'acme';
const TOKEN = 'token-a';
const OWNER = 'account-owner';
const WORKSPACE = 'ws-1';
const PR = 'https://github.com/o/r/pull/12';
const DONE = `[done] Built LIN-7. PR ${PR} is green.`;
const PENDING = `[pending] Waiting on CI for ${PR}.`;

function makeWorld() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  const world = { store, collection, historyCollection, logs: [] };
  world.hook = createLeftoverStep({
    dispatchStore: store,
    ownerCheck: async () => ({ status: 'owner' }),
    haltReader: async () => null,
    resolveWorkspaceId: async () => WORKSPACE,
    log: (line) => world.logs.push(line)
  }).forRequest({ baseUrl: 'https://harbour.test', workspaceId: WORKSPACE });
  return world;
}

async function run(world) {
  const row = await world.store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-7', dispatchedBy: OWNER });
  await world.store.takeItem(row._id, URL_KEY, 'orchestrator');
  return row;
}

async function build(world, runId) {
  const row = await world.store.addItem(URL_KEY, {
    prompt: 'build it', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
    target: 'cli', dispatchedBy: OWNER, subscription: 'terminal-only', ...(runId ? { sessionId: runId } : {})
  });
  await world.store.takeItem(row._id, URL_KEY, TOKEN);
  return row;
}

/** The hook option on `addFeedback`. */
const hookOpts = (hook) => ({ wakeHook: hook });

const post = (world, row, message, hook) =>
  world.store.addFeedback(row._id, URL_KEY, { message }, TOKEN, undefined, hook ? hookOpts(hook) : {});

const all = (world) => [...world.collection._docs, ...world.historyCollection._docs];
const wakes = (world) => all(world).filter(d => d.kind === 'wake');
const isQueued = (world, id) => world.collection._docs.some(d => d._id === id);
const historyStatus = (world, id) => world.historyCollection._docs.find(d => d._id === id)?.status;

async function abortRun(world, runId) {
  const abort = await world.store.addItem(URL_KEY, { abort: true, abortTo: runId, target: 'cli' });
  await world.store.takeItem(abort._id, URL_KEY, TOKEN);
  await world.store.addFeedback(abort._id, URL_KEY, { message: '[aborted] Cancelled running session.' }, TOKEN);
}

async function captureLogs(fn) {
  const lines = [];
  const saved = { log: console.log, error: console.error };
  console.log = (...a) => lines.push(a.map(String).join(' '));
  console.error = (...a) => lines.push(a.map(String).join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

// ─── A2 ─────────────────────────────────────────────────────────────────────

describe('A2 — the mock collection reads $exists the way Mongo does', () => {
  const seeded = async () => {
    const c = createMockCollection();
    await c.insertOne({ _id: 'held', urlKey: URL_KEY, heldWakeFor: 'build-1' });
    await c.insertOne({ _id: 'plain', urlKey: URL_KEY });
    return c;
  };
  const ids = async (c, query) => (await c.find(query).toArray()).map(d => d._id).sort();

  test('$exists: true matches a present field', async () => {
    assert.deepEqual(await ids(await seeded(), { urlKey: URL_KEY, heldWakeFor: { $exists: true } }), ['held']);
  });

  test('$exists: true does not match an absent field', async () => {
    assert.ok(!(await ids(await seeded(), { heldWakeFor: { $exists: true } })).includes('plain'));
  });

  test('$exists: false matches an absent field', async () => {
    assert.deepEqual(await ids(await seeded(), { urlKey: URL_KEY, heldWakeFor: { $exists: false } }), ['plain']);
  });

  test('$exists: false does not match a present field', async () => {
    assert.ok(!(await ids(await seeded(), { heldWakeFor: { $exists: false } })).includes('held'));
  });
});

describe("A2 — a stopped run's cleanup cancels queued rows by heldWakeFor, never by kind", () => {
  test('a queued held row is cancelled; a queued row without heldWakeFor in the same lineage is left alone', async () => {
    const world = makeWorld();
    const a = await run(world);
    const b = await build(world, a._id);
    await captureLogs(() => post(world, b, DONE, world.hook)); // queues the held `leftover` row
    const held = world.collection._docs.find(d => d.heldWakeFor === b._id);
    assert.ok(held, `a held row is queued; logs ${JSON.stringify(world.logs)}`);
    const plain = await world.store.addItem(URL_KEY, {
      prompt: 'a fix round', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
      target: 'cli', dispatchedBy: OWNER, followUpTo: b._id
    });
    assert.equal(plain.heldWakeFor, undefined, 'the second row carries no heldWakeFor');

    await captureLogs(() => abortRun(world, a._id));

    assert.equal(isQueued(world, held._id), false, 'the held row is no longer queued');
    assert.equal(historyStatus(world, held._id), 'cancelled');
    assert.equal(isQueued(world, plain._id), true, 'the row without heldWakeFor stays queued');
  });

  test('a queued row carrying heldWakeFor is cancelled whatever its kind', async () => {
    const world = makeWorld();
    const a = await run(world);
    const b = await build(world, a._id);
    // A held row of another kind: the store holds by `heldWakeFor`, so the kind is the hook's business.
    const held = await world.store.addItem(URL_KEY, {
      prompt: 'held step', kind: 'custom', issueIdentifier: 'LIN-7', target: 'cli',
      dispatchedBy: OWNER, followUpTo: b._id, heldWakeFor: b._id
    });
    assert.equal(held.heldWakeFor, b._id);

    await captureLogs(() => abortRun(world, a._id));

    assert.equal(isQueued(world, held._id), false, `the held ${held.kind} row is no longer queued`);
    assert.equal(historyStatus(world, held._id), 'cancelled');
  });
});

// ─── A3 ─────────────────────────────────────────────────────────────────────

describe('A3 — a [pending] in a lineage that holds nothing wakes as before, quietly', () => {
  /** Post PENDING from a fresh build, with or without the real hook; return the wake and every log line. */
  const pendingWake = async (withHook) => {
    const world = makeWorld();
    const a = await run(world);
    const b = await build(world, a._id);
    const { lines } = await captureLogs(() => post(world, b, PENDING, withHook ? world.hook : null));
    const minted = wakes(world).filter(d => d.followUpTo === a._id);
    return { minted, lines: [...lines, ...world.logs] };
  };

  test('the real hook delivers the same wake as no hook, and logs no [leftover] line', async () => {
    const plain = await pendingWake(false);
    const hooked = await pendingWake(true);
    assert.equal(plain.minted.length, 1, 'the baseline: a pending wakes the parent once');
    assert.equal(hooked.minted.length, 1, `with the hook too; logs ${JSON.stringify(hooked.lines)}`);
    const shape = (w) => ({ kind: w.kind, prompt: w.prompt, subscription: w.subscription, issueIdentifier: w.issueIdentifier });
    assert.deepEqual(shape(hooked.minted[0]), shape(plain.minted[0]), 'byte-identical wake prompt');
    const leftoverLines = hooked.lines.filter(l => l.includes('[leftover]'));
    assert.deepEqual(leftoverLines, [], 'no [leftover] line for a pending that holds nothing');
  });
});

// ─── A4 ─────────────────────────────────────────────────────────────────────

describe('A4 — a rewrite never creates a wake the plan did not owe', () => {
  for (const message of [DONE, '[failed] Could not build LIN-7.']) {
    test(`a rewrite verdict on a parentless row's ${message.slice(0, message.indexOf(']') + 1)} leaves the wake null`, async () => {
      const world = makeWorld();
      const b = await build(world, null); // no parent run: `_planWake` owes no wake
      const calls = [];
      // Shaped like a real descriptor (`buildWakeFollowUp`), so a store that took it would mint it.
      const invented = {
        followUpTo: 'someone', prompt: 'invented wake', queueIfBusy: true, sessionId: 'someone',
        subscription: 'terminal-only', kind: 'wake', issueIdentifier: 'LIN-7'
      };
      const stub = async (args) => {
        calls.push(args);
        return { outcome: 'rewrite', wakeFollowUp: { ...invented } };
      };
      const { result } = await captureLogs(() => post(world, b, message, stub));
      assert.equal(calls.length, 1, 'the hook was consulted');
      assert.deepEqual(wakes(world), [], 'no wake row minted');
      assert.deepEqual(all(world).filter(d => d.prompt === invented.prompt), [], 'the invented wake reached no row');
      assert.deepEqual(world.collection._docs, [], 'nothing was queued');
      assert.ok(result, 'the feedback write landed');
    });
  }
});

// ─── Close-out witnesses (LIN-4383 review, M5 and M8) ─────────────────────────

describe('M5 — the outcome wake reads nothing when the plan owes no wake (slice item 7)', () => {
  for (const [marker, message] of [['pending', PENDING], ['failed', '[failed] Could not finish the step for LIN-7.']]) {
    test(`a [${marker}] with wakeFollowUp: null reads neither the holder nor the producer`, async () => {
      const world = makeWorld();
      const b = await build(world, null);
      // A held row in b's lineage: were the hook to read, both reads would resolve to rows.
      const held = await world.store.addItem(URL_KEY, {
        prompt: 'held step', kind: 'custom', issueIdentifier: 'LIN-7', target: 'cli',
        dispatchedBy: OWNER, followUpTo: b._id, heldWakeFor: b._id
      });
      const reads = { holder: 0, producer: 0 };
      const { heldWakeHolderOf, heldWakeProducerOf } = world.store;
      world.store.heldWakeHolderOf = (...a) => { reads.holder++; return heldWakeHolderOf.apply(world.store, a); };
      world.store.heldWakeProducerOf = (...a) => { reads.producer++; return heldWakeProducerOf.apply(world.store, a); };

      await captureLogs(() => world.hook({
        urlKey: URL_KEY, doc: held, entry: { message }, marker, wakeFollowUp: null, edgeDoc: null
      }));

      assert.deepEqual(reads, { holder: 0, producer: 0 }, 'no held-wake read when no wake is owed');
    });
  }
});

describe('M8 — heldWakeHolderOf walks by lineage, never by kind (slice item 2)', () => {
  const seed = async (world, rows) => {
    for (const row of rows) await world.historyCollection.insertOne({ urlKey: URL_KEY, ...row });
  };

  test('(a) a non-leftover doc carrying heldWakeFor is its own holder', async () => {
    const { store } = makeWorld();
    const doc = { _id: 'impl-held', urlKey: URL_KEY, kind: 'implementation', heldWakeFor: 'build-1' };
    assert.equal(await store.heldWakeHolderOf(URL_KEY, doc), doc);
  });

  test('(b) a custom row under a non-leftover holder returns that holder', async () => {
    const world = makeWorld();
    await seed(world, [{ _id: 'impl-held', kind: 'implementation', heldWakeFor: 'build-1' }]);
    const doc = { _id: 'ci-wake', urlKey: URL_KEY, kind: 'custom', followUpTo: 'impl-held' };
    const holder = await world.store.heldWakeHolderOf(URL_KEY, doc);
    assert.equal(holder?._id, 'impl-held');
  });

  test('(c) a custom row under an implementation row without heldWakeFor has no holder', async () => {
    const world = makeWorld();
    await seed(world, [{ _id: 'impl-plain', kind: 'implementation' }]);
    const doc = { _id: 'ci-wake', urlKey: URL_KEY, kind: 'custom', followUpTo: 'impl-plain' };
    assert.equal(await world.store.heldWakeHolderOf(URL_KEY, doc), null);
  });
});
