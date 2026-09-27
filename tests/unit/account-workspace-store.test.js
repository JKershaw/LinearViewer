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
import { AccountStore } from '../../lib/account-store.js';
import { INDEX_SPECS, ensureIndexes } from '../../lib/db-indexes.js';

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

  // Builds this collection's production indexes (lib/db-indexes.js). Since
  // LIN-1892 the owner mark relies on `account_workspaces_one_owner`: two
  // binds in the same millisecond tie on `createdAt`, so the later edge can
  // sort first by `_id`, and only the index keeps that to one owner.
  async function indexedCollection() {
    const collection = freshDb().collection('account-workspaces');
    for (const spec of INDEX_SPECS.filter(s => s.collection === 'account-workspaces')) {
      await collection.createIndex(spec.keySpec, spec.options);
    }
    return collection;
  }

  function freshStore() {
    return new AccountWorkspaceStore({ collection: freshDb().collection('account-workspaces') });
  }

  // Waits until `Date.now()` is past `date`, so the next edge's `createdAt`
  // sorts strictly after it and can't win the first-edge tie-break on `_id`.
  async function tickPast(date) {
    while (Date.now() <= date.getTime()) await new Promise(resolve => setTimeout(resolve, 1));
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
    const store = new AccountWorkspaceStore({ collection: await indexedCollection() });
    const accountId = randomUUID();
    const workspaceId = randomUUID();

    // Stated setup change (LIN-1892 N5), not a softened assertion: under S1 a
    // workspace's first bind becomes its owner edge, which also carries
    // `role`. A prior binder takes that slot, so the edge pinned below is a
    // plain member and the key-set assertion stays byte-identical. The owner
    // edge's key set is pinned separately by A7b. The collection carries its
    // production indexes, so a same-millisecond tie can't make both owners.
    await store.bindAccountToWorkspace(randomUUID(), workspaceId);

    const edge = await store.bindAccountToWorkspace(accountId, workspaceId);

    assert.deepStrictEqual(new Set(Object.keys(edge)), new Set(['_id', 'accountId', 'workspaceId', 'createdAt']));
  });

  // A7b - the owner edge's key set (LIN-1892 N5)
  test('the owner edge carries no credentials either: its key set is exactly {_id, accountId, workspaceId, createdAt, role}', async () => {
    const collection = freshDb().collection('account-workspaces');
    const store = new AccountWorkspaceStore({ collection });
    const accountId = randomUUID();
    const workspaceId = randomUUID();

    const edge = await store.bindAccountToWorkspace(accountId, workspaceId);
    const stored = await collection.findOne({ accountId, workspaceId });

    const ownerKeys = new Set(['_id', 'accountId', 'workspaceId', 'createdAt', 'role']);
    assert.deepStrictEqual(new Set(Object.keys(edge)), ownerKeys, 'returned owner edge');
    assert.deepStrictEqual(new Set(Object.keys(stored)), ownerKeys, 're-read owner edge');
    assert.strictEqual(edge.role, 'owner');
    assert.strictEqual(stored.role, 'owner');
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

  // --- LIN-1892 S1: the owner edge (first binder of a workspace) ---

  describe('owner edge (LIN-1892 S1)', () => {
    async function freshStoreWith(options = {}) {
      const collection = await indexedCollection();
      return { collection, store: new AccountWorkspaceStore({ collection, ...options }) };
    }

    test('the first bind of a workspace is its owner: the returned and the stored edge both carry role:\'owner\'', async () => {
      const { collection, store } = await freshStoreWith();
      const accountId = randomUUID();
      const workspaceId = randomUUID();

      const edge = await store.bindAccountToWorkspace(accountId, workspaceId);

      assert.strictEqual(edge.role, 'owner', 'returned edge');
      const stored = await collection.findOne({ accountId, workspaceId });
      assert.strictEqual(stored.role, 'owner', 'stored edge');
    });

    test('a second account binding the same workspace gets a plain edge (no role)', async () => {
      const { collection, store } = await freshStoreWith();
      const owner = randomUUID();
      const member = randomUUID();
      const workspaceId = randomUUID();

      await store.bindAccountToWorkspace(owner, workspaceId);
      const edge = await store.bindAccountToWorkspace(member, workspaceId);

      assert.ok(!('role' in edge), 'returned edge has no role');
      const stored = await collection.findOne({ accountId: member, workspaceId });
      assert.ok(!('role' in stored), 'stored edge has no role');
      assert.strictEqual(await collection.countDocuments({ workspaceId, role: 'owner' }), 1);
    });

    test('re-binding the owner is idempotent: one edge, still exactly one owner, and the edge keeps its _id', async () => {
      const { collection, store } = await freshStoreWith();
      const accountId = randomUUID();
      const workspaceId = randomUUID();

      const first = await store.bindAccountToWorkspace(accountId, workspaceId);
      const again = await store.bindAccountToWorkspace(accountId, workspaceId);

      // The pre-existing edge's _id is unchanged, so the pre-generated `_id`
      // insert signal read "not inserted" on the re-bind.
      assert.strictEqual(again._id, first._id);
      assert.strictEqual(again.role, 'owner');
      assert.strictEqual(await collection.countDocuments({ accountId, workspaceId }), 1);
      assert.strictEqual(await collection.countDocuments({ workspaceId, role: 'owner' }), 1);
    });

    test('a pre-S1 workspace gets no owner automatically: a new member\'s fresh edge is not the workspace\'s first edge', async () => {
      const { collection, store } = await freshStoreWith();
      const accountStore = new AccountStore({ collection: freshDb().collection('accounts') });
      const legacy = randomUUID();
      const newcomer = randomUUID();
      const workspaceId = randomUUID();

      // A role-less edge as every edge written before S1 is, with an older createdAt.
      await collection.insertOne({
        _id: randomUUID(),
        accountId: legacy,
        workspaceId,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
      });

      const edge = await store.bindAccountToWorkspace(newcomer, workspaceId);
      assert.ok(!('role' in edge), 'a fresh insert that is not the first edge stays plain');
      await store.bindAccountToWorkspace(legacy, workspaceId);

      const edges = await collection.find({ workspaceId }).toArray();
      assert.strictEqual(edges.length, 2);
      assert.ok(edges.every(e => !('role' in e)), 'neither edge gets a role');
      assert.strictEqual(await store.getWorkspaceOwnerAccountId(workspaceId, accountStore), null);
    });

    test('getWorkspaceOwnerAccountId returns null for a workspace with no edges at all', async () => {
      const { store } = await freshStoreWith();
      const accountStore = new AccountStore({ collection: freshDb().collection('accounts') });

      assert.strictEqual(await store.getWorkspaceOwnerAccountId(randomUUID(), accountStore), null);
    });

    test('getWorkspaceOwnerAccountId canonicalises a merged owner to the survivor; the survivor\'s re-bind edge stays plain', async () => {
      const { collection, store } = await freshStoreWith();
      const accountStore = new AccountStore({ collection: freshDb().collection('accounts') });
      const workspaceId = randomUUID();

      const merged = await accountStore.createAccount();
      const survivor = await accountStore.createAccount();
      await store.bindAccountToWorkspace(merged._id, workspaceId);
      assert.strictEqual(await store.getWorkspaceOwnerAccountId(workspaceId, accountStore), merged._id);

      const result = await accountStore.mergeAccounts(survivor._id, merged._id, { accountWorkspaceStore: store });
      assert.strictEqual(result.ok, true);

      assert.strictEqual(await store.getWorkspaceOwnerAccountId(workspaceId, accountStore), survivor._id);
      const survivorEdge = await collection.findOne({ accountId: survivor._id, workspaceId });
      assert.ok(survivorEdge, 'the merge re-bound the survivor');
      assert.ok(!('role' in survivorEdge), 'the survivor\'s edge is plain; the owner edge is still the merged account\'s');
      assert.strictEqual(await collection.countDocuments({ workspaceId, role: 'owner' }), 1);
    });

    test('the owner index enforces one owner per workspace on MangoDB, and builds alongside the plain {workspaceId:1} index', async () => {
      const db = freshDb();
      const { failed } = await ensureIndexes(db, { logger: { warn() {} } });
      assert.deepStrictEqual(failed.filter(f => f.collection === 'account-workspaces'), []);
      const collection = db.collection('account-workspaces');
      const workspaceId = randomUUID();
      const a = { _id: randomUUID(), accountId: randomUUID(), workspaceId, createdAt: new Date() };
      const b = { _id: randomUUID(), accountId: randomUUID(), workspaceId, createdAt: new Date() };
      await collection.insertOne(a);
      await collection.insertOne(b);

      await collection.updateOne({ _id: a._id }, { $set: { role: 'owner' } });
      await assert.rejects(
        () => collection.updateOne({ _id: b._id }, { $set: { role: 'owner' } }),
        /E11000|duplicate key/i
      );

      const indexes = await collection.listIndexes().toArray();
      const owner = indexes.find(ix => ix.name === 'account_workspaces_one_owner');
      assert.ok(owner, 'account_workspaces_one_owner is built');
      assert.deepStrictEqual(owner.key, { workspaceId: 1, role: 1 });
      assert.strictEqual(owner.unique, true);
      assert.deepStrictEqual(owner.partialFilterExpression, { role: 'owner' });
      assert.ok(
        indexes.some(ix => JSON.stringify(ix.key) === JSON.stringify({ workspaceId: 1 })),
        'the pre-existing {workspaceId:1} index is still there (no key-spec collision)'
      );
    });

    test('crash gap is stated, not healed: a failed owner mark leaves the workspace owner-less for good', async () => {
      const logged = [];
      const { collection, store } = await freshStoreWith({ logger: { error: (...args) => logged.push(args.join(' ')) } });
      const accountStore = new AccountStore({ collection: freshDb().collection('accounts') });
      const first = randomUUID();
      const second = randomUUID();
      const workspaceId = randomUUID();

      const realUpdateOne = collection.updateOne.bind(collection);
      let thrown = false;
      collection.updateOne = async (...args) => {
        if (!thrown) {
          thrown = true;
          throw new Error('simulated failure between insert and owner mark');
        }
        return realUpdateOne(...args);
      };

      const edge = await store.bindAccountToWorkspace(first, workspaceId);
      assert.ok(thrown, 'the owner mark was attempted');
      assert.ok(!('role' in edge), 'the returned edge is truthful: no mark landed');
      assert.strictEqual(logged.length, 1, 'the failed mark is logged');
      assert.match(logged[0], /simulated failure/);

      // The plan's "later binds aren't its first edge" rests on `createdAt`
      // order; a bind in the same millisecond could win the `_id` tie-break.
      await tickPast(edge.createdAt);
      await store.bindAccountToWorkspace(second, workspaceId);
      await store.bindAccountToWorkspace(first, workspaceId);

      assert.strictEqual(await collection.countDocuments({ workspaceId, role: 'owner' }), 0);
      assert.strictEqual(await store.getWorkspaceOwnerAccountId(workspaceId, accountStore), null);
    });
  });
});
