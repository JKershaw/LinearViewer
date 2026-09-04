/**
 * LIN-2533 (LIN-679 Stage 1) — group G agent-status extraction.
 *
 * Three things this file pins that nothing else does:
 *
 * 1. Source-text census (LIN-2245 template): a positive pin that the moved
 *    registrations + store call sites live in routes/proxy-agent-status.js,
 *    paired with a complementary zero-count pin that routes/proxy.js no
 *    longer carries them. Group G had ZERO pre-existing source-text pins
 *    (verified independently three ways during LIN-2533 beat 1 and
 *    re-verified against this post-move tree in beat 3), so there is
 *    nothing to re-point — these are new pins, landed so a future stage
 *    can't silently reintroduce agent-status wiring into routes/proxy.js
 *    without a loud failure here.
 *
 * 2. An HTTP-level witness for `requireWriteScope` on the POST arm and its
 *    ABSENCE on the GET arm. tests/unit/proxy-route-aliases.test.js already
 *    exercises both moved routes and both deprecated /api/proxy/foreman/status
 *    aliases over real HTTP (identical-payloads probes, pre-existing,
 *    unaffected by the move — same createProxyRoutes surface); what had no
 *    witness anywhere is the scope gate itself: that an unscoped (read) token
 *    is rejected 403 on POST, and that the GET arm is reachable with the SAME
 *    read-scoped token (i.e. requireWriteScope is not in its middleware chain).
 *
 * 3. A DI witness that `agentStatusStore` actually reaches the sub-router
 *    (LIN-2533 close-out, review ledger item 1 — "What CI Did Not Prove").
 *    Every other test in this file, and every pre-existing test that touches
 *    these routes, stops at a 4xx BEFORE the store is dereferenced, so
 *    deleting `agentStatusStore` from the router.use(...) mount in
 *    routes/proxy.js left the whole suite green while both arms 500'd at
 *    runtime. These two happy-path probes run through createProxyRoutes (the
 *    real composer + mount, not the factory directly) against a stub store,
 *    so the injection is what they are actually pinning. Response contracts
 *    below are OBSERVED from the implementation, not assumed.
 */

process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const proxySource = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');
const agentStatusSource = readFileSync(join(__dirname, '../../routes/proxy-agent-status.js'), 'utf8');

function occurrenceCount(source, needle) {
  return source.split(needle).length - 1;
}

describe('LIN-2533: agent-status registrations + store calls moved out of routes/proxy.js', () => {
  const ALIAS_PAIR = "['/api/proxy/agent/status', '/api/proxy/foreman/status']";

  test('routes/proxy-agent-status.js carries both array-path registrations', () => {
    assert.equal(occurrenceCount(agentStatusSource, ALIAS_PAIR), 2,
      'expected exactly 2 registrations (POST + GET) carrying the canonical/deprecated-alias pair');
  });
  test('routes/proxy.js carries zero array-path registrations (moved out)', () => {
    assert.equal(occurrenceCount(proxySource, ALIAS_PAIR), 0,
      'a copy was left behind, or reintroduced, in routes/proxy.js');
  });

  test('routes/proxy-agent-status.js calls agentStatusStore.recordStatus( exactly once', () => {
    assert.equal(occurrenceCount(agentStatusSource, 'agentStatusStore.recordStatus('), 1);
  });
  test('routes/proxy.js calls agentStatusStore.recordStatus( zero times (moved out)', () => {
    assert.equal(occurrenceCount(proxySource, 'agentStatusStore.recordStatus('), 0);
  });

  test('routes/proxy-agent-status.js calls agentStatusStore.listStatus( exactly once', () => {
    assert.equal(occurrenceCount(agentStatusSource, 'agentStatusStore.listStatus('), 1);
  });
  test('routes/proxy.js calls agentStatusStore.listStatus( zero times (moved out)', () => {
    assert.equal(occurrenceCount(proxySource, 'agentStatusStore.listStatus('), 0);
  });
});

function buildApp({ scope = 'readWrite', agentStatusStore = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope, createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore,
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
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

describe('LIN-2533: requireWriteScope over real HTTP (no witness anywhere before this ticket)', () => {
  for (const path of ['/api/proxy/agent/status', '/api/proxy/foreman/status']) {
    test(`POST ${path} — a read-scoped token is rejected 403`, async () => {
      const app = buildApp({ scope: 'read' });
      const { status } = await call(app, 'post', path, { taskIdentifier: 't', action: 'a', status: 's', summary: 'x' });
      assert.equal(status, 403);
    });

    test(`POST ${path} — a readWrite-scoped token is NOT rejected 403 (not vacuous)`, async () => {
      const app = buildApp({ scope: 'readWrite' });
      const { status } = await call(app, 'post', path, {});
      // Empty body still 400s on taskIdentifier before reaching the store — the
      // point here is only that requireWriteScope itself did not block it.
      assert.notEqual(status, 403);
      assert.equal(status, 400);
    });

    test(`GET ${path} — a read-scoped token reaches the handler (requireWriteScope not in this chain)`, async () => {
      const app = buildApp({ scope: 'read' });
      // Deterministic pre-network 400 (over-long tokenId), same probe design as
      // tests/unit/proxy-route-aliases.test.js — a 403 here would mean
      // requireWriteScope leaked onto the GET arm; a 400 proves the request
      // reached the handler's own validation instead.
      const { status } = await call(app, 'get', `${path}?tokenId=${'x'.repeat(1001)}`);
      assert.equal(status, 400);
    });
  }
});

describe('LIN-2533 close-out: agentStatusStore is injected into the mounted sub-router (ledger item 1)', () => {
  function stubStore() {
    const calls = { recordStatus: [], listStatus: [] };
    return {
      calls,
      recordStatus: async (entry) => { calls.recordStatus.push(entry); return { id: 'st1' }; },
      listStatus: async (urlKey, opts) => { calls.listStatus.push([urlKey, opts]); return { entries: [{ id: 'e1' }], total: 1 }; }
    };
  }

  for (const path of ['/api/proxy/agent/status', '/api/proxy/foreman/status']) {
    test(`POST ${path} — reaches recordStatus and returns the observed 201 {success:true}`, async () => {
      const store = stubStore();
      const app = buildApp({ agentStatusStore: store });
      const { status, body } = await call(app, 'post', path, {
        taskIdentifier: 'LIN-2533', action: 'implement', status: 'working', summary: 'probe', dispatchId: 'd1'
      });

      // A 500 here is the exact failure a missing `agentStatusStore` in the
      // router.use(...) mount produces (TypeError → the handler's catch).
      assert.equal(status, 201);
      assert.deepEqual(body, { success: true });

      assert.equal(store.calls.recordStatus.length, 1, 'handler did not reach the injected store');
      assert.deepEqual(store.calls.recordStatus[0], {
        // urlKey/tokenId/tokenLabel come from the auth middleware, not the body —
        // pins the attribution fields the UI groups sessions by.
        urlKey: 'acme',
        taskIdentifier: 'LIN-2533',
        action: 'implement',
        status: 'working',
        summary: 'probe',
        tokenId: 't1',
        tokenLabel: 'test',
        dispatchId: 'd1'
      });
    });

    test(`GET ${path} — reaches listStatus and returns its result verbatim at 200`, async () => {
      const store = stubStore();
      const app = buildApp({ agentStatusStore: store });
      const { status, body } = await call(app, 'get', `${path}?limit=5&offset=2&tokenId=t1&taskIdentifier=LIN-2533`);

      assert.equal(status, 200);
      assert.deepEqual(body, { entries: [{ id: 'e1' }], total: 1 });

      assert.equal(store.calls.listStatus.length, 1, 'handler did not reach the injected store');
      assert.deepEqual(store.calls.listStatus[0], ['acme', { limit: 5, offset: 2, tokenId: 't1', taskIdentifier: 'LIN-2533' }]);
    });
  }
});
