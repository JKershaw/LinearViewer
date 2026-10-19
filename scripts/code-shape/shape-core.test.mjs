// Shape against the section 13 definitions (docs/theseus-method-long.md), on inline fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyse } from './shape-core.mjs';
import { measureShape } from './shape-report.mjs';

test('lines: code, comment-only and blank; a line with code and a trailing comment is code', () => {
  const r = analyse('// header\n\nconst a = 1; // trailing\n/* block\n   comment */\nconst b = 2;\n');
  assert.deepEqual(r.lines, { total: 6, code: 2, comment: 3, blank: 1 });
});

test('complexity is 1 plus each if, ?:, loop, case with a test, catch, &&, ||, ??; default values count; ?. does not', () => {
  const src = `export function f(a, b = 1) {
  if (a) { return a ?? b; }
  const t = a ? 1 : 2;
  switch (t) { case 1: return 1; case 2: return 2; default: return 0; }
}
export function g(o) { return o?.x?.y; }
`;
  const r = analyse(src);
  const byName = Object.fromEntries(r.perFunction.map((f) => [f.name, f]));
  // f: 1 + default value + if + ?? + ?: + two cases (default not counted) = 7; g: optional chains only = 1
  assert.equal(byName.f.cyclomatic, 7);
  assert.equal(byName.g.cyclomatic, 1);
  assert.equal(r.optionalChains, 2);
  // decision points = sum over units of (complexity - 1); the module unit is its own unit with base 1
  assert.equal(r.cyclomatic.decisionPoints, 6);
  assert.equal(r.cyclomatic.total, 7 + 1 + 1);
});

test('an else-if adds no nesting level; each function starts again at 0', () => {
  const src = `export function f(a) {
  if (a === 1) { return 1; } else if (a === 2) { return 2; } else { return 3; }
}
export function g(a) { for (const x of a) { if (x) { while (x) { x = 0; } } } }
`;
  assert.equal(analyse(src).maxNesting, 3);
  assert.equal(analyse(src.split('export function g')[0]).maxNesting, 1);
});

test('functions: callbacks and one-line arrows count; unitsOver10 lists units above complexity 10', () => {
  const big = `export function big(a) {\n${Array.from({ length: 11 }, (_, i) => `  if (a === ${i}) { a++; }`).join('\n')}\n}\n`;
  const r = analyse(`${big}export const m = (xs) => xs.map((x) => x + 1);\n`);
  assert.equal(r.functions.count, 3);
  assert.deepEqual(r.cyclomatic.unitsOver10, ['big']);
});

test('measureShape: per-area rollup, totals, parse failures and unmapped files listed not fatal', () => {
  const areaMap = { areas: [{ name: 'Core', match: ['^lib/'] }] };
  const files = {
    'lib/a.js': 'export function a(x) { if (x) { return 1; } return 0; }\n',
    'lib/b.js': 'export const b = (x) => x ?? 2;\n',
    'routes/c.js': 'export function c() { return 1; }\n',
    'lib/broken.js': 'export function (\n',
  };
  const r = measureShape({ files, areaMap });
  assert.deepEqual(r.scope.parseFailures.map((f) => f.file), ['lib/broken.js']);
  assert.deepEqual(r.scope.unmappedFiles, ['routes/c.js']);
  assert.deepEqual(r.areas.map((a) => [a.area, a.files, a.functions, a.decisionPoints]), [['Core', 2, 2, 2], ['routes', 1, 1, 0]]);
  assert.equal(r.totals.files, 3);
  assert.equal(r.totals.functions, 3);
  assert.equal(r.areas[0].worstFunctionByCodeLines.name, 'a');
  assert.ok(!('perFunction' in r.files[0]));
  assert.ok('perFunction' in measureShape({ files, areaMap, detail: true }).files[0]);
});

// The kit copies the definitions (LIN-3628) rather than importing them from experiments/. The guard is
// two-sided: a change to either copy fails this test. The original stays a frozen record of the experiment
// on purpose (it is no-semicolon style, and editing it would alter recorded history), so a deliberate
// change goes in the kit copy and the original is updated only to match (LIN-3640).
// While the original exists, the two must not drift.
const ORIGINAL = fileURLToPath(new URL('../../experiments/rebuild-exp1/kit/lib/shape-core.mjs', import.meta.url));
test('shape-core.mjs is a byte copy of the experiments original', { skip: !existsSync(ORIGINAL) }, () => {
  assert.equal(readFileSync(new URL('./shape-core.mjs', import.meta.url), 'utf8'), readFileSync(ORIGINAL, 'utf8'));
});
