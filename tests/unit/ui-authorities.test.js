/**
 * LIN-3889 (Consolidate): each shared Settings UI decision has one authority in public/*.css
 * (docs/architecture/ui-pieces.md). These guards keep the losing copies from growing back: a
 * second key/value row, link, subtitle, text-control or group-title body, a `.line` override on
 * Settings, or a new breakpoint width. Witness: planting a second `.dispatch-section .line` body
 * turns the first test red.
 *
 * Run with: node --test tests/unit/ui-authorities.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const sheets = readdirSync(PUBLIC).filter(f => f.endsWith('.css')).sort();
const css = Object.fromEntries(sheets.map(f => [f, readFileSync(path.join(PUBLIC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]));

// Rule bodies, by selector, across every sheet (comments stripped).
const rulesFor = (selector) => {
  const found = [];
  for (const [file, text] of Object.entries(css)) {
    const re = new RegExp(`(^|[},\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'gm');
    if (re.test(text)) found.push(file);
  }
  return found;
};

describe('one authority per decision', () => {
  test('the key/value row is `.field`, and no per-section copy of it remains', () => {
    assert.deepEqual(rulesFor('.field'), ['style.css']);
    for (const sel of ['.dispatch-section .line', '.proxy-section .line', '.settings-section .line']) {
      assert.deepEqual(rulesFor(sel), [], `${sel} is a copy of .field`);
    }
  });

  test('the key/value row wraps on a phone in its one place', () => {
    assert.match(css['style.css'], /@media \(max-width: 640px\) \{\s*\.field \{\s*flex-wrap: wrap;/);
  });

  test('the link is one rule, in style.css', () => {
    assert.deepEqual(rulesFor('.settings-link'), ['style.css']);
  });

  test('the note is `.page-header__subtitle`; `.settings-subtitle` is gone', () => {
    assert.deepEqual(rulesFor('.settings-subtitle'), []);
    assert.deepEqual(rulesFor('.page-header__subtitle'), ['style.css']);
  });

  test('the text control is one body, shared by .model-select and .token-label-input', () => {
    assert.match(css['style.css'], /\.model-select,\s*\.token-label-input \{/);
    for (const other of sheets.filter(f => f !== 'style.css')) {
      // A phone rule that only sets min-width is an override, not a second body.
      assert.doesNotMatch(css[other], /\.(model-select|token-label-input)\s*\{[^}]*(border|padding|font-size)/, `${other} repeats the text control body`);
    }
  });

  test('the switch is `.settings-switch`; `.toggle-btn` and `.feature-toggle` are gone', () => {
    assert.deepEqual(rulesFor('.toggle-btn'), []);
    assert.deepEqual(rulesFor('.feature-toggle'), []);
    assert.deepEqual(rulesFor('.settings-switch'), ['settings.css']);
  });

  test('the dead token list has no rules left in common-actions.css', () => {
    for (const sel of ['.token-list', '.token-item', '.token-meta', '.token-info', '.token-label-text', '.token-revoke']) {
      assert.deepEqual(rulesFor(sel).filter(f => f === 'common-actions.css'), [], `${sel} has no emitter`);
    }
  });

  test('the group title on Audit is not repeated (.settings-header is no longer in audit.css)', () => {
    assert.deepEqual(rulesFor('.settings-header').filter(f => f === 'audit.css'), []);
  });
});

describe('the button decision: .btn is the authority, with tone variants', () => {
  test('.btn and its tone variants are defined in style.css', () => {
    for (const sel of ['.btn', '.btn--red', '.btn--teal']) assert.deepEqual(rulesFor(sel), ['style.css'], sel);
  });
});

describe('breakpoints are the written list', () => {
  test('the widths used in @media preludes are the 13 in ui-pieces.md', () => {
    const widths = new Set();
    for (const text of Object.values(css)) {
      for (const m of text.matchAll(/@media[^{]*\{/g)) {
        for (const w of m[0].matchAll(/(?:min|max)-width:\s*(\d+)px/g)) widths.add(Number(w[1]));
      }
    }
    assert.deepEqual([...widths].sort((a, b) => a - b), [400, 480, 560, 600, 640, 641, 720, 760, 900, 960, 1024, 1040, 1280]);
  });
});
