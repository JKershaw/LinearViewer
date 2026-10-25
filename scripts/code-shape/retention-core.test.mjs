// Pure tests for the retention core (LIN-3829): file contents in, data out. No git, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentRefs, measureRetention } from './retention-core.mjs';

const noHeadTree = () => ({});

test('a ref in a comment that is present at base and absent at head is dropped, with its base file', () => {
  const r = measureRetention({
    baseFiles: { 'lib/a.js': '// LIN-12 keeps the retry\nexport const a = 1;\n' },
    headFiles: { 'lib/a.js': 'export const a = 1;\n' },
    headTree: noHeadTree,
  });
  assert.deepEqual(r.dropped.map((d) => [d.ref, d.baseFiles]), [['LIN-12', ['lib/a.js']]]);
  assert.deepEqual(r.dropped[0].citedElsewhereAtHead, []);
  assert.deepEqual(r.linRefs, [1, 0]);
});

test('a ref moved from one file to another in the same commit is not dropped (per-commit pooling)', () => {
  const r = measureRetention({
    baseFiles: { 'lib/a.js': '// LIN-12 keeps the retry\nexport const a = 1;\n', 'lib/b.js': 'export const b = 1;\n' },
    headFiles: { 'lib/a.js': 'export const a = 1;\n', 'lib/b.js': '// LIN-12 keeps the retry\nexport const b = 1;\n' },
    headTree: noHeadTree,
  });
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.linRefs, [1, 1]);
});

test('refs in string, template or other non-comment text are not counted', () => {
  const r = measureRetention({
    baseFiles: { 'lib/a.js': "// LIN-8 is the real reason\nexport const s = 'LIN-7';\nexport const t = `LIN-9`;\n" },
    headFiles: { 'lib/a.js': "export const s = 'LIN-7';\nexport const t = `LIN-9`;\n" },
    headTree: noHeadTree,
  });
  assert.deepEqual(r.dropped.map((d) => d.ref), ['LIN-8'], 'only the comment ref is dropped');
  assert.deepEqual(r.linRefs, [1, 0]);
});

test('a slash ref expands to both refs; a ref is never matched inside a longer number', () => {
  assert.deepEqual([...commentRefs('// see LIN-622/623\n').refs].sort(), ['LIN-622', 'LIN-623']);
  assert.deepEqual([...commentRefs('// LIN-622\n').refs], ['LIN-622'], 'LIN-62 is not matched inside LIN-622');

  const slash = measureRetention({
    baseFiles: { 'lib/a.js': '// see LIN-622/623\n' },
    headFiles: { 'lib/a.js': '// see LIN-622\n' },
    headTree: noHeadTree,
  });
  assert.deepEqual(slash.dropped.map((d) => d.ref), ['LIN-623']);

  const prefix = measureRetention({
    baseFiles: { 'lib/a.js': '// LIN-62\n' },
    headFiles: { 'lib/a.js': '// LIN-622\n' },
    headTree: noHeadTree,
  });
  assert.deepEqual(prefix.dropped.map((d) => d.ref), ['LIN-62'], 'LIN-622 at head does not hide a dropped LIN-62');
});

test('a file that fails to parse at head is listed under parseFailures and its base refs are not dropped', () => {
  const r = measureRetention({
    baseFiles: { 'lib/a.js': '// LIN-5 reason\nexport const a = 1;\n' },
    headFiles: { 'lib/a.js': 'export const a = (\n' },
    headTree: noHeadTree,
  });
  assert.deepEqual(r.parseFailures, [{ path: 'lib/a.js', side: 'head' }]);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.linRefs, [0, 0], 'a failing file is in neither pool');
});

test('a file that fails to parse at base is listed under parseFailures and contributes nothing', () => {
  const r = measureRetention({
    baseFiles: { 'lib/a.js': 'export const a = (\n' },
    headFiles: { 'lib/a.js': '// LIN-6 reason\nexport const a = 1;\n' },
    headTree: noHeadTree,
  });
  assert.deepEqual(r.parseFailures, [{ path: 'lib/a.js', side: 'base' }]);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.linRefs, [0, 0]);
});

test('a deleted file drops its refs unless they are pooled elsewhere; an added file only adds', () => {
  const r = measureRetention({
    baseFiles: { 'lib/gone.js': '// LIN-20 gone\n', 'lib/moved.js': '// LIN-21 moved\n' },
    headFiles: { 'lib/gone.js': '', 'lib/moved.js': '', 'lib/new.js': '// LIN-21 moved\n// LIN-30 added\n' },
    headTree: noHeadTree,
  });
  assert.deepEqual(r.dropped.map((d) => [d.ref, d.baseFiles]), [['LIN-20', ['lib/gone.js']]]);
  assert.deepEqual(r.linRefs, [2, 2]);
});

test('dropped refs sort numerically, not as text', () => {
  const r = measureRetention({
    baseFiles: { 'lib/a.js': '// LIN-100\n// LIN-9\n' },
    headFiles: { 'lib/a.js': '' },
    headTree: noHeadTree,
  });
  assert.deepEqual(r.dropped.map((d) => d.ref), ['LIN-9', 'LIN-100']);
});

test('citedElsewhereAtHead names an unchanged head file whose comment still has the ref', () => {
  const r = measureRetention({
    baseFiles: { 'lib/a.js': '// LIN-40 reason\n' },
    headFiles: { 'lib/a.js': '' },
    headTree: () => ({ 'routes/b.js': '// keeps LIN-40 for the same reason\nexport const b = 1;\n' }),
  });
  assert.deepEqual(r.dropped[0].citedElsewhereAtHead, ['routes/b.js']);
});

test('citedElsewhereAtHead ignores changed files, string-only mentions and unparseable files', () => {
  const r = measureRetention({
    baseFiles: { 'lib/a.js': '// LIN-41 reason\n' },
    headFiles: { 'lib/a.js': '' },
    headTree: () => ({
      'lib/a.js': '// LIN-41 still here, but this file changed\n',
      'lib/c.js': 'const s = "LIN-41";\n',
      'lib/d.js': 'export const d = (\n',
    }),
  });
  assert.deepEqual(r.dropped.map((d) => [d.ref, d.citedElsewhereAtHead]), [['LIN-41', []]]);
});

test('the head tree is read only when something was dropped', () => {
  const r = measureRetention({
    baseFiles: { 'lib/a.js': '// LIN-50 reason\n' },
    headFiles: { 'lib/a.js': '// LIN-50 reason\n' },
    headTree: () => { throw new Error('should not be read'); },
  });
  assert.deepEqual(r.dropped, []);
});

test('an empty change reports nothing dropped and the pool sizes', () => {
  const r = measureRetention({ baseFiles: {}, headFiles: {}, headTree: noHeadTree });
  assert.deepEqual(r, { dropped: [], linRefs: [0, 0], commentLines: [0, 0], parseFailures: [] });
});

test('commentLines counts the lines each comment spans, on both sides', () => {
  const r = measureRetention({
    baseFiles: { 'lib/a.js': '/* LIN-1\n   two\n   three */\nexport const a = 1;\n' },
    headFiles: { 'lib/a.js': '// LIN-1\n' },
    headTree: noHeadTree,
  });
  assert.deepEqual(r.commentLines, [3, 1]);
});
