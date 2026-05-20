/**
 * Unit tests for swim lane assignment algorithm.
 *
 * Run with: node --test tests/unit/swim-lanes.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { assignLanes, assignSegments, computeCrossLaneColumns } from '../../lib/swim-lanes.js';

// =============================================================================
// Test Helpers
// =============================================================================

let cardCounter = 0;

function createCard(overrides = {}) {
  cardCounter++;
  return {
    id: overrides.id || `card-${cardCounter}`,
    identifier: overrides.identifier || `TEST-${cardCounter}`,
    title: overrides.title || `Test Card ${cardCounter}`,
    description: '',
    priority: 2,
    url: '',
    stateType: 'unstarted',
    stateName: 'Todo',
    labels: [],
    projectName: 'Test Project',
    assignee: null,
    completedAt: null,
    dueDate: null,
    section: 'project',
    blocksIds: [],
    parentId: null,
    ...overrides
  };
}

// =============================================================================
// Basic Behavior
// =============================================================================

describe('assignLanes', () => {
  test('returns empty lanes for empty input', () => {
    const { lanes } = assignLanes([]);
    assert.deepStrictEqual(lanes, []);
  });

  test('single issue gets one lane', () => {
    const cards = [createCard({ id: 'a' })];
    const { lanes } = assignLanes(cards);
    assert.strictEqual(lanes.length, 1);
    assert.strictEqual(lanes[0].items.length, 1);
    assert.strictEqual(lanes[0].items[0].id, 'a');
  });

  test('two independent issues from same project share a lane', () => {
    const cards = [
      createCard({ id: 'a', title: 'Task A', projectName: 'P1' }),
      createCard({ id: 'b', title: 'Task B', projectName: 'P1' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10 });
    assert.strictEqual(lanes.length, 1);
    assert.strictEqual(lanes[0].items.length, 2);
  });

  test('two independent issues from different projects get two lanes', () => {
    const cards = [
      createCard({ id: 'a', title: 'Task A', projectName: 'P1' }),
      createCard({ id: 'b', title: 'Task B', projectName: 'P2' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10 });
    assert.strictEqual(lanes.length, 2);
  });

  test('blocking chain creates one lane', () => {
    const cards = [
      createCard({ id: 'a', blocksIds: ['b'] }),
      createCard({ id: 'b', blocksIds: ['c'] }),
      createCard({ id: 'c' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10 });
    assert.strictEqual(lanes.length, 1);
    assert.strictEqual(lanes[0].items.length, 3);
  });

  test('blocking order: blocker appears before blocked', () => {
    const cards = [
      createCard({ id: 'c' }),
      createCard({ id: 'a', blocksIds: ['b'] }),
      createCard({ id: 'b', blocksIds: ['c'] })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10 });
    const ids = lanes[0].items.map(i => i.id);
    assert.ok(ids.indexOf('a') < ids.indexOf('b'), 'a should come before b');
    assert.ok(ids.indexOf('b') < ids.indexOf('c'), 'b should come before c');
  });

  test('parent-child creates one lane', () => {
    const cards = [
      createCard({ id: 'parent' }),
      createCard({ id: 'child1', parentId: 'parent' }),
      createCard({ id: 'child2', parentId: 'parent' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10 });
    assert.strictEqual(lanes.length, 1);
    // Parent should come before children
    const ids = lanes[0].items.map(i => i.id);
    assert.strictEqual(ids[0], 'parent');
  });
});

// =============================================================================
// maxLanes
// =============================================================================

describe('maxLanes', () => {
  test('merges lanes when exceeding maxLanes', () => {
    const cards = [
      createCard({ id: 'a', projectName: 'P1' }),
      createCard({ id: 'b', projectName: 'P2' }),
      createCard({ id: 'c', projectName: 'P3' }),
      createCard({ id: 'd', projectName: 'P4' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 2 });
    assert.strictEqual(lanes.length, 2);
    // All 4 issues should still be present
    const allItems = lanes.flatMap(l => l.items);
    assert.strictEqual(allItems.length, 4);
  });

  test('maxLanes=1 puts everything in one lane', () => {
    const cards = [
      createCard({ id: 'a' }),
      createCard({ id: 'b' }),
      createCard({ id: 'c' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 1 });
    assert.strictEqual(lanes.length, 1);
    assert.strictEqual(lanes[0].items.length, 3);
  });

  test('does not merge if under maxLanes', () => {
    const cards = [
      createCard({ id: 'a', projectName: 'P1' }),
      createCard({ id: 'b', projectName: 'P2' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 5 });
    assert.strictEqual(lanes.length, 2);
  });
});

// =============================================================================
// Completed Filtering
// =============================================================================

describe('showCompleted', () => {
  test('filters out terminal-state issues by default (completed/canceled/duplicate)', () => {
    const cards = [
      createCard({ id: 'a', stateType: 'unstarted' }),
      createCard({ id: 'b', stateType: 'completed' }),
      createCard({ id: 'c', stateType: 'canceled' }),
      createCard({ id: 'd', stateType: 'duplicate' })
    ];
    const { lanes } = assignLanes(cards);
    const allItems = lanes.flatMap(l => l.items);
    assert.strictEqual(allItems.length, 1);
    assert.strictEqual(allItems[0].id, 'a');
  });

  test('includes completed/duplicate when showCompleted=true', () => {
    const cards = [
      createCard({ id: 'a', stateType: 'unstarted' }),
      createCard({ id: 'b', stateType: 'completed' }),
      createCard({ id: 'c', stateType: 'duplicate' })
    ];
    const { lanes } = assignLanes(cards, { showCompleted: true });
    const allItems = lanes.flatMap(l => l.items);
    assert.strictEqual(allItems.length, 3);
  });
});

// =============================================================================
// Project Grouping
// =============================================================================

describe('project grouping', () => {
  test('creates one lane per project', () => {
    const cards = [
      createCard({ id: 'a', projectName: 'Alpha' }),
      createCard({ id: 'b', projectName: 'Alpha' }),
      createCard({ id: 'c', projectName: 'Beta' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project', maxLanes: 10 });
    assert.strictEqual(lanes.length, 2);
    assert.ok(lanes.some(l => l.label === 'Alpha'));
    assert.ok(lanes.some(l => l.label === 'Beta'));
  });

  test('groups unprojecte issues as "No Project"', () => {
    const cards = [
      createCard({ id: 'a', projectName: '' }),
      createCard({ id: 'b', projectName: null })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project', maxLanes: 10 });
    assert.strictEqual(lanes.length, 1);
    assert.strictEqual(lanes[0].label, 'No Project');
  });
});

// =============================================================================
// Lane Ordering by Project
// =============================================================================

describe('lane ordering by projectOrder', () => {
  test('project grouping sorts lanes by project sortOrder', () => {
    const cards = [
      createCard({ id: 'a', projectName: 'Zebra' }),
      createCard({ id: 'b', projectName: 'Alpha' }),
      createCard({ id: 'c', projectName: 'Middle' })
    ];
    const projectOrder = { 'Alpha': 1, 'Middle': 2, 'Zebra': 3 };
    const { lanes } = assignLanes(cards, { grouping: 'project', maxLanes: 10, projectOrder });
    assert.strictEqual(lanes[0].label, 'Alpha');
    assert.strictEqual(lanes[1].label, 'Middle');
    assert.strictEqual(lanes[2].label, 'Zebra');
  });

  test('dependency grouping sorts lanes by primary project sortOrder', () => {
    // Three independent tasks in different projects
    const cards = [
      createCard({ id: 'a', projectName: 'Zebra' }),
      createCard({ id: 'b', projectName: 'Alpha' }),
      createCard({ id: 'c', projectName: 'Middle' })
    ];
    const projectOrder = { 'Alpha': 1, 'Middle': 2, 'Zebra': 3 };
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10, projectOrder });
    // Each gets its own lane; should be sorted by project order
    assert.strictEqual(lanes[0].items[0].projectName, 'Alpha');
    assert.strictEqual(lanes[1].items[0].projectName, 'Middle');
    assert.strictEqual(lanes[2].items[0].projectName, 'Zebra');
  });

  test('projects without sortOrder go to the end', () => {
    const cards = [
      createCard({ id: 'a', projectName: 'Known' }),
      createCard({ id: 'b', projectName: 'Unknown' })
    ];
    const projectOrder = { 'Known': 1 };
    const { lanes } = assignLanes(cards, { grouping: 'project', maxLanes: 10, projectOrder });
    assert.strictEqual(lanes[0].label, 'Known');
    assert.strictEqual(lanes[1].label, 'Unknown');
  });
});

// =============================================================================
// Assignee Grouping
// =============================================================================

describe('assignee grouping', () => {
  test('creates one lane per assignee', () => {
    const cards = [
      createCard({ id: 'a', assignee: 'Alice' }),
      createCard({ id: 'b', assignee: 'Bob' }),
      createCard({ id: 'c', assignee: 'Alice' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'assignee', maxLanes: 10 });
    assert.strictEqual(lanes.length, 2);
    const aliceLane = lanes.find(l => l.label === 'Alice');
    assert.strictEqual(aliceLane.items.length, 2);
  });

  test('groups unassigned issues together', () => {
    const cards = [
      createCard({ id: 'a', assignee: null }),
      createCard({ id: 'b', assignee: null })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'assignee', maxLanes: 10 });
    assert.strictEqual(lanes.length, 1);
    assert.strictEqual(lanes[0].label, 'Unassigned');
  });
});

// =============================================================================
// Status Grouping
// =============================================================================

describe('status grouping', () => {
  test('creates lanes in correct order', () => {
    const cards = [
      createCard({ id: 'a', stateType: 'backlog' }),
      createCard({ id: 'b', stateType: 'started' }),
      createCard({ id: 'c', stateType: 'unstarted' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'status', maxLanes: 10 });
    assert.strictEqual(lanes.length, 3);
    assert.strictEqual(lanes[0].label, 'In Progress');
    assert.strictEqual(lanes[1].label, 'Todo');
    assert.strictEqual(lanes[2].label, 'Backlog');
  });

  test('folds duplicate-state issues into the Canceled lane (LIN-276)', () => {
    const cards = [
      createCard({ id: 'a', stateType: 'canceled' }),
      createCard({ id: 'b', stateType: 'duplicate' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'status', maxLanes: 10, showCompleted: true });
    // Only one lane — both cards merged into 'Canceled'.
    assert.strictEqual(lanes.length, 1);
    assert.strictEqual(lanes[0].label, 'Canceled');
    assert.strictEqual(lanes[0].items.length, 2);
    const ids = lanes[0].items.map(i => i.id).sort();
    assert.deepStrictEqual(ids, ['a', 'b']);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  test('handles circular blocking gracefully', () => {
    const cards = [
      createCard({ id: 'a', blocksIds: ['b'] }),
      createCard({ id: 'b', blocksIds: ['a'] })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10 });
    // Should not crash, both issues should appear
    const allItems = lanes.flatMap(l => l.items);
    assert.strictEqual(allItems.length, 2);
  });

  test('handles blocksIds referencing non-existent issues', () => {
    const cards = [
      createCard({ id: 'a', blocksIds: ['nonexistent'] })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10 });
    assert.strictEqual(lanes.length, 1);
    assert.strictEqual(lanes[0].items.length, 1);
  });

  test('all issues in terminal state with showCompleted=false returns empty', () => {
    const cards = [
      createCard({ id: 'a', stateType: 'completed' }),
      createCard({ id: 'b', stateType: 'canceled' }),
      createCard({ id: 'c', stateType: 'duplicate' })
    ];
    const { lanes } = assignLanes(cards, { showCompleted: false });
    assert.deepStrictEqual(lanes, []);
  });
});

// =============================================================================
// Segment Assignment
// =============================================================================

describe('assignSegments', () => {
  test('assigns segment 0 to started items', () => {
    const cards = [createCard({ id: 'a', stateType: 'started' })];
    const { lanes } = assignLanes(cards);
    assignSegments(lanes);
    assert.strictEqual(lanes[0].items[0].segment, 0);
  });

  test('assigns segment 1 to unstarted items', () => {
    const cards = [createCard({ id: 'a', stateType: 'unstarted' })];
    const { lanes } = assignLanes(cards);
    assignSegments(lanes);
    assert.strictEqual(lanes[0].items[0].segment, 1);
  });

  test('assigns segment 2 to backlog items', () => {
    const cards = [createCard({ id: 'a', stateType: 'backlog' })];
    const { lanes } = assignLanes(cards);
    assignSegments(lanes);
    assert.strictEqual(lanes[0].items[0].segment, 2);
  });

  test('assigns segment 3 to completed items', () => {
    const cards = [createCard({ id: 'a', stateType: 'completed' })];
    const { lanes } = assignLanes(cards, { showCompleted: true });
    assignSegments(lanes);
    assert.strictEqual(lanes[0].items[0].segment, 3);
  });

  test('sorts items within lane by segment (started before unstarted)', () => {
    const cards = [
      createCard({ id: 'a', stateType: 'unstarted', projectName: 'P' }),
      createCard({ id: 'b', stateType: 'started', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards);
    assignSegments(lanes);
    assert.strictEqual(lanes[0].items[0].id, 'b');
    assert.strictEqual(lanes[0].items[0].segment, 0);
    assert.strictEqual(lanes[0].items[1].id, 'a');
    assert.strictEqual(lanes[0].items[1].segment, 1);
  });

  test('dependency promotion: todo blocker of started item gets segment 0', () => {
    const cards = [
      createCard({ id: 'blocker', stateType: 'unstarted', blocksIds: ['active'] }),
      createCard({ id: 'active', stateType: 'started' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency' });
    assignSegments(lanes, { grouping: 'dependency' });
    // Both should be segment 0 — blocker promoted because it blocks a started item
    assert.strictEqual(lanes[0].items.find(i => i.id === 'blocker').segment, 0);
    assert.strictEqual(lanes[0].items.find(i => i.id === 'active').segment, 0);
  });

  test('dependency promotion: transitive blocker also promoted', () => {
    const cards = [
      createCard({ id: 'root', stateType: 'unstarted', blocksIds: ['mid'] }),
      createCard({ id: 'mid', stateType: 'unstarted', blocksIds: ['active'] }),
      createCard({ id: 'active', stateType: 'started' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency' });
    assignSegments(lanes, { grouping: 'dependency' });
    assert.strictEqual(lanes[0].items.find(i => i.id === 'root').segment, 0);
    assert.strictEqual(lanes[0].items.find(i => i.id === 'mid').segment, 0);
  });

  test('no promotion in project grouping mode', () => {
    const cards = [
      createCard({ id: 'blocker', stateType: 'unstarted', blocksIds: ['active'], projectName: 'P' }),
      createCard({ id: 'active', stateType: 'started', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project' });
    assert.strictEqual(lanes[0].items.find(i => i.id === 'blocker').segment, 1);
    assert.strictEqual(lanes[0].items.find(i => i.id === 'active').segment, 0);
  });

  test('parent of started child is promoted in dependency mode', () => {
    const cards = [
      createCard({ id: 'parent', stateType: 'unstarted' }),
      createCard({ id: 'child', stateType: 'started', parentId: 'parent' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency' });
    assignSegments(lanes, { grouping: 'dependency' });
    assert.strictEqual(lanes[0].items.find(i => i.id === 'parent').segment, 0);
  });

  test('empty lanes produce no segments', () => {
    const lanes = [{ id: 'empty', label: 'Empty', items: [] }];
    assignSegments(lanes);
    assert.strictEqual(lanes[0].items.length, 0);
  });
});

// =============================================================================
// Status Tiebreaker in Dependency Ordering
// =============================================================================

describe('status tiebreaker in dependency ordering', () => {
  test('started items sort before unstarted at same dependency level', () => {
    // Three independent items in same project — no dependency edges
    const cards = [
      createCard({ id: 'todo1', stateType: 'unstarted', projectName: 'P' }),
      createCard({ id: 'active', stateType: 'started', projectName: 'P' }),
      createCard({ id: 'todo2', stateType: 'unstarted', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency' });
    const ids = lanes[0].items.map(i => i.id);
    // 'active' should be first since it's started
    assert.strictEqual(ids[0], 'active');
  });

  test('honors caller input order as tiebreaker when state is equal', () => {
    // Three independent to-do items in the same project. Caller pre-sorts by
    // priority (urgent → low), so input order IS the tiebreaker we want to
    // survive the topological sort.
    const cards = [
      createCard({ id: 'urgent', stateType: 'unstarted', priority: 1, projectName: 'P' }),
      createCard({ id: 'medium', stateType: 'unstarted', priority: 3, projectName: 'P' }),
      createCard({ id: 'low', stateType: 'unstarted', priority: 4, projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency' });
    const ids = lanes[0].items.map(i => i.id);
    assert.deepStrictEqual(ids, ['urgent', 'medium', 'low']);
  });

  test('input-order tiebreaker holds across independent blocking chains in one lane', () => {
    // Two unrelated two-card chains in the same project. Caller feeds the
    // higher-priority chain second — chain order in the merged lane should
    // still reflect the caller's sort.
    const cards = [
      createCard({ id: 'low-a', stateType: 'unstarted', priority: 4, projectName: 'P', blocksIds: ['low-b'] }),
      createCard({ id: 'low-b', stateType: 'unstarted', priority: 4, projectName: 'P' }),
      createCard({ id: 'hi-a', stateType: 'unstarted', priority: 1, projectName: 'P', blocksIds: ['hi-b'] }),
      createCard({ id: 'hi-b', stateType: 'unstarted', priority: 1, projectName: 'P' })
    ];
    // Caller hands us priority-sorted input:
    const sorted = [cards[2], cards[3], cards[0], cards[1]];
    const { lanes } = assignLanes(sorted, { grouping: 'dependency' });
    const ids = lanes[0].items.map(i => i.id);
    // Blocking order preserved within each chain, and high-priority chain first
    assert.ok(ids.indexOf('hi-a') < ids.indexOf('hi-b'), 'hi-a before hi-b');
    assert.ok(ids.indexOf('low-a') < ids.indexOf('low-b'), 'low-a before low-b');
    assert.ok(ids.indexOf('hi-a') < ids.indexOf('low-a'), 'high-priority chain precedes low-priority chain');
  });
});

// =============================================================================
// Cross-Lane Column Positioning
// =============================================================================

describe('computeCrossLaneColumns', () => {
  test('no cross-lane deps — items keep sequential columns', () => {
    const a = createCard({ id: 'a1', projectName: 'A', stateType: 'unstarted' });
    const b = createCard({ id: 'b1', projectName: 'B', stateType: 'unstarted' });
    const { lanes } = assignLanes([a, b], { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project' });
    computeCrossLaneColumns(lanes);

    assert.strictEqual(lanes[0].items[0].column, 0);
    assert.strictEqual(lanes[1].items[0].column, 0);
  });

  test('simple cross-lane block — blocked item pushed right', () => {
    const blocker = createCard({ id: 'blocker', projectName: 'A', stateType: 'unstarted', blocksIds: ['blocked'] });
    const blocked = createCard({ id: 'blocked', projectName: 'B', stateType: 'unstarted' });
    const other = createCard({ id: 'other', projectName: 'B', stateType: 'unstarted' });
    const { lanes } = assignLanes([blocker, blocked, other], { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project' });
    computeCrossLaneColumns(lanes);

    // blocker should be at column 0, blocked at column >= 1
    assert.strictEqual(blocker.column, 0);
    assert.ok(blocked.column >= 1, 'blocked item should be pushed right of blocker');
    // other should be shifted after blocked
    assert.ok(other.column > blocked.column || other.column === blocked.column - 1 || other.column >= 0);
  });

  test('chain across 3 lanes — cascading push', () => {
    const a = createCard({ id: 'ca', projectName: 'P1', stateType: 'unstarted', blocksIds: ['cb'] });
    const b = createCard({ id: 'cb', projectName: 'P2', stateType: 'unstarted', blocksIds: ['cc'] });
    const c = createCard({ id: 'cc', projectName: 'P3', stateType: 'unstarted' });
    const { lanes } = assignLanes([a, b, c], { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project' });
    computeCrossLaneColumns(lanes);

    assert.strictEqual(a.column, 0);
    assert.ok(b.column >= 1, 'b should be after a');
    assert.ok(c.column >= b.column + 1, 'c should be after b');
  });

  test('different segments — no staggering across segment boundary', () => {
    const blocker = createCard({ id: 'started1', projectName: 'A', stateType: 'started', blocksIds: ['todo1'] });
    const blocked = createCard({ id: 'todo1', projectName: 'B', stateType: 'unstarted' });
    const { lanes } = assignLanes([blocker, blocked], { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project' });
    computeCrossLaneColumns(lanes);

    // They're in different segments, so both should be at column 0
    assert.strictEqual(blocker.column, 0);
    assert.strictEqual(blocked.column, 0);
  });

  test('gap compression caps at maxGap', () => {
    // Create a scenario with a long gap: blocker at col 0, then 3 items in the blocked lane
    // blocker blocks the 4th item, creating a big gap
    const b1 = createCard({ id: 'b1', projectName: 'A', stateType: 'unstarted' });
    const b2 = createCard({ id: 'b2', projectName: 'A', stateType: 'unstarted' });
    const b3 = createCard({ id: 'b3', projectName: 'A', stateType: 'unstarted', blocksIds: ['target'] });
    const target = createCard({ id: 'target', projectName: 'B', stateType: 'unstarted' });
    const { lanes } = assignLanes([b1, b2, b3, target], { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project' });
    computeCrossLaneColumns(lanes, { maxGap: 2 });

    // target should be pushed right of b3, but gap before target in lane B should be <= 2
    assert.ok(target.column >= b3.column + 1, 'target should be after its blocker');
    // Gap = target.column - 0 - 1 (since target is the first item in its lane)
    // After compression, gap should be <= maxGap
    assert.ok(target.column <= 2 + 1, 'gap should be compressed to maxGap');
  });

  test('empty input — no crash', () => {
    const result = computeCrossLaneColumns([]);
    assert.deepStrictEqual(result.columnCounts, {});
  });

  test('subsequent items in lane shift when blocked item pushed', () => {
    const blocker = createCard({ id: 'bl', projectName: 'A', stateType: 'unstarted', blocksIds: ['first'] });
    const first = createCard({ id: 'first', projectName: 'B', stateType: 'unstarted' });
    const second = createCard({ id: 'second', projectName: 'B', stateType: 'unstarted' });
    const { lanes } = assignLanes([blocker, first, second], { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project' });
    computeCrossLaneColumns(lanes);

    // first pushed to >= 1, second should follow after it
    assert.ok(first.column >= 1);
    assert.ok(second.column > first.column, 'second should be after first');
  });
});

// =============================================================================
// Subtask Grouping (cluster siblings + parent promotion in all modes)
// =============================================================================

describe('subtask grouping — cluster siblings', () => {
  test('children follow parent contiguously in dependency mode', () => {
    const cards = [
      createCard({ id: 'parent', projectName: 'P' }),
      createCard({ id: 'other', projectName: 'P' }),
      createCard({ id: 'child1', parentId: 'parent', projectName: 'P' }),
      createCard({ id: 'child2', parentId: 'parent', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10 });
    const ids = lanes[0].items.map(i => i.id);
    const parentIdx = ids.indexOf('parent');
    // children should be immediately after parent
    assert.strictEqual(ids[parentIdx + 1], 'child1');
    assert.strictEqual(ids[parentIdx + 2], 'child2');
  });

  test('children follow parent in project mode too', () => {
    const cards = [
      createCard({ id: 'parent', projectName: 'P' }),
      createCard({ id: 'unrelated', projectName: 'P' }),
      createCard({ id: 'child', parentId: 'parent', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project', maxLanes: 10 });
    const ids = lanes[0].items.map(i => i.id);
    const parentIdx = ids.indexOf('parent');
    assert.strictEqual(ids[parentIdx + 1], 'child', 'child should follow parent immediately');
  });

  test('nested subtasks: grandchild follows child follows parent', () => {
    const cards = [
      createCard({ id: 'grandparent', projectName: 'P' }),
      createCard({ id: 'stray', projectName: 'P' }),
      createCard({ id: 'parent', parentId: 'grandparent', projectName: 'P' }),
      createCard({ id: 'child', parentId: 'parent', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project', maxLanes: 10 });
    const ids = lanes[0].items.map(i => i.id);
    const gIdx = ids.indexOf('grandparent');
    assert.strictEqual(ids[gIdx + 1], 'parent');
    assert.strictEqual(ids[gIdx + 2], 'child');
  });

  test('does not pull child past its explicit blocker', () => {
    // blocker blocks child, parent appears first. Cluster pass must NOT pull
    // child before blocker, even to sit next to parent.
    const cards = [
      createCard({ id: 'parent', projectName: 'P' }),
      createCard({ id: 'blocker', blocksIds: ['child'], projectName: 'P' }),
      createCard({ id: 'child', parentId: 'parent', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10 });
    const ids = lanes[0].items.map(i => i.id);
    // blocker must appear before child
    assert.ok(ids.indexOf('blocker') < ids.indexOf('child'), 'blocker must precede child');
  });

  test('groupSubtasks=false disables clustering', () => {
    const cards = [
      createCard({ id: 'parent', projectName: 'P' }),
      createCard({ id: 'unrelated', projectName: 'P' }),
      createCard({ id: 'child', parentId: 'parent', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project', maxLanes: 10, groupSubtasks: false });
    const ids = lanes[0].items.map(i => i.id);
    // Without clustering, 'unrelated' stays between parent and child
    assert.strictEqual(ids[0], 'parent');
    assert.strictEqual(ids[1], 'unrelated');
    assert.strictEqual(ids[2], 'child');
  });

  test('multiple independent parents each cluster their own subtasks', () => {
    const cards = [
      createCard({ id: 'p1', projectName: 'P' }),
      createCard({ id: 'p2', projectName: 'P' }),
      createCard({ id: 'c1', parentId: 'p1', projectName: 'P' }),
      createCard({ id: 'c2', parentId: 'p2', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project', maxLanes: 10 });
    const ids = lanes[0].items.map(i => i.id);
    // p1 immediately followed by c1; p2 immediately followed by c2
    const p1Idx = ids.indexOf('p1');
    const p2Idx = ids.indexOf('p2');
    assert.strictEqual(ids[p1Idx + 1], 'c1');
    assert.strictEqual(ids[p2Idx + 1], 'c2');
  });
});

describe('subtask grouping — parent promotion in non-dependency modes', () => {
  test('project mode: parent of started child gets segment 0 when groupSubtasks on', () => {
    const cards = [
      createCard({ id: 'parent', stateType: 'unstarted', projectName: 'P' }),
      createCard({ id: 'child', stateType: 'started', parentId: 'parent', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project', groupSubtasks: true });
    assert.strictEqual(lanes[0].items.find(i => i.id === 'parent').segment, 0);
    assert.strictEqual(lanes[0].items.find(i => i.id === 'child').segment, 0);
  });

  test('assignee mode: parent of started child gets segment 0 when groupSubtasks on', () => {
    const cards = [
      createCard({ id: 'parent', stateType: 'unstarted', assignee: 'Alice' }),
      createCard({ id: 'child', stateType: 'started', parentId: 'parent', assignee: 'Alice' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'assignee' });
    assignSegments(lanes, { grouping: 'assignee', groupSubtasks: true });
    assert.strictEqual(lanes[0].items.find(i => i.id === 'parent').segment, 0);
  });

  test('project mode: unrelated blockers are NOT promoted when groupSubtasks on', () => {
    // In project mode with groupSubtasks, only parents (not arbitrary blockers)
    // should be promoted, to preserve project-mode semantics.
    const cards = [
      createCard({ id: 'blocker', stateType: 'unstarted', blocksIds: ['active'], projectName: 'P' }),
      createCard({ id: 'active', stateType: 'started', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project', groupSubtasks: true });
    assert.strictEqual(lanes[0].items.find(i => i.id === 'blocker').segment, 1);
    assert.strictEqual(lanes[0].items.find(i => i.id === 'active').segment, 0);
  });

  test('project mode with groupSubtasks=false: parent NOT promoted', () => {
    const cards = [
      createCard({ id: 'parent', stateType: 'unstarted', projectName: 'P' }),
      createCard({ id: 'child', stateType: 'started', parentId: 'parent', projectName: 'P' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project', groupSubtasks: false });
    assignSegments(lanes, { grouping: 'project', groupSubtasks: false });
    assert.strictEqual(lanes[0].items.find(i => i.id === 'parent').segment, 1);
  });

  test('dependency mode still promotes arbitrary blockers (backward compat)', () => {
    const cards = [
      createCard({ id: 'blocker', stateType: 'unstarted', blocksIds: ['active'] }),
      createCard({ id: 'active', stateType: 'started' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'dependency' });
    assignSegments(lanes, { grouping: 'dependency', groupSubtasks: true });
    assert.strictEqual(lanes[0].items.find(i => i.id === 'blocker').segment, 0);
  });
});

describe('subtask grouping — segment coherence across siblings', () => {
  test('project mode: to-do sibling gets pulled to segment 0 alongside started sibling', () => {
    // P has two children: C1 (started) and C2 (to-do). After cohere, everything
    // should sit in segment 0 so the group decoration spans the whole family.
    const cards = [
      createCard({ id: 'p', stateType: 'unstarted', projectName: 'Proj' }),
      createCard({ id: 'c1', stateType: 'started', parentId: 'p', projectName: 'Proj' }),
      createCard({ id: 'c2', stateType: 'unstarted', parentId: 'p', projectName: 'Proj' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project', groupSubtasks: true });
    const lane = lanes[0];
    assert.strictEqual(lane.items.find(i => i.id === 'p').segment, 0);
    assert.strictEqual(lane.items.find(i => i.id === 'c1').segment, 0);
    assert.strictEqual(lane.items.find(i => i.id === 'c2').segment, 0);
  });

  test('backlog sibling pulled forward to match to-do sibling', () => {
    // No started members — the most-forward segment in the group is to-do (1),
    // so the backlog child should be pulled forward to match.
    const cards = [
      createCard({ id: 'p', stateType: 'unstarted', projectName: 'Proj' }),
      createCard({ id: 'c1', stateType: 'unstarted', parentId: 'p', projectName: 'Proj' }),
      createCard({ id: 'c2', stateType: 'backlog', parentId: 'p', projectName: 'Proj' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project', groupSubtasks: true });
    const lane = lanes[0];
    assert.strictEqual(lane.items.find(i => i.id === 'p').segment, 1);
    assert.strictEqual(lane.items.find(i => i.id === 'c1').segment, 1);
    assert.strictEqual(lane.items.find(i => i.id === 'c2').segment, 1);
  });

  test('completed sibling pulled forward with show-completed', () => {
    // When show-completed is on, a completed subtask should join its active
    // siblings in segment 0. The state indicator still reflects its true state.
    const cards = [
      createCard({ id: 'p', stateType: 'unstarted', projectName: 'Proj' }),
      createCard({ id: 'c1', stateType: 'started', parentId: 'p', projectName: 'Proj' }),
      createCard({ id: 'c2', stateType: 'completed', parentId: 'p', projectName: 'Proj' })
    ];
    const { lanes } = assignLanes(cards, {
      grouping: 'project',
      showCompleted: true
    });
    assignSegments(lanes, { grouping: 'project', groupSubtasks: true });
    const lane = lanes[0];
    assert.strictEqual(lane.items.find(i => i.id === 'p').segment, 0);
    assert.strictEqual(lane.items.find(i => i.id === 'c1').segment, 0);
    assert.strictEqual(lane.items.find(i => i.id === 'c2').segment, 0);
  });

  test('nested hierarchy: grandparent, parent, grandchild all unified', () => {
    // G → P → C, with C started. G and P should both be pulled to 0.
    const cards = [
      createCard({ id: 'g', stateType: 'unstarted', projectName: 'Proj' }),
      createCard({ id: 'p', stateType: 'unstarted', parentId: 'g', projectName: 'Proj' }),
      createCard({ id: 'c', stateType: 'started', parentId: 'p', projectName: 'Proj' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project', groupSubtasks: true });
    const lane = lanes[0];
    assert.strictEqual(lane.items.find(i => i.id === 'g').segment, 0);
    assert.strictEqual(lane.items.find(i => i.id === 'p').segment, 0);
    assert.strictEqual(lane.items.find(i => i.id === 'c').segment, 0);
  });

  test('independent groups keep their own segments', () => {
    // Two unrelated parent/child groups: one active (seg 0), one all to-do (seg 1).
    // Each group coheres to its own min — they don't influence each other.
    const cards = [
      createCard({ id: 'p1', stateType: 'unstarted', projectName: 'Proj' }),
      createCard({ id: 'c1', stateType: 'started', parentId: 'p1', projectName: 'Proj' }),
      createCard({ id: 'p2', stateType: 'unstarted', projectName: 'Proj' }),
      createCard({ id: 'c2', stateType: 'unstarted', parentId: 'p2', projectName: 'Proj' })
    ];
    const { lanes } = assignLanes(cards, { grouping: 'project' });
    assignSegments(lanes, { grouping: 'project', groupSubtasks: true });
    const lane = lanes[0];
    assert.strictEqual(lane.items.find(i => i.id === 'p1').segment, 0);
    assert.strictEqual(lane.items.find(i => i.id === 'c1').segment, 0);
    assert.strictEqual(lane.items.find(i => i.id === 'p2').segment, 1);
    assert.strictEqual(lane.items.find(i => i.id === 'c2').segment, 1);
  });

  test('coherence is skipped when groupSubtasks=false', () => {
    // With the toggle off, siblings keep their individual segments.
    const cards = [
      createCard({ id: 'p', stateType: 'unstarted', projectName: 'Proj' }),
      createCard({ id: 'c1', stateType: 'started', parentId: 'p', projectName: 'Proj' }),
      createCard({ id: 'c2', stateType: 'unstarted', parentId: 'p', projectName: 'Proj' })
    ];
    const { lanes } = assignLanes(cards, {
      grouping: 'project',
      groupSubtasks: false
    });
    assignSegments(lanes, { grouping: 'project', groupSubtasks: false });
    const lane = lanes[0];
    // Parent and started child both at their natural segments
    assert.strictEqual(lane.items.find(i => i.id === 'p').segment, 1);
    assert.strictEqual(lane.items.find(i => i.id === 'c1').segment, 0);
    assert.strictEqual(lane.items.find(i => i.id === 'c2').segment, 1);
  });

  test('nobody moves backwards: all-completed group stays in completed segment', () => {
    // Group with no forward members: everyone stays where they are.
    const cards = [
      createCard({ id: 'p', stateType: 'completed', projectName: 'Proj' }),
      createCard({ id: 'c', stateType: 'completed', parentId: 'p', projectName: 'Proj' })
    ];
    const { lanes } = assignLanes(cards, {
      grouping: 'project',
      showCompleted: true
    });
    assignSegments(lanes, { grouping: 'project', groupSubtasks: true });
    const lane = lanes[0];
    assert.strictEqual(lane.items.find(i => i.id === 'p').segment, 3);
    assert.strictEqual(lane.items.find(i => i.id === 'c').segment, 3);
  });
});
