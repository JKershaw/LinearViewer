/**
 * LIN-528 — Proxy surface alignment: canonical nested issue-scoped routes plus
 * forgiving flat aliases.
 *
 * Each issue-scoped (and the cycle-scoped) endpoint now accepts two URLs that
 * resolve to ONE handler via Express array-path routing. This test pins both
 * halves of the contract for every alias pair the ticket called out:
 *
 *  1. Same handler (structural): the mounted router exposes a single route whose
 *     path array contains BOTH the canonical and the alias path, for the right
 *     HTTP method. Because Express compiles an array path into one Route + one
 *     handler, this is a by-construction guarantee that the two URLs cannot drift
 *     onto different handlers.
 *
 *  2. Identical payload (behavioral): hitting the canonical URL and the alias URL
 *     with identical input yields byte-identical status + body. We drive each pair
 *     down a deterministic, network-free path (format validation 400s for the
 *     read/write GraphQL endpoints; test-mode "Issue not found" 404s for the
 *     LLM-backed endpoints) so the assertion is stable offline.
 *
 * The e2e suite can't cover the *pairing*: it only ever calls the documented URL,
 * so an alias that silently 404'd or hit the wrong handler would pass e2e.
 */

// LLM-backed endpoints short-circuit to deterministic test fixtures only when
// NODE_ENV === 'test' AND the resolved access token is 'test-token'. Set the
// env BEFORE importing the routes so module-level rate-limiter skips also apply.
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

// Every alias pair under test. `canonical` is the documented form; `alias` is the
// undocumented forgiving form. `param` records the shared :param name(s) that MUST
// match across the pair (a mismatch would break the shared handler's req.params).
const PAIRS = [
  {
    name: 'relations (read)',
    method: 'get',
    canonical: '/api/proxy/issues/:issueId/relations',
    alias: '/api/proxy/relations/:issueId',
    probe: { canonical: '/api/proxy/issues/bad%20id/relations', alias: '/api/proxy/relations/bad%20id' },
    expectStatus: 400
  },
  {
    name: 'comments (write)',
    method: 'post',
    canonical: '/api/proxy/issues/:issueId/comments',
    alias: '/api/proxy/comments/:issueId',
    probe: { canonical: '/api/proxy/issues/bad%20id/comments', alias: '/api/proxy/comments/bad%20id' },
    expectStatus: 400
  },
  {
    name: 'cycle detail',
    method: 'get',
    canonical: '/api/proxy/cycles/:cycleId',
    alias: '/api/proxy/cycle/:cycleId',
    probe: { canonical: '/api/proxy/cycles/not-a-uuid', alias: '/api/proxy/cycle/not-a-uuid' },
    expectStatus: 400
  },
  {
    name: 'recommend',
    method: 'get',
    canonical: '/api/proxy/issues/:identifier/recommend',
    alias: '/api/proxy/recommend/:identifier',
    probe: { canonical: '/api/proxy/issues/LIN-999999/recommend', alias: '/api/proxy/recommend/LIN-999999' },
    expectStatus: 404
  },
  {
    name: 'recap',
    method: 'get',
    canonical: '/api/proxy/issues/:identifier/recap',
    alias: '/api/proxy/recap/:identifier',
    probe: { canonical: '/api/proxy/issues/LIN-999999/recap', alias: '/api/proxy/recap/LIN-999999' },
    expectStatus: 404
  },
  {
    name: 'brief',
    method: 'get',
    canonical: '/api/proxy/issues/:identifier/brief',
    alias: '/api/proxy/brief/:identifier',
    probe: { canonical: '/api/proxy/issues/LIN-999999/brief', alias: '/api/proxy/brief/LIN-999999' },
    expectStatus: 404
  },
  {
    name: 'prompt',
    method: 'get',
    canonical: '/api/proxy/issues/:identifier/prompt/:templateKey',
    alias: '/api/proxy/prompt/:identifier/:templateKey',
    probe: { canonical: '/api/proxy/issues/LIN-999999/prompt/implement', alias: '/api/proxy/prompt/LIN-999999/implement' },
    expectStatus: 404
  },
  // LIN-533: agent/status is canonical; foreman/status remains a forgiving deprecated
  // alias for existing consumers (the autopilot runner). POST 400s on a missing
  // taskIdentifier and GET 400s on an over-long tokenId — both before the store is hit,
  // so the probe is deterministic and network-free.
  {
    name: 'agent status (write)',
    method: 'post',
    canonical: '/api/proxy/agent/status',
    alias: '/api/proxy/foreman/status',
    probe: { canonical: '/api/proxy/agent/status', alias: '/api/proxy/foreman/status' },
    expectStatus: 400
  },
  {
    name: 'agent status (read)',
    method: 'get',
    canonical: '/api/proxy/agent/status',
    alias: '/api/proxy/foreman/status',
    probe: {
      canonical: '/api/proxy/agent/status?tokenId=' + 'x'.repeat(1001),
      alias: '/api/proxy/foreman/status?tokenId=' + 'x'.repeat(1001)
    },
    expectStatus: 400
  }
];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    // Drives isTestMode (token === 'test-token') for the LLM endpoints; the
    // GraphQL endpoints build a client but 400 on bad input before any network.
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// ---------------------------------------------------------------------------
// 1. Structural: each pair is ONE route serving BOTH paths.
// ---------------------------------------------------------------------------
describe('proxy route aliases — same handler (router stack)', () => {
  const router = createProxyRoutes({
    proxyTokenStore: { validateToken: async () => null },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'ok' }),
    getWorkspaceAccessToken: async () => null,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {}, freeTierStore: {}
  });

  // Index routes by the exact path array Express stored for each Route.
  const routePaths = router.stack
    .filter(layer => layer.route)
    .map(layer => ({ path: layer.route.path, methods: layer.route.methods }));

  for (const pair of PAIRS) {
    test(`${pair.name}: canonical + alias share one ${pair.method.toUpperCase()} route`, () => {
      const match = routePaths.find(r =>
        Array.isArray(r.path) &&
        r.path.includes(pair.canonical) &&
        r.path.includes(pair.alias) &&
        r.methods[pair.method] === true
      );
      assert.ok(
        match,
        `expected a single ${pair.method.toUpperCase()} route whose path array contains both ` +
        `${pair.canonical} and ${pair.alias}`
      );
      // Canonical is documented first by convention.
      assert.equal(match.path[0], pair.canonical, 'canonical path should be listed first');
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Behavioral: canonical URL and alias URL return identical status + body.
// ---------------------------------------------------------------------------
describe('proxy route aliases — identical payloads', () => {
  for (const pair of PAIRS) {
    test(`${pair.name}: ${pair.probe.canonical} === ${pair.probe.alias}`, async () => {
      const app = buildApp();
      const body = pair.method === 'post' ? { body: 'hello' } : undefined;
      const canonical = await call(app, pair.method, pair.probe.canonical, body);
      const alias = await call(app, pair.method, pair.probe.alias, body);

      assert.equal(canonical.status, pair.expectStatus,
        `canonical expected ${pair.expectStatus}, got ${canonical.status}: ${JSON.stringify(canonical.body)}`);
      assert.equal(alias.status, canonical.status, 'alias status must equal canonical status');
      assert.deepEqual(alias.body, canonical.body, 'alias body must equal canonical body');
    });
  }
});
