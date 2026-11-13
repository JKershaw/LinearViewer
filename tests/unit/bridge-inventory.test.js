/**
 * LIN-4471: the bridge inventory over the real repo, and the same checks on synthetic inputs, so the check can fail.
 * The bridge is `public/cost-format-global.js` (one shim, one name). The real repo must have one declared name, that
 * name's one emitter, and exactly the registered readers, each with a witness. The renderer-coverage half of the old
 * shim guard (shared-modules.test.js, before LIN-4471) is here: every script list that names a consumer also names the
 * shim as a module. Rules and helpers: tests/unit/helpers/bridge-inventory.js.
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
const SHIM = '/cost-format-global.js';
const BRIDGED = ['CostFormat'];
/** Registered readers of the bridge, each with the witness that loads it first and installs the global after. */
const CONSUMERS = {
  '/flight-companion.js': 'tests/unit/cost-format-consumers.test.js',
  '/observation.js': 'tests/unit/observation-scan-due.test.js',
  '/prompt-section.js': 'tests/unit/lin-3833-run-control.test.js',
};

function realInputs() {
  const rendererFiles = readdirSync(join(ROOT, 'lib')).filter((f) => f.endsWith('.js'));
  const renderers = [];
  const emittedNames = new Set();
  for (const f of rendererFiles) {
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

describe('the bridge over the real repo', () => {
  const inputs = realInputs();
  const result = bridgeProblems({
    bridged: BRIDGED,
    shim: SHIM,
    emitted: inputs.emitted,
    pages: inputs.pages,
    renderers: inputs.renderers,
    consumers: CONSUMERS,
    fileExists: (p) => existsSync(join(ROOT, p)),
    readText: (p) => read(p),
  });

  test('the inventory is clean: one declared name, one emitter, the registered readers, each witnessed', () => {
    assert.deepEqual(result.problems, []);
  });

  test('the one emitter of the bridge is the shim, and it is the only module that writes a bridged name', () => {
    assert.deepEqual([...result.written], BRIDGED);
    assert.deepEqual(Object.keys(inputs.emitted).filter((f) => bridgeWrites(inputs.emitted[f]).size), ['cost-format-global.js']);
  });

  test('the emitted modules are the shim and the one page module that imports the formatter directly', () => {
    assert.deepEqual(Object.keys(inputs.emitted).sort(), ['cost-format-global.js', 'workspace-kpis.js']);
  });

  test('the bridge keeps exactly three classic readers, and the workspace KPIs page is not one', () => {
    assert.deepEqual([...result.readers.keys()].sort(), Object.keys(CONSUMERS).sort());
    assert.equal(result.readers.has('/workspace-kpis.js'), false);
  });
});

describe('the checks fail on each synthetic breach (witnesses for the inventory)', () => {
  const base = () => {
    const inputs = realInputs();
    return {
      bridged: BRIDGED,
      shim: SHIM,
      emitted: { ...inputs.emitted },
      pages: { ...inputs.pages },
      renderers: inputs.renderers,
      consumers: { ...CONSUMERS },
      fileExists: () => true,
      readText: () => 'loadCostFormat(world.sandbox);',
    };
  };
  const run = (overrides) => bridgeProblems({ ...base(), ...overrides }).problems;

  test('growth: a module writes a new name, nested in a function, and the check names it', () => {
    const emitted = { ...realInputs().emitted, 'cost-format-global.js': 'function f() { window.Other = 1; }\n' + realInputs().emitted['cost-format-global.js'] };
    const problems = run({ emitted });
    assert.ok(problems.some((p) => /writes window\.Other: a new bridge name/.test(p)), problems.join('\n'));
  });

  test('last consumer removed: a registered consumer that no longer reads leaves the table in the same change', () => {
    const pages = { ...realInputs().pages, 'observation.js': "'use strict';\nfunction draw() { return 1; }\n" };
    const problems = run({ pages });
    assert.ok(problems.some((p) => /observation\.js is a registered consumer but no longer reads/.test(p)), problems.join('\n'));
  });

  test('an unregistered reader: a classic script reads the bridge bare, and the message states the timing rule', () => {
    const pages = { ...realInputs().pages, 'swipe.js': "document.addEventListener('DOMContentLoaded', () => CostFormat.formatUsd(1));\n" };
    const problems = run({ pages });
    const hit = problems.find((p) => /swipe\.js reads window\.CostFormat but is not a registered consumer/.test(p));
    assert.ok(hit, problems.join('\n'));
    assert.match(hit, /DOMContentLoaded/);
  });

  test('a window. read by a registered-looking file in a different spelling is still a read (window.CostFormat, not bare)', () => {
    assert.deepEqual([...bridgeReads("const f = window.CostFormat.formatUsd;", BRIDGED)], ['CostFormat']);
    assert.deepEqual([...bridgeReads("const o = { CostFormat: 1 }; o.CostFormat;", BRIDGED)], []);
  });

  test('a declared name that no module writes is named for deletion', () => {
    const emitted = { 'cost-format-global.js': "import { formatUsd } from '../lib/cost-format.js';\n" };
    const problems = run({ emitted });
    assert.ok(problems.some((p) => /window\.CostFormat is declared but no emitted module writes it/.test(p)), problems.join('\n'));
  });

  test('a renderer that names a consumer without the module shim fails', () => {
    const renderers = [{ rel: 'lib/render-fake.js', entries: [{ src: '/prompt-section.js', module: false }] }];
    const problems = run({ renderers });
    assert.ok(problems.some((p) => /lib\/render-fake\.js lists a consumer .* without the module shim/.test(p)), problems.join('\n'));
  });

  test('a witness that is missing, or never calls loadCostFormat, fails', () => {
    assert.ok(run({ fileExists: () => false }).some((p) => /its witness .* does not exist/.test(p)));
    assert.ok(run({ readText: () => '// no loader here' }).some((p) => /never calls loadCostFormat/.test(p)));
  });
});
