/**
 * LIN-4068 spike witness: one gather, every reader agrees.
 *
 * Each case runs through the real readers: Home's row (`createHomeRowStates`, with a store that windows the way the
 * lean workspace read does), `/state` (`createTaskPageLoader().loadTaskState` with the one gather injected, its own
 * loops whole-life) and the task page (`loadTaskPage`'s `taskState`). Then the same `/state` read WITHOUT the gather
 * (today's main) shows the disagreement the gather removes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPageLoader, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { createHomeRowStates, createTaskStateGather } from '../../lib/home-row-states.js';
import { inReadWindow } from '../../lib/read-horizon.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-31T10:00:00.000Z');
const URL_KEY = 'acme';
const daysAgo = (d, min = 0) => new Date(NOW.getTime() - d * 86400000 - min * 60000).toISOString();

let seq = 0;
function loop(id, over = {}) {
  const loopId = `l${++seq}`;
  const at = over.at || daysAgo(0, 30);
  delete over.at;
  return {
    loopId, lineageId: loopId, issueIdentifier: id, kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: at, takenAt: at, resolvedAt: at,
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
const ended = (status) => (id, kind, at) => loop(id, {
  kind, at, agentState: status, terminalStatus: status, terminalCompletedAt: at, historyStatus: 'resolved',
});
const done = ended('done');
const failed = ended('failed');
const running = (id, kind, at) => loop(id, { kind, at });

const issue = (identifier, type, parent = null, over = {}) => ({
  id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type },
  parent: parent ? { id: `id-${parent}` } : null, ...over,
});

/** Every reader's answer for one task, over one world (issues + loops). */
async function readersOf(world, identifier) {
  const { issues, loops } = world;
  const byId = (ids) => loops.filter((l) => ids.includes(l.issueIdentifier));
  // The stores: the lean workspace read and the batched read window to 30 days; the task's own read is whole-life.
  const windowed = (ls) => ls.filter((l) => inReadWindow(l.dispatchedAt, NOW));
  const homeRowStates = createHomeRowStates({
    getLoopsForWorkspace: async () => windowed(loops), dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, now: () => NOW,
  });
  const home = await homeRowStates({ urlKey: URL_KEY, issues, runControls: true });

  const gatherTaskState = createTaskStateGather({
    getIssueSet: async () => issues,
    getLoopsForIssues: async (_u, ids) => windowed(byId(ids)),
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, now: () => NOW,
  });
  const base = {
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, now: () => NOW,
    getLoopsForIssue: async (_u, id) => byId([id]),
    readTaskRunFacts: async () => ({ stopAt: null, variant: null }),
  };
  const loader = createTaskPageLoader({ ...base, gatherTaskState });
  const state = await loader.loadTaskState({ urlKey: URL_KEY, identifier });
  const target = issues.find((i) => i.identifier === identifier);
  const access = {
    callScope: null,
    provider: { fetchRecommendationContext: async () => ({ issue: target, parent: null, children: issues.filter((i) => i.parent?.id === target.id), comments: [] }) },
  };
  const page = await loader.loadTaskPage({ urlKey: URL_KEY, identifier, access });
  const mainState = await createTaskPageLoader(base).loadTaskState({ urlKey: URL_KEY, identifier });
  return {
    row: home.states.get(identifier)?.state,
    state: state.taskState?.state,
    page: page.taskState?.state,
    box: sessionSummaryOf(state.stateModel, { container: state.container }),
    history: state.model.sessions.length,
    main: { state: mainState.taskState.state, pill: (await createTaskPageLoader(base).loadTaskPage({ urlKey: URL_KEY, identifier, access })).model.status },
  };
}

const agree = (r, want) => {
  assert.equal(r.row, want, `Home row reads ${r.row}`);
  assert.equal(r.state, want, `/state reads ${r.state}`);
  assert.equal(r.page, want, `task page reads ${r.page}`);
};

describe('LIN-4068: one gather, the row, /state and the task page agree', () => {
  test('old sessions: Build failed 45 days ago reads next everywhere; history keeps the old sessions', async () => {
    const world = {
      issues: [issue('T-1', 'started')],
      loops: [done('T-1', 'research', daysAgo(46)), failed('T-1', 'implementation', daysAgo(45))],
    };
    const r = await readersOf(world, 'T-1');
    agree(r, 'next');
    assert.equal(r.history, 2, 'the history still lists both sessions');
    assert.equal(r.box.action.kind, 'step');
    assert.equal(r.box.action.step.kind, 'research', 'the box offers the step its state names, not "Build again"');
    assert.equal(r.main.state, 'failed', 'today: /state reads the 45-day-old failure');
  });

  test('Done subtask whose last run failed reads done; its parent rolls up nothing from it', async () => {
    const world = {
      issues: [issue('P-2', 'started'), issue('C-2', 'completed', 'P-2')],
      loops: [done('C-2', 'implementation', daysAgo(2)), failed('C-2', 'review', daysAgo(1))],
    };
    agree(await readersOf(world, 'C-2'), 'done');
    const parent = await readersOf(world, 'P-2');
    assert.notEqual(parent.row, 'failed');
    assert.equal(parent.row, parent.state);
    assert.equal(parent.row, parent.page);
    assert.equal((await readersOf(world, 'C-2')).main.state, 'failed', 'today: /state says failed beside a done row');
  });

  test('Done subtask with a running close-out makes its parent read running everywhere', async () => {
    const world = {
      issues: [issue('P-5', 'started'), issue('C-5', 'completed', 'P-5')],
      loops: [done('C-5', 'implementation', daysAgo(1)), running('C-5', 'close-out', daysAgo(0, 5))],
    };
    agree(await readersOf(world, 'P-5'), 'running');
  });

  test('three levels under a Backlog parent, a subtask in another project: the grandchild runs, the parent reads running', async () => {
    const world = {
      issues: [
        issue('P-3', 'backlog', null, { project: { id: 'proj-a' } }),
        issue('C-3', 'unstarted', 'P-3', { project: { id: 'proj-b' }, assignee: { name: 'Sam' } }),
        issue('G-3', 'started', 'C-3', { project: { id: 'proj-b' } }),
      ],
      loops: [running('G-3', 'implementation', daysAgo(0, 10))],
    };
    const r = await readersOf(world, 'P-3');
    agree(r, 'running');
    assert.notEqual(r.main.state, 'running', `today: /state reads ${r.main.state}`);
    assert.notEqual(r.main.pill, 'running', `today: the page pill reads ${r.main.pill}`);
    agree(await readersOf(world, 'C-3'), 'running');
  });
});
