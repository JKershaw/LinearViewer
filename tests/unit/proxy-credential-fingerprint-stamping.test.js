/**
 * LIN-1980 — pins that all 10 `resolveWorkspaceAccess`-consuming surfaces in
 * routes/proxy.js stamp `req.resolvedCredentialFingerprint` before any other
 * logic (including the `!token`/`!accessToken` early return), so a future
 * 11th call site — or an edit to one of the existing ten — can't silently
 * reintroduce the "markSuspect can't fire from this route" gap the plan's
 * F1/round-2 review findings identified.
 *
 * Deliberately a NEW file rather than folded into
 * workspace-accesstoken-linear-egress-census.test.js: that census pins a
 * DIFFERENT class (LIN-1899's Linear-bound egress mechanisms) that happens to
 * share the same `resolveWorkspaceAccess(` regex target for its site COUNT.
 * This file pins what happens AT each of those sites, which is LIN-1980's
 * concern, not LIN-1899's. tests/unit/workspace-accesstoken-linear-egress-census.test.js:195-205
 * remains the count-of-10 pin; this file is the per-site stamping pin the
 * plan's own review asked for ("a single shared test asserting all 10 sites
 * stamp req.resolvedCredentialFingerprint before returning").
 *
 * Source-text census, in the same spirit and with the same honesty caveat as
 * the LIN-1899 census: this pins the SHAPE of the stamp at each site, not
 * runtime correctness — routes/proxy.js:2072-3427's chokepoint sites are one
 * shared surface (resolveProviderAccess itself), separately behaviourally
 * proven end-to-end in tests/unit/credential-rejection-logging.test.js. The 9
 * direct sites are proven behaviourally only for /issues/:id-shaped routes
 * elsewhere; the remaining 8 are proven here by source position only, which
 * is why this file exists — driving all 9 direct routes' full request/response
 * cycle (recommend, brief, recap, autopilot/kickoff, ...) would mean building
 * out OpenRouter/dispatch-queue/preset fixtures unrelated to what LIN-1980
 * actually changed.
 *
 * LIN-679 Stage 6 (LIN-2540) closes the three-way split named below: group
 * I's 1 direct site (recommend-and-dispatch) has moved to
 * routes/proxy-dispatch.js, so routes/proxy.js now carries 0 of the 9 direct
 * sites and the F=7 + H=1 + I=1 = 9 partition is a true partition rather than
 * a moving target.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROXY_SRC = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');
// LIN-679 Stage 4 (LIN-2538): group F's 7 direct sites (stack, prompt,
// recommend, recap x2, brief x2) moved to their own sub-router. The
// remaining 2 (autopilot/kickoff, recommend-and-dispatch) stay in
// routes/proxy.js until Stages 5/6 land — three-way split, part 1 of 3.
const PROXY_COMPUTE_SRC = readFileSync(join(__dirname, '../../routes/proxy-compute.js'), 'utf8');
// LIN-679 Stage 5 (LIN-2539): group H's 1 direct site (autopilot/kickoff)
// moved to its own sub-router — three-way split, part 2 of 3.
const PROXY_KICKOFF_SRC = readFileSync(join(__dirname, '../../routes/proxy-kickoff.js'), 'utf8');
// LIN-679 Stage 6 (LIN-2540): group I's 1 direct site (recommend-and-dispatch)
// moved to its own sub-router — three-way split, part 3 of 3, closing. The
// partition is now true: F=7 + H=1 + I=1 = 9, and routes/proxy.js has 0.
const PROXY_DISPATCH_SRC = readFileSync(join(__dirname, '../../routes/proxy-dispatch.js'), 'utf8');

// The 7 direct call sites that moved to routes/proxy-compute.js, named by
// the endpoint tag their own workspaceUnavailable(...) call passes — a
// stable, human-readable anchor that survives line-number drift. Order
// matches the plan's own enumeration.
const COMPUTE_SITE_ENDPOINTS = [
  '/api/proxy/stack',
  '/api/proxy/prompt',
  '/api/proxy/recommend',
  '/api/proxy/recap', // GET
  '/api/proxy/recap', // POST (recap appears twice — see the dedicated test below)
  '/api/proxy/brief', // GET
  '/api/proxy/brief', // POST (brief appears twice — see the dedicated test below)
];

// The 1 direct call site that moved to routes/proxy-kickoff.js (group H).
const KICKOFF_SITE_ENDPOINTS = [
  '/api/proxy/autopilot/kickoff',
];

// The 1 direct call site that moved to routes/proxy-dispatch.js (group I).
const DISPATCH_SITE_ENDPOINTS = [
  '/api/proxy/recommend-and-dispatch',
];

// LIN-3219 A3 (M19): the count literals are gone; the relations below can fail.

/** Return-path offsets in a function body with no preceding fingerprint stamp. */
function unstampedReturns(body) {
  const clean = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const offenders = [];
  const re = /\breturn\b/g;
  let last = 0;
  let m;
  while ((m = re.exec(clean))) {
    if (!/req\.resolvedCredentialFingerprint\s*=/.test(clean.slice(last, m.index))) offenders.push(m.index);
    last = m.index + m[0].length;
  }
  return offenders;
}

const DIRECT_CALL = /const \{ token(?:: accessToken)?, reason, provider \} = await resolveProviderAccess\(req\.proxyUrlKey, req\.proxyCreatedBy, req\);/g;

/** Every direct call site whose following window lacks a `!accessToken`/`!token` guard. */
function directUnguardedOffenders(files) {
  const offenders = [];
  for (const { file, src } of files) {
    for (const m of src.matchAll(DIRECT_CALL)) {
      const window = src.slice(m.index, m.index + 400);
      if (!window.includes('if (!accessToken)') && !window.includes('if (!token)')) offenders.push(file);
    }
  }
  return offenders;
}

describe('LIN-1980 — req.resolvedCredentialFingerprint stamping coverage', () => {
  const providerBody = () => {
    const start = PROXY_SRC.indexOf('async function resolveProviderAccess');
    assert.ok(start >= 0, 'resolveProviderAccess not found');
    const end = PROXY_SRC.indexOf('\n  }', start); // closes at the 2-space method-body indent inside createProxyRoutes
    return PROXY_SRC.slice(start, end);
  };

  test('every return path of resolveProviderAccess that resolves a credential is preceded by a req.resolvedCredentialFingerprint stamp', () => {
    // Boundary rule (not a count): every `return` in the chokepoint's body must
    // have a stamp since the previous return / function start. The failure path
    // does not return here (it falls through), so every return is a resolving
    // path — LIN-1746's "stamp unconditionally" regression is excluded because
    // it had no return before the failure branch. The OTHER half of LIN-1746 —
    // "a resolution failure must never stamp, so it is classified proxy-token,
    // not provider-lane, and never pollutes providerLaneOccupancy" — is carried
    // behaviourally by tests/unit/credential-rejection-logging.test.js's
    // workspace-resolution-failure test (its own file, since it asserts on the
    // recorded event, not on source shape). This file keeps only the
    // resolving-return half.
    const offenders = unstampedReturns(providerBody());
    assert.deepEqual(offenders, [], `unstamped return paths at offsets ${JSON.stringify(offenders)}`);
  });

  test('WITNESS: a planted unstamped return path fails', () => {
    const opener = 'async function resolveProviderAccess(urlKey, ownerAccountId, req) {';
    const planted = providerBody().replace(opener, `${opener}\n    return { provider: localProvider, token: urlKey, reason: 'ok' };`);
    assert.ok(planted.includes(opener), 'the opener was actually planted');
    assert.ok(unstampedReturns(planted).length > 0, 'the planted unstamped return must be an offender');
  });

  // LIN-679 Stage 3a / LIN-2536 (F4): derived from the filesystem rather than
  // a hard-coded file list, so this floor covers every present AND future
  // routes/proxy-*.js extraction (E/F/H/I) with no further manual append —
  // the exact non-extensibility defect LIN-2557 documents for the sibling
  // rateLimit( census. House precedent: tests/unit/test-server-listen-bind.test.js's
  // directory-derived file discovery.
  const routesDir = join(__dirname, '../../routes');
  const proxyRouteFiles = readdirSync(routesDir).filter(f => f.startsWith('proxy') && f.endsWith('.js'));

  test('every routes/proxy*.js file\'s resolveProviderAccess call sites pass `req` as the third argument, so the chokepoint can actually stamp onto THIS request', () => {
    const invocations = [];
    for (const file of proxyRouteFiles) {
      const src = readFileSync(join(routesDir, file), 'utf8');
      const callSites = src.match(/resolveProviderAccess\([^)]*\)/g) || [];
      // Exclude the function's own definition line (routes/proxy.js only), which matches a different shape.
      const filtered = callSites.filter(c => !c.startsWith('resolveProviderAccess(urlKey'));
      invocations.push(...filtered.map(call => ({ file, call })));
    }
    assert.ok(invocations.length >= 10, `expected at least 10 resolveProviderAccess call sites across ${proxyRouteFiles.join(', ')}, found ${invocations.length}`);
    const missingReq = invocations.filter(({ call }) => !/,\s*req\)$/.test(call));
    assert.deepEqual(missingReq, [], `every resolveProviderAccess(...) call must end in ", req)" so the chokepoint can stamp — offenders: ${JSON.stringify(missingReq)}`);
  });

  test('every direct resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req) call site destructures the token shape and is immediately followed by its !accessToken guard (no per-file counts)', () => {
    // LIN-3219 A3: the F=7 + H=1 + I=1 = 9 per-file counts are gone. The
    // relation is derived from the filesystem-discovered proxy route files and
    // can fail: a direct site with no following guard is an offender.
    const files = proxyRouteFiles.map((file) => ({ file, src: readFileSync(join(routesDir, file), 'utf8') }));
    const sites = files.flatMap(({ file, src }) => [...src.matchAll(DIRECT_CALL)].map(() => file));
    assert.ok(sites.length > 0, 'a zero-site scan would be vacuous');
    assert.deepEqual(directUnguardedOffenders(files), [], 'direct sites without a !token guard');
  });

  test('WITNESS: a direct call site with no following guard fails', () => {
    const planted = [{
      file: 'routes/zz-direct.js',
      src: "const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);\n// no guard follows\n",
    }];
    assert.ok(directUnguardedOffenders(planted).includes('routes/zz-direct.js'), 'expected the planted unguarded site to be an offender');
  });

  // Belt-and-braces on the ordering claim itself (not just presence): since
  // resolveProviderAccess's own internal stamp (pinned above) completes before
  // the `await` on its call site returns, the meaningful residual risk is a
  // stray statement sneaking in BETWEEN the resolve call and its !accessToken
  // guard that reads/uses accessToken (or anything else) before the guard can
  // reject an unresolved credential — so assert nothing but the LIN-1980
  // comment sits in that gap, for each of the 9 direct sites.
  //
  // LIN-679 Stage 4 (LIN-2538) — three-way split, part 1 of 3: run this check
  // separately over routes/proxy-compute.js (7 sites).
  // LIN-679 Stage 5 (LIN-2539) — three-way split, part 2 of 3: also run it
  // over routes/proxy-kickoff.js (1 site).
  // LIN-679 Stage 6 (LIN-2540) — three-way split, part 3 of 3, closing: also
  // run it over routes/proxy-dispatch.js (1 site, group I
  // recommend-and-dispatch) and the complementary 0-site no-op over
  // routes/proxy.js (valid per the function's own loop-over-zero-matches shape).
  /** Check every direct site in `source`; returns the number of sites checked. */
  function assertOrderingGuard(source, label) {
    const resolveIdx = [];
    let cursor = 0;
    const needle = 'const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);';
    while (true) {
      const idx = source.indexOf(needle, cursor);
      if (idx === -1) break;
      resolveIdx.push(idx);
      cursor = idx + needle.length;
    }
    for (const idx of resolveIdx) {
      // Bounded by the NEXT resolve site (or EOF) rather than a fixed char
      // count, so a comment of any length between the resolve call and its
      // guard can't produce a false "guard not found".
      const nextResolveIdx = resolveIdx.find(other => other > idx) ?? source.length;
      const window = source.slice(idx, Math.min(idx + 400, nextResolveIdx));
      const guardIdx = window.indexOf('if (!accessToken)');
      assert.ok(guardIdx >= 0, `no !accessToken guard found shortly after the resolve site in ${label} (offset ${idx})`);
      const between = window.slice(needle.length, guardIdx);
      const strippedOfComments = between.replace(/\/\/[^\n]*/g, '').trim();
      assert.equal(strippedOfComments, '',
        `unexpected non-comment code between the resolve call and its !accessToken guard in ${label} (offset ${idx}): ${JSON.stringify(between)}`);
    }
    return resolveIdx.length;
  }

  test('at every direct site, nothing but the LIN-1980 comment sits between the resolveProviderAccess(...) call and its !accessToken guard (no per-file counts)', () => {
    const total = assertOrderingGuard(PROXY_COMPUTE_SRC, 'routes/proxy-compute.js')
      + assertOrderingGuard(PROXY_KICKOFF_SRC, 'routes/proxy-kickoff.js')
      + assertOrderingGuard(PROXY_DISPATCH_SRC, 'routes/proxy-dispatch.js')
      + assertOrderingGuard(PROXY_SRC, 'routes/proxy.js');
    assert.ok(total > 0, 'a zero-site scan would be vacuous');
  });

  test('endpoint coverage sanity: every endpoint tag this ticket\'s plan named for the 9 direct sites is actually present in its own file', () => {
    for (const endpoint of new Set(COMPUTE_SITE_ENDPOINTS)) {
      assert.ok(PROXY_COMPUTE_SRC.includes(`'${endpoint}'`), `expected to find the endpoint tag '${endpoint}' in routes/proxy-compute.js`);
    }
    for (const endpoint of new Set(KICKOFF_SITE_ENDPOINTS)) {
      assert.ok(PROXY_KICKOFF_SRC.includes(`'${endpoint}'`), `expected to find the endpoint tag '${endpoint}' in routes/proxy-kickoff.js`);
    }
    for (const endpoint of new Set(DISPATCH_SITE_ENDPOINTS)) {
      assert.ok(PROXY_DISPATCH_SRC.includes(`'${endpoint}'`), `expected to find the endpoint tag '${endpoint}' in routes/proxy-dispatch.js`);
    }
  });

  test('logEvent calls rejectedCredentialRegistry.markSuspect(req.resolvedCredentialFingerprint, ...) inside its status === 401 || status === 503 branch (LIN-2236 widened it to cover 503 too), reading the stamp — not a fresh fingerprint and not credentialResolutions', () => {
    const start = PROXY_SRC.indexOf('function logEvent(req, endpoint, status, note = null, { skipWitness = false } = {}) {');
    assert.ok(start >= 0);
    const end = PROXY_SRC.indexOf('\n  }', start);
    const body = PROXY_SRC.slice(start, end);
    assert.match(body, /if \(status === 401 \|\| status === 503\)/);
    assert.match(body, /rejectedCredentialRegistry\?\.markSuspect\(req\.resolvedCredentialFingerprint,/);
  });
});
