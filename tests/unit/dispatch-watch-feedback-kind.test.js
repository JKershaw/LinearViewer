/**
 * LIN-1475 — GET /api/proxy/dispatch/:id (formatDispatchWatch) exposes a
 * feedback entry's kind conditionally, matching _formatFeedbackEntries'
 * exact shape (LIN-1297 additive idiom: present when tagged, no `null` key
 * when absent). formatDispatchWatch re-maps entries that getItemStatus()
 * already ran through _formatFeedbackEntries, so this pins the watch
 * route's own copy of that shape rather than relying solely on the
 * store-level unit tests.
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
  const server = app.listen(0, '127.0.0.1');
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

describe('LIN-1475 — watch endpoint kind exposure', () => {
  test('feedback.kind is present when tagged, absent (no null) when not, matching _formatFeedbackEntries', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', { prompt: 'do the thing' });
    await dispatchQueueStore.takeItem(created._id, 'acme');
    await dispatchQueueStore.addFeedback(created._id, 'acme', { message: 'beat', kind: 'heartbeat' }, null);
    await dispatchQueueStore.addFeedback(created._id, 'acme', { message: 'untagged' }, null);

    const watchRes = await call(app, 'get', `/api/proxy/dispatch/${created._id}`);
    assert.equal(watchRes.status, 200, JSON.stringify(watchRes.body));

    const [tagged, untagged] = watchRes.body.feedback;
    assert.equal(tagged.kind, 'heartbeat');
    assert.equal('kind' in untagged, false, 'an untagged entry must not serialise a null kind key');
    assert.deepEqual(Object.keys(tagged).sort(), ['kind', 'message', 'timestamp', 'url', 'urlLabel'].sort());
    assert.deepEqual(Object.keys(untagged).sort(), ['message', 'timestamp', 'url', 'urlLabel'].sort());
  });

  test('LIN-1425: kind:"usage" survives the watch endpoint\'s formatter unchanged', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', { prompt: 'do the thing' });
    await dispatchQueueStore.takeItem(created._id, 'acme');
    const rootItemId = '11111111-2222-3333-4444-555555555555';
    const usageMessage = '[usage] {"schema":1,"harness":"claude-code","model":"claude-opus-4-8","inputTokens":1,"outputTokens":2,"cacheCreationInputTokens":3,"cacheCreation1hInputTokens":2,"cacheReadInputTokens":4,"costUsd":null}';
    await dispatchQueueStore.addFeedback(created._id, 'acme', { message: usageMessage, kind: 'usage', rootItemId }, null);

    const watchRes = await call(app, 'get', `/api/proxy/dispatch/${created._id}`);
    assert.equal(watchRes.status, 200, JSON.stringify(watchRes.body));

    const [entry] = watchRes.body.feedback;
    assert.equal(entry.kind, 'usage');
    assert.equal(entry.rootItemId, rootItemId);
    assert.equal(entry.message, usageMessage);
  });

  test('LIN-1427: kind:"refusal" survives the watch endpoint\'s formatter unchanged', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', { prompt: 'do the thing' });
    await dispatchQueueStore.takeItem(created._id, 'acme');
    const rootItemId = '11111111-2222-3333-4444-555555555555';
    const refusalMessage = '[blocked] refused to proceed: task required bypassing a safety control';
    await dispatchQueueStore.addFeedback(created._id, 'acme', { message: refusalMessage, kind: 'refusal', rootItemId }, null);

    const watchRes = await call(app, 'get', `/api/proxy/dispatch/${created._id}`);
    assert.equal(watchRes.status, 200, JSON.stringify(watchRes.body));

    const [entry] = watchRes.body.feedback;
    assert.equal(entry.kind, 'refusal');
    assert.equal(entry.rootItemId, rootItemId);
    assert.equal(entry.message, refusalMessage);
  });
});
