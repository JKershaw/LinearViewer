/**
 * LIN-1582 — POST /workspace/:urlKey/api/proxy/tokens under the ownerless switch.
 *
 * This route was the second of two production bootstrap mints that escaped
 * DISPATCH_OWNERLESS_BROKER_COMPAT: it called `createToken({ kind: 'bootstrap' })`
 * directly, so with the lane off it still minted an ownerless bootstrap whose
 * ownerlessness the exchanged working token inherited (the LIN-1576 shape).
 *
 * Two things are being pinned, and the second is the reason a store-level guard
 * alone was not enough:
 *
 *   1. A `bootstrap: true` request from a session with no `accountId` is REFUSED
 *      when the lane is off, before any mint is attempted.
 *   2. It is refused with a policy-shaped 503, not the generic 500 the route's
 *      catch-all would have produced once the store started throwing — a
 *      deliberate policy decision must not be reported as a server fault.
 *
 * And three things must NOT change: the non-bootstrap path (which reaches the same
 * createToken call through a ternary spread), an owned bootstrap mint, and the
 * whole route under the default compat-on lane.
 *
 * Scaffolding mirrors tests/unit/quota-isolation.test.js — the real route factory
 * over the real ProxyTokenStore, so the assertions run the actual chain rather
 * than a reimplementation of it.
 *
 * Run with: node --test tests/unit/proxy-token-route-ownerless.test.js
 *
 * NODE_ENV must be set to 'test' BEFORE importing routes/proxy.js: the
 * module-level proxyTokenCreationLimiter (max 10/15min/IP) is shared across
 * every createProxyRoutes() instance in the process, and this file makes 8
 * route-level mints over real HTTP (LIN-2505).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

const ENV = 'DISPATCH_OWNERLESS_BROKER_COMPAT';
const TOKENS_PATH = '/workspace/acme/api/proxy/tokens';

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
    return { statusCode: res.status, jsonBody: parsed };
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
    async updateOne(query, update) {
      const doc = docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v));
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne() { return { deletedCount: 0 }; },
    async deleteMany() { return { deletedCount: 0 }; },
  };
}

// Fresh app per request (a session-injecting `workspaceFromUrl` is baked in at
// build time), matching this file's own per-test isolation convention.
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

/**
 * Drive the real route over HTTP. `accountId: null` models the ownerless
 * session this ticket is about — a session that authenticated but carries no
 * account stamp.
 */
async function createToken(proxyTokenStore, { accountId, body }) {
  const app = buildProxyApp({ proxyTokenStore, session: { accountId, features: { proxy: true } } });
  return call(app, 'post', TOKENS_PATH, body);
}

function harness() {
  const collection = inMemoryCollection();
  const proxyTokenStore = new ProxyTokenStore({ collection });
  return { collection, proxyTokenStore };
}

const restore = (t) => {
  const before = process.env[ENV];
  t.after(() => {
    if (before === undefined) delete process.env[ENV];
    else process.env[ENV] = before;
  });
};

describe('LIN-1582 — POST .../api/proxy/tokens and the ownerless switch', () => {
  test('compat OFF + bootstrap + ownerless session → 503, and no mint is attempted', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const { collection, proxyTokenStore } = harness();
    const warnMock = t.mock.method(console, 'warn', () => {});

    const res = await createToken(proxyTokenStore, {
      accountId: null,
      body: { label: 'handoff', scope: 'readWrite', bootstrap: true },
    });

    // A policy refusal, shaped like the broker lane's (routes/dispatch.js) —
    // NOT the generic 500 the route's catch would have turned the store throw into.
    assert.equal(res.statusCode, 503, JSON.stringify(res.jsonBody));
    assert.match(res.jsonBody.error, /no account owner/i);
    assert.match(res.jsonBody.error, /LIN-1448/);
    // The detail must send the reader somewhere that can actually work.
    assert.match(res.jsonBody.message, /sign in again/i);
    assert.ok(!('token' in res.jsonBody), 'no credential in a refusal body');

    // Refused BEFORE the store, so nothing was written and the store's own
    // backstop never had to fire (no double-log).
    assert.equal(collection._docs.length, 0, 'no token document may be written');
    const warned = warnMock.mock.calls.map(c => c.arguments.join(' ')).join('\n');
    assert.match(warned, /LIN-1582/, 'the refusal is logged for the operator');
    assert.equal(warnMock.mock.calls.length, 1, 'route and store must not both log');
  });

  test('compat OFF + bootstrap + OWNED session → 201, response shape unchanged', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const { collection, proxyTokenStore } = harness();

    const res = await createToken(proxyTokenStore, {
      accountId: 'account-A',
      body: { label: 'handoff', scope: 'readWrite', bootstrap: true },
    });

    assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.success, true);
    assert.equal(res.jsonBody.kind, 'bootstrap');
    assert.equal(res.jsonBody.singleUse, true, 'a bootstrap is forced single-use');
    assert.equal(res.jsonBody.label, 'handoff');
    assert.equal(res.jsonBody.scope, 'readWrite');
    assert.ok(res.jsonBody.tokenId && res.jsonBody.token);
    assert.match(res.jsonBody.message, /cannot be retrieved later/);

    assert.equal(collection._docs.length, 1);
    assert.equal(collection._docs[0].createdBy, 'account-A');
    // And it is a real, exchangeable bootstrap.
    const working = await proxyTokenStore.exchangeBootstrapToken(res.jsonBody.token);
    assert.equal(working.kind, 'standard');
  });

  test('compat OFF + NON-bootstrap + ownerless session → 201 (the untouched path)', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const { collection, proxyTokenStore } = harness();

    // The regression that would matter most: the bootstrap and non-bootstrap
    // branches share one createToken call via a ternary spread, so a check placed
    // outside `if (wantBootstrap)` would break every ordinary mint from a session
    // that happens to lack an accountId. The switch was never scoped to these.
    const res = await createToken(proxyTokenStore, {
      accountId: null,
      body: { label: 'ordinary', scope: 'read' },
    });

    assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.kind, 'standard');
    assert.equal(res.jsonBody.singleUse, false);
    assert.equal(collection._docs.length, 1);
    assert.equal(collection._docs[0].createdBy, null);
  });

  test('compat OFF + non-bootstrap singleUse + ownerless session → 201 (flag still honored)', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const { proxyTokenStore } = harness();

    const res = await createToken(proxyTokenStore, {
      accountId: null,
      body: { label: 'ordinary', scope: 'read', singleUse: true },
    });

    assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.kind, 'standard');
    assert.equal(res.jsonBody.singleUse, true, 'the non-bootstrap options are forwarded as before');
  });

  test('compat ON (default) + bootstrap + ownerless session → 201 (compat lane preserved)', async (t) => {
    restore(t);
    delete process.env[ENV];
    const { collection, proxyTokenStore } = harness();

    const res = await createToken(proxyTokenStore, {
      accountId: null,
      body: { label: 'handoff', scope: 'readWrite', bootstrap: true },
    });

    assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.kind, 'bootstrap');
    assert.equal(collection._docs[0].createdBy, null, 'ownerless mints remain possible under compat');
  });

  test('the string form "bootstrap": "true" is gated too', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const { collection, proxyTokenStore } = harness();
    t.mock.method(console, 'warn', () => {});

    // The route accepts both the boolean and the string (`bootstrap === 'true'`),
    // so the gate has to key on the same resolved `wantBootstrap` the mint does —
    // not on `req.body.bootstrap === true`, which a form-encoded caller would slip past.
    const res = await createToken(proxyTokenStore, {
      accountId: null,
      body: { label: 'handoff', scope: 'readWrite', bootstrap: 'true' },
    });

    assert.equal(res.statusCode, 503, JSON.stringify(res.jsonBody));
    assert.equal(collection._docs.length, 0);
  });

  test('an undefined session is treated as ownerless, not crashed on', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const { collection, proxyTokenStore } = harness();
    t.mock.method(console, 'warn', () => {});

    // No accountId anywhere on the session — the shape the optional chain in both
    // the gate and the mint has to tolerate identically.
    const app = buildProxyApp({ proxyTokenStore, session: { features: { proxy: true } } });
    const res = await call(app, 'post', TOKENS_PATH, { bootstrap: true, scope: 'readWrite' });

    assert.equal(res.statusCode, 503, JSON.stringify(res.jsonBody));
    assert.equal(collection._docs.length, 0);
  });

  test('the proxy feature gate still runs first (403 before any ownerless verdict)', async (t) => {
    restore(t);
    process.env[ENV] = 'off';
    const { collection, proxyTokenStore } = harness();

    const app = buildProxyApp({ proxyTokenStore, session: { accountId: null, features: { proxy: false } } });
    const res = await call(app, 'post', TOKENS_PATH, { bootstrap: true });

    // LIN-525 #2's defense-in-depth gate must keep precedence: a flag-off caller
    // learns the feature is off, not that their session lacks an owner.
    assert.equal(res.statusCode, 403, JSON.stringify(res.jsonBody));
    assert.match(res.jsonBody.error, /not enabled/i);
    assert.equal(collection._docs.length, 0);
  });
});
