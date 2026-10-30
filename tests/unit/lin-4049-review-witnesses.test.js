/**
 * LIN-4049 review 5 (witness (a), the plan's remaining cases): a waiting grandchild, and a session outside Home's lean
 * window read through both real reads.
 *
 * Home's row reads the lean 30-day window (`getLoopsForWorkspace(..., {lean: true})`). The task page's box reads every
 * session the task ever had (`getLoopsForIssue(..., {horizon: 'all'})`, LIN-3324). The window case uses those two real
 * reads over stub stores, so the window is the code's own, not a stub's.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubtreeIndex, parseSubtreeHint } from '../../lib/subtree-index.js';
import { createTaskPageLoader, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { createHomeRowStates } from '../../lib/home-row-states.js';
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { digestFeedback } from '../../lib/digest-feedback.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-30T10:06:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const issue = (identifier, { parentId = null, type = 'unstarted' } = {}) => ({
  id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type },
  ...(parentId ? { parent: { id: parentId, identifier: null } } : {}),
});

// The edges as the client sends them: `[parent, child, stateType]` triples, one per child.
const edgesOf = (roots) => {
  const out = [];
  const walk = (node) => node.children.forEach((child) => {
    out.push([node.issue.identifier, child.issue.identifier, child.issue.state.type]);
    walk(child);
  });
  roots.forEach(walk);
  return out;
};

// LIN-1 (started) > LIN-2 > LIN-3: a chain of three, the grandchild LIN-3 holding the session under test.
const CHAIN = [issue('LIN-1', { type: 'started' }), issue('LIN-2', { parentId: 'id-LIN-1' }), issue('LIN-3', { parentId: 'id-LIN-2' })];
const chain = () => parseSubtreeHint(JSON.stringify({ edges: edgesOf(buildSubtreeIndex(CHAIN)) })).edges;

const emptyTaskStores = () => ({
  taskDecisionsStore: { listUnansweredForWorkspaces: async () => [], listNewestScanPerTask: async () => ({}) },
  shelvedRulingsStore: { listForWorkspaces: async () => [] },
});

/**
 * A history row for one task, `ageDays` old, with its digest as the store writes it. `message` is the feedback line.
 * Dated from the wall clock, not NOW: the lean read's window is measured against `Date.now()`, so a row dated from a
 * fixed instant falls outside it when the clock is shifted (CLOCK_SHIFT_DAYS, LIN-3949).
 */
function historyRow(identifier, ageDays, message = null) {
  const wallNow = Date.now();
  const dispatchedAt = new Date(wallNow - ageDays * DAY_MS);
  const row = {
    id: `hist-${identifier}-${ageDays}`, promptName: 'implementation', prompt: 'implementation prompt text', issueId: `id-${identifier}`,
    issueIdentifier: identifier, issueTitle: identifier, workspace: { urlKey: 'ws' }, dispatchedAt: dispatchedAt.toISOString(),
    dispatchedBy: 'user-1', target: 'cli', repo: null, status: 'taken', resolvedAt: null, takenByTokenLabel: 'consumer-1',
    feedback: message ? [{ message, createdAt: new Date(dispatchedAt.getTime() + 60e3).toISOString() }] : [],
  };
  row.feedbackDigest = digestFeedback(row, { now: wallNow });
  return row;
}

/** The store the real loop reads take, honouring the `since` window as the store's query does. */
function historyStore(rows) {
  return {
    dispatchStore: {
      listItems: async () => [],
      listHistory: async (_urlKey, options) => {
        let items = options?.issueIdentifier ? rows.filter(r => r.issueIdentifier === options.issueIdentifier) : rows;
        if (options?.since) items = items.filter(r => new Date(r.dispatchedAt).getTime() >= options.since.getTime());
        return { items, total: items.length };
      },
    },
    agentStatusStore: { listStatus: async () => ({ items: [], total: 0 }) },
  };
}

/** Home's row state for LIN-1 and the task page's /state for LIN-1, each from its own real read of the same stores. */
async function bothSides(stores, edges) {
  const home = await createHomeRowStates({
    getLoopsForWorkspace, dispatchStore: stores.dispatchStore, agentStatusStore: stores.agentStatusStore,
    ...emptyTaskStores(), enrichLoop, deriveSessionWaiting, now: () => NOW,
    onError: (message) => assert.fail(message),
  });
  const homeOut = await home({ urlKey: 'ws', subtrees: buildSubtreeIndex(CHAIN), inProgressTrees: [], recentActivityTrees: [], projectTrees: [], runControls: true });
  const loader = createTaskPageLoader({ ...stores, ...emptyTaskStores(), enrichLoop, deriveSessionWaiting, now: () => NOW });
  const opened = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-1', edges });
  return { home: homeOut.states.get('LIN-1'), opened };
}

describe('LIN-4049 review 5 — a grandchild that waits on you makes the parent needs you on both surfaces (witness (a))', () => {
  // An open task-scan decision on LIN-3: the question a subtask that waits on you holds open. Both surfaces read the
  // same store, so the parent's row and its box must name the same state.
  const scanOn = (identifier) => ({
    id: `scan-${identifier}`, urlKey: 'ws', issueId: `id-${identifier}`, issueIdentifier: identifier,
    decision: { decision_id: `dec-${identifier}`, question: 'Which way?', options: [] },
    scannedAt: '2026-10-30T10:00:00.000Z', outcome: null, outcomeAt: null,
  });
  const decisions = {
    taskDecisionsStore: { listUnansweredForWorkspaces: async () => [scanOn('LIN-3')], listNewestScanPerTask: async () => ({}) },
    shelvedRulingsStore: { listForWorkspaces: async () => [] },
  };

  test('the parent reads needs you on Home and in its box, and its box offers no action', async () => {
    const loader = createTaskPageLoader({ getLoopsForIssue: async () => [], dispatchStore: {}, agentStatusStore: {}, ...decisions, enrichLoop, deriveSessionWaiting, now: () => NOW });
    const { model, taskState, rowState, container, overCap } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-1', edges: chain() });

    const home = await createHomeRowStates({
      getLoopsForWorkspace: async () => [], dispatchStore: {}, agentStatusStore: {}, ...decisions,
      enrichLoop, deriveSessionWaiting, now: () => NOW, onError: (message) => assert.fail(message),
    });
    const homeOut = await home({ urlKey: 'ws', subtrees: buildSubtreeIndex(CHAIN), inProgressTrees: [], recentActivityTrees: [], projectTrees: [], runControls: true });

    assert.equal(taskState.state, 'needs-you', 'the grandchild\'s question is the parent\'s');
    assert.equal(rowState.state, 'needs-you');
    assert.equal(homeOut.states.get('LIN-1').state, rowState.state, 'Home\'s row and the box name the same state');
    assert.deepEqual(sessionSummaryOf(model, { container, rowState, overCap }).actions, []);
  });
});

describe('LIN-4049 review 5 — a session outside Home\'s lean window, read through both real reads (witness (a))', () => {
  test('a session inside the window: Home\'s row and /state name the same state for the parent', async () => {
    const stores = historyStore([historyRow('LIN-3', 2)]);
    const { home, opened } = await bothSides(stores, chain());
    assert.equal(home.state, 'running');
    assert.equal(opened.rowState.state, home.state, 'Home\'s row and the box agree inside the window');
    assert.equal(opened.taskState.state, home.state);
  });

  // PINNED RESIDUAL, not a passing agreement. The box reads every session the task ever had (LIN-3324), and Home's row
  // reads the 30-day window, so a 45-day-old running session is `running` on the box and `next` on the row. A leaf
  // task already reads this way on main; this PR does not change the read modules. Which window the box should read is a
  // decision for the team, asked on LIN-4049 and not yet recorded. When it is decided, this test changes with it on
  // purpose: it fails, and it should.
  test('a session outside the window: the box reads it, Home\'s row does not (pinned residual, LIN-4049 review 5)', async () => {
    const stores = historyStore([historyRow('LIN-3', 45)]);
    const { home, opened } = await bothSides(stores, chain());
    assert.equal(home.state, 'next', 'Home\'s lean window drops the 45-day-old session');
    assert.equal(opened.taskState.state, 'running', 'the box reads every session the task ever had');
  });
});
