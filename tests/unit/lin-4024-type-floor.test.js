/**
 * LIN-4024 look: the opened task's text runs stay at the 12px floor. The seeded E2E measures the rendered first screen;
 * these pin the rules a Change sheet or a run-control state uses, which that measure does not reach.
 *
 * Witness: each rule's font-size is read from its stylesheet and held at 12px or more. Before the change the run-quota,
 * setup, setup-notice and other-prompts-label rules were 11px, and the phone Change summary and note were 0.9em (about 11.7px).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_CONTROL = readFileSync(join(__dirname, '../../public/run-control.css'), 'utf8');
const STYLE = readFileSync(join(__dirname, '../../public/style.css'), 'utf8');

// The body of a top-level rule whose selector list is exactly `selector` (not a longer selector that contains it).
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `${selector} is a top-level rule`);
  return match[1];
}

function fontSizeOf(body) {
  const match = body.match(/font-size:\s*([^;]+);/);
  assert.ok(match, 'the rule sets a font-size');
  return match[1].trim();
}

describe('opened-task run-control text runs (LIN-4024)', () => {
  for (const selector of ['.opened-task-run-quota', '.opened-task-setup', '.opened-task-setup-notice', '.opened-task-other-prompts-label']) {
    test(`${selector} is 12px, not below the floor`, () => {
      assert.equal(fontSizeOf(ruleBody(RUN_CONTROL, selector)), '12px');
    });
  }
});

describe('the Change sheet summary and note on a phone (LIN-4024)', () => {
  test('the desktop size is unchanged (0.9em)', () => {
    assert.equal(fontSizeOf(ruleBody(STYLE, '.opened-task-change-summary,\n.opened-task-change-note')), '0.9em');
  });

  test('inside the phone block they are 0.75rem (12px at the root size), which the body rule does not shrink', () => {
    const phone = STYLE.match(/@media \(max-width: 640px\) \{\n  \.opened-task-change-summary,\n  \.opened-task-change-note \{\n    font-size: ([^;]+);/);
    assert.ok(phone, 'the phone media block sets the summary and note size');
    assert.equal(phone[1].trim(), '0.75rem');
  });
});
