/**
 * LIN-4016 W3 — the one main action: the same offered step, for a leaf and for a container.
 *
 * `/state` sends `sessions.action` (`mainActionOf`): a step for a leaf, Run to PR for a container (a container never
 * offers a stage), nothing while a session is busy (running, queued or waiting on an answer). These cases feed the
 * real `sessionSummaryOf` (the route's `sessions`), with `container` as the page passes it back.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskPageModel, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { mainActionOf } from '../../lib/task-state.js';
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

/** `sessions.action` for one task's loops, as the route reads it. */
function actionFor(loops, { container = false, trackerType = null } = {}) {
  const model = buildTaskPageModel({
    identifier: ID, loops, ctx: trackerType ? { issue: { identifier: ID, state: { name: trackerType, type: trackerType } }, children: [] } : null,
    enrichLoop, deriveSessionWaiting, now: NOW,
  });
  return sessionSummaryOf(model, { container }).action;
}

describe('LIN-4016 W3 — the main action: a step for a leaf, Run to PR for a container', () => {
  const finishedPlan = [doneLoop('plan', { loopId: 'p1', lineageId: 'p1' })];

  test('a leaf with a step to offer: the step, with the reason the box says', () => {
    const action = actionFor(finishedPlan);
    assert.equal(action.kind, 'step');
    assert.ok(action.step.label, 'the step names what runs');
    assert.equal(action.why, action.step.reason);
  });

  test('the same sessions as a container: Run to PR, never a stage', () => {
    const action = actionFor(finishedPlan, { container: true });
    assert.equal(action.kind, 'run-to-pr');
    assert.match(action.why, /container/);
  });

  test('a running stage offers nothing, for a leaf or a container', () => {
    const running = [doneLoop('plan', { loopId: 'p1', lineageId: 'p1' }), loop({ loopId: 'b1', lineageId: 'b1', kind: 'implementation' })];
    assert.equal(actionFor(running), null);
    assert.equal(actionFor(running, { container: true }), null);
  });

  test('a session waiting on an answer offers nothing, for a leaf or a container', () => {
    const waiting = [rulingLoop()];
    assert.equal(actionFor(waiting), null);
    assert.equal(actionFor(waiting, { container: true }), null);
  });

  test('a failed stage is offered again as a step (a leaf), and as Run to PR (a container)', () => {
    const failed = [failedLoop('implementation', { loopId: 'f1', lineageId: 'f1' })];
    const leaf = actionFor(failed);
    assert.equal(leaf.kind, 'step');
    assert.equal(leaf.step.failed, true, 'the stage that failed runs again');
    assert.equal(actionFor(failed, { container: true }).kind, 'run-to-pr');
  });

  test('a finished task, leaf: no step is offered, so the action is Run to PR as it has always been (not changed here)', () => {
    const action = actionFor(finishedPlan.map((l) => ({ ...l, loopId: l.loopId })), { trackerType: 'completed' });
    assert.equal(action.kind, 'run-to-pr');
  });

  test('mainActionOf is the one rule: busy wins, then container, then the offered step', () => {
    const step = { kind: 'implementation', label: 'Build', why: 'usual', reason: 'usually next after Plan', failed: false };
    assert.equal(mainActionOf({ offered: step, busy: true }), null);
    assert.equal(mainActionOf({ offered: step, busy: false, container: true }).kind, 'run-to-pr');
    assert.deepEqual(mainActionOf({ offered: step, busy: false }), { kind: 'step', step, why: 'usually next after Plan' });
    assert.equal(mainActionOf({ offered: null, busy: false }).kind, 'run-to-pr');
  });
});
