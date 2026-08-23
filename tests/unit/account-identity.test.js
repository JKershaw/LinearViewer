/**
 * LIN-2233 (Ticket A of the LIN-2231 design) — identity carry-and-link,
 * confirmed merge, and the merge-semantics of `AccountStore.mergeAccounts`.
 *
 * Covers the L6 verification suite items this ticket owns:
 *   1. Fork-prevention (L2.1): front-door login as A, then as a brand-new
 *      identity B in the SAME session → one account, both identities
 *      attached, session.accountId unchanged.
 *   2. Conflict still conflicts without confirmation (L2.2): identity C
 *      already belongs to a different pre-existing account → two accounts
 *      remain, mergedInto absent on both, the conflict is surfaced (not
 *      silently merged) — and declining leaves both accounts untouched.
 *   3. Merge-semantics (AccountStore.mergeAccounts): alias via mergedInto,
 *      never migrates identities[]; additive/idempotent workspace rebind.
 * Plus route-level coverage of the confirmed-merge flow and LIN-2231's
 * amendment A1 (fresh dual-authentication) / A2 (session canonicalization).
 *
 * Run with: node --test tests/unit/account-identity.test.js
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
import { AccountMergeLogStore } from '../../lib/account-merge-log.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';

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

// A provider whose org/viewer response is selected by `idx.index` — lets a
// test drive TWO distinct front-door logins (two distinct human identities)
// through the SAME session, one after another.
function twoIdentityProvider(idx, orgs, viewers) {
  return {
    name: 'linear',
    beginAuth: ({ state }) => `https://linear.app/oauth/authorize?state=${state}`,
    completeAuth: async () => ({ access_token: 'lin_tok', refresh_token: `refresh-${idx.index}`, expires_in: 86400 }),
    fetchOrganization: async () => orgs[idx.index],
    fetchViewer: async () => viewers[idx.index],
  };
}

describe('LIN-2233 — account identity carry-and-link, confirmed merge', () => {
  let dbClient, dbDir, counter = 0, savedEnv;
  const ENV = ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'];

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'account-identity-'));
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

  function freshStores() {
    const db = dbClient.db(`acct_id_${counter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
      accountMergeLogStore: new AccountMergeLogStore({ collection: db.collection('account-merge-events') }),
    };
  }

  // === L6 test 1: fork-prevention ===============================================

  test('L6 test 1 — fork-prevention: front-door login as A, then as a brand-new identity B in the SAME session → one account, both identities attached, session.accountId unchanged', async () => {
    const stores = freshStores();
    const idx = { index: 0 };
    const provider = twoIdentityProvider(idx,
      [{ id: 'org-a', name: 'Org A', urlKey: 'org-a' }, { id: 'org-b', name: 'Org B', urlKey: 'org-b' }],
      [{ id: 'viewer-a' }, { id: 'viewer-b' }]);
    const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...stores });
    const handler = getHandler(router, 'get', '/auth/callback');

    const session = makeSession({ oauthState: 'real' });
    await handler({ query: { code: 'c1', state: 'real' }, session }, makeRes());
    const accountIdAfterA = session.accountId;
    assert.ok(accountIdAfterA);

    idx.index = 1;
    session.oauthState = 'real2';
    const res = makeRes();
    await handler({ query: { code: 'c2', state: 'real2' }, session }, res);

    assert.strictEqual(res.redirectedTo, '/workspace/org-b/');
    assert.strictEqual(session.accountId, accountIdAfterA, 'session.accountId unchanged across the second front-door login');
    const account = await stores.accountStore.getAccount(accountIdAfterA);
    assert.strictEqual(account.identities.length, 2, 'both identities attached to the ONE account');
    assert.ok(account.identities.some(i => i.scope === 'viewer-a'));
    assert.ok(account.identities.some(i => i.scope === 'viewer-b'));
  });

  // === L6 test 2: conflict still conflicts without confirmation =================

  test('L6 test 2 — conflict still conflicts without confirmation: identity B already belongs to a different account, no confirm → two accounts remain, mergedInto absent on both, conflict surfaced', async () => {
    const stores = freshStores();
    const otherAccount = await stores.accountStore.createAccount();
    await stores.accountStore.linkIdentity(otherAccount._id, 'linear', 'viewer-other', {});

    const idx = { index: 0 };
    const provider = twoIdentityProvider(idx,
      [{ id: 'org-mine', name: 'Mine', urlKey: 'mine' }, { id: 'org-other', name: 'Other', urlKey: 'other' }],
      [{ id: 'viewer-mine' }, { id: 'viewer-other' }]);
    const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...stores });
    const handler = getHandler(router, 'get', '/auth/callback');
    const declineHandler = getHandler(router, 'post', '/auth/merge/decline');

    const session = makeSession({ oauthState: 'real' });
    await handler({ query: { code: 'c1', state: 'real' }, session }, makeRes());
    const canonicalId = session.accountId;
    assert.ok(canonicalId);
    assert.notStrictEqual(canonicalId, otherAccount._id);

    idx.index = 1;
    session.oauthState = 'real2';
    const res = makeRes();
    await handler({ query: { code: 'c2', state: 'real2' }, session }, res);

    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body, /Merge these accounts\?/, 'canonical side was JUST freshly authenticated (previous login), so a mergeable offer is shown');
    assert.ok(session.pendingMerge, 'a pending merge offer is stored — but nothing written yet');

    assert.strictEqual((await stores.accountStore.getAccount(canonicalId)).mergedInto, undefined);
    assert.strictEqual((await stores.accountStore.getAccount(otherAccount._id)).mergedInto, undefined);
    assert.deepStrictEqual(await stores.accountWorkspaceStore.listAccountsForWorkspace('org-other'), [], 'the arriving workspace is not bound onto canonical without confirmation');
    assert.ok(!session.workspaces.some(w => w.id === 'org-other'), 'the unconfirmed workspace does not linger in session.workspaces');

    // Explicit decline: byte-identical outcome — nothing mutated, offer cleared.
    const declineRes = makeRes();
    await declineHandler({ session }, declineRes);
    assert.strictEqual(declineRes.redirectedTo, '/');
    assert.strictEqual(session.pendingMerge, undefined);
    assert.strictEqual((await stores.accountStore.getAccount(canonicalId)).mergedInto, undefined);
    assert.strictEqual((await stores.accountStore.getAccount(otherAccount._id)).mergedInto, undefined);
  });

  // === Confirmed merge success (L2.2 + amendments A1/A2) =========================

  test('confirmed merge: POST /auth/merge/confirm merges accounts, binds the arriving workspace onto canonical, persists its credential, sets session.accountId, and durably logs the merge', async () => {
    const stores = freshStores();
    const otherAccount = await stores.accountStore.createAccount();
    await stores.accountStore.linkIdentity(otherAccount._id, 'linear', 'viewer-other', {});
    // A pre-existing workspace edge the merged account already held — proves
    // the rebind, not just the newly-arriving workspace.
    await stores.accountWorkspaceStore.bindAccountToWorkspace(otherAccount._id, 'org-legacy');

    const idx = { index: 0 };
    const provider = twoIdentityProvider(idx,
      [{ id: 'org-mine', name: 'Mine', urlKey: 'mine' }, { id: 'org-other', name: 'Other', urlKey: 'other' }],
      [{ id: 'viewer-mine' }, { id: 'viewer-other' }]);
    const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...stores });
    const callbackHandler = getHandler(router, 'get', '/auth/callback');
    const confirmHandler = getHandler(router, 'post', '/auth/merge/confirm');

    const session = makeSession({ oauthState: 'real' });
    await callbackHandler({ query: { code: 'c1', state: 'real' }, session }, makeRes());
    const canonicalId = session.accountId;

    idx.index = 1;
    session.oauthState = 'real2';
    await callbackHandler({ query: { code: 'c2', state: 'real2' }, session }, makeRes());
    assert.ok(session.pendingMerge);

    const res = makeRes();
    await confirmHandler({ session }, res);

    assert.strictEqual(res.redirectedTo, '/workspace/other/');
    assert.strictEqual(session.accountId, canonicalId, 'amendment A2: session.accountId set to canonical on confirm');
    assert.strictEqual(session.pendingMerge, undefined);
    assert.ok(session.workspaces.some(w => w.id === 'org-other'), 'the arriving workspace is added back to session.workspaces on confirm');

    const merged = await stores.accountStore.getAccount(otherAccount._id);
    assert.strictEqual(merged.mergedInto, canonicalId, 'merged account aliased via mergedInto — permanent pointer');
    assert.strictEqual(merged.identities.length, 1, 'identities[] untouched — never migrated');
    assert.strictEqual(merged.identities[0].scope, 'viewer-other');

    const canonical = await stores.accountStore.getAccount(canonicalId);
    assert.strictEqual(canonical.identities.length, 1, 'canonical does NOT gain the merged identity directly — it resolves through mergedInto (Ticket B)');

    const canonicalWorkspaces = await stores.accountWorkspaceStore.listWorkspacesForAccount(canonicalId);
    assert.ok(canonicalWorkspaces.includes('org-other'), 'the newly-arriving workspace is bound onto canonical');
    assert.ok(canonicalWorkspaces.includes('org-legacy'), 'the merged account\'s PRE-EXISTING workspace edge is also rebound onto canonical');
    const mergedWorkspacesStillPresent = await stores.accountWorkspaceStore.listWorkspacesForAccount(otherAccount._id);
    assert.ok(mergedWorkspacesStillPresent.includes('org-legacy'), 'rebind is ADDITIVE — the merged account keeps its own edge (audit history intact)');

    const cred = await stores.ownerCredentialStore.get(canonicalId, 'other');
    assert.ok(cred, 'the arriving identity\'s owner credential is persisted under the CANONICAL account');
    assert.strictEqual(cred.refreshToken, 'refresh-1');

    const events = await stores.accountMergeLogStore.collection.find({}).toArray();
    assert.strictEqual(events.length, 1, 'the merge is durably logged');
    assert.strictEqual(events[0].canonicalId, canonicalId);
    assert.strictEqual(events[0].mergedId, otherAccount._id);
    assert.ok(events[0].workspaceIds.includes('org-legacy'));
  });

  // === Amendment A1: fresh dual-authentication is required ======================

  test('amendment A1: a live-but-STALE canonical session is refused a one-click merge — re-auth required, no pending merge stored', async () => {
    const stores = freshStores();
    const canonicalAccount = await stores.accountStore.createAccount();
    await stores.accountStore.linkIdentity(canonicalAccount._id, 'linear', 'viewer-mine', {});
    const otherAccount = await stores.accountStore.createAccount();
    await stores.accountStore.linkIdentity(otherAccount._id, 'linear', 'viewer-other', {});

    const idx = { index: 1 }; // straight to the conflicting identity
    const provider = twoIdentityProvider(idx,
      [{ id: 'org-mine', name: 'Mine', urlKey: 'mine' }, { id: 'org-other', name: 'Other', urlKey: 'other' }],
      [{ id: 'viewer-mine' }, { id: 'viewer-other' }]);
    const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...stores });
    const handler = getHandler(router, 'get', '/auth/callback');

    // A session that is LIVE (accountId set) but whose last proven identity
    // link is well outside the fresh-auth window — e.g. hours old.
    const session = makeSession({
      oauthState: 'real',
      accountId: canonicalAccount._id,
      identityAuthenticatedAt: Date.now() - 60 * 60 * 1000,
    });
    const res = makeRes();
    await handler({ query: { code: 'c1', state: 'real' }, session }, res);

    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body, /Sign in again to confirm/);
    assert.strictEqual(session.pendingMerge, undefined, 'no pending merge is offered when the canonical side is not fresh');
    assert.strictEqual((await stores.accountStore.getAccount(canonicalAccount._id)).mergedInto, undefined);
    assert.strictEqual((await stores.accountStore.getAccount(otherAccount._id)).mergedInto, undefined);
  });

  test('POST /auth/merge/confirm with no pending merge in session is refused (400), writes nothing', async () => {
    const stores = freshStores();
    const router = createAuthRoutes({ provider: {}, sessionStore: { cleanup: async () => {} }, ...stores });
    const confirmHandler = getHandler(router, 'post', '/auth/merge/confirm');
    const session = makeSession({});
    const res = makeRes();

    await confirmHandler({ session }, res);

    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body, /Merge Expired/);
  });

  // === Merge-semantics: AccountStore.mergeAccounts is an alias, never a migration

  describe('AccountStore.mergeAccounts — merge semantics', () => {
    test('aliases via mergedInto, never migrates identities[]; rebinds workspace edges additively; durably logs', async () => {
      const stores = freshStores();
      const canonical = await stores.accountStore.createAccount();
      await stores.accountStore.linkIdentity(canonical._id, 'linear', 'canonical-identity', {});
      const merged = await stores.accountStore.createAccount();
      await stores.accountStore.linkIdentity(merged._id, 'linear', 'merged-identity', { some: 'credential' });
      await stores.accountWorkspaceStore.bindAccountToWorkspace(merged._id, 'ws-1');
      await stores.accountWorkspaceStore.bindAccountToWorkspace(merged._id, 'ws-2');

      const result = await stores.accountStore.mergeAccounts(canonical._id, merged._id, {
        accountWorkspaceStore: stores.accountWorkspaceStore,
        mergeLogStore: stores.accountMergeLogStore,
      });

      assert.strictEqual(result.ok, true);
      const mergedDoc = await stores.accountStore.getAccount(merged._id);
      assert.strictEqual(mergedDoc.mergedInto, canonical._id, 'one-way alias pointer');
      assert.strictEqual(mergedDoc.identities.length, 1, 'identities[] never migrated');
      assert.strictEqual(mergedDoc.identities[0].scope, 'merged-identity');
      assert.deepStrictEqual(mergedDoc.identities[0].credentials, { some: 'credential' }, 'identity credentials untouched');

      const canonicalDoc = await stores.accountStore.getAccount(canonical._id);
      assert.strictEqual(canonicalDoc.identities.length, 1, 'canonical identities[] unaffected');

      const canonicalWorkspaces = await stores.accountWorkspaceStore.listWorkspacesForAccount(canonical._id);
      assert.ok(canonicalWorkspaces.includes('ws-1') && canonicalWorkspaces.includes('ws-2'), 'both edges re-bound onto canonical');
      const mergedWorkspaces = await stores.accountWorkspaceStore.listWorkspacesForAccount(merged._id);
      assert.ok(mergedWorkspaces.includes('ws-1') && mergedWorkspaces.includes('ws-2'), 'merged account keeps its OWN edges — additive, not a move');

      const events = await stores.accountMergeLogStore.collection.find({}).toArray();
      assert.strictEqual(events.length, 1);
      assert.deepStrictEqual(events[0].workspaceIds.sort(), ['ws-1', 'ws-2']);
    });

    test('is idempotent when re-merging into the SAME canonical; refuses to re-point an already-merged account elsewhere', async () => {
      const stores = freshStores();
      const canonical = await stores.accountStore.createAccount();
      const merged = await stores.accountStore.createAccount();
      const thirdAccount = await stores.accountStore.createAccount();

      const first = await stores.accountStore.mergeAccounts(canonical._id, merged._id);
      assert.strictEqual(first.ok, true);

      const again = await stores.accountStore.mergeAccounts(canonical._id, merged._id);
      assert.strictEqual(again.ok, true);
      assert.strictEqual(again.alreadyMerged, true);

      const elsewhere = await stores.accountStore.mergeAccounts(thirdAccount._id, merged._id);
      assert.strictEqual(elsewhere.ok, false);
      assert.strictEqual(elsewhere.reason, 'already-merged');
      assert.strictEqual(elsewhere.mergedInto, canonical._id, 'mergedInto is never reassigned once set');
    });

    test('refuses a self-merge and an unknown account without writing anything', async () => {
      const stores = freshStores();
      const account = await stores.accountStore.createAccount();

      const self = await stores.accountStore.mergeAccounts(account._id, account._id);
      assert.strictEqual(self.ok, false);
      assert.strictEqual(self.reason, 'self-merge');

      const unknownMerged = await stores.accountStore.mergeAccounts(account._id, 'does-not-exist');
      assert.strictEqual(unknownMerged.ok, false);
      assert.strictEqual(unknownMerged.reason, 'unknown-merged');

      const unknownCanonical = await stores.accountStore.mergeAccounts('does-not-exist', account._id);
      assert.strictEqual(unknownCanonical.ok, false);
      assert.strictEqual(unknownCanonical.reason, 'unknown-canonical');

      assert.strictEqual((await stores.accountStore.getAccount(account._id)).mergedInto, undefined);
    });
  });
});
