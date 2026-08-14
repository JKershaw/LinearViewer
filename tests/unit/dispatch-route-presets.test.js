/**
 * LIN-1390 S6 — route-level: the user-facing POST /workspace/:urlKey/api/dispatch
 * accepts an optional `presetId`, validates it against the injected
 * dispatchPresetsStore (unknown/invalid -> 400 via badRequest.json, mirroring
 * every other malformed-field rejection on this route), and threads it into
 * the shared dispatch factory so the selected preset's config takes routing
 * precedence over workspace dispatchDefaults.
 *
 * Mirrors the buildApp/call scaffolding in dispatch-route-defaults.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { WorkspacePreferencesStore } from '../../lib/workspace-preferences.js';
import { DispatchPresetsStore } from '../../lib/dispatch-presets-store.js';

function createMockCollection() {
  const docs = [];
  return {
    async findOne(query) { return docs.find(d => d._id === query._id) || null; },
    async updateOne(query, update, options = {}) {
      let doc = docs.find(d => d._id === query._id);
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 };
        doc = { _id: query._id, ...(update.$setOnInsert || {}) };
        docs.push(doc);
      }
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1 };
    },
    find(query = {}) {
      const results = docs.filter(d => (query.urlKey === undefined || d.urlKey === query.urlKey));
      return { async toArray() { return results.slice(); } };
    },
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
  };
}

function buildApp(captured, { workspacePreferencesStore, dispatchPresetsStore, dispatchQueueStore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: dispatchQueueStore || {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-07-17T00:00:00.000Z', ...item };
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
    workspacePreferencesStore,
    dispatchPresetsStore
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
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

describe('LIN-1390 S6 — POST /workspace/:urlKey/api/dispatch presetId', () => {
  test('no presetId at all: byte-identical to pre-LIN-1390 (no-preset regression)', async () => {
    const captured = {};
    const app = buildApp(captured, { dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.model, null);
    assert.strictEqual(captured.item.harness, null);
    assert.strictEqual(captured.item.presetConfig, null);
  });

  test('an unknown presetId is rejected 400 via badRequest.json', async () => {
    const captured = {};
    const presetsStore = new DispatchPresetsStore({ collection: createMockCollection() });
    const app = buildApp(captured, { dispatchPresetsStore: presetsStore });
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', presetId: 'ghost-id' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error, JSON.stringify(res.body));
  });

  test('a non-string presetId is rejected 400', async () => {
    const captured = {};
    const app = buildApp(captured, { dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', presetId: 42 });
    assert.equal(res.status, 400);
  });

  test('a valid presetId resolves model/harness through the preset and beats workspace dispatchDefaults', async () => {
    const captured = {};
    const presetsStore = new DispatchPresetsStore({ collection: createMockCollection() });
    const created = await presetsStore.createCustom('acme', { name: 'P', config: { model: 'preset-model', harness: 'preset-harness' } });

    const prefsStore = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await prefsStore.saveWorkspacePreferences('acme', { dispatchDefaults: { model: 'ws-model', harness: 'ws-harness' } });

    const app = buildApp(captured, { dispatchPresetsStore: presetsStore, workspacePreferencesStore: prefsStore });
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', presetId: created.id });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'preset-model');
    assert.equal(captured.item.harness, 'preset-harness');
  });

  test('an explicit incoming model/harness still beats the selected preset', async () => {
    const captured = {};
    const presetsStore = new DispatchPresetsStore({ collection: createMockCollection() });
    const created = await presetsStore.createCustom('acme', { name: 'P', config: { model: 'preset-model', harness: 'preset-harness' } });

    const app = buildApp(captured, { dispatchPresetsStore: presetsStore });
    const res = await call(app, 'post', PATH, {
      prompt: 'run me', kind: 'implementation', presetId: created.id, model: 'explicit-model', harness: 'explicit-harness'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'explicit-model');
    assert.equal(captured.item.harness, 'explicit-harness');
  });

  test('no dispatchPresetsStore wired at all: a presetId is accepted but has no effect (degrades gracefully)', async () => {
    const captured = {};
    const app = buildApp(captured); // dispatchPresetsStore omitted entirely
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', presetId: 'whatever' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.model, null);
    assert.strictEqual(captured.item.presetConfig, null);
  });

  test('a selected preset on kind:autopilot stamps presetConfig/presetName on the dispatched item', async () => {
    const captured = {};
    const presetsStore = new DispatchPresetsStore({ collection: createMockCollection() });
    const created = await presetsStore.createCustom('acme', { name: 'Autopilot Preset', config: { model: 'preset-model' } });

    const app = buildApp(captured, { dispatchPresetsStore: presetsStore });
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'autopilot', presetId: created.id });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(captured.item.presetConfig, { model: 'preset-model' });
    assert.equal(captured.item.presetName, 'Autopilot Preset');
  });
});
