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
// Action vocabulary — the routing prompt's `→ **action**` must stay inside the
// vocabulary deriveDispatchKind() understands, so the fused recommend-and-dispatch
// verb lands a real `kind` (not the `custom` fallback) for every known type.
// =============================================================================

describe('action vocabulary (kind derivation seam)', () => {
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
// Breakdown-created subtask approved-parent-plan exemption (LIN-3049): a child carrying
// a copied slice of an approved parent plan is settled prep, and its own "plan-review
// due: no" citing the parent's verdict is honored. The selector reads both from the
// stages' own descriptions (LIN-3300); the live routing shape is measured by
// scripts/eval/fixtures/recommend/approved-parent-breakdown.json.
// =============================================================================
describe('stage descriptions: approved-parent-plan child exemption (LIN-3049)', () => {
  test('plan and plan-review each name the breakdown child\'s approved parent slice', async () => {
    const { getSelectableStages } = await import('../../lib/prompt-templates.js');
    const stage = (k) => getSelectableStages().find(st => st.key === k);
    assert.match(stage('plan').whenNot, /breakdown child's copied slice of an approved parent plan/);
    assert.match(stage('plan-review').whenNot, /breakdown child covered by its parent's approving plan-review/);
  });
});
