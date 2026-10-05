/**
 * LIN-3304: the next-stage choice has its own seam (lib/stage-router.js).
 *
 * This is the routing eval arm the ticket asks for, pinned at the seam: the router
 * prompt (since LIN-3300 the only prompt a recommendation call sends; its bytes are
 * pinned by stage-router-prompt-snapshots.test.js) is the stage selector, and the
 * routing reply is parsed into the stage decision by one owner. LIN-3309 fixed the two defects this seam pinned as
 * PRESENT (`**Reasoning**` streaming, an out-of-list `retro`), so those pins moved.
 *
 * Run with: node --test tests/unit/stage-router.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRouterPrompt,
  routeStage,
  parseRouteDecision,
  parseRecommendedAction,
  parseDeferTo
} from '../../lib/stage-router.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';

const ISSUE = { identifier: 'LIN-1', title: 't', description: 'd', state: { name: 'Todo', type: 'unstarted' }, labels: [] };
const CTX = { parent: null, siblings: [], project: null, children: [], comments: [] };

describe('stage-router: one owner for the next-stage choice (LIN-3304)', () => {
  test('the router prompt is the stage selector: view, facts, stages, rules, reply (LIN-3300)', () => {
    const prompt = buildRouterPrompt(buildSelectorArgs(ISSUE, CTX));
    const order = ['## The ticket', '## Facts computed in code', '## Stages', '## How to choose', '## Reply'].map(h => prompt.indexOf(h));
    assert.ok(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1])), 'each section once, in order');
    assert.doesNotMatch(prompt, /Sequential Workflow Decision|### Step \d/, 'the decision tree is gone');
  });

  test('a non-Linear provider gets the capability pass (review finding 1)', () => {
    const prompt = buildRouterPrompt(buildSelectorArgs(ISSUE, CTX, { linearMcp: false }, { displayName: 'GitHub Issues' }));
    assert.ok(!/\bLinear\b/.test(prompt));
  });

  test('routeStage reads the chosen stage, its kind and its Why now line', () => {
    const reply = '## Reasoning\n→ **plan**\n**Why now:** there is no plan yet.';
    const d = routeStage(reply, 'stop', 12);
    assert.equal(d.action, 'plan');
    assert.equal(d.kind, 'plan');
    assert.equal(d.deferTo, null);
    assert.equal(d.whyNow, 'there is no plan yet.');
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

  test('the live `**Reasoning**` header still parses in routing mode (D1 fixed the stream, not the parse)', () => {
    const d = routeStage('**Reasoning**\n→ **design**\n**Next:** weigh the shapes', 'stop', 3);
    assert.equal(d.action, 'design');
    assert.ok(d.reasoning.startsWith('→ **design**') || d.reasoning.includes('Weigh') || d.reasoning.includes('→'), 'the reasoning survives the bold header');
  });

  test('an out-of-list stage is rejected in routing mode (D2)', () => {
    assert.throws(() => routeStage('## Reasoning\n→ **retro**', 'stop', 3), /cannot be recommended/);
    // `parseRecommendedAction` stays a pure extractor that returns the token.
    assert.equal(parseRecommendedAction('## Reasoning\n→ **retro**'), 'retro');
  });

  test('a `## Prompt` section a model adds anyway is not part of the reasoning', () => {
    const d = routeStage('## Reasoning\n→ **plan**\n**Next:** review\n## Prompt\nBODY', 'stop', 3);
    assert.equal(d.action, 'plan');
    assert.ok(!d.reasoning.includes('BODY'));
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
