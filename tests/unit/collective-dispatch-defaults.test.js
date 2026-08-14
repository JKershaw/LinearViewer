/**
 * LIN-1139 CONVERGENCE — collective fan-out inherits dispatch defaults.
 *
 * Before LIN-1139 the collective fan-out hand-rolled `dispatchQueueStore.addItem`
 * with NO model/harness resolution at all — every collective participant was
 * dispatched with a null model/harness regardless of the workspace's configured
 * dispatchDefaults. Routing it through the shared createDispatchItem factory
 * closes that gap (the exact inheritance gap the parent LIN-1135 names): a
 * collective dispatch now resolves model/harness from the participant workspace's
 * own dispatchDefaults. This is a DELIBERATE behavior change (the parent's
 * inheritance goal), pinned here so it can't silently regress.
 *
 * The factory is called with applyDefaultHarness:false, so the claude-code
 * interpose (LIN-1159) is NOT applied here — it stays scoped to the proxy dispatch
 * boundary. A participant workspace with no configured default therefore keeps a
 * null harness, exactly as the collective fan-out did before; only the inheritance
 * of a CONFIGURED default is new.
 *
 * Note: resolution is keyed on the PARTICIPANT workspace's urlKey (each character
 * is bound to its own repo/workspace), not the anchor the request is posted to.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCollectiveRoutes } from '../../routes/collective.js';
import { WorkspacePreferencesStore } from '../../lib/workspace-preferences.js';

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
    }
  };
}

const WORKSPACES = [
  { urlKey: 'alpha', name: 'Alpha Project' },
  { urlKey: 'bravo', name: 'Bravo Project' },
];

function buildApp(captured, { workspacePreferencesStore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createCollectiveRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.push({ urlKey, item });
        return { _id: `disp-${captured.length}`, ...item };
      },
    },
    proxyTokenStore: null,
    yapClient: { baseUrl: 'https://yap.test' },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    workspacePreferencesStore,
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1', features: { collective: true }, workspaces: WORKSPACES };
      next();
    },
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

const START_PATH = '/workspace/alpha/collective/start';

describe('LIN-1139 — collective fan-out inherits workspace dispatch defaults', () => {
  test('with no prefs store wired: model and harness stay null (no claude-code interpose)', async () => {
    const captured = [];
    const app = buildApp(captured);
    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    assert.strictEqual(captured[0].item.model, null);
    assert.strictEqual(captured[0].item.harness, null);
  });

  test("inherits the participant workspace's configured model/harness defaults", async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('alpha', {
      dispatchDefaults: { model: 'alpha-model', harness: 'alpha-harness' }
    });
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].item.model, 'alpha-model');
    assert.equal(captured[0].item.harness, 'alpha-harness');
  });

  test('resolves per participant workspace, not the posted anchor', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    // Only bravo has defaults; alpha (the anchor) has none.
    await store.saveWorkspacePreferences('bravo', {
      dispatchDefaults: { model: 'bravo-model', harness: 'bravo-harness' }
    });
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', START_PATH, {
      channel: '#room',
      characters: [{ workspaceUrlKey: 'alpha' }, { workspaceUrlKey: 'bravo' }],
      target: 'cli',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const byKey = Object.fromEntries(captured.map(c => [c.urlKey, c.item]));
    // alpha: no defaults -> model + harness stay null (no interpose here).
    assert.strictEqual(byKey.alpha.model, null);
    assert.strictEqual(byKey.alpha.harness, null);
    // bravo: its own defaults inherited.
    assert.equal(byKey.bravo.model, 'bravo-model');
    assert.equal(byKey.bravo.harness, 'bravo-harness');
  });
});
