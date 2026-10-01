/**
 * LIN-3216 (LIN-3201 A0) — unit tests for tests/unit/lib/import-graph.js.
 *
 * Synthetic fixtures only (in-memory sources): the helper is pure over a
 * supplied file set, so every case is drivable without touching the tree.
 * Every exported function and method is exercised, each positive case carries a
 * negative counterpart, and the mutation-check table lives in the PR (each
 * guarded behaviour was observed to fail when the helper was broken).
 *
 * Lives at the top level of tests/unit/ on purpose: the unit runner globs
 * non-recursively (`node --test tests/unit/*.test.js`), the hermetic wrapper
 * counts only top-level files, and the mutant runner uses the same glob — a
 * test under tests/unit/lib/ would never run in CI.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildImportGraph,
  resolveSpecifier,
  parseModule,
} from './lib/import-graph.js';

// Absolute URL of the helper, so the bounded child process below imports the
// same file this test imports.
const HELPER_URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'lib', 'import-graph.js')).href;

/** Object of { path: source } -> the iterable form buildImportGraph accepts. */
function mk(sources) {
  return buildImportGraph(Object.entries(sources).map(([path, source]) => ({ path, source })));
}

describe('resolveSpecifier', () => {
  test('resolves a relative specifier against the importer directory', () => {
    assert.equal(resolveSpecifier('routes/proxy.js', './proxy-kickoff.js'), 'routes/proxy-kickoff.js');
    assert.equal(resolveSpecifier('routes/proxy-flight-companion.js', '../lib/chat-tools.js'), 'lib/chat-tools.js');
  });

  test('appends .js when the specifier has no extension', () => {
    assert.equal(resolveSpecifier('lib/wrapper.js', './dispatch-factory'), 'lib/dispatch-factory.js');
  });

  test('negative: bare and node: specifiers are not resolved', () => {
    assert.equal(resolveSpecifier('lib/a.js', 'express'), null);
    assert.equal(resolveSpecifier('lib/a.js', 'node:fs'), null);
  });

  test('negative: a specifier that escapes the repo root is not resolved', () => {
    assert.equal(resolveSpecifier('lib/a.js', '../../../etc/passwd'), null);
  });
});

describe('parseModule', () => {
  test('parses every static import/re-export form and the export names', () => {
    const { imports, reexports, exportedNames } = parseModule([
      "import 'node:fs';",
      "import def from './m.js';",
      "import { a, b as c } from './m.js';",
      "import * as ns from './m.js';",
      "import def2, { d } from './m.js';",
      "export { x, y as z } from './m.js';",
      "export * from './m.js';",
      "export * as barrel from './m.js';",
      "export { localA as localB };",
      "export function fn() {}",
      "export async function afn() {}",
      "export class Klass {}",
      "export const one = 1, two = 2;",
      "export default 42;",
    ].join('\n'));

    assert.deepEqual(imports.find((r) => r.specifier === 'node:fs'), {
      specifier: 'node:fs', form: 'side-effect', star: false, sideEffect: true, bindings: [],
    });
    assert.deepEqual(imports.find((r) => r.specifier === './m.js' && r.form === 'default').bindings,
      [{ imported: 'default', local: 'def' }]);
    assert.deepEqual(imports.find((r) => r.form === 'named').bindings,
      [{ imported: 'a', local: 'a' }, { imported: 'b', local: 'c' }]);
    assert.deepEqual(imports.find((r) => r.form === 'namespace'),
      { specifier: './m.js', form: 'namespace', star: true, sideEffect: false, bindings: [{ imported: '*', local: 'ns' }] });
    assert.deepEqual(imports.find((r) => r.bindings.some((b) => b.local === 'd')).bindings,
      [{ imported: 'default', local: 'def2' }, { imported: 'd', local: 'd' }]);

    assert.deepEqual(reexports.find((r) => r.form === 'named').bindings,
      [{ imported: 'x', local: 'x' }, { imported: 'y', local: 'z' }]);
    assert.equal(reexports.find((r) => r.form === 'star').star, true);
    assert.deepEqual(reexports.find((r) => r.form === 'namespace').bindings,
      [{ imported: '*', local: 'barrel' }]);

    for (const name of ['z', 'barrel', 'localB', 'fn', 'afn', 'Klass', 'one', 'two', 'default']) {
      assert.ok(exportedNames.includes(name), `expected exported name ${name}`);
    }
  });

  test('ignores import/export text inside comments', () => {
    const { imports, exportedNames } = parseModule(
      "// import { ghost } from './ghost.js';\n/* export function alsoGhost() {} */\nexport const real = 1;\n"
    );
    assert.deepEqual(imports, []);
    assert.deepEqual(exportedNames, ['real']);
  });
});

describe('direct import', () => {
  const graph = mk({
    'a.js': "import { x } from './b.js';\n",
    'b.js': 'export function x() {}\n',
  });

  test('records the resolved edge and binding', () => {
    assert.deepEqual(graph.dependenciesOf('a.js'), ['b.js']);
    const [rec] = graph.importsOf('a.js');
    assert.equal(rec.resolved, 'b.js');
    assert.equal(rec.kind, 'import');
    assert.deepEqual(rec.bindings, [{ imported: 'x', local: 'x' }]);
    assert.deepEqual(graph.importsOf('a.js')[0].bindings, [{ imported: 'x', local: 'x' }]);
    assert.deepEqual(graph.edges(), [{ from: 'a.js', to: 'b.js', specifier: './b.js', kind: 'import' }]);
    assert.equal(graph.reaches('a.js', 'x'), true);
    assert.deepEqual(graph.directImportersOf('x'), ['a.js']);
  });

  test('negative: a symbol with no path is not reached', () => {
    assert.equal(graph.reaches('a.js', 'y'), false);
    assert.deepEqual(graph.directImportersOf('y'), []);
  });
});

describe('export … from re-export (named and star)', () => {
  const graph = mk({
    'named.js': "export { createDispatchItem } from './def.js';\n",
    'star.js': "export * from './def.js';\n",
    'ns.js': "export * as barrel from './def.js';\n",
    'def.js': 'export async function createDispatchItem() {}\n',
    'empty.js': 'export const nothing = 1;\n',
    'emptyStar.js': "export * from './empty.js';\n",
  });

  test('named re-export forwards the name and is reachable', () => {
    assert.ok(graph.exportedNamesOf('named.js').includes('createDispatchItem'));
    assert.equal(graph.reaches('named.js', 'createDispatchItem'), true);
    assert.equal(graph.importsOf('named.js')[0].kind, 're-export');
    assert.equal(graph.importsOf('named.js')[0].resolved, 'def.js');
    assert.deepEqual(graph.directImportersOf('createDispatchItem').sort(), ['named.js']);
  });

  test('star re-export expands the target export set', () => {
    assert.deepEqual(graph.exportedNamesOf('star.js'), ['createDispatchItem']);
    assert.equal(graph.reaches('star.js', 'createDispatchItem'), true);
  });

  test('negative: a star re-export is not a direct named importer', () => {
    assert.deepEqual(graph.directImportersOf('createDispatchItem').sort(), ['named.js']);
  });

  test('export * as ns exports only the namespace name', () => {
    assert.deepEqual(graph.exportedNamesOf('ns.js'), ['barrel']);
    assert.equal(graph.reaches('ns.js', 'barrel'), true);
  });

  test('negative: a star re-export of a module without the symbol does not invent it', () => {
    assert.deepEqual(graph.exportedNamesOf('emptyStar.js'), ['nothing']);
    assert.equal(graph.reaches('emptyStar.js', 'createDispatchItem'), false);
  });
});

describe('aliasing (import { x as y })', () => {
  const graph = mk({
    'al.js': "import { createDispatchItem as enqueue } from './def.js';\nexport const ready = true;\n",
    'def.js': 'export async function createDispatchItem() {}\n',
  });

  test('the imported (source) name is what the graph tracks', () => {
    assert.deepEqual(graph.importsOf('al.js')[0].bindings, [{ imported: 'createDispatchItem', local: 'enqueue' }]);
    assert.deepEqual(graph.directImportersOf('createDispatchItem'), ['al.js']);
    assert.equal(graph.reaches('al.js', 'createDispatchItem'), true);
  });

  test('negative: the local alias is not treated as the exported symbol', () => {
    assert.deepEqual(graph.directImportersOf('enqueue'), []);
    assert.equal(graph.reaches('al.js', 'enqueue'), false);
  });
});

describe('two-hop transitive edge through a lib/ wrapper', () => {
  const graph = mk({
    'routes/thing.js': "import { helper } from '../lib/wrapper.js';\n",
    'lib/wrapper.js': "import { createDispatchItem } from './dispatch-factory.js';\nexport function helper() { return createDispatchItem; }\n",
    'lib/dispatch-factory.js': 'export async function createDispatchItem() {}\n',
    'lib/isolated.js': 'export const alone = 1;\n',
  });

  test('reach crosses the wrapper to the defining module', () => {
    assert.equal(graph.reaches('routes/thing.js', 'createDispatchItem'), true);
    assert.equal(graph.reaches('lib/wrapper.js', 'createDispatchItem'), true);
    assert.equal(graph.reaches('lib/dispatch-factory.js', 'createDispatchItem'), true);
    assert.deepEqual(graph.reachingModules('createDispatchItem'),
      ['lib/dispatch-factory.js', 'lib/wrapper.js', 'routes/thing.js']);
  });

  test('reachingModules({ from }) bounds the candidate set', () => {
    assert.deepEqual(graph.reachingModules('createDispatchItem', { from: ['routes/thing.js'] }), ['routes/thing.js']);
  });

  test('negative: an isolated module reaches nothing', () => {
    assert.equal(graph.reaches('lib/isolated.js', 'createDispatchItem'), false);
    assert.equal(graph.reaches('routes/thing.js', 'notAThing'), false);
  });
});

describe('cycles terminate', () => {
  const graph = mk({
    'c1.js': "import { b } from './c2.js';\nexport function a() {}\n",
    'c2.js': "import { a } from './c1.js';\nexport function b() {}\n",
    'x.js': "export * from './y.js';\n",
    'y.js': "export * from './x.js';\nexport const only = 1;\n",
  });

  test('reaches terminates on a two-module import cycle and returns the right answer', () => {
    // `reaches` is synchronous, so a lost visited-set guard would spin the
    // event loop and Node's per-test timeout could not preempt it. Run the
    // cycle in a bounded child process instead: a lost guard makes this test
    // FAIL (ETIMEDOUT) rather than hang the suite.
    const script = `
      import { buildImportGraph } from ${JSON.stringify(HELPER_URL)};
      const g = buildImportGraph(new Map([
        ['c1.js', "import { b } from './c2.js';\\nexport function a() {}\\n"],
        ['c2.js', "import { a } from './c1.js';\\nexport function b() {}\\n"],
      ]));
      if (g.reaches('c1.js', 'b') !== true) throw new Error('c1 -> b should be true');
      if (g.reaches('c2.js', 'a') !== true) throw new Error('c2 -> a should be true');
      if (g.reaches('c1.js', 'missing') !== false) throw new Error('missing should be false');
      console.log('terminated');
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 2000,
    });
    assert.match(out, /terminated/);
  });

  test('a star re-export cycle expands exported names without looping', () => {
    assert.deepEqual(graph.exportedNamesOf('x.js'), ['only']);
    assert.equal(graph.reaches('x.js', 'only'), true);
  });
});

describe('graph bookkeeping', () => {
  const graph = mk({
    'a.js': "import { x } from './b.js';\nimport 'express';\n",
    'b.js': 'export function x() {}\n',
  });

  test('paths/has/sourceOf expose the supplied file set', () => {
    assert.deepEqual(graph.paths(), ['a.js', 'b.js']);
    assert.equal(graph.has('a.js'), true);
    assert.equal(graph.has('nope.js'), false);
    assert.equal(graph.sourceOf('b.js'), 'export function x() {}\n');
  });

  test('a non-relative import is recorded but contributes no edge or dependency', () => {
    assert.deepEqual(graph.dependenciesOf('a.js'), ['b.js']);
    const bare = graph.importsOf('a.js').find((r) => r.specifier === 'express');
    assert.equal(bare.resolved, null);
    assert.deepEqual(graph.edges().map((e) => e.to), ['b.js']);
    assert.deepEqual(graph.directImportersOf('x'), ['a.js']);
  });

  test('resolve() delegates to resolveSpecifier', () => {
    assert.equal(graph.resolve('a.js', './b.js'), 'b.js');
    assert.equal(graph.resolve('a.js', 'express'), null);
  });
});
