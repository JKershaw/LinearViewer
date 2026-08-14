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
import { readFileSync } from 'node:fs';
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
const ASSET_RELAY_FILES = ['routes/workspace-api.js', 'routes/proxy.js'];
const KNOWN_ASSET_RELAY_COUNT = 2;

describe('LIN-1899 census (a) — credential-bearing Linear egress mechanisms', () => {
  test('exactly 2 statically Linear-bound GraphQL clients are constructed outside tests', () => {
    const counts = Object.fromEntries(
      GRAPHQL_CLIENT_FILES.map(f => [f, count(read(f), /new GraphQLClient\(/g)])
    );
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    assert.equal(
      total,
      KNOWN_GRAPHQL_CLIENT_COUNT,
      `Found ${total} GraphQL client construction(s) (${JSON.stringify(counts)}), expected exactly ` +
      `${KNOWN_GRAPHQL_CLIENT_COUNT} (lib/audit.js and lib/providers/linear/index.js). A NEW one is a NEW ` +
      'Linear egress mechanism: whatever feeds it a workspace credential must be provider-guarded with ' +
      'isActiveProviderLinear(workspace) (lib/workspace.js) before the call, or the mirror will carry a ' +
      "non-Linear provider's credential to api.linear.app (LIN-1899)."
    );
  });

  test('exactly 2 raw-fetch relays to Linear asset hosts exist under routes/', () => {
    const counts = Object.fromEntries(
      ASSET_RELAY_FILES.map(f => [f, count(read(f), /'uploads\.linear\.app'/g)])
    );
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    assert.equal(
      total,
      KNOWN_ASSET_RELAY_COUNT,
      `Found ${total} Linear asset-host allowlist(s) under routes/ (${JSON.stringify(counts)}), expected exactly ` +
      `${KNOWN_ASSET_RELAY_COUNT}: the image proxy (routes/workspace-api.js, guarded by LIN-1899) and the ` +
      'attachment relay (routes/proxy.js, guarded by LIN-1891). A THIRD relay must withhold its Authorization ' +
      'header for a non-Linear active binding — asset relays degrade (serve the asset, drop the credential); ' +
      'capability endpoints refuse with 422 CAPABILITY_NOT_SUPPORTED.'
    );
  });

  test('both LIN-1899 guard sites still call the shared predicate', () => {
    // Cheap backstop for the one mutation the counts above cannot see: a guard
    // deleted while its call site stays put. Presence only — the behavioural
    // proof lives in the two egress-observing test files named at the top.
    const source = read('routes/workspace-api.js');
    assert.equal(
      count(source, /isActiveProviderLinear\(workspace\)/g),
      2,
      'expected exactly 2 isActiveProviderLinear(workspace) guards in routes/workspace-api.js — the audit ' +
      'route (refuses 422) and the image proxy (withholds the header). If a guard was intentionally removed, ' +
      'the consumer it protected must no longer read workspace.accessToken on a Linear-bound path (LIN-1899).'
    );
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
  test('routes/ has exactly 1 runAudit call site (LIN-1899, guarded)', () => {
    // NOTE the two-part count. A bare /runAudit\(/ match over raw source returns
    // 2 at this HEAD: the call itself plus the prose mention inside the
    // test-mock comment above it ("runAudit() goes straight to GraphQL"). The
    // eviction-census template counts with a bare regex, which would pin a
    // number that is really "1 call + 1 comment" and drift the moment either
    // moves. So the call sites are counted on non-comment lines only, and the
    // total is asserted alongside it to keep the raw grep honest.
    const source = read('routes/workspace-api.js');
    const callSites = source
      .split('\n')
      .filter(line => /runAudit\(/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));

    assert.equal(
      callSites.length,
      1,
      `Found ${callSites.length} runAudit call site(s) in routes/workspace-api.js, expected exactly 1 ` +
      '(GET /workspace/:urlKey/api/audit). runAudit goes straight to a Linear GraphQL client, so a SECOND ' +
      'caller needs its own isActiveProviderLinear(workspace) guard — otherwise a Jira-active workspace ' +
      'discloses its raw API token to api.linear.app (LIN-1899).'
    );
    assert.equal(
      count(source, /runAudit\(/g),
      2,
      'expected 2 raw runAudit( occurrences in routes/workspace-api.js: 1 call site + 1 mention in the ' +
      'test-mock comment. If this drifts, re-check which of the two moved before touching the pinned counts.'
    );
  });

  test('routes/ templates the raw mirror into a Bearer header exactly once (LIN-1899, guarded)', () => {
    const counts = {
      'routes/workspace-api.js': count(read('routes/workspace-api.js'), /Bearer \$\{workspace\.accessToken\}/g),
      'routes/proxy.js': count(read('routes/proxy.js'), /Bearer \$\{workspace\.accessToken\}/g),
      'routes/dashboard.js': count(read('routes/dashboard.js'), /Bearer \$\{workspace\.accessToken\}/g),
    };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    assert.equal(
      total,
      1,
      `Found ${total} raw \`Bearer \${workspace.accessToken}\` template(s) (${JSON.stringify(counts)}), expected ` +
      'exactly 1: the image proxy, whose header object is now conditional on isActiveProviderLinear(workspace). ' +
      'A new one sends whatever credential the active binding holds — Jira, GitHub, or a local urlKey — to ' +
      'whatever host it is pointed at (LIN-1899).'
    );
  });

  test('routes/proxy.js\'s 9 accessor-fed consumers are now discharged (LIN-2044); routes/dashboard.js\'s 2 remain LIN-1912\'s, not yet guarded', () => {
    // Pinned as a HANDOVER UPDATE: LIN-2044 routed every one of routes/proxy.js's
    // former 9 raw resolveWorkspaceAccess( sites through resolveProviderAccess,
    // which resolves the workspace's ACTIVE provider and hands its call sites
    // that provider's own client — never a hardcoded Linear one. The only
    // resolveWorkspaceAccess( call left in the file is resolveProviderAccess's
    // own internal read, so the count below is now 1, not 10.
    const proxyResolves = count(read('routes/proxy.js'), /resolveWorkspaceAccess\(/g);
    const dashboardReads = count(read('routes/dashboard.js'), /getWorkspaceAccessToken\(/g);

    assert.equal(
      proxyResolves,
      1,
      `Found ${proxyResolves} resolveWorkspaceAccess( sites in routes/proxy.js (expected exactly 1: ` +
      'resolveProviderAccess\'s own internal call). LIN-2044 discharged the other 9 by routing them through ' +
      'resolveProviderAccess instead. A count above 1 means a NEW raw resolveWorkspaceAccess( site was added, ' +
      'reintroducing the same disclosure defect LIN-1899 named — it needs the same provider-routing fix, not a ' +
      'guard. A count of 0 means resolveProviderAccess itself was restructured and this pin needs re-grounding.'
    );
    assert.equal(
      dashboardReads,
      2,
      `Found ${dashboardReads} getWorkspaceAccessToken( sites in routes/dashboard.js (expected 2, both ` +
      'LIN-1912\'s, unaffected by LIN-2044 — that ticket scoped routes/proxy.js only). routes/dashboard.js:829 ' +
      'fires on a POLL with no user action, making it the most reachable member of this class — more so than ' +
      'the audit route this ticket was filed for.'
    );
  });
});
