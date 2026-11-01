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
import { buildInProgressCountParts, rowRecordOf } from '../../lib/task-board-view.js';
import { rulingStandingOf } from '../../lib/unanswered-decisions.js';
import { renderHomeStatus } from '../../lib/render-task-page.js';
import { pageStatusOf } from '../../lib/task-state.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { heldTaskFacts, heldLoaderDeps } from '../fixtures/held-task-facts.js';

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

// The loader for one task's stored loops, the same loader the route calls. LIN-4070: `/state` reads the held set, so the
// task's tracker issue is held (complete) beside its loops.
function loaderFor(loops, node) {
  return createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting,
    getLoopsForIssue: async () => loops, getLoopsForIssues: async () => loops, now: () => NOW,
    ...heldLoaderDeps(heldTaskFacts({ issues: [node.issue], now: NOW })),
  });
}

// Every surface's answer for one scenario.
async function surfacesOf({ loops, trackerType }) {
  const node = rowNode(trackerType);
  const rowStates = buildRowStates({
    roots: [node], loopsByIdentifier: new Map([[ID, loops]]), enrichLoop, deriveSessionWaiting, now: NOW, sessionsVisible: true,
  });
  const row = rowStates.get(ID);
  const { model, taskState } = await loaderFor(loops, node).loadTaskState({ urlKey: URL_KEY, identifier: ID });
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
  { name: 'idle: no sessions yet', loops: [], trackerType: 'started', expect: { state: 'todo' } },
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
  // LIN-4016 (review finding 2): an older running Build with a newer queued Review. The worker holds the Build, so the
  // Build is the stage every surface names, and Stop targets it.
  {
    name: 'a running Build with a newer queued Review: the running stage is the one named',
    loops: [loop({ loopId: 'b1', lineageId: 'b1' }), queuedLoop({ loopId: 'v1', lineageId: 'v1', kind: 'review' })],
    trackerType: 'started', expect: { state: 'running' },
  },
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
    assert.equal(pageStatusOf(s.taskState), 'waiting', 'the gathered state reads waiting, so the task page polls at the waiting cadence');
    assert.equal(s.summary.running, null);
    assert.equal(s.summary.queued, null);
    assert.equal(s.summary.busy, true, 'busy stays true: the wake is unended');
  });

  test('a running Build with a newer queued Review: the header, the row, /state and the summary all name the Build', async () => {
    const s = await surfacesOf(OWN_SCENARIOS[OWN_SCENARIOS.length - 1]);
    assert.match(s.model.sentence, /^Build running/, 'the header names the running stage');
    assert.match(s.row.words, /^Build running/, 'the row names the running stage');
    assert.match(s.taskState.words, /^Build running/, '/state names the running stage');
    assert.equal(s.summary.running.kind, 'implementation', 'Stop targets the running Build, not the queued Review');
    assert.equal(s.summary.queued, null, 'the queued Review is not the session the task is working on');
  });

  test('queued with no ruling is live and queued, so the task page polls fast', async () => {
    const s = await surfacesOf(OWN_SCENARIOS[2]);
    assert.equal(s.model.live, true);
    assert.equal(pageStatusOf(s.taskState), 'running', 'the page status is the gathered running state');
  });
});

describe('LIN-4016 W1 / LIN-4070 D2 — a tracker-decided state: the row, /state and the page-load record agree', () => {
  // LIN-4070 reverses LIN-4016 decision 5: every surface gets the tracker type, so `/state` decides done and backlog
  // exactly as the row does. The tracker decides finished; a failed stage on a finished task is history (it reads done).
  test('a finished task: the row, /state and the page-load record all say done', async () => {
    const s = await surfacesOf({ loops: [doneLoop('implementation')], trackerType: 'completed' });
    assert.equal(s.row.state, 'done');
    assert.equal(s.taskState.state, 'done', '/state reads the same tracker word as the row');
    assert.equal(s.pageModel.finished, true, 'the page-load record reads the same tracker word');
    assert.equal(s.taskState.action.kind, 'none', 'a finished task offers no run (LIN-4042): the no-run decision');
  });

  test('a backlog task: the row, /state and the record all say backlog', async () => {
    const s = await surfacesOf({ loops: [], trackerType: 'backlog' });
    assert.equal(s.row.state, 'backlog');
    assert.equal(s.taskState.state, 'backlog');
  });

  // A finished task whose last stage failed (plan decision 2): the tracker decides finished, so the row and /state say
  // done, and the failure is history that rolls nothing up to a parent.
  // LIN-4071: the record carries the action and the copy-first words only; the opened task's pill is `/state`'s (the
  // gather's), which `renderHomeStatus` paints from the decided state. These pin the pill the box paints.
  test('a finished task whose last stage failed: the row, /state and the opened task say done, and no run is offered', async () => {
    const s = await surfacesOf({ loops: [failedLoop('implementation')], trackerType: 'completed' });
    assert.equal(s.row.state, 'done');
    assert.equal(s.taskState.state, 'done', '/state reads the tracker word, as the row does');
    assert.deepEqual(pillOf(renderHomeStatus(s.pageModel, { taskState: s.taskState })), { word: 'done', tone: 'done' }, 'the opened task paints the decided word');
    assert.equal(rowRecordOf({ stateType: 'completed', decided: s.taskState }).action.kind, 'none');
  });

  test('a finished task whose last stage succeeded: the row and the opened task say done, and no step is offered', async () => {
    const s = await surfacesOf({ loops: [doneLoop('implementation')], trackerType: 'completed' });
    assert.equal(s.row.state, 'done');
    assert.deepEqual(pillOf(renderHomeStatus(s.pageModel, { taskState: s.taskState })), { word: 'done', tone: 'done' });
    // The route sends the gathered action (`taskState.action`, the no-run decision here), not the summary's own rule (LIN-4068 D7).
    assert.equal(rowRecordOf({ stateType: 'completed', decided: s.taskState }).action.kind, 'none', 'a finished task offers no stage step');
  });

  test('a backlog task: the opened task says backlog, the word its row says', async () => {
    const s = await surfacesOf({ loops: [], trackerType: 'backlog' });
    assert.deepEqual(pillOf(renderHomeStatus(s.pageModel, { taskState: s.taskState })), { word: 'backlog', tone: 'backlog' });
  });

  test('a running task paints no pill on the opened task (the running box says it), and its record carries the gathered action only', async () => {
    const s = await surfacesOf({ loops: [loop()], trackerType: 'started' });
    assert.equal(renderHomeStatus(s.pageModel, { taskState: s.taskState }), '');
    assert.deepEqual(Object.keys(rowRecordOf({ stateType: 'started', decided: s.row })).sort(), ['action', 'copyStep', 'trackerWord']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// LIN-4103 — the agreement table across a TREE. A parent's row, the count line, the opened box (`/state`'s `attention`)
// and `/state` itself all draw the one decided state: nothing re-derives it per surface. Each scenario is a small tree
// of stored loops, run through the same surfaces as above: the row (`buildRowStates`, which the Home gather mirrors),
// `/state` (`loadTaskState` over a held subtree, the gatherer's answer), and the count line.
// ---------------------------------------------------------------------------------------------------------------------

const TREE_ROOT = 'LIN-90';

/** A tree node: `{id, type, loops, children}`. `loops` are the node's own stored loops. */
const treeNode = (id, type = 'started', loops = [], children = []) => ({ id, type, loops, children });
const own = (id, make, ...args) => make(...args, { issueIdentifier: id, loopId: `${id}-l`, lineageId: `${id}-l` });
const ownRuling = (id) => rulingLoop({
  issueIdentifier: id, loopId: `${id}-r`, lineageId: `${id}-r`,
  decision: { decision_id: `d-${id}`, question: `Which way for ${id}?` },
});

function flatten(node, parent = null, out = []) {
  out.push({ node, parent });
  for (const child of node.children) flatten(child, node, out);
  return out;
}

function nodeOf({ id, type, children }, parent = null) {
  return {
    issue: {
      id: `id-${id}`, identifier: id, title: `Title of ${id}`, state: { name: type, type },
      ...(parent ? { parent: { id: `id-${parent.id}` } } : {}),
    },
    children: children.map((child) => nodeOf(child, { id })),
    depth: 0,
  };
}

/** Every surface's answer for one tree: the root's row, `/state`, the box line, and the Home count line. */
async function treeSurfacesOf(tree, { held = true } = {}) {
  const flat = flatten(tree);
  const loopsById = new Map(flat.map(({ node }) => [node.id, node.loops]));
  const allLoops = flat.flatMap(({ node }) => node.loops);
  const rootNode = nodeOf(tree);
  const rowStates = buildRowStates({
    roots: [rootNode], loopsByIdentifier: loopsById, enrichLoop, deriveSessionWaiting, now: NOW, sessionsVisible: true,
  });
  const issues = [];
  (function collect(n) { issues.push(n.issue); n.children.forEach(collect); })(rootNode);
  const loader = createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting,
    getLoopsForIssue: async (_url, id) => loopsById.get(id) || [],
    getLoopsForIssues: async (_url, ids) => ids.flatMap((id) => loopsById.get(id) || []),
    now: () => NOW,
    ...(held
      ? heldLoaderDeps(heldTaskFacts({ issues, now: NOW }))
      : heldLoaderDeps(heldTaskFacts({ issues, now: NOW, readAt: new Date(NOW.getTime() + 60 * 60 * 1000) }))),
  });
  const { taskState, incomplete } = await loader.loadTaskState({ urlKey: URL_KEY, identifier: tree.id });
  const rulingCount = rulingStandingOf({ urlKey: URL_KEY, loops: allLoops }, { now: NOW, enrichLoop }).rows.length;
  return {
    row: rowStates.get(tree.id),
    rowOf: (id) => rowStates.get(id),
    taskState,
    incomplete,
    rulingCount,
    count: buildInProgressCountParts([{ projectName: 'P', roots: [rootNode] }], rowStates, { rulingCount }).map((p) => p.text),
  };
}

const TREE_SCENARIOS = [
  {
    name: 'a parent with a running grandchild',
    tree: () => treeNode(TREE_ROOT, 'started', [], [
      treeNode('LIN-91', 'started', [], [treeNode('LIN-92', 'started', [own('LIN-92', loop)])]),
      treeNode('LIN-93'),
    ]),
    expect: { state: 'running', count: ['1 running'] },
  },
  {
    name: 'a parent with two subtasks that need you',
    tree: () => treeNode(TREE_ROOT, 'started', [], [
      treeNode('LIN-91', 'started', [ownRuling('LIN-91')]),
      treeNode('LIN-92', 'started', [ownRuling('LIN-92')]),
      treeNode('LIN-93'),
    ]),
    expect: { state: 'needs-you', count: ['2 waiting on you'], attention: ['LIN-91', 'LIN-92'] },
  },
  {
    name: 'a parent with one failed open subtask',
    tree: () => treeNode(TREE_ROOT, 'started', [], [
      treeNode('LIN-91', 'started', [own('LIN-91', failedLoop, 'implementation')]),
      treeNode('LIN-92'),
    ]),
    expect: { state: 'failed', words: 'a subtask failed', count: ['1 failed'], attention: ['LIN-91'] },
  },
  {
    name: 'a parent with two failed open subtasks',
    tree: () => treeNode(TREE_ROOT, 'started', [], [
      treeNode('LIN-91', 'started', [own('LIN-91', failedLoop, 'implementation')]),
      treeNode('LIN-92', 'started', [own('LIN-92', failedLoop, 'plan')]),
    ]),
    expect: { state: 'failed', words: '2 subtasks failed', count: ['1 failed'], attention: ['LIN-91', 'LIN-92'] },
  },
  {
    name: 'a Done child whose last stage failed: it reads done and rolls nothing up',
    tree: () => treeNode(TREE_ROOT, 'started', [], [
      treeNode('LIN-91', 'completed', [own('LIN-91', failedLoop, 'implementation')]),
    ]),
    expect: { state: 'todo', words: null, count: [], childState: { 'LIN-91': 'done' } },
  },
];

describe('LIN-4103 — a parent\'s row, /state, the opened box and the count line agree (the cross-surface table)', () => {
  for (const scenario of TREE_SCENARIOS) {
    test(`${scenario.name}: one decided state on every surface`, async () => {
      const s = await treeSurfacesOf(scenario.tree());
      assert.ok(s.taskState, 'the held subtree is complete, so /state answers');
      // The row and /state carry the same decided state, words, tone and box line.
      assert.equal(s.taskState.state, s.row.state, 'state');
      assert.equal(s.taskState.words, s.row.words, 'words');
      assert.equal(s.taskState.tone, s.row.tone, 'tone');
      assert.deepEqual(s.taskState.attention ?? null, s.row.attention ?? null, 'the opened box line is the row\'s');

      // The expectation is the plan's fixture table, so a surface that agrees on a wrong answer still fails.
      assert.equal(s.row.state, scenario.expect.state);
      if ('words' in scenario.expect) assert.equal(s.row.words, scenario.expect.words);
      assert.deepEqual(s.count, scenario.expect.count, 'the count line');
      for (const [id, state] of Object.entries(scenario.expect.childState || {})) assert.equal(s.rowOf(id).state, state, `${id}'s own row`);

      // The box names exactly the subtasks whose own rows carry the state it announces.
      if (scenario.expect.attention) {
        // One subtask is the line's own `identifier`; several are its `subtasks` list.
        const line = s.taskState.attention;
        const named = line.subtasks ? line.subtasks.map((x) => x.identifier) : [line.identifier];
        assert.deepEqual(named, scenario.expect.attention, 'the box names every subtask');
        for (const id of named) assert.ok(['needs-you', 'failed'].includes(s.rowOf(id).state), `${id} is a subtask whose own row says so`);
      } else {
        assert.equal(s.taskState.attention ?? null, null, 'no subtask line when no subtask needs you or failed');
      }

      // The count line counts the root's own decided state, and the waiting number is the rulings the surfaces share.
      assert.equal(s.count.includes('1 running'), s.row.state === 'running');
      assert.equal(s.count.includes('1 failed'), s.row.state === 'failed');
      const waiting = s.count.find((t) => t.includes('waiting on you'));
      assert.equal(waiting ? Number.parseInt(waiting, 10) : 0, s.rulingCount, 'the count line is the ruling count');
    });
  }

  test('a cold held set: /state says it has not read yet, and invents no state; the row is the gather\'s alone', async () => {
    const s = await treeSurfacesOf(TREE_SCENARIOS[1].tree(), { held: false });
    assert.equal(s.taskState, null, '/state carries no state when the held set is not fresh');
    assert.equal(typeof s.incomplete, 'string', 'it names why');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// LIN-4104 D1 — busy is its own propagated fact (review note 1). A child whose own stage failed rolls up to `failed`
// with `running: false`, so a read of the rolled flags hides the running grandchild under it. The parent must still
// offer no run, on its row and on `/state`, and both must carry the same busy fact.
// ---------------------------------------------------------------------------------------------------------------------

describe('LIN-4104 D1 — busy over the subtree is not read off the rolled state (a failed node cannot hide a running descendant)', () => {
  // LIN-90 (parent) → LIN-91 (its own failed stage, so it rolls up to failed) → LIN-92 (the grandchild running or queued).
  const failedParentTree = (grandchildLoop) => treeNode(TREE_ROOT, 'started', [], [
    treeNode('LIN-91', 'started', [own('LIN-91', failedLoop, 'implementation')], [
      treeNode('LIN-92', 'started', [own('LIN-92', grandchildLoop)]),
    ]),
    treeNode('LIN-93'),
  ]);

  for (const [name, grandchildLoop] of [['running', loop], ['queued', queuedLoop]]) {
    test(`parent whose failed subtask has a ${name} subtask: no run is offered on the row or on /state, and both say busy`, async () => {
      const s = await treeSurfacesOf(failedParentTree(grandchildLoop));
      assert.equal(s.row.state, 'failed', 'the parent rolls up to failed, the case that hides the running grandchild');
      assert.equal(s.row.action?.kind, 'busy', 'the row names the run in flight over a running descendant, and offers none');
      assert.equal(s.row.action.identifier, 'LIN-92', 'the busy line names the grandchild that runs');
      assert.ok(s.taskState, 'the held subtree is complete, so /state answers');
      assert.equal(s.taskState.action?.kind, 'busy', '/state offers no run over a running descendant');
      assert.equal(s.row.busy, true, 'the row carries busy: the subtree has a running or queued session');
      assert.equal(s.taskState.busy, true, '/state carries the same busy fact as the row');
    });
  }
});

describe('LIN-4104 D1 — the offer kinds on the row and on /state (answer-first names the subtasks, a finished task offers none)', () => {
  test('a parent with two subtasks that need you: answer-first names both, on the row and on /state', async () => {
    const scenario = TREE_SCENARIOS.find((x) => x.name === 'a parent with two subtasks that need you');
    const s = await treeSurfacesOf(scenario.tree());
    assert.equal(s.row.action.kind, 'answer-first');
    assert.deepEqual(s.row.action.identifiers, ['LIN-91', 'LIN-92'], 'the box leads with each question');
    assert.deepEqual(s.taskState.action, s.row.action, '/state sends the same decision');
  });

  test('a parent whose only subtask is Done (a finished leaf under it) offers the run control; the Done child offers none', async () => {
    const scenario = TREE_SCENARIOS.find((x) => x.name === 'a Done child whose last stage failed: it reads done and rolls nothing up');
    const s = await treeSurfacesOf(scenario.tree());
    assert.equal(s.rowOf('LIN-91').action.kind, 'none', 'a finished child offers no run (LIN-4042)');
    assert.equal(s.row.action.kind, 'offer', 'the parent counts open work and offers the run control');
  });
});
