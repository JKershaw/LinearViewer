/**
 * LIN-1099 — route-level: the proxy consumer API's dispatch-creation call
 * sites resolve blank incoming `model`/`harness` against the workspace's
 * stored `dispatchDefaults` (per-kind override -> workspace-wide default ->
 * null), reusing the exact `resolveDispatchDefaults` seam LIN-1094 wired into
 * routes/dispatch.js. The proxy API is a separate surface with THREE
 * dispatch-creation call sites, all exercised here:
 *   - POST /api/proxy/dispatch (consumer readWrite)
 *   - POST /api/proxy/recommend-and-dispatch, verb-override branch (kind set)
 *   - POST /api/proxy/recommend-and-dispatch, recommendation-derived branch
 *     (no kind -> LLM/test-token descent resolves the action)
 *
 * Mirrors tests/unit/dispatch-route-defaults.test.js's scenarios, and reuses
 * proxy-dispatch-model.test.js's buildApp/TEST-14 scaffolding for the
 * recommendation-derived branch.
 *
 * LIN-1159 NOTE: the proxy dispatch boundary now interposes `claude-code` as the
 * default resolved harness (applyDefaultDispatchHarness), so a blank harness with
 * no configured default resolves to 'claude-code' rather than null. `model` keeps
 * its null-passthrough (no default interposed). The "no default configured" cases
 * below therefore assert model:null but harness:'claude-code'.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { WorkspacePreferencesStore } from '../../lib/workspace-preferences.js';

function createMockCollection() {
  const docs = [];
  return {
    async findOne(query) {
      return docs.find(d => d._id === query._id) || null;
    },
    async updateOne(query, update, options = {}) {
      let doc = docs.find(d => d._id === query._id);
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 };
        doc = { _id: query._id, ...(update.$setOnInsert || {}) };
        docs.push(doc);
      }
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1 };
    }
  };
}

function buildApp(captured, { workspacePreferencesStore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-07-06T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore,
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

describe('LIN-1099 — POST /api/proxy/dispatch resolves dispatchDefaults', () => {
  test('no workspacePreferencesStore wired at all: model null passthrough, harness defaults to claude-code (LIN-1159)', async () => {
    const captured = {};
    const app = buildApp(captured); // workspacePreferencesStore omitted entirely
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', kind: 'implementation' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.model, null);
    assert.strictEqual(captured.item.harness, 'claude-code');
  });

  test('a store is wired but no dispatchDefaults are configured: model null passthrough, harness defaults to claude-code (LIN-1159)', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', kind: 'implementation' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.model, null);
    assert.strictEqual(captured.item.harness, 'claude-code');
  });

  test('an explicit model/harness still wins over configured defaults', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: { model: 'default-model', harness: 'default-harness' }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'run me',
      kind: 'implementation',
      model: 'explicit-model',
      harness: 'explicit-harness'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'explicit-model');
    assert.equal(captured.item.harness, 'explicit-harness');
  });

  test('workspace-wide default fills in blank model/harness', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: { model: 'workspace-model', harness: 'workspace-harness' }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', kind: 'implementation' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'workspace-model');
    assert.equal(captured.item.harness, 'workspace-harness');
  });

  test('per-kind override beats the workspace-wide default for a matching kind', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: {
        model: 'workspace-model',
        harness: 'workspace-harness',
        byKind: {
          implementation: { model: 'kind-model', harness: 'kind-harness' }
        }
      }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', kind: 'implementation' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'kind-model');
    assert.equal(captured.item.harness, 'kind-harness');
  });

  test('kind is derived from promptName when omitted, and still drives per-kind resolution', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: {
        byKind: {
          implementation: { model: 'kind-model', harness: 'kind-harness' }
        }
      }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'run me', promptName: 'implementation' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.kind, 'implementation');
    assert.equal(captured.item.model, 'kind-model');
    assert.equal(captured.item.harness, 'kind-harness');
  });

  test('model and harness resolve independently: an explicit model keeps a defaulted harness', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: { model: 'workspace-model', harness: 'workspace-harness' }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'run me', kind: 'implementation', model: 'explicit-model'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'explicit-model');
    assert.equal(captured.item.harness, 'workspace-harness');
  });
});

describe('LIN-1099 — POST /api/proxy/recommend-and-dispatch resolves dispatchDefaults (verb-override branch)', () => {
  test('workspace-wide default fills in blank model/harness', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: { model: 'workspace-model', harness: 'workspace-harness' }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'verb-override path must dispatch an item');
    assert.equal(captured.item.model, 'workspace-model');
    assert.equal(captured.item.harness, 'workspace-harness');
  });

  test('per-kind override beats the workspace-wide default, and an explicit caller value still wins', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: {
        model: 'workspace-model',
        harness: 'workspace-harness',
        byKind: {
          implementation: { model: 'kind-model', harness: 'kind-harness' }
        }
      }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', model: 'explicit-model'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'explicit-model');
    assert.equal(captured.item.harness, 'kind-harness');
  });

  test('no store wired: model null passthrough, harness defaults to claude-code (LIN-1159)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.model, null);
    assert.strictEqual(captured.item.harness, 'claude-code');
  });
});

describe('LIN-1099 — POST /api/proxy/recommend-and-dispatch resolves dispatchDefaults (recommendation-derived branch)', () => {
  // No `kind` in the request: the test-token short-circuit resolves TEST-14
  // (a started, childless fixture) to an `implement` action, so the descent
  // terminates on the recommendation-derived addItem seam, not the
  // verb-override one — proven below via deriveDispatchKind('implement').
  test('workspace-wide default fills in blank model/harness', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: { model: 'workspace-model', harness: 'workspace-harness' }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'recommendation-derived path must dispatch an item');
    assert.equal(captured.item.issueIdentifier, 'TEST-14');
    assert.equal(captured.item.model, 'workspace-model');
    assert.equal(captured.item.harness, 'workspace-harness');
  });

  test('per-kind override is keyed off the resolved recommendation kind, not a caller-supplied one', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: {
        model: 'workspace-model',
        harness: 'workspace-harness',
        byKind: {
          implementation: { model: 'kind-model', harness: 'kind-harness' }
        }
      }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.kind, 'implementation');
    assert.equal(captured.item.model, 'kind-model');
    assert.equal(captured.item.harness, 'kind-harness');
  });

  test('an explicit model still wins, independently of a defaulted harness', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: { model: 'workspace-model', harness: 'workspace-harness' }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14', model: 'explicit-model'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'explicit-model');
    assert.equal(captured.item.harness, 'workspace-harness');
  });

  test('no store wired: model null passthrough, harness defaults to claude-code (LIN-1159)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-14'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.model, null);
    assert.strictEqual(captured.item.harness, 'claude-code');
  });
});
