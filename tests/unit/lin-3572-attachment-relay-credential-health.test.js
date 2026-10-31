/**
 * LIN-3572 — an asset host's answer counts for the workspace credential only
 * when the relay actually sent that credential with the request.
 *
 * GET /api/proxy/attachments/:id passes the upstream asset host's HTTP status
 * into logEvent. logEvent marks the resolved credential suspect on a 401/503,
 * and counts a 2xx as a witness that the credential is accepted. But the relay
 * sends `Authorization` only to a Linear host on a linear workspace. So a
 * GitHub asset host's 401 used to mark a credential the host never saw, and a
 * GitHub 200 used to witness it.
 *
 * These tests drive the real handler over HTTP and observe the registry's
 * markSuspect / witnessAccepted calls. The upstream fetch is stubbed per host.
 */

process.env.NODE_ENV = 'test';

import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { encodeAttachmentHandle } from '../../lib/proxy-wire.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { setProxyFetchImpl } from '../../lib/proxy-fetch.js';
import { guardNetwork } from '../fixtures/network-guard.js';

const WS_TOKEN = 'ws-linear-token';
const WS_FINGERPRINT = fingerprintCredential(WS_TOKEN);
const LINEAR_HOST = 'https://uploads.linear.app';
const GITHUB_HOST = 'https://user-images.githubusercontent.com';
const realFetch = globalThis.fetch;

function fakeRegistry() {
  const markSuspectCalls = [];
  const witnessCalls = [];
  return {
    markSuspectCalls,
    witnessCalls,
    markSuspect: (fp, opts) => markSuspectCalls.push({ fp, opts }),
    witnessAccepted: (fp) => witnessCalls.push(fp),
    isSuspect: () => false,
    shouldAttemptRefresh: () => false,
    accept: () => {},
  };
}

function buildApp({ providerName = 'linear', rejectedCredentialRegistry }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({
      token: WS_TOKEN,
      reason: 'ok',
      provider: providerName,
      expiresAt: Date.now() + 3600_000,
      credentialFingerprint: WS_FINGERPRINT,
    }),
    getWorkspaceAccessToken: async () => WS_TOKEN,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    rejectedCredentialRegistry,
  }));
  return app;
}

// Call the relay over HTTP and return the status the client saw.
async function getAttachmentStatus(app, handle) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/proxy/attachments/${encodeURIComponent(handle)}`,
      { headers: { Authorization: 'Bearer anything' } },
    );
    await res.arrayBuffer();
    return res.status;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// A minimal fetch Response stand-in for the upstream asset fetch.
function fakeResponse({ ok = true, status = 200, contentType = 'image/png', bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]) } = {}) {
  return {
    ok,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

// Route upstream calls by host: the asset host under test gets `handler`,
// everything else (the loopback call to the test server) hits the real fetch.
// Installed as both globalThis.fetch and the proxy-fetch override, so the
// relay's egress is stubbed whichever branch createProxyFetch() takes.
function stubUpstream(hostPrefix, handler) {
  const fn = async (url, opts) => {
    if (typeof url === 'string' && url.startsWith(hostPrefix)) return handler(url, opts);
    return realFetch(url, opts);
  };
  globalThis.fetch = fn;
  setProxyFetchImpl(fn);
}

let networkGuard;
let savedProxyEnv;
beforeEach(() => {
  savedProxyEnv = {
    HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY,
    https_proxy: process.env.https_proxy, http_proxy: process.env.http_proxy,
  };
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
  delete process.env.HTTP_PROXY; delete process.env.https_proxy; delete process.env.http_proxy;
  networkGuard = guardNetwork();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setProxyFetchImpl(null);
  networkGuard.restore();
  for (const [k, v] of Object.entries(savedProxyEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  assert.equal(networkGuard.attempts.length, 0, `unexpected http(s).request transport attempts: ${JSON.stringify(networkGuard.attempts)}`);
});

const md = (url) => encodeAttachmentHandle('md', url);

describe('GET /api/proxy/attachments/:id — an asset host speaks for the credential only if the relay sent it (LIN-3572)', () => {
  test('a GitHub asset-host 401 leaves the credential alone when no Authorization was relayed', async () => {
    const registry = fakeRegistry();
    let sawAuthHeader = 'UNSET';
    stubUpstream(GITHUB_HOST, (url, opts) => {
      sawAuthHeader = 'Authorization' in (opts.headers || {});
      return fakeResponse({ ok: false, status: 401 });
    });
    const status = await getAttachmentStatus(
      buildApp({ rejectedCredentialRegistry: registry }),
      md(`${GITHUB_HOST}/1/abc.png`),
    );
    assert.equal(status, 401, 'the client still sees the host\'s status');
    assert.equal(sawAuthHeader, false, 'precondition: the workspace credential was not sent to GitHub');
    assert.deepEqual(registry.markSuspectCalls, [], 'a host that never saw the credential must not mark it suspect');
  });

  test('a GitHub asset-host 200 does not witness the credential when no Authorization was relayed', async () => {
    const registry = fakeRegistry();
    stubUpstream(GITHUB_HOST, () => fakeResponse({ contentType: 'image/png' }));
    const status = await getAttachmentStatus(
      buildApp({ rejectedCredentialRegistry: registry }),
      md(`${GITHUB_HOST}/1/abc.png`),
    );
    assert.equal(status, 200);
    assert.deepEqual(registry.witnessCalls, [], 'a host that never saw the credential cannot prove it is accepted');
  });

  test('a Linear-host 401 on a linear workspace still marks the relayed credential suspect', async () => {
    const registry = fakeRegistry();
    let sawAuth = null;
    stubUpstream(LINEAR_HOST, (url, opts) => {
      sawAuth = opts.headers.Authorization;
      return fakeResponse({ ok: false, status: 401 });
    });
    const status = await getAttachmentStatus(
      buildApp({ rejectedCredentialRegistry: registry }),
      md(`${LINEAR_HOST}/abc/screenshot.png`),
    );
    assert.equal(status, 401);
    assert.equal(sawAuth, `Bearer ${WS_TOKEN}`, 'precondition: the credential was relayed to Linear');
    assert.equal(registry.markSuspectCalls.length, 1, 'the credential the relay sent is the one the 401 speaks for');
    assert.equal(registry.markSuspectCalls[0].fp, WS_FINGERPRINT);
    assert.equal(registry.markSuspectCalls[0].opts.reason, 'provider-401');
  });

  test('a Linear-host 200 on a linear workspace still witnesses the relayed credential', async () => {
    const registry = fakeRegistry();
    stubUpstream(LINEAR_HOST, () => fakeResponse({ contentType: 'image/png' }));
    const status = await getAttachmentStatus(
      buildApp({ rejectedCredentialRegistry: registry }),
      md(`${LINEAR_HOST}/abc/screenshot.png`),
    );
    assert.equal(status, 200);
    assert.deepEqual(registry.witnessCalls, [WS_FINGERPRINT]);
  });

  test('a non-linear workspace relaying a Linear-hosted 401 sends no credential, so it does not mark it suspect', async () => {
    const registry = fakeRegistry();
    let sawAuthHeader = 'UNSET';
    stubUpstream(LINEAR_HOST, (url, opts) => {
      sawAuthHeader = 'Authorization' in (opts.headers || {});
      return fakeResponse({ ok: false, status: 401 });
    });
    const status = await getAttachmentStatus(
      buildApp({ providerName: 'local', rejectedCredentialRegistry: registry }),
      md(`${LINEAR_HOST}/abc/screenshot.png`),
    );
    assert.equal(status, 401);
    assert.equal(sawAuthHeader, false, 'precondition: a local-bound workspace does not send its credential to Linear\'s CDN');
    assert.deepEqual(registry.markSuspectCalls, [], 'the same rule as GitHub: no relayed credential, no health change');
  });
});
