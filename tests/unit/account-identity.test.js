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
      const confirmHandler = getHandler(router, 'post', '/auth/merge/confirm');

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
      // registered on B (mergeAccounts never touches identities[]), so
      // session.accountId picks up B, the non-canonical id, exactly as
      // LIN-2265 describes.
      idx.index = 1;
      const s2 = makeSession({ oauthState: 'real3' });
      const res2 = makeRes();
      await callbackHandler({ query: { code: 'c3', state: 'real3' }, session: s2 }, res2);
      assert.strictEqual(res2.statusCode, 200, 'round 2 step 1: an ordinary successful login, not a conflict');
      assert.strictEqual(s2.accountId, otherAccount._id, 'session.accountId is the merged (non-canonical) id after this login — the reachable hazard');

      // Then, SAME session, sign in with the canonical identity. Before the
      // fix this reached establishAccount with session.accountId === B and
      // existingOwner === A, raised a conflict, and confirming it wrote
      // A.mergedInto = B — a CYCLE (A.mergedInto=B, B.mergedInto=A) that makes
      // resolveCanonicalAccountId throw for both accounts forever. The fix in
      // establishAccount canonicalizes session.accountId (B -> A) BEFORE this
      // comparison, so it now matches existingOwner and no conflict is raised
      // at all — the login just succeeds under the canonical account.
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
      const confirmHandler = getHandler(router, 'post', '/auth/merge/confirm');

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
      idx.index = 0;
      const s2 = makeSession({ oauthState: 'real3' });
      const res2 = makeRes();
      await callbackHandler({ query: { code: 'c3', state: 'real3' }, session: s2 }, res2);
      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(s2.accountId, mineAccount._id, 'picks up the merged, non-canonical id');

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
});
