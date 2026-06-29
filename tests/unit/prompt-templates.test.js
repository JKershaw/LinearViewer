/**
 * Unit tests for prompt-templates.js
 *
 * Run with: node --test tests/unit/prompt-templates.test.js
 *
 * Tests the workflow label system:
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 *
 * Plus virtual prompts: plan, look-into, triage
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasPrompt, getPromptLabels, generatePrompt, getAvailablePrompts, getPromptDescriptionsForAI, PROMPT_TEMPLATES, PROMPT_CATEGORIES, formatAIHintsForMetaPrompt, RECOMMEND_META_ACTIONS, DISPATCH_KINDS, isValidDispatchKind, deriveDispatchKind } from '../../lib/prompt-templates.js';
import { WORK_ISSUE_LABELS } from '../../lib/workflow-config.js';
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

  test('returns false for code-review (consolidated into review — LIN-523)', () => {
    assert.strictEqual(hasPrompt('code-review'), false);
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
    assert.ok(labels.includes('close-out'));
    assert.ok(labels.includes('retro'));
  });

  test('has exactly 15 templates', () => {
    const labels = getPromptLabels();
    assert.strictEqual(labels.length, 15);
  });
});

// =============================================================================
// Recommend-meta actions: `defer` (LIN-327)
// =============================================================================

describe('defer recommend-meta action', () => {
  test('defer is NOT a prompt template (no generate() body)', () => {
    // The no-body cost contract is structural: defer has no PROMPT_TEMPLATES entry,
    // so it cannot produce a prompt and cannot inflate the template count.
    assert.ok(!('defer' in PROMPT_TEMPLATES), 'defer must not be a prompt template');
    assert.strictEqual(getPromptLabels().length, 15, 'defer must not change the template count');
  });

  test('defer is registered in RECOMMEND_META_ACTIONS and the dispatch vocabulary', () => {
    assert.ok(RECOMMEND_META_ACTIONS.includes('defer'));
    assert.ok(DISPATCH_KINDS.includes('defer'), 'defer must be a valid dispatch kind');
    assert.strictEqual(isValidDispatchKind('defer'), true);
  });

  test('deriveDispatchKind resolves defer to itself, not the custom fallback', () => {
    assert.strictEqual(deriveDispatchKind('defer'), 'defer');
    assert.strictEqual(deriveDispatchKind('DEFER'), 'defer');
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

  test('references discussion by pointer instead of embedding comment bodies', () => {
    const contextWithComments = {
      ...mockContext,
      comments: [
        { body: 'First comment with research findings', user: 'Alice', createdAt: '2024-01-15T10:00:00Z' },
        { body: 'Follow-up discussion', user: 'Bob', createdAt: '2024-01-16T14:30:00Z' }
      ]
    };

    const result = generatePrompt('blocked', mockIssue, contextWithComments);
    // Pass-by-reference: the prompt points at the task's discussion rather than
    // baking the comment thread in verbatim (keeps prompts short for long-lived
    // tasks; the agent reads live content). So the comment bodies/authors must
    // NOT appear, and the reference directive must.
    assert.ok(!result.prompt.includes('First comment with research findings'),
      'comment bodies must not be embedded verbatim');
    assert.ok(!result.prompt.includes('Alice'),
      'comment authors must not be embedded verbatim');
    assert.ok(result.prompt.includes('read the current description and comment thread'),
      'prompt must reference the task discussion instead of embedding it');
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

  test('has UNIVERSAL category (LIN-357: no longer label-triggered)', () => {
    const template = PROMPT_TEMPLATES['blocked'];
    assert.strictEqual(template.category, PROMPT_CATEGORIES.UNIVERSAL);
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
      '2. Validate the acceptance witness: confirm the signal you will call "fixed" (the failing test, log line, assertion, or observable behavior) actually tracks the real outcome. A witness that can read green while the outcome is still wrong (or red while it is already right) must be validated or replaced before you optimize against it. A witness that genuinely tracks the outcome is a valid answer — state it explicitly.',
      '3. Identify likely causes:',
      '   - Run `git log --oneline -15 -- <affected file(s)>` and read recent commits; if 3+ commits touch the same file, that signals tight coupling or fragile code',
      '   - Check `git log --all --grep="<keyword from bug description>"` to see if this was fixed before (if no results, widen the keyword or skip — absence of results doesn\'t mean no prior fix)',
      '   - Search wider than nearby code: look for prior investigations or runs of the same subsystem, and prior diverging episodes — seed from both the technical lead and the meta-pattern ("this class of bug, last time the decisive experiment was X"), not only related fixes',
      '   - Examine the affected code paths for tight coupling or unusual patterns',
      '4. Debug systematically (add logging, trace execution)',
      '5. Confirm the cause before building the fix: name the single decisive experiment that disambiguates the leading hypothesis from its rivals, and run it. Evidence the cause is confirmed — not merely plausible — is required before you propose or hand off a fix. An investigation that proposes a fix while stating the decisive experiment was not run is NOT done; a genuinely confirmed cause is a valid answer and must be stated explicitly.',
      '6. Widen the model — isolated, or one of a class? Once the root cause is in hand, check whether the same pattern produces siblings: search for the pattern itself (the failure mode, a shared helper, a parallel code path), not only the symptom the ticket cites. A genuinely isolated issue is a valid answer — state it explicitly.',
      '7. Propose fix with minimal scope. If step 6 found a class, the fix stays minimal — name the class and list the unhandled instances in your findings comment instead of silently widening the fix.',
      '8. Verify fix doesn\'t introduce regressions',
      '**When fixed**: Leave the `bug` label in place — moving the task to Done marks it resolved. The label is the lasting record that this was a bug (used by reports and prioritization), so do not remove it.'
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

  test('does not include preparing label removal instruction', () => {
    const issueWithPreparing = {
      ...mockIssue,
      labels: ['preparing']
    };
    const result = generatePrompt('plan', issueWithPreparing, mockContext);
    // The preparing label may still appear as data in the Labels section,
    // but the "remove the preparing label" instruction must be gone.
    assert.ok(!result.prompt.includes('Label Update'));
    assert.ok(!result.prompt.includes('Remove it in Linear'));
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

  // Completeness check: the surface list must be verified complete, not just correct.
  // Guards the breadth failure — the same concept implemented in more than one place
  // under a different name, where a clean search for the cited symbol looks like proof
  // of completeness but is not.
  test('includes a Completeness check on the surface list', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Completeness check'), 'plan prompt must include a Completeness check');
    assert.ok(
      result.prompt.includes('not proof of completeness'),
      'must warn that a clean search for the cited symbol is not proof of completeness'
    );
  });

  test('Completeness check follows surface enumeration and precedes the session-fit question', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    const listIdx = result.prompt.indexOf('List the surfaces your plan touches');
    const compIdx = result.prompt.indexOf('Completeness check');
    const fitIdx = result.prompt.indexOf('does this fit one focused session');
    assert.ok(listIdx !== -1 && compIdx !== -1 && fitIdx !== -1, 'all three anchors must be present');
    assert.ok(listIdx < compIdx, 'Completeness check must follow surface enumeration');
    assert.ok(compIdx < fitIdx, 'Completeness check must precede the session-fit question');
  });

  test('Completeness check does not misfire on genuinely single-surface work', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(
      result.prompt.includes('single-surface change is a valid result'),
      'must explicitly allow a single-surface result so scope is a decision, not invented breadth'
    );
  });
});

// =============================================================================
// code-review consolidation into review (LIN-523)
// =============================================================================

describe('code-review consolidated into review (LIN-523)', () => {
  const mockIssue = {
    id: 'issue-review',
    identifier: 'TEST-CR1',
    title: 'Refactor authentication module',
    description: 'Extract auth logic into separate service for better testability',
    url: 'https://linear.app/test/issue/TEST-CR1',
    state: { name: 'In Progress', type: 'started' },
    labels: ['review'],
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

  test('code-review template no longer exists', () => {
    assert.strictEqual(PROMPT_TEMPLATES['code-review'], undefined);
    assert.strictEqual(generatePrompt('code-review', mockIssue, mockContext), null);
  });

  test('review carries the folded-in verdict and quality checklist items', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    // Explicit verdict (was code-review's distinctive output)
    assert.ok(result.prompt.includes('Approve'));
    assert.ok(result.prompt.includes('Request Changes'));
    assert.ok(result.prompt.includes('Needs Discussion'));
    // code-review's distinctive checklist items now live in review
    assert.ok(result.prompt.includes('security vulnerabilities'));
    assert.ok(result.prompt.includes('Code style consistent'));
    assert.ok(result.prompt.includes('performance regressions'));
  });

  test('review does not instruct merge or Done (close-out split at the merge line)', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.ok(result.prompt.includes('does NOT merge') || result.prompt.includes('not merge'));
    assert.ok(result.prompt.includes('Do NOT mark this task Done') || result.prompt.includes('Do NOT mark the task Done'));
  });
});

// =============================================================================
// Terminal-state note — handwritten path (LIN-353, both-paths mirror)
// =============================================================================

describe('generatePrompt terminal-state note (LIN-353)', () => {
  const baseIssue = {
    id: 'issue-done', identifier: 'TEST-DONE', title: 'Finished work',
    description: 'Some work', url: 'https://linear.app/test/issue/TEST-DONE',
    labels: [], createdAt: '2026-01-01T00:00:00.000Z'
  };
  const baseContext = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  test('a Done leaf (no open children) gets the "Task Already Complete" note steering to review/close', () => {
    const issue = { ...baseIssue, state: { name: 'Done', type: 'completed' } };
    const result = generatePrompt('review', issue, baseContext);
    assert.ok(/Task Already Complete/i.test(result.prompt), 'the terminal note must be present');
    assert.ok(/review\/verification pass|verify the finished work|holds up/i.test(result.prompt),
      'it must steer toward verify/close, not redo');
  });

  test('canceled and duplicate leaves also get the note (all terminal states)', () => {
    for (const [name, type] of [['Canceled', 'canceled'], ['Duplicate', 'duplicate']]) {
      const issue = { ...baseIssue, state: { name, type } };
      const result = generatePrompt('review', issue, baseContext);
      assert.ok(/Task Already Complete/i.test(result.prompt), `terminal note must be present for ${type}`);
    }
  });

  test('a Done parent WITH an open child does NOT get the note (Scenario J — live work remains)', () => {
    const issue = { ...baseIssue, state: { name: 'Done', type: 'completed' } };
    const context = {
      ...baseContext,
      children: [
        { identifier: 'TEST-C1', state: { name: 'Done', type: 'completed' } },
        { identifier: 'TEST-C2', state: { name: 'Todo', type: 'unstarted' } }
      ]
    };
    const result = generatePrompt('review', issue, context);
    assert.ok(!/Task Already Complete/i.test(result.prompt), 'a terminal parent with open children is not short-circuited');
  });

  test('a non-terminal task does NOT get the note', () => {
    const issue = { ...baseIssue, state: { name: 'In Progress', type: 'started' } };
    const result = generatePrompt('review', issue, baseContext);
    assert.ok(!/Task Already Complete/i.test(result.prompt), 'open tasks must not see the terminal note');
  });
});

describe('generatePrompt all-subtasks-complete note (LIN-364)', () => {
  const baseIssue = {
    id: 'issue-open', identifier: 'TEST-OPEN', title: 'Open parent',
    description: 'Parent work', url: 'https://linear.app/test/issue/TEST-OPEN',
    labels: [], createdAt: '2026-01-01T00:00:00.000Z'
  };
  const baseContext = { parent: null, siblings: [], project: { name: 'P' }, comments: [] };

  test('an OPEN parent whose every child is terminal gets the "All Subtasks Complete" note steering to review/close', () => {
    const issue = { ...baseIssue, state: { name: 'In Progress', type: 'started' } };
    const context = {
      ...baseContext,
      children: [
        { identifier: 'TEST-C1', state: { name: 'Done', type: 'completed' } },
        { identifier: 'TEST-C2', state: { name: 'Done', type: 'completed' } }
      ]
    };
    const result = generatePrompt('review', issue, context);
    assert.ok(/All Subtasks Complete/i.test(result.prompt), 'the all-complete note must be present');
    assert.ok(/review\/verification pass|close it out|add up to this task/i.test(result.prompt),
      'it must steer toward review/close, not defer');
  });

  test('canceled and duplicate children also count as complete (all terminal states)', () => {
    const issue = { ...baseIssue, state: { name: 'Todo', type: 'unstarted' } };
    const context = {
      ...baseContext,
      children: [
        { identifier: 'TEST-C1', state: { name: 'Canceled', type: 'canceled' } },
        { identifier: 'TEST-C2', state: { name: 'Duplicate', type: 'duplicate' } }
      ]
    };
    const result = generatePrompt('review', issue, context);
    assert.ok(/All Subtasks Complete/i.test(result.prompt), 'mixed terminal children still trigger the note');
  });

  test('an open parent with at least one open child does NOT get the note (live work remains)', () => {
    const issue = { ...baseIssue, state: { name: 'In Progress', type: 'started' } };
    const context = {
      ...baseContext,
      children: [
        { identifier: 'TEST-C1', state: { name: 'Done', type: 'completed' } },
        { identifier: 'TEST-C2', state: { name: 'Todo', type: 'unstarted' } }
      ]
    };
    const result = generatePrompt('review', issue, context);
    assert.ok(!/All Subtasks Complete/i.test(result.prompt), 'a parent with an open child must not be short-circuited');
  });

  test('an open LEAF (no children) does NOT get the note', () => {
    const issue = { ...baseIssue, state: { name: 'In Progress', type: 'started' } };
    const result = generatePrompt('review', issue, { ...baseContext, children: [] });
    assert.ok(!/All Subtasks Complete/i.test(result.prompt), 'a leaf has no subtasks to be complete');
  });

  test('a TERMINAL parent with all children done gets the terminal note, NOT the all-complete note (mutually exclusive)', () => {
    const issue = { ...baseIssue, state: { name: 'Done', type: 'completed' } };
    const context = {
      ...baseContext,
      children: [{ identifier: 'TEST-C1', state: { name: 'Done', type: 'completed' } }]
    };
    const result = generatePrompt('review', issue, context);
    assert.ok(/Task Already Complete/i.test(result.prompt), 'a terminal parent gets the terminal note');
    assert.ok(!/All Subtasks Complete/i.test(result.prompt), 'and NOT the non-terminal all-complete note');
  });
});

describe('generatePrompt bug-already-investigated note (LIN-366)', () => {
  const baseIssue = {
    id: 'issue-bug', identifier: 'TEST-BUG', title: 'Flaky thing',
    description: 'Something misbehaves', url: 'https://linear.app/test/issue/TEST-BUG',
    state: { name: 'In Progress', type: 'started' }, createdAt: '2026-01-01T00:00:00.000Z',
    labels: ['bug']
  };
  const withComments = {
    parent: null, siblings: [], project: { name: 'P' }, children: [],
    comments: [{ body: '## Investigation findings: root cause is X, fix is Y', user: 'Dev', createdAt: '2026-01-02T00:00:00.000Z' }]
  };
  const noComments = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  test('a bug issue WITH prior comments gets the "Don\'t Loop" note steering to the fix', () => {
    const result = generatePrompt('bug', baseIssue, withComments);
    assert.ok(/Prior Investigation On Record/i.test(result.prompt), 'the bug-investigated note must be present');
    assert.ok(/do NOT.*investigate again|investigation is DONE|move to implementing the fix/i.test(result.prompt),
      'it must steer toward the fix, not re-investigation');
  });

  test('a bug issue with NO comments does NOT get the note (nothing investigated yet)', () => {
    const result = generatePrompt('bug', baseIssue, noComments);
    assert.ok(!/Prior Investigation On Record/i.test(result.prompt), 'a fresh bug has no prior investigation to skip');
  });

  test('a non-bug issue with comments does NOT get the note (label is the trigger)', () => {
    const issue = { ...baseIssue, labels: [] };
    const result = generatePrompt('look-into', issue, withComments);
    assert.ok(!/Prior Investigation On Record/i.test(result.prompt), 'only bug-labelled tasks get the note');
  });
});

// =============================================================================
// Class check — widen the model, don't patch the witness (LIN-313)
// =============================================================================
// A narrowly-worded task gets diligently completed in isolation, then the parent
// hits the next instance of the same class. Bug and review prompts must ask the
// class question (isolated, or one of a class?) without expanding their own scope
// — instances are named and recorded, not silently fixed.

describe('class check — isolated or one of a class (LIN-313)', () => {
  const bugIssue = {
    id: 'issue-bug-class', identifier: 'TEST-BC1', title: 'process.foo missing',
    description: 'Runtime crashes on process.foo', url: 'https://linear.app/test/issue/TEST-BC1',
    state: { name: 'In Progress', type: 'started' }, createdAt: '2026-01-01T00:00:00.000Z',
    labels: ['bug']
  };
  const reviewIssue = {
    id: 'issue-rev-class', identifier: 'TEST-RC1', title: 'Verify fix',
    description: 'Review the landed fix', url: 'https://linear.app/test/issue/TEST-RC1',
    state: { name: 'In Progress', type: 'started' }, createdAt: '2026-01-01T00:00:00.000Z',
    labels: []
  };
  const ctx = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  test('bug template asks the class question after root cause is in hand', () => {
    const result = generatePrompt('bug', bugIssue, ctx);
    assert.ok(/isolated, or one of a class/i.test(result.prompt), 'bug prompt must ask isolated-or-class');
    assert.ok(/search for the pattern itself/i.test(result.prompt), 'must search the pattern, not only the cited symptom');
  });

  test('bug class check keeps the fix minimal — instances recorded, not silently fixed', () => {
    const result = generatePrompt('bug', bugIssue, ctx);
    assert.ok(/the fix stays minimal/i.test(result.prompt), 'a found class must not widen the fix');
    assert.ok(/list the unhandled instances/i.test(result.prompt), 'unhandled instances must be recorded');
  });

  test('bug class check guards against manufactured work (isolated is a valid answer)', () => {
    const result = generatePrompt('bug', bugIssue, ctx);
    assert.ok(/genuinely isolated issue is a valid answer/i.test(result.prompt),
      'an isolated result must be explicitly valid');
  });

  test('review template includes the class-check section before close-out', () => {
    const result = generatePrompt('review', reviewIssue, ctx);
    assert.ok(/### Isolated, or One of a Class\?/.test(result.prompt), 'review prompt must carry the class-check section');
    assert.ok(/do not expand this task to fix them/i.test(result.prompt), 'siblings become a finding, not new scope');
    assert.ok(/genuinely isolated change is a valid result/i.test(result.prompt),
      'an isolated result must be explicitly valid');
  });

  test('review checklist carries the class-check item', () => {
    const result = generatePrompt('review', reviewIssue, ctx);
    assert.ok(result.prompt.includes('- [ ] Class check answered: isolated, or class named with unhandled instances listed'),
      'checklist must include the class-check line');
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

  test('presents findings to the user without auto-saving them', () => {
    const result = generatePrompt('retro', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Present your findings to the user'), 'should present findings to the user');
    assert.ok(!result.prompt.includes('Add findings as a comment'), 'should NOT auto-post a comment');
    assert.ok(result.prompt.includes('Do not write them back to Linear'), 'should leave next steps to the user');
  });

  test('handles both completed and in-flight work', () => {
    const result = generatePrompt('retro', mockIssue, mockContext);
    assert.ok(result.prompt.includes('in-flight') || result.prompt.includes('in-progress'),
      'should cover in-progress retros');
    assert.ok(result.prompt.includes('risk'), 'in-flight retros should flag risks instead of downstream effects');
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

  test('is excluded from the AI recommendation meta-prompt (user-initiated only)', () => {
    const hints = formatAIHintsForMetaPrompt();
    assert.ok(!hints.includes('reorient'),
      'retro aiHint should not appear in the meta-prompt');
    assert.ok(!/\*\*retro\*\*/.test(hints), 'retro should not be listed as an action type');
    // Sanity check: other prompts still flow into the meta-prompt
    assert.ok(hints.includes('research') || hints.includes('plan'),
      'other prompts should still be present in the meta-prompt');
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

  test('includes label selection guide with work-issue labels', () => {
    const result = generatePrompt('triage', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Label Selection Guide'));
    assert.ok(result.prompt.includes('blocked'));
    assert.ok(result.prompt.includes('bug'));
    assert.ok(!result.prompt.includes('preparing'));
  });

  // LIN-734: triage must account for project selection, not only labels/priority/state.
  test('instructs the agent to confirm and fix the project', () => {
    const result = generatePrompt('triage', mockIssue, mockContext);
    assert.ok(/\*\*Project\*\*/.test(result.prompt), 'should list Project under metadata');
    assert.ok(/correct project/i.test(result.prompt), 'should ask whether the task is in the correct project');
    assert.ok(/move or assign/i.test(result.prompt), 'should instruct moving/assigning mis-filed tasks');
  });

  test('triage completion signals include project correctness', () => {
    assert.ok(
      COMPLETION_SIGNALS['triage'].signals.some(s => /correct project/i.test(s)),
      'triage readiness should account for project, not just labels/priority/state'
    );
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

  // LIN-550: review is the ledger WRITER. Its body carries the `### What CI Did Not Prove`
  // ledger (after Manual Verification, before Verdict) and a `### Hand Off to Close-Out`
  // section (after Verdict, before Completion). Review no longer owns the merge.
  test('review body carries the ledger then hands off to close-out (LIN-550 ordering)', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    const manualIdx = result.prompt.indexOf('### Manual Verification');
    const ledgerIdx = result.prompt.indexOf('### What CI Did Not Prove');
    const verdictIdx = result.prompt.indexOf('### Verdict');
    const handoffIdx = result.prompt.indexOf('### Hand Off to Close-Out');
    const completionIdx = result.prompt.indexOf('### Completion');
    assert.ok(ledgerIdx !== -1, 'ledger section exists');
    assert.ok(handoffIdx !== -1, 'hand-off section exists');
    assert.ok(manualIdx !== -1 && manualIdx < ledgerIdx, 'ledger comes after Manual Verification');
    assert.ok(ledgerIdx < verdictIdx, 'ledger comes before the Verdict');
    assert.ok(verdictIdx < handoffIdx, 'hand-off comes after the Verdict');
    assert.ok(completionIdx !== -1 && handoffIdx < completionIdx, 'hand-off comes before Completion');
    // The old fused gate section is gone.
    assert.ok(!result.prompt.includes('### Close-Out Gate'), 'the old fused Close-Out Gate section is removed');
  });

  // LIN-550: review is WRITE-ONLY. It writes the ledger + a conditional verdict and hands
  // the merge / Done / follow-up filing to the close-out step — it never performs them.
  test('review is write-only: ledger + conditional verdict, hands off (does not merge/Done)', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.ok(/Review is write-only/i.test(result.prompt), 'states review is write-only');
    assert.ok(/CI is green on the PR/i.test(result.prompt), 'confirms CI green on the PR');
    assert.ok(/does NOT merge, does NOT mark the task Done, and does NOT file the close-out follow-ups/i.test(result.prompt),
      'review does not merge, mark Done, or file close-out follow-ups');
    assert.ok(/Approve — conditional on close-out discharging the ledger/i.test(result.prompt),
      'a non-empty ledger forces a conditional approval');
    assert.ok(/hand off to `close-out`/i.test(result.prompt), 'hands off to the close-out step');
    // The retired "merger owns it" framing must be gone.
    assert.ok(!/belong to whoever merges/i.test(result.prompt) && !/belong to the merger/i.test(result.prompt),
      'no longer hands to an undefined merger');
  });

  test('review concludes with an explicit verdict (folded in from code-review)', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.ok(/### Verdict/i.test(result.prompt), 'has a Verdict section');
    assert.ok(/Approve.*Request Changes.*Needs Discussion/s.test(result.prompt), 'lists the three verdicts');
  });

  test('Close-Out Gate cannot-close branch files a `blocks` ticket and routes to it, not another review', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.ok(/cannot-close branch/i.test(result.prompt), 'names the cannot-close branch');
    assert.ok(/do NOT loop back into another `review`/i.test(result.prompt), 'forbids looping back to review');
    assert.ok(/as a `blocks` relation on the current task/i.test(result.prompt), 'files/links the blocker as `blocks`');
    assert.ok(/A `blocks` relation does not make the engine descend/i.test(result.prompt),
      'next action must be named explicitly because `blocks` does not drive descent');
    assert.ok(/closes only once the blocker is resolved and CI is green/i.test(result.prompt),
      'original closes only after blocker resolves and CI green');
    assert.ok(/distinct from a plan-phase prerequisite-refactor subtask/i.test(result.prompt),
      'closure blocker kept distinct from plan refactor-subtask');
  });

  test('review completion signals reflect verdict-based, pre-merge close-out (LIN-523)', () => {
    const reviewSignal = COMPLETION_SIGNALS['review'];
    assert.ok(
      reviewSignal.signals.some(s => /explicit verdict issued/i.test(s)),
      'signals include an explicit verdict'
    );
    assert.ok(
      reviewSignal.signals.some(s => /CI\/CD pipeline green on the PR/i.test(s)),
      'signals include CI green on the PR'
    );
    assert.ok(
      reviewSignal.signals.some(s => /closure blocker filed\/linked as `blocks`/i.test(s)),
      'signals include the blocker-filed-and-routed close-out outcome'
    );
    // The retired post-merge signals must be gone
    assert.ok(
      !reviewSignal.signals.some(s => /merged state verified/i.test(s)),
      'no longer claims to verify a merge'
    );
  });
});

// =============================================================================
// getAvailablePrompts Tests
// =============================================================================

describe('getAvailablePrompts', () => {
  test('returns plan (and never the retired code-review) for eligible backlog issue', () => {
    const issue = {
      state: { type: 'backlog' },
      labels: { nodes: [] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(available.includes('plan'), 'Should include plan');
    assert.ok(!available.includes('code-review'), 'code-review was consolidated into review (LIN-523)');
    // review is universal, so it is always offered
    assert.ok(available.includes('review'), 'Should include review (the single quality gate)');
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

  test('returns plan and review for completed issue (state as signal, not gate — LIN-353)', () => {
    const issue = {
      state: { type: 'completed' },
      labels: { nodes: [] }
    };
    const available = getAvailablePrompts(issue);
    // Terminal state no longer hard-excludes review/plan; it shapes the recommendation
    // (formatTerminalStateNote / meta-prompt Step 0) rather than removing the option.
    assert.ok(available.includes('review'), 'Should include review on a Done ticket');
    assert.ok(available.includes('plan'), 'Should include plan on a Done ticket');
    assert.ok(!available.includes('code-review'), 'code-review retired (LIN-523)');
  });

  test('returns plan and review for canceled and duplicate issues (all terminal states — LIN-353)', () => {
    for (const type of ['canceled', 'duplicate']) {
      const available = getAvailablePrompts({ state: { type }, labels: { nodes: [] } });
      assert.ok(available.includes('review'), `Should include review for ${type}`);
      assert.ok(available.includes('plan'), `Should include plan for ${type}`);
    }
  });

  test('returns plan regardless of labels (no preparing gating)', () => {
    const issue = {
      state: { type: 'backlog' },
      labels: { nodes: [{ name: 'preparing' }] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(available.includes('plan'), 'Should include plan regardless of labels');
  });

  test('returns label-based prompts alongside state-based prompts', () => {
    const issue = {
      state: { type: 'started' },
      labels: { nodes: [{ name: 'bug' }] }
    };
    const available = getAvailablePrompts(issue);
    assert.ok(available.includes('bug'), 'Should include bug label prompt');
    assert.ok(available.includes('plan'), 'Should include plan');
    assert.ok(available.includes('review'), 'Should include review');
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
    assert.strictEqual(desc.category, PROMPT_CATEGORIES.UNIVERSAL);
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

// =============================================================================
// Surface Assessment necessity gate (LIN-192 origin, LIN-397 gate) — handwritten path
//
// The handwritten path must match the meta-prompt: research ends with a Surface
// Assessment gated on necessity (consumer test + who-pays test, third verdict for
// noticed-but-not-required improvements, size routed to sequencing), and plan turns
// only a necessary prerequisite refactor into a separate blocking subtask. These
// pin the gate, not just the section's presence. The mirror tests for the AI path
// live in tests/unit/openrouter.test.js.
// =============================================================================

describe('Surface Assessment (handwritten path)', () => {
  const mockIssue = {
    id: 'issue-sa',
    identifier: 'TEST-SA1',
    title: 'Add a thing',
    description: 'Add a thing to the codebase',
    url: 'https://linear.app/test/issue/TEST-SA1',
    state: { name: 'Todo', type: 'unstarted' },
    labels: []
  };
  const mockContext = { parent: null, siblings: [], project: null, children: [], comments: [] };

  test('research template ends research with a Surface Assessment', () => {
    const result = generatePrompt('research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Surface Assessment'), 'research must include Surface Assessment');
    assert.ok(result.prompt.includes('refactor required'), 'must offer the refactor-required verdict');
  });

  test('research gates the refactor verdict on necessity, not availability', () => {
    const result = generatePrompt('research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Consumer test'), 'must require citing the in-task consumer of the new seam');
    assert.ok(result.prompt.includes('Who-pays test'), 'must require a beneficiary-or-bystander accounting per touched consumer');
    assert.ok(
      result.prompt.includes('improvement noticed, not required'),
      'must offer the third verdict so noticed improvements have a non-blocking home'
    );
    assert.ok(
      result.prompt.includes('Size is not a rejection criterion'),
      'size must route to sequencing, never to worth'
    );
  });

  test('research routes the Surface Assessment into the comment so plan can read it', () => {
    const result = generatePrompt('research', mockIssue, mockContext);
    assert.ok(
      /\*\*Comment\*\*:[^\n]*Surface Assessment/.test(result.prompt),
      'Surface Assessment must be part of the comment output, not only the description'
    );
  });

  test('plan template sequences a necessary prerequisite refactor as a separate blocking subtask', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Surface Assessment'), 'plan must reference the prior Surface Assessment');
    assert.ok(result.prompt.includes('blocking subtask'), 'plan must encode a necessary prerequisite refactor as a blocking subtask');
    assert.ok(
      result.prompt.includes('do not absorb the refactor into implementation'),
      'plan must preserve the sequencing guarantee'
    );
  });

  test('plan template rejects consumer-less or bystander-taxing refactors', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(
      result.prompt.includes('refactor required'),
      'the blocking-subtask ratchet must be conditioned on the refactor-required verdict'
    );
    assert.ok(
      result.prompt.includes('no consumer in this task'),
      'plan must reject refactors with no in-task consumer'
    );
    assert.ok(
      result.prompt.includes('does not become a subtask'),
      'rejected refactors are folded inline, scoped down, or noted — never spun into subtasks'
    );
  });
});

// Audit the Layers (LIN-740, reframes Horizontal Obligations LIN-697) — research must
// enumerate EVERY layer the change touches, brief how each is done here (citing sources),
// then CLOSE the set (prove it complete). Generative, not a fixed category list (a list
// anchors and the agent skips the unnamed layer — the LIN-735/295/579 gap). Keeps the
// obligation axes as per-layer seed reasoning, the duplicate-representation Surface-
// Assessment trigger, the small-task off-ramp, and the both-paths mirror; adds the
// per-layer brief artifact, the cite-your-sources rule, and the coverage-not-speed license.
describe('Audit the Layers (handwritten path)', () => {
  const mockIssue = {
    id: 'issue-ho', identifier: 'TEST-HO1', title: 'Add a thing',
    description: 'Add a thing to the codebase', url: 'https://linear.app/test/issue/TEST-HO1',
    state: { name: 'Todo', type: 'unstarted' }, labels: []
  };
  const mockContext = { parent: null, siblings: [], project: null, children: [], comments: [] };

  test('research template asks for the change\'s horizontal obligations to the existing system', () => {
    const result = generatePrompt('research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Audit the Layers'), 'research must include the Audit the Layers block');
    assert.ok(
      result.prompt.includes('what it must hold true against'),
      'it must frame obligations as what the change must hold true against, not only what it builds'
    );
    assert.ok(
      result.prompt.includes('reuse rather than duplicate'),
      'it must name the existing-structure / reuse-don\'t-duplicate axis'
    );
    assert.ok(
      result.prompt.includes('seed examples, not the whole set'),
      'the axes must be seed examples, not a fixed exhaustive checklist'
    );
  });

  test('the audit enumerates layers, requires a per-layer brief, and cites sources', () => {
    const result = generatePrompt('research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Enumerate the layers'), 'the audit must enumerate every layer the change touches');
    assert.ok(
      result.prompt.includes('Cite a source for each claim'),
      'the audit must require a cited source per claim so the brief is verified, not assumed'
    );
    assert.ok(
      result.prompt.includes('per-layer audit') && result.prompt.includes('one brief per layer'),
      'the comment output must require a per-layer brief with sources cited'
    );
  });

  test('the audit licenses coverage over speed (the exhaustiveness trade)', () => {
    const result = generatePrompt('research', mockIssue, mockContext);
    assert.ok(
      /measured by \*coverage\*, not speed/.test(result.prompt),
      'the audit must say completion is measured by coverage, not speed'
    );
  });

  test('the audit closes the layer set rather than hunting loosely', () => {
    const result = generatePrompt('research', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Close the set'), 'the audit must end with a closure step');
    assert.ok(
      result.prompt.includes('did you NOT check') && result.prompt.includes('assert without verifying'),
      'closure must hunt unchecked layers and unverified assertions'
    );
    assert.ok(
      result.prompt.includes('show the search that would have surfaced'),
      'closure must require evidence the set is complete, not a bare claim'
    );
  });

  test('Surface Assessment treats a second representation of existing data as refactor required', () => {
    const result = generatePrompt('research', mockIssue, mockContext);
    assert.ok(
      result.prompt.includes('SECOND REPRESENTATION'),
      'Surface Assessment must catch introducing a duplicate representation of already-modelled data'
    );
    assert.ok(
      /SECOND REPRESENTATION[\s\S]*refactor required/.test(result.prompt),
      'a duplicate representation must resolve to refactor required, not lands cleanly'
    );
  });

  test('the audit blocks sit under the existing scale-to-task guard', () => {
    const result = generatePrompt('research', mockIssue, mockContext);
    // Guard names the sub-steps, and the guard precedes the blocks it governs.
    assert.ok(
      result.prompt.includes('framing/completeness/history/obligations sub-steps'),
      'the scale-to-task guard must name the obligations sub-steps so small tasks skip them'
    );
    assert.ok(
      result.prompt.indexOf('Scale this to the task') < result.prompt.indexOf('Audit the Layers'),
      'the lower-bound guard must precede the audit block it governs'
    );
  });

  // LIN-697 eval (2026-06-26): the upstream scale-to-task hint alone left gpt-5.4-mini
  // ritually filling the obligations section on a one-file typo (control fired 50%). The
  // fix is a LOCAL applicability gate at the section head — positive framing (what to do
  // on a small task + a clean off-ramp), so the gate travels with the imperative it governs.
  test('the Audit the Layers block leads with a local small-task off-ramp', () => {
    const result = generatePrompt('research', mockIssue, mockContext);
    const headerAt = result.prompt.indexOf('### Audit the Layers');
    const imperativeAt = result.prompt.indexOf('characterise not just');
    const gateAt = result.prompt.indexOf('go straight to the Surface Assessment');
    assert.ok(gateAt > headerAt && gateAt < imperativeAt,
      'the small-task off-ramp must sit at the section head, before the audit imperative');
    assert.ok(
      result.prompt.includes('This applies when the change touches shared structure, more than one surface, or data the system already models'),
      'the gate must positively state when the section applies');
  });

  test('meta-prompt mirrors the audit directives in the Research-prompts rule', () => {
    const p = buildMetaPromptTemplate({
      issueContext: 'CTX', identifier: 'LIN-901',
      hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: false, commentCount: 0, aiHints: 'H', actionVocabulary: 'plan, review, research',
      completionSignals: 'S', focusedSubtaskId: null, isTerminal: false, hasOpenChildren: false
    });
    assert.ok(/Audit the Layers pass/.test(p), 'meta-prompt must require an Audit the Layers pass');
    assert.ok(/cite a source for each claim/.test(p), 'meta-prompt must require a cited source per claim');
    assert.ok(/state the layer set as complete/.test(p), 'meta-prompt must require closing the layer set');
    assert.ok(/seed examples, not a fixed checklist/.test(p), 'meta-prompt must frame the axes as seed examples, not a checklist');
    assert.ok(/adversarial self-review pass/.test(p), 'meta-prompt must require the adversarial self-review pass');
    assert.ok(
      /second representation of something already modelled/.test(p),
      'meta-prompt Surface Assessment must treat a duplicate representation as refactor required'
    );
    assert.ok(/does not pay the obligation tax/.test(p), 'meta-prompt must keep the scale-to-task guard over the new content');
  });
});

// Scale-to-task (lower bound, LIN-260). The heavy generative phases must tell the
// agent to size output to the task — proven on the meta-prompt path via
// scripts/eval-prompt-scaling.mjs and mirrored here per CLAUDE.md's both-paths rule.
describe('Scale to the task (handwritten path)', () => {
  const mockIssue = {
    id: 'issue-st', identifier: 'TEST-ST1', title: 'Add a thing',
    description: 'Add a thing', url: 'https://linear.app/test/issue/TEST-ST1',
    state: { name: 'Todo', type: 'unstarted' }, labels: []
  };
  const mockContext = { parent: null, siblings: [], project: null, children: [], comments: [] };

  test('plan and research templates scale output to the task', () => {
    for (const phase of ['plan', 'research']) {
      const result = generatePrompt(phase, mockIssue, mockContext);
      assert.ok(result.prompt.includes('Scale this to the task'), `${phase} must include the scale-to-task directive`);
    }
  });

  test('scale directive carries the deceptive-small over-trim guard', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(
      result.prompt.includes('across the codebase') && result.prompt.includes('one sentence'),
      'must warn that a terse description does not imply a small task (the over-trim guard)'
    );
  });

  test('terminal phases do NOT carry the scale directive', () => {
    for (const phase of ['implementation', 'review']) {
      const result = generatePrompt(phase, mockIssue, mockContext);
      assert.ok(!result.prompt.includes('Scale this to the task'), `${phase} should not carry the scale-to-task directive`);
    }
  });
});

// =============================================================================
// LIN-177 S4/S5: Capability-aware prompts (provider.ui threaded into both paths)
// =============================================================================
import { generateCustomPrompt } from '../../lib/prompt-templates.js';
import { resolvePromptUi, applyPromptCapabilities, DEFAULT_PROMPT_UI, formatSubtaskSummary, appendGroundingSections, formatPlanFidelityCheck, formatAttachmentsSection } from '../../lib/prompt-formatters.js';
import { applyGroundingToRecommendation, formatIssueContext } from '../../lib/openrouter.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';

describe('resolvePromptUi (LIN-177 S4)', () => {
  test('no provider → Linear floor (every capability on, displayName Linear)', () => {
    assert.deepStrictEqual(resolvePromptUi({}, null), {
      displayName: 'Linear', write: true, subtasks: true, comments: true, includeTracker: true
    });
  });

  test('write is the hard floor: a read-only provider drops tracker refs regardless of flag', () => {
    const caps = resolvePromptUi({ linearMcp: true }, { write: false, displayName: 'Docs' });
    assert.strictEqual(caps.write, false);
    assert.strictEqual(caps.includeTracker, false, 'no tracker refs when provider cannot write');
    assert.strictEqual(caps.displayName, 'Docs');
  });

  test('linearMcp flag is the soft preference within a writable provider', () => {
    const caps = resolvePromptUi({ linearMcp: false }, { write: true, displayName: 'Local' });
    assert.strictEqual(caps.write, true);
    assert.strictEqual(caps.includeTracker, false, 'flag off suppresses the suffix even when writable');
  });

  test('displayName falls back to Linear when the provider ui omits it', () => {
    assert.strictEqual(resolvePromptUi({}, { write: true }).displayName, 'Linear');
  });
});

describe('capability-aware prompts: Linear byte-parity (LIN-177 S4/S5)', () => {
  const issue = {
    identifier: 'LIN-900', title: 'Sample', description: 'd',
    state: { name: 'Todo', type: 'unstarted' }, createdAt: '2026-01-01T00:00:00.000Z',
    priority: 2, assignee: { name: 'Dev' }, labels: []
  };
  const context = {
    project: { name: 'Proj' },
    parent: { identifier: 'LIN-1', title: 'Parent', state: { name: 'In Progress' } },
    siblings: [{ identifier: 'LIN-2', title: 'Sib', state: { name: 'Todo' } }],
    children: [{ identifier: 'LIN-3', title: 'Child', state: { name: 'Todo', type: 'unstarted' } }],
    comments: [{ body: 'hi', user: 'Dev', createdAt: '2026-01-02T00:00:00.000Z' }]
  };
  const LINEAR_UI = { ...DEFAULT_PROMPT_UI };

  test('threading an explicit Linear ui is a no-op vs. no provider, for every template + flag state', () => {
    for (const key of getPromptLabels()) {
      const i = { ...issue, labels: [key] };
      for (const flags of [{}, { linearMcp: false }]) {
        const base = generatePrompt(key, i, context, flags).prompt;
        const withUi = generatePrompt(key, i, context, flags, LINEAR_UI).prompt;
        assert.strictEqual(withUi, base, `${key} (flags=${JSON.stringify(flags)}) must be byte-identical for Linear`);
      }
    }
  });

  test('meta-prompt: explicit Linear ui is a no-op vs. no provider', () => {
    const args = {
      issueContext: 'CTX', identifier: 'LIN-900', hasSubtasks: true, subtaskCount: 1,
      completedCount: 0, inProgressCount: 0, remainingCount: 1, hasComments: true, commentCount: 1,
      aiHints: 'H', actionVocabulary: 'plan, implement', completionSignals: 'S',
      isTerminal: false, hasOpenChildren: true
    };
    const base = buildMetaPromptTemplate(args);
    const withUi = buildMetaPromptTemplate({ ...args, providerUi: LINEAR_UI });
    assert.strictEqual(withUi, base);
  });
});

describe('meta-prompt Step 0: open parent, all subtasks complete (LIN-364)', () => {
  const baseArgs = {
    issueContext: 'CTX', identifier: 'LIN-900',
    hasSubtasks: true, subtaskCount: 2, completedCount: 2, inProgressCount: 0, remainingCount: 0,
    hasComments: false, commentCount: 0, aiHints: 'H', actionVocabulary: 'plan, review, implement',
    completionSignals: 'S', focusedSubtaskId: null
  };

  test('open parent with all subtasks complete gets the unified review/close branch forbidding defer', () => {
    const p = buildMetaPromptTemplate({ ...baseArgs, isTerminal: false, hasOpenChildren: false });
    assert.ok(/Step 0: The substantive work here is already complete/i.test(p), 'the unified completion Step 0 branch must be present');
    assert.ok(/all \d+ of its subtasks are in a terminal state/i.test(p), 'it must name the all-subtasks-complete case');
    assert.ok(/Do NOT `?defer`?/i.test(p), 'it must explicitly forbid defer');
    assert.ok(/recommend `?review`?/i.test(p), 'it must steer toward review/close');
  });

  test('open parent with an open child does NOT get the branch (descent still applies)', () => {
    const p = buildMetaPromptTemplate({
      ...baseArgs, completedCount: 1, remainingCount: 1, isTerminal: false, hasOpenChildren: true
    });
    assert.ok(!/The substantive work here is already complete/i.test(p), 'a parent with an open child is not short-circuited');
  });

  test('a leaf (no subtasks) does NOT get the branch', () => {
    const p = buildMetaPromptTemplate({
      ...baseArgs, hasSubtasks: false, subtaskCount: 0, completedCount: 0, isTerminal: false, hasOpenChildren: false
    });
    assert.ok(!/The substantive work here is already complete/i.test(p), 'a leaf with no subtasks is not short-circuited at Step 0');
  });

  test('a terminal parent gets the unified Step 0 with the terminal clause, not the all-subtasks clause', () => {
    const p = buildMetaPromptTemplate({ ...baseArgs, isTerminal: true, hasOpenChildren: false });
    assert.ok(/Step 0: The substantive work here is already complete/i.test(p), 'a terminal task gets the unified completion Step 0');
    assert.ok(/its state is already a terminal state/i.test(p), 'with the terminal-state clause');
    assert.ok(!/all \d+ of its subtasks are in a terminal state/i.test(p), 'and NOT the non-terminal all-subtasks-complete clause');
  });
});

describe('meta-prompt review close-out gate + cannot-close routing (LIN-474)', () => {
  const baseArgs = {
    issueContext: 'CTX', identifier: 'LIN-900',
    hasSubtasks: true, subtaskCount: 2, completedCount: 2, inProgressCount: 0, remainingCount: 0,
    hasComments: true, commentCount: 2, aiHints: 'H', actionVocabulary: 'plan, review, implementation, bug',
    completionSignals: 'S', focusedSubtaskId: null
  };

  test('Review rule is trimmed to WRITE-ONLY + ledger + conditional verdict; a SEPARATE Close-out rule owns the gate (LIN-550)', () => {
    const p = buildMetaPromptTemplate({ ...baseArgs, isTerminal: false, hasOpenChildren: true });
    const reviewMatches = p.match(/\*\*Review prompts\*\* must:/g) || [];
    assert.strictEqual(reviewMatches.length, 1, 'there is exactly one Review-prompts rule');
    assert.ok(/explicit verdict \(Approve \/ Request Changes \/ Needs Discussion\)/i.test(p), 'the verdict is encoded');
    assert.ok(/write a `### What CI Did Not Prove` ledger/i.test(p), 'review writes the ledger');
    assert.ok(/Approve — conditional on close-out discharging the ledger/i.test(p), 'conditional approval encoded');
    assert.ok(/Review is WRITE-ONLY/i.test(p), 'review is write-only — no merge/Done/follow-ups');
    assert.ok(/must NOT loop back into another review/i.test(p), 'forbids looping back to review');
    assert.ok(/as `blocks` the current task/i.test(p), 'files/links the blocker as `blocks`');
    assert.ok(/a `blocks` relation alone does not make the engine descend/i.test(p),
      'next action named because `blocks` does not drive descent');
    // The retired fused-gate + undefined-merger framing must be gone from the review rule.
    assert.ok(!/PRE-MERGE close-out gate/i.test(p), 'no fused pre-merge close-out gate language');
    assert.ok(!/belong to the merger/i.test(p), 'no undefined-merger handoff');
    // A SEPARATE Close-out rule now owns the ledger gate (the three blocking invariants).
    const closeoutMatches = p.match(/\*\*Close-out prompts\*\* must/g) || [];
    assert.strictEqual(closeoutMatches.length, 1, 'exactly one Close-out-prompts rule exists');
    assert.ok(/gate on the review verdict rather than any specific format/i.test(p), 'close-out gates on the verdict, not the exact heading (LIN-810)');
    assert.ok(/it never discharges a flagged gap/i.test(p), 'green CI never discharges a flagged gap');
    assert.ok(/names the exact precondition they exercised/i.test(p), 'human acceptance must name the exact precondition');
  });

  test('Step 0 completion branch carries the cannot-close branch routing to a blocker', () => {
    const p = buildMetaPromptTemplate({ ...baseArgs, isTerminal: true, hasOpenChildren: false });
    assert.ok(/\*\*Cannot-close branch:\*\*/i.test(p), 'Step 0 names the cannot-close branch');
    assert.ok(/do NOT keep routing to `?review`?/i.test(p), 'it must not keep routing to review on CI-red/blocker');
    assert.ok(/route instead via Step 2 to the blocker/i.test(p), 'it routes to the blocker via Step 2');
  });

  test('Step 3 already-landed seam routes a CI-red / surfaced-blocker case to the blocker, not a repeated review', () => {
    const p = buildMetaPromptTemplate({
      ...baseArgs, hasSubtasks: false, subtaskCount: 0, completedCount: 0,
      isTerminal: false, hasOpenChildren: false
    });
    assert.ok(/neither to `?implementation`? nor to a repeated `?review`?/i.test(p),
      'Step 3 carries the cannot-close exception');
    assert.ok(/route the next action to that blocker/i.test(p), 'it routes the next action to the blocker');
  });
});

// =============================================================================
// close-out template + review→close-out ledger handoff (LIN-550)
// =============================================================================

describe('close-out template + review→close-out ledger handoff (LIN-550)', () => {
  const issue = {
    id: 'co-1', identifier: 'LIN-901', title: 'Land the thing',
    description: 'work', url: 'https://linear.app/test/issue/LIN-901',
    labels: [], createdAt: '2026-01-01T00:00:00.000Z'
  };
  const context = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  test('close-out is a registered first-class template (key, name, UNIVERSAL, AI-recommendable, completion signal)', () => {
    assert.ok('close-out' in PROMPT_TEMPLATES, 'close-out is a PROMPT_TEMPLATES key');
    const t = PROMPT_TEMPLATES['close-out'];
    assert.strictEqual(t.name, 'close-out');
    assert.strictEqual(t.category, PROMPT_CATEGORIES.UNIVERSAL);
    assert.ok(t.aiHint, 'has an aiHint so it is AI-recommendable');
    assert.ok(COMPLETION_SIGNALS['close-out'], 'has a registered completion signal');
    assert.strictEqual(t.completionSignals, COMPLETION_SIGNALS['close-out'], 'template wires its completion signal');
  });

  test('(a) close-out reads the review ledger and gates merge/Done until each item is discharged or accepted', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/most recent review summary comment/i.test(prompt), 'reads the latest review comment');
    assert.ok(/Not-Proven-by-CI Ledger Gate/i.test(prompt), 'has the ledger gate');
    assert.ok(/Do NOT merge or set the task Done while any ledger item is undischarged/i.test(prompt),
      'blocks merge/Done while any item is undischarged');
    assert.ok(/\*\*\(a\) discharged\*\*/i.test(prompt) && /\*\*\(b\) explicitly accepted\*\*/i.test(prompt),
      'each item is discharged-with-evidence or explicitly accepted');
    // Only after all-clear does it perform the irreversible set.
    assert.ok(/Perform the Irreversible Set/i.test(prompt) && /Merge the approved PR/i.test(prompt) && /Set the task to Done/i.test(prompt),
      'merge/Done/summary/follow-ups happen only on all-clear');
  });

  test('(b) review writes a structured ledger; close-out reads the verdict/gaps without keying on the heading (LIN-810 decoupling)', () => {
    const review = generatePrompt('review', issue, context).prompt;
    const closeout = generatePrompt('close-out', issue, context).prompt;
    // Review still emits the structured heading — helpful structure when present.
    assert.ok(review.includes('### What CI Did Not Prove'), 'review writes the ### What CI Did Not Prove ledger');
    assert.ok(/add a summary comment containing the `### What CI Did Not Prove` ledger/i.test(review),
      'review records the ledger into its summary comment (the carrier)');
    // Close-out no longer requires that exact string — it reads the verdict and flagged gaps fuzzily.
    assert.ok(!closeout.includes('### What CI Did Not Prove'),
      'close-out does not key on the literal heading (decoupled)');
    assert.ok(/gaps it flagged as (not covered by|unproven by) CI/i.test(closeout),
      'close-out reads the review\'s flagged gaps generically');
  });

  test('(c) empty ledger => close-out is a cheap no-op pass-through; review allows an unconditional Approve only then', () => {
    const closeout = generatePrompt('close-out', issue, context).prompt;
    assert.ok(/### Cheap When Empty/i.test(closeout), 'close-out has the cheap-when-empty path');
    assert.ok(/no-op pass-through/i.test(closeout), 'an explicitly empty ledger makes close-out a no-op pass-through');
    const review = generatePrompt('review', issue, context).prompt;
    assert.ok(/only an explicitly empty ledger may carry a plain \*\*Approve\*\*/i.test(review),
      'review permits a plain Approve only when the ledger is explicitly empty');
    assert.ok(/An explicitly empty ledger makes close-out a no-op pass-through/i.test(review),
      'review states the empty-ledger ⇒ no-op contract');
  });

  test('(d) the gate invariants are present in the rendered close-out body', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    // 1. gate on the review verdict — an absent ledger under an Approve is treated as empty (LIN-810)
    assert.ok(/Gate on the review verdict/i.test(prompt),
      'close-out gates on the verdict, treating an absent ledger under an Approve as empty');
    assert.ok(/treat the absence of such gaps as an empty ledger/i.test(prompt),
      'an absent ledger under an Approve is read as empty, not a block');
    // 2. green CI alone never discharges a ledger item
    assert.ok(/Green CI is never evidence for a ledger item/i.test(prompt),
      'green CI never discharges a ledger item');
    // 3. human validation counts only if it names the exact precondition
    assert.ok(/does not name the precondition it exercised does NOT discharge an item/i.test(prompt),
      'a human validation that does not name the precondition does not discharge');
    assert.ok(/by a human who names the exact precondition they exercised/i.test(prompt),
      'explicit human acceptance must name the exact precondition');
  });

  test('(f) close-out relaxes the missing-ledger block: verdict-gated, absent-is-empty, only no-verdict routes to review (LIN-810)', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    // The old hard block on a missing/unparseable heading is gone.
    assert.ok(!/Missing or unparseable ledger BLOCKS/i.test(prompt),
      'the old missing-ledger hard-block language is removed');
    assert.ok(!/route back to `review` to \(re\)write/i.test(prompt),
      'no longer routes back to review over a missing heading');
    // Gate on the verdict; absence of flagged gaps under an Approve is an empty ledger.
    assert.ok(/When the latest review records an \*\*Approve\*\*/i.test(prompt),
      'proceeds when the review recorded an Approve');
    assert.ok(/note that in your summary/i.test(prompt),
      'records the absence of an explicit ledger in the summary');
    // Only a complete lack of a review verdict is unauthorized to close.
    assert.ok(/no review verdict at all is unauthorized to close/i.test(prompt),
      'only a task with no review verdict at all routes back to review');
  });

  test('(e1) close-out body emits no literal "Linear" and renames cleanly for a non-Linear provider', () => {
    const linear = generatePrompt('close-out', issue, context).prompt;
    assert.ok(!linear.includes('Linear'), 'close-out body contains no literal Linear (it enters the byte-parity loop)');
    const local = generatePrompt('close-out', { ...issue, labels: ['close-out'] }, context, {},
      { write: true, comments: true, subtasks: true, displayName: 'Local' }).prompt;
    assert.ok(!local.includes('Linear'), 'no Linear leaks for a non-Linear provider');
  });

  test('(e2) close-out is byte-identical for Linear with vs without an explicit provider', () => {
    const i = { ...issue, labels: ['close-out'] };
    const base = generatePrompt('close-out', i, context, {}).prompt;
    const withUi = generatePrompt('close-out', i, context, {}, { ...DEFAULT_PROMPT_UI }).prompt;
    assert.strictEqual(withUi, base, 'close-out must be byte-identical for Linear');
  });

  test('(meta) both paths render close-out: routing offers it after review approval (Step 0 + Step 3 + priority line)', () => {
    const baseArgs = {
      issueContext: 'CTX', identifier: 'LIN-901', hasComments: true, commentCount: 2,
      aiHints: 'H', actionVocabulary: 'review, close-out, implementation', completionSignals: 'S'
    };
    const step0 = buildMetaPromptTemplate({ ...baseArgs, hasSubtasks: true, subtaskCount: 2, completedCount: 2, inProgressCount: 0, remainingCount: 0, isTerminal: true, hasOpenChildren: false });
    assert.ok(/recommend `close-out`, NOT another `review`/i.test(step0), 'Step 0 offers close-out after approval');
    assert.ok(/then `close-out` once review has approved/i.test(step0), 'priority line sequences review→close-out');
    const step3 = buildMetaPromptTemplate({ ...baseArgs, hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0, isTerminal: false, hasOpenChildren: false });
    assert.ok(/Recommend `close-out` — the ledger-gated finish/i.test(step3), 'Step 3 landed-guard offers close-out after approval');
  });
});

describe('meta-prompt Step 2: bug already investigated (LIN-366)', () => {
  const baseArgs = {
    issueContext: 'CTX', identifier: 'LIN-900',
    hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
    hasComments: true, commentCount: 2, aiHints: 'H', actionVocabulary: 'plan, implementation, review, bug',
    completionSignals: 'S', focusedSubtaskId: null, isTerminal: false, hasOpenChildren: false
  };

  test('Step 2 carries the "already investigated → advance to the fix" escape hatch', () => {
    const p = buildMetaPromptTemplate(baseArgs);
    assert.ok(/already been investigated/i.test(p), 'the bug-investigated escape hatch must be present');
    assert.ok(/do NOT loop research/i.test(p), 'it must explicitly forbid looping research');
    assert.ok(/Recommend `?implementation`?/i.test(p), 'it must route a done investigation to implementation');
  });

  test('it ties the decision to the bug completion signal, not just the label', () => {
    const p = buildMetaPromptTemplate(baseArgs);
    assert.ok(/completion signal/i.test(p), 'the escape hatch references the bug completion signal');
    assert.ok(/label.*(alone|mere presence) is NOT a reason/i.test(p),
      'the label alone must not be treated as a reason to re-investigate');
  });

  test('with comments present, it directs the model to read them', () => {
    const p = buildMetaPromptTemplate({ ...baseArgs, hasComments: true, commentCount: 3 });
    assert.ok(/There are 3 comment\(s\) — read them/i.test(p), 'comment-count phrasing must surface when comments exist');
  });
});

describe('FRONTIER FACTS fact-surfacing (LIN-433)', () => {
  const frontierFacts = {
    openCount: 3,
    blockedCount: 1,
    openChildren: [
      { identifier: 'LIN-401', blocked: true },
      { identifier: 'LIN-402', blocked: false },
      { identifier: 'LIN-428', blocked: false }
    ],
    nextChild: 'LIN-428',
    sessionFit: 'fits one session'
  };
  const baseArgs = {
    issueContext: 'CTX', identifier: 'LIN-385',
    hasSubtasks: true, subtaskCount: 4, completedCount: 1, inProgressCount: 0, remainingCount: 3,
    hasComments: false, commentCount: 0, aiHints: 'H', actionVocabulary: 'plan, implementation, review, breakdown, defer',
    completionSignals: 'S', focusedSubtaskId: 'LIN-428', isTerminal: false, hasOpenChildren: true
  };

  test('meta-prompt renders the deterministic block when frontierFacts is supplied', () => {
    const p = buildMetaPromptTemplate({ ...baseArgs, frontierFacts });
    assert.ok(/FRONTIER FACTS \(deterministic/i.test(p), 'the block header must be present');
    assert.ok(/Open children: 3 \(1 blocked, 2 actionable\)/.test(p), 'open/blocked/actionable counts surface');
    assert.ok(/LIN-401 \[blocked\]/.test(p) && /LIN-428 \[actionable\]/.test(p), 'per-child blocker status surfaces');
    assert.ok(/Frontier next child[^\n]*: LIN-428/.test(p), 'the frontier next child surfaces');
    assert.ok(/Plan session-fit answer: fits one session/.test(p), 'the extracted session-fit hint surfaces');
  });

  test('meta-prompt omits the block when frontierFacts is absent (Linear-parity default)', () => {
    const p = buildMetaPromptTemplate({ ...baseArgs, frontierFacts: null });
    assert.ok(!/FRONTIER FACTS/.test(p), 'no block without frontierFacts (the parity default)');
  });

  test('SUGGESTED NEXT prose advertises the frontier picker, not the stale priority order', () => {
    const p = buildMetaPromptTemplate({ ...baseArgs, frontierFacts });
    assert.ok(/Blocked children are skipped/i.test(p), 'prose names the skip-blocked behavior');
    assert.ok(/unblocks-most then critical-path/i.test(p), 'prose names the frontier ranking');
    assert.ok(!/first non-blocked todo > first incomplete/i.test(p), 'the stale priority wording is gone');
  });

  test('handwritten path mirrors the same facts via formatSubtaskSummary', () => {
    const children = [
      // LIN-357: blocked-ness is the incomplete blocking relation, not the label.
      { id: 'a', identifier: 'LIN-401', title: 't', state: { type: 'unstarted' },
        labels: { nodes: [] }, inverseRelations: { nodes: [{ type: 'blocks', issue: { id: 'x', state: { type: 'started' } } }] } },
      { id: 'b', identifier: 'LIN-428', title: 't', state: { type: 'started' },
        labels: { nodes: [] }, inverseRelations: { nodes: [] } }
    ];
    const summary = formatSubtaskSummary(children);
    assert.ok(/\*\*Subtasks:\*\* 0\/2 done, 1 in progress → Continue: LIN-428/.test(summary),
      'summary advertises the frontier-picked next child');
    assert.ok(/\*\*Frontier facts:\*\* 2 open child\(ren\), 1 blocked, next frontier child LIN-428/.test(summary),
      'the mirrored FRONTIER FACTS line carries the same open/blocked counts and next child');
  });
});

describe('capability-aware prompts: non-Linear providers (LIN-177 S4/S5)', () => {
  const issue = {
    identifier: 'GH-7', title: 'Sample', description: 'd',
    state: { name: 'Todo', type: 'unstarted' }, createdAt: '2026-01-01T00:00:00.000Z', labels: []
  };
  const context = {
    project: { name: 'P' }, parent: null, siblings: [],
    children: [{ identifier: 'GH-8', title: 'Child', state: { name: 'Todo', type: 'unstarted' } }],
    comments: []
  };

  test('writable non-Linear provider: tracker renamed to displayName, write steps kept', () => {
    const ui = { write: true, comments: true, estimates: true, subtasks: true, displayName: 'Local' };
    const p = generatePrompt('implementation', { ...issue, labels: ['implementation'] }, context, {}, ui).prompt;
    assert.ok(!p.includes('Linear'), 'no hardcoded Linear');
    assert.ok(p.includes('in Local'), 'tracker renamed to displayName');
    assert.ok(/Set GH-7 status to "In Progress"/.test(p), 'status-change step kept for a writable provider');
  });

  test('read-only provider: no Linear, no status-change steps, no subtask sections', () => {
    const ui = { write: false, comments: false, estimates: false, subtasks: false, displayName: 'Docs' };
    const p = generatePrompt('plan', { ...issue, labels: ['plan'] }, context, {}, ui).prompt;
    assert.ok(!p.includes('Linear'), 'no hardcoded Linear');
    assert.ok(!/Set [^\n]*status to/.test(p), 'no status-change directive for a read-only provider');
    assert.ok(!/^\*\*(Existing Subtasks|Subtasks):\*\*/m.test(p), 'no subtask section for a provider without subtasks');
    // Workflow steps renumber cleanly after write-steps are dropped (no gap/duplicate).
    const wf = p.split('## Workflow')[1].split('##')[0];
    const nums = (wf.match(/^\d+\. /gm) || []).map(s => parseInt(s, 10));
    assert.deepStrictEqual(nums, nums.map((_, idx) => idx + 1), 'workflow steps renumbered 1..n');
  });

  test('subtasks gate is independent of write: a writable, no-subtasks provider keeps writes but drops subtask sections', () => {
    const ui = { write: true, comments: true, estimates: true, subtasks: false, displayName: 'Jira' };
    const p = generatePrompt('breakdown', { ...issue, labels: ['breakdown'] }, context, {}, ui).prompt;
    assert.ok(/Set GH-7 status to "In Progress"/.test(p), 'status step kept (writable)');
    assert.ok(!/^\*\*Existing Subtasks:\*\*/m.test(p), 'subtask section dropped');
  });

  test('meta-prompt read-only provider: renamed tracker + read-only workflow note', () => {
    const meta = buildMetaPromptTemplate({
      issueContext: 'CTX', identifier: 'GH-7', hasSubtasks: false, subtaskCount: 0,
      completedCount: 0, inProgressCount: 0, remainingCount: 0, hasComments: false, commentCount: 0,
      aiHints: 'H', actionVocabulary: 'plan, implement', completionSignals: 'S',
      providerUi: { write: false, comments: false, estimates: false, subtasks: false, displayName: 'Docs' }
    });
    assert.ok(!meta.includes('Linear'), 'no hardcoded Linear in the meta-prompt');
    assert.ok(meta.includes('Docs task'), 'tracker renamed to displayName');
    assert.ok(meta.includes('read-only'), 'read-only workflow note present');
  });
});

describe('generateCustomPrompt capability awareness (LIN-177 S4)', () => {
  const issue = { identifier: 'GH-9', title: 'T', description: 'd', state: { name: 'Todo' }, labels: [] };
  const ctx = { project: { name: 'P' }, children: [], comments: [] };

  test('renames the tracker for a non-Linear provider', () => {
    const custom = { id: 'c1', name: 'Custom', template: 'Do the thing and update it in Linear.' };
    const out = generateCustomPrompt(custom, issue, ctx, {}, { write: true, displayName: 'Local' });
    assert.ok(out.prompt.includes('in Local') && !out.prompt.includes('Linear'));
  });

  test('strips tracker references for a read-only provider', () => {
    const custom = { id: 'c1', name: 'Custom', template: 'Update the status in Linear when done.' };
    const out = generateCustomPrompt(custom, issue, ctx, {}, { write: false, displayName: 'Docs' });
    assert.ok(!/ in Docs/.test(out.prompt) && !out.prompt.includes('Linear'));
  });
});

describe('applyPromptCapabilities is a no-op for the Linear floor (LIN-177 S4)', () => {
  test('Linear caps leave text untouched', () => {
    const txt = '## Workflow\n\n1. **Start**: Set X status to "In Progress" in Linear\n2. **Fetch details**: in Linear\n\n**Subtasks:** 1/2 done';
    assert.strictEqual(applyPromptCapabilities(txt, resolvePromptUi({}, null)), txt);
  });
});

// =============================================================================
// Cross-path grounding parity (LIN-435: ONE source of truth for the
// deterministic re-grounding rules). The handwritten path (generatePrompt) and
// the AI meta-prompt path (applyGroundingToRecommendation) must append
// byte-identical grounding sections from the same appendGroundingSections seam,
// so the rules can never drift between paths (the broken meta staleness date is
// the defect this kills).
// =============================================================================
describe('cross-path grounding parity (LIN-435)', () => {
  const issue = {
    identifier: 'LIN-700', title: 'T', description: 'd',
    state: { name: 'Todo', type: 'unstarted' },
    createdAt: '2026-03-01T00:00:00.000Z', labels: ['implementation']
  };
  const context = { children: [], comments: [] };

  test('handwritten and meta paths append byte-identical grounding sections', () => {
    const grounding = appendGroundingSections('', issue, context);
    assert.ok(grounding.length > 0, 'fixture produces a non-empty grounding (staleness is unconditional)');

    // Handwritten path: generatePrompt ends with exactly these grounding sections
    // (the capability post-pass is a no-op for Linear and for grounding text).
    const hw = generatePrompt('implementation', issue, context).prompt;
    assert.ok(hw.endsWith(grounding), 'handwritten prompt ends with the shared grounding sections');

    // Meta path: the post-pass appends the identical grounding to the LLM body.
    const meta = applyGroundingToRecommendation(
      { reasoning: 'r', prompt: 'BODY', truncated: false, recommendedAction: 'implement', deferTo: null, completionTokens: 1 },
      issue, context
    );
    assert.strictEqual(meta.prompt, 'BODY' + grounding, 'meta path appends the identical grounding');
  });

  test('staleness --since date is injected deterministically from issue.createdAt (no placeholder)', () => {
    const meta = applyGroundingToRecommendation({ prompt: 'BODY' }, issue, context);
    assert.ok(
      meta.prompt.includes('git log --since="2026-03-01T00:00:00.000Z"'),
      'the real createdAt is substituted into --since'
    );
    assert.ok(
      !/\[ticket created date\]|<the ticket's Created date>/.test(meta.prompt),
      'no meta-prompt placeholder leaks into the grounded prompt'
    );
  });

  test('defer replies (prompt:null) get NO grounding — the no-body cost contract (LIN-327/328)', () => {
    const deferReply = { reasoning: 'r', prompt: null, truncated: false, recommendedAction: 'defer', deferTo: 'LIN-2', completionTokens: 1 };
    const out = applyGroundingToRecommendation(deferReply, issue, context);
    assert.strictEqual(out.prompt, null, 'a defer body stays null');
    assert.deepStrictEqual(out, deferReply, 'a defer reply is returned unchanged');
  });

  test('terminal-state + bug-investigated sections also match across paths', () => {
    const terminalBug = {
      identifier: 'LIN-701', title: 'T', description: 'd',
      state: { name: 'Done', type: 'completed' },
      createdAt: '2026-03-01T00:00:00.000Z', labels: ['bug']
    };
    const ctx = { children: [], comments: [{ body: 'root cause found', user: 'Dev', createdAt: '2026-03-02T00:00:00.000Z' }] };
    const grounding = appendGroundingSections('', terminalBug, ctx);
    assert.ok(/Task Already Complete/.test(grounding), 'terminal-state note present in the shared grounding');
    assert.ok(/Prior Investigation On Record/.test(grounding), 'bug-investigated note present in the shared grounding');

    const meta = applyGroundingToRecommendation({ prompt: 'BODY' }, terminalBug, ctx);
    assert.strictEqual(meta.prompt, 'BODY' + grounding, 'meta path matches for the terminal+bug case too');
  });
});

// =============================================================================
// Cross-path Attachments section parity (LIN-772). The handwritten path
// (generatePrompt post-pass) and the AI meta-prompt path (formatIssueContext
// context block) must emit the SAME formatAttachmentsSection output, so a worker
// sees an identical attachment set regardless of surface. Attachment-less issues
// must stay byte-identical on both paths (the section self-gates to '').
// =============================================================================
describe('cross-path Attachments section parity (LIN-772)', () => {
  const issue = {
    identifier: 'LIN-720', title: 'T', description: 'd',
    state: { name: 'Todo', type: 'unstarted' },
    createdAt: '2026-06-01T00:00:00.000Z', labels: ['implementation']
  };
  const attachments = [
    { id: 'att:abc', title: 'design.png', contentType: 'image/png', kind: 'image' },
    { id: 'md:def', title: 'spec.md', contentType: null, kind: 'file' }
  ];
  const ctxWith = { children: [], comments: [], attachments };
  const ctxWithout = { children: [], comments: [], attachments: [] };

  test('attachment-less context is byte-identical to no-attachments-field (both paths)', () => {
    // Handwritten path: empty attachments must not change the rendered prompt.
    const hwNone = generatePrompt('implementation', issue, { children: [], comments: [] }).prompt;
    const hwEmpty = generatePrompt('implementation', issue, ctxWithout).prompt;
    assert.strictEqual(hwEmpty, hwNone, 'handwritten prompt unchanged by an empty attachments array');
    assert.ok(!hwEmpty.includes('## Attachments'), 'no Attachments section when there is nothing attached');

    // Meta path: the context block is likewise unchanged.
    const metaNone = formatIssueContext(issue, { children: [], comments: [] });
    const metaEmpty = formatIssueContext(issue, ctxWithout);
    assert.strictEqual(metaEmpty, metaNone, 'meta context block unchanged by an empty attachments array');
    assert.ok(!metaEmpty.includes('## Attachments'), 'no Attachments section in meta context when empty');
  });

  test('both paths embed the byte-identical shared Attachments section when attachments exist', () => {
    const section = formatAttachmentsSection(ctxWith);
    assert.ok(section.length > 0, 'fixture with attachments produces a non-empty section');
    assert.ok(section.includes('## Attachments'), 'section carries the heading');

    // Handwritten path appends it verbatim (capability post-pass is a no-op for Linear).
    const hw = generatePrompt('implementation', issue, ctxWith).prompt;
    assert.ok(hw.includes(section), 'handwritten prompt embeds the shared Attachments section verbatim');

    // Meta path folds the identical section into the context block.
    const meta = formatIssueContext(issue, ctxWith);
    assert.ok(meta.includes(section), 'meta context block embeds the identical Attachments section');
  });

  test('the section lists every attachment by title, kind, and opaque relay handle', () => {
    const section = formatAttachmentsSection(ctxWith);
    assert.ok(section.includes('design.png') && section.includes('`att:abc`'), 'formal image listed with its handle');
    assert.ok(section.includes('spec.md') && section.includes('`md:def`'), 'markdown file listed with its handle');
    assert.ok(section.includes('image/png'), 'contentType surfaced when present');
    assert.ok(section.includes('(file)'), 'null-contentType file omits the type suffix');
    assert.ok(
      /GET \/api\/proxy\/attachments\/<id>/.test(section),
      'directs the worker to fetch bytes through the relay, not by dereferencing the handle'
    );
  });

  test('section self-gates to empty for absent / non-array / handle-less input', () => {
    assert.strictEqual(formatAttachmentsSection(), '', 'no context → empty');
    assert.strictEqual(formatAttachmentsSection({}), '', 'no attachments field → empty');
    assert.strictEqual(formatAttachmentsSection({ attachments: null }), '', 'null attachments → empty');
    assert.strictEqual(formatAttachmentsSection({ attachments: 'x' }), '', 'non-array attachments → empty');
    assert.strictEqual(formatAttachmentsSection({ attachments: [{}, null] }), '', 'entries without an id → empty');
  });

  test('renders the optional owner/inherited provenance hook (S4, LIN-773) only when set', () => {
    const base = formatAttachmentsSection({ attachments: [{ id: 'att:x', title: 'a.png', kind: 'image' }] });
    assert.ok(!/inherited|_\(from /.test(base), 'no provenance suffix when owner/inherited are unset (S3 default is stable)');

    const inherited = formatAttachmentsSection({
      attachments: [{ id: 'att:x', title: 'a.png', kind: 'image', inherited: true, owner: 'LIN-700' }]
    });
    assert.ok(inherited.includes('inherited from LIN-700'), 'inherited attachment names its owning ancestor');

    const owned = formatAttachmentsSection({
      attachments: [{ id: 'att:x', title: 'a.png', kind: 'image', owner: 'LIN-720' }]
    });
    assert.ok(owned.includes('_(from LIN-720)_'), 'own attachment can still carry an owner label');
  });

  test('the Attachments section is provider-agnostic (no hardcoded Linear)', () => {
    assert.ok(!formatAttachmentsSection(ctxWith).includes('Linear'), 'shared section prose must not hardcode a tracker name');
  });
});

// =============================================================================
// Plan-fidelity reconciliation + refactor-equivalence (LIN-698). The
// implementation template already re-grounds the TICKET's claims about the code
// against HEAD; it lacked the symmetric re-grounding of the PLAN's claims about
// the research. Add that check (plus the refactor/behavior-preservation
// equivalence guidance) on BOTH prompt paths, kept implementation-specific and
// deliberately NOT routed through the universal appendGroundingSections seam.
// =============================================================================
describe('plan-fidelity reconciliation + refactor-equivalence (LIN-698)', () => {
  const mockIssue = {
    id: 'issue-pf', identifier: 'TEST-PF1', title: 'Implement a thing',
    description: 'Implement the planned change', url: 'https://linear.app/test/issue/TEST-PF1',
    state: { name: 'Todo', type: 'unstarted' }, labels: ['implementation']
  };
  const mockContext = { parent: null, siblings: [], project: null, children: [], comments: [] };

  test('implementation template adds a Re-ground the Plan fidelity check', () => {
    const result = generatePrompt('implementation', mockIssue, mockContext);
    assert.ok(result.prompt.includes('Re-ground the Plan'), 'implementation must include the plan-fidelity check');
    assert.ok(result.prompt.includes('distillation'), 'must frame the plan as a distillation of the research');
    assert.ok(
      result.prompt.includes('research/exploration notes') && result.prompt.includes('comment thread'),
      'must direct reading the research notes and comment thread, not just the description'
    );
    assert.ok(
      result.prompt.includes('"preserve this behavior" constraint'),
      'must require extracting the research constraints, not just a staleness skim'
    );
  });

  test('implementation template tightens Guideline 1 to research-wins-on-conflict', () => {
    const result = generatePrompt('implementation', mockIssue, mockContext);
    assert.ok(
      result.prompt.includes("research's reasoning wins"),
      'Guideline 1 must defer to the research when plan and research conflict'
    );
    assert.ok(
      !result.prompt.includes('Follow the plan, including any history-sourced constraints it documented'),
      'the old plan-only Guideline 1 wording must be replaced'
    );
  });

  test('implementation template adds a refactor / behavior-preservation equivalence check', () => {
    const result = generatePrompt('implementation', mockIssue, mockContext);
    assert.ok(result.prompt.includes('behavior-preserving'), 'must address behavior-preserving / refactor labels');
    assert.ok(result.prompt.includes('characterization test'), 'must call for a characterization test of old behavior');
  });

  test('the plan-fidelity prose is provider-agnostic (no hardcoded Linear)', () => {
    assert.ok(!formatPlanFidelityCheck().includes('Linear'), 'shared template prose must not hardcode a tracker name');
  });

  test('plan-fidelity is NOT routed through the universal grounding seam (LIN-698 anti-pattern)', () => {
    const issue = { identifier: 'LIN-700', createdAt: '2026-03-01T00:00:00.000Z', labels: ['implementation'] };
    const grounding = appendGroundingSections('', issue, { children: [], comments: [] });
    assert.ok(
      !grounding.includes('Re-ground the Plan'),
      'plan-fidelity must stay implementation-specific and not leak into the universal grounding sections'
    );
  });

  test('meta-prompt mirrors the plan-fidelity + refactor-equivalence directives (both-paths rule)', () => {
    const p = buildMetaPromptTemplate({
      issueContext: 'CTX', identifier: 'LIN-902',
      hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: false, commentCount: 0, aiHints: 'H', actionVocabulary: 'plan, review, implement',
      completionSignals: 'S', focusedSubtaskId: null, isTerminal: false, hasOpenChildren: false
    });
    assert.ok(/reconcile the plan against the research/.test(p), 'meta-prompt must require plan-vs-research reconciliation');
    assert.ok(/research's reasoning wins/.test(p), 'meta-prompt must give the research priority on conflict');
    assert.ok(/characterization test/.test(p), 'meta-prompt must require characterizing old behavior for refactor labels');
  });
});
