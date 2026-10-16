// Fixture inputs: (1) the exact renderRoadmapPage calls captured from the four
// pinned unit-test files, (2) lib/sample-data/mock-data.js testMockData run the
// way server.js runs it, (3) hand-listed edge roadmapModels, including the
// hand-built model shapes those test files pass to the sibling prompt builders.
import v8 from 'node:v8';

export function capturedInputs(capture) {
  const out = [];
  for (const f of capture.files) {
    for (const r of f.records) {
      if (!r.payload) { out.push({ id: `test:${r.site}#${r.n}`, tier: 'test', error: r.error }); continue; }
      const { data, options, argc } = v8.deserialize(r.payload);
      out.push({ id: `test:${r.site}#${r.n}`, tier: 'test', data, options, argc });
    }
  }
  return out;
}

export function mockDataInputs(deps) {
  const { testMockData, testMockTeams } = deps;
  const model = () => deps.buildRoadmapModel(testMockData.projects, testMockData.issues);
  const base = {
    deployInfo: {}, urlKey: 'test-workspace', openRouterSource: null,
    workspaces: [{ id: 'w1', urlKey: 'test-workspace', name: 'Test Workspace', accessToken: 'test-token' }],
    featureFlags: { ...deps.FEATURE_DEFAULTS, roadmap: true },
    availableModels: deps.AVAILABLE_MODELS, teams: testMockTeams, selectedTeamId: null
  };
  return [
    { id: 'mock:testMockData', options: base },
    { id: 'mock:testMockData+ai', options: { ...base, openRouterSource: 'oauth' } },
    { id: 'mock:testMockData+team', options: { ...base, selectedTeamId: testMockTeams[1].id } },
    { id: 'mock:testMockData+deploy', options: { ...base, deployInfo: { version: 'v42', commit: 'abc1234def5678', createdAt: '2026-10-01T00:00:00Z' } } }
  ].map(c => ({ ...c, tier: 'mock', data: { roadmapModel: model(), organizationName: testMockData.organizationName } }));
}

export function edgeInputs() {
  const o = { urlKey: 'ws' };
  const ai = { urlKey: 'ws', openRouterSource: 'oauth' };
  const models = [
    ['empty-model', {}],
    ['no-roadmapModel', undefined],
    ['milestones-empty', { milestones: [] }],
    ['cp-empty-map', { criticalPaths: new Map() }],
    ['cp-empty-object', { criticalPaths: {} }],
    ['velocity-empty', { velocity: {} }],
    ['milestone-name-only', { milestones: [{ name: 'Only' }] }],
    ['milestone-empty-object', { milestones: [{}] }],
    // shapes from roadmap-integration.test.js's summarize/chat/narrative tests
    ['summarize-velocity', { velocity: { tasksPerWeek: 5.5, pointsPerWeek: 12, trend: 'increasing' } }],
    ['summarize-milestone-projections', { milestones: [{ name: 'Launch', progressPercent: 60, totalTasks: 10, remainingTasks: 4, remainingPoints: 8, weeksRemaining: 3, confidenceLow: 2, confidenceHigh: 5, projectedEnd: '2026-04-15T00:00:00Z' }] }],
    ['summarize-risks', { milestones: [{ name: 'Launch', totalTasks: 3, remainingTasks: 3 }], risks: [
      { type: 'unassigned-critical', severity: 'high', milestone: 'Launch', description: 'Unassigned critical tasks' },
      { type: 'velocity-declining', severity: 'medium', milestone: null, description: 'Velocity is declining. Projections may be optimistic.' },
      { type: 'overdue', severity: 'high', milestone: 'Launch', description: 'Projected completion exceeds due date.' },
      { type: 'unestimated-critical', severity: 'medium', milestone: 'Launch', description: '2 critical-path tasks have no estimate.' }
    ] }],
    ['summarize-cp-object', { milestones: [{ name: 'Alpha', totalTasks: 3, remainingTasks: 3 }], criticalPaths: { Alpha: { length: 3, blockers: ['a', 'b'], path: ['a', 'b', 'c'] } } }],
    ['summarize-cp-map', { milestones: [{ name: 'Beta' }], criticalPaths: new Map([['Beta', { length: 2, blockers: ['x'], path: ['x', 'y'] }]]) }],
    ['summarize-empty-sections', { velocity: { tasksPerWeek: 0, pointsPerWeek: 0, trend: 'stable' }, milestones: [], risks: [], criticalPaths: {} }],
    ['summarize-in-progress-task', { milestones: [{ name: 'Launch', progressPercent: 50, totalTasks: 2, remainingTasks: 1, tasksInQueue: [{ id: 'i1', identifier: 'LIN-204', title: 'Add OAuth flow', stateType: 'started', priority: 2, labels: ['feature', 'auth'], description: 'Wire up Linear OAuth callback handling.' }] }] }],
    ['summarize-next-up-backlog', { milestones: [{ name: 'Launch', progressPercent: 0, totalTasks: 3, remainingTasks: 3, tasksInQueue: [
      { id: 'a', identifier: 'LIN-1', title: 'Active work', stateType: 'started' },
      { id: 'b', identifier: 'LIN-2', title: 'Committed todo', stateType: 'unstarted' },
      { id: 'c', identifier: 'LIN-3', title: 'Someday maybe', stateType: 'backlog' }] }] }],
    ['summarize-plain-task', { milestones: [{ name: 'Launch', progressPercent: 0, totalTasks: 1, remainingTasks: 1, tasksInQueue: [{ id: 'a', identifier: 'LIN-9', title: 'Plain task', stateType: 'unstarted', priority: 0, labels: [] }] }] }],
    ['chat-velocity-only', { velocity: { tasksPerWeek: 2 } }],
    ['chat-milestone', { velocity: { tasksPerWeek: 5, pointsPerWeek: 10, trend: 'decreasing' }, milestones: [{ name: 'Launch', progressPercent: 80, totalTasks: 10, remainingTasks: 2 }] }],
    ['assessRisks-shape', { milestones: [{ name: 'Alpha', remainingTasks: 2, tasksInQueue: [{ id: 'a', assignee: null, estimate: null }, { id: 'b', assignee: 'Bob', estimate: 3 }] }],
      criticalPaths: new Map([['Alpha', { path: ['a', 'b'], length: 2, blockers: ['a'] }]]), executionQueue: [{ id: 'a', identifier: 'A-1', title: 'a', stateType: 'started' }] }]
  ];
  const out = [];
  for (const [name, m] of models) {
    const data = m === undefined ? {} : { roadmapModel: m, organizationName: 'Test' };
    out.push({ id: `edge:${name}`, tier: 'edge', data, options: o });
    out.push({ id: `edge:${name}+ai`, tier: 'edge', data, options: ai });
  }
  return out;
}
