/**
 * Pin tests for the LIN-3578 rebuild of lib/pipeline-loops.js.
 *
 * Run with: node --test tests/unit/pipeline-loops-pins.test.js
 *
 * One class-(a) fix: on the LEAN path, an abort whose target row has no
 * `feedbackDigest` was dropped (the target read `terminalStatus: null`), while
 * the non-lean build of the same rows reported it `aborted`. The comments in
 * lib/pipeline-loops.js promise the two builds agree on every fact (LIN-3011,
 * the W1 witness in mongo-smoke.test.js), and LIN-3014's exemption list does not
 * exempt terminal facts. A digest-less lean target is either a still-queued live
 * item (a live item never carries a digest) or a history row that vanished
 * between `listHistory` and the self-heal re-read.
 *
 * Fixtures only: no store, no network.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { __internal } from '../../lib/pipeline-loops.js';
import { digestFeedback } from '../../lib/digest-feedback.js';

const { _buildLoops } = __internal;

const NOW = new Date('2026-06-22T14:00:00.000Z');
const T_TARGET = '2026-06-22T10:00:00.000Z';
const T_ABORT = '2026-06-22T12:00:00.000Z';
const ABORTED = { message: '[aborted] stopped by operator', timestamp: T_ABORT };

function target(overrides = {}) {
  return {
    id: 'target-1',
    promptName: 'implementation',
    issueIdentifier: 'LIN-1',
    dispatchedAt: T_TARGET,
    target: 'cli',
    kind: 'implementation',
    ...overrides
  };
}

// The abort row as the store writes it: no issueIdentifier, `abortTo` the target,
// and its own `[aborted]` marker. Non-lean carries `feedback`; the lean read
// carries only the persisted digest of it.
function abortRow({ lean }) {
  const doc = { id: 'abort-1', dispatchedAt: T_ABORT, feedback: [ABORTED], feedbackVersion: 0 };
  return {
    id: 'abort-1',
    abort: true,
    abortTo: 'target-1',
    issueIdentifier: null,
    dispatchedAt: T_ABORT,
    resolvedAt: T_ABORT,
    status: 'taken',
    ...(lean
      ? { feedbackDigest: { ...digestFeedback(doc, { now: NOW.getTime() }), version: 0 } }
      : { feedback: [ABORTED] })
  };
}

// The facts the two builds must agree on.
function facts(loop) {
  return {
    terminalStatus: loop.terminalStatus,
    terminalCompletedAt: loop.terminalCompletedAt,
    wakeMarker: loop.wakeMarker,
    waitingMessage: loop.waitingMessage,
    decision: loop.decision,
    decisionCase: loop.decisionCase,
    answeredDecisions: loop.answeredDecisions,
    withdrawal: loop.withdrawal,
    withdrawalReversed: loop.withdrawalReversed,
    telemetry: loop.telemetry
  };
}

const find = (loops, id) => loops.find(l => l.loopId === id);

describe('LIN-3578: a lean abort reaches a target that has no digest', () => {
  test('a still-queued LIVE target (never has a digest) reads aborted, like the non-lean build', () => {
    const lean = _buildLoops({ liveItems: [target()], historyItems: [abortRow({ lean: true })], now: NOW, lean: true });
    const full = _buildLoops({
      liveItems: [target({ feedback: [] })], historyItems: [abortRow({ lean: false })], now: NOW, lean: false
    });

    const leanTarget = find(lean, 'target-1');
    assert.equal(leanTarget.terminalStatus, 'aborted');
    assert.equal(leanTarget.terminalCompletedAt, T_ABORT);
    assert.equal(leanTarget.wakeMarker, 'aborted');
    assert.equal(leanTarget.telemetry.runtime.dispatchedAt, T_TARGET);
    assert.equal(leanTarget.telemetry.runtime.completedAt, T_ABORT);
    assert.equal(leanTarget.telemetry.runtime.ms, 2 * 60 * 60 * 1000);
    assert.deepStrictEqual(facts(leanTarget), facts(find(full, 'target-1')));
  });

  test('a HISTORY target whose digest is missing (vanished during self-heal) reads aborted', () => {
    const history = target({ status: 'taken', resolvedAt: '2026-06-22T10:01:00.000Z' });
    const lean = _buildLoops({ historyItems: [history, abortRow({ lean: true })], now: NOW, lean: true });
    const full = _buildLoops({
      historyItems: [{ ...history, feedback: [] }, abortRow({ lean: false })], now: NOW, lean: false
    });

    assert.equal(find(lean, 'target-1').terminalStatus, 'aborted');
    assert.deepStrictEqual(facts(find(lean, 'target-1')), facts(find(full, 'target-1')));
  });

  test('without an abort, a digest-less lean row is unchanged: no terminal, its own dispatch time in the runtime', () => {
    const lean = _buildLoops({ liveItems: [target()], now: NOW, lean: true });
    const full = _buildLoops({ liveItems: [target({ feedback: [] })], now: NOW, lean: false });

    const l = find(lean, 'target-1');
    assert.equal(l.terminalStatus, null);
    assert.equal(l.terminalCompletedAt, null);
    assert.equal(l.wakeMarker, null);
    assert.equal(l.withdrawalReversed, false);
    assert.deepStrictEqual(l.telemetry.runtime, { ms: null, dispatchedAt: T_TARGET, completedAt: null, crossCheck: null });
    assert.deepStrictEqual(facts(l), facts(find(full, 'target-1')));
  });

  test('a lean target WITH a digest still takes the abort through the digest path (guard)', () => {
    const doc = { id: 'target-1', dispatchedAt: T_TARGET, feedback: [{ message: '[working · running] 2 tools in 5s', timestamp: T_TARGET }], feedbackVersion: 0 };
    const withDigest = target({
      status: 'taken',
      resolvedAt: '2026-06-22T10:01:00.000Z',
      feedbackDigest: { ...digestFeedback(doc, { now: NOW.getTime() }), version: 0 }
    });
    const lean = _buildLoops({ historyItems: [withDigest, abortRow({ lean: true })], now: NOW, lean: true });
    const full = _buildLoops({
      historyItems: [{ ...withDigest, feedbackDigest: undefined, feedback: doc.feedback }, abortRow({ lean: false })],
      now: NOW, lean: false
    });

    assert.equal(find(lean, 'target-1').terminalStatus, 'aborted');
    assert.deepStrictEqual(facts(find(lean, 'target-1')), facts(find(full, 'target-1')));
  });
});
