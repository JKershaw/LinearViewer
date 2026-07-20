/**
 * LIN-1468 — GET /api/proxy/dispatch/:id (formatDispatchWatch) exposes a
 * feedback entry's rootItemId conditionally, matching _formatFeedbackEntries'
 * exact shape (LIN-1297 additive idiom: present when tagged, no `null` key
 * when absent). The two formatters are independent code paths on the same
 * contract, so this pins the watch route's own copy of that shape rather than
 * relying solely on the store-level unit tests.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function buildApp({ dispatchQueueStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' })
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

describe('LIN-1468 — watch endpoint rootItemId exposure', () => {
  test('feedback.rootItemId is present when tagged, absent (no null) when not, matching _formatFeedbackEntries', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', { prompt: 'do the thing' });
    await dispatchQueueStore.takeItem(created._id, 'acme');
    await dispatchQueueStore.addFeedback(created._id, 'acme', { message: 'tagged', rootItemId: created._id }, null);
    await dispatchQueueStore.addFeedback(created._id, 'acme', { message: 'untagged' }, null);

    const watchRes = await call(app, 'get', `/api/proxy/dispatch/${created._id}`);
    assert.equal(watchRes.status, 200, JSON.stringify(watchRes.body));

    const [tagged, untagged] = watchRes.body.feedback;
    assert.equal(tagged.rootItemId, created._id);
    assert.equal('rootItemId' in untagged, false, 'an untagged entry must not serialise a null rootItemId key');
    assert.deepEqual(Object.keys(untagged).sort(), ['message', 'timestamp', 'url', 'urlLabel'].sort());
  });
});
