import { test } from 'node:test';
import assert from 'node:assert/strict';
import { astEqual, buildRewrites, indent, invertMap, nocomment, rename } from './perturb-core.mjs';
import { diffFailures, looksLikeTap, parseTap } from './tap.mjs';

// No multi-line template literal: `indent` changes those by design.
const SRC = `// header comment
import { helper } from './helper.js';

/**
 * Doubles things,
 * over two more lines.
 */
export function double(values, factor) {
  // inline note
  const out = [];
  for (const value of values) { out.push(helper(value) * factor); } // trailing
  return out;
}
export const label = 'text with // not a comment';
`;

test('nocomment: comments are blanked, line numbers hold, the AST is equal', () => {
  const out = nocomment(SRC);
  assert.doesNotMatch(out, /header comment|inline note|trailing|Doubles|two more/);
  assert.match(out, /'text with \/\/ not a comment'/);
  assert.equal(out.split('\n').length, SRC.split('\n').length);
  assert.ok(astEqual(SRC, out));
});

test('indent: every non-empty line moves right and the AST is equal', () => {
  const out = indent(SRC);
  assert.ok(out.split('\n').every((l, i) => l === '' || l.startsWith('  ') || SRC.split('\n')[i] === ''));
  assert.notEqual(out, SRC);
  assert.ok(astEqual(SRC, out));
});

test('rename: names change in code only; applying the inverse map restores an equal AST', () => {
  const map = { double: 'twice', values: 'items', helper: 'assist' };
  const out = rename(map)(SRC);
  assert.match(out, /export function twice\(items, factor\)/);
  assert.match(out, /import \{ assist \}/);
  assert.match(out, /Doubles things/, 'comments are not rewritten');
  assert.match(out, /'text with \/\/ not a comment'/, 'strings are not rewritten');
  assert.ok(!astEqual(SRC, out));
  assert.ok(astEqual(SRC, rename(invertMap(map))(out)));
});

test('astEqual tells a real change from a position change', () => {
  assert.ok(astEqual('const a = 1;', '  const   a = 1 ;'));
  assert.ok(!astEqual('const a = 1;', 'const a = 2;'));
});

test('buildRewrites: indent and nocomment always, rename only with a map, custom ones added', () => {
  assert.deepEqual(Object.keys(buildRewrites()), ['indent', 'nocomment']);
  assert.deepEqual(Object.keys(buildRewrites({ renameMap: { a: 'b' }, custom: { shout: (t) => t.toUpperCase() } })), ['indent', 'nocomment', 'rename', 'shout']);
});

const TAP = `TAP version 13
# Subtest: top ok
ok 1 - top ok
  ---
  duration_ms: 0.8
  ...
# Subtest: top bad
not ok 2 - top bad
  ---
  duration_ms: 0.7
  location: '/private/tmp/tree/tests/a.test.js:3:1'
  failureType: 'testCodeFailure'
  ...
# Subtest: suite
    # Subtest: inner bad
    not ok 1 - inner bad
      ---
      location: '/private/tmp/tree/tests/a.test.js:4:38'
      ...
    # Subtest: inner skipped
    ok 2 - inner skipped # SKIP
      ---
      ...
    1..2
not ok 3 - suite
  ---
  location: '/private/tmp/tree/tests/a.test.js:4:1'
  failureType: 'subtestsFailed'
  ...
# Subtest: expected failure
not ok 4 - expected failure # TODO
  ---
  location: '/private/tmp/tree/tests/a.test.js:9:1'
  ...
1..4
# tests 5
# pass 1
# fail 3
`;

test('parseTap: failures at any depth, relative to the tree root, skip and todo excluded', () => {
  assert.deepEqual(parseTap(TAP, { root: '/tmp/tree' }), [
    { file: 'tests/a.test.js', name: 'inner bad' },
    { file: 'tests/a.test.js', name: 'suite' },
    { file: 'tests/a.test.js', name: 'top bad' },
  ]);
});

test('parseTap: a failure without a location is still listed; no failures gives an empty list', () => {
  assert.deepEqual(parseTap('TAP version 13\nnot ok 1 - lonely\n1..1\n'), [{ file: '(no location)', name: 'lonely' }]);
  assert.deepEqual(parseTap('TAP version 13\nok 1 - fine\n1..1\n'), []);
});

test('diffFailures: what a rewrite adds and what it no longer shows', () => {
  const a = { file: 'f', name: 'a' }, b = { file: 'f', name: 'b' }, c = { file: 'f', name: 'c' };
  assert.deepEqual(diffFailures([a, b], [b, c]), { addedFailures: [c], noLongerFailing: [a] });
});

test('looksLikeTap', () => {
  assert.ok(looksLikeTap(TAP));
  assert.ok(!looksLikeTap('ℹ tests 3\nℹ pass 3\n'));
});
