/**
 * LIN-3279: agent-filed tickets are starting points, not finished research.
 * The filing prompts share one FOLLOW_UP_SHAPE sentence, and the research and
 * design skip guards do not count a filer's own fix as completed prep.
 *
 * Run with: node --test tests/unit/lin-3279-follow-up-shape.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert';
import * as defs from '../../lib/prompt-template-defs.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { PERIODICALS } from '../../lib/periodicals.js';

const ISSUE = { id: 'x', identifier: 'ABC-1', title: 'T', description: 'D', state: { name: 'Done', type: 'completed' }, labels: [] };

test('FOLLOW_UP_SHAPE labels a fix idea as an unvalidated hypothesis', () => {
  assert.ok(defs.FOLLOW_UP_SHAPE, 'FOLLOW_UP_SHAPE is exported');
  assert.match(defs.FOLLOW_UP_SHAPE, /Unvalidated idea/);
  assert.match(defs.FOLLOW_UP_SHAPE, /allowed/);
});

for (const key of ['close-out', 'retrospective-audit']) {
  test(`${key} prompt carries FOLLOW_UP_SHAPE`, () => {
    assert.ok(generatePrompt(key, ISSUE, {}).prompt.includes(defs.FOLLOW_UP_SHAPE));
  });
}

test('every task-minting periodical carries FOLLOW_UP_SHAPE', () => {
  const minting = PERIODICALS.map(p => [p.id, p.generatePrompt()]).filter(([, text]) => /Mint a bounded set/.test(text));
  assert.ok(minting.length > 0);
  for (const [id, text] of minting) assert.ok(text.includes(defs.FOLLOW_UP_SHAPE), id);
});

test('research and design skip guards do not accept a filer-written fix as prep', () => {
  const { research, design } = defs.PROMPT_TEMPLATES;
  assert.match(research.route.whenNot, /completed prep/);
  assert.match(research.route.whenNot, /hypothesis/);
  assert.doesNotMatch(design.route.whenNot, /the ticket or comments already committed/);
  assert.match(design.route.whenNot, /research write-up or approved plan/);
});

test('Seams & Tangles puts the move under the Unvalidated idea heading', () => {
  const seams = PERIODICALS.find(p => p.title === 'Seams & Tangles');
  assert.ok(seams, 'Seams & Tangles periodical exists');
  const bullet = seams.generatePrompt().split('\n').find(l => l.includes('Shape each follow-up as one move'));
  assert.ok(bullet, 'bullet present');
  assert.match(bullet, /Unvalidated idea/);
  assert.doesNotMatch(bullet, /names a single move/);
});
