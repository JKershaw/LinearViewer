/**
 * LIN-4103 (S1: facts, not estimates) — characterization of the state owner BEFORE the change.
 *
 * These pin what must stay true across the change: how a failure is read (its own stage, a subtask's, and the
 * conditions that hide it), what a busy or finished task shows, the done-child rule, the ranking of the states
 * that stay, and `parentNextOf` (which the prompt seed and the recommend descent still read). The words the
 * guess draws (`Research next`, `Next: … on LIN-…`, the `next` state and rank) are NOT pinned here: S1 removes
 * them on purpose, and LIN-3833 / LIN-4039 / LIN-4069 carry those tests, updated in the same change.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRowStates, buildTaskPageModel, nextStepOf } from '../../lib/task-page-loader.js';
import { taskStateOf, taskFactsOf, rollUpRow, needsAPerson } from '../../lib/task-state.js';
import { parentNextOf } from '../../lib/recommendation-facts.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-11-01T10:06:00.000Z');

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-1', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-11-01T10:00:00.000Z', takenAt: '2026-11-01T10:01:00.000Z', resolvedAt: '2026-11-01T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
const doneLoop = (kind, over = {}) => loop({
  kind, agentState: 'done', terminalStatus: 'done', terminalCompletedAt: '2026-11-01T10:03:00.000Z',
  resolvedAt: '2026-11-01T10:03:00.000Z', historyStatus: 'resolved', ...over,
});
const failedLoop = (kind, over = {}) => loop({
  kind, agentState: 'failed', terminalStatus: 'failed', terminalCompletedAt: '2026-11-01T10:02:00.000Z',
  resolvedAt: '2026-11-01T10:02:00.000Z', historyStatus: 'resolved', ...over,
});
const queuedLoop = (over = {}) => loop({ agentState: 'queued', historyStatus: 'dispatched', takenAt: null, resolvedAt: null, ...over });

const node = (identifier, type = 'started', children = []) => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type } },
  children,
  depth: 0,
});

function states(roots, loops = {}) {
  return buildRowStates({
    roots,
    loopsByIdentifier: new Map(Object.entries(loops)),
    enrichLoop,
    deriveSessionWaiting,
    now: NOW,
    sessionsVisible: true,
  });
}

// The task's page model, built the way the row reads it (`rowStateOf`): its own loops and its tracker type.
function modelOf(identifier, loops, trackerType = 'started') {
  return buildTaskPageModel({
    identifier,
    loops,
    ctx: { issue: { identifier, title: identifier, state: { type: trackerType } }, parent: null, children: [] },
    enrichLoop,
    deriveSessionWaiting,
    ruling: null,
    now: NOW,
  });
}

describe('how a failure is read (the fact that must survive the guess being removed)', () => {
  test('the newest failed stage is the offered step: failed, again, with its reason', () => {
    const loops = [doneLoop('research', { loopId: 'r1' }), failedLoop('implementation', { loopId: 'i1' })];
    const step = nextStepOf(modelOf('LIN-1', loops).sessions, 'started');
    assert.equal(step.kind, 'implementation');
    assert.equal(step.failed, true);
    assert.equal(step.why, 'again');
    assert.equal(step.reason, 'failed last time, so it runs again');
  });

  test('a running session hides the failure: nothing is offered while a stage runs (busy)', () => {
    const loops = [failedLoop('implementation', { loopId: 'i1' }), loop({ kind: 'plan', loopId: 'p2' })];
    assert.equal(nextStepOf(modelOf('LIN-1', loops).sessions, 'started'), null);
  });

  test('a finished tracker word hides the failure: nothing is offered on a Done task', () => {
    const loops = [failedLoop('implementation', { loopId: 'i1' })];
    assert.equal(nextStepOf(modelOf('LIN-1', loops, 'completed').sessions, 'completed'), null);
  });

  test('a failed stage reads failed on its own row, with the stage label and "failed"', () => {
    const s = states([node('LIN-1')], { 'LIN-1': [failedLoop('implementation', { issueIdentifier: 'LIN-1' })] });
    assert.equal(s.get('LIN-1').state, 'failed');
    assert.equal(s.get('LIN-1').words, 'Build failed');
    assert.equal(needsAPerson(s.get('LIN-1').state), true, 'a failed task needs a person (LIN-3968)');
  });

  test('taskFactsOf draws the failure from the task model, the same fact the row reads', () => {
    const model = modelOf('LIN-1', [failedLoop('implementation', { loopId: 'i1' })]);
    const facts = taskFactsOf({ model, identifier: 'LIN-1', trackerType: 'started', now: NOW });
    assert.deepEqual(facts.failed, { words: 'Build failed' });
  });

  test('a Done task whose last stage failed reads done on its own row (LIN-4016, LIN-4042): the failure does not show', () => {
    const s = states([node('LIN-1', 'completed')], { 'LIN-1': [failedLoop('implementation', { issueIdentifier: 'LIN-1' })] });
    assert.equal(s.get('LIN-1').state, 'done');
    assert.equal(s.get('LIN-1').words, 'done');
  });

  test('a Done child with a failed last stage does not roll up: its parent does not read failed', () => {
    const child = node('LIN-2', 'completed');
    const parent = node('LIN-1', 'started', [child]);
    const s = states([parent], { 'LIN-2': [failedLoop('implementation', { issueIdentifier: 'LIN-2' })] });
    assert.equal(s.get('LIN-2').state, 'done', 'the child reads done on its own row');
    assert.notEqual(s.get('LIN-1').state, 'failed', 'the parent counts open work, not the child failure');
  });

  test('a parent whose open subtask failed reads failed, and the subtask is named with its failure', () => {
    const child = node('LIN-61');
    const parent = node('LIN-60', 'started', [child]);
    const s = states([parent], { 'LIN-61': [failedLoop('implementation', { issueIdentifier: 'LIN-61' })] });
    assert.equal(s.get('LIN-60').state, 'failed');
    assert.equal(s.get('LIN-60').words, 'Build failed');
    assert.equal(s.get('LIN-60').attention.words, 'A subtask failed: LIN-61 · Build failed');
  });

  test('a subtask that needs you outranks the parent\'s own failed stage (the failure is then not the line)', () => {
    const child = node('LIN-71');
    const parent = node('LIN-70', 'started', [child]);
    const s = states([parent], {
      'LIN-70': [failedLoop('implementation', { issueIdentifier: 'LIN-70', loopId: 'pf' })],
      'LIN-71': [loop({ issueIdentifier: 'LIN-71', wakeMarker: 'blocked', waitingMessage: '[blocked] which way?', feedback: [{ message: '[blocked] which way?', timestamp: '2026-11-01T10:05:00.000Z' }], decision: { decision_id: 'd-1', question: 'Which way?' }, decisionCase: [], answeredDecisions: [], withdrawal: null })],
    });
    assert.equal(s.get('LIN-70').state, 'needs-you');
    assert.equal(s.get('LIN-70').attention.words, 'A subtask needs you: LIN-71');
  });
});

describe('what the states that stay read', () => {
  test('ranking: needs you and failed rank first, running and queued next, parked and quiet after', () => {
    const s = states([
      node('LIN-80'),
      node('LIN-81'),
      node('LIN-82'),
      node('LIN-83', 'backlog'),
    ], {
      'LIN-80': [failedLoop('implementation', { issueIdentifier: 'LIN-80' })],
      'LIN-81': [loop({ issueIdentifier: 'LIN-81' })],
      'LIN-82': [loop({ issueIdentifier: 'LIN-82', wakeMarker: 'blocked', waitingMessage: '[blocked] waiting on the vendor', feedback: [{ message: '[blocked] waiting on the vendor', timestamp: '2026-11-01T10:05:00.000Z' }] })],
    });
    assert.equal(s.get('LIN-80').rank, 0, 'failed');
    assert.equal(s.get('LIN-81').rank, 2, 'running');
    assert.equal(s.get('LIN-82').state, 'parked');
    assert.equal(s.get('LIN-82').rank, 3, 'parked ranks with the rest');
    assert.equal(s.get('LIN-83').state, 'backlog');
    assert.equal(s.get('LIN-83').rank, 3);
  });

  test('a running session has the running state and words, with no failed words beside it', () => {
    const s = states([node('LIN-90')], { 'LIN-90': [loop({ issueIdentifier: 'LIN-90', kind: 'plan' })] });
    assert.equal(s.get('LIN-90').state, 'running');
    assert.equal(s.get('LIN-90').running, true);
    assert.match(s.get('LIN-90').words, /^Plan running · /);
  });

  test('a copy-first viewer (no sessions) reads the tracker alone: a started task says nothing', () => {
    const s = buildRowStates({
      roots: [node('LIN-95')], loopsByIdentifier: new Map(), enrichLoop, deriveSessionWaiting, now: NOW, sessionsVisible: false,
    });
    assert.equal(s.get('LIN-95').words, null);
    assert.equal(s.get('LIN-95').state, 'todo');
  });

  test('taskStateOf: a needs-you own ruling outranks a failed own stage, and the failure is not the attention line', () => {
    const out = taskStateOf({ ownRuling: true, failed: { words: 'Build failed' } });
    assert.equal(out.state, 'needs-you');
    assert.equal(out.attention, null);
  });

  test('rollUpRow: a failed child rolls up to a failed container when nothing needs the person', () => {
    const own = taskFactsOf({ model: modelOf('LIN-100', []), identifier: 'LIN-100', trackerType: 'started', now: NOW });
    const rolled = rollUpRow(own, [{ identifier: 'LIN-101', title: null, state: 'failed', words: 'Build failed' }]);
    assert.equal(rolled.state, 'failed');
    assert.equal(rolled.words, 'Build failed');
  });
});

describe('parentNextOf (kept: the prompt seed and the recommend descent read it)', () => {
  const sub = (identifier, type = 'unstarted') => ({ identifier, state: { type } });

  test('no pick when the container has no children, or all children are finished', () => {
    assert.equal(parentNextOf([]), null);
    assert.equal(parentNextOf([sub('LIN-1', 'completed')]), null);
  });

  test('no pick when the container itself is busy, failed or has landed work', () => {
    const open = [sub('LIN-2')];
    assert.equal(parentNextOf(open, { busy: true }), null);
    assert.equal(parentNextOf(open, { failed: true }), null);
    assert.equal(parentNextOf(open, { landed: true }), null);
  });

  test('otherwise a pick, named by the natural identifier order among open children', () => {
    const pick = parentNextOf([sub('LIN-21'), sub('LIN-20')], { busy: false, failed: false, landed: false });
    assert.equal(pick.identifier, 'LIN-20');
  });
});
