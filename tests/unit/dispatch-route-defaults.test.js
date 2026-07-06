/**
 * LIN-1094 — route-level: the user-facing POST /workspace/:urlKey/api/dispatch
 * resolves blank incoming `model`/`harness` against the workspace's stored
 * `dispatchDefaults` (per-kind override -> workspace-wide default -> null)
 * before persisting the dispatch item. This is the ONE server-side seam where
 * resolution happens (routes/dispatch.js); the store itself only holds data.
 *
 * Mirrors the harness/model plumbing test in dispatch-route-model.test.js —
 * same buildApp/call scaffolding, plus an injected workspacePreferencesStore
 * backed by a real WorkspacePreferencesStore over an in-memory collection so
 * the precedence logic runs against the actual store shape.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
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
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-07-06T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
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

const PATH = '/workspace/acme/api/dispatch';

describe('LIN-1094 — backward compatibility: no defaults configured', () => {
  test('no workspacePreferencesStore wired at all: null passthrough unchanged', async () => {
    const captured = {};
    const app = buildApp(captured); // workspacePreferencesStore omitted entirely
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.model, null);
    assert.strictEqual(captured.item.harness, null);
  });

  test('a store is wired but no dispatchDefaults are configured: null passthrough unchanged', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.model, null);
    assert.strictEqual(captured.item.harness, null);
  });

  test('an explicit model/harness still wins over configured defaults (no resolution needed)', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: { model: 'default-model', harness: 'default-harness' }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', PATH, {
      prompt: 'run me',
      kind: 'implementation',
      model: 'explicit-model',
      harness: 'explicit-harness'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'explicit-model');
    assert.equal(captured.item.harness, 'explicit-harness');
  });
});

describe('LIN-1094 — precedence: per-kind override > workspace-wide > null', () => {
  test('workspace-wide default fills in blank model/harness', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: { model: 'workspace-model', harness: 'workspace-harness' }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation' });

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
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'kind-model');
    assert.equal(captured.item.harness, 'kind-harness');
  });

  test('a non-matching kind falls back to the workspace-wide default, not the other kind\'s override', async () => {
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
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'review' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'workspace-model');
    assert.equal(captured.item.harness, 'workspace-harness');
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
    // 'implementation' is a recognized PROMPT_TEMPLATES display name/key alias.
    const res = await call(app, 'post', PATH, { prompt: 'run me', promptName: 'implementation' });

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
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', model: 'explicit-model' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'explicit-model');
    assert.equal(captured.item.harness, 'workspace-harness');
  });

  test('is workspace-scoped: another workspace with no defaults still gets null passthrough', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', {
      dispatchDefaults: { model: 'workspace-model', harness: 'workspace-harness' }
    });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', '/workspace/other-workspace/api/dispatch', { prompt: 'run me', kind: 'implementation' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.model, null);
    assert.strictEqual(captured.item.harness, null);
  });
});
