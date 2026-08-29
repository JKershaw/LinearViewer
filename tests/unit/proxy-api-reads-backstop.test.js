/**
 * LIN-2350 — the consumer-API-reads backstop: `GET /api/proxy/me` and
 * `GET /api/proxy/issues/:id` decline 422 `CAPABILITY_NOT_SUPPORTED` on a
 * provider that cannot serve `viewer`/`issueDetail`, instead of throwing a raw
 * `provider.viewer is not a function` `TypeError` that surfaces as a 500
 * naming the wrong backend (`"Linear API request failed"` on every provider).
 *
 * Unlike `tests/unit/proxy-route-internal-read-backstop.test.js` (LIN-1559),
 * whose four reads are deliberately kept OFF `PROVIDER_SURFACE` and gated on
 * plain method existence, `viewer`/`projects`/`issues`/`issueDetail` are now
 * declared on the surface (LIN-2350's `apiReads` group) precisely so these two
 * ROUTES can gate on `denyIfUnsupported`/`supports()` — the documented "never
 * 500" capability path. Modeled on that file's real-handler / stub-provider
 * pattern.
 *
 * Run with: node --test tests/unit/proxy-api-reads-backstop.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { registerProvider } from '../../lib/providers/registry.js';

const PROVIDER_NAME = 'apireads-stub';
const ISSUE_ID = 'LIN-900';

/**
 * A provider that cannot serve `viewer`/`issueDetail` — `supports()` reports
 * false for both, and the methods themselves are absent (mirroring a real
 * unimplemented provider, which would inherit `ProviderInterface`'s throwing
 * stub rather than ever be called).
 */
function makeIncapableProvider() {
  return {
    name: PROVIDER_NAME,
    supports: () => false,
  };
}

/** A provider that implements the reads — the control. */
function makeCapableProvider() {
  return {
    name: PROVIDER_NAME,
    supports: (cap) => ['viewer', 'issueDetail'].includes(cap),
    async viewer() { return { id: 'u-1', name: 'Someone', email: 'someone@example.test' }; },
    async issueDetail(_token, issueId) { return { id: 'iss-1', identifier: issueId, title: 'x' }; },
  };
}

function buildApp(provider) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok', provider: PROVIDER_NAME }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function call(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: 'Bearer anything' },
    });
    let parsed = {};
    try { parsed = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(r => server.close(r));
  }
}

/** Assert the shared decline envelope, naming the missing read as the capability. */
function assertDeclined({ status, body }, capability) {
  assert.equal(status, 422, `expected 422, got ${status} (${JSON.stringify(body)})`);
  assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
  assert.equal(body.capability, capability);
  assert.equal(body.provider, PROVIDER_NAME);
}

describe('an incapable provider declines the two owned consumer-API reads', () => {
  test('GET /api/proxy/me declines 422 naming viewer', async () => {
    const app = buildApp(makeIncapableProvider());
    assertDeclined(await call(app, '/api/proxy/me'), 'viewer');
  });

  test('GET /api/proxy/issues/:id declines 422 naming issueDetail', async () => {
    const app = buildApp(makeIncapableProvider());
    assertDeclined(await call(app, `/api/proxy/issues/${ISSUE_ID}`), 'issueDetail');
  });
});

describe('the gate is a no-op for a provider that implements the reads', () => {
  test('GET /api/proxy/me succeeds (control)', async () => {
    const app = buildApp(makeCapableProvider());
    const res = await call(app, '/api/proxy/me');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.notEqual(res.body.code, 'CAPABILITY_NOT_SUPPORTED');
  });

  test('GET /api/proxy/issues/:id succeeds (control)', async () => {
    const app = buildApp(makeCapableProvider());
    const res = await call(app, `/api/proxy/issues/${ISSUE_ID}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.notEqual(res.body.code, 'CAPABILITY_NOT_SUPPORTED');
  });
});
