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
import { createRunParagraphPrecompute, resolvePrecomputeApiKey } from '../../lib/run-paragraph-hook.js';
import { InMemoryRunParagraphStore } from '../../lib/run-paragraph-store.js';
import { buildRunView } from '../../lib/run-view.js';

const URL_KEY = 'ws-hook';
const RUN_ID = 'run-1';

/** A minimal reconstructed session whose loops drive `buildRunView`. */
function makeSession({ sessionId = RUN_ID, steps = [] } = {}) {
  return {
    sessionId,
    seedIssue: 'LIN-1',
    dispatchedAt: '2026-10-02T10:00:00.000Z',
    completedAt: null,
    loops: steps.map((s, i) => ({
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

describe('resolvePrecomputeApiKey (the shared offline guard)', () => {
  test('returns null under NODE_ENV=test (tests stay offline)', () => {
    assert.equal(resolvePrecomputeApiKey({ NODE_ENV: 'test', OPENROUTER_API_KEY: 'k' }), null);
  });

  test('returns null when no key is configured', () => {
    assert.equal(resolvePrecomputeApiKey({}), null);
  });

  test('prefers the primary key, falls back to the free-tier key', () => {
    assert.equal(resolvePrecomputeApiKey({ OPENROUTER_API_KEY: 'primary' }), 'primary');
    assert.equal(resolvePrecomputeApiKey({ OPENROUTER_FREE_TIER_KEY: 'free' }), 'free');
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
