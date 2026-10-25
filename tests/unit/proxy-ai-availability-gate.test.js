// LIN-2427: route-level behaviour of the one AI-availability gate
// (lib/chat-request.js `isAiUnavailable`) at its proxy-family call sites and at
// the `aiConfigured` page renders. proxy-free-tier.test.js pins the resolver and
// the predicate's truth table; this file pins that each proxy site actually
// CONSULTS the gate (deleting a gate, or flipping its `mockAi` flag, goes red).
// Every proxy case here ends at or before the gate or on the mock path: a request
// that PASSED the gate would call OpenRouter, which the hermetic suite forbids.
//
// Setup: no server key (OPENROUTER_API_KEY / OPENROUTER_FREE_TIER_KEY unset), no
// token-creator key (getWorkspaceOpenRouterKey -> null). A non-`test-token`
// workspace credential makes `isTestMode` false, so the gate decides; the
// `test-token` credential is the mock bypass and must not 503.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { BASE_DEPS, buildApp, call } from './lib/proxy-fake-deps.js';
import { createTaskChatRoutes } from '../../routes/task-chat.js';
import { createShipBiscuitRoutes } from '../../routes/ship-biscuit.js';

process.env.NODE_ENV = 'test';

const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENROUTER_FREE_TIER_KEY'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const REAL_TOKEN = { resolveWorkspaceAccess: async () => ({ token: 'real-token', reason: 'ok' }) };
const MOCK_TOKEN = { resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }) };

// A provider that can serve the recap/brief context fetch for a non-test token.
function providerWithContext() {
  const base = BASE_DEPS().provider;
  return {
    ...base,
    fetchIssueContext: async () => ({ issue: { id: 'i1', identifier: 'LIN-1' } }),
    fetchRecommendationContext: async () => ({ issue: { id: 'i1', identifier: 'TEST-1', title: 't' }, comments: [] }),
  };
}

const PROXY_SITES = [
  { name: 'GET /recommend', method: 'get', path: '/api/proxy/recommend/TEST-1', expect: /AI recommendations not configured/ },
  { name: 'GET /recap', method: 'get', path: '/api/proxy/recap/TEST-1', expect: /AI recap is not configured/ },
  { name: 'POST /recap', method: 'post', path: '/api/proxy/recap/TEST-1', body: {}, expect: /AI recap is not configured/ },
  { name: 'GET /brief', method: 'get', path: '/api/proxy/brief/TEST-1', expect: /AI brief is not configured/ },
  { name: 'POST /brief', method: 'post', path: '/api/proxy/brief/TEST-1', body: {}, expect: /AI brief is not configured/ },
  { name: 'POST /recommend-and-dispatch', method: 'post', path: '/api/proxy/recommend-and-dispatch', body: { issueIdentifier: 'TEST-1' }, expect: /AI recommendations not configured/ },
];

describe('proxy-family availability gate (no key anywhere)', () => {
  for (const site of PROXY_SITES) {
    test(`${site.name}: 503 with its own message when no key resolves`, async () => {
      const app = buildApp({ ...REAL_TOKEN, provider: providerWithContext() });
      const res = await call(app, site.method, site.path, { body: site.body });
      assert.equal(res.status, 503, JSON.stringify(res.body));
      assert.match(JSON.stringify(res.body), site.expect);
    });

    test(`${site.name}: the test-token mock bypasses the gate (no 503)`, async () => {
      const app = buildApp({ ...MOCK_TOKEN, provider: providerWithContext() });
      const res = await call(app, site.method, site.path, { body: site.body });
      assert.notEqual(res.status, 503, JSON.stringify(res.body));
    });
  }

  test('GET /recommend: the ?kind= override makes no model call, so it stays outside the gate', async () => {
    const app = buildApp({ ...REAL_TOKEN, provider: providerWithContext() });
    const res = await call(app, 'get', '/api/proxy/recommend/TEST-1?kind=plan');
    assert.doesNotMatch(JSON.stringify(res.body), /not configured/);
  });

  test('flight-companion turn: 503 when no key resolves, even on the test token (mockAi is false there)', async () => {
    for (const deps of [REAL_TOKEN, MOCK_TOKEN]) {
      const app = buildApp({ ...deps, provider: providerWithContext() });
      const res = await call(app, 'post', '/api/proxy/flight-companion/turn', { body: { message: 'hi' } });
      assert.equal(res.status, 503, JSON.stringify(res.body));
      assert.match(JSON.stringify(res.body), /AI is not configured/);
    }
  });
});

// The `aiConfigured` renders (task-chat, ship-biscuit) read
// `resolveChatCredential(...).available`; each page prints a
// `data-ai-unconfigured` warning exactly when no key resolves.
describe('aiConfigured page renders', () => {
  const workspace = { urlKey: 'acme', name: 'Acme' };
  const stubs = {
    workspaceFromUrl: (req, res, next) => { req.workspace = workspace; next(); },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    workspacePreferencesStore: {},
    getOpenRouterSource: () => 'none',
    getDeployInfo: () => ({}),
  };

  function pageApp(router) {
    const app = express();
    app.use((req, res, next) => {
      req.session = { features: { taskChat: true, shipBiscuit: true }, workspaces: [workspace] };
      next();
    });
    app.use(router);
    return app;
  }

  const PAGES = [
    { name: 'task-chat', path: '/workspace/acme/task-chat', build: () => createTaskChatRoutes(stubs) },
    { name: 'ship-biscuit', path: '/workspace/acme/ship-biscuit', build: () => createShipBiscuitRoutes(stubs) },
  ];

  for (const page of PAGES) {
    test(`${page.name}: warns when no key resolves, and not when a free-tier key is set`, async () => {
      const app = pageApp(page.build());
      const bare = await call(app, 'get', page.path);
      assert.equal(bare.status, 200, String(bare.body).slice(0, 300));
      assert.match(bare.body, /data-ai-unconfigured/);

      process.env.OPENROUTER_FREE_TIER_KEY = 'free-key';
      const keyed = await call(app, 'get', page.path);
      assert.equal(keyed.status, 200);
      assert.doesNotMatch(keyed.body, /data-ai-unconfigured/);
    });
  }
});
