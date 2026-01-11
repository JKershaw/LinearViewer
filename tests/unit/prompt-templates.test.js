/**
 * Unit tests for prompt-templates.js
 *
 * Run with: node --test tests/unit/prompt-templates.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasPrompt, getPromptLabels, generatePrompt, PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';

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

  test('shows "top-level task" when no parent', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('top-level task'));
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

  test('shows "None" for siblings when empty', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Sibling Tasks:**\nNone'));
  });

  test('includes Linear MCP tool references', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('mcp__linear__get_issue'));
    assert.ok(result.prompt.includes('mcp__linear__create_issue'));
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

  test('shows None for existing subtasks when empty', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Existing Subtasks:**\nNone'));
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

  test('shows None for other labels when only trigger label exists', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Other Labels:** None'));
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
      'bug'
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

  test('includes MCP tool references', () => {
    const result = generatePrompt('needs-research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('mcp__linear__get_issue'));
    assert.ok(result.prompt.includes('mcp__linear__update_issue'));
  });

  test('includes instructions to update task after completion', () => {
    const result = generatePrompt('needs-research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Remove the `needs-research` label'));
  });

  test('includes output format sections', () => {
    const result = generatePrompt('needs-research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Key Questions'));
    assert.ok(result.prompt.includes('Findings'));
    assert.ok(result.prompt.includes('Recommendation'));
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

  test('includes scope-specific sections', () => {
    const result = generatePrompt('needs-scoping', mockIssue, mockContext);
    assert.ok(result.prompt.includes('In Scope'));
    assert.ok(result.prompt.includes('Out of Scope'));
    assert.ok(result.prompt.includes('Success Criteria'));
  });

  test('includes MCP update instructions', () => {
    const result = generatePrompt('needs-scoping', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Remove the `needs-scoping` label'));
    assert.ok(result.prompt.includes('Update the description with the scope definition'));
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

  test('includes design-specific sections', () => {
    const result = generatePrompt('needs-design', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Design Options'));
    assert.ok(result.prompt.includes('Recommended Approach'));
    assert.ok(result.prompt.includes('API/Interface Changes'));
  });

  test('includes follow-up label instruction', () => {
    const result = generatePrompt('needs-design', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Add `needs-breakdown`'));
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

  test('includes spike-specific sections', () => {
    const result = generatePrompt('needs-spike', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Questions to Answer'));
    assert.ok(result.prompt.includes('Timebox'));
    assert.ok(result.prompt.includes('If Successful'));
    assert.ok(result.prompt.includes('If Unsuccessful'));
  });

  test('suggests timebox when no estimate', () => {
    const issueNoEstimate = { ...mockIssue, estimate: null };
    const result = generatePrompt('needs-spike', issueNoEstimate, mockContext);
    assert.ok(result.prompt.includes('Suggest an appropriate timebox'));
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

  test('includes assignee info', () => {
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Alice'));
  });

  test('includes blocker-specific sections', () => {
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Blocker Type'));
    assert.ok(result.prompt.includes('Root Cause'));
    assert.ok(result.prompt.includes('Options to Unblock'));
    assert.ok(result.prompt.includes('Escalation'));
  });

  test('includes unassigned when no assignee', () => {
    const issueNoAssignee = { ...mockIssue, assignee: null };
    const result = generatePrompt('blocked', issueNoAssignee, mockContext);
    assert.ok(result.prompt.includes('Unassigned'));
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

  test('includes current state info', () => {
    const result = generatePrompt('needs-context', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Status:** Backlog'));
    assert.ok(result.prompt.includes('**Assignee:** Unassigned'));
  });

  test('includes context-specific sections', () => {
    const result = generatePrompt('needs-context', mockIssue, mockContext);
    assert.ok(result.prompt.includes("What's Done"));
    assert.ok(result.prompt.includes("What Remains"));
    assert.ok(result.prompt.includes('Key Decisions'));
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

  test('includes bug-specific sections', () => {
    const result = generatePrompt('bug', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Expected Behavior'));
    assert.ok(result.prompt.includes('Actual Behavior'));
    assert.ok(result.prompt.includes('Reproduction Steps'));
    assert.ok(result.prompt.includes('Likely Causes'));
    assert.ok(result.prompt.includes('Investigation Plan'));
  });

  test('includes assignee and status', () => {
    const result = generatePrompt('bug', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Bob'));
    assert.ok(result.prompt.includes('Todo'));
  });

  test('includes MCP instructions for updating after fix', () => {
    const result = generatePrompt('bug', mockIssue, mockContext);
    assert.ok(result.prompt.includes('link the PR'));
    assert.ok(result.prompt.includes('update status'));
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
    labels: ['needs-breakdown']
  };

  const fullContext = {
    parent: { id: 'p1', identifier: 'TEST-100', title: 'Parent', state: { name: 'Started', type: 'started' } },
    siblings: [{ id: 's1', identifier: 'TEST-101', title: 'Sibling', state: { name: 'Todo', type: 'unstarted' } }],
    project: { name: 'Test Project', description: 'Project desc' },
    children: [{ id: 'c1', identifier: 'TEST-201', title: 'Child', state: { name: 'Todo', type: 'unstarted' } }]
  };

  test('prompt includes all required context sections', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, fullContext);
    assert.ok(result.prompt.includes('## Context'));
    assert.ok(result.prompt.includes('**Project:**'));
    assert.ok(result.prompt.includes('**Issue URL:**'));
    assert.ok(result.prompt.includes('**Parent Task:**'));
    assert.ok(result.prompt.includes('**Sibling Tasks:**'));
    assert.ok(result.prompt.includes('**Existing Subtasks:**'));
    assert.ok(result.prompt.includes('**Other Labels:**'));
    assert.ok(result.prompt.includes('**Current Description:**'));
  });

  test('prompt includes all required instruction sections', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, fullContext);
    assert.ok(result.prompt.includes('## Instructions'));
    assert.ok(result.prompt.includes('## Output Format'));
  });

  test('prompt includes MCP tool references', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, fullContext);
    assert.ok(result.prompt.includes('`mcp__linear__get_issue`'));
    assert.ok(result.prompt.includes('`mcp__linear__create_issue`'));
  });

  test('prompt includes human approval step', () => {
    const result = generatePrompt('needs-breakdown', mockIssue, fullContext);
    assert.ok(result.prompt.includes('After I approve'));
  });
});
