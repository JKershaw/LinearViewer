/**
 * Unit tests for routes/auth.js's /logout — LIN-1507 witness D(i).
 *
 * Behavioural, not asserted: drives the real route handler with a FAKE
 * evictor and asserts the exact key strings it receives, rather than
 * asserting the handler "calls evict()". Also pins the beat-3 decision on
 * the owner-blind `urlKey::*` key (see lib/workspace-token-cache.js's
 * evictWorkspaceTokenPair doc comment for the full reasoning): logout must
 * evict BOTH the owner-scoped key and the legacy owner-blind key for every
 * workspace the session referenced, because getWorkspaceAccessToken
 * (server.js) resolves owner-blind for routes/dashboard.js's lazy
 * hydration, routes/proxy.js, and routes/test.js, and that path's selector
 * can select the very session's own token.
 *
 * Run with: node --test tests/unit/auth-logout-route.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthRoutes } from '../../routes/auth.js';
import { workspaceTokenCacheKey } from '../../lib/workspace-token-cache.js';

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    redirectedTo: null,
    redirect(url) { this.redirectedTo = url; },
  };
}

function makeSession(initial = {}) {
  return {
    ...initial,
    destroyed: false,
    destroy(cb) { this.destroyed = true; cb(); },
  };
}

function makeLogoutHandler(evictWorkspaceToken) {
  const router = createAuthRoutes({ sessionStore: { cleanup: async () => {} }, evictWorkspaceToken });
  return getHandler(router, 'get', '/logout');
}

describe('routes/auth.js — /logout eviction (LIN-1507, witness D(i))', () => {
  test('evicts BOTH the owner-scoped key and the owner-blind (::*) key for each workspace', () => {
    const evicted = [];
    const handler = makeLogoutHandler((key) => evicted.push(key));
    const session = makeSession({
      accountId: 'acct-1',
      workspaces: [{ urlKey: 'acme' }, { urlKey: 'beta' }],
    });
    const res = makeRes();

    handler({ session }, res);

    assert.deepEqual(new Set(evicted), new Set([
      workspaceTokenCacheKey('acme', 'acct-1'),
      workspaceTokenCacheKey('acme'), // the '::*' key — pinned deliberately, see file header
      workspaceTokenCacheKey('beta', 'acct-1'),
      workspaceTokenCacheKey('beta'),
    ]));
    assert.equal(evicted.length, 4, 'exactly one scoped + one unscoped key per workspace, no duplicates/extras');
  });

  test('captures accountId + workspaces BEFORE destroy() — survives a destroy() that wipes session data first', () => {
    const evicted = [];
    const router = createAuthRoutes({ sessionStore: { cleanup: async () => {} }, evictWorkspaceToken: (key) => evicted.push(key) });
    const handler = getHandler(router, 'get', '/logout');
    // A destroy() that synchronously clears session fields BEFORE invoking its
    // callback, mirroring a real store's post-destroy state — this would
    // return no data if the handler captured accountId/workspaces AFTER
    // calling destroy() instead of before.
    const session = {
      accountId: 'acct-1',
      workspaces: [{ urlKey: 'acme' }],
      destroy(cb) {
        this.accountId = undefined;
        this.workspaces = undefined;
        cb();
      },
    };
    const res = makeRes();

    handler({ session }, res);

    assert.deepEqual(evicted, [
      workspaceTokenCacheKey('acme', 'acct-1'),
      workspaceTokenCacheKey('acme'),
    ]);
  });

  test('no workspaces on the session evicts nothing, and still destroys + redirects', () => {
    const evicted = [];
    const handler = makeLogoutHandler((key) => evicted.push(key));
    const session = makeSession({ accountId: 'acct-1' });
    const res = makeRes();

    handler({ session }, res);

    assert.deepEqual(evicted, []);
    assert.ok(session.destroyed);
    assert.equal(res.redirectedTo, '/');
  });

  test('an absent evictWorkspaceToken dependency (legacy direct construction) does not throw', () => {
    const handler = makeLogoutHandler(undefined);
    const session = makeSession({ accountId: 'acct-1', workspaces: [{ urlKey: 'acme' }] });
    const res = makeRes();

    assert.doesNotThrow(() => handler({ session }, res));
    assert.ok(session.destroyed);
    assert.equal(res.redirectedTo, '/');
  });

  test('still destroys the session and redirects home regardless of eviction', () => {
    const handler = makeLogoutHandler(() => {});
    const session = makeSession({ accountId: 'acct-1', workspaces: [{ urlKey: 'acme' }] });
    const res = makeRes();

    handler({ session }, res);

    assert.ok(session.destroyed);
    assert.equal(res.redirectedTo, '/');
  });
});
