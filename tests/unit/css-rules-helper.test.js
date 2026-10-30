/**
 * The stylesheet helper the CSS pins read through (tests/helpers/css-rules.js, LIN-4015). These check the helper itself,
 * so a pin converted to it cannot go vacuous: an absent selector throws, and formatting does not change what applies.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseSheet, appliedDecls, declOf, rulesFor, readSheets } from '../helpers/css-rules.js';

describe('css-rules: parsing', () => {
  test('selector lists are split and compared whitespace-insensitively, so a reflow does not change what applies', () => {
    const a = parseSheet('.x,\n  .y > .z {\n  color: red;\n}');
    const b = parseSheet('.x,.y>.z{color:red}');
    assert.deepEqual(rulesFor([a], '.y > .z').map((r) => r.decls), rulesFor([b], '.y>.z').map((r) => r.decls));
    assert.equal(rulesFor([a], '.x').length, 1);
  });

  test('media is recorded on each rule, and an unconditional rule has none', () => {
    const s = parseSheet('.a { top: 0 } @media (max-width: 640px) { .a { top: 1px } }');
    assert.deepEqual(rulesFor([s], '.a', { media: 'any' }).map((r) => r.media), [null, '(max-width:640px)']);
    assert.equal(rulesFor([s], '.a').length, 1, 'the default query reads only unconditional rules');
    assert.equal(rulesFor([s], '.a', { media: '(max-width: 640px)' }).length, 1);
  });

  test('at-rules that are not style rules (@font-face, @keyframes) contribute no selectors', () => {
    const s = parseSheet('@font-face { font-family: X; src: url("a;b.woff2") } @keyframes spin { from { top: 0 } to { top: 1px } } .a { top: 2px }');
    assert.equal(s.rules.length, 1);
    assert.equal(declOf([s], '.a', 'top'), '2px');
  });

  test('a semicolon inside a url() does not split a declaration', () => {
    const s = parseSheet('.a { background: url(data:image/png;base64,AA); color: red }');
    assert.equal(declOf([s], '.a', 'background'), 'url(data:image/png;base64,AA)');
  });

  test('!important beats a later plain declaration for the same property', () => {
    const s = parseSheet('.a { color: red !important } .a { color: blue }');
    assert.equal(declOf([s], '.a', 'color'), 'red');
  });
});

describe('css-rules: what applies, in page order', () => {
  test('a later sheet in the page order wins for the same property', () => {
    const first = parseSheet('.a { font-size: 11px; top: 0 }', '/style.css');
    const second = parseSheet('.a { font-size: 12px }', '/run-control.css');
    const applied = appliedDecls([first, second], '.a');
    assert.equal(applied.get('font-size'), '12px');
    assert.equal(applied.get('top'), '0');
  });

  test('a rule for another selector is not read for this one', () => {
    const s = parseSheet('.a-b { font-size: 9px } .a { color: red }');
    assert.equal(rulesFor([s], '.a').length, 1);
    assert.throws(() => declOf([s], '.a', 'font-size'), /sets no font-size/);
  });

  test('a selector with no rule throws, so a pin cannot pass on an absent selector', () => {
    const s = parseSheet('.a { color: red }');
    assert.throws(() => appliedDecls([s], '.missing'), /no rule for "\.missing"/);
  });

  test('a media-only rule does not apply to the unconditional query', () => {
    const s = parseSheet('@media (max-width: 640px) { .a { font-size: 12px } }');
    assert.throws(() => declOf([s], '.a', 'font-size'), /no rule/);
    assert.equal(declOf([s], '.a', 'font-size', { media: '(max-width: 640px)' }), '12px');
  });
});

describe('css-rules: the real sheets', () => {
  test('readSheets parses a shipped sheet in order and finds a known rule', () => {
    const [style] = readSheets(['/style.css']);
    assert.equal(style.name, '/style.css');
    assert.ok(style.rules.length > 700, 'style.css has over seven hundred style rules');
    assert.ok(declOf([style], '.opened-task-change-summary', 'font-size', { media: '(max-width: 640px)' }));
  });
});
