/**
 * Unit tests for the `[skipped] human-continued` cross-repo contract (LIN-946
 * beat 3, honoring the merged LIN-951 runner side).
 *
 * When a cascade abort hits a human-continued session the runner refuses it and
 * posts "[skipped] human-continued session <id> (<phase>)." instead of
 * "[aborted]". Harbour MUST treat that marker as:
 *   (a) TERMINAL — the abort item is resolved; never retried (Harbour has no
 *       dispatch-retry path, so "no retry" holds by construction);
 *   (b) BENIGN — its own distinct status, NOT equal to `aborted` or `failed`;
 *   (c) NOT a wake event — a skip means nothing ended, so no up-chain wake;
 *   (d) and a cascade emits ordinary UNFORCED aborts, so `force` stays the escape
 *       hatch for a deliberate single targeted abort.
 *
 * These exercise the real seams: the terminal-marker classifier
 * (lib/dispatch-terminal.js), loop reconstruction (_buildLoops), session
 * terminality (routes/dashboard.js sessionIsTerminal), and the store expansion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTerminalStatus,
  findTerminalFeedback,
  deriveCompletedAt,
  isWakeEvent,
  findWakeEvent
} from '../../lib/dispatch-terminal.js';
import { __internal as pipeline } from '../../lib/pipeline-loops.js';
import { sessionIsTerminal } from '../../routes/dashboard.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const SKIPPED_MSG = '[skipped] human-continued session 7b3f2a10 (implementation).';
const skippedFeedback = [{ message: SKIPPED_MSG, timestamp: '2026-07-03T12:00:00.000Z' }];

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

// ── (a)+(b) Marker seam: terminal, benign, distinct from aborted/failed ────────
test('[skipped] is a terminal marker with its own distinct benign status', () => {
  assert.equal(deriveTerminalStatus(skippedFeedback), 'skipped');
  assert.notEqual(deriveTerminalStatus(skippedFeedback), 'aborted'); // not a close
  assert.notEqual(deriveTerminalStatus(skippedFeedback), 'failed');  // not a failure

  const terminal = findTerminalFeedback(skippedFeedback);
  assert.ok(terminal, 'the seam recognizes [skipped] as terminal');
  assert.equal(terminal.status, 'skipped');
  // Terminal ⇒ it HAS a completion time (the abort item is resolved, not pending),
  // so telemetry/completion reads it as ended rather than forever-running.
  assert.equal(deriveCompletedAt(skippedFeedback), '2026-07-03T12:00:00.000Z');
});

// ── (c) Not a wake event: no up-chain wake is bubbled for a skip ──────────────
test('[skipped] is NOT a wake event — it never wakes an up-chain parent', () => {
  assert.equal(isWakeEvent(SKIPPED_MSG), false);
  assert.equal(findWakeEvent(skippedFeedback), null);
});

test('regression guard: [aborted] stays a wake-triggering terminal, distinct from [skipped]', () => {
  const abortedMsg = '[aborted] cancelled by operator';
  const abortedFeedback = [{ message: abortedMsg, timestamp: '2026-07-03T12:00:00.000Z' }];
  assert.equal(deriveTerminalStatus(abortedFeedback), 'aborted');
  assert.equal(isWakeEvent(abortedMsg), true, 'aborted still wakes; only skipped is suppressed');
  // The two are genuinely different outcomes.
  assert.notEqual(deriveTerminalStatus(abortedFeedback), deriveTerminalStatus(skippedFeedback));
});

// ── Reconstruction: a [skipped] run reconstructs as ended, not errored ────────
test('loop reconstruction carries [skipped] as terminalStatus:skipped (ended, not errored)', () => {
  const now = new Date('2026-07-03T13:00:00.000Z');
  const hist = {
    id: 'abort-item-1',
    promptName: 'Prompt',
    prompt: null,
    issueId: null,
    issueIdentifier: 'LIN-946',
    issueTitle: null,
    issueUrl: null,
    dispatchedAt: '2026-07-03T12:59:00.000Z',
    dispatchedBy: null,
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: '2026-07-03T12:59:30.000Z',
    takenByTokenLabel: 'consumer-1',
    feedback: skippedFeedback
  };
  const loops = pipeline._buildLoops({ historyItems: [hist], now });
  assert.equal(loops.length, 1);
  assert.equal(loops[0].terminalStatus, 'skipped', 'reconstruction reads it as skipped');
  assert.notEqual(loops[0].terminalStatus, 'aborted'); // not an abort
  assert.notEqual(loops[0].terminalStatus, 'failed');  // not an error
  assert.equal(loops[0].terminalCompletedAt, '2026-07-03T12:00:00.000Z', 'has a completion time');
});

test('dashboard: a run carrying only a [skipped] marker reads as ended (terminal), not still-running', () => {
  // agentState:'running' would look non-terminal; the [skipped] terminal marker
  // upgrades it via MARKER_TO_AGENT_STATE (skipped→complete). Had skipped been
  // left unmapped, effectiveAgentState would return undefined and this would be
  // false — the "all sessions appear in progress forever" bug.
  const session = {
    sessionId: 'sess-1',
    loops: [{ loopId: 'sess-1', kind: 'autopilot', agentState: 'running', feedback: skippedFeedback }]
  };
  assert.equal(sessionIsTerminal(session), true);
});

// ── (d) Cascade emits ordinary UNFORCED aborts (non-regression) ───────────────
test('cascade expansion still emits ordinary UNFORCED aborts for ordinary sessions', async () => {
  const store = makeStore();
  const root = await store.addItem('acme', { prompt: 'root', kind: 'autopilot' });
  const worker = await store.addItem('acme', { prompt: 'w', sessionId: root._id });

  const { closed, count } = await store.expandCascadeAborts('acme', root._id, { target: 'cli' });
  assert.equal(count, 2);
  assert.deepEqual(closed.map(c => c.abortTo).sort(), [root._id, worker._id].sort());

  const emitted = (await store.pollAvailable('acme')).filter(i => i.abort === true);
  assert.equal(emitted.length, 2);
  for (const a of emitted) {
    assert.equal(a.abort, true);
    // UNforced is load-bearing: a plain (unforced) cascade abort is exactly what
    // the runner is allowed to skip when a human is in the session (LIN-951).
    assert.equal(a.force, false, 'cascade aborts carry no force → runner may skip human-continued ones');
  }
});

// ── (d) Force passthrough on a deliberate single abort (store seam) ────────────
test('force:true is persisted + forwarded on a single targeted abort (the escape hatch)', async () => {
  const store = makeStore();
  const abortTo = '99999999-9999-4999-8999-999999999999';

  const doc = await store.addItem('acme', { abort: true, abortTo, force: true, target: 'cli' });
  assert.equal(doc.abort, true);
  assert.equal(doc.force, true);

  // The runner must SEE force on the polled/taken item to override its skip.
  const taken = await store.takeItem(doc._id, 'acme');
  assert.equal(taken.force, true);
  assert.equal(taken.abortTo, abortTo);
});
