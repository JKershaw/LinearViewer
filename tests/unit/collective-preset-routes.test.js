/**
 * Route-level tests for the Collective preset CRUD routes (LIN-1050, S4 beat 2):
 *   POST   /workspace/:urlKey/collective/presets
 *   DELETE /workspace/:urlKey/collective/presets/:presetId
 *
 * Backend-only for this ticket — no picker UI yet. Mirrors the style of
 * tests/unit/collective-fanout-characterization.test.js: drives the real
 * router (createCollectiveRoutes) over an in-process HTTP server, with a
 * mock collection backing the REAL CollectivePresetsStore so persistence is
 * proven end-to-end, not just that a method was called.
 *
 * Run with: node --test tests/unit/collective-preset-routes.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCollectiveRoutes } from '../../routes/collective.js';
import { CollectivePresetsStore } from '../../lib/collective-presets-store.js';
import { BUILTIN_PRESETS } from '../../lib/collective-preset-defs.js';

function createMockCollection() {
  const docs = [];
  const matches = (doc, q) =>
    (q._id === undefined || doc._id === q._id) &&
    (q.urlKey === undefined || doc.urlKey === q.urlKey);
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(q) { return docs.find(d => matches(d, q)) || null; },
    find(q = {}) {
      const results = docs.filter(d => matches(d, q));
      return { async toArray() { return results.slice(); } };
    },
    async deleteOne(q) {
      const idx = docs.findIndex(d => matches(d, q));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(q) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], q)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    },
  };
}

function validRoster() {
  return [
    { name: 'Chair', role: 'r', lens: 'l', objective: 'o', value: 'v', disposition: 'd', isFacilitator: true },
    { name: 'Voice', role: 'r2', lens: 'l2', objective: 'o2', value: 'v2', disposition: 'd2' },
  ];
}

function validPreset(overrides = {}) {
  return {
    name: 'My Preset',
    objective: 'do the thing',
    exitCondition: 'thing is done',
    defaultTopic: 'the thing',
    roster: validRoster(),
    ...overrides,
  };
}

function buildApp({ collectivePresetsStore, featureEnabled = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createCollectiveRoutes({
    dispatchQueueStore: { addItem: async () => ({ _id: 'disp-1' }) },
    proxyTokenStore: null,
    collectivePresetsStore,
    yapClient: null,
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = {
        linearUserId: 'u1',
        features: { collective: featureEnabled },
        workspaces: [{ urlKey: req.params.urlKey, name: 'Alpha' }],
      };
      next();
    },
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

const URL_KEY = 'alpha';
const PRESETS_PATH = `/workspace/${URL_KEY}/collective/presets`;

describe('POST /collective/presets (LIN-1050)', () => {
  let store;

  beforeEach(() => {
    store = new CollectivePresetsStore({ collection: createMockCollection() });
  });

  test('creates a custom preset and persists it (visible via store.list)', async () => {
    const app = buildApp({ collectivePresetsStore: store });
    const res = await call(app, 'post', PRESETS_PATH, validPreset());

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.preset.name, 'My Preset');
    assert.equal(res.body.preset.kind, 'custom');
    assert.ok(res.body.preset.id, 'id assigned');

    const list = await store.list(URL_KEY);
    const custom = list.filter(p => p.kind === 'custom');
    assert.equal(custom.length, 1, 'persisted as a real row, not just echoed');
    assert.equal(custom[0].name, 'My Preset');
  });

  test('validation delegates to validatePreset — rejects a missing meeting field', async () => {
    const app = buildApp({ collectivePresetsStore: store });
    const res = await call(app, 'post', PRESETS_PATH, validPreset({ objective: '' }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /objective/);
  });

  test('validation delegates to validatePreset — rejects zero/multiple facilitators', async () => {
    const app = buildApp({ collectivePresetsStore: store });
    const zero = await call(app, 'post', PRESETS_PATH, validPreset({
      roster: validRoster().map(s => ({ ...s, isFacilitator: false })),
    }));
    assert.equal(zero.status, 400);
    assert.match(zero.body.error, /exactly one facilitator/);

    const many = await call(app, 'post', PRESETS_PATH, validPreset({
      roster: validRoster().map(s => ({ ...s, isFacilitator: true })),
    }));
    assert.equal(many.status, 400);
    assert.match(many.body.error, /exactly one facilitator/);
  });

  test('validation delegates to validatePreset — rejects a seat carrying a workspaceUrlKey', async () => {
    const app = buildApp({ collectivePresetsStore: store });
    const roster = validRoster();
    roster[0] = { ...roster[0], workspaceUrlKey: 'some-repo' };
    const res = await call(app, 'post', PRESETS_PATH, validPreset({ roster }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /repo-agnostic/);
  });

  test('validation delegates to validatePreset — rejects an oversized roster', async () => {
    const app = buildApp({ collectivePresetsStore: store });
    const roster = [
      ...validRoster(),
      { name: 'C', role: 'r', lens: 'l', objective: 'o', value: 'v', disposition: 'd' },
      { name: 'D', role: 'r', lens: 'l', objective: 'o', value: 'v', disposition: 'd' },
      { name: 'E', role: 'r', lens: 'l', objective: 'o', value: 'v', disposition: 'd' },
    ];
    const res = await call(app, 'post', PRESETS_PATH, validPreset({ roster }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /between 1 and/);
  });

  test('caps at the store maximum and returns 400 on overflow', async () => {
    store = new CollectivePresetsStore({ collection: createMockCollection(), maxCustom: 2 });
    const app = buildApp({ collectivePresetsStore: store });
    await call(app, 'post', PRESETS_PATH, validPreset({ name: 'p1' }));
    await call(app, 'post', PRESETS_PATH, validPreset({ name: 'p2' }));
    const res = await call(app, 'post', PRESETS_PATH, validPreset({ name: 'p3' }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /maximum of 2/);
  });

  test('session-auth gating: feature flag off → 403, no persistence', async () => {
    const app = buildApp({ collectivePresetsStore: store, featureEnabled: false });
    const res = await call(app, 'post', PRESETS_PATH, validPreset());
    assert.equal(res.status, 403);
    const list = await store.list(URL_KEY);
    assert.equal(list.filter(p => p.kind === 'custom').length, 0);
  });

  test('503 when no preset store is configured', async () => {
    const app = buildApp({ collectivePresetsStore: null });
    const res = await call(app, 'post', PRESETS_PATH, validPreset());
    assert.equal(res.status, 503);
  });
});

describe('DELETE /collective/presets/:presetId (LIN-1050)', () => {
  let store;

  beforeEach(() => {
    store = new CollectivePresetsStore({ collection: createMockCollection() });
  });

  test('deletes a custom preset (round trip through the real store)', async () => {
    const created = await store.createCustom(URL_KEY, validPreset());
    const app = buildApp({ collectivePresetsStore: store });

    const res = await call(app, 'delete', `${PRESETS_PATH}/${created.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(await store.get(URL_KEY, created.id), null);
  });

  test('404 on a missing preset id', async () => {
    const app = buildApp({ collectivePresetsStore: store });
    const res = await call(app, 'delete', `${PRESETS_PATH}/does-not-exist`);
    assert.equal(res.status, 404);
  });

  test('404 on a cross-workspace preset id (partition isolation)', async () => {
    const created = await store.createCustom('other-workspace', validPreset());
    const app = buildApp({ collectivePresetsStore: store });
    const res = await call(app, 'delete', `${PRESETS_PATH}/${created.id}`);
    assert.equal(res.status, 404);
    assert.ok(await store.get('other-workspace', created.id), 'the other workspace record is untouched');
  });

  test('404 (no-op) attempting to delete a builtin: preset', async () => {
    const app = buildApp({ collectivePresetsStore: store });
    const res = await call(app, 'delete', `${PRESETS_PATH}/${BUILTIN_PRESETS[0].id}`);
    assert.equal(res.status, 404);
    // Built-in survives — it was never a row to begin with.
    const list = await store.list(URL_KEY);
    assert.ok(list.some(p => p.id === BUILTIN_PRESETS[0].id));
  });

  test('session-auth gating: feature flag off → 403', async () => {
    const created = await store.createCustom(URL_KEY, validPreset());
    const app = buildApp({ collectivePresetsStore: store, featureEnabled: false });
    const res = await call(app, 'delete', `${PRESETS_PATH}/${created.id}`);
    assert.equal(res.status, 403);
    assert.ok(await store.get(URL_KEY, created.id), 'not deleted while gated off');
  });

  test('503 when no preset store is configured', async () => {
    const app = buildApp({ collectivePresetsStore: null });
    const res = await call(app, 'delete', `${PRESETS_PATH}/anything`);
    assert.equal(res.status, 503);
  });
});

describe('GET /collective page — presets threaded into the render data (LIN-1050)', () => {
  test('page load still succeeds with a presets store wired in (no UI consumption yet)', async () => {
    const store = new CollectivePresetsStore({ collection: createMockCollection() });
    await store.createCustom(URL_KEY, validPreset());
    const app = buildApp({ collectivePresetsStore: store });
    const res = await call(app, 'get', `/workspace/${URL_KEY}/collective`);
    assert.equal(res.status, 200);
  });
});
