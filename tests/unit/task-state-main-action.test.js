/**
 * LIN-4016 W3 — the one main action: the same offered step, for a leaf and for a container.
 * LIN-4049 — `actions` replaces `action` (`mainActionOf` is `actionsOf`). It is empty while the task or anything in its
 * subtree runs, is queued or needs you, and once the task is finished; otherwise it offers the one reach the server knows.
 *
 * `/state` sends `sessions.actions`: a step for a leaf, Run to PR for a container (a container never offers a stage). These
 * cases feed the real `sessionSummaryOf` (the route's `sessions`), with `container`, the subtree's row state and the
 * advisory `finished` as the route passes them.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskPageModel, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { actionsOf, blocksRun } from '../../lib/task-state.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-30T10:06:00.000Z');
const ID = 'LIN-W3';

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: ID, kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z', resolvedAt: '2026-10-30T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
const doneLoop = (kind, over = {}) => loop({
  kind, agentState: 'done', terminalStatus: 'done', terminalCompletedAt: '2026-10-30T10:03:00.000Z',
  resolvedAt: '2026-10-30T10:03:00.000Z', historyStatus: 'resolved', ...over,
});
const failedLoop = (kind, over = {}) => loop({
  kind, agentState: 'failed', terminalStatus: 'failed', terminalCompletedAt: '2026-10-30T10:02:00.000Z',
  resolvedAt: '2026-10-30T10:02:00.000Z', historyStatus: 'resolved', ...over,
});
const rulingLoop = (over = {}) => loop({
  wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
  feedback: [{ message: '[blocked] which way?', timestamp: '2026-10-30T10:05:00.000Z' }],
  decision: { decision_id: 'd-1', question: 'Which way?' }, decisionCase: [], answeredDecisions: [], withdrawal: null, ...over,
});

/** `sessions.actions` for one task's loops, as the route reads it. */
function actionsFor(loops, { container = false, finished = false, rowState = null, overCap = false } = {}) {
  const model = buildTaskPageModel({ identifier: ID, loops, ctx: null, enrichLoop, deriveSessionWaiting, now: NOW });
  return sessionSummaryOf(model, { container, finished, rowState, overCap });
}

describe('LIN-4016 W3 — the main action: a step for a leaf, Run to PR for a container', () => {
  const finishedPlan = [doneLoop('plan', { loopId: 'p1', lineageId: 'p1' })];

  test('a leaf with a step to offer: the step, with the reason the box says', () => {
    const [action] = actionsFor(finishedPlan).actions;
    assert.equal(action.kind, 'step');
    assert.ok(action.step.label, 'the step names what runs');
    assert.equal(action.why, action.step.reason);
  });

  test('the same sessions as a container: Run to PR, never a stage', () => {
    const [action] = actionsFor(finishedPlan, { container: true }).actions;
    assert.equal(action.kind, 'run-to-pr');
    assert.match(action.why, /container/);
  });

  test('a running stage offers nothing, for a leaf or a container', () => {
    const running = [doneLoop('plan', { loopId: 'p1', lineageId: 'p1' }), loop({ loopId: 'b1', lineageId: 'b1', kind: 'implementation' })];
    assert.deepEqual(actionsFor(running).actions, []);
    assert.deepEqual(actionsFor(running, { container: true }).actions, []);
  });

  test('a session waiting on an answer offers nothing, for a leaf or a container', () => {
    const waiting = [rulingLoop()];
    assert.deepEqual(actionsFor(waiting).actions, []);
    assert.deepEqual(actionsFor(waiting, { container: true }).actions, []);
  });

  test('a failed stage is offered again as a step (a leaf), and as Run to PR (a container)', () => {
    const failed = [failedLoop('implementation', { loopId: 'f1', lineageId: 'f1' })];
    const [leaf] = actionsFor(failed).actions;
    assert.equal(leaf.kind, 'step');
    assert.equal(leaf.step.failed, true, 'the stage that failed runs again');
    assert.equal(actionsFor(failed, { container: true }).actions[0].kind, 'run-to-pr');
  });
});

describe('LIN-4049 — actions are empty over the subtree, and when the task is finished', () => {
  const finishedPlan = [doneLoop('plan', { loopId: 'p1', lineageId: 'p1' })];

  test('a subtree that runs, is queued or needs you blocks a container and a leaf alike, as its row says', () => {
    for (const state of ['running', 'queued', 'needs-you']) {
      assert.equal(blocksRun(state), true, state);
      assert.deepEqual(actionsFor(finishedPlan, { container: true, rowState: { state } }).actions, [], state);
      assert.deepEqual(actionsFor(finishedPlan, { rowState: { state } }).actions, [], state);
    }
  });

  test('a failed or next subtree does not block: the step is offered again, as the row says failed or next', () => {
    for (const state of ['failed', 'next', 'todo', 'backlog', 'done', 'parked']) {
      assert.equal(blocksRun(state), false, state);
      assert.equal(actionsFor(finishedPlan, { rowState: { state } }).actions.length, 1, state);
    }
  });

  test('a finished task offers nothing, the step included (the server decides, not the browser)', () => {
    assert.deepEqual(actionsFor(finishedPlan, { finished: true }).actions, []);
    assert.deepEqual(actionsFor(finishedPlan, { container: true, finished: true }).actions, []);
  });

  test('over the read cap the box offers nothing and says why, in a plain sentence', () => {
    const summary = actionsFor(finishedPlan, { overCap: true });
    assert.deepEqual(summary.actions, []);
    assert.match(summary.note, /more subtasks than the run box checks, so it offers no run/);
    assert.equal(actionsFor(finishedPlan).note, null, 'no note when the read is in bounds');
  });

  test('actionsOf is the one rule: busy or finished empties it, then a container, then the offered step', () => {
    const step = { kind: 'implementation', label: 'Build', why: 'usual', reason: 'usually next after Plan', failed: false };
    assert.deepEqual(actionsOf({ offered: step, busy: true }), []);
    assert.deepEqual(actionsOf({ offered: step, busy: false, finished: true }), []);
    assert.equal(actionsOf({ offered: step, busy: false, container: true })[0].kind, 'run-to-pr');
    assert.deepEqual(actionsOf({ offered: step, busy: false }), [{ kind: 'step', step, why: 'usually next after Plan' }]);
    assert.equal(actionsOf({ offered: null, busy: false })[0].kind, 'run-to-pr');
  });
});
