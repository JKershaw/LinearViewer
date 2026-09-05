/**
 * LIN-1985 — a worker holding only a proxy token could not tell, from the
 * 401 RESPONSE BODY ITSELF, whether:
 *   - its OWN bearer/bootstrap token was rejected by Harbour (never a
 *     workspace/provider fault — remedy: mint or re-issue a proxy token), or
 *   - Harbour resolved a workspace credential and Linear rejected IT (a
 *     dead/expired stored credential — remedy: escalate to a human /
 *     reconnect the workspace, never re-issue the agent's own token).
 *
 * `stage` (the same 'proxy-token' | 'provider-lane' vocabulary LIN-2076
 * already persists on the audit row and logs to `[credential-rejected]`,
 * both invisible to the calling agent) now rides on the response body for
 * BOTH classes of 401, alongside a `code`/`category`/`retryable` triple —
 * the same structured-error-envelope shape LIN-417/LIN-2216 already
 * established for the 503 family. Before this, a caller-token rejection
 * carried a bare `{"error": "..."}` with NO code/category/stage at all,
 * while a provider-lane 401 already carried `code`/`category` (from
 * `classifyUpstreamError`) but no explicit `stage`.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

function linearAuthError() {
  const err = new Error('You need to authenticate to access this operation.');
  err.response = {
    status: 401,
    errors: [{ message: 'You need to authenticate to access this operation.', extensions: { statusCode: 401, userError: true } }],
  };
  return err;
}

function buildApp({ resolveWorkspaceAccess, issueDetail, validateToken, describeRejectionCause, proxyEventStore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: validateToken ?? (async () => ({ tokenId: 'tok-1', urlKey: 'acme', label: 'autopilot', scope: 'readWrite', createdBy: 'acct-owner' })),
      exchangeBootstrapToken: async () => null,
      // LIN-1938 S2/S3: the default mirrors these tests' existing bogus/missing
      // bearers — a token nothing recognizes has no descriptor to return.
      describeRejectionCause: describeRejectionCause ?? (async () => null),
    },
    proxyEventStore: proxyEventStore ?? { recordEvent: async () => {} },
    resolveWorkspaceAccess: resolveWorkspaceAccess ?? (async () => ({
      token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
      expiresAt: Date.now() + 3600_000, credentialFingerprint: fingerprintCredential('linear-tok'),
    })),
    getWorkspaceAccessToken: async () => 'linear-tok',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: { name: 'linear', supports: () => true, issueDetail: issueDetail ?? (async () => { throw linearAuthError(); }) },
  }));
  return app;
}

const ISSUE_UUID = '266f0841-ef9a-40de-a7b4-e18890efbf05';

async function request(app, path, { bearer, method = 'GET' } = {}) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const headers = {};
    if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('proxy-token-stage 401s now carry code/category/stage (LIN-1985, Block A)', () => {
  test('a rejected caller bearer token (bad/expired/consumed) — never a workspace fault', async () => {
    const app = buildApp({ validateToken: async () => null });
    const { status, body } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`, { bearer: 'not-a-real-token' });
    assert.equal(status, 401);
    assert.equal(body.code, 'PROXY_TOKEN_INVALID');
    assert.equal(body.category, 'auth');
    assert.equal(body.retryable, false);
    assert.equal(body.stage, 'proxy-token', 'the remedy is re-issue the caller\'s own token, never reconnect the workspace');
    // LIN-1938 regression: an unrecognized bearer (describeRejectionCause's
    // default null) carries neither new field — there is no recognized token
    // to describe.
    assert.equal('proxyTokenState' in body, false);
    assert.equal('proxyTokenExpiredAt' in body, false);
  });

  test('a missing Authorization header carries the same shape', async () => {
    const app = buildApp();
    const { status, body } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`); // no bearer at all
    assert.equal(status, 401);
    assert.equal(body.code, 'PROXY_TOKEN_INVALID');
    assert.equal(body.stage, 'proxy-token');
  });

  test('an empty bearer token carries the same shape', async () => {
    const app = buildApp();
    const { status, body } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`, { bearer: '' });
    assert.equal(status, 401);
    assert.equal(body.code, 'PROXY_TOKEN_INVALID');
    assert.equal(body.stage, 'proxy-token');
  });

  test('an invalid/expired/already-exchanged bootstrap token (POST /api/proxy/token) carries the same shape — same non-workspace-fault class', async () => {
    const app = buildApp();
    const { status, body } = await request(app, '/api/proxy/token', { method: 'POST', bearer: 'bogus-bootstrap' });
    assert.equal(status, 401);
    assert.equal(body.code, 'PROXY_TOKEN_INVALID');
    assert.equal(body.stage, 'proxy-token');
  });
});

describe('provider-lane 401s now carry an explicit stage (LIN-1985, Block B)', () => {
  test('a credential our OWN records already believe is dead, rejected by Linear, stays a terminal 401 with stage:provider-lane', async () => {
    const app = buildApp({
      resolveWorkspaceAccess: async () => ({
        token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
        expiresAt: Date.now() - 1000, credentialFingerprint: fingerprintCredential('linear-tok'),
      }),
    });
    const { status, body } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`, { bearer: 'agent-token' });
    assert.equal(status, 401);
    assert.equal(body.code, 'LINEAR_AUTH', 'the pre-existing LIN-2216 code — unchanged by this ticket');
    assert.equal(body.stage, 'provider-lane', 'the remedy is escalate/reconnect the workspace, never re-issue the caller\'s own token');
  });
});

describe('LIN-1938 S3: the 401 self-describes a recognized-expired token, and audits it', () => {
  test('a recognized-expired token carries proxyTokenState + proxyTokenExpiredAt, distinct from provider-credential fields', async () => {
    const app = buildApp({
      validateToken: async () => null,
      describeRejectionCause: async () => ({ state: 'expired', expiresAt: '2026-08-30T06:09:00.000Z', urlKey: 'acme' }),
    });
    const { status, body } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`, { bearer: 'expired-working-token' });

    assert.equal(status, 401);
    assert.equal(body.code, 'PROXY_TOKEN_INVALID');
    assert.equal(body.stage, 'proxy-token');
    assert.equal(body.retryable, false, 'LIN-1938 must not weaken PROXY_TOKEN_INVALID.retryable');
    assert.equal(body.proxyTokenState, 'expired');
    assert.equal(body.proxyTokenExpiredAt, '2026-08-30T06:09:00.000Z');
    // Distinct names from lib/credential-diagnostics.js's provider-credential fields.
    assert.equal('expiryKind' in body, false);
    assert.equal('msUntilExpiry' in body, false);
  });

  test('a recognized-but-not-expired rejection (bootstrap_only/consumed) carries proxyTokenState but NOT proxyTokenExpiredAt', async () => {
    const app = buildApp({
      validateToken: async () => null,
      describeRejectionCause: async () => ({ state: 'consumed', expiresAt: null, urlKey: 'acme' }),
    });
    const { body } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`, { bearer: 'consumed-token' });

    assert.equal(body.proxyTokenState, 'consumed');
    assert.equal('proxyTokenExpiredAt' in body, false);
  });

  test('writes an audit row for the recognized-expired case: tokenId null, stage proxy-token, status 401, note the state', async () => {
    const recorded = [];
    const app = buildApp({
      validateToken: async () => null,
      describeRejectionCause: async () => ({ state: 'expired', expiresAt: '2026-08-30T06:09:00.000Z', urlKey: 'acme' }),
      proxyEventStore: { recordEvent: async (event) => { recorded.push(event); } },
    });
    await request(app, `/api/proxy/issues/${ISSUE_UUID}`, { bearer: 'expired-working-token' });

    assert.equal(recorded.length, 1, 'exactly one audit row for the recognized-expired 401');
    assert.equal(recorded[0].urlKey, 'acme');
    assert.equal(recorded[0].tokenId, null);
    assert.equal(recorded[0].tokenLabel, null);
    assert.equal(recorded[0].status, 401);
    assert.equal(recorded[0].stage, 'proxy-token');
    assert.equal(recorded[0].note, 'expired');
  });

  test('writes NO audit row for a wholly unrecognized bearer — there is no urlKey to attribute it to', async () => {
    const recorded = [];
    const app = buildApp({
      validateToken: async () => null,
      describeRejectionCause: async () => null,
      proxyEventStore: { recordEvent: async (event) => { recorded.push(event); } },
    });
    await request(app, `/api/proxy/issues/${ISSUE_UUID}`, { bearer: 'garbage-never-issued' });

    assert.equal(recorded.length, 0);
  });
});

describe('the two classes are genuinely distinguishable for the identical 401 status code (LIN-1985, Block C)', () => {
  test('a caller-token rejection and a provider-lane rejection never share a stage value', async () => {
    const proxyTokenApp = buildApp({ validateToken: async () => null });
    const { body: proxyTokenBody } = await request(proxyTokenApp, `/api/proxy/issues/${ISSUE_UUID}`, { bearer: 'bad' });

    const providerLaneApp = buildApp({
      resolveWorkspaceAccess: async () => ({
        token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
        expiresAt: Date.now() - 1000, credentialFingerprint: fingerprintCredential('linear-tok'),
      }),
    });
    const { body: providerLaneBody } = await request(providerLaneApp, `/api/proxy/issues/${ISSUE_UUID}`, { bearer: 'agent-token' });

    assert.notEqual(proxyTokenBody.stage, providerLaneBody.stage);
    assert.deepEqual([proxyTokenBody.stage, providerLaneBody.stage].sort(), ['provider-lane', 'proxy-token']);
  });
});
