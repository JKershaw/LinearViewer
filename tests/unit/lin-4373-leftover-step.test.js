/**
 * LIN-4373 (piece 2 of LIN-4347): the leftover step, and the build wake it holds.
 *
 * At an eligible build's terminal `[done]`, Harbour queues a `leftover` follow-up into the
 * build's own lineage and withholds the build's parent wake until that row ends. The
 * build's terminal wake is then given by exactly one of: the leftover row's own terminal (`[done]` as itself;
 * `[failed]`/`[blocked]` as the build's outcome plus one line), or the release when the
 * row is cancelled (`removeItem`) or expires (`cleanup()`). "The leftover row's own terminal"
 * includes its ci-wake `custom` continuation after it parked on CI; a `[pending]` park in
 * the step's lineage wakes the parent at once, labelled as the leftover step.
 *
 * Store-level through `addFeedback`, `removeItem` and `cleanup()`, on a real
 * DispatchQueueStore over mock collections, with the real leftover hook and the real
 * `enqueueFollowUp` (owner gate, createDispatchItem). Route-level for both entrances.
 * The witness for the wake-block extraction is the existing addFeedback wake suites,
 * which pass unchanged.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createLeftoverStep, workspaceIdResolverFrom } from '../../lib/dispatch-leftover-hook.js';
import { decideLeftover, leftoverPrompt, isStageBuild } from '../../lib/dispatch-leftover.js';
import { LEFTOVERS_HEADING } from '../../lib/prompts/leftover-words.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRunnerRoutes } from '../../routes/proxy-runner.js';
import { readCostOverRecords } from '../../lib/cost-read.js';

const URL_KEY = 'acme';
const TOKEN = 'token-a';
const OWNER = 'account-owner';
const WORKSPACE = 'ws-1';
const BASE_URL = 'https://harbour.test';
const PR = 'https://github.com/o/r/pull/12';
const DONE = `[done] Built LIN-7. PR ${PR} is green.`;

// ─── World ───────────────────────────────────────────────────────────────────

function makeWorld({ ownerStatus = 'owner', halt = null, enqueue } = {}) {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  const world = { store, collection, historyCollection, halt, logs: [] };
  world.step = createLeftoverStep({
    dispatchStore: store,
    ownerCheck: async () => ({ status: ownerStatus }),
    haltReader: async () => world.halt,
    resolveWorkspaceId: async () => WORKSPACE,
    log: (line) => world.logs.push(line),
    ...(enqueue ? { enqueue } : {})
  });
  world.hook = world.step.forRequest({ baseUrl: BASE_URL, workspaceId: WORKSPACE });
  return world;
}

/** The autopilot run, taken (so it lives in history like a real run). */
async function run(world) {
  const row = await world.store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-7', dispatchedBy: OWNER });
  await world.store.takeItem(row._id, URL_KEY, 'orchestrator');
  return row;
}

/** A taken stage build reporting to `runId`. */
async function build(world, runId, extra = {}) {
  const row = await world.store.addItem(URL_KEY, {
    prompt: 'build it', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
    target: 'cli', dispatchedBy: OWNER, subscription: 'terminal-only',
    ...(runId ? { sessionId: runId } : {}), ...extra
  });
  await world.store.takeItem(row._id, URL_KEY, TOKEN);
  return row;
}

const post = (world, row, message, { hook = world.hook, provision } = {}) =>
  world.store.addFeedback(row._id, URL_KEY, { message }, TOKEN, provision, { wakeHook: hook });

const all = (world) => [...world.collection._docs, ...world.historyCollection._docs];
const wakesTo = (world, runId) => all(world).filter(d => d.kind === 'wake' && d.followUpTo === runId);
const leftovers = (world) => all(world).filter(d => d.kind === 'leftover');
const queuedLeftover = (world) => world.collection._docs.find(d => d.kind === 'leftover');

async function takeLeftover(world) {
  const row = queuedLeftover(world);
  assert.ok(row, 'a leftover row is queued');
  await world.store.takeItem(row._id, URL_KEY, TOKEN);
  return row;
}

/** A build that has posted its [done] and queued its leftover row. */
async function heldBuild(world) {
  const a = await run(world);
  const b = await build(world, a._id);
  await post(world, b, DONE);
  return { a, b };
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

// ─── Witness point 1: never woken, or woken twice ───────────────────────────

describe('LIN-4373 — a build [done] queues one leftover row and holds the wake', () => {
  test('one leftover row carrying heldWakeFor, kind leftover, the build lineage; no parent wake', async () => {
    const world = makeWorld();
    const { a, b } = await heldBuild(world);
    const rows = leftovers(world);
    assert.equal(rows.length, 1, `exactly one leftover row; logs ${JSON.stringify(world.logs)}`);
    const [row] = rows;
    assert.equal(row.heldWakeFor, b._id);
    assert.equal(row.followUpTo, b._id, 'it resumes the build row itself');
    assert.equal(row.force, true, 'forced: the build just posted its terminal');
    assert.equal(row.issueIdentifier, 'LIN-7', 'inherited from the build (once-per-ticket scope)');
    assert.equal(row.rootItemId, b.rootItemId, 'in the build lineage, so /cost reads it with the build');
    assert.equal(row.dispatchedBy, OWNER, "owner: the root's dispatchedBy");
    assert.match(row.prompt, new RegExp(LEFTOVERS_HEADING.replace(/[#]/g, '\\#')));
    assert.ok(row.prompt.includes(PR), 'the prompt names the PR');
    assert.deepEqual(wakesTo(world, a._id), [], 'the build wake is held');
    const edge = world.historyCollection._docs.find(d => d._id === b._id);
    assert.ok(!(edge.terminalWakeItems || []).includes(b._id), "the build's guard key is not burned");
  });
});

describe("LIN-4373 — the leftover row's own terminal wakes the parent once", () => {
  test('[done]: one ordinary wake carrying the leftover outcome', async () => {
    const world = makeWorld();
    const { a } = await heldBuild(world);
    const l = await takeLeftover(world);
    await post(world, l, `[done] ${LEFTOVERS_HEADING}: nothing. ${PR} head abc1234`);
    const wakes = wakesTo(world, a._id);
    assert.equal(wakes.length, 1);
    assert.match(wakes[0].prompt, /Outcome: \[done\] ### Leftovers: nothing/);
    assert.doesNotMatch(wakes[0].prompt, /leftover step (ended|did not run)/);
  });

  for (const [marker, message, expected] of [
    ['failed', '[failed] No live session to resume for follow-up abc', /The leftover step ended \[failed\]: \[failed\] No live session to resume/],
    ['blocked', '[blocked] need a ruling on the notes file', /The leftover step ended blocked: \[blocked\] need a ruling/]
  ]) {
    test(`[${marker}]: one wake with the BUILD's [done] outcome and PR, and the ${marker} line`, async () => {
      const world = makeWorld();
      const { a } = await heldBuild(world);
      const l = await takeLeftover(world);
      await post(world, l, message);
      const wakes = wakesTo(world, a._id);
      assert.equal(wakes.length, 1);
      const prompt = wakes[0].prompt;
      assert.match(prompt, expected);
      assert.ok(prompt.includes(`Outcome: ${DONE}`), `the build's outcome, not the leftover's: ${prompt}`);
      assert.ok(prompt.includes(PR));
      assert.ok(prompt.startsWith('The leftover step ended'), 'the line comes first');
      // A re-report of the same terminal adds nothing.
      await post(world, l, message);
      assert.equal(wakesTo(world, a._id).length, 1);
    });
  }
});

describe('LIN-4373 — release when the leftover row never runs', () => {
  test('cancel via removeItem: exactly one wake, the build outcome and the did-not-run line', async () => {
    const world = makeWorld();
    const { a } = await heldBuild(world);
    const row = queuedLeftover(world);
    assert.equal(await world.store.removeItem(URL_KEY, row._id), true);
    const wakes = wakesTo(world, a._id);
    assert.equal(wakes.length, 1);
    assert.match(wakes[0].prompt, /^The leftover step did not run \(its row was cancelled\)\./);
    assert.ok(wakes[0].prompt.includes(`Outcome: ${DONE}`));
    // A second cancel finds nothing; a re-reported build [done] adds no second wake.
    assert.equal(await world.store.removeItem(URL_KEY, row._id), false);
    const b = world.historyCollection._docs.find(d => d.kind === 'implementation');
    await post(world, b, DONE);
    assert.equal(wakesTo(world, a._id).length, 1, 'after a cancel release, a re-report adds no wake');
    assert.equal(leftovers(world).length, 1, 'and queues no second leftover');
  });

  test('expiry via cleanup(): exactly one wake, the build outcome and the did-not-run line', async () => {
    const world = makeWorld();
    const { a } = await heldBuild(world);
    queuedLeftover(world).expiresAt = new Date(Date.now() - 1000);
    await world.store.cleanup();
    const wakes = wakesTo(world, a._id);
    assert.equal(wakes.length, 1);
    assert.match(wakes[0].prompt, /^The leftover step did not run \(its row was expired\)\./);
    await world.store.cleanup();
    assert.equal(wakesTo(world, a._id).length, 1, 'once');
  });

  test('a re-reported build [done] while the row is queued adds no wake; the row\'s later [done] wakes once', async () => {
    const world = makeWorld();
    const { a, b } = await heldBuild(world);
    await post(world, b, DONE);
    assert.equal(wakesTo(world, a._id).length, 0);
    assert.equal(leftovers(world).length, 1, 'no second leftover row');
    const l = await takeLeftover(world);
    await post(world, l, `[done] ${LEFTOVERS_HEADING}: nothing`);
    assert.equal(wakesTo(world, a._id).length, 1);
    await post(world, b, DONE);
    assert.equal(wakesTo(world, a._id).length, 1, 'a re-report after the leftover answered adds nothing');
  });

  test('cancel and expiry under a stopped parent mint nothing', async () => {
    for (const end of ['cancel', 'expire']) {
      const world = makeWorld();
      const { a } = await heldBuild(world);
      // A pending abort row targeting the run: the run is stopped (isRunStopped (a)).
      await world.store.addItem(URL_KEY, { abort: true, abortTo: a._id, target: 'cli' });
      const row = queuedLeftover(world);
      const { lines } = await captureLogs(async () => {
        if (end === 'cancel') await world.store.removeItem(URL_KEY, row._id);
        else { row.expiresAt = new Date(Date.now() - 1000); await world.store.cleanup(); }
      });
      assert.equal(wakesTo(world, a._id).length, 0, `${end}: nothing minted`);
      assert.ok(lines.some(l => l.includes('parent-stopped')), `${end}: the stopped-parent gate decided; ${JSON.stringify(lines)}`);
    }
  });

  test("the stopped run's [aborted] cancels its queued leftover row, and the release mints nothing", async () => {
    const world = makeWorld();
    const { a } = await heldBuild(world);
    const abort = await world.store.addItem(URL_KEY, { abort: true, abortTo: a._id, target: 'cli' });
    await world.store.takeItem(abort._id, URL_KEY, TOKEN);
    await world.store.addFeedback(abort._id, URL_KEY, { message: '[aborted] Cancelled running session.' }, TOKEN);
    const row = leftovers(world)[0];
    assert.equal(world.collection._docs.some(d => d._id === row._id), false, 'no longer queued');
    assert.equal(world.historyCollection._docs.find(d => d._id === row._id).status, 'cancelled');
    assert.equal(wakesTo(world, a._id).length, 0);
  });

  test('a transient provisioner failure at release still enqueues the wake, credentialless', async () => {
    const world = makeWorld();
    const calls = [];
    world.store.setWakeCredentialProvisionerFactory((args) => {
      calls.push(args);
      return async () => ({ reason: 'grant-mint-transient:OWNER_CHECK_UNAVAILABLE' });
    });
    const { a, b } = await heldBuild(world);
    const { lines } = await captureLogs(() => world.store.removeItem(URL_KEY, queuedLeftover(world)._id));
    const wakes = wakesTo(world, a._id);
    assert.equal(wakes.length, 1);
    assert.strictEqual(wakes[0].bootstrapToken, null);
    // LIN-4468: the producing build's id rides along, so the wake takes the resumed parent's stage.
    assert.deepEqual(calls, [{ urlKey: URL_KEY, createdBy: OWNER, itemId: b._id }], "keyed on the root's dispatchedBy");
    assert.ok(lines.some(l => l.includes('[dispatch-wake] no-retry-degraded')), JSON.stringify(lines));
  });

  test('no provisioner factory: the release still wakes, and says it degraded', async () => {
    const world = makeWorld();
    const { a } = await heldBuild(world);
    const { lines } = await captureLogs(() => world.store.removeItem(URL_KEY, queuedLeftover(world)._id));
    assert.equal(wakesTo(world, a._id).length, 1);
    assert.ok(lines.some(l => l.includes('[dispatch-wake] no-retry-degraded') && l.includes('no-provisioner')));
  });

  test('a provisioner factory that throws: the degraded release logs under one prefix, [dispatch-wake]', async () => {
    const world = makeWorld();
    world.store.setWakeCredentialProvisionerFactory(() => { throw new Error('factory down'); });
    const { a } = await heldBuild(world);
    const { lines } = await captureLogs(() => world.store.removeItem(URL_KEY, queuedLeftover(world)._id));
    assert.equal(wakesTo(world, a._id).length, 1, 'the release still wakes');
    const degraded = lines.filter(l => l.includes('no-retry-degraded'));
    assert.ok(degraded.some(l => l.includes('provisioner-factory-threw:factory down')), JSON.stringify(lines));
    assert.deepEqual(degraded.filter(l => !l.startsWith('[dispatch-wake] no-retry-degraded')), [], 'no other prefix for the same event');
  });

  test('a release that faults the first time is recovered by a re-reported build [done]: exactly one wake', async () => {
    const world = makeWorld();
    const { a, b } = await heldBuild(world);
    const realDeliver = world.store._deliverWake.bind(world.store);
    let calls = 0;
    world.store._deliverWake = async (...args) => {
      if (calls++ === 0) throw new Error('transient enqueue fault');
      return realDeliver(...args);
    };
    const row = queuedLeftover(world);
    const { result } = await captureLogs(() => world.store.removeItem(URL_KEY, row._id));
    assert.equal(result, true, 'the archive stands');
    assert.equal(wakesTo(world, a._id).length, 0, 'the first release faulted: nothing minted');
    // The build re-reports its [done]: the hook answers hold on an archived (cancelled)
    // leftover, and the hold path re-runs the release.
    await captureLogs(() => post(world, b, DONE));
    const wakes = wakesTo(world, a._id);
    assert.equal(wakes.length, 1, 'the re-report recovers the held wake');
    assert.match(wakes[0].prompt, /^The leftover step did not run \(its row was cancelled\)\./);
    assert.ok(wakes[0].prompt.includes(`Outcome: ${DONE}`));
    await captureLogs(() => post(world, b, DONE));
    assert.equal(wakesTo(world, a._id).length, 1, 'and a further re-report adds none');
    assert.equal(leftovers(world).length, 1, 'no second leftover row');
  });

  test('a release that throws never fails the archive', async () => {
    const world = makeWorld();
    await heldBuild(world);
    world.store.releaseHeldWake = async () => { throw new Error('boom'); };
    const row = queuedLeftover(world);
    const { result } = await captureLogs(() => world.store.removeItem(URL_KEY, row._id));
    assert.equal(result, true);
    assert.equal(world.historyCollection._docs.find(d => d._id === row._id).status, 'cancelled');
  });
});

describe('LIN-4373 — a leftover step that parks on CI and ends on its ci-wake continuation', () => {
  /** The step pushed a tidy and parked; the ci-wake sweep continued it on a custom row, taken. */
  async function parkedLeftover(world) {
    const { a, b } = await heldBuild(world);
    const l = await takeLeftover(world);
    await post(world, l, `[pending] pushed a tidy, waiting on CI for ${PR}`);
    // The ci-wake sweep's row, made the way enqueueFollowUp makes it.
    const c = await createDispatchItem({ store: world.store, urlKey: URL_KEY, prompt: `CI finished on ${PR}`, applyDefaultHarness: false, fields: { followUpTo: l._id, target: 'cli', force: true, dispatchedBy: OWNER } });
    await world.store.takeItem(c._id, URL_KEY, TOKEN);
    assert.equal(world.historyCollection._docs.find(d => d._id === c._id).kind, 'custom');
    return { a, b, l, c };
  }

  test("[pending] in the step's lineage wakes at once, naming the leftover step and the build's [done] and PR; the build wake stays held", async () => {
    const world = makeWorld();
    const { a, b } = await parkedLeftover(world);
    const wakes = wakesTo(world, a._id);
    assert.equal(wakes.length, 1, 'a parked child wakes its parent, as today');
    const prompt = wakes[0].prompt;
    assert.ok(prompt.startsWith('The leftover step is paused [pending]: [pending] pushed a tidy'), prompt);
    assert.ok(prompt.includes(`The build already finished: ${DONE}`), prompt);
    assert.ok(prompt.includes(PR));
    assert.match(prompt, /the build's own wake is still held until the step ends/);
    const edge = world.historyCollection._docs.find(d => d._id === b._id);
    assert.ok(!(edge.terminalWakeItems || []).includes(b._id), "the build's guard key is still not burned");
  });

  for (const [marker, message, expected] of [
    ['failed', '[failed] my tidy broke CI on the branch', /^The leftover step ended \[failed\]: \[failed\] my tidy broke CI/],
    ['blocked', '[blocked] CI needs a secret I cannot set', /^The leftover step ended blocked: \[blocked\] CI needs a secret/],
    ['aborted', '[aborted] Cancelled running session.', /^The leftover step ended \[aborted\]: \[aborted\] Cancelled running session/]
  ]) {
    test(`[${marker}] on the continuation row wakes once with the BUILD's [done] outcome and PR, and the ${marker} line`, async () => {
      const world = makeWorld();
      const { a, c } = await parkedLeftover(world);
      const before = wakesTo(world, a._id).length;
      await post(world, c, message);
      const wakes = wakesTo(world, a._id);
      assert.equal(wakes.length, before + 1);
      const prompt = wakes[wakes.length - 1].prompt;
      assert.match(prompt, expected);
      assert.ok(prompt.includes(`Outcome: ${DONE}`), `the build's outcome, not the continuation's: ${prompt}`);
      assert.ok(prompt.includes(PR));
      await post(world, c, message);
      assert.equal(wakesTo(world, a._id).length, before + 1, 'a re-report adds nothing');
      assert.equal(leftovers(world).length, 1, 'and asks nothing again');
    });
  }

  test('[done] on the continuation row wakes once as itself', async () => {
    const world = makeWorld();
    const { a, c } = await parkedLeftover(world);
    const before = wakesTo(world, a._id).length;
    await post(world, c, `[done] ${LEFTOVERS_HEADING}: tidied one copy. ${PR} head abc1234`);
    const wakes = wakesTo(world, a._id);
    assert.equal(wakes.length, before + 1);
    assert.match(wakes[wakes.length - 1].prompt, /Outcome: \[done\] ### Leftovers: tidied one copy/);
    assert.doesNotMatch(wakes[wakes.length - 1].prompt, /leftover step (ended|did not run|is paused)/);
    assert.equal(leftovers(world).length, 1);
  });

  test("a build's own ci-wake continuation (no leftover in its lineage) wakes exactly as today", async () => {
    const world = makeWorld();
    const a = await run(world);
    const b = await build(world, a._id);
    await post(world, b, `[pending] waiting on CI for ${PR}`);
    assert.doesNotMatch(wakesTo(world, a._id)[0].prompt, /leftover step/, 'a build pause is not labelled');
    const c = await createDispatchItem({ store: world.store, urlKey: URL_KEY, prompt: `CI finished on ${PR}`, applyDefaultHarness: false, fields: { followUpTo: b._id, target: 'cli', force: true, dispatchedBy: OWNER } });
    await world.store.takeItem(c._id, URL_KEY, TOKEN);
    await post(world, c, '[failed] CI red on the build');
    const wakes = wakesTo(world, a._id);
    assert.equal(wakes.length, 2);
    assert.match(wakes[1].prompt, /Outcome: \[failed\] CI red on the build/);
    assert.doesNotMatch(wakes[1].prompt, /leftover step/);
    assert.equal(leftovers(world).length, 0);
  });

  test('a fix round after the finished leftover is not leftover lineage: its continuation [failed] wakes as itself', async () => {
    // The walk up from a continuation crosses only `custom` rows. An `implementation` fix
    // round sitting between the continuation and the (finished) leftover stops it, so a real
    // fix-round failure is never hidden behind the earlier build's [done].
    const world = makeWorld();
    const { a } = await heldBuild(world);
    const l = await takeLeftover(world);
    await post(world, l, `[done] ${LEFTOVERS_HEADING}: nothing. ${PR}`);
    const fix = await world.store.addItem(URL_KEY, {
      prompt: 'fix', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
      target: 'cli', dispatchedBy: OWNER, followUpTo: l._id, subscription: 'terminal-only', sessionId: a._id
    });
    await world.store.takeItem(fix._id, URL_KEY, TOKEN);
    await post(world, fix, `[pending] waiting on CI ${PR}`);
    const c = await createDispatchItem({ store: world.store, urlKey: URL_KEY, prompt: `CI finished on ${PR}`, applyDefaultHarness: false, fields: { followUpTo: fix._id, target: 'cli', force: true, dispatchedBy: OWNER } });
    await world.store.takeItem(c._id, URL_KEY, TOKEN);
    await post(world, c, '[failed] fix round CI red');
    const wakes = wakesTo(world, a._id);
    const prompt = wakes[wakes.length - 1].prompt;
    assert.ok(prompt.includes('Outcome: [failed] fix round CI red'), prompt);
    assert.doesNotMatch(prompt, /leftover step/);
  });
});

describe('LIN-4373 — every fallback wakes the parent exactly as today', () => {
  async function fallback(world, opts = {}) {
    const a = await run(world);
    const b = await build(world, a._id);
    const { lines } = await captureLogs(() => post(world, b, DONE, 'hook' in opts ? { hook: opts.hook ?? false } : {}));
    return { a, b, lines };
  }

  test('not eligible (no PR in the lineage): one wake, no leftover row, a skip line', async () => {
    const world = makeWorld();
    const a = await run(world);
    const b = await build(world, a._id);
    await post(world, b, '[done] built, no PR');
    assert.equal(wakesTo(world, a._id).length, 1);
    assert.equal(leftovers(world).length, 0);
    assert.ok(world.logs.some(l => l === `[leftover] skipped reason=no-pr-url item=${b._id}`), JSON.stringify(world.logs));
  });

  test('owner refusal: one wake, no leftover row', async () => {
    const world = makeWorld({ ownerStatus: 'not-owner' });
    const { a } = await fallback(world);
    assert.equal(wakesTo(world, a._id).length, 1);
    assert.equal(leftovers(world).length, 0);
    assert.ok(world.logs.some(l => /\[leftover\] skipped reason=enqueue-422:RUNNER_OWNER_ONLY/.test(l)), JSON.stringify(world.logs));
  });

  test('a non-200 enqueue: one wake', async () => {
    const world = makeWorld({ enqueue: async () => ({ status: 503, body: { code: 'OWNER_CHECK_UNAVAILABLE' } }) });
    const { a } = await fallback(world);
    assert.equal(wakesTo(world, a._id).length, 1);
    assert.ok(world.logs.some(l => /reason=enqueue-503:OWNER_CHECK_UNAVAILABLE/.test(l)));
  });

  test('a hook that throws: one wake', async () => {
    const world = makeWorld();
    const { a, lines } = await fallback(world, { hook: async () => { throw new Error('boom'); } });
    assert.equal(wakesTo(world, a._id).length, 1);
    assert.ok(lines.some(l => l.includes('[held-wake] hook-threw')));
  });

  test('a hook that throws after its enqueue succeeded: the wake still goes', async () => {
    const world = makeWorld();
    const { a } = await fallback(world, { hook: async (ctx) => { await world.hook(ctx); throw new Error('after the claim'); } });
    assert.equal(wakesTo(world, a._id).length, 1, 'a throw is a fallback whatever the hook did first');
  });

  test('a hook answering anything but withhold: one wake', async () => {
    const world = makeWorld();
    const { a } = await fallback(world, { hook: async () => ({ outcome: 'queue' }) });
    assert.equal(wakesTo(world, a._id).length, 1);
  });

  test('no hook at all (every caller before LIN-4373): one wake', async () => {
    const world = makeWorld();
    const { a } = await fallback(world, { hook: null });
    assert.equal(wakesTo(world, a._id).length, 1);
  });
});

describe('LIN-4373 — heldWakeFor survives every archive hop, and no body sets it', () => {
  test('take, cancel and expiry each keep heldWakeFor on the history row', async () => {
    for (const end of ['take', 'cancel', 'expire']) {
      const world = makeWorld();
      const { b } = await heldBuild(world);
      const row = queuedLeftover(world);
      if (end === 'take') await world.store.takeItem(row._id, URL_KEY, TOKEN);
      else if (end === 'cancel') await captureLogs(() => world.store.removeItem(URL_KEY, row._id));
      else { row.expiresAt = new Date(Date.now() - 1000); await captureLogs(() => world.store.cleanup()); }
      const archived = world.historyCollection._docs.find(d => d._id === row._id);
      assert.equal(archived.heldWakeFor, b._id, `${end}: heldWakeFor survives`);
    }
  });

  test('other rows keep their key set: no heldWakeFor key', async () => {
    const world = makeWorld();
    const a = await run(world);
    assert.equal('heldWakeFor' in world.historyCollection._docs.find(d => d._id === a._id), false);
  });

  test('createDispatchItem strips heldWakeFor from fields (the /dispatch body path) and accepts only its parameter', async () => {
    const world = makeWorld();
    const fromBody = await createDispatchItem({ store: world.store, urlKey: URL_KEY, prompt: 'x', fields: { promptName: 'Prompt', heldWakeFor: 'forged' } });
    assert.equal('heldWakeFor' in world.collection._docs.find(d => d._id === fromBody._id), false);
    const fromParam = await createDispatchItem({ store: world.store, urlKey: URL_KEY, prompt: 'x', fields: { promptName: 'Prompt' }, heldWakeFor: 'b-1' });
    assert.equal(world.collection._docs.find(d => d._id === fromParam._id).heldWakeFor, 'b-1');
  });
});

// ─── Witness point 2: the wrong runs asked, or the right ones missed ────────

describe('LIN-4373 — eligibility, store-level', () => {
  test('queues for a build whose [done] lands on a ci-wake custom follow-up row; that row\'s leftover [done] wakes the run', async () => {
    const world = makeWorld();
    const a = await run(world);
    const b = await build(world, a._id);
    await post(world, b, `[pending] waiting on CI for ${PR}`);
    const pausesBefore = wakesTo(world, a._id).length;
    // The ci-wake sweep's row, made the way enqueueFollowUp makes it (createDispatchItem inherits the ticket).
    const c = await createDispatchItem({ store: world.store, urlKey: URL_KEY, prompt: `CI finished on ${PR}`, applyDefaultHarness: false, fields: { followUpTo: b._id, target: 'cli', force: true, dispatchedBy: OWNER } });
    await world.store.takeItem(c._id, URL_KEY, TOKEN);
    assert.equal(world.historyCollection._docs.find(d => d._id === c._id).kind, 'custom');
    await post(world, c, '[done] CI green, ready for review');
    const [row] = leftovers(world);
    assert.ok(row, JSON.stringify(world.logs));
    assert.equal(row.heldWakeFor, c._id);
    assert.equal(wakesTo(world, a._id).length, pausesBefore, 'the terminal wake is held');
    const l = await takeLeftover(world);
    await post(world, l, `[done] ${LEFTOVERS_HEADING}: nothing`);
    assert.equal(wakesTo(world, a._id).length, pausesBefore + 1);
  });

  test('queues for a build a person dispatched (no run): the leftover row runs, no wake is owed', async () => {
    const world = makeWorld();
    const b = await build(world, null);
    await post(world, b, DONE);
    assert.equal(leftovers(world).length, 1);
    const l = await takeLeftover(world);
    await post(world, l, `[done] ${LEFTOVERS_HEADING}: nothing`);
    assert.equal(all(world).filter(d => d.kind === 'wake').length, 0);
  });

  test('a fix round on a ticket that already has a leftover row (queued, or in history) is not asked', async () => {
    for (const where of ['queued', 'history']) {
      const world = makeWorld();
      const { a } = await heldBuild(world);
      if (where === 'history') {
        const l = await takeLeftover(world);
        await post(world, l, `[done] ${LEFTOVERS_HEADING}: nothing`);
      }
      const fix = await build(world, a._id);
      const before = wakesTo(world, a._id).length;
      await post(world, fix, DONE);
      assert.equal(leftovers(world).length, 1, `${where}: no second leftover`);
      assert.equal(wakesTo(world, a._id).length, before + 1, `${where}: the fix round wakes as today`);
      assert.ok(world.logs.some(l => l === `[leftover] skipped reason=ticket-already-asked item=${fix._id}`));
    }
  });

  test('pause, then stop: not asked, woken as today (stop: the gate suppresses it)', async () => {
    for (const mode of ['pause', 'stop']) {
      const world = makeWorld({ halt: { mode } });
      const a = await run(world);
      const b = await build(world, a._id);
      await post(world, b, DONE);
      assert.equal(leftovers(world).length, 0, mode);
      assert.ok(world.logs.some(l => l.includes(`reason=workspace-halted:${mode}`)), mode);
    }
  });

  test("a leftover row's own [done] is not asked again", async () => {
    const world = makeWorld();
    await heldBuild(world);
    const l = await takeLeftover(world);
    await post(world, l, `[done] ${LEFTOVERS_HEADING}: nothing`);
    assert.equal(leftovers(world).length, 1);
    assert.ok(world.logs.some(x => x === `[leftover] skipped reason=leftover-row item=${l._id}`));
  });
});

describe('LIN-4373 — eligibility, the pure decision', () => {
  const done = { message: DONE };
  const root = { _id: 'b', kind: 'implementation', promptName: 'implementation', target: 'cli', issueIdentifier: 'LIN-7', sessionId: 'a', feedback: [done] };
  const decide = (over = {}) => decideLeftover({ doc: root, entry: done, chain: [root], leftoverRows: [], ...over });

  test('queues an eligible stage build, naming the PR', () => {
    const d = decide();
    assert.equal(d.outcome, 'queue');
    assert.equal(d.prUrl, PR);
  });

  for (const [name, over, reason] of [
    ['a worker lane (its kickoff is a custom prompt)', { chain: [{ ...root, kind: 'custom', promptName: 'Worker lane' }], doc: { ...root, kind: 'custom', promptName: 'Worker lane' } }, 'root-not-a-stage-build'],
    ['an implementation-kind row whose prompt is not the stage', { chain: [{ ...root, promptName: 'Hand-written build' }], doc: { ...root, promptName: 'Hand-written build' } }, 'root-not-a-stage-build'],
    ['a periodical implementation row', { chain: [{ ...root, periodicalId: 'p1' }], doc: { ...root, periodicalId: 'p1' } }, 'root-not-a-stage-build'],
    ['a ticket with a leftover row already (another producing row)', { leftoverRows: [{ _id: 'l0', heldWakeFor: 'older', status: 'taken' }] }, 'ticket-already-asked'],
    ['no PR URL', { entry: { message: '[done] built' }, doc: { ...root, feedback: [{ message: '[done] built' }] }, chain: [{ ...root, feedback: [{ message: '[done] built' }] }] }, 'no-pr-url'],
    ['a dash target', { doc: { ...root, target: 'dash' }, chain: [{ ...root, target: 'dash' }] }, 'target-not-resumable'],
    ['a local target', { doc: { ...root, target: 'local' }, chain: [{ ...root, target: 'local' }] }, 'target-not-resumable'],
    ['a [failed] build', { entry: { message: '[failed] tests red' } }, 'not-a-done-terminal'],
    ['a paused workspace', { halt: { mode: 'pause' } }, 'workspace-halted:pause'],
    ['a stopped workspace', { halt: { mode: 'stop' } }, 'workspace-halted:stop'],
    ['a stopped parent run', { parentStopped: true }, 'parent-run-stopped'],
    ["a leftover row's own [done]", { doc: { ...root, kind: 'leftover', followUpTo: 'b0' } }, 'leftover-row'],
    ["a subscription:'none' follow-up", { doc: { ...root, kind: 'custom', followUpTo: 'b', subscription: 'none' }, chain: [{ ...root, kind: 'custom', followUpTo: 'b', subscription: 'none' }, root] }, 'question-only-follow-up'],
    ['a ticketless row', { doc: { ...root, issueIdentifier: null } }, 'no-ticket'],
    ['a parent already woken for this row', { alreadyWoken: true }, 'parent-already-woken']
  ]) {
    test(`not eligible: ${name}`, () => {
      assert.deepEqual(decide(over), { outcome: 'not-eligible', reason });
    });
  }

  test('hold: a leftover row for this producing row; release only when it never ran', () => {
    for (const status of ['queued', 'taken']) {
      assert.deepEqual(decide({ leftoverRows: [{ _id: 'l', heldWakeFor: 'b', status }] }), { outcome: 'hold', reason: `leftover-exists status=${status}`, release: null });
    }
    for (const status of ['cancelled', 'expired']) {
      const own = { _id: 'l', heldWakeFor: 'b', status };
      assert.equal(decide({ leftoverRows: [own] }).release, own);
    }
  });

  test('a ci-wake custom row resolves to its build root', () => {
    const custom = { _id: 'c', kind: 'custom', followUpTo: 'b', target: 'cli', issueIdentifier: 'LIN-7' };
    assert.equal(decideLeftover({ doc: custom, entry: { message: '[done] green' }, chain: [custom, { ...root, feedback: [{ message: DONE }] }] }).outcome, 'queue');
  });

  test('isStageBuild accepts the display name too', () => {
    assert.equal(isStageBuild({ kind: 'implementation', promptName: 'Implementation' }), true);
  });
});

// ─── Route-level: each entrance queues a leftover ───────────────────────────

async function callApp(app, path, body, bearer) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-4373 — route-level: a build [done] through each entrance queues a leftover', () => {
  test('routes/dispatch.js (dispatch-token feedback): the workspace is resolved, the origin is the request\'s', async () => {
    const world = makeWorld();
    const resolved = [];
    const step = createLeftoverStep({
      dispatchStore: world.store,
      ownerCheck: async () => ({ status: 'owner' }),
      resolveWorkspaceId: workspaceIdResolverFrom({ reset() {}, resolve: async (urlKey, opts) => { resolved.push({ urlKey, ...opts }); return { workspaceId: WORKSPACE }; } }),
      log: (line) => world.logs.push(line)
    });
    const a = await run(world);
    const b = await world.store.addItem(URL_KEY, { prompt: 'build', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7', sessionId: a._id, dispatchedBy: OWNER });
    await world.store.takeItem(b._id, URL_KEY, 'harbour');
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: world.store,
      dispatchTokenStore: {},
      workspaceFromUrl: (req, res, next) => next(),
      userPreferencesStore: {},
      harbourFeedbackTokenStore: { validateAndConsume: async () => ({ urlKey: URL_KEY }) },
      proxyTokenStore: null,
      leftoverStep: step
    }));
    const res = await callApp(app, `/api/dispatch/feedback/${b._id}`, { message: DONE }, 'harbour-feedback-token');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(leftovers(world).length, 1, JSON.stringify(world.logs));
    assert.deepEqual(resolved, [{ urlKey: URL_KEY, dispatchedBy: OWNER }]);
    assert.deepEqual(wakesTo(world, a._id), []);
  });

  test('routes/proxy-runner.js (runner feedback): the token\'s own workspace id is used', async () => {
    const world = makeWorld();
    const owners = [];
    const step = createLeftoverStep({
      dispatchStore: world.store,
      ownerCheck: async (args) => { owners.push(args.workspaceId); return { status: 'owner' }; },
      resolveWorkspaceId: async () => { throw new Error('not used at the runner entrance'); },
      log: (line) => world.logs.push(line)
    });
    const a = await run(world);
    const b = await world.store.addItem(URL_KEY, { prompt: 'build', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7', sessionId: a._id, dispatchedBy: OWNER });
    await world.store.takeItem(b._id, URL_KEY, 'runner', 'runner-token-1');
    const app = express();
    app.use(express.json());
    app.use(createProxyRunnerRoutes({
      proxyLimiter: (req, res, next) => next(),
      authenticateProxyToken: (req, res, next) => {
        req.proxyUrlKey = URL_KEY; req.proxyTokenLabel = 'runner'; req.proxyTokenId = 'runner-token-1';
        req.proxyCreatedBy = OWNER; req.proxyWorkspaceId = WORKSPACE; next();
      },
      requireGrant: () => (req, res, next) => next(),
      logEvent: () => {},
      dispatchQueueStore: world.store,
      dispatchTokenStore: {},
      proxyTokenStore: null,
      workspaceHaltStore: {},
      leftoverStep: step
    }));
    const res = await callApp(app, `/api/proxy/runner/feedback/${b._id}`, { message: DONE }, 'x');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(leftovers(world).length, 1, JSON.stringify(world.logs));
    assert.deepEqual(owners, [WORKSPACE]);
    assert.deepEqual(wakesTo(world, a._id), []);
  });
});

// ─── Cost witness ────────────────────────────────────────────────────────────

describe('LIN-4373 — the leftover step shows its own cost', () => {
  test('/cost over a lineage with a leftover follow-up: a dispatches[] entry of kind leftover with its own costUsd', async () => {
    const world = makeWorld();
    const { b } = await heldBuild(world);
    const l = await takeLeftover(world);
    const rows = world.historyCollection._docs
      .filter(d => d.rootItemId === b.rootItemId)
      .map(d => ({ ...d, id: d._id, dispatchedAt: d.dispatchedAt.toISOString() }));
    const at = (row, ms) => new Date(new Date(row.dispatchedAt).getTime() + ms).toISOString();
    const record = (itemId, requestId, when, costUsd) => ({
      rootItemId: b.rootItemId, itemId, requestId, at: when, updatedAt: when, harness: 'claude-code', model: 'claude-opus-5-5',
      effort: 'high', inputTokens: 1000, outputTokens: 100, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0, costUsd
    });
    const bRow = rows.find(r => r._id === b._id);
    const lRow = rows.find(r => r._id === l._id);
    const result = readCostOverRecords({ perDispatch: true, fetchedRows: rows }, [
      record(b._id, 'q1', at(bRow, 1000), 1.0),
      record(l._id, 'q2', at(lRow, 1000), 0.25)
    ]);
    const session = result.workerSessions.find(s => s.rootItemId === b.rootItemId);
    const entry = session.dispatches.find(d => d.kind === 'leftover');
    assert.ok(entry, JSON.stringify(session.dispatches));
    assert.equal(entry.itemId, l._id);
    assert.equal(entry.followUpTo, b._id);
    assert.ok(Math.abs(entry.costUsd - 0.25) < 1e-9, `its own cost: ${entry.costUsd}`);
  });
});

describe('LIN-4373 — the leftover prompt', () => {
  test('asks one question, names the PR, the notes, the heading and what the parent reads', () => {
    const prompt = leftoverPrompt({ issueIdentifier: 'LIN-7', prUrl: PR });
    for (const needle of [PR, 'docs/areas/README.md', LEFTOVERS_HEADING, '## Waiting', '## Lessons', 'File nothing yourself', 'head SHA', '"Nothing" is a valid answer']) {
      assert.ok(prompt.includes(needle), `missing ${needle}`);
    }
  });
});
