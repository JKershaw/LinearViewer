/**
 * LIN-2975 — GET /api/proxy/dispatch/:id (watch/detail) must carry `repo`.
 *
 * formatDispatchWatch already carried sessionId/maxTasks but omitted `repo`,
 * so a caller checking which folder a dispatch was queued against had no
 * proxy-side read for it at all. This proves a detail read echoes a stored
 * `repo`, and reads `null` (not absent/undefined) when none was supplied.
 *
 * Run with: node --test tests/unit/dispatch-watch-repo-field.test.js
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

describe('LIN-2975 — /dispatch/:id (watch) carries repo', () => {
  test('a row with repo set echoes it on the watch response', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', {
      prompt: 'run me', kind: 'implementation', issueIdentifier: 'LIN-1', repo: 'acme-app'
    });

    const res = await call(app, `/api/proxy/dispatch/${created._id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.repo, 'acme-app');
  });

  test('a row without repo echoes repo: null, not absent', async () => {
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
    assert.ok('repo' in res.body, 'repo key must be present even when unset');
    assert.strictEqual(res.body.repo, null);
  });
});
