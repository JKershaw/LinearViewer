/**
 * LIN-3706 — lib/plan-allowance.js is a LEAF: it imports nothing from this repo.
 *
 * `scripts/code-shape/seams.mjs` counts imports between areas but does not see
 * file cycles. A seam that imports a repo module can be imported back by it, so
 * the cheapest proof there is no cycle is that the seam imports nothing but
 * `node:` builtins. Every specifier form is read: static `import`, `export ...
 * from`, dynamic `import()` and `require()`.
 *
 * The scanner is checked against itself (a positive control): the same scan run
 * over a copy of the seam with a repo import added must report that import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEAM = fileURLToPath(new URL('../../lib/plan-allowance.js', import.meta.url));

/** Every module specifier the source names, in any import form. */
export function importedSpecifiers(source) {
  // Strip comments and the contents of template literals' backticks would be
  // overkill; strings in comments are removed so a doc line cannot trip the scan.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const specifiers = [];
  const forms = [
    /\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"();]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const form of forms) {
    for (const match of code.matchAll(form)) specifiers.push(match[1]);
  }
  // A non-literal dynamic import cannot be read, so it is refused outright.
  if (/\bimport\s*\(\s*[^'"\s)]/.test(code) || /\brequire\s*\(\s*[^'"\s)]/.test(code)) {
    specifiers.push('<non-literal>');
  }
  return specifiers;
}

const offenders = (source) => importedSpecifiers(source).filter((spec) => !spec.startsWith('node:'));

test('the seam imports nothing but node: builtins', () => {
  assert.deepEqual(offenders(readFileSync(SEAM, 'utf8')), []);
});

test('positive control: the scan reports a repo import added to a copy of the seam', () => {
  const source = readFileSync(SEAM, 'utf8');
  for (const [label, injected] of [
    ['static', "import { x } from './chat-request.js';"],
    ['bare', "import './free-tier-store.js';"],
    ['re-export', "export { y } from '../routes/dispatch.js';"],
    ['dynamic', "const m = await import('./openrouter.js');"],
    ['require', "const r = require('../server.js');"],
    ['non-literal', 'const n = await import(somewhere);']
  ]) {
    assert.notDeepEqual(offenders(`${injected}\n${source}`), [], `${label} import must be caught`);
  }
  assert.deepEqual(offenders(`import fs from 'node:fs';\n${source}`), [], 'a node: builtin is allowed');
});
