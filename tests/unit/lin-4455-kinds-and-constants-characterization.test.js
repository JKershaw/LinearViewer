/**
 * LIN-4455 (piece 5 of LIN-4447), beat 1: characterization of what the piece must keep.
 *
 * Piece 5 gives each restated constant one declaration and the feedback kinds one table.
 * Before anything moves, these tests pin today's behaviour from OUTSIDE the declarations
 * (literals written here, behaviour read through the public readers), so they keep
 * passing when the hand-written sets become derived and fail if a derivation drifts:
 *
 *   1. `FEEDBACK_ENTRY_KINDS`: exact contents and order, as the runner prompt renders it
 *      (A14's side of the seam: the prompt bytes must not move), and the runner allowlist
 *      does not widen to the two stamp kinds a runner may not post.
 *   2. The skip sets in `lib/session-telemetry.js`: `PARKED_WAIT_SKIPPED_KINDS` (read through
 *      `parseParkedWait`) and `DECISION_LIFECYCLE_STAMP_KINDS` (read through
 *      `parseHeartbeats`), plus the two other stamp copies (`decomposeEffort`,
 *      `isDecisionLifecycleStampEntry`). Each is pinned over every known feedback kind,
 *      an unknown kind and a kind-less entry.
 *   3. `findWakeEvent` has no kind rule: it returns the last wake marker whatever the
 *      entry's kind (Waiting 11's "skip rule" does not exist; piece 5 records that).
 *   4. A release from a store with no held-wake step bound says the holder "did not run"
 *      and its status, then the build's own outcome.
 *   5. Every `HALT_MODES` entry stops a leftover, iterated from the owner so a new mode
 *      is caught (Waiting 2: today the leftover decision spells the modes itself).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { FEEDBACK_ENTRY_KINDS } from '../../lib/dispatch-feedback-kinds.js';
import { validateFeedbackBody } from '../../lib/dispatch-feedback-validation.js';
import { buildRunnerKickoff } from '../../lib/prompts/runner-kickoff.js';
import { parseParkedWait, parseHeartbeats } from '../../lib/session-telemetry.js';
import { decomposeEffort } from '../../lib/wall-clock-summary.js';
import { isDecisionLifecycleStampEntry } from '../../lib/digest-feedback.js';
import { buildRunViewOverRecords } from '../../lib/run-view.js';
import { findWakeEvent } from '../../lib/dispatch-terminal.js';
import { HALT_MODES } from '../../lib/workspace-halt.js';
import { decideLeftover } from '../../lib/dispatch-leftover.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

// ─── The kind universe ───────────────────────────────────────────────────────

/** Today's runner allowlist, in its rendered order. Written out, never read from source. */
const RUNNER_KINDS_LITERAL = [
  'status', 'recap', 'heartbeat', 'evidence', 'assistant-text', 'tool', 'usage', 'resources',
  'refusal', 'decision', 'decision-withdrawn'
];
/** Kinds the store writes itself that a runner may not post (human-only stamps). */
const STORE_ONLY_KINDS = ['decision-answer', 'decision-withdrawal-reversed'];
/** Every feedback-entry kind written anywhere, plus an unknown kind and no kind at all. */
const UNIVERSE = [...RUNNER_KINDS_LITERAL, ...STORE_ONLY_KINDS, 'some-future-kind', undefined];

const STAMP_KINDS = ['decision-answer', 'decision-withdrawn', 'decision-withdrawal-reversed'];
const PARKED_RELAY_KINDS = ['tool', 'usage', 'resources'];

const label = (kind) => (kind === undefined ? '(no kind)' : kind);
const entry = (kind, message, timestamp) => (kind === undefined ? { message, timestamp } : { kind, message, timestamp });

// ─── 1. FEEDBACK_ENTRY_KINDS ─────────────────────────────────────────────────

describe('FEEDBACK_ENTRY_KINDS: contents and order, as the runner prompt renders them', () => {
  test('the store export is exactly the literal, in order', () => {
    assert.deepEqual([...FEEDBACK_ENTRY_KINDS], RUNNER_KINDS_LITERAL);
  });

  test('the runner prompt renders the literal list byte for byte', () => {
    const prompt = buildRunnerKickoff({ baseUrl: 'https://harbour.example' });
    const rendered = '`status`, `recap`, `heartbeat`, `evidence`, `assistant-text`, `tool`, `usage`, '
      + '`resources`, `refusal`, `decision`, `decision-withdrawn`';
    assert.ok(prompt.includes(rendered), 'the runner prompt lists the feedback kinds in today\'s order');
  });

  test('the runner-facing validator accepts each allowlisted kind and drops the store-only stamps', () => {
    for (const kind of RUNNER_KINDS_LITERAL) {
      const message = kind === 'decision-withdrawn' ? JSON.stringify({ decision_id: 'd1', reason: 'r' }) : 'm';
      assert.equal(validateFeedbackBody({ message, kind }).value?.kind, kind, kind);
    }
    for (const kind of [...STORE_ONLY_KINDS, 'some-future-kind']) {
      assert.equal(validateFeedbackBody({ message: 'm', kind }).value.kind, undefined, kind);
    }
  });
});

// ─── 2. The skip sets ────────────────────────────────────────────────────────

describe('the hand-written kind sets, read through their readers', () => {
  test('parseParkedWait walks past exactly the relay kinds and the stamp kinds', () => {
    const skipped = UNIVERSE.filter((kind) => parseParkedWait([
      { kind: 'status', message: 'Scheduled wakeup in 270s', timestamp: '2026-11-13T10:00:00Z' },
      entry(kind, 'a later line', '2026-11-13T10:01:00Z')
    ]) !== null);
    assert.deepEqual(skipped.map(label).sort(), [...PARKED_RELAY_KINDS, ...STAMP_KINDS].sort());
  });

  test('parseHeartbeats drops exactly the stamp kinds and `decision`', () => {
    const dropped = UNIVERSE.filter((kind) =>
      parseHeartbeats([entry(kind, '[working] 6 tools/32s · alive', '2026-11-13T10:00:00Z')]).length === 0);
    assert.deepEqual(dropped.map(label).sort(), ['decision', ...STAMP_KINDS].sort());
  });

  test('decomposeEffort (wall-clock) ignores exactly the stamp kinds for its CI flag', () => {
    const ignored = UNIVERSE.filter((kind) =>
      decomposeEffort({ feedback: [entry(kind, 'ran npm test', '2026-11-13T10:00:00Z')] }).touchedCi === false);
    assert.deepEqual(ignored.map(label).sort(), [...STAMP_KINDS].sort());
  });

  test('the run view\'s waiting clock looks past exactly the stamp kinds to an earlier [blocked]', () => {
    // run-view's stamp set is private: a later [done] carried by a stamp kind is skipped, so
    // the session is still waiting on the earlier [blocked]; any other kind's [done] ends it.
    const skipped = UNIVERSE.filter((kind) => buildRunViewOverRecords({
      loops: [{
        loopId: 'l1', lineageId: 'l1', kind: 'implementation', terminalStatus: null,
        feedback: [
          { kind: 'status', message: '[blocked] waiting on a person', timestamp: '2026-11-13T10:00:00Z' },
          entry(kind, '[done] finished', '2026-11-13T10:01:00Z')
        ]
      }]
    }, { now: '2026-11-13T11:00:00Z', records: [] }).waiting.active);
    assert.deepEqual(skipped.map(label).sort(), [...STAMP_KINDS].sort());
  });

  test('isDecisionLifecycleStampEntry is true for exactly the stamp kinds', () => {
    const stamps = UNIVERSE.filter((kind) => isDecisionLifecycleStampEntry(entry(kind, 'x')));
    assert.deepEqual(stamps.map(label).sort(), [...STAMP_KINDS].sort());
  });
});

// ─── 3. findWakeEvent has no kind rule ───────────────────────────────────────

describe('findWakeEvent returns the last wake marker regardless of entry kind', () => {
  for (const kind of UNIVERSE) {
    test(`a [done] carried by ${label(kind)} is the wake`, () => {
      const last = entry(kind, '[done] finished', '2026-11-13T10:02:00Z');
      const found = findWakeEvent([
        { kind: 'status', message: '[blocked] waiting on a person', timestamp: '2026-11-13T10:00:00Z' },
        last
      ]);
      assert.equal(found?.entry, last);
      assert.equal(found?.marker, 'done');
    });

    test(`a later non-marker ${label(kind)} entry does not hide an earlier marker`, () => {
      const marker = { kind: 'status', message: '[pending] parked on CI', timestamp: '2026-11-13T10:00:00Z' };
      const found = findWakeEvent([marker, entry(kind, 'just a line', '2026-11-13T10:01:00Z')]);
      assert.equal(found?.entry, marker);
      assert.equal(found?.marker, 'pending');
    });
  }
});

// ─── 4. Release wording from a store with no held-wake step bound ───────────

describe('a release from an unbound store says the holder did not run', () => {
  const URL_KEY = 'acme';
  const DONE = '[done] Built LIN-7. PR https://github.com/o/r/pull/12 is green.';

  /**
   * A bare store (no leftover step created, nothing late-bound): a taken run, a taken
   * build that reports to it with its [done] already in history (written directly, so
   * no wake was minted), and a queued row holding the build's wake.
   */
  async function heldWithoutStep() {
    const collection = createMockCollection();
    const historyCollection = createMockCollection();
    const store = new DispatchQueueStore({ collection, historyCollection });
    const runRow = await store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-7', dispatchedBy: 'owner' });
    await store.takeItem(runRow._id, URL_KEY, 'orchestrator');
    const buildRow = await store.addItem(URL_KEY, {
      prompt: 'build it', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
      target: 'cli', dispatchedBy: 'owner', subscription: 'terminal-only', sessionId: runRow._id
    });
    await store.takeItem(buildRow._id, URL_KEY, 'token-a');
    const archived = historyCollection._docs.find((d) => d._id === buildRow._id);
    archived.feedback = [{ message: DONE, timestamp: new Date().toISOString() }];
    const holder = await store.addItem(URL_KEY, { prompt: 'hold', kind: 'custom', issueIdentifier: 'LIN-7', heldWakeFor: buildRow._id });
    const wakesTo = () => [...collection._docs, ...historyCollection._docs].filter((d) => d.kind === 'wake' && d.followUpTo === runRow._id);
    return { store, collection, holder, wakesTo };
  }

  test('cancel (removeItem): one wake, opening "did not run (its row was cancelled)", then the build outcome', async () => {
    const { store, holder, wakesTo } = await heldWithoutStep();
    assert.equal(await store.removeItem(URL_KEY, holder._id), true);
    const wakes = wakesTo();
    assert.equal(wakes.length, 1);
    const firstLine = wakes[0].prompt.split('\n')[0];
    assert.match(firstLine, /did not run \(its row was cancelled\)\. The build's own outcome follows\.$/);
    assert.ok(wakes[0].prompt.includes(`Outcome: ${DONE}`));
  });

  test('expiry (cleanup): one wake, opening "did not run (its row was expired)"', async () => {
    const { store, collection, holder, wakesTo } = await heldWithoutStep();
    collection._docs.find((d) => d._id === holder._id).expiresAt = new Date(Date.now() - 1000);
    await store.cleanup();
    const wakes = wakesTo();
    assert.equal(wakes.length, 1);
    assert.match(wakes[0].prompt.split('\n')[0], /did not run \(its row was expired\)\. The build's own outcome follows\.$/);
  });
});

// ─── 5. Every HALT_MODES entry stops a leftover ─────────────────────────────

describe('every HALT_MODES entry stops a leftover', () => {
  const PR = 'https://github.com/o/r/pull/12';
  const done = { message: `[done] Built LIN-7. PR ${PR} is green.` };
  const root = { _id: 'b', kind: 'implementation', promptName: 'implementation', target: 'cli', issueIdentifier: 'LIN-7', sessionId: 'a', feedback: [done] };
  const decide = (over = {}) => decideLeftover({ doc: root, entry: done, chain: [root], leftoverRows: [], ...over });

  test('the unhalted control queues', () => {
    assert.equal(decide().outcome, 'queue');
  });

  test('HALT_MODES is not empty (the loop below must run)', () => {
    assert.ok(HALT_MODES.length > 0);
  });

  for (const mode of HALT_MODES) {
    test(`halt mode ${mode} is not eligible`, () => {
      assert.deepEqual(decide({ halt: { mode } }), { outcome: 'not-eligible', reason: `workspace-halted:${mode}` });
    });
  }
});
