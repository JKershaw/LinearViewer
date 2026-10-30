/**
 * LIN-4016 W1 — one state per task: Home's row, the count line, the opened task and `/state` agree.
 *
 * Each scenario is built from stored loops and run through the surfaces that show a task's state: the row
 * (`buildRowStates`), the `/state` read (the real loader's `loadTaskState`, which the route sends as `taskState`
 * and `sessions`), Home's pill (`renderHomeStatus`), the count line (`buildInProgressCountParts`) and the page-load
 * record (`buildTaskPageModel` with a tracker read).
 *
 * The contract (plan decision 5): `/state` carries the task's OWN state and no tracker word. So for every state the
 * tracker does not decide, the row and `/state` agree on state, words and tone. For done and backlog the row says
 * what the tracker says and `/state` says nothing tracker-driven: the test asserts only that the row and the
 * page-load record agree and that `/state.taskState` carries no tracker word.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRowStates, buildTaskPageModel, createTaskPageLoader, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { buildInProgressCountParts } from '../../lib/task-board-view.js';
import { rulingStandingOf } from '../../lib/unanswered-decisions.js';
import { renderHomeStatus } from '../../lib/render-task-page.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-30T10:06:00.000Z');
const URL_KEY = 'acme';
const ID = 'LIN-90';

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
const queuedLoop = (over = {}) => loop({ agentState: 'queued', historyStatus: 'dispatched', takenAt: null, resolvedAt: null, ...over });
// A worker waiting on a structured ruling: the open question the badge counts.
const rulingLoop = (over = {}) => loop({
  wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
  feedback: [{ message: '[blocked] which way?', timestamp: '2026-10-30T10:05:00.000Z' }],
  decision: { decision_id: 'd-1', question: 'Which way?' }, decisionCase: [], answeredDecisions: [], withdrawal: null, ...over,
});
// A waiting session with no structured question: a park, not a ruling.
const parkLoop = (over = {}) => loop({
  wakeMarker: 'blocked', waitingMessage: '[blocked] waiting on the vendor',
  feedback: [{ message: '[blocked] waiting on the vendor', timestamp: '2026-10-30T10:05:00.000Z' }], ...over,
});
const doneLoop = (kind, over = {}) => loop({
  kind, agentState: 'done', terminalStatus: 'done', terminalCompletedAt: '2026-10-30T10:03:00.000Z',
  resolvedAt: '2026-10-30T10:03:00.000Z', historyStatus: 'resolved', ...over,
});
const failedLoop = (kind, over = {}) => loop({
  kind, agentState: 'failed', terminalStatus: 'failed', terminalCompletedAt: '2026-10-30T10:02:00.000Z',
  resolvedAt: '2026-10-30T10:02:00.000Z', historyStatus: 'resolved', ...over,
});

// The tracker word a task carries: a Linear state type. `started` is in progress; done and backlog are the two the
// tracker decides.
const TRACKER_TYPE = { started: 'started', completed: 'completed', backlog: 'backlog' };

const rowNode = (type) => ({
  issue: { id: `id-${ID}`, identifier: ID, title: 'The task', state: { name: type, type } },
  children: [],
  depth: 0,
});

// The loader for one task's stored loops, the same loader the route calls.
function loaderFor(loops) {
  return createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting,
    getLoopsForIssue: async () => loops, now: () => NOW,
  });
}

// Every surface's answer for one scenario.
async function surfacesOf({ loops, trackerType }) {
  const node = rowNode(trackerType);
  const rowStates = buildRowStates({
    roots: [node], loopsByIdentifier: new Map([[ID, loops]]), enrichLoop, deriveSessionWaiting, now: NOW, sessionsVisible: true,
  });
  const row = rowStates.get(ID);
  const { model, taskState } = await loaderFor(loops).loadTaskState({ urlKey: URL_KEY, identifier: ID });
  const pageModel = buildTaskPageModel({
    identifier: ID, loops, ctx: { issue: node.issue, parent: null, children: [] },
    enrichLoop, deriveSessionWaiting, now: NOW,
  });
  const rulingRows = rulingStandingOf({ urlKey: URL_KEY, loops }, { now: NOW, enrichLoop }).rows.length;
  return {
    row,
    taskState,
    model,
    pageModel,
    summary: sessionSummaryOf(model),
    home: renderHomeStatus(model, { now: NOW, taskState }),
    count: buildInProgressCountParts([{ projectName: 'P', roots: [node] }], rowStates, { rulingCount: rulingRows }),
  };
}

/** The pill word and tone Home's opened task paints (empty when it paints none). */
function pillOf(html) {
  if (!html) return null;
  const word = /status-pill__dot" aria-hidden="true"><\/span>([^<]+)<\/span>/.exec(html);
  const tone = /status-pill--([\w-]+)/.exec(html);
  return { word: word ? word[1] : null, tone: tone ? tone[1] : null };
}

// Scenarios the tracker does not decide: `/state` must equal the row, on state, words and tone.
const OWN_SCENARIOS = [
  { name: 'idle: no sessions yet', loops: [], trackerType: 'started', expect: { state: 'next' } },
  { name: 'running', loops: [loop()], trackerType: 'started', expect: { state: 'running' } },
  { name: 'queued, not behind a ruling', loops: [queuedLoop()], trackerType: 'started', expect: { state: 'queued' } },
  {
    name: 'queued behind an open ruling (the wake waits on the ruling)',
    loops: [rulingLoop({ loopId: 'r1', lineageId: 'r1' }), queuedLoop({ loopId: 'w1', lineageId: 'w1', kind: 'check-in' })],
    trackerType: 'started', expect: { state: 'needs-you' },
  },
  { name: 'waiting on an open ruling', loops: [rulingLoop()], trackerType: 'started', expect: { state: 'needs-you' } },
  { name: 'parked, no question', loops: [parkLoop()], trackerType: 'started', expect: { state: 'parked' } },
  { name: 'failed stage', loops: [failedLoop('implementation')], trackerType: 'started', expect: { state: 'failed', words: 'Build failed' } },
];

describe('LIN-4016 W1 — the states the tracker does not decide read the same on the row and on /state', () => {
  for (const scenario of OWN_SCENARIOS) {
    test(`${scenario.name}: the row, /state, the pill, the count line and the summary agree`, async () => {
      const s = await surfacesOf(scenario);
      // The row and /state carry the same decided state, words and tone.
      assert.equal(s.taskState.state, s.row.state, 'state');
      assert.equal(s.taskState.words, s.row.words, 'words');
      assert.equal(s.taskState.tone, s.row.tone, 'tone');
      if (scenario.expect.state) assert.equal(s.row.state, scenario.expect.state);
      if (scenario.expect.words) assert.equal(s.row.words, scenario.expect.words);

      // The session facts the summary and the model carry match the row's own reading of running and queued.
      const running = s.row.state === 'running';
      const queued = s.row.state === 'queued';
      assert.equal(s.model.live, running || queued, 'model.live counts a running or a queued (not behind a ruling) session');
      assert.equal(s.summary.running !== null, running || queued, 'sessions.running is the session Stop targets');
      assert.equal(s.summary.queued !== null, queued, 'sessions.queued is set only for a queued session');
      assert.equal(s.summary.busy, s.model.sessions.some((x) => ['running', 'queued', 'waiting'].includes(x.state)), 'busy: any session unended');

      // Home's pill: none while running or queued (the Go slot says it), else the row's own decision.
      const pill = pillOf(s.home);
      if (running || queued) {
        assert.equal(s.home, '', 'running and queued say nothing in the pill');
      } else if (s.row.state === 'needs-you') {
        assert.deepEqual(pill, { word: 'needs you', tone: 'needs-you' });
      } else if (s.row.state === 'parked') {
        assert.deepEqual(pill, { word: 'parked', tone: 'queued' });
      } else if (s.row.state === 'failed') {
        assert.deepEqual(pill, { word: 'failed', tone: 'error' });
      }

      // The count line counts a failed task as failed and never as waiting on you, and a running one as running.
      const texts = s.count.map((p) => p.text);
      assert.equal(texts.includes('1 failed'), s.row.state === 'failed');
      assert.equal(texts.includes('1 running'), running);
      assert.equal(texts.some((t) => t.includes('waiting on you')), s.row.state === 'needs-you' && s.model.waitingFor === 'ruling');
    });
  }

  test('queued behind an open ruling: the task waits on the ruling, so the model is not live and the summary has no running session (LIN-4024)', async () => {
    const s = await surfacesOf(OWN_SCENARIOS[3]);
    assert.equal(s.model.live, false, 'a queued wake behind a ruling is not live');
    assert.equal(s.model.status, 'waiting', 'the header reads waiting, so the task page polls at the waiting cadence');
    assert.equal(s.summary.running, null);
    assert.equal(s.summary.queued, null);
    assert.equal(s.summary.busy, true, 'busy stays true: the wake is unended');
  });

  test('queued with no ruling is live and queued, so the task page polls fast', async () => {
    const s = await surfacesOf(OWN_SCENARIOS[2]);
    assert.equal(s.model.live, true);
    assert.equal(s.model.status, 'running');
  });
});

describe('LIN-4016 W1 — a tracker-decided state: the row and the page-load record agree; /state carries no tracker word', () => {
  test('a finished task: the row says done, the page-load record is finished, and /state is tracker-free', async () => {
    const s = await surfacesOf({ loops: [doneLoop('implementation')], trackerType: 'completed' });
    assert.equal(s.row.state, 'done');
    assert.equal(s.pageModel.finished, true, 'the page-load record reads the same tracker word');
    assert.notEqual(s.taskState.state, 'done', '/state never says done: it has no tracker');
    assert.notEqual(s.taskState.state, 'backlog');
  });

  test('a backlog task: the row says backlog, and /state carries no tracker word', async () => {
    const s = await surfacesOf({ loops: [], trackerType: 'backlog' });
    assert.equal(s.row.state, 'backlog');
    assert.notEqual(s.taskState.state, 'backlog');
  });

  // The one accepted difference (plan decision 5, review note 1): a finished task whose last stage failed. The row
  // says done, because a finished task offers no next step and its failed stage is not offered again (LIN-3968). `/state`
  // has no tracker, so it says what its own sessions say: failed. The PR names this for review.
  test('a finished task whose last stage failed: the row says done, and /state says the task\'s own failure (named difference)', async () => {
    const s = await surfacesOf({ loops: [failedLoop('implementation')], trackerType: 'completed' });
    assert.equal(s.row.state, 'done');
    assert.equal(s.taskState.state, 'failed');
  });
});
