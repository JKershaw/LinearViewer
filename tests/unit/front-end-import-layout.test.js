/**
 * LIN-4471: the import layout of `public/` (the relative-specifier scheme that makes a page module importable in the
 * browser and in Node). Every import in a `public/` module is a flat `./x.js` sibling or an allow-listed `../lib/x.js`
 * leaf, `public/` has no nested `.js`, and the rule is witnessed against synthetic bad fixtures so a green run means the
 * check can fail. The rule and its reasons are in tests/unit/helpers/front-end-graph.js.
 *
 * Run with: node --test tests/unit/front-end-import-layout.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_MODULES } from '../../lib/vendor-assets.js';
import { importViolations, importSpecifiers } from './helpers/front-end-graph.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = join(ROOT, 'public');

/** Every `.js` file under a directory, recursively, as paths relative to it. */
function jsFilesUnder(dir, rel = '') {
  const out = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = join(rel, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(dir, path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

const publicTop = readdirSync(PUBLIC).filter((f) => f.endsWith('.js') && statSync(join(PUBLIC, f)).isFile());
const publicNames = new Set(publicTop);

describe('public/ is flat', () => {
  test('no .js file lives below public/ top level', () => {
    const nested = jsFilesUnder(PUBLIC).filter((f) => f.includes('/') || f.includes('\\'));
    assert.deepEqual(nested, [], `nested .js under public/: ${nested.join(', ')}`);
  });
});

describe('every import in public/ is a flat sibling or an allow-listed lib leaf', () => {
  for (const file of publicTop) {
    test(`public/${file}`, () => {
      const problems = importViolations({ file, src: readFileSync(join(PUBLIC, file), 'utf8'), publicNames, sharedModules: SHARED_MODULES });
      assert.deepEqual(problems, []);
    });
  }

  test('the bridge and the page that uses the leaf both reach it by the same relative specifier', () => {
    const src = readFileSync(join(PUBLIC, 'cost-format-global.js'), 'utf8');
    assert.deepEqual(importSpecifiers(src).map((i) => i.specifier), ['../lib/cost-format.js']);
  });
});

describe('the rule is witnessed by synthetic bad fixtures (each must be named)', () => {
  const cases = [
    ['a nested .js in public/', { file: 'page.js', src: "import { x } from './sub/x.js';", expect: /nested/ }],
    ['a lib file that is not on the allow-list', { file: 'page.js', src: "import { r } from '../lib/render.js';", expect: /not a SHARED_MODULES leaf/ }],
    ['a bare specifier', { file: 'page.js', src: "import express from 'express';", expect: /not a relative/ }],
    ['an absolute specifier', { file: 'page.js', src: "import { formatUsd } from '/lib/cost-format.js';", expect: /not a relative/ }],
    ['a traversal out of lib/', { file: 'page.js', src: "import s from '../server.js';", expect: /not a relative/ }],
    ['a sibling that does not exist', { file: 'page.js', src: "import { x } from './missing.js';", expect: /not a file in public/ }],
    ['a nested lib path', { file: 'page.js', src: "import { x } from '../lib/utils/html.js';", expect: /nested under lib/ }],
    ['a dynamic import of a bare name', { file: 'page.js', src: "const m = await import('lodash');", expect: /not a relative/ }],
  ];
  for (const [label, { file, src, expect }] of cases) {
    test(`${label} is a violation`, () => {
      const problems = importViolations({ file, src, publicNames, sharedModules: SHARED_MODULES });
      assert.ok(problems.some((p) => expect.test(p)), `expected ${expect} in ${JSON.stringify(problems)}`);
    });
  }

  test('a listed leaf and a flat sibling are not violations (the negative control)', () => {
    const src = "import { formatUsd } from '../lib/cost-format.js';\nimport { x } from './chart-helpers.js';";
    assert.deepEqual(importViolations({ file: 'page.js', src, publicNames, sharedModules: SHARED_MODULES }), []);
  });

  test('the leaf map is read from SHARED_MODULES: a leaf added there is allowed, with no second list to edit', () => {
    const extended = { ...SHARED_MODULES, '/lib/extra.js': 'lib/extra.js' };
    const src = "import { e } from '../lib/extra.js';";
    assert.deepEqual(importViolations({ file: 'page.js', src, publicNames, sharedModules: extended }), []);
    assert.equal(importViolations({ file: 'page.js', src, publicNames, sharedModules: SHARED_MODULES }).length, 1);
  });
});
