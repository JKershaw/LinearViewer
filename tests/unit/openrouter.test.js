/**
 * Unit tests for openrouter.js
 *
 * Run with: node --test tests/unit/openrouter.test.js
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  stripCodeBlockMarkers,
  formatSubtaskOverview,
  formatIssueContext,
  isEpicShapedParent,
  parseRecommendedAction,
  parseDeferTo,
  parseRecommendationResponse,
  applyGroundingToRecommendation,
  getRecommendationStream,
  getRecommendation,
  setLlmCallRecorder,
  setPromptTraceRecorder,
  getModelDisplayName,
  formatModelPricing,
  getModelPricingHint,
  AVAILABLE_MODELS,
  getPaidEnvKey,
  hasPaidEnvKey,
  isRecommendationEnabled,
  DEFAULT_MODEL,
  EPIC_CHILD_THRESHOLD,
  COUSIN_CAP,
  SIBLING_CAP,
  EPIC_TITLE_PATTERN
} from '../../lib/openrouter.js';
import { appendGroundingSections } from '../../lib/prompt-formatters.js';
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

  test('shows remaining subtasks with circle, one per line', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'unstarted' } },
      { id: '2', identifier: 'LIN-2', state: { type: 'backlog' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('○ Remaining:'));
    assert.ok(result.includes('LIN-1'));
    assert.ok(result.includes('LIN-2'));
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
    assert.ok(lines[0].includes('✓ Done: LIN-1'));
    assert.ok(lines[1].includes('○ Remaining:'));
    assert.ok(result.includes('→ LIN-2'));
    assert.ok(result.includes('LIN-3 (in progress)'));
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
    assert.ok(result.includes('○ Remaining:'));
    assert.ok(result.includes('LIN-1'));
  });

  test('shows remaining subtask titles so the recommender can choose', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', title: 'Wire the auth route', state: { type: 'backlog' } },
      { id: '2', identifier: 'LIN-2', title: 'Capability-aware rendering', state: { type: 'backlog' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('Wire the auth route'));
    assert.ok(result.includes('Capability-aware rendering'));
  });

  test('annotates a child that itself has subtasks with a count', () => {
    const children = [
      {
        id: '1', identifier: 'LIN-1', title: 'A node', state: { type: 'backlog' },
        children: { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
      },
      { id: '2', identifier: 'LIN-2', title: 'A leaf', state: { type: 'backlog' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('LIN-1 A node [3 subtasks]'), 'plural count for a node child');
    assert.ok(!result.includes('LIN-2 A leaf ['), 'no count annotation for a leaf child');
  });

  test('singular subtask label for exactly one nested child', () => {
    const children = [
      {
        id: '1', identifier: 'LIN-1', title: 'A node', state: { type: 'backlog' },
        children: { nodes: [{ id: 'a' }] }
      }
    ];
    assert.ok(formatSubtaskOverview(children, null).includes('[1 subtask]'));
  });

  // Display order must match the focus picker (lowest identifier first), even when
  // the input arrives in Linear's newest-first connection order (LIN-177 shape).
  test('orders remaining by identifier regardless of input order', () => {
    const children = [
      { id: '5', identifier: 'LIN-337', title: 'S5', state: { type: 'backlog' } },
      { id: '4', identifier: 'LIN-336', title: 'S4', state: { type: 'backlog' } },
      { id: '2', identifier: 'LIN-334', title: 'S2', state: { type: 'backlog' } }
    ];
    const result = formatSubtaskOverview(children, null);
    const remainingLines = result.split('\n').filter(l => /LIN-33\d/.test(l));
    assert.ok(remainingLines[0].includes('LIN-334'), 'lowest identifier listed first');
    assert.ok(remainingLines[2].includes('LIN-337'), 'highest identifier listed last');
  });
});

// =============================================================================
// LIN-279: Strategy Framing context — isEpicShapedParent + cousin rendering
// =============================================================================

describe('getModelDisplayName', () => {
  test('returns the curated name for a known model id', () => {
    assert.strictEqual(getModelDisplayName('openai/gpt-5.4-mini'), 'GPT-5.4 Mini');
    assert.strictEqual(getModelDisplayName('anthropic/claude-opus-4.8'), 'Claude Opus 4.8');
    assert.strictEqual(getModelDisplayName('openai/gpt-5.5'), 'GPT-5.5');
    assert.strictEqual(getModelDisplayName('openai/gpt-5.5-pro'), 'GPT-5.5 Pro');
  });

  test('falls back to the provider-stripped slug for an uncurated id', () => {
    assert.strictEqual(getModelDisplayName('some-provider/custom-model-v2'), 'custom-model-v2');
  });

  test('returns the id unchanged when there is no provider prefix', () => {
    assert.strictEqual(getModelDisplayName('bare-model'), 'bare-model');
  });

  test('defaults to the default model name when id is falsy', () => {
    assert.strictEqual(getModelDisplayName(''), getModelDisplayName(DEFAULT_MODEL));
    assert.strictEqual(getModelDisplayName(null), getModelDisplayName(DEFAULT_MODEL));
    assert.strictEqual(getModelDisplayName(undefined), getModelDisplayName(DEFAULT_MODEL));
  });
});

describe('formatModelPricing / getModelPricingHint (LIN-993)', () => {
  test('formats a model rate card as a compact in/out hint', () => {
    assert.strictEqual(
      formatModelPricing({ pricing: { prompt: 0.75, completion: 4.5 } }),
      '$0.75 in / $4.50 out per 1M tokens'
    );
  });

  test('returns null when pricing is missing or malformed', () => {
    assert.strictEqual(formatModelPricing(null), null);
    assert.strictEqual(formatModelPricing({}), null);
    assert.strictEqual(formatModelPricing({ pricing: { prompt: 1 } }), null);
    assert.strictEqual(formatModelPricing({ pricing: { prompt: 'x', completion: 'y' } }), null);
  });

  test('getModelPricingHint resolves a curated id, null for unknown', () => {
    assert.strictEqual(getModelPricingHint('openai/gpt-5.4-mini'), '$0.75 in / $4.50 out per 1M tokens');
    assert.strictEqual(getModelPricingHint('some-provider/unknown-model'), null);
  });

  test('every curated model carries a well-formed pricing rate', () => {
    for (const m of AVAILABLE_MODELS) {
      assert.ok(m.pricing, `model ${m.id} must carry a pricing rate`);
      assert.strictEqual(typeof m.pricing.prompt, 'number', `${m.id} prompt rate is a number`);
      assert.strictEqual(typeof m.pricing.completion, 'number', `${m.id} completion rate is a number`);
      assert.ok(m.pricing.prompt >= 0 && m.pricing.completion >= 0, `${m.id} rates are non-negative`);
    }
  });
});

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
      result.includes('fetch the parent epic\'s full child list via the API'),
      'must include explicit API-fetch instruction'
    );
    assert.ok(
      result.includes('Strategy Framing'),
      'must cross-reference the Strategy Framing step that consumes this list'
    );
    // Negative assertion: bare "…and N more" is the failure mode being prevented
    assert.ok(!result.includes('…and '), 'must NOT use bare "…and N more"');
    assert.ok(!result.match(/siblings.*and \d+ more/), 'must NOT use bare "and N more"');
  });

  test('when truncation does NOT fire: API-fetch nudge is absent', () => {
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
    assert.ok(!result.includes('full child list via the API'), 'API-fetch instruction absent when not truncated');
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
      result.includes('fetch the parent epic\'s full descendant tree via the API'),
      'must include explicit API-fetch instruction'
    );
    assert.ok(
      result.includes('Strategy Framing'),
      'must cross-reference the Strategy Framing step that consumes this list'
    );
    // Negative assertion: bare "…and N more" is the failure mode being prevented
    assert.ok(!result.includes('…and '), 'must NOT use bare "…and N more"');
    assert.ok(!result.match(/and \d+ more/), 'must NOT use bare "and N more"');
  });

  test('when truncation does NOT fire: API-fetch nudge is absent', () => {
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
    assert.ok(!result.includes('via the API'), 'API-fetch instruction absent when not truncated');
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

describe('buildMetaPromptTemplate terminal-state branch (LIN-353)', () => {
  function build(overrides = {}) {
    return buildMetaPromptTemplate({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: false, commentCount: 0, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '), ...overrides
    });
  }

  test('a terminal leaf (no open children) gets a Done branch steering to review/close, not look-into', () => {
    const text = build({ isTerminal: true, hasOpenChildren: false });
    assert.ok(/terminal state/i.test(text), 'the Done branch must be present');
    assert.ok(/\breview\b/.test(text), 'a terminal leaf must be steered toward review/close');
    assert.ok(/do NOT recommend .*look-into/i.test(text) || /never to redo/i.test(text),
      'the Done branch must forbid no-op look-into/busywork');
  });

  test('a non-terminal task does NOT get the Done branch', () => {
    const text = build({ isTerminal: false, hasOpenChildren: false });
    assert.ok(!/### Step 0:/.test(text), 'open tasks must not see the terminal Step 0');
  });

  test('a terminal task WITH open children is told to descend, not close (Scenario J)', () => {
    const text = build({ isTerminal: true, hasOpenChildren: true, hasSubtasks: true, subtaskCount: 2, remainingCount: 1 });
    assert.ok(/still has open children/i.test(text), 'the open-children terminal branch must be present');
    assert.ok(/descend|route to the open child/i.test(text), 'it must steer toward the open child, not close');
  });

  test('an open parent whose every subtask is terminal gets the unified Step 0 review/close branch', () => {
    const text = build({ isTerminal: false, hasSubtasks: true, subtaskCount: 3, remainingCount: 0, hasOpenChildren: false });
    assert.ok(/### Step 0:/.test(text), 'the unified completion Step 0 must fire for an all-subtasks-done parent');
    assert.ok(/\breview\b/.test(text), 'it must steer toward review/close');
    assert.ok(/close it out|close-out/i.test(text), 'it must frame the remaining work as the parent close-out');
    assert.ok(/do NOT \`?defer\`?/i.test(text), 'it must still forbid deferring into a finished child (LIN-364)');
  });
});

// =============================================================================
// Review routing (review-never-recommended fix): `review` is no longer gated to
// terminal/all-subtasks-done states. Step 3 routes a leaf whose implementation has
// already landed (completion signals recorded) to `review` instead of looping
// `implementation` — the cause of merged-but-In-Progress tasks never advancing.
// =============================================================================
describe('buildMetaPromptTemplate review routing for landed implementation', () => {
  function build(overrides = {}) {
    return buildMetaPromptTemplate({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: true, commentCount: 2, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '), ...overrides
    });
  }

  test('Step 3 instructs routing an already-landed implementation to review', () => {
    const text = build({ isTerminal: false, hasOpenChildren: false });
    assert.ok(/already landed/i.test(text), 'Step 3 must check whether implementation has already landed');
    assert.ok(/Recommend \`review\`/.test(text), 'a landed implementation must route to review');
  });

  test('Step 3 guards against re-recommending implementation on done work and on In Progress alone', () => {
    const text = build({ isTerminal: false, hasOpenChildren: false });
    assert.ok(/Do NOT re-recommend \`implementation\` on work that is already done/i.test(text),
      'it must forbid re-implementing already-done work');
    assert.ok(/In Progress state is NOT by itself evidence/i.test(text),
      'an In Progress state alone must not be read as unfinished');
  });
});

// =============================================================================
// Review routing for a PLAN-LESS leaf (LIN-448) — LIN-431's already-landed guard
// only fired inside the "a complete plan exists" branch, so a research→implementation
// leaf (no `plan` step, no `## Implementation Plan` block, no session-fit answer)
// bypassed it and fell through to "implementation readiness" (the "simple enough to
// implement directly" path), looping `implementation` on a merged-but-In-Progress
// leaf. The fix hoists the landed check ABOVE the plan gate so it fires for any leaf
// carrying completion signals, planned or not.
// =============================================================================
describe('buildMetaPromptTemplate review routing for a plan-less landed leaf (LIN-448)', () => {
  function build(overrides = {}) {
    return buildMetaPromptTemplate({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: true, commentCount: 1, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '), ...overrides
    });
  }

  test('the already-landed check is hoisted ABOVE the plan-exists gate, not nested under it', () => {
    const text = build({ isTerminal: false, hasOpenChildren: false });
    const landedIdx = text.indexOf('already landed');
    const planGateIdx = text.indexOf('check whether a plan exists');
    assert.ok(landedIdx !== -1, 'the already-landed check must be present in Step 3');
    assert.ok(planGateIdx !== -1, 'the plan-exists gate must be present in Step 3');
    assert.ok(landedIdx < planGateIdx,
      'the already-landed check must precede the plan-exists gate so plan-less leaves still hit it');
  });

  test('the landed check explicitly covers the plan-less research→implementation leaf shape', () => {
    const text = build({ isTerminal: false, hasOpenChildren: false });
    assert.ok(/plan-less\s+\`research → implementation\`\s+leaf/i.test(text),
      'the landed-check must name the plan-less research→implementation leaf shape from LIN-448');
    assert.ok(/no \`plan\` step/i.test(text),
      'it must acknowledge leaves that reached implementation with no plan step');
  });

  test('"simple enough to implement directly" is explicitly NOT a reason to skip the landed check', () => {
    const text = build({ isTerminal: false, hasOpenChildren: false });
    assert.ok(/small enough to just do it.*NOT a reason to skip this landed-evidence check/is.test(text),
      'the "simple enough to implement directly" path must not bypass the landed-evidence check');
  });

  test('the guard applies to a childless open leaf (no subtasks, In Progress)', () => {
    const text = build({ isTerminal: false, hasSubtasks: false, hasOpenChildren: false });
    // Step 0's deterministic review rule cannot fire for a childless open leaf...
    assert.ok(!/### Step 0: The substantive work here is already complete/.test(text),
      'Step 0 deterministic review must NOT fire for a childless open leaf (the LIN-448 gap)');
    // ...so Step 3's hoisted soft check is the path that must route it to review.
    assert.ok(/already landed/i.test(text) && /Recommend \`review\`/.test(text),
      'Step 3 must carry the already-landed → review path for the childless open leaf');
  });
});

// =============================================================================
// Close-out routing gate (LIN-812) — close-out and review are the positive/negative
// pair of ONE decision (the review→close-out split, LIN-550; the verdict-not-heading
// relax, LIN-810; the positive-review-evidence requirement, LIN-811). The recommender
// baseline did not cover `close-out` at all (LIN-804: it fired ~1/3 of the time it
// should), so these structural guards pin the routing prose that the LLM shape-coverage
// fixtures (scripts/eval/fixtures/recommend/closeout-review.json) measure under load.
// The decision is driven by COMMENT-TRAIL state: an Approve verdict on record +
// unmerged → close-out; work that merely looks done with NO review-verdict comment →
// review. Step 0 carries it for the already-complete node; Step 3 for the landed leaf.
// =============================================================================
describe('buildMetaPromptTemplate close-out routing gate (LIN-812)', () => {
  function build(overrides = {}) {
    return buildMetaPromptTemplate({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: true, commentCount: 2, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '), ...overrides
    });
  }

  test('Step 0 routes an approved-but-unmerged finished task to close-out, not another review', () => {
    // All subtasks complete (hasSubtasks, no open children) arms the Step-0 branch.
    const text = build({ isTerminal: false, hasSubtasks: true, subtaskCount: 2, completedCount: 2, hasOpenChildren: false });
    assert.ok(/### Step 0: The substantive work here is already complete/.test(text),
      'Step 0 must fire for a finished node with no open children');
    assert.ok(/Approve \(or Approve — conditional\) verdict and a ledger, but the work is still unmerged \/ not Done → recommend \`close-out\`, NOT another \`review\`/i.test(text),
      'Step 0 must route approved-but-unmerged work to close-out, not a repeated review');
  });

  test('Step 0 requires positive review evidence before close-out — looking done is not enough', () => {
    const text = build({ isTerminal: false, hasSubtasks: true, subtaskCount: 1, completedCount: 1, hasOpenChildren: false });
    assert.ok(/\`close-out\` requires positive evidence that a review actually ran/i.test(text),
      'close-out must demand positive evidence (a review-verdict comment) on the trail');
    assert.ok(/if no such review comment is on the trail, the review has not happened — recommend \`review\`/i.test(text),
      'absent a review-verdict comment, the gate must route to review');
    assert.ok(/When the evidence is ambiguous, default to \`review\`/i.test(text),
      'ambiguous evidence must default to review, never close-out');
  });

  test('Step 3 carries the landed-leaf close-out path (approve-on-record + unmerged)', () => {
    // Childless open leaf: Step 0 cannot fire, so Step 3 owns the close-out routing.
    const text = build({ isTerminal: false, hasSubtasks: false, hasOpenChildren: false });
    assert.ok(!/### Step 0: The substantive work here is already complete/.test(text),
      'Step 0 must NOT fire for a childless open leaf — Step 3 is the path');
    assert.ok(/Implementation landed AND \`review\` has already recorded an Approve \(or Approve — conditional\) verdict.*Recommend \`close-out\`/is.test(text),
      'Step 3 must route landed + approved-on-record + unmerged work to close-out');
    assert.ok(/A rich, detailed, or complete-looking description is not that evidence.*recommend \`review\`/is.test(text),
      'Step 3 must keep the LIN-811 positive-evidence requirement on the leaf path too');
  });

  test('the cannot-close branch routes landed-but-red / blocked work away from close-out', () => {
    const text = build({ isTerminal: false, hasSubtasks: true, subtaskCount: 1, completedCount: 1, hasOpenChildren: false });
    assert.ok(/Cannot-close branch/i.test(text),
      'Step 0 must carry the cannot-close branch');
    assert.ok(/if the comments already show the work landed but CI is red.*do NOT keep routing to \`review\` or \`close-out\`/is.test(text),
      'landed-but-red work must route to the blocker, not to review/close-out');
  });

  // LIN-823 — the LIN-811 review-evidence gate covered the generic "landed leaf, no
  // review" shape but missed the BUG path: a `bug`-labelled fix posts its own rich
  // investigation comments (`Root cause CONFIRMED`, findings, class-check, stepper
  // run-summary) that read review-ish and fooled the recommender into close-out before
  // review. The gate must now explicitly exclude that author-diagnosis commentary from
  // counting as a review verdict. The prose is shared by Step 0 and Step 3, so both
  // close-out decision points carry the exclusion.
  test('the close-out gate excludes a bug\'s own investigation commentary from review evidence (LIN-823)', () => {
    // Step 0 path (all subtasks complete) and Step 3 path (childless open leaf) must
    // both carry the bug-investigation exclusion.
    const step0 = build({ isTerminal: false, hasSubtasks: true, subtaskCount: 1, completedCount: 1, hasOpenChildren: false });
    const step3 = build({ isTerminal: false, hasSubtasks: false, hasOpenChildren: false });
    for (const [label, text] of [['Step 0', step0], ['Step 3', step3]]) {
      assert.ok(/a \`bug\`'s own investigation commentary is NOT a review verdict/i.test(text),
        `${label} must state that a bug's investigation commentary is not a review verdict`);
      assert.ok(/do NOT count root-cause, findings, class-check, or run-summary comments as review evidence/i.test(text),
        `${label} must exclude root-cause/findings/class-check/run-summary comments from review evidence`);
      assert.ok(/Only an actual \`review\` verdict on the trail .* authorizes \`close-out\`/is.test(text),
        `${label} must require an actual review verdict before close-out`);
    }
  });
});

// =============================================================================
// Over-advance guard (LIN-597) — the engine's dominant front-half miss is reaching
// too far down-lifecycle (e.g. `implement`) on a task with too little COMMITTED
// SCOPE to act. Step 3 now makes the rule explicit and one-directional: absent
// committed scope is itself the signal to plan/research, never implement — without
// touching the clearly-planned `implement` case or the genuinely-small direct path.
// =============================================================================
describe('buildMetaPromptTemplate over-advance guard (LIN-597)', () => {
  function build(overrides = {}) {
    return buildMetaPromptTemplate({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: true, commentCount: 1, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '), ...overrides
    });
  }

  test('Step 3 states the no-committed-scope rule explicitly', () => {
    const text = build();
    assert.ok(/no committed scope ⇒ never \`implement\`/i.test(text),
      'Step 3 must carry the explicit "no committed scope ⇒ never implement" rule');
  });

  test('the rule is one-directional — resolve DOWN to plan/research when scope is weak/absent', () => {
    const text = build();
    assert.ok(/one-directional/i.test(text) && /resolve DOWN/i.test(text),
      'the rule must name the one-directional bias and steer toward plan/research, not implement');
  });

  test('a rich-but-unscoped description is NOT treated as scoped', () => {
    const text = build();
    assert.ok(/NOT scoped merely because its intent is legible|rich-but-unscoped/i.test(text),
      'the rule must reject legible-intent / long-description as a substitute for committed scope');
  });

  test('an existing plan still routes on its session-fit answer — the guard does not override it', () => {
    const text = build();
    // The no-scope guard must explicitly preserve BOTH committed-plan routes so it
    // cannot erode the multi-session → breakdown branch (LIN-385@breakdown regression).
    assert.ok(/never overrides a plan that exists/i.test(text),
      'the guard must state it fires only when scope is absent, never overriding an existing plan');
    assert.ok(/fits one session.*\`implementation\`.*needs multiple sessions.*\`breakdown\`/is.test(text),
      'both session-fit routes (implementation AND breakdown) must be preserved against the guard');
  });

  test('"simple enough to implement directly" requires concrete in-hand small scope', () => {
    const text = build();
    assert.ok(/concrete, in-hand small scope — NOT by a legible intent on an unscoped/is.test(text),
      'the direct-implement readiness path must require in-hand small scope, not just legible intent');
  });
});

// =============================================================================
// Single-action boundary (LIN-358) — the generated prompt body must stay within
// the one recommended action and hand off by naming the follow-up, rather than
// carrying the work into the next phase. The reported symptom was an "unblock"
// prompt that, once unblocked, proceeded to implement; the fix is the general
// boundary rule plus removing the "proceed to the next phase" trigger in Step 2.
// =============================================================================

describe('buildMetaPromptTemplate single-action boundary (LIN-358)', () => {
  function build(overrides = {}) {
    return buildMetaPromptTemplate({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: false, commentCount: 0, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '), ...overrides
    });
  }

  test('the prompt body is constrained to the single recommended action', () => {
    const text = build();
    assert.ok(
      /Keep the generated prompt inside the single action you recommended/.test(text),
      'the single-action boundary rule must be present'
    );
  });

  test('the boundary rule routes the next phase through a handoff, not continuation', () => {
    const text = build();
    assert.ok(
      /its final step names the follow-up action/.test(text),
      'the rule must instruct the prompt to name the follow-up action'
    );
    assert.ok(
      /each action gets its own prompt, generated fresh when it starts/.test(text),
      'the rule must state each action gets its own prompt'
    );
  });

  test('the blocked branch hands off rather than proceeding into the next phase', () => {
    const text = build();
    assert.ok(
      /confirm the task is unblocked and recommend the next action/.test(text),
      'the resolved-blocker shortcut must recommend the next action'
    );
    assert.ok(
      !/remove label/.test(text),
      'the abolished blocked-label mutation (LIN-357) must be gone from the meta-prompt'
    );
    assert.ok(
      !/proceed to the next phase/.test(text),
      'the "proceed to the next phase" wording that licensed implementation drift must be gone'
    );
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

// Class check (LIN-313) — bug and review prompts ask "isolated, or one of a
// class?" so a narrowly-worded task doesn't clear while its siblings wait to
// surprise the parent. Mirrors the handwritten path per CLAUDE.md's both-paths
// rule (bug template step 4 / review "Isolated, or One of a Class?" section).
describe('buildMetaPromptTemplate class check (LIN-313)', () => {
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

  test('Bug-prompts rule requires a class check once the root cause is in hand', () => {
    const result = build();
    assert.ok(
      result.includes("widen the model, don't patch the witness"),
      'the bug rule must carry the widen-the-model directive'
    );
    assert.ok(
      result.includes('whether the same pattern produces siblings'),
      'the bug rule must ask for pattern siblings, not only the cited symptom'
    );
  });

  test('Bug class check keeps the fix minimal and records the class instead', () => {
    const result = build();
    assert.ok(
      result.includes('the fix stays minimal'),
      'a found class must not silently widen the fix'
    );
    assert.ok(
      result.includes('record the unhandled instances as a comment'),
      'unhandled instances must be recorded for follow-up scoping'
    );
  });

  test('Review-prompts rule includes a class check before approving the close', () => {
    const result = build();
    assert.ok(
      result.includes('class check before approving the close'),
      'the review rule must include the close-out class check'
    );
    assert.ok(
      result.includes('record the instances as a review finding rather than expanding the task'),
      'siblings become a finding, not new scope'
    );
  });

  test('class check guards against manufactured work in both rules', () => {
    const result = build();
    assert.ok(
      result.includes('genuinely isolated issue is a valid answer'),
      'the bug rule must allow an isolated result'
    );
    assert.ok(
      result.includes('genuinely isolated change is a valid result'),
      'the review rule must allow an isolated result'
    );
  });
});

// =============================================================================
// Surface Assessment necessity gate (LIN-192 origin, LIN-397 gate) — AI path
//
// Research must gate the refactor verdict on necessity (consumer test + who-pays
// test, third verdict, size routed to sequencing), and plan must sequence only a
// necessary prerequisite refactor as a separate blocking subtask while rejecting
// speculative ones. These pin the gate against drift and mirror the
// handwritten-path tests in tests/unit/prompt-templates.test.js.
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

  test('research-prompts rule gates the Surface Assessment on necessity, not availability', () => {
    const result = build();
    assert.ok(result.includes('Surface Assessment'), 'meta-prompt must require a Surface Assessment');
    assert.ok(result.includes('refactor required'), 'must offer the refactor-required verdict');
    assert.ok(result.includes('consumer test'), 'must require citing the in-task consumer of the new seam');
    assert.ok(result.includes('who-pays test'), 'must require a beneficiary-or-bystander accounting per touched consumer');
    assert.ok(
      result.includes('improvement noticed, not required'),
      'must offer the third verdict so noticed improvements have a non-blocking home'
    );
    assert.ok(
      result.includes('Size is not a rejection criterion'),
      'size must route to sequencing, never to worth'
    );
  });

  test('plan-prompts rule sequences a necessary refactor and rejects speculative ones', () => {
    const result = build();
    assert.ok(
      result.includes('separate blocking subtask'),
      'plan rule must encode a necessary prerequisite refactor as a separate blocking subtask'
    );
    assert.ok(
      result.includes('do not absorb the refactor into implementation steps'),
      'plan rule must preserve the sequencing guarantee'
    );
    assert.ok(
      result.includes('names its in-task consumer'),
      'the blocking-subtask ratchet must be conditioned on a verdict naming its in-task consumer'
    );
    assert.ok(
      result.includes('must not become a subtask'),
      'consumer-less or bystander-taxing refactors are folded inline, scoped down, or noted'
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
    assert.ok(names.includes('review'));
    assert.ok(!names.includes('code review'), 'code review was consolidated into review (LIN-523)');
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

  // The emitted skeleton must keep directives OFF the fill-in lines, so a literal
  // model fills the slot instead of transcribing the guidance (the leak we saw on
  // gpt-5.4-mini: "→ implement — use EXACTLY one action name, verbatim, from …").
  test('the response skeleton presents a clean action line and never inlines the directive', () => {
    const text = buildMetaPromptTemplate({ ...base });
    assert.ok(text.includes('→ **<action>**'), 'the skeleton action line is a bare fill-in slot');
    assert.ok(!text.includes('→ **[action]** —'), 'no directive prose is appended to the emitted action line');
    assert.ok(text.includes('Keep the surrounding `**` bold markers'),
      'the skeleton reminds the model to keep the bold markers the parser requires');
    assert.ok(/do NOT copy these field descriptions/i.test(text),
      'the model is told not to transcribe the field descriptions into its answer');
  });

  // DeferTo must NOT appear in the default skeleton — only as a conditional rule —
  // so a non-defer reply that mirrors the skeleton omits it (no bare "DeferTo:").
  test('DeferTo is a conditional rule, absent from the default skeleton', () => {
    const text = buildMetaPromptTemplate({ ...base });
    const skeletonStart = text.indexOf('## Reasoning');
    const promptSlot = text.indexOf('<the complete prompt text');
    const skeleton = text.slice(skeletonStart, promptSlot);
    assert.ok(!skeleton.includes('DeferTo'),
      'the default (non-defer) skeleton must not contain a DeferTo line');
    assert.ok(/ONLY when the action is `defer`/.test(text),
      'DeferTo is stated as a conditional rule below the skeleton');
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
    assert.strictEqual(parseRecommendedAction('→ **look into**'), 'look into');
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

// =============================================================================
// getRecommendationStream — streaming return + delta emission (LIN-346)
// =============================================================================

describe('getRecommendationStream (LIN-346)', () => {
  let originalFetch;
  let savedProxyEnv;

  // A minimal issue/context that buildMetaPrompt can format without throwing.
  const ISSUE = {
    identifier: 'LIN-1',
    title: 'A leaf task',
    description: 'Do the thing.',
    url: 'https://linear.app/test/issue/LIN-1',
    state: { name: 'In Progress', type: 'started' }
  };
  const CONTEXT = { parent: null, siblings: [], project: { description: '' }, children: [], comments: [], focusedChild: null };

  beforeEach(() => {
    originalFetch = global.fetch;
    // getRecommendationStream only streams when no HTTP(S) proxy is configured.
    savedProxyEnv = {
      HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY,
      https_proxy: process.env.https_proxy, http_proxy: process.env.http_proxy
    };
    delete process.env.HTTPS_PROXY; delete process.env.HTTP_PROXY;
    delete process.env.https_proxy; delete process.env.http_proxy;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedProxyEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  // Build a mock OpenRouter SSE streaming response from raw markdown, split into
  // pieces so the section parser and the raw accumulator both see chunk boundaries.
  function mockStreamResponse(pieces, { finishReason = 'stop', completionTokens = 42 } = {}) {
    const enc = new TextEncoder();
    const blocks = pieces.map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
    blocks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }], usage: { completion_tokens: completionTokens } })}\n\n`);
    blocks.push('data: [DONE]\n\n');
    return {
      ok: true,
      body: (async function* () { for (const b of blocks) yield enc.encode(b); })()
    };
  }

  test('emits deltas AND returns the structured object equal to parseRecommendationResponse', async () => {
    const raw = '## Reasoning\n→ **research**\nLook into it.\n## Prompt\nGo research the thing.';
    // Split mid-section to exercise chunk-boundary buffering.
    const pieces = ['## Reasoning\n→ **research**\nLook ', 'into it.\n## Prompt\nGo research ', 'the thing.'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces, { completionTokens: 17 }));

    const events = [];
    const result = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key' }, (type, data) => events.push({ type, data }));

    // (a) emits deltas for both sections
    const reasoningDeltas = events.filter(e => e.type === 'delta' && e.data.section === 'reasoning');
    const promptDeltas = events.filter(e => e.type === 'delta' && e.data.section === 'prompt');
    assert.ok(reasoningDeltas.length > 0, 'streamed reasoning deltas');
    assert.ok(promptDeltas.length > 0, 'streamed prompt deltas');
    assert.strictEqual(reasoningDeltas.map(e => e.data.content).join(''), '→ **research**\nLook into it.');
    // The LLM body streams first, then the deterministic grounding post-pass (LIN-435)
    // streams as an additional prompt delta so the leaf view matches the shipped prompt.
    const grounding = appendGroundingSections('', ISSUE, CONTEXT);
    assert.strictEqual(promptDeltas.map(e => e.data.content).join(''), 'Go research the thing.' + grounding);

    // emits a terminal done
    assert.strictEqual(events.filter(e => e.type === 'done').length, 1);

    // (b) returns a structured object equal to the buffered parse with the SAME grounding
    // post-pass applied — proving the streamed and returned prompts both carry grounding.
    assert.deepStrictEqual(
      result,
      applyGroundingToRecommendation(parseRecommendationResponse(raw, 'stop', 17), ISSUE, CONTEXT)
    );
    assert.strictEqual(result.recommendedAction, 'research');
    assert.strictEqual(result.prompt, 'Go research the thing.' + grounding);
    assert.strictEqual(result.truncated, false);
    assert.strictEqual(result.completionTokens, 17);
  });

  test('defer-shaped stream returns recommendedAction:defer, deferTo set, prompt:null', async () => {
    const raw = '## Reasoning\n→ **defer**\nThe real work is in the child.\nDeferTo: LIN-297';
    const pieces = ['## Reasoning\n→ **defer**\nThe real work ', 'is in the child.\nDeferTo: LIN-297'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces, { completionTokens: 9 }));

    const events = [];
    const result = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key' }, (type, data) => events.push({ type, data }));

    // Defer hops stream only reasoning — never a prompt phase (keeps the socket warm
    // without emitting a phantom prompt section).
    assert.ok(events.some(e => e.type === 'delta' && e.data.section === 'reasoning'), 'streamed reasoning');
    assert.ok(!events.some(e => e.type === 'phase' && e.data.phase === 'prompt'), 'no prompt phase on a defer');

    assert.deepStrictEqual(result, parseRecommendationResponse(raw, 'stop', 9));
    assert.strictEqual(result.recommendedAction, 'defer');
    assert.strictEqual(result.deferTo, 'LIN-297');
    assert.strictEqual(result.prompt, null);
  });

  test('surfaces truncated:true when finish_reason is length (13ecc22 preserved)', async () => {
    const pieces = ['## Reasoning\n→ **implement**\nBuild it.\n## Prompt\nDo the build'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces, { finishReason: 'length', completionTokens: 8000 }));

    const events = [];
    const result = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key' }, (type, data) => events.push({ type, data }));

    assert.strictEqual(result.truncated, true, 'structured return carries truncated');
    const done = events.find(e => e.type === 'done');
    assert.strictEqual(done.data.truncated, true, 'done event carries truncated');
  });
});

// =============================================================================
// LLM call recorder hook (LIN-418)
// =============================================================================

describe('LLM call recorder (LIN-418)', () => {
  let originalFetch;
  let savedProxyEnv;
  const ISSUE = {
    identifier: 'LIN-1', title: 'A leaf task', description: 'Do the thing.',
    url: 'https://linear.app/test/issue/LIN-1', state: { name: 'In Progress', type: 'started' }
  };
  const CONTEXT = { parent: null, siblings: [], project: { description: '' }, children: [], comments: [], focusedChild: null };

  beforeEach(() => {
    originalFetch = global.fetch;
    savedProxyEnv = {
      HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY,
      https_proxy: process.env.https_proxy, http_proxy: process.env.http_proxy
    };
    delete process.env.HTTPS_PROXY; delete process.env.HTTP_PROXY;
    delete process.env.https_proxy; delete process.env.http_proxy;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setLlmCallRecorder(null);
    for (const [k, v] of Object.entries(savedProxyEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  // Mock SSE response that carries usage accounting (cost + tokens), provider, and model
  // in the final chunk — the shape OpenRouter returns when usage:{include:true} is set.
  function mockStreamResponse(pieces, { provider = 'OpenAI', model = 'openai/gpt-5.4-mini' } = {}) {
    const enc = new TextEncoder();
    const blocks = pieces.map(p => `data: ${JSON.stringify({ provider, model, choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
    blocks.push(`data: ${JSON.stringify({ provider, model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 30, total_tokens: 1230, cost: 0.00042 } })}\n\n`);
    blocks.push('data: [DONE]\n\n');
    return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
  }

  test('getRecommendationStream records model, provider, tokens, cost + caller callMeta', async () => {
    const pieces = ['## Reasoning\n→ **research**\nLook into it.\n## Prompt\nGo research.'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces));

    const records = [];
    setLlmCallRecorder((r) => records.push(r));

    await getRecommendationStream(
      ISSUE, CONTEXT,
      { apiKey: 'test-key', callMeta: { urlKey: 'acme', feature: 'recommend', issueIdentifier: 'LIN-1' } },
      () => {}
    );

    assert.strictEqual(records.length, 1);
    const r = records[0];
    assert.strictEqual(r.urlKey, 'acme');
    assert.strictEqual(r.feature, 'recommend');
    assert.strictEqual(r.issueIdentifier, 'LIN-1');
    assert.strictEqual(r.provider, 'OpenAI');
    assert.strictEqual(r.model, 'openai/gpt-5.4-mini');
    assert.strictEqual(r.promptTokens, 1200);
    assert.strictEqual(r.completionTokens, 30);
    assert.strictEqual(r.cost, 0.00042);
    assert.strictEqual(r.finishReason, 'stop');
    assert.ok(typeof r.durationMs === 'number' && r.durationMs >= 0);
  });

  test('records even without callMeta (every call is logged)', async () => {
    const pieces = ['## Reasoning\n→ **research**\nx.\n## Prompt\ny.'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces));

    const records = [];
    setLlmCallRecorder((r) => records.push(r));

    await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key' }, () => {});

    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].cost, 0.00042);
    assert.strictEqual(records[0].urlKey, undefined); // no attribution, still logged
  });

  test('a throwing recorder never breaks the call', async () => {
    const pieces = ['## Reasoning\n→ **research**\nx.\n## Prompt\ny.'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces));
    setLlmCallRecorder(() => { throw new Error('recorder boom'); });

    // Should resolve normally despite the recorder throwing.
    const result = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key' }, () => {});
    assert.strictEqual(result.recommendedAction, 'research');
  });

  test('streamChat surfaces usage in its done event and records the call', async () => {
    const pieces = ['Hello ', 'world.'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces));

    const records = [];
    setLlmCallRecorder((r) => records.push(r));

    const events = [];
    const { streamChat } = await import('../../lib/openrouter.js');
    await streamChat(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'test-key', callMeta: { urlKey: 'acme', feature: 'task-chat' } },
      (type, data) => events.push({ type, data })
    );

    const done = events.find(e => e.type === 'done');
    assert.ok(done, 'emits a done event');
    assert.strictEqual(done.data.usage.cost, 0.00042);
    assert.strictEqual(done.data.usage.completionTokens, 30);

    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].feature, 'task-chat');
    assert.strictEqual(records[0].cost, 0.00042);
  });
});

// ===========================================================================
// Prompt trace recorder (LIN-578) — content-bearing capture at the two
// recommendation seams only. Verifies traces are captured WITHOUT changing the
// user-facing recommendation result, and that the generic chat path is NOT captured.
// ===========================================================================
describe('prompt trace recorder (LIN-578)', () => {
  let originalFetch;
  let savedProxyEnv;
  const ISSUE = {
    identifier: 'LIN-1', title: 'A leaf task', description: 'Do the thing.',
    url: 'https://linear.app/test/issue/LIN-1', state: { name: 'In Progress', type: 'started' },
    createdAt: '2026-01-01T00:00:00.000Z'
  };
  const CONTEXT = { parent: null, siblings: [], project: { description: '' }, children: [], comments: [], focusedChild: null };

  beforeEach(() => {
    originalFetch = global.fetch;
    savedProxyEnv = {
      HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY,
      https_proxy: process.env.https_proxy, http_proxy: process.env.http_proxy
    };
    delete process.env.HTTPS_PROXY; delete process.env.HTTP_PROXY;
    delete process.env.https_proxy; delete process.env.http_proxy;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setLlmCallRecorder(null);
    setPromptTraceRecorder(null);
    for (const [k, v] of Object.entries(savedProxyEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  // Streaming SSE response (matches the metadata-recorder block's mock shape).
  function mockStreamResponse(pieces, { provider = 'OpenAI', model = 'openai/gpt-5.4-mini', finishReason = 'stop' } = {}) {
    const enc = new TextEncoder();
    const blocks = pieces.map(p => `data: ${JSON.stringify({ provider, model, choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
    blocks.push(`data: ${JSON.stringify({ provider, model, choices: [{ delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 1200, completion_tokens: 30, total_tokens: 1230, cost: 0.00042 } })}\n\n`);
    blocks.push('data: [DONE]\n\n');
    return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
  }

  // Note on the non-stream seam (getRecommendation): it issues its request through
  // the module-level `customFetch`, which is bound to native fetch at import time
  // (and only re-pointed when a proxy is configured), so a `global.fetch` mock can't
  // intercept it the way it does the streaming path. The non-stream seam wires the
  // SAME recordPromptTrace(...) call over locals proven by parseRecommendationResponse
  // / applyGroundingToRecommendation tests; the streaming test below exercises the
  // recorder end-to-end. Mocking the non-stream HTTP would require a production
  // refactor (out of scope for LIN-578).

  test('getRecommendationStream records a content-bearing trace and returns the same result', async () => {
    const pieces = ['## Reasoning\n→ **research**\nLook into it.\n## Prompt\nGo research.'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces));

    const traces = [];
    setPromptTraceRecorder((t) => traces.push(t));

    const result = await getRecommendationStream(
      ISSUE, CONTEXT,
      { apiKey: 'test-key', callMeta: { urlKey: 'acme', feature: 'recommend', issueIdentifier: 'LIN-1' } },
      () => {}
    );

    // User-facing result unchanged.
    assert.strictEqual(result.recommendedAction, 'research');
    assert.ok(result.prompt.startsWith('Go research.'));

    // Exactly one trace, carrying input + output + attribution.
    assert.strictEqual(traces.length, 1);
    const t = traces[0];
    assert.strictEqual(t.urlKey, 'acme');
    assert.strictEqual(t.feature, 'recommend');
    assert.strictEqual(t.issueIdentifier, 'LIN-1');
    assert.ok(typeof t.metaPrompt === 'string' && t.metaPrompt.length > 0); // rendered input
    assert.strictEqual(t.model, 'openai/gpt-5.4-mini');
    assert.strictEqual(t.rawContent, pieces[0]);
    assert.strictEqual(t.reasoning, '→ **research**\nLook into it.');
    assert.strictEqual(t.prompt, 'Go research.'); // parsed, pre-grounding
    assert.strictEqual(t.finalPrompt, result.prompt); // post-grounding == what the user receives
    assert.strictEqual(t.finishReason, 'stop');
    assert.strictEqual(t.truncated, false);
  });

  test('a throwing trace recorder never breaks the call', async () => {
    const pieces = ['## Reasoning\n→ **research**\nx.\n## Prompt\ny.'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces));
    setPromptTraceRecorder(() => { throw new Error('trace boom'); });

    const result = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key' }, () => {});
    assert.strictEqual(result.recommendedAction, 'research');
  });

  test('the generic chat path (streamChat) does NOT record a trace (scoped to recommendations)', async () => {
    const pieces = ['Hello ', 'world.'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces));

    const traces = [];
    setPromptTraceRecorder((t) => traces.push(t));

    const { streamChat } = await import('../../lib/openrouter.js');
    await streamChat(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'test-key', callMeta: { urlKey: 'acme', feature: 'task-chat' } },
      () => {}
    );

    assert.strictEqual(traces.length, 0); // generic chat must never be trace-captured
  });
});

// =============================================================================
// getRecommendation — external abort signal (gap #2, LIN-346)
// =============================================================================

describe('getRecommendation abort (LIN-346 gap #2)', () => {
  let originalFetch;
  const ISSUE = {
    identifier: 'LIN-1', title: 'A leaf task', description: 'Do the thing.',
    url: 'https://linear.app/test/issue/LIN-1', state: { name: 'In Progress', type: 'started' }
  };
  const CONTEXT = { parent: null, siblings: [], project: { description: '' }, children: [], comments: [], focusedChild: null };

  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  test('rejects when options.signal fires mid-flight', async () => {
    const ac = new AbortController();
    // A fetch that hangs until its signal aborts, then throws AbortError like real fetch.
    global.fetch = mock.fn((url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    const pending = getRecommendation(ISSUE, CONTEXT, { apiKey: 'test-key', signal: ac.signal });
    ac.abort();
    // External abort maps to the existing timeout message (mapping unchanged).
    await assert.rejects(pending, /OpenRouter request timed out/);
  });

  test('rejects immediately when options.signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    global.fetch = mock.fn((url, opts) => new Promise((resolve, reject) => {
      if (opts.signal.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return reject(err);
      }
      resolve({ ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\nx\n## Prompt\ny' } }] }) });
    }));

    await assert.rejects(
      getRecommendation(ISSUE, CONTEXT, { apiKey: 'test-key', signal: ac.signal }),
      /OpenRouter request timed out/
    );
  });
});

// =============================================================================
// getPaidEnvKey / hasPaidEnvKey (LIN-961)
// =============================================================================
// The single normalized reader for the server paid key: it trims, so empty AND
// whitespace-only OPENROUTER_API_KEY count as unset. Centralizing this predicate
// is the core fix — it stops a blank value from being classified as a paid `env`
// key or forwarded to OpenRouter as a bogus auth header.
describe('getPaidEnvKey / hasPaidEnvKey (LIN-961)', () => {
  let prev;
  beforeEach(() => { prev = process.env.OPENROUTER_API_KEY; });
  afterEach(() => {
    if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prev;
  });

  test('unset → undefined / false', () => {
    delete process.env.OPENROUTER_API_KEY;
    assert.strictEqual(getPaidEnvKey(), undefined);
    assert.strictEqual(hasPaidEnvKey(), false);
    assert.strictEqual(isRecommendationEnabled(), false);
  });

  test('empty string → undefined / false (the reported symptom)', () => {
    process.env.OPENROUTER_API_KEY = '';
    assert.strictEqual(getPaidEnvKey(), undefined);
    assert.strictEqual(hasPaidEnvKey(), false);
    assert.strictEqual(isRecommendationEnabled(), false);
  });

  test('whitespace-only → undefined / false (never forwarded as auth)', () => {
    process.env.OPENROUTER_API_KEY = '   \t ';
    assert.strictEqual(getPaidEnvKey(), undefined);
    assert.strictEqual(hasPaidEnvKey(), false);
  });

  test('a real key → returned verbatim (trimmed) / true', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-abc123';
    assert.strictEqual(getPaidEnvKey(), 'sk-or-abc123');
    assert.strictEqual(hasPaidEnvKey(), true);
    assert.strictEqual(isRecommendationEnabled(), true);
  });

  test('surrounding whitespace is trimmed off a real key', () => {
    process.env.OPENROUTER_API_KEY = '  sk-or-abc123  ';
    assert.strictEqual(getPaidEnvKey(), 'sk-or-abc123');
    assert.strictEqual(hasPaidEnvKey(), true);
  });

  test('isRecommendationEnabled honours a session key regardless of env', () => {
    delete process.env.OPENROUTER_API_KEY;
    assert.strictEqual(isRecommendationEnabled('sess_abc'), true);
  });
});
