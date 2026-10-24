/**
 * LIN-3849 (was LIN-2944 P3 addendum 14): the `proxy` switch is gone, so key
 * tools have no gate. This file used to pin the FEATURES.PROXY default flip and
 * the 403 the autopilot-prompt route returned when `features.proxy` was false;
 * it now pins the opposite: the switch no longer exists, and a stale stored
 * `proxy:false` cannot turn the route off.
 */
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { FEATURES, FEATURE_DEFAULTS, getFeatureFlags } from '../../lib/feature-defaults.js';
import { testMockData } from '../../lib/sample-data/mock-data.js';

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

describe('LIN-3849 — there is no proxy switch', () => {
  test('neither dispatch nor proxy is a feature key, default or flag', () => {
    assert.equal(FEATURES.PROXY, undefined);
    assert.equal(FEATURES.DISPATCH, undefined);
    assert.ok(!('proxy' in getFeatureFlags({})));
    assert.ok(!('dispatch' in getFeatureFlags({})));
    assert.ok(!('proxy' in FEATURE_DEFAULTS) && !('dispatch' in FEATURE_DEFAULTS));
  });

  test('a stale stored proxy:false / dispatch:true is dropped, not honoured', () => {
    const flags = getFeatureFlags({ features: { proxy: false, dispatch: true } });
    assert.ok(!('proxy' in flags));
    assert.ok(!('dispatch' in flags));
  });
});

describe('LIN-3849 — the autopilot-prompt route has no flag gate', () => {
  for (const [name, features] of [['no flags', {}], ['a stale stored proxy:false', { proxy: false }]]) {
    test(`${name} → the route serves the kickoff`, async () => {
      const app = buildApp(features);
      const { status, body } = await withServer(app, get =>
        get(`/workspace/test-workspace/api/autopilot-prompt/${MOCK_ISSUE.id}`));
      assert.equal(status, 200);
      assert.equal(body.kind, 'autopilot');
    });
  }

  test('the general (issueless) route is served too', async () => {
    const app = buildApp({ proxy: false });
    const { status } = await withServer(app, get => get('/workspace/test-workspace/api/autopilot-prompt'));
    assert.equal(status, 200);
  });
});
