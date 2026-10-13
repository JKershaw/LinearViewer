import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureSeams } from './seams.mjs';

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
