/**
 * Unit tests for linear.js
 *
 * Run with: node --test tests/unit/linear.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { selectFocusSubtask, isBlocked } from '../../lib/linear.js';

// =============================================================================
// selectFocusSubtask Tests
// =============================================================================

describe('selectFocusSubtask', () => {
  test('returns null for null input', () => {
    assert.strictEqual(selectFocusSubtask(null), null);
  });

  test('returns null for undefined input', () => {
    assert.strictEqual(selectFocusSubtask(undefined), null);
  });

  test('returns null for empty array', () => {
    assert.strictEqual(selectFocusSubtask([]), null);
  });

  // Priority 1: In-progress tasks
  describe('priority 1: in-progress tasks', () => {
    test('selects in-progress task first', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'unstarted' } },
        { id: '2', identifier: 'LIN-2', state: { type: 'started' } },
        { id: '3', identifier: 'LIN-3', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '2');
    });

    test('selects first in-progress task when multiple exist', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'started' } },
        { id: '2', identifier: 'LIN-2', state: { type: 'started' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '1');
    });
  });

  // Priority 2: Non-blocked todos
  describe('priority 2: non-blocked todos', () => {
    test('selects first unstarted task when no in-progress', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } },
        { id: '3', identifier: 'LIN-3', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '2');
    });

    test('selects backlog task when no unstarted', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        { id: '2', identifier: 'LIN-2', state: { type: 'backlog' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '2');
    });

    // BUG TEST: This test exposes the bug where blocked tasks are not filtered
    // because labels are not fetched in the GraphQL query
    test('skips blocked task and selects next available todo', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        {
          id: '2',
          identifier: 'LIN-2',
          state: { type: 'unstarted' },
          labels: { nodes: [{ name: 'blocked' }] }
        },
        { id: '3', identifier: 'LIN-3', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      // Should skip LIN-2 (blocked) and select LIN-3
      assert.strictEqual(result.id, '3', 'Should skip blocked task and select non-blocked todo');
    });

    test('skips blocked task with uppercase label', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          labels: { nodes: [{ name: 'Blocked' }] }
        },
        { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '2', 'Should handle case-insensitive blocked label');
    });

    test('skips multiple blocked tasks', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          labels: { nodes: [{ name: 'blocked' }] }
        },
        {
          id: '2',
          identifier: 'LIN-2',
          state: { type: 'unstarted' },
          labels: { nodes: [{ name: 'blocked' }, { name: 'bug' }] }
        },
        { id: '3', identifier: 'LIN-3', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '3', 'Should skip all blocked tasks');
    });

    test('handles task with empty labels array', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          labels: { nodes: [] }
        }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '1');
    });

    test('handles task with non-blocked labels', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          labels: { nodes: [{ name: 'bug' }, { name: 'urgent' }] }
        }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '1');
    });
  });

  // Priority 3: Fallback to first incomplete
  describe('priority 3: fallback to first incomplete', () => {
    test('falls back to blocked task when all todos are blocked', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        {
          id: '2',
          identifier: 'LIN-2',
          state: { type: 'unstarted' },
          labels: { nodes: [{ name: 'blocked' }] }
        },
        {
          id: '3',
          identifier: 'LIN-3',
          state: { type: 'unstarted' },
          labels: { nodes: [{ name: 'blocked' }] }
        }
      ];
      const result = selectFocusSubtask(children);
      // When all todos are blocked, should fall back to first incomplete
      assert.strictEqual(result.id, '2');
    });

    test('returns null when all tasks are in terminal states', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        { id: '2', identifier: 'LIN-2', state: { type: 'canceled' } },
        { id: '3', identifier: 'LIN-3', state: { type: 'duplicate' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result, undefined);
    });

    test('skips duplicate tasks in fallback (LIN-276)', () => {
      // Only a duplicate child — fallback must not select it.
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'duplicate' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result, undefined);
    });
  });

  // Bug scenario: LIN-149 - labels not fetched for children
  describe('LIN-149: blocked filter requires labels in data', () => {
    test('BUG: without labels data, blocked filter is bypassed', () => {
      // This simulates what happens when GraphQL doesn't fetch labels for children
      // The first unstarted task is selected even if it would be blocked
      const childrenWithoutLabels = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } }, // Should be blocked, but no labels
        { id: '3', identifier: 'LIN-3', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(childrenWithoutLabels);
      // Without labels, LIN-2 is incorrectly selected (it should be blocked)
      // This documents the bug behavior - after fix, GraphQL should provide labels
      assert.strictEqual(result.id, '2', 'Without labels data, first unstarted is selected');
    });

    test('with labels data, blocked filter works correctly', () => {
      // This is the expected behavior once GraphQL fetches labels
      const childrenWithLabels = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        {
          id: '2',
          identifier: 'LIN-2',
          state: { type: 'unstarted' },
          labels: { nodes: [{ name: 'blocked' }] }
        },
        {
          id: '3',
          identifier: 'LIN-3',
          state: { type: 'unstarted' },
          labels: { nodes: [] }
        }
      ];
      const result = selectFocusSubtask(childrenWithLabels);
      // With labels, LIN-2 is correctly skipped
      assert.strictEqual(result.id, '3', 'With labels data, blocked task is skipped');
    });
  });

  // Relation-based blocking (LIN-149 extended fix)
  describe('relation-based blocking', () => {
    test('skips task blocked by incomplete issue via relation', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        {
          id: '2',
          identifier: 'LIN-2',
          state: { type: 'unstarted' },
          inverseRelations: {
            nodes: [{
              type: 'blocks',
              issue: { id: 'blocker', identifier: 'LIN-99', state: { type: 'started' } }
            }]
          }
        },
        { id: '3', identifier: 'LIN-3', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '3', 'Should skip task blocked by incomplete issue');
    });

    test('selects task when blocking issue is completed', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          inverseRelations: {
            nodes: [{
              type: 'blocks',
              issue: { id: 'blocker', identifier: 'LIN-99', state: { type: 'completed' } }
            }]
          }
        }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '1', 'Should select task when blocker is completed');
    });

    test('selects task when blocking issue is canceled', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          inverseRelations: {
            nodes: [{
              type: 'blocks',
              issue: { id: 'blocker', identifier: 'LIN-99', state: { type: 'canceled' } }
            }]
          }
        }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '1', 'Should select task when blocker is canceled');
    });

    test('skips task with multiple blockers where one is incomplete', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          inverseRelations: {
            nodes: [
              { type: 'blocks', issue: { id: 'b1', identifier: 'LIN-98', state: { type: 'completed' } } },
              { type: 'blocks', issue: { id: 'b2', identifier: 'LIN-99', state: { type: 'unstarted' } } }
            ]
          }
        },
        { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '2', 'Should skip task if any blocker is incomplete');
    });

    test('ignores non-blocking relations', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          inverseRelations: {
            nodes: [
              { type: 'related', issue: { id: 'r1', identifier: 'LIN-99', state: { type: 'unstarted' } } },
              { type: 'duplicate', issue: { id: 'd1', identifier: 'LIN-98', state: { type: 'unstarted' } } }
            ]
          }
        }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '1', 'Should ignore non-blocking relations');
    });

    test('handles combination of label and relation blocking', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          labels: { nodes: [{ name: 'blocked' }] }
        },
        {
          id: '2',
          identifier: 'LIN-2',
          state: { type: 'unstarted' },
          inverseRelations: {
            nodes: [{
              type: 'blocks',
              issue: { id: 'blocker', identifier: 'LIN-99', state: { type: 'started' } }
            }]
          }
        },
        { id: '3', identifier: 'LIN-3', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '3', 'Should skip both label-blocked and relation-blocked tasks');
    });
  });

  // Edge cases
  describe('edge cases', () => {
    test('handles missing state property', () => {
      const children = [
        { id: '1', identifier: 'LIN-1' },
        { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '2');
    });

    test('handles null state', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: null },
        { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      assert.strictEqual(result.id, '2');
    });
  });
});

// =============================================================================
// isBlocked Tests
// =============================================================================

describe('isBlocked', () => {
  describe('label-based blocking', () => {
    test('returns true for blocked label', () => {
      const issue = { labels: { nodes: [{ name: 'blocked' }] } };
      assert.strictEqual(isBlocked(issue), true);
    });

    test('returns true for Blocked label (case insensitive)', () => {
      const issue = { labels: { nodes: [{ name: 'Blocked' }] } };
      assert.strictEqual(isBlocked(issue), true);
    });

    test('returns true for BLOCKED label (case insensitive)', () => {
      const issue = { labels: { nodes: [{ name: 'BLOCKED' }] } };
      assert.strictEqual(isBlocked(issue), true);
    });

    test('returns false for other labels', () => {
      const issue = { labels: { nodes: [{ name: 'bug' }, { name: 'urgent' }] } };
      assert.strictEqual(isBlocked(issue), false);
    });

    test('returns false for empty labels', () => {
      const issue = { labels: { nodes: [] } };
      assert.strictEqual(isBlocked(issue), false);
    });

    test('returns false for missing labels', () => {
      const issue = {};
      assert.strictEqual(isBlocked(issue), false);
    });
  });

  describe('relation-based blocking', () => {
    test('returns true when blocked by incomplete issue', () => {
      const issue = {
        inverseRelations: {
          nodes: [{
            type: 'blocks',
            issue: { id: 'blocker', state: { type: 'started' } }
          }]
        }
      };
      assert.strictEqual(isBlocked(issue), true);
    });

    test('returns true when blocked by unstarted issue', () => {
      const issue = {
        inverseRelations: {
          nodes: [{
            type: 'blocks',
            issue: { id: 'blocker', state: { type: 'unstarted' } }
          }]
        }
      };
      assert.strictEqual(isBlocked(issue), true);
    });

    test('returns false when blocker is completed', () => {
      const issue = {
        inverseRelations: {
          nodes: [{
            type: 'blocks',
            issue: { id: 'blocker', state: { type: 'completed' } }
          }]
        }
      };
      assert.strictEqual(isBlocked(issue), false);
    });

    test('returns false when blocker is canceled', () => {
      const issue = {
        inverseRelations: {
          nodes: [{
            type: 'blocks',
            issue: { id: 'blocker', state: { type: 'canceled' } }
          }]
        }
      };
      assert.strictEqual(isBlocked(issue), false);
    });

    test('returns false when blocker is duplicate (LIN-276)', () => {
      const issue = {
        inverseRelations: {
          nodes: [{
            type: 'blocks',
            issue: { id: 'blocker', state: { type: 'duplicate' } }
          }]
        }
      };
      assert.strictEqual(isBlocked(issue), false);
    });

    test('returns true if any blocker is incomplete', () => {
      const issue = {
        inverseRelations: {
          nodes: [
            { type: 'blocks', issue: { id: 'b1', state: { type: 'completed' } } },
            { type: 'blocks', issue: { id: 'b2', state: { type: 'started' } } },
            { type: 'blocks', issue: { id: 'b3', state: { type: 'canceled' } } }
          ]
        }
      };
      assert.strictEqual(isBlocked(issue), true);
    });

    test('returns false when all blockers are complete', () => {
      const issue = {
        inverseRelations: {
          nodes: [
            { type: 'blocks', issue: { id: 'b1', state: { type: 'completed' } } },
            { type: 'blocks', issue: { id: 'b2', state: { type: 'canceled' } } }
          ]
        }
      };
      assert.strictEqual(isBlocked(issue), false);
    });

    test('ignores non-blocking relations', () => {
      const issue = {
        inverseRelations: {
          nodes: [
            { type: 'related', issue: { id: 'r1', state: { type: 'started' } } },
            { type: 'duplicate', issue: { id: 'd1', state: { type: 'unstarted' } } }
          ]
        }
      };
      assert.strictEqual(isBlocked(issue), false);
    });

    test('returns false for empty inverseRelations', () => {
      const issue = { inverseRelations: { nodes: [] } };
      assert.strictEqual(isBlocked(issue), false);
    });

    test('returns false for missing inverseRelations', () => {
      const issue = {};
      assert.strictEqual(isBlocked(issue), false);
    });
  });

  describe('combined blocking', () => {
    test('returns true for label even without relations', () => {
      const issue = {
        labels: { nodes: [{ name: 'blocked' }] },
        inverseRelations: { nodes: [] }
      };
      assert.strictEqual(isBlocked(issue), true);
    });

    test('returns true for relation even without label', () => {
      const issue = {
        labels: { nodes: [] },
        inverseRelations: {
          nodes: [{
            type: 'blocks',
            issue: { id: 'blocker', state: { type: 'started' } }
          }]
        }
      };
      assert.strictEqual(isBlocked(issue), true);
    });
  });
});
