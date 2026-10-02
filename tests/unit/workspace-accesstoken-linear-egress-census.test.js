/**
 * LIN-1899 — census of the "workspace credential → statically Linear-bound
 * egress" class, so a 12th unguarded site cannot be added silently.
 *
 * WHAT THIS CLASS IS. `workspace.accessToken` is a PROVIDER-AGNOSTIC scalar
 * mirror: `linkProvider` (lib/workspace.js:303) and `mirrorActiveBinding`
 * (:417) write it for every provider, so on a Jira-active workspace it holds a
 * raw Jira API token. Any consumer that reads it (directly, or via
 * `resolveWorkspaceAccess()`/`getWorkspaceAccessToken()`) and hands it to a
 * client hard-wired to a Linear host discloses that credential to an unrelated
 * third party. Constraining the mirror is NOT the fix — the Jira Basic-auth
 * lane (LIN-1885, lib/workspace.js:566-584) and the headless liveness gate
 * (lib/workspace-token-resolver.js:113) both read it, and emptying it would
 * break both. The fix is per-consumer provider guards, so the SET of consumers
 * is what has to stay pinned.
 *
 * HONESTY ABOUT WHAT THIS PROVES, in the same spirit as
 * tests/unit/workspace-token-eviction-census.test.js: these are source-text
 * counts. They pin the SET of sites, not their correctness — a guard in the
 * wrong place still passes here. The behavioural witnesses are
 * tests/unit/audit-route-provider-guard.test.js and the LIN-1899 block in
 * tests/unit/image-proxy.test.js (both assert on OUTBOUND requests, because a
 * status-keyed assertion passes on the vulnerable code).
 *
 * OWNERSHIP SPLIT, recorded here so a maintainer who trips this test finds it
 * rather than a bare magic number:
 *   - LIN-1899 (this ticket) guards the audit route + the image proxy, adds the
 *     shared `isActiveProviderLinear` predicate, and lands this census.
 *   - LIN-1912 originally owned the remaining NINE accessor-fed consumers (7 in
 *     routes/proxy.js's agent/compute lane, 2 in routes/dashboard.js). LIN-2044
 *     discharged routes/proxy.js's share: its 9 compute-lane sites no longer
 *     read the raw Linear-bound mirror at all — they resolve the workspace's
 *     ACTIVE provider via resolveProviderAccess and call that provider's own
 *     method, so a Jira-active workspace's recap/brief/recommend/prompt/stack
 *     calls now hit Jira, not api.linear.app. routes/dashboard.js's 2 sites
 *     remain LIN-1912's, unguarded, reusing the same predicate against the
 *     resolved provider name when picked up.
 *
 * Run with: node --test tests/unit/workspace-accesstoken-linear-egress-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(repoRoot, relPath), 'utf8');
}

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

// LIN-3219 A3 helpers (pure over `{file, src}` / source, so witnesses can plant).
function nonLinearGraphQLSites(files) {
  const out = [];
  for (const [f, src] of files) {
    for (const l of src.split('\n')) {
      if (l.includes('new GraphQLClient(') && !/api\.linear\.app|LINEAR_API_ENDPOINT/.test(l)) out.push(`${f}: ${l.trim()}`);
    }
  }
  return out;
}

function loneAssetHostLines(files) {
  const out = [];
  for (const [f, src] of files) {
    for (const l of src.split('\n')) {
      if (l.includes("'uploads.linear.app'") && !l.includes("'cdn.linear.app'")) out.push(`${f}: ${l.trim()}`);
    }
  }
  return out;
}

function guardCoverageOffenders(source) {
  const guards = (source.match(/isActiveProviderLinear\(workspace\)/g) || []).length;
  const egress = source.split('\n').filter((l) => /\brunAudit\(/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)).length
    + (source.match(/Bearer \$\{getWorkspaceMirrorToken\(workspace\)\}/g) || []).length;
  if (egress === 0) return ['no credential-egress site found'];
  if (guards !== egress) return [`guards (${guards}) != credential-egress sites (${egress})`];
  return [];
}

const MIRROR_BEARER_RE = /Bearer \$\{(?:workspace\.accessToken|getWorkspaceMirrorToken\(workspace\))\}/;

function routeFiles() {
  return readdirSync(join(__dirname, '../../routes'))
    .filter((n) => n.endsWith('.js') && n !== 'test.js')
    .map((n) => `routes/${n}`);
}

function unguardedRunAuditCallers(files) {
  const out = [];
  for (const [f, src] of files) if (/\brunAudit\(/.test(src) && !/isActiveProviderLinear\(workspace\)/.test(src)) out.push(f);
  return out.sort();
}

function unguardedMirrorBearerFiles(files) {
  const out = [];
  for (const [f, src] of files) if (MIRROR_BEARER_RE.test(src) && !/isActiveProviderLinear\(workspace\)/.test(src)) out.push(f);
  return out.sort();
}

function tokenCallerFiles(files) {
  return [...files].filter(([, src]) => /\bgetWorkspaceAccessToken\(/.test(src)).map(([f]) => f).sort();
}

/** Readers of getWorkspaceAccessToken( that do NOT receive it as an injected dep. */
function uninjectedTokenReaders(files) {
  const out = [];
  for (const [f, src] of files) {
    if (/\bgetWorkspaceAccessToken\(/.test(src) && !/getWorkspaceAccessToken\s*[,=]/.test(src)) out.push(f);
  }
  return out.sort();
}

// =============================================================================
// Counter (a) — credential-bearing, statically Linear-bound EGRESS MECHANISMS
// =============================================================================
//
// The shapes a workspace credential can actually leave through. Four today:
//
//   1. lib/audit.js:180                  new GraphQLClient('https://api.linear.app/graphql')
//   2. lib/providers/linear/index.js:74  new GraphQLClient(LINEAR_API_ENDPOINT)  [createLinearClient]
//   3. routes/workspace-api.js           image-proxy fetch    → guarded by LIN-1899
//   4. routes/proxy.js                   attachment relay     → guarded by LIN-1891
//
// (1) is fed by the audit route (guarded here); (2) is fed by routes/dashboard.js's
// 2 remaining accessor sites (LIN-1912) — routes/proxy.js's 9 were discharged by
// LIN-2044's provider-routing fix, so they no longer feed this mechanism at all;
// (3) and (4) are raw fetches to Linear ASSET hosts, each gated by its own host
// allowlist, which is what the second sub-count anchors on.
//
// DELIBERATELY EXCLUDED, and why: the two OAuth token endpoints
// (lib/token-refresh.js:77, lib/providers/linear/index.js:2218) also talk to
// api.linear.app, but authenticate from a refresh token / client secret — never
// from the active-binding mirror — so they are not in this class. Also excluded:
// lib/render.js:109 and lib/proxy-wire.js:104, which name the same Linear asset
// hosts to REWRITE markup into same-origin proxy URLs; neither performs egress.
//
// A FIFTH mechanism means a new egress shape that needs its own provider guard.

const GRAPHQL_CLIENT_FILES = ['lib/audit.js', 'lib/providers/linear/index.js', 'routes/proxy.js', 'routes/workspace-api.js', 'server.js'];
const KNOWN_GRAPHQL_CLIENT_COUNT = 2;

// The two raw-fetch asset relays, anchored by the host allowlist that gates each.
// routes/proxy-reads.js (LIN-679 Stage 3a / LIN-2536): the attachment relay
// moved out of routes/proxy.js — widen the file set, never relax the count.
const ASSET_RELAY_FILES = ['routes/workspace-api.js', 'routes/proxy.js', 'routes/proxy-reads.js'];
const KNOWN_ASSET_RELAY_COUNT = 2;

describe('LIN-1899 census (a) — credential-bearing Linear egress mechanisms', () => {
  test('every GraphQL client construction in the scoped files is statically Linear-bound (no count)', () => {
    // Boundary rule (LIN-3219 A3): a GraphQL client here may only be constructed
    // against the Linear endpoint — anything else would be an unrelated egress.
    const sites = GRAPHQL_CLIENT_FILES.flatMap((f) => read(f).split('\n')
      .filter((l) => l.includes('new GraphQLClient('))
      .map((l) => ({ f, l })));
    assert.ok(sites.length > 0, 'a zero-client scan would be vacuous');
    const offenders = sites
      .filter(({ l }) => !/api\.linear\.app|LINEAR_API_ENDPOINT/.test(l))
      .map(({ f, l }) => `${f}: ${l.trim()}`);
    assert.deepEqual(offenders, [], `non-Linear GraphQL client construction(s): ${offenders.join(' | ')}`);
  });

  test('WITNESS: a non-Linear GraphQL client construction fails', () => {
    const offenders = nonLinearGraphQLSites(new Map([['lib/audit.js', "const c = new GraphQLClient('https://example.com', {});\n"]]));
    assert.ok(offenders.length > 0, 'the planted non-Linear client must be an offender');
  });

  test('every Linear asset-host allowlist in the relay files also allows cdn.linear.app (one allowlist shape, no count)', () => {
    // Boundary rule (LIN-3219 A3): a relay's host allowlist is the one shape
    // (`uploads` + `cdn`), so a stray single-host allowlist is an offender.
    const files = ASSET_RELAY_FILES.map((f) => [f, read(f)]);
    const sites = files.flatMap(([f, src]) => src.split('\n').filter((l) => l.includes("'uploads.linear.app'")).map((l) => ({ f, l })));
    assert.ok(sites.length > 0, 'a zero-relay scan would be vacuous');
    const offenders = sites.filter(({ l }) => !l.includes("'cdn.linear.app'")).map(({ f, l }) => `${f}: ${l.trim()}`);
    assert.deepEqual(offenders, [], `lone uploads.linear.app allowlists: ${offenders.join(' | ')}`);
  });

  test('WITNESS: a lone uploads.linear.app allowlist (no cdn) fails', () => {
    const offenders = loneAssetHostLines(new Map([['routes/workspace-api.js', "const allowedHosts = new Set(['uploads.linear.app'])\n"]]));
    assert.ok(offenders.length > 0, 'the planted lone host must be an offender');
  });

  test('workspace-api.js carries one isActiveProviderLinear(space) guard per credential-egress site (no count)', () => {
    // Derived relation (LIN-3219 A3): guards must equal the egress sites they
    // protect — a new runAudit/Bearer-mirror site with no guard breaks it.
    const source = read('routes/workspace-api.js');
    assert.deepEqual(guardCoverageOffenders(source), []);
  });

  test('WITNESS: an extra egress site with no guard fails', () => {
    const source = read('routes/workspace-api.js') + '\nconst r = await runAudit(getWorkspaceMirrorToken(workspace));\n';
    assert.ok(guardCoverageOffenders(source).length > 0, 'the planted unguarded egress site must be an offender');
  });
});

// =============================================================================
// Counter (b) — the provider-agnostic scalar FEEDS into those mechanisms
// =============================================================================
//
// Greppable counts of the call sites that hand the mirror to counter (a)'s
// mechanisms. This counts FEEDS, not reads, which is why it does not pin the
// raw ~44-hit `.accessToken` grep — most of those are `=== 'test-token'`
// test-mode comparisons that perform no egress. routes/test.js is test-only
// (see its header) and excluded by path.

describe('LIN-1899 census (b) — scalar feeds, by owner', () => {
  test('every route file calling runAudit( guards with isActiveProviderLinear(space) (no count)', () => {
    // Boundary rule (LIN-3219 A3): runAudit goes straight to a Linear GraphQL
    // client, so any route file that calls it must carry the provider guard.
    const callers = routeFiles().filter((f) => /\brunAudit\(/.test(read(f)));
    assert.ok(callers.length > 0, 'a zero-caller scan would be vacuous');
    const offenders = callers.filter((f) => !/isActiveProviderLinear\(workspace\)/.test(read(f)));
    assert.deepEqual(offenders, [], `runAudit( callers without the provider guard: ${offenders.join(', ')}`);
  });

  test('WITNESS: a runAudit( caller without the guard fails', () => {
    const offenders = unguardedRunAuditCallers(new Map([['routes/zz-audit.js', 'const r = await runAudit(getWorkspaceMirrorToken(workspace));\n']]));
    assert.ok(offenders.includes('routes/zz-audit.js'), `expected routes/zz-audit.js, got ${JSON.stringify(offenders)}`);
  });

  test('every raw-mirror Bearer template is in a file that guards with isActiveProviderLinear(space) (no count)', () => {
    // Boundary rule (LIN-3219 A3): a raw-mirror Bearer template must sit in a
    // file that carries the provider guard. The scanner matches either the
    // legacy inline read or the S0 accessor.
    const files = ['routes/workspace-api.js', 'routes/proxy.js', 'routes/dashboard.js'];
    const holders = files.filter((f) => MIRROR_BEARER_RE.test(read(f)));
    assert.ok(holders.length > 0, 'a zero-Bearer scan would be vacuous');
    const offenders = holders.filter((f) => !/isActiveProviderLinear\(workspace\)/.test(read(f)));
    assert.deepEqual(offenders, [], `raw-mirror Bearer templates without the provider guard: ${offenders.join(', ')}`);
  });

  test('WITNESS: a raw-mirror Bearer template in an unguarded file fails', () => {
    const offenders = unguardedMirrorBearerFiles(new Map([['routes/zz-mirror.js', 'Authorization: `Bearer ${getWorkspaceMirrorToken(workspace)}`\n']]));
    assert.ok(offenders.includes('routes/zz-mirror.js'), `expected routes/zz-mirror.js, got ${JSON.stringify(offenders)}`);
  });

  test('every resolveWorkspaceAccess( in routes/proxy.js is inside resolveProviderAccess (no count)', () => {
    const src = read('routes/proxy.js');
    const start = src.indexOf('async function resolveProviderAccess');
    const end = src.indexOf('\n  }', start);
    assert.ok(start >= 0 && end > start, 'resolveProviderAccess not found');
    const sites = [...src.matchAll(/await resolveWorkspaceAccess\(/g)].map((m) => m.index);
    assert.ok(sites.length > 0, 'a zero-resolve scan would be vacuous');
    const outside = sites.filter((i) => i < start || i > end);
    assert.deepEqual(outside, [], `resolveWorkspaceAccess( outside the chokepoint at offsets ${JSON.stringify(outside)}`);
  });

  test('every getWorkspaceAccessToken( reader receives it as an injected dependency (no per-file counts)', () => {
    // Boundary rule (LIN-3219 A3): the symbol is module-private to server.js and
    // injected into route factories, so a reader that does not receive it as a
    // dependency (no `getWorkspaceAccessToken,`/`=`) is an offender.
    const readers = routeFiles().filter((f) => /\bgetWorkspaceAccessToken\(/.test(read(f)));
    assert.ok(readers.length > 0, 'a zero-reader scan would be vacuous');
    assert.deepEqual(uninjectedTokenReaders(readers.map((f) => [f, read(f)])), [], 'readers without the injected dependency');
  });

  test('WITNESS: a resolveWorkspaceAccess( outside the chokepoint, and a getWorkspaceAccessToken( reader without the dep, both fail', () => {
    const src = read('routes/proxy.js') + '\nconst t = await resolveWorkspaceAccess(req.proxyUrlKey);\n';
    const start = src.indexOf('async function resolveProviderAccess');
    const end = src.indexOf('\n  }', start);
    const outside = [...src.matchAll(/await resolveWorkspaceAccess\(/g)].map((m) => m.index).filter((i) => i < start || i > end);
    assert.ok(outside.length > 0, 'the planted out-of-chokepoint resolve must be an offender');
    const offenders = uninjectedTokenReaders(new Map([['routes/zz-token.js', 'const t = await getWorkspaceAccessToken(k, req.session);\n']]));
    assert.ok(offenders.includes('routes/zz-token.js'), `expected routes/zz-token.js, got ${JSON.stringify(offenders)}`);
  });
});
