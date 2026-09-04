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
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
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
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
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
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const router = createAuthRoutes({ provider: fakeProvider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
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
    // LIN-1523 corrective: the durable write sits AFTER the limit-check +
    // establishAccount, so a refused sign-in (no accountId was even minted
    // here) must leave the owner-credentials collection untouched — asserted
    // on the store's actual contents, not on whether a write was attempted.
    assert.deepStrictEqual(await ownerCredentialStore.collection.find({}).toArray(), []);
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
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {}); // the user's FIRST org

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
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
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const session = addSourceSession(myAccount._id);
    let regenCount = 0;
    const origRegen = session.regenerate.bind(session);
    session.regenerate = (cb) => { regenCount++; return origRegen(cb); };

    await handler({ query: { code: 'good-code', state: 'real' }, session }, makeRes());

    assert.strictEqual(session.accountId, myAccount._id, 'live accountId preserved (a regenerate would fork a new id)');
    assert.strictEqual(regenCount, 0, 'add-source path does NOT call session.regenerate()');
  });

  // LIN-1523 corrective: add-source has its OWN upsertWorkspace limit-check
  // (routes/auth.js, ahead of its own establishAccount call), separate from
  // the normal-login branch's — both branches can refuse, so both need this
  // proof. `myAccount._id` is already live here (add-source never
  // regenerates), so the durable store can be queried directly by key rather
  // than only by "the collection is empty".
  test('add-source: at the workspace limit, sign-in is rejected 400 and writes NO durable owner credential (LIN-1349/LIN-1523)', async () => {
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const existingWorkspaces = Array.from({ length: 10 }, (_, i) => ({ id: `ws-${i}`, name: `Workspace ${i}`, urlKey: `ws-${i}`, addedAt: Date.now() }));
    const session = addSourceSession(myAccount._id, { workspaces: existingWorkspaces });

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body, /Workspace Limit Reached/);
    // establishAccount never ran for org-2 (the limit-check refused first) —
    // no account↔workspace binding for the refused org.
    assert.deepEqual(await accountWorkspaceStore.listAccountsForWorkspace('org-2'), []);
    // The crux: no durable credential exists for (myAccount, 'beta') — the
    // refused workspace's urlKey — asserted on the store's actual contents.
    assert.strictEqual(await ownerCredentialStore.get(myAccount._id, 'beta'), null);
  });

  test('add-source: strict 409 when the 2nd Linear identity already belongs to a DIFFERENT account — nothing mutated, no session save (LIN-1351/LIN-1326)', async () => {
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const otherAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(otherAccount._id, 'linear', 'viewer-2', {}); // Y already owns the 2nd org's identity
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});    // X owns only its first org

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const session = addSourceSession(myAccount._id);
    let saveCount = 0;
    const origSave = session.save.bind(session);
    session.save = (cb) => { saveCount++; return origSave(cb); };

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.statusCode, 409);
    // LIN-2233: addSourceSession() sets accountId directly (never a real
    // establishAccount call), so session.identityAuthenticatedAt is unset —
    // NOT freshly authenticated per amendment A1, so the merge is refused
    // outright (re-auth-required) rather than offered as a one-click confirm.
    assert.match(res.body, /Sign in again to confirm/);
    // Neither account mutated: Y keeps exactly its one identity; X did NOT gain viewer-2.
    assert.strictEqual((await accountStore.getAccount(otherAccount._id)).identities.length, 1);
    assert.strictEqual((await accountStore.getAccount(myAccount._id)).identities.length, 1);
    // No binding written for the 2nd org; session account unchanged; NO save on the 409 path.
    assert.deepStrictEqual(await accountWorkspaceStore.listAccountsForWorkspace('org-2'), []);
    assert.strictEqual(session.accountId, myAccount._id);
    assert.strictEqual(saveCount, 0, 'no session save on the strict-conflict path');
    // LIN-1523 corrective: establishAccount itself refused here (AFTER the
    // limit-check passed) — persistOwnerCredential sits after this check too,
    // so no durable credential exists for (myAccount, 'beta') either.
    assert.strictEqual(await ownerCredentialStore.get(myAccount._id, 'beta'), null);
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
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const otherAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(otherAccount._id, 'linear', 'viewer-2', {}); // Y already owns the 2nd org's identity
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});    // X owns only its first org

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
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
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});
    await accountWorkspaceStore.bindAccountToWorkspace(myAccount._id, 'org-1'); // first org already bound

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
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
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
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

  // LIN-2233 (L2.1) superseded this test's original premise: session.accountId
  // is now DELIBERATELY carried across regenerate() (the fix), not wiped — see
  // the fork-prevention test in tests/unit/account-identity.test.js for the
  // intended-behavior case (a REAL pre-existing canonical account surviving
  // regenerate while linking a brand-new identity). This test now guards the
  // other half: regenerate() itself is still called (session-fixation
  // protection intact) even though the carried value changes what happens next.
  test('login-path fence: normal mode:new login still regenerates the session (session-fixation protection intact) even with a carried accountId (LIN-2233)', async () => {
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const router = createAuthRoutes({ provider: fakeProvider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    // A bogus/stale accountId (never a real account in this fresh store) is now
    // CARRIED across regenerate per L2.1, so establishAccount sees it as "live"
    // and attempts to link onto it — which correctly surfaces as an error
    // (unknown account) rather than silently minting a phantom account under a
    // fabricated id.
    const session = makeSession({ oauthState: 'real', accountId: 'stale-account-xyz' });
    let regenCount = 0;
    const origRegen = session.regenerate.bind(session);
    session.regenerate = (cb) => { regenCount++; return origRegen(cb); };

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(regenCount, 1, 'login path still regenerates the session');
    assert.strictEqual(res.statusCode, 409, 'an unresolvable carried accountId surfaces as a conflict, not a silent phantom mint');
    assert.match(res.body, /Account Conflict/, 'unknown-account is not a mergeable conflict — the pre-existing dead-end page');
  });

  // === LIN-2266: the non-mergeable (unknown-account) branch of
  // respondToAccountConflict must not leave a stale identity/hygiene state
  // behind it, or the 409 becomes a permanent lockout / a revived LIN-1351 leak.

  test('mode:new unknown-account 409 clears the stale session.accountId (and its freshness stamp) so a retry self-heals instead of sticking (LIN-2266)', async () => {
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const router = createAuthRoutes({ provider: fakeProvider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const session = makeSession({ oauthState: 'real', accountId: 'ghost-account', identityAuthenticatedAt: 12345 });

    await handler({ query: { code: 'good-code', state: 'real' }, session }, makeRes());

    assert.strictEqual(session.accountId, undefined, 'the unresolvable accountId must not survive the 409 — else every retry re-carries it (sticky lockout)');
    assert.strictEqual(session.identityAuthenticatedAt, undefined, 'the freshness stamp tied to the cleared accountId must not survive it either');

    // The strongest witness: retrying on the SAME (now-cleaned) session succeeds
    // instead of repeating the 409 — this is what "self-heals" actually means.
    session.oauthState = 'real2';
    const retryRes = makeRes();
    await handler({ query: { code: 'good-code', state: 'real2' }, session }, retryRes);
    assert.strictEqual(retryRes.statusCode, 200, 'retry no longer 409s');
    assert.strictEqual(retryRes.redirectedTo, '/workspace/acme/', 'retry lands in the workspace instead of repeating the Account Conflict page');
    assert.strictEqual(retryRes.body, null, 'retry does not render the Account Conflict page');
    assert.ok(session.accountId && session.accountId !== 'ghost-account', 'retry mints/links a real accountId instead of re-carrying the ghost');
  });

  test('add-source unknown-account 409 clears oauthState/oauthIntent (LIN-1351 hygiene) AND the stale accountId (LIN-2266), preserving the session.workspaces restore', async () => {
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    // A live add-source session whose signed-in accountId is itself a ghost
    // (deleted account / repointed datastore) — establishAccount has no
    // existing owner for viewer-2, falls into the "already signed in" branch,
    // and finds session.accountId doesn't resolve: {ok:false, reason:'unknown-account'}.
    const session = addSourceSession('ghost-account');

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(session.oauthState, undefined, 'LIN-1351: oauthState must not survive a failed non-mergeable add-source round-trip');
    assert.strictEqual(session.oauthIntent, undefined, 'LIN-1351: oauthIntent must not survive a failed non-mergeable add-source round-trip');
    assert.strictEqual(session.accountId, undefined, 'LIN-2266: the unresolvable accountId must not stick around either');
    // session.workspaces restoration (LIN-1351) is untouched by this fix — org-2's
    // live-token workspace never leaked in, and org-1 (the pre-existing workspace) survives.
    assert.deepStrictEqual(session.workspaces, [{ id: 'org-1', name: 'Acme', urlKey: 'acme' }]);
  });

  // === LIN-2499: the CSRF nonce's post-success lifetime ===
  // docs/reviews/security-review-2026-06-25.md:64 recorded that oauthState is
  // validated and never cleared. The mismatch arm (LIN-1351) and the add-source
  // arms were already covered above; the mode:'new' SUCCESS path was not, on
  // either side of the change. Worth pinning even though regenerate() below the
  // clear happens to wipe both fields anyway — that is an incidental property of
  // an unrelated session-fixation defence, and this is the assertion that would
  // catch its removal, or a reordering that moves work above the regenerate.

  test('mode:"new" success consumes oauthState/oauthIntent (LIN-2499)', async () => {
    const router = createAuthRoutes({ provider: fakeProvider(), sessionStore: { cleanup: async () => {} }, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'linear' } });

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.redirectedTo, '/workspace/acme/', 'the sign-in still lands');
    assert.strictEqual(session.oauthState, undefined);
    assert.strictEqual(session.oauthIntent, undefined);
  });

  test('a replayed callback with the consumed nonce hits the 400 Session Expired guard, not a second sign-in (LIN-2499)', async () => {
    const router = createAuthRoutes({ provider: fakeProvider(), sessionStore: { cleanup: async () => {} }, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/callback');
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'linear' } });

    const first = makeRes();
    await handler({ query: { code: 'good-code', state: 'real' }, session }, first);
    assert.strictEqual(first.redirectedTo, '/workspace/acme/');

    const replay = makeRes();
    await handler({ query: { code: 'good-code', state: 'real' }, session }, replay);

    assert.strictEqual(replay.statusCode, 400);
    assert.match(replay.body, /Session Expired/);
    assert.strictEqual(replay.redirectedTo, null, 'the flow did not re-run');
  });

  test('add-source success consumes oauthState/oauthIntent (LIN-2499 characterization of the LIN-1351 clear)', async () => {
    const { accountStore, accountWorkspaceStore, ownerCredentialStore } = freshAccountStores();
    const myAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(myAccount._id, 'linear', 'viewer-1', {});

    const router = createAuthRoutes({ provider: org2Provider(), sessionStore: { cleanup: async () => {} }, accountStore, accountWorkspaceStore, ownerCredentialStore });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const session = addSourceSession(myAccount._id);

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(res.redirectedTo, '/workspace/acme/settings?provider_ok=linear');
    assert.strictEqual(session.oauthState, undefined);
    assert.strictEqual(session.oauthIntent, undefined);
  });
});
