/**
 * Unit tests for LIN-1926: pins the route→resolver principal hop for
 * `getWorkspaceOpenRouterKey` across the six live AI-route call sites, plus
 * the ownerless (fail-closed) case.
 *
 * Before this fix had a regression test, nothing verified that every AI route
 * threads `req.proxyCreatedBy` (the proxy token's OWNER, resolved by
 * `authenticateProxyToken` from a real minted token) into
 * `getWorkspaceOpenRouterKey(urlKey, accountId)` — the hop that keeps one
 * proxy token from resolving another account's OpenRouter key. Sub-issue of
 * LIN-1389, unit-layer half of the split with LIN-1925 (which separately
 * covers the server.js wrapper/argument-order wiring — out of scope here).
 *
 * Modeled on tests/unit/linear-token-isolation.test.js's LIN-1366 Block B: a
 * real `ProxyTokenStore` mints tokens with a real `createdBy`, real
 * `authenticateProxyToken` resolves them over real HTTP, and an injected
 * recording resolver captures the `(urlKey, accountId)` args every call site
 * forwards — proving the wiring itself, not just a pure selector. The
 * recording resolver here additionally DELEGATES to the real
 * lib/openrouter-key-resolver.js over a real UserPreferencesStore seeded with
 * account-A's key, so the resolved key is also witnessed end-to-end.
 *
 * Run with: node --test tests/unit/proxy-openrouter-principal-hop.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { UserPreferencesStore } from '../../lib/user-preferences.js';
import { getWorkspaceOpenRouterKey } from '../../lib/openrouter-key-resolver.js';

const WORKSPACE_URL_KEY = 'acme';
const ACCOUNT_A = 'account-A';
const SEEDED_KEY = 'sk-or-v1-account-a-key';
const ISSUE_IDENTIFIER = 'TEST-2'; // a leaf mock fixture: no children, no bug label, not blocked — single-hop recommend

const PAID_NOTE = 'openrouter_key_fallback_paid_env';
const FREE_NOTE = 'openrouter_key_fallback_free_tier';

// Generic Mongo/MangoDB-like in-memory collection, mirroring
// linear-token-isolation.test.js's inMemoryCollection() — shared shape for
// both the ProxyTokenStore and UserPreferencesStore fakes below.
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

// A hand-rolled recording wrapper around the REAL resolver — proves the
// composed chain (route -> hop -> real resolver -> real store), not a pure
// selector in isolation. Records every (urlKey, accountId) call plus the
// resolved key, so a single assertion set covers all four per-case witnesses
// the ticket requires (accountId, urlKey, resolved key, call count).
function makeRecordingResolver(userPreferencesStore) {
  const calls = [];
  const resolver = async (urlKey, accountId) => {
    const result = await getWorkspaceOpenRouterKey(userPreferencesStore, accountId);
    calls.push({ urlKey, accountId, result });
    return result;
  };
  return { calls, resolver };
}

// Minimal cache store fakes for recapCacheStore/briefCacheStore — load-bearing
// per the ticket: routes/proxy.js 503s outright without them (recap :4123,
// brief mirrors it), which would mask the hop under test behind an unrelated
// failure rather than exercising it.
function makeCacheStore() {
  const docs = new Map();
  return {
    async get(urlKey, id) { return docs.get(`${urlKey}:${id}`) || null; },
    async put(urlKey, id, doc) { docs.set(`${urlKey}:${id}`, { ...doc, generatedAt: new Date() }); }
  };
}

// Minimal dispatchQueueStore fake for recommend-and-dispatch — mirrors the
// canonical shape lib/dispatch-store.js's addItem returns (the fields the
// route reads back: _id, kind, promptName, issueIdentifier, target,
// dispatchedAt). Exposes no findRecentFreshDispatch/countDistinctTasksForSession/
// getItemStatus, so createDispatchItem's optional guards fail open (documented
// intent in lib/dispatch-factory.js) rather than needing to be modeled here.
function makeDispatchQueueStore() {
  const items = [];
  let counter = 0;
  return {
    items,
    async addItem(urlKey, item) {
      const doc = {
        _id: `dispatch-${++counter}`,
        urlKey,
        kind: item.kind || 'custom',
        promptName: item.promptName || 'Prompt',
        issueIdentifier: item.issueIdentifier || null,
        target: item.target || 'cli',
        sessionId: item.sessionId || null,
        dispatchedAt: new Date(),
      };
      items.push(doc);
      return doc;
    }
  };
}

// workspacePreferencesStore must be no-op-safe, NOT {} — resolveAiOperationModel
// (recap/brief :4206/4327/4488/4608) and createDispatchItem's dispatchDefaults
// lookup both call getWorkspacePreferences AFTER the resolver hop under test; a
// bare {} would throw there and a status-only assertion would pass for the
// wrong reason (per the ticket's fixture requirements).
function noopWorkspacePreferencesStore() {
  return { getWorkspacePreferences: async () => ({}) };
}

/**
 * Builds a real Express app wired through the real createProxyRoutes, with a
 * real ProxyTokenStore (in-memory collection) for authenticateProxyToken to
 * validate against. `resolveWorkspaceAccess` always succeeds with the given
 * `accessToken` regardless of owner — LIN-1366's owner-isolation hop is a
 * DIFFERENT, already-covered concern (tests/unit/linear-token-isolation.test.js);
 * stubbing it open here isolates the OpenRouter-key hop this ticket targets,
 * including for the ownerless negative case (which must reach the resolver,
 * not be turned away earlier by the workspace-access guard).
 */
function buildApp({ getWorkspaceOpenRouterKey: resolverFn, proxyEventStore, dispatchQueueStore, accessToken = 'test-token' }) {
  const app = express();
  app.use(express.json());
  const proxyTokenStore = new ProxyTokenStore({ collection: inMemoryCollection() });
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: proxyEventStore || { recordEvent: async () => {} },
    agentStatusStore: {},
    recapCacheStore: makeCacheStore(),
    briefCacheStore: makeCacheStore(),
    taskSnapshotStore: null,
    dispatchQueueStore: dispatchQueueStore || makeDispatchQueueStore(),
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceAccessToken: async () => accessToken,
    resolveWorkspaceAccess: async () => ({ token: accessToken, reason: 'ok', provider: 'linear' }),
    getWorkspaceOpenRouterKey: resolverFn,
    workspacePreferencesStore: noopWorkspacePreferencesStore(),
    freeTierStore: { tryUse: async () => ({ allowed: true, remaining: 19, limit: 20, resetsAt: null }) },
  }));
  return { app, proxyTokenStore };
}

async function requestJson(app, path, { method = 'GET', token, body } = {}) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// Fresh store + spy + app per test — call counts and seeded state must never
// leak across cases.
async function setup() {
  const userPreferencesStore = new UserPreferencesStore({ collection: inMemoryCollection() });
  await userPreferencesStore.setOpenRouterApiKey(ACCOUNT_A, SEEDED_KEY);
  const spy = makeRecordingResolver(userPreferencesStore);
  const { app, proxyTokenStore } = buildApp({ getWorkspaceOpenRouterKey: spy.resolver });
  return { spy, app, proxyTokenStore };
}

// Shared per-case acceptance assertions (the load-bearing witness):
// accountId === 'account-A', urlKey matches the token's workspace, the
// resolved key equals the seeded key, and the resolver was called exactly once.
function assertPrincipalThreaded(spy) {
  assert.equal(spy.calls.length, 1, `expected exactly one resolver call, got ${JSON.stringify(spy.calls)}`);
  assert.equal(spy.calls[0].urlKey, WORKSPACE_URL_KEY);
  assert.equal(spy.calls[0].accountId, ACCOUNT_A, 'accountId === account-A is the load-bearing assertion');
  assert.equal(spy.calls[0].result, SEEDED_KEY);
}

describe('req.proxyCreatedBy -> getWorkspaceOpenRouterKey principal hop (LIN-1926)', () => {
  test('1: GET /api/proxy/issues/:identifier/recommend', async () => {
    const { spy, app, proxyTokenStore } = await setup();
    const { token } = await proxyTokenStore.createToken(WORKSPACE_URL_KEY, { scope: 'read', createdBy: ACCOUNT_A });

    const { status, body } = await requestJson(app, `/api/proxy/issues/${ISSUE_IDENTIFIER}/recommend`, { token });

    assert.equal(status, 200, JSON.stringify(body));
    assertPrincipalThreaded(spy);
  });

  test('2: GET /api/proxy/issues/:identifier/recap', async () => {
    const { spy, app, proxyTokenStore } = await setup();
    const { token } = await proxyTokenStore.createToken(WORKSPACE_URL_KEY, { scope: 'read', createdBy: ACCOUNT_A });

    const { status, body } = await requestJson(app, `/api/proxy/issues/${ISSUE_IDENTIFIER}/recap`, { token });

    assert.equal(status, 200, JSON.stringify(body));
    assertPrincipalThreaded(spy);
  });

  test('3: POST /api/proxy/recap/:identifier', async () => {
    const { spy, app, proxyTokenStore } = await setup();
    const { token } = await proxyTokenStore.createToken(WORKSPACE_URL_KEY, { scope: 'read', createdBy: ACCOUNT_A });

    const { status, body } = await requestJson(app, `/api/proxy/recap/${ISSUE_IDENTIFIER}`, { method: 'POST', token });

    assert.equal(status, 200, JSON.stringify(body));
    assertPrincipalThreaded(spy);
  });

  test('4: GET /api/proxy/issues/:identifier/brief', async () => {
    const { spy, app, proxyTokenStore } = await setup();
    const { token } = await proxyTokenStore.createToken(WORKSPACE_URL_KEY, { scope: 'read', createdBy: ACCOUNT_A });

    const { status, body } = await requestJson(app, `/api/proxy/issues/${ISSUE_IDENTIFIER}/brief`, { token });

    assert.equal(status, 200, JSON.stringify(body));
    assertPrincipalThreaded(spy);
  });

  test('5: POST /api/proxy/brief/:identifier', async () => {
    const { spy, app, proxyTokenStore } = await setup();
    const { token } = await proxyTokenStore.createToken(WORKSPACE_URL_KEY, { scope: 'read', createdBy: ACCOUNT_A });

    const { status, body } = await requestJson(app, `/api/proxy/brief/${ISSUE_IDENTIFIER}`, { method: 'POST', token });

    assert.equal(status, 200, JSON.stringify(body));
    assertPrincipalThreaded(spy);
  });

  test('6: POST /api/proxy/recommend-and-dispatch', async () => {
    const { spy, app, proxyTokenStore } = await setup();
    // requireWriteScope gates this route — readWrite, unlike the other five.
    const { token } = await proxyTokenStore.createToken(WORKSPACE_URL_KEY, { scope: 'readWrite', createdBy: ACCOUNT_A });

    const { status, body } = await requestJson(app, '/api/proxy/recommend-and-dispatch', {
      method: 'POST',
      token,
      body: { issueIdentifier: ISSUE_IDENTIFIER },
    });

    assert.equal(status, 201, JSON.stringify(body));
    assertPrincipalThreaded(spy);
  });

  // Negative / fail-closed case: an ownerless (createdBy: null) token must
  // reach the resolver as null and resolve null — never borrow another
  // account's key, and never widen into "any non-null key is forbidden"
  // (that inversion would also reject a legitimately absent key). Minted as a
  // STANDARD token, not a bootstrap: lib/proxy-tokens.js:158 refuses an
  // ownerless bootstrap mint when DISPATCH_OWNERLESS_BROKER_COMPAT is off, and
  // this case must not depend on that env default either way (precedent:
  // linear-token-isolation.test.js R4). Exchange-hop coverage is retained by
  // the six positive cases above.
  test('negative: ownerless proxy token reaches the resolver with null and resolves null (fail-closed)', async () => {
    const { spy, app, proxyTokenStore } = await setup();
    const { token } = await proxyTokenStore.createToken(WORKSPACE_URL_KEY, { scope: 'read' }); // no createdBy

    const { status, body } = await requestJson(app, `/api/proxy/issues/${ISSUE_IDENTIFIER}/recommend`, { token });

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].accountId, null, 'the resolver argument must be null, matching openrouter-key-resolver.test.js:53-70');
    assert.equal(spy.calls[0].result, null);
  });

  // Secondary / corroborating assertion only — NEVER a substitute for the
  // direct principal assertion above (isFreeTier discriminates a correct
  // principal from a null one in only 1 of 4 env configurations, so it is
  // explicitly rejected as the acceptance witness). Exercises the LIVE
  // (non-isTestMode) path so logOpenRouterCredentialSource actually runs: POST
  // /recap witnesses BEFORE its context fetch (routes/proxy.js:4296-4298),
  // same ordering tests/unit/proxy-openrouter-fallback-note.test.js relies on.
  // The downstream Linear call subsequently fails (no real workspace) — only
  // the recorded audit events are asserted, never the response status/body.
  test('secondary: creator key resolves -> no openrouter_key_fallback_* audit note (corroboration only)', async (t) => {
    const savedApiKey = process.env.OPENROUTER_API_KEY;
    const savedFreeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    t.after(() => {
      if (savedApiKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedApiKey;
      if (savedFreeTierKey === undefined) delete process.env.OPENROUTER_FREE_TIER_KEY; else process.env.OPENROUTER_FREE_TIER_KEY = savedFreeTierKey;
    });
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_FREE_TIER_KEY = 'sk-or-fake-free-tier-key';

    const userPreferencesStore = new UserPreferencesStore({ collection: inMemoryCollection() });
    await userPreferencesStore.setOpenRouterApiKey(ACCOUNT_A, SEEDED_KEY);
    const spy = makeRecordingResolver(userPreferencesStore);
    const events = [];
    const { app, proxyTokenStore } = buildApp({
      getWorkspaceOpenRouterKey: spy.resolver,
      proxyEventStore: { recordEvent: async (e) => { events.push(e); } },
      accessToken: 'not-a-real-linear-token',
    });
    const { token } = await proxyTokenStore.createToken(WORKSPACE_URL_KEY, { scope: 'read', createdBy: ACCOUNT_A });

    await requestJson(app, `/api/proxy/recap/${ISSUE_IDENTIFIER}`, { method: 'POST', token });

    assert.ok(
      !events.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `no fallback note when the creator's own key resolved: ${JSON.stringify(events)}`
    );
  });
});
