// pair-rule.test.mjs — LIN-4334. The pair-baseline selection rule (pair-rule.mjs), on synthetic merges.
//
// Run by hand only:  node --test docs/papers/harbour/cleaner-than-it-started-scripts/pair-rule.test.mjs
// Not wired into CI: the unit runner takes only the globs in package.json, and this folder is none of them.
// The real Oct list is checked by analyse.mjs itself (it throws unless the four pairs match expected_pairs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPairs, isProductionFile } from './pair-rule.mjs';

const RULE = { production: ['lib/', 'routes/', 'public/', 'server.js'], window_hours: 48, take: 4 };
const sha = (n) => String(n).repeat(40);
const m = (n, committed, ...files) => ({ full: sha(n), short: sha(n).slice(0, 9), committed, subject: `merge ${n}`, files });

test('production files: a prefix covers files under it; server.js is exact; other paths are not candidates', () => {
  assert.equal(isProductionFile('lib/x.js', RULE.production), true);
  assert.equal(isProductionFile('routes/a/b.js', RULE.production), true);
  assert.equal(isProductionFile('public/kpis.css', RULE.production), true);
  assert.equal(isProductionFile('server.js', RULE.production), true);
  assert.equal(isProductionFile('server.jsx', RULE.production), false);
  assert.equal(isProductionFile('libfoo.js', RULE.production), false, 'lib/ is a directory prefix, not a string prefix');
  assert.equal(isProductionFile('docs/lib/x.js', RULE.production), false);
  assert.equal(isProductionFile('tests/unit/x.test.js', RULE.production), false);
});

test('times are compared as instants: +01:00 and Z in the same list pair in true time order', () => {
  // 10:00+01:00 is 09:00Z, which is EARLIER than 09:30Z. A string comparison would order them the other way.
  const merges = [
    m(1, '2026-10-20T09:30:00Z', 'lib/x.js'),
    m(2, '2026-10-20T10:00:00+01:00', 'lib/x.js'),
  ];
  const [p] = selectPairs(merges, RULE);
  assert.equal(p.first.full, sha(2), 'the 09:00Z merge is first in time');
  assert.equal(p.second.full, sha(1));
});

test('the 48 h window is inclusive: exactly 48 h pairs, 48 h and one second does not', () => {
  const at48 = selectPairs([m(1, '2026-10-20T00:00:00Z', 'lib/x.js'), m(2, '2026-10-22T00:00:00Z', 'lib/x.js')], RULE);
  assert.equal(at48.length, 1);
  const over = selectPairs([m(1, '2026-10-20T00:00:00Z', 'lib/x.js'), m(2, '2026-10-22T00:00:01Z', 'lib/x.js')], RULE);
  assert.equal(over.length, 0);
});

test('a pair needs a shared production file: two production merges with no common file do not pair', () => {
  const merges = [m(1, '2026-10-20T00:00:00Z', 'lib/x.js'), m(2, '2026-10-20T01:00:00Z', 'lib/y.js')];
  assert.equal(selectPairs(merges, RULE).length, 0);
});

test('only production files count: a shared docs file does not pair two merges', () => {
  const merges = [m(1, '2026-10-20T00:00:00Z', 'docs/a.md'), m(2, '2026-10-20T01:00:00Z', 'docs/a.md')];
  assert.equal(selectPairs(merges, RULE).length, 0);
});

test('a shared file that is production only in one merge still pairs on the production file they share', () => {
  // merge 1 touches lib/x.js and docs/a.md; merge 2 touches docs/a.md and lib/x.js: the shared production file is lib/x.js
  const merges = [m(1, '2026-10-20T00:00:00Z', 'lib/x.js', 'docs/a.md'), m(2, '2026-10-20T01:00:00Z', 'docs/a.md', 'lib/x.js')];
  assert.equal(selectPairs(merges, RULE).length, 1);
});

test('no merge is used twice: three merges on one file give one pair, the third is left alone', () => {
  const merges = [m(1, '2026-10-20T00:00:00Z', 'lib/x.js'), m(2, '2026-10-20T01:00:00Z', 'lib/x.js'), m(3, '2026-10-20T02:00:00Z', 'lib/x.js')];
  const pairs = selectPairs(merges, RULE);
  assert.deepEqual(pairs.map((p) => p.label), [`${sha(1).slice(0, 8)}→${sha(2).slice(0, 8)}`]);
});

test('take: five possible pairs yield the first four, in date order', () => {
  const merges = [];
  for (let i = 0; i < 5; i++) {
    const t = `2026-10-2${i}T00:00:00Z`;
    merges.push(m(2 * i + 1, t, `lib/f${i}.js`), m(2 * i + 2, `2026-10-2${i}T01:00:00Z`, `lib/f${i}.js`));
  }
  const pairs = selectPairs(merges, RULE);
  assert.equal(pairs.length, 4);
  assert.deepEqual(pairs.map((p) => p.first.full), [sha(1), sha(3), sha(5), sha(7)]);
});

test('the next unused merge is taken, not the nearest in file overlap: a later pair does not steal an earlier merge', () => {
  // 1 and 2 share lib/x.js; 2 and 3 share routes/r.js. Date order pairs 1 with 2, so 3 stays unpaired.
  const merges = [m(1, '2026-10-20T00:00:00Z', 'lib/x.js'), m(2, '2026-10-20T01:00:00Z', 'lib/x.js', 'routes/r.js'), m(3, '2026-10-20T02:00:00Z', 'routes/r.js')];
  const pairs = selectPairs(merges, RULE);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].second.full, sha(2));
});

test('an unparseable committed time throws, naming the merge, rather than sorting it to a wrong place', () => {
  assert.throws(() => selectPairs([m(1, 'not a time', 'lib/x.js'), m(2, '2026-10-20T01:00:00Z', 'lib/x.js')], RULE), /merge 111111111 has no parseable committed time/);
});
