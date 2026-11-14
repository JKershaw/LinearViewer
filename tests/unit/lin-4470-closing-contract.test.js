/**
 * LIN-4470 (piece 6 of LIN-4448): the cut rule's token order is the closing contract's, and a test links the two.
 *
 * CUT (lib/prompts/stage-kinds.js) tells a stage that a cut is raised as one ruling, `DECISION:` before `BLOCKED:`. The
 * closing contract the runner is given (lib/prompts/runner-kickoff.js) says the same thing in its own words: a
 * `DECISION:` line just before the one outcome line, `BLOCKED:`. Harbour records a ruling only from a DECISION: line
 * (LIN-3505), so the order is code's reading, and the two spellings must agree. Each side was tested alone before; this
 * is the link. Words only: the rule's sentences are not compared.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CUT } from '../../lib/prompts/stage-kinds.js';
import { buildRunnerKickoff } from '../../lib/prompts/runner-kickoff.js';

const kickoff = buildRunnerKickoff({ baseUrl: 'https://harbour.example' });

describe('LIN-4470 — the cut rule and the closing contract name the same tokens in the same order', () => {
  test('the closing contract says DECISION: sits just before the one outcome line, BLOCKED:', () => {
    assert.match(kickoff, /end your final message with exactly one outcome line/);
    assert.match(kickoff, /`DECISION:` line just before the `BLOCKED:` line/);
  });

  test('CUT spells both tokens the same way and in the same order', () => {
    const decision = CUT.indexOf('`DECISION:`');
    const blocked = CUT.indexOf('`BLOCKED:`');
    assert.ok(decision >= 0, 'CUT names `DECISION:`');
    assert.ok(blocked > decision, 'CUT names `BLOCKED:` after `DECISION:`');
    assert.ok(kickoff.includes('`DECISION:`') && kickoff.includes('`BLOCKED:`'), 'the closing contract spells both the same way');
  });
});
