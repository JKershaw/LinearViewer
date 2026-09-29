/**
 * LIN-3131 S2b.2 — the owner-checked `runner: true` copy mint on
 * `POST /workspace/:urlKey/api/proxy/tokens`.
 *
 * Drives the real `createProxyRoutes` chain over a REAL `ProxyTokenStore`,
 * mirroring tests/unit/proxy-token-route-ownerless.test.js. The per-IP creation
 * limiter is the module-scope singleton in routes/proxy.js, but it `skip`s
 * under NODE_ENV=test (set below before the import), so it is inert here; the
 * limiter itself is witnessed by tests/unit/lin-2534-tokens-admin-extraction.test.js.
 *
 * Covers, per the approved LIN-3059 plan (P4 S2b.2, P5) and LIN-3131's
 * description:
 *  - the runner mint: server-resolved grants `['take','dispatch']`, `runner`
 *    lifetime profile, ignored client `scope`/`label`;
 *  - each P5 refusal code, exact status + `retryable`, nothing written;
 *  - `GRANTS_NOT_CLIENT_SETTABLE` for any body carrying `grants`;
 *  - the DEFAULT path (no `runner`) byte-identical: same success shape,
 *    `providerDisplayName`, prompt-proxy 48h TTL, no grants key.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

const TOKENS_PATH = '/workspace/acme/api/proxy/tokens';

function createMockCollection() {
  let docs = [];
  const matches = (d, query) => Object.keys(query).every(k => {
    if (k === '$or') return query.$or.some(sub => matches(d, sub));
    const val = query[k];
    if (val && typeof val === 'object') {
      if ('$lt' in val && '$ne' in val) {
        return d[k] !== val.$ne && d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      }
      if ('$lt' in val) return d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      return true;
    }
    return d[k] === val;
  });
  return {
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query) {
      const before = docs.length;
      docs = docs.filter(d => !matches(d, query));
      return { deletedCount: before - docs.length };
    },
    find(query = {}) { return { toArray: async () => docs.filter(d => matches(d, query)) }; },
    _docs: () => docs
  };
}

const OWNER = async () => ({ status: 'owner' });

function harness({ ownerCheck = OWNER } = {}) {
  const collection = createMockCollection();
  const proxyTokenStore = new ProxyTokenStore({ collection });
  if (ownerCheck !== null) proxyTokenStore.setOwnerCheck(ownerCheck);
  return { collection, proxyTokenStore };
}

function buildApp({ proxyTokenStore, session, workspace }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = workspace || { urlKey: 'acme', id: 'ws-1', provider: 'linear' };
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

async function call(app, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${TOKENS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const session = (overrides = {}) => ({ accountId: 'account-A', features: { proxy: true }, ...overrides });

// ---------------------------------------------------------------------------
// Success — the runner mint
// ---------------------------------------------------------------------------

describe('LIN-3131 S2b.2 — runner: true mints the owner-checked runner bootstrap', () => {
  test('201 with server grants, runner profile/TTL, readWrite; stored owner/workspace/profile; exchangeable', async () => {
    const { collection, proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session() });

    const before = Date.now();
    const res = await call(app, { runner: true });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.kind, 'bootstrap');
    assert.equal(res.body.singleUse, true, 'a runner copy is a single-use bootstrap');
    assert.equal(res.body.scope, 'readWrite', 'the server resolves the scope, not the client');
    assert.deepEqual(res.body.grants, ['take', 'dispatch'], 'server-resolved runner grants');
    assert.equal(res.body.lifetimeProfile, 'runner');
    assert.ok(res.body.token && res.body.tokenId);

    const ttlSeconds = (new Date(res.body.expiresAt).getTime() - before) / 1000;
    assert.ok(ttlSeconds > 3599 && ttlSeconds <= 3601, `expected the 1h runner bootstrap TTL, got ${ttlSeconds}s`);

    const doc = collection._docs()[0];
    assert.equal(doc.createdBy, 'account-A');
    assert.equal(doc.workspaceId, 'ws-1', 'the workspace id is stamped for the exchange-time re-check');
    assert.equal(doc.lifetimeProfile, 'runner');
    assert.deepEqual(doc.grants, ['take', 'dispatch']);

    // It is a real, owner-checked, grant-bearing bootstrap.
    const working = await proxyTokenStore.exchangeBootstrapToken(res.body.token);
    assert.ok(working?.token, 'the runner bootstrap exchanges');
    assert.deepEqual(working.grants, ['take', 'dispatch']);
  });

  test('client scope and label are IGNORED (an over-long label is not rejected)', async () => {
    const { collection, proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session() });

    const res = await call(app, {
      runner: true,
      scope: 'read',
      label: 'x'.repeat(2000) // > MAX_NAME_LENGTH (1000): a default mint would 400 here
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.scope, 'readWrite', 'the client scope is ignored');
    assert.equal(res.body.label, 'default', 'the client label is ignored; the store default is used');
    assert.equal(collection._docs()[0].label, 'default');
  });

  test('the string form runner: "true" is honoured, like bootstrap', async () => {
    const { proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session() });
    const res = await call(app, { runner: 'true' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.grants, ['take', 'dispatch']);
  });
});

// ---------------------------------------------------------------------------
// L2 — the owner and workspace come from the session/route, never the body
//
// Review counselling (c50dfdd4 L2): mutation M8 (take `ownerAccountId` from
// `req.body` before the session) survived, because no test posted a body that
// DISAGREED with the session. These pin the authority source: the seam must be
// asked about the session account and the route-resolved workspace id, and a
// non-owner session cannot mint by naming the real owner in the body.
// ---------------------------------------------------------------------------

describe('LIN-3131 L2 — runner mint authority is session/workspace, never request body', () => {
  const OWNER = 'account-owner';
  // A realistic owner check: owner iff asked about the real owner account on the
  // route's workspace id. Body-supplied values are NOT the owner.
  const realisticOwnerCheck = async ({ workspaceId, accountId }) =>
    (workspaceId === 'ws-1' && accountId === OWNER) ? { status: 'owner' } : { status: 'not-owner' };

  test('L2/L4 success: every runner-mint authority is session/route-derived, never body-derived', async () => {
    let seamArgs;
    const { collection, proxyTokenStore } = harness({
      ownerCheck: async (args) => { seamArgs = args; return realisticOwnerCheck(args); }
    });
    const app = buildApp({ proxyTokenStore, session: session({ accountId: OWNER }) });

    // The body names a DIFFERENT owner, workspace, urlKey and lifetime profile.
    // Every one must be ignored: urlKey is the token's DATA authority, so a
    // body-supplied value would let workspace-A's owner mint a runner token
    // scoped to workspace B.
    const res = await call(app, {
      runner: true,
      ownerAccountId: 'attacker',
      workspaceId: 'other-ws',
      urlKey: 'other-key',
      profile: 'worker',
      lifetimeProfile: 'worker'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(
      [seamArgs.workspaceId, seamArgs.accountId],
      ['ws-1', OWNER],
      'the owner check is asked about the route workspace + the session account, not the body'
    );
    const doc = collection._docs()[0];
    assert.equal(doc.createdBy, OWNER, 'createdBy is the session account, never body ownerAccountId');
    assert.equal(doc.workspaceId, 'ws-1', 'workspaceId is the route workspace, never body workspaceId');
    assert.equal(doc.urlKey, 'acme', 'urlKey is the route workspace, never body urlKey');
    assert.equal(doc.lifetimeProfile, 'runner', 'the profile is the route constant, never body profile');
  });

  test('L2 disagreement: a non-owner session naming the real owner in the body is still refused GRANT_OWNER_ONLY', async () => {
    const { collection, proxyTokenStore } = harness({ ownerCheck: realisticOwnerCheck });
    // Session account 'account-A' is NOT the owner; the body claims it is.
    const app = buildApp({ proxyTokenStore, session: session() });

    const res = await call(app, { runner: true, ownerAccountId: OWNER, workspaceId: 'ws-1' });

    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNER_ONLY');
    assert.equal(collection._docs().length, 0, 'nothing is written on the refusal');
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes(OWNER), 'the refusal never echoes the body owner');
    assert.ok(!body.includes('ws-1') && !body.includes('other-ws'), 'nor a workspace id');
  });
});

// ---------------------------------------------------------------------------
// Refusals (P5) — one test per code
// ---------------------------------------------------------------------------

describe('LIN-3131 S2b.2 — runner mint refusals (P5), fail closed', () => {
  test('GRANT_OWNERLESS: a session with no accountId → 503, retryable false, nothing written', async () => {
    const { collection, proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session({ accountId: null }) });

    const res = await call(app, { runner: true });

    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNERLESS');
    assert.equal(res.body.retryable, false);
    assert.equal(collection._docs().length, 0, 'no token document may be written');
  });

  test('WORKSPACE_OWNER_UNSET: the workspace has no owner edge → 409, retryable false', async () => {
    const { collection, proxyTokenStore } = harness({ ownerCheck: async () => ({ status: 'no-owner' }) });
    const app = buildApp({ proxyTokenStore, session: session() });

    const res = await call(app, { runner: true });

    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'WORKSPACE_OWNER_UNSET');
    assert.equal(res.body.retryable, false);
    assert.equal(collection._docs().length, 0);
  });

  test('GRANT_OWNER_ONLY: another account owns the workspace → 403, retryable false, never names the owner', async () => {
    const { collection, proxyTokenStore } = harness({ ownerCheck: async () => ({ status: 'not-owner' }) });
    const app = buildApp({ proxyTokenStore, session: session() });

    const res = await call(app, { runner: true });

    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GRANT_OWNER_ONLY');
    assert.equal(res.body.retryable, false);
    assert.ok(!JSON.stringify(res.body).includes('account-'), 'the refusal never names an account id');
    assert.equal(collection._docs().length, 0);
  });

  test('OWNER_CHECK_UNAVAILABLE: an unwired seam → 503, retryable true', async () => {
    const { collection, proxyTokenStore } = harness({ ownerCheck: null }); // never setOwnerCheck
    const app = buildApp({ proxyTokenStore, session: session() });

    const res = await call(app, { runner: true });

    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'OWNER_CHECK_UNAVAILABLE');
    assert.equal(res.body.retryable, true);
    assert.equal(collection._docs().length, 0);
  });

  test('OWNER_CHECK_UNAVAILABLE: a throwing owner seam → 503, retryable true', async () => {
    const { collection, proxyTokenStore } = harness({
      ownerCheck: async () => { throw new Error('owner store down'); }
    });
    const app = buildApp({ proxyTokenStore, session: session() });

    const res = await call(app, { runner: true });

    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'OWNER_CHECK_UNAVAILABLE');
    assert.equal(res.body.retryable, true);
    assert.equal(collection._docs().length, 0);
  });
});

// ---------------------------------------------------------------------------
// GRANTS_NOT_CLIENT_SETTABLE — any path
// ---------------------------------------------------------------------------

describe('LIN-3131 S2b.2 — clients never name grants', () => {
  for (const [desc, body] of [
    ['runner, grants array', { runner: true, grants: ['take'] }],
    ['runner, grants empty', { runner: true, grants: [] }],
    ['runner, grants null', { runner: true, grants: null }],
    ['default path, grants array', { label: 'ordinary', grants: ['take', 'dispatch'] }],
    ['default path, grants as a string', { grants: 'take' }]
  ]) {
    test(`${desc} → 400 GRANTS_NOT_CLIENT_SETTABLE, nothing written`, async () => {
      const { collection, proxyTokenStore } = harness();
      const app = buildApp({ proxyTokenStore, session: session() });

      const res = await call(app, body);

      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.code, 'GRANTS_NOT_CLIENT_SETTABLE');
      assert.equal(collection._docs().length, 0, 'a refused body must not mint');
    });
  }
});

// ---------------------------------------------------------------------------
// Default path characterisation (no runner) — byte-identical
// ---------------------------------------------------------------------------

describe('LIN-3131 S2b.2 — the no-runner path is unchanged', () => {
  test('a prompt-proxy bootstrap mints exactly as before (shape + providerDisplayName + 48h TTL)', async () => {
    const { collection, proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session() });

    const before = Date.now();
    const res = await call(app, { label: 'prompt-proxy', scope: 'readWrite', bootstrap: true });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body).sort(), [
      'kind', 'label', 'message', 'providerDisplayName', 'scope', 'singleUse', 'success', 'token', 'tokenId'
    ].sort(), 'the default success body keeps exactly its existing keys');
    assert.equal(res.body.success, true);
    assert.equal(res.body.kind, 'bootstrap');
    assert.equal(res.body.label, 'prompt-proxy');
    assert.equal(res.body.scope, 'readWrite');
    assert.equal(res.body.singleUse, true);
    assert.equal(res.body.providerDisplayName, 'Linear');
    assert.match(res.body.message, /cannot be retrieved later/);

    // LIN-525 #5: prompt-proxy gets the 48h TTL (not the runner's 1h).
    const ttlSeconds = (new Date(collection._docs()[0].expiresAt).getTime() - before) / 1000;
    assert.ok(ttlSeconds > 48 * 3600 - 5 && ttlSeconds <= 48 * 3600 + 5, `expected the 48h prompt-proxy TTL, got ${ttlSeconds}s`);
  });

  test('a plain standard mint keeps its shape and carries no grants key', async () => {
    const { collection, proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session() });

    const res = await call(app, { label: 'ordinary', scope: 'read' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.kind, 'standard');
    assert.equal(res.body.scope, 'read');
    assert.equal(res.body.singleUse, false);
    assert.equal(res.body.label, 'ordinary');
    assert.equal(res.body.providerDisplayName, 'Linear');
    assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'grants'), false, 'the default body has no grants key');
    assert.equal(collection._docs()[0].createdBy, 'account-A');
  });

  test('an ownerless NON-bootstrap default mint still succeeds (runner gating does not leak)', async () => {
    const { proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session({ accountId: null }) });

    const res = await call(app, { label: 'ordinary', scope: 'read' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.kind, 'standard');
  });

  test('the proxy feature gate still runs first (403 before any runner verdict)', async () => {
    const { collection, proxyTokenStore } = harness();
    const app = buildApp({ proxyTokenStore, session: session({ accountId: null, features: { proxy: false } }) });

    const res = await call(app, { runner: true });

    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.match(res.body.error, /not enabled/i);
    assert.equal(collection._docs().length, 0);
  });
});
