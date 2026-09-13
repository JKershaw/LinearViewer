/**
 * LIN-688 — `undici` was a declared direct runtime dependency
 * (`"undici": "^7.18.2"`) that no source or test file imported. Every in-tree
 * reference is a COMMENT about Node's built-in global `fetch` (a separate
 * undici copy bundled inside the Node binary, not this npm package), HTTP
 * proxying uses `https-proxy-agent`, and there is no WebSocket-client usage —
 * so the package was effectively unused while carrying a high-severity
 * advisory cluster. The fix is removal (the app keeps using Node's built-in
 * `fetch`), per the dependency review that minted this ticket
 * (docs/reviews/dependency-supply-chain-review-2026-06-25.md, finding
 * `undici-advisory-cluster`).
 *
 * That review warned the pin "could become reachable the moment any code does
 * `import { WebSocket } from 'undici'`". These tests make that regression
 * loud, on two independent surfaces:
 *   1. `undici` is not a declared direct dependency (package.json / lock root).
 *   2. No first-party source or test file imports the npm package.
 *
 * Nothing here pins the Node runtime; the deployed Node version is a separate,
 * out-of-scope platform note (the ticket says so explicitly).
 *
 * Run with: node --test tests/unit/lin-688-undici-not-a-dependency.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Directories that hold first-party code/tests. Docs are deliberately excluded
// — they legitimately discuss `import { WebSocket } from 'undici'` as prose.
const SCAN_DIRS = ['lib', 'routes', 'public', 'scripts', 'tests'];
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'test-results', 'playwright-report', 'playwright-report-visual']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

// Strip comments so a source comment that merely mentions the specifier (the
// pre-removal codebase was full of them) is not mistaken for an import.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const UNDICI_IMPORT_RE = /\bfrom\s+['"]undici['"]|require\s*\(\s*['"]undici['"]\s*\)|import\s*\(\s*['"]undici['"]\s*\)/;

describe('LIN-688: undici is not a declared dependency', () => {
  test('package.json declares no undici dependency in any dependency field', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      assert.ok(
        !pkg[field] || !('undici' in pkg[field]),
        `package.json's ${field} must not declare undici — the app uses Node's built-in fetch`
      );
    }
  });

  test('the lockfile root package declares no undici dependency', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
    const rootDeps = lock.packages?.['']?.dependencies ?? {};
    assert.ok(!('undici' in rootDeps), 'package-lock.json root must not carry undici — re-run npm install after editing package.json');
  });
});

describe('LIN-688: no first-party source or test imports the npm undici package', () => {
  test('no import/require of "undici" exists under lib/routes/public/scripts/tests', () => {
    const offenders = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const src = stripComments(readFileSync(file, 'utf8'));
        if (UNDICI_IMPORT_RE.test(src)) offenders.push(relative(ROOT, file));
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `these files import the npm undici package (use Node's built-in fetch / https-proxy-agent instead):\n  ${offenders.join('\n  ')}`
    );
  });

  test('server.js imports no undici package', () => {
    const src = stripComments(readFileSync(join(ROOT, 'server.js'), 'utf8'));
    assert.ok(!UNDICI_IMPORT_RE.test(src), 'server.js must not import the npm undici package');
  });
});
