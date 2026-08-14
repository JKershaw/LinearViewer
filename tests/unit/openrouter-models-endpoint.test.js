/**
 * Unit tests for GET /workspace/:urlKey/api/openrouter/models (LIN-1111
 * Session 2) — the JSON endpoint the client-rendered dispatch-exec-controls
 * fetch to supplement the static model suggestion list with the live
 * OpenRouter catalog.
 *
 * Run with: node --test tests/unit/openrouter-models-endpoint.test.js
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { MOCK_CATALOG_MODELS, _resetCatalogCacheForTests } from '../../lib/openrouter-catalog.js';

before(() => { process.env.NODE_ENV = 'test'; });

/** Mount the workspace-api router with a workspace of the given shape. */
function buildApp(workspace) {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = workspace;
      req.session = { features: {} };
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

// Deliberately Node's `http` module, NOT global fetch: these tests mock
// global.fetch to control the server's OWN outbound call to OpenRouter, and
// the test harness's request to its own local server must not collide with
// that mock.
async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    return await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

let originalFetch;
beforeEach(() => {
  originalFetch = global.fetch;
  _resetCatalogCacheForTests();
});
afterEach(() => {
  global.fetch = originalFetch;
  _resetCatalogCacheForTests();
});

test('test-token workspace (mock-gated) returns the canned catalog without a live fetch', async () => {
  global.fetch = () => { throw new Error('must not be called'); };
  const app = buildApp({ accessToken: 'test-token', urlKey: 'test-workspace' });
  const { status, body } = await get(app, '/workspace/test-workspace/api/openrouter/models');
  assert.equal(status, 200);
  assert.deepEqual(body.models, MOCK_CATALOG_MODELS);
});

test('local-provider workspace (mock-gated) returns the canned catalog without a live fetch', async () => {
  global.fetch = () => { throw new Error('must not be called'); };
  const app = buildApp({ provider: 'local', urlKey: 'test-workspace' });
  const { status, body } = await get(app, '/workspace/test-workspace/api/openrouter/models');
  assert.equal(status, 200);
  assert.deepEqual(body.models, MOCK_CATALOG_MODELS);
});

test('a non-mocked workspace hits the real (mocked-fetch) catalog path', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: 'openai/gpt-x', name: 'GPT X' }] })
  });
  const app = buildApp({ accessToken: 'real-linear-token', urlKey: 'test-workspace' });
  const { status, body } = await get(app, '/workspace/test-workspace/api/openrouter/models');
  assert.equal(status, 200);
  assert.deepEqual(body.models, [{ id: 'openai/gpt-x', name: 'GPT X' }]);
});

test('degrades to 200 {models: []} — never 500s — when the live catalog is unreachable', async () => {
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const app = buildApp({ accessToken: 'real-linear-token', urlKey: 'test-workspace' });
  const { status, body } = await get(app, '/workspace/test-workspace/api/openrouter/models');
  assert.equal(status, 200);
  assert.deepEqual(body.models, []);
});
