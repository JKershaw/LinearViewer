/**
 * Unit tests for prompt-templates.js
 *
 * Run with: node --test tests/unit/prompt-templates.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasPrompt, getPromptLabels, generatePrompt, getAvailablePrompts, PROMPT_TEMPLATES, PROMPT_CATEGORIES } from '../../lib/prompt-templates.js';

// =============================================================================
// hasPrompt Tests
// =============================================================================

describe('hasPrompt', () => {
  test('returns true for needs-breakdown label', () => {
    assert.strictEqual(hasPrompt('needs-breakdown'), true);
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

  test('includes needs-breakdown', () => {
    const labels = getPromptLabels();
    assert.ok(labels.includes('needs-breakdown'));
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
    labels: ['needs-breakdown']
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: null,
    children: []
  };

  test('returns null for unknown label', () => {
    const result = generatePrompt('feature', mockIssue, mockContext);
    assert.strictEqual(result, null);
  });

  test('returns object with name and prompt for valid label', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result !== null);
    assert.ok(typeof result.name === 'string');
    assert.ok(typeof result.prompt === 'string');
  });

  test('includes issue identifier in prompt', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('TEST-123'));
  });

  test('includes issue title in prompt', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Test task title'));
  });

  test('includes issue URL in prompt', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('https://linear.app/test/issue/TEST-123'));
  });

  test('includes description in prompt', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('This is a test description'));
  });

  test('omits parent section when no parent', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
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

    const result = generatePrompt('needs-breakdown', mockIssue, contextWithParent);
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

    const result = generatePrompt('needs-breakdown', mockIssue, contextWithSiblings);
    assert.ok(result.prompt.includes('TEST-101'));
    assert.ok(result.prompt.includes('Sibling 1'));
    assert.ok(result.prompt.includes('TEST-102'));
    assert.ok(result.prompt.includes('Sibling 2'));
  });

  test('omits sibling section when empty', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('**Sibling Tasks:**'));
  });

  test('truncates long descriptions with notice', () => {
    const issueWithLongDesc = {
      ...mockIssue,
      description: 'x'.repeat(1200)
    };

    const result = generatePrompt('needs-breakdown', issueWithLongDesc, mockContext);
    // Should be truncated to 1000 chars + "..."
    assert.ok(result.prompt.includes('x'.repeat(1000)));
    assert.ok(result.prompt.includes('...'));
    // Should include truncation notice
    assert.ok(result.prompt.includes('Description truncated'));
    assert.ok(result.prompt.includes('Use MCP to read full details'));
  });

  test('handles missing description gracefully', () => {
    const issueNoDesc = {
      ...mockIssue,
      description: null
    };

    const result = generatePrompt('needs-breakdown', issueNoDesc, mockContext);
    assert.ok(result.prompt.includes('No description provided'));
  });

  test('includes project context when present', () => {
    const contextWithProject = {
      ...mockContext,
      project: {
        name: 'My Project',
        description: 'This is the project description'
      }
    };

    const result = generatePrompt('needs-breakdown', mockIssue, contextWithProject);
    assert.ok(result.prompt.includes('My Project'));
    assert.ok(result.prompt.includes('This is the project description'));
  });

  test('shows Unknown for missing project', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Project:** Unknown'));
  });

  test('includes existing children when present', () => {
    const contextWithChildren = {
      ...mockContext,
      children: [
        { id: 'c1', identifier: 'TEST-201', title: 'Child task 1', state: { name: 'Todo', type: 'unstarted' } },
        { id: 'c2', identifier: 'TEST-202', title: 'Child task 2', state: { name: 'In Progress', type: 'started' } }
      ]
    };

    const result = generatePrompt('needs-breakdown', mockIssue, contextWithChildren);
    assert.ok(result.prompt.includes('TEST-201'));
    assert.ok(result.prompt.includes('Child task 1'));
    assert.ok(result.prompt.includes('TEST-202'));
    assert.ok(result.prompt.includes('Child task 2'));
    // Should include instruction to avoid duplicating existing subtasks
    assert.ok(result.prompt.includes('avoid duplicating'));
  });

  test('omits existing subtasks section when empty', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('**Existing Subtasks:**'));
  });

  test('includes other labels excluding the trigger label', () => {
    const issueWithLabels = {
      ...mockIssue,
      labels: ['needs-breakdown', 'backend', 'high-priority']
    };

    const result = generatePrompt('needs-breakdown', issueWithLabels, mockContext);
    assert.ok(result.prompt.includes('backend'));
    assert.ok(result.prompt.includes('high-priority'));
    // Should not duplicate needs-breakdown in other labels
    assert.ok(!result.prompt.includes('**Other Labels:** needs-breakdown'));
  });

  test('omits other labels section when only trigger label exists', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('**Other Labels:**'));
  });
});

// =============================================================================
// PROMPT_TEMPLATES Structure Tests
// =============================================================================

describe('PROMPT_TEMPLATES', () => {
  test('needs-breakdown template has required properties', () => {
    const template = PROMPT_TEMPLATES['needs-breakdown'];
    assert.ok(template !== undefined);
    assert.ok(typeof template.name === 'string');
    assert.ok(typeof template.generate === 'function');
  });

  test('template name is human-readable', () => {
    const template = PROMPT_TEMPLATES['needs-breakdown'];
    assert.strictEqual(template.name, 'Task Breakdown');
  });

  test('all expected templates exist', () => {
    const expectedTemplates = [
      'needs-breakdown',
      'needs-research',
      'needs-scoping',
      'needs-design',
      'needs-spike',
      'blocked',
      'needs-context',
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
// needs-research Template Tests
// =============================================================================

describe('needs-research template', () => {
  const mockIssue = {
    id: 'issue-research',
    identifier: 'TEST-R1',
    title: 'Research authentication options',
    description: 'Investigate OAuth vs JWT vs session-based auth',
    url: 'https://linear.app/test/issue/TEST-R1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['needs-research']
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: { name: 'Auth Project', description: 'Authentication improvements' },
    children: []
  };

  test('returns Research Task as name', () => {
    const result = generatePrompt('needs-research', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Research Task');
  });

  test('includes goal section', () => {
    const result = generatePrompt('needs-research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('research systematically'));
  });

  test('includes project and URL', () => {
    const result = generatePrompt('needs-research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Auth Project'));
    assert.ok(result.prompt.includes('https://linear.app/test/issue/TEST-R1'));
  });
});

// =============================================================================
// needs-scoping Template Tests
// =============================================================================

describe('needs-scoping template', () => {
  const mockIssue = {
    id: 'issue-scoping',
    identifier: 'TEST-S1',
    title: 'Define scope for user dashboard',
    description: 'Need to clarify dashboard features',
    url: 'https://linear.app/test/issue/TEST-S1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['needs-scoping']
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: null,
    children: []
  };

  test('returns Scope Definition as name', () => {
    const result = generatePrompt('needs-scoping', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Scope Definition');
  });

  test('includes goal with scope concepts', () => {
    const result = generatePrompt('needs-scoping', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('in scope'));
    assert.ok(result.prompt.includes('out of scope'));
    assert.ok(result.prompt.includes('success criteria'));
  });
});

// =============================================================================
// needs-design Template Tests
// =============================================================================

describe('needs-design template', () => {
  const mockIssue = {
    id: 'issue-design',
    identifier: 'TEST-D1',
    title: 'Design caching layer',
    description: 'Create technical design for caching',
    url: 'https://linear.app/test/issue/TEST-D1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['needs-design']
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: { name: 'Performance', description: 'Performance improvements' },
    children: []
  };

  test('returns Technical Design as name', () => {
    const result = generatePrompt('needs-design', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Technical Design');
  });

  test('includes goal with design concepts', () => {
    const result = generatePrompt('needs-design', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('design approaches'));
    assert.ok(result.prompt.includes('tradeoffs'));
  });
});

// =============================================================================
// needs-spike Template Tests
// =============================================================================

describe('needs-spike template', () => {
  const mockIssue = {
    id: 'issue-spike',
    identifier: 'TEST-SP1',
    title: 'Spike: WebSocket vs SSE',
    description: 'Evaluate real-time update options',
    url: 'https://linear.app/test/issue/TEST-SP1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['needs-spike'],
    estimate: 2
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: null,
    children: []
  };

  test('returns Technical Spike as name', () => {
    const result = generatePrompt('needs-spike', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Technical Spike');
  });

  test('includes timebox hint from estimate', () => {
    const result = generatePrompt('needs-spike', mockIssue, mockContext);
    assert.ok(result.prompt.includes('2 points'));
  });

  test('includes goal with spike concepts', () => {
    const result = generatePrompt('needs-spike', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('questions'));
    assert.ok(result.prompt.includes('success criteria'));
  });

  test('omits timebox when no estimate', () => {
    const issueNoEstimate = { ...mockIssue, estimate: null };
    const result = generatePrompt('needs-spike', issueNoEstimate, mockContext);
    assert.ok(!result.prompt.includes('Timebox'));
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
    children: []
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
// needs-context Template Tests
// =============================================================================

describe('needs-context template', () => {
  const mockIssue = {
    id: 'issue-context',
    identifier: 'TEST-C1',
    title: 'Context needed for migration',
    description: 'Need context on legacy system',
    url: 'https://linear.app/test/issue/TEST-C1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: ['needs-context'],
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
    ]
  };

  test('returns Context Summary as name', () => {
    const result = generatePrompt('needs-context', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Context Summary');
  });

  test('includes status', () => {
    const result = generatePrompt('needs-context', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Status:** Backlog'));
  });

  test('includes goal with context concepts', () => {
    const result = generatePrompt('needs-context', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes("what's done"));
    assert.ok(result.prompt.includes('next steps'));
  });

  test('includes siblings and children', () => {
    const result = generatePrompt('needs-context', mockIssue, mockContext);
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
    children: []
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

  test('includes status', () => {
    const result = generatePrompt('bug', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Status:** Todo'));
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
    ]
  };

  test('returns Implementation Plan as name', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.strictEqual(result.name, 'Implementation Plan');
  });

  test('has READY category', () => {
    const template = PROMPT_TEMPLATES['plan'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.READY);
  });

  test('includes status', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Status:** Backlog'));
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
    assert.ok(result.prompt.includes('implementation plan'));
  });

  test('includes project info', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('User Features'));
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
    children: []
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

  test('includes status', () => {
    const result = generatePrompt('code-review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Status:** In Review'));
  });

  test('includes project info', () => {
    const result = generatePrompt('code-review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Auth Refactor'));
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
      labels: { nodes: [{ name: 'needs-breakdown' }] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(!available.includes('plan'), 'Should not include plan when needs-breakdown present');
    assert.ok(!available.includes('code-review'), 'Should not include code-review when needs-breakdown present');
    assert.ok(available.includes('needs-breakdown'), 'Should include needs-breakdown label prompt');
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
    labels: ['needs-breakdown', 'backend']
  };

  const fullContext = {
    parent: { id: 'p1', identifier: 'TEST-100', title: 'Parent', state: { name: 'Started', type: 'started' } },
    siblings: [{ id: 's1', identifier: 'TEST-101', title: 'Sibling', state: { name: 'Todo', type: 'unstarted' } }],
    project: { name: 'Test Project', description: 'Project desc' },
    children: [{ id: 'c1', identifier: 'TEST-201', title: 'Child', state: { name: 'Todo', type: 'unstarted' } }]
  };

  test('prompt includes context sections when data present', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, fullContext);
    assert.ok(result.prompt.includes('## Context'));
    assert.ok(result.prompt.includes('**Project:**'));
    assert.ok(result.prompt.includes('**Issue URL:**'));
    assert.ok(result.prompt.includes('**Parent Task:**'));
    assert.ok(result.prompt.includes('**Sibling Tasks:**'));
    assert.ok(result.prompt.includes('**Existing Subtasks:**'));
    assert.ok(result.prompt.includes('**Other Labels:**'));
  });

  test('prompt includes goal section', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, fullContext);
    assert.ok(result.prompt.includes('## Goal'));
  });

  test('prompt omits empty sections', () => {
    const emptyContext = {
      parent: null,
      siblings: [],
      project: { name: 'Test Project' },
      children: []
    };
    const issueNoExtraLabels = { ...mockIssue, labels: ['needs-breakdown'] };
    const result = generatePrompt('needs-breakdown', issueNoExtraLabels, emptyContext);
    assert.ok(!result.prompt.includes('**Parent Task:**'));
    assert.ok(!result.prompt.includes('**Sibling Tasks:**'));
    assert.ok(!result.prompt.includes('**Existing Subtasks:**'));
    assert.ok(!result.prompt.includes('**Other Labels:**'));
  });
});
