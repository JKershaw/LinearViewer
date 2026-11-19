/**
 * LIN-4494 (the `?assignee=me` name, LIN-4491 review): the signed-in person's name comes from the workspace's people
 * (lib/workspace-people.js) before the provider's viewer, and the people reader batches its reads.
 *
 * Witnesses: the helper gives the workspace's name for a member, through a merged account's canonical person, and null for
 * a non-person; the server's own resolveAssigneeSelection (sliced from server.js, as the LIN-2526 harness does) takes the
 * stored name, falls through to the viewer when there is none, never asks a viewer for a signed-out request, and still
 * degrades a provider with no viewer to all; the people reader makes the same number of reads for one member as for five
 * (the real stores, MangoDB), and a per-account read would be caught.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { WorkspaceStore } from '../../lib/workspace-store.js';
import { createListWorkspacePeople, storedNameOf } from '../../lib/workspace-people.js';

const SERVER_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../server.js'), 'utf8');
const people = (list) => async () => list;

describe('storedNameOf: the name the workspace shows for the signed-in person', () => {
  const canonicalIs = (map) => async (id) => map[id] ?? id;

  test('a member with a stored name gets that name', async () => {
    const name = await storedNameOf({ accountId: 'acc-john', urlKey: 'acme' }, { listPeople: people([{ accountId: 'acc-john', name: 'John Kershaw' }]), canonicalAccountId: canonicalIs({}) });
    assert.equal(name, 'John Kershaw');
  });

  test('a merged account resolves to its canonical person first', async () => {
    const name = await storedNameOf({ accountId: 'acc-old', urlKey: 'acme' }, { listPeople: people([{ accountId: 'acc-john', name: 'John Kershaw' }]), canonicalAccountId: canonicalIs({ 'acc-old': 'acc-john' }) });
    assert.equal(name, 'John Kershaw');
  });

  test('an account that is not a named person here gets null, so the caller asks the viewer', async () => {
    assert.equal(await storedNameOf({ accountId: 'acc-new', urlKey: 'acme' }, { listPeople: people([{ accountId: 'acc-john', name: 'John Kershaw' }]), canonicalAccountId: canonicalIs({}) }), null);
    assert.equal(await storedNameOf({ accountId: null, urlKey: 'acme' }, { listPeople: people([]), canonicalAccountId: canonicalIs({}) }), null);
  });
});

describe("the server's ?assignee=me, from the real resolveAssigneeSelection body", () => {
  /** The function as server.js writes it: sliced from its marker to the next route block, as the LIN-2526 harness does. */
  function sliceResolveAssigneeSelection() {
    const startIdx = SERVER_SRC.indexOf('async function resolveAssigneeSelection(req, provider, scope) {');
    assert.notEqual(startIdx, -1, 'expected resolveAssigneeSelection in server.js');
    const endIdx = SERVER_SRC.indexOf('\n/**\n * Workspace project view', startIdx);
    assert.notEqual(endIdx, -1, 'expected the docstring marker bounding resolveAssigneeSelection');
    return SERVER_SRC.slice(startIdx, endIdx);
  }

  function makeProvider({ supportsViewer = true, viewer = { name: 'From Linear' } } = {}) {
    const calls = { viewer: 0 };
    return {
      calls,
      supports: (method) => method === 'viewer' && supportsViewer,
      viewer: async () => { calls.viewer += 1; return viewer; },
    };
  }

  /** Run the real body with `storedPersonNameOf` stubbed to `stored` (the server's helper, which reads the people). */
  async function resolve({ session = null, stored = null, provider = makeProvider(), assignee = 'me' } = {}) {
    const context = vm.createContext({ console: { error() {} }, storedPersonNameOf: async () => stored });
    const fn = vm.runInContext([sliceResolveAssigneeSelection(), '', 'resolveAssigneeSelection'].join('\n'), context);
    const req = { query: { assignee }, session, workspace: { urlKey: 'acme' } };
    // The VM's objects come from another realm: a JSON round-trip makes them this realm's plain values.
    return { out: JSON.parse(JSON.stringify(await fn(req, provider, { token: 'x' }))), provider };
  }

  test('a signed-in person with a stored name gets it, and the provider viewer is not asked', async () => {
    const { out, provider } = await resolve({ session: { accountId: 'acc-john' }, stored: 'John Kershaw' });
    assert.deepEqual(out, { selectedAssignee: 'me', resolvedAssigneeName: 'John Kershaw' });
    assert.equal(provider.calls.viewer, 0);
  });

  test('a signed-in person with no stored name falls through to the provider viewer, as before', async () => {
    const { out, provider } = await resolve({ session: { accountId: 'acc-new' }, stored: null });
    assert.deepEqual(out, { selectedAssignee: 'me', resolvedAssigneeName: 'From Linear' });
    assert.equal(provider.calls.viewer, 1);
  });

  test('a request with no session never reads the stored name, and reads the viewer as before', async () => {
    const { out, provider } = await resolve({ session: null, stored: 'John Kershaw' });
    assert.equal(out.resolvedAssigneeName, 'From Linear');
    assert.equal(provider.calls.viewer, 1);
  });

  test('a provider with no viewer still reads all, even when the workspace has the name', async () => {
    const { out } = await resolve({ session: { accountId: 'acc-john' }, stored: 'John Kershaw', provider: makeProvider({ supportsViewer: false }) });
    assert.deepEqual(out, { selectedAssignee: 'all', resolvedAssigneeName: null });
  });

  test('an explicit name and all are unchanged', async () => {
    assert.deepEqual((await resolve({ session: { accountId: 'acc-john' }, stored: 'John Kershaw', assignee: 'Ada' })).out, { selectedAssignee: 'Ada', resolvedAssigneeName: 'Ada' });
    assert.deepEqual((await resolve({ session: { accountId: 'acc-john' }, stored: 'John Kershaw', assignee: 'all' })).out, { selectedAssignee: 'all', resolvedAssigneeName: null });
  });
});

describe('the workspace people reader batches its reads (real stores)', () => {
  const harness = createMangoTmpdir('lin-4494-home-people-');
  let db;
  let accounts;
  let memberships;
  let workspaces;
  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(async () => {
    db = harness.freshDb();
    accounts = new AccountStore({ collection: db.collection('accounts') });
    memberships = new AccountWorkspaceStore({ collection: db.collection('account-workspaces') });
    workspaces = new WorkspaceStore({ collection: db.collection('workspaces') });
    await workspaces.registerWorkspace({ id: 'ws-acme', urlKey: 'acme', provider: 'linear' });
  });

  async function member(name, { mergedInto = null } = {}) {
    const account = await accounts.createAccount();
    if (name) await accounts.linkIdentity(account._id, 'linear', `viewer-${account._id}`, {}, { name });
    if (mergedInto) await accounts.collection.updateOne({ _id: account._id }, { $set: { mergedInto } });
    await memberships.bindAccountToWorkspace(account._id, 'ws-acme');
    return account._id;
  }

  /** Counts every read the store makes (find and findOne), so a per-account read cannot hide behind either. */
  function countReads(store) {
    const counter = { reads: 0 };
    for (const name of ['find', 'findOne']) {
      const original = store.collection[name].bind(store.collection);
      store.collection[name] = (...args) => { counter.reads += 1; return original(...args); };
    }
    return counter;
  }

  test('one member and five members cost the same number of account reads, and the merged person is listed once', async () => {
    const one = await member('John Kershaw');
    const listPeople = createListWorkspacePeople({ workspaceStore: workspaces, accountStore: accounts, accountWorkspaceStore: memberships });
    const counterOne = countReads(accounts);
    assert.deepEqual((await listPeople('acme')).map((p) => p.accountId), [one]);
    const readsForOne = counterOne.reads;
    delete accounts.collection.find;
    delete accounts.collection.findOne;

    const canonical = await member('Ada Lovelace');
    const old = await member(null, { mergedInto: canonical });
    await member('Grace Hopper');
    await member('Linus Torvalds');
    await member('Barbara Liskov');
    const counterFive = countReads(accounts);
    const five = await listPeople('acme');
    assert.equal(five.length, 5, 'five people, the merged account not listed twice');
    assert.ok(five.some((p) => p.accountId === canonical && p.name === 'Ada Lovelace'), 'the merged pair is read as the canonical person');
    assert.equal(five.some((p) => p.accountId === old), false);
    assert.equal(counterFive.reads, readsForOne + 2, 'a bounded number of reads: the same shape, not one per member');
  });
});
