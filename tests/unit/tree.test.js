/**
 * Unit tests for tree.js
 *
 * Run with: node --test tests/unit/tree.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildForest, partitionCompleted, buildInProgressForest, buildRecentActivityForest, NO_PROJECT_ID, PERIODICALS_PROJECT_ID, isTerminalState, isCompleted, TERMINAL_STATE_TYPES, selectFocusSubtask, computeFrontierFacts, isBlocked } from '../../lib/tree.js';
import { isHiddenState, getStateDisplay } from '../../lib/providers/state-map.js';
import { childrenToGraphNodes, computeGraphFeatures, hasOpenFrontier } from '../../lib/graph-features.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createIssue(overrides = {}) {
  return {
    id: 'issue-' + Math.random().toString(36).substr(2, 9),
    title: 'Test Issue',
    description: null,
    priority: 2,
    sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
    dueDate: null,
    completedAt: null,
    url: null,
    parent: null,
    project: null,
    state: { name: 'Backlog', type: 'backlog' },
    assignee: null,
    labels: { nodes: [] },
    ...overrides
  };
}

// =============================================================================
// Dashboard hide-cancelled seam (LIN-769)
// =============================================================================
// server.js filters cancelled issues out of the merged issue list BEFORE any
// forest is built (`issues.filter(i => !isHiddenState(i))`). These tests
// reproduce that exact pipeline — filter → buildForest → partitionCompleted —
// to prove cancelled never reaches the rendered tree while completed (and other
// states) still do, and a completed issue still partitions as done.
describe('hide-cancelled dashboard seam (LIN-769)', () => {
  // Mirrors the server.js seam verbatim.
  const applyDashboardFilter = (issues) => issues.filter(i => !isHiddenState(i));

  const collectIds = (forest) => {
    const ids = [];
    const walk = (node) => {
      ids.push(node.issue.id);
      node.children.forEach(walk);
    };
    for (const { roots } of forest.values()) roots.forEach(walk);
    return ids;
  };

  test('cancelled issue is removed from the forest; completed + active survive', () => {
    const active = createIssue({ id: 'active', project: { id: 'p1' }, state: { name: 'In Progress', type: 'started' } });
    const done = createIssue({ id: 'done', project: { id: 'p1' }, state: { name: 'Done', type: 'completed' } });
    const dup = createIssue({ id: 'dup', project: { id: 'p1' }, state: { name: 'Duplicate', type: 'duplicate' } });
    const cancelled = createIssue({ id: 'cancelled', project: { id: 'p1' }, state: { name: 'Canceled', type: 'canceled' } });

    const forest = buildForest(applyDashboardFilter([active, done, dup, cancelled]));
    const ids = collectIds(forest);

    assert.ok(!ids.includes('cancelled'), 'cancelled must NOT appear in the rendered forest');
    assert.ok(ids.includes('active'), 'active issue must remain');
    assert.ok(ids.includes('done'), 'completed issue must remain');
    assert.ok(ids.includes('dup'), 'duplicate must remain (deliberately not hidden)');
  });

  test('a completed issue still partitions as done; cancelled is gone entirely', () => {
    const done = createIssue({ id: 'done', project: { id: 'p1' }, state: { name: 'Done', type: 'completed' } });
    const cancelled = createIssue({ id: 'cancelled', project: { id: 'p1' }, state: { name: 'Canceled', type: 'canceled' } });

    const forest = buildForest(applyDashboardFilter([done, cancelled]));
    const { roots } = forest.get('p1');
    const { incomplete, completed, completedCount } = partitionCompleted(roots);

    // Completed issue is present and grouped as done, rendered with the ✓ glyph.
    assert.strictEqual(incomplete.length, 0);
    assert.strictEqual(completed.length, 1);
    assert.strictEqual(completed[0].issue.id, 'done');
    assert.strictEqual(completedCount, 1);
    assert.strictEqual(getStateDisplay(completed[0].issue.state.type).class, 'done');
    assert.strictEqual(getStateDisplay(completed[0].issue.state.type).char, '✓');

    // Cancelled appears in NEITHER bucket — it was filtered out before the forest.
    const allIds = [...incomplete, ...completed].map(n => n.issue.id);
    assert.ok(!allIds.includes('cancelled'), 'cancelled is hidden, not shown as done');
  });

  test('a cancelled child is dropped while its live parent survives', () => {
    const parent = createIssue({ id: 'parent', project: { id: 'p1' }, state: { name: 'In Progress', type: 'started' } });
    const cancelledChild = createIssue({ id: 'kid', project: null, parent: { id: 'parent' }, state: { name: 'Canceled', type: 'canceled' } });

    const forest = buildForest(applyDashboardFilter([parent, cancelledChild]));
    const ids = collectIds(forest);

    assert.ok(ids.includes('parent'), 'live parent must remain');
    assert.ok(!ids.includes('kid'), 'cancelled child must be hidden, mirroring trashed');
  });
});

// =============================================================================
// buildForest Tests - Subtask Project Inheritance (LIN-53)
// =============================================================================

describe('buildForest', () => {
  describe('subtask project inheritance (LIN-53)', () => {
    test('subtask without project appears under parent with project', () => {
      const parent = createIssue({
        id: 'parent',
        title: 'Parent',
        project: { id: 'proj-1' }
      });
      const child = createIssue({
        id: 'child',
        title: 'Child',
        project: null,
        parent: { id: 'parent' }
      });

      const forest = buildForest([parent, child]);

      // Child should inherit parent's project
      assert.ok(forest.has('proj-1'), 'should have proj-1');
      assert.ok(!forest.has(NO_PROJECT_ID), 'should not have NO_PROJECT_ID');

      const { roots } = forest.get('proj-1');
      assert.strictEqual(roots.length, 1);
      assert.strictEqual(roots[0].issue.id, 'parent');
      assert.strictEqual(roots[0].children.length, 1);
      assert.strictEqual(roots[0].children[0].issue.id, 'child');
    });

    test('nested subtasks inherit ancestor project', () => {
      const grandparent = createIssue({
        id: 'gp',
        title: 'Grandparent',
        project: { id: 'proj-1' }
      });
      const parent = createIssue({
        id: 'p',
        title: 'Parent',
        project: null,
        parent: { id: 'gp' }
      });
      const child = createIssue({
        id: 'c',
        title: 'Child',
        project: null,
        parent: { id: 'p' }
      });

      const forest = buildForest([grandparent, parent, child]);

      assert.ok(forest.has('proj-1'));
      assert.ok(!forest.has(NO_PROJECT_ID));

      const { roots } = forest.get('proj-1');
      assert.strictEqual(roots.length, 1);
      assert.strictEqual(roots[0].issue.id, 'gp');
      assert.strictEqual(roots[0].children.length, 1);
      assert.strictEqual(roots[0].children[0].issue.id, 'p');
      assert.strictEqual(roots[0].children[0].children.length, 1);
      assert.strictEqual(roots[0].children[0].children[0].issue.id, 'c');
    });

    test('subtask with explicit project keeps its own project', () => {
      const parent = createIssue({
        id: 'parent',
        title: 'Parent',
        project: { id: 'proj-1' }
      });
      const child = createIssue({
        id: 'child',
        title: 'Child',
        project: { id: 'proj-2' },
        parent: { id: 'parent' }
      });

      const forest = buildForest([parent, child]);

      // Child has explicit project, so it stays in its own project
      // (user intentionally assigned it to a different project)
      assert.ok(forest.has('proj-1'));
      assert.ok(forest.has('proj-2'));

      const proj1 = forest.get('proj-1');
      const proj2 = forest.get('proj-2');
      assert.strictEqual(proj1.roots.length, 1);
      assert.strictEqual(proj1.roots[0].issue.id, 'parent');
      assert.strictEqual(proj2.roots.length, 1);
      assert.strictEqual(proj2.roots[0].issue.id, 'child');
    });

    test('issue without parent keeps its own project', () => {
      const issue1 = createIssue({
        id: 'issue1',
        title: 'Issue 1',
        project: { id: 'proj-1' }
      });
      const issue2 = createIssue({
        id: 'issue2',
        title: 'Issue 2',
        project: { id: 'proj-2' }
      });

      const forest = buildForest([issue1, issue2]);

      assert.ok(forest.has('proj-1'));
      assert.ok(forest.has('proj-2'));
    });

    test('issue without parent or project goes to NO_PROJECT', () => {
      const issue = createIssue({
        id: 'orphan',
        title: 'Orphan',
        project: null,
        parent: null
      });

      const forest = buildForest([issue]);

      assert.ok(forest.has(NO_PROJECT_ID));
      assert.strictEqual(forest.get(NO_PROJECT_ID).roots.length, 1);
    });
  });

  // ===========================================================================
  // Cross-provider id collisions (LIN-544)
  // ===========================================================================
  // A raw issue.id is only unique within its provider (GitHub emits "42", Local
  // a doc id, Linear a UUID). A merged multi-provider list can repeat a raw id,
  // and node Maps keyed on the raw id would silently clobber. Node identity must
  // be source-qualified so both survive.
  describe('cross-provider id collisions (LIN-544)', () => {
    test('two issues sharing a raw id from different sources both survive', () => {
      const linearIssue = createIssue({ id: '42', title: 'Linear 42', source: 'linear', project: { id: 'proj-1' } });
      const githubIssue = createIssue({ id: '42', title: 'GitHub 42', source: 'github', project: { id: 'proj-1' } });

      const forest = buildForest([linearIssue, githubIssue]);
      const { roots } = forest.get('proj-1');

      assert.strictEqual(roots.length, 2, 'both same-id issues survive the merge');
      const titles = roots.map(r => r.issue.title).sort();
      assert.deepStrictEqual(titles, ['GitHub 42', 'Linear 42']);
    });

    test('a child attaches to its same-source parent, not a foreign id twin', () => {
      // 'p' exists in BOTH providers; the linear child must nest under the
      // linear parent, leaving the github 'p' a standalone root.
      const linearParent = createIssue({ id: 'p', title: 'Linear parent', source: 'linear', project: { id: 'proj-1' } });
      const githubTwin = createIssue({ id: 'p', title: 'GitHub twin', source: 'github', project: { id: 'proj-1' } });
      const linearChild = createIssue({ id: 'c', title: 'Linear child', source: 'linear', project: { id: 'proj-1' }, parent: { id: 'p' } });

      const forest = buildForest([linearParent, githubTwin, linearChild]);
      const { roots } = forest.get('proj-1');

      assert.strictEqual(roots.length, 2, 'two roots: linear parent + github twin');
      const linearRoot = roots.find(r => r.issue.title === 'Linear parent');
      const githubRoot = roots.find(r => r.issue.title === 'GitHub twin');
      assert.strictEqual(linearRoot.children.length, 1, 'child nests under same-source parent');
      assert.strictEqual(linearRoot.children[0].issue.title, 'Linear child');
      assert.strictEqual(githubRoot.children.length, 0, 'foreign id twin gets no child');
    });

    test('single-provider (un-stamped) issues keep raw-id behaviour', () => {
      // No `source` field → issueSource defaults to linear; tree shape unchanged.
      const parent = createIssue({ id: 'parent', project: { id: 'proj-1' } });
      const child = createIssue({ id: 'child', parent: { id: 'parent' }, project: null });

      const forest = buildForest([parent, child]);
      const { roots } = forest.get('proj-1');
      assert.strictEqual(roots.length, 1);
      assert.strictEqual(roots[0].children[0].issue.id, 'child');
    });
  });

  describe('buildInProgressForest cross-provider collisions (LIN-544)', () => {
    test('same-id in-progress issues from different sources both appear', () => {
      const started = { name: 'In Progress', type: 'started' };
      const linearIssue = createIssue({ id: '7', title: 'Linear 7', source: 'linear', project: { id: 'proj-1' }, state: started });
      const githubIssue = createIssue({ id: '7', title: 'GitHub 7', source: 'github', project: { id: 'proj-1' }, state: started });

      const trees = buildInProgressForest([linearIssue, githubIssue], [{ id: 'proj-1', name: 'Proj 1', sortOrder: 0 }]);
      const roots = trees.flatMap(t => t.roots);
      assert.strictEqual(roots.length, 2, 'both in-progress same-id issues render');
      const titles = roots.map(r => r.issue.title).sort();
      assert.deepStrictEqual(titles, ['GitHub 7', 'Linear 7']);
    });
  });
});

// =============================================================================
// buildInProgressForest Tests - Subtask Project Inheritance (LIN-53)
// =============================================================================

describe('buildInProgressForest', () => {
  const projects = [
    { id: 'proj-1', name: 'Project One', sortOrder: 1 },
    { id: 'proj-2', name: 'Project Two', sortOrder: 2 }
  ];

  describe('subtask project inheritance (LIN-53)', () => {
    test('in-progress subtask without project appears under parent', () => {
      const parent = createIssue({
        id: 'parent',
        title: 'Parent',
        project: { id: 'proj-1' },
        state: { name: 'Backlog', type: 'backlog' }
      });
      const child = createIssue({
        id: 'child',
        title: 'Child',
        project: null,
        parent: { id: 'parent' },
        state: { name: 'In Progress', type: 'started' }
      });

      const result = buildInProgressForest([parent, child], projects);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].projectId, 'proj-1');
      assert.strictEqual(result[0].roots.length, 1);
      assert.strictEqual(result[0].roots[0].issue.id, 'parent');
      assert.strictEqual(result[0].roots[0].children.length, 1);
      assert.strictEqual(result[0].roots[0].children[0].issue.id, 'child');
    });

    test('in-progress subtask with explicit project keeps its own project', () => {
      const parent = createIssue({
        id: 'parent',
        title: 'Parent',
        project: { id: 'proj-1' },
        state: { name: 'Backlog', type: 'backlog' }
      });
      const child = createIssue({
        id: 'child',
        title: 'Child',
        project: { id: 'proj-2' },
        parent: { id: 'parent' },
        state: { name: 'In Progress', type: 'started' }
      });

      const result = buildInProgressForest([parent, child], projects);

      // Child has explicit project, so both projects appear
      // (user intentionally assigned subtask to different project)
      assert.strictEqual(result.length, 2);
      const projIds = result.map(r => r.projectId).sort();
      assert.deepStrictEqual(projIds, ['proj-1', 'proj-2']);
    });
  });

  // LIN-341: the two NO_PROJECT_ID special-cases (display-name + sort-last) were
  // extended to also recognise the synthetic __periodicals__ id.
  describe('__periodicals__ special-cases (LIN-341)', () => {
    test('display-name branch names the group "Periodicals"', () => {
      const issue = createIssue({
        id: 'p1',
        title: 'Under periodicals',
        project: { id: PERIODICALS_PROJECT_ID },
        state: { name: 'In Progress', type: 'started' }
      });

      const result = buildInProgressForest([issue], projects);
      const group = result.find(r => r.projectId === PERIODICALS_PROJECT_ID);
      assert.ok(group, 'group present');
      assert.strictEqual(group.projectName, 'Periodicals');
    });

    test('sort-last branch keeps __periodicals__ after real projects', () => {
      const real = createIssue({
        id: 'r1',
        title: 'Real project task',
        project: { id: 'proj-1' },
        state: { name: 'In Progress', type: 'started' }
      });
      const periodical = createIssue({
        id: 'p1',
        title: 'Under periodicals',
        project: { id: PERIODICALS_PROJECT_ID },
        state: { name: 'In Progress', type: 'started' }
      });

      const result = buildInProgressForest([periodical, real], projects);
      // Real project sorts before the synthetic periodicals group.
      assert.strictEqual(result[result.length - 1].projectId, PERIODICALS_PROJECT_ID);
      assert.strictEqual(result[0].projectId, 'proj-1');
    });

    test('NO_PROJECT_ID still sorts last too (not regressed)', () => {
      const real = createIssue({
        id: 'r1',
        title: 'Real',
        project: { id: 'proj-1' },
        state: { name: 'In Progress', type: 'started' }
      });
      const orphan = createIssue({
        id: 'o1',
        title: 'Orphan',
        project: null,
        state: { name: 'In Progress', type: 'started' }
      });

      const result = buildInProgressForest([orphan, real], projects);
      assert.strictEqual(result[result.length - 1].projectId, NO_PROJECT_ID);
      const group = result.find(r => r.projectId === NO_PROJECT_ID);
      assert.strictEqual(group.projectName, 'No Project');
    });
  });
});

// =============================================================================
// isTerminalState / isCompleted Tests (LIN-276)
// =============================================================================

describe('isTerminalState', () => {
  test('returns true for completed', () => {
    assert.strictEqual(isTerminalState('completed'), true);
  });
  test('returns true for canceled', () => {
    assert.strictEqual(isTerminalState('canceled'), true);
  });
  test('returns true for duplicate', () => {
    assert.strictEqual(isTerminalState('duplicate'), true);
  });
  test('returns false for active states', () => {
    assert.strictEqual(isTerminalState('started'), false);
    assert.strictEqual(isTerminalState('unstarted'), false);
    assert.strictEqual(isTerminalState('backlog'), false);
  });
  test('returns false for undefined / unknown', () => {
    assert.strictEqual(isTerminalState(undefined), false);
    assert.strictEqual(isTerminalState(null), false);
    assert.strictEqual(isTerminalState('whatever'), false);
  });
  test('TERMINAL_STATE_TYPES includes duplicate', () => {
    assert.ok(TERMINAL_STATE_TYPES.includes('duplicate'));
    assert.ok(TERMINAL_STATE_TYPES.includes('canceled'));
    assert.ok(TERMINAL_STATE_TYPES.includes('completed'));
  });
});

describe('isCompleted', () => {
  test('treats duplicate-state issues as completed (LIN-276)', () => {
    const issue = { state: { name: 'Duplicate', type: 'duplicate' } };
    assert.strictEqual(isCompleted(issue), true);
  });
  test('treats canceled-state issues as completed', () => {
    const issue = { state: { name: 'Canceled', type: 'canceled' } };
    assert.strictEqual(isCompleted(issue), true);
  });
  test('treats started-state issues as not completed', () => {
    const issue = { state: { name: 'In Progress', type: 'started' } };
    assert.strictEqual(isCompleted(issue), false);
  });
});

// =============================================================================
// selectFocusSubtask — frontier ranking + skip-blocked (LIN-433)
// =============================================================================

/**
 * Build a canonical child. `inverseBlocks` is a list of {identifier, type}
 * blockers — modelling "blocker blocks this child" via the child's inverse
 * `blocks` edge, which is how canonical children actually carry blocking data
 * (no forward blocksIds). `blockedLabel` adds the (abolished, LIN-357) `blocked`
 * label — which no longer affects blocking, so it is only used to assert that.
 */
function makeChild(identifier, type, { inverseBlocks = [], blockedLabel = false } = {}) {
  return {
    id: 'id-' + identifier,
    identifier,
    title: identifier,
    state: { name: type, type },
    labels: { nodes: blockedLabel ? [{ name: 'blocked' }] : [] },
    inverseRelations: {
      nodes: inverseBlocks.map(b => ({
        type: 'blocks',
        issue: { id: 'id-' + b.identifier, state: { type: b.type || 'unstarted' } }
      }))
    }
  };
}

describe('childrenToGraphNodes (LIN-433)', () => {
  test('reconstructs in-set blocksIds from inverse blocks edges', () => {
    // LIN-30 blocks LIN-40 (modelled as inverse-blocks on LIN-40).
    const children = [
      makeChild('LIN-30', 'unstarted'),
      makeChild('LIN-40', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-30' }] })
    ];
    const nodes = childrenToGraphNodes(children);
    const blocker = nodes.find(n => n.identifier === 'LIN-30');
    assert.deepStrictEqual(blocker.blocksIds, ['id-LIN-40']);
  });

  test('ignores blockers that are not in the sibling set', () => {
    const children = [
      makeChild('LIN-40', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-99' }] })
    ];
    const nodes = childrenToGraphNodes(children);
    assert.deepStrictEqual(nodes[0].blocksIds, []);
  });

  test('does not mutate the input children', () => {
    const children = [makeChild('LIN-1', 'unstarted')];
    childrenToGraphNodes(children);
    assert.strictEqual(children[0].downstreamUnblocks, undefined);
    assert.strictEqual(children[0].blocksIds, undefined);
  });
});

describe('selectFocusSubtask', () => {
  test('(i) HAR-149 shape: a blocked in-progress child is NOT chosen; the non-blocked frontier is', () => {
    // LIN-2 is in progress but blocked by active LIN-9; LIN-3 is in progress, free.
    const children = [
      makeChild('LIN-2', 'started', { inverseBlocks: [{ identifier: 'LIN-9', type: 'started' }] }),
      makeChild('LIN-3', 'started')
    ];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-3');
  });

  test('(i) all in-progress children blocked → descends to the non-blocked todo, not the blocked started child', () => {
    const children = [
      makeChild('LIN-2', 'started', { inverseBlocks: [{ identifier: 'LIN-9', type: 'started' }] }),
      makeChild('LIN-5', 'unstarted')
    ];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-5');
  });

  test('(ii) within a tier, higher downstreamUnblocks wins over identifier order', () => {
    // Non-blocked todos: LIN-30 (blocks LIN-40) and LIN-20 (blocks nothing).
    // Identifier order would pick LIN-20; frontier ranking prefers LIN-30 (unblocks 1).
    const children = [
      makeChild('LIN-20', 'unstarted'),
      makeChild('LIN-30', 'unstarted'),
      makeChild('LIN-40', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-30' }] })
    ];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-30');
  });

  test('(ii) critical-path length breaks ties when unblocks counts are equal', () => {
    // Chain LIN-10 → LIN-11 → LIN-12 gives LIN-10 critical path 3, unblocks 2.
    // LIN-50 blocks only LIN-51: unblocks 1. Both non-blocked todos; LIN-10 wins on unblocks.
    const children = [
      makeChild('LIN-50', 'unstarted'),
      makeChild('LIN-51', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-50' }] }),
      makeChild('LIN-10', 'unstarted'),
      makeChild('LIN-11', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-10' }] }),
      makeChild('LIN-12', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-11' }] })
    ];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-10');
  });

  test('(iii) an edge-free set degrades to identifier order (today\'s behavior preserved)', () => {
    const children = [
      makeChild('LIN-30', 'unstarted'),
      makeChild('LIN-10', 'unstarted'),
      makeChild('LIN-20', 'unstarted')
    ];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-10');
  });

  test('non-blocked in-progress is preferred over a non-blocked todo', () => {
    const children = [
      makeChild('LIN-9', 'unstarted'),
      makeChild('LIN-7', 'started')
    ];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-7');
  });

  test('the `blocked` label alone does NOT exclude an in-progress child (LIN-357)', () => {
    // The label is abolished; only an incomplete blocking relation excludes. So the
    // labelled-but-relation-free in-progress child is still chosen over the todo.
    const children = [
      makeChild('LIN-2', 'started', { blockedLabel: true }),
      makeChild('LIN-3', 'unstarted')
    ];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-2');
  });

  test('all candidates blocked → falls back to lowest-identifier non-terminal', () => {
    const children = [
      makeChild('LIN-5', 'started', { inverseBlocks: [{ identifier: 'LIN-9', type: 'started' }] }),
      makeChild('LIN-3', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-9', type: 'started' }] })
    ];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-3');
  });

  test('terminal blocker does not block (resolved) — its successor stays eligible', () => {
    // LIN-3 is blocked only by LIN-9 which is Done → LIN-3 is actionable.
    const children = [
      makeChild('LIN-3', 'started', { inverseBlocks: [{ identifier: 'LIN-9', type: 'completed' }] })
    ];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-3');
  });

  test('returns null for empty / nullish input', () => {
    assert.strictEqual(selectFocusSubtask([]), null);
    assert.strictEqual(selectFocusSubtask(null), null);
    assert.strictEqual(selectFocusSubtask(undefined), null);
  });

  test('all children terminal → undefined (no non-terminal to pick)', () => {
    const children = [makeChild('LIN-1', 'completed'), makeChild('LIN-2', 'canceled')];
    assert.strictEqual(selectFocusSubtask(children), undefined);
  });
});

// =============================================================================
// Transitive dead-end guard — hasOpenFrontier + selectFocusSubtask (LIN-444)
// =============================================================================

/** Attach a subtree to a child built by makeChild. */
function withChildren(child, kids) {
  return { ...child, children: { nodes: kids } };
}

describe('hasOpenFrontier (LIN-444)', () => {
  test('a non-blocked leaf reaches an open frontier (itself)', () => {
    assert.strictEqual(hasOpenFrontier(makeChild('LIN-1', 'unstarted'), isBlocked), true);
  });

  test('a terminal node reaches no frontier', () => {
    assert.strictEqual(hasOpenFrontier(makeChild('LIN-1', 'completed'), isBlocked), false);
  });

  test('a directly-blocked node reaches no frontier', () => {
    const n = makeChild('LIN-1', 'started', { inverseBlocks: [{ identifier: 'LIN-9', type: 'started' }] });
    assert.strictEqual(hasOpenFrontier(n, isBlocked), false);
  });

  test('non-blocked parent whose only child dead-ends in a block is itself a dead end', () => {
    const blockedKid = makeChild('LIN-502', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-900', type: 'started' }] });
    const parent = withChildren(makeChild('LIN-497', 'started'), [blockedKid]);
    assert.strictEqual(hasOpenFrontier(parent, isBlocked), false);
  });

  test('non-blocked parent with an open child reaches an open frontier', () => {
    const openKid = makeChild('LIN-616', 'unstarted');
    const parent = withChildren(makeChild('LIN-545', 'started'), [openKid]);
    assert.strictEqual(hasOpenFrontier(parent, isBlocked), true);
  });

  test('ids-only children (no state/blocked signal) degrade to open — guard stays inert', () => {
    const parent = withChildren(makeChild('LIN-1', 'started'), [{ id: 'g1' }, { id: 'g2' }]);
    assert.strictEqual(hasOpenFrontier(parent, isBlocked), true);
  });

  test('a parent reaches an open frontier if ANY branch is open (mixed children)', () => {
    const blockedKid = makeChild('LIN-2', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-9', type: 'started' }] });
    const openKid = makeChild('LIN-3', 'unstarted');
    const parent = withChildren(makeChild('LIN-1', 'started'), [blockedKid, openKid]);
    assert.strictEqual(hasOpenFrontier(parent, isBlocked), true);
  });
});

describe('selectFocusSubtask — transitive dead-end guard (LIN-444)', () => {
  // HAR-149 shape: two non-blocked in-progress children. HAR-497 (lower id) would
  // win on identifier order, but its only child dead-ends at a blocked node; HAR-545
  // descends into an open frontier. The guard routes to HAR-545.
  const deadEnd = (id) => withChildren(
    makeChild(id, 'started'),
    [makeChild(id + '-blocked', 'unstarted', { inverseBlocks: [{ identifier: 'EXT-1', type: 'started' }] })]
  );
  const openEpic = (id, childState = 'unstarted') => withChildren(
    makeChild(id, 'started'),
    [makeChild(id + '-open', childState)]
  );

  test('the dead-branch child is skipped for the open-frontier sibling', () => {
    const children = [deadEnd('LIN-497'), openEpic('LIN-545')];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-545');
  });

  test('without subtree blocked-ness the harness/provider is blind → identifier order (the red baseline)', () => {
    // Same two epics, but children carry no subtree → both read as open → LIN-497 wins.
    const children = [makeChild('LIN-497', 'started'), makeChild('LIN-545', 'started')];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-497');
  });

  test('open frontier beats the state tier: an open todo is chosen over a dead-end in-progress', () => {
    const children = [deadEnd('LIN-497'), withChildren(makeChild('LIN-545', 'unstarted'), [makeChild('LIN-616', 'unstarted')])];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-545');
  });

  test('ranking signal, not a hard skip: when every candidate dead-ends, the best dead-end is still chosen', () => {
    const children = [deadEnd('LIN-497'), deadEnd('LIN-498')];
    // No open frontier anywhere → fall back to the dead-end pool, lowest identifier.
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-497');
  });

  test('within the open pool, frontier ranking still applies (no behavior loss)', () => {
    // Both open; LIN-30 blocks LIN-40 in-set → higher downstreamUnblocks wins over id order.
    const children = [
      withChildren(makeChild('LIN-20', 'unstarted'), [makeChild('LIN-21', 'unstarted')]),
      withChildren(makeChild('LIN-30', 'unstarted'), [makeChild('LIN-31', 'unstarted')]),
      makeChild('LIN-40', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-30' }] })
    ];
    assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-30');
  });
});

describe('computeFrontierFacts (LIN-433)', () => {
  test('reports open/blocked counts and the descent-aligned next child', () => {
    const children = [
      makeChild('LIN-1', 'completed'),
      makeChild('LIN-2', 'started', { inverseBlocks: [{ identifier: 'LIN-9', type: 'started' }] }),
      makeChild('LIN-3', 'started')
    ];
    const facts = computeFrontierFacts(children);
    assert.strictEqual(facts.openCount, 2);          // LIN-2, LIN-3 (LIN-1 terminal)
    assert.strictEqual(facts.blockedCount, 1);       // LIN-2 blocked
    assert.strictEqual(facts.nextChild, 'LIN-3');    // same child selectFocusSubtask picks
    assert.deepStrictEqual(
      facts.openChildren,
      [{ identifier: 'LIN-2', blocked: true }, { identifier: 'LIN-3', blocked: false }]
    );
  });

  test('nextChild matches selectFocusSubtask exactly (no advertised/descent disagreement)', () => {
    const children = [
      makeChild('LIN-20', 'unstarted'),
      makeChild('LIN-30', 'unstarted'),
      makeChild('LIN-40', 'unstarted', { inverseBlocks: [{ identifier: 'LIN-30' }] })
    ];
    assert.strictEqual(computeFrontierFacts(children).nextChild, selectFocusSubtask(children).identifier);
  });

  test('returns null for empty input', () => {
    assert.strictEqual(computeFrontierFacts([]), null);
    assert.strictEqual(computeFrontierFacts(null), null);
  });
});

// =============================================================================
// buildRecentActivityForest Tests (LIN-490)
// =============================================================================

describe('buildRecentActivityForest', () => {
  // Helpers for window-relative timestamps (default look-back is 7 days).
  const ago = ms => new Date(Date.now() - ms).toISOString();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const projects = [{ id: 'proj-1', name: 'Product' }];

  function rootsOf(forest) {
    assert.strictEqual(forest.length <= 1, true, 'forest is a single flat tree or empty');
    return forest.length ? forest[0].roots : [];
  }

  test('returns empty array when nothing is in the window', () => {
    const issues = [createIssue({ createdAt: ago(30 * DAY), updatedAt: ago(30 * DAY) })];
    assert.deepStrictEqual(buildRecentActivityForest(issues, projects), []);
  });

  test('surfaces a recently completed issue as a "completed" row', () => {
    const issues = [createIssue({
      id: 'done', state: { name: 'Done', type: 'completed' }, project: { id: 'proj-1' },
      createdAt: ago(10 * DAY), completedAt: ago(2 * HOUR), updatedAt: ago(2 * HOUR)
    })];
    const roots = rootsOf(buildRecentActivityForest(issues, projects));
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].activityKind, 'completed');
    assert.strictEqual(roots[0].activityAt, issues[0].completedAt);
    assert.strictEqual(roots[0].projectName, 'Product');
  });

  test('surfaces a recently created issue as a "created" row (no new data needed)', () => {
    const issues = [createIssue({
      id: 'new', state: { name: 'Backlog', type: 'backlog' },
      createdAt: ago(3 * HOUR), updatedAt: ago(3 * HOUR)
    })];
    const roots = rootsOf(buildRecentActivityForest(issues, projects));
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].activityKind, 'created');
    assert.strictEqual(roots[0].activityAt, issues[0].createdAt);
  });

  test('surfaces an edited issue (updatedAt well after createdAt) as an "edited" row', () => {
    const issues = [createIssue({
      id: 'edited', state: { name: 'In Progress', type: 'started' },
      createdAt: ago(20 * DAY), updatedAt: ago(5 * HOUR)
    })];
    const roots = rootsOf(buildRecentActivityForest(issues, projects));
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].activityKind, 'edited');
    assert.strictEqual(roots[0].activityAt, issues[0].updatedAt);
  });

  test('a freshly created issue is "created", not "edited" (creation bump within epsilon)', () => {
    const createdAt = ago(2 * HOUR);
    const issues = [createIssue({
      id: 'fresh', state: { name: 'Backlog', type: 'backlog' },
      createdAt,
      // updatedAt only a few seconds after createdAt → below the edit epsilon
      updatedAt: new Date(new Date(createdAt).getTime() + 5 * 1000).toISOString()
    })];
    const roots = rootsOf(buildRecentActivityForest(issues, projects));
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].activityKind, 'created');
  });

  test('emits at most one row per issue: created-then-completed reads as "completed"', () => {
    const issues = [createIssue({
      id: 'both', state: { name: 'Done', type: 'completed' },
      createdAt: ago(6 * HOUR), updatedAt: ago(1 * HOUR), completedAt: ago(1 * HOUR)
    })];
    const roots = rootsOf(buildRecentActivityForest(issues, projects));
    assert.strictEqual(roots.length, 1, 'one issue → one row (dedupe)');
    assert.strictEqual(roots[0].activityKind, 'completed');
  });

  test('sorts all activity kinds together, newest activity first', () => {
    const issues = [
      createIssue({ id: 'a-old-created', state: { name: 'Backlog', type: 'backlog' }, createdAt: ago(5 * DAY), updatedAt: ago(5 * DAY) }),
      createIssue({ id: 'b-recent-completed', state: { name: 'Done', type: 'completed' }, createdAt: ago(10 * DAY), completedAt: ago(1 * HOUR), updatedAt: ago(1 * HOUR) }),
      createIssue({ id: 'c-recent-edited', state: { name: 'In Progress', type: 'started' }, createdAt: ago(10 * DAY), updatedAt: ago(2 * HOUR) })
    ];
    const roots = rootsOf(buildRecentActivityForest(issues, projects));
    assert.deepStrictEqual(roots.map(r => r.issue.id), ['b-recent-completed', 'c-recent-edited', 'a-old-created']);
  });

  test('kinds option restricts the feed (pipeline keeps completion-only)', () => {
    const issues = [
      createIssue({ id: 'done', state: { name: 'Done', type: 'completed' }, createdAt: ago(10 * DAY), completedAt: ago(1 * HOUR), updatedAt: ago(1 * HOUR) }),
      createIssue({ id: 'new', state: { name: 'Backlog', type: 'backlog' }, createdAt: ago(2 * HOUR), updatedAt: ago(2 * HOUR) }),
      createIssue({ id: 'edited', state: { name: 'In Progress', type: 'started' }, createdAt: ago(10 * DAY), updatedAt: ago(3 * HOUR) })
    ];
    const roots = rootsOf(buildRecentActivityForest(issues, projects, 7, { kinds: ['completed'] }));
    assert.deepStrictEqual(roots.map(r => r.issue.id), ['done']);
    assert.strictEqual(roots[0].activityKind, 'completed');
  });
});
