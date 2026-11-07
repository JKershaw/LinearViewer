/**
 * LIN-4345, attempt 2 (upstream): a stage that decides what gets built names each cut to the
 * `## As asked` block and raises one ruling. The rule has one home, the DECIDE scope line in
 * lib/prompts/stage-intent.js, so every deciding stage renders it once and no judging,
 * reading or filing stage renders it at all. A new deciding stage inherits it by being DECIDE;
 * a copy anywhere else fails here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { generatePrompt, PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';
import { STAGE_INTENT } from '../../lib/prompts/stage-intent.js';

const CUT_RULE = 'Cutting the `## As asked` block is not yours';
const LICENCE = /fixing at the cause and refactoring included, are yours/; // DECIDE's own clause
const DECIDING = ['research', 'scoping', 'design', 'spike', 'plan', 'breakdown', 'implementation', 'blocked'];

const ISSUE = {
  id: 'issue-cut', identifier: 'LIN-4345', title: 'Cut rule fixture',
  description: '## As asked\n\nWrite a full guide.\n\n*End of what was asked. Steps write below this line; nothing above it changes.*',
  url: 'https://linear.app/test/issue/LIN-4345', createdAt: '2026-11-07T00:00:00.000Z',
  state: { name: 'In Progress', type: 'started' }, labels: []
};
const CONTEXT = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
const count = (text, needle) => text.split(needle).length - 1;

describe('the cut rule has one home (LIN-4345)', () => {
  test('the deciding stages are exactly the DECIDE ones', () => {
    const decide = Object.keys(STAGE_INTENT).filter(k => LICENCE.test(STAGE_INTENT[k][0]));
    assert.deepEqual(decide.sort(), [...DECIDING].sort());
  });

  test('every DECIDE stage renders the cut rule exactly once; every other stage never', () => {
    const kinds = Object.keys(PROMPT_TEMPLATES);
    assert.ok(DECIDING.every(k => kinds.includes(k)), 'every deciding stage has a template');
    for (const kind of kinds) {
      const { prompt } = generatePrompt(kind, ISSUE, CONTEXT);
      const decides = Object.hasOwn(STAGE_INTENT, kind) && LICENCE.test(STAGE_INTENT[kind][0]);
      assert.equal(count(prompt, CUT_RULE), decides ? 1 : 0, kind);
    }
  });

  test('the rule carries all three parts: what a cut is, quote it where you write, one ruling unagreed until answered', () => {
    const line = STAGE_INTENT.plan[0];
    assert.match(line, /any sentence or clause not delivered in full/);
    assert.match(line, /scope, assumption, design, size limit or another ticket, is a cut/);
    assert.match(line, /Quote each where you write/);
    assert.match(line, /raise them as one ruling; unanswered, a cut is not agreed/);
  });

  test('no other prompt source carries a copy of the rule', () => {
    const files = ['lib/prompt-template-defs.js', 'lib/prompt-formatters.js', 'lib/proxy-preamble.js', 'lib/prompt-contract.js',
      ...readdirSync('lib/prompts').map(f => `lib/prompts/${f}`).filter(f => f !== 'lib/prompts/stage-intent.js')];
    for (const f of files) assert.equal(count(readFileSync(f, 'utf8'), CUT_RULE), 0, f);
  });
});

describe('scoping and plan give the cuts a place (LIN-4345)', () => {
  test('scoping no longer owns what is in and out of scope, and still reads the code first', () => {
    const { prompt } = generatePrompt('scoping', ISSUE, CONTEXT);
    assert.doesNotMatch(prompt, /in and out of scope is yours to decide/);
    assert.doesNotMatch(prompt, /flag for the human only product or intent questions/);
    assert.match(prompt, /Read the code first\./);
    assert.match(prompt, /- \*\*Out of Scope\*\*: Different problems excluded, and each cut to the ask, quoted, with its ruling; the cause of this one is never out of scope/);
  });

  test('plan opens with the block\'s problem, then each cut, inherited too, with its ruling, or none', () => {
    const { prompt } = generatePrompt('plan', ISSUE, CONTEXT);
    assert.match(prompt, /It opens with the problem as the `## As asked` block puts it and what done will look like: .*marked as the plan's own\. It lists each cut to the block, inherited too, quoted with its ruling, or says none\. If what the ticket asks for has drifted/);
  });
});
