/**
 * LIN-677 — proxy write endpoints check workspace-availability BEFORE the
 * capability gate.
 *
 * Surfaced by the API Quality Review (LIN-665, finding H2): the write handlers
 * called denyIfUnsupported(provider, ...) before the `if (!token) return
 * workspaceUnavailable(...)` check. For an UNAVAILABLE workspace bound to a
 * provider that does not support the op, the caller got a misleading
 * 422 CAPABILITY_NOT_SUPPORTED (non-retryable → escalate) instead of the true
 * 503 WORKSPACE_* envelope (retryable → back off and retry). That is the wrong
 * wait-vs-escalate signal for an automated operator.
 *
 * These tests drive the real LIN-581 per-workspace selection path: a GitHub-
 * backed workspace (which declines createRelation/deleteRelation) that is also
 * unavailable (null token, a retryable `store_unreachable` reason) must now
 * return the 503 workspace envelope, NOT the 422 capability decline. The
 * companion cases pin the two orderings that must NOT change: an AVAILABLE
 * GitHub workspace still 422s on an unsupported op (capability wins when the
 * workspace is reachable), and a supported op on an unavailable workspace was
 * already — and stays — 503.
 *
 * Inert under today's Linear-only deploy (Linear supports every write), but
 * latent for any other provider; this is a correctness fix, not a behaviour
 * change for the current deployment.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
// Imported for its self-registration side effect (registers 'github' so the
// registry can resolve a workspace whose provider name is 'github').
import { githubProvider } from '../../lib/providers/github/index.js';

const UUID = '11111111-1111-1111-1111-111111111111';
const REL = '33333333-3333-3333-3333-333333333333';
const COMMENT = '44444444-4444-4444-4444-444444444444';

// `providerName` is what resolveWorkspaceAccess reports for the workspace; the
// proxy resolves the active provider from it through the registry (the real
// LIN-581 selection path). `token: null` + a `reason` models an UNAVAILABLE
// workspace so the `!token` guard fires; `store_unreachable` maps to a
// retryable upstream envelope.
function buildApp(providerName, { token = 'ws-token', reason = 'ok' } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token, reason, provider: providerName }),
    getWorkspaceAccessToken: async () => token,
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

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0, '127.0.0.1');
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

test('unavailable GitHub workspace + unsupported createRelation → 503 workspace envelope, not 422 capability', async () => {
  // The regression case: BOTH gates would fire. Workspace-availability must win,
  // yielding the retryable 503 so an automated operator backs off and retries
  // rather than escalating on a misleading non-retryable 422.
  const { status, body } = await request(
    buildApp('github', { token: null, reason: 'store_unreachable' }),
    `/api/proxy/issues/${UUID}/relations`,
    { method: 'POST', body: { type: 'blocks', relatedIssueId: '22222222-2222-2222-2222-222222222222' } }
  );
  assert.equal(status, 503);
  assert.equal(body.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.equal(body.retryable, true);
  assert.notEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
});

test('unavailable GitHub workspace + unsupported deleteRelation → 503 workspace envelope, not 422 capability', async () => {
  const { status, body } = await request(
    buildApp('github', { token: null, reason: 'store_unreachable' }),
    `/api/proxy/issues/${UUID}/relations/${REL}`,
    { method: 'DELETE' }
  );
  assert.equal(status, 503);
  assert.equal(body.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.equal(body.retryable, true);
  assert.notEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
});

test('unavailable GitHub workspace + unsupported deleteComment → 503 workspace envelope, not 422 capability (LIN-1160)', async () => {
  const { status, body } = await request(
    buildApp('github', { token: null, reason: 'store_unreachable' }),
    `/api/proxy/issues/${UUID}/comments/${COMMENT}`,
    { method: 'DELETE' }
  );
  assert.equal(status, 503);
  assert.equal(body.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.equal(body.retryable, true);
  assert.notEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
});

test('unavailable GitHub workspace + unsupported updateComment → 503 workspace envelope, not 422 capability (LIN-1160)', async () => {
  const { status, body } = await request(
    buildApp('github', { token: null, reason: 'store_unreachable' }),
    `/api/proxy/issues/${UUID}/comments/${COMMENT}`,
    { method: 'PATCH', body: { body: 'corrected' } }
  );
  assert.equal(status, 503);
  assert.equal(body.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.equal(body.retryable, true);
  assert.notEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
});

test('AVAILABLE GitHub workspace + unsupported createRelation still 422 (capability wins when reachable)', async () => {
  // The other ordering that must NOT change: when the workspace IS available,
  // the capability gate is the correct, informative response.
  const { status, body } = await request(
    buildApp('github'),
    `/api/proxy/issues/${UUID}/relations`,
    { method: 'POST', body: { type: 'blocks', relatedIssueId: '22222222-2222-2222-2222-222222222222' } }
  );
  assert.equal(status, 422);
  assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
  assert.equal(body.capability, 'createRelation');
});

// The ninth, out-of-original-list handler discovered at HEAD (the LIN-891
// attachments upload POST). It had BOTH its capability gates — uploadFile and
// the target-derived write capability — ahead of the `!token` guard; the fix
// moved availability first. GitHub declines `uploadFile`, so an unavailable
// GitHub workspace exercises exactly the same regression (both gates would
// fire) as the relation handlers above. This is the ledger item that was
// coverage-only-by-inspection at review time (LIN-677 close-out).

test('unavailable GitHub workspace + attachments upload (unsupported uploadFile) → 503 workspace envelope, not 422 capability', async () => {
  const { status, body } = await request(
    buildApp('github', { token: null, reason: 'store_unreachable' }),
    `/api/proxy/issues/${UUID}/attachments`,
    { method: 'POST', body: { image: 'data:image/png;base64,iVBORw0KGgo=' } }
  );
  assert.equal(status, 503);
  assert.equal(body.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.equal(body.retryable, true);
  assert.notEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
});

test('AVAILABLE GitHub workspace + attachments upload still 422 on the uploadFile gate (capability wins when reachable)', async () => {
  // Control: reachable workspace, so the uploadFile capability gate — the FIRST
  // of the endpoint's two gates, and the one that now sits after availability —
  // is the correct informative decline.
  const { status, body } = await request(
    buildApp('github'),
    `/api/proxy/issues/${UUID}/attachments`,
    { method: 'POST', body: { image: 'data:image/png;base64,iVBORw0KGgo=' } }
  );
  assert.equal(status, 422);
  assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
  assert.equal(body.capability, 'uploadFile');
});
