/**
 * LIN-3367 — the consumer poll warning is shown only while a row is queued,
 * and is derived from the LIVE getConsumerLastSeenAt (read once per list).
 *
 * Run with: node --test tests/unit/proxy-dispatch-poll-warning-queued-only.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { buildQueuedPollWarning } from '../../lib/consumer-poll-warning.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function buildApp({ dispatchQueueStore, dispatchTokenStore }) {
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
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer anything' } });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function tokenStore(lastUsedAt) {
  const calls = { n: 0 };
  return {
    calls,
    listTokens: async () => { calls.n++; return lastUsedAt ? [{ lastUsedAt }] : []; }
  };
}

const newStore = () => new DispatchQueueStore({
  collection: createMockCollection(),
  historyCollection: createMockCollection()
});

describe('buildQueuedPollWarning (LIN-3367)', () => {
  test('null for every non-queued status, even when never polled', () => {
    for (const s of ['taken', 'done', 'failed', 'blocked', 'aborted', 'closed']) {
      assert.equal(buildQueuedPollWarning(s, null), null, s);
    }
  });
  test('queued: warns on never-polled, silent on a fresh live poll', () => {
    assert.match(buildQueuedPollWarning('queued', null), /No consumer has ever polled/);
    assert.equal(buildQueuedPollWarning('queued', new Date().toISOString()), null);
  });
});

describe('GET /api/proxy/dispatch — queued-only warning from live recency (LIN-3367)', () => {
  test('queued row warns when nothing has polled; taken row does not; token store read once', async () => {
    const dispatchQueueStore = newStore();
    const tokens = tokenStore(null);
    const app = buildApp({ dispatchQueueStore, dispatchTokenStore: tokens });
    const a = await dispatchQueueStore.addItem('acme', { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-1' });
    const b = await dispatchQueueStore.addItem('acme', { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-2' });
    const c = await dispatchQueueStore.addItem('acme', { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-3' });
    await dispatchQueueStore.takeItem(c._id, 'acme');

    const res = await get(app, '/api/proxy/dispatch');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const byId = Object.fromEntries(res.body.items.map(i => [i.id, i]));
    assert.match(byId[a._id].consumerPollWarning, /ever polled/);
    assert.match(byId[b._id].consumerPollWarning, /ever polled/);
    assert.equal(byId[c._id].status, 'taken');
    assert.equal(byId[c._id].consumerPollWarning, null);
    assert.equal(tokens.calls.n, 1, 'live recency must be read once per list request, not per row');
  });

  test('uses LIVE recency, not the enqueue stamp: a stale stamp is silent once a consumer polls', async () => {
    const dispatchQueueStore = newStore();
    const app = buildApp({ dispatchQueueStore, dispatchTokenStore: tokenStore(new Date().toISOString()) });
    const a = await dispatchQueueStore.addItem('acme', {
      prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-1', consumerLastSeenAt: null
    });
    const list = await get(app, '/api/proxy/dispatch');
    assert.equal(list.body.items.find(i => i.id === a._id).consumerPollWarning, null);
    const detail = await get(app, `/api/proxy/dispatch/${a._id}`);
    assert.equal(detail.body.consumerPollWarning, null);
  });

  test('detail: queued warns, taken is null', async () => {
    const dispatchQueueStore = newStore();
    const app = buildApp({ dispatchQueueStore, dispatchTokenStore: tokenStore(null) });
    const q = await dispatchQueueStore.addItem('acme', { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-1' });
    const t = await dispatchQueueStore.addItem('acme', { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-2' });
    await dispatchQueueStore.takeItem(t._id, 'acme');
    assert.match((await get(app, `/api/proxy/dispatch/${q._id}`)).body.consumerPollWarning, /ever polled/);
    assert.equal((await get(app, `/api/proxy/dispatch/${t._id}`)).body.consumerPollWarning, null);
  });
});

describe('GET /workspace/:urlKey/api/dispatch — dispatch-page queue list (LIN-3367)', () => {
  function buildPageApp({ dispatchQueueStore, dispatchTokenStore }) {
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore,
      dispatchTokenStore,
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: req.params.urlKey };
        req.session = { linearUserId: 'u1' };
        next();
      },
      userPreferencesStore: {},
      harbourFeedbackTokenStore: null
    }));
    return app;
  }
  const getPage = (app) => get(app, '/workspace/acme/api/dispatch');

  test('a queued row stamped null is silent once a consumer has polled (live recency, not the stamp)', async () => {
    const dispatchQueueStore = newStore();
    const tokens = tokenStore(new Date().toISOString());
    const app = buildPageApp({ dispatchQueueStore, dispatchTokenStore: tokens });
    const a = await dispatchQueueStore.addItem('acme', {
      prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-1', consumerLastSeenAt: null
    });
    const res = await getPage(app);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.items.find(i => i._id === a._id || i.id === a._id).consumerPollWarning, null);
    assert.equal(tokens.calls.n, 1, 'live recency must be read once per list request, not per row');
  });

  test('a queued row warns when no consumer has ever polled', async () => {
    const dispatchQueueStore = newStore();
    const app = buildPageApp({ dispatchQueueStore, dispatchTokenStore: tokenStore(null) });
    const a = await dispatchQueueStore.addItem('acme', { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-1' });
    const res = await getPage(app);
    assert.match(res.body.items.find(i => i._id === a._id || i.id === a._id).consumerPollWarning, /ever polled/);
  });
});
