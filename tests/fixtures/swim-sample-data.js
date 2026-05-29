/**
 * Realistic sample data for the Swim view prototype.
 * Richer than mock-data.js — includes deep dependency chains,
 * multiple projects, subtask groups, and varied states.
 *
 * Deterministic for reproducible screenshots.
 */

const TEAM_ENG = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const TEAM_DES = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

export const swimSampleProjects = [
  { id: 'proj-auth', name: 'Authentication Overhaul', content: 'Replace legacy auth with OAuth 2.0 + PKCE', url: 'https://linear.app/test/project/proj-auth', sortOrder: 1 },
  { id: 'proj-dash', name: 'Dashboard Redesign', content: 'New dashboard with real-time widgets', url: 'https://linear.app/test/project/proj-dash', sortOrder: 2 },
  { id: 'proj-api', name: 'API v2', content: 'RESTful API v2 with pagination and filtering', url: 'https://linear.app/test/project/proj-api', sortOrder: 3 },
  { id: 'proj-infra', name: 'Infrastructure', content: 'CI/CD, monitoring, and deployment improvements', url: 'https://linear.app/test/project/proj-infra', sortOrder: 4 }
];

export const swimSampleIssues = [
  // =========================================================================
  // Auth project — blocking chain: design → implement → migrate → test
  // =========================================================================
  {
    id: 'auth-1', identifier: 'AUTH-1', title: 'Design OAuth 2.0 flow',
    description: 'Document the full OAuth 2.0 + PKCE flow including token refresh',
    estimate: 3, priority: 1, sortOrder: 1, createdAt: '2024-01-01T00:00:00Z',
    dueDate: '2024-02-01', completedAt: '2024-01-15T00:00:00Z',
    url: 'https://linear.app/test/issue/AUTH-1', parent: null,
    project: { id: 'proj-auth' }, state: { name: 'Done', type: 'completed' },
    assignee: { name: 'Alice' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'auth-2' } }] }
  },
  {
    id: 'auth-2', identifier: 'AUTH-2', title: 'Implement OAuth provider',
    description: 'Build the OAuth provider with PKCE support',
    estimate: 8, priority: 1, sortOrder: 2, createdAt: '2024-01-02T00:00:00Z',
    dueDate: '2024-03-01', completedAt: null,
    url: 'https://linear.app/test/issue/AUTH-2', parent: null,
    project: { id: 'proj-auth' }, state: { name: 'In Progress', type: 'started' },
    assignee: { name: 'Alice' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'auth-3' } }, { type: 'blocks', relatedIssue: { id: 'dash-2' } }] }
  },
  {
    id: 'auth-3', identifier: 'AUTH-3', title: 'Migrate existing users',
    description: 'Batch migration script for existing user tokens',
    estimate: 5, priority: 2, sortOrder: 3, createdAt: '2024-01-03T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/AUTH-3', parent: null,
    project: { id: 'proj-auth' }, state: { name: 'Todo', type: 'unstarted' },
    assignee: { name: 'Bob' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'auth-4' } }, { type: 'blocks', relatedIssue: { id: 'api-5' } }] }
  },
  {
    id: 'auth-4', identifier: 'AUTH-4', title: 'E2E auth tests',
    description: 'Full integration test suite for new auth flow',
    estimate: 3, priority: 2, sortOrder: 4, createdAt: '2024-01-04T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/AUTH-4', parent: null,
    project: { id: 'proj-auth' }, state: { name: 'Backlog', type: 'backlog' },
    assignee: null, labels: { nodes: [{ name: 'launch' }] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },
  // Auth — independent task (parallel to chain)
  {
    id: 'auth-5', identifier: 'AUTH-5', title: 'Update login page UI',
    description: 'Redesign login page for new OAuth flow',
    estimate: 3, priority: 3, sortOrder: 5, createdAt: '2024-01-05T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/AUTH-5', parent: null,
    project: { id: 'proj-auth' }, state: { name: 'In Progress', type: 'started' },
    assignee: { name: 'Charlie' }, labels: { nodes: [] }, team: { id: TEAM_DES },
    relations: { nodes: [] }
  },

  // =========================================================================
  // Dashboard project — parent with subtasks
  // =========================================================================
  {
    id: 'dash-1', identifier: 'DASH-1', title: 'Widget framework',
    description: 'Base framework for real-time dashboard widgets',
    estimate: 8, priority: 1, sortOrder: 1, createdAt: '2024-01-06T00:00:00Z',
    dueDate: '2024-03-15', completedAt: null,
    url: 'https://linear.app/test/issue/DASH-1', parent: null,
    project: { id: 'proj-dash' }, state: { name: 'In Progress', type: 'started' },
    assignee: { name: 'Charlie' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },
  {
    id: 'dash-1a', identifier: 'DASH-1a', title: 'Widget data layer',
    description: 'WebSocket-based data subscription for widgets',
    estimate: 3, priority: 1, sortOrder: 2, createdAt: '2024-01-07T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/DASH-1a', parent: { id: 'dash-1' },
    project: { id: 'proj-dash' }, state: { name: 'In Progress', type: 'started' },
    assignee: { name: 'Charlie' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },
  {
    id: 'dash-1b', identifier: 'DASH-1b', title: 'Widget rendering engine',
    description: 'Lightweight rendering engine for widget content',
    estimate: 5, priority: 2, sortOrder: 3, createdAt: '2024-01-08T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/DASH-1b', parent: { id: 'dash-1' },
    project: { id: 'proj-dash' }, state: { name: 'Todo', type: 'unstarted' },
    assignee: { name: 'Charlie' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },
  {
    id: 'dash-1c', identifier: 'DASH-1c', title: 'Widget layout manager',
    description: 'Drag-and-drop grid layout for dashboard widgets',
    estimate: 3, priority: 3, sortOrder: 4, createdAt: '2024-01-09T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/DASH-1c', parent: { id: 'dash-1' },
    project: { id: 'proj-dash' }, state: { name: 'Backlog', type: 'backlog' },
    assignee: null, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },
  // Nested subtasks: DASH-1b (Widget rendering engine) is itself a parent —
  // exercises subtask-groups-within-subtask-groups (a group nested inside a group).
  {
    id: 'dash-1b1', identifier: 'DASH-1b1', title: 'Canvas paint pipeline',
    description: 'Batched canvas draw calls with dirty-rect tracking',
    estimate: 3, priority: 2, sortOrder: 1, createdAt: '2024-01-08T01:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/DASH-1b1', parent: { id: 'dash-1b' },
    project: { id: 'proj-dash' }, state: { name: 'In Progress', type: 'started' },
    assignee: { name: 'Charlie' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'dash-1b2' } }] }
  },
  {
    id: 'dash-1b2', identifier: 'DASH-1b2', title: 'Virtualized scroll buffer',
    description: 'Recycle off-screen widget nodes to cap DOM size',
    estimate: 2, priority: 3, sortOrder: 2, createdAt: '2024-01-08T02:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/DASH-1b2', parent: { id: 'dash-1b' },
    project: { id: 'proj-dash' }, state: { name: 'Todo', type: 'unstarted' },
    assignee: null, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },
  // Dashboard — independent tasks
  {
    id: 'dash-2', identifier: 'DASH-2', title: 'Dashboard navigation redesign',
    description: 'Simplify the dashboard nav with breadcrumbs',
    estimate: 3, priority: 2, sortOrder: 5, createdAt: '2024-01-10T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/DASH-2', parent: null,
    project: { id: 'proj-dash' }, state: { name: 'Todo', type: 'unstarted' },
    assignee: { name: 'Diana' }, labels: { nodes: [{ name: 'launch' }] }, team: { id: TEAM_DES },
    relations: { nodes: [] }
  },
  {
    id: 'dash-3', identifier: 'DASH-3', title: 'Fix chart tooltip bug',
    description: 'Tooltips on line charts show wrong date on hover',
    estimate: 1, priority: 1, sortOrder: 6, createdAt: '2024-01-11T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/DASH-3', parent: null,
    project: { id: 'proj-dash' }, state: { name: 'In Progress', type: 'started' },
    assignee: { name: 'Bob' }, labels: { nodes: [{ name: 'bug' }] }, team: { id: TEAM_ENG },
    relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'infra-2' } }] }
  },

  // =========================================================================
  // API v2 project — chain: schema → endpoints → docs, plus independent tasks
  // =========================================================================
  {
    id: 'api-1', identifier: 'API-1', title: 'Design v2 API schema',
    description: 'OpenAPI spec for v2 endpoints with pagination',
    estimate: 5, priority: 1, sortOrder: 1, createdAt: '2024-01-12T00:00:00Z',
    dueDate: '2024-02-15', completedAt: '2024-02-10T00:00:00Z',
    url: 'https://linear.app/test/issue/API-1', parent: null,
    project: { id: 'proj-api' }, state: { name: 'Done', type: 'completed' },
    assignee: { name: 'Eve' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'api-2' } }] }
  },
  {
    id: 'api-2', identifier: 'API-2', title: 'Build v2 endpoints',
    description: 'Implement all v2 API endpoints per spec',
    estimate: 13, priority: 1, sortOrder: 2, createdAt: '2024-01-13T00:00:00Z',
    dueDate: '2024-04-01', completedAt: null,
    url: 'https://linear.app/test/issue/API-2', parent: null,
    project: { id: 'proj-api' }, state: { name: 'In Progress', type: 'started' },
    assignee: { name: 'Eve' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'api-3' } }] }
  },
  {
    id: 'api-3', identifier: 'API-3', title: 'Write API documentation',
    description: 'Auto-generated docs from OpenAPI spec + examples',
    estimate: 3, priority: 3, sortOrder: 3, createdAt: '2024-01-14T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/API-3', parent: null,
    project: { id: 'proj-api' }, state: { name: 'Backlog', type: 'backlog' },
    assignee: null, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },
  {
    id: 'api-4', identifier: 'API-4', title: 'Rate limiting middleware',
    description: 'Token bucket rate limiter for API v2',
    estimate: 3, priority: 2, sortOrder: 4, createdAt: '2024-01-15T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/API-4', parent: null,
    project: { id: 'proj-api' }, state: { name: 'Todo', type: 'unstarted' },
    assignee: { name: 'Alice' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },
  // API v2 — cross-project blocker: auth blocks API
  {
    id: 'api-5', identifier: 'API-5', title: 'API auth integration',
    description: 'Integrate new OAuth tokens with API v2 auth middleware',
    estimate: 5, priority: 1, sortOrder: 5, createdAt: '2024-01-16T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/API-5', parent: null,
    project: { id: 'proj-api' }, state: { name: 'Todo', type: 'unstarted' },
    assignee: { name: 'Alice' }, labels: { nodes: [{ name: 'blocked' }, { name: 'launch' }] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },

  // =========================================================================
  // Infrastructure project — mostly independent tasks
  // =========================================================================
  {
    id: 'infra-1', identifier: 'INFRA-1', title: 'Set up staging environment',
    description: 'Docker-based staging with auto-deploy from main',
    estimate: 5, priority: 1, sortOrder: 1, createdAt: '2024-01-17T00:00:00Z',
    dueDate: '2024-02-01', completedAt: '2024-01-25T00:00:00Z',
    url: 'https://linear.app/test/issue/INFRA-1', parent: null,
    project: { id: 'proj-infra' }, state: { name: 'Done', type: 'completed' },
    assignee: { name: 'Frank' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },
  {
    id: 'infra-2', identifier: 'INFRA-2', title: 'Add monitoring alerts',
    description: 'PagerDuty integration with custom thresholds',
    estimate: 3, priority: 2, sortOrder: 2, createdAt: '2024-01-18T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/INFRA-2', parent: null,
    project: { id: 'proj-infra' }, state: { name: 'In Progress', type: 'started' },
    assignee: { name: 'Frank' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  },
  {
    id: 'infra-3', identifier: 'INFRA-3', title: 'Database backup automation',
    description: 'Automated daily backups with retention policy',
    estimate: 2, priority: 2, sortOrder: 3, createdAt: '2024-01-19T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/INFRA-3', parent: null,
    project: { id: 'proj-infra' }, state: { name: 'Todo', type: 'unstarted' },
    assignee: { name: 'Frank' }, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'api-4' } }] }
  },
  {
    id: 'infra-4', identifier: 'INFRA-4', title: 'CI pipeline optimization',
    description: 'Reduce CI time from 12min to under 5min',
    estimate: 3, priority: 3, sortOrder: 4, createdAt: '2024-01-20T00:00:00Z',
    dueDate: null, completedAt: null,
    url: 'https://linear.app/test/issue/INFRA-4', parent: null,
    project: { id: 'proj-infra' }, state: { name: 'Backlog', type: 'backlog' },
    assignee: null, labels: { nodes: [] }, team: { id: TEAM_ENG },
    relations: { nodes: [] }
  }
];

// Pre-build blocksIds from relations (matching the flattenTrees card format)
for (const issue of swimSampleIssues) {
  issue.blocksIds = (issue.relations?.nodes || [])
    .filter(r => r.type === 'blocks')
    .map(r => r.relatedIssue.id);
}

/**
 * Get swim sample data in the same format as testMockData.
 */
export const swimSampleData = {
  organizationName: 'Swim Sample Workspace',
  projects: swimSampleProjects,
  issues: swimSampleIssues
};
