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
// Home/task selectors kept literal by name (ruling dispatch 4eeb6ac5, standing rule 2):
//  - .task-sentence-at: the sans sentence time, pinned at 0.85em by LIN-3991 and LIN-4009. Equals the --font-size-sm value.
//  - .page-header h1: the Home and task-page title, pinned at 1.5rem by LIN-4009 (its phone steps 1.3rem and 1.2rem keep
//    their own sizes, as the LIN-4009 test names them). Not body text, so the body-text rule does not reach it.
//  - .page-header__subtitle: the count line under the title, 0.9em. Shared with other pages, so it is kept, not mapped.
export const HOME_PIN_EXEMPT = Object.freeze(['.task-sentence-at', '.page-header h1', '.page-header__subtitle']);

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
  '.plain-page',
  '.plain-title',
  '.repo-picker-add-link',
  '.repo-picker-group-heading',
  '.repo-picker-truncated-note',
  '.section .section-header--ruled',
]);
// Shell chrome at a phone width (the header that the LIN-2191 and LIN-4009 tests lay out at 320px). The nav and its badges
// keep their original sizes, because the header's layout pins depend on them; the nav sets its own phone size (14px at
// 640px, 13px at 400px), so the body text beside it can stay at 16px. Exempt by name (ruling dispatch 4eeb6ac5, rule 2).
export const CHROME_EXEMPT = Object.freeze([
  '.nav-action', '.nav-label', '.nav-more-toggle', '.nav-option', '.nav-value', '.nav-view',
  '.queue-badge', '.rulings-badge', '.search-clear', '.search-input', '.search-no-results', '.wordmark-nav',
  '.nav-bar', '.toggle',
]);
const EXEMPT = new Set([...LIN4024_EXEMPT, ...HOME_PIN_EXEMPT, ...CHROME_EXEMPT]);
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

  test('the Home/task pin exemption is exactly the three named selectors, and each still has its rule', () => {
    assert.deepEqual([...HOME_PIN_EXEMPT], ['.task-sentence-at', '.page-header h1', '.page-header__subtitle']);
    assert.equal(appliedDecls(SHEETS, '.task-sentence-at').get('font-size'), '0.85em');
    assert.equal(appliedDecls(SHEETS, '.page-header h1').get('font-size'), '1.5rem');
    assert.equal(appliedDecls(SHEETS, '.page-header__subtitle').get('font-size'), '0.9em');
  });
});

// Every selector on the sheets Home and the task page load that may keep --font-structural (mono). Mono is for IDs and
// figures (LIN-4040 D7; LIN-4107 item 23). The entries are grouped by the reason mono is kept. Entries under "to review"
// were kept as they were because their names do not settle whether they show a fact; they are a list for the reviewer, not
// a decision. Listed by hand, so a new mono selector fails until it is added here with its reason.
export const MONO_ALLOWED = Object.freeze([
  // IDs and machine facts (the wordmark is the brand mark, kept mono as its pin in tests/unit/wordmark.test.js says)
  '.wordmark',
  '.task-ident',
  '.sess-v code',
  '.task-ref-ident',
  '.sess-ticket-ident',
  '.sess-ctx-ident',
  '.sess-run-id',
  '.sess-cred-token',
  '.task-share-url',
  '.context-node-id',
  '.footer-deploy',
  '.chat-tool-row',
  '.chat-tool-group',
  // figures
  '.tag__count',
  '.swipe-counter',
  '.sess-run-times',
  '.task-chat-saved-count',
  '.task-share-when',
  // code spans (literal text)
  '.comment-body code',
  '.issue-description .desc-full-content code',
  '.prompt-text code',
  '.prompt-text pre code',
  '.swipe-accordion-body code',
  '.swipe-prompt-text code',
  '.swipe-reasoning-content code',
  '.task-chat-warning code',
  '.task-edit-preview code',
  // glyphs (structural characters)
  '.nav-view-current::before',
  '.nav-more-toggle',
  '.search-clear',
  '.sess-run-toggle-icon',
  '.task-ref-glyph',
  // to review (kept mono, names do not settle it): card meta, a chat fold, key/value rows, a segment bar
  '.card-meta',
  '.chat-fold',
  '.sess-ctx-meta',
  '.sess-kv',
  '.swipe-blocking-issue',
  '.swipe-card-header',
  '.swipe-relation-issue',
  '.task-chat-saved-meta',
  '.segment-bar__cell',
  // other pages (not Home or the task page): left as they were
  '.landing-wordmark',
  '.error-details',
  '.obs-act-chip',
  '.repo-picker-slug',
  '.project[data-project-type="periodicals"] .periodical-mode',
  '.token-value',
  '.token-usage-hint code',
  '.decision-panel-figures',
  '.decision-panel-costs',
]);
const MONO_SET = new Set(MONO_ALLOWED);

describe('mono is only on the allowlisted selectors (LIN-4107 beat 2 corrective)', () => {
  const structural = new Set();
  for (const sheet of SHEETS) {
    for (const rule of sheet.rules) {
      for (const d of rule.decls) {
        if (d.prop === 'font-family' && /var\(--font-structural\)/.test(d.value)) {
          for (const s of rule.selectors) structural.add(s);
        }
      }
    }
  }

  test('every selector that sets the structural (mono) face is on the allowlist', () => {
    assert.deepEqual([...structural].filter((s) => !MONO_SET.has(s)), []);
  });

  test('every allowlisted selector still sets the structural face (a stale entry fails)', () => {
    assert.deepEqual(MONO_ALLOWED.filter((s) => !structural.has(s)), []);
  });
});

describe('the out-of-scope list cannot grow or go stale (LIN-4107)', () => {
  test('it has the fifteen selectors the ruling names, and each still has a rule in the sheets', () => {
    assert.equal(NON_HOME_TASK.length, 15);
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
