/**
 * LIN-1390 — end-to-end "echo honesty" check, through real HTTP + a real
 * DispatchQueueStore (not a mock): dispatch an autopilot kickoff carrying a
 * selected preset via POST /api/proxy/autopilot/kickoff, then GET the watch
 * endpoint (formatDispatchWatch) and confirm its model/harness/presetName
 * agree with what the SAME store's takeItem (_formatItem, the seam a
 * consumer's poll/take actually reads) returns for that exact item — proving
 * the two formatters never diverge on the resolved value.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { DispatchPresetsStore } from '../../lib/dispatch-presets-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function buildApp({ dispatchQueueStore, dispatchPresetsStore }) {
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
    dispatchQueueStore,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    dispatchPresetsStore,
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: method.toUpperCase(),
      headers: { Authorization: 'Bearer anything' }
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-1390 — watch echo honesty against a real store', () => {
  test('GET /api/proxy/dispatch/:id (watch) agrees with takeItem on model/harness/presetName for the same item', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const dispatchPresetsStore = new DispatchPresetsStore({ collection: createMockCollection() });
    const preset = await dispatchPresetsStore.createCustom('acme', {
      name: 'Watch Preset', config: { model: 'preset-model', harness: 'preset-harness' }
    });

    const app = buildApp({ dispatchQueueStore, dispatchPresetsStore });

    // Dispatch directly through the store (S6's own POST-body parsing of
    // presetId is covered separately in proxy-kickoff-presets.test.js) — this
    // test is focused purely on the read side: does the watch route's
    // formatDispatchWatch agree with takeItem's _formatItem for one item.
    const created = await dispatchQueueStore.addItem('acme', {
      prompt: 'run me', kind: 'autopilot',
      model: 'preset-model', harness: 'preset-harness',
      presetConfig: preset.config, presetName: preset.name
    });

    const watchRes = await call(app, 'get', `/api/proxy/dispatch/${created._id}`);
    assert.equal(watchRes.status, 200, JSON.stringify(watchRes.body));

    const taken = await dispatchQueueStore.takeItem(created._id, 'acme');

    assert.equal(watchRes.body.model, taken.model);
    assert.equal(watchRes.body.harness, taken.harness);
    assert.equal(watchRes.body.presetName, taken.presetName);
    assert.equal(watchRes.body.model, 'preset-model');
    assert.equal(watchRes.body.harness, 'preset-harness');
    assert.equal(watchRes.body.presetName, 'Watch Preset');
  });
});
