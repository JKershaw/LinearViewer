import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measureSeams } from './seams.mjs';
import { makeRepo } from './test-helpers.mjs';

const map = {
  areas: [
    { name: 'Pages', match: ['^lib/render'] },
    { name: 'Runs', match: ['^lib/run'] },
    { name: 'Misc', match: ['^lib/'] },
  ],
};
const m = (files, areaMap = map) => measureSeams({ files, areaMap, commit: 'abc' });

test('classification: first match wins, catch-all catches, unmatched is listed', () => {
  const r = m({ 'lib/render-a.js': '', 'lib/other.js': '', 'routes/x.js': '' });
  const count = (n) => r.areas.find((a) => a.name === n)?.files;
  assert.equal(count('Pages'), 1);
  assert.equal(count('Misc'), 1);
  assert.deepEqual(r.scope.unmappedFiles, ['routes/x.js']);
  assert.equal(r.commit, 'abc');
});

test('extraction handles every import form and skips bare specifiers', () => {
  const r = m({
    'lib/run-a.js': `#!/usr/bin/env node
import './render-a.js';
import x from 'lodash';
export { y } from './render-b.js';
export * from './render-c.js';
const z = await import('./render-d.js');
await import(name);`,
    'lib/render-a.js': '', 'lib/render-b.js': '', 'lib/render-c.js': '', 'lib/render-d.js': '',
  });
  assert.equal(r.links.length, 1);
  assert.deepEqual(r.links[0], { from: 'Runs', to: 'Pages', imports: 4 });
  assert.equal(r.scope.nonLiteralDynamicImports, 1);
});

test('syntax errors are listed, not fatal; unresolved relative imports are counted', () => {
  const r = m({ 'lib/run-a.js': 'import {', 'lib/run-b.js': "import './missing.js'; import '../lib/run-a.js';" });
  assert.deepEqual(r.scope.parseFailures, ['lib/run-a.js']);
  assert.equal(r.scope.unresolvedRelativeImports, 1);
  assert.equal(r.areas.find((a) => a.name === 'Runs').internalImports, 1);
});

test('links count distinct file pairs; same-area imports are internal', () => {
  const r = m({
    'lib/run-a.js': "import './render-a.js'; import './render-a.js'; import './run-b.js';",
    'lib/run-b.js': '', 'lib/render-a.js': '',
  });
  assert.deepEqual(r.links, [{ from: 'Runs', to: 'Pages', imports: 1 }]);
  assert.equal(r.areas.find((a) => a.name === 'Runs').internalImports, 1);
});

test('knots: mutual pair has both counts and crossings; one-way is not a knot', () => {
  const oneWay = m({ 'lib/run-a.js': "import './render-a.js';", 'lib/render-a.js': '' });
  assert.deepEqual(oneWay.knots, { pairs: [], groups: [] });
  const r = m({ 'lib/run-a.js': "import './render-a.js';", 'lib/render-a.js': "import './run-a.js';" });
  assert.equal(r.knots.pairs.length, 1);
  const p = r.knots.pairs[0];
  assert.deepEqual([p.a, p.b, p.aToB, p.bToA], ['Pages', 'Runs', 1, 1]);
  assert.equal(p.crossings.length, 2);
  assert.deepEqual(r.knots.groups, [['Pages', 'Runs']]);
});

test('a three-area cycle with no mutual pair shows only as a group', () => {
  const three = { areas: [{ name: 'A', match: ['^lib/a'] }, { name: 'B', match: ['^lib/b'] }, { name: 'C', match: ['^lib/c'] }] };
  const r = m({ 'lib/a.js': "import './b.js';", 'lib/b.js': "import './c.js';", 'lib/c.js': "import './a.js';" }, three);
  assert.deepEqual(r.knots.pairs, []);
  assert.deepEqual(r.knots.groups, [['A', 'B', 'C']]);
});

test('entry files: imported from another area counts, imported only within its area does not', () => {
  const r = m({
    'lib/run-a.js': "import './render-a.js'; import './run-b.js';",
    'lib/run-b.js': '', 'lib/render-a.js': '',
  });
  const pages = r.areas.find((a) => a.name === 'Pages');
  assert.deepEqual(pages.entryFiles, [{ path: 'lib/render-a.js', importedFromAreas: ['Runs'], importers: 1 }]);
  assert.deepEqual(r.areas.find((a) => a.name === 'Runs').entryFiles, []);
});

test('output is independent of input order', () => {
  const files = {
    'lib/run-a.js': "import './render-a.js';", 'lib/render-a.js': "import './run-a.js';", 'lib/other.js': "import './run-a.js';",
  };
  const reversed = Object.fromEntries(Object.entries(files).reverse());
  assert.equal(JSON.stringify(m(files)), JSON.stringify(m(reversed)));
});

// LIN-3638: the CLI reads the commit through the kit's readCommit, not a reader of its own.
test('CLI: reads a commit from the object store, non-ASCII paths included, symlinks excluded', () => {
  const repo = makeRepo();
  try {
    repo.commit({ 'lib/run-a.js': "import './render-é.js';", 'lib/render-é.js': '', 'lib/target.js': '' }, '2026-01-01T00:00:00Z');
    const link = execFileSync('git', ['-C', repo.dir, 'hash-object', '-w', '--stdin'], { input: './target.js', encoding: 'utf8' }).trim();
    repo.git('update-index', '--add', '--cacheinfo', `120000,${link},lib/link.js`);
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'link');
    const out = JSON.parse(execFileSync('node', [fileURLToPath(new URL('./seams.mjs', import.meta.url)), repo.dir, 'HEAD'], { encoding: 'utf8' }));
    assert.equal(out.scope.files, 3);
    assert.equal(out.scope.unresolvedRelativeImports, 0);
    assert.match(out.commit, /^[0-9a-f]{40}$/);
  } finally { repo.cleanup(); }
});
