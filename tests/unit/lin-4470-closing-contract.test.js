/**
 * LIN-4470 (piece 6 of LIN-4448): the cut rule's token order is the closing contract's, and a test links the two.
 *
 * CUT (lib/prompts/stage-kinds.js) tells a stage that a cut is raised as one `question` record, then the run ends `BLOCKED:`.
 * The closing contract the runner is given (lib/prompts/runner-kickoff.js, docs/runner-prompt.md) says the same in its own
 * words: the question is asked before the one outcome line, `BLOCKED:`. The question record is the ask (LIN-4533; the
 * DECISION: block it replaces was scraped from the text), so the order is the record's, and the two spellings must agree.
 * Each side was tested alone before; this is the link. Words only: the rule's sentences are not compared.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CUT } from '../../lib/prompts/stage-kinds.js';
import { buildRunnerKickoff } from '../../lib/prompts/runner-kickoff.js';

const kickoff = buildRunnerKickoff({ baseUrl: 'https://harbour.example' });

describe('LIN-4470 — the cut rule and the closing contract name the same tokens in the same order', () => {
  test('the closing contract says the question record is written before the one outcome line, BLOCKED: (LIN-4533)', () => {
    assert.match(kickoff, /end your final message with exactly one outcome line/);
    assert.match(kickoff, /write a `question` record on the task/);
    assert.match(kickoff, /then end `BLOCKED:`/);
  });

  test('CUT and the closing contract name the question record before BLOCKED:, the same way', () => {
    const question = CUT.indexOf('`question` record');
    const blocked = CUT.indexOf('`BLOCKED:`');
    assert.ok(question >= 0, 'CUT names the `question` record');
    assert.ok(blocked > question, 'CUT names `BLOCKED:` after the question record');
    assert.ok(kickoff.includes('`question` record') && kickoff.includes('`BLOCKED:`'), 'the closing contract spells both the same way');
    assert.ok(kickoff.indexOf('`question` record') < kickoff.indexOf('then end `BLOCKED:`'), 'the closing contract asks before it ends BLOCKED:');
  });
});
