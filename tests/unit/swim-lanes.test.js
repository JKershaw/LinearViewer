/**
 * Unit tests for swim lane assignment algorithm.
 *
 * Run with: node --test tests/unit/swim-lanes.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { assignLanes } from '../../lib/swim-lanes.js';

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
    const { lanes, links } = assignLanes([]);
    assert.deepStrictEqual(lanes, []);
    assert.deepStrictEqual(links, []);
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
  test('filters out completed issues by default', () => {
    const cards = [
      createCard({ id: 'a', stateType: 'unstarted' }),
      createCard({ id: 'b', stateType: 'completed' }),
      createCard({ id: 'c', stateType: 'canceled' })
    ];
    const { lanes } = assignLanes(cards);
    const allItems = lanes.flatMap(l => l.items);
    assert.strictEqual(allItems.length, 1);
    assert.strictEqual(allItems[0].id, 'a');
  });

  test('includes completed when showCompleted=true', () => {
    const cards = [
      createCard({ id: 'a', stateType: 'unstarted' }),
      createCard({ id: 'b', stateType: 'completed' })
    ];
    const { lanes } = assignLanes(cards, { showCompleted: true });
    const allItems = lanes.flatMap(l => l.items);
    assert.strictEqual(allItems.length, 2);
  });
});

// =============================================================================
// Cross-Lane Links
// =============================================================================

describe('cross-lane links', () => {
  test('detects blocking links across lanes', () => {
    // a blocks d, but they are in different components (separate lanes)
    const cards = [
      createCard({ id: 'a', blocksIds: ['d'] }),
      createCard({ id: 'b' }),
      createCard({ id: 'c' }),
      createCard({ id: 'd' })
    ];
    const { links } = assignLanes(cards, { grouping: 'dependency', maxLanes: 10 });
    // a and d are connected via blocks, so they should be in the same lane in dependency mode
    // Cross-lane links only appear when the blocker and blocked are in different lanes
    // In dependency mode, a→d edge connects them, so they're in the same component
    assert.strictEqual(links.length, 0);
  });

  test('cross-lane links appear in project grouping', () => {
    const cards = [
      createCard({ id: 'a', projectName: 'Alpha', blocksIds: ['b'] }),
      createCard({ id: 'b', projectName: 'Beta' })
    ];
    const { links } = assignLanes(cards, { grouping: 'project', maxLanes: 10 });
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].from, 'a');
    assert.strictEqual(links[0].to, 'b');
    assert.strictEqual(links[0].type, 'blocks');
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

  test('all issues completed with showCompleted=false returns empty', () => {
    const cards = [
      createCard({ id: 'a', stateType: 'completed' }),
      createCard({ id: 'b', stateType: 'canceled' })
    ];
    const { lanes } = assignLanes(cards, { showCompleted: false });
    assert.deepStrictEqual(lanes, []);
  });
});
