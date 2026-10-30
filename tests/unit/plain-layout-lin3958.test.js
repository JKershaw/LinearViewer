// LIN-3958: the Plain layout polish. The rules are CSS, so this asks public/style.css what applies to each Plain selector:
// every Plain rule is scoped to .plain-page, the shared .section .section-header rule keeps its declarations, and the
// 400px phone root is set. The layout itself (sizes, the bullet's gutter, the measure) is measured in
// tests/e2e/legal.spec.js, `Layout`. Rules are read through tests/helpers/css-rules.js (LIN-4015), so a merged selector
// list or a reformat does not change the answer; a colour token may be the semantic name or its raw alias.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSheets, appliedDecls, declOf } from '../helpers/css-rules.js';

const STYLE = readSheets(['/style.css']);
const SETTINGS = readSheets(['/style.css', '/settings.css']);

// The Plain block's rules: those whose first selector opens with .plain-.
const plainRules = STYLE.flatMap((sheet) => sheet.rules).filter((rule) => rule.selectors[0].startsWith('.plain-'));

// A colour may be the semantic token or the raw alias it maps to (LIN-4015 moved the uses to the semantic names).
const oneOf = (value, names) => assert.ok(names.includes(value), `${value} is one of ${names.join(', ')}`);

test('every Plain selector is scoped to .plain-page (or the .plain-title it owns)', () => {
  assert.ok(plainRules.length > 0, 'the Plain block holds rules');
  for (const rule of plainRules) {
    for (const s of rule.selectors) {
      assert.match(s, /^\.plain-(page|title)\b/, `unscoped Plain selector: ${s}`);
    }
  }
});

test('the shared .section .section-header rule keeps the declarations it had at main', () => {
  const applied = appliedDecls(STYLE, '.section .section-header');
  assert.equal(applied.get('font-family'), 'var(--font-content)');
  assert.equal(applied.get('font-size'), 'var(--font-size-base)');
  assert.equal(applied.get('font-weight'), '500');
  oneOf(applied.get('color'), ['var(--fg)', 'var(--text)']);
  assert.equal(applied.get('margin'), '0 0 0.75rem 0');
});

test('the Plain root sets no face of its own, so /styleguide labels keep their faces', () => {
  assert.equal(appliedDecls(STYLE, '.plain-page').has('font-family'), false);
});

test('the title is an explicit 1.5rem, the step above the heading', () => {
  assert.equal(declOf(STYLE, '.plain-title', 'font-size'), '1.5rem');
});

test('the heading steps up from the prose: --font-size-lg, weight 600, body colour, direct children of .plain-page only', () => {
  const heading = appliedDecls(STYLE, '.plain-page > .section > .section-header');
  assert.equal(heading.get('font-size'), 'var(--font-size-lg)');
  assert.equal(heading.get('font-weight'), '600');
  oneOf(heading.get('color'), ['var(--fg)', 'var(--text)']);
});

test('unclassed paragraphs, list items, dd and dt are the sans face in --fg-dim; classed prose keeps its own look', () => {
  for (const selector of ['.plain-page .section p:not([class])', '.plain-page .section :is(ul, ol):not([class]) > li', '.plain-page .section dl:not([class]) > :is(dd, dt)']) {
    const applied = appliedDecls(STYLE, selector);
    oneOf(applied.get('color'), ['var(--fg-dim)', 'var(--muted)']);
    assert.equal(applied.get('font-family'), 'var(--font-content)', selector);
  }
});

test('lists take a 1.5rem gutter for the bullet (the --space-4 token), and classed lists keep their own padding', () => {
  assert.equal(declOf(STYLE, '.plain-page .section :is(ul, ol):not([class])', 'padding-left'), 'var(--space-4)');
});

test('running text (unclassed paragraphs, lists and definition lists) takes a 40em measure', () => {
  assert.equal(declOf(STYLE, '.plain-page .section p:not([class])', 'max-width'), '40em');
  assert.equal(declOf(STYLE, '.plain-page .section :is(ul, ol, dl):not([class])', 'max-width'), '40em');
});

test('at 400px the Plain page takes a 1rem root, the same root Settings uses', () => {
  assert.equal(declOf(STYLE, '.plain-page', 'font-size', { media: '(max-width: 400px)' }), '1rem');
  assert.equal(declOf(SETTINGS, '.settings-shell', 'font-size', { media: '(max-width: 760px)' }), '1rem');
  assert.equal(declOf(SETTINGS, '.settings-shell', 'grid-template-columns', { media: '(max-width: 760px)' }), 'minmax(0, 1fr)');
});
