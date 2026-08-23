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
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROXY_SRC = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');

// The 9 direct call sites, named by the endpoint tag their own
// workspaceUnavailable(...) call passes — a stable, human-readable anchor
// that survives line-number drift. Order matches the plan's own enumeration.
const DIRECT_SITE_ENDPOINTS = [
  '/api/proxy/stack',
  '/api/proxy/prompt',
  '/api/proxy/recommend',
  '/api/proxy/recap', // GET
  '/api/proxy/recap', // POST (recap appears twice — see the dedicated test below)
  '/api/proxy/brief', // GET
  '/api/proxy/brief', // POST (brief appears twice — see the dedicated test below)
  '/api/proxy/autopilot/kickoff',
  '/api/proxy/recommend-and-dispatch',
];

describe('LIN-1980 — req.resolvedCredentialFingerprint stamping coverage', () => {
  test('resolveProviderAccess (the provider-lane chokepoint, fronting ~24 sites as ONE surface) stamps req.resolvedCredentialFingerprint on every return path, including the TEST_LOCAL_URL_KEY short-circuit', () => {
    const start = PROXY_SRC.indexOf('async function resolveProviderAccess');
    assert.ok(start >= 0, 'resolveProviderAccess not found');
    const end = PROXY_SRC.indexOf('\n  }', start); // closes at the 2-space method-body indent inside createProxyRoutes
    const body = PROXY_SRC.slice(start, end);

    const stampCount = (body.match(/req\.resolvedCredentialFingerprint\s*=/g) || []).length;
    assert.equal(stampCount, 2, 'expected exactly 2 stamps: the TEST_LOCAL_URL_KEY short-circuit and the real resolveWorkspaceAccess path');
  });

  test('all 24 resolveProviderAccess call sites pass `req` as the third argument, so the chokepoint can actually stamp onto THIS request', () => {
    const callSites = PROXY_SRC.match(/resolveProviderAccess\([^)]*\)/g) || [];
    // Exclude the function's own definition line, which matches a different shape.
    const invocations = callSites.filter(c => !c.startsWith('resolveProviderAccess(urlKey'));
    assert.ok(invocations.length >= 10, `expected at least 10 resolveProviderAccess call sites, found ${invocations.length}`);
    const missingReq = invocations.filter(c => !/,\s*req\)$/.test(c));
    assert.deepEqual(missingReq, [], `every resolveProviderAccess(...) call must end in ", req)" so the chokepoint can stamp — offenders: ${JSON.stringify(missingReq)}`);
  });

  test('each of the 9 direct resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req) call sites destructures `provider` (LIN-2044) — the manual per-site stamp is gone because resolveProviderAccess now stamps internally, proven by the chokepoint test above', () => {
    // Pre-LIN-2044 this pinned a DIFFERENT shape: a raw resolveWorkspaceAccess(...)
    // call destructuring `credentialFingerprint`, immediately followed by a manual
    // `req.resolvedCredentialFingerprint = credentialFingerprint ?? null;` line.
    // LIN-2044 routed all 9 of these sites onto resolveProviderAccess (passing `req`
    // as the third arg so ITS internal stamp, already pinned above, lands on this
    // request) and deleted the now-redundant manual stamp line at each site.
    const pattern = /const \{ token: accessToken, reason, provider \} = await resolveProviderAccess\(req\.proxyUrlKey, req\.proxyCreatedBy, req\);/g;
    const matches = PROXY_SRC.match(pattern) || [];
    assert.equal(
      matches.length,
      9,
      `expected 9 direct resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req) call sites in this exact shape, found ${matches.length}. ` +
      'A count below 9 means a site reverted to the pre-LIN-2044 raw resolveWorkspaceAccess(...) + manual-stamp shape ' +
      '(losing both provider resolution and, if `req` is not threaded through, the request-scoped stamp); ' +
      'a count above 9 means a NEW 10th direct site was added — update this pin\'s expected count only after also ' +
      'updating the "expected exactly 1" resolveWorkspaceAccess( count pinned in workspace-accesstoken-linear-egress-census.test.js.'
    );
  });

  test('each of the 9 direct sites checks !accessToken immediately after the resolveProviderAccess(...) call, with nothing but the LIN-1980 comment between them — no logic can act on a request whose provider resolution failed before the guard has a chance to reject it', () => {
    // Belt-and-braces on the ordering claim itself (not just presence): since
    // resolveProviderAccess's own internal stamp (pinned above) completes before
    // the `await` on its call site returns, the meaningful residual risk is a
    // stray statement sneaking in BETWEEN the resolve call and its !accessToken
    // guard that reads/uses accessToken (or anything else) before the guard can
    // reject an unresolved credential — so assert nothing but the LIN-1980
    // comment sits in that gap, for each of the 9 direct sites.
    const resolveIdx = [];
    let cursor = 0;
    const needle = 'const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);';
    while (true) {
      const idx = PROXY_SRC.indexOf(needle, cursor);
      if (idx === -1) break;
      resolveIdx.push(idx);
      cursor = idx + needle.length;
    }
    assert.equal(resolveIdx.length, 9);

    for (const idx of resolveIdx) {
      // Bounded by the NEXT resolve site (or EOF) rather than a fixed char
      // count, so a comment of any length between the resolve call and its
      // guard can't produce a false "guard not found".
      const nextResolveIdx = resolveIdx.find(other => other > idx) ?? PROXY_SRC.length;
      const window = PROXY_SRC.slice(idx, Math.min(idx + 400, nextResolveIdx));
      const guardIdx = window.indexOf('if (!accessToken)');
      assert.ok(guardIdx >= 0, `no !accessToken guard found shortly after the resolve site (offset ${idx})`);
      const between = window.slice(needle.length, guardIdx);
      const strippedOfComments = between.replace(/\/\/[^\n]*/g, '').trim();
      assert.equal(strippedOfComments, '',
        `unexpected non-comment code between the resolve call and its !accessToken guard (offset ${idx}): ${JSON.stringify(between)}`);
    }
  });

  test('endpoint coverage sanity: every endpoint tag this ticket\'s plan named for the 9 direct sites is actually present in routes/proxy.js', () => {
    for (const endpoint of new Set(DIRECT_SITE_ENDPOINTS)) {
      assert.ok(PROXY_SRC.includes(`'${endpoint}'`), `expected to find the endpoint tag '${endpoint}' in routes/proxy.js`);
    }
  });

  test('logEvent calls rejectedCredentialRegistry.markSuspect(req.resolvedCredentialFingerprint, ...) inside its status === 401 || status === 503 branch (LIN-2236 widened it to cover 503 too), reading the stamp — not a fresh fingerprint and not credentialResolutions', () => {
    const start = PROXY_SRC.indexOf('function logEvent(req, endpoint, status, note = null) {');
    assert.ok(start >= 0);
    const end = PROXY_SRC.indexOf('\n  }', start);
    const body = PROXY_SRC.slice(start, end);
    assert.match(body, /if \(status === 401 \|\| status === 503\)/);
    assert.match(body, /rejectedCredentialRegistry\?\.markSuspect\(req\.resolvedCredentialFingerprint,/);
  });
});
