/**
 * LIN-309 — capability-gated consumer-API writes.
 *
 * The proxy write endpoints route through `provider.*` and consult the active
 * provider's capability descriptor BEFORE the write. A provider that does not
 * implement a given write must decline with a clean 4xx (422 + a machine-
 * readable `CAPABILITY_NOT_SUPPORTED` code) instead of letting the provider's
 * NotImplementedError bubble up to an opaque 500. `provider.supports(...)` is
 * the "never 500" path the provider interface documents.
 *
 * The proxy speaks to Linear in production (every write supported, so the gate
 * is always a pass — byte-identical behaviour). The gate is the forward-looking
 * seam for LIN-306's broader provider unification. To exercise the decline path
 * we inject the real GitHub provider, which implements createIssue/updateIssue/
 * createComment/addLabel/removeLabel but declines createRelation/deleteRelation.
 *
 * The e2e suite can't cover this: in test mode the proxy always uses the Linear
 * default, which supports the full write surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { linearProvider } from '../../lib/providers/linear/index.js';
import { githubProvider } from '../../lib/providers/github/index.js';

const UUID = '11111111-1111-1111-1111-111111111111';

// A workspace whose token always resolves, so the request reaches the write
// body rather than short-circuiting on workspace access. The capability gate
// runs first, so for a declined write the token is never consulted — but a
// SUPPORTED write must fall through past the gate, and we assert it does by
// observing it does NOT 422.
function buildApp(provider, { token = 'ws-token' } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token, reason: token ? 'ok' : 'not_connected' }),
    getWorkspaceAccessToken: async () => token,
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return app;
}

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer anything',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('unsupported write (createRelation on the GitHub provider) → clean 422, not 500', async () => {
  const { status, body } = await request(buildApp(githubProvider), `/api/proxy/issues/${UUID}/relations`, {
    method: 'POST',
    body: { type: 'blocks', relatedIssueId: '22222222-2222-2222-2222-222222222222' },
  });
  assert.equal(status, 422);
  assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
  assert.equal(body.capability, 'createRelation');
  assert.equal(body.provider, 'github');
});

test('unsupported deleteRelation → clean 422', async () => {
  const relId = '33333333-3333-3333-3333-333333333333';
  const { status, body } = await request(buildApp(githubProvider), `/api/proxy/issues/${UUID}/relations/${relId}`, {
    method: 'DELETE',
  });
  assert.equal(status, 422);
  assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
  assert.equal(body.capability, 'deleteRelation');
});

test('a SUPPORTED write is not blocked by the gate (createIssue falls through)', async () => {
  // GitHub implements createIssue, so the gate passes. With a null workspace
  // token the request then short-circuits to the 503 workspace envelope — the
  // point is only that it is NOT the 422 capability decline, proving the gate
  // is selective rather than blanket.
  const { status, body } = await request(buildApp(githubProvider, { token: null }), '/api/proxy/issues', {
    method: 'POST',
    body: { teamId: '00000000-0000-0000-0000-000000000000', title: 'x' },
  });
  assert.notEqual(status, 422);
  assert.notEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
  assert.equal(status, 503);
});

test('the default provider (Linear) supports the full write surface — gate is a pass', () => {
  for (const m of ['createIssue', 'updateIssue', 'createComment', 'createRelation', 'deleteRelation', 'addLabel', 'removeLabel']) {
    assert.equal(linearProvider.supports(m), true, `Linear must support ${m}`);
  }
});
