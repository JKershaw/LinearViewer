/**
 * LIN-3129 S1 steps 2–3 — the grant model in ProxyTokenStore.
 *
 * Covers:
 *  - `createToken` structurally refuses grants (non-empty, non-array) for every
 *    kind, and still mints for absent/empty grants;
 *  - `validateToken` returns `grants`, zeroed to `[]` for ownerless documents;
 *  - `listTokens` adds `grants` + `parentTokenId`;
 *  - `mintGrantBootstrap` + `setOwnerCheck`: every refusal code, unknowable
 *    grants, the unwired/throwing/corrupt seam, the success shape and the fixed
 *    runner bootstrap TTL, and the ownerless refusal with compat env ON;
 *  - worker/child `provisionBootstrapToken` stays grant-less.
 *
 * A REAL ProxyTokenStore over an in-memory collection backs every case. Tests
 * never reach `#mint` (they cannot — it is a true private method) and never seed
 * a grant through it.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { provisionBootstrapToken } from '../../lib/proxy-preamble.js';

function createMockCollection() {
  let docs = [];

  return {
    async insertOne(doc) {
      docs.push({ ...doc });
      return { insertedId: doc._id };
    },
    async findOne(query) {
      return docs.find(d => {
        return Object.keys(query).every(k => {
          if (typeof query[k] === 'object' && query[k] !== null) return true; // skip operators
          return d[k] === query[k];
        });
      }) || null;
    },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => {
        return Object.keys(query).every(k => {
          if (typeof query[k] === 'object' && query[k] !== null) return true;
          return d[k] === query[k];
        });
      });
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) {
        Object.assign(docs[idx], update.$set);
      }
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => {
        return Object.keys(query).every(k => d[k] === query[k]);
      });
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query) {
      const before = docs.length;
      docs = docs.filter(d => {
        return !Object.keys(query).every(k => {
          const val = query[k];
          if (val && typeof val === 'object') {
            // Handle $lt, $ne, $gt operators
            if ('$lt' in val && '$ne' in val) {
              return d[k] !== val.$ne && d[k] !== null && new Date(d[k]) < new Date(val.$lt);
            }
            if ('$lt' in val) {
              return d[k] !== null && new Date(d[k]) < new Date(val.$lt);
            }
            return true;
          }
          return d[k] === val;
        });
      });
      return { deletedCount: before - docs.length };
    },
    find(query) {
      const results = docs.filter(d => {
        return Object.keys(query).every(k => {
          const val = query[k];
          if (val && typeof val === 'object') return true; // skip operators
          return d[k] === val;
        });
      });
      return { toArray: async () => results };
    },
    _docs: () => docs,
    _clear: () => { docs = []; }
  };
}

const GRANT_OWNER = async () => ({ status: 'owner' });

function newStore(ownerCheck) {
  const collection = createMockCollection();
  const store = new ProxyTokenStore({ collection });
  if (ownerCheck) store.setOwnerCheck(ownerCheck);
  return { store, collection };
}

async function assertRefused(promise, { code, status, retryable }) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected code ${code}, got ${err.code} (${err.message})`);
    assert.equal(err.status, status, `expected status ${status}, got ${err.status}`);
    if (retryable !== undefined) {
      assert.equal(err.retryable, retryable, `expected retryable ${retryable}`);
    }
    return true;
  });
}

describe('LIN-3129 — createToken structurally refuses grants', () => {
  let store, collection;
  beforeEach(() => { ({ store, collection } = newStore()); });

  test('throws on a non-empty grants array for a standard token, and inserts nothing', async () => {
    await assert.rejects(
      () => store.createToken('acme', { grants: ['take'] }),
      /refuses grants/
    );
    assert.equal(collection._docs().length, 0, 'no document may be written behind a refusal');
  });

  test('throws on a non-empty grants array for a bootstrap token', async () => {
    await assert.rejects(
      () => store.createToken('acme', { kind: 'bootstrap', createdBy: 'account-A', grants: ['dispatch'] }),
      /refuses grants/
    );
    assert.equal(collection._docs().length, 0);
  });

  test('throws on a non-array grants value', async () => {
    await assert.rejects(() => store.createToken('acme', { grants: 'take' }), /refuses grants/);
    await assert.rejects(() => store.createToken('acme', { grants: { take: true } }), /refuses grants/);
  });

  test('an empty grants array or an omitted grants still mints (grants: [])', async () => {
    const withEmpty = await store.createToken('acme', { grants: [] });
    const omitted = await store.createToken('acme', {});
    assert.deepEqual(withEmpty.grants, []);
    assert.deepEqual(omitted.grants, []);
    const docs = collection._docs();
    assert.equal(docs.length, 2);
    assert.deepEqual(docs.map(d => d.grants), [[], []]);
  });

  test('createToken forces parentTokenId and lifetimeProfile; a public mint may stamp only a workspace id', async () => {
    // LIN-3129 beat-3 carry-in: the wrapper spreads ...options into #mint, so
    // without this a public caller could stamp lineage that revoke then follows.
    // LIN-3409 relaxes A3 narrowly: the workspace id (identity, no authority).
    await store.createToken('acme', {
      createdBy: 'account-A', parentTokenId: 'a-root-id', workspaceId: 'ws-9',
      lifetimeProfile: 'worker'
    });
    const doc = collection._docs()[0];
    assert.equal(doc.parentTokenId, null, 'a public mint may not stamp a lineage parent');
    assert.equal(doc.lifetimeProfile, null, 'a public mint may not stamp a lifetime profile');
    assert.deepEqual(doc.grants, [], 'a public mint never carries grants');
    assert.equal(doc.workspaceId, 'ws-9', 'a public mint may stamp the workspace id');
  });

  test('createToken stores null for an absent or non-string workspaceId', async () => {
    await store.createToken('acme', { createdBy: 'account-A' });
    await store.createToken('acme', { createdBy: 'account-A', workspaceId: { $ne: null } });
    await store.createToken('acme', { createdBy: 'account-A', workspaceId: '' });
    assert.deepEqual(collection._docs().map(d => d.workspaceId), [null, null, null]);
  });
});

describe('LIN-3129 — validateToken returns grants, zeroed for ownerless documents', () => {
  let store, collection;
  beforeEach(() => { ({ store, collection } = newStore()); });

  test('an owned document with grants returns them', async () => {
    const plain = 'owned-' + crypto.randomUUID();
    await store.collection.insertOne({
      _id: crypto.randomUUID(), urlKey: 'acme',
      tokenHash: crypto.createHash('sha256').update(plain).digest('hex'),
      label: 'runner', scope: 'readWrite', kind: 'standard', singleUse: false,
      createdBy: 'account-A', grants: ['take', 'dispatch'], parentTokenId: null,
      workspaceId: 'ws-1', createdAt: new Date(), lastUsedAt: null, expiresAt: null, consumed: false
    });

    const validated = await store.validateToken(plain);
    assert.deepEqual(validated.grants, ['take', 'dispatch']);
  });

  test('an OWNERLESS document with stored grants returns grants: [] (never carries authority)', async () => {
    // Seeded DIRECTLY through the collection — never through #mint, so this is
    // precisely the foreign/legacy row shape the guard must neutralise.
    const plain = 'ownerless-' + crypto.randomUUID();
    await store.collection.insertOne({
      _id: crypto.randomUUID(), urlKey: 'acme',
      tokenHash: crypto.createHash('sha256').update(plain).digest('hex'),
      label: 'legacy', scope: 'readWrite', kind: 'standard', singleUse: false,
      createdBy: null, grants: ['take', 'dispatch'], parentTokenId: null,
      workspaceId: null, createdAt: new Date(), lastUsedAt: null, expiresAt: null, consumed: false
    });

    const validated = await store.validateToken(plain);
    assert.ok(validated, 'the token still authenticates (ownerless is a supported population)');
    assert.deepEqual(validated.grants, [], 'an ownerless document never carries a grant');
  });

  test('a document with no grants field returns []', async () => {
    const result = await store.createToken('acme', { createdBy: 'account-A' });
    const validated = await store.validateToken(result.token);
    assert.deepEqual(validated.grants, []);
  });

  test('listTokens adds grants and parentTokenId', async () => {
    await store.createToken('acme', { label: 'plain', createdBy: 'account-A' });
    const [token] = await store.listTokens('acme');
    assert.deepEqual(token.grants, []);
    assert.equal(token.parentTokenId, null);
  });
});

describe('LIN-3129 — mintGrantBootstrap refusals', () => {
  test('ownerless mint (no ownerAccountId) is refused GRANT_OWNERLESS even with compat ON', async () => {
    const before = process.env.DISPATCH_OWNERLESS_BROKER_COMPAT;
    delete process.env.DISPATCH_OWNERLESS_BROKER_COMPAT; // compat ON (the default)
    try {
      const { store, collection } = newStore(GRANT_OWNER);
      await assertRefused(
        store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', grants: ['take'] }),
        { code: 'GRANT_OWNERLESS', status: 503, retryable: false }
      );
      assert.equal(collection._docs().length, 0);
    } finally {
      if (before === undefined) delete process.env.DISPATCH_OWNERLESS_BROKER_COMPAT;
      else process.env.DISPATCH_OWNERLESS_BROKER_COMPAT = before;
    }
  });

  test('an empty grants array is refused INVALID_GRANTS', async () => {
    const { store } = newStore(GRANT_OWNER);
    await assertRefused(
      store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: [] }),
      { code: 'INVALID_GRANTS', status: 400, retryable: false }
    );
  });

  test('an unknown grant is refused INVALID_GRANTS (grants must be a subset of GRANTS)', async () => {
    const { store, collection } = newStore(GRANT_OWNER);
    await assertRefused(
      store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: ['take', 'admin'] }),
      { code: 'INVALID_GRANTS', status: 400, retryable: false }
    );
    assert.equal(collection._docs().length, 0, 'a bad grant set must not partly mint');
  });

  test('a non-array grants value is refused INVALID_GRANTS', async () => {
    const { store } = newStore(GRANT_OWNER);
    await assertRefused(
      store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: 'take' }),
      { code: 'INVALID_GRANTS', status: 400, retryable: false }
    );
  });

  test('an unwired owner seam fails closed with OWNER_CHECK_UNAVAILABLE (retryable)', async () => {
    const { store, collection } = newStore(); // setOwnerCheck never called
    await assertRefused(
      store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: ['take'] }),
      { code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true }
    );
    assert.equal(collection._docs().length, 0);
  });

  test('a throwing owner seam fails closed with OWNER_CHECK_UNAVAILABLE', async () => {
    const { store } = newStore(async () => { throw new Error('boom'); });
    await assertRefused(
      store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: ['take'] }),
      { code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true }
    );
  });

  test('a corrupt/unknown owner-seam answer fails closed with OWNER_CHECK_UNAVAILABLE', async () => {
    for (const answer of [null, {}, { status: 'maybe' }, 'owner']) {
      const { store } = newStore(async () => answer);
      await assertRefused(
        store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: ['take'] }),
        { code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true }
      );
    }
  });

  test('a workspace with no owner edge is refused WORKSPACE_OWNER_UNSET (not retryable)', async () => {
    const { store } = newStore(async () => ({ status: 'no-owner' }));
    await assertRefused(
      store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: ['take'] }),
      { code: 'WORKSPACE_OWNER_UNSET', status: 409, retryable: false }
    );
  });

  test('another account owning the workspace is refused GRANT_OWNER_ONLY and never names the owner', async () => {
    const { store } = newStore(async () => ({ status: 'not-owner' }));
    await assert.rejects(
      store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: ['take'] }),
      (err) => {
        assert.equal(err.code, 'GRANT_OWNER_ONLY');
        assert.equal(err.status, 403);
        assert.equal(err.retryable, false);
        assert.ok(!err.message.includes('account-'), 'the refusal never names an account id');
        return true;
      }
    );
  });

  test('a seam returning a non-function is treated as unwired (fails closed)', async () => {
    const { store } = newStore();
    store.setOwnerCheck('not-a-function');
    await assertRefused(
      store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants: ['take'] }),
      { code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true }
    );
  });
});

describe('LIN-3129 — mintGrantBootstrap success shape and TTL', () => {
  test('mints a readWrite bootstrap with runner TTL, owner and workspace stamped', async () => {
    const { store, collection } = newStore(async ({ workspaceId, accountId }) => {
      assert.equal(workspaceId, 'ws-1');
      assert.equal(accountId, 'account-A');
      return { status: 'owner' };
    });

    const before = Date.now();
    const minted = await store.mintGrantBootstrap({
      urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A',
      grants: ['take', 'dispatch'], label: 'runner-bootstrap'
    });

    assert.ok(minted.token, 'returns the plain token once');
    assert.equal(minted.kind, 'bootstrap');
    assert.equal(minted.scope, 'readWrite');
    assert.equal(minted.singleUse, true, 'a bootstrap is forced single-use');
    assert.deepEqual(minted.grants, ['take', 'dispatch']);
    assert.equal(minted.workspaceId, 'ws-1');

    const doc = collection._docs()[0];
    assert.equal(doc.createdBy, 'account-A');
    assert.equal(doc.workspaceId, 'ws-1');
    assert.deepEqual(doc.grants, ['take', 'dispatch']);

    // expiresAt == now + 3600s, within a small wall-clock tolerance.
    const ttlSeconds = (new Date(minted.expiresAt).getTime() - before) / 1000;
    assert.ok(ttlSeconds > 3599 && ttlSeconds <= 3601, `runner bootstrap TTL should be ~3600s, got ${ttlSeconds}`);

    // The minted bootstrap is exchange-only: validateToken rejects it, as always.
    assert.equal(await store.validateToken(minted.token), null);
  });

  test('the minted grant array is copied, never aliased to the caller', async () => {
    const { store } = newStore(GRANT_OWNER);
    const grants = ['take'];
    const minted = await store.mintGrantBootstrap({
      urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'account-A', grants
    });
    grants.push('dispatch');
    assert.deepEqual(minted.grants, ['take'], 'mutating the caller array must not widen the mint');
  });
});

describe('LIN-3129 — worker/child bootstraps stay grant-less', () => {
  test('provisionBootstrapToken mints through createToken and cannot carry grants', async () => {
    const { store } = newStore();
    const token = await provisionBootstrapToken({
      proxyTokenStore: store,
      urlKey: 'acme',
      baseUrl: 'https://harbour.example',
      label: 'dispatch-bootstrap',
      harness: 'claude-code',
      createdBy: 'account-A'
    });
    assert.ok(token, 'the worker bootstrap still mints');

    // Exchange it to a working token (createToken path) and confirm no grants.
    const working = await store.exchangeBootstrapToken(token);
    assert.ok(working?.token, 'the worker bootstrap exchanges');
    const validated = await store.validateToken(working.token);
    assert.deepEqual(validated.grants, [], 'worker/child credentials stay grant-less');
  });
});
