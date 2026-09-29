/**
 * LIN-3129 S1 step 2 — structural source pins for the private mint seam.
 *
 * The invariant is "no bypassable grant-mint path": `#mint` is a true ES
 * private method, only the same-class internal callers may reference it, tests
 * cannot reach it, and the new grant API's callers stay on a named allow-list.
 * At S1 (`mintGrantBootstrap` / `setOwnerCheck`) the grant API was inert; from
 * LIN-3131 S2b.1 the owner seam is wired in production, so its allow-list is
 * exactly `server.js` rather than the empty set — still a tight list, not a
 * loosening.
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

describe('LIN-3129/LIN-3131 — the grant API caller allow-lists', () => {
  const SOURCE_FILES = [
    ...walk(join(REPO, 'routes')),
    ...walk(join(REPO, 'lib')),
    ...walk(join(REPO, 'public')),
    join(REPO, 'server.js')
  ].filter(f => f !== STORE);

  // NARROWED (LIN-3134 T2-i / LIN-3138 S2): the declared-mint mechanism lands
  // the ONE `mintGrantBootstrap` caller, in lib/proxy-preamble.js's declared
  // branch. It is INERT — no production caller passes a non-empty
  // `declaredGrants` — and the LIN-3134 F3 census is the replacement pin that
  // enforces exactly that. This is the same shape of narrowing the requireGrant
  // pin below already took at LIN-3130 S2a: a named, still-tight allow-list, not
  // a loosening — any second caller still fails. (LIN-3131 S2b.2 adds the live
  // runner mint caller in routes/proxy-tokens-admin.js.)
  test('mintGrantBootstrap has exactly one non-store caller: the inert mechanism module lib/proxy-preamble.js', () => {
    const offenders = SOURCE_FILES.filter(f => readFileSync(f, 'utf8').includes('mintGrantBootstrap'));
    assert.deepEqual(offenders, [join(REPO, 'lib/proxy-preamble.js')],
      'the declared-mint mechanism (inert) is the only caller outside lib/proxy-tokens.js');
  });

  // UPDATED (LIN-3131 S2b.1): the owner seam is now wired in production, so the
  // S1 "inert" empty-set pin is replaced by an exact allow-list — the ONE
  // `setOwnerCheck` caller is server.js's late binding, after
  // `accountWorkspaceStore` exists and the seam is composed in
  // lib/workspace-owner.js. Any second caller still fails.
  test('setOwnerCheck is wired in exactly one production site: server.js', () => {
    const offenders = SOURCE_FILES.filter(f => readFileSync(f, 'utf8').includes('setOwnerCheck'));
    assert.deepEqual(offenders, [join(REPO, 'server.js')],
      'S2b.1 late-binds the owner seam only in server.js; any other caller fails');
  });

  // NARROWED (LIN-3130 S2a, autopilot ruling; the approved LIN-3059 plan
  // supersedes the S1-era "no mount yet" pin): S2a mounts requireGrant('take')
  // at the runner sub-router, so the file set is no longer empty — but it must
  // be EXACTLY routes/proxy-runner.js, and the only grant name mounted anywhere
  // under routes/ must be 'take'. requireGrant('dispatch') is LIN-2884's mount,
  // gated on its own merge order (S2b + #1601 deployed + the LIN-1892 backfill),
  // and must not exist yet. This is narrower than the old empty-set assertion,
  // not looser: a second take mount, or any dispatch mount, still fails.
  test('S2a mounts requireGrant(\'take\') in routes/proxy-runner.js only; LIN-2884 owns dispatch', () => {
    // Match an actual mount call, requireGrant('<name>') — not a passing mention.
    const mounts = [];
    for (const file of walk(join(REPO, 'routes'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/requireGrant\s*\(\s*['"]([^'"]+)['"]/g)) {
        mounts.push({ file: file.slice(REPO.length + 1), grant: m[1] });
      }
    }

    const files = [...new Set(mounts.map((m) => m.file))].sort();
    assert.deepEqual(
      files,
      ['routes/proxy-runner.js'],
      'S2a mounts requireGrant only in routes/proxy-runner.js; any additional/other mount fails this pin'
    );

    const grants = [...new Set(mounts.map((m) => m.grant))].sort();
    assert.deepEqual(
      grants,
      ['take'],
      'S2a mounts only the take grant; requireGrant(\'dispatch\') is LIN-2884\'s and must not exist yet'
    );
  });
});
