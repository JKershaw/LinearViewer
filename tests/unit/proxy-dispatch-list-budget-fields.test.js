/**
 * LIN-2975 — GET /api/proxy/dispatch (list) must carry sessionId/maxTasks.
 *
 * The list projection's explicit allow-list omitted `sessionId`/`maxTasks`
 * entirely, so a caller reading a list row for either field got `null` —
 * indistinguishable from "read and confirmed absent." A passage runner
 * misread that as proof a child autopilot never stamped `sessionId` on its
 * fanned-out workers, when in fact the stamping was fine and only the list
 * read hid it (see the LIN-2975 research trail). This proves both keys are
 * PRESENT on every row (not just truthy when set), through a real
 * DispatchQueueStore end to end.
 *
 * Run with: node --test tests/unit/proxy-dispatch-list-budget-fields.test.js
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

describe('LIN-2975 — /dispatch list carries sessionId/maxTasks', () => {
  test('a row with sessionId/maxTasks set comes back on the list with both fields', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', {
      prompt: 'run me', kind: 'implementation', issueIdentifier: 'LIN-1',
      sessionId: 'run-1', maxTasks: 5
    });

    const res = await call(app, '/api/proxy/dispatch');
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const item = res.body.items.find(i => i.id === created._id);
    assert.ok(item, 'created item not found in list response');
    assert.equal(item.sessionId, 'run-1');
    assert.equal(item.maxTasks, 5);
  });

  test('a row without sessionId/maxTasks comes back with both KEYS PRESENT and null, not absent', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', {
      prompt: 'run me too', kind: 'implementation', issueIdentifier: 'LIN-2'
    });

    const res = await call(app, '/api/proxy/dispatch');
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const item = res.body.items.find(i => i.id === created._id);
    assert.ok(item, 'created item not found in list response');
    assert.ok('sessionId' in item, 'sessionId key must be present even when unset');
    assert.ok('maxTasks' in item, 'maxTasks key must be present even when unset');
    assert.strictEqual(item.sessionId, null);
    assert.strictEqual(item.maxTasks, null);
  });

  // LIN-2975 note D (plan-review): the list must stay an explicit allow-list,
  // never a spread of the stored item — a spread would also leak the
  // single-use bootstrapToken. Cheap regression: the field this ticket adds
  // must show up, but a field this ticket did NOT ask for must not.
  test('bootstrapToken never appears on the list row', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', {
      prompt: 'run me', kind: 'implementation', issueIdentifier: 'LIN-3', bootstrapToken: 'secret-token'
    });

    const res = await call(app, '/api/proxy/dispatch');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const item = res.body.items.find(i => i.id === created._id);
    assert.ok(item, 'created item not found in list response');
    assert.ok(!('bootstrapToken' in item), 'bootstrapToken must not appear on the list row');
  });
});

describe('LIN-2934 — /dispatch list carries maxSessionsPerTask', () => {
  test('a row with maxSessionsPerTask set comes back on the list with the field', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', {
      prompt: 'run me', kind: 'implementation', issueIdentifier: 'LIN-1',
      sessionId: 'run-1', maxSessionsPerTask: 10
    });

    const res = await call(app, '/api/proxy/dispatch');
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const item = res.body.items.find(i => i.id === created._id);
    assert.ok(item);
    assert.equal(item.maxSessionsPerTask, 10);
  });

  test('a row without maxSessionsPerTask comes back with the KEY PRESENT and null, not absent', async () => {
    const dispatchQueueStore = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection()
    });
    const app = buildApp({ dispatchQueueStore });

    const created = await dispatchQueueStore.addItem('acme', {
      prompt: 'run me too', kind: 'implementation', issueIdentifier: 'LIN-2'
    });

    const res = await call(app, '/api/proxy/dispatch');
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const item = res.body.items.find(i => i.id === created._id);
    assert.ok(item);
    assert.ok('maxSessionsPerTask' in item, 'maxSessionsPerTask key must be present even when unset');
    assert.strictEqual(item.maxSessionsPerTask, null);
  });
});
