/**
 * scripts/lin3014/build-measure.mjs (LIN-3014)
 *
 * Splices the unit-tested classify() implementation into the mongosh
 * template verbatim, so there is exactly one classify() — never a hand-copy
 * that could drift from what tests/unit/lin3014-classify.test.js proves.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildMeasureScript, extractClassifyFn } from '../../scripts/lin3014/build-measure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

test('LIN-3014 extractClassifyFn: pulls the real classify() body out of lib/classify.mjs, without the export keyword', () => {
  const classifySource = readFileSync(join(repoRoot, 'scripts', 'lin3014', 'lib', 'classify.mjs'), 'utf8');
  const fn = extractClassifyFn(classifySource);
  assert.match(fn, /^function classify\(before, after\)/);
  assert.doesNotMatch(fn, /^export /);
  assert.match(fn, /LIN-615 violation/);
  assert.match(fn, /BYTES INCREASED at same rows/);
});

test('LIN-3014 extractClassifyFn: throws a clear error when classify() cannot be found', () => {
  assert.throws(() => extractClassifyFn('export const notAFunction = 1;'), /could not find/);
});

test('LIN-3014 buildMeasureScript: splices the classify fn and the KPI EJSON into both template placeholders', () => {
  const template = 'const x = 1;\n/* __CLASSIFY_FN__ */\nconst kpis = __KPIS_EJSON__;\n';
  const script = buildMeasureScript({
    templateSource: template,
    classifyFnSource: 'function classify(a,b) { return a.rows === b.rows; }\n',
    kpisEjson: '{"dispatchHistory":{}}'
  });
  assert.match(script, /function classify\(a,b\)/);
  assert.doesNotMatch(script, /__CLASSIFY_FN__/);
  assert.match(script, /const kpis = "\{\\"dispatchHistory/);
  assert.doesNotMatch(script, /__KPIS_EJSON__/);
});

test('LIN-3014 buildMeasureScript: throws if the template is missing the classify placeholder', () => {
  assert.throws(
    () => buildMeasureScript({ templateSource: 'no placeholder here __KPIS_EJSON__', classifyFnSource: 'function classify(){}', kpisEjson: '{}' }),
    /__CLASSIFY_FN__/
  );
});

test('LIN-3014 buildMeasureScript: throws if the template is missing the KPIS placeholder', () => {
  assert.throws(
    () => buildMeasureScript({ templateSource: '/* __CLASSIFY_FN__ */', classifyFnSource: 'function classify(){}', kpisEjson: '{}' }),
    /__KPIS_EJSON__/
  );
});

test('LIN-3014 build-measure end-to-end: the real measure.template.js accepts the real classify() splice cleanly', () => {
  const classifySource = readFileSync(join(repoRoot, 'scripts', 'lin3014', 'lib', 'classify.mjs'), 'utf8');
  const templateSource = readFileSync(join(repoRoot, 'scripts', 'lin3014', 'measure.template.js'), 'utf8');
  const script = buildMeasureScript({
    templateSource,
    classifyFnSource: extractClassifyFn(classifySource),
    kpisEjson: '{"dispatchHistory":{"pipeline":[{"$project":{"feedbackCount":{"$cond":[true,1,2]}}}]},"proxyEvents":{"pipeline":[]},"reportHistory":{"filter":{},"projection":null}}'
  });
  assert.doesNotMatch(script, /__CLASSIFY_FN__/);
  assert.doesNotMatch(script, /__KPIS_EJSON__/);
  assert.match(script, /function classify\(before, after\)/);
});
