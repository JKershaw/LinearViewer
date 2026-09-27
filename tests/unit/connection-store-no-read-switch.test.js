/**
 * N3 static no-read-switch guard (LIN-3127).
 *
 * The Connection store is write-only this ticket: LIN-3124 owns the read
 * cutover. This test enforces that boundary structurally rather than trusting
 * review:
 *
 *   (a) the set of production modules importing lib/connection-store.js is
 *       EXACTLY the allow-list — five writers, no more;
 *   (b) no non-test source calls `connectionStore.get(` (the store's only read
 *       method, added solely so the acceptance witness can stub it to throw);
 *   (c) the protected read modules import nothing from connection-store;
 *   (d) no provider index.js imports it.
 *
 * Run with: node --test tests/unit/connection-store-no-read-switch.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// Production source roots scanned for imports/usages.
const SOURCE_DIRS = ['lib', 'routes'];
const SOURCE_FILES = ['server.js'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'tests', 'test-results', 'public', 'docs', 'plans', 'prototypes', 'content', 'data', '.github']);

// N3(a): the exact set of production modules allowed to import the store.
const ALLOWED_IMPORTERS = [
  'server.js',
  'routes/auth.js',
  'routes/account-merge.js',
  'lib/github-install-flow.js',
  'routes/jira-auth.js',
];

// N3(c): protected read modules — must import NOTHING from connection-store.
const PROTECTED_MODULES = [
  'lib/workspace-token-resolver.js',
  'lib/workspace-token-refresh.js',
  'lib/credential-invariant-sweep.js',
  'routes/workspace-api.js',
  'lib/workspace.js',
];

function listSourceFiles() {
  const out = [];
  for (const rel of SOURCE_FILES) out.push(rel);
  for (const dir of SOURCE_DIRS) {
    const walk = (abs) => {
      for (const entry of readdirSync(abs)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(abs, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (entry.endsWith('.js')) out.push(relative(ROOT, full));
      }
    };
    walk(join(ROOT, dir));
  }
  return out;
}

function importsConnectionStore(source) {
  return /from\s+['"][^'"]*connection-store\.js['"]/.test(stripComments(source));
}

/**
 * Remove block and line comments so a prose mention (e.g. the store module's
 * own doc referencing `connectionStore.get(`) is never mistaken for code.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('LIN-3127 N3 — static no-read-switch guard', () => {
  const files = listSourceFiles();
  const importers = files.filter(rel => importsConnectionStore(readFileSync(join(ROOT, rel), 'utf8')));

  test('(a) only the allow-listed production modules import the Connection store', () => {
    assert.deepStrictEqual(
      [...new Set(importers)].sort(),
      [...ALLOWED_IMPORTERS].sort(),
      'connection-store importers must be exactly the allow-list (add a module only with a read-cutover ticket)'
    );
  });

  test('(b) no non-test source calls connectionStore.get(', () => {
    const offenders = [];
    for (const rel of files) {
      const source = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      if (/connectionStore\s*\??\.\s*get\s*\(/.test(source)) offenders.push(rel);
    }
    assert.deepStrictEqual(offenders, [], 'the store is write-only this ticket; `get` is a test-only read');
  });

  test('(c) the protected read modules import nothing from connection-store', () => {
    for (const rel of PROTECTED_MODULES) {
      const source = readFileSync(join(ROOT, rel), 'utf8');
      assert.equal(importsConnectionStore(source), false, `${rel} must not import connection-store`);
    }
    // Belt-and-braces: the protected set is a strict subset of the allow-list.
    for (const rel of PROTECTED_MODULES) assert.ok(!ALLOWED_IMPORTERS.includes(rel), `${rel} must never be allow-listed`);
  });

  test('(d) no provider index.js imports connection-store', () => {
    const providerIndexes = files.filter(rel => /^lib\/providers\/[^/]+\/index\.js$/.test(rel));
    assert.ok(providerIndexes.length > 0, 'expected provider index.js files to scan');
    for (const rel of providerIndexes) {
      const source = readFileSync(join(ROOT, rel), 'utf8');
      assert.equal(importsConnectionStore(source), false, `${rel} must not import connection-store (store is threaded from server.js, LIN-675)`);
    }
  });
});
