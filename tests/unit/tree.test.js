/**
 * Unit tests for tree.js
 *
 * Run with: node --test tests/unit/tree.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildForest, buildInProgressForest, NO_PROJECT_ID, PERIODICALS_PROJECT_ID, isTerminalState, isCompleted, TERMINAL_STATE_TYPES } from '../../lib/tree.js';

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
