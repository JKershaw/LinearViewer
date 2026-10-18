import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError, areaOf, compileGuide, compileScope, loadAreas, parseArgs } from './code-shape-lib.mjs';

test('default scope: JavaScript minus node_modules, vendored dirs, minified files and tests', () => {
  const inScope = compileScope();
  for (const p of ['server.js', 'lib/a.mjs', 'src/deep/b.cjs', 'public/app.js']) assert.ok(inScope(p), p);
  for (const p of ['README.md', 'lib/a.ts', 'node_modules/x/index.js', 'public/vendor/x.js', 'public/vendored/x.js', 'public/a.min.js',
    'tests/a.js', 'test/a.js', 'lib/__tests__/a.js', 'lib/a.test.js', 'lib/a.spec.mjs']) assert.ok(!inScope(p), p);
});

test('--include replaces only the default include; --exclude replaces only the default exclude', () => {
  const onlyLib = compileScope({ include: '^lib/.*\\.js$' });
  assert.ok(onlyLib('lib/a.js'));
  assert.ok(!onlyLib('routes/a.js'));
  assert.ok(!onlyLib('lib/a.test.js'), 'the default exclude still applies');
  const noExclude = compileScope({ exclude: '^$' });
  assert.ok(noExclude('lib/a.test.js'), 'a new exclude replaces the default one');
  assert.ok(!noExclude('lib/a.ts'), 'the default include still applies');
  const custom = compileScope({ exclude: '^lib/skip/' });
  assert.ok(!custom('lib/skip/a.js'));
  assert.ok(custom('tests/a.js'), 'the default exclude is gone, not stacked');
});

test('loadAreas: the default file is used when present; an explicit missing or malformed path is a usage error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'code-shape-areas-'));
  try {
    assert.ok(loadAreas(undefined).areaMap.areas.length > 0);
    assert.throws(() => loadAreas(join(dir, 'missing.json')), UsageError);
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    assert.throws(() => loadAreas(join(dir, 'bad.json')), UsageError);
    writeFileSync(join(dir, 'shape.json'), '{"areas": "nope"}');
    assert.throws(() => loadAreas(join(dir, 'shape.json')), UsageError);
    writeFileSync(join(dir, 'ok.json'), '{"areas":[{"name":"X","match":["^x/"]}]}');
    assert.equal(loadAreas(join(dir, 'ok.json')).areaMap.areas[0].name, 'X');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('areaOf: first matching area wins; unclaimed files fall back to the top-level directory', () => {
  const guide = compileGuide({ areas: [{ name: 'A', match: ['^lib/a'] }, { name: 'B', match: ['^lib/'] }] });
  assert.equal(areaOf(guide, 'lib/a1.js'), 'A');
  assert.equal(areaOf(guide, 'lib/z.js'), 'B');
  assert.equal(areaOf(guide, 'routes/x.js'), 'routes');
  assert.equal(areaOf(null, 'server.js'), 'server.js');
});

test('parseArgs: values, booleans, positionals; unknown flags and missing values are usage errors', () => {
  const spec = { '--a': 'value', '--b': 'bool' };
  assert.deepEqual(parseArgs(['x', '--a', '1', '--b', 'y'], spec), { positional: ['x', 'y'], flags: { '--a': '1', '--b': true } });
  assert.throws(() => parseArgs(['--c'], spec), UsageError);
  assert.throws(() => parseArgs(['--a'], spec), UsageError);
});
