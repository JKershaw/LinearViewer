/**
 * LIN-3136 S5 (acceptance 14) — the `driver` copy-purpose row on
 * `POST /workspace/:urlKey/api/proxy/tokens`.
 *
 * Drives the real `createProxyRoutes` chain over a REAL `ProxyTokenStore`
 * (the harness of tests/unit/lin-3131-runner-copy-mint.test.js). Covers:
 *  - owner + `purpose: 'driver'` → a single-use bootstrap holding exactly
 *    `['dispatch']` on the `worker` profile, label `prompt-driver`, with the
 *    declared provider identity; it exchanges to readWrite + `['dispatch']`
 *    ≈48h, enqueues, cannot reach a runner route, and its recommend child is
 *    grant-less;
 *  - every owner refusal with the `'a driver credential'` subject, nothing
 *    written;
 *  - body `grants` first, then `INVALID_PURPOSE` for an unknown, non-string or
 *    conflicting purpose;
 *  - `runner: true` stays an alias of `purpose: 'runner'` with its response
 *    byte-identical, and no purpose stays the byte-identical `prompt-proxy` path;
 *  - the closed purpose table itself.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { COPY_PURPOSES } from '../../routes/proxy-tokens-admin.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { RUNNER_GRANTS } from '../../lib/proxy-scopes.js';
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

describe('LIN-3136 S5 — purpose:driver mints the owner-checked driver bootstrap', () => {
  test('201: [dispatch] only, worker profile, prompt-driver label, provider identity; stored owner/workspace', async () => {
    const { collection, proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session() });

    const before = Date.now();
    const res = await mint(app, { purpose: 'driver', scope: 'read', label: 'client-label' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.kind, 'bootstrap');
    assert.equal(res.body.singleUse, true);
    assert.equal(res.body.scope, 'readWrite', 'client scope is ignored on a purposed mint');
    assert.equal(res.body.label, 'prompt-driver', 'client label is ignored; the server fixes it');
    assert.deepEqual(res.body.grants, ['dispatch'], 'never take, never RUNNER_GRANTS');
    assert.equal(res.body.lifetimeProfile, 'worker');
    assert.equal(res.body.providerDisplayName, 'Linear', 'buildBlock reads the declared provider');
    const ttl = (new Date(res.body.expiresAt).getTime() - before) / 1000;
    assert.ok(ttl > HOURS_48 - 5 && ttl <= HOURS_48 + 5, `worker bootstrap TTL is 48h, got ${ttl}s`);

    const docs = collection._docs;
    assert.equal(docs.length, 1);
    assert.equal(docs[0].createdBy, 'account-A');
    assert.equal(docs[0].workspaceId, 'ws-1');
    assert.equal(docs[0].lifetimeProfile, 'worker');
    assert.equal(docs[0].label, 'prompt-driver');
    assert.deepEqual(docs[0].grants, ['dispatch']);
  });

  test('exchange → readWrite + [dispatch] ≈48h; POST /dispatch 201; runner route 403; recommend child grant-less', async () => {
    const { proxyTokenStore } = harness();
    const captured = {};
    const app = buildApp({ proxyTokenStore, session: session(), captured });

    const minted = await mint(app, { purpose: 'driver' });
    assert.equal(minted.status, 201, JSON.stringify(minted.body));

    const before = Date.now();
    const exchanged = await call(app, 'post', '/api/proxy/token', { token: minted.body.token });
    assert.equal(exchanged.status, 200, JSON.stringify(exchanged.body));
    assert.equal(exchanged.body.scope, 'readWrite');
    assert.deepEqual(exchanged.body.grants, ['dispatch']);
    const ttl = (new Date(exchanged.body.expiresAt).getTime() - before) / 1000;
    assert.ok(ttl > HOURS_48 - 5 && ttl <= HOURS_48 + 5, `worker working TTL is 48h, got ${ttl}s`);
    const working = exchanged.body.token;

    const dispatched = await call(app, 'post', '/api/proxy/dispatch', {
      token: working, body: { prompt: 'run me', kind: 'implementation' }
    });
    assert.equal(dispatched.status, 201, JSON.stringify(dispatched.body));

    const runner = await call(app, 'get', '/api/proxy/runner/poll', { token: working });
    assert.equal(runner.status, 403, JSON.stringify(runner.body));
    assert.equal(runner.body.code, 'TAKE_GRANT_REQUIRED', 'a driver copy holds no take grant');

    captured.items = [];
    const recommended = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      token: working, body: { issueIdentifier: 'TEST-1', kind: 'implementation', harness: 'claude-code' }
    });
    assert.equal(recommended.status, 201, JSON.stringify(recommended.body));
    const child = captured.items[0];
    assert.ok(child?.bootstrapToken, 'the recommend child carries its own bootstrap');
    const childWorking = await proxyTokenStore.exchangeBootstrapToken(child.bootstrapToken);
    assert.deepEqual(childWorking.grants ?? [], [], 'a leaf child is grant-less: the poster\'s dispatch never widens it');
    assert.equal(child.grantDeclaration ?? null, null, 'nothing declared for the leaf');
  });
});

describe('LIN-3136 S5 — driver refusals use the driver subject and write nothing', () => {
  const cases = [
    ['not-owner → 403 GRANT_OWNER_ONLY', { ownerCheck: async () => ({ status: 'not-owner' }) }, 403, 'GRANT_OWNER_ONLY', false],
    ['owner-less workspace → 409 WORKSPACE_OWNER_UNSET', { ownerCheck: async () => ({ status: 'no-owner' }) }, 409, 'WORKSPACE_OWNER_UNSET', false],
    ['seam unwired → 503 OWNER_CHECK_UNAVAILABLE', { ownerCheck: null }, 503, 'OWNER_CHECK_UNAVAILABLE', true],
    ['seam throws → 503 OWNER_CHECK_UNAVAILABLE', { ownerCheck: async () => { throw new Error('down'); } }, 503, 'OWNER_CHECK_UNAVAILABLE', true]
  ];
  for (const [desc, opts, status, code, retryable] of cases) {
    test(desc, async () => {
      const { collection, proxyTokenStore } = harness(opts);
      const app = buildApp({ proxyTokenStore, session: session() });
      const res = await mint(app, { purpose: 'driver' });
      assert.equal(res.status, status, JSON.stringify(res.body));
      assert.equal(res.body.code, code);
      assert.equal(res.body.retryable, retryable);
      if (code === 'GRANT_OWNER_ONLY') {
        assert.equal(res.body.error, "Only this workspace's owner can mint a driver credential");
      }
      assert.equal(collection._docs.length, 0, 'a refused driver copy writes no token');
    });
  }

  test('no accountId → 503 GRANT_OWNERLESS before any mint', async () => {
    const { collection, proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session({ accountId: null }) });
    const res = await mint(app, { purpose: 'driver' });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNERLESS');
    assert.equal(collection._docs.length, 0);
  });
});

describe('LIN-3136 S5 — purpose validation', () => {
  test('body grants is refused first, even with an unknown purpose', async () => {
    for (const body of [{ purpose: 'driver', grants: ['dispatch'] }, { purpose: 'admin', grants: [] }]) {
      const { collection, proxyTokenStore } = harness();
      const res = await mint(buildApp({ proxyTokenStore, session: session() }), body);
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.code, 'GRANTS_NOT_CLIENT_SETTABLE');
      assert.equal(collection._docs.length, 0);
    }
  });

  for (const [desc, body] of [
    ['an unknown purpose', { purpose: 'admin' }],
    ['a prototype key', { purpose: 'constructor' }],
    ['a non-string purpose', { purpose: ['driver'] }],
    ['a null purpose', { purpose: null }],
    ['runner:true with purpose driver', { runner: true, purpose: 'driver' }]
  ]) {
    test(`${desc} → 400 INVALID_PURPOSE, nothing written`, async () => {
      const { collection, proxyTokenStore } = harness();
      const res = await mint(buildApp({ proxyTokenStore, session: session() }), body);
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.code, 'INVALID_PURPOSE');
      assert.equal(res.body.retryable, false);
      assert.equal(collection._docs.length, 0);
    });
  }
});

describe('LIN-3136 S5 — the runner alias and the default path are unchanged', () => {
  const RUNNER_KEYS = ['expiresAt', 'grants', 'kind', 'label', 'lifetimeProfile', 'message', 'scope', 'singleUse', 'success', 'token', 'tokenId'];

  for (const body of [{ runner: true }, { runner: 'true' }, { purpose: 'runner' }, { runner: true, purpose: 'runner' }]) {
    test(`${JSON.stringify(body)} → the runner credential, response keys unchanged`, async () => {
      const { collection, proxyTokenStore } = harness();
      const res = await mint(buildApp({ proxyTokenStore, session: session() }), body);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(Object.keys(res.body).sort(), RUNNER_KEYS);
      assert.deepEqual(res.body.grants, ['take', 'dispatch']);
      assert.equal(res.body.lifetimeProfile, 'runner');
      assert.equal(collection._docs[0].label, res.body.label, 'the runner arm still passes no label of its own');
      assert.notEqual(res.body.label, 'prompt-driver');
    });
  }

  test('no purpose: the toggle body still mints a grant-less prompt-proxy bootstrap with the same keys', async () => {
    const { collection, proxyTokenStore } = harness();
    const res = await mint(buildApp({ proxyTokenStore, session: session() }), { label: 'prompt-proxy', scope: 'readWrite', bootstrap: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body).sort(),
      ['kind', 'label', 'message', 'providerDisplayName', 'scope', 'singleUse', 'success', 'token', 'tokenId']);
    assert.equal(res.body.label, 'prompt-proxy');
    assert.deepEqual(collection._docs[0].grants ?? [], []);
  });
});

describe('LIN-3136 S5 — the closed purpose table', () => {
  test('frozen, exactly runner and driver; driver is [dispatch] on worker, runner is RUNNER_GRANTS on runner', () => {
    assert.ok(Object.isFrozen(COPY_PURPOSES));
    assert.deepEqual(Object.keys(COPY_PURPOSES).sort(), ['driver', 'runner']);
    for (const row of Object.values(COPY_PURPOSES)) {
      assert.ok(Object.isFrozen(row));
      assert.ok(Object.isFrozen(row.grants));
    }
    assert.deepEqual([...COPY_PURPOSES.driver.grants], ['dispatch']);
    assert.equal(COPY_PURPOSES.driver.profile, 'worker');
    assert.equal(COPY_PURPOSES.driver.label, 'prompt-driver');
    assert.equal(COPY_PURPOSES.driver.subject, 'a driver credential');
    assert.equal(COPY_PURPOSES.driver.providerIdentity, true);
    assert.deepEqual([...COPY_PURPOSES.runner.grants], [...RUNNER_GRANTS]);
    assert.equal(COPY_PURPOSES.runner.profile, 'runner');
    assert.equal(COPY_PURPOSES.runner.providerIdentity, false);
  });
});
