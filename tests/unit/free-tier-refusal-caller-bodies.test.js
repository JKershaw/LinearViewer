/**
 * LIN-3658: the free-tier refusal body at each caller that had no exact-body row.
 *
 * `freeTierRefusalBlock` (lib/chat-request.js) is proven in
 * chat-request-free-tier-rule.test.js; these rows prove each ROUTE still sends
 * it: a free-tier denial from the store is a 429 whose body is exactly
 * `{"error":<reason>,"freeTier":{"used":true,"remaining","limit","resetsAt"}}`
 * (JSON.stringify equality, so key order is part of the assertion), and the
 * gate charged the store once for the workspace. Swapping the builder for `{}`
 * at any caller turns that caller's row red.
 *
 * Callers with an existing harness keep their rows beside it: the dashboard
 * run/session summaries (dashboard-routes.test.js), Task Chat
 * (task-chat-route.test.js), Ship's Biscuit (ship-biscuit-route.test.js) and the
 * Flight Companion (flight-companion-*-route.test.js). The rest are here:
 * next-run, roadmap generate and chat, and workspace-api's `refuseFreeTier`
 * (recap) and `keepaliveError` mock-path (recommend) sites.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createNextRunRoutes } from '../../routes/next-run.js';
import { createRoadmapRoutes } from '../../routes/workspace-api-roadmap.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { testMockData } from '../../lib/sample-data/mock-data.js';

const PROVIDER_NAME = 'lin3658-caller-bodies-fake';
registerProvider({
  name: PROVIDER_NAME,
  supports: () => true,
  ui: { displayName: 'Fake' },
  async fetchProjects() { return { organizationName: 'Acme', projects: [], issues: [] }; },
  async fetchTeams() { return []; },
  async fetchRecommendationContext() { throw new Error('the gate must refuse before any context fetch'); },
});

const DENIED_RECORD = { allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 10, resetsAt: '2026-09-01T00:00:00.000Z' };
const DENIED_429_BODY = '{"error":"Free tier limit reached","freeTier":{"used":true,"remaining":0,"limit":10,"resetsAt":"2026-09-01T00:00:00.000Z"}}';

function deniedStore() {
  const calls = [];
  return { calls, async tryUse(urlKey) { calls.push(urlKey); return DENIED_RECORD; } };
}

async function withEnv(overrides, fn) {
  const prev = Object.fromEntries(Object.keys(overrides).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// A free-tier session: no session key, no paid env key, a free-tier key set.
const FREE_TIER_ENV = { NODE_ENV: 'production', OPENROUTER_API_KEY: undefined, OPENROUTER_FREE_TIER_KEY: 'free-tier-test-key' };

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    setHeader() { return this; },
    json(body) { this.jsonBody = body; return this; },
  };
}

async function assertRefused(handler, req, store, urlKey) {
  const res = makeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(JSON.stringify(res.jsonBody), DENIED_429_BODY);
  assert.deepStrictEqual(store.calls, [urlKey], 'the gate charged the store once for the workspace');
}

describe('LIN-3658: next-run suggest 429s a free-tier denial with the exact body', () => {
  test('POST /api/next-run/suggest', async () => {
    await withEnv(FREE_TIER_ENV, async () => {
      const store = deniedStore();
      const router = createNextRunRoutes({ workspaceFromUrl: (req, res, next) => next(), freeTierStore: store, workspacePreferencesStore: null, getOpenRouterSource: () => 'free', getDeployInfo: () => ({}), reportHistoryStore: null });
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/next-run/suggest');
      const req = { workspace: { urlKey: 'ws-a', provider: PROVIDER_NAME, accessToken: 'tok' }, session: { features: { nextRun: true } }, params: { urlKey: 'ws-a' }, query: {}, body: {} };
      await assertRefused(handler, req, store, 'ws-a');
    });
  });
});

describe('LIN-3658: roadmap generate and chat 429 a free-tier denial with the exact body', () => {
  function roadmapRouter(store) {
    return createRoadmapRoutes({ workspaceFromUrl: (req, res, next) => next(), freeTierStore: store, userPreferencesStore: null, workspacePreferencesStore: null, reportHistoryStore: null });
  }
  const roadmapReq = (body) => ({ workspace: { urlKey: 'ws-a', provider: PROVIDER_NAME, accessToken: 'tok' }, session: { features: { roadmap: true } }, params: { urlKey: 'ws-a' }, query: {}, body });

  test('POST /api/roadmap/generate (first-layer charge, before the stream opens)', async () => {
    await withEnv(FREE_TIER_ENV, async () => {
      const store = deniedStore();
      const handler = getHandler(roadmapRouter(store), 'post', '/workspace/:urlKey/api/roadmap/generate');
      await assertRefused(handler, roadmapReq({ northStar: 'Ship faster' }), store, 'ws-a');
    });
  });

  test('POST /api/roadmap/chat', async () => {
    await withEnv(FREE_TIER_ENV, async () => {
      const store = deniedStore();
      const handler = getHandler(roadmapRouter(store), 'post', '/workspace/:urlKey/api/roadmap/chat');
      await assertRefused(handler, roadmapReq({ question: 'where are we?' }), store, 'ws-a');
    });
  });
});

describe('LIN-3658: workspace-api 429s a free-tier denial with the exact body', () => {
  function workspaceApiRouter(store) {
    return createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      freeTierStore: store,
      getOpenRouterSource: () => 'free',
      userPreferencesStore: null,
      workspacePreferencesStore: null,
      recapCacheStore: { async get() { return null; }, async put() {} },
    });
  }

  test('refuseFreeTier: POST /api/recap/:issueId', async () => {
    await withEnv(FREE_TIER_ENV, async () => {
      const store = deniedStore();
      const handler = getHandler(workspaceApiRouter(store), 'post', '/workspace/:urlKey/api/recap/:issueId');
      const req = { workspace: { urlKey: 'ws-a', provider: PROVIDER_NAME, accessToken: 'tok' }, session: { features: {} }, params: { urlKey: 'ws-a', issueId: 'LIN-500' }, query: {}, body: {} };
      await assertRefused(handler, req, store, 'ws-a');
    });
  });

  test('keepaliveError mock path: GET /api/recommend/:issueId under the test token charges via the session flag', async () => {
    // The test-token DATA mock charges the free tier on its own, keyed by the
    // session flag (LIN-405), and answers through the keepalive transport.
    await withEnv({ NODE_ENV: 'test', OPENROUTER_API_KEY: undefined, OPENROUTER_FREE_TIER_KEY: undefined }, async () => {
      const store = deniedStore();
      const handler = getHandler(workspaceApiRouter(store), 'get', '/workspace/:urlKey/api/recommend/:issueId');
      const mockIssue = testMockData.issues[0];
      const req = { workspace: { urlKey: 'ws-a', accessToken: 'test-token' }, session: { features: {}, freeTierEnabled: true }, params: { urlKey: 'ws-a', issueId: mockIssue.id }, query: {}, body: {} };
      await assertRefused(handler, req, store, 'ws-a');
    });
  });
});
