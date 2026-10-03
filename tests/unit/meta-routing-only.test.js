/**
 * LIN-3292: the meta call can route only. With `routingOnly`, the meta-prompt keeps
 * the facts, the decision tree, the action vocabulary and the reasoning format, and
 * drops everything about writing a prompt body: the grounding and scale rules, the
 * prompt skeleton, the per-stage quality rules and the `## Prompt` section. Off, it
 * is byte-identical to today's. The parser takes a body-less reply in that mode.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { parseRecommendationResponse } from '../../lib/openrouter.js';

const ARGS = {
  issueContext: 'CTX', identifier: 'LIN-1', hasSubtasks: false, subtaskCount: 0, completedCount: 0,
  inProgressCount: 0, remainingCount: 0, hasComments: false, commentCount: 0,
  aiHints: 'HINTS', actionVocabulary: 'plan, review, defer', completionSignals: 'SIGNALS'
};
const WRITING = ['## Grounding Rule', '## Scale To The Task', 'Keep the generated prompt inside', '## Prompt Structure',
  '### Quality rules for generated prompts', '## Comments vs Description', '## Label Instructions', '3. Generate a tailored prompt',
  '\n## Prompt\n', 'Generate a tailored prompt they can use'];
const ROUTING = ['## Task Context\nCTX', '## CRITICAL: Sequential Workflow Decision', '### Step 1', '### Step 3',
  '## Action Types Reference\n\nHINTS', '## Completion Signals', '## Reasoning', '→ **<action>**', '**Next:**', 'plan, review, defer'];

describe('routing-only meta-prompt (LIN-3292)', () => {
  test('off: byte-identical to the default', () => {
    assert.equal(buildMetaPromptTemplate({ ...ARGS, routingOnly: false }), buildMetaPromptTemplate(ARGS));
  });

  test('on: every routing part stays and every writing part goes', () => {
    const full = buildMetaPromptTemplate(ARGS);
    const routing = buildMetaPromptTemplate({ ...ARGS, routingOnly: true });
    for (const part of ROUTING) assert.ok(routing.includes(part), `keeps ${JSON.stringify(part)}`);
    for (const part of WRITING) {
      assert.ok(full.includes(part), `the full prompt has ${JSON.stringify(part)}`);
      assert.ok(!routing.includes(part), `routing drops ${JSON.stringify(part)}`);
    }
    assert.ok(Buffer.byteLength(routing) < Buffer.byteLength(full) / 2, 'the per-stage rules were most of it');
  });

  test('the parser takes a body-less reply in routing mode, and still requires an action', () => {
    const reply = '## Reasoning\n**Assessment:**\n- Ready: ✓ Yes\n→ **plan**\n**Next:** review';
    assert.throws(() => parseRecommendationResponse(reply, 'stop', 3), /missing ## Reasoning or ## Prompt/);
    const parsed = parseRecommendationResponse(reply, 'stop', 3, { routingOnly: true });
    assert.equal(parsed.prompt, null);
    assert.equal(parsed.recommendedAction, 'plan');
    assert.throws(() => parseRecommendationResponse('## Reasoning\nno arrow', 'stop', 3, { routingOnly: true }), /recommended action/);
  });

  test('routing mode needs only the action line: a reply with the header rendered as bold still parses (seen live)', () => {
    const reply = '**Reasoning**\n**Assessment:**\n- Ready: ✗ No - open decision\n→ **design**\n**Next:** weigh the shapes';
    const parsed = parseRecommendationResponse(reply, 'stop', 3, { routingOnly: true });
    assert.equal(parsed.recommendedAction, 'design');
    assert.ok(parsed.reasoning.startsWith('**Assessment:**'));
    const defer = parseRecommendationResponse('Reasoning:\n→ **defer**\n**DeferTo:** LIN-9', 'stop', 3, { routingOnly: true });
    assert.equal(defer.deferTo, 'LIN-9');
    assert.throws(() => parseRecommendationResponse(reply, 'stop', 3), /missing ## Reasoning or ## Prompt/, 'the full mode is unchanged');
  });

  test('routing mode ignores a body the model emits anyway, and keeps the defer contract', () => {
    const parsed = parseRecommendationResponse('## Reasoning\n→ **plan**\n## Prompt\nBODY', 'stop', 3, { routingOnly: true });
    assert.equal(parsed.prompt, null);
    const defer = parseRecommendationResponse('## Reasoning\n→ **defer**\n**DeferTo:** LIN-9', 'stop', 3, { routingOnly: true });
    assert.equal(defer.deferTo, 'LIN-9');
  });
});
