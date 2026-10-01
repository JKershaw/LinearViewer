/**
 * LIN-2534 (LIN-679 Stage 2 / PR-2a) — group A tokens-admin extraction.
 *
 * Group A carries ZERO pre-existing source-text pins (confirmed three
 * independent ways during planning), so there is nothing to re-point here.
 * Following LIN-2533's own precedent (tests/unit/lin-2533-agent-status-extraction.test.js),
 * this file instead lands a NEW pin set covering the invariants no existing
 * suite observes:
 *
 * 1. Source-text census: the five registrations carry workspaceFromUrl (never
 *    authenticateProxyToken — group A is the only group on session-cookie
 *    auth), and proxyTokenCreationLimiter appears on the POST only.
 *
 * 2. rateLimit( occurrence pins — routes/proxy-tokens-admin.js declares no
 *    limiter of its own (0), routes/proxy.js's own declaration stays a
 *    singleton (1), and the routes/-scoped total stays 5 (never repo-wide,
 *    which is 7 because of two eval-fixture string literals).
 *
 * 3. The providerDisplayName derivation moved verbatim (LIN-2370) and is
 *    absent from routes/proxy.js.
 *
 * 4. A RUNTIME witness for proxyTokenCreationLimiter's lifetime (plan-review
 *    R1, construction corrected per re-review verdict 09fad3d5): the count
 *    pins above are source-text only and cannot see a *composer*-level
 *    regression where each createProxyRoutes() call closes over its own
 *    freshly-budgeted limiter instance instead of sharing the module-scope
 *    singleton. Modelled on tests/unit/dispatch-queue-limiter-export.test.js:
 *    flip NODE_ENV to 'development' to de-inert the `skip`, build TWO
 *    createProxyRoutes() composer calls (never two sub-factory calls, which
 *    would hold the limiter's provenance constant by construction and could
 *    not see this regression), drive the first composer's POST to exhaustion
 *    (429 on the 11th), then prove the second composer's very FIRST request
 *    is already 429 too — which only a shared module-scope instance explains.
 *
 *    Mutation-checked by hand while authoring this file: temporarily
 *    relocating `const proxyTokenCreationLimiter = rateLimit({...})` from
 *    module scope (routes/proxy.js) to inside createProxyRoutes's body made
 *    the "composer B's first request is already 429" assertion fail with the
 *    actual response 403 (composer B's own workspaceFromUrl/session state,
 *    not a 429) — reproducing the plan's own measured 403 exactly — then the
 *    declaration was reverted and the test re-run green. See the PR
 *    description for the full transcript.
 */
process.env.NODE_ENV = 'test';

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const proxySource = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');
const tokensAdminSource = readFileSync(join(__dirname, '../../routes/proxy-tokens-admin.js'), 'utf8');

function registrationsIn(source) {
  return source.match(/router\.(get|post|put|patch|delete)\(/g) || [];
}

describe('LIN-2534: group A registrations moved out of routes/proxy.js, onto workspaceFromUrl only', () => {
  test('every route registration in routes/proxy-tokens-admin.js is chained onto workspaceFromUrl', () => {
    // Boundary rule (LIN-3218): the count is not pinned — every registration in
    // the file must carry `workspaceFromUrl` as its first middleware, derived
    // from the registration count itself. A new registration on a different
    // auth chain fails the equality.
    const registrations = registrationsIn(tokensAdminSource);
    const workspaceFromUrlChains = (tokensAdminSource.match(/workspaceFromUrl, async \(req, res\) => \{/g) || []).length;
    assert.ok(registrations.length > 0, 'the file must register routes, never pass on zero');
    assert.equal(workspaceFromUrlChains, registrations.length,
      `every one of the ${registrations.length} registrations must chain workspaceFromUrl`);
  });

  test('routes/proxy-tokens-admin.js carries no authenticateProxyToken reference (session-cookie auth only)', () => {
    assert.ok(!tokensAdminSource.includes('authenticateProxyToken'),
      'group A is the only group off the proxy-token bearer-auth surface — a swapped chain must fail this bound');
  });

  test('proxyTokenCreationLimiter is bound to exactly the POST /tokens registration', () => {
    // Derived set, not a count: the registrations whose middleware list names
    // the limiter must be exactly the one POST arm.
    const limiterRegistrations = [...tokensAdminSource.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'[^)]*proxyTokenCreationLimiter/g)]
      .map((m) => `${m[1].toUpperCase()} ${m[2]}`);
    assert.deepEqual(limiterRegistrations, ['POST /workspace/:urlKey/api/proxy/tokens'],
      'the limiter must be reached from exactly the POST /tokens arm');
    assert.match(tokensAdminSource,
      /router\.post\('\/workspace\/:urlKey\/api\/proxy\/tokens', proxyTokenCreationLimiter, workspaceFromUrl/,
      'the limiter must be the first middleware on POST /tokens, ahead of workspaceFromUrl');
  });
});

describe('LIN-2534: limiter declaration and lifetime — source-text half', () => {
  test('routes/proxy-tokens-admin.js declares no rateLimit( of its own (limiter is injected, not redeclared)', () => {
    assert.ok(!tokensAdminSource.includes('rateLimit('),
      'a sub-factory rateLimit({...}) declaration would make the limiter per-factory — a behaviour change');
  });

  test('routes/proxy.js declares proxyTokenCreationLimiter once, at module scope', () => {
    const declaration = 'const proxyTokenCreationLimiter = rateLimit({';
    const declIndex = proxySource.indexOf(declaration);
    const composerIndex = proxySource.indexOf('export function createProxyRoutes(');
    assert.ok(declIndex !== -1, 'the module-scope proxyTokenCreationLimiter declaration is missing');
    assert.ok(composerIndex !== -1, 'createProxyRoutes declaration not found');
    // Module scope (not inside createProxyRoutes): a declaration relocated into
    // the composer body would make each composer call close over its own
    // budget — the exact regression the runtime witness below discriminates.
    assert.ok(declIndex < composerIndex,
      'proxyTokenCreationLimiter must stay a module-scope singleton, declared before createProxyRoutes');
  });

  test('every rateLimit( occurrence in the scoped route files is a limiter declaration, never a bare call', () => {
    // Replaces the pinned scoped total (5): derive both sides from source and
    // require every occurrence to be a `= rateLimit(` declaration, so a new
    // bare call cannot slip in behind a matching number.
    const files = [
      'routes/dispatch.js',
      'routes/proxy.js',
      'routes/proxy-tokens-admin.js',
      'routes/proxy-agent-status.js',
    ];
    let occurrences = 0;
    let declarations = 0;
    for (const rel of files) {
      const src = readFileSync(join(__dirname, '../..', rel), 'utf8');
      occurrences += (src.match(/rateLimit\(/g) || []).length;
      declarations += (src.match(/=\s*rateLimit\(/g) || []).length;
    }
    assert.ok(occurrences > 0, 'the scoped files must declare at least one limiter, never pass on zero');
    assert.equal(declarations, occurrences,
      `every rateLimit( occurrence in ${files.join(', ')} must be a limiter declaration`);
  });
});

describe('LIN-2534: providerDisplayName derivation (LIN-2370) moved verbatim', () => {
  const DERIVATION = "const providerDisplayName = getProvider(workspace.provider)?.ui?.displayName ?? null;";

  test('routes/proxy-tokens-admin.js carries the derivation', () => {
    assert.ok(tokensAdminSource.includes(DERIVATION),
      'the providerDisplayName derivation must live in routes/proxy-tokens-admin.js');
  });

  test('routes/proxy.js no longer carries the derivation (moved out, not duplicated)', () => {
    assert.ok(!proxySource.includes(DERIVATION),
      'the providerDisplayName derivation must not remain in routes/proxy.js');
  });
});

// ---------------------------------------------------------------------------
// Runtime witness — limiter lifetime (plan-review R1; construction corrected
// per re-review verdict 09fad3d5). Built on TWO createProxyRoutes() composer
// calls, each from a fake-deps bag carrying NO limiter of any kind — the
// composer closes over the module-scope `const` in routes/proxy.js, which is
// exactly what makes this construction a discriminator for a composer-side
// regression (relocating the declaration into createProxyRoutes). A pair of
// createTokensAdminRoutes() sub-factory calls handed the SAME reference by
// the test itself would hold the limiter's provenance constant by
// construction and could not see that regression — deliberately not used.
// ---------------------------------------------------------------------------

const realNodeEnv = process.env.NODE_ENV;
after(() => {
  if (realNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = realNodeEnv;
});

function fakeDeps() {
  return {
    proxyTokenStore: {
      createToken: async () => ({ tokenId: 't1', token: 'tok', label: 'x', scope: 'read', kind: 'standard', singleUse: false }),
      listTokens: async () => ([]),
    },
    proxyEventStore: { recordEvent: async () => {}, listEvents: async () => ({ events: [], total: 0 }), listCredentialHealth: async () => ({ tokens: [] }) },
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  };
}

async function post(app, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return { status: res.status };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-2534: proxyTokenCreationLimiter is a shared singleton across createProxyRoutes() calls', () => {
  test('composer A: first 10 POSTs are not 429, the 11th is 429 (limiter max: 10)', async () => {
    process.env.NODE_ENV = 'development';
    const appA = express();
    appA.use(express.json());
    appA.use(createProxyRoutes(fakeDeps()));

    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const { status } = await post(appA, '/workspace/acme/api/proxy/tokens', { label: `t${i}` });
      statuses.push(status);
    }
    for (let i = 0; i < 10; i++) {
      assert.notEqual(statuses[i], 429, `request ${i} on composer A must not be rate-limited yet`);
    }
    assert.equal(statuses[10], 429, 'the 11th request on composer A must be rate-limited');
  });

  test('composer B (fresh instance, no prior traffic): its very FIRST request is already 429 — proves a shared module-scope limiter, not a per-composer one', async () => {
    // Ordering dependency, stated per the plan: this assertion carries signal
    // only because the PRECEDING test in this describe block already drove
    // composer A's shared budget to exhaustion. Run alone, composer B's first
    // request would pass trivially (not 429) — indistinguishable from a
    // genuinely shared-but-unhit limiter. The two tests must run in sequence.
    process.env.NODE_ENV = 'development';
    const appB = express();
    appB.use(express.json());
    appB.use(createProxyRoutes(fakeDeps()));

    const { status } = await post(appB, '/workspace/acme/api/proxy/tokens', { label: 'fresh' });
    assert.equal(status, 429,
      'composer B inherited composer A\'s exhausted budget — only a shared module-scope ' +
      'limiter instance explains this; a per-composer instance would pass here');
  });
});
