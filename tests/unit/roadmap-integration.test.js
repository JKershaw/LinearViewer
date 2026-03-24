/**
 * Integration tests for roadmap data flow.
 *
 * Verifies that the output shapes from roadmap.js functions are compatible
 * with render-roadmap.js and prompt templates — catching field name mismatches
 * that unit tests on individual functions cannot detect.
 *
 * Run with: node --test tests/unit/roadmap-integration.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  calculateVelocity,
  buildExecutionQueue,
  groupByMilestone,
  projectTimeline,
  findCriticalPaths,
  assessRisks
} from '../../lib/roadmap.js';
import { renderRoadmapPage } from '../../lib/render-roadmap.js';
import { buildRoadmapNarrativePrompt } from '../../lib/prompts/roadmap-narrative-template.js';
import { buildRoadmapChatPrompt } from '../../lib/prompts/roadmap-chat-template.js';

// =============================================================================
// Shared test data factory
// =============================================================================

let counter = 0;

function createIssue(overrides = {}) {
  counter++;
  return {
    id: overrides.id || `issue-${counter}`,
    identifier: overrides.identifier || `TEST-${counter}`,
    title: overrides.title || `Test Issue ${counter}`,
    description: '',
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

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/**
 * Build a complete roadmap model from raw issues, mirroring server.js logic.
 */
function buildRoadmapModel(issues, projects) {
  const velocity = calculateVelocity(issues, 90);
  const executionQueue = buildExecutionQueue(issues);
  const milestones = groupByMilestone(executionQueue, projects);
  const timedMilestones = projectTimeline(milestones, velocity);
  const criticalPaths = findCriticalPaths(executionQueue);
  const risks = assessRisks(timedMilestones, criticalPaths, velocity);

  return {
    velocity,
    milestones: timedMilestones,
    criticalPaths,
    risks,
    executionQueue
  };
}

// =============================================================================
// Data shape contract: roadmap.js → render-roadmap.js
// =============================================================================

describe('roadmap data shape contract', () => {
  test('velocity output has fields expected by renderer', () => {
    const issues = [
      createIssue({
        completedAt: daysAgo(3),
        estimate: 3,
        state: { name: 'Done', type: 'completed' }
      })
    ];
    const velocity = calculateVelocity(issues, 30);

    // render-roadmap.js reads these fields
    assert.ok('tasksPerWeek' in velocity, 'missing tasksPerWeek');
    assert.ok('pointsPerWeek' in velocity, 'missing pointsPerWeek');
    assert.ok('trend' in velocity, 'missing trend');
    assert.ok('weeklyData' in velocity, 'missing weeklyData');
    assert.strictEqual(typeof velocity.tasksPerWeek, 'number');
    assert.strictEqual(typeof velocity.pointsPerWeek, 'number');
    assert.ok(['stable', 'increasing', 'decreasing'].includes(velocity.trend));
  });

  test('milestone output has fields expected by renderer', () => {
    const issues = [
      createIssue({
        id: 'a',
        state: { name: 'In Progress', type: 'started' },
        estimate: 3,
        project: { id: 'proj-1', name: 'Alpha' }
      }),
      createIssue({
        id: 'b',
        state: { name: 'Todo', type: 'unstarted' },
        estimate: 5,
        project: { id: 'proj-1', name: 'Alpha' }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'Alpha' }];
    const queue = buildExecutionQueue(issues);
    const milestones = groupByMilestone(queue, projects);
    const velocity = { tasksPerWeek: 2, pointsPerWeek: 5, trend: 'stable' };
    const timed = projectTimeline(milestones, velocity);

    assert.ok(timed.length > 0);
    const m = timed[0];

    // Fields read by render-roadmap.js
    assert.ok('name' in m, 'missing name');
    assert.ok('totalTasks' in m, 'missing totalTasks');
    assert.ok('remainingTasks' in m, 'missing remainingTasks');
    assert.ok('completedTasks' in m, 'missing completedTasks');
    assert.ok('remainingPoints' in m, 'missing remainingPoints');
    assert.ok('progressPercent' in m, 'missing progressPercent');
    assert.ok('weeksRemaining' in m, 'missing weeksRemaining');
    assert.ok('confidenceLow' in m, 'missing confidenceLow');
    assert.ok('confidenceHigh' in m, 'missing confidenceHigh');
    assert.ok('tasksInQueue' in m, 'missing tasksInQueue');
    assert.ok(Array.isArray(m.tasksInQueue));
  });

  test('criticalPaths keyed by project name, matching milestone.name', () => {
    const issues = [
      createIssue({
        id: 'blocker',
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Alpha' },
        relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'blocked' } }] }
      }),
      createIssue({
        id: 'blocked',
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Alpha' },
        relations: { nodes: [] }
      })
    ];
    const queue = buildExecutionQueue(issues);
    const criticalPaths = findCriticalPaths(queue);

    // criticalPaths should be a Map keyed by project name
    assert.ok(criticalPaths instanceof Map, 'criticalPaths should be a Map');

    // Keys should match milestone names (project names)
    for (const [key, value] of criticalPaths) {
      assert.strictEqual(typeof key, 'string');
      assert.ok('path' in value, 'missing path');
      assert.ok('length' in value, 'missing length');
      assert.ok('blockers' in value, 'missing blockers');
      assert.ok(Array.isArray(value.path));
    }
  });

  test('assessRisks output has milestone field (not milestoneId)', () => {
    const milestones = [{
      name: 'Alpha',
      remainingTasks: 2,
      tasksInQueue: [
        { id: 'a', assignee: null, estimate: null },
        { id: 'b', assignee: 'Bob', estimate: 3 },
      ]
    }];
    const criticalPaths = new Map([
      ['Alpha', { path: ['a', 'b'], length: 2, blockers: ['a'] }]
    ]);
    const velocity = { tasksPerWeek: 5, pointsPerWeek: 10, trend: 'stable' };
    const risks = assessRisks(milestones, criticalPaths, velocity);

    for (const risk of risks) {
      assert.ok('type' in risk, 'missing type');
      assert.ok('severity' in risk, 'missing severity');
      assert.ok('description' in risk, 'missing description');
      assert.ok('milestone' in risk, 'missing milestone (renderer filters by this)');
      assert.ok('issues' in risk, 'missing issues');
      // Must NOT have milestoneId (old incorrect field)
      assert.ok(!('milestoneId' in risk), 'should not have milestoneId field');
      assert.ok(!('projectId' in risk), 'should not have projectId field');
    }
  });

  test('execution queue items have identifier and title for critical path rendering', () => {
    const issues = [
      createIssue({
        id: 'x',
        identifier: 'TEST-42',
        title: 'Fix the thing',
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Alpha' }
      })
    ];
    const queue = buildExecutionQueue(issues);
    assert.ok(queue.length > 0);
    const item = queue[0];
    // render-roadmap.js resolves path IDs using execution queue
    assert.ok('id' in item);
    assert.ok('identifier' in item);
    assert.ok('title' in item);
    assert.ok('stateType' in item);
  });
});

// =============================================================================
// End-to-end rendering: roadmap model → HTML
// =============================================================================

describe('renderRoadmapPage with real model', () => {
  test('renders without errors for a typical roadmap model', () => {
    const issues = [
      createIssue({
        id: 'done-1',
        completedAt: daysAgo(3),
        estimate: 3,
        state: { name: 'Done', type: 'completed' },
        project: { id: 'proj-1', name: 'Alpha' }
      }),
      createIssue({
        id: 'wip-1',
        estimate: 5,
        state: { name: 'In Progress', type: 'started' },
        project: { id: 'proj-1', name: 'Alpha' },
        assignee: { name: 'Alice' }
      }),
      createIssue({
        id: 'todo-1',
        estimate: 2,
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Alpha' }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'Alpha' }];
    const model = buildRoadmapModel(issues, projects);

    const html = renderRoadmapPage(
      { roadmapModel: model, organizationName: 'Test Org' },
      { urlKey: 'test-ws', featureFlags: { roadmap: true } }
    );

    assert.ok(html.includes('<!DOCTYPE html>'), 'should be a full HTML doc');
    assert.ok(html.includes('Roadmap'), 'should include page title');
    assert.ok(html.includes('Alpha'), 'should include milestone name');
    assert.ok(html.includes('tasks/week'), 'should include velocity stats');
    assert.ok(html.includes('roadmap-milestone-card'), 'should include milestone cards');
  });

  test('renders milestone progress bar correctly', () => {
    const issues = [
      createIssue({
        id: 'todo-a',
        estimate: 3,
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Beta' }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'Beta' }];
    const model = buildRoadmapModel(issues, projects);

    const html = renderRoadmapPage(
      { roadmapModel: model, organizationName: 'Test' },
      { urlKey: 'test-ws' }
    );

    assert.ok(html.includes('roadmap-progress-bar'), 'should include progress bar');
    assert.ok(html.includes('Beta'), 'should include milestone name');
  });

  test('renders risks when present', () => {
    const issues = [
      createIssue({
        id: 'risk-a',
        estimate: null,
        assignee: null,
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Risky' },
        relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'risk-b' } }] }
      }),
      createIssue({
        id: 'risk-b',
        estimate: null,
        assignee: null,
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Risky' },
        relations: { nodes: [] }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'Risky' }];
    const model = buildRoadmapModel(issues, projects);

    const html = renderRoadmapPage(
      { roadmapModel: model, organizationName: 'Test' },
      { urlKey: 'test-ws' }
    );

    // Should render risks (unassigned + unestimated on critical path)
    assert.ok(html.includes('roadmap-risk-badge') || html.includes('roadmap-risks'),
      'should include risk indicators');
  });

  test('renders critical path when dependencies exist', () => {
    const issues = [
      createIssue({
        id: 'cp-a',
        identifier: 'TST-1',
        title: 'First task',
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Chain' },
        relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'cp-b' } }] }
      }),
      createIssue({
        id: 'cp-b',
        identifier: 'TST-2',
        title: 'Second task',
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Chain' },
        relations: { nodes: [] }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'Chain' }];
    const model = buildRoadmapModel(issues, projects);

    const html = renderRoadmapPage(
      { roadmapModel: model, organizationName: 'Test' },
      { urlKey: 'test-ws' }
    );

    assert.ok(html.includes('critical path'), 'should show critical path heading');
    assert.ok(html.includes('TST-1'), 'should show first issue identifier');
    assert.ok(html.includes('TST-2'), 'should show second issue identifier');
  });

  test('hides AI sections when no openRouterSource', () => {
    const model = buildRoadmapModel([], []);
    const html = renderRoadmapPage(
      { roadmapModel: model, organizationName: 'Test' },
      { urlKey: 'test-ws', openRouterSource: null }
    );

    assert.ok(html.includes('roadmap-narrative hidden'), 'narrative should be hidden');
    assert.ok(html.includes('roadmap-chat hidden'), 'chat should be hidden');
  });

  test('shows AI sections when openRouterSource present', () => {
    const model = buildRoadmapModel([], []);
    const html = renderRoadmapPage(
      { roadmapModel: model, organizationName: 'Test' },
      { urlKey: 'test-ws', openRouterSource: 'oauth' }
    );

    assert.ok(!html.includes('roadmap-narrative hidden'), 'narrative should be visible');
    assert.ok(!html.includes('roadmap-chat hidden'), 'chat should be visible');
  });

  test('embeds __ROADMAP_DATA__ as JSON', () => {
    const issues = [
      createIssue({
        id: 'data-1',
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Data' }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'Data' }];
    const model = buildRoadmapModel(issues, projects);

    const html = renderRoadmapPage(
      { roadmapModel: model, organizationName: 'Test' },
      { urlKey: 'test-ws' }
    );

    assert.ok(html.includes('window.__ROADMAP_DATA__'), 'should embed roadmap data');
    // Verify it's valid JSON by extracting and parsing
    const match = html.match(/window\.__ROADMAP_DATA__\s*=\s*(.+?);<\/script>/);
    assert.ok(match, 'should find embedded JSON');
    const parsed = JSON.parse(match[1].replace(/\\u003c/g, '<'));
    assert.ok('velocity' in parsed);
    assert.ok('milestones' in parsed);
    assert.ok('hasAI' in parsed);
    assert.ok('urlKey' in parsed);
  });
});

// =============================================================================
// Prompt template contract tests
// =============================================================================

describe('prompt templates accept roadmap model', () => {
  test('buildRoadmapNarrativePrompt produces non-empty string from real model', () => {
    const issues = [
      createIssue({
        completedAt: daysAgo(5),
        estimate: 3,
        state: { name: 'Done', type: 'completed' },
        project: { id: 'proj-1', name: 'Alpha' }
      }),
      createIssue({
        state: { name: 'Todo', type: 'unstarted' },
        estimate: 5,
        project: { id: 'proj-1', name: 'Alpha' }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'Alpha' }];
    const model = buildRoadmapModel(issues, projects);

    // Convert Map to plain object (as the client sends)
    const serializable = {
      ...model,
      criticalPaths: Object.fromEntries(model.criticalPaths)
    };

    const prompt = buildRoadmapNarrativePrompt(serializable);
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 100, 'prompt should be substantial');
    assert.ok(prompt.includes('Alpha'), 'prompt should include milestone data');
    assert.ok(prompt.includes('velocity'), 'prompt should reference velocity');
  });

  test('buildRoadmapChatPrompt produces system and user from real model', () => {
    const issues = [
      createIssue({
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Beta' }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'Beta' }];
    const model = buildRoadmapModel(issues, projects);

    const serializable = {
      ...model,
      criticalPaths: Object.fromEntries(model.criticalPaths)
    };

    const { system, user } = buildRoadmapChatPrompt(serializable, 'When will Beta be done?');
    assert.strictEqual(typeof system, 'string');
    assert.strictEqual(typeof user, 'string');
    assert.ok(system.length > 100, 'system prompt should be substantial');
    assert.ok(system.includes('Beta'), 'system should include milestone data');
    assert.strictEqual(user, 'When will Beta be done?');
  });

  test('narrative prompt handles empty model gracefully', () => {
    const prompt = buildRoadmapNarrativePrompt({});
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 0);
  });

  test('chat prompt handles empty model gracefully', () => {
    const { system, user } = buildRoadmapChatPrompt({}, 'What is happening?');
    assert.strictEqual(typeof system, 'string');
    assert.strictEqual(user, 'What is happening?');
  });
});
