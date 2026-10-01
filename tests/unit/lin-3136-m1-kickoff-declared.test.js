/**
 * LIN-3136 S2 (acceptance 4 and 6) — M1: `POST /api/proxy/autopilot/kickoff`
 * declares `['dispatch']` for the child it launches.
 *
 * Real `createProxyRoutes` over a REAL `ProxyTokenStore`. The caller holds a
 * driver-style working token (owner-checked `mintGrantBootstrap` in `ws-1`,
 * then exchanged), so its stored `workspaceId` reaches the kickoff through
 * `req.proxyWorkspaceId` (Finding A). Covers:
 *  - the child bootstrap (claude-code field, and prose in the prompt) exchanges
 *    to readWrite + `['dispatch']` ≈48h, owned by the caller's owner, and the
 *    item carries a `site: 'M1'` declaration; the child can then enqueue;
 *  - the exchange never adds a grant (the child gets exactly the declaration);
 *  - a caller token with no stored workspace fails closed (400 INVALID_GRANTS),
 *    an owner change refuses (403 GRANT_OWNER_ONLY, human text), an unavailable
 *    owner check stays the transient 503 — nothing enqueued, nothing minted;
 *  - `appendProxyContext: false` mints and declares nothing;
 *  - a plain `POST /dispatch` launch from the same caller stays a grant-less leaf.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import crypto from 'crypto';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const OWNER = 'account-A';
const WS = 'ws-1';
const HOURS_48 = 48 * 3600;
const KICKOFF = '/api/proxy/autopilot/kickoff';
const PROXY_ATTACH_FAILED_MESSAGE = 'Proxy context was requested but a proxy token could not be created (LIN-1175) — refusing to launch a credential-less session; you may have hit the token rate limit, wait a minute and retry.';

function world({ ownerCheck } = {}) {
  const store = new ProxyTokenStore({ collection: createMockCollection() });
  const state = { owners: { [WS]: OWNER }, fault: false };
  store.setOwnerCheck(ownerCheck || (async ({ workspaceId, accountId }) => {
    if (state.fault) throw new Error('owner store down');
    const owner = state.owners[workspaceId];
    if (!owner) return { status: 'no-owner' };
    return { status: owner === accountId ? 'owner' : 'not-owner' };
  }));
  const spy = { grant: [], plain: [] };
  const realGrant = store.mintGrantBootstrap.bind(store);
  store.mintGrantBootstrap = async (args) => { spy.grant.push(args); return realGrant(args); };
  const realCreate = store.createToken.bind(store);
  store.createToken = async (urlKey, opts) => { spy.plain.push(opts); return realCreate(urlKey, opts); };
  const items = [];
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: store,
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok', provider: 'linear' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        items.push(item);
        return { _id: `disp-${items.length}`, dispatchedAt: '2026-10-01T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { store, state, spy, items, app };
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

/** A dispatch-holding caller, minted and exchanged like a driver copy. */
async function dispatchCaller(w) {
  const bootstrap = await w.store.mintGrantBootstrap({
    urlKey: 'acme', workspaceId: WS, ownerAccountId: OWNER, grants: ['dispatch'], profile: 'worker'
  });
  const working = await w.store.exchangeBootstrapToken(bootstrap.token);
  w.spy.grant.length = 0;
  w.spy.plain.length = 0;
  return working.token;
}

const proseToken = (prompt) => (prompt.match(/Authorization: Bearer (\S+)" /) || [])[1];

describe('LIN-3136 M1 — a kickoff declares [dispatch] for its child', () => {
  for (const [mode, harness] of [['claude-code (MCP field)', undefined], ['opencode (prose)', 'opencode']]) {
    test(`${mode}: child bootstrap → readWrite + [dispatch] ≈48h, owner's, site M1; the child can enqueue`, async () => {
      const w = world();
      const caller = await dispatchCaller(w);

      const res = await call(w.app, 'post', KICKOFF, { token: caller, body: { goal: 'walk the stack', target: 'cli', ...(harness ? { harness } : {}) } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(w.items.length, 1);
      const item = w.items[0];

      assert.equal(w.spy.grant.length, 1, 'one declared mint');
      assert.equal(w.spy.plain.length, 0, 'no grant-less mint');
      assert.deepEqual(w.spy.grant[0], {
        urlKey: 'acme', workspaceId: WS, ownerAccountId: OWNER, grants: ['dispatch'], label: 'kickoff-bootstrap', profile: 'worker'
      });
      assert.equal(item.grantDeclaration.site, 'M1');
      assert.deepEqual(item.grantDeclaration.grants, ['dispatch']);
      assert.equal(item.grantDeclaration.ownerAccountId, OWNER);
      assert.equal(item.grantDeclaration.workspaceId, WS);

      const bootstrap = harness ? proseToken(item.prompt) : item.bootstrapToken;
      assert.ok(bootstrap, 'the child carries a bootstrap');
      const before = Date.now();
      const child = await w.store.exchangeBootstrapToken(bootstrap);
      assert.equal(child.scope, 'readWrite');
      assert.deepEqual(child.grants, ['dispatch'], 'the exchange copies the declaration and adds nothing');
      const ttl = (new Date(child.expiresAt).getTime() - before) / 1000;
      assert.ok(ttl > HOURS_48 - 5 && ttl <= HOURS_48 + 5, `worker 48h, got ${ttl}s`);
      assert.equal((await w.store.validateToken(child.token)).createdBy, OWNER);

      const enqueued = await call(w.app, 'post', '/api/proxy/dispatch', { token: child.token, body: { prompt: 'child work', kind: 'implementation' } });
      assert.equal(enqueued.status, 201, JSON.stringify(enqueued.body));
    });
  }

  test('appendProxyContext:false mints nothing and declares nothing', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    const res = await call(w.app, 'post', KICKOFF, { token: caller, body: { goal: 'walk', appendProxyContext: false } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(w.spy.grant.length + w.spy.plain.length, 0);
    assert.equal(w.items[0].grantDeclaration ?? null, null);
  });
});

describe('LIN-3136 M1 — refusals: nothing enqueued, nothing minted', () => {
  test('an un-granted readWrite caller → 403 DISPATCH_GRANT_REQUIRED at the gate (criterion 6)', async () => {
    const w = world();
    const { token } = await w.store.createToken('acme', { scope: 'readWrite', createdBy: OWNER });
    w.spy.plain.length = 0;
    const res = await call(w.app, 'post', KICKOFF, { token, body: { goal: 'walk' } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'DISPATCH_GRANT_REQUIRED');
    assert.equal(w.items.length, 0, 'no item');
    assert.equal(w.spy.grant.length + w.spy.plain.length, 0, 'no token minted');
  });

  test('a caller token with no stored workspace → 400 INVALID_GRANTS (fail closed, no urlKey fallback)', async () => {
    const w = world();
    // A grant-bearing row with no workspace binding (legacy or corrupt: the
    // normal mint always stores one). It passes the dispatch gate, so this is
    // M1's own fail-closed branch, not the gate's 403.
    const token = crypto.randomBytes(24).toString('hex');
    await w.store.collection.insertOne({
      _id: crypto.randomUUID(), urlKey: 'acme', tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      label: 'legacy', scope: 'readWrite', kind: 'standard', singleUse: false, createdBy: OWNER,
      grants: ['dispatch'], parentTokenId: null, workspaceId: null, createdAt: new Date(), lastUsedAt: null,
      expiresAt: null, consumed: false
    });
    w.spy.plain.length = 0;
    const res = await call(w.app, 'post', KICKOFF, { token, body: { goal: 'walk' } });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, 'INVALID_GRANTS');
    assert.equal(res.body.retryable, false);
    assert.doesNotMatch(res.body.error, /declared resume record/);
    assert.equal(w.items.length, 0);
    assert.equal(w.spy.grant.length + w.spy.plain.length, 0);
  });

  test('ownership changed since the caller was minted → 403 GRANT_OWNER_ONLY with the shared text', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    w.state.owners[WS] = 'account-B';
    const res = await call(w.app, 'post', KICKOFF, { token: caller, body: { goal: 'walk' } });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.deepEqual(res.body, {
      error: "Only this workspace's owner can mint a child autopilot launch credential",
      code: 'GRANT_OWNER_ONLY',
      retryable: false
    });
    assert.equal(w.items.length, 0);
    assert.equal(w.spy.plain.length, 0, 'never degrades to a grant-less mint');
  });

  test('owner-less workspace → 409 WORKSPACE_OWNER_UNSET', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    delete w.state.owners[WS];
    const res = await call(w.app, 'post', KICKOFF, { token: caller, body: { goal: 'walk' } });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'WORKSPACE_OWNER_UNSET');
    assert.equal(w.items.length, 0);
  });

  test('owner check unavailable → the existing transient 503', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    w.state.fault = true;
    const res = await call(w.app, 'post', KICKOFF, { token: caller, body: { goal: 'walk' } });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.error, PROXY_ATTACH_FAILED_MESSAGE);
    assert.equal(w.items.length, 0);
    assert.equal(w.spy.plain.length, 0);
  });
});

describe('LIN-3136 — leaf launches stay grant-less', () => {
  test('a plain POST /dispatch launch from a dispatch holder mints a grant-less child and declares nothing', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    const res = await call(w.app, 'post', '/api/proxy/dispatch', { token: caller, body: { prompt: 'leaf work', kind: 'implementation', appendProxyContext: true } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const item = w.items[0];
    assert.equal(w.spy.grant.length, 0, 'no declared mint for a leaf');
    assert.equal(item.grantDeclaration ?? null, null);
    const child = await w.store.exchangeBootstrapToken(item.bootstrapToken);
    assert.deepEqual(child.grants ?? [], []);
  });

  test('a plain POST /dispatch with kind autopilot also stays grant-less (M3 deferred to LIN-3099)', async () => {
    const w = world();
    const caller = await dispatchCaller(w);
    const res = await call(w.app, 'post', '/api/proxy/dispatch', { token: caller, body: { prompt: 'hand-written autopilot', kind: 'autopilot' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(w.spy.grant.length, 0);
    assert.equal(w.items[0].grantDeclaration ?? null, null);
  });
});
