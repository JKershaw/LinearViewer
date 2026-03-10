/**
 * Unit tests for swipe view sorting and blocking order.
 *
 * Run with: node --test tests/unit/swipe-sort.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { sortIssuesForSwipe, applyBlockingOrder } from '../../lib/render-swipe.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createCard(overrides = {}) {
  return {
    id: 'card-' + Math.random().toString(36).substr(2, 9),
    identifier: '',
    title: 'Test Card',
    description: '',
    priority: 2,
    url: '',
    stateType: 'unstarted',
    stateName: 'Todo',
    labels: [],
    projectName: 'Test Project',
    completedAt: null,
    dueDate: null,
    section: 'project',
    blocksIds: [],
    ...overrides
  };
}

// =============================================================================
// sortIssuesForSwipe
// =============================================================================

describe('sortIssuesForSwipe', () => {
  test('puts completed/canceled issues last', () => {
    const cards = [
      createCard({ id: 'done', stateType: 'completed' }),
      createCard({ id: 'todo', stateType: 'unstarted' }),
      createCard({ id: 'canceled', stateType: 'canceled' }),
    ];
    sortIssuesForSwipe(cards);
    assert.strictEqual(cards[0].id, 'todo');
    assert.ok(['done', 'canceled'].includes(cards[1].id));
    assert.ok(['done', 'canceled'].includes(cards[2].id));
  });

  test('puts bugs before non-bugs within same state group', () => {
    const cards = [
      createCard({ id: 'feature', stateType: 'started', labels: ['feature'], priority: 1 }),
      createCard({ id: 'bug', stateType: 'started', labels: ['bug'], priority: 1 }),
    ];
    sortIssuesForSwipe(cards);
    assert.strictEqual(cards[0].id, 'bug');
    assert.strictEqual(cards[1].id, 'feature');
  });

  test('sorts by state order: started > unstarted > backlog', () => {
    const cards = [
      createCard({ id: 'backlog', stateType: 'backlog', priority: 1 }),
      createCard({ id: 'started', stateType: 'started', priority: 1 }),
      createCard({ id: 'unstarted', stateType: 'unstarted', priority: 1 }),
    ];
    sortIssuesForSwipe(cards);
    assert.deepStrictEqual(cards.map(c => c.id), ['started', 'unstarted', 'backlog']);
  });

  test('sorts by priority within same state', () => {
    const cards = [
      createCard({ id: 'low', stateType: 'unstarted', priority: 4 }),
      createCard({ id: 'urgent', stateType: 'unstarted', priority: 1 }),
      createCard({ id: 'medium', stateType: 'unstarted', priority: 3 }),
    ];
    sortIssuesForSwipe(cards);
    assert.deepStrictEqual(cards.map(c => c.id), ['urgent', 'medium', 'low']);
  });

  test('treats priority 0 (none) as lowest', () => {
    const cards = [
      createCard({ id: 'none', stateType: 'unstarted', priority: 0 }),
      createCard({ id: 'low', stateType: 'unstarted', priority: 4 }),
    ];
    sortIssuesForSwipe(cards);
    assert.deepStrictEqual(cards.map(c => c.id), ['low', 'none']);
  });
});

// =============================================================================
// applyBlockingOrder
// =============================================================================

describe('applyBlockingOrder', () => {
  test('moves blocker before blocked issue', () => {
    const blocker = createCard({ id: 'blocker', stateType: 'unstarted', priority: 4, blocksIds: ['blocked'] });
    const blocked = createCard({ id: 'blocked', stateType: 'unstarted', priority: 1 });
    // blocked has higher priority so sorts first normally
    const sorted = [blocked, blocker];
    const result = applyBlockingOrder(sorted);
    assert.strictEqual(result[0].id, 'blocker');
    assert.strictEqual(result[1].id, 'blocked');
  });

  test('preserves order when no blocking relationships', () => {
    const a = createCard({ id: 'a', stateType: 'started' });
    const b = createCard({ id: 'b', stateType: 'unstarted' });
    const c = createCard({ id: 'c', stateType: 'backlog' });
    const result = applyBlockingOrder([a, b, c]);
    assert.deepStrictEqual(result.map(i => i.id), ['a', 'b', 'c']);
  });

  test('handles chain: A blocks B blocks C', () => {
    const a = createCard({ id: 'a', stateType: 'backlog', priority: 4, blocksIds: ['b'] });
    const b = createCard({ id: 'b', stateType: 'backlog', priority: 3, blocksIds: ['c'] });
    const c = createCard({ id: 'c', stateType: 'backlog', priority: 1 });
    // Original order by priority: c, b, a
    const result = applyBlockingOrder([c, b, a]);
    assert.deepStrictEqual(result.map(i => i.id), ['a', 'b', 'c']);
  });

  test('ignores blocking edges from completed issues', () => {
    const blocker = createCard({ id: 'blocker', stateType: 'completed', blocksIds: ['blocked'] });
    const blocked = createCard({ id: 'blocked', stateType: 'unstarted' });
    // blocker is completed so its edge is ignored — original order preserved
    const result = applyBlockingOrder([blocked, blocker]);
    assert.deepStrictEqual(result.map(i => i.id), ['blocked', 'blocker']);
  });

  test('handles cycles gracefully', () => {
    const a = createCard({ id: 'a', stateType: 'unstarted', blocksIds: ['b'] });
    const b = createCard({ id: 'b', stateType: 'unstarted', blocksIds: ['a'] });
    const result = applyBlockingOrder([a, b]);
    // Both should appear (cycle doesn't cause loss)
    assert.strictEqual(result.length, 2);
    const ids = new Set(result.map(i => i.id));
    assert.ok(ids.has('a'));
    assert.ok(ids.has('b'));
  });

  test('blocking edges to issues outside the set are ignored', () => {
    const a = createCard({ id: 'a', stateType: 'unstarted', blocksIds: ['not-in-set'] });
    const b = createCard({ id: 'b', stateType: 'unstarted' });
    const result = applyBlockingOrder([a, b]);
    assert.deepStrictEqual(result.map(i => i.id), ['a', 'b']);
  });

  test('stable ordering among unrelated issues', () => {
    const blocker = createCard({ id: 'blocker', stateType: 'unstarted', priority: 4, blocksIds: ['blocked'] });
    const unrelated1 = createCard({ id: 'u1', stateType: 'unstarted', priority: 2 });
    const unrelated2 = createCard({ id: 'u2', stateType: 'unstarted', priority: 3 });
    const blocked = createCard({ id: 'blocked', stateType: 'unstarted', priority: 1 });
    // Pre-sorted order: blocked (p1), u1 (p2), u2 (p3), blocker (p4)
    const result = applyBlockingOrder([blocked, unrelated1, unrelated2, blocker]);
    // blocker must come before blocked, unrelated issues keep their relative positions
    const blockerIdx = result.findIndex(i => i.id === 'blocker');
    const blockedIdx = result.findIndex(i => i.id === 'blocked');
    assert.ok(blockerIdx < blockedIdx, 'blocker should appear before blocked');
    // Unrelated issues should maintain their relative order
    const u1Idx = result.findIndex(i => i.id === 'u1');
    const u2Idx = result.findIndex(i => i.id === 'u2');
    assert.ok(u1Idx < u2Idx, 'unrelated issues should keep relative order');
  });

  test('handles empty array', () => {
    const result = applyBlockingOrder([]);
    assert.deepStrictEqual(result, []);
  });

  test('handles single issue', () => {
    const a = createCard({ id: 'a' });
    const result = applyBlockingOrder([a]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'a');
  });

  test('handles issues with missing blocksIds', () => {
    const a = createCard({ id: 'a' });
    delete a.blocksIds;
    const b = createCard({ id: 'b' });
    const result = applyBlockingOrder([a, b]);
    assert.strictEqual(result.length, 2);
  });
});
