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

// LIN-4380 (LIN-4349 P2): this used to pin "every task-minting periodical carries FOLLOW_UP_SHAPE".
// No Periodical files a ticket now (the 13 corrective ones feed the area notes, the 3 advisory ones
// report to a person), so the shape's carriers are exactly the filing prompts above. This pins
// that: no Periodical prompt tells the run to file follow-ups, none carries the filing shape, and
// each says positively that it mints none. A Periodical that starts filing again fails here.
test('no Periodical files a follow-up, so none carries FOLLOW_UP_SHAPE (LIN-4380)', () => {
  assert.strictEqual(PERIODICALS.length, 16);
  for (const p of PERIODICALS) {
    const text = p.generatePrompt();
    assert.doesNotMatch(text, /Mint a bounded set|into new Linear tasks yourself|before minting a task/i, `${p.id} tells the run to file follow-ups`);
    assert.ok(!text.includes(defs.FOLLOW_UP_SHAPE), `${p.id} carries the filing shape`);
    assert.match(text, p.mode === 'advisory' ? /mint NO follow-up tasks/ : /mint no follow-up tasks/, `${p.id} says it mints none`);
  }
});

test('research and design skip guards do not accept a filer-written fix as prep', () => {
  const { research, design } = defs.PROMPT_TEMPLATES;
  assert.match(research.route.whenNot, /completed prep/);
  assert.match(research.route.whenNot, /hypothesis/);
  assert.doesNotMatch(design.route.whenNot, /the ticket or comments already committed/);
  assert.match(design.route.whenNot, /research write-up or approved plan/);
});

// Seams & Tangles' "Shape each follow-up as one move" bullet went with its follow-ups (LIN-4379):
// it feeds the area notes and mints nothing, which tests/unit/periodicals.test.js pins.
