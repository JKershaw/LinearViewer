/**
 * Dense sample data for Ship view stress-testing.
 *
 * Mirrors a realistic workspace shape: 8 projects (several with long names that
 * stress segment-label layout), 6 in-progress cards filling the ship, and a
 * mix of priorities, blocking chains, and subtasks to drive realistic radial
 * distribution.
 *
 * Project names are inspired by the user's actual Linear workspace so segment
 * label widths match what they see in production.
 */

const TEAM = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

export const shipDenseProjects = [
  { id: 'proj-ux',      name: 'UX & Desktop',                content: '', sortOrder: 1, url: 'https://linear.app/test/project/proj-ux' },
  { id: 'proj-agent',   name: 'Agent & AI Tools',             content: '', sortOrder: 2, url: 'https://linear.app/test/project/proj-agent' },
  { id: 'proj-mcp',     name: 'MCP & Remote Control',         content: '', sortOrder: 3, url: 'https://linear.app/test/project/proj-mcp' },
  { id: 'proj-sec',     name: 'Safety & Security',            content: '', sortOrder: 4, url: 'https://linear.app/test/project/proj-sec' },
  { id: 'proj-os',      name: 'OS',                           content: '', sortOrder: 5, url: 'https://linear.app/test/project/proj-os' },
  { id: 'proj-arch',    name: 'Project Architecture & Ops',   content: '', sortOrder: 6, url: 'https://linear.app/test/project/proj-arch' },
  { id: 'proj-harbour', name: 'Harbour App',                  content: '', sortOrder: 7, url: 'https://linear.app/test/project/proj-harbour' },
  { id: 'proj-shell',   name: 'Shell & Shims',                content: '', sortOrder: 8, url: 'https://linear.app/test/project/proj-shell' }
];

function issue(id, identifier, title, projectId, stateType, priority, extras = {}) {
  const stateName = stateType === 'started' ? 'In Progress'
    : stateType === 'completed' ? 'Done'
    : stateType === 'canceled' ? 'Canceled'
    : stateType === 'backlog' ? 'Backlog' : 'Todo';
  return {
    id, identifier, title,
    description: '',
    estimate: 3, priority, sortOrder: 1,
    createdAt: '2024-01-01T00:00:00Z',
    dueDate: null, completedAt: null,
    url: `https://linear.app/test/issue/${identifier}`,
    parent: extras.parent ? { id: extras.parent } : null,
    project: { id: projectId },
    state: { name: stateName, type: stateType },
    assignee: extras.assignee ? { name: extras.assignee } : null,
    labels: { nodes: (extras.labels || []).map(name => ({ name })) },
    team: { id: TEAM },
    relations: { nodes: (extras.blocks || []).map(blockedId => ({
      type: 'blocks', relatedIssue: { id: blockedId }
    })) }
  };
}

export const shipDenseIssues = [
  // ---- 6 in-progress cards filling the ship ----
  issue('ux-wip',      'UX-1',  'Refresh swipe view spacing',           'proj-ux',      'started',   2),
  issue('agent-wip',   'AGT-1', 'Ship agent dispatch v2',               'proj-agent',   'started',   1),
  issue('mcp-wip',     'MCP-1', 'Streaming MCP server prototype',       'proj-mcp',     'started',   1),
  issue('sec-wip',     'SEC-1', 'Audit session token storage',          'proj-sec',     'started',   1),
  issue('arch-wip',    'ARC-1', 'Migrate background jobs to queue',     'proj-arch',    'started',   2),
  issue('harbour-wip', 'HAR-1', 'Harbour pipeline view polish',         'proj-harbour', 'started',   2),

  // ---- UX & Desktop: 4 non-started ----
  issue('ux-2', 'UX-2', 'Desktop drag preview lag',          'proj-ux', 'unstarted', 2, { blocks: ['ux-wip'] }),
  issue('ux-3', 'UX-3', 'Keyboard shortcuts cheat sheet',    'proj-ux', 'backlog',   3),
  issue('ux-4', 'UX-4', 'Empty-state illustration set',      'proj-ux', 'backlog',   4),
  issue('ux-5', 'UX-5', 'Onboarding tour copy review',       'proj-ux', 'unstarted', 4),

  // ---- Agent & AI Tools: 5 non-started incl. subtasks ----
  issue('agt-2',  'AGT-2', 'Recommendation prompt v3',         'proj-agent', 'unstarted', 1, { blocks: ['agent-wip'] }),
  issue('agt-3',  'AGT-3', 'Foreman task stack ordering',      'proj-agent', 'unstarted', 2, { parent: 'agt-2' }),
  issue('agt-4',  'AGT-4', 'Stack scoring weights',            'proj-agent', 'backlog',   3, { parent: 'agt-2' }),
  issue('agt-5',  'AGT-5', 'OpenRouter cost reporting',        'proj-agent', 'backlog',   3),
  issue('agt-6',  'AGT-6', 'Eval harness for prompt drift',    'proj-agent', 'backlog',   4),

  // ---- MCP & Remote Control: 4 non-started ----
  issue('mcp-2', 'MCP-2', 'MCP: reconcile transport drift',    'proj-mcp', 'unstarted', 2),
  issue('mcp-3', 'MCP-3', 'Remote control token rotation',     'proj-mcp', 'unstarted', 2, { blocks: ['mcp-wip'] }),
  issue('mcp-4', 'MCP-4', 'Heartbeat ping/pong frame',         'proj-mcp', 'backlog',   3),
  issue('mcp-5', 'MCP-5', 'Decouple sessions from sockets',    'proj-mcp', 'backlog',   4),

  // ---- Safety & Security: 4 non-started, 1 bug ----
  issue('sec-2', 'SEC-2', 'Add rate limit to /auth endpoints', 'proj-sec', 'unstarted', 1, { blocks: ['sec-wip'] }),
  issue('sec-3', 'SEC-3', 'Rotate signing keys quarterly',     'proj-sec', 'backlog',   3),
  issue('sec-4', 'SEC-4', 'Sentry PII scrubber config',        'proj-sec', 'unstarted', 2),
  issue('sec-5', 'SEC-5', 'CSRF middleware token leak',        'proj-sec', 'unstarted', 1, { labels: ['bug'] }),

  // ---- OS: 3 non-started ----
  issue('os-2', 'OS-2', 'Switch launchd plist to user agents', 'proj-os', 'unstarted', 3),
  issue('os-3', 'OS-3', 'macOS sandboxing entitlements',       'proj-os', 'backlog',   3),
  issue('os-4', 'OS-4', 'Windows installer signing flow',      'proj-os', 'backlog',   4),

  // ---- Project Architecture & Ops: 4 non-started ----
  issue('arc-2', 'ARC-2', 'Postgres connection pool tuning',   'proj-arch', 'unstarted', 2),
  issue('arc-3', 'ARC-3', 'Tracing for queued jobs',           'proj-arch', 'unstarted', 2),
  issue('arc-4', 'ARC-4', 'Index audit on hot tables',         'proj-arch', 'backlog',   3),
  issue('arc-5', 'ARC-5', 'Rotate staging secrets',            'proj-arch', 'backlog',   4),

  // ---- Harbour App: 3 non-started ----
  issue('har-2', 'HAR-2', 'Floor view drag handles',           'proj-harbour', 'unstarted', 2),
  issue('har-3', 'HAR-3', 'Cell drop animation easing',        'proj-harbour', 'backlog',   3),
  issue('har-4', 'HAR-4', 'Overlay focus trap fix',            'proj-harbour', 'unstarted', 2, { labels: ['bug'] }),

  // ---- Shell & Shims: all backlog → segment should be SKIPPED by the
  // backlog-only filter. (Project is technically active in Linear but no work
  // is currently queued for action.) ----
  issue('shl-2', 'SHL-2', 'Shim macOS LaunchAgents',           'proj-shell', 'backlog',   3),
  issue('shl-3', 'SHL-3', 'Shell wrapper exit-code passthrough','proj-shell', 'backlog',   3),
  issue('shl-4', 'SHL-4', 'Update PATH lookup heuristics',     'proj-shell', 'backlog',   4)
];

// Pre-build blocksIds (matching the flattenTrees card format).
for (const iss of shipDenseIssues) {
  iss.blocksIds = (iss.relations?.nodes || [])
    .filter(r => r.type === 'blocks')
    .map(r => r.relatedIssue.id);
}

export const shipDenseSampleData = {
  organizationName: 'Dense Ship Workspace',
  projects: shipDenseProjects,
  issues: shipDenseIssues
};
