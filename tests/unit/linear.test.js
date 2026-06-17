/**
 * Unit tests for linear.js
 *
 * Run with: node --test tests/unit/linear.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
// isBlocked / selectFocusSubtask relocated to lib/tree.js (LIN-330) — they are
// canonical-state/tree-shape helpers, not Linear-transport-specific.
import { selectFocusSubtask, isBlocked } from '../../lib/tree.js';

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

  // Deterministic tie-break: among equally-eligible candidates, pick the lowest
  // identifier (natural order) regardless of input array order. Linear returns
  // children newest-first, so without this the pick is the most-recently-created
  // subtask — the LIN-177 S5-instead-of-S2 surprise.
  describe('tie-break by identifier (LIN-177)', () => {
    test('picks lowest-identifier todo when input is newest-first', () => {
      const children = [
        { id: '5', identifier: 'LIN-337', state: { type: 'backlog' } },
        { id: '4', identifier: 'LIN-336', state: { type: 'backlog' } },
        { id: '3', identifier: 'LIN-335', state: { type: 'backlog' } },
        { id: '2', identifier: 'LIN-334', state: { type: 'backlog' } },
        { id: 'd1', identifier: 'LIN-333', state: { type: 'completed' } },
        { id: 'd0', identifier: 'LIN-332', state: { type: 'completed' } }
      ];
      // All four backlog children are unblocked → earliest remaining (LIN-334) wins.
      assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-334');
    });

    test('compares numerically, not as strings (LIN-9 before LIN-10)', () => {
      const children = [
        { id: 'b', identifier: 'LIN-10', state: { type: 'unstarted' } },
        { id: 'a', identifier: 'LIN-9', state: { type: 'unstarted' } }
      ];
      assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-9');
    });

    test('in-progress tie-break also picks lowest identifier', () => {
      const children = [
        { id: 'y', identifier: 'LIN-20', state: { type: 'started' } },
        { id: 'x', identifier: 'LIN-2', state: { type: 'started' } }
      ];
      assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-2');
    });

    test('fallback tie-break (all blocked) also picks lowest identifier', () => {
      // LIN-357: blocked-ness is the blocking relationship, not a label.
      const blocked = { nodes: [{ type: 'blocks', issue: { id: 'x', state: { type: 'started' } } }] };
      const children = [
        { id: 'b', identifier: 'LIN-30', state: { type: 'unstarted' }, inverseRelations: blocked },
        { id: 'a', identifier: 'LIN-3', state: { type: 'unstarted' }, inverseRelations: blocked }
      ];
      assert.strictEqual(selectFocusSubtask(children).identifier, 'LIN-3');
    });
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

    // LIN-357: a task is blocked by an incomplete blocking RELATIONSHIP, not a label.
    const blockingRelation = { nodes: [{ type: 'blocks', issue: { id: 'x', state: { type: 'started' } } }] };

    test('skips blocked task and selects next available todo', () => {
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        {
          id: '2',
          identifier: 'LIN-2',
          state: { type: 'unstarted' },
          inverseRelations: blockingRelation
        },
        { id: '3', identifier: 'LIN-3', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(children);
      // Should skip LIN-2 (blocked) and select LIN-3
      assert.strictEqual(result.id, '3', 'Should skip blocked task and select non-blocked todo');
    });

    test('skips multiple blocked tasks', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          inverseRelations: blockingRelation
        },
        {
          id: '2',
          identifier: 'LIN-2',
          state: { type: 'unstarted' },
          inverseRelations: blockingRelation,
          labels: { nodes: [{ name: 'bug' }] }
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
      const blockingRelation = { nodes: [{ type: 'blocks', issue: { id: 'x', state: { type: 'started' } } }] };
      const children = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        {
          id: '2',
          identifier: 'LIN-2',
          state: { type: 'unstarted' },
          inverseRelations: blockingRelation
        },
        {
          id: '3',
          identifier: 'LIN-3',
          state: { type: 'unstarted' },
          inverseRelations: blockingRelation
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

  // LIN-149 origin / LIN-357: blocked filter depends on blocking-relation data
  describe('LIN-357: blocked filter requires relation data', () => {
    test('without relation data, no task reads as blocked', () => {
      // No blocking-relation data on any child → the first unstarted is selected.
      const childrenWithoutRelations = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } },
        { id: '3', identifier: 'LIN-3', state: { type: 'unstarted' } }
      ];
      const result = selectFocusSubtask(childrenWithoutRelations);
      assert.strictEqual(result.id, '2', 'Without relation data, first unstarted is selected');
    });

    test('with relation data, blocked filter works correctly', () => {
      const childrenWithRelations = [
        { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
        {
          id: '2',
          identifier: 'LIN-2',
          state: { type: 'unstarted' },
          inverseRelations: { nodes: [{ type: 'blocks', issue: { id: 'x', state: { type: 'started' } } }] }
        },
        {
          id: '3',
          identifier: 'LIN-3',
          state: { type: 'unstarted' },
          inverseRelations: { nodes: [] }
        }
      ];
      const result = selectFocusSubtask(childrenWithRelations);
      // LIN-2 is blocked by an incomplete blocker → correctly skipped
      assert.strictEqual(result.id, '3', 'With relation data, blocked task is skipped');
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

    test('skips multiple relation-blocked tasks', () => {
      const children = [
        {
          id: '1',
          identifier: 'LIN-1',
          state: { type: 'unstarted' },
          inverseRelations: {
            nodes: [{
              type: 'blocks',
              issue: { id: 'blocker0', identifier: 'LIN-98', state: { type: 'unstarted' } }
            }]
          }
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
      assert.strictEqual(result.id, '3', 'Should skip relation-blocked tasks');
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
  // LIN-357: the `blocked` LABEL was abolished — a label is no longer a blocking
  // signal. Blocked-ness is the incomplete blocking RELATIONSHIP only.
  describe('labels are not a blocking signal (LIN-357)', () => {
    test('returns false for the (abolished) blocked label', () => {
      const issue = { labels: { nodes: [{ name: 'blocked' }] } };
      assert.strictEqual(isBlocked(issue), false);
    });

    test('returns false for Blocked label (case variations)', () => {
      const issue = { labels: { nodes: [{ name: 'Blocked' }] } };
      assert.strictEqual(isBlocked(issue), false);
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

  describe('label + relation interplay (LIN-357)', () => {
    test('the abolished blocked label alone does NOT block', () => {
      const issue = {
        labels: { nodes: [{ name: 'blocked' }] },
        inverseRelations: { nodes: [] }
      };
      assert.strictEqual(isBlocked(issue), false);
    });

    test('a blocking relation blocks regardless of labels', () => {
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
