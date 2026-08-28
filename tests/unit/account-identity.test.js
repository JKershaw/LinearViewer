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
import { createAccountMergeRoutes } from '../../routes/account-merge.js';
import { AccountStore } from '../../lib/account-store.js';
import { establishAccount } from '../../lib/account-session.js';
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

    // LIN-2237 (Ticket E, L6 item 4 — durable-record invariant): the LINK
    // path (L2.1), not just the merge path (L2.2, covered separately below),
    // must also leave a durable owner-credentials record for
    // (canonical account, workspace, provider) — resolveWorkspaceAccess's
    // durable arm (Ticket B) has nothing to canonicalize INTO if the link
    // path itself never persisted one.
    const credA = await stores.ownerCredentialStore.get(accountIdAfterA, 'org-a');
    assert.ok(credA, 'the FIRST (minting) front-door login persists a durable credential');
    assert.strictEqual(credA.refreshToken, 'refresh-0');
    const credB = await stores.ownerCredentialStore.get(accountIdAfterA, 'org-b');
    assert.ok(credB, 'the SECOND (linking) front-door login — the actual L2.1 fix under test — ALSO persists one, under the SAME account');
    assert.strictEqual(credB.refreshToken, 'refresh-1');
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
    const mergeRouter = createAccountMergeRoutes({ ...stores });
    const declineHandler = getHandler(mergeRouter, 'post', '/auth/merge/decline');

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
    // LIN-2304: confirm-completion is now uniform across every provider,
    // including Linear — the confirm handler applies activeWorkspaceId and
    // rehydrated preferences the same way every provider's non-conflict
    // success path already does, closing a pre-existing gap on Linear's own
    // confirm route rather than forking it. A fake store witnesses both.
    const prefsCalls = [];
    const userPreferencesStore = { getUserPreferences: async (accountId) => { prefsCalls.push(accountId); return { theme: 'dark' }; } };
    const mergeRouter = createAccountMergeRoutes({ ...stores, userPreferencesStore });
    const confirmHandler = getHandler(mergeRouter, 'post', '/auth/merge/confirm');

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
    // LIN-2304: the uniform completion step — previously ABSENT from Linear's
    // own confirm handler (§0 of the plan's research), a pre-existing gap
    // this ticket closes deliberately, not a provider fork.
    assert.strictEqual(session.activeWorkspaceId, 'org-other', 'LIN-2304: activeWorkspaceId is now set on confirm, uniformly');
    assert.deepStrictEqual(prefsCalls, [canonicalId], 'LIN-2304: preferences are now rehydrated for the canonical account on confirm, uniformly');
    assert.strictEqual(session.theme, 'dark', 'the rehydrated preference actually lands on the session');

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
    const mergeRouter = createAccountMergeRoutes({ ...stores });
    const confirmHandler = getHandler(mergeRouter, 'post', '/auth/merge/confirm');
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

    // === LIN-2265: mergeAccounts must not write a mergedInto CYCLE =============

    test('LIN-2265: a second merge that targets an already-merged canonical is refused at the write path, and writes no cycle', async () => {
      const stores = freshStores();
      const a = await stores.accountStore.createAccount();
      const b = await stores.accountStore.createAccount();

      // First merge: B -> A (B becomes the merged side, A is canonical).
      const first = await stores.accountStore.mergeAccounts(a._id, b._id);
      assert.strictEqual(first.ok, true);

      // Second merge attempts the OPPOSITE direction, using the account that
      // was just merged away (B) as the new merge's canonical side. Before
      // LIN-2265 this succeeded and wrote A.mergedInto = B, producing a
      // two-node cycle (A.mergedInto=B, B.mergedInto=A).
      const second = await stores.accountStore.mergeAccounts(b._id, a._id);
      assert.strictEqual(second.ok, false, 'refused: canonical side (B) is itself already merged (into A)');
      assert.strictEqual(second.reason, 'canonical-already-merged');
      assert.strictEqual(second.mergedInto, a._id);

      const aDoc = await stores.accountStore.getAccount(a._id);
      const bDoc = await stores.accountStore.getAccount(b._id);
      assert.strictEqual(aDoc.mergedInto, undefined, 'A never gets a mergedInto — no cycle');
      assert.strictEqual(bDoc.mergedInto, a._id, 'B keeps its original, permanent pointer, unchanged');

      // Both remain resolvable — the cycle this guards against would make
      // resolveCanonicalAccountId throw for BOTH accounts, forever.
      assert.strictEqual(await stores.accountStore.resolveCanonicalAccountId(a._id), a._id);
      assert.strictEqual(await stores.accountStore.resolveCanonicalAccountId(b._id), a._id);
    });
  });

  // === LIN-2265: the reachable route-level repro ================================

  describe('LIN-2265 — mergeAccounts cycle via ordinary sign-in (route-level repro)', () => {
    test('a later login with the merged identity self-heals session.accountId to canonical, so the SECOND merge attempt never even offers a cycle-forming merge', async () => {
      const stores = freshStores();

      // Round 1, session S1: mint A (viewer-mine), then merge B (viewer-other,
      // a pre-existing account) into A via the front-door conflict+confirm
      // flow — the ordinary, legitimate merge.
      const otherAccount = await stores.accountStore.createAccount();
      await stores.accountStore.linkIdentity(otherAccount._id, 'linear', 'viewer-other', {});

      const idx = { index: 0 };
      const provider = twoIdentityProvider(idx,
        [{ id: 'org-mine', name: 'Mine', urlKey: 'mine' }, { id: 'org-other', name: 'Other', urlKey: 'other' }],
        [{ id: 'viewer-mine' }, { id: 'viewer-other' }]);
      const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...stores });
      const callbackHandler = getHandler(router, 'get', '/auth/callback');
      const mergeRouter = createAccountMergeRoutes({ ...stores });
      const confirmHandler = getHandler(mergeRouter, 'post', '/auth/merge/confirm');

      const s1 = makeSession({ oauthState: 'real' });
      await callbackHandler({ query: { code: 'c1', state: 'real' }, session: s1 }, makeRes());
      const canonicalId = s1.accountId;
      assert.ok(canonicalId);

      idx.index = 1;
      s1.oauthState = 'real2';
      await callbackHandler({ query: { code: 'c2', state: 'real2' }, session: s1 }, makeRes());
      assert.ok(s1.pendingMerge, 'round 1: a merge is offered');
      await confirmHandler({ session: s1 }, makeRes());
      assert.strictEqual((await stores.accountStore.getAccount(otherAccount._id)).mergedInto, canonicalId, 'round 1: B merged into A');

      // Round 2, a FRESH session S2 (e.g. a different browser/device): sign in
      // with the MERGED identity first — establishAccount finds it still
      // registered on B (mergeAccounts never touches identities[]), but
      // LIN-2285 canonicalizes the session/workspace write, so
      // session.accountId self-heals to the canonical A on THIS login, not
      // just on a later establishAccount call.
      idx.index = 1;
      const s2 = makeSession({ oauthState: 'real3' });
      const res2 = makeRes();
      await callbackHandler({ query: { code: 'c3', state: 'real3' }, session: s2 }, res2);
      assert.strictEqual(res2.statusCode, 200, 'round 2 step 1: an ordinary successful login, not a conflict');
      assert.strictEqual(s2.accountId, canonicalId, 'session.accountId self-heals to the canonical id on this very login (LIN-2285)');

      // Then, SAME session, sign in with the canonical identity too. Before
      // LIN-2265, this reached establishAccount with session.accountId === B
      // (uncanonicalized) and existingOwner === A, raised a conflict, and
      // confirming it wrote A.mergedInto = B — a CYCLE (A.mergedInto=B,
      // B.mergedInto=A) that makes resolveCanonicalAccountId throw for both
      // accounts forever. session.accountId is already canonical A here
      // (LIN-2285 healed it on the previous login above), so this is now the
      // straightforward already-signed-in idempotent re-link case — no
      // conflict, and definitely no cycle-forming merge offer.
      idx.index = 0;
      s2.oauthState = 'real4';
      const res3 = makeRes();
      await callbackHandler({ query: { code: 'c4', state: 'real4' }, session: s2 }, res3);

      assert.strictEqual(res3.statusCode, 200, 'round 2 step 2: no conflict is raised — self-healed instead of offering a cycle-forming merge');
      assert.strictEqual(res3.redirectedTo, '/workspace/mine/');
      assert.strictEqual(s2.accountId, canonicalId, 'session.accountId self-healed from the merged id to the canonical one');
      assert.strictEqual(s2.pendingMerge, undefined, 'no pending merge was ever created');

      const aDoc = await stores.accountStore.getAccount(canonicalId);
      const bDoc = await stores.accountStore.getAccount(otherAccount._id);
      assert.strictEqual(aDoc.mergedInto, undefined, 'canonical account never gets a mergedInto — no cycle written');
      assert.strictEqual(bDoc.mergedInto, canonicalId, 'the original, one-way merge pointer is untouched');

      // Both accounts stay resolvable forever — the exact blast radius LIN-2265
      // describes (resolveWorkspaceAccess -> store_unreachable) never occurs.
      assert.strictEqual(await stores.accountStore.resolveCanonicalAccountId(canonicalId), canonicalId);
      assert.strictEqual(await stores.accountStore.resolveCanonicalAccountId(otherAccount._id), canonicalId);
    });

    test('LIN-2265: the mirrored login order (viewer-other mints first, viewer-mine is the pre-existing account merged in) self-heals the same way, no cycle', async () => {
      const stores = freshStores();

      // Round 1, session S1: this time the FIRST login mints the account for
      // viewer-other, and the pre-existing account (viewer-mine) is the one
      // that ends up merged — the opposite ordering from the test above.
      const mineAccount = await stores.accountStore.createAccount();
      await stores.accountStore.linkIdentity(mineAccount._id, 'linear', 'viewer-mine', {});

      const idx = { index: 1 }; // viewer-other logs in first this time
      const provider = twoIdentityProvider(idx,
        [{ id: 'org-mine', name: 'Mine', urlKey: 'mine' }, { id: 'org-other', name: 'Other', urlKey: 'other' }],
        [{ id: 'viewer-mine' }, { id: 'viewer-other' }]);
      const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...stores });
      const callbackHandler = getHandler(router, 'get', '/auth/callback');
      const mergeRouter = createAccountMergeRoutes({ ...stores });
      const confirmHandler = getHandler(mergeRouter, 'post', '/auth/merge/confirm');

      const s1 = makeSession({ oauthState: 'real' });
      await callbackHandler({ query: { code: 'c1', state: 'real' }, session: s1 }, makeRes());
      const canonicalId = s1.accountId; // freshly minted for viewer-other
      assert.ok(canonicalId);
      assert.notStrictEqual(canonicalId, mineAccount._id);

      idx.index = 0; // viewer-mine, the pre-existing account, conflicts and merges in
      s1.oauthState = 'real2';
      await callbackHandler({ query: { code: 'c2', state: 'real2' }, session: s1 }, makeRes());
      assert.ok(s1.pendingMerge, 'round 1: a merge is offered');
      await confirmHandler({ session: s1 }, makeRes());
      assert.strictEqual((await stores.accountStore.getAccount(mineAccount._id)).mergedInto, canonicalId, 'round 1: mineAccount merged into the canonical (viewer-other-minted) account');

      // Round 2, a fresh session: log in with the now-merged identity
      // (viewer-mine) first, then the canonical identity (viewer-other).
      // LIN-2285: self-heals to canonical on THIS login, not just on the
      // next establishAccount call.
      idx.index = 0;
      const s2 = makeSession({ oauthState: 'real3' });
      const res2 = makeRes();
      await callbackHandler({ query: { code: 'c3', state: 'real3' }, session: s2 }, res2);
      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(s2.accountId, canonicalId, 'session.accountId self-heals to the canonical id on this very login (LIN-2285)');

      idx.index = 1;
      s2.oauthState = 'real4';
      const res3 = makeRes();
      await callbackHandler({ query: { code: 'c4', state: 'real4' }, session: s2 }, res3);

      assert.strictEqual(res3.statusCode, 200, 'self-healed — no conflict, no cycle-forming merge offered');
      assert.strictEqual(res3.redirectedTo, '/workspace/other/');
      assert.strictEqual(s2.accountId, canonicalId);
      assert.strictEqual(s2.pendingMerge, undefined);

      assert.strictEqual((await stores.accountStore.getAccount(canonicalId)).mergedInto, undefined, 'no cycle written');
      assert.strictEqual((await stores.accountStore.getAccount(mineAccount._id)).mergedInto, canonicalId);
      assert.strictEqual(await stores.accountStore.resolveCanonicalAccountId(canonicalId), canonicalId);
      assert.strictEqual(await stores.accountStore.resolveCanonicalAccountId(mineAccount._id), canonicalId);
    });
  });

  // === LIN-2265 close-out: already-corrupt data must not break sign-in =========
  //
  // Ledger item from the LIN-2265 review: `establishAccount` now calls
  // `resolveCanonicalAccountId` whenever `session.accountId` is set, and that
  // method THROWS on a `mergedInto` cycle or an over-deep chain. No new cycle
  // can be created (the `mergeAccounts` guard above), so only data corrupted
  // BEFORE that guard shipped can reach this — but for such an account an
  // unwrapped call would turn sign-in into a throw where it previously
  // proceeded, and on the entry paths that do not wrap their own
  // `establishAccount` call (POST /auth/jira/link) into an unhandled
  // rejection that hangs the request rather than erroring cleanly. These
  // tests pin the degrade-instead-of-throw behaviour on seeded corruption.

  describe('LIN-2265 — pre-existing mergedInto corruption degrades, never throws, at the sign-in seam', () => {
    // Seeds corruption the fixed write path can no longer produce, by writing
    // `mergedInto` straight onto the documents — this is what an account
    // corrupted before the guard shipped looks like on disk.
    async function seedCycle(accountStore) {
      const a = await accountStore.createAccount();
      const b = await accountStore.createAccount();
      await accountStore.collection.updateOne({ _id: a._id }, { $set: { mergedInto: b._id } });
      await accountStore.collection.updateOne({ _id: b._id }, { $set: { mergedInto: a._id } });
      await assert.rejects(() => accountStore.resolveCanonicalAccountId(a._id), /cycle detected/,
        'sanity: the seeded pair is genuinely unresolvable');
      return { a, b };
    }

    test('establishAccount with a CYCLIC session.accountId completes instead of throwing, keeping the id uncanonicalized', async () => {
      const stores = freshStores();
      const { a } = await seedCycle(stores.accountStore);
      await stores.accountStore.linkIdentity(a._id, 'linear', 'viewer-cyclic', {});

      const session = makeSession({ accountId: a._id });
      const established = await establishAccount(
        session, stores.accountStore, stores.accountWorkspaceStore, 'linear', 'viewer-cyclic', {}, 'org-cyclic'
      );

      assert.strictEqual(established.ok, true, 'sign-in proceeds exactly as it did before LIN-2265');
      assert.strictEqual(established.accountId, a._id);
      assert.strictEqual(session.accountId, a._id, 'degraded to the uncanonicalized id — never a throw, never null');
    });

    test('an over-deep mergedInto chain degrades the same way', async () => {
      const stores = freshStores();
      // 10 accounts chained head -> ... -> tail: deeper than resolveCanonicalAccountId's maxDepth of 8.
      const chain = [];
      for (let i = 0; i < 10; i++) chain.push(await stores.accountStore.createAccount());
      for (let i = 0; i < chain.length - 1; i++) {
        await stores.accountStore.collection.updateOne({ _id: chain[i]._id }, { $set: { mergedInto: chain[i + 1]._id } });
      }
      const head = chain[0];
      await assert.rejects(() => stores.accountStore.resolveCanonicalAccountId(head._id), /maxDepth/,
        'sanity: the seeded chain is genuinely over-deep');
      await stores.accountStore.linkIdentity(head._id, 'linear', 'viewer-deep', {});

      const session = makeSession({ accountId: head._id });
      const established = await establishAccount(
        session, stores.accountStore, stores.accountWorkspaceStore, 'linear', 'viewer-deep', {}, 'org-deep'
      );

      assert.strictEqual(established.ok, true);
      assert.strictEqual(session.accountId, head._id);
    });

    test('the front-door callback signs a corrupted account in cleanly — no 500, no unhandled rejection — and the write-path guard still fails a merge closed', async () => {
      const stores = freshStores();
      const { a, b } = await seedCycle(stores.accountStore);
      await stores.accountStore.linkIdentity(a._id, 'linear', 'viewer-mine', {});

      const idx = { index: 0 };
      const provider = twoIdentityProvider(idx,
        [{ id: 'org-mine', name: 'Mine', urlKey: 'mine' }, { id: 'org-other', name: 'Other', urlKey: 'other' }],
        [{ id: 'viewer-mine' }, { id: 'viewer-other' }]);
      const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...stores });
      const handler = getHandler(router, 'get', '/auth/callback');

      const session = makeSession({ oauthState: 'real', accountId: a._id });
      const res = makeRes();
      await handler({ query: { code: 'c1', state: 'real' }, session }, res);

      assert.strictEqual(res.statusCode, 200, 'a corrupted account still lands, exactly as it did before LIN-2265');
      assert.strictEqual(res.redirectedTo, '/workspace/mine/');
      assert.strictEqual(session.accountId, a._id);

      // The second, independent layer is unaffected by the degrade: a merge
      // built from the stale id still fails closed at the write path.
      const c = await stores.accountStore.createAccount();
      const attempt = await stores.accountStore.mergeAccounts(a._id, c._id);
      assert.strictEqual(attempt.ok, false);
      assert.strictEqual(attempt.reason, 'canonical-already-merged');
      assert.strictEqual((await stores.accountStore.getAccount(c._id)).mergedInto, undefined, 'no new pointer written onto the corrupt graph');
      assert.strictEqual((await stores.accountStore.getAccount(a._id)).mergedInto, b._id, 'the seeded corruption is untouched — never silently repaired here');
    });
  });

  // === LIN-2285: the merged side of a merge offer is canonicalized ============
  //
  // LIN-2265 canonicalized the CANONICAL side (session.accountId). The MERGED
  // side — existingOwner._id, propagated into the conflict payload, the
  // linkIdentity-race sibling at :155, and the final session/workspace write —
  // was still raw, so a third account offered a merge of an already-merged
  // identity's owner dead-ended on a generic 500 "Merge Failed" (already-merged
  // at the mergeAccounts write path, since the offer named the wrong side).

  describe('LIN-2285 — canonicalize the merged side of a merge offer', () => {
    test('acceptance witness: a third account offered a merge of an already-merged identity gets the CANONICAL absorber, confirms cleanly, and a later login lands directly on it', async () => {
      const stores = freshStores();

      // B merged into A BEFORE this session ever starts.
      const a = await stores.accountStore.createAccount();
      await stores.accountStore.linkIdentity(a._id, 'linear', 'viewer-a1', {});
      const b = await stores.accountStore.createAccount();
      await stores.accountStore.linkIdentity(b._id, 'linear', 'viewer-b1', {});
      assert.strictEqual((await stores.accountStore.mergeAccounts(a._id, b._id, { accountWorkspaceStore: stores.accountWorkspaceStore, mergeLogStore: stores.accountMergeLogStore })).ok, true);

      const idx = { index: 0 };
      const provider = twoIdentityProvider(idx,
        [{ id: 'org-c1', name: 'C1', urlKey: 'c1' }, { id: 'org-b1', name: 'B1', urlKey: 'b1' }],
        [{ id: 'viewer-c1' }, { id: 'viewer-b1' }]);
      const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...stores });
      const callbackHandler = getHandler(router, 'get', '/auth/callback');
      const mergeRouter = createAccountMergeRoutes({ ...stores });
      const confirmHandler = getHandler(mergeRouter, 'post', '/auth/merge/confirm');

      // A THIRD, unrelated account C mints via a fresh sign-in.
      const session = makeSession({ oauthState: 'real' });
      await callbackHandler({ query: { code: 'c1', state: 'real' }, session }, makeRes());
      const c = session.accountId;
      assert.ok(c);
      assert.notStrictEqual(c, a._id);
      assert.notStrictEqual(c, b._id);

      // Same session signs in with B's identity — B is already merged into A.
      idx.index = 1;
      session.oauthState = 'real2';
      const offerRes = makeRes();
      await callbackHandler({ query: { code: 'c2', state: 'real2' }, session }, offerRes);
      assert.strictEqual(offerRes.statusCode, 409, 'a genuine conflict: C is a distinct canonical account from A');
      assert.ok(session.pendingMerge);
      assert.strictEqual(session.pendingMerge.canonicalAccountId, c);
      assert.strictEqual(session.pendingMerge.mergedAccountId, a._id, 'the offer names the CANONICAL absorber A, not the raw merged id B');
      assert.notStrictEqual(session.pendingMerge.mergedAccountId, b._id);

      const confirmRes = makeRes();
      await confirmHandler({ session }, confirmRes);
      assert.strictEqual(confirmRes.statusCode, 200, 'confirm redirects (default statusCode) rather than erroring — no 500 "Merge Failed" dead end');
      assert.ok(confirmRes.redirectedTo);
      assert.strictEqual(session.accountId, c);

      // Chain resolves cleanly, no cycle, both merges are one-way.
      assert.strictEqual(await stores.accountStore.resolveCanonicalAccountId(b._id), c);
      assert.strictEqual(await stores.accountStore.resolveCanonicalAccountId(a._id), c);
      assert.strictEqual((await stores.accountStore.getAccount(a._id)).mergedInto, c);
      assert.strictEqual((await stores.accountStore.getAccount(b._id)).mergedInto, a._id, 'the original one-way pointer is untouched');
      assert.strictEqual((await stores.accountStore.getAccount(c)).mergedInto, undefined, 'the surviving canonical account never gets a mergedInto');

      // The REAL acceptance witness (not just the absence of the 500): a later,
      // fresh-session login with B's (twice-merged) identity lands directly on
      // the fully-resolved canonical account with 200, no conflict.
      const idx2 = { index: 0 };
      const laterProvider = twoIdentityProvider(idx2, [{ id: 'org-b1', name: 'B1', urlKey: 'b1' }], [{ id: 'viewer-b1' }]);
      const laterRouter = createAuthRoutes({ provider: laterProvider, sessionStore: { cleanup: async () => {} }, ...stores });
      const laterHandler = getHandler(laterRouter, 'get', '/auth/callback');
      const laterSession = makeSession({ oauthState: 'later' });
      const laterRes = makeRes();
      await laterHandler({ query: { code: 'later', state: 'later' }, session: laterSession }, laterRes);
      assert.strictEqual(laterRes.statusCode, 200, 'a subsequent login with the twice-merged identity is an ordinary success, not a conflict');
      assert.strictEqual(laterSession.accountId, c, 'lands directly on the fully-resolved canonical account');
    });

    test('probe 3: session already on the canonical absorber, signing in with an already-merged identity is a plain 200 link — never a 409 merge offer', async () => {
      const stores = freshStores();
      const a = await stores.accountStore.createAccount();
      await stores.accountStore.linkIdentity(a._id, 'linear', 'viewer-a3', {});
      const b = await stores.accountStore.createAccount();
      await stores.accountStore.linkIdentity(b._id, 'linear', 'viewer-b3', {});
      assert.strictEqual((await stores.accountStore.mergeAccounts(a._id, b._id, { accountWorkspaceStore: stores.accountWorkspaceStore, mergeLogStore: stores.accountMergeLogStore })).ok, true);

      const idx = { index: 0 };
      const provider = twoIdentityProvider(idx,
        [{ id: 'org-a3', name: 'A3', urlKey: 'a3' }, { id: 'org-b3', name: 'B3', urlKey: 'b3' }],
        [{ id: 'viewer-a3' }, { id: 'viewer-b3' }]);
      const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...stores });
      const handler = getHandler(router, 'get', '/auth/callback');

      const session = makeSession({ oauthState: 'real' });
      await handler({ query: { code: 'c1', state: 'real' }, session }, makeRes());
      assert.strictEqual(session.accountId, a._id);

      idx.index = 1;
      session.oauthState = 'real2';
      const res = makeRes();
      await handler({ query: { code: 'c2', state: 'real2' }, session }, res);

      assert.strictEqual(res.statusCode, 200, 'plain link, never the 409 merge-offer page');
      assert.strictEqual(session.pendingMerge, undefined, 'no pendingMerge is ever created for this same-account no-op');
      assert.strictEqual(session.accountId, a._id);
    });

    test('probe 4 (Linear): a fresh sign-in with an already-merged identity durably persists the owner credential under the CANONICAL account, not the merged one', async () => {
      const stores = freshStores();
      const a = await stores.accountStore.createAccount();
      const b = await stores.accountStore.createAccount();
      await stores.accountStore.linkIdentity(b._id, 'linear', 'viewer-b4', {});
      assert.strictEqual((await stores.accountStore.mergeAccounts(a._id, b._id, { accountWorkspaceStore: stores.accountWorkspaceStore, mergeLogStore: stores.accountMergeLogStore })).ok, true);

      const idx = { index: 0 };
      const provider = twoIdentityProvider(idx, [{ id: 'org-b4', name: 'B4', urlKey: 'b4' }], [{ id: 'viewer-b4' }]);
      const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...stores });
      const handler = getHandler(router, 'get', '/auth/callback');

      const session = makeSession({ oauthState: 'real' });
      const res = makeRes();
      await handler({ query: { code: 'c1', state: 'real' }, session }, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(session.accountId, a._id, 'session.accountId is canonical, not the merged id');

      const credA = await stores.ownerCredentialStore.get(a._id, 'b4');
      assert.ok(credA, 'the durable owner-credential write landed under the CANONICAL account');
      assert.strictEqual(credA.refreshToken, 'refresh-0');
      const credB = await stores.ownerCredentialStore.get(b._id, 'b4');
      assert.strictEqual(credB, null, 'no write happened under the merged (non-canonical) account');
    });

    test('probe 6: a multi-hop merge chain (B→A→Z) resolves to the fully-walked canonical Z, not the one-hop A', async () => {
      const stores = freshStores();
      const b = await stores.accountStore.createAccount();
      await stores.accountStore.linkIdentity(b._id, 'linear', 'viewer-b6', {});
      const a = await stores.accountStore.createAccount();
      const z = await stores.accountStore.createAccount();
      assert.strictEqual((await stores.accountStore.mergeAccounts(a._id, b._id)).ok, true);
      assert.strictEqual((await stores.accountStore.mergeAccounts(z._id, a._id)).ok, true);

      const session = {};
      const mintC = await establishAccount(session, stores.accountStore, stores.accountWorkspaceStore, 'linear', 'viewer-c6', {}, 'ws-c6');
      assert.strictEqual(mintC.ok, true);

      const result = await establishAccount(session, stores.accountStore, stores.accountWorkspaceStore, 'linear', 'viewer-b6', {}, 'ws-b6');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.conflict.accountId, z._id, 'the fully-walked canonical Z, not the one-hop A');
      assert.notStrictEqual(result.conflict.accountId, a._id);
      assert.notStrictEqual(result.conflict.accountId, b._id);
    });

    // The `:155` `linkIdentity`-race sibling (plan-review F1): a genuine race
    // between the `:119` `findAccountByIdentity` lookup and the `:142`
    // `linkIdentity` write. Per the plan-review's own technique — `accountStore`
    // is a parameter to `establishAccount`, so a minimal store double that
    // forces `linkIdentity`'s result drives both branches deterministically,
    // with no real concurrent interleaving needed.
    describe(':155 linkIdentity-race sibling (both branches, per plan-review F1)', () => {
      function forcedConflictStore(realStore, conflictAccountId, { onDelete } = {}) {
        return {
          findAccountByIdentity: (...a) => realStore.findAccountByIdentity(...a),
          createAccount: (...a) => realStore.createAccount(...a),
          linkIdentity: async () => ({ ok: false, conflict: { accountId: conflictAccountId } }),
          deleteAccount: async (...a) => { onDelete?.(); return realStore.deleteAccount(...a); },
          resolveCanonicalAccountId: (...a) => realStore.resolveCanonicalAccountId(...a),
        };
      }

      test('distinct-owner branch: a raced-in owner merged into a DIFFERENT account propagates the CANONICAL conflict, not the raw race id', async () => {
        const stores = freshStores();
        const session = {};
        const initial = await establishAccount(session, stores.accountStore, stores.accountWorkspaceStore, 'linear', 'viewer-x1', {}, 'ws-x1');
        assert.strictEqual(initial.ok, true);
        const x = initial.accountId;

        const z = await stores.accountStore.createAccount();
        const o = await stores.accountStore.createAccount();
        assert.strictEqual((await stores.accountStore.mergeAccounts(z._id, o._id)).ok, true);

        const forcedStore = forcedConflictStore(stores.accountStore, o._id);
        const result = await establishAccount(session, forcedStore, stores.accountWorkspaceStore, 'linear', 'viewer-raced1', {}, 'ws-x1');

        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.conflict.accountId, z._id, 'propagated conflict is the canonical Z, not the raw race id O');
        assert.strictEqual(session.accountId, x, 'the already-established session account is untouched by a returned conflict');
      });

      test('equality branch: a raced-in owner merged into the account already being linked to falls through as a plain link — NEVER a self-merge 500 (plan-review F1)', async () => {
        const stores = freshStores();
        const session = {};
        const initial = await establishAccount(session, stores.accountStore, stores.accountWorkspaceStore, 'linear', 'viewer-x2', {}, 'ws-x2');
        const x = initial.accountId;

        // O merged into X itself — the raced-in owner resolves to the very
        // account already being established here.
        const o = await stores.accountStore.createAccount();
        assert.strictEqual((await stores.accountStore.mergeAccounts(x, o._id)).ok, true);

        let deleteCalls = 0;
        const forcedStore = forcedConflictStore(stores.accountStore, o._id, { onDelete: () => { deleteCalls++; } });
        const result = await establishAccount(session, forcedStore, stores.accountWorkspaceStore, 'linear', 'viewer-raced2', {}, 'ws-x2');

        // This is the mutation-equivalent witness for plan-review F1: against
        // the PRIOR (unconditional-canonicalization) draft, `resolvedRaceOwnerId`
        // (X) was returned as `conflict: { accountId: X }` unconditionally,
        // `respondToAccountConflict` would have built a pending merge of X into
        // X, and confirming would have called `mergeAccounts(X, X)` →
        // `{ok:false, reason:'self-merge'}` — a 500. This test was run against
        // that unconditional draft and observed failing exactly that way before
        // the corrected equality-aware control flow landed.
        assert.strictEqual(result.ok, true, 'MUST NOT be a self-merge conflict/500 — a same-side race resolves as a plain link');
        assert.strictEqual(result.accountId, x);
        assert.strictEqual(session.accountId, x);
        assert.strictEqual(deleteCalls, 0, 'must NOT take the mint-only adoption/delete path — accountId here is an existing account, not an orphan');
        const xDoc = await stores.accountStore.getAccount(x);
        assert.strictEqual(xDoc.identities.length, 1, 'no push happened on this forced-conflict call — X is untouched aside from the workspace bind/session fields');
      });

      test('a corrupt mergedInto chain on the raced-in owner degrades to the raw id rather than throwing', async () => {
        const stores = freshStores();
        const session = {};
        const initial = await establishAccount(session, stores.accountStore, stores.accountWorkspaceStore, 'linear', 'viewer-x3', {}, 'ws-x3');
        const x = initial.accountId;

        const o = await stores.accountStore.createAccount();
        const forcedStore = {
          findAccountByIdentity: (...a) => stores.accountStore.findAccountByIdentity(...a),
          createAccount: (...a) => stores.accountStore.createAccount(...a),
          linkIdentity: async () => ({ ok: false, conflict: { accountId: o._id } }),
          deleteAccount: (...a) => stores.accountStore.deleteAccount(...a),
          resolveCanonicalAccountId: async (id) => {
            if (id === o._id) throw new Error('simulated corrupt mergedInto chain');
            return stores.accountStore.resolveCanonicalAccountId(id);
          },
        };

        const result = await establishAccount(session, forcedStore, stores.accountWorkspaceStore, 'linear', 'viewer-raced3', {}, 'ws-x3');
        assert.strictEqual(result.ok, false, 'degrades to a conflict return, never throws');
        assert.strictEqual(result.conflict.accountId, o._id, 'uncanonicalized (raw) id used when resolution is corrupt');
      });
    });

    // Extends the pre-existing LIN-2265 corrupt-mergedInto coverage above
    // (which only exercised the (a) self-heal call site) to the two NEW
    // LIN-2285 call sites: the merged-side decision (b) and the final
    // session/workspace write (d).
    //
    // Acceptance-witness note: these two tests do NOT fail against
    // pre-LIN-2285 code — the old `establishAccount` never attempted
    // canonical resolution at either the existingOwner decision or the
    // existingOwner-branch write, so a corrupt chain passed through
    // unchanged there regardless, coincidentally producing the same
    // observable result this test asserts. There is no old-code failure to
    // witness for "this NEW call site degrades rather than throws," because
    // the new call site is, by definition, new. Instead these are
    // mutation-equivalent witnesses against the NEW code: with
    // `resolveCanonicalDegraded`'s try/catch removed (calling
    // `resolveCanonicalAccountId` directly), both tests were run and
    // observed failing — `establishAccount` rejects instead of completing —
    // confirming the degrade wrapper at these two call sites is load-bearing.
    describe('corrupt-chain degrade, extended to the LIN-2285 call sites', () => {
      async function seedCycle(accountStore) {
        const p = await accountStore.createAccount();
        const q = await accountStore.createAccount();
        await accountStore.collection.updateOne({ _id: p._id }, { $set: { mergedInto: q._id } });
        await accountStore.collection.updateOne({ _id: q._id }, { $set: { mergedInto: p._id } });
        await assert.rejects(() => accountStore.resolveCanonicalAccountId(p._id), /cycle detected/,
          'sanity: the seeded pair is genuinely unresolvable');
        return { p, q };
      }

      test('(b) merged-side decision: a corrupt existingOwner chain degrades the conflict payload to the raw id rather than throwing', async () => {
        const stores = freshStores();
        const { p } = await seedCycle(stores.accountStore);
        await stores.accountStore.linkIdentity(p._id, 'linear', 'viewer-corrupt-b', {});

        const otherSession = {};
        const other = await establishAccount(otherSession, stores.accountStore, stores.accountWorkspaceStore, 'linear', 'viewer-other-b', {}, 'ws-other-b');
        assert.strictEqual(other.ok, true);

        // otherSession is signed in as a distinct account, so this raises the
        // decision comparison at (b) against the corrupt existingOwner.
        const result = await establishAccount(otherSession, stores.accountStore, stores.accountWorkspaceStore, 'linear', 'viewer-corrupt-b', {}, 'ws-corrupt-b');
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.conflict.accountId, p._id, 'degraded to the uncanonicalized id — never a throw');
      });

      test('(b)+(d) fresh sign-in with a corrupt existingOwner completes instead of throwing, keeping the id uncanonicalized', async () => {
        const stores = freshStores();
        const { p } = await seedCycle(stores.accountStore);
        await stores.accountStore.linkIdentity(p._id, 'linear', 'viewer-corrupt-bd', {});

        const session = {};
        const result = await establishAccount(session, stores.accountStore, stores.accountWorkspaceStore, 'linear', 'viewer-corrupt-bd', {}, 'ws-corrupt-bd');
        assert.strictEqual(result.ok, true, 'sign-in proceeds instead of throwing');
        assert.strictEqual(result.accountId, p._id);
        assert.strictEqual(session.accountId, p._id, 'degraded to the uncanonicalized id at the final write too');
      });
    });
  });
});

// LIN-2285 step 4: `routes/account-merge.js`'s residual `/auth/merge/confirm`
// 500 is reason-specific for all six `mergeAccounts` failure reasons
// (lib/account-store.js:226-254), never the generic "Could not complete the
// merge." fallback for a reason the store actually returns. A minimal
// `mergeAccounts`-forcing store double drives all six deterministically,
// mirroring the technique used for the `:155` race sibling above.
describe('LIN-2285 — residual /auth/merge/confirm 500 is reason-specific for all six mergeAccounts failure reasons', () => {
  function makeForcedConfirmHandler(reason) {
    const forcedStore = { mergeAccounts: async () => ({ ok: false, reason }) };
    const router = createAccountMergeRoutes({ accountStore: forcedStore, accountWorkspaceStore: {} });
    return getHandler(router, 'post', '/auth/merge/confirm');
  }

  function makeConfirmSession() {
    return {
      accountId: 'canonical-1',
      identityAuthenticatedAt: Date.now(),
      pendingMerge: { canonicalAccountId: 'canonical-1', mergedAccountId: 'merged-1', workspace: {}, mode: 'new', createdAt: Date.now() },
      save(cb) { if (cb) cb(); },
    };
  }

  const REASONS = ['missing-id', 'self-merge', 'unknown-canonical', 'unknown-merged', 'canonical-already-merged', 'already-merged'];

  for (const reason of REASONS) {
    test(`reason '${reason}' gets specific copy, not the generic "Could not complete the merge. Please try again."`, async () => {
      const confirmHandler = makeForcedConfirmHandler(reason);
      const res = makeRes();
      await confirmHandler({ session: makeConfirmSession() }, res);

      assert.strictEqual(res.statusCode, 500);
      assert.doesNotMatch(res.body, /Could not complete the merge\. Please try again\./,
        'never the generic fallback for a reason mergeAccounts actually returns');
      assert.match(res.body, /Could not complete the merge/, 'still names the failure as a merge failure');
    });
  }

  test('an unrecognized reason still falls back to the generic copy (defensive, not expected to trigger)', async () => {
    const confirmHandler = makeForcedConfirmHandler('some-future-reason-not-yet-invented');
    const res = makeRes();
    await confirmHandler({ session: makeConfirmSession() }, res);

    assert.strictEqual(res.statusCode, 500);
    assert.match(res.body, /Could not complete the merge\. Please try again\./);
  });
});
