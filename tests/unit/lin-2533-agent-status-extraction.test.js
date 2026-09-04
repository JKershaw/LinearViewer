/**
 * LIN-2533 (LIN-679 Stage 1) — group G agent-status extraction.
 *
 * Two things this file pins that nothing else does:
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

function buildApp({ scope = 'readWrite' } = {}) {
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
    agentStatusStore: {},
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
