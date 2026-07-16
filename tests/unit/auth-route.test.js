/**
 * Unit tests for routes/auth.js — the Linear OAuth callback, one of the five
 * sign-in paths LIN-1329 wires through `establishAccount`. Mirrors the
 * tests/unit/github-auth.test.js route-harness style: the router is under
 * test, not the network — a fake Linear provider drives it.
 *
 * Run with: node --test tests/unit/auth-route.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createAuthRoutes } from '../../routes/auth.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';

function fakeProvider(overrides = {}) {
  return {
    name: 'linear',
    beginAuth: ({ state }) => `https://linear.app/oauth/authorize?state=${state}`,
    completeAuth: async () => ({ access_token: 'lin_tok', refresh_token: 'lin_refresh', expires_in: 86400 }),
    fetchOrganization: async () => ({ id: 'org-1', name: 'Acme', urlKey: 'acme' }),
    fetchViewer: async () => ({ id: 'viewer-1' }),
    ...overrides,
  };
}

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    send(html) { this.body = html; return this; },
    redirect(url) { this.redirectedTo = url; return this; },
  };
}

function makeSession(initial = {}) {
  return {
    ...initial,
    save(cb) { if (cb) cb(); },
    regenerate(cb) {
      for (const k of Object.keys(this)) {
        if (typeof this[k] !== 'function') delete this[k];
      }
      cb();
    },
  };
}

describe('routes/auth.js — Linear OAuth callback', () => {
  let dbClient;
  let dbDir;
  let acctCounter = 0;
  let savedEnv;
  const ENV = ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'];

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'auth-route-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
    savedEnv = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    for (const k of ENV) process.env[k] = 'set';
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  function freshAccountStores() {
    const db = dbClient.db(`acct_${acctCounter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
  }

  test('callback establishes a durable account and sets session.accountId', async () => {
    const router = createAuthRoutes({ provider: fakeProvider(), sessionStore: { cleanup: async () => {} }, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real' });

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.redirectedTo, '/workspace/acme/');
    assert.strictEqual(session.workspaces.length, 1);
    assert.strictEqual(session.linearUserId, 'viewer-1');
    assert.ok(session.accountId, 'session.accountId set by establishAccount');
  });

  test('a returning user (fresh session, previously-seen viewer.id) lands on their EXISTING account, not a new one', async () => {
    const stores = freshAccountStores();
    const router = createAuthRoutes({ provider: fakeProvider(), sessionStore: { cleanup: async () => {} }, ...stores });
    const handler = getHandler(router, 'get', '/auth/callback');

    const firstSession = makeSession({ oauthState: 'real' });
    await handler({ query: { code: 'good-code', state: 'real' }, session: firstSession }, makeRes());
    const firstAccountId = firstSession.accountId;
    assert.ok(firstAccountId);

    // A brand-new session (logged out / new device) signing in with the SAME
    // Linear identity.
    const secondSession = makeSession({ oauthState: 'real' });
    await handler({ query: { code: 'good-code', state: 'real' }, session: secondSession }, makeRes());

    assert.strictEqual(secondSession.accountId, firstAccountId);
  });

  // NOTE: the 409 Account Conflict branch (an identity already owned by a
  // DIFFERENT account than the current session) is not separately exercised
  // here: session.regenerate() unconditionally wipes session.accountId before
  // establishAccount runs, and Linear has no "add-source" mode yet (unlike
  // GitHub) — so from this route's own entry points, a fresh session can only
  // ever REUSE an already-owned identity (the returning-user case above),
  // never conflict against one. The conflict signal itself, and the route's
  // handling of it, are covered at the seam level in account-session.test.js
  // and github-auth.test.js/github-projects-auth.test.js (whose add-source
  // mode can reach it).

  test('rejects a mismatched OAuth state (CSRF guard) before any account work', async () => {
    const router = createAuthRoutes({ provider: fakeProvider(), sessionStore: { cleanup: async () => {} }, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real' });

    await handler({ query: { code: 'good-code', state: 'attacker' }, session }, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(session.accountId, undefined);
  });

  // LIN-1349: at MAX_WORKSPACES, the upsertWorkspace limit check must run BEFORE
  // establishAccount, so a refused workspace never gets a durable account↔workspace
  // binding written for it (previously establishAccount ran first and left a
  // binding in place even though the user was shown a 400).
  test('at the workspace limit, sign-in is rejected 400 and writes NO account↔workspace binding (LIN-1349)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createAuthRoutes({ provider: fakeProvider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const existingWorkspaces = Array.from({ length: 10 }, (_, i) => ({ id: `ws-${i}`, name: `Workspace ${i}`, urlKey: `ws-${i}`, addedAt: Date.now() }));
    const session = makeSession({ oauthState: 'real', workspaces: existingWorkspaces });

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body, /Workspace Limit Reached/);
    // The crux: establishAccount never ran, so no binding exists for the refused workspace.
    assert.deepEqual(await accountWorkspaceStore.listAccountsForWorkspace('org-1'), []);
    assert.strictEqual(session.accountId, undefined);
  });
});
