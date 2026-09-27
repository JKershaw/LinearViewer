/**
 * Ownership across an account merge (LIN-1892 S1, D5).
 *
 * Run with: node --test tests/unit/account-merge-ownership.test.js
 *
 * `mergeAccounts` (lib/account-store.js) is deliberately unchanged by S1: it
 * re-binds the merged account's workspaces onto the survivor. That re-bind is
 * either not an insert (the survivor already had the edge) or an insert that
 * is not the workspace's first edge, so it never mints a second owner. The
 * owner read canonicalises a merged owner to the survivor. Real MangoDB, with
 * the production account-workspaces indexes (lib/db-indexes.js).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { AccountStore } from '../../lib/account-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';

describe('account merge ownership (LIN-1892 S1)', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'account-merge-ownership-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  async function freshStores() {
    const db = client.db(`amo_${counter++}`);
    const edges = db.collection('account-workspaces');
    for (const spec of INDEX_SPECS.filter(s => s.collection === 'account-workspaces')) {
      await edges.createIndex(spec.keySpec, spec.options);
    }
    return {
      edges,
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: edges })
    };
  }

  // Binds in order with strictly increasing `createdAt`, so which edge is a
  // workspace's first doesn't come down to a same-millisecond `_id` tie.
  async function bindInOrder(store, workspaceId, accountIds) {
    for (const accountId of accountIds) {
      const edge = await store.bindAccountToWorkspace(accountId, workspaceId);
      while (Date.now() <= edge.createdAt.getTime()) await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  test('the merged account owns W and the survivor never bound it: the survivor gets a plain edge; the owner read resolves to the survivor', async () => {
    const { edges, accountStore, accountWorkspaceStore } = await freshStores();
    const merged = await accountStore.createAccount();
    const survivor = await accountStore.createAccount();
    const workspaceId = randomUUID();
    await bindInOrder(accountWorkspaceStore, workspaceId, [merged._id]);

    const result = await accountStore.mergeAccounts(survivor._id, merged._id, { accountWorkspaceStore });
    assert.strictEqual(result.ok, true);

    const survivorEdge = await edges.findOne({ accountId: survivor._id, workspaceId });
    assert.ok(survivorEdge, 'the merge re-bound the survivor');
    assert.ok(!('role' in survivorEdge), 'a fresh insert that is not the first edge stays plain');
    assert.strictEqual(await edges.countDocuments({ workspaceId, role: 'owner' }), 1);
    assert.strictEqual(await accountWorkspaceStore.getWorkspaceOwnerAccountId(workspaceId, accountStore), survivor._id);
  });

  test('both bound to W, the merged account first (owner): after the merge still one owner, and it resolves to the survivor', async () => {
    const { edges, accountStore, accountWorkspaceStore } = await freshStores();
    const merged = await accountStore.createAccount();
    const survivor = await accountStore.createAccount();
    const workspaceId = randomUUID();
    await bindInOrder(accountWorkspaceStore, workspaceId, [merged._id, survivor._id]);

    const result = await accountStore.mergeAccounts(survivor._id, merged._id, { accountWorkspaceStore });
    assert.strictEqual(result.ok, true);

    assert.strictEqual(await edges.countDocuments({ workspaceId }), 2, 'the re-bind was not an insert');
    const owners = await edges.find({ workspaceId, role: 'owner' }).toArray();
    assert.strictEqual(owners.length, 1, 'at most one owner');
    assert.strictEqual(owners[0].accountId, merged._id, 'the owner edge is never moved; the merge is an alias');
    assert.strictEqual(await accountWorkspaceStore.getWorkspaceOwnerAccountId(workspaceId, accountStore), survivor._id);
  });

  test('both bound to W, the survivor first (owner): after the merge still one owner, the survivor', async () => {
    const { edges, accountStore, accountWorkspaceStore } = await freshStores();
    const merged = await accountStore.createAccount();
    const survivor = await accountStore.createAccount();
    const workspaceId = randomUUID();
    await bindInOrder(accountWorkspaceStore, workspaceId, [survivor._id, merged._id]);

    const result = await accountStore.mergeAccounts(survivor._id, merged._id, { accountWorkspaceStore });
    assert.strictEqual(result.ok, true);

    assert.strictEqual(await edges.countDocuments({ workspaceId }), 2);
    const owners = await edges.find({ workspaceId, role: 'owner' }).toArray();
    assert.strictEqual(owners.length, 1, 'at most one owner');
    assert.strictEqual(owners[0].accountId, survivor._id);
    assert.strictEqual(await accountWorkspaceStore.getWorkspaceOwnerAccountId(workspaceId, accountStore), survivor._id);
  });

  test('a chained merge (X into Y, then Y into Z) resolves X\'s owner edge to Z', async () => {
    const { accountStore, accountWorkspaceStore } = await freshStores();
    const x = await accountStore.createAccount();
    const y = await accountStore.createAccount();
    const z = await accountStore.createAccount();
    const workspaceId = randomUUID();
    await bindInOrder(accountWorkspaceStore, workspaceId, [x._id]);

    assert.strictEqual((await accountStore.mergeAccounts(y._id, x._id, { accountWorkspaceStore })).ok, true);
    assert.strictEqual((await accountStore.mergeAccounts(z._id, y._id, { accountWorkspaceStore })).ok, true);

    assert.strictEqual(await accountWorkspaceStore.getWorkspaceOwnerAccountId(workspaceId, accountStore), z._id);
  });
});
