/**
 * Unit tests for lib/pat-session.js — the PAT (Personal Access Token) auto-login
 * middleware, one of the five sign-in paths LIN-1329 wires through
 * `establishAccount`. Extracted from server.js into its own factory precisely
 * so it can be exercised here without a running server.
 *
 * Run with: node --test tests/unit/pat-session.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createEnsurePATSession } from '../../lib/pat-session.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { ProviderInterface } from '../../lib/providers/interface.js';

// A minimal fake Linear provider — the middleware is under test, not the
// network. Registered under 'linear' so getProvider('linear') resolves it.
class FakeLinearProvider extends ProviderInterface {
  constructor() {
    super();
    this.name = 'linear';
  }
  async fetchOrganization() {
    return { id: 'org-1', name: 'Acme', urlKey: 'acme' };
  }
  async fetchViewer() {
    return { id: 'viewer-1' };
  }
}

function makeSession(initial = {}) {
  return { ...initial, save(cb) { if (cb) cb(); } };
}

function makeReqRes({ path = '/', session = makeSession() } = {}) {
  const req = { path, session };
  const res = {};
  return { req, res };
}

describe('createEnsurePATSession', () => {
  let dbClient;
  let dbDir;
  let counter = 0;
  let savedPat;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'pat-session-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
    registerProvider(new FakeLinearProvider());
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    savedPat = process.env.LINEAR_ACCESS_TOKEN;
    process.env.LINEAR_ACCESS_TOKEN = 'lin_api_test';
  });

  afterEach(() => {
    if (savedPat === undefined) delete process.env.LINEAR_ACCESS_TOKEN;
    else process.env.LINEAR_ACCESS_TOKEN = savedPat;
  });

  function freshStores() {
    const db = dbClient.db(`acct_${counter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
  }

  test('no-op when LINEAR_ACCESS_TOKEN is unset', async () => {
    delete process.env.LINEAR_ACCESS_TOKEN;
    const middleware = createEnsurePATSession(freshStores());
    const { req, res } = makeReqRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.session.workspaces, undefined);
  });

  test('no-op when the session already has workspaces', async () => {
    const middleware = createEnsurePATSession(freshStores());
    const { req, res } = makeReqRes({ session: makeSession({ workspaces: [{ id: 'x' }] }) });
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.session.workspaces.length, 1, 'existing workspace untouched');
  });

  test('creates a PAT workspace and establishes a durable account (LIN-1332: no session.linearUserId)', async () => {
    const middleware = createEnsurePATSession(freshStores());
    const { req, res } = makeReqRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.session.workspaces.length, 1);
    const ws = req.session.workspaces[0];
    assert.strictEqual(ws.isPAT, true);
    assert.strictEqual(ws.id, 'org-1');
    assert.strictEqual(req.session.activeWorkspaceId, 'org-1');
    assert.strictEqual(req.session.linearUserId, undefined);
    // LIN-1329: the account seam ran for real.
    assert.ok(req.session.accountId, 'session.accountId set by establishAccount');
  });

  test('a second PAT session for the SAME viewer.id reuses the SAME account (returning user)', async () => {
    const stores = freshStores();
    const first = makeReqRes();
    await createEnsurePATSession(stores)(first.req, first.res, () => {});
    const second = makeReqRes();
    await createEnsurePATSession(stores)(second.req, second.res, () => {});

    assert.strictEqual(second.req.session.accountId, first.req.session.accountId);
  });

  test('provider failure degrades gracefully: next() still called, no session mutation', async () => {
    class ThrowingProvider extends ProviderInterface {
      constructor() { super(); this.name = 'linear'; }
      async fetchOrganization() { throw new Error('network down'); }
      async fetchViewer() { throw new Error('network down'); }
    }
    registerProvider(new ThrowingProvider());
    try {
      const middleware = createEnsurePATSession(freshStores());
      const { req, res } = makeReqRes();
      let nextCalled = false;
      await middleware(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true);
      assert.strictEqual(req.session.workspaces, undefined);
    } finally {
      registerProvider(new FakeLinearProvider());
    }
  });

  test('LIN-1524 close-out Finding #3 (posture pin): PAT workspace carries no refreshToken, and the factory takes no ownerCredentialStore dependency', async () => {
    // Structural half: the factory's own deps signature has no store param —
    // confirmed by freshStores() below not including one and the middleware
    // still working correctly. Behavioural half: the produced credential has
    // no refreshToken field at all, since a PAT is static/non-expiring and
    // has nothing rotating to persist durably.
    const middleware = createEnsurePATSession(freshStores());
    const { req, res } = makeReqRes();
    await middleware(req, res, () => {});

    const ws = req.session.workspaces[0];
    assert.strictEqual(ws.refreshToken, undefined, 'PAT workspace must not carry a refreshToken');
    assert.strictEqual(ws.tokenExpiresAt, Number.MAX_SAFE_INTEGER, 'PAT never expires');
    const binding = ws.bindings.find(b => b.provider === 'linear' && b.scope === 'org-1');
    assert.strictEqual(binding.credentials.refreshToken, undefined, 'no refreshToken in the binding either — nothing durable to store');
  });

  test('skips auth/test/logout/legal routes even with no session workspaces', async () => {
    const middleware = createEnsurePATSession(freshStores());
    for (const path of ['/auth/linear', '/logout', '/test/set-session', '/privacy', '/terms', '/styleguide']) {
      const { req, res } = makeReqRes({ path });
      let nextCalled = false;
      await middleware(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true, `next() called for ${path}`);
      assert.strictEqual(req.session.workspaces, undefined, `no PAT session created for ${path}`);
    }
  });

  // LIN-3330: a public guest task page under /t/ carries no session, so PAT
  // auto-login must skip it with ZERO provider reads — the predicate is
  // trailing-slash so /test/, /terms and /templates stay unaffected.
  test('skips guest /t/ paths with zero provider reads (LIN-3330)', async () => {
    class CountingPATProvider extends ProviderInterface {
      constructor() { super(); this.name = 'linear'; this.calls = 0; }
      async fetchOrganization() { this.calls++; return { id: 'org-1', name: 'Acme', urlKey: 'acme' }; }
      async fetchViewer() { this.calls++; return { id: 'viewer-1' }; }
    }
    const counting = new CountingPATProvider();
    registerProvider(counting);
    try {
      const middleware = createEnsurePATSession(freshStores());
      const token = 'A'.repeat(43);
      for (const path of ['/t/abc', `/t/${token}`, '/t/', `/t/${token}/state`]) {
        const { req, res } = makeReqRes({ path });
        let nextCalled = false;
        await middleware(req, res, () => { nextCalled = true; });
        assert.strictEqual(nextCalled, true, `next() called for ${path}`);
        assert.strictEqual(req.session.workspaces, undefined, `no PAT session for ${path}`);
      }
      assert.strictEqual(counting.calls, 0, 'PAT never read the provider for a guest path');
      // Negative cases: the trailing slash must not sweep these in.
      for (const path of ['/test/x', '/terms', '/templates', '/t']) {
        const { req, res } = makeReqRes({ path });
        await middleware(req, res, () => {});
      }
      assert.ok(counting.calls > 0, 'a non-guest path still runs PAT auto-login');
    } finally {
      registerProvider(new FakeLinearProvider());
    }
  });

  // LIN-1892 (N1): an email-only signed-in session (accountId, zero
  // workspaces) is not a signed-out visitor. Keep the guard if S2 is reverted.
  describe('N1: a signed-in account with zero workspaces is never auto-logged-in (LIN-1892)', () => {
    class CountingLinearProvider extends ProviderInterface {
      constructor() { super(); this.name = 'linear'; this.calls = 0; }
      async fetchOrganization() { this.calls++; return { id: 'org-1', name: 'Acme', urlKey: 'acme' }; }
      async fetchViewer() { this.calls++; return { id: 'viewer-1' }; }
    }
    let counting;
    beforeEach(() => { counting = new CountingLinearProvider(); registerProvider(counting); });
    afterEach(() => { registerProvider(new FakeLinearProvider()); });

    for (const path of ['/', '/account']) {
      for (const initial of [{ accountId: 'A', workspaces: [] }, { accountId: 'A' }]) {
        test(`${path} with ${JSON.stringify(initial)}: next(), no provider call, no workspace, no account write`, async () => {
          const stores = freshStores();
          const session = makeSession(initial);
          const { req, res } = makeReqRes({ path, session });
          let nextCalled = false;
          await createEnsurePATSession(stores)(req, res, () => { nextCalled = true; });

          assert.strictEqual(nextCalled, true);
          assert.strictEqual(counting.calls, 0, 'fetchOrganization/fetchViewer never called');
          assert.deepStrictEqual(req.session.workspaces, initial.workspaces, 'workspaces untouched');
          assert.strictEqual(req.session.accountId, 'A');
          assert.strictEqual(await stores.accountStore.collection.countDocuments({}), 0, 'the account store is unchanged');
          assert.strictEqual(await stores.accountWorkspaceStore.collection.countDocuments({}), 0);
        });
      }
    }

    test('sessions WITHOUT an accountId behave exactly as before: the PAT workspace and account are created', async () => {
      for (const initial of [{}, { workspaces: [] }, { accountId: undefined, workspaces: [] }, { accountId: '' }]) {
        const stores = freshStores();
        const { req, res } = makeReqRes({ session: makeSession(initial) });
        let nextCalled = false;
        await createEnsurePATSession(stores)(req, res, () => { nextCalled = true; });

        assert.strictEqual(nextCalled, true);
        assert.strictEqual(counting.calls > 0, true, `${JSON.stringify(initial)}: PAT auto-login ran`);
        assert.strictEqual(req.session.workspaces.length, 1);
        assert.strictEqual(req.session.workspaces[0].id, 'org-1');
        assert.strictEqual(req.session.activeWorkspaceId, 'org-1');
        assert.ok(req.session.accountId, 'the account seam ran');
        assert.deepStrictEqual(
          Object.keys(req.session).filter(k => typeof req.session[k] !== 'function').sort(),
          ['accountId', 'activeWorkspaceId', 'identityAuthenticatedAt', 'workspaces'],
          'the same session fields as before LIN-1892'
        );
      }
    });
  });
});
