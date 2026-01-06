/**
 * Mock data for E2E tests.
 * Used by server.js in test mode to avoid hitting the Linear API.
 */

export const testMockTeams = [
  { id: 'team-eng', name: 'Engineering', key: 'ENG' },
  { id: 'team-design', name: 'Design', key: 'DES' }
]

export const testMockData = {
  organizationName: 'Test Workspace',
  projects: [
    { id: 'proj-alpha', name: 'Project Alpha', content: 'First test project', url: 'https://linear.app/test/project/proj-alpha', sortOrder: 1 },
    { id: 'proj-beta', name: 'Project Beta', content: 'Second test project', url: 'https://linear.app/test/project/proj-beta', sortOrder: 2 }
  ],
  issues: [
    { id: 'issue-1', title: 'Parent task in progress', description: 'This is a parent task', estimate: 5, priority: 2, sortOrder: 1, createdAt: '2024-01-01T00:00:00Z', dueDate: '2024-02-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-1', parent: null, project: { id: 'proj-alpha' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Alice' }, labels: { nodes: [{ name: 'feature' }] }, team: { id: 'team-eng' } },
    { id: 'issue-2', title: 'Child task todo', description: 'A child task', estimate: 2, priority: 3, sortOrder: 2, createdAt: '2024-01-02T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-2', parent: { id: 'issue-1' }, project: { id: 'proj-alpha' }, state: { name: 'Todo', type: 'unstarted' }, assignee: null, labels: { nodes: [] }, team: { id: 'team-eng' } },
    { id: 'issue-3', title: 'Completed task', description: 'This task is done', estimate: 1, priority: 4, sortOrder: 3, createdAt: '2024-01-03T00:00:00Z', dueDate: null, completedAt: '2024-01-10T00:00:00Z', url: 'https://linear.app/test/issue/TEST-3', parent: null, project: { id: 'proj-alpha' }, state: { name: 'Done', type: 'completed' }, assignee: { name: 'Bob' }, labels: { nodes: [{ name: 'bug' }] }, team: { id: 'team-eng' } },
    { id: 'issue-4', title: 'Beta task in progress', description: 'An in-progress task in Beta', estimate: 3, priority: 1, sortOrder: 1, createdAt: '2024-01-04T00:00:00Z', dueDate: '2024-03-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-4', parent: null, project: { id: 'proj-beta' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Charlie' }, labels: { nodes: [{ name: 'urgent' }] }, team: { id: 'team-design' } },
    { id: 'issue-5', title: 'Beta todo task', description: 'A todo task in Beta', estimate: null, priority: 0, sortOrder: 2, createdAt: '2024-01-05T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-5', parent: null, project: { id: 'proj-beta' }, state: { name: 'Backlog', type: 'backlog' }, assignee: null, labels: { nodes: [] }, team: { id: 'team-design' } }
  ]
}
