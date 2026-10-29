/**
 * LIN-4024 step 1 (state): Home says what needs you the same way everywhere.
 *
 * Witnesses: the precedence of one task state (`taskStateOf`); the LIN-4011/4012 shape from the ticket, with a
 * queued wake behind an open ruling, read the way Home reads it (rows, count line, the task's summary) and
 * agreeing with the badge's own reduction on the same inputs; a shelved ruling reads parked and leaves the count;
 * a task-scan decision needs you and counts; and the opened task reads a ruling only inside the 30-day window.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRowStates, buildTaskPageModel, createTaskPageLoader, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { buildInProgressCountParts } from '../../lib/task-board-view.js';
import { collectUnansweredDecisions, rulingStandingOf } from '../../lib/unanswered-decisions.js';
import { taskStateOf } from '../../lib/task-state.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-29T12:00:00.000Z');
const URL_KEY = 'acme';

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-50', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-29T10:00:00.000Z', takenAt: '2026-10-29T10:01:00.000Z', resolvedAt: '2026-10-29T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
// A worker waiting on a structured ruling (a `[decision]` plus `[blocked]`), the way LIN-4011/4012 wait.
const ruling = (over = {}) => loop({
  wakeMarker: 'blocked', waitingMessage: '[blocked] re-dispatch?',
  feedback: [{ message: '[blocked] re-dispatch?', timestamp: '2026-10-29T10:05:00.000Z' }],
  decision: { decision_id: 'd-1', question: 'Re-dispatch the cancelled research?' }, decisionCase: [],
  answeredDecisions: [], withdrawal: null, ...over,
});
// An auto-enqueued check-in behind the ruling: queued, not running (the LIN-4011 case).
const queuedWake = (over = {}) => loop({
  loopId: 'wake-1', lineageId: 'wake-1', kind: 'check-in', agentState: 'queued', historyStatus: 'dispatched',
  takenAt: null, resolvedAt: null, ...over,
});

const node = (identifier, children = []) => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, state: { name: 'started', type: 'started' } },
  children,
  depth: 0,
});

const rulingsFor = (loops, opts = {}) => rulingStandingOf(
  { urlKey: URL_KEY, loops, ...opts },
  { now: NOW, enrichLoop }
);

describe('taskStateOf — one precedence for the row, the count and the task', () => {
  test('an open ruling is needs you, even over a failed stage and a running session', () => {
    const s = taskStateOf({ ownRuling: true, failed: { words: 'Build failed' }, running: { words: 'Build running' } });
    assert.equal(s.state, 'needs-you');
    assert.equal(s.words, 'needs you');
    assert.equal(s.running, false, 'a task that needs you is not counted as running');
  });

  test('a failed stage is failed, not running, when nothing waits on a person', () => {
    const s = taskStateOf({ failed: { words: 'Build failed' }, running: { words: 'Review running' } });
    assert.equal(s.state, 'failed');
    assert.equal(s.words, 'Build failed');
    assert.equal(s.tone, 'failed');
    assert.equal(s.needsYou, true, 'a failed task still needs a person (LIN-3968), so it ranks first');
  });

  test('running never includes queued: a queued session is queued, with its own words', () => {
    const s = taskStateOf({ queued: { words: 'Check-in queued' } });
    assert.equal(s.state, 'queued');
    assert.equal(s.running, false);
    assert.equal(s.queued, true);
    assert.equal(s.words, 'Check-in queued');
  });

  test('a parked task reads parked, beats its next step, and a backlog task keeps its backlog word', () => {
    assert.equal(taskStateOf({ parked: true, next: 'Research' }).words, 'parked');
    assert.equal(taskStateOf({ trackerWord: 'backlog', next: 'Research' }).words, 'backlog');
    assert.equal(taskStateOf({ next: 'Research' }).words, 'Research next');
    assert.equal(taskStateOf({ next: 'Research' }).tone, 'ready');
  });

  test('a subtask that needs you is named in needsYouTasks and does not change the parent\'s word', () => {
    const s = taskStateOf({ childNeedsYou: [{ identifier: 'LIN-1', title: 'one' }, { identifier: 'LIN-2', title: 'two' }] });
    assert.equal(s.words, 'needs you');
    assert.deepEqual(s.needsYouTasks.map((t) => t.identifier), ['LIN-1', 'LIN-2']);
    assert.equal(s.runOn, null, 'a parent waiting on answers offers no run target');
  });
});

describe('LIN-4024 — LIN-4011/4012 read the same on the row, the count and the summary', () => {
  // LIN-4008 (the parent) holds LIN-4011 and LIN-4012, each a worker waiting on its own ruling. LIN-4011 also has a
  // queued check-in behind its ruling.
  const loops = {
    'LIN-4011': [ruling({ loopId: 'r11', lineageId: 'r11', issueIdentifier: 'LIN-4011', kind: 'research', decision: { decision_id: 'lin4011-rc', question: 'Re-dispatch?' } }), queuedWake({ issueIdentifier: 'LIN-4011' })],
    'LIN-4012': [ruling({ loopId: 'r12', lineageId: 'r12', issueIdentifier: 'LIN-4012', kind: 'research', decision: { decision_id: 'lin4012-rc', question: 'Re-dispatch?' } })],
  };
  const flat = Object.values(loops).flat();
  const parent = node('LIN-4008', [node('LIN-4011'), node('LIN-4012')]);

  test('two rulings are open: the row, the count and the badge agree on two', () => {
    const ruling0 = rulingsFor(flat);
    const badge = collectUnansweredDecisions({ loops: flat.map((l) => ({ ...enrichLoop(l), workspaceUrlKey: URL_KEY })) }, { now: NOW });
    assert.equal(ruling0.rows.length, 2);
    assert.equal(badge.length, 2, 'the badge reads the same two rulings');

    const states = buildRowStates({
      roots: [parent],
      loopsByIdentifier: new Map(Object.entries(loops)),
      enrichLoop, deriveSessionWaiting, now: NOW, ruling: ruling0,
    });
    assert.equal(states.get('LIN-4011').state, 'needs-you');
    assert.equal(states.get('LIN-4011').words, 'needs you', 'the queued check-in behind the ruling is not queued');
    assert.equal(states.get('LIN-4012').words, 'needs you');
    assert.equal(states.get('LIN-4008').words, 'needs you');
    assert.deepEqual(states.get('LIN-4008').needsYouTasks.map((t) => t.identifier), ['LIN-4011', 'LIN-4012']);
    assert.equal(states.get('LIN-4008').running, false);

    const parts = buildInProgressCountParts([{ projectName: 'P', roots: [parent] }], states, { rulingCount: ruling0.rows.length });
    assert.deepEqual(parts.map((p) => p.text), ['2 waiting on you'], 'the summary says two rulings and nothing is running');
  });

  test('the opened task: a queued check-in behind a ruling is not running, and the task is waiting on the ruling', () => {
    const ruling0 = rulingsFor(flat);
    const model = buildTaskPageModel({
      identifier: 'LIN-4011', loops: loops['LIN-4011'], ctx: null, enrichLoop, deriveSessionWaiting, ruling: ruling0, now: NOW,
    });
    assert.equal(model.waitingFor, 'ruling');
    assert.equal(sessionSummaryOf(model).running, null, 'the queued check-in is not the running session');
  });

  test('a shelved ruling reads parked, is not needs you, and leaves the count and the badge', () => {
    const shelved = [{ urlKey: URL_KEY, decisionId: 'lin4012-rc', decisionLoopId: 'r12', resurfaceAt: '2026-11-05T00:00:00.000Z' }];
    const ruling0 = rulingsFor(flat, { shelvedRulings: shelved });
    const badge = collectUnansweredDecisions(
      { loops: flat.map((l) => ({ ...enrichLoop(l), workspaceUrlKey: URL_KEY })), shelvedRulings: shelved },
      { now: NOW }
    );
    assert.equal(ruling0.rows.length, 1);
    assert.equal(badge.length, 1, 'the badge hides the shelved ruling too');

    const states = buildRowStates({ roots: [parent], loopsByIdentifier: new Map(Object.entries(loops)), enrichLoop, deriveSessionWaiting, now: NOW, ruling: ruling0 });
    assert.equal(states.get('LIN-4012').state, 'parked');
    assert.equal(states.get('LIN-4012').needsYou, false);
    assert.equal(states.get('LIN-4011').state, 'needs-you');
  });

  test('a task-scan decision needs you and counts; a shelved one reads parked and does not', () => {
    const scan = {
      id: 'scan-1', urlKey: URL_KEY, issueId: 'uuid-4013', issueIdentifier: 'LIN-4013', scannedAt: '2026-10-29T10:02:00.000Z', outcome: null,
      decision: { decision_id: 'td-1', question: 'Split this task?' },
    };
    const open = rulingsFor([], { taskDecisions: [scan] });
    const roots = [node('LIN-4013')];
    const openStates = buildRowStates({ roots, loopsByIdentifier: new Map(), enrichLoop, deriveSessionWaiting, now: NOW, ruling: open });
    assert.equal(openStates.get('LIN-4013').state, 'needs-you');
    assert.equal(open.rows.length, 1);

    const shelvedRulings = [{ urlKey: URL_KEY, decisionId: 'td-1', resurfaceAt: '2026-11-05T00:00:00.000Z' }];
    const shelved = rulingsFor([], { taskDecisions: [scan], shelvedRulings });
    const shelvedStates = buildRowStates({ roots, loopsByIdentifier: new Map(), enrichLoop, deriveSessionWaiting, now: NOW, ruling: shelved });
    assert.equal(shelvedStates.get('LIN-4013').state, 'parked');
    assert.equal(shelved.rows.length, 0);
  });
});

describe('LIN-4024 — the opened task reads the same 30-day window as the rows and the badge', () => {
  const emptyStores = {
    taskDecisionsStore: { async listUnansweredForWorkspaces() { return []; }, async listNewestScanPerTask() { return {}; } },
    shelvedRulingsStore: { async listForWorkspaces() { return []; } },
  };
  const loaderFor = (loops) => createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting,
    getLoopsForIssue: async () => loops, now: () => NOW, ...emptyStores,
  });

  test('an open ruling inside the window is needs you on the opened task and in /state', async () => {
    const { model } = await loaderFor([ruling({ loopId: 'in-1', lineageId: 'in-1', issueIdentifier: 'LIN-4030', dispatchedAt: '2026-10-25T10:00:00.000Z' })])
      .loadTaskState({ urlKey: URL_KEY, identifier: 'LIN-4030' });
    assert.equal(model.waitingFor, 'ruling');
  });

  test('a ruling older than the read window is history, not a question: parked, as the rows and badge read it', async () => {
    const { model } = await loaderFor([ruling({ loopId: 'old-1', lineageId: 'old-1', issueIdentifier: 'LIN-4031', dispatchedAt: '2026-09-20T10:00:00.000Z' })])
      .loadTaskState({ urlKey: URL_KEY, identifier: 'LIN-4031' });
    assert.equal(model.waitingFor, 'parked');
  });
});
