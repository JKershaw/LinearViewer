/**
 * Unit tests for prompt-templates.js
 *
 * Run with: node --test tests/unit/prompt-templates.test.js
 *
 * Tests the simplified 3-label system:
 * - preparing: Pre-implementation work
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 *
 * Plus virtual prompts: plan, code-review, look-into, triage
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasPrompt, getPromptLabels, generatePrompt, getAvailablePrompts, getPromptDescriptionsForAI, PROMPT_TEMPLATES, PROMPT_CATEGORIES, getPreWorkLabels, isPreWorkLabel } from '../../lib/prompt-templates.js';
import { PREPARING_LABEL, WORK_ISSUE_LABELS } from '../../lib/workflow-config.js';
import { COMPLETION_SIGNALS } from '../../lib/completion-signals.js';

// =============================================================================
// hasPrompt Tests
// =============================================================================

describe('hasPrompt', () => {
  test('returns true for blocked label', () => {
    assert.strictEqual(hasPrompt('blocked'), true);
  });

  test('returns true for bug label', () => {
    assert.strictEqual(hasPrompt('bug'), true);
  });

  test('returns true for virtual prompts', () => {
    assert.strictEqual(hasPrompt('plan'), true);
    assert.strictEqual(hasPrompt('code-review'), true);
    assert.strictEqual(hasPrompt('look-into'), true);
    assert.strictEqual(hasPrompt('triage'), true);
    assert.strictEqual(hasPrompt('breakdown'), true);
    assert.strictEqual(hasPrompt('research'), true);
    assert.strictEqual(hasPrompt('scoping'), true);
    assert.strictEqual(hasPrompt('design'), true);
    assert.strictEqual(hasPrompt('spike'), true);
    assert.strictEqual(hasPrompt('context'), true);
    assert.strictEqual(hasPrompt('implementation'), true);
    assert.strictEqual(hasPrompt('review'), true);
  });

  test('returns false for unknown labels', () => {
    assert.strictEqual(hasPrompt('feature'), false);
    assert.strictEqual(hasPrompt('urgent'), false);
    assert.strictEqual(hasPrompt('documentation'), false);
  });

  test('returns false for old in-X phase labels (removed format)', () => {
    assert.strictEqual(hasPrompt('in-breakdown'), false);
    assert.strictEqual(hasPrompt('in-research'), false);
    assert.strictEqual(hasPrompt('in-scoping'), false);
    assert.strictEqual(hasPrompt('in-design'), false);
    assert.strictEqual(hasPrompt('in-spike'), false);
    assert.strictEqual(hasPrompt('in-context'), false);
    assert.strictEqual(hasPrompt('in-implementation'), false);
    assert.strictEqual(hasPrompt('in-review'), false);
  });

  test('returns false for empty string', () => {
    assert.strictEqual(hasPrompt(''), false);
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

  test('includes work-issue labels', () => {
    const labels = getPromptLabels();
    assert.ok(labels.includes('blocked'));
    assert.ok(labels.includes('bug'));
  });

  test('includes virtual prompts', () => {
    const labels = getPromptLabels();
    assert.ok(labels.includes('plan'));
    assert.ok(labels.includes('code-review'));
    assert.ok(labels.includes('look-into'));
    assert.ok(labels.includes('triage'));
    assert.ok(labels.includes('breakdown'));
    assert.ok(labels.includes('research'));
    assert.ok(labels.includes('scoping'));
    assert.ok(labels.includes('design'));
    assert.ok(labels.includes('spike'));
    assert.ok(labels.includes('context'));
    assert.ok(labels.includes('implementation'));
    assert.ok(labels.includes('review'));
    assert.ok(labels.includes('retro'));
  });

  test('has exactly 15 templates', () => {
    const labels = getPromptLabels();
    assert.strictEqual(labels.length, 15);
  });
});

// =============================================================================
// getPreWorkLabels Tests
// =============================================================================

describe('getPreWorkLabels', () => {
  test('returns array with preparing label', () => {
    const labels = getPreWorkLabels();
    assert.ok(Array.isArray(labels));
    assert.strictEqual(labels.length, 1);
    assert.ok(labels.includes(PREPARING_LABEL));
  });
});

// =============================================================================
// isPreWorkLabel Tests
// =============================================================================

describe('isPreWorkLabel', () => {
  test('returns true for preparing label', () => {
    assert.strictEqual(isPreWorkLabel('preparing'), true);
    assert.strictEqual(isPreWorkLabel('Preparing'), true);
    assert.strictEqual(isPreWorkLabel('PREPARING'), true);
  });

  test('returns false for other labels', () => {
    assert.strictEqual(isPreWorkLabel('blocked'), false);
    assert.strictEqual(isPreWorkLabel('bug'), false);
    assert.strictEqual(isPreWorkLabel('in-breakdown'), false);
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
    labels: ['blocked']
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
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.ok(result !== null);
    assert.ok(typeof result.name === 'string');
    assert.ok(typeof result.prompt === 'string');
  });

  test('includes issue identifier and title in header', () => {
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.ok(result.prompt.includes('TEST-123'));
    assert.ok(result.prompt.includes('Test task title'));
  });

  test('includes workflow section with Linear references', () => {
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Workflow'));
    assert.ok(result.prompt.includes('in Linear'));
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

    const result = generatePrompt('blocked', mockIssue, contextWithParent);
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

    const result = generatePrompt('blocked', mockIssue, contextWithSiblings);
    assert.ok(result.prompt.includes('TEST-101'));
    assert.ok(result.prompt.includes('Sibling 1'));
  });

  test('includes project name when present', () => {
    const contextWithProject = {
      ...mockContext,
      project: {
        name: 'My Project',
        description: 'This is the project description'
      }
    };

    const result = generatePrompt('blocked', mockIssue, contextWithProject);
    assert.ok(result.prompt.includes('My Project'));
  });

  test('includes comments when present', () => {
    const contextWithComments = {
      ...mockContext,
      comments: [
        { body: 'First comment with research findings', user: 'Alice', createdAt: '2024-01-15T10:00:00Z' },
        { body: 'Follow-up discussion', user: 'Bob', createdAt: '2024-01-16T14:30:00Z' }
      ]
    };

    const result = generatePrompt('blocked', mockIssue, contextWithComments);
    assert.ok(result.prompt.includes('Alice'));
    assert.ok(result.prompt.includes('First comment with research findings'));
  });
});

// =============================================================================
// PROMPT_TEMPLATES Structure Tests
// =============================================================================

describe('PROMPT_TEMPLATES', () => {
  test('blocked template has required properties', () => {
    const template = PROMPT_TEMPLATES['blocked'];
    assert.ok(template !== undefined);
    assert.ok(typeof template.name === 'string');
    assert.ok(typeof template.generate === 'function');
  });

  test('all expected templates exist', () => {
    const expectedTemplates = [
      'blocked',
      'bug',
      'plan',
      'code-review',
      'look-into',
      'triage',
      'breakdown',
      'research',
      'scoping',
      'design',
      'spike',
      'context',
      'implementation',
      'review',
      'retro'
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

  test('old in-X label format templates do not exist (replaced by universal prompts)', () => {
    const oldLabelFormat = [
      'in-breakdown',
      'in-research',
      'in-scoping',
      'in-design',
      'in-spike',
      'in-context',
      'in-implementation',
      'in-review'
    ];
    for (const labelName of oldLabelFormat) {
      assert.ok(!PROMPT_TEMPLATES[labelName], `Old template for ${labelName} should NOT exist`);
    }
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
    parent: null,
    siblings: [],
    project: { name: 'Integration', description: 'API Integration' },
    children: [],
    comments: []
  };

  test('returns blocked as name', () => {
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.strictEqual(result.name, 'blocked');
  });

  test('includes goal with blocker concepts', () => {
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('Blocker Type'));
    assert.ok(result.prompt.includes('Root Cause'));
  });

  test('has WORK_ISSUE category', () => {
    const template = PROMPT_TEMPLATES['blocked'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.WORK_ISSUE);
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

  test('returns bug as name', () => {
    const result = generatePrompt('bug', mockIssue, mockContext);
    assert.strictEqual(result.name, 'bug');
  });

  test('includes goal with bug concepts', () => {
    const result = generatePrompt('bug', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('reproduction steps'));
    assert.ok(result.prompt.includes('likely causes'));
  });

  test('has WORK_ISSUE category', () => {
    const template = PROMPT_TEMPLATES['bug'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.WORK_ISSUE);
  });

  // LIN-279 AC #4: bug template is byte-identical pre/post the Strategy Framing change.
  test('bug template does NOT include Strategy Framing', () => {
    const result = generatePrompt('bug', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('Strategy Framing'), 'bug prompt must not include Strategy Framing');
  });

  test('bug template Goal block is byte-identical to inline snapshot', () => {
    const result = generatePrompt('bug', mockIssue, mockContext);
    // Inline snapshot of the bug template's ## Goal section, frozen at the time of LIN-279.
    // Any change to bug Goal content will fail this assertion — that is the AC #4 lock.
    // Note: the template's section array is .filter(Boolean)-ed, which strips empty
    // strings — so adjacent items end up separated by a single '\n', not '\n\n'.
    // This snapshot reflects the post-filter shape.
    const expectedGoalBlock = [
      '## Goal',
      '**Role**: Act as a software debugger investigating unexpected behavior. You have authority to reproduce issues, trace root causes, and propose fixes, but should not deploy changes without review.',
      'Start by reading any prior investigation notes in comments. Confirm the reproduction steps and root-cause hypotheses still match what you can observe now. If the behavior has changed since investigation, note it and re-verify before proposing a fix.',
      'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.',
      'Investigation process:',
      '1. Reproduce the issue (document exact steps)',
      '2. Identify likely causes:',
      '   - Run `git log --oneline -15 -- <affected file(s)>` and read recent commits; if 3+ commits touch the same file, that signals tight coupling or fragile code',
      '   - Check `git log --all --grep="<keyword from bug description>"` to see if this was fixed before (if no results, widen the keyword or skip — absence of results doesn\'t mean no prior fix)',
      '   - Examine the affected code paths for tight coupling or unusual patterns',
      '3. Debug systematically (add logging, trace execution)',
      '4. Propose fix with minimal scope',
      '5. Verify fix doesn\'t introduce regressions',
      '**When fixed**: Remove the `bug` label in Linear'
    ].join('\n');
    assert.ok(
      result.prompt.includes(expectedGoalBlock),
      'bug template Goal block must match snapshot byte-for-byte'
    );
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
    labels: [],
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

  test('returns plan as name', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.strictEqual(result.name, 'plan');
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

  test('includes planning content without implementation phase', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Files to modify or create'));
    assert.ok(result.prompt.includes('Testing approach'));
    assert.ok(!result.prompt.includes('Phase 2: Implementation'), 'Should not include implementation phase');
    assert.ok(!result.prompt.includes('Implement changes incrementally'), 'Should not include implementation instructions');
  });

  test('includes scope assessment section with session-fit question', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Scope Assessment'));
    assert.ok(result.prompt.includes('surfaces'));
    assert.ok(result.prompt.includes('fits one session'));
    assert.ok(result.prompt.includes('needs multiple sessions'));
  });

  test('includes subtask summary when subtasks present', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('**Subtasks:**'));
    assert.ok(result.prompt.includes('0/1 done'));
    assert.ok(result.prompt.includes('Next: TEST-C1'));
  });

  test('uses planning role, not implementation role', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('technical planner'));
    assert.ok(!result.prompt.includes('implementation engineer'));
  });

  test('includes if blocked section', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## If Blocked'));
  });

  test('includes preparing label removal instruction when issue has preparing label', () => {
    const issueWithPreparing = {
      ...mockIssue,
      labels: ['preparing']
    };
    const result = generatePrompt('plan', issueWithPreparing, mockContext);
    assert.ok(result.prompt.includes('Label Update'));
    assert.ok(result.prompt.includes('preparing'));
    assert.ok(result.prompt.includes('Remove it'));
  });

  test('does not include preparing label removal when not present', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('Label Update'));
  });

  // LIN-279: Strategy Framing must run before Scope Assessment.
  // Reversing the order produces post-hoc justification of the cheap default.
  test('includes Strategy Framing block', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Strategy Framing'), 'plan prompt must include Strategy Framing');
  });

  test('Strategy Framing appears before Scope Assessment', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    const sfIdx = result.prompt.indexOf('Strategy Framing');
    const saIdx = result.prompt.indexOf('Scope Assessment');
    assert.notStrictEqual(sfIdx, -1, 'Strategy Framing must be present');
    assert.notStrictEqual(saIdx, -1, 'Scope Assessment must be present');
    assert.ok(sfIdx < saIdx, 'Strategy Framing must appear before Scope Assessment (ordering invariant)');
  });

  test('Strategy Framing block names cost-of-doing and cost-of-not-doing', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Cost of doing'), 'must name cost-of-doing axis');
    assert.ok(result.prompt.includes('Cost of not doing'), 'must name cost-of-not-doing axis');
  });

  test('Strategy Framing block instructs naming routed-around contract gap', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    // The block must instruct the consumer to NAME the gap (identifier or "none identified"),
    // not just to describe it in prose. A bare description silently reintroduces the failure mode.
    assert.ok(result.prompt.includes('NAME the routed-around contract gap'), 'must instruct naming the gap');
    assert.ok(result.prompt.includes('none identified'), 'must allow "none identified" as an explicit alternative');
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

  test('returns code review as name', () => {
    const result = generatePrompt('code-review', mockIssue, mockContext);
    assert.strictEqual(result.name, 'code review');
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

  test('includes review checklist', () => {
    const result = generatePrompt('code-review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Review checklist'));
    assert.ok(result.prompt.includes('Tests cover'));
    assert.ok(result.prompt.includes('security vulnerabilities'));
  });
});

// =============================================================================
// look-into Template Tests
// =============================================================================

describe('look-into template', () => {
  const mockIssue = {
    id: 'issue-lookin',
    identifier: 'TEST-L1',
    title: 'Investigate performance issue',
    description: 'Users reporting slow page loads',
    url: 'https://linear.app/test/issue/TEST-L1',
    state: { name: 'Backlog', type: 'backlog' },
    labels: [],
    assignee: null
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: { name: 'Performance', description: 'Performance work' },
    children: [],
    comments: []
  };

  test('returns look into as name', () => {
    const result = generatePrompt('look-into', mockIssue, mockContext);
    assert.strictEqual(result.name, 'look into');
  });

  test('has UNIVERSAL category', () => {
    const template = PROMPT_TEMPLATES['look-into'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.UNIVERSAL);
  });

  test('includes goal with overview concepts', () => {
    const result = generatePrompt('look-into', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('overview'));
    assert.ok(result.prompt.includes('Recommended next action'));
  });

  test('does NOT include status change instruction (read-only template)', () => {
    const result = generatePrompt('look-into', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('status to "In Progress"'), 'look-into should not change status');
  });

  test('includes inform-only workflow instructions (no Linear updates)', () => {
    const result = generatePrompt('look-into', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Fetch details'), 'should include fetch step');
    assert.ok(result.prompt.includes('Present your findings to the user'), 'should present findings to user');
    assert.ok(!result.prompt.includes('Add findings as a comment'), 'should NOT write back to Linear');
  });
});

// =============================================================================
// retro Template Tests
// =============================================================================

describe('retro template', () => {
  const mockIssue = {
    id: 'issue-retro',
    identifier: 'TEST-R1',
    title: 'Add export feature',
    description: 'Let users export their data',
    url: 'https://linear.app/test/issue/TEST-R1',
    state: { name: 'Done', type: 'completed' },
    labels: [],
    assignee: null
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: { name: 'Product', description: 'Product work' },
    children: [],
    comments: []
  };

  test('returns retro as name', () => {
    const result = generatePrompt('retro', mockIssue, mockContext);
    assert.strictEqual(result.name, 'retro');
  });

  test('has UNIVERSAL category', () => {
    const template = PROMPT_TEMPLATES['retro'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.UNIVERSAL);
  });

  test('does NOT include status change instruction (read-only template)', () => {
    const result = generatePrompt('retro', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('status to "In Progress"'), 'retro should not change status');
  });

  test('writes findings back as a comment', () => {
    const result = generatePrompt('retro', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Add findings as a comment'), 'should post retro as a comment');
  });

  test('instructs reconstruction from git and Linear history', () => {
    const result = generatePrompt('retro', mockIssue, mockContext);
    assert.ok(result.prompt.includes('git log --grep=TEST-R1'), 'should reference task commits by identifier');
    assert.ok(result.prompt.includes('Downstream'), 'should cover downstream effects');
  });

  test('includes goal with retrospective concepts', () => {
    const result = generatePrompt('retro', mockIssue, mockContext);
    assert.ok(result.prompt.includes('## Goal'));
    assert.ok(result.prompt.includes('hindsight'));
    assert.ok(result.prompt.includes('Lessons'));
  });
});

// =============================================================================
// triage Template Tests
// =============================================================================

describe('triage template', () => {
  const mockIssue = {
    id: 'issue-triage',
    identifier: 'TEST-T1',
    title: 'New feature request',
    description: 'User wants dark mode',
    url: 'https://linear.app/test/issue/TEST-T1',
    state: { name: 'Triage', type: 'triage' },
    labels: [],
    assignee: null,
    priority: 2
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: null,
    children: [],
    comments: []
  };

  test('returns triage as name', () => {
    const result = generatePrompt('triage', mockIssue, mockContext);
    assert.strictEqual(result.name, 'triage');
  });

  test('has UNIVERSAL category', () => {
    const template = PROMPT_TEMPLATES['triage'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.UNIVERSAL);
  });

  test('includes label selection guide with 3 labels', () => {
    const result = generatePrompt('triage', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Label Selection Guide'));
    assert.ok(result.prompt.includes('preparing'));
    assert.ok(result.prompt.includes('blocked'));
    assert.ok(result.prompt.includes('bug'));
  });
});

// =============================================================================
// context Template Tests
// =============================================================================

describe('context template', () => {
  const mockIssue = {
    id: 'issue-context',
    identifier: 'TEST-CTX1',
    title: 'Feature implementation in progress',
    description: 'User profile feature work',
    url: 'https://linear.app/test/issue/TEST-CTX1',
    state: { name: 'In Progress', type: 'started' },
    labels: [],
    assignee: { name: 'Alice' }
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: { name: 'User Features', description: 'User-related features' },
    children: [],
    comments: []
  };

  test('returns context as name', () => {
    const result = generatePrompt('context', mockIssue, mockContext);
    assert.strictEqual(result.name, 'context');
  });

  test('has UNIVERSAL category', () => {
    const template = PROMPT_TEMPLATES['context'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.UNIVERSAL);
  });

  test('does NOT include status change instruction (read-only template)', () => {
    const result = generatePrompt('context', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('status to "In Progress"'), 'context should not change status');
  });

  test('includes read-only workflow instructions', () => {
    const result = generatePrompt('context', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Fetch details'), 'should include fetch step');
    assert.ok(result.prompt.includes('Add findings as a comment'), 'should include comment step');
  });
});

// =============================================================================
// review Template Tests
// =============================================================================

describe('review template', () => {
  const mockIssue = {
    id: 'issue-review',
    identifier: 'TEST-REV1',
    title: 'Completed feature for review',
    description: 'Feature ready for final review',
    url: 'https://linear.app/test/issue/TEST-REV1',
    state: { name: 'In Progress', type: 'started' },
    labels: [],
    assignee: { name: 'Bob' }
  };

  const mockContext = {
    parent: null,
    siblings: [],
    project: { name: 'Product', description: 'Product features' },
    children: [],
    comments: []
  };

  test('returns review as name', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.strictEqual(result.name, 'review');
  });

  test('has UNIVERSAL category', () => {
    const template = PROMPT_TEMPLATES['review'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.UNIVERSAL);
  });

  test('does NOT include status change instruction (read-only template)', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('status to "In Progress"'), 'review should not change status');
  });

  test('includes read-only workflow instructions', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Fetch details'), 'should include fetch step');
    assert.ok(result.prompt.includes('Add findings as a comment'), 'should include comment step');
  });

  test('includes Test Quality Check sub-section', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('### Test Quality Check'), 'should include Test Quality Check section header');
  });

  test('Test Quality Check names e2e/integration and a checklist item locks the wording', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('e2e'), 'should reference e2e in test-level guidance');
    assert.ok(
      result.prompt.includes('Tests exist at the appropriate level (e2e/integration for cross-module or user-facing behavior, not only unit tests)'),
      'should include the new Review Checklist item phrase verbatim'
    );
  });

  test('Test Quality Check is positioned between Gap Analysis and Review Checklist', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    const gapIdx = result.prompt.indexOf('### Gap Analysis');
    const testIdx = result.prompt.indexOf('### Test Quality Check');
    const checklistIdx = result.prompt.indexOf('### Review Checklist');
    assert.ok(gapIdx !== -1, 'Gap Analysis section exists');
    assert.ok(testIdx !== -1, 'Test Quality Check section exists');
    assert.ok(checklistIdx !== -1, 'Review Checklist section exists');
    assert.ok(gapIdx < testIdx, 'Gap Analysis comes before Test Quality Check');
    assert.ok(testIdx < checklistIdx, 'Test Quality Check comes before Review Checklist');
  });

  test('review completion signals include test-level coverage', () => {
    const reviewSignal = COMPLETION_SIGNALS['review'];
    assert.ok(reviewSignal, 'review completion signal is defined');
    assert.ok(
      reviewSignal.signals.includes('Tests exist at appropriate level (e2e/integration where needed)'),
      'review signals array includes the new test-level coverage signal'
    );
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

  test('returns universal prompts for all issues', () => {
    const issue = {
      state: { type: 'backlog' },
      labels: { nodes: [] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(available.includes('look-into'), 'Should include look-into');
    assert.ok(available.includes('triage'), 'Should include triage');
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

  test('does not return plan or code-review when preparing label present', () => {
    const issue = {
      state: { type: 'backlog' },
      labels: { nodes: [{ name: 'preparing' }] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(!available.includes('plan'), 'Should not include plan when preparing present');
    assert.ok(!available.includes('code-review'), 'Should not include code-review when preparing present');
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
// getPromptDescriptionsForAI Tests
// =============================================================================

describe('getPromptDescriptionsForAI', () => {
  test('returns array of prompt descriptions', () => {
    const keys = ['blocked', 'plan'];
    const descriptions = getPromptDescriptionsForAI(keys);
    assert.ok(Array.isArray(descriptions));
    assert.strictEqual(descriptions.length, 2);
  });

  test('each description has key, name, description, and category', () => {
    const keys = ['blocked'];
    const descriptions = getPromptDescriptionsForAI(keys);
    const desc = descriptions[0];
    assert.strictEqual(desc.key, 'blocked');
    assert.strictEqual(desc.name, 'blocked');
    assert.ok(typeof desc.description === 'string');
    assert.ok(desc.description.length > 0);
    assert.strictEqual(desc.category, PROMPT_CATEGORIES.WORK_ISSUE);
  });

  test('filters out unknown keys', () => {
    const keys = ['blocked', 'unknown-label', 'plan'];
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
