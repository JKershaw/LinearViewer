/**
 * LIN-4499 close-out (finding-1236e238), as converted by LIN-4527: the kept ticket section and the selector's view leave
 * the description's OLD plan section out with `textWithoutPlan` (lib/legacy-plan-text.js), the one temporary Slice 4
 * display. The sealed-block branch that once kept a plan heading inside a legacy `## As asked` block is retired with its
 * reader: no production block holds a plan heading (checked on LIN-4527 across 160 sealed tickets), and the block's
 * words and end line still come through whole when they hold none.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatIssueContext, formatSelectorView } from '../../lib/openrouter.js';
import { textWithoutPlan } from '../../lib/legacy-plan-text.js';
import { ASKED_END } from '../../lib/brief-quote.js';

const SEALED = `## As asked\n\nPlease fix X.\n\nMy idea: do Y.\n\n${ASKED_END}`;
const REPRO = `${SEALED}\n\n## Notes\n\nkept`;

describe('textWithoutPlan: the temporary plan display cuts only a plan section (LIN-4527)', () => {
  test('a sealed block with nothing around it comes back whole', () => {
    assert.equal(textWithoutPlan(SEALED), SEALED);
  });

  test('a plan section below a block is cut, the block and the notes stay', () => {
    const text = `${SEALED}\n\n## Implementation Plan\n\nstep-written plan\n\n## Notes\n\nkept`;
    assert.equal(textWithoutPlan(text), REPRO);
  });

  test('a plan section above a block is cut, the block stays', () => {
    const text = `Intro.\n\n## Implementation Plan\n\nold plan\n\n${SEALED}\n\n## Notes\n\nkept`;
    assert.equal(textWithoutPlan(text), `Intro.\n\n${SEALED}\n\n## Notes\n\nkept`);
  });

  test('no block: the plan section is cut as before; null reads as empty', () => {
    assert.equal(textWithoutPlan('Intro.\n\n## Implementation Plan\n\nold\n\n## After\n\nkept'), 'Intro.\n\n## After\n\nkept');
    assert.equal(textWithoutPlan(null), '');
  });

  // LIN-4527 residual: a plan heading inside a block is cut like any other, end line included, because the block is no
  // longer recognised. No production block holds one (0 of 160 sealed tickets on LIN-4527).
  test('a plan heading inside a block is cut with the block\'s end line (LIN-4527 residual, no production block holds one)', () => {
    const text = `## As asked\n\nPlease fix X.\n\n### Implementation Plan\n\nmy idea\n\n${ASKED_END}\n\n## Notes\n\nkept`;
    assert.equal(textWithoutPlan(text), `## As asked\n\nPlease fix X.\n\n## Notes\n\nkept`);
  });
});

describe('the brief\'s kept ticket section (formatIssueContext) carries the block', () => {
  test('the repro: the person\'s words and the end line survive', () => {
    const out = formatIssueContext({ identifier: 'LIN-1', title: 'T', description: REPRO, state: { name: 'Todo', type: 'unstarted' } }, {});
    assert.ok(out.includes('My idea: do Y.'), 'the words inside the block');
    assert.ok(out.includes(ASKED_END), 'the end line');
    assert.ok(out.includes('## Notes\n\nkept'));
  });

  test('a plan section below the block is not shown in the kept section', () => {
    const text = `${SEALED}\n\n## Implementation Plan\n\nstep-written plan\n\n## Notes\n\nkept`;
    const out = formatIssueContext({ identifier: 'LIN-1', title: 'T', description: text, state: { name: 'Todo', type: 'unstarted' } }, {});
    assert.ok(!out.includes('step-written plan'), 'the plan below the block is cut');
    assert.ok(out.includes('My idea: do Y.'));
  });
});

describe('the selector\'s own view (formatSelectorView) carries the block', () => {
  test('the repro: the words inside the block and the end line survive; a plan section below is cut', () => {
    const text = `${SEALED}\n\n## Implementation Plan\n\nstep-written plan\n\n## Notes\n\nkept`;
    const out = formatSelectorView({ identifier: 'LIN-1', title: 'T', description: text, state: { name: 'Todo', type: 'unstarted' } }, {});
    assert.ok(out.includes('My idea: do Y.'), 'the words inside the block');
    assert.ok(out.includes(ASKED_END), 'the end line');
    assert.ok(!out.includes('step-written plan'), 'the plan below the block is cut');
  });
});
