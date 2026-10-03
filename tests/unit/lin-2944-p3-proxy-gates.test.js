/**
 * LIN-2944 P3 — addendum 14: the FEATURES.PROXY default flip, and the
 * explicit `features.proxy:false` override still enforcing every gate.
 *
 * The nav link, `/proxy` page, token-mint gate, next-run inline Dispatch and the
 * passage-planner notice are covered by kept-behavior e2e/unit cases:
 *   - nav link + `/proxy` redirect: tests/e2e/feature-toggles.spec.js
 *   - token-mint gate: tests/unit/proxy-token-route-ownerless.test.js
 *   - next-run inline Dispatch: tests/unit/render-next-run-budget-dial.test.js
 *   - passage-planner notice: tests/unit/render-passage-planner.test.js
 * The autopilot-prompt route gate had NO proxy-off coverage, so it is pinned
 * here (it returns 403 before any provider work when proxy is off).
 */
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { FEATURES, FEATURE_DEFAULTS, getFeatureFlags } from '../../lib/feature-defaults.js';
import { testMockData } from '../fixtures/mock-data.js';

before(() => { process.env.NODE_ENV = 'test'; });

const MOCK_ISSUE = testMockData.issues[0];

/** Mount the workspace-api router with the given session feature flags. */
function buildApp(features) {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { accessToken: 'test-token', urlKey: 'test-workspace' };
      req.session = { features };
      next();
    },
    freeTierStore: {},
    getOpenRouterSource: () => null,
    userPreferencesStore: {},
    workspacePreferencesStore: {},
    customPromptsStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    reportHistoryStore: {},
    dispatchQueueStore: {},
    agentStatusStore: {},
    promptTraceStore: {},
    proxyTokenStore: {},
  }));
  return app;
}

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const get = async (path) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
  };
  try {
    return await fn(get);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-2944 P3 — FEATURES.PROXY default flip (addendum 14)', () => {
  test('the default is ON', () => {
    assert.equal(FEATURE_DEFAULTS[FEATURES.PROXY], true);
    assert.equal(getFeatureFlags({}).proxy, true);
  });

  test('an explicit features.proxy:false still wins over the default', () => {
    assert.equal(getFeatureFlags({ features: { proxy: false } }).proxy, false);
  });
});

describe('LIN-2944 P3 — the autopilot-prompt gate (proxy:false enforced)', () => {
  test('proxy off → 403 Proxy feature is not enabled, no prompt body', async () => {
    const app = buildApp({ proxy: false });
    const { status, body } = await withServer(app, get =>
      get(`/workspace/test-workspace/api/autopilot-prompt/${MOCK_ISSUE.id}`));
    assert.equal(status, 403);
    assert.equal(body.error, 'Proxy feature is not enabled');
    assert.equal(body.prompt, undefined);
  });

  test('proxy on → the route serves the kickoff', async () => {
    const app = buildApp({ proxy: true });
    const { status, body } = await withServer(app, get =>
      get(`/workspace/test-workspace/api/autopilot-prompt/${MOCK_ISSUE.id}`));
    assert.equal(status, 200);
    assert.equal(body.kind, 'autopilot');
  });
});
