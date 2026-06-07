/**
 * Unit tests for openrouter.js
 *
 * Run with: node --test tests/unit/openrouter.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  stripCodeBlockMarkers,
  formatSubtaskOverview,
  formatIssueContext,
  isEpicShapedParent,
  parseRecommendedAction,
  parseDeferTo,
  parseRecommendationResponse,
  EPIC_CHILD_THRESHOLD,
  COUSIN_CAP,
  SIBLING_CAP,
  EPIC_TITLE_PATTERN
} from '../../lib/openrouter.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { getAIRecommendationActionNames, deriveDispatchKind, isValidDispatchKind, DISPATCH_KIND_DEFAULT } from '../../lib/prompt-templates.js';

// =============================================================================
// stripCodeBlockMarkers Tests
// =============================================================================

describe('stripCodeBlockMarkers', () => {
  test('returns null for null input', () => {
    assert.strictEqual(stripCodeBlockMarkers(null), null);
  });

  test('returns undefined for undefined input', () => {
    assert.strictEqual(stripCodeBlockMarkers(undefined), undefined);
  });

  test('returns empty string for empty input', () => {
    assert.strictEqual(stripCodeBlockMarkers(''), '');
  });

  test('returns text unchanged when no code blocks present', () => {
    const input = '# Implement LIN-64\n\n## Goal\n\nFix the bug.';
    assert.strictEqual(stripCodeBlockMarkers(input), input);
  });

  test('strips opening and closing triple backticks', () => {
    const input = '```\n# Implement LIN-64\n\n## Goal\n\nFix the bug.\n```';
    const expected = '# Implement LIN-64\n\n## Goal\n\nFix the bug.';
    assert.strictEqual(stripCodeBlockMarkers(input), expected);
  });

  test('strips backticks with language specifier', () => {
    const input = '```markdown\n# Implement LIN-64\n\n## Goal\n\nFix the bug.\n```';
    const expected = '# Implement LIN-64\n\n## Goal\n\nFix the bug.';
    assert.strictEqual(stripCodeBlockMarkers(input), expected);
  });

  test('strips backticks with various language specifiers', () => {
    const variations = ['```md\n', '```text\n', '```txt\n', '```plaintext\n'];
    const content = '# Implement LIN-64';

    for (const prefix of variations) {
      const input = `${prefix}${content}\n\`\`\``;
      assert.strictEqual(stripCodeBlockMarkers(input), content);
    }
  });

  test('handles backticks without newline after opening', () => {
    const input = '```# Implement LIN-64\n```';
    const expected = '# Implement LIN-64';
    assert.strictEqual(stripCodeBlockMarkers(input), expected);
  });

  test('handles backticks without newline before closing', () => {
    const input = '```\n# Implement LIN-64```';
    const expected = '# Implement LIN-64';
    assert.strictEqual(stripCodeBlockMarkers(input), expected);
  });

  test('does not strip backticks in the middle of text', () => {
    const input = '# Implement\n\n```javascript\nconst x = 1;\n```\n\n## Goal';
    // Only opening backticks at start should be stripped, not internal ones
    assert.strictEqual(stripCodeBlockMarkers(input), input);
  });

  test('only strips one pair of markers', () => {
    const input = '```\n```\n# Implement\n```\n```';
    // Strips outer pair, leaves inner backticks
    const expected = '```\n# Implement\n```';
    assert.strictEqual(stripCodeBlockMarkers(input), expected);
  });
});

// =============================================================================
// formatSubtaskOverview Tests
// =============================================================================

describe('formatSubtaskOverview', () => {
  test('returns empty string for empty array', () => {
    assert.strictEqual(formatSubtaskOverview([], 'focus-id'), '');
  });

  test('shows done subtasks with checkmark', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
      { id: '2', identifier: 'LIN-2', state: { type: 'canceled' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('✓ Done: LIN-1, LIN-2'));
  });

  test('shows remaining subtasks with circle', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'unstarted' } },
      { id: '2', identifier: 'LIN-2', state: { type: 'backlog' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('○ Remaining: LIN-1, LIN-2'));
  });

  test('marks focused subtask with arrow', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'unstarted' } },
      { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } }
    ];
    const result = formatSubtaskOverview(children, '2');
    assert.ok(result.includes('→ LIN-2'));
    assert.ok(!result.includes('→ LIN-1'));
  });

  test('shows in-progress status for started subtasks', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'started' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('LIN-1 (in progress)'));
  });

  test('groups completed and remaining separately', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
      { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } },
      { id: '3', identifier: 'LIN-3', state: { type: 'started' } }
    ];
    const result = formatSubtaskOverview(children, '2');
    const lines = result.split('\n');
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[0].includes('✓ Done: LIN-1'));
    assert.ok(lines[1].includes('○ Remaining:'));
    assert.ok(lines[1].includes('→ LIN-2'));
    assert.ok(lines[1].includes('LIN-3 (in progress)'));
  });

  test('handles only completed subtasks', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'completed' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('✓ Done: LIN-1'));
    assert.ok(!result.includes('○ Remaining'));
  });

  test('handles only remaining subtasks', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'unstarted' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(!result.includes('✓ Done'));
    assert.ok(result.includes('○ Remaining: LIN-1'));
  });
});

// =============================================================================
// LIN-279: Strategy Framing context — isEpicShapedParent + cousin rendering
// =============================================================================

describe('isEpicShapedParent', () => {
  test('returns true when parentChildCount >= EPIC_CHILD_THRESHOLD', () => {
    const parent = { title: 'Plain parent' };
    assert.strictEqual(isEpicShapedParent(parent, EPIC_CHILD_THRESHOLD), true);
    assert.strictEqual(isEpicShapedParent(parent, EPIC_CHILD_THRESHOLD + 1), true);
    assert.strictEqual(isEpicShapedParent(parent, EPIC_CHILD_THRESHOLD - 1), false);
  });

  test('returns true when parent title contains "Phase"', () => {
    assert.strictEqual(isEpicShapedParent({ title: 'Phase 2 cleanup' }, 1), true);
  });

  test('returns true when parent title contains "Migration"', () => {
    assert.strictEqual(isEpicShapedParent({ title: 'ESM Migration' }, 1), true);
  });

  test('returns true when parent title contains "Epic"', () => {
    assert.strictEqual(isEpicShapedParent({ title: 'Auth Epic' }, 1), true);
  });

  test('returns true when parent title contains a Unicode em-dash (not a hyphen)', () => {
    // em-dash is U+2014, distinct from hyphen-minus (-) and en-dash (–)
    assert.strictEqual(isEpicShapedParent({ title: 'Auth — refresh tokens' }, 1), true);
    // Plain hyphen-minus must NOT trigger
    assert.strictEqual(isEpicShapedParent({ title: 'Auth - refresh tokens' }, 1), false);
  });

  test('matches tracker tokens case-insensitively', () => {
    assert.strictEqual(isEpicShapedParent({ title: 'phase 1' }, 1), true);
    assert.strictEqual(isEpicShapedParent({ title: 'EPIC: launch' }, 1), true);
  });

  test('returns false when parent has 1 child and title is plain', () => {
    assert.strictEqual(isEpicShapedParent({ title: 'Plain task' }, 1), false);
  });

  test('returns false when parent is null', () => {
    assert.strictEqual(isEpicShapedParent(null, 5), false);
    assert.strictEqual(isEpicShapedParent(null, null), false);
  });

  test('fail-safe: includes when child count missing but title carries tracker language', () => {
    // Ambiguous child count, but the title is unambiguous — include.
    assert.strictEqual(isEpicShapedParent({ title: 'Phase 1: prep' }, null), true);
    assert.strictEqual(isEpicShapedParent({ title: 'Big Migration' }, undefined), true);
  });

  test('exported constants have expected values', () => {
    assert.strictEqual(EPIC_CHILD_THRESHOLD, 4);
    assert.strictEqual(COUSIN_CAP, 20);
    assert.strictEqual(SIBLING_CAP, 5);
    assert.ok(EPIC_TITLE_PATTERN instanceof RegExp);
  });
});

describe('formatIssueContext siblings', () => {
  const baseIssue = {
    id: 'i-cur',
    identifier: 'LIN-100',
    title: 'Current issue',
    description: 'Body',
    state: { name: 'Todo', type: 'unstarted' },
    labels: []
  };

  function makeSibling(num, stateType = 'unstarted', stateName = 'Todo') {
    return {
      id: `s-${num}`,
      identifier: `LIN-${100 + num}`,
      title: `Sibling ${num}`,
      state: { name: stateName, type: stateType }
    };
  }

  test('when truncation fires: renders explicit MCP-fetch nudge, not bare "…and N more"', () => {
    // SIBLING_CAP + 7 total siblings, cap is 5, so 7 should be reported as "not shown"
    const siblings = Array.from({ length: SIBLING_CAP }, (_, i) => makeSibling(i + 1));
    const context = {
      parent: { id: 'p1', identifier: 'LIN-50', title: 'Migration Epic', state: { name: 'In Progress', type: 'started' } },
      parentChildCount: SIBLING_CAP + 7 + 1,
      siblings,
      siblingsTotal: SIBLING_CAP + 7,
      cousins: [],
      cousinsTotal: 0,
      children: [],
      comments: []
    };
    const result = formatIssueContext(baseIssue, context);
    // Positive assertion on the instruction string
    assert.ok(result.includes('7 siblings not shown.'), 'must report exact N not shown');
    assert.ok(
      result.includes('fetch the parent epic\'s full child list via Linear MCP'),
      'must include explicit MCP-fetch instruction'
    );
    assert.ok(
      result.includes('Strategy Framing'),
      'must cross-reference the Strategy Framing step that consumes this list'
    );
    // Negative assertion: bare "…and N more" is the failure mode being prevented
    assert.ok(!result.includes('…and '), 'must NOT use bare "…and N more"');
    assert.ok(!result.match(/siblings.*and \d+ more/), 'must NOT use bare "and N more"');
  });

  test('when truncation does NOT fire: MCP-fetch nudge is absent', () => {
    const context = {
      parent: { id: 'p1', identifier: 'LIN-50', title: 'Migration Epic', state: { name: 'In Progress', type: 'started' } },
      parentChildCount: 4,
      siblings: [makeSibling(1), makeSibling(2), makeSibling(3)],
      siblingsTotal: 3,
      cousins: [],
      cousinsTotal: 0,
      children: [],
      comments: []
    };
    const result = formatIssueContext(baseIssue, context);
    assert.ok(result.includes('**Sibling Tasks:**'));
    assert.ok(!result.includes('siblings not shown'), 'nudge must be absent when not truncated');
    assert.ok(!result.includes('full child list via Linear MCP'), 'MCP-fetch instruction absent when not truncated');
  });
});

describe('formatIssueContext cousins', () => {
  const baseIssue = {
    id: 'i-cur',
    identifier: 'LIN-100',
    title: 'Current issue',
    description: 'Body',
    state: { name: 'Todo', type: 'unstarted' },
    labels: []
  };

  function makeCousin(num, stateType = 'unstarted', stateName = 'Todo') {
    return {
      id: `c-${num}`,
      identifier: `LIN-${200 + num}`,
      title: `Cousin ${num}`,
      state: { name: stateName, type: stateType }
    };
  }

  test('includes Related-work section when parent is epic-shaped and cousins are present', () => {
    const context = {
      parent: { id: 'p1', identifier: 'LIN-50', title: 'Migration Epic', state: { name: 'In Progress', type: 'started' } },
      parentChildCount: 5,
      siblings: [
        { id: 's1', identifier: 'LIN-101', title: 'Sibling A', state: { name: 'In Progress', type: 'started' } }
      ],
      cousins: [makeCousin(1), makeCousin(2)],
      cousinsTotal: 2,
      children: [],
      comments: []
    };
    const result = formatIssueContext(baseIssue, context);
    assert.ok(result.includes('Related work in the parent epic:'), 'must render cousin section');
    assert.ok(result.includes('LIN-201'));
    assert.ok(result.includes('Cousin 1'));
  });

  test('omits Related-work section when parentChildCount === 1', () => {
    const context = {
      parent: { id: 'p1', identifier: 'LIN-50', title: 'Plain parent', state: { name: 'In Progress', type: 'started' } },
      parentChildCount: 1,
      siblings: [],
      cousins: [],
      cousinsTotal: 0,
      children: [],
      comments: []
    };
    const result = formatIssueContext(baseIssue, context);
    assert.ok(!result.includes('Related work in the parent epic'), 'must omit cousin section');
  });

  test('omits Related-work section when parent has multiple children but title is plain AND child count < threshold', () => {
    const context = {
      parent: { id: 'p1', identifier: 'LIN-50', title: 'Plain parent', state: { name: 'In Progress', type: 'started' } },
      parentChildCount: EPIC_CHILD_THRESHOLD - 1,
      siblings: [
        { id: 's1', identifier: 'LIN-101', title: 'Sibling A', state: { name: 'Todo', type: 'unstarted' } }
      ],
      cousins: [makeCousin(1)],
      cousinsTotal: 1,
      children: [],
      comments: []
    };
    const result = formatIssueContext(baseIssue, context);
    assert.ok(!result.includes('Related work in the parent epic'), 'must omit cousin section when not epic-shaped');
  });

  test('when truncation fires: renders explicit MCP-fetch nudge, not bare "…and N more"', () => {
    // 25 cousins total, cap is 20, so 5 should be reported as "not shown"
    const cousins = Array.from({ length: COUSIN_CAP }, (_, i) => makeCousin(i + 1));
    const context = {
      parent: { id: 'p1', identifier: 'LIN-50', title: 'Migration Epic', state: { name: 'In Progress', type: 'started' } },
      parentChildCount: 8,
      siblings: [],
      cousins,
      cousinsTotal: COUSIN_CAP + 5,
      children: [],
      comments: []
    };
    const result = formatIssueContext(baseIssue, context);
    // Positive assertion on the instruction string
    assert.ok(result.includes('5 cousins not shown.'), 'must report exact N not shown');
    assert.ok(
      result.includes('fetch the parent epic\'s full descendant tree via Linear MCP'),
      'must include explicit MCP-fetch instruction'
    );
    assert.ok(
      result.includes('Strategy Framing'),
      'must cross-reference the Strategy Framing step that consumes this list'
    );
    // Negative assertion: bare "…and N more" is the failure mode being prevented
    assert.ok(!result.includes('…and '), 'must NOT use bare "…and N more"');
    assert.ok(!result.match(/and \d+ more/), 'must NOT use bare "and N more"');
  });

  test('when truncation does NOT fire: MCP-fetch nudge is absent', () => {
    const context = {
      parent: { id: 'p1', identifier: 'LIN-50', title: 'Migration Epic', state: { name: 'In Progress', type: 'started' } },
      parentChildCount: 5,
      siblings: [],
      cousins: [makeCousin(1), makeCousin(2), makeCousin(3)],
      cousinsTotal: 3,
      children: [],
      comments: []
    };
    const result = formatIssueContext(baseIssue, context);
    assert.ok(result.includes('Related work in the parent epic'));
    assert.ok(!result.includes('cousins not shown'), 'nudge must be absent when not truncated');
    assert.ok(!result.includes('via Linear MCP'), 'MCP-fetch instruction absent when not truncated');
  });

  test('cousins section appears AFTER Sibling Tasks and BEFORE Existing Subtasks', () => {
    const context = {
      parent: { id: 'p1', identifier: 'LIN-50', title: 'Migration Epic', state: { name: 'In Progress', type: 'started' } },
      parentChildCount: 5,
      siblings: [
        { id: 's1', identifier: 'LIN-101', title: 'Sibling A', state: { name: 'Todo', type: 'unstarted' } }
      ],
      cousins: [makeCousin(1)],
      cousinsTotal: 1,
      children: [
        { id: 'c1', identifier: 'LIN-301', title: 'Child 1', state: { name: 'Todo', type: 'unstarted' } }
      ],
      comments: []
    };
    const result = formatIssueContext(baseIssue, context);
    const siblingIdx = result.indexOf('**Sibling Tasks:**');
    const cousinIdx = result.indexOf('**Related work in the parent epic:**');
    const childrenIdx = result.indexOf('**Existing Subtasks:**');
    assert.notStrictEqual(siblingIdx, -1);
    assert.notStrictEqual(cousinIdx, -1);
    assert.notStrictEqual(childrenIdx, -1);
    assert.ok(siblingIdx < cousinIdx, 'cousins must appear after Sibling Tasks');
    assert.ok(cousinIdx < childrenIdx, 'cousins must appear before Existing Subtasks');
  });

  test('two-tier focusedChild branch skips cousins to avoid double-rendering', () => {
    // In two-tier mode, the parent IS the current issue and "cousins" would be
    // the focusedChild's siblings — already in the children list. Skip them.
    const context = {
      parent: { id: 'p1', identifier: 'LIN-50', title: 'Migration Epic', state: { name: 'In Progress', type: 'started' } },
      parentChildCount: 6,
      siblings: [],
      cousins: [makeCousin(1), makeCousin(2)],
      cousinsTotal: 2,
      children: [
        { id: 'fc', identifier: 'LIN-150', title: 'Focused subtask', state: { name: 'Todo', type: 'unstarted' } }
      ],
      comments: [],
      focusedChild: {
        issue: {
          id: 'fc',
          identifier: 'LIN-150',
          title: 'Focused subtask',
          description: 'Sub body',
          state: { name: 'Todo', type: 'unstarted' },
          labels: []
        },
        comments: []
      }
    };
    const result = formatIssueContext(baseIssue, context);
    assert.ok(!result.includes('Related work in the parent epic'), 'cousins must be skipped in two-tier branch');
  });
});

// =============================================================================
// Meta-prompt: Plan completeness check (mirrors handwritten path)
// =============================================================================

describe('buildMetaPromptTemplate defer routing (LIN-327)', () => {
  function build(overrides = {}) {
    return buildMetaPromptTemplate({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: false, commentCount: 0, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '), ...overrides
    });
  }

  test('node-shaped tasks get the defer-vs-node-work decision step', () => {
    const text = build({ hasSubtasks: true, subtaskCount: 3, remainingCount: 2 });
    assert.ok(text.includes('defer'), 'defer must appear in a node-shaped meta-prompt');
    assert.ok(/defer.*vs.*node-work/i.test(text), 'the node-work-vs-defer decision must be present');
  });

  test('leaf tasks do NOT get the defer decision step (no child to defer to)', () => {
    const text = build({ hasSubtasks: false });
    assert.ok(!text.includes('vs. node-work'), 'leaf tasks must not see the defer decision step');
  });

  test('output contract documents the DeferTo line and the empty-prompt-on-defer rule', () => {
    const text = build({ hasSubtasks: true, subtaskCount: 2, remainingCount: 2 });
    assert.ok(text.includes('DeferTo:'), 'the structured DeferTo contract line must be documented');
    assert.ok(/do NOT generate a prompt body/i.test(text) || /leave the Prompt section empty/i.test(text),
      'the no-prompt-body rule for defer must be stated');
  });

  test('defer appears in the emittable action vocabulary list', () => {
    const text = build({ hasSubtasks: true });
    assert.ok(text.includes('defer'), 'defer must be in the action vocabulary the meta-prompt prints');
  });
});

describe('buildMetaPromptTemplate plan completeness check', () => {
  function build() {
    return buildMetaPromptTemplate({
      issueContext: 'Test context',
      identifier: 'LIN-1',
      hasSubtasks: false,
      subtaskCount: 0,
      completedCount: 0,
      inProgressCount: 0,
      remainingCount: 0,
      hasComments: false,
      commentCount: 0,
      aiHints: 'hints'
    });
  }

  // The completeness check guards the breadth failure: the same concept is often
  // implemented in more than one place under a different name, and a clean search
  // for the cited symbol is not proof the surface list is complete.
  test('Plan-prompts rule instructs a completeness check on the surface list', () => {
    const result = build();
    assert.ok(result.includes('completeness check'), 'meta-prompt must require a completeness check');
  });

  test('completeness check searches the concept, not just the cited symbol', () => {
    const result = build();
    assert.ok(
      result.includes('not proof of completeness'),
      'must state that a clean search for the cited symbol is not proof of completeness'
    );
  });

  test('completeness check allows a genuinely single-surface result', () => {
    const result = build();
    assert.ok(
      result.includes('single-surface result is valid'),
      'must not misfire on genuinely localized changes'
    );
  });
});

// =============================================================================
// Surface Assessment (refactoring recommendations) — AI path
//
// Research must surface a refactor recommendation, and plan must sequence a named
// prerequisite refactor as a separate blocking subtask. These guard the meta-prompt
// rules against drift and mirror the handwritten-path tests in
// tests/unit/prompt-templates.test.js.
// =============================================================================

describe('buildMetaPromptTemplate Surface Assessment', () => {
  function build() {
    return buildMetaPromptTemplate({
      issueContext: 'Test context',
      identifier: 'LIN-1',
      hasSubtasks: false,
      subtaskCount: 0,
      completedCount: 0,
      inProgressCount: 0,
      remainingCount: 0,
      hasComments: false,
      commentCount: 0,
      aiHints: 'hints'
    });
  }

  test('research-prompts rule requires a Surface Assessment naming any refactor', () => {
    const result = build();
    assert.ok(result.includes('Surface Assessment'), 'meta-prompt must require a Surface Assessment');
    assert.ok(result.includes('refactor needed'), 'must offer the refactor-needed option');
  });

  test('plan-prompts rule sequences a prerequisite refactor as a separate blocking subtask', () => {
    const result = build();
    assert.ok(
      result.includes('separate blocking subtask'),
      'plan rule must encode a prerequisite refactor as a separate blocking subtask'
    );
    assert.ok(
      result.includes('do not absorb the refactor into implementation steps'),
      'plan rule must preserve the sequencing guarantee'
    );
  });
});

// =============================================================================
// Scale to the task (lower bound, LIN-260) — the meta-prompt must size the
// generated prompt to the task, with the deceptive-small over-trim guard.
// Proven via scripts/eval-prompt-scaling.mjs; mirrored in the handwritten path
// (tests/unit/prompt-templates.test.js) per CLAUDE.md's both-paths rule.
// =============================================================================

describe('buildMetaPromptTemplate scale to the task', () => {
  function build() {
    return buildMetaPromptTemplate({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: false, commentCount: 0, aiHints: 'hints'
    });
  }

  test('meta-prompt includes the Scale To The Task rule', () => {
    assert.ok(build().includes('## Scale To The Task'), 'meta-prompt must size output to the task');
  });

  test('scale rule licenses a short prompt for a small task', () => {
    assert.ok(
      build().includes('A short prompt for a small task is correct'),
      'must license brevity so small tasks are not padded to fill the scaffold'
    );
  });

  test('scale rule carries the deceptive-small over-trim guard', () => {
    const result = build();
    assert.ok(
      result.includes('across the codebase') && result.includes('Do NOT infer "small" from a terse description'),
      'must warn that a terse description does not imply a small task'
    );
  });
});

// =============================================================================
// Action vocabulary — the meta-prompt's `→ **action**` must stay inside the
// vocabulary deriveDispatchKind() understands, so the fused recommend-and-dispatch
// verb lands a real `kind` (not the `custom` fallback) for every known type.
// =============================================================================

describe('action vocabulary (kind derivation seam)', () => {
  const base = {
    issueContext: 'ctx', identifier: 'LIN-1', hasSubtasks: false, subtaskCount: 0,
    completedCount: 0, inProgressCount: 0, remainingCount: 0, hasComments: false,
    commentCount: 0, aiHints: 'hints'
  };

  test('getAIRecommendationActionNames returns mappable names and excludes retro', () => {
    const names = getAIRecommendationActionNames();
    assert.ok(names.includes('plan'));
    assert.ok(names.includes('implement'));
    assert.ok(names.includes('code review'));
    assert.ok(!names.includes('retro'), 'retro is excluded from AI recommendation');
  });

  test('every recommended action name derives to a real (non-custom) kind', () => {
    for (const name of getAIRecommendationActionNames()) {
      assert.notStrictEqual(
        deriveDispatchKind(name), DISPATCH_KIND_DEFAULT,
        `recommended action "${name}" should map to a known kind, not "${DISPATCH_KIND_DEFAULT}"`
      );
    }
  });

  test('meta-prompt embeds the supplied vocabulary and the verbatim-one instruction', () => {
    const vocab = getAIRecommendationActionNames().join(', ');
    const text = buildMetaPromptTemplate({ ...base, actionVocabulary: vocab });
    assert.ok(text.includes(vocab), 'the action vocabulary list must appear in the meta-prompt');
    assert.ok(text.includes('EXACTLY one action name'), 'the verbatim-one constraint must be stated');
  });

  test('falls back to an example set when no vocabulary is supplied', () => {
    const text = buildMetaPromptTemplate({ ...base });
    assert.ok(text.includes('plan, research, implement'), 'a sensible fallback list is present');
  });

  // LIN-327: `defer` is a recommend-meta action — emittable by the recommender,
  // a valid kind, and self-deriving (NOT the custom fallback), despite having no
  // PROMPT_TEMPLATES entry / no prompt body.
  test('defer is in the AI recommendation vocabulary', () => {
    assert.ok(getAIRecommendationActionNames().includes('defer'),
      'defer must be offered to the meta-prompt as an emittable action');
  });

  test('defer is a valid dispatch kind and derives to itself (not custom)', () => {
    assert.strictEqual(isValidDispatchKind('defer'), true);
    assert.strictEqual(deriveDispatchKind('defer'), 'defer');
    assert.notStrictEqual(deriveDispatchKind('defer'), DISPATCH_KIND_DEFAULT);
  });
});

// =============================================================================
// parseDeferTo Tests (LIN-327)
// =============================================================================

describe('parseDeferTo', () => {
  test('extracts the target identifier from the DeferTo contract line', () => {
    const reasoning = '→ **defer**\n**Next:** descend\n**DeferTo:** LIN-297';
    assert.strictEqual(parseDeferTo(reasoning), 'LIN-297');
  });

  test('tolerates missing markdown bold around the value', () => {
    assert.strictEqual(parseDeferTo('DeferTo: ABC-12'), 'ABC-12');
  });

  test('extracts a UUID target', () => {
    const uuid = '663837bb-e936-4e01-a13c-eb62fc37b3d6';
    assert.strictEqual(parseDeferTo(`**DeferTo:** ${uuid}`), uuid);
  });

  test('returns null when the DeferTo line is absent', () => {
    assert.strictEqual(parseDeferTo('→ **research**\n**Next:** investigate'), null);
  });

  test('returns null for non-string input', () => {
    assert.strictEqual(parseDeferTo(null), null);
    assert.strictEqual(parseDeferTo(undefined), null);
  });
});

// =============================================================================
// parseRecommendationResponse Tests (LIN-327 — defer no-body cost contract)
// =============================================================================

describe('parseRecommendationResponse', () => {
  test('a normal action carries its prompt body and a null deferTo', () => {
    const content = '## Reasoning\n→ **research**\n**Next:** investigate\n\n## Prompt\nGo research the thing.';
    const result = parseRecommendationResponse(content, 'stop', 120);
    assert.strictEqual(result.recommendedAction, 'research');
    assert.strictEqual(result.prompt, 'Go research the thing.');
    assert.strictEqual(result.deferTo, null);
  });

  test('a defer reply carries NO prompt body and a deferTo target', () => {
    const content = '## Reasoning\n→ **defer**\n**Next:** descend to the child\n**DeferTo:** LIN-297\n\n## Prompt\n';
    const result = parseRecommendationResponse(content, 'stop', 30);
    assert.strictEqual(result.recommendedAction, 'defer');
    assert.strictEqual(result.deferTo, 'LIN-297');
    assert.strictEqual(result.prompt, null, 'defer must not carry a prompt body (cost contract)');
  });

  test('a defer reply that emits a prompt body still drops it (no body ever survives)', () => {
    const content = '## Reasoning\n→ **defer**\n**DeferTo:** LIN-300\n\n## Prompt\nStray body the model should not have written.';
    const result = parseRecommendationResponse(content, 'stop', 40);
    assert.strictEqual(result.recommendedAction, 'defer');
    assert.strictEqual(result.deferTo, 'LIN-300');
    assert.strictEqual(result.prompt, null, 'a defer prompt body is discarded, not returned');
  });

  test('a defer reply missing its DeferTo target throws', () => {
    const content = '## Reasoning\n→ **defer**\n**Next:** descend\n\n## Prompt\n';
    assert.throws(() => parseRecommendationResponse(content, 'stop', 10), /DeferTo target/);
  });

  test('a non-defer reply missing its prompt body throws', () => {
    const content = '## Reasoning\n→ **plan**\n**Next:** plan it\n\n## Prompt\n';
    assert.throws(() => parseRecommendationResponse(content, 'stop', 10), /missing ## Reasoning or ## Prompt/);
  });

  test('marks truncated when finish_reason is length', () => {
    const content = '## Reasoning\n→ **plan**\n\n## Prompt\nPlan body.';
    assert.strictEqual(parseRecommendationResponse(content, 'length', 8000).truncated, true);
  });
});

// =============================================================================
// parseRecommendedAction Tests (LIN-321)
// =============================================================================

describe('parseRecommendedAction', () => {
  test('extracts a well-formed lowercase action', () => {
    const reasoning = 'Assessment...\n→ **plan**\n**Next:** ...';
    assert.strictEqual(parseRecommendedAction(reasoning), 'plan');
  });

  test('extracts a capitalised display-name variant verbatim (trimmed)', () => {
    const reasoning = '→ **Plan**';
    assert.strictEqual(parseRecommendedAction(reasoning), 'Plan');
  });

  test('extracts multi-word action names', () => {
    assert.strictEqual(parseRecommendedAction('→ **code review**'), 'code review');
  });

  test('matches the meta-prompt format with parenthetical examples after the line', () => {
    const reasoning = '**Signal Status:** met\n→ **bug**\n**Next:** verify the fix';
    assert.strictEqual(parseRecommendedAction(reasoning), 'bug');
  });

  test('returns null when the arrow line is absent', () => {
    assert.strictEqual(parseRecommendedAction('Assessment without an action line'), null);
  });

  test('returns null for non-string input', () => {
    assert.strictEqual(parseRecommendedAction(null), null);
    assert.strictEqual(parseRecommendedAction(undefined), null);
    assert.strictEqual(parseRecommendedAction(42), null);
  });
});
