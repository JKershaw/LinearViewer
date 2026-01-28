/**
 * Unit tests for linear.js
 *
 * Run with: node --test tests/unit/linear.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { selectFocusSubtask } from '../../lib/linear.js';

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

    test('returns null when all tasks are completed', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        { id: '2', identifier: 'LIN-2', state: { type: 'canceled' } }
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
