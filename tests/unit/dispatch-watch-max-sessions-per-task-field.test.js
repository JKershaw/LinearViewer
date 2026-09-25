/**
 * LIN-2934 (R4/M19) — GET /api/proxy/dispatch/:id (watch/detail) must carry
 * `maxSessionsPerTask`. Mirrors tests/unit/dispatch-watch-repo-field.test.js's
 * pattern exactly (LIN-2975's own gap of the same shape). The review's
 * mutation pass found this untested: dropping `maxSessionsPerTask` from
 * `formatDispatchWatch` (routes/proxy-dispatch.js) failed nothing (M19) even
 * though the field has been present in the formatter since the implementation
 * landed — the CODE was correct, the TEST was missing.
 *
 * Covers both the still-queued branch and the archived (taken) branch, since
 * `formatDispatchWatch` is shared by both `getItemStatus` resolution paths.
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
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1' })
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

async function call(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: 'Bearer anything' }
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-2934 — /dispatch/:id (watch) carries maxSessionsPerTask', () => {
  test('a still-queued row with maxSessionsPerTask set echoes it on the watch response', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', {
      prompt: 'run me', kind: 'autopilot', maxSessionsPerTask: 4
    });

    const res = await call(app, `/api/proxy/dispatch/${created._id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.maxSessionsPerTask, 4);
  });

  test('a row without maxSessionsPerTask echoes null, not absent', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', {
      prompt: 'run me too', kind: 'implementation', issueIdentifier: 'LIN-2'
    });

    const res = await call(app, `/api/proxy/dispatch/${created._id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok('maxSessionsPerTask' in res.body, 'maxSessionsPerTask key must be present even when unset');
    assert.strictEqual(res.body.maxSessionsPerTask, null);
  });

  test('an ARCHIVED (taken) row still echoes maxSessionsPerTask on the watch response', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', {
      prompt: 'run me', kind: 'autopilot', maxSessionsPerTask: 6
    });
    await dispatchQueueStore.takeItem(created._id, 'acme');

    const res = await call(app, `/api/proxy/dispatch/${created._id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'taken', 'sanity: resolved via the history branch');
    assert.equal(res.body.maxSessionsPerTask, 6);
  });
});
