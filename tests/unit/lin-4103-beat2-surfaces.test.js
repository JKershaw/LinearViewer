/**
 * LIN-4103 beat 2 — the surfaces show facts only: rows, the stage strip and track, a parent's roll-up, the opened box,
 * and the "what comes next" line. Each test here is an acceptance witness: it was run against the beat-1 code first and
 * its failing output is recorded in the LIN-4103 beat 2 evidence comment.
 *
 * Witnesses:
 *  - W-A a row says no guessed step (no "usual", "Next: …", "… next") for any state a task can be in;
 *  - W-B the stage strip and the task-page track draw no `ahead` (usual) stage;
 *  - W-C a parent's row rolls its children up as counts ("1 of 3 running", "a subtask failed"); a Done child whose last
 *    stage failed does not roll up;
 *  - W-D the opened box names every subtask that needs you (or failed), and agrees with the row;
 *  - W-E the offer is a fact only: no usual-stage guess, no "comes next" line for a task nothing has run on;
 *  - W-F the 30-day window holds for the row, while the strip keeps a 32-day-old session dated.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRowStates, buildTaskPageModel, buildTaskStages, nextStepOf, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { rollUpRow, taskStateOf } from '../../lib/task-state.js';
import { renderStageStrip, renderTaskTrack, renderNextLine } from '../../lib/render-task-page.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { createHomeRowStates } from '../../lib/home-row-states.js';
import { inReadWindow } from '../../lib/read-horizon.js';

const NOW = new Date('2026-11-01T10:06:00.000Z');
const OLD = '2026-09-30T10:00:00.000Z'; // 32 days before NOW: outside Home's 30-day window

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
const ruling = (over = {}) => loop({
  wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
  feedback: [{ message: '[blocked] which way?', timestamp: '2026-11-01T10:05:00.000Z' }],
  decision: { decision_id: 'd-1', question: 'Which way?' }, decisionCase: [], answeredDecisions: [], withdrawal: null, ...over,
});

const node = (identifier, type = 'started', children = []) => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type } },
  children,
  depth: 0,
});

function states(roots, loops = {}) {
  return buildRowStates({
    roots, loopsByIdentifier: new Map(Object.entries(loops)), enrichLoop, deriveSessionWaiting, now: NOW, sessionsVisible: true,
  });
}

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

// A child's row state as buildRowStates keeps it: its decided state, with its identifier and title.
const childOf = (identifier, facts = {}) => ({ identifier, title: identifier, ...taskStateOf(facts) });
const RUNNING = { running: { words: 'Plan running · 5m' } };
const FAILED = { failed: { words: 'Build failed' } };
const NEEDS_YOU = { ownRuling: true };
const QUIET = {};

// Words that name a guessed step. A row, a strip or a box must never carry one.
const GUESS = /\busual\b|usually next|\bNext:|\bnext\b|comes next/i;

describe('W-A rows say no guessed step', () => {
  test('a row of every task state carries no guessed step, and a never-run task says nothing', () => {
    const cases = {
      'LIN-10': { loops: {}, type: 'started' },
      'LIN-11': { loops: { 'LIN-11': [doneLoop('research', { issueIdentifier: 'LIN-11' })] }, type: 'started' },
      'LIN-12': { loops: { 'LIN-12': [doneLoop('plan', { issueIdentifier: 'LIN-12' })] }, type: 'started' },
      'LIN-13': { loops: { 'LIN-13': [failedLoop('implementation', { issueIdentifier: 'LIN-13' })] }, type: 'started' },
      'LIN-14': { loops: { 'LIN-14': [loop({ issueIdentifier: 'LIN-14', kind: 'plan' })] }, type: 'started' },
      'LIN-15': { loops: { 'LIN-15': [loop({ issueIdentifier: 'LIN-15', kind: 'plan', agentState: 'queued', takenAt: null, historyStatus: 'dispatched' })] }, type: 'started' },
      'LIN-16': { loops: {}, type: 'backlog' },
    };
    const loops = Object.fromEntries(Object.entries(cases).map(([id, c]) => [id, c.loops[id] || []]));
    const s = states(Object.entries(cases).map(([id, c]) => node(id, c.type)), loops);
    for (const id of Object.keys(cases)) {
      const words = s.get(id).words;
      assert.doesNotMatch(String(words), GUESS, `${id} row says "${words}"`);
    }
    assert.equal(s.get('LIN-10').words, null, 'a never-run task says nothing on its row');
  });
});

describe('W-B the stage strip and the task-page track draw no ahead stage', () => {
  test('buildTaskStages for a never-run task has no ahead stage', () => {
    const model = modelOf('LIN-20', []);
    assert.deepEqual(buildTaskStages(model.sessions, { trackerType: 'started' }), []);
  });

  test('after research only, no stage is ahead: the stages are the sessions that ran', () => {
    const model = modelOf('LIN-21', [doneLoop('research', { issueIdentifier: 'LIN-21' })]);
    const stages = buildTaskStages(model.sessions, { trackerType: 'started' });
    assert.ok(stages.every((st) => st.state !== 'ahead'), 'no ahead stage');
    assert.deepEqual(stages.map((st) => st.kind), ['research']);
  });

  test('the strip HTML of a never-run task carries no usual or ahead chip', () => {
    const html = renderStageStrip(modelOf('LIN-22', []), { now: NOW });
    assert.doesNotMatch(html, /usually next|usual<|data-state="ahead"|data-tone="ahead"/, 'no usual or ahead chip');
    assert.doesNotMatch(html, GUESS);
  });

  test('the task-page track HTML carries no ahead stage row', () => {
    const html = renderTaskTrack(modelOf('LIN-23', [doneLoop('research', { issueIdentifier: 'LIN-23' })]), { now: NOW });
    assert.doesNotMatch(html, /task-page-stage-ahead|usually next/);
  });
});

describe('W-C a parent rolls its children up as counts', () => {
  test('one running child of three reads "1 of 3 running" (the ticket\'s example)', () => {
    const rolled = rollUpRow({}, [childOf('LIN-31', RUNNING), childOf('LIN-32'), childOf('LIN-33')]);
    assert.equal(rolled.state, 'running');
    assert.equal(rolled.words, '1 of 3 running');
  });

  test('a failed child, with nothing that needs you, reads "a subtask failed"', () => {
    const rolled = rollUpRow({}, [childOf('LIN-34'), childOf('LIN-35', FAILED)]);
    assert.equal(rolled.state, 'failed');
    assert.equal(rolled.words, 'a subtask failed');
  });

  test('two failed children read "2 subtasks failed"', () => {
    const rolled = rollUpRow({}, [childOf('LIN-36', FAILED), childOf('LIN-37', FAILED)]);
    assert.equal(rolled.words, '2 subtasks failed');
  });

  test('a Done child whose last stage failed does not roll up: the parent does not read failed', () => {
    const s = states([node('LIN-38', 'started', [node('LIN-39', 'completed')])], { 'LIN-39': [failedLoop('implementation', { issueIdentifier: 'LIN-39' })] });
    assert.equal(s.get('LIN-39').state, 'done', 'the child reads done on its own row');
    assert.notEqual(s.get('LIN-38').state, 'failed');
    assert.doesNotMatch(String(s.get('LIN-38').words), /subtask/);
  });

  test('end to end: a parent of three with one running child reads "1 of 3 running" on its row', () => {
    const s = states(
      [node('LIN-40', 'started', [node('LIN-41'), node('LIN-42'), node('LIN-43')])],
      { 'LIN-41': [loop({ issueIdentifier: 'LIN-41', kind: 'plan' })] },
    );
    assert.equal(s.get('LIN-40').words, '1 of 3 running');
  });
});

describe('W-D the opened box names every subtask that needs you, and agrees with the row', () => {
  test('two subtasks that need you are both named, and the row still reads needs you', () => {
    const children = [childOf('LIN-51', NEEDS_YOU), childOf('LIN-52', NEEDS_YOU), childOf('LIN-53')];
    const parent = rollUpRow({}, children);
    assert.equal(parent.state, 'needs-you');
    assert.equal(parent.attention.words, '2 subtasks need you: LIN-51, LIN-52');
  });

  test('two failed subtasks are both named in the box', () => {
    const parent = rollUpRow({}, [childOf('LIN-54', FAILED), childOf('LIN-55', FAILED)]);
    assert.equal(parent.attention.words, '2 subtasks failed: LIN-54, LIN-55');
  });

  test('a single subtask that needs you keeps the line it always had', () => {
    const parent = rollUpRow({}, [childOf('LIN-56', NEEDS_YOU), childOf('LIN-57')]);
    assert.equal(parent.attention.words, 'A subtask needs you: LIN-56');
  });
});

describe('W-E the offer is a fact: no usual-stage guess and no "comes next" for a task nothing ran on', () => {
  test('nextStepOf offers nothing for a never-run task or after research (no usual-stage guess)', () => {
    assert.equal(nextStepOf(modelOf('LIN-60', []).sessions, 'started'), null);
    assert.equal(nextStepOf(modelOf('LIN-61', [doneLoop('research', { issueIdentifier: 'LIN-61' })]).sessions, 'started'), null);
  });

  // LIN-3968 ruling (option a): a cancelled stage is offered again, as a fact and not a failure; run again and done, it clears.
  test('a stage whose latest session was undone is offered again, not as a failure; run again and done, it offers nothing', () => {
    const cancelled = loop({ issueIdentifier: 'LIN-62', kind: 'implementation', agentState: 'cancelled', terminalStatus: 'cancelled', historyStatus: 'resolved', resolvedAt: '2026-11-01T10:02:00.000Z' });
    const again = nextStepOf(modelOf('LIN-62', [cancelled]).sessions, 'started');
    assert.equal(again.kind, 'implementation');
    assert.equal(again.failed, false);
    const cleared = nextStepOf(modelOf('LIN-62', [cancelled, doneLoop('implementation', { issueIdentifier: 'LIN-62', loopId: 'l2' })]).sessions, 'started');
    assert.equal(cleared, null);
  });

  test('a failed stage is still offered as a fact (failed, again)', () => {
    const step = nextStepOf(modelOf('LIN-63', [failedLoop('implementation', { issueIdentifier: 'LIN-63' })]).sessions, 'started');
    assert.equal(step.failed, true);
    assert.equal(step.kind, 'implementation');
  });

  test('sessionSummaryOf carries no guessed next step for a never-run task (the field is gone)', () => {
    assert.equal('next' in sessionSummaryOf(modelOf('LIN-64', [])), false);
  });

  test('the "what comes next" line for a never-run task says nothing has run, not that a step comes next', () => {
    const model = modelOf('LIN-65', []);
    const taskState = states([node('LIN-65')], {}).get('LIN-65');
    const line = renderNextLine(model, { taskState });
    const text = line.replace(/<[^>]+>/g, ''); // the visible words; the element's data-testid is not a word on the page
    assert.doesNotMatch(text, GUESS);
    assert.match(text, /Nothing has run on this task yet\./);
  });
});

describe('W-F the 30-day window holds for the row; the strip keeps a 32-day-old session, dated', () => {
  // Home's gather applies the window (lib/home-row-states.js over lib/read-horizon.js), as lin-4069 does.
  test('a task whose only session is 32 days old reads never run on its row', async () => {
    const old = failedLoop('implementation', { issueIdentifier: 'LIN-70', dispatchedAt: OLD, takenAt: OLD, resolvedAt: OLD, terminalCompletedAt: OLD });
    const homeRowStates = createHomeRowStates({
      getLoopsForWorkspace: async () => [old].filter((l) => inReadWindow(l.dispatchedAt, NOW)),
      dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, now: () => NOW,
    });
    const home = await homeRowStates({ urlKey: 'acme', issues: [node('LIN-70').issue], runControls: true });
    assert.equal(home.states.get('LIN-70').state, 'todo');
    assert.equal(home.states.get('LIN-70').words, null);
  });

  test('the strip keeps that session, dated: the stage carries its start, not a window cut', () => {
    const old = failedLoop('implementation', { issueIdentifier: 'LIN-71', dispatchedAt: OLD, takenAt: OLD, resolvedAt: OLD, terminalCompletedAt: OLD });
    const model = modelOf('LIN-71', [old]);
    const stages = buildTaskStages(model.sessions, { trackerType: 'started' });
    assert.equal(stages.length, 1, 'the old session is still a stage');
    assert.ok(stages[0].startedAt, 'the stage is dated');
  });
});
