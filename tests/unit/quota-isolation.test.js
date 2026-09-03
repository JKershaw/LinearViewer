/**
 * Unit tests for LIN-1353 S1+S4: proxy-token quota isolation after the
 * accountId re-key.
 *
 * S1 (lib/user-preferences.js) and S4 (proxy-tokens.createdBy) must land in
 * the SAME change — re-keying prefs without re-pointing `createdBy` would
 * silently break quota isolation with no error and no test, re-entering
 * LIN-498's failure mode via a different door: account B's proxy token would
 * resolve to a `createdBy` value (`accountId`) that no longer matches where
 * account A's OpenRouter key is stored (still keyed by the old `linearUserId`),
 * so EVERY token would silently resolve to "no key" — or worse, if only one
 * side re-keyed, to the WRONG account's key.
 *
 * These tests drive the REAL chain end-to-end: the actual HTTP token-creation
 * write site (routes/proxy.js `POST .../api/proxy/tokens`, which writes
 * `createdBy: req.session.accountId`) → the real `ProxyTokenStore.validateToken`
 * read → the real `getWorkspaceOpenRouterKey` resolver seam (D1a,
 * lib/openrouter-key-resolver.js) → the real `UserPreferencesStore`. No stub
 * reimplements or bypasses any link in that chain.
 *
 * Run with: node --test tests/unit/quota-isolation.test.js
 *
 * NODE_ENV must be set to 'test' BEFORE importing routes/proxy.js: the
 * module-level proxyTokenCreationLimiter (max 10/15min/IP) is shared across
 * every createProxyRoutes() instance in the process, and this file mints
 * several tokens across its tests over real HTTP (LIN-2505).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { UserPreferencesStore } from '../../lib/user-preferences.js';
import { getWorkspaceOpenRouterKey } from '../../lib/openrouter-key-resolver.js';

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function inMemoryCollection() {
  const docs = [];
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) {
      return docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v)) || null;
    },
    find(query = {}) {
      const results = docs.filter(d => Object.entries(query).every(([k, v]) => d[k] === v));
      return { async toArray() { return results.slice(); } };
    },
    async updateOne(query, update, options = {}) {
      let doc = docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v));
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 };
        doc = { ...(update.$setOnInsert || {}) };
        Object.entries(query).forEach(([k, v]) => { doc[k] = v; });
        docs.push(doc);
      }
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => Object.entries(query).every(([k, v]) => d[k] === v));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (Object.entries(query).every(([k, v]) => docs[i][k] === v)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    },
  };
}

// Fresh app per request, sharing the SAME proxyTokenStore across a test's
// mints: the request-driven conversion (LIN-2505) needs to bake a specific
// session into `workspaceFromUrl` per POST, so the app is built per call
// rather than once per test — the store, where identity/state actually
// lives, stays shared. Session-injection shape mirrors
// tests/unit/dispatch-route-defaults.test.js:62-66.
function buildProxyApp({ proxyTokenStore, session }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: 'acme' };
      req.session = session;
      next();
    },
    getWorkspaceAccessToken: () => null, resolveWorkspaceAccess: () => null,
    getWorkspaceOpenRouterKey: async () => null, workspacePreferencesStore: {}, freeTierStore: {},
  }));
  return app;
}

async function mintToken({ proxyTokenStore, session, label }) {
  const app = buildProxyApp({ proxyTokenStore, session });
  const { status, body } = await call(app, 'post', '/workspace/acme/api/proxy/tokens', { label, scope: 'read' });
  assert.strictEqual(status, 201, JSON.stringify(body));
  return body.token;
}

async function mintTokenForAccount(proxyTokenStore, accountId) {
  return mintToken({
    proxyTokenStore,
    session: { accountId, features: { proxy: true } },
    label: `token-for-${accountId}`
  });
}

describe('Proxy-token quota isolation after the accountId re-key (LIN-1353 S1+S4)', () => {
  test('the HTTP token-creation write site stamps createdBy from req.session.accountId (not linearUserId)', async () => {
    const proxyTokenStore = new ProxyTokenStore({ collection: inMemoryCollection() });

    const token = await mintTokenForAccount(proxyTokenStore, 'account-A');
    const validated = await proxyTokenStore.validateToken(token);

    assert.equal(validated.createdBy, 'account-A');
  });

  test('a session with linearUserId but NO accountId mints a token with createdBy: null (proves the write site really switched keys)', async () => {
    const proxyTokenStore = new ProxyTokenStore({ collection: inMemoryCollection() });

    const token = await mintToken({
      proxyTokenStore,
      session: { linearUserId: 'legacy-linear-id', features: { proxy: true } },
      label: 'legacy-session-token'
    });

    const validated = await proxyTokenStore.validateToken(token);
    assert.equal(validated.createdBy, null);
  });

  test('quota isolation end-to-end: account A\'s token resolves ONLY account A\'s OpenRouter key, never account B\'s', async () => {
    const proxyTokenStore = new ProxyTokenStore({ collection: inMemoryCollection() });
    const userPreferencesStore = new UserPreferencesStore({ collection: inMemoryCollection() });
    await userPreferencesStore.setOpenRouterApiKey('account-A', 'sk-or-v1-account-A-key');
    await userPreferencesStore.setOpenRouterApiKey('account-B', 'sk-or-v1-account-B-key');

    const tokenA = await mintTokenForAccount(proxyTokenStore, 'account-A');
    const tokenB = await mintTokenForAccount(proxyTokenStore, 'account-B');

    // Drive the REAL chain: validate the token → its createdBy → the D1a resolver.
    const creatorA = (await proxyTokenStore.validateToken(tokenA)).createdBy;
    const creatorB = (await proxyTokenStore.validateToken(tokenB)).createdBy;

    const resolvedForA = await getWorkspaceOpenRouterKey(userPreferencesStore, creatorA);
    const resolvedForB = await getWorkspaceOpenRouterKey(userPreferencesStore, creatorB);

    assert.equal(resolvedForA, 'sk-or-v1-account-A-key');
    assert.equal(resolvedForB, 'sk-or-v1-account-B-key');
    // The critical negative: B's token must NEVER resolve A's key, or vice versa.
    assert.notEqual(resolvedForA, resolvedForB);
    assert.notEqual(resolvedForB, 'sk-or-v1-account-A-key');
  });

  test('quota isolation survives a re-auth (session.regenerate reissues a NEW accountId-scoped token, old data untouched)', async () => {
    // Simulates the realistic sequence: account A mints a token, connects a key,
    // then mints a SECOND token later (e.g. after a re-auth). Both tokens must
    // resolve the SAME account's key — re-keying does not fragment one account's
    // tokens across different resolved identities.
    const proxyTokenStore = new ProxyTokenStore({ collection: inMemoryCollection() });
    const userPreferencesStore = new UserPreferencesStore({ collection: inMemoryCollection() });
    await userPreferencesStore.setOpenRouterApiKey('account-A', 'sk-or-v1-account-A-key');

    const firstToken = await mintTokenForAccount(proxyTokenStore, 'account-A');
    const secondToken = await mintTokenForAccount(proxyTokenStore, 'account-A');

    const firstCreator = (await proxyTokenStore.validateToken(firstToken)).createdBy;
    const secondCreator = (await proxyTokenStore.validateToken(secondToken)).createdBy;

    assert.equal(firstCreator, secondCreator);
    assert.equal(await getWorkspaceOpenRouterKey(userPreferencesStore, secondCreator), 'sk-or-v1-account-A-key');
  });

  test('a token with no createdBy (anonymous mint) resolves no key at all — never falls back to someone else\'s', async () => {
    const proxyTokenStore = new ProxyTokenStore({ collection: inMemoryCollection() });
    const userPreferencesStore = new UserPreferencesStore({ collection: inMemoryCollection() });
    await userPreferencesStore.setOpenRouterApiKey('account-A', 'sk-or-v1-account-A-key');

    const anon = await proxyTokenStore.createToken('acme', { label: 'no-creator', scope: 'read' });
    const validated = await proxyTokenStore.validateToken(anon.token);

    assert.equal(validated.createdBy, null);
    assert.equal(await getWorkspaceOpenRouterKey(userPreferencesStore, validated.createdBy), null);
  });

  test('bootstrap-token exchange propagates createdBy unchanged (the second write site, LIN-376)', async () => {
    const proxyTokenStore = new ProxyTokenStore({ collection: inMemoryCollection() });
    const userPreferencesStore = new UserPreferencesStore({ collection: inMemoryCollection() });
    await userPreferencesStore.setOpenRouterApiKey('account-A', 'sk-or-v1-account-A-key');

    const bootstrap = await proxyTokenStore.createToken('acme', { label: 'handoff', scope: 'read', kind: 'bootstrap', createdBy: 'account-A' });
    const exchanged = await proxyTokenStore.exchangeBootstrapToken(bootstrap.token);
    assert.ok(exchanged, 'exchange succeeded');

    const validated = await proxyTokenStore.validateToken(exchanged.token);
    assert.equal(validated.createdBy, 'account-A');
    assert.equal(await getWorkspaceOpenRouterKey(userPreferencesStore, validated.createdBy), 'sk-or-v1-account-A-key');
  });
});
