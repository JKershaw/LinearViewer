/**
 * Unit tests for lib/account-session.js's `establishAccount` (LIN-1329, Phase C
 * of LIN-1326) — the single seam every sign-in path converges on.
 *
 * Against REAL MangoDB tmpdir-backed AccountStore/AccountWorkspaceStore
 * instances (precedent: tests/unit/account-store.test.js), not hand-rolled
 * fakes, since correctness here rests on the stores' own find/link/bind
 * semantics.
 *
 * Run with: node --test tests/unit/account-session.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { establishAccount } from '../../lib/account-session.js';
import { ensureIndexes } from '../../lib/db-indexes.js';

describe('establishAccount', () => {
  let client;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'account-session-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStores() {
    const db = client.db(`acct_${counter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
  }

  // The mint-branch race (below) is only actually racy with the
  // `accounts_identity_unique` index built (lib/db-indexes.js) — that index is
  // the SOLE cross-document enforcer (LIN-1338); without it two concurrent
  // pushes both just succeed and no conflict is ever produced to reconcile.
  // Mirrors real boot (server.js calls ensureIndexes) and the review's own repro.
  async function freshIndexedStores() {
    const db = client.db(`acct_${counter++}`);
    await ensureIndexes(db);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
  }

  test('fresh sign-in: mints a new account, links the identity, binds the workspace, sets session.accountId', async () => {
    const { accountStore, accountWorkspaceStore } = freshStores();
    const session = {};

    const result = await establishAccount(session, accountStore, accountWorkspaceStore, 'linear', 'viewer-1', { name: 'Ada' }, 'ws-1');

    assert.strictEqual(result.ok, true);
    assert.strictEqual(session.accountId, result.accountId);
    const account = await accountStore.getAccount(result.accountId);
    assert.deepStrictEqual(account.identities, [{ provider: 'linear', scope: 'viewer-1', credentials: { name: 'Ada' } }]);
    const workspaces = await accountWorkspaceStore.listWorkspacesForAccount(result.accountId);
    assert.deepStrictEqual(workspaces, ['ws-1']);
  });

  test('returning user with no session: an identity already owned by an account is REUSED, not re-minted (the day-2-login bug)', async () => {
    const { accountStore, accountWorkspaceStore } = freshStores();
    const firstSession = {};
    const first = await establishAccount(firstSession, accountStore, accountWorkspaceStore, 'linear', 'viewer-2', {}, 'ws-1');

    // Simulate a brand-new browser session — logged out, or a fresh device —
    // where session.accountId is unset, but the identity has been seen before.
    const secondSession = {};
    const second = await establishAccount(secondSession, accountStore, accountWorkspaceStore, 'linear', 'viewer-2', {}, 'ws-2');

    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.accountId, first.accountId, 'reuses the SAME account, does not mint a new one');
    const workspaces = await accountWorkspaceStore.listWorkspacesForAccount(first.accountId);
    assert.deepStrictEqual(workspaces.sort(), ['ws-1', 'ws-2']);
  });

  test('second-provider sign-in while already signed in attaches a second identity to the SAME account', async () => {
    const { accountStore, accountWorkspaceStore } = freshStores();
    const session = {};
    const first = await establishAccount(session, accountStore, accountWorkspaceStore, 'linear', 'viewer-3', {}, 'ws-1');
    assert.strictEqual(first.ok, true);

    // session.accountId now carries over (still signed in), linking a second,
    // never-before-seen identity.
    const second = await establishAccount(session, accountStore, accountWorkspaceStore, 'github', 'gh-user-3', { login: 'ada' }, 'ws-1');

    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.accountId, first.accountId);
    const account = await accountStore.getAccount(first.accountId);
    assert.strictEqual(account.identities.length, 2);
    assert.deepStrictEqual(account.identities.map(i => i.provider).sort(), ['github', 'linear']);
  });

  test('strict conflict: an identity already linked to a DIFFERENT account returns the conflict signal and mutates neither side', async () => {
    const { accountStore, accountWorkspaceStore } = freshStores();
    const sessionA = {};
    const accountA = await establishAccount(sessionA, accountStore, accountWorkspaceStore, 'linear', 'viewer-a', {}, 'ws-a');
    const sessionB = {};
    const accountB = await establishAccount(sessionB, accountStore, accountWorkspaceStore, 'linear', 'viewer-b', {}, 'ws-b');
    assert.notStrictEqual(accountA.accountId, accountB.accountId);

    // Session B is signed in as account B, but tries to link an identity
    // (viewer-a) that already belongs to account A.
    sessionB.accountId = accountB.accountId;
    const conflict = await establishAccount(sessionB, accountStore, accountWorkspaceStore, 'linear', 'viewer-a', {}, 'ws-b');

    assert.strictEqual(conflict.ok, false);
    assert.strictEqual(conflict.conflict.accountId, accountA.accountId);
    // Neither account was mutated: A still has exactly its own identity, B still
    // has exactly its own identity — no auto-merge.
    const acctA = await accountStore.getAccount(accountA.accountId);
    const acctB = await accountStore.getAccount(accountB.accountId);
    assert.strictEqual(acctA.identities.length, 1);
    assert.strictEqual(acctB.identities.length, 1);
    // session.accountId is untouched by the failed attempt.
    assert.strictEqual(sessionB.accountId, accountB.accountId);
  });

  test('idempotent re-link: signing in again with the SAME identity on the SAME account merges credentials, no duplicate identity', async () => {
    const { accountStore, accountWorkspaceStore } = freshStores();
    const session = {};
    const first = await establishAccount(session, accountStore, accountWorkspaceStore, 'github', 'gh-4', { login: 'old-login' }, 'ws-1');
    const second = await establishAccount(session, accountStore, accountWorkspaceStore, 'github', 'gh-4', { login: 'new-login' }, 'ws-1');

    assert.strictEqual(second.accountId, first.accountId);
    const account = await accountStore.getAccount(first.accountId);
    assert.strictEqual(account.identities.length, 1, 'no duplicate identity entry');
    assert.strictEqual(account.identities[0].credentials.login, 'new-login', 'credentials merged, newest wins');
  });

  test('re-binding the same account to the same workspace is idempotent (no duplicate edge)', async () => {
    const { accountStore, accountWorkspaceStore } = freshStores();
    const session = {};
    await establishAccount(session, accountStore, accountWorkspaceStore, 'local', 'url-key-1', {}, 'ws-1');
    await establishAccount(session, accountStore, accountWorkspaceStore, 'local', 'url-key-1', {}, 'ws-1');

    const workspaces = await accountWorkspaceStore.listWorkspacesForAccount(session.accountId);
    assert.deepStrictEqual(workspaces, ['ws-1']);
  });

  test('concurrent first sign-ins for the SAME identity: one real account, no false conflict for the loser, no orphan left behind (LIN-1329 review finding 1)', async () => {
    const { accountStore, accountWorkspaceStore } = await freshIndexedStores();
    const sessionA = {};
    const sessionB = {};

    const [resultA, resultB] = await Promise.all([
      establishAccount(sessionA, accountStore, accountWorkspaceStore, 'github', 'human-race', { login: 'tabA' }, 'ws-a'),
      establishAccount(sessionB, accountStore, accountWorkspaceStore, 'github', 'human-race', { login: 'tabB' }, 'ws-b'),
    ]);

    // Neither caller sees a conflict — both are the SAME human's own first sign-in.
    assert.strictEqual(resultA.ok, true, 'tab A must not see a conflict');
    assert.strictEqual(resultB.ok, true, 'tab B must not see a conflict against its own sign-in');
    assert.strictEqual(resultA.accountId, resultB.accountId, 'both land on the SAME winning account');
    assert.strictEqual(sessionA.accountId, resultA.accountId);
    assert.strictEqual(sessionB.accountId, resultB.accountId);

    // Exactly one account exists — no orphan left behind by the losing mint.
    const winner = await accountStore.getAccount(resultA.accountId);
    assert.ok(winner, 'the winning account exists');
    assert.strictEqual(winner.identities.length, 1, 'exactly one identity, no duplicate');
    assert.strictEqual(winner.identities[0].scope, 'human-race');

    // The loser's freshly-minted, zero-identity account was deleted, not left behind.
    const accounts = await accountStore.collection.find({}).toArray();
    assert.strictEqual(accounts.length, 1, 'no zero-identity orphan account remains');

    // Both callers' workspaces are bound to the one surviving account.
    const workspaces = await accountWorkspaceStore.listWorkspacesForAccount(resultA.accountId);
    assert.deepStrictEqual(workspaces.sort(), ['ws-a', 'ws-b']);
  });
});

// LIN-1892 S2 item 5: a null workspace is an identity-only sign-in (email).
// It must write NO account↔workspace edge; a real id behaves exactly as before.
describe('establishAccount with a null workspace (LIN-1892 identity-only sign-in)', () => {
  let client;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'account-session-null-ws-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  async function freshStores() {
    const db = client.db(`acct_null_${counter++}`);
    await ensureIndexes(db);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      edges: db.collection('account-workspaces'),
    };
  }

  test('null workspace: mints the account, links the email identity, sets accountId and freshness, writes no edge', async () => {
    const { accountStore, accountWorkspaceStore, edges } = await freshStores();
    const session = {};
    const before = Date.now();

    const result = await establishAccount(session, accountStore, accountWorkspaceStore, 'email', 'a@x.io', {}, null);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(session.accountId, result.accountId);
    assert.ok(Number.isFinite(session.identityAuthenticatedAt) && session.identityAuthenticatedAt >= before, 'freshness stamped');
    const account = await accountStore.getAccount(result.accountId);
    assert.deepStrictEqual(account.identities, [{ provider: 'email', scope: 'a@x.io', credentials: {} }]);
    assert.strictEqual(await edges.countDocuments({}), 0, 'no account↔workspace edge');
  });

  test('undefined workspace is treated the same as null (no edge)', async () => {
    const { accountStore, accountWorkspaceStore, edges } = await freshStores();
    const result = await establishAccount({}, accountStore, accountWorkspaceStore, 'email', 'a@x.io', {}, undefined);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(await edges.countDocuments({}), 0);
  });

  test('returning email sign-in in a new session lands on the same account, still with no edge', async () => {
    const { accountStore, accountWorkspaceStore, edges } = await freshStores();
    const first = await establishAccount({}, accountStore, accountWorkspaceStore, 'email', 'a@x.io', {}, null);
    const secondSession = {};
    const second = await establishAccount(secondSession, accountStore, accountWorkspaceStore, 'email', 'a@x.io', {}, null);

    assert.strictEqual(second.accountId, first.accountId);
    assert.strictEqual(secondSession.accountId, first.accountId);
    assert.strictEqual(await accountStore.collection.countDocuments({}), 1, 'no second account');
    assert.strictEqual(await edges.countDocuments({}), 0);
  });

  test('live account already holding the email: re-stamps freshness, links nothing new, leaves existing edges alone', async () => {
    const { accountStore, accountWorkspaceStore } = await freshStores();
    const session = {};
    const linear = await establishAccount(session, accountStore, accountWorkspaceStore, 'linear', 'viewer-1', {}, 'ws-1');
    await establishAccount(session, accountStore, accountWorkspaceStore, 'email', 'p@x.io', {}, null);
    session.identityAuthenticatedAt = 0;

    const again = await establishAccount(session, accountStore, accountWorkspaceStore, 'email', 'p@x.io', {}, null);

    assert.deepStrictEqual(again, { ok: true, accountId: linear.accountId });
    assert.ok(session.identityAuthenticatedAt > 0, 'freshness re-stamped');
    const account = await accountStore.getAccount(linear.accountId);
    assert.deepStrictEqual(account.identities.map(i => `${i.provider}:${i.scope}`), ['linear:viewer-1', 'email:p@x.io']);
    assert.deepStrictEqual(await accountWorkspaceStore.listAllEdges(), [{ accountId: linear.accountId, workspaceId: 'ws-1' }]);
  });

  test('a conflict with a null workspace is still returned unchanged, and writes no edge', async () => {
    const { accountStore, accountWorkspaceStore, edges } = await freshStores();
    const owner = await establishAccount({}, accountStore, accountWorkspaceStore, 'email', 'e@x.io', {}, null);
    const session = {};
    await establishAccount(session, accountStore, accountWorkspaceStore, 'linear', 'viewer-p', {}, 'ws-p');

    const result = await establishAccount(session, accountStore, accountWorkspaceStore, 'email', 'e@x.io', {}, null);

    assert.deepStrictEqual(result, { ok: false, conflict: { accountId: owner.accountId } });
    assert.deepStrictEqual((await edges.find({}).toArray()).map(e => e.workspaceId), ['ws-p']);
  });

  test('a real workspace id behaves exactly as before: one edge, keyed to the canonical account', async () => {
    const { accountStore, accountWorkspaceStore, edges } = await freshStores();
    const session = {};
    const result = await establishAccount(session, accountStore, accountWorkspaceStore, 'linear', 'viewer-1', { name: 'Ada' }, 'ws-1');

    assert.strictEqual(result.ok, true);
    // Compared through listAllEdges' {accountId, workspaceId} projection, not
    // the raw key set: S1 (PR #1601) adds an owner `role` to first edges.
    assert.deepStrictEqual(await accountWorkspaceStore.listAllEdges(), [{ accountId: result.accountId, workspaceId: 'ws-1' }]);
    assert.strictEqual(await edges.countDocuments({}), 1);
  });
});
