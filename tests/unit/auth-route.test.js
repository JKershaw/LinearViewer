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
import { getWorkspaceByUrlKey } from '../../lib/workspace.js';

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
    assert.strictEqual(session.linearUserId, undefined);
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

  // LIN-1350: a throw inside the post-regenerate callback (e.g. the prefs
  // store down) used to resolve the wrapper promise via `finally` with no
  // response ever sent, surfacing only as an unhandledRejection. The new
  // `catch` arm must render this route's own 500 page instead of hanging.
  test('a throw inside the post-regenerate callback (prefs store down) responds 500, not a hang (LIN-1350)', async () => {
    const router = createAuthRoutes({
      provider: fakeProvider(),
      sessionStore: { cleanup: async () => {} },
      userPreferencesStore: { getUserPreferences: async () => { throw new Error('prefs store down') } },
      ...freshAccountStores(),
    });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real' });

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.body && /Something Went Wrong/.test(res.body));
    assert.strictEqual(res.redirectedTo, null);
  });

  // === LIN-1351: Linear add-source (mode:'add-source') route-level tests ===
  // A signed-in user connects a SECOND Linear org. Its org-scoped viewer.id links
  // onto the CURRENT account WITHOUT regenerating (the live session.accountId is the
  // target); the 2nd org becomes its own workspace bound to that account; a
  // cross-account collision is a strict 409 with nothing written. Mirrors the GitHub
  // add-source tests (tests/unit/github-auth.test.js) on the same real-Mango harness.

  // The SECOND org: a distinct org-scoped identity (viewer-2) + its own workspace.
  const org2Provider = () => fakeProvider({
    fetchOrganization: async () => ({ id: 'org-2', name: 'Beta', urlKey: 'beta' }),
    fetchViewer: async () => ({ id: 'viewer-2' }),
  });

  // A live add-source session for a user already signed in as `accountId`, viewing
  // their first org (acme). intent.mode='add-source' carries the return workspace.
  function addSourceSession(accountId, overrides = {}) {
    return makeSession({
      oauthState: 'real',
      oauthIntent: { mode: 'add-source', provider: 'linear', workspaceUrlKey: 'acme' },
      accountId,
      workspaces: [{ id: 'org-1', name: 'Acme', urlKey: 'acme' }],
      activeWorkspaceId: 'org-1',
      ...overrides,
    });
  }

  test('add-source: connecting a SECOND Linear org links its identity onto the SAME account, minting none (LIN-1351)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {}); // the user's FIRST org

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const session = addSourceSession(myAccount._id);

    await handler({ query: { code: 'good-code', state: 'real' }, session }, makeRes());

    // The 2nd org's org-scoped identity is linked onto the CURRENT account X (no mint).
    const owner = await accountStore.findAccountByIdentity('linear', 'viewer-2');
    assert.ok(owner, 'viewer-2 identity now exists');
    assert.strictEqual(owner._id, myAccount._id, 'link target is the current account X');
    // The durable account↔workspace edge binds account X to the NEW org's workspace.
    assert.deepStrictEqual(await accountWorkspaceStore.listAccountsForWorkspace('org-2'), [myAccount._id]);
    // The new org appears as its own workspace in the session.
    assert.ok(session.workspaces.some(w => w.id === 'org-2'), 'org-2 workspace added to session');
  });

  test('add-source: session.accountId is UNCHANGED across the round-trip — the path does NOT regenerate (LIN-1351)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const session = addSourceSession(myAccount._id);
    let regenCount = 0;
    const origRegen = session.regenerate.bind(session);
    session.regenerate = (cb) => { regenCount++; return origRegen(cb); };

    await handler({ query: { code: 'good-code', state: 'real' }, session }, makeRes());

    assert.strictEqual(session.accountId, myAccount._id, 'live accountId preserved (a regenerate would fork a new id)');
    assert.strictEqual(regenCount, 0, 'add-source path does NOT call session.regenerate()');
  });

  test('add-source: strict 409 when the 2nd Linear identity already belongs to a DIFFERENT account — nothing mutated, no session save (LIN-1351/LIN-1326)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const otherAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(otherAccount._id, 'linear', 'viewer-2', {}); // Y already owns the 2nd org's identity
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});    // X owns only its first org

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const session = addSourceSession(myAccount._id);
    let saveCount = 0;
    const origSave = session.save.bind(session);
    session.save = (cb) => { saveCount++; return origSave(cb); };

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body, /Account Conflict/);
    // Neither account mutated: Y keeps exactly its one identity; X did NOT gain viewer-2.
    assert.strictEqual((await accountStore.getAccount(otherAccount._id)).identities.length, 1);
    assert.strictEqual((await accountStore.getAccount(myAccount._id)).identities.length, 1);
    // No binding written for the 2nd org; session account unchanged; NO save on the 409 path.
    assert.deepStrictEqual(await accountWorkspaceStore.listAccountsForWorkspace('org-2'), []);
    assert.strictEqual(session.accountId, myAccount._id);
    assert.strictEqual(saveCount, 0, 'no session save on the strict-conflict path');
  });

  test('add-source: a strict 409 leaves NO org-2 workspace in session.workspaces — the refused org cannot authorize /workspace/:urlKey/* (LIN-1351 review regression)', async () => {
    // Regression for the MEDIUM-HIGH review finding: before the fix, org-2 (which
    // carries a LIVE OAuth token) was pushed into session.workspaces BEFORE
    // establishAccount and left there on the strict conflict. Because the session
    // is resave:false on a persistent store, it persisted cross-request, and
    // workspaceFromUrl (server.js) authorizes /workspace/:urlKey/* SOLELY from
    // session.workspaces — so the user gained access to a workspace whose
    // connection was just refused. This asserts the ACTUAL leaked state (org-2
    // absent from session.workspaces + the exploited authorization lookup denied),
    // NOT the weak saveCount===0 proxy the review called out.
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const otherAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(otherAccount._id, 'linear', 'viewer-2', {}); // Y already owns the 2nd org's identity
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});    // X owns only its first org

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const session = addSourceSession(myAccount._id);

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.statusCode, 409);
    // The exact thing that was leaking: org-2 must NOT be in session.workspaces at
    // response end — by id AND by its urlKey ('beta', from org2Provider).
    assert.ok(!session.workspaces.some(w => w.id === 'org-2'), 'org-2 must NOT remain in session.workspaces after a refused connection');
    assert.ok(!session.workspaces.some(w => w.urlKey === 'beta'), 'org-2 urlKey "beta" must NOT remain in session.workspaces');
    // Only the pre-existing first org survives.
    assert.deepStrictEqual(session.workspaces.map(w => w.id), ['org-1']);
    // The authorization path the finding exploited: workspaceFromUrl resolves the
    // workspace via getWorkspaceByUrlKey(session, urlKey). It must find nothing for
    // org-2, so a subsequent GET /workspace/beta/... would NOT be authorized.
    assert.strictEqual(getWorkspaceByUrlKey(session, 'beta'), null, 'refused org "beta" must not be resolvable/authorizable from the session');
    // And no OAuth intent/state leaks across the failed round-trip.
    assert.strictEqual(session.oauthState, undefined);
    assert.strictEqual(session.oauthIntent, undefined);
  });

  test('add-source: two Linear orgs with DISTINCT org-scoped viewer.ids coexist on ONE account (LIN-1351)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});
    await accountWorkspaceStore.bindAccountToWorkspace(myAccount._id, 'org-1'); // first org already bound

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const session = addSourceSession(myAccount._id);

    await handler({ query: { code: 'good-code', state: 'real' }, session }, makeRes());

    assert.notStrictEqual('viewer-1', 'viewer-2');
    // Both distinct org-scoped identities resolve to the SAME account.
    assert.strictEqual((await accountStore.findAccountByIdentity('linear', 'viewer-1'))._id, myAccount._id);
    assert.strictEqual((await accountStore.findAccountByIdentity('linear', 'viewer-2'))._id, myAccount._id);
    assert.strictEqual((await accountStore.getAccount(myAccount._id)).identities.length, 2, 'both identities on one account');
    // And both orgs' workspaces are bound to that one account.
    const workspaces = await accountWorkspaceStore.listWorkspacesForAccount(myAccount._id);
    assert.ok(workspaces.includes('org-1') && workspaces.includes('org-2'), 'org-1 AND org-2 bound to the one account');
  });

  test('add-source: on success STAYS on the current workspace and returns to its settings — no auto-switch (LIN-1351, UX (b))', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const session = addSourceSession(myAccount._id);

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.redirectedTo, '/workspace/acme/settings?provider_ok=linear');
    assert.strictEqual(session.activeWorkspaceId, 'org-1', 'active workspace NOT switched to the new org');
    // OAuth state/intent cleared on success.
    assert.strictEqual(session.oauthIntent, undefined);
    assert.strictEqual(session.oauthState, undefined);
  });

  test('login-path fence: normal mode:new login still regenerates and does NOT preserve a pre-existing session.accountId (LIN-1351 guard)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createAuthRoutes({ provider: fakeProvider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    // A normal login (no add-source intent) carrying a STALE accountId that MUST be
    // wiped by regenerate() — never preserved/auto-merged onto the fresh sign-in.
    const session = makeSession({ oauthState: 'real', accountId: 'stale-account-xyz' });
    let regenCount = 0;
    const origRegen = session.regenerate.bind(session);
    session.regenerate = (cb) => { regenCount++; return origRegen(cb); };

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.redirectedTo, '/workspace/acme/');
    assert.strictEqual(regenCount, 1, 'login path still regenerates the session');
    assert.ok(session.accountId, 'a durable account is established by identity lookup');
    assert.notStrictEqual(session.accountId, 'stale-account-xyz', 'the pre-existing accountId is NOT preserved across regenerate');
  });
});
