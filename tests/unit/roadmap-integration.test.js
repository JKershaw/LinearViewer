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
  assessRisks,
  issueToRoadmapCard
} from '../../lib/roadmap.js';
import { renderRoadmapPage } from '../../lib/render-roadmap.js';
import { summarizeRoadmapModel, buildRoadmapNarrativeMessages, buildRoadmapNarrativePrompt } from '../../lib/prompts/roadmap-narrative-template.js';
import { buildRoadmapChatMessages, buildRoadmapChatPrompt } from '../../lib/prompts/roadmap-chat-template.js';

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
  const completedIssues = issues
    .filter(i => i.state?.type === 'completed')
    .map(i => issueToRoadmapCard(i));
  const milestones = groupByMilestone(executionQueue, projects, completedIssues);
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

  test('progressPercent reflects completed issues when passed to groupByMilestone', () => {
    const issues = [
      createIssue({
        id: 'done-prog',
        completedAt: daysAgo(3),
        estimate: 3,
        state: { name: 'Done', type: 'completed' },
        project: { id: 'proj-1', name: 'ProgressTest' }
      }),
      createIssue({
        id: 'todo-prog',
        estimate: 5,
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'ProgressTest' }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'ProgressTest' }];
    const model = buildRoadmapModel(issues, projects);

    const milestone = model.milestones.find(m => m.name === 'ProgressTest');
    assert.ok(milestone, 'should have ProgressTest milestone');
    assert.strictEqual(milestone.completedTasks, 1, 'should count 1 completed task');
    assert.strictEqual(milestone.totalTasks, 2, 'should count 2 total tasks');
    assert.ok(milestone.progressPercent > 0, `progressPercent should be > 0, got ${milestone.progressPercent}`);
    assert.strictEqual(milestone.progressPercent, 50, 'should be 50% complete');
  });

  test('issueToRoadmapCard handles null relatedIssue in relations', () => {
    const issue = createIssue({
      id: 'null-rel',
      relations: { nodes: [
        { type: 'blocks', relatedIssue: null },
        { type: 'blocks', relatedIssue: { id: 'valid-target' } },
        { type: 'related', relatedIssue: null }
      ] }
    });
    const card = issueToRoadmapCard(issue);
    // Should not crash and should only include valid blocking relations
    assert.deepStrictEqual(card.blocksIds, ['valid-target']);
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

  test('renders trend classes matching CSS (BEM convention)', () => {
    const issues = [
      createIssue({
        id: 'trend-1',
        completedAt: daysAgo(3),
        estimate: 3,
        state: { name: 'Done', type: 'completed' },
        project: { id: 'proj-1', name: 'Trend' }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'Trend' }];
    const model = buildRoadmapModel(issues, projects);

    const html = renderRoadmapPage(
      { roadmapModel: model, organizationName: 'Test' },
      { urlKey: 'test-ws' }
    );

    // Trend classes must use BEM double-dash format matching roadmap.css
    const trendClassMatch = html.match(/roadmap-trend--(?:increasing|decreasing|stable)/);
    assert.ok(trendClassMatch, 'trend class should use BEM format (roadmap-trend--*)');
    // Must NOT use old non-BEM format
    assert.ok(!html.includes('trend-up'), 'should not use old trend-up class');
    assert.ok(!html.includes('trend-down'), 'should not use old trend-down class');
    assert.ok(!html.includes('"trend-stable"'), 'should not use old trend-stable class');
  });

  test('renders risk badge classes matching CSS (BEM convention)', () => {
    const issues = [
      createIssue({
        id: 'rbem-a',
        estimate: null,
        assignee: null,
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'BemRisk' },
        relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'rbem-b' } }] }
      }),
      createIssue({
        id: 'rbem-b',
        estimate: null,
        assignee: null,
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'BemRisk' },
        relations: { nodes: [] }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'BemRisk' }];
    const model = buildRoadmapModel(issues, projects);

    const html = renderRoadmapPage(
      { roadmapModel: model, organizationName: 'Test' },
      { urlKey: 'test-ws' }
    );

    // If risks are present, they must use BEM double-dash format
    if (html.includes('roadmap-risk-badge')) {
      const riskBadgeMatches = html.match(/roadmap-risk-badge roadmap-risk--\w+/g);
      assert.ok(riskBadgeMatches, 'risk badge should use BEM format (roadmap-risk--*)');
      // Must NOT use single-dash format
      const singleDashRisks = html.match(/roadmap-risk-(?!badge|-)(?:high|medium|low)/g);
      assert.ok(!singleDashRisks, 'should not use single-dash risk classes (roadmap-risk-high)');
    }
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
    // executionQueue should NOT be in client payload (only needed server-side)
    assert.ok(!('executionQueue' in parsed), 'executionQueue should not be in client payload');
  });
});

// =============================================================================
// Prompt template contract tests
// =============================================================================

// =============================================================================
// Model summarization
// =============================================================================

describe('summarizeRoadmapModel', () => {
  test('includes report date', () => {
    const summary = summarizeRoadmapModel({});
    assert.ok(summary.includes('Report date:'), 'should include report date');
    // Date should be in YYYY-MM-DD format
    assert.ok(/Report date: \d{4}-\d{2}-\d{2}/.test(summary), 'date should be ISO format');
  });

  test('includes velocity data', () => {
    const summary = summarizeRoadmapModel({
      velocity: { tasksPerWeek: 5.5, pointsPerWeek: 12, trend: 'increasing' }
    });
    assert.ok(summary.includes('VELOCITY'), 'should have velocity section');
    assert.ok(summary.includes('5.5'), 'should include tasks/week');
    assert.ok(summary.includes('12'), 'should include points/week');
    assert.ok(summary.includes('increasing'), 'should include trend');
  });

  test('includes milestone data with projections', () => {
    const summary = summarizeRoadmapModel({
      milestones: [{
        name: 'Launch',
        progressPercent: 60,
        totalTasks: 10,
        remainingTasks: 4,
        remainingPoints: 8,
        weeksRemaining: 3,
        confidenceLow: 2,
        confidenceHigh: 5,
        projectedEnd: '2026-04-15T00:00:00Z'
      }]
    });
    assert.ok(summary.includes('MILESTONES'), 'should have milestones section');
    assert.ok(summary.includes('Launch'), 'should include milestone name');
    assert.ok(summary.includes('60%'), 'should include progress');
    assert.ok(summary.includes('6/10'), 'should include done/total');
    assert.ok(summary.includes('~3 weeks'), 'should include projection');
    assert.ok(summary.includes('2-5 weeks'), 'should include confidence range');
    assert.ok(summary.includes('2026-04-15'), 'should include projected end date');
  });

  test('includes risks with severity and milestone', () => {
    const summary = summarizeRoadmapModel({
      risks: [
        { severity: 'high', milestone: 'Launch', description: 'Unassigned critical tasks' },
        { severity: 'medium', milestone: null, description: 'Velocity declining' }
      ]
    });
    assert.ok(summary.includes('RISKS'), 'should have risks section');
    assert.ok(summary.includes('[high]'), 'should include severity');
    assert.ok(summary.includes('[Launch]'), 'should include milestone');
    assert.ok(summary.includes('Unassigned critical tasks'), 'should include description');
    assert.ok(summary.includes('Velocity declining'), 'should include global risk');
  });

  test('includes critical paths when meaningful', () => {
    const summary = summarizeRoadmapModel({
      criticalPaths: { 'Alpha': { length: 3, blockers: ['a', 'b'], path: ['a', 'b', 'c'] } }
    });
    assert.ok(summary.includes('CRITICAL PATHS'), 'should have critical paths section');
    assert.ok(summary.includes('Alpha'), 'should include project name');
    assert.ok(summary.includes('3 tasks deep'), 'should include chain length');
  });

  test('omits sections for empty data', () => {
    const summary = summarizeRoadmapModel({
      velocity: { tasksPerWeek: 0, pointsPerWeek: 0, trend: 'stable' },
      milestones: [],
      risks: [],
      criticalPaths: {}
    });
    assert.ok(summary.includes('VELOCITY'), 'always shows velocity');
    assert.ok(!summary.includes('MILESTONES'), 'omits empty milestones');
    assert.ok(!summary.includes('RISKS'), 'omits empty risks');
    assert.ok(!summary.includes('CRITICAL PATHS'), 'omits empty paths');
  });

  test('handles Map-type criticalPaths (from server)', () => {
    const cp = new Map([['Beta', { length: 2, blockers: ['x'], path: ['x', 'y'] }]]);
    const summary = summarizeRoadmapModel({ criticalPaths: cp });
    assert.ok(summary.includes('Beta'), 'should handle Map input');
  });

  test('is significantly smaller than raw JSON dump', () => {
    const issues = [
      createIssue({ state: { name: 'Todo', type: 'unstarted' }, estimate: 3, project: { id: 'p1', name: 'A' } }),
      createIssue({ state: { name: 'Todo', type: 'unstarted' }, estimate: 5, project: { id: 'p1', name: 'A' } }),
      createIssue({ state: { name: 'Todo', type: 'unstarted' }, estimate: 2, project: { id: 'p2', name: 'B' } }),
    ];
    const model = buildRoadmapModel(issues, [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }]);
    const serializable = { ...model, criticalPaths: Object.fromEntries(model.criticalPaths) };

    const jsonSize = JSON.stringify(serializable, null, 2).length;
    const summarySize = summarizeRoadmapModel(serializable).length;
    assert.ok(summarySize < jsonSize, `summary (${summarySize}) should be smaller than JSON (${jsonSize})`);
  });
});

// =============================================================================
// Narrative messages
// =============================================================================

describe('buildRoadmapNarrativeMessages', () => {
  test('returns array of system and user messages', () => {
    const model = buildRoadmapModel(
      [createIssue({ state: { name: 'Todo', type: 'unstarted' }, project: { id: 'p1', name: 'A' } })],
      [{ id: 'p1', name: 'A' }]
    );
    const serializable = { ...model, criticalPaths: Object.fromEntries(model.criticalPaths) };
    const messages = buildRoadmapNarrativeMessages(serializable);

    assert.ok(Array.isArray(messages));
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
  });

  test('system message instructs plain text output (no markdown)', () => {
    const messages = buildRoadmapNarrativeMessages({});
    const system = messages[0].content;
    assert.ok(system.includes('Plain text only'), 'should instruct plain text');
    assert.ok(system.includes('Do NOT use markdown'), 'should prohibit markdown');
  });

  test('system message includes word limit', () => {
    const messages = buildRoadmapNarrativeMessages({});
    const system = messages[0].content;
    assert.ok(/\d+ words/.test(system), 'should include word limit');
  });

  test('user message contains summarized data, not raw JSON', () => {
    const model = { velocity: { tasksPerWeek: 3, pointsPerWeek: 8, trend: 'stable' } };
    const messages = buildRoadmapNarrativeMessages(model);
    const user = messages[1].content;
    assert.ok(user.includes('Tasks/week: 3'), 'should contain summarized velocity');
    assert.ok(!user.includes('"tasksPerWeek"'), 'should not contain raw JSON keys');
  });

  test('backward-compatible buildRoadmapNarrativePrompt still works', () => {
    const prompt = buildRoadmapNarrativePrompt({});
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 100);
  });
});

// =============================================================================
// Chat messages
// =============================================================================

describe('buildRoadmapChatMessages', () => {
  test('returns system + user messages without history', () => {
    const model = { velocity: { tasksPerWeek: 2 } };
    const messages = buildRoadmapChatMessages(model, 'When will it ship?');

    assert.ok(Array.isArray(messages));
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[messages.length - 1].role, 'user');
    assert.strictEqual(messages[messages.length - 1].content, 'When will it ship?');
  });

  test('system message instructs plain text output', () => {
    const messages = buildRoadmapChatMessages({}, 'test');
    const system = messages[0].content;
    assert.ok(system.includes('Plain text only'), 'should instruct plain text');
    assert.ok(system.includes('Do NOT use markdown'), 'should prohibit markdown');
  });

  test('system message contains summarized data', () => {
    const model = {
      velocity: { tasksPerWeek: 5, pointsPerWeek: 10, trend: 'decreasing' },
      milestones: [{ name: 'Launch', progressPercent: 80, totalTasks: 10, remainingTasks: 2 }]
    };
    const messages = buildRoadmapChatMessages(model, 'test');
    const system = messages[0].content;
    assert.ok(system.includes('Launch'), 'should include milestone name');
    assert.ok(system.includes('decreasing'), 'should include trend');
    assert.ok(!system.includes('"tasksPerWeek"'), 'should not have raw JSON');
  });

  test('includes conversation history in correct order', () => {
    const history = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
    ];
    const messages = buildRoadmapChatMessages({}, 'Follow-up', history);

    // system, then history, then current question
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
    assert.strictEqual(messages[1].content, 'First question');
    assert.strictEqual(messages[2].role, 'assistant');
    assert.strictEqual(messages[2].content, 'First answer');
    assert.strictEqual(messages[3].role, 'user');
    assert.strictEqual(messages[3].content, 'Follow-up');
  });

  test('caps history to prevent token overflow', () => {
    // Create 30 turns (15 user + 15 assistant)
    const history = [];
    for (let i = 0; i < 15; i++) {
      history.push({ role: 'user', content: `Q${i}` });
      history.push({ role: 'assistant', content: `A${i}` });
    }
    const messages = buildRoadmapChatMessages({}, 'Latest', history);

    // Should have system + capped history + current question
    // Max 10 turns = 20 messages from history, plus system + current = 22
    assert.ok(messages.length <= 22, `should cap history, got ${messages.length} messages`);
    // Last message should always be the current question
    assert.strictEqual(messages[messages.length - 1].content, 'Latest');
  });

  test('filters out non-user/assistant roles from history', () => {
    const history = [
      { role: 'system', content: 'injected' },
      { role: 'user', content: 'real question' },
      { role: 'tool', content: 'tool result' },
    ];
    const messages = buildRoadmapChatMessages({}, 'test', history);
    const roles = messages.map(m => m.role);
    // Should only have one system (the template's), user messages, no tool/extra system
    assert.strictEqual(roles.filter(r => r === 'system').length, 1, 'should have exactly one system message');
    assert.ok(!roles.includes('tool'), 'should filter out tool messages');
  });

  test('backward-compatible buildRoadmapChatPrompt still works', () => {
    const { system, user } = buildRoadmapChatPrompt({}, 'test question');
    assert.strictEqual(typeof system, 'string');
    assert.strictEqual(user, 'test question');
    assert.ok(system.includes('ROADMAP DATA'));
  });
});

// =============================================================================
// Full pipeline: model → summarize → messages → (would stream)
// =============================================================================

describe('prompt pipeline end-to-end', () => {
  test('narrative messages from real model contain milestone data', () => {
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
    const serializable = { ...model, criticalPaths: Object.fromEntries(model.criticalPaths) };

    const messages = buildRoadmapNarrativeMessages(serializable);
    const allContent = messages.map(m => m.content).join('\n');
    assert.ok(allContent.includes('Alpha'), 'should contain milestone name');
    assert.ok(allContent.includes('Tasks/week'), 'should contain velocity');
  });

  test('chat messages from real model with history work correctly', () => {
    const issues = [
      createIssue({
        state: { name: 'Todo', type: 'unstarted' },
        project: { id: 'proj-1', name: 'Beta' }
      })
    ];
    const projects = [{ id: 'proj-1', name: 'Beta' }];
    const model = buildRoadmapModel(issues, projects);
    const serializable = { ...model, criticalPaths: Object.fromEntries(model.criticalPaths) };

    const history = [
      { role: 'user', content: 'How is Beta going?' },
      { role: 'assistant', content: 'Beta has 1 remaining task.' }
    ];
    const messages = buildRoadmapChatMessages(serializable, 'What blocks it?', history);

    // Verify structure: system, history user, history assistant, current user
    assert.strictEqual(messages[0].role, 'system');
    assert.ok(messages[0].content.includes('Beta'), 'system should include milestone');
    assert.strictEqual(messages[1].content, 'How is Beta going?');
    assert.strictEqual(messages[2].content, 'Beta has 1 remaining task.');
    assert.strictEqual(messages[3].content, 'What blocks it?');
  });
});
