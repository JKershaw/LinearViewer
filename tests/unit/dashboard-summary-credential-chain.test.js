/**
 * LIN-3840: behaviour tests for the credential chain and the free-tier gate on the
 * two dashboard summary routes (POST run-summary/:loopId, POST session-summary/:sessionId).
 *
 * These replace the source-text counts that
 * `interactive-openrouter-chain-byte-identity` kept on `routes/dashboard.js`
 * (`resolveChatCredential(` x2, `if (!apiKey) {` x2) and carry the allow-path half of
 * its "one quota unit per request" row. They drive the real router over HTTP on the
 * real (non-mock) path, so they hold wherever in `routes/` the handlers are placed.
 *
 * Transport: the OpenRouter call is faked with `setFetchImpl` (lib/openrouter.js), which
 * overrides both the native and the egress-proxy branch. `globalThis.fetch` is NOT
 * stubbed: `request()` in lib/entrance-route-sweep.js uses it for its own loopback.
 * Every key is built at runtime (lib/secret-scan.js is part of ci-success).
 *
 * Which mutation each scenario fails under (shown in the PR):
 *   (a) no key anywhere        -> the `if (!apiKey)` guard deleted
 *   (b) session key + denying  -> `sessionApiKey: req.session.openRouterApiKey` dropped
 *   (c) paid env key only      -> resolveChatCredential(...) swapped for
 *                                 { apiKey: req.session.openRouterApiKey, isFreeTier: false }
 *   (d) free-tier key + allow  -> the same swap; a second checkFreeTierGate call placed
 *                                 before the existing one (store charged twice)
 *
 * Run: node --test tests/unit/dashboard-summary-credential-chain.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { setFetchImpl } from '../../lib/openrouter.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';
import { appAround, request } from './lib/entrance-route-sweep.js';

const NOW_ISO = new Date().toISOString();
const runtimeKey = (tag) => `ck_${tag}_${randomBytes(12).toString('hex')}`;

const ENV_KEYS = ['NODE_ENV', 'HARBOUR_DISABLE_AI_MOCK', 'OPENROUTER_API_KEY', 'OPENROUTER_FREE_TIER_KEY'];

/** The real (non-mock) summary path, with the env the scenario asks for; restored in `finally`. */
async function withEnv({ paidKey = null, freeKey = null }, fn) {
  const prev = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  process.env.NODE_ENV = 'test';
  process.env.HARBOUR_DISABLE_AI_MOCK = '1';
  if (paidKey) process.env.OPENROUTER_API_KEY = paidKey; else delete process.env.OPENROUTER_API_KEY;
  if (freeKey) process.env.OPENROUTER_FREE_TIER_KEY = freeKey; else delete process.env.OPENROUTER_FREE_TIER_KEY;
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  }
}

/**
 * An OpenRouter fake for `setFetchImpl`. Answers in whichever shape streamChat asked
 * for (SSE when the body says `stream: true`, JSON otherwise: the egress-proxy branch),
 * and records the Authorization header of each request.
 */
function makeOpenRouterFake() {
  const requests = [];
  const content = JSON.stringify({ outcome: 'Shipped.', highlights: ['one'], statusLine: 'done' });
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), authorization: init.headers.Authorization });
    if (body.stream) {
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`
        + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`
        + 'data: [DONE]\n\n';
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  return { fn, requests };
}

const DENIED = { allowed: false, remaining: 0, limit: 5, resetsAt: '2030-01-01T00:00:00.000Z', reason: 'Free tier limit reached' };

function summaryApp({ session, freeTierStore }) {
  const history = [
    // run-summary target: a terminal worker run.
    { id: 'run-1', issueIdentifier: 'LIN-2', issueTitle: 'Title', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: 'pr opened' }] },
    // session-summary target: a terminal autopilot session with one worker.
    { id: 'sess-1', kind: 'autopilot', issueIdentifier: 'LIN-3', issueTitle: 'Title', promptName: 'autopilot', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken' },
    { id: 'sess-1-w', sessionId: 'sess-1', issueIdentifier: 'LIN-4', issueTitle: 'Title', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: 'pr opened' }] }
  ];
  const agentStatus = [['run-1', 'LIN-2'], ['sess-1', 'LIN-3'], ['sess-1-w', 'LIN-4']].map(([id, ident]) => ({ id: `as-${id}`, dispatchId: id, taskIdentifier: ident, action: 'implementation', status: 'completed', summary: 'all done', timestamp: NOW_ISO }));
  const router = createDashboardRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.session = session;
      req.workspace = { urlKey: 'ws-a', id: 'ws-a-id', provider: 'linear' };
      next();
    },
    dispatchQueueStore: {
      async listItems() { return []; },
      async listHistory() { return { items: withFreshDigests(history) }; }
    },
    agentStatusStore: { async listStatus() { return { items: agentStatus }; } },
    runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
    sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
    freeTierStore,
    getWorkspaceAccessToken: async () => 'workspace-token',
    fetchIssueContext: async () => ({}),
    fetchWorkspaceIssues: async () => [],
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({})
  });
  return appAround(router);
}

const ROUTES = [
  { name: 'run-summary', url: '/workspace/ws-a/api/dashboard/run-summary/run-1' },
  { name: 'session-summary', url: '/workspace/ws-a/api/dashboard/session-summary/sess-1' }
];

/** Run one POST against a summary route with the OpenRouter transport faked. */
async function post(route, { session, freeTierStore }) {
  const fake = makeOpenRouterFake();
  const storeCalls = [];
  const store = { async tryUse(urlKey) { storeCalls.push(urlKey); return freeTierStore.result; } };
  setFetchImpl(fake.fn);
  try {
    const res = await request(summaryApp({ session, freeTierStore: store }), 'POST', route.url);
    return { res, storeCalls, outbound: fake.requests };
  } finally {
    setFetchImpl(null);
  }
}

for (const route of ROUTES) {
  describe(`POST ${route.name}: credential chain and free-tier gate (LIN-3840)`, () => {
    test('(a) no key anywhere: 503 "AI summaries are not configured", no gate charge, no outbound call', async () => {
      await withEnv({}, async () => {
        const { res, storeCalls, outbound } = await post(route, { session: {}, freeTierStore: { result: { allowed: true } } });
        assert.equal(res.status, 503, res.text);
        assert.equal(res.body.error, 'AI summaries are not configured');
        assert.deepEqual(storeCalls, [], 'the free-tier store is never called');
        assert.deepEqual(outbound, [], 'no OpenRouter request is made');
      });
    });

    test('(b) the session key wins and is never free-tier: a denying store is not consulted, the session key is sent', async () => {
      const sessionKey = runtimeKey('session');
      await withEnv({ paidKey: runtimeKey('paid'), freeKey: runtimeKey('free') }, async () => {
        const { res, storeCalls, outbound } = await post(route, { session: { openRouterApiKey: sessionKey }, freeTierStore: { result: DENIED } });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(storeCalls, [], 'a session key is not on the free tier: the store is not called');
        assert.equal(outbound.length, 1);
        assert.equal(outbound[0].authorization, `Bearer ${sessionKey}`);
      });
    });

    test('(c) paid env key only: the env key is sent, the store is not called', async () => {
      const paidKey = runtimeKey('paid');
      await withEnv({ paidKey }, async () => {
        const { res, storeCalls, outbound } = await post(route, { session: {}, freeTierStore: { result: DENIED } });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(storeCalls, []);
        assert.equal(outbound.length, 1);
        assert.equal(outbound[0].authorization, `Bearer ${paidKey}`);
      });
    });

    test('(d) free-tier key only with an allowing store: charged exactly once, the free-tier key is sent', async () => {
      const freeKey = runtimeKey('free');
      await withEnv({ freeKey }, async () => {
        const { res, storeCalls, outbound } = await post(route, { session: {}, freeTierStore: { result: { allowed: true } } });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(storeCalls, ['ws-a'], 'one quota unit for the workspace, no more');
        assert.equal(outbound.length, 1);
        assert.equal(outbound[0].authorization, `Bearer ${freeKey}`);
      });
    });
  });
}
