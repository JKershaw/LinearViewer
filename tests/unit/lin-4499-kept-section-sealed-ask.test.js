/**
 * LIN-4499 close-out (finding-1236e238): the kept ticket section leaves the description's OLD plan section out, but never
 * cuts inside a legacy sealed `## As asked` block: the person's words, whatever headings they hold, and the block's end
 * line are kept byte for byte. A plan section above or below the block is still cut.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatIssueContext, formatSelectorView } from '../../lib/openrouter.js';
import { descriptionWithoutPlan } from '../../lib/asked-of.js';
import { ASKED_END } from '../../lib/brief-quote.js';

const SEALED = `## As asked\n\nPlease fix X.\n\n### Implementation Plan\n\nmy idea: do Y\n\n${ASKED_END}`;
const REPRO = `${SEALED}\n\n## Notes\n\nkept`;

describe('descriptionWithoutPlan keeps a legacy sealed block whole', () => {
  test('a plan heading inside the block, with notes below: the block (heading, words, end line) is untouched', () => {
    assert.equal(descriptionWithoutPlan(REPRO), REPRO);
  });

  test('a plan section below the block is still cut, the block stays', () => {
    const text = `${SEALED}\n\n## Implementation Plan\n\nstep-written plan\n\n## Notes\n\nkept`;
    assert.equal(descriptionWithoutPlan(text), REPRO);
  });

  test('a plan section above the block is cut, the block stays', () => {
    const text = `Intro.\n\n## Implementation Plan\n\nold plan\n\n${SEALED}\n\n## Notes\n\nkept`;
    assert.equal(descriptionWithoutPlan(text), `Intro.\n\n${SEALED}\n\n## Notes\n\nkept`);
  });

  test('a block with nothing around it comes back whole', () => {
    assert.equal(descriptionWithoutPlan(SEALED), SEALED);
  });

  test('no block: the plan section is cut as before; null reads as empty', () => {
    assert.equal(descriptionWithoutPlan('Intro.\n\n## Implementation Plan\n\nold\n\n## After\n\nkept'), 'Intro.\n\n## After\n\nkept');
    assert.equal(descriptionWithoutPlan(null), '');
  });

  test('a Jira-read end line (_…_) keeps its block too', () => {
    const jiraEnd = `_${ASKED_END.slice(1, -1)}_`;
    const text = `## As asked\n\nPlease fix X.\n\n### Implementation Plan\n\nmy idea\n\n${jiraEnd}\n\n## Notes\n\nkept`;
    assert.equal(descriptionWithoutPlan(text), text);
  });
});

describe('the brief\'s kept ticket section (formatIssueContext) carries the block', () => {
  test('the repro: the person\'s words after the heading and the end line survive', () => {
    const out = formatIssueContext({ identifier: 'LIN-1', title: 'T', description: REPRO, state: { name: 'Todo', type: 'unstarted' } }, {});
    assert.ok(out.includes('### Implementation Plan\n\nmy idea: do Y'), 'the words inside the block');
    assert.ok(out.includes(ASKED_END), 'the end line');
    assert.ok(out.includes('## Notes\n\nkept'));
  });
});

describe('the selector\'s own view (formatSelectorView) carries the block', () => {
  test('the repro: the words inside the block and the end line survive; a plan section below is cut', () => {
    const text = `${SEALED}\n\n## Implementation Plan\n\nstep-written plan\n\n## Notes\n\nkept`;
    const out = formatSelectorView({ identifier: 'LIN-1', title: 'T', description: text, state: { name: 'Todo', type: 'unstarted' } }, {});
    assert.ok(out.includes('### Implementation Plan\n\nmy idea: do Y'), 'the words inside the block');
    assert.ok(out.includes(ASKED_END), 'the end line');
    assert.ok(!out.includes('step-written plan'), 'the plan below the block is cut');
  });
});
