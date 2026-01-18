/**
 * Unit tests for tree.js
 *
 * Run with: node --test tests/unit/tree.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildForest, buildInProgressForest, NO_PROJECT_ID } from '../../lib/tree.js';

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
});
