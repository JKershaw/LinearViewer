/**
 * LIN-3131 (LIN-3059 S2b.1) — the workspace-owner seam, and the L2 carry-forward.
 *
 * Two layers:
 *  - `lib/workspace-owner.js`'s `checkWorkspaceOwner` over fakes (boundary cases:
 *    owner / not-owner / no-owner / absent ids / a throwing store) and over the
 *    REAL post-#1601 `AccountWorkspaceStore` (a merged-away owner canonicalises;
 *    a corrupt `mergedInto` chain throws → unavailable).
 *  - the L2 carry-forward from LIN-3129 (comment 1fb65e56): an absent
 *    `workspaceId` must fail closed for BOTH `mintGrantBootstrap` and the
 *    matching exchange. Witnessed through a REAL `ProxyTokenStore` whose seam is
 *    the REAL `checkWorkspaceOwner`, over stores deliberately permissive enough
 *    that, without the seam's own `workspaceId` guard, the absent-id mint and
 *    exchange would both succeed.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { AccountStore } from '../../lib/account-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { RUNNER_GRANTS } from '../../lib/proxy-scopes.js';
import { checkWorkspaceOwner, createWorkspaceOwnerCheck } from '../../lib/workspace-owner.js';

// ---------------------------------------------------------------------------
// Fakes for the seam boundary
// ---------------------------------------------------------------------------

/** A store pair permissive to anything: it reports account-A as owner of every
 *  workspace, and canonicalises to itself. If the seam is what fails closed for
 *  an absent id, these fakes cannot be the reason. */
function permissiveDeps() {
  return {
    accountWorkspaceStore: { getWorkspaceOwnerAccountId: async () => 'account-A' },
    accountStore: { resolveCanonicalAccountId: async (id) => id }
  };
}

describe('LIN-3131 — checkWorkspaceOwner seam (fakes)', () => {
  test('owner match returns owner', async () => {
    assert.deepEqual(
      await checkWorkspaceOwner({ workspaceId: 'ws-1', accountId: 'account-A' }, permissiveDeps()),
      { status: 'owner' }
    );
  });

  test('a different canonical account is not-owner', async () => {
    const deps = {
      accountWorkspaceStore: { getWorkspaceOwnerAccountId: async () => 'account-A' },
      accountStore: { resolveCanonicalAccountId: async (id) => id }
    };
    assert.deepEqual(
      await checkWorkspaceOwner({ workspaceId: 'ws-1', accountId: 'account-B' }, deps),
      { status: 'not-owner' }
    );
  });

  test('no owner edge is no-owner', async () => {
    const deps = {
      accountWorkspaceStore: { getWorkspaceOwnerAccountId: async () => null },
      accountStore: { resolveCanonicalAccountId: async (id) => id }
    };
    assert.deepEqual(
      await checkWorkspaceOwner({ workspaceId: 'ws-1', accountId: 'account-A' }, deps),
      { status: 'no-owner' }
    );
  });

  test('L2: an absent workspaceId is no-owner, before any store lookup', async () => {
    let lookedUp = false;
    const deps = {
      accountWorkspaceStore: {
        getWorkspaceOwnerAccountId: async () => { lookedUp = true; return 'account-A'; }
      },
      accountStore: { resolveCanonicalAccountId: async (id) => id }
    };
    for (const workspaceId of [undefined, null, '']) {
      assert.deepEqual(
        await checkWorkspaceOwner({ workspaceId, accountId: 'account-A' }, deps),
        { status: 'no-owner' },
        `workspaceId=${JSON.stringify(workspaceId)} must fail closed`
      );
    }
    assert.equal(lookedUp, false, 'an absent workspaceId must not reach the store as an `undefined` key');
  });

  test('an absent accountId is not-owner', async () => {
    for (const accountId of [undefined, null, '']) {
      assert.deepEqual(
        await checkWorkspaceOwner({ workspaceId: 'ws-1', accountId }, permissiveDeps()),
        { status: 'not-owner' }
      );
    }
  });

  test('a throwing store propagates (the store maps it to unavailable)', async () => {
    const deps = {
      accountWorkspaceStore: { getWorkspaceOwnerAccountId: async () => { throw new Error('store down'); } },
      accountStore: { resolveCanonicalAccountId: async (id) => id }
    };
    await assert.rejects(
      checkWorkspaceOwner({ workspaceId: 'ws-1', accountId: 'account-A' }, deps),
      /store down/
    );
  });

  test('a throwing canonical resolution propagates (unavailable)', async () => {
    const deps = {
      accountWorkspaceStore: { getWorkspaceOwnerAccountId: async () => 'account-A' },
      accountStore: { resolveCanonicalAccountId: async () => { throw new Error('corrupt chain'); } }
    };
    await assert.rejects(
      checkWorkspaceOwner({ workspaceId: 'ws-1', accountId: 'account-A' }, deps),
      /corrupt chain/
    );
  });

  test('createWorkspaceOwnerCheck binds the deps into the seam shape', async () => {
    const seam = createWorkspaceOwnerCheck(permissiveDeps());
    assert.deepEqual(await seam({ workspaceId: 'ws-1', accountId: 'account-A' }), { status: 'owner' });
    // The bound seam still owns the absent-workspaceId guard.
    assert.deepEqual(await seam({ workspaceId: undefined, accountId: 'account-A' }), { status: 'no-owner' });
  });
});

// ---------------------------------------------------------------------------
// The seam over the real post-#1601 AccountWorkspaceStore
// ---------------------------------------------------------------------------

describe('LIN-3131 — checkWorkspaceOwner over the real AccountWorkspaceStore', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'workspace-owner-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  async function freshStores() {
    const db = client.db(`wo_${counter++}`);
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

  test('the owner edge is the owner; another member is not-owner', async () => {
    const { accountStore, accountWorkspaceStore } = await freshStores();
    const owner = await accountStore.createAccount();
    const member = await accountStore.createAccount();
    const workspaceId = randomUUID();
    await accountWorkspaceStore.bindAccountToWorkspace(owner._id, workspaceId);
    await accountWorkspaceStore.bindAccountToWorkspace(member._id, workspaceId);

    assert.deepEqual(
      await checkWorkspaceOwner({ workspaceId, accountId: owner._id }, { accountWorkspaceStore, accountStore }),
      { status: 'owner' }
    );
    assert.deepEqual(
      await checkWorkspaceOwner({ workspaceId, accountId: member._id }, { accountWorkspaceStore, accountStore }),
      { status: 'not-owner' }
    );
  });

  test('a workspace with no edges is no-owner', async () => {
    const { accountStore, accountWorkspaceStore } = await freshStores();
    const account = await accountStore.createAccount();
    assert.deepEqual(
      await checkWorkspaceOwner({ workspaceId: randomUUID(), accountId: account._id }, { accountWorkspaceStore, accountStore }),
      { status: 'no-owner' }
    );
  });

  test('a merged-away owner canonicalises: both the merged id and its survivor answer owner', async () => {
    const { accountStore, accountWorkspaceStore } = await freshStores();
    const merged = await accountStore.createAccount();
    const survivor = await accountStore.createAccount();
    const workspaceId = randomUUID();
    await accountWorkspaceStore.bindAccountToWorkspace(merged._id, workspaceId);

    assert.equal((await accountStore.mergeAccounts(survivor._id, merged._id, { accountWorkspaceStore })).ok, true);

    for (const accountId of [merged._id, survivor._id]) {
      assert.deepEqual(
        await checkWorkspaceOwner({ workspaceId, accountId }, { accountWorkspaceStore, accountStore }),
        { status: 'owner' },
        `account ${accountId} must resolve to the canonical owner`
      );
    }
    // A third account that never bound it is still not-owner.
    const outsider = await accountStore.createAccount();
    assert.deepEqual(
      await checkWorkspaceOwner({ workspaceId, accountId: outsider._id }, { accountWorkspaceStore, accountStore }),
      { status: 'not-owner' }
    );
  });

  test('a corrupt mergedInto cycle throws (→ unavailable, fail closed)', async () => {
    const { accountStore, accountWorkspaceStore } = await freshStores();
    const a = await accountStore.createAccount();
    const b = await accountStore.createAccount();
    // `mergeAccounts` refuses to build a cycle, so seed the corruption directly.
    await accountStore.collection.updateOne({ _id: a._id }, { $set: { mergedInto: b._id } });
    await accountStore.collection.updateOne({ _id: b._id }, { $set: { mergedInto: a._id } });

    const workspaceId = randomUUID();
    await accountWorkspaceStore.bindAccountToWorkspace(a._id, workspaceId);

    await assert.rejects(
      checkWorkspaceOwner({ workspaceId, accountId: a._id }, { accountWorkspaceStore, accountStore }),
      /resolveCanonicalAccountId/,
      'a corrupt owner chain must throw so the store fails closed'
    );
  });

  test('a corrupt chain through the wired store maps to OWNER_CHECK_UNAVAILABLE at mint', async () => {
    const { accountStore, accountWorkspaceStore } = await freshStores();
    const a = await accountStore.createAccount();
    const b = await accountStore.createAccount();
    await accountStore.collection.updateOne({ _id: a._id }, { $set: { mergedInto: b._id } });
    await accountStore.collection.updateOne({ _id: b._id }, { $set: { mergedInto: a._id } });
    const workspaceId = randomUUID();
    await accountWorkspaceStore.bindAccountToWorkspace(a._id, workspaceId);

    const proxyCollection = createMockCollection();
    const store = new ProxyTokenStore({ collection: proxyCollection });
    store.setOwnerCheck(createWorkspaceOwnerCheck({ accountWorkspaceStore, accountStore }));

    await assert.rejects(
      store.mintGrantBootstrap({ urlKey: 'acme', workspaceId, ownerAccountId: 'account-A', grants: RUNNER_GRANTS }),
      (err) => {
        assert.equal(err.code, 'OWNER_CHECK_UNAVAILABLE', `expected unavailable, got ${err.code} (${err.message})`);
        assert.equal(err.status, 503);
        assert.equal(err.retryable, true, 'an unavailable owner check is retryable');
        return true;
      }
    );
    assert.equal(proxyCollection._docs().length, 0, 'a refused mint must not write');
  });
});

// ---------------------------------------------------------------------------
// L2 carry-forward — absent workspaceId fails closed through the real store
// ---------------------------------------------------------------------------

/** Minimal in-memory collection (MangoDB-compatible) for the real ProxyTokenStore. */
function createMockCollection() {
  let docs = [];
  const matches = (d, query) => Object.keys(query).every(k => {
    if (k === '$or') return query.$or.some(sub => matches(d, sub));
    const val = query[k];
    if (val && typeof val === 'object') {
      if ('$lt' in val && '$ne' in val) {
        return d[k] !== val.$ne && d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      }
      if ('$lt' in val) return d[k] !== null && new Date(d[k]) < new Date(val.$lt);
      return true;
    }
    return d[k] === val;
  });
  return {
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(docs[idx], update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query) {
      const before = docs.length;
      docs = docs.filter(d => !matches(d, query));
      return { deletedCount: before - docs.length };
    },
    find(query = {}) { return { toArray: async () => docs.filter(d => matches(d, query)) }; },
    _docs: () => docs
  };
}

describe('LIN-3131 — L2: an absent workspaceId fails closed for mint and exchange', () => {
  // The seam is the REAL `checkWorkspaceOwner`; the wrapped stores are
  // deliberately permissive (they report account-A as owner of ANY workspace and
  // canonicalise to the input). Without the seam's own workspaceId guard, the
  // `undefined` key would reach these stores and be answered `owner`.
  function storeWithRealSeamOverPermissiveStores() {
    const collection = createMockCollection();
    const store = new ProxyTokenStore({ collection });
    store.setOwnerCheck(createWorkspaceOwnerCheck(permissiveDeps()));
    return { store, collection };
  }

  async function seedGrantBootstrap(collection, plain) {
    const doc = {
      _id: randomUUID(),
      urlKey: 'acme',
      tokenHash: createHash('sha256').update(plain).digest('hex'),
      label: 'runner-bootstrap', scope: 'readWrite', kind: 'bootstrap', singleUse: true,
      createdBy: 'account-A', grants: RUNNER_GRANTS.slice(), parentTokenId: null,
      workspaceId: null, createdAt: new Date(), lastUsedAt: null, expiresAt: null, consumed: false
    };
    await collection.insertOne(doc);
    return doc;
  }

  test('mintGrantBootstrap with no workspaceId refuses and writes nothing', async () => {
    const { store, collection } = storeWithRealSeamOverPermissiveStores();
    await assert.rejects(
      store.mintGrantBootstrap({ urlKey: 'acme', ownerAccountId: 'account-A', grants: RUNNER_GRANTS }),
      (err) => {
        assert.equal(err.code, 'WORKSPACE_OWNER_UNSET', `expected a refusal, got ${err.code} (${err.message})`);
        assert.equal(err.status, 409);
        assert.equal(err.retryable, false);
        return true;
      }
    );
    assert.equal(collection._docs().length, 0, 'a refused mint must not write');
  });

  test('the matching exchange of an absent-workspaceId grant document fails closed and spends the bootstrap', async () => {
    const { store, collection } = storeWithRealSeamOverPermissiveStores();
    const plain = 'boot-' + randomUUID();
    const boot = await seedGrantBootstrap(collection, plain);

    assert.equal(
      await store.exchangeBootstrapToken(plain),
      null,
      'an absent-workspaceId grant bootstrap must not exchange'
    );
    assert.equal(collection._docs().find(d => d._id === boot._id).consumed, true, 'the bootstrap is spent, not left live');
    assert.equal(
      collection._docs().filter(d => d.kind === 'standard').length,
      0,
      'no working token may be minted'
    );
  });
});
