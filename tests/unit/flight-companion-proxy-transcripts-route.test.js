/**
 * tests/unit/flight-companion-proxy-transcripts-route.test.js — LIN-2634.
 *
 * Route-level tests for `GET /api/proxy/flight-companion/transcripts`
 * (routes/proxy-flight-companion.js), driven through the REAL
 * `createProxyRoutes` composer over real HTTP (tests/unit/lib/proxy-fake-deps.js's
 * `buildApp`/`call`) — proxy-token auth runs for real. The two-creator
 * technique overrides `proxyTokenStore.validateToken`'s `createdBy` (keyed
 * off the bearer token string), the same seam
 * tests/unit/lib/proxy-fake-deps.js's own BASE_DEPS() documents.
 *
 * Per the plan's correction-4 decision, every scoping-relevant case below is
 * driven through the REAL `SavedChatStore` (lib/saved-chat-store.js) over an
 * in-memory mock collection — the same minimal mock technique
 * tests/unit/saved-chat-store.test.js uses, duplicated locally rather than
 * imported (importing a `.test.js` file as a module re-registers its
 * describe/test blocks under Node's per-file isolation). This makes the
 * creator-argument mutation unconditional: it runs against the SAME
 * production query-construction code the store-level suite already
 * mutation-checks directly, not a hand-rolled fake that could pass by luck.
 * Only the store-failure case below uses a rejecting stub, since it tests
 * the route's own catch-path rather than scoping.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACME, BASE_DEPS, buildApp, call } from './lib/proxy-fake-deps.js';
import { SavedChatStore } from '../../lib/saved-chat-store.js';

const WORKSPACE_2 = 'workspace-2';
const U1 = 'u1';
const U2 = 'u2';

const U1_TOKEN = 'u1-token';
const U2_TOKEN = 'u2-token';
const OWNERLESS_TOKEN = 'ownerless-token';
const WORKSPACE_2_TOKEN = 'workspace-2-token';

// Same minimal in-memory mock collection technique as
// tests/unit/saved-chat-store.test.js (matches _id/urlKey/accountId/
// taskIdentifier), duplicated here rather than imported.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query.taskIdentifier !== undefined && doc.taskIdentifier !== query.taskIdentifier) return false;
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.accountId !== undefined && doc.accountId !== query.accountId) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
  };
}

// Maps the two-creator/two-workspace technique onto validateToken, keyed by
// the bearer token string call() sends — one shared override for every test
// below that needs more than the single default creator/workspace.
function multiTenantProxyTokenStore() {
  return {
    ...BASE_DEPS().proxyTokenStore,
    validateToken: async (token) => {
      if (token === U2_TOKEN) return { tokenId: 't2', urlKey: ACME, label: 'test', scope: 'readWrite', createdBy: U2 };
      if (token === OWNERLESS_TOKEN) return { tokenId: 't3', urlKey: ACME, label: 'test', scope: 'readWrite', createdBy: null };
      if (token === WORKSPACE_2_TOKEN) return { tokenId: 't4', urlKey: WORKSPACE_2, label: 'test', scope: 'readWrite', createdBy: U1 };
      return { tokenId: 't1', urlKey: ACME, label: 'test', scope: 'readWrite', createdBy: U1 };
    },
  };
}

async function seedCompanionChat(store, urlKey, accountId, content) {
  return store.create(urlKey, accountId, {
    taskIdentifier: 'flight-companion',
    transcript: [{ role: 'user', content }],
  });
}

describe('GET /api/proxy/flight-companion/transcripts (LIN-2634)', () => {
  test('positive-content: returns exactly the caller\'s companion chats, newest-first, with transcripts', async () => {
    const collection = createMockCollection();
    const savedChatStore = new SavedChatStore({ collection });
    const first = await seedCompanionChat(savedChatStore, ACME, U1, 'first companion chat');
    const second = await seedCompanionChat(savedChatStore, ACME, U1, 'second companion chat');
    await savedChatStore.create(ACME, U1, { taskIdentifier: 'LIN-1', transcript: [{ role: 'user', content: 'ordinary chat' }] });

    const app = buildApp({ proxyTokenStore: multiTenantProxyTokenStore(), savedChatStore });
    const { status, body } = await call(app, 'GET', '/api/proxy/flight-companion/transcripts', {
      headers: { Authorization: `Bearer ${U1_TOKEN}` },
    });

    assert.equal(status, 200);
    assert.deepEqual(body.chats.map(c => c.id), [second.id, first.id]);
    assert.deepEqual(body.chats[0].transcript, [{ role: 'user', content: 'second companion chat' }]);
  });

  test('non-leakage: another creator\'s companion chats are never returned (set equality, not containment)', async () => {
    const collection = createMockCollection();
    const savedChatStore = new SavedChatStore({ collection });
    const u1Chat = await seedCompanionChat(savedChatStore, ACME, U1, 'u1 companion chat');
    await seedCompanionChat(savedChatStore, ACME, U2, 'u2 companion chat');

    const app = buildApp({ proxyTokenStore: multiTenantProxyTokenStore(), savedChatStore });
    const { status, body } = await call(app, 'GET', '/api/proxy/flight-companion/transcripts', {
      headers: { Authorization: `Bearer ${U1_TOKEN}` },
    });

    assert.equal(status, 200);
    assert.deepEqual(body.chats.map(c => c.id), [u1Chat.id]);
  });

  test('cross-workspace: the same accountId under a second urlKey never appears under the first workspace\'s token', async () => {
    const collection = createMockCollection();
    const savedChatStore = new SavedChatStore({ collection });
    const w1Chat = await seedCompanionChat(savedChatStore, ACME, U1, 'workspace 1 chat');
    await seedCompanionChat(savedChatStore, WORKSPACE_2, U1, 'workspace 2 chat');

    const app = buildApp({ proxyTokenStore: multiTenantProxyTokenStore(), savedChatStore });
    const { status, body } = await call(app, 'GET', '/api/proxy/flight-companion/transcripts', {
      headers: { Authorization: `Bearer ${U1_TOKEN}` },
    });

    assert.equal(status, 200);
    assert.deepEqual(body.chats.map(c => c.id), [w1Chat.id]);
  });

  test('ownerless/legacy token (createdBy: null) fails closed to an empty list, not an error', async () => {
    const collection = createMockCollection();
    const savedChatStore = new SavedChatStore({ collection });
    await seedCompanionChat(savedChatStore, ACME, U1, 'u1 companion chat');

    const app = buildApp({ proxyTokenStore: multiTenantProxyTokenStore(), savedChatStore });
    const { status, body } = await call(app, 'GET', '/api/proxy/flight-companion/transcripts', {
      headers: { Authorization: `Bearer ${OWNERLESS_TOKEN}` },
    });

    assert.equal(status, 200);
    assert.deepEqual(body, { chats: [] });
  });

  test('store absent (default null) → 503, never a bare {chats: []}', async () => {
    const app = buildApp({ proxyTokenStore: multiTenantProxyTokenStore() });
    const { status, body } = await call(app, 'GET', '/api/proxy/flight-companion/transcripts', {
      headers: { Authorization: `Bearer ${U1_TOKEN}` },
    });

    assert.equal(status, 503);
    assert.ok(body.error);
  });

  test('store failure → 500, never a bare {chats: []}', async () => {
    const savedChatStore = { listByTask: async () => { throw new Error('boom'); } };
    const app = buildApp({ proxyTokenStore: multiTenantProxyTokenStore(), savedChatStore });
    const { status, body } = await call(app, 'GET', '/api/proxy/flight-companion/transcripts', {
      headers: { Authorization: `Bearer ${U1_TOKEN}` },
    });

    assert.equal(status, 500);
    assert.ok(body.error);
  });
});
