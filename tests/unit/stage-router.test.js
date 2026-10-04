/**
 * LIN-3304: the next-stage choice has its own seam (lib/stage-router.js).
 *
 * This is the routing eval arm the ticket asks for, pinned at the seam: it proves
 * the router prompt the writer-off live path sends is byte-identical to the routing
 * half the full template composes, and that the routing reply is parsed into the
 * stage decision by one owner. Behaviour is deliberately unchanged here — the two
 * known defects (a `**Reasoning**` header, an out-of-list stage) are pinned as
 * PRESENT, so the follow-up ticket that fixes them has a witness to move.
 *
 * Run with: node --test tests/unit/stage-router.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRouterPrompt,
  routerFragments,
  routeStage,
  parseRouteDecision,
  parseRecommendedAction,
  parseDeferTo
} from '../../lib/stage-router.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { parseRecommendationResponse } from '../../lib/openrouter.js';

const ARGS = {
  issueContext: 'CTX', identifier: 'LIN-1', hasSubtasks: false, subtaskCount: 0, completedCount: 0,
  inProgressCount: 0, remainingCount: 0, hasComments: false, commentCount: 0,
  aiHints: 'HINTS', actionVocabulary: 'plan, review, defer', completionSignals: 'SIGNALS'
};

const NODE_ARGS = {
  ...ARGS,
  issueContext: 'NODE-CTX', identifier: 'LIN-7700',
  hasSubtasks: true, subtaskCount: 2, completedCount: 1, inProgressCount: 1, remainingCount: 1,
  hasComments: true, commentCount: 3, focusedSubtaskId: 'LIN-7701',
  frontierFacts: { openCount: 1, blockedCount: 0, openChildren: [{ identifier: 'LIN-7701', blocked: false }], nextChild: 'LIN-7701', sessionFit: 'fits one session' },
  isTerminal: false, hasOpenChildren: true
};

describe('stage-router: one owner for the next-stage choice (LIN-3304)', () => {
  test('the router prompt is byte-identical to the routing half the full template composes', () => {
    for (const args of [ARGS, NODE_ARGS, { ...NODE_ARGS, isTerminal: true }]) {
      assert.equal(
        buildRouterPrompt(args),
        buildMetaPromptTemplate({ ...args, routingOnly: true }),
        `routing-only output must match the seam for ${args.identifier}`
      );
    }
  });

  test('the full template still composes every router fragment (nothing dropped in the move)', () => {
    const full = buildMetaPromptTemplate(ARGS);
    const f = routerFragments(ARGS);
    for (const [name, text] of Object.entries(f)) {
      if (name === 'trailing') continue;
      assert.ok(full.includes(text), `the full prompt still carries the ${name} fragment exactly`);
    }
  });

  test('routeStage reads the chosen stage, its kind and its contract lines', () => {
    const reply = '## Reasoning\n**Assessment:**\n- Ready: ✓ Yes\n→ **plan**\n**Next:** write the plan';
    const d = routeStage(reply, 'stop', 12);
    assert.equal(d.action, 'plan');
    assert.equal(d.kind, 'plan');
    assert.equal(d.deferTo, null);
    assert.equal(d.next, 'write the plan');
    assert.ok(d.assessment.includes('Ready: ✓ Yes'), 'the assessment block is read');
    assert.equal(d.truncated, false);
    assert.equal(d.completionTokens, 12);
  });

  test('routeStage carries the defer contract (target + kind), and still rejects a body-less non-defer', () => {
    const d = routeStage('## Reasoning\n→ **defer**\n**DeferTo:** LIN-9', 'stop', 3);
    assert.equal(d.action, 'defer');
    assert.equal(d.kind, 'defer');
    assert.equal(d.deferTo, 'LIN-9');
    assert.throws(() => routeStage('## Reasoning\nno arrow', 'stop', 3), /recommended action/);
    assert.throws(() => routeStage('## Reasoning\n→ **defer**', 'stop', 3), /DeferTo target/);
  });

  test('PRESENT-BEHAVIOUR PIN: the live `**Reasoning**` header still parses in routing mode (fix owed later)', () => {
    const d = routeStage('**Reasoning**\n→ **design**\n**Next:** weigh the shapes', 'stop', 3);
    assert.equal(d.action, 'design');
    assert.ok(d.reasoning.startsWith('→ **design**') || d.reasoning.includes('Weigh') || d.reasoning.includes('→'), 'the reasoning survives the bold header');
  });

  test('PRESENT-BEHAVIOUR PIN: an out-of-list stage is still accepted in routing mode (fix owed later)', () => {
    assert.equal(routeStage('## Reasoning\n→ **retro**', 'stop', 3).action, 'retro');
  });

  test('the full-mode parse is unchanged: it still requires a ## Prompt body', () => {
    const reply = '## Reasoning\n→ **plan**\n**Next:** review';
    assert.throws(() => parseRecommendationResponse(reply, 'stop', 3), /missing ## Reasoning or ## Prompt/);
    const parsed = parseRecommendationResponse(reply + '\n## Prompt\nBODY', 'stop', 3);
    assert.equal(parsed.prompt, 'BODY');
    assert.equal(parsed.recommendedAction, 'plan');
  });

  test('parseRecommendationResponse routing mode delegates to the seam (same decision, legacy shape)', () => {
    const reply = '## Reasoning\n→ **plan**\n**Next:** review';
    const viaSeam = routeStage(reply, 'stop', 3);
    const legacy = parseRecommendationResponse(reply, 'stop', 3, { routingOnly: true });
    assert.equal(legacy.recommendedAction, viaSeam.action);
    assert.equal(legacy.prompt, null);
  });

  test('parseRouteDecision and routeStage are the same owner', () => {
    const reply = '## Reasoning\n→ **review**';
    assert.deepEqual(routeStage(reply, 'stop', 1), parseRouteDecision(reply, 'stop', 1));
  });

  test('openrouter still re-exports the seam\'s parsers (one canonical definition)', async () => {
    const openrouter = await import('../../lib/openrouter.js');
    assert.equal(openrouter.parseRecommendedAction, parseRecommendedAction);
    assert.equal(openrouter.parseDeferTo, parseDeferTo);
  });
});
