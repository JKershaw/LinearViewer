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
import fs from 'node:fs';
import { hasPrompt, getPromptLabels, generatePrompt, getAvailablePrompts, getPromptDescriptionsForAI, PROMPT_TEMPLATES, PROMPT_CATEGORIES, formatStageOptions, getSelectableStages, RECOMMEND_META_ACTIONS, DISPATCH_KINDS, isValidDispatchKind, deriveDispatchKind } from '../../lib/prompt-templates.js';
const actionNames = () => getSelectableStages().map(s => s.name);
import { WORK_ISSUE_LABELS } from '../../lib/workflow-config.js';
import { COMPLETION_SIGNALS } from '../../lib/completion-signals.js';

// Extracts every backtick-quoted `priority`-family field identifier
// (priority, priorityLevel, priorityLabel, ...) from a text slice. Field-scoped,
// not phrase-locked (LIN-2315/LIN-2316): keys on WHICH field is named, not on
// specific prose, so a paraphrase that still names the wrong field still fails.
function namedPriorityFields(text) {
  return [...text.matchAll(/`(priority\w*)`/g)].map(m => m[1]);
}

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
    assert.ok(labels.includes('retrospective-audit'));
    assert.ok(labels.includes('retro'));
  });

  test('has exactly 17 templates', () => {
    const labels = getPromptLabels();
    assert.strictEqual(labels.length, 17);
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
    assert.strictEqual(getPromptLabels().length, 17, 'defer must not change the template count');
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

  // A router that writes `→ **close out**` named close-out. Read as custom, it named no
  // stage and failed the hop (LIN-3292).
  test('deriveDispatchKind reads a space, underscore or hyphen alike', () => {
    for (const [name, kind] of [['close out', 'close-out'], ['Close_Out', 'close-out'], ['plan review', 'plan-review'],
      ['look-into', 'look-into'], ['look into', 'look-into'], ['retrospective audit', 'retrospective-audit'], ['implement', 'implementation']]) {
      assert.strictEqual(deriveDispatchKind(name), kind, name);
    }
    assert.strictEqual(deriveDispatchKind('closeout'), 'custom', 'only separators are normalised, not spelling');
  });
});

// =============================================================================
// `public/llms.txt` catalog (LIN-1602 precedent, LIN-2261 review F1): the
// public, unauthenticated agent-facing catalog is hand-maintained prose, not
// derived from PROMPT_TEMPLATES — so it can silently drift from the registry.
// These tests cross-reference the file's content against the live registry
// rather than pinning a literal count, so the NEXT template addition fails
// here instead of shipping a stale public claim again.
// =============================================================================

describe('public/llms.txt prompt catalog stays in sync with PROMPT_TEMPLATES', () => {
  const llmsTxt = fs.readFileSync(new URL('../../public/llms.txt', import.meta.url), 'utf8');
  const templateKeys = Object.keys(PROMPT_TEMPLATES);

  test('the advertised count matches the registry size', () => {
    const match = llmsTxt.match(/Available Prompt Templates \((\d+) total\)/);
    assert.ok(match, 'llms.txt must carry an "Available Prompt Templates (N total)" header');
    assert.strictEqual(Number(match[1]), templateKeys.length);
  });

  test('every registered template kind (including retrospective-audit) is listed as a bullet', () => {
    for (const key of templateKeys) {
      assert.ok(
        llmsTxt.includes(`\`${key}\` -`),
        `llms.txt is missing a catalog bullet for \`${key}\``,
      );
    }
  });

  test('the "All N templates above" cross-reference also matches the registry size', () => {
    const match = llmsTxt.match(/All (\d+) templates above/);
    assert.ok(match, 'llms.txt must carry an "All N templates above" cross-reference');
    assert.strictEqual(Number(match[1]), templateKeys.length);
  });
});

// =============================================================================
// The SAME drift, in the two internal current-state docs (LIN-2302 Instance 6).
// `public/llms.txt` was guarded by the block above (LIN-2261), but that guard is
// scoped to llms.txt only — docs/architecture/source-map.md and
// docs/executive-summary.md carry the same hand-maintained count and were
// left unguarded. The figure has now drifted
// three times inside one ticket's lifetime (14 -> 16 -> 17), and a stale value
// has already been load-bearing once: an operator relied on the wrong figure
// while filing LIN-2261 and propagated it into that ticket.
//
// Derived from the registry, never pinned to a literal, for the same reason the
// block above is: the NEXT template addition should fail here rather than ship a
// seventh instance of this class.
//
// SCOPE BOUNDARY: this is a narrow count guard, NOT the structural remedy for
// claim-drift generally — that is LIN-2261's retrospective-audit template.
//
// What is deliberately NOT covered, and why (an earlier draft of this comment
// claimed the exclusions were all "dated audit reports"; review showed that was
// itself a false enumeration — on the very surface meant to stop false
// enumerations — so it is spelled out properly here):
//
//   - docs/prompt-audit-report.md, docs/meta-prompt-audit-report.md — genuinely
//     dated point-in-time records (Date: 2026-01-21 / 2026-01-28). Freezing a
//     historical report is not drift.
//   - docs/lin-260-prompt-scaling-research.md — a Status-marked RESEARCH doc,
//     not a dated audit report. Same reasoning (a point-in-time artifact), but
//     it is not the same kind of document, and saying so was wrong.
//   - content/landing.md:18 ("14 deterministic templates") — undated, current
//     state, and PUBLIC (parsed at boot by server.js and served
//     unauthenticated), so it is squarely this class and NOT excluded on
//     principle. It is excluded because it is already owned by LIN-2392, and
//     absorbing another ticket's instance is the scope creep LIN-313 forbids.
//     That file carries adjacent provider drift too (line 13 lists the backends
//     and omits Jira and github-projects), which is the same ticket's business.
// ==============================================================================

describe('current-state docs keep the prompt-template count in sync with PROMPT_TEMPLATES', () => {
  const templateCount = Object.keys(PROMPT_TEMPLATES).length;

  const CURRENT_STATE_DOCS = [
    { file: 'docs/architecture/source-map.md', pattern: /Prompt template definitions \((\d+) templates\)/ },
    { file: 'docs/executive-summary.md', pattern: /\| (\d+) prompt templates with `route`/ },
  ];

  for (const { file, pattern } of CURRENT_STATE_DOCS) {
    test(`${file} advertises the registry's real template count`, () => {
      const text = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      const match = text.match(pattern);
      assert.ok(match, `${file} must still carry a template-count claim matching ${pattern}`);
      assert.strictEqual(Number(match[1]), templateCount,
        `${file} claims ${match[1]} prompt templates; the registry exports ${templateCount}`);
    });
  }
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
      'plan-review',
      'implementation',
      'review',
      'close-out',
      'retrospective-audit',
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
    // LIN-3299: the role line became the Goal's lead, and the steps moved under ## Process.
    const expectedGoalBlock = [
      '## Goal',
      // LIN-3299: code adds Scope and Authority after the lead, on every path.
      'Something behaves wrong. Find its cause for certain, with evidence, before anything is fixed; nothing ships without review.' + formatStageIntent('bug') + '\n',
      '## Process',
      'Start by reading any prior investigation notes in comments. Confirm the reproduction steps and root-cause hypotheses still match what you can observe now. If the behavior has changed since investigation, note it and re-verify before proposing a fix.',
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
      '7. Propose the fix at the cause: the change that removes it and reaches every instance step 6 found, refactoring where that simplifies the code. A change you would need to tell the team about first goes to the human as a ruling.',
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

  // LIN-3299: the role line is the Goal's lead now; it keeps the role's limit.
  test('leads with planning, and makes no code changes', () => {
    const result = generatePrompt('plan', mockIssue, mockContext);
    assert.ok(result.prompt.split('## Process')[1].includes('Make no code changes here: the next stage builds the plan.'));
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

  // LIN-3202 (menu M14): the plan states what it adds beyond the research and
  // cites the findings it relies on instead of restating them. Evidence base:
  // the median plan restates ~440 words of research (`step-overlap` v2 B).
  describe('cite, don\'t restate (LIN-3202)', () => {
    test('states what the plan adds beyond the research and cites the rest', () => {
      const result = generatePrompt('plan', mockIssue, mockContext);
      assert.ok(result.prompt.includes('State what it adds, and cite the rest'),
        'the plan prompt must carry the cite-don\'t-restate directive');
      assert.ok(result.prompt.includes('what it adds beyond the research'),
        'must ask what the plan adds beyond the research');
      assert.ok(result.prompt.includes('the research findings it relies on instead of restating them'),
        'must ask for citations of the findings relied on');
    });

    test('requires resolvable citations and forbids restatement to look self-contained', () => {
      const result = generatePrompt('plan', mockIssue, mockContext);
      assert.ok(result.prompt.includes('cite by comment (author/heading or id), file:line, or sha'),
        'citations must be resolvable without the plan paraphrasing them');
      assert.ok(result.prompt.includes('never restate a finding to "make the plan self-contained"'),
        'must not instruct restating a finding to appear self-contained');
      assert.ok(result.prompt.includes('there are no citations to manufacture'),
        'the no-research case must forbid manufacturing citations');
    });

    test('states the no-research and disagreement cases as additions, not restatements', () => {
      const result = generatePrompt('plan', mockIssue, mockContext);
      assert.ok(result.prompt.includes('the plan stands alone'),
        'a plan with no prior research must be allowed to stand alone');
      assert.ok(result.prompt.includes('that is an addition, not a restatement'),
        'a disagreement or stale finding must be named as an addition');
      assert.ok(result.prompt.includes('the citation covers the member list, not the verdict'),
        'the in/out-of-scope verdict stays the plan\'s own decision');
    });

    test('leaves the ordering invariant intact: Strategy Framing → Scope Assessment → session-fit → plan-review gate', () => {
      const result = generatePrompt('plan', mockIssue, mockContext);
      const sf = result.prompt.indexOf('### Strategy Framing');
      const sa = result.prompt.indexOf('### Scope Assessment');
      const fit = result.prompt.indexOf('does this fit one focused session');
      const gate = result.prompt.indexOf('### Plan-review Gate');
      assert.ok(sf > -1 && sa > -1 && fit > -1 && gate > -1, 'all four anchors must be present');
      assert.ok(sf < sa, 'Strategy Framing precedes Scope Assessment');
      assert.ok(sa < fit, 'Scope Assessment precedes the session-fit question');
      assert.ok(fit < gate, 'the session-fit answer precedes the plan-review gate');
    });

    test('leaves the class-not-member bound text untouched', () => {
      const result = generatePrompt('plan', mockIssue, mockContext);
      assert.ok(result.prompt.includes('Record the class, its bound, and its members in the issue description alongside the plan, where plan-review will look for them'),
        'the class bound must still have its stated destination');
    });
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
    // Said once, in the hand-off, with its reason (LIN-3293 dedup).
    assert.ok(/You do NOT merge, mark the task Done, or file follow-ups/.test(result.prompt));
  });
});

// =============================================================================
// Terminal-state note (LIN-353; the router's Step 0 routes on the same state)
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
    assert.ok(/holds up against this task's goal/i.test(result.prompt),
      'it must steer toward checking the parent against its goal, not defer');
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
    const result = generatePrompt('implementation', baseIssue, withComments);
    assert.ok(/Prior Investigation On Record/i.test(result.prompt), 'the bug-investigated note must be present');
    assert.ok(/do NOT.*investigate again|investigation is DONE|move to implementing the fix/i.test(result.prompt),
      'it must steer toward the fix, not re-investigation');
  });

  test('the bug investigation stage itself does NOT get the note (it proposes the fix, it does not apply it; LIN-3296)', () => {
    const result = generatePrompt('bug', baseIssue, withComments);
    assert.ok(!/Prior Investigation On Record|move to implementing the fix/i.test(result.prompt),
      'the bug stage stays an investigation; the fix is a separate implementation dispatch');
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

  test('bug class check proposes the fix at the cause, reaching every instance (LIN-3291)', () => {
    const result = generatePrompt('bug', bugIssue, ctx);
    assert.ok(/Propose the fix at the cause/i.test(result.prompt), 'the proposal is at the cause');
    assert.ok(/reaches every instance step 6 found/i.test(result.prompt), 'a found class is reached by the fix, not just listed');
  });

  test('bug class check guards against manufactured work (isolated is a valid answer)', () => {
    const result = generatePrompt('bug', bugIssue, ctx);
    assert.ok(/genuinely isolated issue is a valid answer/i.test(result.prompt),
      'an isolated result must be explicitly valid');
  });

  test('review template includes the class-check section before close-out', () => {
    const result = generatePrompt('review', reviewIssue, ctx);
    assert.ok(/### Isolated, or One of a Class\?/.test(result.prompt), 'review prompt must carry the class-check section');
    // LIN-3006: a sibling is no longer unconditionally routed to "list as a
    // finding, do not expand this task" — it is marked inside/outside first,
    // and an inside sibling becomes a ledger item rather than expanding the task.
    // LIN-3006 review fixup: "so the remaining work is scoped deliberately —
    // review itself does not fix it" replaces the residual "follow-up work"
    // framing, which implied an inside sibling is a follow-up rather than scope.
    assert.ok(/so the remaining work is scoped deliberately — review itself does not fix it/i.test(result.prompt),
      'siblings are marked inside/outside, not unconditionally expanded into new scope');
    assert.ok(/genuinely isolated change is a valid result/i.test(result.prompt),
      'an isolated result must be explicitly valid');
  });

  test('review checklist carries the class-check item', () => {
    const result = generatePrompt('review', reviewIssue, ctx);
    // The class check is its own section; the checklist no longer restates it (LIN-3293 dedup).
    assert.ok(/### Isolated, or One of a Class\?/.test(result.prompt), 'the class check stays required');
    assert.ok(!result.prompt.includes('- [ ] Class check answered'), 'and is said once');
  });
});

// =============================================================================
// Mutation-check directive — pin the review institutionalization (LIN-2274)
// =============================================================================
// LIN-2274 added a mutation-check directive to the review template so a
// reviewer independently mutation-checks the load-bearing new/changed tests
// before approving the close ("the test exists and asserts something" is not
// proof it asserts the right thing). Nothing pinned it (LIN-2303) — mirrors
// the class-check (LIN-313) precedent above.

describe('mutation-check directive — pin the review institutionalization (LIN-2274)', () => {
  const reviewIssue = {
    id: 'issue-rev-mutation', identifier: 'TEST-MC1', title: 'Verify fix',
    description: 'Review the landed fix', url: 'https://linear.app/test/issue/TEST-MC1',
    state: { name: 'In Progress', type: 'started' }, createdAt: '2026-01-01T00:00:00.000Z',
    labels: []
  };
  const ctx = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  test('review template carries the mutation-check guideline bullet', () => {
    const result = generatePrompt('review', reviewIssue, ctx);
    assert.ok(/Mutation-check the load-bearing tests \(LIN-2274\)/.test(result.prompt),
      'review prompt must carry the mutation-check bullet');
    assert.ok(/name the specific mutation you tried and what you observed/i.test(result.prompt),
      'must pin the substantive clause, not just the label');
  });

  test('review checklist carries the mutation-check item', () => {
    const result = generatePrompt('review', reviewIssue, ctx);
    // The mutation check lives in Test Quality Check; the checklist no longer restates it (LIN-3293 dedup).
    assert.ok(/\*\*Mutation-check the load-bearing tests/.test(result.prompt), 'the mutation check stays required');
    assert.ok(!result.prompt.includes('- [ ] At least the load-bearing'), 'and is said once');
  });

  test('mutation-check directive stays inside Test Quality Check, ahead of the Review Checklist', () => {
    const result = generatePrompt('review', reviewIssue, ctx);
    const directiveIndex = result.prompt.indexOf('Mutation-check the load-bearing tests (LIN-2274)');
    const checklistIndex = result.prompt.indexOf('### Review Checklist');
    assert.ok(directiveIndex > -1, 'mutation-check directive must be present');
    assert.ok(checklistIndex > -1, 'Review Checklist section must be present');
    assert.ok(directiveIndex < checklistIndex, 'mutation-check directive must precede the Review Checklist');
  });
});


// =============================================================================
// LIN-1871 (revising LIN-1873) — argue the class, not the member, pinned on
// BOTH prompt paths, across all three templates the ruling names
// =============================================================================
//
// Evidence base is LIN-1871, which applied the original cited-sweep rule by
// hand to four tickets parked at plan-review with 4+ agent sessions each and
// ZERO commits between them. In every case the convergent query was cheap
// (one `rg`, or a ~40-line script) and reproduced the reviewer's blocking
// finding mechanically — and on LIN-1717 the reviewer had already written the
// query down; the plan simply never cited it. John's 2026-09-12 ruling
// generalises that fix into three rules: research names the classes a ticket
// touches (with a bound, not necessarily a query); plan works from research's
// classes and is sent back only for a missing CLASS, never a missing member
// inside a class already correctly bounded; plan-review argues the class a
// missed member belongs to, not just the member.
//
// The un-sweepable escape hatch is UNCHANGED by this revision and stays
// pinned as before: a class may have no sweep, and a reviewer must check the
// REASON rather than the absence — otherwise the rule pushes plans toward
// inventing an authoritative-looking bound for a class that has none, which
// ends the conversation with the wrong answer instead of not ending it.

describe('class-not-member enumeration rule — research template (LIN-1871)', () => {
  const researchIssue = {
    id: 'issue-classes-research', identifier: 'TEST-CL0', title: 'Cover every call site',
    description: 'Handle the whole class', url: 'https://linear.app/test/issue/TEST-CL0',
    state: { name: 'Todo', type: 'unstarted' }, createdAt: '2026-01-01T00:00:00.000Z',
    labels: []
  };
  const ctx = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  test('requires naming each class, how it was bounded, and every member found', () => {
    const result = generatePrompt('research', researchIssue, ctx);
    assert.ok(/### Name the Classes/.test(result.prompt),
      'research prompt must carry the Name the Classes section');
    assert.ok(/name it, say how you bounded it, and list every member you found/i.test(result.prompt),
      'must pin the three-part obligation: name, bound, enumerate');
    assert.ok(/a query is one way to bound a class, not the only way/i.test(result.prompt),
      'a query must not be the only accepted form of bounding at research stage');
  });

  // LIN-3299: research's Goal told it to recommend "not final decisions on direction",
  // which contradicts its Scope and Authority (engineering choices are the agent's).
  test('research recommends an approach without being told the direction is not its to decide', () => {
    const { prompt } = generatePrompt('research', researchIssue, ctx);
    assert.doesNotMatch(prompt, /final decisions on direction/i);
    assert.match(prompt, /recommend an approach the next stage can build on/);
    const withComments = generatePrompt('research', researchIssue, { ...ctx, comments: [{ body: 'notes', user: 'Dev', createdAt: '2026-01-02T00:00:00.000Z' }] }).prompt;
    assert.ok(withComments.split('## Process')[1].includes('build on existing findings'), 'prior research is a process step, printed by code');
  });

  test('treats an unbound class as a first-class answer, naming the two recurring shapes', () => {
    const result = generatePrompt('research', researchIssue, ctx);
    assert.ok(/A class you could not bound is a first-class answer/i.test(result.prompt),
      'declaring a class unbound must not read as an omission');
    assert.ok(/destination that does not exist yet in the current source tree/i.test(result.prompt),
      'must name the moved-code-destinations shape (LIN-1717)');
    assert.ok(/production data rather than source/i.test(result.prompt),
      'must name the population-is-data shape (LIN-1731)');
  });

  test('hands the class list to the plan step, which extends it only with reason', () => {
    const result = generatePrompt('research', researchIssue, ctx);
    assert.ok(/Record each class, its bound, and its members in the description/i.test(result.prompt),
      'the class list needs a stated destination for the plan step to find');
    assert.ok(/plan step works from this list/i.test(result.prompt),
      'must state that plan is not free to re-derive classes from scratch');
    assert.ok(/only adds a class of its own if it can say why you missed it/i.test(result.prompt),
      'a new class at plan stage must be justified against research, not just added');
  });

  test('sits after Audit the Layers, before Surface Assessment', () => {
    const result = generatePrompt('research', researchIssue, ctx);
    const audit = result.prompt.indexOf('### Audit the Layers');
    const classes = result.prompt.indexOf('### Name the Classes');
    const surface = result.prompt.indexOf('### Surface Assessment');
    assert.ok(audit > -1 && classes > -1 && surface > -1, 'all three anchors present');
    assert.ok(audit < classes, 'class-naming follows the broader layer audit');
    assert.ok(classes < surface, 'and precedes the Surface Assessment verdict');
  });

  test('lists the class list among the research description output, where research records it', () => {
    const result = generatePrompt('research', researchIssue, ctx);
    assert.ok(/\*\*Description\*\*: Key findings, the class list/i.test(result.prompt),
      'the Output section must name the class list as a deliverable, not just imply it');
  });
});

describe('class-not-member enumeration rule — plan template (LIN-1871, revising LIN-1873)', () => {
  const planIssue = {
    id: 'issue-sweep-plan', identifier: 'TEST-SW1', title: 'Cover every call site',
    description: 'Handle the whole class', url: 'https://linear.app/test/issue/TEST-SW1',
    state: { name: 'Todo', type: 'unstarted' }, createdAt: '2026-01-01T00:00:00.000Z',
    labels: []
  };
  const ctx = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  test('works from research\'s classes and adds a class only with reason', () => {
    const result = generatePrompt('plan', planIssue, ctx);
    assert.ok(/Name the class, and how you bounded it — work from research.s classes/i.test(result.prompt),
      'plan prompt must carry the class-not-member directive, keyed to research');
    assert.ok(/add a class of your own only if you can say why research missed it/i.test(result.prompt),
      'a plan-added class must be justified against what research found');
  });

  test('requires a reproducible query as one way to bound a class, not the only way', () => {
    const result = generatePrompt('plan', planIssue, ctx);
    assert.ok(/reproducible query whose output IS the enumeration/i.test(result.prompt),
      'must pin the substantive clause — the query IS the enumeration, not a supporting note');
    assert.ok(/is one way to bound a class, and the strongest one where it applies/i.test(result.prompt),
      'a query must not be presented as the only accepted bound');
    assert.ok(/paste its output and record the commit sha it ran at/i.test(result.prompt),
      'a query with no output and no sha is not reproducible by the reviewer');
  });

  test('is sent back only for a missing class, never a missing member inside a bounded class', () => {
    const result = generatePrompt('plan', planIssue, ctx);
    assert.ok(/not sent back later for a missing member inside a class it correctly bounded/i.test(result.prompt),
      'the class-not-member bound must be stated as the plan\'s own send-back rule');
    assert.ok(/only for a class it should have named/i.test(result.prompt),
      'the only valid send-back reason is a missing class');
  });

  test('names the two un-sweepable shapes and makes declaring one a first-class answer', () => {
    const result = generatePrompt('plan', planIssue, ctx);
    assert.ok(/no sweep, and saying so is a first-class answer/i.test(result.prompt),
      'declaring a class un-sweepable must not read as an omission');
    // NOT `|| /destinations of new or moved code/`. The emphasis marker is part
    // of the clause; the loose alternative passes with it stripped, and the meta
    // counterpart was already tightened to the exact form. Review found the same
    // item fixed on one path and not the other -- the drift the both-paths rule
    // exists to prevent, inside this ticket's own tests.
    assert.ok(/destinations\* of new or moved code/i.test(result.prompt),
      'must name the moved-code-destinations shape (LIN-1717)');
    assert.ok(/production data rather than source/i.test(result.prompt),
      'must name the population-is-data shape (LIN-1731)');
  });

  test('bounds the un-sweepable escape hatch with a checkable criterion', () => {
    // The escape hatch is the rule's ONLY opt-out, so it is the one clause a
    // future edit can quietly widen back into "this class is awkward, therefore
    // I am exempt" -- which would hollow out the whole directive while leaving
    // every other assertion green. It shipped unpinned: review deleted the
    // criterion from BOTH paths and the suites stayed at 324/0 and 177/0.
    const result = generatePrompt('plan', planIssue, ctx);
    assert.ok(/not in the current source tree/i.test(result.prompt),
      'the test for a third un-sweepable shape must be stated, not left to judgement');
    assert.ok(/merely awkward to grep/i.test(result.prompt),
      'a hard-to-grep class must be excluded from the hatch by name');
    assert.ok(/harder query, not an absent one/i.test(result.prompt),
      'must say WHY it is excluded, or the exclusion reads as arbitrary');
  });

  test('names where the class, its bound and its members are recorded', () => {
    // A class the reviewer cannot find recorded is a hand-list with extra
    // steps, and check (1) of plan-review is written to go looking for it.
    const result = generatePrompt('plan', planIssue, ctx);
    assert.ok(/Record the class, its bound, and its members in the issue description/i.test(result.prompt),
      'the class, its bound and its members need a stated destination');
    assert.ok(/where plan-review will look for them/i.test(result.prompt),
      'the destination must be tied to the reader who consumes it');
  });

  test('warns against manufacturing a query, a script, or a checklist to fill the slot', () => {
    const result = generatePrompt('plan', planIssue, ctx);
    assert.ok(/Do not manufacture a query, a script, or a checklist to fill the slot/i.test(result.prompt),
      'the anti-incentive is the half that keeps the rule honest, and now excludes scripted forms too');
    assert.ok(/the rule asks for reasoning shown, not a form filled/i.test(result.prompt),
      'must state the rule is about reasoning, not a fixed vocabulary');
    assert.ok(/looks authoritative and is quietly incomplete/i.test(result.prompt),
      'must name WHY a fabricated bound is worse than none');
    assert.ok(/rather than trimming it until it agrees/i.test(result.prompt),
      'a disagreeing bound is a result to report, not something to tune');
  });

  test('sits inside the completeness check, before the per-surface notes', () => {
    const result = generatePrompt('plan', planIssue, ctx);
    const completeness = result.prompt.indexOf('**Completeness check.**');
    const classRule = result.prompt.indexOf('Name the class, and how you bounded it');
    const perSurface = result.prompt.indexOf('For each surface, note:');
    assert.ok(completeness > -1 && classRule > -1 && perSurface > -1, 'all three anchors present');
    assert.ok(completeness < classRule, 'the class rule extends the completeness check');
    assert.ok(classRule < perSurface, 'and stays ahead of the per-surface notes');
  });
});

describe('class-not-member enumeration rule — plan-review template (LIN-1871, revising LIN-1873)', () => {
  const reviewIssue = {
    id: 'issue-sweep-rev', identifier: 'TEST-SW2', title: 'Verify the plan',
    description: 'Plan is documented', url: 'https://linear.app/test/issue/TEST-SW2',
    state: { name: 'Todo', type: 'unstarted' }, createdAt: '2026-01-01T00:00:00.000Z',
    labels: []
  };
  const ctx = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  test('argues the class, not the member, when a missing member turns up', () => {
    const result = generatePrompt('plan-review', reviewIssue, ctx);
    assert.ok(/Completeness check — argue the class, not the member/i.test(result.prompt),
      'the check must be retitled to name the class-not-member rule');
    assert.ok(/If you find a member the plan lacks, do not stop there/i.test(result.prompt),
      'a found member must not end the finding by itself');
    assert.ok(/how you bounded that class, and every other member your bounding found/i.test(result.prompt),
      'the finding must widen to the whole class, not just the one member');
    assert.ok(/One round, whole class/i.test(result.prompt),
      'must pin the one-round-whole-class outcome');
    assert.ok(/a verdict that names a member and stops is incomplete/i.test(result.prompt),
      'a member-only verdict must be named as incomplete, however correct the member');
  });

  test('re-derives the plan\'s own bound before searching independently', () => {
    const result = generatePrompt('plan-review', reviewIssue, ctx);
    assert.ok(/re-derive that bound yourself/i.test(result.prompt),
      'the cheap mechanical check must come first');
    assert.ok(/re-run the query it cites at the sha it names, or redo the reasoning/i.test(result.prompt),
      'must accept a re-run OR a redone reasoning as ways to re-derive the bound');
    assert.ok(/Where the plan cites no bound for a class it claims to cover/i.test(result.prompt),
      'the independent search is the fallback, not the primary, and now keys on "bound" not "sweep"');
  });

  test('is sent back only for a missing or wrongly-bounded class', () => {
    const result = generatePrompt('plan-review', reviewIssue, ctx);
    assert.ok(/not sent back for a missing member inside a class already correctly bounded/i.test(result.prompt),
      'the class-not-member bound must be stated as plan-review\'s own send-back rule');
    assert.ok(/only for a missing or wrongly-bounded class/i.test(result.prompt),
      'the only valid Request Changes reason is a missing or wrongly-bounded class');
  });

  test('directs disagreement at the bound, because that is what converges', () => {
    const result = generatePrompt('plan-review', reviewIssue, ctx);
    assert.ok(/argue about the BOUND/i.test(result.prompt),
      'must redirect a disputed enumeration to the bound, not just "the sweep"');
    assert.ok(/Propose the class, the query or reasoning you would use instead, and show what it finds/i.test(result.prompt),
      'proposing a counter-class with its own bound is the concrete action');
    // One alternative only. The old second branch `one at a time do not` was a
    // SUBSTRING of the first, so the first could never be the deciding branch
    // and the effective assertion was silently the weaker one -- the same dead
    // -alternation defect review found two lines up, left behind by its fix.
    assert.ok(/discovering members one at a time do not/i.test(result.prompt),
      'must say why: member-by-member discovery does not converge');
  });

  test('an un-sweepable class is checked on its REASON, not treated as incomplete', () => {
    const result = generatePrompt('plan-review', reviewIssue, ctx);
    assert.ok(/declares a class un-sweepable is not thereby incomplete/i.test(result.prompt),
      'the reviewer must not demand a sweep that cannot exist');
    assert.ok(/Check the REASON, not the absence/i.test(result.prompt),
      'pins what the reviewer actually checks');
    assert.ok(/demand a sweep only where you can name the query/i.test(result.prompt),
      'a demand for a sweep must come with the query that would produce it');
  });

  test('stays check (1) — the completeness slot, ahead of Strategy Framing', () => {
    const result = generatePrompt('plan-review', reviewIssue, ctx);
    const one = result.prompt.indexOf('1. **Completeness check');
    const two = result.prompt.indexOf('2. **Strategy Framing');
    assert.ok(one > -1 && two > -1, 'both numbered checks present');
    assert.ok(one < two, 'the class-argument check belongs to check (1), not a new check');
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
    const hints = formatStageOptions();
    assert.ok(!hints.includes('reorient'),
      'retro should not appear in the stage options');
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

  // LIN-1136: bug label stays — no longer removed when the fix lands.
  test('bug label rule does not tell agent to remove the label after fix', () => {
    const result = generatePrompt('triage', mockIssue, mockContext);
    assert.ok(!result.prompt.includes('remove it when the fix lands'),
      'should not tell agent to remove the bug label when the fix lands');
  });

  // LIN-1136: triage is organization, not research.
  test('clarifies boundary — triage is organization, not research', () => {
    const result = generatePrompt('triage', mockIssue, mockContext);
    assert.ok(/organization/i.test(result.prompt), 'should describe triage as organization');
    assert.ok(/research step follows separately/i.test(result.prompt),
      'should note that research is a separate next step');
    assert.ok(/present analysis as completed research/i.test(result.prompt),
      'should warn against presenting analysis as completed research');
  });

  // LIN-1227: triage must not change task scope — no description/scope rewrite, no
  // follow-up task/subtask creation, mirroring breakdown's scope guardrail.
  test('(handwritten) forbids rewriting scope and creating follow-up tasks/subtasks', () => {
    const result = generatePrompt('triage', mockIssue, mockContext);
    assert.ok(/preserves? scope/i.test(result.prompt),
      'handwritten triage should state that it preserves scope');
    assert.ok(/rewrite the task's description/i.test(result.prompt),
      'handwritten triage should forbid rewriting the task description');
    assert.ok(/follow-up tasks or subtasks/i.test(result.prompt),
      'handwritten triage should forbid creating follow-up tasks or subtasks');
  });


  // ===========================================================================
  // LIN-2316: the displayed priority must never be a bare native (descending)
  // integer with no scale, and the priority-write authority must name exactly
  // one field — the provider-neutral, ascending `priorityLevel` — never the
  // native `priority` field. Field-scoped, not phrase-locked (LIN-2315):
  // assertions key on WHICH field is named/displayed, not on specific prose,
  // so a paraphrase that keeps naming the wrong field still fails.
  // ===========================================================================

  test('(f1) the Current State priority line is never a bare native integer — it always names the priorityLevel field', () => {
    // priority: 2 is a plain native (descending) int with no label attached,
    // the exact shape the live enqueueFeedbackTriage call site supplies —
    // the shape most exposed to reverting into a bare, unannotated int.
    const result = generatePrompt('triage', { ...mockIssue, priority: 2, priorityLabel: undefined }, mockContext);
    const currentState = result.prompt.slice(result.prompt.indexOf('## Current State'), result.prompt.indexOf('## Goal'));
    const priorityLine = currentState.split('\n').find(l => l.startsWith('**Priority:**'));
    assert.ok(priorityLine, 'Current State carries a Priority line');
    const displayedValue = priorityLine.replace(/^\*\*Priority:\*\*\s*/, '');
    assert.ok(!/^\d+\s*$/.test(displayedValue),
      'the priority value must not be a bare integer with no field/scale named');
    assert.ok(/\bpriorityLevel\b/.test(displayedValue),
      'the displayed value names the priorityLevel field');
    assert.ok(!/\bpriority\b(?!Level)/i.test(displayedValue),
      'the displayed value does not also name the bare native priority field');
  });

  test('(f2) a Not Set priority still renders through the same field-scoped path (no bare-int regression for the unset case)', () => {
    const result = generatePrompt('triage', { ...mockIssue, priority: undefined, priorityLabel: undefined }, mockContext);
    const currentState = result.prompt.slice(result.prompt.indexOf('## Current State'), result.prompt.indexOf('## Goal'));
    const priorityLine = currentState.split('\n').find(l => l.startsWith('**Priority:**'));
    assert.strictEqual(priorityLine, '**Priority:** Not set');
  });

  // LIN-3299: the role line became the Goal's lead, which grants the authority without
  // naming a field; the write field is named once, in the metadata bullet (f4).
  test('(f3) the Goal lead grants the metadata authority without naming any priority field', () => {
    const result = generatePrompt('triage', mockIssue, mockContext);
    const lines = result.prompt.split('\n');
    const lead = lines[lines.indexOf('## Goal') + 1];
    assert.match(lead, /priority/, 'the lead is the authority line');
    assert.deepStrictEqual(namedPriorityFields(lead), [],
      'the lead names no priority-family field, so never a bare native `priority`');
  });

  test('(f4) the Other Metadata Priority bullet names priorityLevel as the sole write field', () => {
    const result = generatePrompt('triage', mockIssue, mockContext);
    const metadataBullet = result.prompt.split('\n').find(l => l.trim().startsWith('- **Priority**:'));
    assert.ok(metadataBullet, 'the Other Metadata Priority bullet is present');
    assert.deepStrictEqual(namedPriorityFields(metadataBullet), ['priorityLevel'],
      'the metadata bullet names exactly priorityLevel — an unnamed write field (no backtick-quoted field at all) or a bare native `priority` both fail this');
  });

  // ===========================================================================
  // LIN-2317: the generated-prompt sibling of LIN-2316. LIN-2316 fixed only the
  // handwritten triage template (asserted by f1-f4 above); the meta-prompt's
  // "Triage prompts" quality rule and the triage aiHint.goal it feeds still
  // authorized a priority write without naming which field, so a model told
  // "you may change priority" could reach for the native (descending) `priority`
  // field and invert its intent. Field-scoped per LIN-2315: assertions key on
  // WHICH field is named, not on specific prose.
  // ===========================================================================


  // LIN-3300: the triage aiHint (a second copy of this write instruction) is gone. The
  // stage options say when triage is next and give no write instruction at all.
  test('(meta f6) the triage stage option carries no priority write field', () => {
    const options = formatStageOptions();
    const start = options.indexOf('- `triage`:');
    const triageBlock = options.slice(start, options.indexOf('\n- `', start + 1));
    assert.ok(start >= 0, 'the stage options include a triage entry');
    assert.deepStrictEqual(namedPriorityFields(triageBlock), [],
      'the triage option names no priority-family write field');
  });

  test('(f7) canonical priority 0 is annotated as unknown/none, not only the top of the scale', () => {
    const result = generatePrompt('triage', { ...mockIssue, priority: 0, priorityLabel: undefined }, mockContext);
    const currentState = result.prompt.slice(result.prompt.indexOf('## Current State'), result.prompt.indexOf('## Goal'));
    const priorityLine = currentState.split('\n').find(l => l.startsWith('**Priority:**'));
    assert.ok(priorityLine, 'Current State carries a Priority line');
    assert.ok(/\bpriorityLevel\s+0\b/.test(priorityLine), 'the displayed value names priorityLevel 0');
    assert.ok(/unknown\/none|unknown|none/i.test(priorityLine),
      'the scale note annotates 0 as unknown/none, not only the top of the scale');
    assert.ok(/4\s*=\s*highest/i.test(priorityLine), 'the scale note still explains the top of the scale');
  });

  test('(f8) a non-zero canonical priority is unaffected by the 0-annotation (no regression)', () => {
    const result = generatePrompt('triage', { ...mockIssue, priority: 2, priorityLabel: undefined }, mockContext);
    const currentState = result.prompt.slice(result.prompt.indexOf('## Current State'), result.prompt.indexOf('## Goal'));
    const priorityLine = currentState.split('\n').find(l => l.startsWith('**Priority:**'));
    assert.ok(/\bpriorityLevel\s+3\b/.test(priorityLine), 'native priority 2 maps to canonical priorityLevel 3');
    assert.ok(!/unknown/i.test(priorityLine), 'a set priority does not carry the unknown/none annotation');
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
    assert.ok(/UI\/route\/cross-module → e2e; pure function → unit/.test(result.prompt),
      'the test-level rule is stated once, in Test Quality Check');
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
    assert.ok(/You do NOT merge, mark the task Done, or file follow-ups/i.test(result.prompt),
      'review does not merge, mark Done, or file follow-ups: close-out files them (LIN-3293)');
    assert.ok(/Approve — conditional on close-out discharging the ledger/i.test(result.prompt),
      'a non-empty ledger forces a conditional approval');
    assert.ok(/the `close-out` step does, from the ledger you wrote/i.test(result.prompt), 'hands off to the close-out step');
    // The retired "merger owns it" framing must be gone.
    assert.ok(!/belong to whoever merges/i.test(result.prompt) && !/belong to the merger/i.test(result.prompt),
      'no longer hands to an undefined merger');
  });

  test('review concludes with an explicit verdict (folded in from code-review)', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.ok(/### Verdict/i.test(result.prompt), 'has a Verdict section');
    assert.ok(/Approve.*Request Changes.*Needs Discussion/s.test(result.prompt), 'lists the three verdicts');
  });

  test('Close-Out Gate cannot-close branch keeps a surfaced problem in this task and routes to the stage that fixes it (LIN-3291)', () => {
    const result = generatePrompt('review', mockIssue, mockContext);
    assert.ok(/cannot-close branch/i.test(result.prompt), 'names the cannot-close branch');
    assert.ok(/do NOT loop back into another `review`/i.test(result.prompt), 'forbids looping back to review');
    assert.ok(/that is still this task's work, its cause included/i.test(result.prompt), 'a bigger problem the fix exposed stays this work');
    assert.ok(/File no new ticket for it/.test(result.prompt), 'no new ticket is filed for it');
    assert.ok(!/Create a new Linear ticket for the surfaced work/.test(result.prompt), 'the old split-off instruction is gone');
    assert.ok(/name the stage that does it on this task as the next action: `implementation`, `bug`/.test(result.prompt),
      'the next action is the stage that fixes it here');
    assert.ok(/A `blocks` relation does not make the engine descend|a `blocks` relation does not make the engine descend/i.test(result.prompt),
      'linking an owning task still names the next action, because `blocks` does not drive descent');
    assert.ok(/Only a fix the team would need to hear about before it happens makes it \*\*Needs Discussion\*\*/.test(result.prompt),
      'only a team-level change goes to the human');
    // LIN-3293: John's definition is the clause itself. A bracketed list of
    // categories read as the definition and was turned into the test by a writer.
    assert.ok(!/before it happens \(/.test(result.prompt), 'no category list stands in for the definition');
    assert.ok(/stays open until it is fixed and CI is green/i.test(result.prompt), 'closes only after the fix and green CI');
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
      reviewSignal.signals.some(s => /Request Changes, naming the stage that fixes it here \(no new ticket\)/i.test(s)),
      'signals include the cannot-close outcome: the fix stays in this task (LIN-3291)'
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
// Research ends with a Surface Assessment gated on necessity (consumer test +
// who-pays test, third verdict for noticed-but-not-required improvements, size
// routed to sequencing), and plan turns only a necessary prerequisite refactor into
// a separate blocking subtask. These pin the gate, not just the section's presence.
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
    assert.ok(result.prompt.includes('Cause-or-consumer test'), 'must require the cause removed or the in-task consumer of the new seam');
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
// Assessment trigger and the small-task off-ramp; adds the
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

});

// Scale-to-task (lower bound, LIN-260). The heavy generative phases must tell the
// agent to size output to the task.
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
// LIN-177 S4/S5: Capability-aware prompts (provider.ui threaded into the stage and router prompts)
// =============================================================================
import { generateCustomPrompt } from '../../lib/prompt-templates.js';
import { resolvePromptUi, applyPromptCapabilities, DEFAULT_PROMPT_UI, formatSubtaskSummary, appendGroundingSections, formatPlanFidelityCheck, formatAttachmentsSection, formatAttachmentPerceptionCheck, formatIfBlocked } from '../../lib/prompt-formatters.js';
import { formatIssueContext, buildSelectorArgs } from '../../lib/openrouter.js';
import { buildRouterPrompt } from '../../lib/stage-router.js';

/** The stage selector's prompt for a small open leaf (LIN-3300). */
const selectorPrompt = (providerUi = null) => buildRouterPrompt(buildSelectorArgs(
  { identifier: 'LIN-900', title: 't', description: 'd', state: { name: 'Todo', type: 'unstarted' }, labels: [] },
  { parent: null, siblings: [], project: null, children: [], comments: [] }, {}, providerUi));
/** One numbered rule of the selector's "How to choose", up to the next. */
const selectorRule = (n) => { const p = selectorPrompt(); const a = p.indexOf(`${n}. **`); return p.slice(a, p.indexOf('\n', a)); };
import { formatStageContract } from '../../lib/prompt-contract.js';
import { formatNodeFactsBlock } from '../../lib/recommendation-facts.js';
import { formatStageIntent, withStageIntent } from '../../lib/prompts/stage-intent.js';

describe('resolvePromptUi (LIN-177 S4)', () => {
  test('no provider → Linear floor (every capability on, displayName Linear)', () => {
    assert.deepStrictEqual(resolvePromptUi({}, null), {
      displayName: 'Linear', write: true, subtasks: true, comments: true, includeTracker: true,
      // LIN-2361: null — Linear's real state vocabulary needs an async/per-team fetch, so no
      // synchronous vocabulary is ever available here; the "Set status" wording is left as-is.
      fixedStates: null
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

  test('routing prompt: explicit Linear ui is a no-op vs. no provider', () => {
    assert.strictEqual(selectorPrompt(LINEAR_UI), selectorPrompt());
  });
});

describe('selector rule 2: landed work (LIN-364, LIN-474, LIN-811)', () => {
  test('rule 2 orders the landing stages; the stages say when each applies, said once', () => {
    assert.match(selectorRule(2), /against `retrospective-audit`, `close-out`, the `implementation` fix round \(on the same PR\) and `review`, in that order; a terminal state with no open subtask counts as landed work/);
    const options = formatStageOptions();
    assert.match(options, /- `review`: [^\n]*\n  When: Work has landed \(a PR or completion summary on the trail, or every subtask done\)/);
    assert.match(options, /Requires: An Approve from a code review; a plan-review Approve is not one\./);
    assert.match(options, /CI is red, or verifying the work surfaced a blocker: that is `implementation` \(or `bug`, or `blocked` if only a person can settle it\) on this ticket first/);
  });
});

describe('meta-prompt retrospective-audit routing + quality rule (LIN-2261)', () => {
  test('rule 2 names retrospective-audit for merged-and-Done work, distinct from review/close-out', () => {
    assert.match(selectorRule(2), /against `retrospective-audit`, `close-out`/);
    assert.match(formatStageOptions(), /- `retrospective-audit`: [^\n]*\n  When: The work is merged and Done, with a code review on record\./);
  });

  test('retrospective-audit is offered in the AI recommendation vocabulary (unlike retro)', () => {
    const names = actionNames();
    assert.ok(names.includes('retrospective-audit'), 'retrospective-audit must be an emittable action');
    assert.ok(!names.includes('retro'), 'retro stays excluded from AI recommendation');
  });

  test('retrospective-audit derives to a real (non-custom) dispatch kind', () => {
    assert.notStrictEqual(deriveDispatchKind('retrospective-audit'), 'custom');
  });
});

describe('selector design shape-fork routing + stage discriminators (LIN-878)', () => {
  test('rule 7 routes a contested shape to design, after knowledge and before the plan', () => {
    assert.match(selectorRule(7), /Then `design`, when it applies\. Why: a plan should not pick the architecture silently\./);
    const p = selectorPrompt();
    assert.ok(p.indexOf('6. **Knowledge.**') < p.indexOf('7. **Shape.**') && p.indexOf('7. **Shape.**') < p.indexOf('8. **Plan.**'), 'after knowledge, before the plan');
  });

  // LIN-3300: the discriminators are each stage's own "Not when", rendered for every stage.
  test('formatStageOptions renders the design/scoping/spike discriminators', () => {
    const options = formatStageOptions();
    const entry = (key) => { const i = options.indexOf(`- \`${key}\`:`); return options.slice(i, options.indexOf('\n- `', i + 1)); };
    assert.match(entry('design'), /Not when: One obvious shape, an approach the ticket or comments already committed to, landed work, or knowledge still ungathered \(`research`\)/);
    assert.match(entry('scoping'), /Not when: The gap is knowledge to gather[^\n]*\(`research`\); only the solution shape is open \(`design`\)/);
    assert.match(entry('spike'), /Not when: The gap is broader understanding \(`research`\)/);
    assert.match(entry('retrospective-audit'), /Not when: The work has not merged \(`review`\)/);
  });

  test('every selectable stage says when it is next and when it is not', () => {
    const options = formatStageOptions();
    const n = actionNames().length;
    assert.strictEqual((options.match(/^  When: /gm) || []).length, n, 'one When per stage');
    assert.strictEqual((options.match(/^  Not when: /gm) || []).length, n, 'one Not when per stage');
  });
});

// =============================================================================
// retrospective-audit template (LIN-2261) — the post-merge audit verb
// =============================================================================

describe('retrospective-audit template', () => {
  const mockIssue = {
    id: 'issue-retro-audit',
    identifier: 'LIN-2261',
    title: 'Test Task',
    description: 'Test description',
    url: 'https://linear.app/test/issue/LIN-2261',
    labels: [],
    createdAt: '2026-08-01T00:00:00Z'
  };
  const mockContext = { parent: null, siblings: [], project: null, children: [], comments: [] };

  test('is registered with category UNIVERSAL, a route, and completionSignals', () => {
    const template = PROMPT_TEMPLATES['retrospective-audit'];
    assert.ok(template, 'retrospective-audit template must exist');
    assert.strictEqual(template.category, PROMPT_CATEGORIES.UNIVERSAL);
    assert.ok(template.route, 'must have a route so the selector offers it');
    assert.ok(template.completionSignals, 'must have completionSignals');
  });

  test('is part of the AI recommendation vocabulary (unlike retro)', () => {
    const names = actionNames();
    assert.ok(names.includes('retrospective-audit'), 'retrospective-audit must be recommendable');
  });

  test('generates a prompt that opens from the fact the change is already merged', () => {
    const result = generatePrompt('retrospective-audit', mockIssue, mockContext);
    assert.strictEqual(result.name, 'retrospective-audit');
    assert.ok(/already merged/i.test(result.prompt), 'must state the change is already merged');
    assert.ok(!/status to "In Progress"/i.test(result.prompt), 'must not change status — read-only');
  });

  test('does not re-verify overall correctness and focuses on claims + test integrity', () => {
    const result = generatePrompt('retrospective-audit', mockIssue, mockContext);
    assert.ok(/re-verify overall correctness/i.test(result.prompt), 'must disclaim re-verifying correctness');
    assert.ok(/Audit the Claims/i.test(result.prompt), 'must audit claims');
    assert.ok(/Audit Test Integrity/i.test(result.prompt), 'must audit test integrity');
    assert.ok(/Ownership Orphans/i.test(result.prompt), 'must check ownership orphans');
  });

  test('forbids state changes and follow-up filing', () => {
    const result = generatePrompt('retrospective-audit', mockIssue, mockContext);
    assert.ok(/do not change status, labels/i.test(result.prompt), 'must forbid status/label changes');
    assert.ok(/do not merge or mark anything Done/i.test(result.prompt), 'must forbid merge/Done');
    assert.ok(/file a follow-up ticket, readable on its own, for each finding that still matters/i.test(result.prompt), 'must file follow-ups for findings that matter (LIN-3291)');
  });

  test('reports findings as a comment (read-only workflow), not a Linear write beyond the comment', () => {
    const result = generatePrompt('retrospective-audit', mockIssue, mockContext);
    assert.ok(/Add findings as a comment/i.test(result.prompt), 'workflow ends in a findings comment');
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
    assert.ok(t.route, 'has a route so the selector offers it');
    assert.ok(COMPLETION_SIGNALS['close-out'], 'has a registered completion signal');
    assert.strictEqual(t.completionSignals, COMPLETION_SIGNALS['close-out'], 'template wires its completion signal');
  });

  test('(a) close-out reads the review ledger and settles each item before the merge it gates', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/most recent review summary comment/i.test(prompt), 'reads the latest review comment');
    assert.ok(/### Settle the Ledger/.test(prompt), 'has the ledger section');
    assert.ok(/Review marked each item \*\*inside\*\*.*or \*\*outside\*\*/.test(prompt),
      'the settling route is keyed on review\'s inside/outside mark');
    assert.ok(/may be accepted by a person, but only one who names the exact precondition they exercised/i.test(prompt),
      'any item may also be accepted by a human naming the precondition');
    const workflow = prompt.slice(prompt.indexOf('## Workflow'), prompt.indexOf('## Context'));
    assert.ok(/Once the items that belong before the merge are settled, merge/.test(workflow),
      'the merge waits on the items that belong before it');
  });

  // Ruling on LIN-2825: scope discharges by done or an explicit drop, never by
  // filing. Extends the LIN-550 ledger gate and the LIN-1871 class-bound
  // enumeration with an inside/outside mark, failing independently of the plain
  // LIN-550 pins above.
  describe('scope discharges by done, not by filing (LIN-2825, extending LIN-550 + LIN-1871)', () => {
    test('review marks class-check instances and ledger items inside/outside the ticket\'s bounded classes', () => {
      const { prompt } = generatePrompt('review', issue, context);
      assert.ok(/Inside or Outside the Ticket's Scope/i.test(prompt), 'review has the inside/outside scope section');
      assert.ok(/A finding inside a bounded class is scope/i.test(prompt), 'states rule 1 of the ruling');
      assert.ok(/scope discharges by done or an explicit drop, never by filing/i.test(prompt), 'states rule 2 of the ruling');
      assert.ok(/mark it \*\*inside\*\* or \*\*outside\*\* the ticket's bounded classes/i.test(prompt),
        'the ledger instruction requires marking each item inside/outside');
      assert.ok(/filing a ticket for it is never a discharge, since it belongs to this ticket/i.test(prompt),
        'the ledger instruction states filing never discharges an inside item');
    });

    test('close-out settles an inside item only by done, or leaves it undone for a team-level reason; never by filing', () => {
      const { prompt } = generatePrompt('close-out', issue, context);
      assert.ok(/\*\*Inside\*\*: done, shown by evidence you cite/.test(prompt), 'an inside item is settled by cited evidence of done');
      assert.ok(/Filing a ticket never settles inside work/.test(prompt), 'filing never settles an inside item');
      assert.ok(/Leave one undone only when finishing it is a change the team would need to hear about first, and say in your summary exactly what is left and why/.test(prompt),
        'an inside item is left undone only for a change the team would hear about first (LIN-3291), and said so');
    });

    test('close-out lets an outside item be settled by a self-contained filed ticket', () => {
      const { prompt } = generatePrompt('close-out', issue, context);
      assert.ok(/\*\*Outside\*\*: file it as a follow-up a reader with no access to this task can act on/.test(prompt),
        'an outside item is filed, and the filing stands alone');
    });

    // LIN-3006: the drop-then-file route is removed on purpose — inside work is
    // done or left undone with its reason, never filed.
    test('close-out files outside items only — inside work is never filed', () => {
      const { prompt } = generatePrompt('close-out', issue, context);
      assert.ok(/Only outside items are filed here; inside work is done or left undone with its reason, never filed/.test(prompt),
        'follow-up triage files outside items only');
      assert.ok(!/inside-scope items you have explicitly dropped in the summary above, are eligible to be filed/i.test(prompt),
        'the drop-then-file route stays removed');
      const workflow = prompt.slice(prompt.indexOf('## Workflow'), prompt.indexOf('## Context'));
      assert.ok(/file the outside follow-ups/.test(workflow), 'the workflow files outside follow-ups only');
    });

    test('review and close-out limit ruling options to outside-only filing', () => {
      const review = generatePrompt('review', issue, context).prompt;
      const closeout = generatePrompt('close-out', issue, context).prompt;
      const rulingClause = /an inside item's options are "do it here" or "drop it, with the reason"; "file" is offered only for an outside item/i;
      assert.ok(rulingClause.test(review), 'review limits ruling options to outside-only filing');
      assert.ok(rulingClause.test(closeout), 'close-out limits ruling options to outside-only filing');
    });

    test('inside is defined by kind (defect/idiom), not by research\'s enumerated list', () => {
      const review = generatePrompt('review', issue, context).prompt;
      const kindNotList = /its cause included wherever it lives, or the same defect or idiom as a class this ticket bounded, whether or not research\'s enumeration listed it/i;
      assert.ok(kindNotList.test(review), 'review defines inside by kind, not by the research list');
      assert.ok(/a different problem — not this ticket\'s or its cause/i.test(review), 'outside is a different problem, never this ticket\'s cause');
    });

    // LIN-3006 review fixup: the kind-not-list rewrite dropped the pre-existing
    // "or a claim this ticket's own change depends on" disjunct, which every
    // What-CI-Did-Not-Prove ledger item satisfies by definition. This pin fails
    // against the wording landed on PR #1554 before the fixup (kind-only, no
    // disjunct) and passes once the disjunct is restored.
    test('inside also covers a claim this ticket\'s own change depends on, alongside the kind definition', () => {
      const review = generatePrompt('review', issue, context).prompt;
      assert.ok(/whether or not research's enumeration listed it — the list is evidence of the class, not its edge — or a claim this ticket's own change depends on/i.test(review),
        'the dependency-claim disjunct sits alongside the kind-not-list definition');
    });

    test('the named-monitor/named-rollback routes remain — a different axis from scope', () => {
      const review = generatePrompt('review', issue, context).prompt;
      const closeout = generatePrompt('close-out', issue, context).prompt;
      assert.ok(/\*\*A named monitor\*\*/.test(review) && /\*\*A named rollback\*\*/.test(review), 'review still carries both named routes');
      assert.ok(/\*\*A named monitor or rollback\*\*: cite the name review wrote/.test(closeout), 'close-out still honours both named routes');
      assert.ok(/This marking is separate from how each item is settled, below/.test(review),
        'review states the scope mark is orthogonal to how an item is settled');
    });
  });

  // LIN-3326: close-out finishes the work. It makes the fixes review asked for
  // itself, however many files they touch, as long as they stay the size of fixes,
  // merges, and does the post-deploy steps once the deploy has landed; review
  // records those steps as after the merge, never as conditions on it. This
  // replaces the LIN-3033 authoring bound (2 files / 3 hunks of review-quoted
  // text, merge conflicts and "do it here" never eligible) and LIN-3056's
  // narrowing of the conditional Approve to that bound, both removed on purpose:
  // on LIN-3325 they left no agent able to finish an approved, green task.
  describe('close-out finishes the work (LIN-3326)', () => {
    test('close-out makes the fixes review asked for, whatever their file count, and hands back only what is more than a fix', () => {
      const { prompt } = generatePrompt('close-out', issue, context);
      assert.ok(/### Make the Fixes Review Asked For/.test(prompt), 'has the fixes section');
      assert.ok(/Make them yourself, however many files they touch, and resolve any conflict landing the PR needs/.test(prompt),
        'fixes and a merge conflict are close-out\'s own, with no file or hunk count');
      assert.ok(!/at most 2 files and 3 hunks/i.test(prompt) && !/trivially small/i.test(prompt), 'the old size bound is gone');
      assert.ok(/one that turns out to need a new design or new behaviour is not a fix, so hold the merge and name `review` next/.test(prompt),
        'a new design or new behaviour goes back to review');
      assert.ok(/Nobody reviews what you change after the approval, so list each change in your summary/.test(prompt),
        'the reason for recording each change is kept with the rule');
      assert.ok(/re-establish CI on the new head before merging/.test(prompt) && /--match-head-commit/.test(prompt),
        'CI is re-established on the new head and the merge is pinned to it');
    });

    test('a post-deploy step runs after the merge, once the deploy has landed, and never holds the merge', () => {
      const { prompt } = generatePrompt('close-out', issue, context);
      assert.ok(/\*\*An item that can only run once the change is live\*\* \(a live check, a data clean-up\): do it after the merge, once the deploy has landed/.test(prompt),
        'a live check or a clean-up runs after the merge');
      assert.ok(/It is never a reason to hold the merge/.test(prompt), 'a post-deploy step is not a merge condition');
      assert.ok(/wait until the deploy has landed \(the deployed commit is your merge or later; Harbour shows its own in the page footer\)/.test(prompt),
        'the deploy signal is named');
      const land = prompt.slice(prompt.indexOf('### Land It and Close the Loop'));
      const deployAt = land.search(/wait until the deploy has landed/);
      const doneAt = land.search(/Then set the task to Done/);
      assert.ok(deployAt > -1 && doneAt > deployAt, 'Done comes after the post-deploy steps');
      assert.ok(/If a post-deploy step fails or is beyond your access, the task stays open/.test(prompt),
        'a failed post-deploy step keeps the task open');
    });

    test('close-out closes the loop on the related tickets the work settles', () => {
      const { prompt } = generatePrompt('close-out', issue, context);
      assert.ok(/Close or cancel the related tickets this work settles, saying why/.test(prompt));
    });

    test('engineering calls in finishing the work are close-out\'s; only a team-level change goes to the human', () => {
      const { prompt } = generatePrompt('close-out', issue, context);
      assert.ok(/Engineering calls in finishing the work are yours/.test(prompt));
      assert.ok(/Only a change the team would need to hear about before it happens goes to the human/.test(prompt));
    });

    test('review records post-deploy steps as after the merge, never as conditions on it', () => {
      const { prompt } = generatePrompt('review', issue, context);
      assert.ok(/\*\*After the deploy\*\*: a step that can only run once the change is live, such as a live check or a data clean-up\. Record it as a post-deploy step close-out does after the merge, never as a condition on the merge\./.test(prompt));
      assert.ok(!/hard close-out \*gate item\*/i.test(prompt) && !/stays a hard gate item/i.test(prompt),
        'no claim is turned into a hard pre-merge gate');
    });

    test('review approves conditionally for a ledger or named fixes, and sends back only new design or behaviour', () => {
      const { prompt } = generatePrompt('review', issue, context);
      assert.ok(/the verdict is `Approve — conditional on close-out discharging the ledger`, never a bare Approve/.test(prompt),
        'the machine-read conditional verdict is unchanged (lib/run-ledger.js classifyVerdict)');
      assert.ok(/only an explicitly empty ledger with nothing to fix may carry a plain \*\*Approve\*\*/.test(prompt));
      assert.ok(/Close-out makes the fixes you name itself, however many files they touch, so name each precisely enough to make without guessing/.test(prompt),
        'review names each fix precisely, with no size bound');
      assert.ok(/When the work still needs a new design or new behaviour, the verdict is \*\*Request Changes\*\* back to `implementation`/.test(prompt));
      assert.ok(!/trivial, review-named-edit bound/i.test(prompt), 'the LIN-3033 bound no longer narrows the verdict');
    });
  });

  // LIN-2991/LIN-3022 §5: two idempotency clauses inserted immediately after
  // LIN-3006's own "file is offered only for an outside item" eligibility
  // clause, at each of review, close-out step 8, and Follow-up Triage —
  // LIN-3006's own boundary (which decisions may offer "file" at all) is
  // untouched; this only adds an existence/re-raise check on top of it.
  describe('idempotency guidance — existing-ticket check and no-re-raise (LIN-2991/LIN-3022 §5)', () => {
    const existingTicketClause = /before filing an outside item.*search the anchor's relations.*GET \/api\/proxy\/issues\/\{id\}\/relations.*GET \/api\/proxy\/search.*if one exists,? link it/is;
    const noReRaiseClause = /before raising a `DECISION:` on a finding.*GET \/api\/proxy\/rulings\?issueIdentifier=<anchor>&includeResolved=true.*do not re-raise a finding.*includeResolved.*covers loop-backed rulings only, never a task-bound one/is;

    // LIN-3293: one owner for filing. Review files nothing, so it carries the
    // no-re-raise check but not the filing check; close-out files the outside
    // items and runs the existing-ticket check before each.
    test('review carries the no-re-raise clause after the LIN-3006 eligibility clause, and leaves filing to close-out', () => {
      const review = generatePrompt('review', issue, context).prompt;
      const eligibilityIdx = review.search(/"file" is offered only for an outside item/i);
      const noReRaiseIdx = review.search(noReRaiseClause);
      const nextSectionIdx = review.indexOf('### Test Quality Check');
      assert.ok(eligibilityIdx > -1, 'sanity: LIN-3006\'s eligibility clause is present');
      assert.ok(eligibilityIdx < noReRaiseIdx && noReRaiseIdx < nextSectionIdx, 'the no-re-raise clause sits after the eligibility clause');
      assert.equal(review.search(existingTicketClause), -1, 'review files nothing, so it has no filing check');
      assert.match(review, /close-out files it, after checking it does not already exist/);
    });

    test('Follow-up Triage carries both clauses, immediately after the eligibility clause and before the Priority bullet', () => {
      const closeout = generatePrompt('close-out', issue, context).prompt;
      const eligibilityIdx = closeout.search(/"file" is offered only for an outside item/i);
      const existingIdx = closeout.search(existingTicketClause);
      const noReRaiseIdx = closeout.search(noReRaiseClause);
      const priorityIdx = closeout.indexOf('**Priority**');
      assert.ok(eligibilityIdx > -1 && existingIdx > -1 && noReRaiseIdx > -1, 'all three clauses are present');
      assert.ok(eligibilityIdx < existingIdx && existingIdx < noReRaiseIdx && noReRaiseIdx < priorityIdx,
        'both new clauses sit after the eligibility clause and before the Priority bullet, in order');
    });

    // LIN-3006's own pins (the block above and this ticket's own review/
    // close-out describe) must stay green unmodified — re-asserted here so a
    // future edit to this new describe block cannot silently regress them.
    test('LIN-3006\'s own eligibility clause and boundary are untouched by the new clauses', () => {
      const review = generatePrompt('review', issue, context).prompt;
      const closeout = generatePrompt('close-out', issue, context).prompt;
      const rulingClause = /an inside item's options are "do it here" or "drop it, with the reason"; "file" is offered only for an outside item/i;
      assert.ok(rulingClause.test(review), 'review still limits ruling options to outside-only filing, unchanged');
      assert.ok(rulingClause.test(closeout), 'close-out still limits ruling options to outside-only filing, unchanged');
    });

  });

  test('(b) review writes a structured ledger; close-out reads it without keying on the heading (LIN-810 decoupling)', () => {
    const review = generatePrompt('review', issue, context).prompt;
    const closeout = generatePrompt('close-out', issue, context).prompt;
    // Review still emits the structured heading — helpful structure when present.
    assert.ok(review.includes('### What CI Did Not Prove'), 'review writes the ### What CI Did Not Prove ledger');
    assert.ok(/record it in one summary comment: the ledger/i.test(review),
      'review records the ledger into its summary comment (the carrier)');
    assert.ok(/Put the ledger under `### What CI Did Not Prove`/.test(review),
      'the ledger heading is the stage contract\'s (LIN-3292)');
    // Close-out does not require that exact string — it reads the ledger generically.
    assert.ok(!closeout.includes('### What CI Did Not Prove'),
      'close-out does not key on the literal heading (decoupled)');
    assert.ok(/the ledger of what CI did not prove/i.test(closeout),
      'close-out reads the review\'s ledger generically');
  });

  test('(c) empty ledger => close-out has nothing to settle; review allows an unconditional Approve only then', () => {
    const closeout = generatePrompt('close-out', issue, context).prompt;
    assert.ok(/An explicitly empty ledger has nothing to settle, so do not manufacture doubt about a self-contained change/.test(closeout),
      'an explicitly empty ledger is a pass-through, not a reason for doubt');
    const review = generatePrompt('review', issue, context).prompt;
    assert.ok(/only an explicitly empty ledger with nothing to fix may carry a plain \*\*Approve\*\*/i.test(review),
      'review permits a plain Approve only when the ledger is explicitly empty and nothing is to be fixed');
    assert.ok(/An explicitly empty ledger leaves close-out nothing to settle/i.test(review),
      'review states the empty-ledger contract');
  });

  test('(d) the gate invariants are present in the rendered close-out body', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    // 1. a missing verdict, or an Approve with no ledger at all, goes back to review (LIN-3291)
    assert.ok(/With no review verdict on record, or an Approve with no ledger at all \(an explicitly empty one is fine\), the work is not ready: leave the task open and name `review` next/.test(prompt),
      'a missing verdict or ledger goes back to review, never read as empty');
    // 2. green CI alone never discharges a ledger item
    assert.ok(/Green CI is never evidence for a ledger item/i.test(prompt),
      'green CI never discharges a ledger item');
    // 3. human acceptance counts only if it names the exact precondition
    assert.ok(/only one who names the exact precondition they exercised/i.test(prompt),
      'explicit human acceptance must name the exact precondition');
  });

  test('(f) close-out is verdict-gated, not heading-gated (LIN-810)', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(!/Missing or unparseable ledger BLOCKS/i.test(prompt),
      'the old missing-ledger hard-block language is removed');
    assert.ok(!/route back to `review` to \(re\)write/i.test(prompt),
      'no longer routes back to review over a missing heading');
    assert.ok(/Review has recorded its verdict and what green CI did not prove in its summary comment/.test(prompt),
      'close-out starts from the recorded verdict');
  });

  test('(f2) the recorded Approve IS the authorization — no fresh human go-ahead required (LIN-1365)', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/A recorded review Approve is your authority to finish; no fresh "go ahead" is needed/.test(prompt),
      'the recorded Approve is the authorization, with no fresh go-ahead');
    assert.ok(/Green CI is never evidence for a ledger item/i.test(prompt),
      'green CI still never discharges a ledger item');
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

  test('(meta) the selector offers close-out after a code review approves', () => {
    assert.match(selectorRule(2), /`close-out`/);
    assert.match(formatStageOptions(), /- `close-out`: [^\n]*\n  When: The latest code review approved/);
  });

  // ===========================================================================
  // Archive + prune superseded stage artifacts on successful close-out (LIN-1770)
  // ===========================================================================

  test('(g1) archive+prune follows the summary and precedes filing follow-ups', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    const land = prompt.slice(prompt.indexOf('### Land It and Close the Loop'));
    const summaryAt = land.search(/Post the summary comment/);
    const archiveAt = land.search(/archive and prune the description/);
    const followUpsAt = land.search(/file the outside follow-ups/);
    assert.ok(summaryAt > -1 && archiveAt > -1 && followUpsAt > -1, 'all three steps are present');
    assert.ok(summaryAt < archiveAt && archiveAt < followUpsAt,
      'archive+prune sits strictly between the summary post and follow-up filing');
  });

  test('(g2) the workflow list also carries archive & prune before filing follow-ups', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    const workflow = prompt.slice(prompt.indexOf('## Workflow'), prompt.indexOf('## Context'));
    const archiveAt = workflow.search(/archive & prune the description/);
    const followUpsAt = workflow.search(/file the outside follow-ups/);
    assert.ok(archiveAt > -1 && followUpsAt > -1 && archiveAt < followUpsAt,
      'the workflow list sequences archive & prune before filing follow-ups');
  });

  test('(g3) archive-first uses the zero-spend brief flag, then verifies the snapshot landed before pruning', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/brief\?noRefresh=1/.test(prompt), 'archive step calls the brief endpoint with noRefresh=1 (zero LLM spend)');
    assert.ok(/GET \/api\/proxy\/issues\/LIN-901\/snapshots/.test(prompt),
      'verify step reads the snapshot listing before editing');
    assert.ok(/fire-and-forget server-side and swallows its own errors/i.test(prompt),
      'a 200 from the archive call is explicitly NOT treated as proof it captured anything');
  });

  test('(g4) prune uses a full PATCH rewrite, and the never-prune list explicitly carries scope', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/PATCH \/api\/proxy\/issues\/:id/.test(prompt), 'prune uses the full-body PATCH rewrite');
    assert.ok(/\*\*Never prune\*\*/.test(prompt), 'a never-prune carve-out is named');
    assert.ok(/original problem statement, acceptance criteria, reproduction steps, scope/i.test(prompt),
      'never-prune explicitly lists scope alongside problem statement/acceptance criteria/repro steps');
    assert.ok(/single source of truth.*stands/i.test(prompt),
      'never-prune cross-references the scoping template\'s single-source-of-truth wording rather than contradicting it');
  });

  test('(g5) the stub must preserve the session-fit phrase or Implementation Plan heading verbatim', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    // Carried by the stage contract (LIN-3292), appended by code after the brief.
    assert.ok(/keep word for word any `Implementation Plan` heading/i.test(prompt),
      'the marker-preservation mandate is explicit and verbatim');
    assert.ok(/fits one session.*needs multiple sessions/.test(prompt), 'both session-fit phrases are named');
    assert.ok(/any `plan-review due:` line/.test(prompt), 'LIN-3296: the plan-review gate marker survives the prune');
    assert.ok(/code reads them there/i.test(prompt),
      'the prompt explains WHY the literals matter, so an implementer does not "clean up" the wording');
  });

  test('(g6) archive+prune runs only on the all-clear path, never on the cannot-close branch', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/This step runs only here, after the merge and the Done transition, on the successful all-clear path/i.test(prompt),
      'the prune step is explicitly scoped to the all-clear path');
    assert.ok(/never on a cannot-close branch, and never on a task that stays open with Request Changes/i.test(prompt),
      'the prune step explicitly excludes the cannot-close / stays-open branches');
  });

  test('(g7) comments stay untouched by policy — the prune is a description-only edit', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/Comments are untouched by policy/i.test(prompt),
      'comments are explicitly out of scope for the prune, stated as a policy choice rather than a capability gap');
    assert.ok(/the prune is a description edit only/i.test(prompt), 'the policy distinction is preserved');
    assert.ok(/using the existing write surface/i.test(prompt), 'the prune uses only existing write surfaces');
    // The comment-edit route aside was a note for rule authors, not the agent (LIN-3293 dedup).
  });

  test('(g8) close-out still emits no literal "Linear" with the archive+prune section included (LIN-177 parity)', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/Archive & Prune/.test(prompt), 'sanity: the new section is actually present in this render');
    assert.ok(!prompt.includes('Linear'), 'the archive+prune addition introduces no literal "Linear"');
  });

  test('(g9) archive-verification failure branch: skip-and-close is sited between verify and prune, and names the post-merge discriminator', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    const section = prompt.slice(prompt.indexOf('### Archive & Prune Superseded Stage Artifacts'));
    const verifyAt = section.search(/\d\. \*\*Verify the archive landed\*\*/);
    const failureAt = section.search(/\d\. \*\*If the snapshot cannot be verified\*\*/);
    const pruneAt = section.search(/\d\. \*\*Prune\*\*/);
    assert.ok(verifyAt > -1 && failureAt > -1 && pruneAt > -1, 'all three steps are present');
    assert.ok(verifyAt < failureAt && failureAt < pruneAt,
      'the failure branch sits strictly between verification and pruning');
    assert.ok(/do not prune/i.test(section) && /close the task anyway/i.test(section),
      'the branch states do-not-prune and close-anyway');
    assert.ok(/record in the close-out summary that the archive could not be confirmed and the prune was skipped/i.test(section),
      'the branch requires recording the skip in the summary');
    assert.ok(/never hold open, re-route, or reopen a task whose merge and Done transition have landed/i.test(section),
      'the branch prohibits holding open, re-routing, or reopening');
    assert.ok(/merge and Done transition are already irreversible/i.test(section) || /merge and Done transition have landed/i.test(section),
      'the branch names the post-merge/Done discriminator — this is what distinguishes it from the pre-merge gate');
  });


  test('(g12) coreOutcome and readinessCheck carry the "(or the skip recorded)" wording together — never readinessCheck alone', () => {
    const sig = COMPLETION_SIGNALS['close-out'];
    assert.ok(/archived and pruned of superseded stage artifacts \(or the skipped prune recorded\)/i.test(sig.coreOutcome),
      'coreOutcome carries the skipped-prune parenthetical');
    assert.ok(/archived-and-pruned \(or the skip recorded\)/i.test(sig.readinessCheck),
      'readinessCheck carries the matching parenthetical, so the two fields state one contract, not two');
    assert.ok(sig.readinessCheck.trim().endsWith('?'),
      'the question-mark invariant is preserved (locked separately in tests/unit/completion-signals.test.js:86)');
    assert.ok(sig.signals.some(s => /where the archive could not be verified, the prune skipped and that recorded in the summary/i.test(s)),
      'signals[] carries the same contract for consistency, even though it reaches no prompt path');
  });

  // ===========================================================================
  // Catalog text pinned to the template body's step ordering (LIN-1773)
  // ===========================================================================

  test('(h1) sanity: the close-out body states merge→done→summary→archive→prune→follow-up in order', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    const land = prompt.slice(prompt.indexOf('### Land It and Close the Loop'), prompt.indexOf('### Follow-up Triage'));
    const steps = [/Merge pinned/, /set the task to Done/, /Post the summary comment/, /archive and prune/, /file the outside follow-ups/];
    const positions = steps.map(re => land.search(re));
    assert.ok(positions.every(p => p > -1), 'every step is present in the Land It section');
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `${steps[i]} must appear after ${steps[i - 1]}`);
    }
  });

  // LIN-3300: aiHint.goal and aiHint.workflow (two more copies) are gone; the description stays.
  test('(h2) the description names every irreversible-set step in the body\'s order', () => {
    const keywords = ['merge', 'done', 'summary', 'archive', 'prune', 'follow-up'];
    const assertOrdered = (text, label) => {
      const lower = text.toLowerCase();
      const positions = keywords.map(k => lower.indexOf(k));
      assert.ok(positions.every(p => p > -1), `${label} mentions every keyword (${keywords.join(', ')})`);
      for (let i = 1; i < positions.length; i++) {
        assert.ok(positions[i] > positions[i - 1],
          `${label}: "${keywords[i]}" must appear after "${keywords[i - 1]}"`);
      }
    };
    const t = PROMPT_TEMPLATES['close-out'];
    assertOrdered(t.description, 'close-out.description');
  });

  // ===========================================================================
  // Follow-up triage: filed follow-ups get a priority and a type label (LIN-2309)
  // ===========================================================================

  test('(i1) close-out carries a Follow-up Triage section requiring priority + type label on every filed follow-up', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/### Follow-up Triage/.test(prompt), 'close-out has the Follow-up Triage section');
    assert.ok(/never leave it at the provider default/i.test(prompt),
      'follow-ups must not be left at the provider default');
  });

  test('(i2) priority guidance derives from risk, requires stated reasoning, and forbids inventing a numeric scale', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/derive it from the finding's own risk/i.test(prompt), 'priority is derived from the finding\'s risk');
    assert.ok(/state that reasoning in one line on the ticket/i.test(prompt), 'reasoning must be stated on the ticket');
    assert.ok(/`priorityLevel` \(ascending, 4 = highest\)/.test(prompt), 'names the provider-neutral priorityLevel field with its ascending scale');
    assert.ok(/do not invent a numeric scale of your own/i.test(prompt), 'forbids inventing a numeric scale');
    // Field-scoped, not phrase-locked (LIN-2315): a paraphrase that still names the
    // native field (e.g. "or `priority`, the provider-native equivalent") fails this
    // even though it doesn't match the literal phrase the old assertion keyed on.
    const triageSection = prompt.slice(prompt.indexOf('### Follow-up Triage'), prompt.indexOf('### Archive & Prune'));
    const priorityBullet = triageSection.split('\n').find(l => l.trim().startsWith('- **Priority**:'));
    assert.ok(priorityBullet, 'the Follow-up Triage Priority bullet is present');
    assert.deepStrictEqual(namedPriorityFields(priorityBullet), ['priorityLevel'],
      'the Priority bullet names exactly priorityLevel as a priority-family field — its scale is inverted on the native field (LIN-2311), so naming that field there under any wording is the hazard');
  });

  test('(i3) label guidance uses the workspace label catalog and requires an explicit note when nothing fits', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/GET \/api\/proxy\/labels/.test(prompt), 'labels come from the workspace\'s own catalog endpoint');
    assert.ok(/never a hardcoded vocabulary/i.test(prompt), 'forbids a hardcoded label vocabulary');
    assert.ok(/say so explicitly on the ticket rather than inventing one/i.test(prompt),
      'requires an explicit note instead of inventing a label');
  });

  test('(i4) triage is best-effort and degrades to a note rather than blocking or expanding the close', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(/best-effort, never blocking/i.test(prompt), 'triage is explicitly best-effort, never blocking');
    assert.ok(/record a one-line note on the ticket saying so instead of retrying or failing the close/i.test(prompt),
      'degrades to a stated note rather than retrying or failing the close');
  });

  test('(i5) the close-out step that files follow-ups points filers at Follow-up Triage', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    const land = prompt.slice(prompt.indexOf('### Land It and Close the Loop'), prompt.indexOf('### Follow-up Triage'));
    assert.ok(/file the outside follow-ups \(see Follow-up Triage below\)/.test(land),
      'the filing step references Follow-up Triage');
  });

  test('(i6) Follow-up Triage sits after "Always name a next action" and before Archive & Prune', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    const nextActionAt = prompt.indexOf('**Always name a next action**');
    const triageAt = prompt.indexOf('### Follow-up Triage');
    const archiveAt = prompt.indexOf('### Archive & Prune Superseded Stage Artifacts');
    assert.ok(nextActionAt > -1 && triageAt > -1 && archiveAt > -1, 'all three anchors are present');
    assert.ok(nextActionAt < triageAt && triageAt < archiveAt,
      'Follow-up Triage sits strictly between the next-action note and Archive & Prune');
  });

  test('(i7) Follow-up Triage is scoped to close-out only — it does not leak into other templates via the shared grounding post-pass', () => {
    const { prompt: bugPrompt } = generatePrompt('bug', { ...issue, labels: ['bug'] }, context);
    const { prompt: implPrompt } = generatePrompt('implementation', issue, context);
    assert.ok(!bugPrompt.includes('Follow-up Triage'), 'Follow-up Triage does not leak into the bug template');
    assert.ok(!implPrompt.includes('Follow-up Triage'), 'Follow-up Triage does not leak into the implementation template');
  });

  test('(i8) close-out still emits no literal "Linear" with Follow-up Triage included, and stays byte-identical for Linear (LIN-177 parity)', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(!prompt.includes('Linear'), 'Follow-up Triage introduces no literal "Linear"');
    const i = { ...issue, labels: ['close-out'] };
    const base = generatePrompt('close-out', i, context, {}).prompt;
    const withUi = generatePrompt('close-out', i, context, {}, { ...DEFAULT_PROMPT_UI }).prompt;
    assert.strictEqual(withUi, base, 'close-out must stay byte-identical for Linear with Follow-up Triage included');
  });

});

// =============================================================================
// plan-review template: registration + the seven checks
// (LIN-1602; 7th check — source-of-truth re-grounding — added by LIN-1859)
//
// The acceptance criterion is that the seven checks are present AND ORDERED, so
// the assertions below anchor on CONTENT, never on list numbering: the rendered
// body opens with formatReadOnlyWorkflow's own `1./2./3.` list, ABOVE the checks —
// a bare `^\d\. \*\*` scan anchors on that and proves nothing. Every ordering
// assertion is therefore scoped to the `### The Seven Checks` section. The anchors
// are case- and hyphen-tolerant.
// =============================================================================

import { formatReadOnlyWorkflow, formatDiscussionReference } from '../../lib/prompt-formatters.js';

describe('plan-review template + the seven checks (LIN-1602 / LIN-1859)', () => {
  const issue = {
    id: 'pr-1', identifier: 'LIN-903', title: 'Verify the plan',
    description: 'a plan', url: 'https://linear.app/test/issue/LIN-903',
    labels: [], createdAt: '2026-01-01T00:00:00.000Z'
  };
  const context = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  // The seven checks, in their committed order. Content anchors only.
  const PLAN_REVIEW_CHECKS = [
    { label: 'completeness check', re: /completeness check/i },
    { label: 'Strategy Framing', re: /strategy framing/i },
    { label: 'history signal', re: /history signal/i },
    { label: 'session-fit', re: /session-fit/i },
    { label: 'relaxation guard', re: /relaxation guard/i },
    { label: 'prerequisite-refactor necessity', re: /prerequisite[- ]refactor/i },
    { label: 'source-of-truth re-grounding', re: /source-of-truth|re-grounding|authoritative/i }
  ];

  /** Assert the seven anchors are present and strictly increasing WITHIN one path's region. */
  const assertSevenChecksOrdered = (region, pathName) => {
    let prev = -1;
    for (const { label, re } of PLAN_REVIEW_CHECKS) {
      const at = region.search(re);
      assert.ok(at > -1, `${pathName}: missing the "${label}" check`);
      assert.ok(at > prev, `${pathName}: "${label}" is out of order (index ${at} follows ${prev})`);
      prev = at;
    }
  };

  test('plan-review is a registered first-class template (key, name===key, UNIVERSAL, AI-recommendable, completion signal)', () => {
    assert.ok('plan-review' in PROMPT_TEMPLATES, 'plan-review is a PROMPT_TEMPLATES key');
    const t = PROMPT_TEMPLATES['plan-review'];
    // The display name MUST equal the key: parseRecommendedAction reads the emitted
    // `→ **name**` and _DISPATCH_KIND_BY_ALIAS maps it back (the close-out precedent).
    assert.strictEqual(t.name, 'plan-review');
    assert.strictEqual(t.category, PROMPT_CATEGORIES.UNIVERSAL);
    assert.ok(t.route, 'has a route so the selector offers it');
    assert.ok(COMPLETION_SIGNALS['plan-review'], 'has a registered completion signal');
    assert.strictEqual(t.completionSignals, COMPLETION_SIGNALS['plan-review'], 'template wires its completion signal');
  });

  test('(a) handwritten path: the seven checks are present and ordered inside "### The Seven Checks"', () => {
    const { prompt } = generatePrompt('plan-review', issue, context);
    const start = prompt.indexOf('### The Seven Checks');
    const end = prompt.indexOf('### Verdict');
    assert.ok(start > -1, 'the body has a "### The Seven Checks" section');
    assert.ok(end > start, 'the checks section is closed by "### Verdict"');
    const section = prompt.slice(start, end);
    // Trap 1: the decoy list from formatReadOnlyWorkflow sits ABOVE the section.
    assert.ok(!section.includes('**Fetch details**'),
      'the checks section excludes formatReadOnlyWorkflow\'s own numbered list');
    assertSevenChecksOrdered(section, 'handwritten');
  });


  test('(c) the prompt carries the verdict vocabulary and the verify-don\'t-redesign, write-only stance', () => {
    const { prompt } = generatePrompt('plan-review', issue, context);
    // LIN-3299: verify-don't-redesign is a Scope and Authority line, which code adds.
    assert.ok(/Verify, do not redesign: another reasonable approach is not a finding/.test(prompt));
    assert.ok(/Approve/.test(prompt) && /Request Changes/.test(prompt) && /Needs Discussion/.test(prompt),
      'carries the Approve / Request Changes / Needs Discussion vocabulary');
    assert.ok(/against its own claims, adding no requirements of (your|its) own/i.test(prompt), 'verifies against the plan\'s own claims');
    assert.ok(/claims verified; proceed to implementation/i.test(prompt), 'cheap-when-clean line');
    // Write-only: no plan edits, no implementing, no follow-ups filed.
    assert.ok(/You do NOT edit the plan, do NOT implement any part of it, and do NOT file follow-up tickets/i.test(prompt),
      'plan-review is write-only');
  });

  test('(d) plan-review uses the shared read-only workflow (verify → comment, no status write)', () => {
    const { prompt } = generatePrompt('plan-review', issue, context);
    assert.ok(prompt.includes(formatReadOnlyWorkflow(issue, { useLinear: true })),
      'the body embeds the shared formatReadOnlyWorkflow block verbatim');
    assert.ok(!/Set LIN-903 status to "In Progress"/.test(prompt), 'read-only: no status write step');
  });

  test('(e1) the template\'s OWN strings emit no literal "Linear" — every mention is attributable to a shared formatter', () => {
    const { prompt } = generatePrompt('plan-review', issue, context);
    // Not a bare absence check: this template legitimately inherits tracker
    // mentions from the shared formatters. Subtract exactly what they emit and
    // assert the template's own prose adds none.
    let own = prompt;
    for (const shared of [formatReadOnlyWorkflow(issue, { useLinear: true }), formatDiscussionReference(issue, { useLinear: true })]) {
      assert.ok(shared && own.includes(shared), 'the shared formatter output is present to subtract');
      own = own.replace(shared, '');
    }
    assert.strictEqual((own.match(/\bLinear\b/g) || []).length, 0,
      'the plan-review template body contributes no literal "Linear" of its own');
  });

  test('(e2) Linear byte-parity: applyPromptCapabilities is a no-op, and a non-Linear provider renames cleanly', () => {
    const i = { ...issue, labels: ['plan-review'] };
    // The no-op asserted directly: rendered output is byte-identical with vs
    // without an explicit Linear provider ui (the LIN-177 S4/S5 loop).
    const base = generatePrompt('plan-review', i, context, {}).prompt;
    const withUi = generatePrompt('plan-review', i, context, {}, { ...DEFAULT_PROMPT_UI }).prompt;
    assert.strictEqual(withUi, base, 'plan-review must be byte-identical for Linear');
    assert.strictEqual(applyPromptCapabilities(base, resolvePromptUi({}, null)), base,
      'the capability post-pass is a no-op on the Linear floor');
    // And nothing leaks for a provider with a different display name.
    const local = generatePrompt('plan-review', i, context, {},
      { write: true, comments: true, subtasks: true, displayName: 'Local' }).prompt;
    assert.ok(!local.includes('Linear'), 'no Linear leaks for a non-Linear provider');
  });
});

// =============================================================================
// The plan-review GATE and the revision half, in the handwritten `plan` template
// (LIN-1603, items 2.1/2.2 — the routing that reads them is pinned in
// tests/unit/openrouter.test.js). Two ordering facts are load-bearing and are
// asserted by index, not by presence:
//   - the gate sits AFTER the session-fit answer, because criterion (a) reads it;
//   - the revision half sits BEFORE Strategy Framing, because a revising planner
//     must see the verdict before re-deriving the framing the findings are about.
// The third property is negative and the easiest to erode: the gate must stay
// GATED — a plan meeting none of the criteria hands straight to implementation.
// =============================================================================

describe('plan-review gate + revision half in the plan template (LIN-1603)', () => {
  const issue = {
    id: 'pg-1', identifier: 'LIN-904', title: 'Add the gate',
    description: 'work', url: 'https://linear.app/test/issue/LIN-904',
    labels: [], createdAt: '2026-01-01T00:00:00.000Z'
  };
  const context = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
  const plan = () => generatePrompt('plan', issue, context).prompt;

  test('the gate names all four criteria and requires the decision be written down', () => {
    const p = plan();
    assert.ok(/### Plan-review Gate/.test(p), 'the plan carries a plan-review gate section');
    assert.ok(/\*\*\(a\)\*\* The session-fit answer above is "needs multiple sessions"/.test(p), 'criterion (a)');
    assert.ok(/\*\*\(b\)\*\* Strategy Framing names a routed-around contract gap/.test(p), 'criterion (b)');
    assert.ok(/\*\*\(c\)\*\* Any step in the plan relaxes a validation, a contract, or a guard/.test(p), 'criterion (c)');
    assert.ok(/\*\*\(d\)\*\* The plan touches credential, merge-rule, or dispatch-contract surfaces/.test(p), 'criterion (d)');
    assert.ok(/Record the decision in the issue description, naming which of \(a\)–\(d\) fired/.test(p),
      'the decision must be recorded in the description');
    assert.ok(/`plan-review due: yes` or `plan-review due: no`/.test(p),
      'in the form the router reads, carried by the stage contract (LIN-3292)');
  });

  test('the gate is sited AFTER the session-fit answer — criterion (a) reads it', () => {
    const p = plan();
    const sessionFit = p.indexOf('Document the answer in the issue description alongside the plan.');
    const gate = p.indexOf('### Plan-review Gate');
    assert.ok(sessionFit > -1 && gate > -1, 'both landmarks must be present');
    assert.ok(sessionFit < gate,
      'the gate must follow the session-fit answer, or criterion (a) would read an answer that does not exist yet');
  });

  test('the gate stays GATED — none of (a)–(d) hands straight to implementation', () => {
    const p = plan();
    assert.ok(/None of \(a\)–\(d\) firing is the common result: that plan hands directly to implementation, exactly as today/.test(p),
      'the common case must route as it did before the gate existed');
    assert.ok(/gated step, not a universal one/.test(p), 'the prompt must say the step is gated, not universal');
    assert.ok(/do not volunteer it for a plan that meets none of the criteria/.test(p),
      'the over-fire guard must be explicit, not implied by omission');
  });

  test('the revision half sits BEFORE Strategy Framing and recognises a prior verdict by substance', () => {
    const p = plan();
    const revise = p.indexOf('### Revising After a Plan Review');
    const framing = p.indexOf('### Strategy Framing');
    assert.ok(revise > -1 && framing > -1, 'both sections must be present');
    assert.ok(revise < framing,
      'the revision half must precede Strategy Framing so a revising planner reads the verdict first');
    assert.ok(/a \`plan-review\` comment recording an explicit \*\*Approve\*\* \/ \*\*Request Changes\*\* \/ \*\*Needs Discussion\*\*/.test(p),
      'the prior verdict is recognised by its substance (the verdict vocabulary)');
    assert.ok(/headed \`### Plan Review Verdict\` where one is used/.test(p),
      'the header is named as a disambiguator — "where one is used", not as a requirement');
  });

  test('the revision must address every finding and record what changed', () => {
    const p = plan();
    assert.ok(/this pass is a \*\*revision\*\*, not a fresh plan/.test(p),
      'a plan with a verdict on the trail is a revision, not a re-plan from scratch');
    assert.ok(/Where you disagree with a finding, answer it explicitly with your reasoning/.test(p),
      'a disagreed-with finding must be answered, not silently dropped');
    assert.ok(/\*\*Record what changed\*\*/.test(p),
      'the revision must record which findings it addressed, so the next review can check it');
  });

  test('the plan-review template EMITS the disambiguating header (the producer half of 2.5)', () => {
    // Without this the header has two consumers (the close-out exclusions and the
    // plan's revision half) and no producer.
    const { prompt } = generatePrompt('plan-review', issue, context);
    assert.ok(/one comment that starts with \`### Plan Review Verdict\`/.test(prompt),
      'plan-review must head its verdict comment with the disambiguator (the stage contract, LIN-3292)');
    assert.ok(/an Approve here must never be mistaken for authorization to close the task out/.test(prompt),
      'the template must say why the header exists — the close-out confusion it prevents');
  });

  // ===========================================================================
  // Plan revisions REPLACE the prior plan section instead of appending (LIN-1770)
  // ===========================================================================

  test('(h1) the revision half instructs replace, not append, and states the one-current-plan invariant', () => {
    const p = plan();
    const replaceAt = p.indexOf('**Replace, don\'t append**');
    const recordAt = p.indexOf('**Record what changed**');
    assert.ok(replaceAt > -1, 'the "Replace, don\'t append" instruction is present');
    assert.ok(recordAt > -1 && replaceAt < recordAt,
      'replace-semantics is stated before the record-what-changed instruction, in write order');
    assert.ok(/REPLACES the plan section already in the description/.test(p),
      'states explicitly that the revision replaces the prior plan section');
    assert.ok(/rather than leaving the superseded plan in place beside it/.test(p),
      'explicitly forbids leaving the old plan text in place alongside the new one');
    assert.ok(/description\/replace/.test(p), 'names the targeted description/replace write surface');
    assert.ok(/carries exactly one current plan, never a stack of them/.test(p),
      'states the one-current-plan invariant');
  });

  test('(h2) the changelog is a short line, not the superseded plan\'s full text', () => {
    const p = plan();
    assert.ok(/a short changelog line/.test(p), 'the record-what-changed instruction names it as a short line');
    assert.ok(/not the superseded plan's full text/.test(p),
      'explicitly distinguishes the changelog from retaining the old plan verbatim');
  });

  test('(h3) the revision half still sits before Strategy Framing with the new replace instruction included', () => {
    const p = plan();
    const revise = p.indexOf('### Revising After a Plan Review');
    const replaceAt = p.indexOf('**Replace, don\'t append**');
    const framing = p.indexOf('### Strategy Framing');
    assert.ok(revise > -1 && replaceAt > -1 && framing > -1, 'all three landmarks are present');
    assert.ok(revise < replaceAt && replaceAt < framing,
      'the replace instruction sits inside the revision section, before Strategy Framing');
  });


  test('the gate did not disturb the pre-existing plan apparatus', () => {
    // Regression guard: two additive sections were spliced into the middle of this
    // template; the ordering invariants around them must still hold.
    const p = plan();
    const framing = p.indexOf('### Strategy Framing');
    const scope = p.indexOf('### Scope Assessment');
    assert.ok(framing > -1 && scope > -1 && framing < scope,
      'Strategy Framing must still precede Scope Assessment (the LIN-279 invariant)');
    assert.ok(/Surface Assessment/.test(p), 'the prerequisite-refactor rule must survive');
    assert.ok(/completeness check/i.test(p), 'the completeness check must survive');
  });
});

// =============================================================================
// How a ledger item is settled (LIN-898, LIN-1579, LIN-3326). LIN-898 began
// this: a claim that cannot be proven before merge need not wait on a pre-merge
// human sign-off. LIN-3326 finished it: no item is a pre-merge gate on its risk
// surface alone; a step that can only run once the change is live is done by
// close-out after the deploy. The floors stay: green CI never settles an item,
// a person's acceptance names the precondition, a missing verdict blocks.
// =============================================================================

describe('how a ledger item is settled (LIN-898, LIN-3326)', () => {
  const issue = {
    id: 'lr-1', identifier: 'LIN-902', title: 'Tweak prompt wording',
    description: 'work', url: 'https://linear.app/test/issue/LIN-902',
    labels: [], createdAt: '2026-01-01T00:00:00.000Z'
  };
  const context = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  const metaArgs = {
    issueContext: 'CTX', identifier: 'LIN-902',
    hasSubtasks: true, subtaskCount: 2, completedCount: 2, inProgressCount: 0, remainingCount: 0,
    hasComments: true, commentCount: 2, aiHints: 'H',
    actionVocabulary: 'plan, review, close-out, implementation, bug',
    completionSignals: 'S', focusedSubtaskId: null, isTerminal: false, hasOpenChildren: true
  };

  test('review routes each item by what the claim needs, with no pre-merge sign-off gate', () => {
    const review = generatePrompt('review', issue, context).prompt;
    assert.ok(/\*\*Say how each item will be settled\*\*, keeping each route to what the claim needs/.test(review),
      'review states how each item will be settled');
    assert.ok(/\*\*Before the merge\*\*: a check or a repro close-out can run, naming the exact condition that tells right from wrong/.test(review),
      'a check before the merge names its distinguishing condition');
    assert.ok(/\*\*After the deploy\*\*/.test(review) && /\*\*A named monitor\*\*/.test(review) && /\*\*A named rollback\*\*/.test(review),
      'the other three routes are offered');
    assert.ok(!/explicit human acceptance before merge/i.test(review) && !/Proportional to risk class/.test(review),
      'no item becomes a pre-merge sign-off gate on its risk surface');
  });

  test('HARD FLOORS not regressed: green CI never settles, acceptance names the precondition, missing verdict still blocks', () => {
    const review = generatePrompt('review', issue, context).prompt;
    const closeout = generatePrompt('close-out', issue, context).prompt;
    assert.ok(/Green CI is never evidence for a ledger item/i.test(closeout),
      'green CI still never settles a ledger item');
    assert.ok(/Green CI never settles a ledger item/.test(review), 'review states the same floor (Scope and Authority)');
    assert.ok(/may be accepted by a person, but only one who names the exact precondition they exercised/i.test(closeout),
      'acceptance without a named precondition (a reviewer\'s own "no action needed" included) settles nothing');
    assert.ok(/With no review verdict on record/.test(closeout) && /the work is not ready: leave the task open and name `review` next/.test(closeout),
      'a task with no review verdict still blocks close');
  });

  test('completion signals stay coherent with how items are settled', () => {
    const sig = COMPLETION_SIGNALS['close-out'];
    assert.ok(sig.signals.some(s => /green CI alone never discharges a ledger item/i.test(s)),
      'the checkpoint keeps the green-CI floor explicit');
    assert.ok(sig.signals.some(s => /accepted by a human naming the exact precondition exercised/i.test(s)),
      'the checkpoint keeps acceptance tied to a named precondition');
    assert.ok(/the post-deploy steps done once the deploy landed/.test(sig.readinessCheck),
      'the readiness check carries the post-deploy steps after the merge');
  });
});

// =============================================================================
// Pre-launch posture (LIN-1579): what the reviewer can NAME settles a claim
// that cannot be proven before merge — a monitor for a claim only production
// time can show, a rollback for a reversible change — and bookkeeping closes in
// the merging session. Naming is review's to do; close-out cites the name.
// =============================================================================

describe('named-discharge lanes and close-on-merge (LIN-1579)', () => {
  const issue = {
    id: 'nd-1', identifier: 'LIN-903', title: 'Bound an async wait',
    description: 'work', url: 'https://linear.app/test/issue/LIN-903',
    labels: [], createdAt: '2026-01-01T00:00:00.000Z'
  };
  const context = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  const metaArgs = {
    issueContext: 'CTX', identifier: 'LIN-903',
    hasSubtasks: true, subtaskCount: 2, completedCount: 2, inProgressCount: 0, remainingCount: 0,
    hasComments: true, commentCount: 2, aiHints: 'H',
    actionVocabulary: 'plan, review, close-out, implementation, bug',
    completionSignals: 'S', focusedSubtaskId: null, isTerminal: false, hasOpenChildren: true
  };

  test('(1) review authors the named-monitor route, with its one-line justification', () => {
    const review = generatePrompt('review', issue, context).prompt;
    assert.ok(/\*\*A named monitor\*\*, for a claim only time in production can show/.test(review),
      'review carries the named-monitor route');
    assert.ok(/a log or oplog entry, a metric, or a path that fails loudly/i.test(review),
      'the monitor must be a specific, nameable thing');
    // LIN-2917: a routed ticket does not fire, so it is not a monitor. It may be
    // cited beside a monitor, never instead of one.
    assert.ok(/A monitor \*\*fires\*\*; a follow-up ticket does not, so it may sit \*beside\* a monitor, never \*instead\* of one/.test(review),
      'a ticket may sit beside the monitor, never instead of it');
    // Misfire guard: unprovable-in-principle is not "this CI run did not cover it".
    assert.ok(/with one line on why no check short of production could prove it/.test(review),
      'the misfire guard is a written line');
    assert.ok(/A claim a test could have proven is not unprovable but untested, and usually means \*\*Request Changes\*\*/.test(review),
      'an untested claim is not an unprovable one');
  });

  test('(2) review states what makes a change reversible and requires the rollback be named', () => {
    const review = generatePrompt('review', issue, context).prompt;
    assert.ok(/\*\*A named rollback\*\*, for a change that is genuinely reversible/.test(review), 'review carries the named-rollback route');
    assert.ok(/the single commit to revert, or the exact env var \/ flag and its safe value/i.test(review),
      'the rollback itself is named');
    assert.ok(/A migration, data already persisted in the new shape, or a third party already consuming the change makes it not reversible/.test(review),
      'the lane cannot collapse into "git can revert anything"');
  });

  test('(3) close-out cites review\'s named monitor or rollback, never one of its own', () => {
    const closeout = generatePrompt('close-out', issue, context).prompt;
    assert.ok(/\*\*A named monitor or rollback\*\*: cite the name review wrote\. You cannot supply one yourself/.test(closeout),
      'close-out cites review\'s name rather than authoring its own');
    assert.ok(/a ticket is not a monitor, because it does not fire/.test(closeout),
      'close-out refuses a ticket standing in for a monitor');
  });

  test('(4) close-out verifies on what landed and closes the bookkeeping in the same session', () => {
    const closeout = generatePrompt('close-out', issue, context).prompt;
    assert.ok(/Verify the change on what landed in this same session/.test(closeout),
      'verification happens on what landed, in the merging session');
    assert.ok(/do not leave the task open, or file a follow-up, only to "confirm the merged change works"/.test(closeout),
      'no separate verification pass and no confirm-it-works follow-up');
    // Bound: "close on merge" must not become "close without verifying".
    assert.ok(/A claim that needs real-world elapsed time belongs on a named monitor/.test(closeout),
      'an elapsed-time claim routes to the named monitor instead of closing unverified');
  });

  test('(5) unnamed gets no route, and the ledger itself never shrinks', () => {
    const review = generatePrompt('review', issue, context).prompt;
    const closeout = generatePrompt('close-out', issue, context).prompt;
    assert.ok(/An unnamed monitor or rollback settles nothing/.test(review), 'review: naming is the price of the route');
    assert.ok(/"we will notice" or "it can be reverted" with nothing named settles nothing/.test(closeout),
      'close-out: hand-waved reversibility is not a discharge');
    assert.ok(/Green CI is never evidence for a ledger item/i.test(closeout),
      'green CI still never discharges a ledger item');
    assert.ok(/Still enumerate every claim CI does not exercise; only the route changes/.test(review),
      'every claim CI does not exercise is still enumerated');
  });

  test('(7) completion signals stay coherent with the named routes and close-on-merge', () => {
    const sig = COMPLETION_SIGNALS['close-out'];
    assert.ok(sig.signals.some(s => /a monitor or rollback review named cited by that name \(an unnamed one settles nothing\)/.test(s)),
      'a checkpoint reflects the named-monitor / named-rollback discharge, naming as its price');
    assert.ok(sig.signals.some(s => /the change verified on what landed in the same session/i.test(s)),
      'a checkpoint reflects close-on-merge verification');
  });
});

describe('selector rule 5: bug already investigated (LIN-366)', () => {
  test('a cause that still stands goes to the fix; the label alone is not a reason to re-investigate', () => {
    assert.match(selectorRule(5), /a cause that stands goes to its fix, `plan` if the fix spans surfaces/);
    assert.match(selectorRule(5), /never re-investigate a confirmed one/);
    const bug = formatStageOptions().split('\n- `').find(e => e.startsWith('bug`'));
    assert.match(bug, /The `bug` label alone does not mean investigation is owed/);
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

  test('the selector renders the node facts from frontierFacts, and none for a leaf', () => {
    const p = formatNodeFactsBlock({ completedCount: 1, inProgressCount: 0, remainingCount: 3, frontierFacts }, 4);
    assert.ok(/- Subtasks: 4 \(1 done, 0 in progress, 3 remaining\)/.test(p), 'counts surface');
    assert.ok(/LIN-401 \[blocked\]/.test(p) && /LIN-428 \[actionable\]/.test(p), 'per-child blocker status surfaces');
    assert.ok(/Frontier next child \(skip-blocked, unblocks-most\/critical-path ranked\): LIN-428/.test(p), 'the frontier next child and its ranking surface');
    assert.ok(/Session fit stated in the plan: fits one session/.test(p), 'the extracted session-fit hint surfaces');
    assert.equal(formatNodeFactsBlock({ frontierFacts: null }, 0), '', 'no block for a leaf');
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

  test('routing prompt, read-only provider: no hardcoded Linear', () => {
    const meta = selectorPrompt({ write: false, comments: false, estimates: false, subtasks: false, displayName: 'Docs' });
    assert.ok(!meta.includes('Linear'), 'no hardcoded Linear in the routing prompt');
  });
});

// LIN-3296 (B): the subtask strip ended a multi-line "**Subtasks:**" block at the next
// blank line, but templates build their lines with `.filter(Boolean)` (the '' spacers are
// gone), so no blank line followed the block and the strip ate everything after it —
// the whole `## Goal` section for `context`. Latent only because the GitHub providers
// return no hierarchy today.
describe('subtask strip removes only the subtask list (LIN-3296)', () => {
  const issue = {
    identifier: 'GH-7', title: 'Sample', description: 'd',
    state: { name: 'Todo', type: 'unstarted' }, createdAt: '2026-01-01T00:00:00.000Z', labels: []
  };
  const ctx = (children) => ({ project: { name: 'P' }, parent: null, siblings: [], children, comments: [] });
  const children = [
    { identifier: 'GH-8', title: 'Child one', state: { name: 'Todo', type: 'unstarted' } },
    { identifier: 'GH-9', title: 'Child two', state: { name: 'In Progress', type: 'started' } }
  ];
  const ui = { write: true, comments: true, estimates: true, subtasks: false, displayName: 'GitHub' };

  // context/plan/implementation/look-into render "**Subtasks:**"; breakdown renders
  // "**Existing Subtasks:**".
  for (const template of ['context', 'plan', 'implementation', 'look-into', 'breakdown']) {
    test(`${template}: subtask lines are removed and the following sections survive`, () => {
      const withChildren = generatePrompt(template, { ...issue, labels: [template] }, ctx(children), {}, ui).prompt;
      const withoutChildren = generatePrompt(template, { ...issue, labels: [template] }, ctx([]), {}, ui).prompt;
      assert.ok(!/^\*\*(Existing Subtasks|Subtasks):\*\*/m.test(withChildren), 'subtask header removed');
      assert.ok(!/GH-8|GH-9/.test(withChildren), 'subtask list lines removed');
      assert.ok(withChildren.includes('## Goal'), '## Goal survives the strip');
      // Structural: nothing of the no-children prompt is lost — its lines appear, in
      // order, in the stripped prompt. (Not strict equality: a template may add
      // child-conditional prose of its own, and the inline summary leaves its trailing
      // blank line, neither of which is the strip's concern.)
      const kept = withChildren.split('\n');
      let at = 0;
      for (const line of withoutChildren.split('\n')) {
        const found = kept.indexOf(line, at);
        assert.ok(found !== -1, `line lost by the strip: ${JSON.stringify(line.slice(0, 80))}`);
        at = found + 1;
      }
    });
  }

  test('context: a provider without subtasks sees exactly the no-children prompt', () => {
    const withChildren = generatePrompt('context', { ...issue, labels: ['context'] }, ctx(children), {}, ui).prompt;
    const withoutChildren = generatePrompt('context', { ...issue, labels: ['context'] }, ctx([]), {}, ui).prompt;
    assert.strictEqual(withChildren, withoutChildren);
  });

  test('a provider that keeps subtasks still renders the list unchanged', () => {
    const keep = { ...ui, subtasks: true };
    const p = generatePrompt('context', { ...issue, labels: ['context'] }, ctx(children), {}, keep).prompt;
    assert.ok(p.includes('**Subtasks:**\n- GH-8: "Child one" (Todo)\n- GH-9: "Child two" (In Progress)\n'));
  });

  test('the strip stops at the first non-list line, blank line or not', () => {
    const caps = { write: true, subtasks: false, displayName: 'Linear', includeTracker: true, fixedStates: null };
    const prompt = [
      '**Subtasks:**', '- GH-8: "Child one" (Todo)', '- GH-9: "Child two" (In Progress)',
      '**Labels:** x', '## Goal', '- keep this bullet'
    ].join('\n');
    assert.strictEqual(applyPromptCapabilities(prompt, caps), '**Labels:** x\n## Goal\n- keep this bullet');
    // Inline forms are still dropped line-by-line, as before.
    const inline = '**Subtasks:** 0/2 done → Next: GH-8\n**Frontier facts:** 2 open\nafter';
    assert.strictEqual(applyPromptCapabilities(inline, caps), 'after');
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
// Grounding is one seam (LIN-435: ONE source of truth for the deterministic
// re-grounding rules): finishStagePrompt appends appendGroundingSections after the
// stage contract, so a routed recommendation and a pinned stage carry the same text.
// =============================================================================
describe('grounding is one seam (LIN-435)', () => {
  const issue = {
    identifier: 'LIN-700', title: 'T', description: 'd',
    state: { name: 'Todo', type: 'unstarted' },
    createdAt: '2026-03-01T00:00:00.000Z', labels: ['implementation']
  };
  const context = { children: [], comments: [] };

  test('the stage prompt ends with the contract, then the shared grounding sections', () => {
    const grounding = appendGroundingSections('', issue, context);
    assert.ok(grounding.length > 0, 'fixture produces a non-empty grounding (staleness is unconditional)');
    const hw = generatePrompt('implementation', issue, context).prompt;
    assert.ok(hw.endsWith(grounding), 'the prompt ends with the shared grounding sections');
    const contract = formatStageContract('implementation', issue.identifier);
    assert.ok(hw.includes(contract + grounding), 'the stage contract, then the grounding (LIN-3292)');
  });

  test('staleness --since date is injected deterministically from issue.createdAt (no placeholder)', () => {
    const prompt = generatePrompt('implementation', issue, context).prompt;
    assert.ok(prompt.includes('git log --since="2026-03-01T00:00:00.000Z"'), 'the real createdAt is substituted into --since');
    assert.ok(!/\[ticket created date\]|<the ticket's Created date>/.test(prompt), 'no placeholder leaks into the grounded prompt');
  });

  // LIN-3299: a research run adopted a ticket's prescribed limit ("leave this file
  // unchanged") as its own. The one hypothesis sentence covers the ticket's proposed fix
  // as well as its account of the code.
  test('the hypothesis sentence covers the ticket\'s proposed fix', () => {
    const sentence = appendGroundingSections('', issue, context).split('\n').find(l => l.startsWith('Treat this ticket'));
    assert.match(sentence, /\*\*hypothesis\*\*/);
    assert.match(sentence, /any solution or limit it proposes/);
    assert.ok(generatePrompt('research', issue, context).prompt.includes(sentence));
  });

  test('terminal-state + bug-investigated sections reach the implementation prompt', () => {
    const terminalBug = {
      identifier: 'LIN-701', title: 'T', description: 'd',
      state: { name: 'Done', type: 'completed' },
      createdAt: '2026-03-01T00:00:00.000Z', labels: ['bug']
    };
    const ctx = { children: [], comments: [{ body: 'root cause found', user: 'Dev', createdAt: '2026-03-02T00:00:00.000Z' }] };
    const grounding = appendGroundingSections('', terminalBug, ctx);
    assert.ok(/Task Already Complete/.test(grounding), 'terminal-state note present in the shared grounding');
    assert.ok(/Prior Investigation On Record/.test(grounding), 'bug-investigated note present in the shared grounding');
    assert.ok(generatePrompt('implementation', terminalBug, ctx).prompt.endsWith(appendGroundingSections('', terminalBug, ctx, 'implementation')));
  });
});

// =============================================================================
// Grounding notes are chosen per stage (LIN-3296). appendGroundingSections used
// to append every note to every template, so a look-back on a Done ticket was told
// to "close out", triage to re-ground code it never reads, and the bug
// investigation to "move to implementing the fix". The expected matrix below is
// the spec, written independently of the table in lib/prompt-formatters.js:
// S staleness, T terminal-state, C all-subtasks-complete, B bug-investigated.
// =============================================================================
describe('grounding notes chosen per stage (LIN-3296)', () => {
  const EXPECTED = {
    implementation: 'STCB',
    blocked: 'STC', bug: 'STC', plan: 'STC', breakdown: 'STC', research: 'STC',
    scoping: 'STC', design: 'STC', spike: 'STC', 'plan-review': 'STC',
    review: 'STC', 'close-out': 'STC',
    'look-into': 'S', context: 'S',
    'retrospective-audit': 'S', retro: 'S',
    triage: ''
  };
  const HEADINGS = {
    S: '## Re-ground the Ticket (staleness check)',
    T: '## Task Already Complete',
    C: '## All Subtasks Complete',
    B: "## Prior Investigation On Record — Don't Loop"
  };
  const base = {
    id: 'issue-g', identifier: 'LIN-3296', title: 'Grounding fixture', description: 'Some work',
    url: 'https://linear.app/test/issue/LIN-3296', createdAt: '2026-03-01T00:00:00.000Z'
  };
  const comment = { body: 'Root cause is X; fix is Y', user: 'Dev', createdAt: '2026-03-02T00:00:00.000Z' };
  // Done bug with a prior comment: triggers S, T and B.
  const doneBug = {
    issue: { ...base, state: { name: 'Done', type: 'completed' }, labels: ['bug'] },
    context: { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [comment] }
  };
  // Open parent whose every subtask is Done: triggers S and C.
  const kidsDone = {
    issue: { ...base, state: { name: 'In Progress', type: 'started' }, labels: [] },
    context: {
      parent: null, siblings: [], project: { name: 'P' }, comments: [],
      children: [{ identifier: 'LIN-3297', title: 'c', state: { name: 'Done', type: 'completed' } }]
    }
  };
  const present = (prompt, letter) => prompt.includes(HEADINGS[letter]);

  test('the expected matrix covers every template kind (a new stage must choose its notes)', () => {
    assert.deepStrictEqual(Object.keys(EXPECTED).sort(), Object.keys(PROMPT_TEMPLATES).sort());
  });

  for (const [kind, want] of Object.entries(EXPECTED)) {
    test(`${kind}: handwritten path carries exactly ${want || 'no'} grounding notes`, () => {
      const a = generatePrompt(kind, doneBug.issue, doneBug.context).prompt;
      const b = generatePrompt(kind, kidsDone.issue, kidsDone.context).prompt;
      assert.strictEqual(present(a, 'S'), want.includes('S'), `${kind}: staleness`);
      assert.strictEqual(present(a, 'T'), want.includes('T'), `${kind}: terminal-state on a Done task`);
      assert.strictEqual(present(a, 'B'), want.includes('B'), `${kind}: bug-investigated on a bug with comments`);
      assert.strictEqual(present(b, 'C'), want.includes('C'), `${kind}: children-complete on an open parent`);
    });

  }

  test('an unknown kind keeps every note (custom prompts unchanged)', () => {
    const all = appendGroundingSections('', doneBug.issue, doneBug.context);
    for (const letter of 'STB') assert.ok(present(all, letter), `no kind: ${letter} kept`);
    assert.strictEqual(appendGroundingSections('', doneBug.issue, doneBug.context, 'custom'), all);
    assert.strictEqual(appendGroundingSections('', doneBug.issue, doneBug.context, 'toString'), all,
      'an Object.prototype key is not a table row');
  });
});

// =============================================================================
// Attachments section parity (LIN-772). The stage prompt (generatePrompt post-pass)
// and the router prompt (formatIssueContext context block) must emit the SAME
// formatAttachmentsSection output, so the router and the worker see an identical
// attachment set. Attachment-less issues stay byte-identical (the section
// self-gates to '').
// =============================================================================
describe('Attachments section parity, stage and router prompts (LIN-772)', () => {
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

  test('attachment-less context is byte-identical to no-attachments-field (stage and router prompts)', () => {
    // Handwritten path: empty attachments must not change the rendered prompt.
    const hwNone = generatePrompt('implementation', issue, { children: [], comments: [] }).prompt;
    const hwEmpty = generatePrompt('implementation', issue, ctxWithout).prompt;
    assert.strictEqual(hwEmpty, hwNone, 'handwritten prompt unchanged by an empty attachments array');
    assert.ok(!hwEmpty.includes('## Attachments'), 'no Attachments section when there is nothing attached');

    // Router prompt: the context block is likewise unchanged.
    const metaNone = formatIssueContext(issue, { children: [], comments: [] });
    const metaEmpty = formatIssueContext(issue, ctxWithout);
    assert.strictEqual(metaEmpty, metaNone, 'meta context block unchanged by an empty attachments array');
    assert.ok(!metaEmpty.includes('## Attachments'), 'no Attachments section in meta context when empty');
  });

  test('stage and router prompts embed the byte-identical shared Attachments section when attachments exist', () => {
    const section = formatAttachmentsSection(ctxWith);
    assert.ok(section.length > 0, 'fixture with attachments produces a non-empty section');
    assert.ok(section.includes('## Attachments'), 'section carries the heading');

    // Handwritten path appends it verbatim (capability post-pass is a no-op for Linear).
    const hw = generatePrompt('implementation', issue, ctxWith).prompt;
    assert.ok(hw.includes(section), 'handwritten prompt embeds the shared Attachments section verbatim');

    // The router prompt folds the identical section into its context block.
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

  test('the section tells agents that formal attachments carry url metadata (LIN-1673)', () => {
    const section = formatAttachmentsSection(ctxWith);
    assert.ok(
      /`att:`.*attachments.*carry.*`url`|`url`.*`att:`/i.test(section),
      'tells agents that formal att: attachments carry a url field'
    );
    assert.ok(
      /ATTACHMENT_HOST_NOT_ALLOWED/.test(section),
      'names the specific error code an agent sees when the relay blocks a host'
    );
    assert.ok(
      /`md:`.*do not carry `url`/i.test(section),
      'explicitly states md: attachments do not carry url — narrower policy, not blanket'
    );
    assert.ok(
      /`id` routes the relay.*`url` names the target/i.test(section) ||
      /`id`.*routes.*relay.*`url`.*names.*target/i.test(section),
      'distinguishes id (relay fetch handle) from url (target identifier)'
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

  test('instructs agents to derive the file extension from metadata contentType and view the saved file (LIN-889)', () => {
    const section = formatAttachmentsSection(ctxWith);
    assert.ok(
      /forced-download/.test(section) && /neutral/.test(section),
      'names the relay response as a neutral, forced-download signal'
    );
    assert.ok(
      /do NOT use the response'?s? (own )?Content-Type/i.test(section),
      "tells agents not to trust the relay response's own Content-Type"
    );
    assert.ok(
      /save the fetched bytes to a local file/i.test(section) &&
        /extension derived from that item'?s? `?contentType`? metadata field/i.test(section),
      "tells agents to save bytes locally using the item's metadata contentType to pick the extension"
    );
    assert.ok(
      /open\/view the saved local file/i.test(section),
      'tells agents to open/view the saved file so it is actually perceived'
    );
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

});

// =============================================================================
// Principle 0 gate + self-sufficient ruling pointer for the worker lane (LIN-2202,
// the worker-path half of LIN-1732's escalation-discipline rubric). formatIfBlocked()
// is the single shared seam for both worker templates (plan, implementation).
// =============================================================================

describe('If Blocked / Principle 0 gate + ruling pointer (LIN-2202)', () => {
  const mockIssue = {
    id: 'issue-ib', identifier: 'TEST-IB1', title: 'Do a thing',
    description: 'Do the thing', url: 'https://linear.app/test/issue/TEST-IB1',
    state: { name: 'Todo', type: 'unstarted' }, labels: ['implementation']
  };
  const mockContext = { parent: null, siblings: [], project: null, children: [], comments: [] };

  test('plan and implementation templates both carry the Principle 0 gate and manual pointer', () => {
    for (const kind of ['plan', 'implementation']) {
      const result = generatePrompt(kind, mockIssue, mockContext);
      assert.ok(result.prompt.includes('## If Blocked'), `${kind}: must keep the If Blocked heading`);
      assert.ok(
        result.prompt.includes('Gate on Principle 0'),
        `${kind}: must include the Principle 0 gate`
      );
      assert.ok(
        result.prompt.includes('`PENDING-EXTERNAL`') && result.prompt.includes('`BLOCKED:`'),
        `${kind}: must name both sentinels`
      );
      assert.ok(
        result.prompt.includes('The human\'s edge, and how to hand back'),
        `${kind}: must cite the manual section by name`
      );
      assert.ok(
        result.prompt.includes('GET /api/proxy/autopilot/manual'),
        `${kind}: must name the portable endpoint pointer`
      );
      // LIN-2973: a bare pointer isn't enough — the one-sentence test itself
      // must reach the worker, not just the manual's name.
      const flat = result.prompt.replace(/^>\s?/gm, '').replace(/\s+/g, ' ');
      assert.ok(
        flat.includes('Does this genuinely require the human, right now — or is it just something the human might like to see?'),
        `${kind}: must carry the Principle 0 acceptance test sentence itself, not just a pointer to it`
      );
    }
  });

  test('the manual pointer is portable — a bare repo-relative doc path never appears outside the endpoint parenthetical', () => {
    const body = formatIfBlocked();
    assert.ok(body.includes('GET /api/proxy/autopilot/manual'));
    // The doc path may appear only inside the citation parenthetical that also names the
    // portable endpoint — a repo-relative path outside that parenthetical would be dead for a
    // worker running against a different repo, which is exactly the constraint this test name
    // promises. Every mention of the doc path must therefore be paired with the endpoint.
    const pairedMentions = (body.match(/\(`docs\/autopilot-operating-manual\.md`, also served at `GET \/api\/proxy\/autopilot\/manual`\)/g) || []).length;
    const totalMentions = (body.match(/docs\/autopilot-operating-manual\.md/g) || []).length;
    assert.strictEqual(
      totalMentions, pairedMentions,
      'the repo-relative doc path must only ever appear inside the endpoint-paired citation parenthetical, never bare'
    );
  });

  test('step 3\'s exact blocks/blocked-by relationship line survives verbatim on both templates (LIN-357 regression)', () => {
    const relationshipLine = 'Capture the dependency as a `blocks`/`blocked-by` relationship between the tasks';
    for (const kind of ['plan', 'implementation']) {
      const result = generatePrompt(kind, mockIssue, mockContext);
      assert.ok(result.prompt.includes(relationshipLine), `${kind}: must preserve step 3 verbatim`);
    }
  });

  test('does not restate the manual rubric prose (one-source-of-truth)', () => {
    for (const kind of ['plan', 'implementation']) {
      const result = generatePrompt(kind, mockIssue, mockContext);
      assert.ok(
        !result.prompt.includes('Merge sibling blockers before you bubble up'),
        `${kind}: must not restate the manual's merge-sibling-blockers rubric text`
      );
      assert.ok(
        !result.prompt.includes('per-option cost belongs in the option'),
        `${kind}: must not restate the DECISION: JSON emit grammar guidance`
      );
    }
  });

  test('the If Blocked addition is provider-agnostic (no hardcoded tracker noun)', () => {
    const body = formatIfBlocked();
    const addedProse = body.slice(body.indexOf('**Gate on Principle 0'));
    assert.ok(!/\bLinear\b/.test(addedProse), 'the new Principle 0/pointer prose must stay tracker-neutral');
  });

  test('is NOT routed through the universal grounding seam (LIN-698/LIN-435 anti-pattern)', () => {
    const issue = { identifier: 'LIN-2202', createdAt: '2026-03-01T00:00:00.000Z', labels: ['implementation'] };
    const grounding = appendGroundingSections('', issue, { children: [], comments: [] });
    assert.ok(
      !grounding.includes('Gate on Principle 0'),
      'the Principle 0 gate must stay formatIfBlocked-specific and not leak into every template via the shared post-pass'
    );
  });


  // F1/F2 remedy: the `blocked` template (lib/prompt-template-defs.js) is the closest
  // ungated sibling of the worker-lane rubric this ticket adds, so it must carry the
  // same Principle 0 gate + manual citation, structurally tested so removing either
  // directive fails a focused assertion rather than passing silently.
  test('the handwritten blocked template also gates the blocker analysis on Principle 0 and cites the manual', () => {
    const result = generatePrompt('blocked', mockIssue, mockContext);
    assert.ok(
      /Gate this analysis on Principle 0/.test(result.prompt),
      'blocked: must gate the blocker analysis on Principle 0'
    );
    assert.ok(
      /cost of doing nothing/.test(result.prompt),
      'blocked: must name the cost of doing nothing'
    );
    assert.ok(
      result.prompt.includes('The human\'s edge, and how to hand back'),
      'blocked: must cite the manual section by name'
    );
    assert.ok(
      result.prompt.includes('GET /api/proxy/autopilot/manual'),
      'blocked: must name the portable endpoint pointer'
    );
    // LIN-2973: the `blocked` template is itself one of the worker paths that used
    // to strand the consumer with a bare pointer — assert the test sentence lands.
    const flat = result.prompt.replace(/^>\s?/gm, '').replace(/\s+/g, ' ');
    assert.ok(
      flat.includes('Does this genuinely require the human, right now — or is it just something the human might like to see?'),
      'blocked: must carry the Principle 0 acceptance test sentence itself, not just a pointer to it'
    );
  });

});

// =============================================================================
// Acceptance-witness discipline for implementation-authored tests (LIN-2219).
// lib/prompt-template-defs.js:127 (the bug/investigate template's witness-validation
// rule) is scoped to the lane that writes the fewest tests. This extends the same
// discipline — before trusting a test as the acceptance witness, observe it fail (or
// run the mutation equivalent) — to guideline 6 of the implementation template.
// Assertions are scoped to the guidelines block and use distinctive
// multi-word phrases so a pre-existing `red`/`fail` substring elsewhere in the prompt
// (CI language) cannot satisfy them (measured false positive: `includes('red')` already
// passes today via guideline 3's "required").
// =============================================================================
describe('acceptance-witness discipline for authored tests (LIN-2219)', () => {
  const mockIssue = {
    id: 'issue-aw', identifier: 'TEST-AW1', title: 'Do a thing',
    description: 'Do the thing', url: 'https://linear.app/test/issue/TEST-AW1',
    state: { name: 'Todo', type: 'unstarted' }, labels: ['implementation']
  };
  const mockContext = { parent: null, siblings: [], project: null, children: [], comments: [] };

  function guidelinesSlice() {
    const { prompt } = generatePrompt('implementation', mockIssue, mockContext);
    const start = prompt.indexOf('### Implementation Guidelines');
    const end = prompt.indexOf('### Shared Boundaries');
    assert.ok(start !== -1 && end !== -1 && end > start, 'expected an Implementation Guidelines block before Shared Boundaries');
    return prompt.slice(start, end);
  }

  test('implementation guidelines require observing a real failure before trusting a test as the witness', () => {
    const slice = guidelinesSlice();
    assert.ok(/observe it fail/.test(slice), 'must require observing the test fail');
    assert.ok(
      /capture the actual failing output/.test(slice),
      'must require capturing actual failing output, not an assertion it would fail'
    );
    assert.ok(/mutation equivalent/.test(slice), 'must name the mutation equivalent for an impossible-RED test');
  });

  test('the acceptance-witness guideline stays tracker-neutral', () => {
    const slice = guidelinesSlice();
    assert.ok(!/\bLinear\b/.test(slice), 'the new guideline must not hardcode a tracker noun');
  });

  test('does not restate the bug/investigate template\'s witness-validation wording (one-source-of-truth)', () => {
    const slice = guidelinesSlice();
    assert.ok(
      !slice.includes('must be validated or replaced before you optimize against it'),
      'must not restate the bug rule\'s distinctive clause'
    );
    assert.ok(
      !slice.includes('can read green while the outcome is still wrong'),
      'must not restate the bug rule\'s distinctive clause'
    );
  });

});

// =============================================================================
// Attachment-perception discipline (LIN-872). research/plan/review must fetch AND
// perceive every attachment before making a grounding claim, enumerate them
// explicitly, and hard-stop + escalate (recommend `blocked`) on an unperceivable
// one — closing the gap where the shared Attachments section (LIN-772) only says
// "read any that are relevant." Scoped to research/plan/review only, wired inline
// (never through the universal appendGroundingSections seam).
// =============================================================================
describe('attachment perception discipline (LIN-872)', () => {
  const attachments = [
    { id: 'att:abc', title: 'design.png', contentType: 'image/png', kind: 'image' },
    { id: 'md:def', title: 'spec.md', contentType: null, kind: 'file' }
  ];
  const ctxWith = { parent: null, siblings: [], project: null, children: [], comments: [], attachments };
  const ctxWithout = { parent: null, siblings: [], project: null, children: [], comments: [], attachments: [] };

  const mkIssue = (label) => ({
    id: `issue-${label}`, identifier: `TEST-AP-${label}`, title: 'T', description: 'd',
    url: `https://linear.app/test/issue/TEST-AP-${label}`,
    state: { name: 'Todo', type: 'unstarted' }, labels: [label]
  });

  for (const label of ['research', 'plan', 'review']) {
    test(`${label} template requires perceiving every attachment when attachments exist`, () => {
      const result = generatePrompt(label, mkIssue(label), ctxWith);
      assert.ok(result.prompt.includes('Perceive Every Attachment Before Grounding'), `${label} must include the attachment-perception check`);
      assert.ok(/fetch and perceive every/i.test(result.prompt), `${label} must require fetching AND perceiving every attachment`);
      assert.ok(
        /never summarize them collectively as "the attachments"/i.test(result.prompt),
        `${label} must require explicit enumeration, not a collective reference`
      );
      assert.ok(/recommend `blocked`/.test(result.prompt), `${label} must recommend blocked as the escalation next action`);
    });

    test(`${label} template omits the attachment-perception check when there are no attachments`, () => {
      const result = generatePrompt(label, mkIssue(label), ctxWithout);
      assert.ok(!result.prompt.includes('Perceive Every Attachment Before Grounding'), `${label} must self-gate to empty with no attachments`);
    });

    test(`${label} template stays attachment-less byte-identical to a context with no attachments field`, () => {
      const withEmptyArray = generatePrompt(label, mkIssue(label), ctxWithout).prompt;
      const withoutField = generatePrompt(label, mkIssue(label), { parent: null, siblings: [], project: null, children: [], comments: [] }).prompt;
      assert.strictEqual(withEmptyArray, withoutField, `${label} must render identically whether attachments is [] or absent`);
    });
  }

  test('an out-of-scope template (bug) does not include the attachment-perception check even with attachments present', () => {
    const result = generatePrompt('bug', mkIssue('bug'), ctxWith);
    assert.ok(!result.prompt.includes('Perceive Every Attachment Before Grounding'), 'bug template is out of scope for LIN-872');
  });

  test('review strengthens Manual Verification to require viewing the spec attachment and the result side-by-side', () => {
    const withAttachments = generatePrompt('review', mkIssue('review'), ctxWith).prompt;
    const idx = withAttachments.indexOf('### Manual Verification');
    assert.ok(idx !== -1, 'Manual Verification section must exist');
    const section = withAttachments.slice(idx, withAttachments.indexOf('### What CI Did Not Prove'));
    assert.ok(/side-by-side/.test(section), 'Manual Verification must require side-by-side spec/result viewing');

    const withoutAttachments = generatePrompt('review', mkIssue('review'), ctxWithout).prompt;
    const idx2 = withoutAttachments.indexOf('### Manual Verification');
    const section2 = withoutAttachments.slice(idx2, withoutAttachments.indexOf('### What CI Did Not Prove'));
    assert.ok(!/side-by-side/.test(section2), 'side-by-side sentence must self-gate off when there are no attachments');
  });

  test('the attachment-perception prose is provider-agnostic (no hardcoded Linear)', () => {
    assert.ok(!formatAttachmentPerceptionCheck(ctxWith).includes('Linear'), 'shared check prose must not hardcode a tracker name');
  });

  test('attachment-perception check self-gates to empty for absent / non-array / handle-less input', () => {
    assert.strictEqual(formatAttachmentPerceptionCheck(), '', 'no context → empty');
    assert.strictEqual(formatAttachmentPerceptionCheck({}), '', 'no attachments field → empty');
    assert.strictEqual(formatAttachmentPerceptionCheck({ attachments: null }), '', 'null attachments → empty');
    assert.strictEqual(formatAttachmentPerceptionCheck({ attachments: [{}, null] }), '', 'entries without an id → empty');
  });

  test('attachment-perception check is NOT routed through the universal grounding seam (LIN-872 anti-pattern)', () => {
    const issue = { identifier: 'LIN-700', createdAt: '2026-03-01T00:00:00.000Z', labels: ['implementation'] };
    const grounding = appendGroundingSections('', issue, ctxWith);
    assert.ok(
      !grounding.includes('Perceive Every Attachment Before Grounding'),
      'attachment-perception check must stay scoped to research/plan/review, not leak into the universal grounding sections'
    );
  });

});

// =============================================================================
// Capability-gated CI gate: conditional on CI actually existing (LIN-1455)
// =============================================================================

describe('capability-gated CI/checks directive (LIN-1455)', () => {
  const issue = {
    id: 'ci-1', identifier: 'LIN-1455', title: 'No-CI repos',
    description: 'work', url: 'https://linear.app/test/issue/LIN-1455',
    labels: [], createdAt: '2026-01-01T00:00:00.000Z'
  };
  const context = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };

  test('implementation/review/close-out all establish CI presence boundedly before asserting the gate', () => {
    for (const key of ['implementation', 'review', 'close-out']) {
      const { prompt } = generatePrompt(key, issue, context);
      assert.ok(/Establish CI \(or Its Substitute\)/.test(prompt), `${key} carries the CI-gate directive`);
      assert.ok(/CI configuration/.test(prompt) && /one settle/.test(prompt), `${key} bounds the CI-presence determination`);
      assert.ok(/CI is genuinely absent/.test(prompt), `${key} names the no-CI branch`);
      assert.ok(/diffing failure \*\*names\*\*/.test(prompt), `${key} requires diffing failure names, not counts`);
      assert.ok(/never\*\* arm a Monitor/.test(prompt), `${key} forbids arming a watch on an unobserved check set`);
    }
  });

  test('review independently re-runs the substitute rather than trusting the implementer\'s numbers', () => {
    const { prompt } = generatePrompt('review', issue, context);
    assert.ok(/independence matters here/.test(prompt), 'review is told independence matters');
    assert.ok(/re-run both branches yourself rather than citing an earlier stage's numbers/.test(prompt),
      'review re-runs the differential itself');
  });

  test('implementation does not carry the reviewer-independence framing (only review does)', () => {
    const { prompt } = generatePrompt('implementation', issue, context);
    assert.ok(!/independence matters here/.test(prompt), 'implementation is the first run, not a re-run');
  });

  test('close-out still does not key on the review ledger heading (LIN-810 decoupling preserved)', () => {
    const { prompt } = generatePrompt('close-out', issue, context);
    assert.ok(!prompt.includes('### What CI Did Not Prove'), 'close-out CI-gate block does not leak the ledger heading');
  });

  test('the substitute\'s own limits are folded into review\'s ledger residue, not treated as proof', () => {
    const { prompt } = generatePrompt('review', issue, context);
    assert.ok(/its own limits belong here as ledger items too|its known limits belong here as ledger items too/.test(prompt),
      'review records the substitute\'s limits as ledger residue');
  });

  test('implementation/review/close-out CI mentions are conditional, not a bare unconditional gate', () => {
    const review = generatePrompt('review', issue, context).prompt;
    const closeout = generatePrompt('close-out', issue, context).prompt;
    assert.ok(/or, if CI is genuinely absent, that the substitute above has been independently re-run and recorded/.test(review),
      'review\'s pre-Approve CI confirmation is conditional');
    assert.ok(/or, if CI is genuinely absent, that the substitute has been re-run and recorded/.test(closeout),
      'close-out\'s merge gate is conditional');
  });

  test('completion signals: review readinessCheck and signals are conditional on CI existing (human decision, 2026-08-09)', () => {
    const review = COMPLETION_SIGNALS['review'];
    assert.ok(/CI green on the PR, or, when CI is genuinely absent, with the two-branch substitute independently re-run and recorded/.test(review.readinessCheck),
      'review readinessCheck no longer routes CI-absence to a closure blocker');
    assert.ok(review.signals.some(s => /genuinely absent and the two-branch substitute recorded/.test(s)),
      'review signals name the no-CI substitute');
    assert.ok(review.signals.some(s => /CI genuinely absent with no substitute recorded, or a bigger problem surfaced/.test(s)),
      'review signals route an unrecorded no-CI substitute the same way as CI-red');
  });

  test('completion signals: close-out signal accepts the recorded substitute alongside green CI', () => {
    const closeout = COMPLETION_SIGNALS['close-out'];
    assert.ok(closeout.signals.some(s => /CI genuinely absent with the substitute re-run and recorded on it/.test(s)),
      'close-out signal names the no-CI substitute path');
    assert.ok(closeout.signals.some(s => /green CI alone never discharges a ledger item/.test(s)),
      'the never-discharges-a-ledger-item parenthetical is preserved verbatim');
  });


});

// =============================================================================
// Breakdown template subtask-description mandate (LIN-3049) — the handwritten
// path half of the two-path fix. A subtask of an already-approved, decomposed
// plan must carry its own plan slice (session-fit + plan-review-due:no citing
// the approving verdict) so it routes straight to implementation; a subtask
// whose decomposed ticket carries NO Approve on its own comment trail stays a
// plain acceptance-criteria task. The precondition must name the decomposed
// ticket's own trail, never the rendered Parent Task section (F4).
// =============================================================================
describe('breakdown template subtask-description mandate (LIN-3049)', () => {
  const baseIssue = {
    identifier: 'LIN-910', title: 'Break down the surfaces', description: 'd',
    state: { name: 'In Progress', type: 'started' }, labels: ['breakdown']
  };
  const baseContext = {
    project: { name: 'Proj' },
    parent: { identifier: 'LIN-900', title: 'Grandparent', state: { name: 'Todo' } },
    siblings: [], children: [], comments: []
  };
  const approvedVerdict = {
    body: '### Plan Review Verdict\n\n**Verdict: Approve.**',
    user: 'reviewer', createdAt: '2026-09-25T00:00:00.000Z'
  };

  const sectionOf = (prompt) => prompt.slice(
    prompt.indexOf('### Creating Subtasks'),
    prompt.indexOf('### After Creating All Subtasks')
  );

  // F4: the verdict lives on the DECOMPOSED ticket's own trail, never on
  // context.parent. Both fixtures hold context.parent constant and vary only the
  // issue's own comments; the static prose must name the this-ticket-own-trail
  // precondition in both cases (the template is static — this pins its presence,
  // not a runtime branch).
  for (const [label, comments] of [
    ['no Approve on the issue\'s own trail', []],
    ['an Approve on the issue\'s own trail', [approvedVerdict]]
  ]) {
    test(`the precondition names the decomposed ticket's own trail (${label})`, () => {
      const issue = { ...baseIssue, comments };
      const p = generatePrompt('breakdown', issue, baseContext).prompt;
      const section = sectionOf(p);
      assert.ok(/THIS TICKET'S OWN comment trail/.test(section),
        'the Creating Subtasks section must name the decomposed ticket\'s own comment trail');
      assert.ok(/not the 'Parent Task' section rendered above in Context/.test(section),
        'it must exclude the rendered Parent Task section (the F4 wrong-ticket trap)');
      assert.ok(/If no such Approve is on record on this ticket's own trail/.test(section),
        'it must state the no-Approve fallback');
    });
  }

  test('the five approved-path bullets are present and in (a)-(e) order', () => {
    const p = generatePrompt('breakdown', baseIssue, baseContext).prompt;
    const section = sectionOf(p);
    const a = section.indexOf('(a) This surface\'s slice of the approved plan');
    const b = section.indexOf('(b) `Session fit: fits one session`');
    const c = section.indexOf('(c) `Plan-review due: no');
    const d = section.indexOf('(d) The grounding commit SHA(s)');
    const e = section.indexOf('(e) A line saying the parent\'s approved plan is this surface\'s starting point');
    assert.ok(a > -1 && b > -1 && c > -1 && d > -1 && e > -1, 'all five approved-path bullets must be present');
    assert.ok(a < b && b < c && c < d && d < e, 'the five bullets must appear in (a)-(e) order');
    // N2: bullet (c) names this ticket's own approving verdict, not the parent's.
    assert.ok(/cited from this ticket's own approving verdict \(the one the precondition found\)/.test(section),
      'N2: bullet (c) must cite this ticket\'s own approving verdict');
    // R6: bullet (b) must not copy a false `fits one session` onto a surface the
    // approved plan itself could not scope to one session; it must defer to a
    // fresh `plan` pass instead (M13).
    assert.ok(/if a surface genuinely does not fit one session, leave this line for a fresh `plan` pass to answer honestly rather than copying a false claim/.test(section),
      'R6: bullet (b) must require omitting the session-fit line for a surface that does not fit one session');
  });

  test('the existing drift exit is extended to name the approach/files each surface section names', () => {
    const p = generatePrompt('breakdown', baseIssue, baseContext).prompt;
    assert.ok(/Confirm the surfaces, any dependency arrows, and the approach\/files each surface's plan section names still reflect the current codebase/.test(p),
      'the existing drift exit must name the copied specifics');
  });

  test('the existing fallback wording survives for the no-Approve case', () => {
    const p = generatePrompt('breakdown', baseIssue, baseContext).prompt;
    const section = sectionOf(p);
    assert.ok(/create the subtask with only a plain acceptance-criteria description/.test(section),
      'the no-Approve path must still produce a plain acceptance-criteria subtask');
    // R4: the focused, per-surface acceptance-criteria guidance must survive as the
    // fallback's description wording (it was deleted, leaving the precondition pointing
    // at wording that no longer existed).
    assert.ok(/Description with acceptance criteria for this surface — the child sees its parent only as a title, so say where the parent's scope and design can be read/.test(section),
      'R4: the no-Approve fallback must keep the per-surface acceptance-criteria guidance (LIN-3296: and point the child at the parent it cannot see)');
    assert.ok(/none of bullets \(a\)–\(e\) below apply, and the subtask is expected to route through `research`\/`plan` normally/.test(section),
      'the fallback must withhold every approved-path bullet, (a) the plan slice included');
  });

  test('byte-parity: explicit Linear ui stays a no-op for the new breakdown content', () => {
    const base = generatePrompt('breakdown', baseIssue, baseContext, {}).prompt;
    const withUi = generatePrompt('breakdown', baseIssue, baseContext, {}, { ...DEFAULT_PROMPT_UI }).prompt;
    assert.strictEqual(withUi, base, 'the new breakdown content must remain byte-identical for Linear');
  });
});

// =============================================================================
// The stage contract (LIN-3292) is appended by code, once, between the body and
// the grounding, and is said nowhere else in the prompt.
// =============================================================================
describe('the stage contract (LIN-3292)', () => {
  const issue = {
    id: 'issue-c', identifier: 'LIN-3292', title: 'Contract fixture', description: 'd',
    url: 'https://linear.app/test/issue/LIN-3292', createdAt: '2026-03-01T00:00:00.000Z',
    state: { name: 'In Progress', type: 'started' }, labels: []
  };
  const context = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
  const HEADING = '## Formats Later Steps Read';
  const count = (text, needle) => text.split(needle).length - 1;

  for (const kind of Object.keys(PROMPT_TEMPLATES)) {
    test(`${kind}: the contract appears exactly once, after the body`, () => {
      const contract = formatStageContract(kind, issue.identifier);
      const hw = generatePrompt(kind, issue, context).prompt;
      const body = PROMPT_TEMPLATES[kind].generate(issue, context, {});
      assert.ok(hw.startsWith(withStageIntent(body, kind) + contract), `${kind}: body (with its scope lines, LIN-3299) + contract + …`);
      assert.strictEqual(count(hw, HEADING), contract ? 1 : 0);
    });
  }

  test('each format the contract carries is said once: the body no longer asks for it', () => {
    const formats = {
      plan: ['## Implementation Plan', 'plan-review due: yes'],
      'plan-review': ['### Plan Review Verdict'],
      review: ['ledger empty', `## Review — ${issue.identifier}`],
      'close-out': ['plan-review due:', `## Close-out — ${issue.identifier}`]
    };
    for (const [kind, needles] of Object.entries(formats)) {
      const body = PROMPT_TEMPLATES[kind].generate(issue, context, {});
      const contract = formatStageContract(kind, issue.identifier);
      for (const needle of needles) {
        assert.ok(contract.includes(needle), `${kind}: the contract carries ${needle}`);
        assert.ok(!body.includes(needle), `${kind}: the body no longer asks for ${needle}`);
      }
    }
  });

  test('a read-only tracker gets no contract', () => {
    const ui = { write: false, subtasks: false, displayName: 'Jira', fixedStates: false };
    assert.ok(!generatePrompt('review', issue, context, {}, ui).prompt.includes(HEADING));
  });
});

// =============================================================================
// A finished task's notes fit the stage routing sent it to (LIN-3292). Review
// authorizes the close and does not perform it; in-scope findings are never filed
// as follow-ups; and a work stage sent a Done task (to fix red CI, say) is told to
// fix that, not that the work is complete and should be closed out.
// =============================================================================
describe('finished-task notes ask what their stage does (LIN-3292)', () => {
  const base = {
    id: 'issue-f', identifier: 'LIN-3292', title: 'Finished fixture', description: 'work',
    url: 'https://linear.app/test/issue/LIN-3292', createdAt: '2026-03-01T00:00:00.000Z', labels: []
  };
  const done = { issue: { ...base, state: { name: 'Done', type: 'completed' } }, context: { children: [], comments: [] } };
  const kids = {
    issue: { ...base, state: { name: 'In Progress', type: 'started' } },
    context: { children: [{ identifier: 'LIN-1', title: 'c', state: { name: 'Done', type: 'completed' } }], comments: [] }
  };
  const WORK_STAGES = ['implementation', 'blocked', 'bug', 'plan', 'breakdown', 'research', 'scoping', 'design', 'spike', 'plan-review'];

  for (const { issue, context } of [done, kids]) {
    const label = issue.state.type === 'completed' ? 'Done task' : 'open parent, subtasks Done';
    test(`${label}: no stage is told to file what is missing as a follow-up`, () => {
      for (const kind of [...WORK_STAGES, 'review', 'close-out']) {
        const notes = appendGroundingSections('', issue, context, kind);
        assert.ok(notes.length > 0, `${kind}: a note is present`);
        assert.ok(!/as a follow-up/i.test(notes), `${kind}: no follow-up filing`);
      }
    });

    test(`${label}: review checks and gives a verdict; it does not close`, () => {
      const notes = appendGroundingSections('', issue, context, 'review');
      assert.match(notes, /put it in your verdict rather than filing it/);
      assert.match(notes, /authorizes the close; it does not perform it/);
      assert.ok(!/close (it )?out/i.test(notes), 'review is not told to close out');
    });

    test(`${label}: close-out lands it and sends what is missing back to implementation`, () => {
      const notes = appendGroundingSections('', issue, context, 'close-out');
      assert.match(notes, /close it out/);
      assert.match(notes, /back to `implementation` rather than filing it/);
    });

    // Stage-neutral (LIN-3292 review O2): plan-review is write-only and research, scoping
    // and design build nothing, so the note asks for this stage's part, not a fix.
    test(`${label}: a work stage routing sent here does its own part for what is missing`, () => {
      for (const kind of WORK_STAGES) {
        const notes = appendGroundingSections('', issue, context, kind);
        assert.match(notes, /do this stage's part for what is still missing, at its cause/, kind);
        assert.ok(!/\bfix\b/i.test(notes), `${kind}: not told to fix something its stage may not touch`);
        assert.ok(!/close (it )?out|verdict/i.test(notes), `${kind}: no close-out or verdict ask`);
      }
    });

  }
});

// =============================================================================
// LIN-3299: a stage's Goal is its intent, the lead; the process code prints as written
// follows under ## Process.
// =============================================================================
describe('the Goal lead and the Process (LIN-3299)', () => {
  test('every template leads its Goal with the intent and puts its steps under ## Process', () => {
    const issue = { identifier: 'LIN-3299', title: 'T', description: 'd', state: { name: 'Todo', type: 'unstarted' }, createdAt: '2026-03-01T00:00:00.000Z', labels: [] };
    for (const kind of Object.keys(PROMPT_TEMPLATES)) {
      const { prompt } = generatePrompt(kind, issue, { children: [], comments: [] });
      assert.ok(prompt.indexOf('## Goal') < prompt.indexOf('## Process'), kind);
      assert.equal(prompt.split('\n## Process\n').length, 2, `${kind}: one process section`);
      assert.doesNotMatch(prompt, /\*\*Role\*\*|\bAct as\b/, kind);
    }
  });

});

// =============================================================================
// LIN-3300: the stage rules that lived only in the deleted meta-prompt's writing
// blocks, moved into the template of the stage they govern. Prompt-writing rules
// (prompt sizing, skeleton, comment-vs-description guidance) were dropped, not moved.
// =============================================================================
describe('stage rules moved from the deleted meta-prompt (LIN-3300)', () => {
  const issue = {
    id: 'issue-m', identifier: 'LIN-3300', title: 'Moved-rules fixture', description: 'd',
    url: 'https://linear.app/test/issue/LIN-3300', createdAt: '2026-03-01T00:00:00.000Z',
    state: { name: 'In Progress', type: 'started' }, labels: []
  };
  const context = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
  const prompt = (kind) => generatePrompt(kind, issue, context).prompt;

  test('implementation tests for unintended side effects, not only intended ones', () => {
    assert.match(prompt('implementation'), /cover intended effects, unintended side effects, and any interactions the plan flagged/);
  });

  test('implementation finds a shared system\'s dependents before changing it', () => {
    assert.match(prompt('implementation'), /Before changing a shared system, find its dependents in the codebase\./);
  });

  test('plan states how requirements that share a path, state or interface are expected to interact', () => {
    assert.match(prompt('plan'), /Where requirements share a code path, state, or interface, state how they are expected to interact\./);
  });

  test('review verifies a visual or behavioural change by running it', () => {
    assert.match(prompt('review'), /verify the result directly where possible \(run the app, take screenshots, check viewports\)/);
  });

  test('scoping says when the ticket is aimed at a symptom', () => {
    const p = prompt('scoping');
    assert.match(p, /If the ticket is aimed at a symptom of something deeper, say so\./);
    assert.ok(p.indexOf('aimed at a symptom') > p.indexOf('## Process'), 'in the process, not the lead');
  });

  test('context says how done work is known and which decisions were overturned', () => {
    const p = prompt('context');
    assert.match(p, /\*\*Completed\*\*: What's already done, and how that is known/);
    assert.match(p, /\*\*Key Decisions\*\*: Important choices made, and any since overturned/);
  });

  test('close-out of a bug-labelled task keeps the bug label when it sets Done; other tasks are not told', () => {
    const rule = 'Leave the `bug` label in place: Done marks it resolved';
    const bug = generatePrompt('close-out', { ...issue, labels: ['Bug'] }, context).prompt;
    assert.ok(bug.includes(`set the task to Done. ${rule}`), 'beside the Done transition');
    assert.ok(!prompt('close-out').includes(rule));
  });
});
