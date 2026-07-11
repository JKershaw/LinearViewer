/**
 * Unit tests for LIN-1257 — abort terminal-attribution at the SESSION level.
 *
 * Run with: node --test tests/unit/pipeline-abort-session-terminal.test.js
 *
 * Companion to the loop-level cases in pipeline-loops.test.js. These drive the
 * real end-to-end chain — reconstruction (`_buildLoops`, which runs the LIN-1257
 * abort pre-pass) → session assembly (`_buildSessions`) → the exported
 * `sessionIsTerminal` (routes/dashboard.js) — to prove the two card-level claims
 * the fix rests on:
 *
 *   2. Anchor abort flips the card: when `abortTo` names the anchor loop
 *      (`loopId === sessionId`), the whole session card goes terminal — for free,
 *      because `sessionIsTerminal` follows the anchor. No roll-up code needed.
 *   3. Worker abort does NOT flip the card: when `abortTo` names a worker under a
 *      still-live anchor, the run row flips terminal but the session card stays
 *      live (guards against over-terminalizing valid multi-worker sessions).
 *
 * Fixtures-only: no proxy, no token, no network — the same pattern as
 * pipeline-sessions.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { __internal } from '../../lib/pipeline-loops.js';
import { sessionIsTerminal } from '../../routes/dashboard.js';

const { _buildLoops, _buildSessions } = __internal;

const EPIC = 'LIN-590';   // the autopilot seed issue
const CHILD = 'LIN-591';  // a worker subtask under the epic
const SESSION_ID = 'ap-1'; // == the autopilot orchestrator's dispatch id (the anchor)

const T0 = '2026-06-22T10:00:00.000Z';        // orchestrator dispatched
const ABORT_TS = '2026-06-22T12:00:00.000Z';  // the abort's terminal marker time
const NOW = new Date('2026-06-22T14:00:00.000Z');

// A still-live heartbeat — deliberately NOT a terminal marker, so a loop carrying
// only this reconstructs non-terminal (renders "in-progress").
function heartbeat(ts) {
  return [{ message: '[working · running] 4 tools in 34s', url: null, urlLabel: null, timestamp: ts }];
}

// A genuine terminal marker the target posted for ITSELF (e.g. `[done]@12:00`) —
// the F1 precondition: a target that already carries its own terminal outcome.
function terminalMarker(marker, ts) {
  return [{ message: `[${marker}] finished`, url: null, urlLabel: null, timestamp: ts }];
}

// The autopilot orchestrator (the session anchor): kind 'autopilot', its loopId
// becomes the session's sessionId. Scoped to an issue, so it carries an
// issueIdentifier and survives reconstruction. Still `taken` + running.
function orchestrator(overrides = {}) {
  return {
    id: SESSION_ID,
    promptName: 'autopilot',
    prompt: 'autopilot kickoff',
    issueId: 'uuid-590',
    issueIdentifier: EPIC,
    issueTitle: 'Epic',
    issueUrl: null,
    dispatchedAt: T0,
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: '2026-06-22T10:01:00.000Z',
    kind: 'autopilot',
    sessionId: null,
    feedback: heartbeat('2026-06-22T11:00:00.000Z'),
    ...overrides
  };
}

// A worker under the session: carries the explicit sessionId (so it groups under
// the anchor) and an issueIdentifier (so it survives reconstruction). Still
// `taken` + running.
function worker(overrides = {}) {
  return {
    id: 'w1',
    promptName: 'implementation',
    prompt: 'work',
    issueId: 'uuid-591',
    issueIdentifier: CHILD,
    issueTitle: 'Child',
    issueUrl: null,
    dispatchedAt: '2026-06-22T10:30:00.000Z',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: '2026-06-22T10:31:00.000Z',
    kind: 'implementation',
    sessionId: SESSION_ID,
    feedback: heartbeat('2026-06-22T11:00:00.000Z'),
    ...overrides
  };
}

// The abort item: no issueIdentifier (dropped by reconstruction), abort=true,
// abortTo = the row it targets, terminal `[aborted]` feedback carrying the time.
function abortRow(abortTo, overrides = {}) {
  return {
    id: 'abrt-1',
    promptName: null,
    prompt: null,
    issueId: null,
    issueIdentifier: null,
    issueTitle: null,
    issueUrl: null,
    dispatchedAt: '2026-06-22T11:59:00.000Z',
    target: 'cli',
    repo: null,
    status: 'aborted',
    resolvedAt: ABORT_TS,
    kind: 'custom',
    abort: true,
    abortTo,
    sessionId: SESSION_ID,
    feedback: [{ message: `[aborted] Cancelled running session 3e626118 (EXECUTING).`, timestamp: ABORT_TS }],
    ...overrides
  };
}

function sessionFor(sessionId, { liveItems = [], historyItems = [] }) {
  const loops = _buildLoops({ liveItems, historyItems, now: NOW });
  const sessions = _buildSessions(loops, { now: NOW });
  return { sessions, session: sessions.find(s => s.sessionId === sessionId) };
}

function loopsFor({ liveItems = [], historyItems = [] }) {
  return _buildLoops({ liveItems, historyItems, now: NOW });
}

// ─── F1: an earlier abort must never override a later genuine terminal ─────────
// (LIN-1261) The abort's synthetic `[aborted]` entry is appended LAST and
// findTerminalFeedback is position-based (last-in-array wins). Before the F1 guard
// a target that had already posted its own `[done]@12:00` would be relabeled
// `aborted` and its completedAt rewound to the earlier abort time. The guard
// appends only when the abort is STRICTLY later than any pre-existing terminal.

describe('F1: abort vs a target that already carries its own terminal marker (LIN-1261)', () => {
  const DONE_TS = '2026-06-22T12:00:00.000Z';       // the target's own [done]
  const EARLIER_ABORT_TS = '2026-06-22T11:30:00.000Z';  // abort BEFORE the [done]
  const LATER_ABORT_TS = '2026-06-22T12:30:00.000Z';    // abort AFTER the [done]

  test('earlier abort does NOT override a later [done] or rewind completedAt', () => {
    const loops = loopsFor({
      liveItems: [orchestrator(), worker({ feedback: terminalMarker('done', DONE_TS) })],
      historyItems: [abortRow('w1', { feedback: [{ message: '[aborted] cancelled', timestamp: EARLIER_ABORT_TS }] })]
    });
    const workerLoop = loops.find(l => l.loopId === 'w1');
    assert.strictEqual(workerLoop.terminalStatus, 'done', 'genuine later [done] is preserved');
    assert.strictEqual(workerLoop.terminalCompletedAt, DONE_TS, 'completedAt is NOT rewound to the earlier abort');
  });

  test('earlier abort does NOT override a later [failed]', () => {
    const loops = loopsFor({
      liveItems: [orchestrator(), worker({ feedback: terminalMarker('failed', DONE_TS) })],
      historyItems: [abortRow('w1', { feedback: [{ message: '[aborted] cancelled', timestamp: EARLIER_ABORT_TS }] })]
    });
    const workerLoop = loops.find(l => l.loopId === 'w1');
    assert.strictEqual(workerLoop.terminalStatus, 'failed');
    assert.strictEqual(workerLoop.terminalCompletedAt, DONE_TS);
  });

  test('a genuinely LATER abort still wins (forward, not a rewind)', () => {
    const loops = loopsFor({
      liveItems: [orchestrator(), worker({ feedback: terminalMarker('done', DONE_TS) })],
      historyItems: [abortRow('w1', { feedback: [{ message: '[aborted] cancelled', timestamp: LATER_ABORT_TS }] })]
    });
    const workerLoop = loops.find(l => l.loopId === 'w1');
    assert.strictEqual(workerLoop.terminalStatus, 'aborted', 'the later abort is the real terminal event');
    assert.strictEqual(workerLoop.terminalCompletedAt, LATER_ABORT_TS);
  });

  test('control: a running (non-terminal) target is still attributed aborted (A2 unchanged)', () => {
    const loops = loopsFor({
      liveItems: [orchestrator(), worker({ feedback: heartbeat('2026-06-22T11:00:00.000Z') })],
      historyItems: [abortRow('w1')]
    });
    const workerLoop = loops.find(l => l.loopId === 'w1');
    assert.strictEqual(workerLoop.terminalStatus, 'aborted');
    assert.strictEqual(workerLoop.terminalCompletedAt, ABORT_TS);
  });
});

// ─── Case 2: anchor abort flips the whole card ───────────────────────────────

describe('anchor abort → session card terminal (LIN-1257)', () => {
  test('when abortTo names the anchor loop, sessionIsTerminal(session) === true', () => {
    // Anchor + one still-live worker; the abort targets the ANCHOR (ap-1).
    const { session } = sessionFor(SESSION_ID, {
      liveItems: [orchestrator(), worker()],
      historyItems: [abortRow(SESSION_ID)]
    });
    assert.ok(session, 'the autopilot session was reconstructed');
    // The anchor loop itself is now terminal (aborted)…
    const anchor = session.loops.find(l => l.loopId === SESSION_ID);
    assert.strictEqual(anchor.terminalStatus, 'aborted');
    // …so the card follows the anchor and goes terminal — with NO roll-up code.
    assert.strictEqual(sessionIsTerminal(session), true);
  });

  test('control: the SAME session with no abort stays live (sessionIsTerminal === false)', () => {
    const { session } = sessionFor(SESSION_ID, {
      liveItems: [orchestrator(), worker()],
      historyItems: []
    });
    assert.ok(session);
    assert.strictEqual(sessionIsTerminal(session), false);
  });
});

// ─── Case 3: worker abort does NOT flip the card ─────────────────────────────

describe('worker abort → run row terminal, card stays live (LIN-1257)', () => {
  test('when abortTo names a worker under a live anchor, the run flips but the card does NOT', () => {
    // The abort targets the WORKER (w1); the anchor (ap-1) is untouched and live.
    const { session } = sessionFor(SESSION_ID, {
      liveItems: [orchestrator(), worker()],
      historyItems: [abortRow('w1')]
    });
    assert.ok(session, 'the autopilot session was reconstructed');

    // The worker run row IS terminal (aborted) — the reported symptom is fixed.
    const workerLoop = session.loops.find(l => l.loopId === 'w1');
    assert.strictEqual(workerLoop.terminalStatus, 'aborted', 'worker run row flips terminal');

    // The anchor was never aborted, so it stays non-terminal…
    const anchor = session.loops.find(l => l.loopId === SESSION_ID);
    assert.strictEqual(anchor.terminalStatus, null, 'anchor keeps its running heartbeat');

    // …and the whole session card therefore stays LIVE (anchor-follow). This is the
    // guard against over-terminalizing a valid multi-worker session.
    assert.strictEqual(sessionIsTerminal(session), false);
  });
});
