/**
 * LIN-3137 J5 — refusal-vocabulary parity between the two owner-gated session
 * mints (plan review carry-forward 2).
 *
 * The shared `lib/owner-mint-refusals.js` supplies the same status / code /
 * category / retryable / wording to both mints, but each route keeps its OWN
 * outcome→code mapping: the runner copy gets its codes from the proxy token
 * store's throws, the dispatch mint resolves through `resolveOwnerMintRefusal`.
 * The guard against drift is therefore an END-TO-END comparison of what the two
 * REAL routes put on the wire for every refusal — not the shared table compared
 * with itself.
 *
 * `NODE_ENV=test` before import so both module-scope creation limiters skip.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const WORKSPACE = { urlKey: 'acme', id: 'ws-1', provider: 'linear' };
const RUNNER_PATH = '/workspace/acme/api/proxy/tokens';
const DISPATCH_PATH = '/workspace/acme/api/dispatch/tokens';

function buildRunnerApp({ ownerCheck, session }) {
  const proxyTokenStore = new ProxyTokenStore({ collection: createMockCollection() });
  if (ownerCheck) proxyTokenStore.setOwnerCheck(ownerCheck);
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = WORKSPACE;
      req.session = session;
      next();
    },
    getWorkspaceAccessToken: () => null,
    resolveWorkspaceAccess: () => null,
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {}, freeTierStore: {}
  }));
  return app;
}

function buildDispatchApp({ ownerCheck, session }) {
  const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {},
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => {
      req.workspace = WORKSPACE;
      req.session = session;
      next();
    },
    userPreferencesStore: {},
    workspaceOwnerCheck: ownerCheck ?? null
  }));
  return app;
}

async function call(app, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const SESSION = { accountId: 'account-A', features: { proxy: true } };
const NO_ACCOUNT = { accountId: null, features: { proxy: true } };

// Every refusal shape, driven through both routes. `ownerCheck` is installed on
// both routes; `accountId` comes from the session.
const SCENARIOS = [
  { code: 'GRANT_OWNER_ONLY', ownerCheck: async () => ({ status: 'not-owner' }), session: SESSION },
  { code: 'WORKSPACE_OWNER_UNSET', ownerCheck: async () => ({ status: 'no-owner' }), session: SESSION },
  { code: 'GRANT_OWNERLESS', ownerCheck: async () => ({ status: 'owner' }), session: NO_ACCOUNT },
  { code: 'OWNER_CHECK_UNAVAILABLE (seam throws)', ownerCheck: async () => { throw new Error('owner store down'); }, session: SESSION, expectedCode: 'OWNER_CHECK_UNAVAILABLE' },
  { code: 'OWNER_CHECK_UNAVAILABLE (seam unwired)', ownerCheck: null, session: SESSION, expectedCode: 'OWNER_CHECK_UNAVAILABLE' },
  { code: 'OWNER_CHECK_UNAVAILABLE (malformed status)', ownerCheck: async () => ({ status: 'bogus' }), session: SESSION, expectedCode: 'OWNER_CHECK_UNAVAILABLE' }
];

describe('LIN-3137 — runner and dispatch mints refuse identically (end to end)', () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.code}: same status/code/category/retryable on both real routes`, async () => {
      const runner = await call(
        buildRunnerApp({ ownerCheck: scenario.ownerCheck, session: scenario.session }),
        RUNNER_PATH,
        { runner: true }
      );
      const dispatch = await call(
        buildDispatchApp({ ownerCheck: scenario.ownerCheck, session: scenario.session }),
        DISPATCH_PATH,
        {}
      );

      const expectedCode = scenario.expectedCode ?? scenario.code;
      for (const [label, res] of [['runner', runner], ['dispatch', dispatch]]) {
        assert.equal(res.body.code, expectedCode, `${label} code (${JSON.stringify(res.body)})`);
        assert.ok(res.status >= 400, `${label} must refuse, not mint (${res.status})`);
      }

      assert.equal(dispatch.status, runner.status, 'HTTP status must match');
      assert.equal(dispatch.body.code, runner.body.code, 'code must match');
      assert.equal(dispatch.body.category, runner.body.category, 'category must match');
      assert.equal(dispatch.body.retryable, runner.body.retryable, 'retryable must match');
    });
  }

  test('GRANT_OWNER_ONLY wording is correct per mint (subject), not a shared string', async () => {
    const ownerCheck = async () => ({ status: 'not-owner' });
    const runner = await call(buildRunnerApp({ ownerCheck, session: SESSION }), RUNNER_PATH, { runner: true });
    const dispatch = await call(buildDispatchApp({ ownerCheck, session: SESSION }), DISPATCH_PATH, {});

    assert.equal(runner.body.error, "Only this workspace's owner can mint a runner credential");
    assert.equal(dispatch.body.error, "Only this workspace's owner can mint a dispatch token");
  });
});
