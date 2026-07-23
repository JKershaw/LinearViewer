/**
 * Unit tests for POST /workspace/:urlKey/remove — LIN-1507 witness D(i).
 *
 * Behavioural, not asserted: drives the real route handler with a FAKE
 * evictor and asserts the exact key strings it receives. Covers both
 * branches of the handler:
 *   - remove-LAST-workspace (session.workspaces.length <= 1): a logout by
 *     another name — session.destroy(), same both-keys treatment as
 *     routes/auth.js's /logout (see tests/unit/auth-logout-route.test.js
 *     and lib/workspace-token-cache.js's evictWorkspaceTokenPair doc).
 *   - remove-ONE-OF-MANY: the session survives, so only that one
 *     workspace's key pair is evicted — siblings must be left alone.
 *
 * Run with: node --test tests/unit/workspace-remove-route.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createWorkspaceRoutes } from '../../routes/workspace.js';
import { workspaceTokenCacheKey } from '../../lib/workspace-token-cache.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';

function getHandler(router) {
  const layer = router.stack.find(l => l.route?.path === '/workspace/:urlKey/remove' && l.route.methods.post);
  assert.ok(layer, 'POST /workspace/:urlKey/remove route is registered');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    redirectedTo: null,
    statusCode: 200,
    sentBody: null,
    redirect(url) { this.redirectedTo = url; },
    status(code) { this.statusCode = code; return this; },
    send(b) { this.sentBody = b; return this; },
  };
}

function makeSession(initial = {}) {
  return {
    ...initial,
    destroyed: false,
    destroy(cb) { this.destroyed = true; cb(); },
    save(cb) { if (cb) cb(); },
  };
}

function makeHandler(evictWorkspaceToken, extraDeps = {}) {
  const router = createWorkspaceRoutes({ evictWorkspaceToken, ...extraDeps });
  return getHandler(router);
}

describe('POST /workspace/:urlKey/remove eviction (LIN-1507, witness D(i))', () => {
  test('remove-last-workspace: evicts both keys for every workspace, then destroys the session', async () => {
    const evicted = [];
    const handler = makeHandler((key) => evicted.push(key));
    const session = makeSession({
      accountId: 'acct-1',
      workspaces: [{ id: 'ws-1', urlKey: 'acme' }],
      activeWorkspaceId: 'ws-1',
    });
    const res = makeRes();

    await handler({ params: { urlKey: 'acme' }, session }, res);

    assert.deepEqual(new Set(evicted), new Set([
      workspaceTokenCacheKey('acme', 'acct-1'),
      workspaceTokenCacheKey('acme'),
    ]));
    assert.equal(evicted.length, 2);
    assert.ok(session.destroyed, 'the only-workspace-left branch is session.destroy()');
    assert.equal(res.redirectedTo, '/');
  });

  test('remove-one-of-many: evicts ONLY the removed workspace\'s key pair — siblings untouched', async () => {
    const evicted = [];
    const handler = makeHandler((key) => evicted.push(key));
    const session = makeSession({
      accountId: 'acct-1',
      workspaces: [
        { id: 'ws-1', urlKey: 'acme' },
        { id: 'ws-2', urlKey: 'beta' },
      ],
      activeWorkspaceId: 'ws-1',
    });
    const res = makeRes();

    await handler({ params: { urlKey: 'acme' }, session }, res);

    assert.deepEqual(new Set(evicted), new Set([
      workspaceTokenCacheKey('acme', 'acct-1'),
      workspaceTokenCacheKey('acme'),
    ]));
    assert.equal(evicted.length, 2, 'no key for the sibling workspace (beta) was evicted');
    assert.ok(!session.destroyed, 'the session survives when other workspaces remain');
    assert.equal(res.redirectedTo, '/workspace/beta/');
  });

  test('an absent evictWorkspaceToken dependency does not throw on either branch', async () => {
    const handlerNoDeps = makeHandler(undefined);

    const lastWsSession = makeSession({ accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }], activeWorkspaceId: 'ws-1' });
    await assert.doesNotReject(() => handlerNoDeps({ params: { urlKey: 'acme' }, session: lastWsSession }, makeRes()));

    const manyWsSession = makeSession({
      accountId: 'acct-1',
      workspaces: [{ id: 'ws-1', urlKey: 'acme' }, { id: 'ws-2', urlKey: 'beta' }],
      activeWorkspaceId: 'ws-1',
    });
    await assert.doesNotReject(() => handlerNoDeps({ params: { urlKey: 'acme' }, session: manyWsSession }, makeRes()));
  });

  test('an invalid urlKey 400s before any eviction is attempted', async () => {
    const evicted = [];
    const handler = makeHandler((key) => evicted.push(key));
    const session = makeSession({ accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }] });
    const res = makeRes();

    await handler({ params: { urlKey: 'not valid!' }, session }, res);

    assert.deepEqual(evicted, []);
    assert.equal(res.statusCode, 400);
  });

  test('removing an unknown workspace 404s and evicts nothing', async () => {
    const evicted = [];
    const handler = makeHandler((key) => evicted.push(key));
    const session = makeSession({
      accountId: 'acct-1',
      workspaces: [{ id: 'ws-1', urlKey: 'acme' }, { id: 'ws-2', urlKey: 'beta' }],
      activeWorkspaceId: 'ws-1',
    });
    const res = makeRes();

    await handler({ params: { urlKey: 'ghost' }, session }, res);

    assert.deepEqual(evicted, []);
    assert.equal(res.statusCode, 404);
  });
});

describe('POST /workspace/:urlKey/remove durable deletion (LIN-1523)', () => {
  let dbClient;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'workspace-remove-route-durable-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshCredentialStore() {
    const db = dbClient.db(`ocs_${counter++}`);
    return new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
  }

  test('remove-last-workspace: the durable record is gone after the destroy() path', async () => {
    const ownerCredentialStore = freshCredentialStore();
    await ownerCredentialStore.put('acct-1', 'acme', { provider: 'linear', scope: 'org-1', token: 't', refreshToken: 'r', tokenExpiresAt: 123 });
    const handler = makeHandler(undefined, { ownerCredentialStore });
    const session = makeSession({ accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }], activeWorkspaceId: 'ws-1' });

    await handler({ params: { urlKey: 'acme' }, session }, makeRes());

    assert.equal(await ownerCredentialStore.get('acct-1', 'acme'), null, 'durable record must be gone after the last-workspace disconnect');
  });

  test('remove-one-of-many: the removed workspace\'s durable record is gone, but a SIBLING workspace\'s record is intact — deletion is scoped, not account-wide', async () => {
    const ownerCredentialStore = freshCredentialStore();
    await ownerCredentialStore.put('acct-1', 'acme', { provider: 'linear', scope: 'org-1', token: 't-acme', refreshToken: 'r-acme', tokenExpiresAt: 123 });
    await ownerCredentialStore.put('acct-1', 'beta', { provider: 'linear', scope: 'org-2', token: 't-beta', refreshToken: 'r-beta', tokenExpiresAt: 456 });
    const handler = makeHandler(undefined, { ownerCredentialStore });
    const session = makeSession({
      accountId: 'acct-1',
      workspaces: [{ id: 'ws-1', urlKey: 'acme' }, { id: 'ws-2', urlKey: 'beta' }],
      activeWorkspaceId: 'ws-1',
    });

    await handler({ params: { urlKey: 'acme' }, session }, makeRes());

    assert.equal(await ownerCredentialStore.get('acct-1', 'acme'), null, 'the disconnected workspace\'s durable record must be gone');
    const sibling = await ownerCredentialStore.get('acct-1', 'beta');
    assert.ok(sibling, 'the sibling workspace\'s durable record must survive');
    assert.equal(sibling.refreshToken, 'r-beta');
  });

  test('an absent ownerCredentialStore dependency does not throw on either branch (mirrors the evictWorkspaceToken precedent above)', async () => {
    const handlerNoDeps = makeHandler(undefined, {});

    const lastWsSession = makeSession({ accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }], activeWorkspaceId: 'ws-1' });
    await assert.doesNotReject(() => handlerNoDeps({ params: { urlKey: 'acme' }, session: lastWsSession }, makeRes()));

    const manyWsSession = makeSession({
      accountId: 'acct-1',
      workspaces: [{ id: 'ws-1', urlKey: 'acme' }, { id: 'ws-2', urlKey: 'beta' }],
      activeWorkspaceId: 'ws-1',
    });
    await assert.doesNotReject(() => handlerNoDeps({ params: { urlKey: 'acme' }, session: manyWsSession }, makeRes()));
  });

  test('the store-level delete is a no-op on a record that is not there — no throw (beat 2 store method, exercised at this call site)', async () => {
    const ownerCredentialStore = freshCredentialStore();
    const handler = makeHandler(undefined, { ownerCredentialStore });
    const session = makeSession({ accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }], activeWorkspaceId: 'ws-1' });

    await assert.doesNotReject(() => handler({ params: { urlKey: 'acme' }, session }, makeRes()));
    assert.equal(await ownerCredentialStore.get('acct-1', 'acme'), null);
  });
});
