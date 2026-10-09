/**
 * LIN-3125 Phase 3 — held NEW workspace (D-F3/F8, C2, L4).
 *
 * Drives the REAL `routes/held-connection.js` `mode=new` POST against a REAL
 * ConnectionStore + AccountWorkspaceStore (MangoDB) with the REAL
 * `convertToConnectionBacked`/`persistBinding` seam and the REAL
 * `bindAccountToWorkspace` owner edge. Proves the §D-F3/F8 sequence:
 *   - the container is built with `provider`, so `activeBinding` flips and the
 *     persisted binding is `{provider, scope, connectionId}` with no credentials;
 *   - the owner edge is written (F8) with NO `establishAccount` and NO
 *     `identityAuthenticatedAt` stamp;
 *   - the limit page is the shared one, with zero writes / no referent;
 *   - a persist failure restores the session through the REAL caller (L4/F3);
 *   - an owner-edge failure compensates the referent and restores the session
 *     (C2): no bound, ownerless workspace survives;
 *   - D11 off is a retryable page with zero writes;
 *   - the `server.js` reader binding is pinned by driving hook -> picker through
 *     the SAME factory `server.js` uses (`createAuthorizedAccountConnectionReader`).
 *
 * Run with: node --test tests/unit/lin-3125-persist-held.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createHeldConnectionRoutes } from '../../routes/held-connection.js';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { ConnectionStore } from '../../lib/connection-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { convertToConnectionBacked, createAuthorizedAccountConnectionReader, heldConnectionCredentials } from '../../lib/connection-credential.js';
import { renderWorkspaceLimitPage } from '../../lib/render-pages.js';
import { loadStrippedSources } from '../fixtures/connection-access-guards.js';
import { withResolver } from './lin-3382-resolver-harness.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG', 'CONNECTION_BACKED_WRITES'];
const ACCT = 'acct-1';
const INSTALL = '77';
// LIN-3382: held-new keys come from the resolver (`gh-<name>-<installationId>`), no longer the bare repo name.
const NEW_KEY = `gh-a-${INSTALL}`;
const CONN_ID = `${ACCT}::github::${INSTALL}`;

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function makeRes() {
  return { statusCode: 200, body: null, redirectedTo: null, status(c){this.statusCode=c;return this;}, send(h){this.body=h;return this;}, redirect(u){this.redirectedTo=u;return this;} };
}
function makeSession(over = {}) {
  return {
    accountId: ACCT,
    identityAuthenticatedAt: 111,
    workspaces: [{ id: 'w0', urlKey: 'base', bindings: [{ provider: 'linear', scope: 'org' }] }],
    heldEntry: { provider: 'github', mode: 'new', workspaceUrlKey: null, beginUrl: '/auth/github' },
    save(cb) { if (cb) cb(); },
    ...over,
  };
}
function githubProvider({ scopes } = {}) {
  return {
    name: 'github', scopeType: 'repository', ui: { displayName: 'GitHub Issues' },
    supports: (m) => m === 'listConnectionScopes',
    beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?state=${state}`,
    async listConnectionScopes() { return scopes ?? [{ slug: 'octo/a', name: 'octo/a', private: false, installationId: INSTALL }] },
    heldScopeView(item = {}) { const v = { scope: item.slug, label: item.name, installationId: item.installationId }; if (item.private) v.detail = 'private'; return v; },
  };
}
const fakeAccountStore = { resolveCanonicalAccountId: async (id) => id, getAccount: async () => null, listEmailIdentities: async () => [] };

describe('LIN-3125 Phase 3 — held new workspace', () => {
  let dir;
  let client;
  let n = 0;
  let savedEnv;

  before(async () => {
    savedEnv = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    Object.assign(process.env, { GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 's', GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: RSA_PEM, GITHUB_APP_SLUG: 'app' });
    dir = mkdtempSync(join(tmpdir(), 'lin3125-new-'));
    client = new MangoClient(dir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  });
  beforeEach(() => { delete process.env.CONNECTION_BACKED_WRITES; });
  afterEach(() => { delete process.env.CONNECTION_BACKED_WRITES; });

  async function stores() {
    const db = client.db(`new_${n++}`);
    const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
    const accountWorkspaceStore = new AccountWorkspaceStore({ collection: db.collection('account-workspaces') });
    await connectionStore.collection.insertOne({ _id: CONN_ID, accountId: ACCT, provider: 'github', unitId: INSTALL, origin: 'github', referents: [], credentials: { token: 'ghs_fresh', installationId: INSTALL, tokenExpiresAt: Date.now() + 3600_000 } });
    return { connectionStore, accountWorkspaceStore };
  }

  function buildRoute(connectionStore, accountWorkspaceStore, { provider = githubProvider(), writes = true, writesFn, convert = convertToConnectionBacked } = {}) {
    return createHeldConnectionRoutes({ ...withResolver(),
      resolveProvider: () => provider,
      connectionStore,
      accountWorkspaceStore,
      listAuthorizedAccountConnections: createAuthorizedAccountConnectionReader({ connectionStore }),
      heldConnectionCredentials,
      connectionBackedWritesEnabled: writesFn || (() => writes),
      convertToConnectionBacked: convert,
      resolveCanonicalAccountId: (id) => id,
    });
  }

  /**
   * L4 (D7): a real `AccountWorkspaceStore` whose owner-mark `updateOne` throws
   * (code 91). `_markOwnerIfFirstEdge` swallows it and returns false, so
   * `bindAccountToWorkspace` returns the just-inserted edge WITHOUT
   * `role:'owner'` — the exact "failed owner mark" shape the route must catch.
   */
  function roleMarkThrowingStore(realStore) {
    const collection = new Proxy(realStore.collection, {
      get(target, prop) {
        if (prop === 'updateOne') {
          return async (filter, update, opts) => {
            if (update?.$set?.role === 'owner') throw Object.assign(new Error('owner mark down'), { code: 91 });
            return target.updateOne(filter, update, opts);
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return new AccountWorkspaceStore({ collection });
  }

  async function runToOffer(route, session) {
    const res = makeRes();
    await getHandler(route, 'get', '/connect/:provider/held')({ params: { provider: 'github' }, session }, res);
    return res;
  }
  async function bind(route, session, body) {
    const res = makeRes();
    await getHandler(route, 'post', '/connect/:provider/held/bind')({ params: { provider: 'github' }, session, body }, res);
    return res;
  }

  test('mode=new success: provider + activeBinding set, credential-free binding, owner edge, no freshness stamp', async () => {
    const { connectionStore, accountWorkspaceStore } = await stores();
    const route = buildRoute(connectionStore, accountWorkspaceStore);
    const session = makeSession();
    await runToOffer(route, session);
    const res = await bind(route, session, { repo: 'octo/a' });

    assert.equal(res.redirectedTo, `/workspace/${NEW_KEY}/`);
    assert.equal(session.workspaces.length, 2, 'one new container');
    const ws = session.workspaces.find(w => w.urlKey === NEW_KEY);
    assert.ok(ws, 'new workspace exists');
    assert.equal(ws.provider, 'github', 'provider set on the container (F3)');
    assert.deepEqual(ws.activeBinding, { provider: 'github', scope: 'octo/a' }, 'activeBinding flipped');
    const binding = ws.bindings.find(b => b.scope === 'octo/a');
    assert.deepEqual(binding, { provider: 'github', scope: 'octo/a', connectionId: CONN_ID });
    assert.ok(!('credentials' in binding), 'no credentials on the binding');
    assert.ok(!('credentials' in ws) && !('accessToken' in ws), 'no scalar mirror');

    const owner = await accountWorkspaceStore.getWorkspaceOwnerAccountId(ws.id, fakeAccountStore);
    assert.equal(owner, ACCT, 'owner edge written (F8)');

    assert.equal(session.identityAuthenticatedAt, 111, 'no freshness stamp');
    assert.equal(session.accountId, ACCT, 'accountId untouched (no establishAccount)');
    assert.deepEqual(session.providerAdded, { provider: 'github', scope: 'octo/a' });
    assert.equal(session.heldEntry, undefined, 'heldEntry cleared');

    const row = await connectionStore.collection.findOne({ _id: CONN_ID });
    assert.deepEqual(row.referents, [{ urlKey: NEW_KEY, provider: 'github', scope: 'octo/a' }]);
  });

  test('mode=new limit: identical Workspace Limit Reached page, zero writes, no referent', async () => {
    const { connectionStore, accountWorkspaceStore } = await stores();
    const route = buildRoute(connectionStore, accountWorkspaceStore);
    const full = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, urlKey: `w${i}`, bindings: [] }));
    const session = makeSession({ workspaces: full });
    await runToOffer(route, session);
    const res = await bind(route, session, { repo: 'octo/a' });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body, renderWorkspaceLimitPage(), 'the shared limit page verbatim');
    assert.equal(session.workspaces.length, 10, 'session workspaces unchanged');
    const row = await connectionStore.collection.findOne({ _id: CONN_ID });
    assert.deepEqual(row.referents, [], 'no referent written');
    assert.equal(await accountWorkspaceStore.collection.countDocuments({}), 0, 'no owner edge');
  });

  test('mode=new persist failure: F3 restore through the REAL caller (L4 copy)', async () => {
    const { connectionStore, accountWorkspaceStore } = await stores();
    const failingConvert = async () => ({ connectionBacked: false, error: 'retryable', finalize: async () => false });
    const route = buildRoute(connectionStore, accountWorkspaceStore, { convert: failingConvert });
    const session = makeSession();
    await runToOffer(route, session);
    const res = await bind(route, session, { repo: 'octo/a' });

    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Connection Not Saved/);
    assert.equal(session.workspaces.length, 1, 'the upserted container was restored away');
    assert.equal(session.workspaces.find(w => w.urlKey === NEW_KEY), undefined);
    const row = await connectionStore.collection.findOne({ _id: CONN_ID });
    assert.deepEqual(row.referents, [], 'no referent');
  });

  test('C2/F8 owner-edge failure: referent compensated, session restored, no ownerless workspace', async () => {
    const { connectionStore, accountWorkspaceStore } = await stores();
    const throwingStore = { bindAccountToWorkspace: async () => { throw new Error('edge write down'); } };
    const route = buildRoute(connectionStore, throwingStore);
    const session = makeSession();
    await runToOffer(route, session);
    const res = await bind(route, session, { repo: 'octo/a' });

    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Connection Not Saved/);
    assert.equal(session.workspaces.length, 1, 'new workspace rolled back');
    assert.equal(session.workspaces.find(w => w.urlKey === NEW_KEY), undefined);
    const row = await connectionStore.collection.findOne({ _id: CONN_ID });
    assert.deepEqual(row.referents, [], 'referent removed by C2 compensation');
    assert.equal(session.providerAdded, undefined, 'no success flash on rollback');
    assert.ok(session.heldEntry, 'heldEntry kept for retry');
    // and the real edge store never got an edge for that id
    assert.equal(await accountWorkspaceStore.collection.countDocuments({}), 0);
  });

  test('L4 (D7) failed owner mark: role-less edge => 503, session restored, referent removed', async () => {
    const { connectionStore, accountWorkspaceStore } = await stores();
    const route = buildRoute(connectionStore, roleMarkThrowingStore(accountWorkspaceStore));
    const session = makeSession();
    await runToOffer(route, session);
    const res = await bind(route, session, { repo: 'octo/a' });

    assert.equal(res.statusCode, 503, 'a swallowed owner-mark failure is not success');
    assert.match(res.body, /Connection Not Saved/);
    assert.equal(session.workspaces.length, 1, 'new workspace rolled back');
    assert.equal(session.workspaces.find(w => w.urlKey === NEW_KEY), undefined, 'no bound, ownerless workspace survives');
    const row = await connectionStore.collection.findOne({ _id: CONN_ID });
    assert.deepEqual(row.referents, [], 'referent removed by C2 compensation');
    assert.ok(session.heldEntry, 'heldEntry kept for retry');
    // The unmarked edge insert did land, but never as an owner edge.
    const edges = await accountWorkspaceStore.collection.find({}).toArray();
    assert.equal(edges.length, 1, 'the role-less edge insert landed');
    assert.equal(edges[0].role, undefined, 'owner mark did not land');
  });

  test('D11 off at mode=new POST: retryable page, zero writes', async () => {
    const { connectionStore, accountWorkspaceStore } = await stores();
    const route = buildRoute(connectionStore, accountWorkspaceStore, { writes: false });
    const session = makeSession();
    const res = await bind(route, session, { repo: 'octo/a' });
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Connection Not Saved/);
    assert.equal(session.workspaces.length, 1);
    const row = await connectionStore.collection.findOne({ _id: CONN_ID });
    assert.deepEqual(row.referents, []);
  });

  test('L5 (D8) mode=new: predicate true at the route check, off at conversion => 503, no referent', async () => {
    const { connectionStore, accountWorkspaceStore } = await stores();
    const session = makeSession();
    await runToOffer(buildRoute(connectionStore, accountWorkspaceStore), session); // offer map, writes on
    let reads = 0;
    const writesFn = () => { reads += 1; return reads === 1; }; // route check true; converter read false
    const route = buildRoute(connectionStore, accountWorkspaceStore, { writesFn });
    const res = await bind(route, session, { repo: 'octo/a' });

    assert.equal(reads, 2, 'the predicate is read once at the route check and once at conversion');
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Connection Not Saved/);
    assert.equal(session.workspaces.length, 1, 'the upserted container was restored away');
    assert.equal(session.workspaces.find(w => w.urlKey === NEW_KEY), undefined);
    const row = await connectionStore.collection.findOne({ _id: CONN_ID });
    assert.deepEqual(row.referents, [], 'no referent');
  });

  // -------------------------------------------------------------------------
  // Server-wiring pin: hook -> picker through the SAME factory server.js uses
  // -------------------------------------------------------------------------
  test('server wiring: the bound reader drives hook -> picker end to end', async () => {
    const { connectionStore, accountWorkspaceStore } = await stores();
    // EXACTLY the construction server.js uses:
    //   const listAuthorizedAccountConnectionsFor = createAuthorizedAccountConnectionReader({ connectionStore })
    const reader = createAuthorizedAccountConnectionReader({ connectionStore });
    const provider = githubProvider();
    const flow = createGitHubAuthRoutes({ ...withResolver(), provider, accountStore: fakeAccountStore, accountWorkspaceStore, connectionStore, listAuthorizedAccountConnections: reader, connectionBackedWritesEnabled: () => true });

    const session = makeSession({ workspaces: [{ id: 'w0', urlKey: 'base', bindings: [] }], heldEntry: undefined });
    const res = makeRes();
    await getHandler(flow, 'get', '/auth/github')({ query: { mode: 'add-source', workspace: 'base', heldConnection: '1' }, session }, res);
    assert.equal(res.redirectedTo, '/connect/github/held', 'hook captured the marked entry');
    assert.ok(session.heldEntry, 'server-side intent stored');

    const route = buildRoute(connectionStore, accountWorkspaceStore, { provider });
    const pres = makeRes();
    await getHandler(route, 'get', '/connect/:provider/held')({ params: { provider: 'github' }, session }, pres);
    assert.match(pres.body, /octo\/a/, 'the bound reader reached the real store through the picker');
    assert.deepEqual(session.heldEntry.offered, { 'octo/a': CONN_ID });
  });

  test('server.js builds the reader with the shared factory (C1 wiring pinned)', () => {
    const src = loadStrippedSources().get('server.js');
    assert.match(src, /createAuthorizedAccountConnectionReader\(\{ connectionStore \}\)/, 'server.js must bind the reader via the factory');
  });
});
