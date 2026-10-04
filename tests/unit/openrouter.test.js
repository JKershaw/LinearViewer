/**
 * Unit tests for openrouter.js
 *
 * Run with: node --test tests/unit/openrouter.test.js
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  formatSubtaskOverview,
  formatIssueContext,
  isEpicShapedParent,
  parseRecommendedAction,
  parseDeferTo,
  getRecommendationStream,
  getRecommendation,
  setLlmCallRecorder,
  setPromptTraceRecorder,
  setFetchImpl,
  getModelDisplayName,
  formatModelPricing,
  getModelPricingHint,
  isToolCapableModel,
  AVAILABLE_MODELS,
  getPaidEnvKey,
  hasPaidEnvKey,
  isRecommendationEnabled,
  DEFAULT_MODEL,
  resolveReasoningBudget,
  isReasoningModel,
  REASONING_MIN_TOKENS,
  REASONING_MAX_TOKENS,
  EPIC_CHILD_THRESHOLD,
  COUSIN_CAP,
  SIBLING_CAP,
  EPIC_TITLE_PATTERN
} from '../../lib/openrouter.js';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { getAIRecommendationActionNames, deriveDispatchKind, isValidDispatchKind, DISPATCH_KIND_DEFAULT, generatePrompt } from '../../lib/prompt-templates.js';
import { guardNetwork } from '../fixtures/network-guard.js';

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

describe('isToolCapableModel (LIN-990)', () => {
  test('returns true for every curated model in AVAILABLE_MODELS', () => {
    for (const m of AVAILABLE_MODELS) {
      assert.strictEqual(isToolCapableModel(m.id), true, `${m.id} should be tool-capable`);
    }
  });

  test('the DEFAULT_MODEL is tool-capable (free-tier forces it)', () => {
    assert.strictEqual(isToolCapableModel(DEFAULT_MODEL), true);
  });

  test('returns false for a custom/uncurated model id (unknown ≠ capable)', () => {
    assert.strictEqual(isToolCapableModel('some-provider/custom-model-v2'), false);
    assert.strictEqual(isToolCapableModel('openai/gpt-5.4-mini-typo'), false);
    assert.strictEqual(isToolCapableModel('gpt-5.4-mini'), false); // provider prefix required
  });

  test('returns false for falsy or non-string ids', () => {
    assert.strictEqual(isToolCapableModel(''), false);
    assert.strictEqual(isToolCapableModel(null), false);
    assert.strictEqual(isToolCapableModel(undefined), false);
    assert.strictEqual(isToolCapableModel(123), false);
    assert.strictEqual(isToolCapableModel({}), false);
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

describe('formatIssueContext timestamps (LIN-1067)', () => {
  const baseCtx = { parent: null, siblings: [], cousins: [], children: [], comments: [] };
  const issue = {
    id: 'i-1', identifier: 'LIN-1', title: 'T', description: 'B',
    state: { name: 'Todo', type: 'unstarted' }, labels: [],
  };

  test('renders **Created:** and **Updated:** when the issue carries them', () => {
    const result = formatIssueContext(
      { ...issue, createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-06-15T12:34:56Z' },
      baseCtx
    );
    assert.match(result, /\*\*Created:\*\* 2026-04-01T00:00:00Z/);
    assert.match(result, /\*\*Updated:\*\* 2026-06-15T12:34:56Z/);
  });

  test('omits **Updated:** when updatedAt is absent (additive, unchanged for providers without it)', () => {
    const result = formatIssueContext({ ...issue, createdAt: '2026-04-01T00:00:00Z' }, baseCtx);
    assert.match(result, /\*\*Created:\*\*/);
    assert.doesNotMatch(result, /\*\*Updated:\*\*/);
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
// Router prompt: the decision tree (lib/stage-router.js)
// =============================================================================

describe('router prompt: defer routing (LIN-327)', () => {
  function build(overrides = {}) {
    return buildRouterPrompt({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: false, commentCount: 0, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '), ...overrides
    });
  }

  test('node-shaped tasks get the defer-vs-node-work decision step', () => {
    const text = build({ hasSubtasks: true, subtaskCount: 3, remainingCount: 2 });
    assert.ok(text.includes('defer'), 'defer must appear in a node-shaped routing prompt');
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
    assert.ok(text.includes('defer'), 'defer must be in the action vocabulary the routing prompt prints');
  });
});

describe('router prompt: terminal-state branch (LIN-353)', () => {
  function build(overrides = {}) {
    return buildRouterPrompt({
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
describe('router prompt: review routing for landed implementation', () => {
  function build(overrides = {}) {
    return buildRouterPrompt({
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
describe('router prompt: review routing for a plan-less landed leaf (LIN-448)', () => {
  function build(overrides = {}) {
    return buildRouterPrompt({
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
describe('router prompt: close-out routing gate (LIN-812)', () => {
  function build(overrides = {}) {
    return buildRouterPrompt({
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

  // ---------------------------------------------------------------------------
  // The plan-review carve-out (LIN-1603 item 2.5) — the same failure SHAPE as the
  // LIN-823 bug-commentary exclusion above, one step earlier in the pipeline.
  // `plan-review` deliberately reuses review's Approve / Request Changes / Needs
  // Discussion vocabulary, so an Approve on a PLAN could otherwise satisfy the
  // close-out evidence check and authorize the merge + Done transition on work that
  // was never built. Deterministic and model-free: this pins the prose in BOTH
  // close-out decision points, exactly as the bug carve-out is pinned.
  // ---------------------------------------------------------------------------
  test('a plan-review verdict is NOT close-out evidence — in both Step 0 and Step 3 (LIN-1603)', () => {
    const step0 = build({ isTerminal: false, hasSubtasks: true, subtaskCount: 1, completedCount: 1, hasOpenChildren: false });
    const step3 = build({ isTerminal: false, hasSubtasks: false, hasOpenChildren: false });
    for (const [label, text] of [['Step 0', step0], ['Step 3', step3]]) {
      assert.ok(/a \`plan-review\` verdict is NOT a review verdict either/i.test(text),
        `${label} must exclude a plan-review verdict from review evidence`);
      assert.ok(/would authorize \`close-out\` on unimplemented work/i.test(text),
        `${label} must name the failure it prevents: close-out on unimplemented work`);
      // The header is the DISAMBIGUATOR, never the thing the gate keys on (LIN-810):
      // the exclusion must hold for a plan-review verdict posted WITHOUT the header.
      assert.ok(/whether or not that header is present/i.test(text),
        `${label} must exclude the plan verdict on substance, not on the presence of the header`);
      assert.ok(/the header is a disambiguator between the two verdict kinds, not the thing the gate keys on/i.test(text),
        `${label} must state the header is not a required format (LIN-810)`);
      // Regression guard: the plan-review exclusion must not have displaced the
      // bug-commentary one — both carve-outs live in this same sentence chain.
      assert.ok(/a \`bug\`'s own investigation commentary is NOT a review verdict/i.test(text),
        `${label} must still carry the LIN-823 bug-commentary exclusion`);
    }
  });
});

// =============================================================================
// Plan-review gate + routing branch (LIN-1603, items 2.4 and 2.3) — the gate is
// GATED, never universal: it exists to protect the throughput of the work that
// needs it, so the risk being guarded here is OVER-firing. These pin (a) that the
// branch is sited between the plan-exists gate and the session-fit routing, (b)
// that a gate-not-met plan still falls through to the unchanged session-fit
// routes, and (c) the one-cycle revision bound with its human-edge escalation.
// The eval (scripts/eval-plan-review.mjs) measures the same two properties under
// load; these are the deterministic half.
// =============================================================================
describe('router prompt: plan-review gate and routing (LIN-1603)', () => {
  function build(overrides = {}) {
    return buildRouterPrompt({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: true, commentCount: 2, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '),
      isTerminal: false, hasOpenChildren: false, ...overrides
    });
  }

  test('the gate is sited AFTER the plan-exists check and BEFORE the session-fit routing', () => {
    const text = build();
    const planGate = text.indexOf('check whether a plan exists');
    const reviewGate = text.indexOf('the plan-review gate');
    const sessionFit = text.indexOf('Otherwise route on the session-fit answer');
    assert.ok(planGate > -1 && reviewGate > -1 && sessionFit > -1,
      'all three landmarks must be present in Step 3');
    assert.ok(planGate < reviewGate,
      'the plan-review gate must come after the plan-exists check — it reads a plan that exists');
    assert.ok(reviewGate < sessionFit,
      'the gate must come BEFORE the session-fit routing, or a gated plan would already have been routed');
  });

  test('all four gate criteria are stated, keyed to what the plan says', () => {
    const text = build();
    assert.ok(/\(a\) the session-fit answer is "needs multiple sessions"/i.test(text),
      'criterion (a): the multi-session answer');
    assert.ok(/\(b\) it names a routed-around contract gap with a ticket identifier/i.test(text),
      'criterion (b): a named routed-around contract gap');
    assert.ok(/\(c\) any step relaxes a validation, a contract, or a guard/i.test(text),
      'criterion (c): a relaxed validation/contract/guard');
    assert.ok(/\(d\) it touches credential, merge-rule, or dispatch-contract surfaces/i.test(text),
      'criterion (d): credential / merge-rule / dispatch-contract surfaces');
    // The plan writes the decision down (item 2.1); the router may read it directly.
    assert.ok(/plan-review due: yes/i.test(text),
      'the router must recognise the decision the plan phase records');
  });

  test('gate NOT met ⇒ no plan-review and no added dispatch — the over-fire guard', () => {
    const text = build();
    assert.ok(/When none of \(a\)–\(d\) holds, do NOT emit \`plan-review\`/i.test(text),
      'the gate must state the negative case explicitly, not leave it implied');
    assert.ok(/fall straight through to the session-fit routing below, exactly as before this gate existed/i.test(text),
      'a gate-not-met plan must reach its old destination unchanged (zero added dispatches)');
    assert.ok(/gated, not universal/i.test(text),
      'the prose must say the step is gated rather than universal');
    // The unchanged destinations themselves must survive alongside the new branch.
    assert.ok(/fits one session.*\`implementation\`.*needs multiple sessions.*\`breakdown\`/is.test(text),
      'both pre-existing session-fit routes must remain intact');
  });

  const REVIEW_FACTS = {
    verdicts: 2, count: 1, latestVerdict: 'request changes', revised: false,
    revisionN: 2, replies: [], commentsRead: 5
  };

  test('gate met + no verdict on the trail ⇒ plan-review, and only then', () => {
    const text = build();
    assert.ok(/Recommend \`plan-review\` when ALL of these hold: a plan exists; the gate is met; and NO plan-review verdict is on the trail yet/i.test(text),
      'all three conditions must be required together');
    const withVerdict = build({ planReviewFacts: { ...REVIEW_FACTS, latestVerdict: 'approve', count: 0 } });
    assert.ok(/never re-emit \`plan-review\` on a plan that already has one/i.test(withVerdict),
      'a plan that already carries a verdict must not be re-reviewed');
    assert.ok(!/PLAN-REVIEW FACTS \(deterministic/.test(text), 'no facts block when no verdict is on the trail');
  });

  test('the revision loop is bounded in code, escalating after the third verdict', () => {
    const text = build({ planReviewFacts: REVIEW_FACTS });
    assert.ok(/Request Changes \/ Needs Discussion since the latest Approve: 1/i.test(text),
      'the count is computed in code and shown, not re-derived in prose');
    assert.ok(/Count 1 or 2 → \`plan\` \(the revision pass\)/.test(text),
      'the first/second Request Changes route back to plan for the revision pass');
    assert.ok(/Count 3 or more → \`blocked\`, unless the NEWEST reply after the latest verdict tells the work to continue/.test(text),
      'the third escalates to the human edge via blocked');
    assert.ok(/tells the work to hold .* → \`blocked\`, at any count/.test(text),
      'a hold wins at any count');
    assert.ok(/The NEWEST reply wins: a hold a later reply superseded is not a hold/.test(text),
      'the newest reply wins over an older hold');
    assert.ok(/A revision has landed since the latest verdict → \`plan-review\`, at any count/.test(text),
      'a revised plan must route to plan-review, not back to plan');
    assert.ok(/Never route past an unanswered verdict to \`breakdown\` or \`implementation\`/.test(text),
      'the build/re-review safety floor must survive');
  });

  test('Approve routes on session-fit as before, and is explicitly not close-out evidence', () => {
    const text = build({ planReviewFacts: { ...REVIEW_FACTS, count: 0, latestVerdict: 'approve' } });
    assert.ok(/Latest verdict is Approve → route on the session-fit answer/.test(text),
      'an approved plan must rejoin the unchanged session-fit routing');
    assert.ok(/never read an Approve as close-out evidence/i.test(text),
      'the carve-out must also be stated at the producing end of the verdict');
    assert.ok(/An Approve authorizes implementation only — it is never close-out evidence/.test(build()),
      'the static lead also carries the carve-out');
  });

  test('the Completed-prep rule carries the one exception the revision branch needs', () => {
    const text = build();
    // "Completed prep ⇒ never re-emit the prep verb" would otherwise out-argue the
    // Request-Changes → `plan` branch, since a plan already exists on the trail.
    assert.ok(/ONE exception, and only one: a \`plan-review\` that recorded \*\*Request Changes\*\* or \*\*Needs Discussion\*\* makes the plan's deliverable un-settled again/i.test(text),
      'the never-re-emit-prep rule must name the revision pass as its single exception');
    assert.ok(/Completed prep ⇒ never re-emit the prep verb/i.test(text),
      'the rule itself must survive the exception');
  });


  test('the emitted action is dispatchable — `→ **plan-review**` round-trips to a valid kind', () => {
    // The routing branch is only real if what the recommender emits survives the
    // wire: parseRecommendedAction reads the `→ **name**` line, and the dispatch
    // layer must accept the result as a kind.
    assert.strictEqual(parseRecommendedAction('The gate is met.\n\n→ **plan-review**'), 'plan-review');
    assert.strictEqual(deriveDispatchKind('plan-review'), 'plan-review');
    assert.ok(isValidDispatchKind('plan-review'), 'plan-review must be a dispatchable kind');
    assert.ok(getAIRecommendationActionNames().includes('plan-review'),
      'plan-review must be in the vocabulary the routing prompt is given');
  });
});

// =============================================================================
// Over-advance guard (LIN-597) — the engine's dominant front-half miss is reaching
// too far down-lifecycle (e.g. `implement`) on a task with too little COMMITTED
// SCOPE to act. Step 3 now makes the rule explicit and one-directional: absent
// committed scope is itself the signal to plan/research, never implement — without
// touching the clearly-planned `implement` case or the genuinely-small direct path.
// =============================================================================
describe('router prompt: over-advance guard (LIN-597)', () => {
  function build(overrides = {}) {
    return buildRouterPrompt({
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

describe('router prompt: single-action boundary (LIN-358)', () => {
  function build(overrides = {}) {
    return buildRouterPrompt({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: false, commentCount: 0, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '), ...overrides
    });
  }


  test('the blocked branch hands off rather than proceeding into the next phase', () => {
    const text = build();
    assert.ok(
      /confirm the task is unblocked and recommend the next action/.test(text),
      'the resolved-blocker shortcut must recommend the next action'
    );
    assert.ok(
      !/remove label/.test(text),
      'the abolished blocked-label mutation (LIN-357) must be gone from the routing prompt'
    );
    assert.ok(
      !/proceed to the next phase/.test(text),
      'the "proceed to the next phase" wording that licensed implementation drift must be gone'
    );
  });
});


// =============================================================================
// Action vocabulary — the routing prompt's `→ **action**` must stay inside the
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

  test('the routing prompt embeds the supplied vocabulary and the verbatim-one instruction', () => {
    const vocab = getAIRecommendationActionNames().join(', ');
    const text = buildRouterPrompt({ ...base, actionVocabulary: vocab });
    assert.ok(text.includes(vocab), 'the action vocabulary list must appear in the routing prompt');
    assert.ok(text.includes('EXACTLY one action name'), 'the verbatim-one constraint must be stated');
  });

  test('falls back to an example set when no vocabulary is supplied', () => {
    const text = buildRouterPrompt({ ...base });
    assert.ok(text.includes('plan, research, implement'), 'a sensible fallback list is present');
  });

  // The emitted skeleton must keep directives OFF the fill-in lines, so a literal
  // model fills the slot instead of transcribing the guidance (the leak we saw on
  // gpt-5.4-mini: "→ implement — use EXACTLY one action name, verbatim, from …").
  test('the response skeleton presents a clean action line and never inlines the directive', () => {
    const text = buildRouterPrompt({ ...base });
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
    const text = buildRouterPrompt({ ...base });
    const skeletonStart = text.indexOf('## Reasoning');
    const rulesStart = text.indexOf('Rules for the lines above');
    const skeleton = text.slice(skeletonStart, rulesStart);
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
      'defer must be offered to the router as an emittable action');
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

  test('matches the routing reply format with parenthetical examples after the line', () => {
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

  test('emits reasoning deltas AND returns the routed recommendation, its prompt generatePrompt for the stage', async () => {
    // Split mid-section to exercise chunk-boundary buffering.
    const pieces = ['## Reasoning\n→ **research**\nLook ', 'into it.\n**Next:** plan'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces, { completionTokens: 17 }));

    const events = [];
    const result = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key' }, (type, data) => events.push({ type, data }));

    const reasoningDeltas = events.filter(e => e.type === 'delta' && e.data.section === 'reasoning');
    const promptDeltas = events.filter(e => e.type === 'delta' && e.data.section === 'prompt');
    assert.strictEqual(reasoningDeltas.map(e => e.data.content).join(''), '→ **research**\nLook into it.\n**Next:** plan');
    // Code assembles the stage's prompt; it goes out as one delta after the reasoning.
    const expected = generatePrompt('research', ISSUE, CONTEXT).prompt;
    assert.strictEqual(promptDeltas.length, 1);
    assert.strictEqual(promptDeltas[0].data.content, expected);
    assert.strictEqual(events.filter(e => e.type === 'done').length, 1);

    assert.strictEqual(result.recommendedAction, 'research');
    assert.strictEqual(result.prompt, expected);
    assert.strictEqual(result.truncated, false);
    assert.strictEqual(result.completionTokens, 17);
  });

  test('stream and buffered paths return the same recommendation', async () => {
    const raw = '## Reasoning\n→ **plan**\nReady.\n**Next:** implement';
    global.fetch = mock.fn(async () => mockStreamResponse([raw.slice(0, 20), raw.slice(20)], { completionTokens: 9 }));
    const streamed = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key' }, () => {});
    global.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: raw }, finish_reason: 'stop' }], usage: { completion_tokens: 9 } })
    }));
    const buffered = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'test-key' });
    assert.deepStrictEqual(streamed, buffered);
  });

  test('defer-shaped stream returns recommendedAction:defer, deferTo set, prompt:null', async () => {
    const pieces = ['## Reasoning\n→ **defer**\nThe real work ', 'is in the child.\nDeferTo: LIN-297'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces, { completionTokens: 9 }));

    const events = [];
    const result = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key' }, (type, data) => events.push({ type, data }));

    // Defer hops stream only reasoning — never a prompt phase (keeps the socket warm
    // without emitting a phantom prompt section).
    assert.ok(events.some(e => e.type === 'delta' && e.data.section === 'reasoning'), 'streamed reasoning');
    assert.ok(!events.some(e => e.type === 'phase' && e.data.phase === 'prompt'), 'no prompt phase on a defer');

    assert.strictEqual(result.recommendedAction, 'defer');
    assert.strictEqual(result.deferTo, 'LIN-297');
    assert.strictEqual(result.prompt, null);
    assert.strictEqual(result.completionTokens, 9);
  });

  test('surfaces truncated:true when finish_reason is length (13ecc22 preserved)', async () => {
    const pieces = ['## Reasoning\n→ **implement**\nBuild it.'];
    global.fetch = mock.fn(async () => mockStreamResponse(pieces, { finishReason: 'length', completionTokens: 8000 }));

    const events = [];
    const result = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key' }, (type, data) => events.push({ type, data }));

    assert.strictEqual(result.truncated, true, 'structured return carries truncated');
    const done = events.find(e => e.type === 'done');
    assert.strictEqual(done.data.truncated, true, 'done event carries truncated');
  });

  // LIN-3296: grounding is chosen per stage from the recommended action, on both the
  // streamed and the buffered path. A look-back on a Done bug must not be told to close
  // out or to move to implementing the fix.
  const DONE_BUG = { ...ISSUE, state: { name: 'Done', type: 'completed' }, labels: ['bug'], createdAt: '2026-01-01T00:00:00.000Z' };
  const WITH_COMMENT = { ...CONTEXT, comments: [{ body: 'Root cause is X', user: 'Dev', createdAt: '2026-01-02T00:00:00.000Z' }] };
  const AUDIT_RAW = '## Reasoning\n→ **retrospective-audit**\nMerged and closed.\n**Next:** none';

  test('streamed retrospective-audit on a Done bug carries no close-out or fix note (LIN-3296)', async () => {
    global.fetch = mock.fn(async () => mockStreamResponse([AUDIT_RAW]));
    const events = [];
    const result = await getRecommendationStream(DONE_BUG, WITH_COMMENT, { apiKey: 'test-key' }, (type, data) => events.push({ type, data }));
    const streamed = events.filter(e => e.type === 'delta' && e.data.section === 'prompt').map(e => e.data.content).join('');
    assert.strictEqual(streamed, generatePrompt('retrospective-audit', DONE_BUG, WITH_COMMENT).prompt);
    assert.strictEqual(result.prompt, streamed);
    assert.ok(!/Task Already Complete|Prior Investigation On Record/.test(streamed), 'look-back keeps its brief');
    assert.ok(streamed.includes('Re-ground the Ticket'), 'the staleness check still fits an audit of landed code');
  });

  test('buffered retrospective-audit on a Done bug carries no close-out or fix note (LIN-3296)', async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: AUDIT_RAW }, finish_reason: 'stop' }], usage: { completion_tokens: 5 } })
    }));
    const result = await getRecommendation(DONE_BUG, WITH_COMMENT, { apiKey: 'test-key' });
    assert.strictEqual(result.prompt, generatePrompt('retrospective-audit', DONE_BUG, WITH_COMMENT).prompt);
    assert.ok(!/Task Already Complete|Prior Investigation On Record/.test(result.prompt));
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
// Reasoning-token budget split (LIN-1000)
//
// The structural fix for roadmap truncation: an opt-in `reasoning` allocation on
// the shared streamChat seam, plus the pure budget-split helper. Two things must
// hold — (1) a caller that does NOT opt in keeps the wire body byte-identical, so
// every sibling path is provably unaffected; (2) the helper's arithmetic reserves
// reasoning headroom on top of the prose budget for reasoning models only.
// ===========================================================================
describe('isReasoningModel (LIN-1000)', () => {
  test('the default model and the gpt-5 family are reasoning models', () => {
    assert.strictEqual(isReasoningModel(DEFAULT_MODEL), true);
    assert.strictEqual(isReasoningModel('openai/gpt-5.4-mini'), true);
    assert.strictEqual(isReasoningModel('openai/gpt-5.5'), true);
    assert.strictEqual(isReasoningModel('openai/o3-mini'), true);
  });

  test('non-reasoning models and junk are not', () => {
    assert.strictEqual(isReasoningModel('anthropic/claude-opus-4.8'), false);
    assert.strictEqual(isReasoningModel('openai/gpt-4o'), false);
    assert.strictEqual(isReasoningModel(''), false);
    assert.strictEqual(isReasoningModel(null), false);
    assert.strictEqual(isReasoningModel(undefined), false);
  });
});

describe('resolveReasoningBudget (LIN-1000)', () => {
  test('a reasoning model splits the budget: reasoning headroom ON TOP of prose', () => {
    const { reasoning, maxTokens } = resolveReasoningBudget({ model: DEFAULT_MODEL, proseTokens: 3000 });
    // Prose is protected: max_tokens covers prose PLUS the reserved reasoning.
    assert.deepStrictEqual(reasoning, { max_tokens: 3000 });
    assert.strictEqual(maxTokens, 3000 + 3000, 'max_tokens = prose + reasoning');
  });

  test('the default reasoning reserve is the prose budget clamped to [MIN, MAX]', () => {
    // Below the floor → clamped up to MIN.
    const small = resolveReasoningBudget({ model: DEFAULT_MODEL, proseTokens: 400 });
    assert.strictEqual(small.reasoning.max_tokens, REASONING_MIN_TOKENS);
    assert.strictEqual(small.maxTokens, 400 + REASONING_MIN_TOKENS);

    // Above the ceiling → clamped down to MAX.
    const big = resolveReasoningBudget({ model: DEFAULT_MODEL, proseTokens: 16000 });
    assert.strictEqual(big.reasoning.max_tokens, REASONING_MAX_TOKENS);
    assert.strictEqual(big.maxTokens, 16000 + REASONING_MAX_TOKENS);
  });

  test('an explicit reasoningTokens overrides the default reserve', () => {
    const { reasoning, maxTokens } = resolveReasoningBudget({ model: DEFAULT_MODEL, proseTokens: 3000, reasoningTokens: 500 });
    assert.deepStrictEqual(reasoning, { max_tokens: 500 });
    assert.strictEqual(maxTokens, 3500);
  });

  test('a non-reasoning model is a no-op: no reasoning field, prose budget unchanged', () => {
    const { reasoning, maxTokens } = resolveReasoningBudget({ model: 'anthropic/claude-opus-4.8', proseTokens: 3000 });
    assert.strictEqual(reasoning, undefined, 'no reasoning field for a non-reasoning model');
    assert.strictEqual(maxTokens, 3000, 'max_tokens stays the bare prose budget');
  });
});

describe('streamChat reasoning wire body (LIN-1000)', () => {
  let originalFetch;
  let savedProxyEnv;

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
    for (const [k, v] of Object.entries(savedProxyEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  function mockStreamResponse(pieces) {
    const enc = new TextEncoder();
    const blocks = pieces.map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
    blocks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    blocks.push('data: [DONE]\n\n');
    return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
  }

  async function captureBody(options) {
    global.fetch = mock.fn(async () => mockStreamResponse(['ok']));
    const { streamChat } = await import('../../lib/openrouter.js');
    await streamChat([{ role: 'user', content: 'hi' }], { apiKey: 'test-key', model: DEFAULT_MODEL, maxTokens: 3000, ...options }, () => {});
    return global.fetch.mock.calls[0].arguments[1].body;
  }

  test('WITHOUT a reasoning option the wire body is byte-identical to today', async () => {
    const body = await captureBody({});
    // Byte-identical to the pre-LIN-1000 body: a bare max_tokens, no reasoning key.
    const expected = JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.3,
      max_tokens: 3000,
      stream: true,
      usage: { include: true }
    });
    assert.strictEqual(body, expected);
    assert.ok(!/"reasoning"/.test(body), 'omitted ⇒ no reasoning field on the wire');
  });

  test('WITH a reasoning option the field is spliced into the wire body verbatim', async () => {
    const body = await captureBody({ reasoning: { max_tokens: 4000 } });
    const parsed = JSON.parse(body);
    assert.deepStrictEqual(parsed.reasoning, { max_tokens: 4000 });
    // The rest of the body is otherwise unchanged.
    assert.strictEqual(parsed.max_tokens, 3000);
    assert.deepStrictEqual(parsed.usage, { include: true });
  });

  test('the helper output threaded into streamChat reproduces the roadmap wire shape', async () => {
    // This is exactly what the 3 roadmap call sites do: derive {reasoning, maxTokens}
    // from a prose budget, then pass both to streamChat.
    const { reasoning, maxTokens } = resolveReasoningBudget({ model: DEFAULT_MODEL, proseTokens: 5000 });
    const body = await captureBody({ reasoning, maxTokens });
    const parsed = JSON.parse(body);
    assert.deepStrictEqual(parsed.reasoning, { max_tokens: 5000 });
    assert.strictEqual(parsed.max_tokens, 10000, 'prose (5000) + reasoning (5000)');
  });

  test('streamChatWithTools tool-less final answer carries NO reasoning (delegation unaffected)', async () => {
    global.fetch = mock.fn(async () => mockStreamResponse(['answer']));
    const { streamChatWithTools } = await import('../../lib/openrouter.js');
    await streamChatWithTools(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'test-key', model: DEFAULT_MODEL, maxTokens: 1500, tools: [] },
      () => {}
    );
    const body = global.fetch.mock.calls[0].arguments[1].body;
    assert.ok(!/"reasoning"/.test(body), 'streamChatWithTools passes no reasoning ⇒ body unchanged');
  });
});

// ===========================================================================
// Pre-aborted signal handling (LIN-2637)
//
// An AbortSignal that is ALREADY aborted when streamChat is entered fires no
// future `abort` event — the event has been and gone — so a listener alone
// lets a late abort slip through and buy a full streaming call. The guard must
// therefore run up front, BEFORE the request starts: the test asserts that the
// transport is never invoked, not merely that the call rejects.
// ===========================================================================
describe('streamChat pre-aborted signal (LIN-2637)', () => {
  let originalFetch;
  let savedProxyEnv;

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
    setFetchImpl(null);
    for (const [k, v] of Object.entries(savedProxyEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  function mockStreamResponse(pieces) {
    const enc = new TextEncoder();
    const blocks = pieces.map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
    blocks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    blocks.push('data: [DONE]\n\n');
    return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
  }

  test('streamChat with an already-aborted signal issues NO upstream request', async () => {
    const ac = new AbortController();
    ac.abort();

    // A transport that would FAIL the test if it were invoked.
    let fetchCalls = 0;
    setFetchImpl(() => { fetchCalls++; throw new Error('transport must not be invoked'); });

    const events = [];
    const { streamChat } = await import('../../lib/openrouter.js');
    await assert.rejects(
      streamChat(
        [{ role: 'user', content: 'hi' }],
        { apiKey: 'test-key', signal: ac.signal },
        (type, data) => events.push({ type, data })
      ),
      /OpenRouter request timed out/,
      'an already-aborted signal surfaces as the abort contract error'
    );

    assert.strictEqual(fetchCalls, 0, 'no request is made for a pre-aborted signal');
    assert.strictEqual(events.length, 0, 'no tokens/done are emitted for a pre-aborted signal');
  });

  test('an abort landing during streamChat setup is still caught by the up-front guard', async () => {
    // The abort fires while streamChat is suspended inside initProxyFetch —
    // before the request branch (and its listener) has been reached. The
    // post-setup guard must catch it, or the request would proceed with an
    // abort that no listener will ever see. The transport counter pins "no
    // request is issued for the setup window" — a listener-only shape would
    // still reject (via the 120s timeout rescue) but would first put a call
    // on the wire.
    const ac = new AbortController();
    let fetchCalls = 0;
    setFetchImpl((url, opts) => {
      fetchCalls++;
      return new Promise((resolve, reject) => {
        const rejectAborted = () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (opts.signal.aborted) return rejectAborted();
        opts.signal.addEventListener('abort', rejectAborted);
      });
    });

    const { streamChat } = await import('../../lib/openrouter.js');
    const pending = streamChat(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'test-key', signal: ac.signal },
      () => {}
    );
    ac.abort();
    await assert.rejects(pending, /OpenRouter request timed out/);
    assert.strictEqual(fetchCalls, 0, 'no transport call is made when the abort lands during setup');
  });

  test('an abort after the request is in flight rejects via the abort listener', async () => {
    // The genuine mid-flight case: the request is already out when the signal
    // fires, so only the listener wiring can abort it. Guards the listener
    // path the fix relies on for aborts that land after the up-front check.
    const ac = new AbortController();
    let fetchStarted;
    const fetchStartedP = new Promise((resolve) => { fetchStarted = resolve; });
    setFetchImpl((url, opts) => {
      fetchStarted();
      return new Promise((resolve, reject) => {
        const rejectAborted = () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (opts.signal.aborted) return rejectAborted();
        opts.signal.addEventListener('abort', rejectAborted);
      });
    });

    const { streamChat } = await import('../../lib/openrouter.js');
    const pending = streamChat(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'test-key', signal: ac.signal },
      () => {}
    );
    await fetchStartedP;
    ac.abort();
    await assert.rejects(pending, /OpenRouter request timed out/);
  });

  test('streamChatWithTools re-entering runToolHop with an already-aborted signal issues NO request', async () => {
    // The runToolHop half of the shared guard (LIN-2637). An abort that lands
    // during hop 1's executeTool leaves the signal ALREADY aborted when the loop
    // re-enters runToolHop for hop 2. The up-front guard there must fail BEFORE
    // any transport call, or the loop buys a full second tool hop for nothing.
    // This pins the runToolHop call site of throwIfAborted, which the final-hop
    // test above cannot reach: its single hop breaks out of the loop before
    // runToolHop is ever re-entered with the aborted signal.
    const ac = new AbortController();
    const calls = [];
    setFetchImpl(async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ streaming: body.stream === true, toolHop: Array.isArray(body.tools) });
      // Non-streaming tool hop: the model asks for a tool again.
      return {
        ok: true,
        json: async () => ({
          choices: [{
            finish_reason: 'tool_calls',
            message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'sample_tool', arguments: '{}' } }] }
          }]
        })
      };
    });

    const { streamChatWithTools } = await import('../../lib/openrouter.js');
    await assert.rejects(
      streamChatWithTools(
        [{ role: 'user', content: 'hi' }],
        {
          apiKey: 'test-key',
          tools: [{ type: 'function', function: { name: 'sample_tool', parameters: { type: 'object', properties: {} } } }],
          maxIterations: 2,
          signal: ac.signal,
          executeTool: async () => { ac.abort(); return 'tool result'; }
        },
        () => {}
      ),
      /OpenRouter request timed out/,
      'a signal aborted during a tool hop must fail the NEXT runToolHop with the abort contract error'
    );

    // Only hop 1's request happened. Hop 2 must NOT reach the transport.
    assert.strictEqual(calls.length, 1, 'no second tool-hop request for a pre-aborted signal');
    assert.strictEqual(calls[0].toolHop, true, 'the only request is the non-streaming tool hop');
  });

  test('streamChatWithTools final streamChat makes NO request when the abort lands during the last tool hop', async () => {
    const ac = new AbortController();
    const calls = [];
    setFetchImpl(async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ streaming: body.stream === true, toolHop: Array.isArray(body.tools) });
      if (body.tools) {
        // Non-streaming tool hop: the model asks for a tool.
        return {
          ok: true,
          json: async () => ({
            choices: [{
              finish_reason: 'tool_calls',
              message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'sample_tool', arguments: '{}' } }] }
            }]
          })
        };
      }
      // Streaming final answer — reaching here means the fix failed.
      return mockStreamResponse(['should not happen']);
    });

    const { streamChatWithTools } = await import('../../lib/openrouter.js');
    await assert.rejects(
      streamChatWithTools(
        [{ role: 'user', content: 'hi' }],
        {
          apiKey: 'test-key',
          tools: [{ type: 'function', function: { name: 'sample_tool', parameters: { type: 'object', properties: {} } } }],
          maxIterations: 1,
          signal: ac.signal,
          executeTool: async () => { ac.abort(); return 'tool result'; }
        },
        () => {}
      ),
      /OpenRouter request timed out/,
      'a signal aborted during the last tool hop must fail the mandatory final streamChat'
    );

    // Exactly ONE request happened — the tool hop. The final streamed answer
    // must NOT be issued.
    assert.strictEqual(calls.length, 1, 'no streaming call after the tool hop');
    assert.strictEqual(calls[0].toolHop, true, 'the only request is the non-streaming tool hop');
    assert.strictEqual(calls[0].streaming, false);
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
  // SAME recordPromptTrace(...) call (pinned by recommend-stage-assembly.test.js through
  // setFetchImpl); the streaming test below exercises the
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

    // User-facing result: code assembled the routed stage's prompt; the body the
    // model wrote anyway is ignored.
    assert.strictEqual(result.recommendedAction, 'research');
    assert.strictEqual(result.prompt, generatePrompt('research', ISSUE, CONTEXT).prompt);

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
    assert.strictEqual(t.prompt, null); // a routing reply carries no body
    assert.strictEqual(t.finalPrompt, result.prompt); // what the user receives
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
    //
    // LIN-1848: prior to the injectable transport seam, getRecommendation called
    // the module-scoped `customFetch` directly, which was bound to native fetch
    // at import time — so this mock was never actually invoked, and the test only
    // passed because a REAL fetch call also honours an aborted signal. Now that
    // getRecommendation resolves its transport live (via resolveOpenRouterFetch),
    // this mock genuinely receives the call and must handle the case where the
    // signal is ALREADY aborted by the time it's invoked (a real, once-only DOM
    // 'abort' event fired before this listener existed would never be redelivered),
    // exactly as a real fetch implementation would.
    global.fetch = mock.fn((url, opts) => new Promise((_, reject) => {
      const rejectAborted = () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (opts.signal.aborted) return rejectAborted();
      opts.signal.addEventListener('abort', rejectAborted);
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
// Injectable transport seam (LIN-1848)
// =============================================================================
// getRecommendation's transport is `customFetch` under a configured proxy — a
// module-level binding captured before any mock exists (see lib/openrouter.js's
// resolveOpenRouterFetch). setFetchImpl overrides it regardless of proxy state.
// This is the pinning test for that surface: with HTTPS_PROXY set to an
// unreachable value and NO global.fetch mock at all, the override alone must
// carry the whole call and the process must make zero real outbound requests.
describe('getRecommendation transport seam under a configured proxy (LIN-1848)', () => {
  const ISSUE = {
    identifier: 'LIN-1', title: 'A leaf task', description: 'Do the thing.',
    url: 'https://linear.app/test/issue/LIN-1', state: { name: 'In Progress', type: 'started' }
  };
  const CONTEXT = { parent: null, siblings: [], project: { description: '' }, children: [], comments: [], focusedChild: null };

  let networkGuard;
  let savedProxyEnv;
  beforeEach(() => {
    savedProxyEnv = {
      HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY,
      https_proxy: process.env.https_proxy, http_proxy: process.env.http_proxy
    };
    process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
    delete process.env.HTTP_PROXY; delete process.env.https_proxy; delete process.env.http_proxy;
    networkGuard = guardNetwork();
  });
  afterEach(() => {
    setFetchImpl(null);
    networkGuard.restore();
    for (const [k, v] of Object.entries(savedProxyEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    assert.equal(networkGuard.attempts.length, 0, `unexpected http(s).request transport attempts: ${JSON.stringify(networkGuard.attempts)}`);
  });

  test('an injected override serves the call with zero outbound requests, even under a proxy', async () => {
    let overrideCalls = 0;
    setFetchImpl(async (url) => {
      overrideCalls++;
      assert.match(url, /openrouter\.ai/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\n→ **research**\nLook into it.\n## Prompt\nDo the thing.' } }] }) };
    });

    const result = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'test-key' });

    assert.equal(overrideCalls, 1, 'the override, not a live proxy transport, must have served the request');
    assert.equal(result.recommendedAction, 'research');
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

// =============================================================================
// Breakdown-created subtask approved-parent-plan exemption (LIN-3049) — the
// two-path fix so a child of an already-approved, decomposed plan carries its
// own plan slice (plus a committed session-fit and a plan-review-due:no line
// citing the approving verdict) into routing, while a child with no recorded
// Approve on the decomposed ticket's own trail stays a plain acceptance-criteria
// subtask. These are the deterministic structural pins; the live routing shape is
// measured by scripts/eval/fixtures/recommend/approved-parent-breakdown.json.
// =============================================================================
describe('router prompt: approved-parent-plan child exemption (LIN-3049)', () => {
  function build(overrides = {}) {
    return buildRouterPrompt({
      issueContext: 'Test context', identifier: 'LIN-1', hasSubtasks: false,
      subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
      hasComments: true, commentCount: 2, aiHints: 'hints',
      actionVocabulary: getAIRecommendationActionNames().join(', '),
      isTerminal: false, hasOpenChildren: false, ...overrides
    });
  }

  test('the Step 1 over-fire guard names the breakdown child slice as findings-plus-validated-approach', () => {
    const text = build();
    const guardIntro = text.indexOf('Guard against over-firing');
    const addition = text.indexOf('counts as findings-plus-validated-approach already in hand');
    const nextBranch = text.indexOf('→ If the knowledge the deliverable depends on is not yet gathered');
    assert.ok(guardIntro > -1 && addition > -1 && nextBranch > -1, 'all three Step 1 landmarks must be present');
    assert.ok(guardIntro < addition && addition < nextBranch,
      'the addition must sit INSIDE the over-fire guard list, not in the routing branches below');
    assert.ok(/copied slice of the parent's approved plan.*naming its surfaces, approach, and tests/is.test(text),
      'the addition must name the copied approved-parent-plan slice explicitly');
  });

  test('the completed-prep addition is sited before the ONE exception and names the copied slice', () => {
    const text = build();
    const rule = text.indexOf('Completed prep ⇒ never re-emit the prep verb');
    const addition = text.indexOf('copied approved-parent-plan slice with a committed session-fit answer');
    const exception = text.indexOf('ONE exception, and only one:');
    assert.ok(rule > -1 && addition > -1 && exception > -1, 'all three landmarks must be present');
    assert.ok(rule < addition && addition < exception,
      'the addition must sit after the base rule and before its single exception');
    assert.ok(/treat it as settled prep even though the `plan` step never literally ran/is.test(text),
      'the addition must say the breakdown child is settled prep without a plan session of its own');
  });

  test('the gate addition sits strictly between criterion (d) and the verdict routing, outside (a)-(d)', () => {
    const text = build();
    const criterionD = text.indexOf('(d) it touches credential, merge-rule, or dispatch-contract surfaces');
    const addition = text.indexOf('copied approved-plan slice clears the gate');
    const verdict = text.indexOf('Once a plan-review verdict IS on the trail');
    assert.ok(criterionD > -1 && addition > -1 && verdict > -1, 'all three gate landmarks must be present');
    assert.ok(criterionD < addition && addition < verdict,
      'the addition must sit after the (a)-(d) criteria and before the verdict routing');
    assert.ok(/does not re-fire solely because the underlying surface is the same dispatch-contract surface/is.test(text),
      'the addition must name the criterion-(d) non-refire for a copied slice');
    assert.ok(/Re-derive the gate independently only if the child's copied slice visibly diverges/i.test(text),
      'the addition must keep the divergence re-derivation escape hatch');
  });

  test('all three new guards carry the divergence condition, not only the gate', () => {
    const text = build();
    const step1 = text.indexOf('counts as findings-plus-validated-approach already in hand');
    const step1End = text.indexOf('→ If the knowledge the deliverable depends on is not yet gathered');
    assert.ok(step1 > -1 && step1End > step1, 'the Step 1 addition must be present and bounded');
    assert.ok(/unless the copied slice visibly diverges from what the cited approving verdict approved/.test(text.slice(step1, step1End)),
      'R1: the Step 1 over-fire guard must not apply when the copied slice visibly diverges');

    const prep = text.indexOf('treat it as settled prep even though the `plan` step never literally ran');
    const prepEnd = text.indexOf('ONE exception, and only one:');
    assert.ok(prep > -1 && prepEnd > prep, 'the completed-prep addition must be present and bounded');
    assert.ok(/This settled-prep read does NOT apply when the child's copied slice visibly diverges/.test(text.slice(prep, prepEnd)),
      'R1: the completed-prep rule must not apply when the copied slice visibly diverges');

    const gate = text.indexOf('copied approved-plan slice clears the gate');
    const gateEnd = text.indexOf('Once a plan-review verdict IS on the trail');
    assert.ok(gate > -1 && gateEnd > gate, 'the gate addition must be present and bounded');
    assert.ok(/Re-derive the gate independently only if the child's copied slice visibly diverges/.test(text.slice(gate, gateEnd)),
      'R1: the gate must re-derive on the same visible divergence');
  });


  test('parity: the LIN-597 downward bias and the LIN-1603 verdict/revision pins are untouched byte-for-byte', () => {
    const text = build();
    assert.ok(/fits one session.*`implementation`.*needs multiple sessions.*`breakdown`/is.test(text),
      'both pre-existing session-fit routes must survive');
    assert.ok(/route on the PLAN-REVIEW FACTS below \(computed in code — do not re-count or re-derive it\)/i.test(text),
      'the verdict routing lead must point at the code-computed facts');
    assert.ok(/An Approve authorizes implementation only — it is never close-out evidence/i.test(text),
      'the Approve-not-close-out pin must survive');
    assert.ok(/Completed prep ⇒ never re-emit the prep verb/i.test(text),
      'the completed-prep rule itself must survive');
    assert.ok(/ONE exception, and only one: a `plan-review` that recorded \*\*Request Changes\*\* or \*\*Needs Discussion\*\*/i.test(text),
      'the single request-changes exception pin (openrouter.test.js:1005) must survive');
    assert.ok(/no committed scope ⇒ never `implement`/i.test(text),
      'the no-committed-scope rule must survive');
    assert.ok(/one-directional/i.test(text) && /resolve DOWN/i.test(text),
      'the one-directional downward bias must survive');
    assert.ok(/never overrides a plan that exists/i.test(text),
      'the guard-fires-only-when-scope-absent pin must survive');
  });
});
