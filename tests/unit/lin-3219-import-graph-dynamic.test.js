/**
 * LIN-3219 (LIN-3232 precondition) — additive extension witnesses for
 * `tests/unit/lib/import-graph.js`: executable dynamic `import()` edges and a
 * namespace-aware `directImportersOf`.
 *
 * WHY THIS FILE EXISTS. A0 (LIN-3216) is a STATIC `import` / `export … from`
 * walk. The A0 review's class check (LIN-3216) and LIN-3232 record the two ESM
 * edges it could not see: (1) executable dynamic `import('./x.js')` is not
 * followed by `reaches`; (2) `directImportersOf` misses namespace importers
 * (`import * as ns from './x.js'`). A boundary rule resting on either query
 * could pass silently on a source that still has the edge. This file is the
 * before/after witness set for the additive fix.
 *
 * Lives at the top level of tests/unit/ so the non-recursive runner glob
 * (`node --test tests/unit/*.test.js`) actually runs it.
 *
 * BEFORE (against A0's helper) every "witness" test below fails; AFTER (with the
 * additive extension) they pass. The negative tests pin the deliberate limits:
 * JSDoc type `import('./x.js')` is not an edge, a bare-specifier dynamic import
 * resolves to null, and a template-literal specifier is NOT followed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { buildImportGraph, parseModule } from './lib/import-graph.js';
import { loadRawSources } from '../fixtures/connection-access-guards.js';

const HELPER_URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'lib', 'import-graph.js')).href;

/** Object of { path: source } -> the iterable form buildImportGraph accepts. */
function mk(sources) {
  return buildImportGraph(Object.entries(sources).map(([path, source]) => ({ path, source })));
}

describe('parseModule — executable dynamic import() is an edge', () => {
  test('a string-literal relative dynamic import is recorded as form "dynamic"', () => {
    const { imports } = parseModule("export async function go() { const m = await import('./d.js'); return m; }\n");
    assert.deepEqual(imports, [
      { specifier: './d.js', form: 'dynamic', star: true, sideEffect: false, bindings: [] },
    ]);
  });

  test('`await import(…)` and `import(…).then(…)` both record the edge', () => {
    const awaited = parseModule("await import('./a.js');\n");
    const chained = parseModule("import('./b.js').then((m) => m.run());\n");
    assert.equal(awaited.imports.find((r) => r.specifier === './a.js')?.form, 'dynamic');
    assert.equal(chained.imports.find((r) => r.specifier === './b.js')?.form, 'dynamic');
  });

  test('negative: a JSDoc type `import(\'./ghost.js\')` is NOT an edge (comment stripped)', () => {
    const { imports } = parseModule("/*\n * @param {import('./ghost.js').Thing} deps\n */\nexport const real = 1;\n");
    assert.deepEqual(imports, []);
  });

  test('negative: a bare-specifier dynamic import is recorded but resolves to null', () => {
    const g = mk({ 'lib/a.js': "export async function go() { return (await import('https-proxy-agent')).x; }\n" });
    const rec = g.importsOf('lib/a.js').find((r) => r.specifier === 'https-proxy-agent');
    assert.ok(rec, 'the bare dynamic import is recorded');
    assert.equal(rec.resolved, null);
    assert.deepEqual(g.edges(), []);
  });

  test('negative: a template-literal specifier is deliberately NOT followed', () => {
    // DECISION (stated): only string-literal specifiers are followed. A template
    // literal may interpolate, so it is left out rather than guessed at.
    const { imports } = parseModule('await import(`./${name}.js`);\n');
    assert.deepEqual(imports, []);
  });

  test('negative: `import.meta` and `<obj>.import(` are not dynamic-import edges', () => {
    const { imports } = parseModule("export const url = import.meta.url;\nexport const r = foo.import('./z.js');\n");
    assert.deepEqual(imports, []);
  });
});

describe('reaches — follows a dynamic import hop', () => {
  test('witness: a module that dynamically imports a symbol is reached (A0 said false)', () => {
    const g = mk({
      'lib/dynamic.js': "export async function go() { const m = await import('./d.js'); return m.createDispatchItem(); }\n",
      'lib/d.js': 'export async function createDispatchItem() {}\n',
    });
    assert.equal(g.reaches('lib/dynamic.js', 'createDispatchItem'), true);
    assert.deepEqual(g.dependenciesOf('lib/dynamic.js'), ['lib/d.js']);
  });

  test('a dynamic wrapper hop is reached (route -> dynamic lib/wrapper -> defining module)', () => {
    const g = mk({
      'routes/thing.js': "export async function go() { const w = await import('../lib/wrapper.js'); return w.helper(); }\n",
      'lib/wrapper.js': "import { createDispatchItem } from './dispatch-factory.js';\nexport function helper() { return createDispatchItem; }\n",
      'lib/dispatch-factory.js': 'export async function createDispatchItem() {}\n',
    });
    assert.equal(g.reaches('routes/thing.js', 'createDispatchItem'), true);
    assert.deepEqual(g.reachingModules('createDispatchItem'),
      ['lib/dispatch-factory.js', 'lib/wrapper.js', 'routes/thing.js']);
  });

  test('two chained dynamic hops are reached', () => {
    const g = mk({
      'a.js': "export async function go() { return (await import('./b.js')).mid(); }\n",
      'b.js': "export async function mid() { return (await import('./c.js')).target; }\n",
      'c.js': 'export function target() {}\n',
    });
    assert.equal(g.reaches('a.js', 'target'), true);
  });

  test('negative: a dynamic import of a module without the symbol does not invent it', () => {
    const g = mk({
      'a.js': "export async function go() { return (await import('./b.js')).other; }\n",
      'b.js': 'export function other() {}\n',
    });
    assert.equal(g.reaches('a.js', 'createDispatchItem'), false);
  });

  test('a dynamic import cycle terminates', () => {
    const script = `
      import { buildImportGraph } from ${JSON.stringify(HELPER_URL)};
      const g = buildImportGraph(new Map([
        ['c1.js', "export async function a() { return (await import('./c2.js')).b; }\\n"],
        ['c2.js', "export async function b() { return (await import('./c1.js')).a; }\\n"],
      ]));
      if (g.reaches('c1.js', 'b') !== true) throw new Error('c1 -> b should be true');
      if (g.reaches('c2.js', 'a') !== true) throw new Error('c2 -> a should be true');
      if (g.reaches('c1.js', 'missing') !== false) throw new Error('missing should be false');
      console.log('terminated');
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 2000 });
    assert.match(out, /terminated/);
  });
});

describe('directImportersOf — namespace-aware (dynamic + import * as)', () => {
  const graph = mk({
    'staticNamed.js': "import { createDispatchItem } from './def.js';\n",
    'staticNs.js': "import * as ns from './def.js';\n",
    'dynamic.js': "export async function go() { return (await import('./def.js')).createDispatchItem(); }\n",
    'alias.js': "import { createDispatchItem as enqueue } from './def.js';\n",
    'starReexport.js': "export * from './def.js';\n",
    'nsReexport.js': "export * as barrel from './def.js';\n",
    'def.js': 'export async function createDispatchItem() {}\n',
  });

  test('witness: a static `import * as ns` is an importer of the target symbol (A0 omitted it)', () => {
    assert.ok(graph.directImportersOf('createDispatchItem').includes('staticNs.js'));
  });

  test('witness: a dynamic `import()` is an importer of the target symbol (A0 omitted it)', () => {
    assert.ok(graph.directImportersOf('createDispatchItem').includes('dynamic.js'));
  });

  test('negative: a star RE-EXPORT is still not a direct named importer (A0 semantics preserved)', () => {
    assert.ok(!graph.directImportersOf('createDispatchItem').includes('starReexport.js'));
  });

  test('negative: a namespace RE-EXPORT (`export * as barrel`) is still not a direct importer', () => {
    assert.ok(!graph.directImportersOf('createDispatchItem').includes('nsReexport.js'));
  });

  test('existing static named/alias semantics are unchanged', () => {
    assert.ok(graph.directImportersOf('createDispatchItem').includes('staticNamed.js'));
    // An aliased import tracks the SOURCE name, so it is an importer of
    // `createDispatchItem` and not of the local alias `enqueue` (A0 semantics).
    assert.ok(graph.directImportersOf('createDispatchItem').includes('alias.js'));
    assert.deepEqual(graph.directImportersOf('enqueue'), []);
  });
});

describe('real corpus at the merge-base', () => {
  // The extension surfaces the two executable relative dynamic imports already
  // recorded in the beat-1/notes: routes/workspace-api-roadmap.js -> lib/prompts/
  // roadmap-chat-template.js and routes/proxy.js -> tests/fixtures/mock-data.js.
  // Neither feeds an A3 credential/dispatch boundary; the extensions that matter
  // for A3 are the static C4 chain (below).
  const graph = buildImportGraph(loadRawSources());

  test('routes/workspace-api-roadmap.js dynamically imports buildRoadmapChatMessages', () => {
    const rec = graph.importsOf('routes/workspace-api-roadmap.js')
      .find((r) => r.specifier === '../lib/prompts/roadmap-chat-template.js');
    assert.equal(rec?.form, 'dynamic');
    assert.equal(graph.reaches('routes/workspace-api-roadmap.js', 'buildRoadmapChatMessages'), true);
  });

  test('routes/proxy.js dynamically imports the mock-data fixture (resolved, target outside the corpus)', () => {
    const rec = graph.importsOf('routes/proxy.js').find((r) => r.specifier === '../tests/fixtures/mock-data.js');
    assert.equal(rec?.form, 'dynamic');
    assert.equal(rec.resolved, 'tests/fixtures/mock-data.js');
  });

  test('C4: routes/proxy-flight-companion.js reaches createDispatchItem through lib/chat-tools.js', () => {
    assert.ok(graph.directImportersOf('createDispatchItem').includes('lib/chat-tools.js'));
    assert.equal(graph.reaches('routes/proxy-flight-companion.js', 'createDispatchItem'), true);
  });
});
