/**
 * The cascade tool the CSS shrink is checked with (tests/measures/css-cascade.mjs, LIN-4015). A merge that moves a rule
 * earlier in the cascade can let a different rule of the same specificity win on one element, and the equivalence diff
 * cannot see that; `flippedPairs` is the half that can. These pin that it does, so LIN-4017 can lean on it, and that every
 * page's stylesheet list starts with /style.css (the dead-fallback deletions rest on it).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flippedPairs, pageLists, propFamily, stylesheetLists } from '../measures/css-cascade.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const scratch = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'css-cascade-'));
  scratch.push(dir);
  return dir;
}
test.after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// A root holding only `public/<name>` files, for the fixtures that need no renderers.
function sheetsRoot(files) {
  const dir = tempRoot();
  mkdirSync(join(dir, 'public'));
  for (const [name, css] of Object.entries(files)) writeFileSync(join(dir, 'public', name), css);
  return dir;
}

const pairOf = (pairs, a, b) => pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

describe('css-cascade: interference (flippedPairs)', () => {
  test('moving the collective input/select rule ahead of .collective-char-repo is flagged', () => {
    const lists = ['/style.css', '/common-actions.css', '/chat.css', '/collective.css'];
    const moved = tempRoot();
    cpSync(join(ROOT, 'public'), join(moved, 'public'), { recursive: true });
    const collective = readFileSync(join(moved, 'public/collective.css'), 'utf8');
    const block = collective.match(/^\.collective-input,\n\.collective-select \{[^}]*\}\n\n?/m);
    assert.ok(block, 'fixture source: public/collective.css has no `.collective-input, .collective-select` rule; update this test');
    writeFileSync(join(moved, 'public/collective.css'), collective.replace(block[0], ''));
    const common = readFileSync(join(moved, 'public/common-actions.css'), 'utf8');
    writeFileSync(join(moved, 'public/common-actions.css'), `${common}\n${block[0]}`);

    const hit = pairOf(flippedPairs(ROOT, moved, lists), '.collective-select', '.collective-char-repo');
    assert.ok(hit, 'the one <select> carrying both classes now takes .collective-char-repo, and the move must be reported');
    assert.ok(hit.shared.includes('font') && hit.shared.includes('color'), `shared families: ${hit.shared}`);
    assert.deepEqual(flippedPairs(ROOT, ROOT, lists), [], 'a tree compared with itself flips nothing');
  });

  test('a shorthand and a longhand of one family count as shared (border vs border-color)', () => {
    const base = sheetsRoot({ 'style.css': '.a { border-color: red } .b { border: 1px solid blue }' });
    const head = sheetsRoot({ 'style.css': '.b { border: 1px solid blue } .a { border-color: red }' });
    // Matching by exact property name finds nothing shared here; by family, `.b`'s border now loses to `.a`'s colour.
    const hit = pairOf(flippedPairs(base, head, ['/style.css']), '.a', '.b');
    assert.ok(hit, 'border and border-color are one family');
    assert.deepEqual(hit.shared, ['border']);
  });

  test('a selector that appears in two rules is still paired, by its last occurrence', () => {
    const base = sheetsRoot({ 'style.css': '.b { margin: 1px } .a { margin: 0 } .a { margin: 2px }' });
    const head = sheetsRoot({ 'style.css': '.a { margin: 0 } .a { margin: 2px } .b { margin: 1px }' });
    // `.a` has two rules in each tree; skipping repeated selectors would report nothing. Its last rule now precedes `.b`.
    assert.ok(pairOf(flippedPairs(base, head, ['/style.css']), '.a', '.b'), 'ordered by the last rule, not skipped');
  });

  test('rules of different specificity, or with no shared family, are not reported', () => {
    const base = sheetsRoot({ 'style.css': '.a { color: red } .b { margin: 0 } .c.d { color: blue }' });
    const head = sheetsRoot({ 'style.css': '.b { margin: 0 } .c.d { color: blue } .a { color: red }' });
    // .a/.b share nothing; .a/.c.d differ in specificity, so the cascade, not order, decides them.
    assert.deepEqual(flippedPairs(base, head, ['/style.css']), []);
  });

  test('propFamily groups shorthands with their longhands and leaves other properties alone', () => {
    for (const [prop, family] of [
      ['margin-top', 'margin'], ['padding', 'padding'], ['border-bottom-color', 'border'], ['border-top-left-radius', 'border-radius'],
      ['font-size', 'font'], ['line-height', 'font'], ['background-color', 'background'], ['row-gap', 'gap-grid'],
      ['grid-template-columns', 'gap-grid'], ['top', 'inset'], ['inset-inline-start', 'inset'], ['color', 'color'], ['display', 'display'],
    ]) assert.equal(propFamily(prop), family, prop);
  });
});

describe('css-cascade: every page stylesheet list starts with /style.css', () => {
  test('every list in lib/ does, apart from the Plain page fragment', () => {
    const lists = stylesheetLists(ROOT);
    assert.ok(lists.length > 30, `expected the renderers' lists, found ${lists.length}`);
    const offenders = lists.filter((names) => names[0] !== '/style.css').map((names) => names.join(' '));
    assert.deepEqual(offenders, ['/settings.css'], 'only the fragment lib/components/plain-page.js appends after a page list');
    assert.doesNotThrow(() => pageLists(ROOT));
  });

  test('a page that forgot /style.css fails the check instead of dropping out of it', () => {
    const dir = tempRoot();
    cpSync(join(ROOT, 'lib'), join(dir, 'lib'), { recursive: true });
    const file = join(dir, 'lib/render-kpis.js');
    const source = readFileSync(file, 'utf8');
    const list = "stylesheets: ['/style.css', '/kpis.css']";
    assert.ok(source.includes(list), 'fixture source: the render-kpis.js list changed; update this test');
    writeFileSync(file, source.replace(list, "stylesheets: ['/kpis.css']"));
    assert.throws(() => pageLists(dir), /not starting with \/style\.css: \[\/kpis\.css\]/);
  });

  test('a list named once as a const and passed by name is read too', () => {
    const dir = tempRoot();
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib/render-x.js'), "const STYLESHEETS = ['/common-actions.css', '/x.css'];\nrenderPage({ stylesheets: STYLESHEETS });\n");
    assert.throws(() => pageLists(dir), /\[\/common-actions\.css, \/x\.css\]/);
  });
});
