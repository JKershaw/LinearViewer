/**
 * LIN-417 — structured error envelope for proxy workspace-resolution failures.
 *
 * Two layers are pinned here:
 *
 *  1. The pure reason→envelope mapping in lib/errors.js
 *     (`workspaceUnavailableEnvelope`): each `reason` produces a stable
 *     code/category/retryable, and `context` carries ONLY the public workspace
 *     slug — never tokens/secrets/content (the kpi-stats privacy discipline).
 *
 *  2. The dual-shape threading in routes/proxy.js: the recovered `reason` must
 *     reach the envelope through BOTH proxy call shapes — the `getClient` path
 *     (Shape A, e.g. the write endpoint POST /issues) and the raw-token path
 *     (Shape B, e.g. /stack). Since LIN-308 re-pointed the read endpoints onto
 *     the raw-token provider path, the write/compute endpoints are the remaining
 *     getClient consumers, so Shape A drives one of those. A forced-reason stub
 *     of `resolveWorkspaceAccess` drives each shape and the test asserts the 503
 *     body is the structured envelope. The HTTP status stays 503 in every case;
 *     only the body gains structure.
 *
 * The e2e suite can't cover this: in test mode `resolveWorkspaceAccess`
 * short-circuits `test-workspace`→`test-token` (reason `ok`), so the null /
 * failure path never runs end-to-end.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { workspaceUnavailableEnvelope } from '../../lib/errors.js';

// ---------------------------------------------------------------------------
// 1. Pure envelope mapping (lib/errors.js)
// ---------------------------------------------------------------------------

test('workspaceUnavailableEnvelope: store_unreachable → upstream / retryable', () => {
  const env = workspaceUnavailableEnvelope('store_unreachable', 'acme');
  assert.equal(env.error, 'Workspace not available');
  assert.equal(env.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.equal(env.category, 'upstream');
  assert.equal(env.retryable, true);
  assert.match(env.detail, /deploy|booting|unreachable/i);
  assert.deepEqual(env.context, { workspaceUrlKey: 'acme' });
});

test('workspaceUnavailableEnvelope: session_expired → auth / not retryable', () => {
  const env = workspaceUnavailableEnvelope('session_expired', 'acme');
  assert.equal(env.code, 'WORKSPACE_SESSION_EXPIRED');
  assert.equal(env.category, 'auth');
  assert.equal(env.retryable, false);
});

test('workspaceUnavailableEnvelope: not_connected → config / not retryable', () => {
  const env = workspaceUnavailableEnvelope('not_connected', 'acme');
  assert.equal(env.code, 'WORKSPACE_NOT_CONNECTED');
  assert.equal(env.category, 'config');
  assert.equal(env.retryable, false);
});

test('envelope context carries only the public workspace slug (privacy boundary)', () => {
  const env = workspaceUnavailableEnvelope('store_unreachable', 'acme');
  assert.deepEqual(Object.keys(env.context), ['workspaceUrlKey']);
  // No token/secret/content leakage anywhere in the serialized body.
  const blob = JSON.stringify(env);
  assert.ok(!/token|secret|accessToken|apiKey|bearer/i.test(blob), `leaked sensitive field: ${blob}`);
});

test('unknown reason falls back to a safe, non-retryable internal envelope', () => {
  const env = workspaceUnavailableEnvelope('ok', 'acme');
  assert.equal(env.code, 'WORKSPACE_UNAVAILABLE');
  assert.equal(env.category, 'internal');
  assert.equal(env.retryable, false);
  assert.deepEqual(env.context, { workspaceUrlKey: 'acme' });
});

// ---------------------------------------------------------------------------
// 2. Dual-shape threading through the live proxy routes (forced reason)
// ---------------------------------------------------------------------------

function buildApp(reason) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    // Auth: any bearer token validates and pins urlKey 'acme'.
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    // The seam under test: force a chosen failure reason (null token).
    resolveWorkspaceAccess: async () => ({ token: null, reason }),
    getWorkspaceAccessToken: async () => null,
    // Unused on the failure path, but required by the factory signature.
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    // Free-tier metering: a no-op stub; the failure paths under test never charge.
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function requestJson(app, path, { method = 'GET', body } = {}) {
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

const getJson = (app, path) => requestJson(app, path);

test('Shape A (write endpoint POST /issues, via getClient): 503 with structured envelope', async () => {
  // POST /issues calls getClient() before any body validation, so the forced
  // null token short-circuits to the envelope (the readWrite stub satisfies the
  // write-scope guard). This is the remaining getClient call shape post-LIN-308.
  const { status, body } = await requestJson(buildApp('store_unreachable'), '/api/proxy/issues', {
    method: 'POST',
    body: { teamId: '00000000-0000-0000-0000-000000000000', title: 'x' }
  });
  assert.equal(status, 503);
  assert.equal(body.error, 'Workspace not available');
  assert.equal(body.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.equal(body.category, 'upstream');
  assert.equal(body.retryable, true);
  assert.equal(body.context.workspaceUrlKey, 'acme');
});

test('Shape B (/stack, raw token): 503 with structured envelope', async () => {
  const { status, body } = await getJson(buildApp('session_expired'), '/api/proxy/stack');
  assert.equal(status, 503);
  assert.equal(body.error, 'Workspace not available');
  assert.equal(body.code, 'WORKSPACE_SESSION_EXPIRED');
  assert.equal(body.category, 'auth');
  assert.equal(body.retryable, false);
  assert.equal(body.context.workspaceUrlKey, 'acme');
});

test('Shape B (/stack) threads not_connected through to config envelope', async () => {
  const { status, body } = await getJson(buildApp('not_connected'), '/api/proxy/stack');
  assert.equal(status, 503);
  assert.equal(body.code, 'WORKSPACE_NOT_CONNECTED');
  assert.equal(body.category, 'config');
  assert.equal(body.retryable, false);
});
