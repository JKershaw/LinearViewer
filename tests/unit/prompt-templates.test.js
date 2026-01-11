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
    assert.strictEqual(hasPrompt('bug'), false);
    assert.strictEqual(hasPrompt('feature'), false);
    assert.strictEqual(hasPrompt('urgent'), false);
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
    const result = generatePrompt('bug', mockIssue, mockContext);
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
      description: 'x'.repeat(600)
    };

    const result = generatePrompt('needs-breakdown', issueWithLongDesc, mockContext);
    // Should be truncated to 500 chars + "..."
    assert.ok(result.prompt.includes('x'.repeat(500)));
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
