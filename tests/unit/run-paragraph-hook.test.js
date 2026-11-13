/**
 * Unit tests for lib/run-paragraph-hook.js (LIN-3253, S3 of LIN-2948).
 *
 * Run with: node --test tests/unit/run-paragraph-hook.test.js
 *
 * Fully offline: the generator is stubbed. These tests pin the trigger contract
 * the materializer hook carries into server.js — unchanged input makes ZERO
 * generator calls, a new finished step makes exactly ONE, a step starting or a
 * wait-for-answer toggling makes ZERO (the gate is ended steps only), a session
 * turning terminal stamps `final: true`, and the shared offline/no-key guard
 * skips the call entirely.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createRunParagraphPrecompute as createRunParagraphPrecompute__unplumbed, resolvePrecomputeCredential } from '../../lib/run-paragraph-hook.js';
import { InMemoryRunParagraphStore } from '../../lib/run-paragraph-store.js';
import { buildRunView as buildRunView__unplumbed } from '../../lib/run-view.js';
import { NO_REQUEST_RECORDS, withDefaults } from '../fixtures/request-usage-loader.js';
import { buildRunViewOf } from '../fixtures/cost-read-cores.js';
import { inputHash } from '../../lib/run-paragraph.js';
import { seedPinnedCatalog } from './helpers/pinned-catalog.js';
// LIN-4201: these tests read snapshot-only lineages, so they pass "no request records" explicitly (plumbing only).
const createRunParagraphPrecompute = withDefaults(createRunParagraphPrecompute__unplumbed, 0, { requestUsageLoader: NO_REQUEST_RECORDS });
const buildRunView = buildRunViewOf;


const URL_KEY = 'ws-hook';
const RUN_ID = 'run-1';

/** A minimal reconstructed session whose loops drive `buildRunView`. */
function makeSession({ sessionId = RUN_ID, steps = [], loops } = {}) {
  return {
    sessionId,
    seedIssue: 'LIN-1',
    dispatchedAt: '2026-10-02T10:00:00.000Z',
    completedAt: null,
    loops: loops || steps.map((s, i) => ({
      loopId: `${sessionId}-l${i}`,
      lineageId: `${sessionId}-l${i}`,
      kind: s.kind,
      terminalStatus: s.terminalStatus ?? null,
      iteration: 1,
      telemetry: {},
      feedback: s.feedback ?? []
    }))
  };
}

/** One lineage: a failed loop, then a follow-up re-dispatch of the same step. */
function followUpLineage(terminalStatus = null) {
  const lineageId = `${RUN_ID}-lineage-impl`;
  return [
    {
      loopId: `${RUN_ID}-l0`,
      lineageId,
      kind: 'implementation',
      terminalStatus: 'failed',
      iteration: 1,
      telemetry: {},
      feedback: []
    },
    {
      loopId: `${RUN_ID}-l1`,
      lineageId,
      kind: 'implementation',
      terminalStatus,
      followUpTo: `${RUN_ID}-l0`,
      iteration: 2,
      telemetry: {},
      feedback: []
    }
  ];
}

function makeRig({ isTerminal = () => false, generateParagraph } = {}) {
  const store = new InMemoryRunParagraphStore();
  const calls = [];
  const hook = createRunParagraphPrecompute({
    runParagraphStore: store,
    generateParagraph:
      generateParagraph ||
      (async (runView, opts) => {
        calls.push({ runView, opts });
        return { paragraph: 'generated paragraph', model: 'small-tier' };
      }),
    buildView: buildRunView,
    isTerminal,
    logger: { error() {} }
  });
  return { store, calls, hook };
}

describe('resolvePrecomputeCredential (the shared offline guard)', () => {
  test('LIN-3664: a whitespace free-tier key is no key; a padded one is trimmed', () => {
    assert.equal(resolvePrecomputeCredential({ OPENROUTER_FREE_TIER_KEY: '   ' }), null);
    assert.deepEqual(resolvePrecomputeCredential({ OPENROUTER_FREE_TIER_KEY: ' free ' }), { apiKey: 'free', isFreeTier: true });
  });

  test('LIN-3664: a whitespace paid key is no key, so it falls through to the free-tier key (as resolveChatCredential does)', () => {
    assert.deepEqual(resolvePrecomputeCredential({ OPENROUTER_API_KEY: '  ', OPENROUTER_FREE_TIER_KEY: 'free' }), { apiKey: 'free', isFreeTier: true });
    assert.equal(resolvePrecomputeCredential({ OPENROUTER_API_KEY: '  ' }), null);
  });

  test('returns null under NODE_ENV=test (tests stay offline)', () => {
    assert.equal(resolvePrecomputeCredential({ NODE_ENV: 'test', OPENROUTER_API_KEY: 'k' }), null);
  });

  test('returns null when no key is configured', () => {
    assert.equal(resolvePrecomputeCredential({}), null);
  });

  test('prefers the primary key, falls back to the free-tier key', () => {
    assert.deepEqual(resolvePrecomputeCredential({ OPENROUTER_API_KEY: 'primary' }), { apiKey: 'primary', isFreeTier: false });
    assert.deepEqual(resolvePrecomputeCredential({ OPENROUTER_FREE_TIER_KEY: 'free' }), { apiKey: 'free', isFreeTier: true });
    // The paid key wins and is not the free tier, even with the free key also set.
    assert.deepEqual(resolvePrecomputeCredential({ OPENROUTER_API_KEY: 'primary', OPENROUTER_FREE_TIER_KEY: 'free' }), { apiKey: 'primary', isFreeTier: false });
  });
});

describe('run-paragraph precompute', () => {
  test('a second materialization with unchanged input makes ZERO generator calls', async () => {
    const { store, calls, hook } = makeRig();
    const session = makeSession({ steps: [{ kind: 'plan', terminalStatus: 'done' }] });

    await hook(URL_KEY, session, { apiKey: 'k' });
    await hook(URL_KEY, session, { apiKey: 'k' });

    assert.equal(calls.length, 1, 'the second call is an inputHash hit');
    const doc = await store.get(URL_KEY, RUN_ID);
    assert.ok(doc, 'the paragraph was stored');
    assert.equal(doc.inputHash.length > 0, true);
    assert.equal(calls[0].runView.steps.length, 1, 'the generator received the real run view');
  });

  test('adding one new finished step makes exactly ONE more generator call', async () => {
    const { calls, hook } = makeRig();
    await hook(URL_KEY, makeSession({ steps: [{ kind: 'plan', terminalStatus: 'done' }] }), { apiKey: 'k' });
    assert.equal(calls.length, 1);

    await hook(
      URL_KEY,
      makeSession({
        steps: [
          { kind: 'plan', terminalStatus: 'done' },
          { kind: 'implementation', terminalStatus: 'done' }
        ]
      }),
      { apiKey: 'k' }
    );
    assert.equal(calls.length, 2, 'the changed finished-step set triggers exactly one regeneration');
  });

  test('a newly started (not ended) step makes ZERO generator calls', async () => {
    const { calls, hook } = makeRig();
    await hook(URL_KEY, makeSession({ steps: [{ kind: 'plan', terminalStatus: 'done' }] }), { apiKey: 'k' });
    assert.equal(calls.length, 1);

    await hook(
      URL_KEY,
      makeSession({
        steps: [
          { kind: 'plan', terminalStatus: 'done' },
          { kind: 'implementation', terminalStatus: null }
        ]
      }),
      { apiKey: 'k' }
    );
    assert.equal(calls.length, 1, 'a step start is not a step end → no regeneration');
  });

  test('a wait-for-answer toggle makes ZERO generator calls', async () => {
    const { calls, hook } = makeRig();
    const running = { kind: 'implementation', terminalStatus: null };

    await hook(
      URL_KEY,
      makeSession({ steps: [{ ...running, feedback: [{ message: '[blocked] need a call' }] }] }),
      { apiKey: 'k' }
    );
    assert.equal(calls.length, 1);

    await hook(URL_KEY, makeSession({ steps: [{ ...running, feedback: [] }] }), { apiKey: 'k' });
    assert.equal(calls.length, 1, 'the waiting toggle is not an ended step → no regeneration');
  });

  test('a follow-up starting on an already-ended step makes ZERO calls, then ending makes exactly ONE', async () => {
    const { calls, hook } = makeRig();

    await hook(URL_KEY, makeSession({ loops: followUpLineage(null).slice(0, 1) }), { apiKey: 'k' });
    assert.equal(calls.length, 1, 'the failed step end triggers one call');

    await hook(URL_KEY, makeSession({ loops: followUpLineage(null) }), { apiKey: 'k' });
    assert.equal(calls.length, 1, 'a follow-up starting on the ended step is a start → no regeneration');

    await hook(URL_KEY, makeSession({ loops: followUpLineage('done') }), { apiKey: 'k' });
    assert.equal(calls.length, 2, 'the follow-up ending is a new ended loop → exactly one regeneration');
  });

  test('a session turning terminal writes final: true (and does not regenerate again)', async () => {
    let terminal = false;
    const { store, calls, hook } = makeRig({ isTerminal: () => terminal });
    const session = makeSession({ steps: [{ kind: 'plan', terminalStatus: 'done' }] });

    await hook(URL_KEY, session, { apiKey: 'k' });
    assert.equal(calls.length, 1);
    assert.equal((await store.get(URL_KEY, RUN_ID)).final, false, 'still running → final false');

    // Same run-view facts, but the session is now terminal: the close-out trigger.
    terminal = true;
    await hook(URL_KEY, session, { apiKey: 'k' });
    assert.equal(calls.length, 2, 'turning terminal triggers exactly one more call');
    assert.equal((await store.get(URL_KEY, RUN_ID)).final, true, 'terminal → final true');

    await hook(URL_KEY, session, { apiKey: 'k' });
    assert.equal(calls.length, 2, 'once final, identical input is a hit again');
  });

  test('the offline/no-key guard skips the generator entirely (zero calls, nothing stored)', async () => {
    const { store, calls, hook } = makeRig();
    const session = makeSession({ steps: [{ kind: 'plan', terminalStatus: 'done' }] });

    await hook(URL_KEY, session, { apiKey: null });
    await hook(URL_KEY, session, {});

    assert.equal(calls.length, 0, 'no key → no generator call');
    assert.equal(await store.get(URL_KEY, RUN_ID), null, 'nothing written');
  });

  test('a generator failure is logged and non-fatal; nothing is written', async () => {
    const errors = [];
    const store = new InMemoryRunParagraphStore();
    const hook = createRunParagraphPrecompute({
      runParagraphStore: store,
      generateParagraph: async () => { throw new Error('boom'); },
      buildView: buildRunView,
      isTerminal: () => false,
      logger: { error: (...args) => errors.push(args.join(' ')) }
    });

    await hook(URL_KEY, makeSession({ steps: [{ kind: 'plan', terminalStatus: 'done' }] }), { apiKey: 'k' });

    assert.equal(errors.length, 1, 'the failure is logged');
    assert.match(errors[0], /boom/);
    assert.equal(await store.get(URL_KEY, RUN_ID), null, 'a failed generation writes nothing');
  });
});

/**
 * LIN-4475 (W-6, the ticket's Waiting 10): a stored `final` paragraph stays a cache hit when only cost, usage or
 * tier change. The gate (lib/run-paragraph.js gateFacts) hashes the title and each ENDED loop's loopId, kind and
 * terminalStatus, and nothing else, so the figures and the tier cannot move it. The positive control is a loop that
 * newly ends, which must regenerate. Each case asserts that the run view really moved (its cost or its tier) and
 * that the gate key did not, so a pass cannot come from a change that never happened.
 */
describe('W-6 (LIN-4475): a stored final paragraph survives cost, usage and tier changes', () => {
  seedPinnedCatalog(); // a record's cost is priced from the pinned catalog (LIN-4358)
  const T0 = '2026-11-02T09:00:00.000Z';
  const LINEAGE = `${RUN_ID}-lineage`;
  const loop = ({ loopId = `${RUN_ID}-l0`, terminalStatus = 'done', model = 'claude-sonnet-5', feedback = [] } = {}) =>
    ({ loopId, lineageId: LINEAGE, kind: 'implementation', terminalStatus, iteration: 1, telemetry: { model }, feedback });
  // A `[usage]` snapshot on the loop: the figures a lineage carries before any request records exist.
  const snapshot = (costUsd) => ({
    kind: 'usage',
    message: `[usage] ${JSON.stringify({ harness: 'claude-code', model: 'claude-sonnet-5', inputTokens: 10, outputTokens: 20, costUsd })}`,
    timestamp: T0
  });
  // One request record of the lineage, in the shape the request-usage loader returns it.
  const record = (requestId, fields = {}) => ({
    rootItemId: LINEAGE, itemId: `${RUN_ID}-l0`, requestId, at: T0, updatedAt: T0,
    harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', inputTokens: 1000, outputTokens: 10, ...fields
  });

  /** The hook rig, with the world's request records and terminal flag set by each case. */
  function witnessRig() {
    const store = new InMemoryRunParagraphStore();
    const calls = [];
    const world = { terminal: true, records: [] };
    const hook = createRunParagraphPrecompute({
      runParagraphStore: store,
      generateParagraph: async () => {
        calls.push(true);
        return { paragraph: `paragraph ${calls.length}`, model: 'small-tier' };
      },
      // The view reads the world's records, so a case moves cost and usage by changing them.
      buildView: (session, opts) => buildRunView(session, { now: opts.now, requestRows: world.records }),
      isTerminal: () => world.terminal,
      logger: { error() {} }
    });
    return { store, calls, hook, world };
  }
  const viewOf = (session, world) => buildRunView(session, { now: new Date(T0), requestRows: world.records });
  const run = (hook, session) => hook(URL_KEY, session, { apiKey: 'k' });

  test('request records: cost and usage go from no figure to a priced total, and the final paragraph is a hit', async () => {
    const { store, calls, hook, world } = witnessRig();
    const session = makeSession({ loops: [loop()] });
    await run(hook, session);
    assert.equal(calls.length, 1, 'the first call regenerates: nothing is stored yet');
    assert.equal((await store.get(URL_KEY, RUN_ID)).final, true, 'terminal, so the stored paragraph is final');

    const before = viewOf(session, world);
    world.records = [record('req-1')];
    const after = viewOf(session, world);
    assert.notDeepEqual(after.cost, before.cost, 'guard: the cost figure moved');
    assert.equal(after.cost.status, 'total', 'guard: the record priced the lineage');
    assert.equal(inputHash(after), inputHash(before), 'the gate key did not move');

    await run(hook, session);
    assert.equal(calls.length, 1, 'cost and usage changed, the ended loops did not: a hit, no generator call');
  });

  test('a tier change (standard to premium, from the lead loop model) leaves the final paragraph a hit', async () => {
    const { store, calls, hook, world } = witnessRig();
    await run(hook, makeSession({ loops: [loop({ model: 'claude-sonnet-5' })] }));
    assert.equal(calls.length, 1);
    assert.equal((await store.get(URL_KEY, RUN_ID)).final, true);

    const before = viewOf(makeSession({ loops: [loop({ model: 'claude-sonnet-5' })] }), world);
    const after = viewOf(makeSession({ loops: [loop({ model: 'claude-opus-5' })] }), world);
    assert.equal(before.steps[0].tier, 'standard', 'guard: the tier before');
    assert.equal(after.steps[0].tier, 'premium', 'guard: the tier moved');
    assert.equal(inputHash(after), inputHash(before), 'the gate key did not move');

    await run(hook, makeSession({ loops: [loop({ model: 'claude-opus-5' })] }));
    assert.equal(calls.length, 1, 'tier changed, the ended loops did not: a hit, no generator call');
  });

  test('a lineage that falls from snapshot figures to no usage stays a hit', async () => {
    const { store, calls, hook, world } = witnessRig();
    const priced = makeSession({ loops: [loop({ feedback: [snapshot(1.5)] })] });
    await run(hook, priced);
    assert.equal(calls.length, 1);
    assert.equal((await store.get(URL_KEY, RUN_ID)).final, true);

    const before = viewOf(priced, world);
    const after = viewOf(makeSession({ loops: [loop()] }), world);
    assert.equal(before.cost.status, 'total', 'guard: the snapshot priced the lineage');
    assert.equal(after.cost.status, 'not-reported', 'guard: no usage now, so the figure is withheld');
    assert.equal(inputHash(after), inputHash(before), 'the gate key did not move');

    await run(hook, makeSession({ loops: [loop()] }));
    assert.equal(calls.length, 1, 'snapshot figures fell to no usage, the ended loops did not: a hit, no generator call');
  });

  test('positive control: a newly ended loop still regenerates the final paragraph', async () => {
    const { store, calls, hook, world } = witnessRig();
    const one = makeSession({ loops: [loop()] });
    await run(hook, one);
    assert.equal(calls.length, 1);

    const two = makeSession({ loops: [loop(), loop({ loopId: `${RUN_ID}-l1`, terminalStatus: 'done' })] });
    assert.notEqual(inputHash(viewOf(two, world)), inputHash(viewOf(one, world)), 'a newly ended loop moves the gate key');
    await run(hook, two);
    assert.equal(calls.length, 2, 'the new ended loop regenerates, so the witness cannot pass by never regenerating');
    assert.equal((await store.get(URL_KEY, RUN_ID)).final, true);
  });
});
