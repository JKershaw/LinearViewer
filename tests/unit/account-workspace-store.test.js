/**
 * Unit tests for lib/account-workspace-store.js (LIN-1328).
 *
 * Run with: node --test tests/unit/account-workspace-store.test.js
 *
 * Against a REAL MangoDB tmpdir instance (precedent: tests/unit/account-store.test.js)
 * — this store's entire claim is durability + explicit (non-embedded)
 * association, so a mock would just encode the assumption instead of testing it.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';

describe('account-workspace-store', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'account-workspace-store-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshDb() {
    return client.db(`aw_${counter++}`);
  }

  function freshStore() {
    return new AccountWorkspaceStore({ collection: freshDb().collection('account-workspaces') });
  }

  // A1
  test('bindAccountToWorkspace then listWorkspacesForAccount round-trips', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const workspaceId = randomUUID();

    await store.bindAccountToWorkspace(accountId, workspaceId);

    const workspaces = await store.listWorkspacesForAccount(accountId);
    assert.deepStrictEqual(workspaces, [workspaceId]);
  });

  // A2 - many-to-many direction 1: one account, two workspaces
  test('one account binds to two workspaces', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();

    await store.bindAccountToWorkspace(accountId, workspaceA);
    await store.bindAccountToWorkspace(accountId, workspaceB);

    const workspaces = await store.listWorkspacesForAccount(accountId);
    assert.strictEqual(workspaces.length, 2);
    assert.ok(workspaces.includes(workspaceA));
    assert.ok(workspaces.includes(workspaceB));
  });

  // A3 - many-to-many direction 2: one workspace, two accounts
  test('one workspace binds to two accounts', async () => {
    const store = freshStore();
    const workspaceId = randomUUID();
    const accountA = randomUUID();
    const accountB = randomUUID();

    await store.bindAccountToWorkspace(accountA, workspaceId);
    await store.bindAccountToWorkspace(accountB, workspaceId);

    const accounts = await store.listAccountsForWorkspace(workspaceId);
    assert.strictEqual(accounts.length, 2);
    assert.ok(accounts.includes(accountA));
    assert.ok(accounts.includes(accountB));
  });

  // A4 - idempotent re-bind
  test('re-binding the same pair is idempotent: exactly one edge, no throw', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const workspaceId = randomUUID();

    await store.bindAccountToWorkspace(accountId, workspaceId);
    await store.bindAccountToWorkspace(accountId, workspaceId);

    const workspaces = await store.listWorkspacesForAccount(accountId);
    assert.deepStrictEqual(workspaces, [workspaceId]);
  });

  // A5 - unbind preserves siblings
  test('unbind removes only the named edge; sibling bindings survive', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();

    await store.bindAccountToWorkspace(accountId, workspaceA);
    await store.bindAccountToWorkspace(accountId, workspaceB);

    await store.unbindAccountFromWorkspace(accountId, workspaceA);

    const workspaces = await store.listWorkspacesForAccount(accountId);
    assert.deepStrictEqual(workspaces, [workspaceB]);
  });

  // A6 - structural: not embedded
  test('structural: the edge lives in its own collection; neither account nor workspace doc gains a membership array', async () => {
    const db = freshDb();
    const accountsCollection = db.collection('accounts');
    const workspacesCollection = db.collection('workspaces');
    const edgeCollection = db.collection('account-workspaces');

    const accountId = randomUUID();
    const workspaceId = randomUUID();
    await accountsCollection.insertOne({ _id: accountId, identities: [] });
    await workspacesCollection.insertOne({ _id: workspaceId, name: 'Acme' });

    const store = new AccountWorkspaceStore({ collection: edgeCollection });
    await store.bindAccountToWorkspace(accountId, workspaceId);

    const edges = await edgeCollection.find({ accountId, workspaceId }).toArray();
    assert.strictEqual(edges.length, 1, 'the edge must exist as its own document');

    const accountDoc = await accountsCollection.findOne({ _id: accountId });
    const workspaceDoc = await workspacesCollection.findOne({ _id: workspaceId });
    assert.ok(!('workspaces' in accountDoc), 'account document must not gain a membership array');
    assert.ok(!('accounts' in workspaceDoc), 'workspace document must not gain a membership array');
  });

  // A7 - no credentials on the edge
  test('the edge carries no credentials: its key set is exactly {_id, accountId, workspaceId, createdAt}', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const workspaceId = randomUUID();

    const edge = await store.bindAccountToWorkspace(accountId, workspaceId);

    assert.deepStrictEqual(new Set(Object.keys(edge)), new Set(['_id', 'accountId', 'workspaceId', 'createdAt']));
  });

  // A8 - durability, cross-client reopen
  test('durability: survives closing and reopening a new MangoClient over the same dbDir', async () => {
    const reopenDir = mkdtempSync(join(tmpdir(), 'account-workspace-store-reopen-'));
    try {
      const clientA = new MangoClient(reopenDir);
      await clientA.connect();
      const storeA = new AccountWorkspaceStore({ collection: clientA.db('main').collection('account-workspaces') });
      const accountId = randomUUID();
      const workspaceId = randomUUID();
      await storeA.bindAccountToWorkspace(accountId, workspaceId);
      await clientA.close();

      const clientB = new MangoClient(reopenDir);
      await clientB.connect();
      const storeB = new AccountWorkspaceStore({ collection: clientB.db('main').collection('account-workspaces') });
      const workspaces = await storeB.listWorkspacesForAccount(accountId);
      assert.deepStrictEqual(workspaces, [workspaceId]);
      await clientB.close();
    } finally {
      rmSync(reopenDir, { recursive: true, force: true });
    }
  });
});
