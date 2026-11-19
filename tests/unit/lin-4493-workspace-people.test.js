/**
 * LIN-4493 (decision 4, John's ruling "link-account"): the name a tracker sign-in stores on the account's identity, and
 * the one reader that lists a workspace's people from it (lib/workspace-people.js), on the real stores (MangoDB).
 *
 * Witnesses: a sign-in stores the name on the identity and a later sign-in refreshes it (and one without a name keeps
 * the stored one); the reader lists a workspace member with a named tracker identity once, under the account id;
 * it leaves out an email-only member, a member with no name, and an account that is not in the workspace; a merged
 * account's identity is read with its canonical account's, and the person is listed once.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { WorkspaceStore } from '../../lib/workspace-store.js';
import { establishAccount } from '../../lib/account-session.js';
import { createListWorkspacePeople } from '../../lib/workspace-people.js';

const harness = createMangoTmpdir('lin-4493-people-');
let db;
let accounts;
let memberships;
let workspaces;
let listPeople;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
  accounts = new AccountStore({ collection: db.collection('accounts') });
  memberships = new AccountWorkspaceStore({ collection: db.collection('account-workspaces') });
  workspaces = new WorkspaceStore({ collection: db.collection('workspaces') });
  const registered = await workspaces.registerWorkspace({ id: 'ws-acme', urlKey: 'acme', provider: 'linear' });
  assert.equal(registered.ok, true, JSON.stringify(registered));
  listPeople = createListWorkspacePeople({ workspaceStore: workspaces, accountStore: accounts, accountWorkspaceStore: memberships });
});

/** An account with the given identities, bound to the workspace when `member` is set. */
async function person({ identities = [], member = true } = {}) {
  const account = await accounts.createAccount();
  for (const [provider, scope, name] of identities) await accounts.linkIdentity(account._id, provider, scope, {}, { name });
  if (member) await memberships.bindAccountToWorkspace(account._id, 'ws-acme');
  return account._id;
}

describe('a tracker sign-in stores the name the tracker shows, on the identity', () => {
  test('linking an identity with a name stores it; a later sign-in refreshes it; one with no name keeps the stored name', async () => {
    const id = await person({ identities: [['linear', 'viewer-john', 'John Kershaw']] });
    assert.equal((await accounts.getAccount(id)).identities[0].name, 'John Kershaw');
    await accounts.linkIdentity(id, 'linear', 'viewer-john', {}, { name: 'John K.' });
    assert.equal((await accounts.getAccount(id)).identities[0].name, 'John K.', 'refreshed on sign-in');
    await accounts.linkIdentity(id, 'linear', 'viewer-john', {});
    assert.equal((await accounts.getAccount(id)).identities[0].name, 'John K.', 'a sign-in with no name keeps it');
  });

  test('establishAccount passes the name through to the identity, for a new account and a returning one', async () => {
    const session = {};
    const first = await establishAccount(session, accounts, memberships, 'github', 'octo-1', { login: 'octo' }, 'ws-acme', { name: 'octo' });
    assert.equal(first.ok, true, JSON.stringify(first));
    const again = await establishAccount({ accountId: first.accountId }, accounts, memberships, 'github', 'octo-1', { login: 'octo' }, 'ws-acme', { name: 'Octo Cat' });
    assert.equal(again.ok, true, JSON.stringify(again));
    const account = await accounts.getAccount(first.accountId);
    assert.equal(account.identities.find((i) => i.provider === 'github').name, 'Octo Cat');
  });
});

describe('the reader lists a workspace\'s people from the names on their tracker identities', () => {
  test('a member with a named identity on the workspace\'s provider is listed once, under the account id', async () => {
    const id = await person({ identities: [['linear', 'viewer-john', 'John Kershaw']] });
    assert.deepEqual(await listPeople('acme'), [{ accountId: id, name: 'John Kershaw', trackerUserId: 'viewer-john' }]);
  });

  test('an email-only member, a member with no name, and a non-member are left out', async () => {
    const john = await person({ identities: [['linear', 'viewer-john', 'John Kershaw']] });
    await person({ identities: [['email', 'ada@example.test', undefined]] });
    await person({ identities: [['linear', 'viewer-noname', null]] });
    await person({ identities: [['linear', 'viewer-outsider', 'Outsider']], member: false });
    const people = await listPeople('acme');
    assert.deepEqual(people.map((p) => p.accountId), [john]);
  });

  test('an identity on another provider does not name the person on this workspace', async () => {
    await person({ identities: [['github', 'octo-2', 'octo']] });
    assert.deepEqual(await listPeople('acme'), []);
  });

  test('a workspace that is not registered has no people', async () => {
    assert.deepEqual(await listPeople('nowhere'), []);
  });

  test('a merged account\'s identity is read with its canonical account, and the person is listed once', async () => {
    const canonical = await person({ identities: [['linear', 'viewer-john', 'John Kershaw']] });
    const merged = await person({ identities: [['linear', 'viewer-john-2', 'J. Kershaw']] });
    const merge = await accounts.mergeAccounts(canonical, merged, { accountWorkspaceStore: memberships });
    assert.equal(merge.ok, true, JSON.stringify(merge));
    const people = await listPeople('acme');
    assert.equal(people.length, 1, 'one person, not one per account');
    assert.equal(people[0].accountId, canonical);
    assert.equal(people[0].name, 'John Kershaw');
  });
});
