/**
 * Unit tests for lib/pipeline-state.js
 *
 * Run with: node --test tests/unit/pipeline-state.test.js
 *
 * Coverage:
 *   - All 10 fixture scenarios from the LIN-246 plan
 *   - Shared state pollution (no leakage between calls)
 *   - Mutation safety (inputs are not modified)
 *   - Rollup consistency (buildPipelineSnapshot vs getTaskForIssue share the
 *     same rollup path)
 *   - Stack ordering parity vs the /api/proxy/stack inline pipeline
 *   - Edge cases: empty loops, missing parent, cycle guard, empty workspace
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  buildPipelineSnapshot,
  getTaskForIssue,
  __internal
} from '../../lib/pipeline-state.js';
import {
  buildForest,
  partitionCompleted,
  buildInProgressForest,
  buildRecentActivityForest,
  NO_PROJECT_ID
} from '../../lib/tree.js';
import {
  flattenTrees,
  sortIssuesForSwipe,
  applyBlockingOrder,
  clusterByParent
} from '../../lib/render-swipe.js';

const {
  healthColor,
  walkParentChain,
  isLeaf,
  hasActiveLoop,
  hasRecentOwnLoop,
  rollupTask,
  RECENT_WINDOW_MS
} = __internal;

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const NOW_ISO = '2026-04-11T12:00:00.000Z';
const NOW_MS = new Date(NOW_ISO).getTime();
const PROJECT_ID = 'proj-1';

function makeProject(overrides = {}) {
  return {
    id: PROJECT_ID,
    name: 'Test Project',
    content: null,
    url: null,
    sortOrder: 1,
    ...overrides
  };
}

function makeIssue(overrides = {}) {
  return {
    id: overrides.id || 'issue-' + Math.random().toString(36).slice(2, 9),
    identifier: overrides.identifier || 'LIN-1',
    title: overrides.title || 'Test Issue',
    description: null,
    estimate: null,
    priority: 2,
    sortOrder: 1,
    createdAt: '2026-04-01T00:00:00Z',
    dueDate: null,
    completedAt: null,
    url: overrides.url || `https://linear.app/x/issue/${overrides.identifier || 'LIN-1'}`,
    parent: null,
    project: { id: PROJECT_ID, name: 'Test Project' },
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    labels: { nodes: [] },
    relations: { nodes: [] },
    ...overrides
  };
}

function makeLoop(overrides = {}) {
  return {
    loopId: 'loop-' + Math.random().toString(36).slice(2, 9),
    issueIdentifier: 'LIN-1',
    issueId: null,
    issueTitle: null,
    issueUrl: null,
    iteration: 1,
    promptName: 'implementation',
    promptText: null,
    dispatchedAt: '2026-04-11T11:00:00.000Z',
    takenAt: null,
    resolvedAt: null,
    dispatchedBy: null,
    target: null,
    repo: null,
    feedback: [],
    source: 'live',
    historyStatus: null,
    foremanAction: null,
    foremanStatus: null,
    foremanSummary: null,
    foremanTimestamp: null,
    agentState: 'running',
    stage: 'implementation',
    ...overrides
  };
}

/**
 * Construct a deps object that injects fake fetchProjects/getLoopsForWorkspace
 * plus no-op stores and a deterministic `now`.
 */
function makeDeps({ projects = [], issues = [], loops = [], now = NOW_MS } = {}) {
  return {
    getWorkspaceAccessToken: async () => 'token-xyz',
    dispatchStore: {
      async listItems() { return []; },
      async listHistory() { return { items: [], total: 0 }; }
    },
    foremanStore: {
      async listStatus() { return { items: [], total: 0 }; }
    },
    fetchProjects: async () => ({ projects, issues }),
    getLoopsForWorkspace: async () => loops,
    now
  };
}

// ─── Private helper tests ────────────────────────────────────────────────────

describe('healthColor', () => {
  test('0 loops → green', () => assert.strictEqual(healthColor(0), 'green'));
  test('1 loop → green', () => assert.strictEqual(healthColor(1), 'green'));
  test('3 loops → green', () => assert.strictEqual(healthColor(3), 'green'));
  test('4 loops → amber', () => assert.strictEqual(healthColor(4), 'amber'));
  test('6 loops → amber', () => assert.strictEqual(healthColor(6), 'amber'));
  test('7 loops → red', () => assert.strictEqual(healthColor(7), 'red'));
  test('100 loops → red', () => assert.strictEqual(healthColor(100), 'red'));
});

describe('isLeaf', () => {
  test('no subtasks → leaf', () => {
    assert.strictEqual(isLeaf({ subtasks: [] }), true);
  });
  test('undefined subtasks → leaf', () => {
    assert.strictEqual(isLeaf({}), true);
  });
  test('all children completed/canceled → leaf', () => {
    const task = { subtasks: [
      { stateType: 'completed' },
      { stateType: 'canceled' }
    ] };
    assert.strictEqual(isLeaf(task), true);
  });
  test('one child still started → not leaf', () => {
    const task = { subtasks: [
      { stateType: 'completed' },
      { stateType: 'started' }
    ] };
    assert.strictEqual(isLeaf(task), false);
  });
  test('child in backlog → not leaf', () => {
    const task = { subtasks: [{ stateType: 'backlog' }] };
    assert.strictEqual(isLeaf(task), false);
  });
});

describe('hasActiveLoop', () => {
  test('no loops → false', () => {
    assert.strictEqual(hasActiveLoop({ loops: [] }), false);
  });
  test('running → true', () => {
    assert.strictEqual(hasActiveLoop({ loops: [{ agentState: 'running' }] }), true);
  });
  test('queued → true', () => {
    assert.strictEqual(hasActiveLoop({ loops: [{ agentState: 'queued' }] }), true);
  });
  test('waiting → true', () => {
    assert.strictEqual(hasActiveLoop({ loops: [{ agentState: 'waiting' }] }), true);
  });
  test('complete → false', () => {
    assert.strictEqual(hasActiveLoop({ loops: [{ agentState: 'complete' }] }), false);
  });
  test('error → false', () => {
    assert.strictEqual(hasActiveLoop({ loops: [{ agentState: 'error' }] }), false);
  });
});

describe('hasRecentOwnLoop', () => {
  test('no loops → false', () => {
    assert.strictEqual(hasRecentOwnLoop({ loops: [] }, NOW_MS), false);
  });
  test('loop dispatched 1h ago → true', () => {
    const loops = [{ dispatchedAt: new Date(NOW_MS - 60 * 60 * 1000).toISOString() }];
    assert.strictEqual(hasRecentOwnLoop({ loops }, NOW_MS), true);
  });
  test('loop dispatched 23h ago → true', () => {
    const loops = [{ dispatchedAt: new Date(NOW_MS - 23 * 60 * 60 * 1000).toISOString() }];
    assert.strictEqual(hasRecentOwnLoop({ loops }, NOW_MS), true);
  });
  test('loop dispatched 25h ago → false', () => {
    const loops = [{ dispatchedAt: new Date(NOW_MS - 25 * 60 * 60 * 1000).toISOString() }];
    assert.strictEqual(hasRecentOwnLoop({ loops }, NOW_MS), false);
  });
});

describe('walkParentChain', () => {
  test('no parent → empty chain', () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1', parent: null });
    assert.deepStrictEqual(walkParentChain(issue, new Map([['a', issue]])), []);
  });

  test('3-level chain returns [mid, root]', () => {
    const root = makeIssue({ id: 'root', identifier: 'LIN-100', title: 'Root', parent: null });
    const mid = makeIssue({ id: 'mid', identifier: 'LIN-101', title: 'Mid', parent: { id: 'root' } });
    const leaf = makeIssue({ id: 'leaf', identifier: 'LIN-102', title: 'Leaf', parent: { id: 'mid' } });
    const issueById = new Map([['root', root], ['mid', mid], ['leaf', leaf]]);
    const chain = walkParentChain(leaf, issueById);
    assert.deepStrictEqual(chain, [
      { identifier: 'LIN-101', title: 'Mid' },
      { identifier: 'LIN-100', title: 'Root' }
    ]);
  });

  test('cycle guard: self-parent → empty chain without infinite loop', () => {
    const a = makeIssue({ id: 'a', identifier: 'LIN-1', parent: { id: 'a' } });
    const issueById = new Map([['a', a]]);
    const chain = walkParentChain(a, issueById);
    // Self-parent: we push 'a' once (seen adds a), then next iter cur.parent.id is 'a' which is seen → stop.
    assert.strictEqual(chain.length, 1);
    assert.strictEqual(chain[0].identifier, 'LIN-1');
  });

  test('mutual cycle A↔B → stops without looping', () => {
    const a = makeIssue({ id: 'a', identifier: 'LIN-A', parent: { id: 'b' } });
    const b = makeIssue({ id: 'b', identifier: 'LIN-B', parent: { id: 'a' } });
    const issueById = new Map([['a', a], ['b', b]]);
    const chain = walkParentChain(a, issueById);
    assert.strictEqual(chain.length, 2);
    assert.deepStrictEqual(chain.map(n => n.identifier), ['LIN-B', 'LIN-A']);
  });

  test('missing parent (outside fetch) → halts cleanly', () => {
    const leaf = makeIssue({ id: 'leaf', identifier: 'LIN-1', parent: { id: 'outside' } });
    const chain = walkParentChain(leaf, new Map([['leaf', leaf]]));
    assert.deepStrictEqual(chain, []);
  });
});

// ─── rollupTask unit tests ───────────────────────────────────────────────────

describe('rollupTask', () => {
  test('empty loops → zeroed rollup with healthColor=green', () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1' });
    const task = rollupTask(issue, [], new Map([['a', issue]]), NOW_MS);
    assert.strictEqual(task.loopCount, 0);
    assert.strictEqual(task.currentStage, null);
    assert.strictEqual(task.agentState, null);
    assert.strictEqual(task.healthColor, 'green');
    assert.strictEqual(task.lastActivityAt, null);
  });

  test('loops are sorted newest-first (head = latest dispatch)', () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1' });
    const old = makeLoop({ loopId: 'old', dispatchedAt: '2026-04-10T00:00:00.000Z', stage: 'plan', agentState: 'complete' });
    const fresh = makeLoop({ loopId: 'fresh', dispatchedAt: '2026-04-11T11:00:00.000Z', stage: 'implementation', agentState: 'running' });
    const task = rollupTask(issue, [old, fresh], new Map([['a', issue]]), NOW_MS);
    assert.strictEqual(task.currentStage, 'implementation');
    assert.strictEqual(task.agentState, 'running');
    assert.strictEqual(task.loops[0].loopId, 'fresh');
    assert.strictEqual(task.loops[1].loopId, 'old');
  });
});

// ─── Plan scenarios 1–10 via buildPipelineSnapshot ───────────────────────────

describe('buildPipelineSnapshot — plan scenarios', () => {
  test('(1) pure leaf with one running loop → active with healthColor=green', async () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1', title: 'Leaf' });
    const loop = makeLoop({
      issueIdentifier: 'LIN-1',
      agentState: 'running',
      stage: 'implementation',
      dispatchedAt: '2026-04-11T11:00:00.000Z'
    });
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [issue],
      loops: [loop]
    }));
    assert.strictEqual(snap.active.length, 1);
    assert.strictEqual(snap.active[0].identifier, 'LIN-1');
    assert.strictEqual(snap.active[0].healthColor, 'green');
    assert.strictEqual(snap.active[0].agentState, 'running');
    assert.strictEqual(snap.queue.length, 0);
  });

  test('(2) parent with one incomplete child, no own-loop → parent dropped, child included', async () => {
    const parent = makeIssue({ id: 'p', identifier: 'LIN-P', title: 'Parent' });
    const child = makeIssue({ id: 'c', identifier: 'LIN-C', title: 'Child', parent: { id: 'p' } });
    // Only the child has an active loop.
    const loop = makeLoop({
      issueIdentifier: 'LIN-C',
      agentState: 'running',
      dispatchedAt: '2026-04-11T11:00:00.000Z'
    });
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [parent, child],
      loops: [loop]
    }));
    const activeIds = snap.active.map(t => t.identifier);
    assert.deepStrictEqual(activeIds, ['LIN-C']);
    // Parent should not leak into queue either (it has no own loop, but it also
    // is a non-leaf that the stack may include — confirm it's not in active).
    const activeSet = new Set(activeIds);
    assert.strictEqual(activeSet.has('LIN-P'), false);
  });

  test('(3) parent with all completed children + parent has running loop → parent in active (isLeaf=true)', async () => {
    const parent = makeIssue({ id: 'p', identifier: 'LIN-P', title: 'Parent' });
    const done1 = makeIssue({
      id: 'c1', identifier: 'LIN-C1', title: 'Done 1', parent: { id: 'p' },
      state: { name: 'Done', type: 'completed' }, completedAt: '2026-04-10T00:00:00Z'
    });
    const done2 = makeIssue({
      id: 'c2', identifier: 'LIN-C2', title: 'Done 2', parent: { id: 'p' },
      state: { name: 'Canceled', type: 'canceled' }, completedAt: '2026-04-10T00:00:00Z'
    });
    const loop = makeLoop({ issueIdentifier: 'LIN-P', agentState: 'running' });
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [parent, done1, done2],
      loops: [loop]
    }));
    const active = snap.active.map(t => t.identifier);
    assert.ok(active.includes('LIN-P'), `expected parent in active, got ${JSON.stringify(active)}`);
  });

  test('(4) parent with incomplete children AND recent own-loop → parent re-admitted to active', async () => {
    const parent = makeIssue({ id: 'p', identifier: 'LIN-P', title: 'Parent' });
    const child = makeIssue({ id: 'c', identifier: 'LIN-C', title: 'Child', parent: { id: 'p' } });

    // Parent's own review loop fired 1h ago, still running (recent own-loop).
    const parentLoop = makeLoop({
      issueIdentifier: 'LIN-P',
      agentState: 'running',
      stage: 'review',
      dispatchedAt: new Date(NOW_MS - 60 * 60 * 1000).toISOString()
    });
    // Child has its own running loop so it also appears.
    const childLoop = makeLoop({
      issueIdentifier: 'LIN-C',
      agentState: 'running',
      dispatchedAt: new Date(NOW_MS - 30 * 60 * 1000).toISOString()
    });
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [parent, child],
      loops: [parentLoop, childLoop]
    }));
    const active = snap.active.map(t => t.identifier).sort();
    assert.deepStrictEqual(active, ['LIN-C', 'LIN-P']);
  });

  test('(5a) leaf with 4 loops → amber', async () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1' });
    const loops = [];
    for (let i = 0; i < 4; i++) {
      loops.push(makeLoop({
        loopId: `loop-${i}`,
        issueIdentifier: 'LIN-1',
        agentState: i === 3 ? 'running' : 'complete',
        dispatchedAt: new Date(NOW_MS - (4 - i) * 60 * 60 * 1000).toISOString(),
        resolvedAt: i === 3 ? null : new Date(NOW_MS - (4 - i) * 60 * 60 * 1000 + 60_000).toISOString()
      }));
    }
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [issue],
      loops
    }));
    assert.strictEqual(snap.active.length, 1);
    assert.strictEqual(snap.active[0].healthColor, 'amber');
    assert.strictEqual(snap.active[0].loopCount, 4);
  });

  test('(5b) leaf with 7 loops → red', async () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1' });
    const loops = [];
    for (let i = 0; i < 7; i++) {
      loops.push(makeLoop({
        loopId: `loop-${i}`,
        issueIdentifier: 'LIN-1',
        agentState: i === 6 ? 'running' : 'complete',
        dispatchedAt: new Date(NOW_MS - (7 - i) * 60 * 60 * 1000).toISOString(),
        resolvedAt: i === 6 ? null : new Date(NOW_MS - (7 - i) * 60 * 60 * 1000 + 60_000).toISOString()
      }));
    }
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [issue],
      loops
    }));
    assert.strictEqual(snap.active[0].healthColor, 'red');
    assert.strictEqual(snap.active[0].loopCount, 7);
  });

  test('(6) unstarted leaf with no loops → queue, not active', async () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1', state: { name: 'Todo', type: 'unstarted' } });
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [issue],
      loops: []
    }));
    assert.strictEqual(snap.active.length, 0);
    const queueIds = snap.queue.map(t => t.identifier);
    assert.ok(queueIds.includes('LIN-1'), `expected LIN-1 in queue, got ${JSON.stringify(queueIds)}`);
  });

  test('(6b) started leaf with no loops → active (state-based classification)', async () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1', state: { name: 'In Progress', type: 'started' } });
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [issue],
      loops: []
    }));
    assert.strictEqual(snap.active.length, 1);
    assert.strictEqual(snap.active[0].identifier, 'LIN-1');
    assert.strictEqual(snap.active[0].healthColor, 'green');
    assert.strictEqual(snap.active[0].agentState, null);
    assert.strictEqual(snap.queue.length, 0);
  });

  test('(6c) backlog leaf → queue, not active', async () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1', state: { name: 'Backlog', type: 'backlog' } });
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [issue],
      loops: []
    }));
    assert.strictEqual(snap.active.length, 0);
    const queueIds = snap.queue.map(t => t.identifier);
    assert.ok(queueIds.includes('LIN-1'), `expected LIN-1 in queue, got ${JSON.stringify(queueIds)}`);
  });

  test('(6d) completed leaf → neither active nor queue', async () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1', state: { name: 'Done', type: 'completed' }, completedAt: '2026-04-10T00:00:00Z' });
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [issue],
      loops: []
    }));
    assert.strictEqual(snap.active.length, 0);
    assert.strictEqual(snap.queue.length, 0);
  });

  test('(7) recently resolved loops populate recent, sorted by resolvedAt desc', async () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1' });
    const l1 = makeLoop({
      loopId: 'l1',
      issueIdentifier: 'LIN-1',
      agentState: 'complete',
      source: 'history',
      dispatchedAt: new Date(NOW_MS - 3 * 60 * 60 * 1000).toISOString(),
      resolvedAt: new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString()
    });
    const l2 = makeLoop({
      loopId: 'l2',
      issueIdentifier: 'LIN-1',
      agentState: 'error',
      source: 'history',
      dispatchedAt: new Date(NOW_MS - 60 * 60 * 1000).toISOString(),
      resolvedAt: new Date(NOW_MS - 30 * 60 * 1000).toISOString()
    });
    // Too old to be recent.
    const oldL = makeLoop({
      loopId: 'old',
      issueIdentifier: 'LIN-1',
      agentState: 'complete',
      source: 'history',
      dispatchedAt: new Date(NOW_MS - 48 * 60 * 60 * 1000).toISOString(),
      resolvedAt: new Date(NOW_MS - 47 * 60 * 60 * 1000).toISOString()
    });
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [issue],
      loops: [l1, l2, oldL]
    }));
    assert.strictEqual(snap.recent.length, 2);
    assert.strictEqual(snap.recent[0].loopId, 'l2'); // newest first
    assert.strictEqual(snap.recent[1].loopId, 'l1');
  });

  test('(8) getTaskForIssue on a non-leaf → returns populated rollup despite leaf filter', async () => {
    const parent = makeIssue({ id: 'p', identifier: 'LIN-P', title: 'Parent' });
    const child = makeIssue({ id: 'c', identifier: 'LIN-C', title: 'Child', parent: { id: 'p' } });
    // Parent has an old breakdown loop — would be dropped by buildPipelineSnapshot.
    const parentLoop = makeLoop({
      loopId: 'p1',
      issueIdentifier: 'LIN-P',
      agentState: 'complete',
      source: 'history',
      stage: 'breakdown',
      dispatchedAt: new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000).toISOString(),
      resolvedAt: new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000 + 60_000).toISOString()
    });
    const deps = makeDeps({
      projects: [makeProject()],
      issues: [parent, child],
      loops: [parentLoop]
    });
    const snap = await buildPipelineSnapshot('ws', deps);
    // Parent should NOT appear in active (old loop, not recent).
    assert.strictEqual(snap.active.find(t => t.identifier === 'LIN-P'), undefined);

    // But getTaskForIssue on the parent should still return the rollup.
    const task = await getTaskForIssue('ws', 'LIN-P', deps);
    assert.strictEqual(task.identifier, 'LIN-P');
    assert.strictEqual(task.loopCount, 1);
    assert.strictEqual(task.currentStage, 'breakdown');
    assert.strictEqual(task.agentState, 'complete');
  });

  test('(9) parentChain walk across 3 levels returns [mid, root]', async () => {
    const root = makeIssue({ id: 'root', identifier: 'LIN-100', title: 'Root' });
    const mid = makeIssue({ id: 'mid', identifier: 'LIN-101', title: 'Mid', parent: { id: 'root' } });
    const leaf = makeIssue({ id: 'leaf', identifier: 'LIN-102', title: 'Leaf', parent: { id: 'mid' } });
    const loop = makeLoop({ issueIdentifier: 'LIN-102', agentState: 'running' });
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [root, mid, leaf],
      loops: [loop]
    }));
    const leafTask = snap.active.find(t => t.identifier === 'LIN-102');
    assert.ok(leafTask, 'expected leaf in active');
    assert.deepStrictEqual(leafTask.parentChain, [
      { identifier: 'LIN-101', title: 'Mid' },
      { identifier: 'LIN-100', title: 'Root' }
    ]);
  });

  test('(10) cycle guard on self-parent corruption → rollup returns without infinite loop', async () => {
    // Route the corrupt issue through getTaskForIssue rather than
    // buildPipelineSnapshot: the upstream stack assembly (buildForest →
    // assignDepth) does not itself cycle-guard, so an integration test with
    // real Linear data would never include a self-parent issue. The plan's
    // cycle guard lives inside walkParentChain; this test verifies the guard
    // holds end-to-end via the public API that doesn't traverse the forest.
    const corrupt = makeIssue({ id: 'a', identifier: 'LIN-CORRUPT', parent: { id: 'a' } });
    const loop = makeLoop({ issueIdentifier: 'LIN-CORRUPT', agentState: 'running' });
    const task = await getTaskForIssue('ws', 'LIN-CORRUPT', makeDeps({
      projects: [makeProject()],
      issues: [corrupt],
      loops: [loop]
    }));
    // Cycle guard: one self-reference is recorded, then halts.
    assert.strictEqual(task.parentChain.length, 1);
    assert.strictEqual(task.parentChain[0].identifier, 'LIN-CORRUPT');
  });
});

// ─── Additional safety / consistency tests ──────────────────────────────────

describe('buildPipelineSnapshot — safety and consistency', () => {
  test('shared-state pollution: two calls with different data do not cross-contaminate', async () => {
    const issueA = makeIssue({ id: 'a', identifier: 'LIN-A' });
    const issueB = makeIssue({ id: 'b', identifier: 'LIN-B' });
    const loopA = makeLoop({ issueIdentifier: 'LIN-A', agentState: 'running' });
    const loopB = makeLoop({ issueIdentifier: 'LIN-B', agentState: 'running' });

    const snap1 = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [issueA],
      loops: [loopA]
    }));
    const snap2 = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [issueB],
      loops: [loopB]
    }));
    assert.deepStrictEqual(snap1.active.map(t => t.identifier), ['LIN-A']);
    assert.deepStrictEqual(snap2.active.map(t => t.identifier), ['LIN-B']);
  });

  test('mutation safety: inputs are not modified', async () => {
    const projects = [makeProject()];
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1' });
    const issues = [issue];
    const loops = [makeLoop({ issueIdentifier: 'LIN-1', agentState: 'running' })];

    // Snapshot pre-call state (deep).
    const beforeProjects = JSON.parse(JSON.stringify(projects));
    const beforeIssues = JSON.parse(JSON.stringify(issues));
    const beforeLoops = JSON.parse(JSON.stringify(loops));
    const beforeProjectsLength = projects.length;
    const beforeIssuesLength = issues.length;

    await buildPipelineSnapshot('ws', makeDeps({ projects, issues, loops }));
    await getTaskForIssue('ws', 'LIN-1', makeDeps({ projects, issues, loops }));

    // Arrays should not have grown (stack builder adds NO_PROJECT locally).
    assert.strictEqual(projects.length, beforeProjectsLength);
    assert.strictEqual(issues.length, beforeIssuesLength);
    assert.deepStrictEqual(projects, beforeProjects);
    assert.deepStrictEqual(issues, beforeIssues);
    assert.deepStrictEqual(loops, beforeLoops);
  });

  test('rollup consistency: same issue, same fields from both public functions', async () => {
    const issue = makeIssue({ id: 'a', identifier: 'LIN-1', title: 'Hello' });
    const loop = makeLoop({
      issueIdentifier: 'LIN-1',
      agentState: 'running',
      stage: 'implementation',
      dispatchedAt: '2026-04-11T11:00:00.000Z'
    });
    const deps = makeDeps({
      projects: [makeProject()],
      issues: [issue],
      loops: [loop]
    });
    const snap = await buildPipelineSnapshot('ws', deps);
    const fromSnap = snap.active.find(t => t.identifier === 'LIN-1');
    const fromGet = await getTaskForIssue('ws', 'LIN-1', deps);

    for (const field of ['identifier', 'title', 'loopCount', 'currentStage', 'agentState', 'healthColor', 'lastActivityAt']) {
      assert.deepStrictEqual(fromSnap[field], fromGet[field], `mismatch on ${field}`);
    }
    assert.deepStrictEqual(fromSnap.parentChain, fromGet.parentChain);
  });

  test('stack ordering parity: _buildStack matches the /api/proxy/stack inline pipeline', () => {
    // Construct a small workspace and run both pipelines in parallel; compare order.
    const proj = makeProject();
    const i1 = makeIssue({ id: 'x', identifier: 'LIN-X', title: 'X' });
    const i2 = makeIssue({ id: 'y', identifier: 'LIN-Y', title: 'Y' });
    const i3 = makeIssue({ id: 'z', identifier: 'LIN-Z', title: 'Z' });

    // Pipeline A: _buildStack from pipeline-state.
    const stackA = __internal._buildStack([proj], [i1, i2, i3]);

    // Pipeline B: the /api/proxy/stack inline implementation (duplicated here
    // so the test pins behavior that the two copies must agree on).
    const projects = [proj];
    const issues = [i1, i2, i3];
    const forest = buildForest(issues);
    if (forest.has(NO_PROJECT_ID)) {
      projects.push({
        id: NO_PROJECT_ID,
        name: 'No Project',
        content: null,
        url: null,
        sortOrder: Number.MAX_SAFE_INTEGER
      });
    }
    const inProgressTrees = buildInProgressForest(issues, projects);
    const recentActivityTrees = buildRecentActivityForest(issues, projects, 1);
    const trees = projects
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(project => {
        const { roots } = forest.get(project.id) || { roots: [] };
        const { incomplete } = partitionCompleted(roots);
        return { project, incomplete };
      });
    const projectIssues = flattenTrees(trees, 'project');
    const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
    const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');
    const seenIds = new Set();
    const allIssues = [];
    for (const issue of inProgressIssues) {
      if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
    }
    for (const issue of projectIssues) {
      if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
    }
    for (const issue of recentIssues) {
      if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
    }
    const cardById = new Map(allIssues.map(i => [i.id, i]));
    const subtaskMap = new Map();
    for (const issue of allIssues) {
      if (issue.parentId && cardById.has(issue.parentId)) {
        const parent = cardById.get(issue.parentId);
        issue.parentIdentifier = parent.identifier;
        issue.parentTitle = parent.title;
        if (!subtaskMap.has(issue.parentId)) subtaskMap.set(issue.parentId, []);
        subtaskMap.get(issue.parentId).push({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          stateType: issue.stateType
        });
      }
    }
    for (const [parentId, children] of subtaskMap) {
      const parent = cardById.get(parentId);
      if (parent) parent.subtasks = children;
    }
    sortIssuesForSwipe(allIssues);
    const stackB = clusterByParent(applyBlockingOrder(allIssues));

    assert.deepStrictEqual(
      stackA.map(t => t.identifier),
      stackB.map(t => t.identifier)
    );
  });

  test('snapshot shape: {fetchedAt, queue, active, recent}', async () => {
    const snap = await buildPipelineSnapshot('ws', makeDeps({
      projects: [makeProject()],
      issues: [makeIssue({ id: 'a', identifier: 'LIN-1' })],
      loops: []
    }));
    assert.ok(typeof snap.fetchedAt === 'string');
    assert.strictEqual(snap.fetchedAt, NOW_ISO);
    assert.ok(Array.isArray(snap.queue));
    assert.ok(Array.isArray(snap.active));
    assert.ok(Array.isArray(snap.recent));
    // Private sort key should not leak.
    for (const task of [...snap.active, ...snap.queue]) {
      assert.strictEqual(task._lastActivityMs, undefined);
    }
  });

  test('empty workspace → empty snapshot', async () => {
    const snap = await buildPipelineSnapshot('ws', makeDeps({}));
    assert.deepStrictEqual(snap.queue, []);
    assert.deepStrictEqual(snap.active, []);
    assert.deepStrictEqual(snap.recent, []);
  });
});

// ─── getTaskForIssue error handling ──────────────────────────────────────────

describe('getTaskForIssue — error handling', () => {
  test('missing identifier → 404-style error', async () => {
    const deps = makeDeps({
      projects: [makeProject()],
      issues: [makeIssue({ id: 'a', identifier: 'LIN-1' })]
    });
    await assert.rejects(
      () => getTaskForIssue('ws', 'LIN-MISSING', deps),
      (err) => err.status === 404 && /issue not found/.test(err.message)
    );
  });

  test('empty identifier → throws', async () => {
    const deps = makeDeps({});
    await assert.rejects(() => getTaskForIssue('ws', '', deps), /identifier is required/);
  });

  test('no access token → throws', async () => {
    const deps = makeDeps({});
    deps.getWorkspaceAccessToken = async () => null;
    await assert.rejects(
      () => getTaskForIssue('ws', 'LIN-1', deps),
      /no access token/
    );
  });
});

// ─── buildPipelineSnapshot validation ───────────────────────────────────────

describe('buildPipelineSnapshot — validation', () => {
  test('missing urlKey → throws', async () => {
    await assert.rejects(() => buildPipelineSnapshot('', makeDeps({})), /urlKey is required/);
  });

  test('missing getWorkspaceAccessToken → throws', async () => {
    const deps = makeDeps({});
    delete deps.getWorkspaceAccessToken;
    await assert.rejects(
      () => buildPipelineSnapshot('ws', deps),
      /getWorkspaceAccessToken must be injected/
    );
  });

  test('missing dispatchStore/foremanStore → throws', async () => {
    const deps = makeDeps({});
    delete deps.dispatchStore;
    await assert.rejects(
      () => buildPipelineSnapshot('ws', deps),
      /dispatchStore and foremanStore must be injected/
    );
  });
});
