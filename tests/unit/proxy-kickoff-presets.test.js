/**
 * LIN-1390 S6 — route-level: POST /api/proxy/autopilot/kickoff accepts an
 * optional `presetId`, validates it against the injected dispatchPresetsStore
 * (unknown/invalid -> 400 via badRequest.json), and threads it into the
 * shared dispatch factory so the selected preset's config takes routing
 * precedence over workspace dispatchDefaults — mirroring the session-route
 * coverage in dispatch-route-presets.test.js for the proxy kickoff twin.
 *
 * Mirrors the buildApp/call scaffolding in proxy-dispatch-bootstrap-token.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
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

function buildApp(captured, { dispatchPresetsStore, workspacePreferencesStore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      createToken: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' })
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
        return { _id: 'disp-1', dispatchedAt: '2026-07-17T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: workspacePreferencesStore || { getWorkspacePreferences: async () => ({}) },
    dispatchPresetsStore,
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
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const PATH = '/api/proxy/autopilot/kickoff';

describe('LIN-1390 S6 — POST /api/proxy/autopilot/kickoff presetId', () => {
  test('no presetId at all: byte-identical to pre-LIN-1390 (no-preset regression) — interposed claude-code harness', async () => {
    const captured = {};
    const app = buildApp(captured, { dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', PATH, { goal: 'ship it', target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.model, null);
    assert.equal(captured.item.harness, 'claude-code');
    assert.strictEqual(captured.item.presetConfig, null);
  });

  test('an unknown presetId is rejected 400 via badRequest.json', async () => {
    const captured = {};
    const presetsStore = new DispatchPresetsStore({ collection: createMockCollection() });
    const app = buildApp(captured, { dispatchPresetsStore: presetsStore });
    const res = await call(app, 'post', PATH, { goal: 'ship it', target: 'cli', presetId: 'ghost-id' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error, JSON.stringify(res.body));
  });

  test('a valid presetId resolves model/harness through the preset and stamps presetConfig/presetName (autopilot kind)', async () => {
    const captured = {};
    const presetsStore = new DispatchPresetsStore({ collection: createMockCollection() });
    const created = await presetsStore.createCustom('acme', { name: 'Kickoff Preset', config: { model: 'preset-model', harness: 'preset-harness' } });

    const app = buildApp(captured, { dispatchPresetsStore: presetsStore });
    const res = await call(app, 'post', PATH, { goal: 'ship it', target: 'cli', presetId: created.id });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.model, 'preset-model');
    assert.equal(captured.item.harness, 'preset-harness');
    assert.deepEqual(captured.item.presetConfig, { model: 'preset-model', harness: 'preset-harness' });
    assert.equal(captured.item.presetName, 'Kickoff Preset');
  });

  test('no dispatchPresetsStore wired at all: a presetId is accepted but has no effect (degrades gracefully)', async () => {
    const captured = {};
    const app = buildApp(captured); // dispatchPresetsStore omitted entirely
    const res = await call(app, 'post', PATH, { goal: 'ship it', target: 'cli', presetId: 'whatever' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.harness, 'claude-code');
    assert.strictEqual(captured.item.presetConfig, null);
  });
});
