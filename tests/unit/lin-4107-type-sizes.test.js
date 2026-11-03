/**
 * LIN-4107 (UI round 3 · S5, type; LIN-4040 D7): the stylesheets Home and the task page load use about four font sizes,
 * all through the existing token set (LIN-4015); body text has no phone shrink; mono is only for IDs and figures.
 *
 * Witness: every font-size in the sheets the two pages load is a token (or `inherit`), with at most four distinct values;
 * no max-width media rule sets a font-size in those sheets; and --font-structural is not applied to the ruling options,
 * the in-progress count line or session names. Read through tests/helpers/css-rules.js, so a selector list merged or a
 * sheet reflowed does not change the result.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSheets, appliedDecls } from '../helpers/css-rules.js';

// The sheets Home (lib/render.js) and the task page (lib/render-task-page.js) load, de-duplicated, in load order.
const SHEET_NAMES = [
  '/style.css',
  '/common-actions.css',
  '/stage-track.css',
  '/run-control.css',
  '/session.css',
  '/swipe.css',
  '/chat.css',
  '/task-chat.css',
  '/task-page.css',
];
const SHEETS = readSheets(SHEET_NAMES);

const FONT_SIZE_TOKENS = new Set(['var(--font-size-sm)', 'var(--font-size-base)', 'var(--font-size-lg)']);

// Selectors whose literal font-size is pinned by LIN-4024 (tests/unit/lin-4024-type-floor.test.js): the 12px legibility
// floor on the opened task's run-control text, and the phone 0.75rem / desktop 0.9em on the Change summary and note.
// Ruled "exempt" for LIN-4107 (autopilot ruling, dispatch 481dbff7): LIN-4024's assertions stay as they are, and only these
// exact selectors are exempt from the token and no-phone-shrink checks. The list is pinned below so it cannot grow silently.
// Note: the 12px and 0.75rem values are a fifth visible size, separate from the four token-mapped sizes.
export const LIN4024_EXEMPT = Object.freeze([
  '.opened-task-run-quota',
  '.opened-task-setup',
  '.opened-task-setup-notice',
  '.opened-task-other-prompts-label',
  '.prompt-section .swipe-prompt-header',
  '.swipe-prompt-actions button',
  '.prompt-section .swipe-prompt-change',
  '.opened-task-generated',
  '.opened-task-regenerate',
  '.opened-task-change-summary',
  '.opened-task-change-note',
]);
// A Home/task pin outside LIN-4024: the sans sentence time, whose literal 0.85em is pinned by LIN-3991 and LIN-4009. It
// equals the --font-size-sm token's value, so it adds no size. Exempt by exact name (ruling dispatch 4eeb6ac5).
export const HOME_PIN_EXEMPT = Object.freeze(['.task-sentence-at']);

// Selectors outside Home and the task page (Plain, landing, error and login, the repo picker, the flight-companion and
// passage-planner prompts, the observation chip). Their rules are left exactly as they were, and the Home/task checks skip
// them (ruling dispatch 4eeb6ac5). Their existing pins stay as they are. Listed one selector per entry.
export const NON_HOME_TASK = Object.freeze([
  '.error-details',
  '.error-home-link',
  '.error-title',
  '.flight-companion-prompt',
  '.passage-planner-prompt',
  '.landing-ctas .landing-cta',
  '.landing-wordmark',
  '.login-button',
  '.obs-act-chip',
  '.page-header h1',
  '.page-header__subtitle',
  '.plain-page',
  '.plain-title',
  '.repo-picker-add-link',
  '.repo-picker-group-heading',
  '.repo-picker-truncated-note',
]);
const EXEMPT = new Set([...LIN4024_EXEMPT, ...HOME_PIN_EXEMPT]);
const OUT_OF_SCOPE = new Set(NON_HOME_TASK);

// A rule is skipped when one of its selectors is exempt or out of scope (a selector list is split on commas).
const isSkippedRule = (rule) => rule.selectors.some((s) => EXEMPT.has(s) || OUT_OF_SCOPE.has(s));

// Every declaration of `prop` across the sheets, with the rule it came from. Exempt rules are skipped.
function declsOf(prop) {
  const out = [];
  for (const sheet of SHEETS) {
    for (const rule of sheet.rules) {
      if (isSkippedRule(rule)) continue;
      for (const d of rule.decls) {
        if (d.prop === prop) out.push({ sheet: sheet.name, selectors: rule.selectors, media: rule.media, value: d.value });
      }
    }
  }
  return out;
}

describe('the type scale on Home and the task page (LIN-4107 D7)', () => {
  test('at most four distinct font-size values across the sheets both pages load', () => {
    const distinct = new Set(declsOf('font-size').map((d) => d.value));
    assert.ok(distinct.size <= 4, `expected at most 4 distinct font-size values, found ${distinct.size}: ${[...distinct].join(', ')}`);
  });

  test('every font-size is a token from the existing set, or inherit', () => {
    const literal = declsOf('font-size')
      .filter((d) => d.value !== 'inherit' && !FONT_SIZE_TOKENS.has(d.value))
      .map((d) => `${d.selectors.join(', ')} (${d.value}) in ${d.sheet}`);
    assert.deepEqual(literal, []);
  });
});

describe('no phone shrink on Home and the task page (LIN-4107 D7)', () => {
  test('no max-width media rule sets a font-size in the sheets both pages load', () => {
    const shrinks = declsOf('font-size')
      .filter((d) => d.media && /max-width/i.test(d.media))
      .map((d) => `${d.selectors.join(', ')} (${d.value}) under ${d.media} in ${d.sheet}`);
    assert.deepEqual(shrinks, []);
  });
});

describe('mono is only for IDs and figures (LIN-4107 D7)', () => {
  // Ruling options, the "N in progress" count line, the Sessions-fold count and session names. None is an ID or a figure
  // the reader checks against a tracker, so none takes --font-structural (LIN-4107 item 23).
  const NOT_MONO = [
    '.sess-qcard-options',
    '.sess-qcard-option',
    '.sess-task',
    '.in-progress-count__part',
    '.opened-task-fold-count',
  ];

  for (const selector of NOT_MONO) {
    test(`${selector} does not use the structural (mono) face`, () => {
      let decls;
      try {
        decls = appliedDecls(SHEETS, selector);
      } catch {
        return; // the selector has no rule in these sheets, so it cannot take the mono face
      }
      const family = decls.get('font-family') || '';
      assert.ok(!/var\(--font-structural\)/.test(family), `${selector} font-family is ${family}`);
    });
  }
});

describe('the LIN-4024 exemption list cannot grow or go stale (LIN-4107)', () => {
  // The selectors LIN-4024's tests pin (tests/unit/lin-4024-type-floor.test.js), written out again on purpose: a change to
  // the exemption has to change this list too, and a review sees both.
  const PINNED_BY_LIN_4024 = [
    '.opened-task-run-quota',
    '.opened-task-setup',
    '.opened-task-setup-notice',
    '.opened-task-other-prompts-label',
    '.prompt-section .swipe-prompt-header',
    '.swipe-prompt-actions button',
    '.prompt-section .swipe-prompt-change',
    '.opened-task-generated',
    '.opened-task-regenerate',
    '.opened-task-change-summary',
    '.opened-task-change-note',
  ];

  test('the exemption list names exactly the selectors LIN-4024 pins', () => {
    assert.deepEqual([...LIN4024_EXEMPT].sort(), [...PINNED_BY_LIN_4024].sort());
  });

  test('every exempt selector still has a rule in the sheets both pages load (an absent one fails)', () => {
    const missing = LIN4024_EXEMPT.filter((selector) => {
      try {
        appliedDecls(SHEETS, selector);
        return false;
      } catch {
        return true;
      }
    });
    assert.deepEqual(missing, []);
  });

  test('the Home/task pin exemption is exactly the sentence-time selector, and it still has its rule', () => {
    assert.deepEqual([...HOME_PIN_EXEMPT], ['.task-sentence-at']);
    assert.equal(appliedDecls(SHEETS, '.task-sentence-at').get('font-size'), '0.85em');
  });
});

describe('the out-of-scope list cannot grow or go stale (LIN-4107)', () => {
  test('it has the sixteen selectors the ruling names, and each still has a rule in the sheets', () => {
    assert.equal(NON_HOME_TASK.length, 16);
    const missing = NON_HOME_TASK.filter((selector) => {
      try {
        appliedDecls(SHEETS, selector);
        return false;
      } catch {
        return true;
      }
    });
    assert.deepEqual(missing, []);
  });
});
