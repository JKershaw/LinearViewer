/**
 * Route-level proof that a 401 on the proxy names the credential.
 * Write-up: docs/incidents/2026-08-09-proxy-401-flood.md
 *
 * The 2026-08-09 incident produced ~25 minutes of sustained
 * `Proxy /issue error: Authentication required, not authenticated` with no way
 * to tell WHICH credential was being rejected, where it came from, or whether
 * the failure was the caller's bearer token or the stored workspace credential.
 * These tests pin the log line that answers those questions.
 *
 * Asserted through the real router (not the pure module) because the value is
 * entirely in the wiring: the descriptor is recorded at the resolution
 * chokepoint and emitted at the status chokepoint, and neither is exercised by
 * a unit test of the formatter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const ISSUE_UUID = '266f0841-ef9a-40de-a7b4-e18890efbf05';

/** A graphql-request-shaped error, matching the exact envelope Linear returned. */
function linearAuthError() {
  const err = new Error('Authentication required, not authenticated');
  err.response = {
    status: 401,
    errors: [{
      message: 'Authentication required, not authenticated',
      extensions: { type: 'authentication error', code: 'AUTHENTICATION_ERROR', statusCode: 401, userError: true },
    }],
  };
  return err;
}

function buildApp({ resolveWorkspaceAccess, validateToken, issueDetail } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: validateToken ?? (async () => ({
        tokenId: 'tok-agent-1', urlKey: 'acme', label: 'autopilot', scope: 'readWrite', createdBy: 'acct-owner',
      })),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: resolveWorkspaceAccess ?? (async () => ({
      token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan', expiresAt: Date.now() + 3600_000,
    })),
    getWorkspaceAccessToken: async () => 'linear-tok',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: {
      name: 'linear',
      supports: () => true,
      issueDetail: issueDetail ?? (async () => { throw linearAuthError(); }),
    },
  }));
  return app;
}

/** Runs a request while capturing the `[credential-rejected]` lines it emits. */
async function requestCapturingWarnings(app, path) {
  const captured = [];
  const original = console.warn;
  console.warn = (...args) => {
    if (args[0] === '[credential-rejected]') captured.push(JSON.parse(args[1]));
  };
  const server = app.listen(0);
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { Authorization: 'Bearer agent-token' },
    });
    return { status: res.status, captured };
  } finally {
    console.warn = original;
    await new Promise(resolve => server.close(resolve));
  }
}

test('a provider-rejected credential is named: fingerprint, source, provider, expiry', async () => {
  const { status, captured } = await requestCapturingWarnings(buildApp(), `/api/proxy/issues/${ISSUE_UUID}`);

  assert.equal(status, 401);
  assert.equal(captured.length, 1, 'exactly one rejection line per failing request');

  const line = captured[0];
  assert.equal(line.stage, 'provider-lane', 'the stored credential was rejected upstream, not the caller token');
  assert.equal(line.endpoint, '/api/proxy/issues/:id');
  assert.equal(line.urlKey, 'acme');
  assert.equal(line.provider, 'linear');
  assert.equal(line.credentialSource, 'session-scan');
  assert.equal(line.credentialShape, 'bare-token');
  assert.equal(line.expiryKind, 'finite');
  assert.ok(line.msUntilExpiry > 0, 'server believed the credential was still live — the whole trap');
  assert.match(line.credentialFingerprint, /^[0-9a-f]{12}$/);

  // Attribution: which agent's token drove this.
  assert.equal(line.proxyTokenId, 'tok-agent-1');
  assert.equal(line.proxyTokenLabel, 'autopilot');
  assert.equal(line.ownerAccountId, 'acct-owner');
});

test('two callers resolving DIFFERENT credentials are distinguishable by fingerprint', async () => {
  // The incident's unanswerable question: one token 200s while another 401s on
  // the same workspace, endpoint, and issue id. Distinct fingerprints answer it.
  const seen = [];
  for (const token of ['credential-alpha', 'credential-beta']) {
    const { captured } = await requestCapturingWarnings(
      buildApp({ resolveWorkspaceAccess: async () => ({ token, reason: 'ok', provider: 'linear', source: 'cache', expiresAt: Date.now() + 1000 }) }),
      `/api/proxy/issues/${ISSUE_UUID}`,
    );
    seen.push(captured[0].credentialFingerprint);
  }
  assert.notEqual(seen[0], seen[1]);
});

test('the never-expires sentinel is surfaced — a credential that can never be displaced', async () => {
  const { captured } = await requestCapturingWarnings(
    buildApp({
      resolveWorkspaceAccess: async () => ({
        token: { email: 'a@b.c', apiToken: 'jira-secret', site: 'https://x.atlassian.net' },
        scope: { email: 'a@b.c', apiToken: 'jira-secret', site: 'https://x.atlassian.net' },
        reason: 'ok', provider: undefined, source: 'cache', expiresAt: Number.MAX_SAFE_INTEGER,
      }),
    }),
    `/api/proxy/issues/${ISSUE_UUID}`,
  );

  const line = captured[0];
  assert.equal(line.expiryKind, 'sentinel', 'wins selection permanently; never eligible for refresh');
  assert.equal(line.shapeMismatch, true, 'a Jira credential authenticating a Linear call');
  assert.equal(line.provider, '<unset:defaults-to-linear>');
});

test('a rejected CALLER token is a distinct stage, not confused with a dead workspace credential', async () => {
  // Same 401 status, completely different remedy: re-issue the agent's token
  // rather than repair the stored workspace credential. Previously identical
  // in the logs.
  const { status, captured } = await requestCapturingWarnings(
    buildApp({ validateToken: async () => null }),
    `/api/proxy/issues/${ISSUE_UUID}`,
  );

  assert.equal(status, 401);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].stage, 'proxy-token');
  assert.equal(captured[0].credentialFingerprint, undefined, 'no workspace credential was ever resolved');
});

test('a successful request emits no rejection line', async () => {
  const { status, captured } = await requestCapturingWarnings(
    buildApp({ issueDetail: async () => ({ id: ISSUE_UUID, identifier: 'LIN-1', title: 'ok', state: { name: 'Todo', type: 'unstarted' } }) }),
    `/api/proxy/issues/${ISSUE_UUID}`,
  );
  assert.equal(status, 200);
  assert.deepEqual(captured, []);
});

test('never logs credential bytes, in either stage', async () => {
  const secret = 'lin_api_do_not_log_me';
  const captured = [];
  const original = console.warn;
  console.warn = (...args) => { if (args[0] === '[credential-rejected]') captured.push(args[1]); };
  try {
    const app = buildApp({
      resolveWorkspaceAccess: async () => ({ token: secret, reason: 'ok', provider: 'linear', source: 'cache', expiresAt: Date.now() + 1000 }),
    });
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/issues/${ISSUE_UUID}`, {
      headers: { Authorization: 'Bearer agent-token' },
    });
    await new Promise(resolve => server.close(resolve));
  } finally {
    console.warn = original;
  }
  assert.equal(captured.length, 1);
  assert.ok(!captured[0].includes(secret));
});
