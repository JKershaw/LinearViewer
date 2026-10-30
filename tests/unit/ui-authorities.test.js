/**
 * LIN-3889 (Consolidate): each shared Settings UI decision has one authority in public/*.css
 * (docs/architecture/ui-pieces.md). These guards keep the losing copies from growing back: a
 * second key/value row, link, subtitle, text-control or group-title body, a `.line` override on
 * Settings, or a new breakpoint width. Witness: planting a second `.dispatch-section .line` body
 * turns the first test red.
 *
 * Which sheet holds a selector is read through tests/helpers/css-rules.js (LIN-4015), so a selector
 * list merged or reflowed in a sheet does not move the answer.
 *
 * Run with: node --test tests/unit/ui-authorities.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readSheets, declOf, normalizeSelector } from '../helpers/css-rules.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const sheetNames = readdirSync(PUBLIC).filter(f => f.endsWith('.css')).sort().map(f => `/${f}`);
const sheets = readSheets(sheetNames);

// The sheets that hold a rule for `selector`, in page-name order.
const rulesIn = (selector) => sheets.filter(sheet => sheet.rules.some(rule => rule.selectors.includes(normalizeSelector(selector))))
  .map(sheet => sheet.name.slice(1));

// True when one rule in the sheet names both selectors, so they share a body rather than two copies of it.
const sharedRule = (sheetName, a, b) => sheets.find(sheet => sheet.name === sheetName)
  .rules.some(rule => rule.selectors.includes(normalizeSelector(a)) && rule.selectors.includes(normalizeSelector(b)));

describe('one authority per decision', () => {
  test('the key/value row is `.field`, and no per-section copy of it remains', () => {
    assert.deepEqual(rulesIn('.field'), ['style.css']);
    for (const sel of ['.dispatch-section .line', '.proxy-section .line', '.settings-section .line']) {
      assert.deepEqual(rulesIn(sel), [], `${sel} is a copy of .field`);
    }
  });

  test('the key/value row wraps on a phone in its one place', () => {
    assert.equal(declOf(readSheets(['/style.css']), '.field', 'flex-wrap', { media: '(max-width: 640px)' }), 'wrap');
  });

  test('the link is one rule, in style.css', () => {
    assert.deepEqual(rulesIn('.settings-link'), ['style.css']);
  });

  test('the note is `.page-header__subtitle`; `.settings-subtitle` is gone', () => {
    assert.deepEqual(rulesIn('.settings-subtitle'), []);
    assert.deepEqual(rulesIn('.page-header__subtitle'), ['style.css']);
  });

  test('the text control is one body, in style.css, and no other sheet repeats its border, padding or font-size', () => {
    const bodySetters = (sheet) => sheet.rules
      .filter(rule => rule.selectors.includes('.token-label-input') && rule.media === null)
      .flatMap(rule => rule.decls.map(d => d.prop))
      .filter(prop => /^(border|padding|font-size)/.test(prop));
    assert.ok(bodySetters(sheets.find(s => s.name === '/style.css')).length > 0, 'style.css sets the text control body');
    for (const other of sheets.filter(s => s.name !== '/style.css')) {
      // A phone rule that only sets min-width is an override, not a second body.
      assert.deepEqual(bodySetters(other), [], `${other.name} repeats the text control body`);
    }
  });

  test('the switch is `.settings-switch`; `.toggle-btn` and `.feature-toggle` are gone', () => {
    assert.deepEqual(rulesIn('.toggle-btn'), []);
    assert.deepEqual(rulesIn('.feature-toggle'), []);
    assert.deepEqual(rulesIn('.settings-switch'), ['settings.css']);
  });

  test('the dead token list has no rules left in common-actions.css', () => {
    for (const sel of ['.token-list', '.token-item', '.token-meta', '.token-info', '.token-label-text', '.token-revoke']) {
      assert.deepEqual(rulesIn(sel).filter(f => f === 'common-actions.css'), [], `${sel} has no emitter`);
    }
  });

  test('the group title on Audit is not repeated (.settings-header is no longer in audit.css)', () => {
    assert.deepEqual(rulesIn('.settings-header').filter(f => f === 'audit.css'), []);
  });
});

describe('the button decision: .btn is the authority, with tone variants', () => {
  test('.btn and its tone variants are defined in style.css', () => {
    // `.btn--teal` is retired (LIN-3890): the ask's teal confirm is `.btn--primary`.
    for (const sel of ['.btn', '.btn--red', '.btn--quiet']) assert.deepEqual(rulesIn(sel), ['style.css'], sel);
    // `.action-btn` is the alias body; flight-companion.css has a contextual override (`.fc-chat-composer .action-btn`), which is not a copy.
    assert.ok(sharedRule('/style.css', '.action-btn', '.btn--quiet'), 'the quiet body is one selector list in style.css');
  });

  test('each `.action-btn` alias shares its canonical tone\'s rule body (one selector list, one body)', () => {
    for (const [alias, tone] of [['.action-btn.save', '.btn--green'], ['.action-btn.connect', '.btn--blue'], ['.action-btn.disconnect', '.btn--red']]) {
      assert.ok(sharedRule('/style.css', alias, tone), `${alias} and ${tone} share one body`);
    }
  });

  test('the rest of the button family is in common-actions.css: none (the token and modal rules stay)', () => {
    assert.deepEqual(rulesIn('.action-btn').filter(f => f === 'common-actions.css'), []);
  });
});

describe('breakpoints are the written list', () => {
  test('the widths used in @media preludes are the 14 in ui-pieces.md', () => {
    const widths = new Set();
    for (const sheet of sheets) {
      for (const rule of sheet.rules) {
        for (const w of (rule.media || '').matchAll(/(?:min|max)-width:(\d+)px/g)) widths.add(Number(w[1]));
      }
    }
    // 360 is the LIN-4009 phone lever (.wordmark-accent hides below it so the nav line fits at 320px).
    assert.deepEqual([...widths].sort((a, b) => a - b), [360, 400, 480, 560, 600, 640, 641, 720, 760, 900, 960, 1024, 1040, 1280]);
  });
});
