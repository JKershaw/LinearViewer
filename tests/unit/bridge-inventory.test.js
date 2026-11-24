/**
 * LIN-4471, LIN-4463 piece 5: the bridge inventory over the real repo, and the same checks on synthetic inputs, so the
 * check can fail. The bridge is at zero: the CostFormat shim (public/cost-format-global.js) and its witness loader
 * (tests/fixtures/browser-cost-format.js) were deleted when prompt-section.js, its last classic reader, became a module.
 * So no emitted module may write a global, except the declared e2e hooks, which no classic script may read. Rules and
 * helpers: tests/unit/helpers/bridge-inventory.js.
 *
 * Run with: node --test tests/unit/bridge-inventory.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeProblems, bridgeReads, bridgeWrites } from './helpers/bridge-inventory.js';
import { scriptLists } from './helpers/renderer-scripts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** E2e hooks: names a module writes only so a browser spec can call them, never read by a classic script (LIN-4463 piece 5). */
const HOOKS = {
  refreshWaitingOnYou: 'tests/e2e/lin-4242-waiting-live.spec.js',
};

function realInputs() {
  const renderers = [];
  const emittedNames = new Set();
  for (const f of readdirSync(join(ROOT, 'lib')).filter((n) => n.endsWith('.js'))) {
    for (const entries of scriptLists(read(`lib/${f}`))) {
      renderers.push({ rel: `lib/${f}`, entries });
      for (const e of entries) if (e.module) emittedNames.add(e.src);
    }
  }
  const pages = {};
  const emitted = {};
  for (const f of readdirSync(join(ROOT, 'public')).filter((n) => n.endsWith('.js'))) {
    pages[f] = read(`public/${f}`);
    if (emittedNames.has(`/${f}`)) emitted[f] = pages[f];
  }
  return { renderers, emitted, pages };
}

const realRun = (overrides = {}) => {
  const inputs = realInputs();
  return bridgeProblems({
    emitted: inputs.emitted,
    pages: inputs.pages,
    hooks: HOOKS,
    fileExists: (p) => existsSync(join(ROOT, p)),
    readText: (p) => read(p),
    ...overrides,
  });
};

describe('the bridge over the real repo', () => {
  const inputs = realInputs();

  test('the inventory is clean: no module writes a global but the declared e2e hook', () => {
    assert.deepEqual(realRun().problems, []);
    assert.deepEqual([...realRun().hooksWritten], Object.keys(HOOKS));
  });

  test('the bridge files are gone: the shim, its witness loader, and every renderer entry for it', () => {
    assert.equal(existsSync(join(ROOT, 'public/cost-format-global.js')), false);
    assert.equal(existsSync(join(ROOT, 'tests/fixtures/browser-cost-format.js')), false);
    for (const { rel, entries } of inputs.renderers) {
      assert.equal(entries.some((e) => e.src === '/cost-format-global.js'), false, rel);
    }
  });

  test('no public script reads window.CostFormat any more', () => {
    for (const [file, src] of Object.entries(inputs.pages)) {
      assert.deepEqual([...bridgeReads(src, ['CostFormat'], { sourceType: 'module' })], [], file);
    }
  });

  test('the emitted modules are the converted pages (workspace-kpis.js, task-page.js, flight-companion.js, observation.js, question-records.js LIN-4532, swipe.js and app.js LIN-4463 piece 5)', () => {
    // prompt-section.js is a module too, but no renderer lists it: app.js, swipe.js and task-page.js import it.
    assert.deepEqual(Object.keys(inputs.emitted).sort(), ['app.js', 'flight-companion.js', 'observation.js', 'question-records.js', 'swipe.js', 'task-page.js', 'workspace-kpis.js']);
  });

  test('the renderer lists the check reads include the const SCRIPTS shape (the task page), so a list the reader cannot match fails here', () => {
    // A rewrite of a list the reader does not model (`Object.freeze([...])`, say) would drop that renderer's modules from
    // the check without a failure, so the task page's list (the one written as a const) is pinned by its modules.
    const taskPage = inputs.renderers.find((r) => r.rel === 'lib/render-task-page.js');
    assert.ok(taskPage, 'lib/render-task-page.js (the const SCRIPTS shape) is among the lists read');
    assert.ok(taskPage.entries.some((e) => e.module && e.src === '/task-page.js'));
  });

  test('a list written as Object.freeze([...]) is not read: the pin above is what catches it', () => {
    assert.deepEqual(scriptLists("const SCRIPTS = Object.freeze(['/common.js', '/prompt-section.js']);"), []);
  });
});

describe('the checks fail on each synthetic breach (witnesses for the inventory)', () => {
  test('growth: a module writes a global, nested in a function, and the check names it', () => {
    const emitted = { ...realInputs().emitted, 'swipe.js': 'function f() { window.CostFormat = 1; }\n' };
    assert.ok(realRun({ emitted }).problems.some((p) => /swipe\.js writes window\.CostFormat: a bridge/.test(p)));
  });

  test('a window. write in another spelling is still a write; a property of another object is not', () => {
    assert.deepEqual([...bridgeWrites('globalThis.X = 1; self.Y = 2; const o = {}; o.Z = 3;')], ['X', 'Y']);
    assert.deepEqual([...bridgeReads('const f = window.CostFormat.formatUsd;', ['CostFormat'])], ['CostFormat']);
    assert.deepEqual([...bridgeReads('const o = { CostFormat: 1 }; o.CostFormat;', ['CostFormat'])], []);
  });

  test('an e2e hook read by a classic script is a bridge and fails; an undeclared hook is a bridge write', () => {
    const pages = { ...realInputs().pages, 'dispatch.js': "document.addEventListener('click', () => window.refreshWaitingOnYou());\n" };
    assert.ok(realRun({ pages }).problems.some((p) => /dispatch\.js reads window\.refreshWaitingOnYou, an e2e hook/.test(p)));
    assert.ok(realRun({ hooks: {} }).problems.some((p) => /app\.js writes window\.refreshWaitingOnYou: a bridge/.test(p)));
  });

  test('a declared hook no module writes, whose spec is missing, or whose spec never calls it, fails', () => {
    assert.ok(realRun({ hooks: { ...HOOKS, gone: HOOKS.refreshWaitingOnYou } }).problems.some((p) => /window\.gone is a declared e2e hook but no emitted module writes it/.test(p)));
    assert.ok(realRun({ fileExists: () => false }).problems.some((p) => /its e2e spec .* does not exist/.test(p)));
    assert.ok(realRun({ readText: () => '// no hook here' }).problems.some((p) => /window\.refreshWaitingOnYou: its e2e spec .* never calls it/.test(p)));
  });
});
