/**
 * Mock data for E2E tests.
 * Used by server.js in test mode to avoid hitting the Linear API.
 *
 * Uses simplified 3-label system:
 * - preparing: Pre-implementation work (research, breakdown, design, etc.)
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 */

export const testMockTeams = [
  { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', name: 'Engineering', key: 'ENG' },
  { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', name: 'Design', key: 'DES' }
]

export const testMockData = {
  organizationName: 'Test Workspace',
  projects: [
    { id: 'proj-alpha', name: 'Project Alpha', content: 'First test project', url: 'https://linear.app/test/project/proj-alpha', sortOrder: 1 },
    { id: 'proj-beta', name: 'Project Beta', content: 'Second test project', url: 'https://linear.app/test/project/proj-beta', sortOrder: 2 }
  ],
  issues: [
    { id: 'issue-1', title: 'Parent task in progress', description: 'This is a parent task', estimate: 5, priority: 2, sortOrder: 1, createdAt: '2024-01-01T00:00:00Z', dueDate: '2024-02-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-1', parent: null, project: { id: 'proj-alpha' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Alice' }, labels: { nodes: [{ name: 'feature' }] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } },
    { id: 'issue-2', title: 'Child task todo', description: 'A child task', estimate: 2, priority: 3, sortOrder: 2, createdAt: '2024-01-02T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-2', parent: { id: 'issue-1' }, project: { id: 'proj-alpha' }, state: { name: 'Todo', type: 'unstarted' }, assignee: null, labels: { nodes: [] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } },
    { id: 'issue-3', title: 'Completed task', description: 'This task is done', estimate: 1, priority: 4, sortOrder: 3, createdAt: '2024-01-03T00:00:00Z', dueDate: null, completedAt: '2024-01-10T00:00:00Z', url: 'https://linear.app/test/issue/TEST-3', parent: null, project: { id: 'proj-alpha' }, state: { name: 'Done', type: 'completed' }, assignee: { name: 'Bob' }, labels: { nodes: [{ name: 'bug' }] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } },
    { id: 'issue-4', title: 'Beta task in progress', description: 'An in-progress task in Beta', estimate: 3, priority: 1, sortOrder: 1, createdAt: '2024-01-04T00:00:00Z', dueDate: '2024-03-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-4', parent: null, project: { id: 'proj-beta' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Charlie' }, labels: { nodes: [{ name: 'urgent' }] }, team: { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' } },
    { id: 'issue-5', title: 'Beta todo task', description: 'A todo task in Beta', estimate: null, priority: 0, sortOrder: 2, createdAt: '2024-01-05T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-5', parent: null, project: { id: 'proj-beta' }, state: { name: 'Backlog', type: 'backlog' }, assignee: null, labels: { nodes: [] }, team: { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' } },
    { id: '66666666-6666-6666-6666-666666666666', title: 'Task needing preparation', description: 'This task needs research and breakdown before implementation', estimate: 8, priority: 2, sortOrder: 3, createdAt: '2024-01-06T00:00:00Z', dueDate: '2024-04-01', completedAt: null, url: 'https://linear.app/test/issue/TEST-6', parent: null, project: { id: 'proj-alpha' }, state: { name: 'Backlog', type: 'backlog' }, assignee: { name: 'Alice' }, labels: { nodes: [{ name: 'preparing' }] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } },
    { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', title: 'Blocked on external API access', description: 'Waiting for API credentials from third-party vendor', estimate: 3, priority: 1, sortOrder: 8, createdAt: '2024-01-11T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-11', parent: null, project: { id: 'proj-alpha' }, state: { name: 'In Progress', type: 'started' }, assignee: { name: 'Alice' }, labels: { nodes: [{ name: 'blocked' }] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } },
    { id: 'dddddddd-dddd-dddd-dddd-ddddddddddde', title: 'Login fails with special characters in password', description: 'Users report login fails when password contains @ or # symbols', estimate: 2, priority: 1, sortOrder: 10, createdAt: '2024-01-13T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-13', parent: null, project: { id: 'proj-alpha' }, state: { name: 'Todo', type: 'unstarted' }, assignee: { name: 'Bob' }, labels: { nodes: [{ name: 'bug' }] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } },
    { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef', title: 'Add pagination to user list', description: 'Implement cursor-based pagination for the user list API endpoint to handle large datasets efficiently', estimate: 3, priority: 2, sortOrder: 11, createdAt: '2024-01-14T00:00:00Z', dueDate: '2024-02-15', completedAt: null, url: 'https://linear.app/test/issue/TEST-14', parent: null, project: { id: 'proj-alpha' }, state: { name: 'Todo', type: 'unstarted' }, assignee: { name: 'Alice' }, labels: { nodes: [] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } },
    { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', title: 'Refactor authentication module', description: 'Extract auth logic into separate service for better testability and reuse across API endpoints', estimate: 5, priority: 2, sortOrder: 12, createdAt: '2024-01-15T00:00:00Z', dueDate: null, completedAt: null, url: 'https://linear.app/test/issue/TEST-15', parent: null, project: { id: 'proj-alpha' }, state: { name: 'In Review', type: 'started' }, assignee: { name: 'Bob' }, labels: { nodes: [] }, team: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } }
  ]
}
