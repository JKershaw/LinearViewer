/**
 * Unit tests for audit logic.
 *
 * Run with: node --test tests/unit/audit.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { computeAuditFromData } from '../../lib/audit.js';
import { getQueueForLabel, matchesQueue, QUEUE_CONFIG } from '../../lib/queue-config.js';

// =============================================================================
// Queue Config Tests
// =============================================================================

describe('Queue Config', () => {
  test('matchesQueue returns true for exact match', () => {
    assert.strictEqual(matchesQueue('breakdown', ['breakdown']), true);
    assert.strictEqual(matchesQueue('ready', ['ready']), true);
  });

  test('matchesQueue is case-insensitive', () => {
    assert.strictEqual(matchesQueue('Breakdown', ['breakdown']), true);
    assert.strictEqual(matchesQueue('BREAKDOWN', ['breakdown']), true);
    assert.strictEqual(matchesQueue('breakdown', ['BREAKDOWN']), true);
  });

  test('matchesQueue returns false for non-match', () => {
    assert.strictEqual(matchesQueue('bug', ['breakdown']), false);
    assert.strictEqual(matchesQueue('feature', ['ready', 'review']), false);
  });

  test('getQueueForLabel returns queue name for matching label', () => {
    assert.strictEqual(getQueueForLabel('breakdown'), 'Breakdown');
    assert.strictEqual(getQueueForLabel('status:breakdown'), 'Breakdown');
    assert.strictEqual(getQueueForLabel('ready'), 'Ready');
    assert.strictEqual(getQueueForLabel('review'), 'Review');
    assert.strictEqual(getQueueForLabel('in-progress'), 'In-Progress');
  });

  test('getQueueForLabel returns null for unmapped labels', () => {
    assert.strictEqual(getQueueForLabel('bug'), null);
    assert.strictEqual(getQueueForLabel('feature'), null);
    assert.strictEqual(getQueueForLabel('priority:high'), null);
  });

  test('QUEUE_CONFIG has required queues defined', () => {
    const requiredQueues = QUEUE_CONFIG.filter(q => q.required);
    assert.ok(requiredQueues.length > 0, 'Should have required queues');

    const requiredNames = requiredQueues.map(q => q.name);
    assert.ok(requiredNames.includes('Breakdown'), 'Breakdown should be required');
    assert.ok(requiredNames.includes('Ready'), 'Ready should be required');
    assert.ok(requiredNames.includes('Review'), 'Review should be required');
  });
});

// =============================================================================
// Audit Computation Tests
// =============================================================================

describe('Audit Computation', () => {
  const baseMockData = {
    teams: [
      { id: 'team1', name: 'Engineering', key: 'ENG' },
      { id: 'team2', name: 'Design', key: 'DES' }
    ],
    projects: [
      { id: 'proj1', name: 'Project Alpha', state: 'started' },
      { id: 'proj2', name: 'Project Beta', state: 'completed' }
    ],
    workflowStates: [
      { id: 'ws1', name: 'Backlog', type: 'backlog', team: { id: 'team1', name: 'Engineering' } },
      { id: 'ws2', name: 'In Progress', type: 'started', team: { id: 'team1', name: 'Engineering' } },
      { id: 'ws3', name: 'Done', type: 'completed', team: { id: 'team1', name: 'Engineering' } }
    ],
    labels: [
      { id: 'l1', name: 'breakdown', color: '#000', issues: { nodes: [{ id: 'i1' }] } },
      { id: 'l2', name: 'ready', color: '#000', issues: { nodes: [{ id: 'i2' }, { id: 'i3' }] } },
      { id: 'l3', name: 'bug', color: '#f00', issues: { nodes: [{ id: 'i4' }] } }
    ],
    issues: [
      {
        id: 'i1',
        title: 'Task 1',
        description: 'A description that is long enough',
        project: { id: 'proj1' },
        state: { name: 'In Progress', type: 'started' },
        assignee: { id: 'u1', name: 'Alice' },
        estimate: 3,
        dueDate: '2025-01-15',
        labels: { nodes: [{ id: 'l1', name: 'breakdown' }] }
      },
      {
        id: 'i2',
        title: 'Task 2',
        description: 'Short',
        project: { id: 'proj1' },
        state: { name: 'Backlog', type: 'backlog' },
        assignee: null,
        estimate: null,
        dueDate: null,
        labels: { nodes: [{ id: 'l2', name: 'ready' }] }
      },
      {
        id: 'i3',
        title: 'Orphan task',
        description: 'This task has no project',
        project: null,
        state: { name: 'Backlog', type: 'backlog' },
        assignee: { id: 'u2', name: 'Bob' },
        estimate: null,
        dueDate: null,
        labels: { nodes: [] }
      }
    ],
    customFields: [
      { name: 'Sprint', type: 'select' }
    ]
  };

  test('computes workspace structure correctly', () => {
    const report = computeAuditFromData(baseMockData);

    assert.strictEqual(report.workspace.teamCount, 2);
    assert.strictEqual(report.workspace.projectCount, 2);
    assert.ok(report.workspace.teams.some(t => t.name === 'Engineering'));
    assert.ok(report.workspace.projectsByState.started === 1);
    assert.ok(report.workspace.projectsByState.completed === 1);
  });

  test('counts tasks per project correctly', () => {
    const report = computeAuditFromData(baseMockData);

    const proj1 = report.projectTasks.find(p => p.name === 'Project Alpha');
    const proj2 = report.projectTasks.find(p => p.name === 'Project Beta');

    assert.strictEqual(proj1.taskCount, 2);
    assert.strictEqual(proj2.taskCount, 0);
  });

  test('identifies orphan tasks correctly', () => {
    const report = computeAuditFromData(baseMockData);

    assert.strictEqual(report.health.orphans.count, 1);
    assert.ok(report.health.orphans.items.some(i => i.title === 'Orphan task'));
  });

  test('identifies unlabeled tasks correctly', () => {
    const report = computeAuditFromData(baseMockData);

    assert.strictEqual(report.health.unlabeled.count, 1);
    assert.ok(report.health.unlabeled.items.some(i => i.title === 'Orphan task'));
  });

  test('identifies short descriptions correctly', () => {
    const report = computeAuditFromData(baseMockData);

    // 'Short' is less than 20 chars
    assert.ok(report.health.shortDescription.count >= 1);
    assert.ok(report.health.shortDescription.items.some(i => i.title === 'Task 2'));
  });

  test('identifies tasks without assignee', () => {
    const report = computeAuditFromData(baseMockData);

    // Only Task 2 has no assignee (i1 has Alice, i3 has Bob)
    assert.strictEqual(report.health.noAssignee.count, 1);
    assert.ok(report.health.noAssignee.items.some(i => i.title === 'Task 2'));
  });

  test('maps labels to queues correctly', () => {
    const report = computeAuditFromData(baseMockData);

    // breakdown and ready should be mapped
    assert.strictEqual(report.labels.mappedCount, 2);
    assert.ok(report.labels.mapped.some(l => l.name === 'breakdown' && l.queue === 'Breakdown'));
    assert.ok(report.labels.mapped.some(l => l.name === 'ready' && l.queue === 'Ready'));

    // bug should be unmapped
    assert.strictEqual(report.labels.unmappedCount, 1);
    assert.ok(report.labels.unmapped.some(l => l.name === 'bug'));
  });

  test('identifies missing queue labels', () => {
    const report = computeAuditFromData(baseMockData);

    // breakdown and ready exist, but review and in-progress don't
    assert.ok(!report.queues.isReady, 'Should not be ready (missing required queues)');
    assert.ok(report.queues.missingRequired.some(q => q.name === 'Review'));
    assert.ok(report.queues.missingRequired.some(q => q.name === 'In-Progress'));
  });

  test('calculates readiness score correctly', () => {
    const report = computeAuditFromData(baseMockData);

    // 2 of 4 required queues exist = 50%
    assert.ok(report.queues.readinessScore >= 0);
    assert.ok(report.queues.readinessScore <= 100);
  });

  test('calculates field usage correctly', () => {
    const report = computeAuditFromData(baseMockData);

    // 1 of 3 issues has estimate = 33%
    assert.ok(report.fields.estimatesUsage >= 30 && report.fields.estimatesUsage <= 35);

    // 1 of 3 issues has due date = 33%
    assert.ok(report.fields.dueDatesUsage >= 30 && report.fields.dueDatesUsage <= 35);
  });

  test('includes custom fields', () => {
    const report = computeAuditFromData(baseMockData);

    assert.strictEqual(report.fields.customFieldCount, 1);
    assert.ok(report.fields.customFields.some(f => f.name === 'Sprint'));
  });

  test('includes timestamp', () => {
    const report = computeAuditFromData(baseMockData);

    assert.ok(report.timestamp);
    assert.doesNotThrow(() => new Date(report.timestamp));
  });
});

describe('Empty Workspace Handling', () => {
  test('handles empty workspace gracefully', () => {
    const emptyData = {
      teams: [],
      projects: [],
      workflowStates: [],
      labels: [],
      issues: [],
      customFields: []
    };

    const report = computeAuditFromData(emptyData);

    assert.strictEqual(report.workspace.teamCount, 0);
    assert.strictEqual(report.workspace.projectCount, 0);
    assert.strictEqual(report.health.totalTasks, 0);
    assert.strictEqual(report.health.orphans.count, 0);
    assert.strictEqual(report.labels.totalLabels, 0);
    assert.strictEqual(report.fields.estimatesUsage, 0);
  });

  test('handles workspace with no labels', () => {
    const noLabelsData = {
      teams: [{ id: 'team1', name: 'Team', key: 'T' }],
      projects: [{ id: 'proj1', name: 'Project', state: 'started' }],
      workflowStates: [],
      labels: [],
      issues: [
        {
          id: 'i1',
          title: 'Task',
          description: 'Description',
          project: { id: 'proj1' },
          state: { name: 'Backlog', type: 'backlog' },
          assignee: null,
          estimate: null,
          dueDate: null,
          labels: { nodes: [] }
        }
      ],
      customFields: []
    };

    const report = computeAuditFromData(noLabelsData);

    assert.strictEqual(report.labels.totalLabels, 0);
    assert.strictEqual(report.labels.mappedCount, 0);
    assert.strictEqual(report.labels.unmappedCount, 0);
    assert.ok(!report.queues.isReady);
  });
});

describe('Multiple Labels Handling', () => {
  test('handles tasks with multiple labels', () => {
    const multiLabelData = {
      teams: [],
      projects: [],
      workflowStates: [],
      labels: [
        { id: 'l1', name: 'breakdown', color: '#000', issues: { nodes: [{ id: 'i1' }] } },
        { id: 'l2', name: 'bug', color: '#f00', issues: { nodes: [{ id: 'i1' }] } }
      ],
      issues: [
        {
          id: 'i1',
          title: 'Task with multiple labels',
          description: 'Description',
          project: null,
          state: { name: 'Backlog', type: 'backlog' },
          assignee: null,
          estimate: null,
          dueDate: null,
          labels: { nodes: [{ id: 'l1', name: 'breakdown' }, { id: 'l2', name: 'bug' }] }
        }
      ],
      customFields: []
    };

    const report = computeAuditFromData(multiLabelData);

    // Task should not be counted as unlabeled
    assert.strictEqual(report.health.unlabeled.count, 0);

    // Both labels should be present
    assert.strictEqual(report.labels.mappedCount, 1); // breakdown
    assert.strictEqual(report.labels.unmappedCount, 1); // bug
  });
});
