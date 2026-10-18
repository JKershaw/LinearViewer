import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureVerbatim, nonTrivialLines } from './verbatim-core.mjs';

const body = (names) => names.map((n) => `const ${n} = compute('${n}', options.${n});`).join('\n');

test('line rules: trimmed; blanks, punctuation-only lines, comments and imports are ignored', () => {
  const src = "import { a } from './a.js';\nexport * from './b.js';\n\n  // note\n/* block */\n * star\n});\n   const x = 1;\n";
  assert.deepEqual(nonTrivialLines(src), ['const x = 1;']);
});

test('a rename-only edit keeps most lines; the renamed ones are not verbatim', () => {
  const oldSrc = body(['alpha', 'beta', 'gamma', 'delta']);
  const newSrc = oldSrc.replace('alpha', 'omega');
  const r = measureVerbatim({ oldFiles: { 'lib/a.js': oldSrc }, newFiles: { 'lib/a.js': newSrc } });
  assert.deepEqual([r.raw.newLines, r.raw.oldLines, r.raw.matched], [4, 4, 3]);
  assert.equal(r.raw.newVerbatimPct, 75);
  assert.equal(r.raw.oldSurvivingPct, 75);
  assert.equal(r.raw.longestRun.length, 3);
});

test('a whole rewrite shares nothing', () => {
  const r = measureVerbatim({ oldFiles: { 'lib/a.js': body(['a', 'b', 'c']) }, newFiles: { 'lib/a.js': body(['x', 'y', 'z']) } });
  assert.equal(r.raw.matched, 0);
  assert.equal(r.raw.newVerbatimPct, 0);
  assert.equal(r.raw.longestRun.length, 0);
});

test('a semicolon-only change: raw misses it, normalised matches it', () => {
  const r = measureVerbatim({ oldFiles: { 'lib/a.js': 'const a = 1;\nconst b = 2;\n' }, newFiles: { 'lib/a.js': 'const a = 1\nconst b = 2\n' } });
  assert.equal(r.raw.matched, 0);
  assert.equal(r.semicolonsNormalised.matched, 2);
  assert.equal(r.semicolonsNormalised.newVerbatimPct, 100);
});

test('matching is a multiset: a line present once in the old matches once in the new', () => {
  const r = measureVerbatim({ oldFiles: { 'lib/a.js': 'run();\nstop();\n' }, newFiles: { 'lib/a.js': 'run();\nrun();\nrun();\n' } });
  assert.equal(r.raw.matched, 1);
});

test('per-region split follows regionOf; new files are consumed in sorted order, so the split is reproducible', () => {
  const shared = 'const shared = 1;\n';
  const oldFiles = { 'lib/old.js': shared };
  // Both new files hold the one old line; the earlier path (sorted) takes it, whatever the key order.
  const forward = measureVerbatim({ oldFiles, newFiles: { 'a/x.js': shared, 'b/y.js': shared }, regionOf: (p) => p.split('/')[0] });
  const backward = measureVerbatim({ oldFiles, newFiles: { 'b/y.js': shared, 'a/x.js': shared }, regionOf: (p) => p.split('/')[0] });
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.regions.map((r) => [r.region, r.newLines, r.raw.matched]), [['a', 1, 1], ['b', 1, 0]]);
});

test('the longest run is within one file and resets at each file start', () => {
  const lines = ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'];
  const r = measureVerbatim({
    oldFiles: { 'lib/old.js': lines.join('\n') },
    newFiles: { 'lib/n1.js': lines.slice(0, 2).join('\n'), 'lib/n2.js': `${lines.slice(2).join('\n')}\n` },
  });
  assert.equal(r.raw.matched, 4);
  assert.equal(r.raw.longestRun.length, 2);
  assert.equal(r.raw.longestRun.file, 'lib/n1.js');
  assert.equal(r.raw.longestRun.ntLine, 1);
});
