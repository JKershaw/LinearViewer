/**
 * Route-level proof that a refused credential stops being re-served.
 * Write-up: docs/incidents/2026-08-09-proxy-401-flood.md (follow-up 1)
 *
 * The incident's amplifier: the headless lane learned nothing from a 401, so
 * every poll re-resolved, re-selected the same dead credential, and failed
 * identically — ~1/sec for ~75 minutes, with no path to recovery.
 *
 * Asserted through the real router because the value is entirely in the wiring:
 * the proxy reports a provider verdict, the registry counts it, and selection
 * acts on it. No unit test of any one piece exercises that loop.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';

const ISSUE_UUID = '266f0841-ef9a-40de-a7b4-e18890efbf05';

function linearAuthError() {
  const err = new Error('Authentication required, not authenticated');
  err.response = { status: 401, errors: [{ extensions: { statusCode: 401 } }] };
  return err;
}

/**
 * A harness wired the way production is: one registry shared between the proxy's
 * verdict reporting and the resolver's selection.
 */
function buildHarness({ issueDetail } = {}) {
  const registry = createRejectedCredentialRegistry();
  const resolveCalls = [];

  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 'tok-1', urlKey: 'acme', label: 'agent', scope: 'readWrite', createdBy: 'acct-1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    // Stands in for resolveWorkspaceAccess: the stored credential is dead
    // upstream but its recorded expiry is in the future, so selection considers
    // it healthy — until it is suspended, at which point the real resolver would
    // fall through to refresh-on-resolve.
    resolveWorkspaceAccess: async () => {
      const suspended = registry.isSuspended('dead-tok');
      resolveCalls.push(suspended ? 'suspended' : 'served');
      return suspended
        ? { token: null, reason: 'session_expired', provider: 'linear' }
        : { token: 'dead-tok', reason: 'ok', provider: 'linear', source: 'session-scan', expiresAt: Date.now() + 24 * 3600_000 };
    },
    getWorkspaceAccessToken: async () => 'dead-tok',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    onProviderRejectedCredential: credential => registry.reject(credential),
    onProviderAcceptedCredential: credential => registry.accept(credential),
    provider: {
      name: 'linear',
      supports: () => true,
      issueDetail: issueDetail ?? (async () => { throw linearAuthError(); }),
    },
  }));

  return { app, registry, resolveCalls };
}

async function get(app, path) {
  const server = app.listen(0);
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { Authorization: 'Bearer agent-token' },
    });
    return res.status;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('a dead credential stops being served after three consecutive refusals', async () => {
  const { app, registry, resolveCalls } = buildHarness();
  const path = `/api/proxy/issues/${ISSUE_UUID}`;

  // The incident's loop: identical 401s, forever.
  assert.equal(await get(app, path), 401);
  assert.equal(await get(app, path), 401);
  assert.equal(registry.isSuspended('dead-tok'), false, 'not suspended before the threshold');
  assert.equal(await get(app, path), 401);

  assert.equal(registry.isSuspended('dead-tok'), true, 'suspended after three strikes');

  // The loop is broken: the credential is no longer handed out.
  const fourth = await get(app, path);
  assert.equal(resolveCalls[3], 'suspended');
  assert.notEqual(fourth, 401, 'no longer re-serving the dead credential');
  assert.equal(fourth, 503, 'a retryable, reasoned envelope instead of an endless 401');
});

test('a single refusal changes nothing — a lone scope-403 must not suspend', async () => {
  const { app, registry, resolveCalls } = buildHarness();
  assert.equal(await get(app, `/api/proxy/issues/${ISSUE_UUID}`), 401);
  assert.equal(registry.isSuspended('dead-tok'), false);
  await get(app, `/api/proxy/issues/${ISSUE_UUID}`);
  assert.equal(resolveCalls[1], 'served', 'the credential is still trusted');
});

test('a success between refusals resets the count', async () => {
  // Counting must be consecutive: a healthy credential that occasionally 401s on
  // an under-scoped write must never suspend itself.
  let succeed = false;
  const { app, registry } = buildHarness({
    issueDetail: async () => {
      if (succeed) return { id: ISSUE_UUID, identifier: 'LIN-1', title: 'ok', state: { name: 'Todo', type: 'unstarted' } };
      throw linearAuthError();
    },
  });
  const path = `/api/proxy/issues/${ISSUE_UUID}`;

  await get(app, path);
  await get(app, path);
  succeed = true;
  assert.equal(await get(app, path), 200);

  succeed = false;
  await get(app, path);
  await get(app, path);
  assert.equal(registry.isSuspended('dead-tok'), false, 'the success restarted the count');
});

test('a healthy credential is never suspended by ordinary traffic', async () => {
  const { app, registry } = buildHarness({
    issueDetail: async () => ({ id: ISSUE_UUID, identifier: 'LIN-1', title: 'ok', state: { name: 'Todo', type: 'unstarted' } }),
  });
  for (let i = 0; i < 5; i++) assert.equal(await get(app, `/api/proxy/issues/${ISSUE_UUID}`), 200);
  assert.equal(registry.isSuspended('dead-tok'), false);
});

test('a non-auth failure never suspends — only 401 is a credential verdict', async () => {
  // A 429 or 500 says nothing about the credential; treating it as a strike
  // would suspend a healthy credential during a provider incident.
  const rateLimited = () => {
    const err = new Error('rate limited');
    err.response = { status: 429, errors: [{ extensions: { statusCode: 429 } }] };
    throw err;
  };
  const { app, registry } = buildHarness({ issueDetail: async () => rateLimited() });
  for (let i = 0; i < 5; i++) await get(app, `/api/proxy/issues/${ISSUE_UUID}`);
  assert.equal(registry.isSuspended('dead-tok'), false);
});

test('the router works with no verdict handlers injected (back-compat)', async () => {
  // Every existing directly-constructed router in the suite omits them.
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't', urlKey: 'acme', scope: 'readWrite', createdBy: 'a' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'tok', reason: 'ok', provider: 'linear' }),
    getWorkspaceAccessToken: async () => 'tok',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: {
      name: 'linear',
      supports: () => true,
      issueDetail: async () => { throw linearAuthError(); },
    },
  }));
  assert.equal(await get(app, `/api/proxy/issues/${ISSUE_UUID}`), 401);
});
