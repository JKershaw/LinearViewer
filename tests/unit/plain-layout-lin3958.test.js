// LIN-3958: the Plain layout polish. The rules are CSS, so this reads public/style.css and
// public/styleguide.css as text: every Plain rule is scoped to .plain-page, the shared
// .section .section-header rule is byte-unchanged, and the 400px phone root is set. The layout itself
// (sizes, the bullet's gutter, the measure) is measured in tests/e2e/legal.spec.js, `Layout`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const style = readFileSync(new URL('../../public/style.css', import.meta.url), 'utf8');
const styleguide = readFileSync(new URL('../../public/styleguide.css', import.meta.url), 'utf8');

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The Plain block: from the .plain-page rule to the banner that opens the Recap section.
const plainBlock = () => {
  const start = style.indexOf('.plain-page {');
  const end = style.lastIndexOf('/* ====', style.indexOf('Recap Section (LIN-261)'));
  assert.ok(start > 0 && end > start, 'the Plain block sits between .plain-page and the Recap banner');
  return stripComments(style.slice(start, end));
};

// Each selector in a block, split on top-level commas (`:is(a, b)` keeps its own commas).
const selectors = (css) => [...css.matchAll(/([^{}]+)\{/g)]
  .map((m) => m[1].trim())
  .filter((s) => !s.startsWith('@'))
  .flatMap((s) => s.replace(/:is\([^)]*\)/g, ':is()').split(',').map((x) => x.trim()))
  .filter(Boolean);

test('every Plain selector is scoped to .plain-page (or the .plain-title it owns)', () => {
  const list = selectors(plainBlock());
  assert.ok(list.length > 0, 'the Plain block holds rules');
  for (const s of list) {
    assert.match(s, /^\.plain-(page|title)\b/, `unscoped Plain selector: ${s}`);
  }
});

test('the shared .section .section-header rule is byte-unchanged', () => {
  assert.ok(style.includes(`.section .section-header {
  font-family: var(--font-content);
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--fg);
  margin: 0 0 0.75rem 0;
}`), 'the shared heading rule must stay as it was at main');
});

test('the Plain root sets no face of its own, so /styleguide labels keep their faces', () => {
  const root = plainBlock().match(/\.plain-page \{([^}]*)\}/);
  assert.ok(root, 'the .plain-page root rule is in the block');
  assert.doesNotMatch(root[1], /font-family/);
});

test('the title is an explicit 1.5rem, the step above the heading', () => {
  assert.match(plainBlock(), /\.plain-title \{[^}]*font-size: 1\.5rem;/);
});

test('the heading steps up from the prose: --font-size-lg, weight 600, body colour, scoped to .plain-page', () => {
  assert.match(plainBlock(), /\.plain-page \.section \.section-header \{\s*font-size: var\(--font-size-lg\);\s*font-weight: 600;\s*color: var\(--fg\);\s*\}/);
});

test('unclassed paragraphs, list items, dd and dt are the sans face in --fg-dim; classed prose keeps its own look', () => {
  assert.match(plainBlock(), /\.plain-page \.section p:not\(\[class\]\),\s*\.plain-page \.section :is\(ul, ol\):not\(\[class\]\) > li,\s*\.plain-page \.section dl:not\(\[class\]\) > :is\(dd, dt\) \{\s*color: var\(--fg-dim\);\s*font-family: var\(--font-content\);\s*\}/);
});

test('lists take a 1.5rem gutter for the bullet (the --space-4 token), and classed lists keep their own padding', () => {
  assert.match(plainBlock(), /\.plain-page \.section :is\(ul, ol\):not\(\[class\]\) \{\s*padding-left: var\(--space-4\);\s*\}/);
});

test('running text (unclassed paragraphs, lists and definition lists) takes a 40em measure', () => {
  assert.match(plainBlock(), /\.plain-page \.section p:not\(\[class\]\),\s*\.plain-page \.section :is\(ul, ol, dl\):not\(\[class\]\) \{\s*max-width: 40em;\s*\}/);
});

test('at 400px the Plain page takes a 1rem root, the same root Settings uses', () => {
  const settings = readFileSync(new URL('../../public/settings.css', import.meta.url), 'utf8');
  assert.match(stripComments(style), /@media \(max-width: 400px\) \{\s*\.plain-page \{\s*font-size: 1rem;\s*\}\s*\}/);
  assert.match(stripComments(settings), /\.settings-shell \{\s*grid-template-columns: minmax\(0, 1fr\);\s*font-size: 1rem;\s*\}/);
});
