/**
 * LIN-3421 witness — removing a workspace revokes the proxy tokens, dispatch
 * tokens and /t/ links the REMOVING account made for that urlKey, and nothing
 * else: another account's rows for the same key survive, runner (grant-bearing)
 * lineages go only for the workspace owner, ownerless dispatch rows stay.
 * Drives the real route handler through BOTH removal branches over real
 * MangoDB-backed stores.
 *
 * Run with: node --test tests/unit/lin-3421-workspace-removal-revocation.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createWorkspaceRoutes } from '../../routes/workspace.js';
import { createWorkspaceRemovalRevoker } from '../../lib/workspace-removal-revocation.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { TaskShareStore } from '../../lib/task-share-store.js';
import { withResolver } from './lin-3382-resolver-harness.js';

const KEY = 'acme';
const WS = 'ws-acme';

function getHandler(router) {
  const layer = router.stack.find(l => l.route?.path === '/workspace/:urlKey/remove' && l.route.methods.post);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const makeRes = () => ({ redirect() {}, status() { return this; }, send() { return this; } });
const makeSession = (initial) => ({ ...initial, destroy(cb) { cb(); }, save(cb) { if (cb) cb(); } });

describe('workspace removal revokes the removing account\'s artifacts (LIN-3421)', () => {
  let client, dir, n = 0;
  let proxy, dispatch, shares, ownerOf, revoker;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lin-3421-'));
    client = new MangoClient(dir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const db = client.db(`w${n++}`);
    proxy = new ProxyTokenStore({ collection: db.collection('proxy-tokens') });
    dispatch = new DispatchTokenStore({ collection: db.collection('dispatch-tokens') });
    shares = new TaskShareStore({ collection: db.collection('task_share_links') });
    ownerOf = 'acct-a';
    proxy.setOwnerCheck(async ({ accountId }) => ({ status: accountId === ownerOf ? 'owner' : 'not-owner' }));
    revoker = createWorkspaceRemovalRevoker({
      proxyTokenStore: proxy,
      dispatchTokenStore: dispatch,
      taskShareStore: shares,
      workspaceOwnerCheck: async ({ accountId }) => ({ status: accountId === ownerOf ? 'owner' : 'not-owner' }),
      resolveCanonicalAccountId: async (id) => id
    });
  });

  async function seed(accountId) {
    const p = await proxy.createToken(KEY, { label: `p-${accountId}`, createdBy: accountId, scope: 'readWrite' });
    const d = await dispatch.createToken(KEY, `d-${accountId}`, accountId);
    const l = await shares.create({ urlKey: KEY, workspaceId: WS, ownerAccountId: accountId, issueIdentifier: 'LIN-1' });
    return { proxy: p.token, dispatch: d.token, link: l.token };
  }
  const live = async (t) => ({
    proxy: !!(await proxy.validateToken(t.proxy)),
    dispatch: !!(await dispatch.validateToken(t.dispatch)),
    link: !!(await shares.getByToken(t.link))?.revokedAt === false
  });

  function route() {
    return getHandler(createWorkspaceRoutes({
      ...withResolver(),
      revokeWorkspaceArtifacts: (args) => revoker.revoke(args)
    }));
  }
  const oneWorkspace = (accountId) => makeSession({ accountId, workspaces: [{ id: WS, urlKey: KEY }], activeWorkspaceId: WS });
  const manyWorkspaces = (accountId) => makeSession({
    accountId, workspaces: [{ id: WS, urlKey: KEY }, { id: 'ws-b', urlKey: 'beta' }], activeWorkspaceId: WS
  });

  for (const [name, mkSession] of [['remove-last-workspace', oneWorkspace], ['remove-one-of-many', manyWorkspaces]]) {
    test(`${name}: A's tokens and link die, B's survive, a rebind does not revive A's`, async () => {
      const a = await seed('acct-a');
      const b = await seed('acct-b');
      assert.deepEqual(await live(a), { proxy: true, dispatch: true, link: true });

      await route()({ params: { urlKey: KEY }, session: mkSession('acct-a') }, makeRes());

      assert.deepEqual(await live(a), { proxy: false, dispatch: false, link: false });
      assert.deepEqual(await live(b), { proxy: true, dispatch: true, link: true });
      assert.ok((await shares.getByToken(a.link)).revokedAt, 'link is soft-revoked, not deleted');

      // A re-binds X: a fresh mint works, the old rows stay dead.
      const again = await seed('acct-a');
      assert.deepEqual(await live(again), { proxy: true, dispatch: true, link: true });
      assert.deepEqual(await live(a), { proxy: false, dispatch: false, link: false });
    });
  }

  test('a stale alias session also revokes rows under the canonical id', async () => {
    revoker = createWorkspaceRemovalRevoker({
      proxyTokenStore: proxy, dispatchTokenStore: dispatch, taskShareStore: shares,
      workspaceOwnerCheck: async () => ({ status: 'not-owner' }),
      resolveCanonicalAccountId: async (id) => (id === 'acct-old' ? 'acct-a' : id)
    });
    // Rows sit under the canonical id; the session still carries the stale alias.
    const old = await seed('acct-a');
    await route()({ params: { urlKey: KEY }, session: oneWorkspace('acct-old') }, makeRes());
    assert.deepEqual(await live(old), { proxy: false, dispatch: false, link: false });
    // canonical lookup failure falls back to the session account only
    revoker = createWorkspaceRemovalRevoker({
      proxyTokenStore: proxy, dispatchTokenStore: dispatch, taskShareStore: shares,
      resolveCanonicalAccountId: async () => { throw new Error('boom'); }
    });
    const a = await seed('acct-a');
    const counts = await revoker.revoke({ urlKey: KEY, workspaceId: WS, accountId: 'acct-a' });
    assert.equal(counts.dispatchTokens, 1);
    assert.deepEqual(await live(a), { proxy: false, dispatch: false, link: false });
  });

  test('other keys of the same account are untouched', async () => {
    const other = await dispatch.createToken('beta', 'x', 'acct-a');
    await seed('acct-a');
    await revoker.revoke({ urlKey: KEY, workspaceId: WS, accountId: 'acct-a' });
    assert.ok(await dispatch.validateToken(other.token));
  });

  test('ownerless dispatch rows are left alone', async () => {
    const ownerless = await dispatch.createToken(KEY, 'legacy', null);
    await seed('acct-a');
    await revoker.revoke({ urlKey: KEY, workspaceId: WS, accountId: 'acct-a' });
    assert.ok(await dispatch.validateToken(ownerless.token));
    assert.equal((await dispatch.listHolderRows(KEY)).length, 1);
  });

  describe('runner lineage is owner-only', () => {
    async function mintRunner(ownerAccountId) {
      const boot = await proxy.mintGrantBootstrap({ urlKey: KEY, workspaceId: WS, ownerAccountId, grants: ['take', 'dispatch'], label: 'runner' });
      const working = await proxy.exchangeBootstrapToken(boot.token);
      return { boot: boot.token, working: working.token };
    }

    test('the owner removing deletes bootstrap and exchanged working token', async () => {
      const r = await mintRunner('acct-a');
      assert.ok(await proxy.validateToken(r.working));
      await revoker.revoke({ urlKey: KEY, workspaceId: WS, accountId: 'acct-a' });
      assert.equal(await proxy.validateToken(r.working), null);
      assert.equal(await proxy.exchangeBootstrapToken(r.boot), null);
      assert.equal(await proxy.collection.countDocuments({ urlKey: KEY, createdBy: 'acct-a' }), 0);
    });

    test('a non-owner member removing keeps the owner\'s runner lineage and deletes only their own grant-less rows', async () => {
      const r = await mintRunner('acct-a');
      const member = await seed('acct-b');
      await revoker.revoke({ urlKey: KEY, workspaceId: WS, accountId: 'acct-b' });
      assert.ok(await proxy.validateToken(r.working));
      assert.equal(await proxy.validateToken(member.proxy), null);
    });

    test('a non-owner\'s own grant-bearing rows survive too (owner check is the removing account\'s)', async () => {
      const r = await mintRunner('acct-a');
      ownerOf = 'someone-else';
      await revoker.revoke({ urlKey: KEY, workspaceId: WS, accountId: 'acct-a' });
      assert.ok(await proxy.validateToken(r.working), 'not the owner any more: fail toward keeping the lineage');
    });

    for (const [label, check] of [
      ['owner check throws', async () => { throw new Error('down'); }],
      ['workspace has no owner', async () => ({ status: 'no-owner' })],
      ['owner check absent', undefined]
    ]) {
      test(`fails closed: ${label} keeps the lineage, still revokes grant-less rows`, async () => {
        const r = await mintRunner('acct-a');
        const plain = await seed('acct-a');
        revoker = createWorkspaceRemovalRevoker({
          proxyTokenStore: proxy, dispatchTokenStore: dispatch, taskShareStore: shares, workspaceOwnerCheck: check
        });
        await revoker.revoke({ urlKey: KEY, workspaceId: WS, accountId: 'acct-a' });
        assert.ok(await proxy.validateToken(r.working));
        assert.equal(await proxy.validateToken(plain.proxy), null);
      });
    }
  });

  test('one failing store does not block the others', async () => {
    const a = await seed('acct-a');
    revoker = createWorkspaceRemovalRevoker({
      proxyTokenStore: { revokeByCreator: async () => { throw new Error('proxy down'); } },
      dispatchTokenStore: dispatch,
      taskShareStore: shares
    });
    const counts = await revoker.revoke({ urlKey: KEY, workspaceId: WS, accountId: 'acct-a' });
    assert.equal(counts.proxyTokens, 0);
    assert.equal(counts.dispatchTokens, 1);
    assert.equal(counts.taskShareLinks, 1);
    assert.equal(await dispatch.validateToken(a.dispatch), null);
  });

  test('without the dependency the route removes as before (nothing extra revoked)', async () => {
    const a = await seed('acct-a');
    const handler = getHandler(createWorkspaceRoutes({ ...withResolver() }));
    await handler({ params: { urlKey: KEY }, session: oneWorkspace('acct-a') }, makeRes());
    assert.ok(await dispatch.validateToken(a.dispatch));
  });
});

describe('dispatch-token expiry (LIN-3421)', () => {
  let client, dir, store, collection;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lin-3421-exp-'));
    client = new MangoClient(dir);
    await client.connect();
    collection = client.db('d').collection('dispatch-tokens');
    store = new DispatchTokenStore({ collection });
  });
  after(async () => {
    if (client?.close) await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('default creates expiresAt: null and the token validates', async () => {
    const t = await store.createToken('k1', 'default-ttl', 'acct-a');
    assert.equal((await collection.findOne({ _id: t.tokenId })).expiresAt, null);
    assert.ok(await store.validateToken(t.token));
    assert.equal((await store.listTokens('k1'))[0].expiresAt, null);
  });

  test('a past expiresAt fails validation but the row still lists and still holds the key', async () => {
    const t = await store.createToken('k2', 'short', 'acct-a', { ttlSeconds: 60 });
    assert.ok(await store.validateToken(t.token), 'live before expiry');
    await collection.updateOne({ _id: t.tokenId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await store.validateToken(t.token), null);
    const listed = await store.listTokens('k2');
    assert.equal(listed.length, 1);
    assert.ok(listed[0].expiresAt, 'listing surfaces the expiry');
    assert.equal((await store.listHolderRows('k2')).length, 1);
    assert.equal(await collection.countDocuments({ _id: t.tokenId }), 1, 'never deleted on expiry');
  });

  test('a legacy row with no expiresAt field still validates', async () => {
    await collection.insertOne({ _id: 'legacy', urlKey: 'k3', tokenHash: store._hashToken('legacy-token'), label: 'old', createdBy: null, createdAt: new Date(), lastUsedAt: null });
    assert.ok(await store.validateToken('legacy-token'));
    assert.equal((await store.listTokens('k3'))[0].expiresAt, null);
  });

  test('constructor defaultTtlSeconds stamps new tokens; per-token null overrides', async () => {
    const s = new DispatchTokenStore({ collection, defaultTtlSeconds: 3600 });
    const t = await s.createToken('k4', 'x', 'acct-a');
    assert.ok((await collection.findOne({ _id: t.tokenId })).expiresAt > new Date());
    const forever = await s.createToken('k4', 'y', 'acct-a', { ttlSeconds: null });
    assert.equal((await collection.findOne({ _id: forever.tokenId })).expiresAt, null);
  });
});

describe('source pins (LIN-3421)', () => {
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

  test('hourly cleanup never touches dispatch tokens (expiry is validate-time only)', () => {
    assert.doesNotMatch(read('lib/hourly-cleanup.js'), /dispatch-?tokens?/i);
  });

  test('server.js builds taskShareStore before the workspace routes mount and passes the revoker', () => {
    const src = read('server.js');
    const built = src.indexOf('const taskShareStore = new TaskShareStore');
    const mount = src.indexOf('app.use(createWorkspaceRoutes(');
    assert.ok(built > -1 && mount > -1 && built < mount, 'taskShareStore is hoisted above the mount');
    assert.match(src.slice(mount, src.indexOf('\n', mount)), /revokeWorkspaceArtifacts/);
  });
});
