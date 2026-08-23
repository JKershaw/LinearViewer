/**
 * Characterization tests for GET /workspace/:urlKey/api/prompt-traces
 * (LIN-2246 stage 2: moved from workspace-api.js into
 * workspace-api-prompts.js). No route-level coverage existed for this
 * endpoint before the move; this pins the three branches the handler has
 * always had — no store configured, a successful list, and a store error —
 * so a later change to workspace-api-prompts.js has something to break.
 *
 * Run with: node --test tests/unit/prompt-traces-route.test.js
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';

before(() => { process.env.NODE_ENV = 'test'; });

function buildApp({ promptTraceStore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: 'test-workspace', accessToken: 'test-token' };
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
    promptTraceStore,
    proxyTokenStore: {},
  }));
  return app;
}

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

test('no promptTraceStore configured: 200 with an empty page, never 503', async () => {
  const app = buildApp({ promptTraceStore: null });
  const { status, body } = await get(app, '/workspace/test-workspace/api/prompt-traces');
  assert.equal(status, 200);
  assert.deepEqual(body, { items: [], total: 0 });
});

test('lists traces from the store, forwarding parsed limit/offset', async () => {
  const calls = [];
  const promptTraceStore = {
    listTraces: async (urlKey, opts) => {
      calls.push({ urlKey, opts });
      return { items: [{ id: 't1' }], total: 1 };
    }
  };
  const app = buildApp({ promptTraceStore });
  const { status, body } = await get(app, '/workspace/test-workspace/api/prompt-traces?limit=10&offset=5');
  assert.equal(status, 200);
  assert.deepEqual(body, { items: [{ id: 't1' }], total: 1 });
  assert.deepEqual(calls, [{ urlKey: 'test-workspace', opts: { limit: 10, offset: 5 } }]);
});

test('clamps limit to [1, 200] and offset to >= 0, defaulting to 50/0', async () => {
  const calls = [];
  const promptTraceStore = {
    listTraces: async (urlKey, opts) => { calls.push(opts); return { items: [], total: 0 }; }
  };
  const app = buildApp({ promptTraceStore });
  await get(app, '/workspace/test-workspace/api/prompt-traces?limit=9999&offset=-5');
  await get(app, '/workspace/test-workspace/api/prompt-traces');
  assert.deepEqual(calls, [
    { limit: 200, offset: 0 },
    { limit: 50, offset: 0 },
  ]);
});

test('a store error surfaces as 500 { error }, not a crash', async () => {
  const promptTraceStore = { listTraces: async () => { throw new Error('boom'); } };
  const app = buildApp({ promptTraceStore });
  const { status, body } = await get(app, '/workspace/test-workspace/api/prompt-traces');
  assert.equal(status, 500);
  assert.deepEqual(body, { error: 'Failed to list prompt traces' });
});
