/**
 * LIN-4049 (LIN-4040 S1, beat 2): `/state` decides the opened box over the subtree the server built.
 *
 * `/state` has no tracker read, so the client sends back the subtree (`parseSubtreeHint`), and the server rebuilds it
 * (`subtreeFromHint`) in the index's shape and child order, reads each descendant's sessions once, reads rulings once,
 * and rolls the row state up with the same `buildRowStates` Home reads (`loadTaskState`).
 *
 * Witnesses: the hint is validated and an invalid entry is dropped; the rebuilt tree has the index's order; a running
 * grandchild blocks its parent's box, and the parent's row and box agree; the attention line names the first failed
 * subtask by identifier order; each descendant's store read happens once, and the rulings are read once per poll; over
 * the cap nothing below the root is read and the box fails closed; `/state` and Home's row states name the same state.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubtreeIndex, parseSubtreeHint, subtreeFromHint, SUBTREE_READ_CAP } from '../../lib/subtree-index.js';
import { createTaskPageLoader, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { createHomeRowStates } from '../../lib/home-row-states.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-30T10:06:00.000Z');

const issue = (identifier, { parentId = null, type = 'unstarted' } = {}) => ({
  id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type },
  ...(parentId ? { parent: { id: parentId, identifier: null } } : {}),
});

// A session of one task's, by identifier. `over` sets the state; the defaults are a running stage.
function loop(identifier, over = {}) {
  return {
    loopId: `${identifier}-l`, lineageId: `${identifier}-l`, issueIdentifier: identifier, kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z', resolvedAt: '2026-10-30T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
const runningLoop = (identifier) => loop(identifier);
const failedLoop = (identifier) => loop(identifier, {
  kind: 'implementation', agentState: 'failed', terminalStatus: 'failed', terminalCompletedAt: '2026-10-30T10:02:00.000Z',
  resolvedAt: '2026-10-30T10:02:00.000Z', historyStatus: 'resolved',
});

/** The store stubs the loader takes, and a counter of every read, so a test can say how many times each one ran. */
function stores(loopsByIdentifier) {
  const reads = { loops: new Map(), rulings: 0 };
  const getLoopsForIssue = async (_urlKey, identifier) => {
    reads.loops.set(identifier, (reads.loops.get(identifier) || 0) + 1);
    return loopsByIdentifier[identifier] || [];
  };
  const taskDecisionsStore = {
    listUnansweredForWorkspaces: async () => { reads.rulings += 1; return []; },
    listNewestScanPerTask: async () => ({}),
  };
  const shelvedRulingsStore = { listForWorkspaces: async () => [] };
  return { reads, getLoopsForIssue, taskDecisionsStore, shelvedRulingsStore };
}

const loaderWith = (loopsByIdentifier) => {
  const s = stores(loopsByIdentifier);
  const loader = createTaskPageLoader({
    enrichLoop, deriveSessionWaiting, getLoopsForIssue: s.getLoopsForIssue,
    taskDecisionsStore: s.taskDecisionsStore, shelvedRulingsStore: s.shelvedRulingsStore, now: () => NOW,
  });
  return { loader, reads: s.reads };
};

/** The identifiers of a subtree, parents before children, in order: the shape two trees must share. */
const shapeOf = (nodes) => nodes.map((n) => [n.issue.identifier, shapeOf(n.children)]);

/** The index's edges as the client sends them: `[parent, child, stateType]`, one per child. */
function edgesOf(roots) {
  const out = [];
  const walk = (node) => node.children.forEach((child) => {
    out.push([node.issue.identifier, child.issue.identifier, child.issue.state.type]);
    walk(child);
  });
  roots.forEach(walk);
  return out;
}

describe('LIN-4049 — the hint the client sends back is validated', () => {
  test('a well-formed entry is kept, in the order sent, and the read is complete', () => {
    const { edges, incomplete } = parseSubtreeHint(JSON.stringify({ edges: [['LIN-1', 'LIN-2', 'started'], ['LIN-2', 'LIN-3', 'unstarted']] }));
    assert.equal(incomplete, false);
    assert.deepEqual(edges, [
      { parent: 'LIN-1', child: 'LIN-2', type: 'started' },
      { parent: 'LIN-2', child: 'LIN-3', type: 'unstarted' },
    ]);
  });

  test('an invalid identifier or an unknown state type is dropped, the rest is kept, and the read is incomplete', () => {
    const { edges, incomplete } = parseSubtreeHint(JSON.stringify({ edges: [
      ['LIN-1', 'bad id!', 'started'],
      ['LIN-1', 'LIN-2', 'not-a-state'],
      ['LIN-1', 'LIN-3', 'completed'],
    ] }));
    assert.equal(incomplete, true, 'a dropped entry may hide a running subtask, so the box fails closed');
    assert.deepEqual(edges, [{ parent: 'LIN-1', child: 'LIN-3', type: 'completed' }]);
  });

  test('a hint that is not JSON, has no edges list, or is not triples is incomplete; no parameter is a leaf', () => {
    assert.deepEqual(parseSubtreeHint('{not json'), { edges: [], incomplete: true });
    assert.deepEqual(parseSubtreeHint('{"a":1}'), { edges: [], incomplete: true });
    assert.deepEqual(parseSubtreeHint(JSON.stringify({ edges: [['LIN-1', 'LIN-2']] })), { edges: [], incomplete: true });
    assert.deepEqual(parseSubtreeHint(undefined), { edges: [], incomplete: false }, 'no subtree is a leaf, not incomplete');
  });
});

describe('LIN-4049 — the rebuilt subtree has the index\'s shape and child order', () => {
  test('a hint rebuilt from the index is the index: same nesting, same identifier order', () => {
    const issues = [
      issue('LIN-1', { type: 'started' }),
      issue('LIN-10', { parentId: 'id-LIN-1', type: 'started' }),
      issue('LIN-9', { parentId: 'id-LIN-1', type: 'unstarted' }),
      issue('LIN-2', { parentId: 'id-LIN-1', type: 'backlog' }),
      issue('LIN-11', { parentId: 'id-LIN-9', type: 'unstarted' }),
    ];
    const index = buildSubtreeIndex(issues);
    const [indexRoot] = index;
    const { root, overCap } = subtreeFromHint('LIN-1', parseSubtreeHint(JSON.stringify({ edges: edgesOf(index) })).edges);
    assert.equal(overCap, false);
    assert.deepEqual(shapeOf(root.children), shapeOf(indexRoot.children));
    assert.deepEqual(root.children.map((c) => c.issue.identifier), ['LIN-2', 'LIN-9', 'LIN-10']);
  });

  test('a child listed twice is placed once, and the root is never placed under itself', () => {
    const { root, descendants } = subtreeFromHint('LIN-1', [
      { parent: 'LIN-1', child: 'LIN-2', type: 'started' },
      { parent: 'LIN-2', child: 'LIN-1', type: 'started' },
      { parent: 'LIN-1', child: 'LIN-2', type: 'started' },
    ]);
    assert.equal(descendants, 1);
    assert.deepEqual(root.children.map((c) => c.issue.identifier), ['LIN-2']);
    assert.deepEqual(root.children[0].children, []);
  });

  test('over the cap the rebuilt tree reports it, so the caller reads nothing below the root', () => {
    const edges = Array.from({ length: SUBTREE_READ_CAP + 1 }, (_, i) => ({ parent: 'LIN-1', child: `LIN-${100 + i}`, type: 'unstarted' }));
    const { overCap, descendants } = subtreeFromHint('LIN-1', edges);
    assert.equal(overCap, true);
    assert.equal(descendants, SUBTREE_READ_CAP + 1);
  });
});

describe('LIN-4049 — /state rolls the subtree up: a running grandchild blocks the parent\'s box', () => {
  // LIN-1 has no sessions of its own; LIN-2 (Todo) has none; LIN-3 (Todo, under LIN-2) runs. The box offers no run.
  const loops = { 'LIN-3': [runningLoop('LIN-3')] };
  const edges = [['LIN-1', 'LIN-2', 'unstarted'], ['LIN-2', 'LIN-3', 'unstarted']].map(([parent, child, type]) => ({ parent, child, type }));

  test('the parent\'s row state is running, and its box offers no action', async () => {
    const { loader, reads } = loaderWith(loops);
    const { model, taskState, rowState, container, overCap } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-1', edges });
    assert.equal(taskState.state, 'running');
    assert.equal(rowState.state, 'running');
    assert.equal(overCap, false);
    assert.equal(container, true);
    const summary = sessionSummaryOf(model, { container, rowState, overCap });
    assert.deepEqual(summary.actions, []);
    // LIN-4049 (beat 3): busy is the box's busy, which includes the subtree: the browser names no step it cannot run.
    assert.equal(summary.busy, true, 'the subtree that runs makes the box busy');
    assert.equal(reads.loops.get('LIN-3'), 1, 'the grandchild is read');
  });

  test('without the hint the same parent is idle, which is why the client must send it', async () => {
    const { loader } = loaderWith(loops);
    const { model, rowState, container, overCap } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-1', edges: [] });
    assert.notEqual(rowState.state, 'running', 'the parent alone has no running session');
    assert.equal(sessionSummaryOf(model, { container, rowState, overCap }).actions.length, 1, 'no subtree, no block');
  });
});

describe('LIN-4049 — the attention line names the first failed subtask by identifier order', () => {
  test('two failed subtasks: the lower identifier is named, whatever the order sent', async () => {
    const loops = { 'LIN-9': [failedLoop('LIN-9')], 'LIN-10': [failedLoop('LIN-10')] };
    const edges = [['LIN-1', 'LIN-10', 'unstarted'], ['LIN-1', 'LIN-9', 'unstarted']].map(([parent, child, type]) => ({ parent, child, type }));
    const { loader } = loaderWith(loops);
    const { taskState } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-1', edges });
    assert.equal(taskState.state, 'failed');
    assert.equal(taskState.attention.identifier, 'LIN-9');
  });
});

describe('LIN-4049 — the store is read once per identifier, and the rulings once per poll', () => {
  test('each descendant\'s sessions are read exactly once, and the rulings once for the whole subtree', async () => {
    const loops = { 'LIN-2': [], 'LIN-3': [runningLoop('LIN-3')], 'LIN-4': [] };
    const edges = [['LIN-1', 'LIN-2', 'unstarted'], ['LIN-2', 'LIN-3', 'unstarted'], ['LIN-2', 'LIN-4', 'unstarted']].map(([parent, child, type]) => ({ parent, child, type }));
    const { loader, reads } = loaderWith(loops);
    await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-1', edges });
    assert.equal(reads.loops.get('LIN-1'), 1);
    assert.equal(reads.loops.get('LIN-2'), 1);
    assert.equal(reads.loops.get('LIN-3'), 1);
    assert.equal(reads.loops.get('LIN-4'), 1);
    assert.equal(reads.rulings, 1, 'one ruling read per poll, not one per descendant');
  });

  test('over the cap: only the task itself is read, and the box fails closed with its note', async () => {
    const edges = Array.from({ length: SUBTREE_READ_CAP + 1 }, (_, i) => ({ parent: 'LIN-1', child: `LIN-${100 + i}`, type: 'unstarted' }));
    const { loader, reads } = loaderWith({ 'LIN-100': [runningLoop('LIN-100')] });
    const { model, rowState, container, overCap } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-1', edges });
    assert.equal(overCap, true);
    assert.equal(rowState, null);
    assert.equal(reads.loops.has('LIN-100'), false, 'nothing below the root is read');
    const summary = sessionSummaryOf(model, { container, rowState, overCap });
    assert.deepEqual(summary.actions, []);
    assert.match(summary.note, /more subtasks than the run box checks/);
  });
});

describe('LIN-4049 — /state and Home name the same state for the same subtree', () => {
  test('a parent whose Todo child runs: Home\'s row and the opened task agree', async () => {
    const loops = { 'LIN-2': [], 'LIN-3': [runningLoop('LIN-3')] };
    const issues = [issue('LIN-1', { type: 'started' }), issue('LIN-2', { parentId: 'id-LIN-1', type: 'unstarted' }), issue('LIN-3', { parentId: 'id-LIN-2', type: 'unstarted' })];
    const index = buildSubtreeIndex(issues);
    const { edges } = parseSubtreeHint(JSON.stringify({ edges: edgesOf(index) }));

    const { loader } = loaderWith(loops);
    const opened = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-1', edges });

    const homeRowStates = createHomeRowStates({
      getLoopsForWorkspace: async () => [runningLoop('LIN-3')], dispatchStore: null, agentStatusStore: null,
      taskDecisionsStore: null, shelvedRulingsStore: null, enrichLoop, deriveSessionWaiting, now: () => NOW,
      onError: (message) => assert.fail(message),
    });
    const home = await homeRowStates({ urlKey: 'ws', subtrees: index, inProgressTrees: [], recentActivityTrees: [], projectTrees: [], runControls: true });

    const row = home.states.get('LIN-1');
    assert.equal(opened.rowState.state, row.state);
    assert.equal(opened.rowState.words, row.words);
    assert.equal(row.state, 'running');
  });
});

describe('LIN-4049 — a task-scan decision on a grandchild reaches the parent\'s box (review 3)', () => {
  // LIN-1 (no sessions) > LIN-2 (no sessions) > LIN-3 (no sessions), and an open task-scan decision on LIN-3 only. The
  // rulings are read once for the whole subtree, so the parent must read it: it is needs you, and its box offers nothing.
  const scanOn = (identifier) => ({
    id: `scan-${identifier}`, urlKey: 'ws', issueId: `id-${identifier}`, issueIdentifier: identifier,
    decision: { decision_id: `dec-${identifier}`, question: 'Which way?', options: [] },
    scannedAt: '2026-10-30T10:00:00.000Z', outcome: null, outcomeAt: null,
  });
  const edges = [['LIN-1', 'LIN-2', 'unstarted'], ['LIN-2', 'LIN-3', 'unstarted']].map(([parent, child, type]) => ({ parent, child, type }));

  test('the grandchild\'s open decision makes the parent needs you, with no action offered', async () => {
    const s = stores({});
    s.taskDecisionsStore.listUnansweredForWorkspaces = async () => { s.reads.rulings += 1; return [scanOn('LIN-3')]; };
    const loader = createTaskPageLoader({
      enrichLoop, deriveSessionWaiting, getLoopsForIssue: s.getLoopsForIssue,
      taskDecisionsStore: s.taskDecisionsStore, shelvedRulingsStore: s.shelvedRulingsStore, now: () => NOW,
    });
    const { model, taskState, rowState, container, overCap } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-1', edges });
    assert.equal(taskState.state, 'needs-you', 'the grandchild\'s question is the parent\'s');
    assert.equal(rowState.state, 'needs-you');
    const summary = sessionSummaryOf(model, { container, rowState, overCap });
    assert.deepEqual(summary.actions, []);
    assert.equal(s.reads.rulings, 1, 'the rulings are read once, over the subtree');
  });
});

describe('LIN-4049 — a failed grandchild reaches the parent\'s box (review 3, witness (a))', () => {
  test('LIN-3 fails under LIN-2 under LIN-1: the parent reads failed and names the failed subtask; a failure is offered again, not blocked', async () => {
    const loops = { 'LIN-3': [failedLoop('LIN-3')] };
    const edges = [['LIN-1', 'LIN-2', 'unstarted'], ['LIN-2', 'LIN-3', 'unstarted']].map(([parent, child, type]) => ({ parent, child, type }));
    const { loader } = loaderWith(loops);
    const { model, taskState, rowState, container, overCap } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-1', edges });
    assert.equal(taskState.state, 'failed');
    assert.equal(taskState.attention.identifier, 'LIN-2', 'the failed subtask named is the child that rolls the failure up');
    assert.equal(rowState.state, 'failed');
    // A failed stage does not block the run (`blocksRun`): it is offered again (LIN-3968), so the parent offers Run to PR.
    assert.deepEqual(sessionSummaryOf(model, { container, rowState, overCap }).actions.map((a) => a.kind), ['run-to-pr']);
  });
});
