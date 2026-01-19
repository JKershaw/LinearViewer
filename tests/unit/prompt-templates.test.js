/**
 * Unit tests for prompt-templates.js
 *
 * Run with: node --test tests/unit/prompt-templates.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasPrompt, getPromptLabels, generatePrompt, getAvailablePrompts, getPromptDescriptionsForAI, PROMPT_TEMPLATES, PROMPT_CATEGORIES } from '../../lib/prompt-templates.js';

// =============================================================================
// hasPrompt Tests
// =============================================================================

describe('hasPrompt', () => {
  test('returns true for in-breakdown label', () => {
    assert.strictEqual(hasPrompt('in-breakdown'), true);
  });

  test('returns false for unknown labels', () => {
    assert.strictEqual(hasPrompt('feature'), false);
    assert.strictEqual(hasPrompt('urgent'), false);
    assert.strictEqual(hasPrompt('documentation'), false);
  });

  test('returns false for empty string', () => {
    assert.strictEqual(hasPrompt(''), false);
  });

  test('is case-sensitive', () => {
    assert.strictEqual(hasPrompt('NEEDS-BREAKDOWN'), false);
    assert.strictEqual(hasPrompt('Needs-Breakdown'), false);
  });
});

// =============================================================================
// getPromptLabels Tests
// =============================================================================

describe('getPromptLabels', () => {
  test('returns array of label names', () => {
    const labels = getPromptLabels();
    assert.ok(Array.isArray(labels));
    assert.ok(labels.length > 0);
  });

  test('includes in-breakdown', () => {
    const labels = getPromptLabels();
    assert.ok(labels.includes('in-breakdown'));
  });
});

// =============================================================================
// generatePrompt Tests
// =============================================================================

describe('generatePrompt', () => {
  const mockIssue = {
    id: 'issue-123',
    identifier: 'TEST-123',
    title: 'Test task title',
    description: 'This is a test description for the task',
    url: 'https://linear.app/test/issue/TEST-123',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['in-breakdown']
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: null,
    children: [],
    comments: []
  };

  test('returns null for unknown label', () => {
    const result = generatePrompt('feature', mockIssue, mockContext);
    assert.strictEqual(result, null);
  });

  test('returns object with name and prompt for valid label', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(result !== null);
    assert.ok(typeof result.name === 'string');
    assert.ok(typeof result.prompt === 'string');
  });

  test('includes issue identifier and title in header', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('TEST-123'));
    assert.ok(result.prompt.includes('Test task title'));
    assert.ok(result.prompt.startsWith('# Break down TEST-123:'));
  });

  test('includes workflow section with Linear MCP instructions', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Workflow'));
    assert.ok(result.prompt.includes('Linear MCP'));
  });

  test('does not include URL (agent uses MCP)', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('https://linear.app'));
    assert.ok(!result.prompt.includes('**Issue URL:**'));
  });

  test('does not include description (agent fetches via MCP)', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('This is a test description'));
    assert.ok(!result.prompt.includes('**Description:**'));
  });

  test('omits parent section when no parent', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('**Parent Task:**'));
  });

  test('includes parent info when present', () => {
    const contextWithParent = {
      ...mockContext,
      parent: {
        id: 'parent-123',
        identifier: 'TEST-100',
        title: 'Parent task title',
        state: { name: 'In Progress', type: 'started' }
      }
    };

    const result = generatePrompt('in-breakdown', mockIssue, contextWithParent);
    assert.ok(result.prompt.includes('TEST-100'));
    assert.ok(result.prompt.includes('Parent task title'));
  });

  test('includes sibling info when present', () => {
    const contextWithSiblings = {
      ...mockContext,
      parent: {
        id: 'parent-123',
        identifier: 'TEST-100',
        title: 'Parent task',
        state: { name: 'In Progress', type: 'started' }
      },
      siblings: [
        { id: 's1', identifier: 'TEST-101', title: 'Sibling 1', state: { name: 'Todo', type: 'unstarted' } },
        { id: 's2', identifier: 'TEST-102', title: 'Sibling 2', state: { name: 'Done', type: 'completed' } }
      ]
    };

    const result = generatePrompt('in-breakdown', mockIssue, contextWithSiblings);
    assert.ok(result.prompt.includes('TEST-101'));
    assert.ok(result.prompt.includes('Sibling 1'));
    assert.ok(result.prompt.includes('TEST-102'));
    assert.ok(result.prompt.includes('Sibling 2'));
  });

  test('omits sibling section when empty', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('**Sibling Tasks:**'));
  });

  test('includes project name when present', () => {
    const contextWithProject = {
      ...mockContext,
      project: {
        name: 'My Project',
        description: 'This is the project description'
      }
    };

    const result = generatePrompt('in-breakdown', mockIssue, contextWithProject);
    assert.ok(result.prompt.includes('My Project'));
    // Project description is not included (agent can look it up)
    assert.ok(!result.prompt.includes('This is the project description'));
  });

  test('shows Unknown for missing project', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Unknown'));
  });

  test('includes existing children when present', () => {
    const contextWithChildren = {
      ...mockContext,
      children: [
        { id: 'c1', identifier: 'TEST-201', title: 'Child task 1', state: { name: 'Todo', type: 'unstarted' } },
        { id: 'c2', identifier: 'TEST-202', title: 'Child task 2', state: { name: 'In Progress', type: 'started' } }
      ]
    };

    const result = generatePrompt('in-breakdown', mockIssue, contextWithChildren);
    assert.ok(result.prompt.includes('TEST-201'));
    assert.ok(result.prompt.includes('Child task 1'));
    assert.ok(result.prompt.includes('TEST-202'));
    assert.ok(result.prompt.includes('Child task 2'));
    // Should include instruction to avoid duplicating existing subtasks
    assert.ok(result.prompt.includes('avoid duplicating'));
  });

  test('omits existing subtasks section when empty', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('**Existing Subtasks:**'));
  });

  test('includes comments when present', () => {
    const contextWithComments = {
      ...mockContext,
      comments: [
        { body: 'First comment with research findings', user: 'Alice', createdAt: '2024-01-15T10:00:00Z' },
        { body: 'Follow-up discussion', user: 'Bob', createdAt: '2024-01-16T14:30:00Z' }
      ]
    };

    const result = generatePrompt('in-breakdown', mockIssue, contextWithComments);
    assert.ok(result.prompt.includes('Alice'));
    assert.ok(result.prompt.includes('First comment with research findings'));
    assert.ok(result.prompt.includes('Bob'));
    assert.ok(result.prompt.includes('Follow-up discussion'));
    assert.ok(result.prompt.includes('Discussion History'));
  });

  test('omits comments section when empty', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('**Discussion History:**'));
  });

  test('includes other labels excluding the trigger label', () => {
    const issueWithLabels = {
      ...mockIssue,
      labels: ['in-breakdown', 'backend', 'high-priority']
    };

    const result = generatePrompt('in-breakdown', issueWithLabels, mockContext);
    assert.ok(result.prompt.includes('backend'));
    assert.ok(result.prompt.includes('high-priority'));
    // Should not duplicate in-breakdown in labels
    assert.ok(!result.prompt.includes('**Labels:** in-breakdown'));
  });

  test('omits labels section when only trigger label exists', () => {
    const result = generatePrompt('in-breakdown', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('**Labels:**'));
  });
});

// =============================================================================
// PROMPT_TEMPLATES Structure Tests
// =============================================================================

describe('PROMPT_TEMPLATES', () => {
  test('in-breakdown template has required properties', () => {
    const template = PROMPT_TEMPLATES['in-breakdown'];
    assert.ok(template !== undefined);
    assert.ok(typeof template.name === 'string');
    assert.ok(typeof template.generate === 'function');
  });

  test('template name is human-readable', () => {
    const template = PROMPT_TEMPLATES['in-breakdown'];
    assert.strictEqual(template.name, 'Task Breakdown');
  });

  test('all expected templates exist', () => {
    const expectedTemplates = [
      'in-breakdown',
      'in-research',
      'in-scoping',
      'in-design',
      'in-spike',
      'blocked',
      'in-context',
      'bug',
      'plan',
      'code-review'
    ];
    for (const labelName of expectedTemplates) {
      assert.ok(PROMPT_TEMPLATES[labelName], `Template for ${labelName} should exist`);
      assert.ok(typeof PROMPT_TEMPLATES[labelName].name === 'string', `${labelName} should have name`);
      assert.ok(typeof PROMPT_TEMPLATES[labelName].generate === 'function', `${labelName} should have generate function`);
    }
  });

  test('all templates have unique names', () => {
    const names = Object.values(PROMPT_TEMPLATES).map(t => t.name);
    const uniqueNames = new Set(names);
    assert.strictEqual(names.length, uniqueNames.size, 'All template names should be unique');
  });
});

// =============================================================================
// in-research Template Tests
// =============================================================================

describe('in-research template', () => {
  const mockIssue = {
    id: 'issue-research',
    identifier: 'TEST-R1',
    title: 'Research authentication options',
    description: 'Investigate OAuth vs JWT vs session-based auth',
    url: 'https://linear.app/test/issue/TEST-R1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['in-research']
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: { name: 'Auth Project', description: 'Authentication improvements' },
    children: [],
    comments: []
  };

  test('includes prior research prompt when comments exist', () => {
    const contextWithComments = {
      ...mockContext,
      comments: [{ body: 'Previous research on OAuth', user: 'Dev', createdAt: '2024-01-10T10:00:00Z' }]
    };
    const result = generatePrompt('in-research', mockIssue, contextWithComments);
    assert.ok(result.prompt.includes('Prior Research'));
    assert.ok(result.prompt.includes('build on existing findings'));
  });

  test('returns Research Task as name', () => {
    const result = generatePrompt('in-research', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Research Task');
  });

  test('includes goal section', () => {
    const result = generatePrompt('in-research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('research systematically'));
  });

  test('includes project name', () => {
    const result = generatePrompt('in-research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Auth Project'));
  });
});

// =============================================================================
// in-scoping Template Tests
// =============================================================================

describe('in-scoping template', () => {
  const mockIssue = {
    id: 'issue-scoping',
    identifier: 'TEST-S1',
    title: 'Define scope for user dashboard',
    description: 'Need to clarify dashboard features',
    url: 'https://linear.app/test/issue/TEST-S1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['in-scoping']
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: null,
    children: [],
    comments: []
  };

  test('returns Scope Definition as name', () => {
    const result = generatePrompt('in-scoping', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Scope Definition');
  });

  test('includes goal with scope concepts', () => {
    const result = generatePrompt('in-scoping', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('in scope'));
    assert.ok(result.prompt.includes('out of scope'));
    assert.ok(result.prompt.includes('success criteria'));
  });
});

// =============================================================================
// in-design Template Tests
// =============================================================================

describe('in-design template', () => {
  const mockIssue = {
    id: 'issue-design',
    identifier: 'TEST-D1',
    title: 'Design caching layer',
    description: 'Create technical design for caching',
    url: 'https://linear.app/test/issue/TEST-D1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['in-design']
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: { name: 'Performance', description: 'Performance improvements' },
    children: [],
    comments: []
  };

  test('returns Technical Design as name', () => {
    const result = generatePrompt('in-design', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Technical Design');
  });

  test('includes goal with design concepts', () => {
    const result = generatePrompt('in-design', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('design approaches'));
    assert.ok(result.prompt.includes('tradeoffs'));
  });
});

// =============================================================================
// in-spike Template Tests
// =============================================================================

describe('in-spike template', () => {
  const mockIssue = {
    id: 'issue-spike',
    identifier: 'TEST-SP1',
    title: 'Spike: WebSocket vs SSE',
    description: 'Evaluate real-time update options',
    url: 'https://linear.app/test/issue/TEST-SP1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['in-spike'],
    estimate: 2
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: null,
    children: [],
    comments: []
  };

  test('returns Technical Spike as name', () => {
    const result = generatePrompt('in-spike', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Technical Spike');
  });

  test('includes goal with spike concepts', () => {
    const result = generatePrompt('in-spike', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('questions'));
    assert.ok(result.prompt.includes('success criteria'));
  });
});

// =============================================================================
// blocked Template Tests
// =============================================================================

describe('blocked template', () => {
  const mockIssue = {
    id: 'issue-blocked',
    identifier: 'TEST-B1',
    title: 'Blocked on external API',
    description: 'Waiting for API credentials',
    url: 'https://linear.app/test/issue/TEST-B1',
    state: { name: 'In Progress', type: 'started' },
    labels: ['blocked'],
    assignee: { name: 'Alice' }
  };

  const mockContext = {
    parent: { id: 'p1', identifier: 'TEST-P1', title: 'Parent task', state: { name: 'Started', type: 'started' } },
    siblings: [],
    project: { name: 'Integration', description: 'API Integration' },
    children: [],
    comments: []
  };

  test('returns Blocker Analysis as name', () => {
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Blocker Analysis');
  });

  test('includes goal with blocker concepts', () => {
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('blocker type'));
    assert.ok(result.prompt.includes('root cause'));
  });

  test('includes parent info when present', () => {
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.ok(result.prompt.includes('TEST-P1'));
    assert.ok(result.prompt.includes('Parent task'));
  });
});

// =============================================================================
// in-context Template Tests
// =============================================================================

describe('in-context template', () => {
  const mockIssue = {
    id: 'issue-context',
    identifier: 'TEST-C1',
    title: 'Context needed for migration',
    description: 'Need context on legacy system',
    url: 'https://linear.app/test/issue/TEST-C1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['in-context'],
    assignee: null
  };

  const mockContext = {
    parent: null,
    siblings: [
      { id: 's1', identifier: 'TEST-S1', title: 'Related task', state: { name: 'Done', type: 'completed' } }
    ],
    project: { name: 'Migration', description: 'Legacy system migration' },
    children: [
      { id: 'c1', identifier: 'TEST-C2', title: 'Subtask', state: { name: 'Todo', type: 'unstarted' } }
    ],
    comments: []
  };

  test('returns Context Summary as name', () => {
    const result = generatePrompt('in-context', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Context Summary');
  });

  test('includes goal with context concepts', () => {
    const result = generatePrompt('in-context', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes("what's done"));
    assert.ok(result.prompt.includes('next steps'));
  });

  test('includes siblings and children', () => {
    const result = generatePrompt('in-context', mockIssue, mockContext);
    assert.ok(result.prompt.includes('TEST-S1'));
    assert.ok(result.prompt.includes('TEST-C2'));
  });
});

// =============================================================================
// bug Template Tests
// =============================================================================

describe('bug template', () => {
  const mockIssue = {
    id: 'issue-bug',
    identifier: 'TEST-BUG1',
    title: 'Login fails with special characters',
    description: 'Users report login fails when password contains @ or #',
    url: 'https://linear.app/test/issue/TEST-BUG1',
    state: { name: 'Todo', type: 'unstarted' },
    labels: ['bug'],
    assignee: { name: 'Bob' }
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: { name: 'Auth', description: 'Authentication system' },
    children: [],
    comments: []
  };

  test('returns Bug Investigation as name', () => {
    const result = generatePrompt('bug', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Bug Investigation');
  });

  test('includes goal with bug concepts', () => {
    const result = generatePrompt('bug', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('reproduction steps'));
    assert.ok(result.prompt.includes('likely causes'));
  });
});

// =============================================================================
// plan Template Tests
// =============================================================================

describe('plan template', () => {
  const mockIssue = {
    id: 'issue-plan',
    identifier: 'TEST-P1',
    title: 'Implement user profile page',
    description: 'Create a new user profile page with avatar, bio, and settings',
    url: 'https://linear.app/test/issue/TEST-P1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['plan'],
    assignee: { name: 'Alice' },
    estimate: 5
  };

  const mockContext = {
    parent: { id: 'p1', identifier: 'TEST-EPIC', title: 'User Management Epic', state: { name: 'In Progress', type: 'started' } },
    siblings: [
      { id: 's1', identifier: 'TEST-S1', title: 'User authentication', state: { name: 'Done', type: 'completed' } }
    ],
    project: { name: 'User Features', description: 'User-related features' },
    children: [
      { id: 'c1', identifier: 'TEST-C1', title: 'Design profile UI', state: { name: 'Todo', type: 'unstarted' } }
    ],
    comments: []
  };

  test('returns Implementation Plan as name', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Implementation Plan');
  });

  test('has READY category', () => {
    const template = PROMPT_TEMPLATES['plan'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.READY);
  });

  test('includes parent info', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('TEST-EPIC'));
    assert.ok(result.prompt.includes('User Management Epic'));
  });

  test('omits parent section when no parent', () => {
    const contextNoParent = { ...mockContext, parent: null };
    const result = generatePrompt('plan', mockIssue, contextNoParent);
    assert.ok(!result.prompt.includes('**Parent Task:**'));
  });

  test('includes sibling tasks', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('TEST-S1'));
    assert.ok(result.prompt.includes('User authentication'));
  });

  test('includes subtasks', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('TEST-C1'));
    assert.ok(result.prompt.includes('Design profile UI'));
  });

  test('includes goal with implementation concepts', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('implement'));
  });

  test('includes project info', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('User Features'));
  });

  test('includes workflow section with status updates', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Workflow'));
    assert.ok(result.prompt.includes('In Progress'));
    assert.ok(result.prompt.includes('in-review'));
  });

  test('workflow uses in-review label for completion', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Complete'));
    assert.ok(result.prompt.includes('add "in-review" label'));
    assert.ok(result.prompt.includes('indicate ready for review'));
  });

  test('includes explicit planning phase before coding', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Phase 1: Planning'));
    assert.ok(result.prompt.includes('required before coding'));
    assert.ok(result.prompt.includes('Files to modify or create'));
  });

  test('includes scope control guidance', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Scope Control'));
    assert.ok(result.prompt.includes('Only implement what is explicitly requested'));
    assert.ok(result.prompt.includes('Avoid over-engineering'));
  });

  test('includes baseline test verification', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Run existing tests to verify baseline'));
  });

  test('includes subtask summary when subtasks present', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Subtasks:**'));
    assert.ok(result.prompt.includes('0/1 done'));
    assert.ok(result.prompt.includes('Next: TEST-C1'));
  });

  test('omits subtask summary when no subtasks', () => {
    const contextNoChildren = { ...mockContext, children: [] };
    const result = generatePrompt('plan', mockIssue, contextNoChildren);
    assert.ok(!result.prompt.includes('**Subtasks:**'));
  });

  test('subtask summary shows in-progress with Continue', () => {
    const contextWithInProgress = {
      ...mockContext,
      children: [
        { id: 'c1', identifier: 'TEST-C1', title: 'Done task', state: { name: 'Done', type: 'completed' } },
        { id: 'c2', identifier: 'TEST-C2', title: 'In progress', state: { name: 'In Progress', type: 'started' } },
        { id: 'c3', identifier: 'TEST-C3', title: 'Todo', state: { name: 'Todo', type: 'unstarted' } }
      ]
    };
    const result = generatePrompt('plan', mockIssue, contextWithInProgress);
    assert.ok(result.prompt.includes('1/3 done'));
    assert.ok(result.prompt.includes('1 in progress'));
    assert.ok(result.prompt.includes('Continue: TEST-C2'));
  });

  test('subtask summary shows Next when none in progress', () => {
    const contextAllTodo = {
      ...mockContext,
      children: [
        { id: 'c1', identifier: 'TEST-C1', title: 'First', state: { name: 'Todo', type: 'unstarted' } },
        { id: 'c2', identifier: 'TEST-C2', title: 'Second', state: { name: 'Todo', type: 'unstarted' } }
      ]
    };
    const result = generatePrompt('plan', mockIssue, contextAllTodo);
    assert.ok(result.prompt.includes('0/2 done'));
    assert.ok(result.prompt.includes('Next: TEST-C1'));
  });

  test('subtask summary shows all done without next action', () => {
    const contextAllDone = {
      ...mockContext,
      children: [
        { id: 'c1', identifier: 'TEST-C1', title: 'Done 1', state: { name: 'Done', type: 'completed' } },
        { id: 'c2', identifier: 'TEST-C2', title: 'Done 2', state: { name: 'Done', type: 'completed' } }
      ]
    };
    const result = generatePrompt('plan', mockIssue, contextAllDone);
    assert.ok(result.prompt.includes('2/2 done'));
    assert.ok(!result.prompt.includes('Next:'));
    assert.ok(!result.prompt.includes('Continue:'));
  });

  test('includes commit message guidance with issue identifier', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('commit message referencing TEST-P1'));
  });

  test('includes success criteria section', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Success Criteria'));
    assert.ok(result.prompt.includes('Tests cover'));
  });

  test('includes if blocked section', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## If Blocked'));
  });

  test('success criteria includes parent alignment when parent exists', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('TEST-EPIC'));
    assert.ok(result.prompt.includes('align with parent'));
  });
});

// =============================================================================
// code-review Template Tests
// =============================================================================

describe('code-review template', () => {
  const mockIssue = {
    id: 'issue-review',
    identifier: 'TEST-CR1',
    title: 'Refactor authentication module',
    description: 'Extract auth logic into separate service for better testability',
    url: 'https://linear.app/test/issue/TEST-CR1',
    state: { name: 'In Review', type: 'started' },
    labels: ['code-review'],
    assignee: { name: 'Alice' },
    estimate: 3
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: { name: 'Auth Refactor', description: 'Authentication improvements' },
    children: [],
    comments: []
  };

  test('returns Code Review as name', () => {
    const result = generatePrompt('code-review', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Code Review');
  });

  test('has READY category', () => {
    const template = PROMPT_TEMPLATES['code-review'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.READY);
  });

  test('includes goal with review concepts', () => {
    const result = generatePrompt('code-review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('correctness'));
    assert.ok(result.prompt.includes('security'));
    assert.ok(result.prompt.includes('Approve'));
  });

  test('includes project info', () => {
    const result = generatePrompt('code-review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Auth Refactor'));
  });

  test('includes workflow section', () => {
    const result = generatePrompt('code-review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Workflow'));
    assert.ok(result.prompt.includes('Linear MCP'));
  });

  test('includes review checklist', () => {
    const result = generatePrompt('code-review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Review checklist'));
    assert.ok(result.prompt.includes('Tests cover'));
    assert.ok(result.prompt.includes('security vulnerabilities'));
  });
});

// =============================================================================
// getAvailablePrompts Tests
// =============================================================================

describe('getAvailablePrompts', () => {
  test('returns both plan and code-review for eligible backlog issue', () => {
    const issue = {
      state: { type: 'backlog' },
      labels: { nodes: [] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(available.includes('plan'), 'Should include plan');
    assert.ok(available.includes('code-review'), 'Should include code-review');
  });

  test('returns both plan and code-review for eligible unstarted issue', () => {
    const issue = {
      state: { type: 'unstarted' },
      labels: { nodes: [] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(available.includes('plan'), 'Should include plan');
    assert.ok(available.includes('code-review'), 'Should include code-review');
  });

  test('returns both plan and code-review for eligible started issue', () => {
    const issue = {
      state: { type: 'started' },
      labels: { nodes: [] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(available.includes('plan'), 'Should include plan');
    assert.ok(available.includes('code-review'), 'Should include code-review');
  });

  test('does not return plan or code-review for completed issue', () => {
    const issue = {
      state: { type: 'completed' },
      labels: { nodes: [] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(!available.includes('plan'), 'Should not include plan');
    assert.ok(!available.includes('code-review'), 'Should not include code-review');
  });

  test('does not return plan or code-review when pre-work label present', () => {
    const issue = {
      state: { type: 'backlog' },
      labels: { nodes: [{ name: 'in-breakdown' }] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(!available.includes('plan'), 'Should not include plan when in-breakdown present');
    assert.ok(!available.includes('code-review'), 'Should not include code-review when in-breakdown present');
    assert.ok(available.includes('in-breakdown'), 'Should include in-breakdown label prompt');
  });

  test('returns label-based prompts alongside state-based prompts', () => {
    const issue = {
      state: { type: 'started' },
      labels: { nodes: [{ name: 'bug' }] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(available.includes('bug'), 'Should include bug label prompt');
    assert.ok(available.includes('plan'), 'Should include plan');
    assert.ok(available.includes('code-review'), 'Should include code-review');
  });
});

// =============================================================================
// Prompt Sections Tests
// =============================================================================

describe('Prompt Sections', () => {
  const mockIssue = {
    id: 'issue-123',
    identifier: 'TEST-123',
    title: 'Test task',
    description: 'Test description',
    url: 'https://linear.app/test/issue/TEST-123',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['in-breakdown', 'backend']
  };

  const fullContext = {
    parent: { id: 'p1', identifier: 'TEST-100', title: 'Parent', state: { name: 'Started', type: 'started' } },
    siblings: [{ id: 's1', identifier: 'TEST-101', title: 'Sibling', state: { name: 'Todo', type: 'unstarted' } }],
    project: { name: 'Test Project', description: 'Project desc' },
    children: [{ id: 'c1', identifier: 'TEST-201', title: 'Child', state: { name: 'Todo', type: 'unstarted' } }],
    comments: []
  };

  test('prompt includes header with identifier and title', () => {
    const result = generatePrompt('in-breakdown', mockIssue, fullContext);
    assert.ok(result.prompt.startsWith('# Break down TEST-123: Test task'));
  });

  test('prompt includes workflow section', () => {
    const result = generatePrompt('in-breakdown', mockIssue, fullContext);
    assert.ok(result.prompt.includes('## Workflow'));
    assert.ok(result.prompt.includes('Linear MCP'));
  });

  test('prompt includes context sections when data present', () => {
    const result = generatePrompt('in-breakdown', mockIssue, fullContext);
    assert.ok(result.prompt.includes('## Context'));
    assert.ok(result.prompt.includes('**Project:**'));
    assert.ok(result.prompt.includes('**Parent Task:**'));
    assert.ok(result.prompt.includes('**Sibling Tasks:**'));
    assert.ok(result.prompt.includes('**Existing Subtasks:**'));
    assert.ok(result.prompt.includes('**Labels:**'));
    // Should NOT include URL or description (agent fetches via MCP)
    assert.ok(!result.prompt.includes('**Issue URL:**'));
    assert.ok(!result.prompt.includes('**Description:**'));
  });

  test('prompt includes goal section', () => {
    const result = generatePrompt('in-breakdown', mockIssue, fullContext);
    assert.ok(result.prompt.includes('## Goal'));
  });

  test('prompt omits empty sections', () => {
    const emptyContext = {
      parent: null,
      siblings: [],
      project: { name: 'Test Project' },
      children: []
    };
    const issueNoExtraLabels = { ...mockIssue, labels: ['in-breakdown'] };
    const result = generatePrompt('in-breakdown', issueNoExtraLabels, emptyContext);
    assert.ok(!result.prompt.includes('**Parent Task:**'));
    assert.ok(!result.prompt.includes('**Sibling Tasks:**'));
    assert.ok(!result.prompt.includes('**Existing Subtasks:**'));
    assert.ok(!result.prompt.includes('**Labels:**'));
  });
});

// =============================================================================
// getPromptDescriptionsForAI Tests
// =============================================================================

describe('getPromptDescriptionsForAI', () => {
  test('returns array of prompt descriptions', () => {
    const keys = ['in-breakdown', 'plan'];
    const descriptions = getPromptDescriptionsForAI(keys);
    assert.ok(Array.isArray(descriptions));
    assert.strictEqual(descriptions.length, 2);
  });

  test('each description has key, name, description, and category', () => {
    const keys = ['in-breakdown'];
    const descriptions = getPromptDescriptionsForAI(keys);
    const desc = descriptions[0];
    assert.strictEqual(desc.key, 'in-breakdown');
    assert.strictEqual(desc.name, 'Task Breakdown');
    assert.ok(typeof desc.description === 'string');
    assert.ok(desc.description.length > 0);
    assert.strictEqual(desc.category, PROMPT_CATEGORIES.PRE_WORK);
  });

  test('filters out unknown keys', () => {
    const keys = ['in-breakdown', 'unknown-label', 'plan'];
    const descriptions = getPromptDescriptionsForAI(keys);
    assert.strictEqual(descriptions.length, 2);
    assert.ok(descriptions.every(d => d.key !== 'unknown-label'));
  });

  test('returns empty array for empty input', () => {
    const descriptions = getPromptDescriptionsForAI([]);
    assert.ok(Array.isArray(descriptions));
    assert.strictEqual(descriptions.length, 0);
  });

  test('all templates have descriptions', () => {
    const allKeys = Object.keys(PROMPT_TEMPLATES);
    const descriptions = getPromptDescriptionsForAI(allKeys);
    assert.strictEqual(descriptions.length, allKeys.length);
    for (const desc of descriptions) {
      assert.ok(typeof desc.description === 'string', `${desc.key} should have description`);
      assert.ok(desc.description.length > 10, `${desc.key} description should be meaningful`);
    }
  });
});
