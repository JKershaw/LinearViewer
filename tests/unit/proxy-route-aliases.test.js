/**
 * LIN-528 — Proxy surface alignment: canonical nested issue-scoped routes plus
 * forgiving flat aliases.
 *
 * Each issue-scoped (and the cycle-scoped) endpoint now accepts two URLs that
 * resolve to ONE handler via Express array-path routing. This test pins the
 * contract for every alias pair the ticket called out, entirely through real
 * HTTP requests (LIN-2505 — the router.stack structural walk this file used to
 * run, plus its `path[0] === canonical` assertion, is gone; see below for why):
 *
 *  1. Same handler, request-level: hitting the canonical URL and the alias URL
 *     with identical input yields byte-identical status + body ("identical
 *     payloads" below). Because Express compiles an array path into one Route +
 *     one handler, two URLs that both resolve and agree on every probed input
 *     are, for observable purposes, the same handler — the honest behavioural
 *     reduction of the old structural guarantee. `path[0] === canonical` has NO
 *     behavioural equivalent and is not recreated: nothing in routes/, lib/, or
 *     server.js reads `req.route`, and Express 4 binds params by name, not
 *     array position, so the array's internal order is unobservable on the wire.
 *
 *  2. Param-echo probes ("mutation-teeth" below): the parity check above is
 *     BLIND to a mutation that renames only the alias's `:param`, because every
 *     probe below short-circuits on the SAME pre-network format validation
 *     regardless of which literal string the (now-unbound) param resolves to —
 *     for 6 of the 9 pairs a validly-formatted-but-nonexistent id still
 *     produces a distinguishing 400-vs-404 divergence, but for the 3 pairs
 *     whose validator treats an unbound param the same as a malformed one
 *     (`relations`, `comments`, `cycle detail`), that divergence never
 *     appears. Those 3 pairs additionally get a param-echoing probe, through a
 *     TEST-ONLY injected `provider` (the LIN-581 seam), so a param-rename
 *     mutation is caught by a second, independent assertion.
 *
 * We drive each pair down a deterministic, network-free path (format
 * validation 400s for the read/write GraphQL endpoints; test-mode "Issue not
 * found" 404s for the LLM-backed endpoints; an injected fake provider for the
 * echo probes) so every assertion is stable offline.
 *
 * The e2e suite already covers most of the *pairing*: tests/e2e/proxy.spec.js
 * drives 7 of these 9 pairs through both URLs with the same probe design. Only
 * the two `agent/status` <-> `foreman/status` pairs are unique to this file.
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

function buildApp({ provider } = {}) {
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
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    ...(provider ? { provider } : {}) // TEST-ONLY injection (LIN-581) — wins over registry resolution.
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
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
// 1. Behavioral: canonical URL and alias URL return identical status + body.
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

// ---------------------------------------------------------------------------
// 2. Param-echo probes (mutation-teeth): the identical-payloads probes above
// short-circuit on format validation that never actually reads the shared
// :param, so all of them are blind to a mutation that renames only the
// alias's param. For 3 of the 9 pairs — relations (read), comments (write),
// cycle detail — the existing probe's validator (isValidIssueId / UUID_REGEX)
// treats an unbound param exactly like a malformed one, so no status
// divergence exists to catch that mutation (verified: a param rename makes
// alias and canonical both 400 identically without this probe). These three
// pairs get a second, param-echoing probe through a TEST-ONLY injected
// `provider` (the LIN-581 seam, precedent: proxy-issues-pagination.test.js)
// that records the id/param it was called with — under a param-rename
// mutation the alias falls back to its pre-network 400 while the canonical
// still reaches the provider and echoes 200/201, so the two diverge.
//
// The other 6 pairs (recommend/recap/brief/prompt/agent-status×2) already
// probe with a validly-formatted-but-nonexistent identifier and see a real
// 400-vs-404 divergence under the same mutation, so they already have teeth
// without an echo probe — adding one there is optional strengthening, not
// required, and is left out here to avoid the extra fixture wiring risk.
// ---------------------------------------------------------------------------
function makeEchoProvider() {
  const calls = { relations: [], cycleDetail: [], createComment: [] };
  return {
    calls,
    name: 'echo-fake',
    supports: () => true,
    async relations(token, issueId) {
      calls.relations.push(issueId);
      return { id: issueId, relations: [], inverseRelations: [] };
    },
    async cycleDetail(token, cycleId) {
      calls.cycleDetail.push(cycleId);
      return { id: cycleId, name: 'Echo Cycle' };
    },
    async issueWriteGuard(token, issueId) {
      return { id: issueId, trashed: false };
    },
    async createComment(token, issueId, body) {
      calls.createComment.push(issueId);
      return { id: 'comment-1', issueId, body };
    }
  };
}

describe('proxy route aliases — param-echo probes (mutation-teeth)', () => {
  test('relations (read): canonical and alias each reach the provider with their OWN issueId', async () => {
    const provider = makeEchoProvider();
    const app = buildApp({ provider });

    const canonical = await call(app, 'get', '/api/proxy/issues/LIN-77/relations');
    const alias = await call(app, 'get', '/api/proxy/relations/LIN-78');

    assert.equal(canonical.status, 200, JSON.stringify(canonical.body));
    assert.equal(alias.status, 200, JSON.stringify(alias.body));
    assert.deepEqual(provider.calls.relations, ['LIN-77', 'LIN-78'],
      'each URL must reach the provider with its own :issueId — a param-rename mutation would drop one to undefined');
  });

  test('comments (write): canonical and alias each reach the provider with their OWN issueId', async () => {
    const provider = makeEchoProvider();
    const app = buildApp({ provider });

    const canonical = await call(app, 'post', '/api/proxy/issues/LIN-77/comments', { body: 'hello' });
    const alias = await call(app, 'post', '/api/proxy/comments/LIN-78', { body: 'hello' });

    assert.equal(canonical.status, 201, JSON.stringify(canonical.body));
    assert.equal(alias.status, 201, JSON.stringify(alias.body));
    assert.deepEqual(provider.calls.createComment, ['LIN-77', 'LIN-78'],
      'each URL must reach the provider with its own :issueId — a param-rename mutation would drop one to undefined');
  });

  test('cycle detail: canonical and alias each reach the provider with their OWN cycleId', async () => {
    const provider = makeEchoProvider();
    const app = buildApp({ provider });
    const CYCLE_A = '11111111-1111-1111-1111-111111111111';
    const CYCLE_B = '22222222-2222-2222-2222-222222222222';

    const canonical = await call(app, 'get', `/api/proxy/cycles/${CYCLE_A}`);
    const alias = await call(app, 'get', `/api/proxy/cycle/${CYCLE_B}`);

    assert.equal(canonical.status, 200, JSON.stringify(canonical.body));
    assert.equal(alias.status, 200, JSON.stringify(alias.body));
    assert.deepEqual(provider.calls.cycleDetail, [CYCLE_A, CYCLE_B],
      'each URL must reach the provider with its own :cycleId — a param-rename mutation would drop one to undefined');
  });
});
