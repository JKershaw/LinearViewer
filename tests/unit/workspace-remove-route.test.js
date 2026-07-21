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
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceRoutes } from '../../routes/workspace.js';
import { workspaceTokenCacheKey } from '../../lib/workspace-token-cache.js';

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

function makeHandler(evictWorkspaceToken) {
  const router = createWorkspaceRoutes({ evictWorkspaceToken });
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
