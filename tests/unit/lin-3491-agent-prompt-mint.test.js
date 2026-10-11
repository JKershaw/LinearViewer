/**
 * LIN-3491 — the `agent` copy-purpose row behind the Proxy page's
 * "read-write + dispatch" Agent Prompt option, on
 * `POST /workspace/:urlKey/api/proxy/tokens`.
 *
 * Same harness as lin-3136-driver-copy-mint.test.js (real `createProxyRoutes`
 * over a REAL `ProxyTokenStore`). Covers: the owner mint (`['dispatch']` only,
 * `readWrite`, `worker` profile, its own label and message), the exchange and a
 * working `POST /dispatch`, no `take`, every owner refusal writing nothing,
 * `grants` in the body, and `INVALID_PURPOSE`.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const TOKENS_PATH = '/workspace/acme/api/proxy/tokens';
const HOURS_48 = 48 * 3600;

const OWNER = async () => ({ status: 'owner' });

function harness({ ownerCheck = OWNER } = {}) {
  const collection = createMockCollection();
  const proxyTokenStore = new ProxyTokenStore({ collection });
  if (ownerCheck !== null) proxyTokenStore.setOwnerCheck(ownerCheck);
  return { collection, proxyTokenStore };
}

const session = (overrides = {}) => ({ accountId: 'account-A', features: { proxy: true }, ...overrides });

function buildApp({ proxyTokenStore, session: sess, captured = {} }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok', provider: 'linear' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    taskSnapshotStore: {},
    // addItem-only: the referent guard fails open without the read capability.
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.items = captured.items || [];
        captured.items.push(item);
        return { _id: `disp-${captured.items.length}`, dispatchedAt: '2026-10-01T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: 'acme', id: 'ws-1', provider: 'linear' };
      req.session = sess;
      next();
    },
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, { token, body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const opts = { method: method.toUpperCase(), headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const mint = (app, body) => call(app, 'post', TOKENS_PATH, { body });

describe('LIN-3491 — purpose:agent mints the owner-checked "read-write + dispatch" bootstrap', () => {
  test('201: [dispatch] only, readWrite, worker profile, agent-prompt-dispatch label, not "Driver"', async () => {
    const { collection, proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session() });

    const before = Date.now();
    const res = await mint(app, { purpose: 'agent', scope: 'read', label: 'client-label' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.scope, 'readWrite', 'client scope is ignored on a purposed mint');
    assert.equal(res.body.label, 'agent-prompt-dispatch', 'client label is ignored; distinct from prompt-driver');
    assert.deepEqual(res.body.grants, ['dispatch'], 'never take');
    assert.equal(res.body.lifetimeProfile, 'worker');
    assert.equal(res.body.providerDisplayName, 'Linear');
    assert.ok(!/driver/i.test(res.body.message), res.body.message);
    assert.match(res.body.message, /^Agent bootstrap created\./);
    const ttl = (new Date(res.body.expiresAt).getTime() - before) / 1000;
    assert.ok(ttl > HOURS_48 - 5 && ttl <= HOURS_48 + 5, `worker bootstrap TTL is 48h, got ${ttl}s`);

    assert.equal(collection._docs.length, 1);
    assert.equal(collection._docs[0].label, 'agent-prompt-dispatch');
    assert.equal(collection._docs[0].createdBy, 'account-A');
    assert.deepEqual(collection._docs[0].grants, ['dispatch']);
  });

  test('the driver purpose keeps its own label and "Driver bootstrap created." message', async () => {
    const { proxyTokenStore } = harness();
    const res = await mint(buildApp({ proxyTokenStore, session: session() }), { purpose: 'driver' });
    assert.equal(res.body.label, 'prompt-driver');
    assert.match(res.body.message, /^Driver bootstrap created\./);
  });

  test('exchange → readWrite + [dispatch] ≈48h; POST /dispatch is not 403; runner route 403 TAKE_GRANT_REQUIRED', async () => {
    const { proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session(), captured: {} });
    const minted = await mint(app, { purpose: 'agent' });
    assert.equal(minted.status, 201, JSON.stringify(minted.body));

    const before = Date.now();
    const exchanged = await call(app, 'post', '/api/proxy/token', { token: minted.body.token });
    assert.equal(exchanged.status, 200, JSON.stringify(exchanged.body));
    assert.equal(exchanged.body.scope, 'readWrite');
    assert.deepEqual(exchanged.body.grants, ['dispatch']);
    const ttl = (new Date(exchanged.body.expiresAt).getTime() - before) / 1000;
    assert.ok(ttl > HOURS_48 - 5 && ttl <= HOURS_48 + 5, `worker working TTL is 48h, got ${ttl}s`);

    const dispatched = await call(app, 'post', '/api/proxy/dispatch', {
      token: exchanged.body.token, body: { prompt: 'run me', kind: 'implementation' }
    });
    assert.equal(dispatched.status, 201, JSON.stringify(dispatched.body));

    const runner = await call(app, 'get', '/api/proxy/runner/poll', { token: exchanged.body.token });
    assert.equal(runner.status, 403);
    assert.equal(runner.body.code, 'TAKE_GRANT_REQUIRED');
  });

  test('a plain Proxy-page read-write mint still cannot dispatch (403 DISPATCH_GRANT_REQUIRED)', async () => {
    const { proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session() });
    const minted = await mint(app, { label: 'agent-prompt', scope: 'readWrite', bootstrap: true });
    assert.equal(minted.status, 201, JSON.stringify(minted.body));
    const exchanged = await call(app, 'post', '/api/proxy/token', { token: minted.body.token });
    const dispatched = await call(app, 'post', '/api/proxy/dispatch', {
      token: exchanged.body.token, body: { prompt: 'run me', kind: 'implementation' }
    });
    assert.equal(dispatched.status, 403);
    assert.equal(dispatched.body.code, 'DISPATCH_GRANT_REQUIRED');
  });
});

describe('LIN-3491 — agent refusals use the agent subject and write nothing', () => {
  const cases = [
    ['not-owner → 403 GRANT_OWNER_ONLY', { ownerCheck: async () => ({ status: 'not-owner' }) }, 403, 'GRANT_OWNER_ONLY'],
    ['owner-less workspace → 409 WORKSPACE_OWNER_UNSET', { ownerCheck: async () => ({ status: 'no-owner' }) }, 409, 'WORKSPACE_OWNER_UNSET'],
    ['seam unwired → 503 OWNER_CHECK_UNAVAILABLE', { ownerCheck: null }, 503, 'OWNER_CHECK_UNAVAILABLE']
  ];
  for (const [desc, opts, status, code] of cases) {
    test(desc, async () => {
      const { collection, proxyTokenStore } = harness(opts);
      const res = await mint(buildApp({ proxyTokenStore, session: session() }), { purpose: 'agent' });
      assert.equal(res.status, status, JSON.stringify(res.body));
      assert.equal(res.body.code, code);
      if (code === 'GRANT_OWNER_ONLY') {
        assert.equal(res.body.error, "Only this workspace's owner can mint an agent credential");
      }
      assert.equal(collection._docs.length, 0);
    });
  }

  test('no accountId → 503 GRANT_OWNERLESS before any mint', async () => {
    const { collection, proxyTokenStore } = harness();
    const res = await mint(buildApp({ proxyTokenStore, session: session({ accountId: null }) }), { purpose: 'agent' });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNERLESS');
    assert.equal(collection._docs.length, 0);
  });
});

describe('LIN-3491 — validation on the agent purpose', () => {
  test('a body carrying grants is refused GRANTS_NOT_CLIENT_SETTABLE and nothing is written', async () => {
    const { collection, proxyTokenStore } = harness();
    const res = await mint(buildApp({ proxyTokenStore, session: session() }), { purpose: 'agent', grants: ['dispatch'] });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANTS_NOT_CLIENT_SETTABLE');
    assert.equal(collection._docs.length, 0);
  });

  test('an unknown purpose → 400 INVALID_PURPOSE, nothing written', async () => {
    const { collection, proxyTokenStore } = harness();
    const res = await mint(buildApp({ proxyTokenStore, session: session() }), { purpose: 'agent-dispatch' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_PURPOSE');
    assert.equal(collection._docs.length, 0);
  });
});
