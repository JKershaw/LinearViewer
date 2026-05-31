/**
 * Unit tests for roadmap.js — deterministic layer for roadmap projections.
 *
 * Run with: node --test tests/unit/roadmap.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  calculateVelocity,
  buildExecutionQueue,
  groupByMilestone,
  groupByProject,
  projectTimeline,
  findCriticalPaths,
  assessRisks,
  buildHierarchy,
  computeParentRollup,
  flattenTasks,
  issueToRoadmapCard,
  firstParaTruncated
} from '../../lib/roadmap.js';

// =============================================================================
// Test Helpers
// =============================================================================

let counter = 0;

function createIssue(overrides = {}) {
  counter++;
  return {
    id: overrides.id || `issue-${counter}`,
    identifier: overrides.identifier || `TEST-${counter}`,
    title: overrides.title || `Test Issue ${counter}`,
    description: overrides.description ?? '',
    estimate: overrides.estimate ?? null,
    priority: overrides.priority ?? 2,
    sortOrder: overrides.sortOrder ?? counter,
    createdAt: overrides.createdAt || '2024-01-01T00:00:00Z',
    dueDate: overrides.dueDate || null,
    completedAt: overrides.completedAt || null,
    url: '',
    parent: overrides.parent || null,
    project: overrides.project || { id: 'proj-1', name: 'Project Alpha' },
    state: overrides.state || { name: 'Todo', type: 'unstarted' },
    assignee: overrides.assignee || null,
    labels: overrides.labels || { nodes: [] },
    relations: overrides.relations || { nodes: [] },
    ...overrides
  };
}

// Fixed reference date for deterministic week-boundary calculations.
// Must be a Friday so daysAgo(2..4) and daysAgo(16..18) each fall within
// a single ISO week with no Monday boundary crossing.
const FIXED_NOW = new Date('2024-01-12T12:00:00Z'); // Friday, Jan 12 2024

function daysAgo(n) {
  const d = new Date(FIXED_NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function weeksAgo(n) {
  return daysAgo(n * 7);
}

// =============================================================================
// calculateVelocity
// =============================================================================

describe('calculateVelocity', () => {
  test('empty issues returns zero velocity', () => {
    const result = calculateVelocity([], 30);
    assert.strictEqual(result.tasksPerWeek, 0);
    assert.strictEqual(result.pointsPerWeek, 0);
    assert.strictEqual(result.trend, 'stable');
    assert.deepStrictEqual(result.weeklyData, []);
  });

  test('single completed issue gives correct weekly rate', () => {
    const issues = [
      createIssue({
        completedAt: daysAgo(3),
        estimate: 3,
        state: { name: 'Done', type: 'completed' }
      })
    ];
    const result = calculateVelocity(issues, 30, FIXED_NOW);
    assert.ok(result.tasksPerWeek > 0, 'should have non-zero tasks per week');
    assert.ok(result.pointsPerWeek > 0, 'should have non-zero points per week');
  });

  test('multiple weeks of completions gives correct average', () => {
    const issues = [
      createIssue({
        completedAt: daysAgo(3),
        estimate: 2,
        state: { name: 'Done', type: 'completed' }
      }),
      createIssue({
        completedAt: daysAgo(10),
        estimate: 3,
        state: { name: 'Done', type: 'completed' }
      }),
      createIssue({
        completedAt: daysAgo(17),
        estimate: 1,
        state: { name: 'Done', type: 'completed' }
      })
    ];
    const result = calculateVelocity(issues, 30, FIXED_NOW);
    // 3 tasks across ~3 weeks → ~1 task/week
    assert.ok(result.tasksPerWeek > 0);
    assert.ok(result.weeklyData.length > 0, 'should have weekly data entries');
  });

  test('issues outside the window are excluded', () => {
    const issues = [
      createIssue({
        completedAt: daysAgo(5),
        estimate: 2,
        state: { name: 'Done', type: 'completed' }
      }),
      createIssue({
        completedAt: daysAgo(60),
        estimate: 5,
        state: { name: 'Done', type: 'completed' }
      })
    ];
    const result14 = calculateVelocity(issues, 14, FIXED_NOW);
    const result90 = calculateVelocity(issues, 90, FIXED_NOW);
    // 14-day window should only include the recent issue
    assert.ok(result90.pointsPerWeek !== result14.pointsPerWeek || result90.tasksPerWeek !== result14.tasksPerWeek,
      'different windows should produce different results');
  });

  test('only completed issues counted (not started/unstarted)', () => {
    const issues = [
      createIssue({
        completedAt: daysAgo(3),
        estimate: 2,
        state: { name: 'Done', type: 'completed' }
      }),
      createIssue({
        estimate: 5,
        state: { name: 'In Progress', type: 'started' }
      }),
      createIssue({
        estimate: 3,
        state: { name: 'Todo', type: 'unstarted' }
      })
    ];
    const result = calculateVelocity(issues, 30, FIXED_NOW);
    // Only one completed issue with 2 points
    assert.ok(result.tasksPerWeek > 0);
    // Points should reflect only the completed issue's estimate
    assert.ok(result.pointsPerWeek > 0);
  });

  test('points calculation uses estimate field, null treated as 0', () => {
    const issues = [
      createIssue({
        completedAt: daysAgo(3),
        estimate: 5,
        state: { name: 'Done', type: 'completed' }
      }),
      createIssue({
        completedAt: daysAgo(4),
        estimate: null,
        state: { name: 'Done', type: 'completed' }
      })
    ];
    const result = calculateVelocity(issues, 30, FIXED_NOW);
    // 2 tasks but only 5 points total
    assert.ok(result.tasksPerWeek > 0);
    assert.ok(result.pointsPerWeek > 0);
  });

  test('trend detection: increasing', () => {
    // More completions recently than earlier
    const issues = [
      // Recent week: 3 tasks
      createIssue({ completedAt: daysAgo(2), state: { name: 'Done', type: 'completed' } }),
      createIssue({ completedAt: daysAgo(3), state: { name: 'Done', type: 'completed' } }),
      createIssue({ completedAt: daysAgo(4), state: { name: 'Done', type: 'completed' } }),
      // Earlier week: 1 task
      createIssue({ completedAt: daysAgo(16), state: { name: 'Done', type: 'completed' } }),
    ];
    const result = calculateVelocity(issues, 30, FIXED_NOW);
    assert.strictEqual(result.trend, 'increasing');
  });

  test('trend detection: decreasing', () => {
    // Fewer completions recently than earlier
    const issues = [
      // Recent week: 1 task
      createIssue({ completedAt: daysAgo(2), state: { name: 'Done', type: 'completed' } }),
      // Earlier week: 3 tasks
      createIssue({ completedAt: daysAgo(16), state: { name: 'Done', type: 'completed' } }),
      createIssue({ completedAt: daysAgo(17), state: { name: 'Done', type: 'completed' } }),
      createIssue({ completedAt: daysAgo(18), state: { name: 'Done', type: 'completed' } }),
    ];
    const result = calculateVelocity(issues, 30, FIXED_NOW);
    assert.strictEqual(result.trend, 'decreasing');
  });

  test('trend detection: stable', () => {
    // Similar completions across weeks
    const issues = [
      createIssue({ completedAt: daysAgo(3), state: { name: 'Done', type: 'completed' } }),
      createIssue({ completedAt: daysAgo(10), state: { name: 'Done', type: 'completed' } }),
      createIssue({ completedAt: daysAgo(17), state: { name: 'Done', type: 'completed' } }),
      createIssue({ completedAt: daysAgo(24), state: { name: 'Done', type: 'completed' } }),
    ];
    const result = calculateVelocity(issues, 30, FIXED_NOW);
    assert.strictEqual(result.trend, 'stable');
  });

  test('daysBack parameter controls the window', () => {
    const issues = [
      createIssue({
        completedAt: daysAgo(10),
        estimate: 3,
        state: { name: 'Done', type: 'completed' }
      })
    ];
    const result7 = calculateVelocity(issues, 7, FIXED_NOW);
    const result14 = calculateVelocity(issues, 14, FIXED_NOW);
    // 7-day window should miss it; 14-day window should include it
    assert.strictEqual(result7.tasksPerWeek, 0);
    assert.ok(result14.tasksPerWeek > 0);
  });
});

// =============================================================================
// buildExecutionQueue
// =============================================================================

describe('buildExecutionQueue', () => {
  test('empty input returns empty array', () => {
    const result = buildExecutionQueue([]);
    assert.deepStrictEqual(result, []);
  });

  test('completed and canceled issues are filtered out', () => {
    const issues = [
      createIssue({ state: { name: 'Done', type: 'completed' } }),
      createIssue({ state: { name: 'Cancelled', type: 'cancelled' } }),
      createIssue({ state: { name: 'Todo', type: 'unstarted' } }),
    ];
    const result = buildExecutionQueue(issues);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].stateType, 'unstarted');
  });

  test('started issues come before unstarted', () => {
    const issues = [
      createIssue({ id: 'unstarted-1', state: { name: 'Todo', type: 'unstarted' } }),
      createIssue({ id: 'started-1', state: { name: 'In Progress', type: 'started' } }),
    ];
    const result = buildExecutionQueue(issues);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, 'started-1');
    assert.strictEqual(result[1].id, 'unstarted-1');
  });

  test('bugs are prioritized within same state group', () => {
    const issues = [
      createIssue({
        id: 'feature-1',
        state: { name: 'Todo', type: 'unstarted' },
        labels: { nodes: [{ name: 'feature' }] }
      }),
      createIssue({
        id: 'bug-1',
        state: { name: 'Todo', type: 'unstarted' },
        labels: { nodes: [{ name: 'bug' }] }
      }),
    ];
    const result = buildExecutionQueue(issues);
    assert.strictEqual(result[0].id, 'bug-1');
    assert.strictEqual(result[1].id, 'feature-1');
  });

  test('blocker appears before blocked issue', () => {
    const blocker = createIssue({
      id: 'blocker-1',
      identifier: 'TEST-B',
      state: { name: 'Todo', type: 'unstarted' },
      priority: 3,
      relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'blocked-1' } }] }
    });
    const blocked = createIssue({
      id: 'blocked-1',
      identifier: 'TEST-A',
      state: { name: 'Todo', type: 'unstarted' },
      priority: 1,
      relations: { nodes: [] }
    });
    const result = buildExecutionQueue([blocked, blocker]);
    const blockerIdx = result.findIndex(i => i.id === 'blocker-1');
    const blockedIdx = result.findIndex(i => i.id === 'blocked-1');
    assert.ok(blockerIdx < blockedIdx,
      `blocker (idx ${blockerIdx}) should come before blocked (idx ${blockedIdx})`);
  });

  test('cycles do not crash (graceful fallback)', () => {
    const a = createIssue({
      id: 'cycle-a',
      state: { name: 'Todo', type: 'unstarted' },
      relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'cycle-b' } }] }
    });
    const b = createIssue({
      id: 'cycle-b',
      state: { name: 'Todo', type: 'unstarted' },
      relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'cycle-a' } }] }
    });
    // Should not throw
    const result = buildExecutionQueue([a, b]);
    assert.strictEqual(result.length, 2);
  });

  test('parent-child relationships preserved', () => {
    const parent = createIssue({
      id: 'parent-1',
      state: { name: 'In Progress', type: 'started' }
    });
    const child = createIssue({
      id: 'child-1',
      state: { name: 'Todo', type: 'unstarted' },
      parent: { id: 'parent-1' }
    });
    const result = buildExecutionQueue([parent, child]);
    const childItem = result.find(i => i.id === 'child-1');
    assert.strictEqual(childItem.parentId, 'parent-1');
  });

  test('output objects have expected card-like shape', () => {
    const issues = [
      createIssue({
        id: 'shape-1',
        identifier: 'TEST-42',
        title: 'Fix alignment',
        estimate: 3,
        priority: 1,
        dueDate: '2024-06-01',
        state: { name: 'In Progress', type: 'started' },
        assignee: { name: 'Alice' },
        labels: { nodes: [{ name: 'bug' }] },
        project: { id: 'proj-1', name: 'Project Alpha' },
        parent: { id: 'parent-x' },
        relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'other-1' } }] }
      })
    ];
    const result = buildExecutionQueue(issues);
    assert.strictEqual(result.length, 1);
    const item = result[0];
    assert.strictEqual(item.id, 'shape-1');
    assert.strictEqual(item.identifier, 'TEST-42');
    assert.strictEqual(item.title, 'Fix alignment');
    assert.strictEqual(item.stateType, 'started');
    assert.strictEqual(item.stateName, 'In Progress');
    assert.strictEqual(item.priority, 1);
    assert.strictEqual(item.estimate, 3);
    assert.strictEqual(item.dueDate, '2024-06-01');
    assert.strictEqual(item.parentId, 'parent-x');
    assert.ok(Array.isArray(item.labels));
    assert.ok(Array.isArray(item.blocksIds));
    assert.ok(item.assignee !== undefined);
    assert.ok(item.projectName !== undefined);
  });

  test('card carries a truncated task description', () => {
    const item = issueToRoadmapCard(createIssue({
      description: 'Short intent line.\n\nA second paragraph that should be dropped.'
    }));
    assert.strictEqual(item.description, 'Short intent line.', 'keeps first paragraph only');
  });

  test('card description is null when the issue has none', () => {
    const item = issueToRoadmapCard(createIssue({ description: '' }));
    assert.strictEqual(item.description, null);
  });
});

// =============================================================================
// firstParaTruncated
// =============================================================================

describe('firstParaTruncated', () => {
  test('returns null for empty input', () => {
    assert.strictEqual(firstParaTruncated(''), null);
    assert.strictEqual(firstParaTruncated(null), null);
  });

  test('takes the first paragraph and collapses whitespace', () => {
    assert.strictEqual(firstParaTruncated('one   two\nthree\n\nlater'), 'one two three');
  });

  test('truncates to the bound with an ellipsis', () => {
    const long = 'x'.repeat(300);
    const out = firstParaTruncated(long, 200);
    assert.strictEqual(out.length, 200);
    assert.ok(out.endsWith('...'));
  });
});

// =============================================================================
// groupByMilestone
// =============================================================================

describe('groupByMilestone', () => {
  test('empty queue returns empty milestones', () => {
    const result = groupByMilestone([], []);
    assert.deepStrictEqual(result, []);
  });

  test('single project groups correctly', () => {
    const queue = [
      { id: 'a', projectName: 'Alpha', estimate: 2, stateType: 'unstarted' },
      { id: 'b', projectName: 'Alpha', estimate: 3, stateType: 'started' },
    ];
    const projects = [{ id: 'proj-1', name: 'Alpha' }];
    const result = groupByMilestone(queue, projects);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'Alpha');
    assert.strictEqual(result[0].tasksInQueue.length, 2);
  });

  test('multiple projects create separate milestones', () => {
    const queue = [
      { id: 'a', projectName: 'Alpha', estimate: 2, stateType: 'unstarted' },
      { id: 'b', projectName: 'Beta', estimate: 3, stateType: 'unstarted' },
    ];
    const projects = [
      { id: 'proj-1', name: 'Alpha' },
      { id: 'proj-2', name: 'Beta' }
    ];
    const result = groupByMilestone(queue, projects);
    assert.strictEqual(result.length, 2);
    const names = result.map(m => m.name).sort();
    assert.deepStrictEqual(names, ['Alpha', 'Beta']);
  });

  test('tasks without project go into "Unassigned" milestone', () => {
    const queue = [
      { id: 'a', projectName: null, estimate: 1, stateType: 'unstarted' },
      { id: 'b', projectName: 'Alpha', estimate: 2, stateType: 'unstarted' },
    ];
    const projects = [{ id: 'proj-1', name: 'Alpha' }];
    const result = groupByMilestone(queue, projects);
    const unassigned = result.find(m => m.name === 'Unassigned');
    assert.ok(unassigned, 'should have an Unassigned milestone');
    assert.strictEqual(unassigned.tasksInQueue.length, 1);
    assert.strictEqual(unassigned.tasksInQueue[0].id, 'a');
  });

  test('progress calculation is correct', () => {
    const queue = [
      { id: 'a', projectName: 'Alpha', estimate: 2, stateType: 'unstarted' },
    ];
    const projects = [{ id: 'proj-1', name: 'Alpha', completedIssueCount: 3, issueCount: 4 }];
    const result = groupByMilestone(queue, projects);
    const milestone = result[0];
    assert.strictEqual(milestone.totalTasks, milestone.remainingTasks + milestone.completedTasks);
    assert.ok(milestone.progressPercent >= 0 && milestone.progressPercent <= 100);
  });

  test('points tallied correctly with null estimates treated as 0', () => {
    const queue = [
      { id: 'a', projectName: 'Alpha', estimate: 5, stateType: 'unstarted' },
      { id: 'b', projectName: 'Alpha', estimate: null, stateType: 'unstarted' },
      { id: 'c', projectName: 'Alpha', estimate: 3, stateType: 'unstarted' },
    ];
    const projects = [{ id: 'proj-1', name: 'Alpha' }];
    const result = groupByMilestone(queue, projects);
    const milestone = result[0];
    assert.strictEqual(milestone.remainingPoints, 8);
  });
});

// =============================================================================
// projectTimeline
// =============================================================================

describe('projectTimeline', () => {
  test('zero velocity returns null projections', () => {
    const milestones = [{
      name: 'Alpha',
      remainingTasks: 5,
      remainingPoints: 10,
      tasksInQueue: Array(5).fill({ estimate: 2 })
    }];
    const velocity = { tasksPerWeek: 0, pointsPerWeek: 0, trend: 'stable' };
    const result = projectTimeline(milestones, velocity, new Date());
    assert.ok(result.length > 0);
    assert.strictEqual(result[0].projectedEnd, null);
    assert.strictEqual(result[0].weeksRemaining, null);
  });

  test('known velocity and task count gives correct weeks', () => {
    const milestones = [{
      name: 'Alpha',
      remainingTasks: 10,
      remainingPoints: 0,
      tasksInQueue: Array(10).fill({ estimate: null })
    }];
    const velocity = { tasksPerWeek: 5, pointsPerWeek: 0, trend: 'stable' };
    const start = new Date('2024-06-01');
    const result = projectTimeline(milestones, velocity, start);
    assert.ok(result[0].weeksRemaining !== null);
    assert.ok(result[0].projectedEnd !== null);
    // 10 tasks / 5 per week = 2 weeks
    assert.strictEqual(result[0].weeksRemaining, 2);
  });

  test('points-based projection used when estimates available', () => {
    // >50% of tasks have estimates → use points-based velocity
    const tasksInQueue = [
      { estimate: 3 },
      { estimate: 5 },
      { estimate: 2 },
      { estimate: null },
    ];
    const milestones = [{
      name: 'Alpha',
      remainingTasks: 4,
      remainingPoints: 10,
      tasksInQueue
    }];
    const velocity = { tasksPerWeek: 2, pointsPerWeek: 5, trend: 'stable' };
    const start = new Date('2024-06-01');
    const result = projectTimeline(milestones, velocity, start);
    // 10 points / 5 per week = 2 weeks (points-based)
    assert.strictEqual(result[0].weeksRemaining, 2);
  });

  test('count-based fallback when few estimates', () => {
    // <50% of tasks have estimates → use count-based velocity
    const tasksInQueue = [
      { estimate: 3 },
      { estimate: null },
      { estimate: null },
      { estimate: null },
    ];
    const milestones = [{
      name: 'Alpha',
      remainingTasks: 4,
      remainingPoints: 3,
      tasksInQueue
    }];
    const velocity = { tasksPerWeek: 2, pointsPerWeek: 5, trend: 'stable' };
    const start = new Date('2024-06-01');
    const result = projectTimeline(milestones, velocity, start);
    // 4 tasks / 2 per week = 2 weeks (count-based)
    assert.strictEqual(result[0].weeksRemaining, 2);
  });

  test('multiple milestones get sequential projections', () => {
    const milestones = [
      {
        name: 'Alpha',
        remainingTasks: 4,
        remainingPoints: 0,
        tasksInQueue: Array(4).fill({ estimate: null })
      },
      {
        name: 'Beta',
        remainingTasks: 6,
        remainingPoints: 0,
        tasksInQueue: Array(6).fill({ estimate: null })
      }
    ];
    const velocity = { tasksPerWeek: 2, pointsPerWeek: 0, trend: 'stable' };
    const start = new Date('2024-06-01');
    const result = projectTimeline(milestones, velocity, start);
    assert.strictEqual(result.length, 2);
    // Both should have projections
    assert.ok(result[0].projectedStart !== null);
    assert.ok(result[1].projectedStart !== null);
    // Beta should start after or at Alpha's start
    assert.ok(new Date(result[1].projectedStart) >= new Date(result[0].projectedStart));
  });

  test('confidence range scales with remaining work', () => {
    const smallMilestone = [{
      name: 'Small',
      remainingTasks: 2,
      remainingPoints: 0,
      tasksInQueue: Array(2).fill({ estimate: null })
    }];
    const largeMilestone = [{
      name: 'Large',
      remainingTasks: 20,
      remainingPoints: 0,
      tasksInQueue: Array(20).fill({ estimate: null })
    }];
    const velocity = { tasksPerWeek: 2, pointsPerWeek: 0, trend: 'stable' };
    const start = new Date('2024-06-01');
    const smallResult = projectTimeline(smallMilestone, velocity, start);
    const largeResult = projectTimeline(largeMilestone, velocity, start);
    // Larger milestone should have wider confidence range
    const smallRange = smallResult[0].confidenceHigh - smallResult[0].confidenceLow;
    const largeRange = largeResult[0].confidenceHigh - largeResult[0].confidenceLow;
    assert.ok(largeRange >= smallRange,
      `large range (${largeRange}) should be >= small range (${smallRange})`);
  });
});

// =============================================================================
// findCriticalPaths
// =============================================================================

describe('findCriticalPaths', () => {
  test('no dependencies returns empty paths', () => {
    const queue = [
      { id: 'a', projectName: 'Alpha', blocksIds: [] },
      { id: 'b', projectName: 'Alpha', blocksIds: [] },
    ];
    const result = findCriticalPaths(queue);
    const alphaPath = result.get('Alpha') || result['Alpha'];
    // With no deps the longest chain is just 1 (or path is empty)
    assert.ok(
      !alphaPath || alphaPath.length <= 1,
      'no meaningful critical path without dependencies'
    );
  });

  test('simple A→B chain detected', () => {
    const queue = [
      { id: 'a', projectName: 'Alpha', blocksIds: ['b'] },
      { id: 'b', projectName: 'Alpha', blocksIds: [] },
    ];
    const result = findCriticalPaths(queue);
    const alpha = result.get ? result.get('Alpha') : result['Alpha'];
    assert.ok(alpha, 'should have Alpha path');
    assert.strictEqual(alpha.length, 2);
    assert.deepStrictEqual(alpha.path, ['a', 'b']);
  });

  test('longest path chosen among alternatives', () => {
    // A→B→C (length 3) vs D→E (length 2)
    const queue = [
      { id: 'a', projectName: 'Alpha', blocksIds: ['b'] },
      { id: 'b', projectName: 'Alpha', blocksIds: ['c'] },
      { id: 'c', projectName: 'Alpha', blocksIds: [] },
      { id: 'd', projectName: 'Alpha', blocksIds: ['e'] },
      { id: 'e', projectName: 'Alpha', blocksIds: [] },
    ];
    const result = findCriticalPaths(queue);
    const alpha = result.get ? result.get('Alpha') : result['Alpha'];
    assert.ok(alpha, 'should have Alpha path');
    assert.strictEqual(alpha.length, 3);
    assert.deepStrictEqual(alpha.path, ['a', 'b', 'c']);
  });

  test('cross-project dependencies handled', () => {
    const queue = [
      { id: 'a', projectName: 'Alpha', blocksIds: ['b'] },
      { id: 'b', projectName: 'Beta', blocksIds: [] },
    ];
    const result = findCriticalPaths(queue);
    // Should not throw and should handle cross-project edges
    assert.ok(result !== null && result !== undefined);
  });

  test('cycle handling does not infinite loop', () => {
    const queue = [
      { id: 'a', projectName: 'Alpha', blocksIds: ['b'] },
      { id: 'b', projectName: 'Alpha', blocksIds: ['a'] },
    ];
    // Should not hang or throw
    const result = findCriticalPaths(queue);
    assert.ok(result !== null && result !== undefined);
  });
});

// =============================================================================
// assessRisks
// =============================================================================

describe('assessRisks', () => {
  test('no risks when everything is healthy', () => {
    const milestones = [{
      name: 'Alpha',
      remainingTasks: 3,
      projectedEnd: '2024-08-01',
      tasksInQueue: [
        { id: 'a', assignee: 'Alice', estimate: 2 },
        { id: 'b', assignee: 'Bob', estimate: 3 },
        { id: 'c', assignee: 'Carol', estimate: 1 },
      ]
    }];
    const criticalPaths = new Map([
      ['Alpha', { path: ['a', 'b'], length: 2, blockers: ['a'] }]
    ]);
    const velocity = { tasksPerWeek: 5, pointsPerWeek: 10, trend: 'stable' };
    const result = assessRisks(milestones, criticalPaths, velocity);
    assert.deepStrictEqual(result, []);
  });

  test('unassigned task on critical path flagged', () => {
    const milestones = [{
      name: 'Alpha',
      remainingTasks: 2,
      tasksInQueue: [
        { id: 'a', assignee: null, estimate: 2 },
        { id: 'b', assignee: 'Bob', estimate: 3 },
      ]
    }];
    const criticalPaths = new Map([
      ['Alpha', { path: ['a', 'b'], length: 2, blockers: ['a'] }]
    ]);
    const velocity = { tasksPerWeek: 5, pointsPerWeek: 10, trend: 'stable' };
    const result = assessRisks(milestones, criticalPaths, velocity);
    const unassignedRisk = result.find(r => r.type === 'unassigned-critical');
    assert.ok(unassignedRisk, 'should flag unassigned task on critical path');
    assert.strictEqual(unassignedRisk.severity, 'high');
    assert.strictEqual(unassignedRisk.milestone, 'Alpha');
    assert.ok(unassignedRisk.issues.includes('a'));
  });

  test('task without estimate on critical path flagged', () => {
    const milestones = [{
      name: 'Alpha',
      remainingTasks: 2,
      tasksInQueue: [
        { id: 'a', assignee: 'Alice', estimate: null },
        { id: 'b', assignee: 'Bob', estimate: 3 },
      ]
    }];
    const criticalPaths = new Map([
      ['Alpha', { path: ['a', 'b'], length: 2, blockers: ['a'] }]
    ]);
    const velocity = { tasksPerWeek: 5, pointsPerWeek: 10, trend: 'stable' };
    const result = assessRisks(milestones, criticalPaths, velocity);
    const unestimatedRisk = result.find(r => r.type === 'unestimated-critical');
    assert.ok(unestimatedRisk, 'should flag unestimated task on critical path');
    assert.ok(unestimatedRisk.issues.includes('a'));
  });

  test('declining velocity trend flagged', () => {
    const milestones = [{
      name: 'Alpha',
      remainingTasks: 2,
      tasksInQueue: [
        { id: 'a', assignee: 'Alice', estimate: 2 },
        { id: 'b', assignee: 'Bob', estimate: 3 },
      ]
    }];
    const criticalPaths = new Map([
      ['Alpha', { path: ['a'], length: 1, blockers: [] }]
    ]);
    const velocity = { tasksPerWeek: 5, pointsPerWeek: 10, trend: 'decreasing' };
    const result = assessRisks(milestones, criticalPaths, velocity);
    const velocityRisk = result.find(r => r.type === 'velocity-declining');
    assert.ok(velocityRisk, 'should flag declining velocity');
  });

  test('overdue milestone flagged', () => {
    const milestones = [{
      name: 'Alpha',
      remainingTasks: 10,
      projectedEnd: '2025-12-01',
      dueDate: '2025-06-01',
      tasksInQueue: Array(10).fill({ id: 'x', assignee: 'Alice', estimate: 2 })
    }];
    const criticalPaths = new Map([
      ['Alpha', { path: ['x'], length: 1, blockers: [] }]
    ]);
    const velocity = { tasksPerWeek: 1, pointsPerWeek: 2, trend: 'stable' };
    const result = assessRisks(milestones, criticalPaths, velocity);
    const overdueRisk = result.find(r => r.type === 'overdue');
    assert.ok(overdueRisk, 'should flag overdue milestone');
    assert.strictEqual(overdueRisk.milestone, 'Alpha');
  });
});

// =============================================================================
// buildHierarchy
// =============================================================================

describe('buildHierarchy', () => {
  test('empty input returns empty maps', () => {
    const h = buildHierarchy([]);
    assert.strictEqual(h.childrenOf.size, 0);
    assert.strictEqual(h.parentOf.size, 0);
  });

  test('detects parent-child when both are in set', () => {
    const cards = [
      { id: 'parent-1', parentId: null },
      { id: 'child-1', parentId: 'parent-1' },
      { id: 'child-2', parentId: 'parent-1' },
    ];
    const h = buildHierarchy(cards);
    assert.ok(h.isParent('parent-1'));
    assert.ok(h.isLeaf('child-1'));
    assert.ok(h.isLeaf('child-2'));
    assert.ok(!h.isParent('child-1'));
    assert.deepStrictEqual(h.childrenOf.get('parent-1').sort(), ['child-1', 'child-2']);
  });

  test('orphaned child (parent not in set) treated as standalone', () => {
    const cards = [
      { id: 'child-1', parentId: 'missing-parent' },
    ];
    const h = buildHierarchy(cards);
    assert.ok(h.isLeaf('child-1'));
    assert.ok(!h.parentOf.has('child-1'));
  });

  test('standalone tasks are leaves and not parents', () => {
    const cards = [
      { id: 'solo-1', parentId: null },
      { id: 'solo-2', parentId: null },
    ];
    const h = buildHierarchy(cards);
    assert.ok(h.isLeaf('solo-1'));
    assert.ok(!h.isParent('solo-1'));
  });
});

// =============================================================================
// computeParentRollup
// =============================================================================

describe('computeParentRollup', () => {
  test('counts states correctly', () => {
    const children = [
      { stateType: 'completed', estimate: 3 },
      { stateType: 'started', estimate: 2 },
      { stateType: 'unstarted', estimate: null },
    ];
    const rollup = computeParentRollup(children);
    assert.strictEqual(rollup.subtaskTotal, 3);
    assert.strictEqual(rollup.subtaskDone, 1);
    assert.strictEqual(rollup.subtaskInProgress, 1);
    assert.strictEqual(rollup.subtaskRemaining, 1);
    assert.strictEqual(rollup.rollupEstimate, 5);
  });

  test('empty children gives zero rollup', () => {
    const rollup = computeParentRollup([]);
    assert.strictEqual(rollup.subtaskTotal, 0);
    assert.strictEqual(rollup.subtaskDone, 0);
  });
});

// =============================================================================
// flattenTasks
// =============================================================================

describe('flattenTasks', () => {
  test('flat list returns same items', () => {
    const tasks = [{ id: 'a' }, { id: 'b' }];
    const result = flattenTasks(tasks);
    assert.strictEqual(result.length, 2);
  });

  test('nested subtasks are flattened', () => {
    const tasks = [
      { id: 'parent', subtasks: [{ id: 'child-1' }, { id: 'child-2' }] },
      { id: 'solo' },
    ];
    const result = flattenTasks(tasks);
    assert.strictEqual(result.length, 4);
    assert.deepStrictEqual(result.map(t => t.id), ['parent', 'child-1', 'child-2', 'solo']);
  });
});

// =============================================================================
// groupByProject — hierarchy behavior
// =============================================================================

describe('groupByProject hierarchy', () => {
  test('subtasks nested under parents in tasksInQueue', () => {
    const parent = issueToRoadmapCard(createIssue({
      id: 'parent-1',
      state: { name: 'In Progress', type: 'started' },
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const child1 = issueToRoadmapCard(createIssue({
      id: 'child-1',
      state: { name: 'Done', type: 'completed' },
      parent: { id: 'parent-1' },
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const child2 = issueToRoadmapCard(createIssue({
      id: 'child-2',
      state: { name: 'Todo', type: 'unstarted' },
      parent: { id: 'parent-1' },
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const queue = [parent, child2]; // child1 is completed, not in queue
    const projects = [{ id: 'proj-1', name: 'Alpha' }];
    const result = groupByProject(queue, projects, [child1]);
    const alpha = result.find(m => m.name === 'Alpha');

    // Top-level tasksInQueue should only have parent (not child2 separately)
    assert.strictEqual(alpha.tasksInQueue.length, 1);
    assert.strictEqual(alpha.tasksInQueue[0].id, 'parent-1');
    assert.ok(alpha.tasksInQueue[0].subtasks.length > 0, 'parent should have subtasks');
  });

  test('parent rollup stats computed from children', () => {
    const parent = issueToRoadmapCard(createIssue({
      id: 'p1',
      state: { name: 'In Progress', type: 'started' },
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const child1 = issueToRoadmapCard(createIssue({
      id: 'c1',
      state: { name: 'Todo', type: 'unstarted' },
      parent: { id: 'p1' },
      estimate: 3,
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const child2 = issueToRoadmapCard(createIssue({
      id: 'c2',
      state: { name: 'In Progress', type: 'started' },
      parent: { id: 'p1' },
      estimate: 2,
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const queue = [parent, child1, child2];
    const projects = [{ id: 'proj-1', name: 'Alpha' }];
    const result = groupByProject(queue, projects);
    const parentTask = result[0].tasksInQueue[0];
    assert.ok(parentTask.rollup, 'parent should have rollup');
    assert.strictEqual(parentTask.rollup.subtaskTotal, 2);
    assert.strictEqual(parentTask.rollup.subtaskInProgress, 1);
    assert.strictEqual(parentTask.rollup.subtaskRemaining, 1);
    assert.strictEqual(parentTask.rollup.rollupEstimate, 5);
  });

  test('progress counts only leaf tasks', () => {
    const parent = issueToRoadmapCard(createIssue({
      id: 'p1',
      state: { name: 'In Progress', type: 'started' },
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const childDone = issueToRoadmapCard(createIssue({
      id: 'c1',
      state: { name: 'Done', type: 'completed' },
      completedAt: daysAgo(1),
      parent: { id: 'p1' },
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const childTodo = issueToRoadmapCard(createIssue({
      id: 'c2',
      state: { name: 'Todo', type: 'unstarted' },
      parent: { id: 'p1' },
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    // Parent in queue, one child done, one child in queue
    const queue = [parent, childTodo];
    const projects = [{ id: 'proj-1', name: 'Alpha' }];
    const result = groupByProject(queue, projects, [childDone]);
    const alpha = result[0];
    // Should count only leaf tasks: 1 done + 1 remaining = 2 total, 50%
    assert.strictEqual(alpha.completedTasks, 1);
    assert.strictEqual(alpha.remainingTasks, 1);
    assert.strictEqual(alpha.totalTasks, 2);
    assert.strictEqual(alpha.progressPercent, 50);
  });

  test('standalone tasks unaffected by hierarchy logic', () => {
    const solo = issueToRoadmapCard(createIssue({
      id: 'solo-1',
      state: { name: 'Todo', type: 'unstarted' },
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const queue = [solo];
    const projects = [{ id: 'proj-1', name: 'Alpha' }];
    const result = groupByProject(queue, projects);
    assert.strictEqual(result[0].tasksInQueue.length, 1);
    assert.strictEqual(result[0].tasksInQueue[0].id, 'solo-1');
    assert.deepStrictEqual(result[0].tasksInQueue[0].subtasks, []);
    assert.strictEqual(result[0].tasksInQueue[0].rollup, null);
  });

  test('project description included when available', () => {
    const task = issueToRoadmapCard(createIssue({
      id: 'a',
      state: { name: 'Todo', type: 'unstarted' },
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const projects = [{ id: 'proj-1', name: 'Alpha', content: 'Replace legacy auth with OAuth 2.0.' }];
    const result = groupByProject([task], projects);
    assert.strictEqual(result[0].description, 'Replace legacy auth with OAuth 2.0.');
  });

  test('project description truncated at ~200 chars', () => {
    const task = issueToRoadmapCard(createIssue({
      id: 'a',
      state: { name: 'Todo', type: 'unstarted' },
      project: { id: 'proj-1', name: 'Alpha' }
    }));
    const longDesc = 'A'.repeat(300) + '\n\nSecond paragraph should be excluded.';
    const projects = [{ id: 'proj-1', name: 'Alpha', content: longDesc }];
    const result = groupByProject([task], projects);
    assert.ok(result[0].description.length <= 200, 'description should be truncated');
    assert.ok(result[0].description.endsWith('...'));
  });
});

// =============================================================================
// calculateVelocity — leaf-only counting
// =============================================================================

describe('calculateVelocity leaf-only', () => {
  test('parent tasks excluded from velocity when children exist', () => {
    const parent = createIssue({
      id: 'parent-v',
      completedAt: daysAgo(3),
      state: { name: 'Done', type: 'completed' }
    });
    const child1 = createIssue({
      id: 'child-v1',
      completedAt: daysAgo(3),
      parent: { id: 'parent-v' },
      state: { name: 'Done', type: 'completed' }
    });
    const child2 = createIssue({
      id: 'child-v2',
      completedAt: daysAgo(3),
      parent: { id: 'parent-v' },
      state: { name: 'Done', type: 'completed' }
    });
    const result = calculateVelocity([parent, child1, child2], 30, FIXED_NOW);
    // Should count 2 children, not 3 (parent excluded)
    const totalTasks = result.weeklyData.reduce((s, w) => s + w.tasks, 0);
    assert.strictEqual(totalTasks, 2);
  });

  test('standalone tasks without children still counted', () => {
    const solo = createIssue({
      id: 'solo-v',
      completedAt: daysAgo(3),
      state: { name: 'Done', type: 'completed' }
    });
    const result = calculateVelocity([solo], 30, FIXED_NOW);
    const totalTasks = result.weeklyData.reduce((s, w) => s + w.tasks, 0);
    assert.strictEqual(totalTasks, 1);
  });
});
