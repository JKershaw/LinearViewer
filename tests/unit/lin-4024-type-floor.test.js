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

// A written prompt's header on Home (the prompt name, its actions, "generated … · regenerate") drew 10-11px, below the
// floor, and the first-screen measure never reached it: it measures the opened task before a prompt is written. The
// sweep holds every absolute font-size in the sheet at 12px or more, so a new rule cannot slip under it either.
describe('no run-control rule sets an absolute font-size under 12px (LIN-4024)', () => {
  test('every px or rem font-size in run-control.css is at least 12px (rem at the 16px root)', () => {
    const below = [];
    for (const m of RUN_CONTROL.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const size = m[2].match(/font-size:\s*([0-9.]+)(px|rem)\s*;/);
      if (!size) continue;
      const px = size[2] === 'px' ? Number(size[1]) : Number(size[1]) * 16;
      if (px < 12) below.push(`${m[1].split('*/').pop().trim()} (${size[1]}${size[2]})`);
    }
    assert.deepEqual(below, []);
  });

  for (const selector of ['.prompt-section .swipe-prompt-header', '.swipe-prompt-actions button,\n.prompt-section .swipe-prompt-change', '.opened-task-generated', '.opened-task-regenerate']) {
    test(`${selector.replace('\n', ' ')} is 12px`, () => {
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
