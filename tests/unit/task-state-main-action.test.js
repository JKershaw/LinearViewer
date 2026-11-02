/**
 * LIN-4016 W3 — the one run decision, now `runOfferOf` (LIN-4104 D1, replacing `mainActionOf`).
 *
 * The `/state` route sends the gather's `taskState.action` as `sessions.action`, so each case drives the real route over
 * the held set (tests/fixtures/state-route.js) and asserts the body the browser gets.
 *
 * Characterization of the old `mainActionOf`, before its replacement, and what each behaviour became:
 *   - busy (any unended session) offered nothing: now `busy` (a run in flight) or `answer-first` (a session waiting on
 *     an answer). A waiting session was busy and offered nothing before; it now leads the box with its question.
 *   - a container offered Run to PR with `container: true`: now `offer` with `container: true` (the same flag, the same why).
 *   - a leaf whose stage failed offered that stage as a `step`: now `offer`, which names no step. DELIBERATE: the run
 *     control's Next step (LIN-4104 D3) is what names a step, at press time, so no stage is pinned on the offer.
 *   - a leaf with nothing to offer offered Run to PR: now `offer`. Its why string changed; the kind carries the meaning.
 *   - a finished task offered `none` (LIN-4042 / LIN-4071): unchanged.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runOfferOf, NO_RUN_ACTION } from '../../lib/task-state.js';
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

describe('LIN-4104 D1 — the run offer on /state: offer for a leaf and a container, busy or answer-first when something is in flight', () => {
  const finishedPlan = [doneLoop('plan', { loopId: 'p1', lineageId: 'p1' })];

  test('a leaf whose stage failed is an offer that names that stage again (LIN-3968: a failed stage is offered again)', async () => {
    const failed = await actionOf([doneLoop('plan', { loopId: 'p1', lineageId: 'p1' }), failedLoop('implementation', { loopId: 'i1', lineageId: 'i1' })]);
    assert.equal(failed.kind, 'offer');
    assert.equal(failed.container, false);
    assert.equal(failed.step.failed, true, 'the offer names the failed stage, a fact from the sessions');
    assert.equal(failed.why, failed.step.reason, 'the why is the failed stage\'s own reason (kept from the characterization)');
  });

  test('a clean finished leaf is an offer, with no guessed step after a clean Plan', async () => {
    assert.equal((await actionOf(finishedPlan)).kind, 'offer');
  });

  test('the same sessions as a container (an open subtask in the held tree): an offer with container: true', async () => {
    const action = await actionOf(finishedPlan, { container: true });
    assert.equal(action.kind, 'offer');
    assert.equal(action.container, true);
    assert.match(action.why, /container/);
  });

  test('a running stage is busy, for a leaf or a container: no offer', async () => {
    const running = [doneLoop('plan', { loopId: 'p1', lineageId: 'p1' }), loop({ loopId: 'b1', lineageId: 'b1', kind: 'implementation' })];
    assert.equal((await actionOf(running)).kind, 'busy');
    assert.equal((await actionOf(running, { container: true })).kind, 'busy');
  });

  test('a session waiting on an answer is answer-first, for a leaf or a container: no offer', async () => {
    const waiting = [rulingLoop()];
    const leaf = await actionOf(waiting);
    assert.equal(leaf.kind, 'answer-first');
    assert.deepEqual(leaf.identifiers, [ID], 'the leaf names itself, so the box leads with its question');
    const container = await actionOf(waiting, { container: true });
    assert.equal(container.kind, 'answer-first');
  });

  test('a failed stage on a leaf is an offer again, and on a container too (with container: true)', async () => {
    const failed = [failedLoop('implementation', { loopId: 'f1', lineageId: 'f1' })];
    assert.equal((await actionOf(failed)).kind, 'offer');
    const container = await actionOf(failed, { container: true });
    assert.equal(container.kind, 'offer');
    assert.equal(container.container, true);
  });

  test('a finished leaf offers no run on /state (LIN-4042): the no-run decision reaches the route', async () => {
    assert.equal((await actionOf(finishedPlan, { state: 'completed' })).kind, 'none');
  });
});

describe('LIN-4104 D1 — the one rule, runOfferOf (the gather and the route both call it)', () => {
  test('finished wins over everything: the no-run decision, whatever else is true', () => {
    assert.equal(runOfferOf({ finished: true, needsYou: [{ identifier: 'A' }], busyOn: { identifier: 'A', words: 'x' } }), NO_RUN_ACTION);
  });

  test('answer-first beats busy, and names the identifiers that need you', () => {
    const action = runOfferOf({ needsYou: [{ identifier: 'A' }, { identifier: 'B' }], busyOn: { identifier: 'C', words: 'Build running' } });
    assert.equal(action.kind, 'answer-first');
    assert.deepEqual(action.identifiers, ['A', 'B']);
  });

  test('busy carries what runs and where', () => {
    const action = runOfferOf({ busyOn: { identifier: 'LIN-92', words: 'Build running · 2m' } });
    assert.equal(action.kind, 'busy');
    assert.equal(action.identifier, 'LIN-92');
    assert.equal(action.words, 'Build running · 2m');
  });

  test('an offer for a leaf and a container alike: the three rungs; a container never carries a step', () => {
    assert.deepEqual(Object.keys(runOfferOf({})).sort(), ['container', 'kind', 'step', 'why']);
    assert.equal(runOfferOf({}).step, null, 'no failed stage, no step');
    assert.equal(runOfferOf({}).kind, 'offer');
    assert.equal(runOfferOf({}).container, false);
    assert.equal(runOfferOf({ container: true }).container, true);
  });
});
