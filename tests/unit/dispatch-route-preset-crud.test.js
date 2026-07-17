/**
 * LIN-1391 S7 — route-level: the Settings-facing dispatch presets CRUD API
 * (GET/POST /workspace/:urlKey/api/dispatch/presets, PATCH/DELETE
 * .../presets/:presetId). Follows the routes/collective.js preset-CRUD
 * convention (JSON POST/DELETE) plus an update route, backed by the same
 * `dispatchPresetsStore` LIN-1390 already wired into createDispatchRoutes.
 *
 * Mirrors the buildApp/call scaffolding in dispatch-route-presets.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchPresetsStore } from '../../lib/dispatch-presets-store.js';

function createMockCollection() {
  const docs = [];
  return {
    async findOne(query) {
      return docs.find(d => d._id === query._id && (query.urlKey === undefined || d.urlKey === query.urlKey)) || null;
    },
    async updateOne(query, update, options = {}) {
      let doc = docs.find(d => d._id === query._id && (query.urlKey === undefined || d.urlKey === query.urlKey));
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
    async deleteOne(query) {
      const idx = docs.findIndex(d => d._id === query._id && d.urlKey === query.urlKey);
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
  };
}

function buildApp({ dispatchPresetsStore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: { addItem: async () => ({ _id: 'disp-1' }) },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: null,
    dispatchPresetsStore
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

const BASE = '/workspace/acme/api/dispatch/presets';

describe('LIN-1391 S7 — GET /workspace/:urlKey/api/dispatch/presets', () => {
  test('lists presets for the workspace, empty when none saved', async () => {
    const app = buildApp({ dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'get', BASE);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.presets, []);
  });

  test('returns saved presets', async () => {
    const store = new DispatchPresetsStore({ collection: createMockCollection() });
    await store.createCustom('acme', { name: 'P1', config: { model: 'm1' } });
    const app = buildApp({ dispatchPresetsStore: store });
    const res = await call(app, 'get', BASE);
    assert.equal(res.status, 200);
    assert.equal(res.body.presets.length, 1);
    assert.equal(res.body.presets[0].name, 'P1');
  });

  test('never lists another workspace\'s presets', async () => {
    const store = new DispatchPresetsStore({ collection: createMockCollection() });
    await store.createCustom('other-workspace', { name: 'Not mine', config: {} });
    const app = buildApp({ dispatchPresetsStore: store });
    const res = await call(app, 'get', BASE);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.presets, []);
  });

  test('absent store: empty list, not an error', async () => {
    const app = buildApp({});
    const res = await call(app, 'get', BASE);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.presets, []);
  });
});

describe('LIN-1391 S7 — POST /workspace/:urlKey/api/dispatch/presets', () => {
  test('creates a preset with model+harness', async () => {
    const app = buildApp({ dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', BASE, { name: 'My preset', model: 'anthropic/claude-opus-4.8', harness: 'claude-code' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.preset.name, 'My preset');
    assert.deepEqual(res.body.preset.config, { model: 'anthropic/claude-opus-4.8', harness: 'claude-code' });
    assert.ok(res.body.preset.id);
  });

  test('creates a partial ("blend") preset — harness only, model omitted from config', async () => {
    const app = buildApp({ dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', BASE, { name: 'Harness only', harness: 'opencode' });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.preset.config, { harness: 'opencode' });
  });

  test('rejects a missing name (400, store validation surfaced)', async () => {
    const app = buildApp({ dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', BASE, { model: 'm1' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /required/i);
  });

  test('rejects an oversized model field (400, before the store is even called)', async () => {
    const app = buildApp({ dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', BASE, { name: 'X', model: 'a'.repeat(1001) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /model/i);
  });

  test('rejects dangerous control characters in harness', async () => {
    const app = buildApp({ dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', BASE, { name: 'X', harness: 'bad\x00harness' });
    assert.equal(res.status, 400);
  });

  test('enforces the store\'s custom-preset cap as a 400, not a 500', async () => {
    const store = new DispatchPresetsStore({ collection: createMockCollection(), maxCustom: 1 });
    const app = buildApp({ dispatchPresetsStore: store });
    await call(app, 'post', BASE, { name: 'First' });
    const res = await call(app, 'post', BASE, { name: 'Second' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /maximum/i);
  });

  test('absent store: 503', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', BASE, { name: 'X' });
    assert.equal(res.status, 503);
  });

  test('never authoring byKind from this route (LIN-1391 scope: top-level model/harness only)', async () => {
    const app = buildApp({ dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', BASE, { name: 'X', model: 'm1', byKind: { review: { model: 'sneaky' } } });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.preset.config, { model: 'm1' });
  });
});

describe('LIN-1391 S7 — PATCH /workspace/:urlKey/api/dispatch/presets/:presetId', () => {
  test('updates name and config', async () => {
    const store = new DispatchPresetsStore({ collection: createMockCollection() });
    const created = await store.createCustom('acme', { name: 'Old name', config: { model: 'old-model' } });
    const app = buildApp({ dispatchPresetsStore: store });

    const res = await call(app, 'patch', `${BASE}/${created.id}`, { name: 'New name', model: 'new-model', harness: 'opencode' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.preset.name, 'New name');
    assert.deepEqual(res.body.preset.config, { model: 'new-model', harness: 'opencode' });
  });

  test('preserves an existing byKind blend the UI never authors (out of S7 scope)', async () => {
    const store = new DispatchPresetsStore({ collection: createMockCollection() });
    const created = await store.createCustom('acme', {
      name: 'Blend',
      config: { model: 'top-model', byKind: { review: { model: 'review-model' } } }
    });
    const app = buildApp({ dispatchPresetsStore: store });

    // Settings only ever posts top-level model/harness — never byKind.
    const res = await call(app, 'patch', `${BASE}/${created.id}`, { name: 'Blend', model: 'top-model-2' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.preset.config, {
      model: 'top-model-2',
      byKind: { review: { model: 'review-model' } }
    });
  });

  test('404s an unknown preset id', async () => {
    const app = buildApp({ dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'patch', `${BASE}/ghost-id`, { name: 'X' });
    assert.equal(res.status, 404);
  });

  test('never updates another workspace\'s preset (partition isolation)', async () => {
    const store = new DispatchPresetsStore({ collection: createMockCollection() });
    const created = await store.createCustom('other-workspace', { name: 'Not mine', config: {} });
    const app = buildApp({ dispatchPresetsStore: store });
    const res = await call(app, 'patch', `${BASE}/${created.id}`, { name: 'Hijacked' });
    assert.equal(res.status, 404);
  });

  test('rejects an oversized model field', async () => {
    const store = new DispatchPresetsStore({ collection: createMockCollection() });
    const created = await store.createCustom('acme', { name: 'X', config: {} });
    const app = buildApp({ dispatchPresetsStore: store });
    const res = await call(app, 'patch', `${BASE}/${created.id}`, { model: 'a'.repeat(1001) });
    assert.equal(res.status, 400);
  });

  test('absent store: 503', async () => {
    const app = buildApp({});
    const res = await call(app, 'patch', `${BASE}/some-id`, { name: 'X' });
    assert.equal(res.status, 503);
  });
});

describe('LIN-1391 S7 — DELETE /workspace/:urlKey/api/dispatch/presets/:presetId', () => {
  test('deletes an existing preset', async () => {
    const store = new DispatchPresetsStore({ collection: createMockCollection() });
    const created = await store.createCustom('acme', { name: 'X', config: {} });
    const app = buildApp({ dispatchPresetsStore: store });

    const res = await call(app, 'delete', `${BASE}/${created.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const listRes = await call(app, 'get', BASE);
    assert.deepEqual(listRes.body.presets, []);
  });

  test('404s an unknown preset id', async () => {
    const app = buildApp({ dispatchPresetsStore: new DispatchPresetsStore({ collection: createMockCollection() }) });
    const res = await call(app, 'delete', `${BASE}/ghost-id`);
    assert.equal(res.status, 404);
  });

  test('never deletes another workspace\'s preset (partition isolation)', async () => {
    const store = new DispatchPresetsStore({ collection: createMockCollection() });
    const created = await store.createCustom('other-workspace', { name: 'Not mine', config: {} });
    const app = buildApp({ dispatchPresetsStore: store });
    const res = await call(app, 'delete', `${BASE}/${created.id}`);
    assert.equal(res.status, 404);

    const stillThere = await store.get('other-workspace', created.id);
    assert.ok(stillThere);
  });

  test('absent store: 503', async () => {
    const app = buildApp({});
    const res = await call(app, 'delete', `${BASE}/some-id`);
    assert.equal(res.status, 503);
  });
});
