/**
 * LIN-3840 — the redaction canary sweep for createDashboardRoutes (replaces the
 * per-file rows of lin-3384-redaction-census for routes/dashboard.js).
 *
 * LIN-3384: a live bootstrap token leaves only on the runner's poll/take. The
 * census keyed every dashboard read of the dispatch store by `file :: function`
 * and a call count, so it pinned where the code sat. This sweep guards the
 * property instead. Every fake queue row carries a runtime-built canary as its
 * `bootstrapToken`, and a second canary in its `prompt` as
 * `Authorization: Bearer <canary>` (the prose shape `maskBootstrapTokens` masks).
 * Every route `createDashboardRoutes` registers is then driven over HTTP:
 *
 *   - the `bootstrapToken` canary must appear in NO response of ANY route, and no
 *     response may carry a non-null `bootstrapToken` field;
 *   - the prompt canary must appear in none either, except the routes listed in
 *     PROMPT_EXCEPTIONS (empty: base shows no route returning the prompt text).
 *
 * Exhaustiveness comes from the router's own registry (`enumerateRoutes`, which
 * descends nested routers and throws on a layer it cannot classify), asserted
 * at 24 routes, with a per-route row saying whether the route reads dispatch rows.
 * The positive control: a "reads" route must reach at least one fake read
 * (`listItems`, `listHistory`, `getItemStatus`; the `...WithPrompt` /
 * `...WithBodies` variants are left undefined so lib/pipeline-loops.js's lean
 * default lands on these), so a fixture that stops at a 404 before the store
 * cannot pass vacuously. A route without a row fails; so does a row without a route.
 *
 * The four run-page routes are swept like the rest. Their rows are marked
 * LIN-3349's: the canary property is a contract on the page, not a pin on its code.
 *
 * Hermetic: the summary routes take their deterministic test-mode path, the
 * OpenRouter transport is a throwing `setFetchImpl` fake (never `globalThis.fetch`:
 * `request()` uses it for the loopback), the PR-state provider is injected, and
 * every outbound request is recorded and must be zero. The canaries are built at
 * run time: a token-shaped literal would trip the `harbour-bootstrap-token` rule
 * of `secret-scan`, which CI requires.
 *
 * Run: node --test tests/unit/dashboard-redaction-canary-sweep.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { setFetchImpl } from '../../lib/openrouter.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';
import { guardNetwork } from '../fixtures/network-guard.js';
import { enumerateRoutes, sampleUrl, appAround, request, makeCanary, SAMPLE_UUID } from './lib/entrance-route-sweep.js';

const NOW_ISO = new Date().toISOString();
const WORKER_ID = '22222222-3333-4444-8555-666666666666';
const URL_VALUES = { wsUrlKey: 'alpha', identifier: 'LIN-1' };

const EXPECTED_ROUTES = 24;

// Which routes read dispatch rows through the queue store. `run-page` marks the
// four routes LIN-3349 owns. A route that does not read says why.
const ROUTE_TABLE = {
  'GET /workspace/:urlKey/observation': { reads: false, why: 'page shell: reads preferences and caches, not queue rows' },
  'GET /workspace/:urlKey/observation/session/:sessionId': { reads: true, owner: 'run-page' },
  'GET /workspace/:urlKey/api/run/:runId/pr-state': { reads: true, owner: 'run-page' },
  'POST /workspace/:urlKey/api/run/:runId/proposals/:id/apply': { reads: true, owner: 'run-page' },
  'POST /workspace/:urlKey/api/run/:runId/proposals/:id/decline': { reads: false, owner: 'run-page', why: 'compare-and-set on the proposals store only' },
  'GET /workspace/:urlKey/dashboard': { reads: false, why: 'a redirect' },
  'GET /workspace/:urlKey/api/dashboard/sessions': { reads: true },
  'GET /workspace/:urlKey/api/dashboard/loops': { reads: true },
  'GET /workspace/:urlKey/api/dashboard/rulings': { reads: true },
  'POST /workspace/:urlKey/api/dashboard/rulings/dismiss': { reads: false, why: 'stamps a decision (a write); returns {success}' },
  'POST /workspace/:urlKey/api/dashboard/rulings/reverse-withdrawal': { reads: false, why: 'stamps a decision (a write); returns {success}' },
  'POST /workspace/:urlKey/api/dashboard/rulings/answer': { reads: false, why: 'task-decisions store only' },
  'POST /workspace/:urlKey/api/dashboard/rulings/shelve': { reads: false, why: 'shelved-rulings store only' },
  'POST /workspace/:urlKey/api/dashboard/rulings/keep': { reads: false, why: 'dismissal-suggestions store only' },
  'GET /workspace/:urlKey/escalation-kpis': { reads: true },
  'GET /workspace/:urlKey/api/escalation-kpis': { reads: true },
  'GET /workspace/:urlKey/effort-readout': { reads: true },
  'GET /workspace/:urlKey/api/effort-readout': { reads: true },
  'GET /workspace/:urlKey/api/dashboard/run-summary/:loopId': { reads: true },
  'POST /workspace/:urlKey/api/dashboard/run-summary/:loopId': { reads: true },
  'GET /workspace/:urlKey/api/dashboard/session-summary/:sessionId': { reads: true },
  'POST /workspace/:urlKey/api/dashboard/session-summary/:sessionId': { reads: true },
  'GET /workspace/:urlKey/api/dashboard/session-context/:sessionId': { reads: true },
  'GET /workspace/:urlKey/api/dashboard/hydrate/:wsUrlKey/:identifier': { reads: false, why: 'tracker read through fetchIssueContext, no queue rows' }
};

// Routes whose reply may carry the prompt canary, with the reason. Found on base:
// none. (A route listed here must really return it; see the exceptions test.)
const PROMPT_EXCEPTIONS = {};

const BODIES = {
  'POST /workspace/:urlKey/api/dashboard/rulings/dismiss': { decisionLoopId: SAMPLE_UUID, decisionId: 'd1' }
};

const keyOf = (r) => `${r.method} ${r.path}`;

/** Every `bootstrapToken` value found anywhere in a parsed JSON body. */
function bootstrapTokenValues(value, out = []) {
  if (Array.isArray(value)) value.forEach(v => bootstrapTokenValues(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'bootstrapToken') out.push(v);
      else bootstrapTokenValues(v, out);
    }
  }
  return out;
}

/**
 * The router under test with fakes around it. `extend(router, deps)` lets a witness
 * plant an extra route. `deps.reads` logs each queue-store read the request reaches.
 */
function buildWorld({ bootCanary, promptCanary, extend } = {}) {
  const prompt = `Work the task.\nAuthorization: Bearer ${promptCanary}\n`;
  const rows = [
    { id: SAMPLE_UUID, _id: SAMPLE_UUID, kind: 'autopilot', issueIdentifier: 'LIN-1', issueTitle: 'Title', promptName: 'autopilot', dispatchedBy: 'acct-owner', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', bootstrapToken: bootCanary, prompt, feedback: [] },
    { id: WORKER_ID, _id: WORKER_ID, sessionId: SAMPLE_UUID, issueIdentifier: 'LIN-2', issueTitle: 'Title', promptName: 'implementation', dispatchedBy: 'acct-owner', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', bootstrapToken: bootCanary, prompt, feedback: [{ message: '[failed] broke', timestamp: NOW_ISO }] }
  ];
  const reads = [];
  const dispatchQueueStore = {
    async listItems() { reads.push('listItems'); return []; },
    async listHistory() { reads.push('listHistory'); return { items: withFreshDigests(rows.map(r => ({ ...r }))) }; },
    async getItemStatus(_urlKey, id) { reads.push('getItemStatus'); return withFreshDigests(rows.filter(r => r.id === id).map(r => ({ ...r })))[0] || null; },
    async addItem(_urlKey, fields) { return { _id: 'added-item', id: 'added-item', ...fields }; },
    async getGrantDeclaration() { return null; },
    async markDecisionAnswered() { return null; },
    async markDecisionWithdrawalReversed() { return null; }
  };
  const deps = {
    workspaceFromUrl: (req, _res, next) => {
      req.session = { accountId: 'acct-owner', workspaces: [{ urlKey: 'alpha', name: 'Alpha' }], features: {} };
      req.workspace = { urlKey: 'alpha', id: 'ws-alpha', provider: 'linear' };
      next();
    },
    dispatchQueueStore,
    agentStatusStore: {
      async listStatus() {
        return { items: rows.map(r => ({ id: `as-${r.id}`, dispatchId: r.id, taskIdentifier: r.issueIdentifier, action: 'implementation', status: 'completed', summary: 'done', timestamp: NOW_ISO })) };
      }
    },
    runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
    sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
    runProposalsStore: {
      async list() { return []; },
      async get() { return { prompt: 'Run the follow-up.', status: 'proposed' }; },
      async apply() { return true; },
      async decline() { return true; },
      async revert() {},
      async recordAppliedItem() {}
    },
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    freeTierStore: { async tryUse() { return { allowed: true }; } },
    getWorkspaceAccessToken: async () => 'workspace-token',
    fetchIssueContext: async () => ({ issue: { state: { name: 'In Progress', type: 'started' } } }),
    fetchWorkspaceIssues: async () => [],
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({}),
    // The PR-state route would otherwise build a live tracker provider.
    prState: { resolveProvider: () => ({ provider: { name: 'linear', fetchIssueComments: async () => [] }, callScope: {} }) },
    // A pass-through feed cache, so a request really enters the feed producers.
    sessionsFeedCache: { keyFor: () => 'k', get: async (_k, producer) => producer(), clear() {} }
  };
  const router = createDashboardRoutes(deps);
  if (extend) extend(router, { dispatchQueueStore, rows });
  return { router, reads };
}

/**
 * Drive every route of `world.router` over HTTP. Returns the problems found; an
 * empty list is a clean sweep. `table` is the per-route row set.
 */
async function sweep(world, { bootCanary, promptCanary, table = ROUTE_TABLE, promptExceptions = PROMPT_EXCEPTIONS }) {
  const problems = [];
  const routes = enumerateRoutes(world.router);
  const keys = new Set(routes.map(keyOf));
  for (const key of keys) if (!table[key]) problems.push(`${key}: no row in the route table`);
  for (const key of Object.keys(table)) if (!keys.has(key)) problems.push(`${key}: a table row for a route that is not registered`);

  for (const route of routes) {
    const key = keyOf(route);
    world.reads.length = 0;
    const res = await request(appAround(world.router), route.method, sampleUrl(route.path, URL_VALUES), {
      body: route.method === 'GET' ? undefined : (BODIES[key] ?? {})
    });
    const row = table[key];
    if (row?.reads) {
      if (world.reads.length === 0) problems.push(`${key}: reads no dispatch row (status ${res.status}); the sweep is aimed at nothing`);
      if (res.status >= 500) problems.push(`${key}: status ${res.status}: ${res.text.slice(0, 200)}`);
    }
    if (res.text.includes(bootCanary)) problems.push(`${key}: the bootstrapToken canary is in the response: ${res.text.slice(0, 200)}`);
    const tokens = bootstrapTokenValues(res.body).filter(v => v !== null && v !== undefined);
    if (tokens.length) problems.push(`${key}: the response carries a bootstrapToken field`);
    if (res.text.includes(promptCanary) && !promptExceptions[key]) problems.push(`${key}: the prompt canary is in the response: ${res.text.slice(0, 200)}`);
  }
  return problems;
}

describe('LIN-3840 redaction canary sweep — createDashboardRoutes', () => {
  const bootCanary = makeCanary();
  const promptCanary = makeCanary();
  let guard;
  let realFetch;
  let outbound;
  const prevMock = process.env.HARBOUR_DISABLE_AI_MOCK;

  before(() => {
    // The summary routes must take their deterministic test-mode path.
    delete process.env.HARBOUR_DISABLE_AI_MOCK;
    // Belt: any OpenRouter request fails the call instead of leaving the process.
    setFetchImpl(async () => { throw new Error('the dashboard sweep must make no outbound OpenRouter request'); });
    // Record non-loopback requests made through global fetch without stubbing it
    // (request() needs it for its own loopback).
    outbound = [];
    realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = String(input?.url ?? input);
      if (!url.startsWith('http://127.0.0.1:')) outbound.push(url);
      return realFetch(input, init);
    };
    guard = guardNetwork();
  });

  after(() => {
    guard.restore();
    globalThis.fetch = realFetch;
    setFetchImpl(null);
    if (prevMock === undefined) delete process.env.HARBOUR_DISABLE_AI_MOCK; else process.env.HARBOUR_DISABLE_AI_MOCK = prevMock;
  });

  test('the canaries are the prefixed 47-character shape the mask recognises, built at run time, and distinct', () => {
    for (const c of [bootCanary, promptCanary]) {
      assert.equal(c.length, 47);
      assert.match(c, /^hbp_[A-Za-z0-9_-]{43}$/);
    }
    assert.notEqual(bootCanary, promptCanary);
  });

  test(`enumerates exactly ${EXPECTED_ROUTES} routes from the router's own registry, none unclassifiable`, () => {
    const { router } = buildWorld({ bootCanary, promptCanary });
    assert.equal(enumerateRoutes(router).length, EXPECTED_ROUTES);
  });

  test('every route is swept: no canary in any response, and every "reads" route reaches a fake read', async () => {
    const world = buildWorld({ bootCanary, promptCanary });
    assert.deepEqual(await sweep(world, { bootCanary, promptCanary }), []);
  });

  test('the four run-page routes are rows of the table, marked as LIN-3349\'s contract', () => {
    const runPage = Object.entries(ROUTE_TABLE).filter(([, row]) => row.owner === 'run-page').map(([k]) => k);
    assert.equal(runPage.length, 4);
  });

  test('the sweep made no outbound request', () => {
    assert.deepEqual(outbound, []);
    assert.deepEqual(guard.attempts, []);
  });

  describe('witnesses: the sweep fails on a planted violation', () => {
    test('a planted GET route returning getItemStatus unredacted fails the canary check', async () => {
      const planted = { ...ROUTE_TABLE, 'GET /workspace/:urlKey/api/dashboard/planted-status/:id': { reads: true } };
      const world = buildWorld({
        bootCanary,
        promptCanary,
        extend: (router, { dispatchQueueStore }) => {
          router.get('/workspace/:urlKey/api/dashboard/planted-status/:id', async (req, res) => {
            res.json(await dispatchQueueStore.getItemStatus('alpha', req.params.id));
          });
        }
      });
      const problems = await sweep(world, { bootCanary, promptCanary, table: planted });
      assert.ok(problems.some(p => p.includes('planted-status') && p.includes('bootstrapToken canary')), problems.join('\n'));
    });

    test('a "reads" route that stops at a 404 before the store fails the positive control', async () => {
      const planted = { ...ROUTE_TABLE, 'GET /workspace/:urlKey/api/dashboard/planted-404/:id': { reads: true } };
      const world = buildWorld({
        bootCanary,
        promptCanary,
        extend: (router) => {
          router.get('/workspace/:urlKey/api/dashboard/planted-404/:id', (_req, res) => res.status(404).json({ error: 'nope' }));
        }
      });
      const problems = await sweep(world, { bootCanary, promptCanary, table: planted });
      assert.ok(problems.some(p => p.includes('planted-404') && p.includes('aimed at nothing')), problems.join('\n'));
    });

    test('a route with no table row fails, and so does a row with no route', async () => {
      const world = buildWorld({
        bootCanary,
        promptCanary,
        extend: (router) => { router.get('/workspace/:urlKey/api/dashboard/planted-unlisted', (_req, res) => res.json({})); }
      });
      const table = { ...ROUTE_TABLE, 'GET /workspace/:urlKey/api/dashboard/gone': { reads: false, why: 'x' } };
      const problems = await sweep(world, { bootCanary, promptCanary, table });
      assert.ok(problems.some(p => p.includes('planted-unlisted') && p.includes('no row')), problems.join('\n'));
      assert.ok(problems.some(p => p.includes('/gone') && p.includes('not registered')), problems.join('\n'));
    });

    test('the prompt canary in a response fails unless the route is a listed exception', async () => {
      const key = 'GET /workspace/:urlKey/api/dashboard/planted-prompt';
      const world = buildWorld({
        bootCanary,
        promptCanary,
        extend: (router, { rows }) => { router.get('/workspace/:urlKey/api/dashboard/planted-prompt', (_req, res) => res.json({ prompt: rows[0].prompt })); }
      });
      const table = { ...ROUTE_TABLE, [key]: { reads: false, why: 'x' } };
      const without = await sweep(world, { bootCanary, promptCanary, table });
      assert.ok(without.some(p => p.includes('planted-prompt') && p.includes('prompt canary')), without.join('\n'));
      const withException = await sweep(world, { bootCanary, promptCanary, table, promptExceptions: { [key]: 'witness' } });
      assert.deepEqual(withException, []);
    });
  });
});
