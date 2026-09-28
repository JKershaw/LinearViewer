/**
 * LIN-3129 S1 step 2 — structural source pins for the private mint seam.
 *
 * The invariant is "no bypassable grant-mint path": `#mint` is a true ES
 * private method, only the same-class internal callers may reference it, tests
 * cannot reach it, and nothing outside lib/proxy-tokens.js calls the new grant
 * API (`mintGrantBootstrap` / `setOwnerCheck`) in S1 — it is inert until S2b.
 *
 * Note the `this.#mint(` set is now exactly {createToken, mintGrantBootstrap,
 * exchangeBootstrapToken}: `createToken` is the grant-less wrapper (it passes
 * grants: []), and from beat 3 `exchangeBootstrapToken` calls `#mint` directly
 * for the grant-copy/lineage semantics. Any other method referencing `#mint`
 * fails the pin. A companion assertion ensures the exchange no longer routes
 * through the public `createToken` (which would bypass the grant copy).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');
const STORE = join(REPO, 'lib/proxy-tokens.js');
const storeSource = readFileSync(STORE, 'utf8');

/** Names of the methods (2-space-indented declarations) whose bodies reference `needle`. */
function methodsReferencing(src, needle) {
  const found = [];
  let current = null;
  for (const line of src.split('\n')) {
    const decl = line.match(/^  (?:async\s+)?(#?[A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (decl) current = decl[1];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (line.includes(needle)) found.push(current);
  }
  return found;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('LIN-3129 — #mint is a true private method with an allow-listed caller set', () => {
  test('declared with ES private syntax, not a _convention alias', () => {
    assert.match(storeSource, /async\s+#mint\s*\(/, '#mint must be declared `async #mint(`');
    assert.ok(!/_mint\s*\(/.test(storeSource), 'no underscore-convention mint alias may exist');
  });

  test('createToken remains a public method wrapping #mint', () => {
    assert.match(storeSource, /async\s+createToken\s*\(/, 'createToken must stay public');
  });

  test('only createToken, mintGrantBootstrap and exchangeBootstrapToken reference this.#mint', () => {
    const expected = ['createToken', 'exchangeBootstrapToken', 'mintGrantBootstrap'];
    const refs = [...new Set(methodsReferencing(storeSource, 'this.#mint('))].sort();
    assert.deepEqual(refs, expected, 'the #mint caller set must be exactly the allow-listed three');
  });

  test('exchangeBootstrapToken no longer routes through the public createToken wrapper', () => {
    assert.ok(!/this\.createToken\(/.test(storeSource),
      'exchange must call #mint directly so grant copy + lineage cannot be bypassed by the wrapper');
  });
});

describe('LIN-3129 — the grant API is inert in S1 (no production caller)', () => {
  const SOURCE_FILES = [
    ...walk(join(REPO, 'routes')),
    ...walk(join(REPO, 'lib')),
    ...walk(join(REPO, 'public')),
    join(REPO, 'server.js')
  ].filter(f => f !== STORE);

  for (const name of ['mintGrantBootstrap', 'setOwnerCheck']) {
    test(`nothing outside lib/proxy-tokens.js references ${name}`, () => {
      const offenders = SOURCE_FILES.filter(f => readFileSync(f, 'utf8').includes(name));
      assert.deepEqual(offenders, [], `${name} must have no production caller in S1`);
    });
  }
});
