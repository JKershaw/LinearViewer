/**
 * LIN-4495 (piece 4 of LIN-4491): the rendering witness. Every stage kind is rendered, fresh and in a fix round, and
 * every rendered prompt is checked for the cutover: no retired word, no "say so on the parent" line, the ask route
 * named where a parent or a sibling was once told in a comment (implementation, plan, breakdown), and the hand-off
 * protocol in every run-bearing preamble, with the run-less line for a dispatch with no run. The preamble's mandates
 * no longer deny a write that the records route allows.
 *
 * The census (tests/unit/lin-4495-retirement-census.test.js) reads the code; this reads what the code renders, so text
 * composed at runtime is covered too (the plan's "the rendering witness catches what the search cannot").
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { buildProxyContextPreamble } from '../../lib/proxy-preamble.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';
import { HANDOFF_BLOCK, ASK_ROUTE, CLOSE_OUT_LINE, HANDOFF_CALLS } from '../../lib/prompts/handoff-words.js';
import { WRITES, WRITES_VALUES } from '../../lib/stage-writes.js';
import { RETIRED, findRetired } from './lin-4495-retirement-census.test.js';

const ISSUE = { id: 'x', identifier: 'LIN-42', title: 'Witness', description: '## As asked\n\nDo the thing.\n', state: { name: 'In Progress', type: 'started' }, labels: [] };
const REVIEW_CHANGES = {
  id: 'r1',
  createdAt: '2026-11-18T10:00:00.000Z',
  user: { name: 'Ada' },
  body: '## Code Review\n\nReviewed head `abc1234` of https://github.com/acme/widget/pull/9.\n\n**Verdict: Request Changes**\n',
};
const PLAIN = { comments: [{ id: 'c1', createdAt: '2026-11-17T10:00:00.000Z', user: { name: 'Ada' }, body: 'Implementation done: https://github.com/acme/widget/pull/9, CI green.' }] };
const FIX_ROUND = { comments: [...PLAIN.comments, REVIEW_CHANGES] };

/** The stage kinds this witness renders: every key of STAGE_KINDS that has a template. */
const KINDS = Object.keys(STAGE_KINDS);
const RUN_BEARING_ASK = new Set(['implementation', 'plan', 'breakdown']);

function render(kind, context) {
  try {
    return generatePrompt(kind, ISSUE, context, {}, {}).prompt;
  } catch (err) {
    if (/no template|not a template|unknown/i.test(String(err?.message))) return null;
    throw err;
  }
}

describe('LIN-4495 rendering witness: every stage kind, fresh and in a fix round', () => {
  for (const [label, context] of [['fresh', PLAIN], ['fix round', FIX_ROUND]]) {
    test(`${label}: no rendered prompt carries a retired word or the "say so on the parent" line`, () => {
      const offenders = [];
      for (const kind of KINDS) {
        const prompt = render(kind, context);
        if (prompt === null) continue;
        for (const { word, re } of RETIRED) if (re.test(prompt)) offenders.push(`${kind}: ${word}`);
        if (/say so on the parent/.test(prompt)) offenders.push(`${kind}: say so on the parent`);
        if (/discharged\/empty ledger|discharging the ledger|ledger you read for yourself/.test(prompt)) offenders.push(`${kind}: the ledger gate line`);
      }
      assert.deepStrictEqual(offenders, []);
    });

    test(`${label}: the ask route is named in the implementation, plan and breakdown prompts`, () => {
      for (const kind of RUN_BEARING_ASK) {
        const prompt = render(kind, context);
        // implementation and plan carry the ask route; breakdown names the same route in its child line (C1-37).
        const named = kind === 'breakdown'
          ? /send a finding to the parent task/.test(prompt)
          : prompt && prompt.includes('To ask the parent or a sibling task something');
        assert.ok(named, `${kind}: the ask route is named`);
      }
    });
  }

  test('the findings the reading keeps are the same words everywhere: the close-out line is one constant', () => {
    assert.equal(CLOSE_OUT_LINE, 'no open findings to close-out');
    assert.ok(ASK_ROUTE.includes('to'), 'the ask route names where the finding goes');
    assert.equal(findRetired({ 'lib/prompts/handoff-words.js': HANDOFF_BLOCK + HANDOFF_CALLS + ASK_ROUTE }).length, 0, 'the protocol itself uses no retired word');
  });
});

describe('LIN-4495 rendering witness: the preamble carries the hand-off protocol, and its mandates allow the writes', () => {
  const build = (writes, runRecordId) => buildProxyContextPreamble({
    baseUrl: 'https://host', token: 'TOK123', issueIdentifier: 'LIN-42', providerDisplayName: 'Linear', writes, runRecordId,
  });

  for (const writes of WRITES_VALUES) {
    test(`${writes}: a run-bearing preamble renders the protocol once, naming the run`, () => {
      const block = build(writes, 'run-abc');
      assert.equal(block.split(HANDOFF_BLOCK).length - 1, 1, 'the protocol block appears exactly once');
      assert.ok(block.includes('Your run: run-abc.'));
      assert.ok(!block.includes('This dispatch starts no run'), 'no run-less line on a run-bearing preamble');
    });

    test(`${writes}: a run-less preamble says records writes are refused, and renders no protocol`, () => {
      const block = build(writes, null);
      assert.ok(block.includes('This dispatch starts no run, so records writes are refused for it'));
      assert.ok(!block.includes(HANDOFF_BLOCK));
    });
  }

  test('the mandates no longer deny a write that the records route allows', () => {
    for (const writes of [WRITES.ONE_COMMENT, WRITES.BLIND_COMMENT, WRITES.NONE]) {
      const block = build(writes, 'run-abc');
      assert.doesNotMatch(block, /your only write is one comment/, `${writes}: a mandate that denies writes`);
    }
  });

  test('the close-out line reads the same in the preamble and the instructions', () => {
    assert.ok(build(WRITES.WORK, 'run-abc').includes(`Approve and ${CLOSE_OUT_LINE}.`) || build(WRITES.WORK, 'run-abc').includes(CLOSE_OUT_LINE));
    assert.ok(buildInstructions({ baseUrl: 'https://host', scope: 'readWrite' }).includes(CLOSE_OUT_LINE));
  });

  test('the instructions carry the hand-off calls and no conveyor', () => {
    const text = buildInstructions({ baseUrl: 'https://host', scope: 'readWrite' });
    assert.ok(text.includes('POST https://host/api/proxy/records'));
    assert.ok(text.includes('"kind":"finding"'));
    assert.deepStrictEqual(findRetired({ 'x.js': text }), [], 'the instructions use no retired word');
  });
});
