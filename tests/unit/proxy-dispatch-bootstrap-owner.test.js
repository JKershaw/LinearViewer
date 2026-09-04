/**
 * LIN-1376 — dispatched/collective bootstrap tokens must carry the dispatching
 * owner's account id, so the working token the exchange mints resolves under
 * LIN-1366's owner-scoped Linear-token selection.
 *
 * Regression: before this fix `attachProxyContext` minted the embedded bootstrap
 * with no `createdBy`, so it (and the token the exchange inherits from it) was
 * `createdBy: null`. LIN-1366's null-owner guard fails that closed, so every
 * dispatched session hit WORKSPACE_NOT_CONNECTED even after wiping stale tokens —
 * the defect was re-minted on each dispatch.
 *
 * A REAL ProxyTokenStore over an in-memory collection backs the store so the mint
 * → exchange → validate chain (the exact path a dispatched agent walks) is
 * exercised end-to-end. `createdBy` is what routes thread into
 * `resolveWorkspaceAccess(urlKey, ownerAccountId)`, so asserting it on the
 * validated working token pins the whole owner-propagation chain.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// LIN-1880: this file opened a live TLS connection to api.linear.app on every
// run. The Linear call is incidental — no assertion here reads Linear data —
// so it is refused rather than stubbed with a plausible response.
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { attachProxyContext } from '../../lib/proxy-preamble.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

function createMockCollection() {
  let docs = [];
  const match = (d, query) => Object.keys(query).every(k => {
    if (typeof query[k] === 'object' && query[k] !== null) return true; // skip operators
    return d[k] === query[k];
  });
  return {
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => match(d, query)) || null; },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => match(d, query));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async find() { return { async toArray() { return docs.slice(); } }; },
    async deleteOne() { return { deletedCount: 0 }; },
    async deleteMany() { return { deletedCount: 0 }; }
  };
}

describe('LIN-1376 — dispatched bootstrap carries the owner account id', () => {
  let store;
  beforeEach(() => {
    store = new ProxyTokenStore({ collection: createMockCollection() });
  });

  test('attachProxyContext threads createdBy → exchanged working token resolves under owner scoping', async () => {
    const { bootstrapToken } = await attachProxyContext({
      proxyTokenStore: store,
      urlKey: 'acme',
      baseUrl: 'https://harbour.example',
      prompt: 'DISPATCHED PROMPT',
      label: 'dispatch-bootstrap',
      harness: 'claude-code', // MCP mode: token is returned as a field, not inlined
      createdBy: 'account-A'
    });

    assert.ok(bootstrapToken, 'claude-code harness returns the minted bootstrap to carry out-of-band');

    // The agent's first real call is the exchange; the working token it gets back
    // must inherit the owner so data endpoints resolve the right Linear identity.
    const working = await store.exchangeBootstrapToken(bootstrapToken);
    assert.ok(working?.token, 'bootstrap exchanges for a working token');

    const validated = await store.validateToken(working.token);
    assert.ok(validated, 'working token validates on data endpoints');
    assert.equal(
      validated.createdBy,
      'account-A',
      'working token carries the dispatching owner — this is the value routes pass to resolveWorkspaceAccess as ownerAccountId'
    );
  });

  test('a null owner still propagates as null (no fabricated owner) — fails closed, as designed', async () => {
    // A dispatcher with no resolvable owner must NOT be papered over with a borrowed
    // identity; it stays null so LIN-1366 fails it closed rather than leaking.
    const { bootstrapToken } = await attachProxyContext({
      proxyTokenStore: store,
      urlKey: 'acme',
      baseUrl: 'https://harbour.example',
      prompt: 'DISPATCHED PROMPT',
      harness: 'claude-code',
      createdBy: null
    });
    const working = await store.exchangeBootstrapToken(bootstrapToken);
    const validated = await store.validateToken(working.token);
    assert.equal(validated.createdBy, null, 'no owner is fabricated when the dispatcher has none');
  });
});

// LIN-1429 — the actual CHAINED-dispatch scenario the ticket's Caution warns
// about: a follow-up mint that omits createdBy PASSES the mint and only dies
// later, at first use of the exchanged working token (WORKSPACE_NOT_CONNECTED
// under LIN-1366's null-owner guard). A createdBy assertion on a bare mint call
// cannot catch that failure mode — it has to be observed at the far end of a
// real mint -> exchange -> validate chain, through the ROUTE's own auth path
// (never a stubbed exchange), which is what this describe block drives.
//
// buildApp/call mirrors the scaffolding in proxy-dispatch-bootstrap-token.test.js
// (this file's own tests above call attachProxyContext directly and have no
// need for it) — the repo's characterized duplication for this pattern, per
// the note at proxy-kickoff-presets.test.js:9.
function buildApp(proxyTokenStore, captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    // {} -> no dispatchDefaults.harness -> LIN-1159's applyDefaultDispatchHarness
    // interposes claude-code, exactly like the beat-3 route-level tests.
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body, bearerToken) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: `Bearer ${bearerToken}` } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-1429 — the real mint -> exchange -> validate chain across a chained dispatch', () => {
  let store;
  beforeEach(() => {
    store = new ProxyTokenStore({ collection: createMockCollection() });
  });

  test('a claude-code follow-up mints its OWN bootstrap whose createdBy survives a second exchange + validate', async () => {
    // 1. Seed the dispatching agent's own credential for real: mint + exchange,
    //    exactly as a genuine dispatch handoff would.
    const seedBootstrap = await store.createToken('acme', {
      label: 'seed', scope: 'readWrite', kind: 'bootstrap', createdBy: 'account-A'
    });
    const seedWorking = await store.exchangeBootstrapToken(seedBootstrap.token);
    assert.ok(seedWorking?.token, 'the seed bootstrap exchanges for a working token');

    // 2. POST /api/proxy/dispatch authenticated with THAT working token, so
    //    authenticateProxyToken validates for real (not a fixture) and sets
    //    req.proxyCreatedBy from the live chain.
    const captured = {};
    const app = buildApp(store, captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      followUpTo: '11111111-2222-3333-4444-555555555555'
      // No `harness` and no `appendProxyContext`: resolves to claude-code
      // (LIN-1159), and provisioning (not append) runs — cell #7, the fix.
    }, seedWorking.token);

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item?.bootstrapToken,
      'the follow-up dispatch minted its OWN new bootstrap (LIN-1429) — distinct from the seed token used to authenticate');

    // 3. Exchange the FOLLOW-UP's bootstrap (not the seed) into its own working
    //    token, validate it, and assert the dispatching owner survived BOTH
    //    hops of this second, independent chain.
    const followUpWorking = await store.exchangeBootstrapToken(captured.item.bootstrapToken);
    assert.ok(followUpWorking?.token, 'the follow-up bootstrap exchanges for a working token');

    const validated = await store.validateToken(followUpWorking.token);
    assert.ok(validated, 'the follow-up working token validates');
    assert.equal(
      validated.createdBy,
      'account-A',
      'the dispatching owner must survive mint -> exchange -> validate for the CHAINED follow-up credential — ' +
      'a follow-up mint that omits createdBy would pass the mint and only fail later, at first real use ' +
      '(WORKSPACE_NOT_CONNECTED under LIN-1366), exactly the failure mode the ticket\'s Caution describes'
    );
  });
});
