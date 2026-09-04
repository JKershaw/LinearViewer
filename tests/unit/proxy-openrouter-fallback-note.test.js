/**
 * LIN-1458 — "fail observably": witness which OpenRouter credential source
 * served a proxy request when the token creator's OWN account-keyed read
 * (getWorkspaceOpenRouterKey) came back empty.
 *
 * routes/proxy.js's logOpenRouterCredentialSource helper is called once per
 * request at the six top-level OpenRouter call sites (GET/POST recommend,
 * recap, brief, plus recommend-and-dispatch), after the existing 503
 * "not configured" gate. It writes an additive audit-note row
 * (openrouter_key_fallback_paid_env / openrouter_key_fallback_free_tier) via
 * the existing logEvent channel — no resolver contract change, no new store.
 *
 * The note is deliberately suppressed under isTestMode (process.env.NODE_ENV
 * === 'test' && accessToken === 'test-token'), so witnessing it live requires
 * a NON-test-token access token. lib/providers/linear/index.js hardcodes
 * https://api.linear.app with no injection seam (LIN-1458's approved plan
 * scoped no such seam), so a bogus token here really does hit the real Linear
 * API and fail authentication downstream of our witness call — exactly as
 * the plan-review's session-fit note (round 2, Advisory A4) anticipated: "the
 * new route-level cases must run with a non-test-token access token and
 * assert the row written before generation; the downstream Linear/OpenRouter
 * call may then fail, and the fire-and-forget row survives that." Every
 * assertion below is on the recorded proxy-event rows, never on the
 * (deliberately unreachable) success response body — EXCEPT the HTTP status,
 * which is asserted alongside every negative (`!events.some(...)`) check: a
 * missing/broken route over HTTP is a silent 404 with NO events at all, so
 * without a status assertion every negative check here would pass vacuously
 * (LIN-2505). That status assertion is deliberately `!== 404`, not a pinned
 * code: the live-Linear call downstream of the witness fails authentication
 * (typically 401), but asserting that exact third-party status made these
 * cases depend on api.linear.app's live response (LIN-2505 review finding) —
 * offline, or on any Linear-side status change, the assertion failed for
 * reasons unrelated to the behaviour under test. `!== 404` still closes the
 * vacuous-negative hole (verified: a missing-route mutation reproduces
 * exactly 404) without that third-party coupling. Status is asserted exactly
 * (200) only under isTestMode, which is fully local/deterministic.
 *
 * Scaffolding mirrors tests/unit/proxy-openrouter-principal-hop.test.js: a
 * real ProxyTokenStore + real HTTP request through the full middleware chain
 * (proxyLimiter / authenticateProxyToken / requireWriteScope), which is a
 * coverage gain over the old direct-handler-call harness this file used to
 * use (LIN-2505) — those middlewares now actually run.
 *
 * Known pre-existing cost, not a regression from this conversion: this file's
 * wall-clock includes several seconds of post-test process idle beyond its
 * actual test time (root cause unidentified — ruled out armKeepalive and bare
 * fetch); unrelated to the request-driven rewrite.
 *
 * Run with: node --test tests/unit/proxy-openrouter-fallback-note.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// LIN-1880: this file opened a live TLS connection to api.linear.app on every
// run. The Linear call is incidental — no assertion here reads Linear data —
// so it is refused rather than stubbed with a plausible response.
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

const PAID_NOTE = 'openrouter_key_fallback_paid_env';
const FREE_NOTE = 'openrouter_key_fallback_free_tier';
const LIN_961_NOTE = 'free-tier fallback: no paid/OAuth key resolved';

const WORKSPACE_URL_KEY = 'acme';
const ACCOUNT_A = 'account-A';
const ISSUE_IDENTIFIER = 'TEST-2';

// Generic Mongo/MangoDB-like in-memory collection, mirroring
// proxy-openrouter-principal-hop.test.js's inMemoryCollection().
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

// Minimal cache store fakes for recapCacheStore/briefCacheStore — the routes
// 503 outright without them, which would mask the witness under an unrelated
// failure. The store's own methods are `get`/`put`, not `set`.
function makeCacheStore() {
  const docs = new Map();
  return {
    async get(urlKey, id) { return docs.get(`${urlKey}:${id}`) || null; },
    async put(urlKey, id, doc) { docs.set(`${urlKey}:${id}`, { ...doc, generatedAt: new Date() }); }
  };
}

// Minimal dispatchQueueStore fake for recommend-and-dispatch, mirroring the
// canonical shape lib/dispatch-store.js's addItem returns.
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
// (recap/brief) calls getWorkspacePreferences AFTER the witness under test; a
// bare {} would throw there rather than exercise the live-Linear failure path.
function noopWorkspacePreferencesStore() {
  return { getWorkspacePreferences: async () => ({}) };
}

/**
 * Builds a real Express app wired through the real createProxyRoutes, with a
 * real ProxyTokenStore (in-memory collection) for authenticateProxyToken to
 * validate against — this sidesteps the old stub's missing `validateToken`
 * entirely by not stubbing at all.
 *
 * `accessToken` defaults to a syntactically-valid but bogus, non-test-token
 * value so isTestMode is false and the witness call is live — see file
 * header. Pass `accessToken: 'test-token'` for the isTestMode negative cases.
 */
function buildApp({ getWorkspaceOpenRouterKey, events, accessToken = 'not-a-real-linear-token', dispatchQueueStore }) {
  const app = express();
  app.use(express.json());
  const proxyTokenStore = new ProxyTokenStore({ collection: inMemoryCollection() });
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async (e) => { events.push(e); return e; } },
    agentStatusStore: {},
    recapCacheStore: makeCacheStore(),
    briefCacheStore: makeCacheStore(),
    taskSnapshotStore: null,
    dispatchQueueStore: dispatchQueueStore || makeDispatchQueueStore(),
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceAccessToken: () => null,
    resolveWorkspaceAccess: async () => ({ token: accessToken, reason: null }),
    getWorkspaceOpenRouterKey,
    workspacePreferencesStore: noopWorkspacePreferencesStore(),
    freeTierStore: { tryUse: async () => ({ allowed: true, remaining: 19, limit: 20, resetsAt: null }) },
  }));
  return { app, proxyTokenStore };
}

async function request(app, path, { method = 'GET', token, body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/**
 * Mints a fresh token against a fresh app/store and drives one request —
 * this file's per-case entry point, replacing the old getHandler+baseReq
 * direct-call shape with a real HTTP round trip.
 */
async function mintAndRequest({ getWorkspaceOpenRouterKey, events, accessToken, dispatchQueueStore, scope = 'read' }, path, opts = {}) {
  const { app, proxyTokenStore } = buildApp({ getWorkspaceOpenRouterKey, events, accessToken, dispatchQueueStore });
  const { token } = await proxyTokenStore.createToken(WORKSPACE_URL_KEY, { scope, createdBy: ACCOUNT_A });
  return request(app, path, { ...opts, token });
}

/** Save/restore an env var around one test, mirroring the ownerless-token spec's `restore()`. */
function withEnv(t, key, value) {
  const before = process.env[key];
  t.after(() => {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  });
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('LIN-1458 — OpenRouter fallback-credential-source audit note', () => {
  test('GET /recommend: creator key present → no fallback note is written', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', undefined);
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];

    const { status } = await mintAndRequest(
      { getWorkspaceOpenRouterKey: async () => 'sk-or-real-creator-key', events },
      `/api/proxy/issues/${ISSUE_IDENTIFIER}/recommend`
    );

    // A missing/broken route silently 404s with no events at all — asserting
    // the request actually reached the route (not that value, just not a
    // missing-route 404) keeps the negative check below from passing
    // vacuously, without depending on api.linear.app's exact live status.
    assert.notEqual(status, 404, `expected the request to reach the route, got a missing-route 404`);
    assert.ok(events.length >= 1, 'the terminal response is still logged');
    assert.ok(!events.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `no fallback note when the creator's own key resolved: ${JSON.stringify(events)}`);
  });

  test('GET /recommend: creator key absent + OPENROUTER_API_KEY set → exactly one paid-env fallback note', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', 'sk-or-fake-paid-env-key');
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];

    const { status } = await mintAndRequest(
      { getWorkspaceOpenRouterKey: async () => null, events },
      `/api/proxy/issues/${ISSUE_IDENTIFIER}/recommend`
    );

    assert.notEqual(status, 404, `expected the request to reach the route, got a missing-route 404`);
    const paidNotes = events.filter(e => e.note === PAID_NOTE);
    assert.equal(paidNotes.length, 1, `expected exactly one paid-env note: ${JSON.stringify(events)}`);
    assert.equal(paidNotes[0].status, 200, 'the witness row itself is a 200, independent of the eventual response');
    assert.ok(!events.some(e => e.note === FREE_NOTE), 'must not also claim free tier');
  });

  test('GET /recommend: creator key absent + only OPENROUTER_FREE_TIER_KEY set → free-tier fallback note alongside the existing LIN-961 row', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', undefined);
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', 'sk-or-fake-free-tier-key');
    const events = [];

    const { status } = await mintAndRequest(
      { getWorkspaceOpenRouterKey: async () => null, events },
      `/api/proxy/issues/${ISSUE_IDENTIFIER}/recommend`
    );

    assert.notEqual(status, 404, `expected the request to reach the route, got a missing-route 404`);
    const freeNotes = events.filter(e => e.note === FREE_NOTE);
    const lin961Notes = events.filter(e => e.note === LIN_961_NOTE);
    assert.equal(freeNotes.length, 1, `expected exactly one free-tier fallback note: ${JSON.stringify(events)}`);
    assert.equal(lin961Notes.length, 1, 'the pre-existing LIN-961 breadcrumb must still fire — additive, not a replacement');
    assert.ok(!events.some(e => e.note === PAID_NOTE), 'must not also claim paid-env');
  });

  test('GET /recommend: ?kind= override → no fallback note (no real credential attempt is made)', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', undefined);
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];

    const { status } = await mintAndRequest(
      { getWorkspaceOpenRouterKey: async () => null, events },
      `/api/proxy/issues/${ISSUE_IDENTIFIER}/recommend?kind=implementation`
    );

    assert.notEqual(status, 404, `expected the request to reach the route, got a missing-route 404`);
    assert.ok(!events.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `kind-override must bypass the 503 gate AND the witness together: ${JSON.stringify(events)}`);
  });

  test('GET /recommend: isTestMode (test-token) → no fallback note, fully deterministic (no live Linear/OpenRouter call)', async () => {
    const events = [];

    const { status } = await mintAndRequest(
      { getWorkspaceOpenRouterKey: async () => null, events, accessToken: 'test-token' },
      `/api/proxy/issues/${ISSUE_IDENTIFIER}/recommend`
    );

    assert.equal(status, 200, `isTestMode must serve the mock recommendation directly, got ${status}`);
    assert.ok(!events.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `isTestMode must suppress the witness: ${JSON.stringify(events)}`);
  });

  test('POST /recommend-and-dispatch: fallback note witnessed exactly once per request', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', 'sk-or-fake-paid-env-key');
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];

    const { status } = await mintAndRequest(
      { getWorkspaceOpenRouterKey: async () => null, events, scope: 'readWrite' },
      '/api/proxy/recommend-and-dispatch',
      { method: 'POST', body: { issueIdentifier: ISSUE_IDENTIFIER } }
    );

    assert.notEqual(status, 404, `expected the request to reach the route, got a missing-route 404`);
    const paidNotes = events.filter(e => e.note === PAID_NOTE);
    assert.equal(paidNotes.length, 1, `expected exactly one witness row for the whole request: ${JSON.stringify(events)}`);
  });

  test('POST /recap (force-regenerate): fallback note witnessed before the (failing) regeneration', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', 'sk-or-fake-paid-env-key');
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];

    const { status } = await mintAndRequest(
      { getWorkspaceOpenRouterKey: async () => null, events },
      `/api/proxy/recap/${ISSUE_IDENTIFIER}`,
      { method: 'POST' }
    );

    assert.notEqual(status, 404, `expected the request to reach the route, got a missing-route 404`);
    const paidNotes = events.filter(e => e.note === PAID_NOTE);
    assert.equal(paidNotes.length, 1, `expected exactly one paid-env note: ${JSON.stringify(events)}`);
  });

  test('POST /brief (force-regenerate): fallback note witnessed before the (failing) regeneration', async (t) => {
    withEnv(t, 'OPENROUTER_API_KEY', 'sk-or-fake-paid-env-key');
    withEnv(t, 'OPENROUTER_FREE_TIER_KEY', undefined);
    const events = [];

    const { status } = await mintAndRequest(
      { getWorkspaceOpenRouterKey: async () => null, events },
      `/api/proxy/brief/${ISSUE_IDENTIFIER}`,
      { method: 'POST' }
    );

    assert.notEqual(status, 404, `expected the request to reach the route, got a missing-route 404`);
    const paidNotes = events.filter(e => e.note === PAID_NOTE);
    assert.equal(paidNotes.length, 1, `expected exactly one paid-env note: ${JSON.stringify(events)}`);
  });

  test('POST /recap and POST /brief: isTestMode → no fallback note, fully deterministic', async () => {
    const recapEvents = [];
    const recapResult = await mintAndRequest(
      { getWorkspaceOpenRouterKey: async () => null, events: recapEvents, accessToken: 'test-token' },
      `/api/proxy/recap/${ISSUE_IDENTIFIER}`,
      { method: 'POST' }
    );
    assert.equal(recapResult.status, 200, `isTestMode must serve the mock recap directly, got ${recapResult.status}`);
    assert.ok(!recapEvents.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `isTestMode must suppress the witness on POST /recap: ${JSON.stringify(recapEvents)}`);

    const briefEvents = [];
    const briefResult = await mintAndRequest(
      { getWorkspaceOpenRouterKey: async () => null, events: briefEvents, accessToken: 'test-token' },
      `/api/proxy/brief/${ISSUE_IDENTIFIER}`,
      { method: 'POST' }
    );
    assert.equal(briefResult.status, 200, `isTestMode must serve the mock brief directly, got ${briefResult.status}`);
    assert.ok(!briefEvents.some(e => e.note === PAID_NOTE || e.note === FREE_NOTE),
      `isTestMode must suppress the witness on POST /brief: ${JSON.stringify(briefEvents)}`);
  });
});
