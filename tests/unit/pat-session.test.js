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

  test('creates a PAT workspace, sets linearUserId, and establishes a durable account', async () => {
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
    assert.strictEqual(req.session.linearUserId, 'viewer-1');
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
});
