/**
 * LIN-4377 / LIN-4383: characterization of the held-wake step's behaviours that no
 * other test pinned, captured on the code before the outcome-wake rewrite moved from
 * the store into the leftover hook. Each passed there first; the move keeps them.
 *
 * C1. A withheld wake's `nullWakeReason` is exactly `held-for-leftover (queued)` when the
 *     step is queued, and `held-for-leftover (hold)` when a re-reported `[done]` holds.
 *     It is only ever read in the `[dispatch-wake] null-wake` log line.
 * C2. A build read that faults while rewording a held lineage's non-`[done]` terminal is
 *     logged (`[leftover] build read for the outcome wake failed item=<id>:`) and the
 *     row's own wake goes ahead, once.
 * C3. A feedback entry that is not a wake event never consults the hook.
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

/** The hook option on `addFeedback`. */
const hookOpts = (hook) => ({ wakeHook: hook });

const post = (world, row, message, hook = world.hook) =>
  world.store.addFeedback(row._id, URL_KEY, { message }, TOKEN, undefined, hookOpts(hook));

const all = (world) => [...world.collection._docs, ...world.historyCollection._docs];
const wakesTo = (world, runId) => all(world).filter(d => d.kind === 'wake' && d.followUpTo === runId);

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

async function heldBuild(world) {
  const a = await world.store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-7', dispatchedBy: OWNER });
  await world.store.takeItem(a._id, URL_KEY, 'orchestrator');
  const b = await world.store.addItem(URL_KEY, {
    prompt: 'build it', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
    target: 'cli', dispatchedBy: OWNER, subscription: 'terminal-only', sessionId: a._id
  });
  await world.store.takeItem(b._id, URL_KEY, TOKEN);
  const { lines } = await captureLogs(() => post(world, b, DONE));
  return { a, b, lines };
}

describe('C1 — a withheld wake names why, exactly', () => {
  test('queued: reason=held-for-leftover (queued)', async () => {
    const world = makeWorld();
    const { b, lines } = await heldBuild(world);
    assert.ok(
      lines.includes(`[dispatch-wake] null-wake producingItem=${b._id} marker=done reason=held-for-leftover (queued)`),
      JSON.stringify(lines)
    );
  });

  test('a re-reported [done] while the row is queued: reason=held-for-leftover (hold)', async () => {
    const world = makeWorld();
    const { b } = await heldBuild(world);
    const { lines } = await captureLogs(() => post(world, b, DONE));
    assert.ok(
      lines.includes(`[dispatch-wake] null-wake producingItem=${b._id} marker=done reason=held-for-leftover (hold)`),
      JSON.stringify(lines)
    );
  });
});

describe("C2 — a faulted build read keeps the row's own wake", () => {
  test("the leftover row's [failed] with the build read faulting: the log line, and one plain wake", async () => {
    const world = makeWorld();
    const { a, b } = await heldBuild(world);
    const l = world.collection._docs.find(d => d.kind === 'leftover');
    await world.store.takeItem(l._id, URL_KEY, TOKEN);

    // Fault the first read of the build row made after the wake is planned: the
    // outcome-wake read. `_planWake`'s own edge walk runs before it and is unaffected.
    const realPlan = world.store._planWake.bind(world.store);
    const realFindOne = world.historyCollection.findOne.bind(world.historyCollection);
    let armed = false;
    world.store._planWake = async (...args) => {
      const plan = await realPlan(...args);
      armed = true;
      return plan;
    };
    world.historyCollection.findOne = async (query, ...rest) => {
      if (armed && query?._id === b._id) {
        armed = false;
        throw new Error('history read fault');
      }
      return realFindOne(query, ...rest);
    };

    const message = '[failed] No live session to resume for follow-up abc';
    const { lines } = await captureLogs(() => post(world, l, message));
    assert.ok(
      lines.some(x => x.startsWith(`[leftover] build read for the outcome wake failed item=${l._id}:`) && x.includes('history read fault')),
      JSON.stringify(lines)
    );
    const wakes = wakesTo(world, a._id);
    assert.equal(wakes.length, 1, 'one wake');
    assert.ok(wakes[0].prompt.includes(message), "the row's own outcome");
    assert.ok(!wakes[0].prompt.startsWith('The leftover step ended'), 'not reworded');
  });
});

describe('C3 — a feedback entry that is not a wake event never consults the hook', () => {
  test('a progress note: the hook is not called', async () => {
    const world = makeWorld();
    const a = await world.store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-7', dispatchedBy: OWNER });
    await world.store.takeItem(a._id, URL_KEY, 'orchestrator');
    const b = await world.store.addItem(URL_KEY, {
      prompt: 'build it', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
      target: 'cli', dispatchedBy: OWNER, subscription: 'terminal-only', sessionId: a._id
    });
    await world.store.takeItem(b._id, URL_KEY, TOKEN);
    let calls = 0;
    await captureLogs(() => post(world, b, 'Reading the store before changing it.', async () => { calls++; }));
    assert.equal(calls, 0);
    assert.equal(wakesTo(world, a._id).length, 0);
  });
});
