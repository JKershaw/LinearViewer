// Pure-core tests for css-measures.mjs. Outside the tests/unit and scripts/code-shape globs on
// purpose, so it never joins `npm test`. Run: node --test tests/measures/css-measures.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { measureCss, dupBlocks, spacingSites, stripComments } from './css-measures.mjs';

const m = (css) => measureCss({ 'public/a.css': css });

test('spacing: literal, token and both are counted per declaration', () => {
  const r = m(`.a { padding: 4px 8px; margin: var(--space-2); gap: calc(var(--space-1) + 2px); margin-top: 0; }`).spacing;
  assert.deepEqual(r, { declarations: 4, literal: 2, literalExCh: 2, token: 2, both: 1 });
});

test('spacing: var() fallbacks are removed before looking for a literal; zero is not literal', () => {
  const r = m(`.a { padding: var(--x, 12px); margin: 0px; padding-left: 0.5rem; }`).spacing;
  assert.equal(r.literal, 1);
});

test('spacing: ch-only lengths count as literal but not literalExCh; scroll-padding is not spacing', () => {
  const r = m(`.a { padding: 2ch; scroll-padding-top: 9px; }`).spacing;
  assert.equal(r.declarations, 1);
  assert.equal(r.literal, 1);
  assert.equal(r.literalExCh, 0);
});

test('comments are ignored', () => {
  const r = m(`/* padding: 9px; font-size: 1px */ .a { font-size: 1rem; }`);
  assert.equal(r.spacing.declarations, 0);
  assert.equal(r.fontSize.declarations, 1);
  assert.equal(stripComments('a\n/* x\ny */b'), 'a\n\nb');
});

test('font sizes: distinct trimmed values; tokens listed', () => {
  const r = m(`:root { --font-size-sm: 12px; } .a { font-size: 1rem; } .b { font-size:  1rem } .c { font-size: var(--font-size-sm); }`).fontSize;
  assert.equal(r.declarations, 4 - 1);
  assert.equal(r.distinct, 2);
  assert.deepEqual(r.tokens, ['--font-size-sm']);
});

test('button classes: distinct class names containing btn or button in selectors only', () => {
  const r = m(`.btn, .btn--primary:hover, .x .action-btn { color: red; } .btn { top: 0; } .plain { color: blue; } @media (max-width: 1px) { .submit-button { top: 0 } }`).buttonClasses;
  assert.deepEqual(r.names, ['action-btn', 'btn', 'btn--primary', 'submit-button']);
});

test('breakpoints: distinct px widths from @media preludes, with per-file counts', () => {
  const r = measureCss({
    'public/a.css': '@media (max-width: 640px) { .a { top: 0 } } @media (min-width: 641px) and (max-width: 900px) { .a { top: 0 } }',
    'public/b.css': '@media (max-width: 640px) { .b { top: 0 } } @media (prefers-color-scheme: dark) { .b { top: 0 } }',
  }).breakpoints;
  assert.equal(r.distinct, 3);
  assert.equal(r.widths[640].total, 2);
  assert.deepEqual(r.widths[640].files, { 'public/a.css': 1, 'public/b.css': 1 });
});

test('lines: counts newlines per file', () => {
  const r = measureCss({ 'public/a.css': 'a\nb\n', 'public/b.css': 'x\n' }).cssLines;
  assert.equal(r.total, 3);
  assert.equal(r.files, 2);
});

test('dupBlocks: 4+ declaration bodies repeated byte-identically across files only', () => {
  const body = 'a: 1; b: 2; c: 3; d: 4';
  const r = dupBlocks({
    'public/a.css': `.x { ${body} }\n.y { ${body} }`,
    'public/b.css': `.z { ${body} }\n.small { a: 1; b: 2 }`,
    'public/c.css': `.small2 { a: 1; b: 2 }`,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].sites.length, 3);
  assert.deepEqual(r[0].sites.map((s) => [s.file, s.line, s.selector]), [['public/a.css', 1, '.x'], ['public/a.css', 2, '.y'], ['public/b.css', 1, '.z']]);
  assert.deepEqual(dupBlocks({ 'public/a.css': `.x { ${body} } .y { ${body} }` }), []);
});

test('spacingSites: lists exactly the literal declarations, with their line', () => {
  const sites = spacingSites({ 'public/a.css': '.a {\n  padding: 4px;\n  margin: var(--space-1);\n  gap: 0;\n}\n/* x */\n.b { margin-left: 1rem }' });
  assert.deepEqual(sites.map((s) => [s.file, s.line, s.prop, s.value]), [['public/a.css', 2, 'padding', '4px'], ['public/a.css', 7, 'margin-left', '1rem']]);
  assert.equal(sites.length, measureCss({ 'public/a.css': '.a {\n  padding: 4px;\n  margin: var(--space-1);\n  gap: 0;\n}\n/* x */\n.b { margin-left: 1rem }' }).spacing.literal);
});
