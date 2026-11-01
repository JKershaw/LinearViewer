/**
 * LIN-4016 W3 — the one main action: the same offered step, for a leaf and for a container.
 *
 * REWRITTEN (LIN-4070): the cases used to call `sessionSummaryOf(model, { container })` directly and read its `action`.
 * The `/state` route no longer sends that value: it sends the gather's `taskState.action` (the gather decides the container
 * from the held tree, and a finished task offers no run, LIN-4042), and `sessions.action` is that value. So each case now
 * drives the real `/state` route over the held set (tests/fixtures/state-route.js) and asserts the body the browser gets.
 * The one rule, `mainActionOf`, keeps its own unit case at the bottom: the route and the gather both call it.
 *
 * What changed in the expectations: a finished leaf offers no run (it read Run to PR before LIN-4042's guard reached the
 * route); a container is the held tree's container, not a flag the page passes back.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mainActionOf } from '../../lib/task-state.js';
import { stateBodyOf, stateIssue } from '../fixtures/state-route.js';

const ID = 'LIN-W3';
const CHILD = 'LIN-W3-C';
const T0 = '2026-10-30T10:00:00.000Z';

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: ID, kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: T0, takenAt: '2026-10-30T10:01:00.000Z', resolvedAt: '2026-10-30T10:01:00.000Z',
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

/** The `/state` action for `ID`'s loops: a leaf, or a container with one open subtask, in the held set. */
async function actionOf(loops, { container = false, state = 'started' } = {}) {
  const issues = [stateIssue(ID, state)];
  if (container) issues.push(stateIssue(CHILD, 'unstarted', { parent: ID }));
  const { status, body } = await stateBodyOf({ issues, loops, identifier: ID });
  assert.equal(status, 200);
  assert.equal(body.incomplete, undefined, 'the held set is complete');
  return body.sessions.action;
}

describe('LIN-4016 W3 — the main action on /state: a step for a leaf, Run to PR for a container', () => {
  const finishedPlan = [doneLoop('plan', { loopId: 'p1', lineageId: 'p1' })];

  // LIN-4103 beat 2: a leaf offers a step only when a stage failed (a fact). A clean finished plan offers no guessed step.
  test('a leaf whose stage failed offers that step, with the reason the box says; a clean leaf offers Run to PR (LIN-4103)', async () => {
    const failed = await actionOf([doneLoop('plan', { loopId: 'p1', lineageId: 'p1' }), failedLoop('implementation', { loopId: 'i1', lineageId: 'i1' })]);
    assert.equal(failed.kind, 'step');
    assert.ok(failed.step.label, 'the step names what runs');
    assert.equal(failed.why, failed.step.reason);
    const clean = await actionOf(finishedPlan);
    assert.equal(clean.kind, 'run-to-pr', 'no guessed step after a clean Plan');
  });

  test('the same sessions as a container (an open subtask in the held tree): Run to PR, never a stage', async () => {
    const action = await actionOf(finishedPlan, { container: true });
    assert.equal(action.kind, 'run-to-pr');
    assert.match(action.why, /container/);
  });

  test('a running stage offers nothing, for a leaf or a container', async () => {
    const running = [doneLoop('plan', { loopId: 'p1', lineageId: 'p1' }), loop({ loopId: 'b1', lineageId: 'b1', kind: 'implementation' })];
    assert.equal(await actionOf(running), null);
    assert.equal(await actionOf(running, { container: true }), null);
  });

  test('a session waiting on an answer offers nothing, for a leaf or a container', async () => {
    const waiting = [rulingLoop()];
    assert.equal(await actionOf(waiting), null);
    assert.equal(await actionOf(waiting, { container: true }), null);
  });

  test('a failed stage is offered again as a step (a leaf), and as Run to PR (a container)', async () => {
    const failed = [failedLoop('implementation', { loopId: 'f1', lineageId: 'f1' })];
    const leaf = await actionOf(failed);
    assert.equal(leaf.kind, 'step');
    assert.equal(leaf.step.failed, true, 'the stage that failed runs again');
    assert.equal((await actionOf(failed, { container: true })).kind, 'run-to-pr');
  });

  test('a finished leaf offers no run on /state (LIN-4042): the no-run decision reaches the route', async () => {
    assert.equal((await actionOf(finishedPlan, { state: 'completed' })).kind, 'none');
  });
});

describe('LIN-4016 W3 — the one rule, mainActionOf (the gather and the route both call it)', () => {
  test('busy wins, then container, then the offered step', () => {
    const step = { kind: 'implementation', label: 'Build', why: 'usual', reason: 'usually next after Plan', failed: false };
    assert.equal(mainActionOf({ offered: step, busy: true }), null);
    assert.equal(mainActionOf({ offered: step, busy: false, container: true }).kind, 'run-to-pr');
    assert.deepEqual(mainActionOf({ offered: step, busy: false }), { kind: 'step', step, why: 'usually next after Plan' });
    assert.equal(mainActionOf({ offered: null, busy: false }).kind, 'run-to-pr');
  });
});
