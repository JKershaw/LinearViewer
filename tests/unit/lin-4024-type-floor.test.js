/**
 * LIN-4024 look: the opened task's text runs stay at the 12px floor. The seeded E2E measures the rendered first screen;
 * these pin the rules a Change sheet or a run-control state uses, which that measure does not reach.
 *
 * Witness: each rule's font-size is read from its stylesheet and held at 12px or more. Before the change the run-quota,
 * setup, setup-notice and other-prompts-label rules were 11px, and the phone Change summary and note were 0.9em (about 11.7px).
 * The rules are read through tests/helpers/css-rules.js (LIN-4015), so a selector list merged or reflowed stays green.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSheets, declOf } from '../helpers/css-rules.js';

const HOME_RUN_CONTROL = readSheets(['/style.css', '/run-control.css']);
const STYLE = readSheets(['/style.css']);
const RUN_CONTROL_ONLY = readSheets(['/run-control.css'])[0];

const fontSizeOf = (sheets, selector, options) => declOf(sheets, selector, 'font-size', options);

describe('opened-task run-control text runs (LIN-4024)', () => {
  for (const selector of ['.opened-task-run-quota', '.opened-task-setup', '.opened-task-setup-notice', '.opened-task-other-prompts-label']) {
    test(`${selector} is 12px, not below the floor`, () => {
      assert.equal(fontSizeOf(HOME_RUN_CONTROL, selector), '12px');
    });
  }
});

// A written prompt's header on Home (the prompt name, its actions, "generated … · regenerate") drew 10-11px, below the
// floor, and the first-screen measure never reached it: it measures the opened task before a prompt is written. The
// sweep holds every absolute font-size in the sheet at 12px or more, so a new rule cannot slip under it either.
describe('no run-control rule sets an absolute font-size under 12px (LIN-4024)', () => {
  test('every px or rem font-size in run-control.css is at least 12px (rem at the 16px root)', () => {
    const below = [];
    for (const rule of RUN_CONTROL_ONLY.rules) {
      for (const d of rule.decls) {
        if (d.prop !== 'font-size') continue;
        const size = d.value.match(/^([0-9.]+)(px|rem)$/);
        if (!size) continue;
        const px = size[2] === 'px' ? Number(size[1]) : Number(size[1]) * 16;
        if (px < 12) below.push(`${rule.selectors.join(', ')} (${d.value})`);
      }
    }
    assert.deepEqual(below, []);
  });

  for (const selector of ['.prompt-section .swipe-prompt-header', '.swipe-prompt-actions button', '.prompt-section .swipe-prompt-change', '.opened-task-generated', '.opened-task-regenerate']) {
    test(`${selector} is 12px`, () => {
      assert.equal(fontSizeOf(HOME_RUN_CONTROL, selector), '12px');
    });
  }
});

describe('the Change sheet summary and note on a phone (LIN-4024)', () => {
  test('the desktop size is unchanged (0.9em)', () => {
    assert.equal(fontSizeOf(STYLE, '.opened-task-change-summary'), '0.9em');
    assert.equal(fontSizeOf(STYLE, '.opened-task-change-note'), '0.9em');
  });

  test('inside the phone block they are 0.75rem (12px at the root size), which the body rule does not shrink', () => {
    for (const selector of ['.opened-task-change-summary', '.opened-task-change-note']) {
      assert.equal(fontSizeOf(STYLE, selector, { media: '(max-width: 640px)' }), '0.75rem');
    }
  });
});
