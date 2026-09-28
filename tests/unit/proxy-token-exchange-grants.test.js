/**
 * LIN-3129 S1 steps 4–5 — grant-copying exchange, owner re-check at exchange,
 * lineage revoke, and the route's `grants` response field.
 *
 * Store-level: a REAL ProxyTokenStore over an in-memory collection that supports
 * the `$or` lineage query. Route-level: `createProxyRoutes` wired to the same
 * store, mirroring tests/unit/proxy-token-exchange.test.js.
 *
 * Seeding note: grant-bearing bootstraps are seeded DIRECTLY through the
 * collection (tests cannot reach `#mint`), which is also how a foreign/legacy
 * doc would look.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createProxyRoutes } from '../../routes/proxy.js';

// ---------------------------------------------------------------------------
// In-memory collection (MangoDB-compatible), with `$or` support for the lineage
// revoke query. Mirrors the operator handling in tests/unit/proxy-tokens.test.js.
// ---------------------------------------------------------------------------

function createLineageCollection() {
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
    find(query) {
      const results = docs.filter(d => matches(d, query));
      return { toArray: async () => results };
    },
    _docs: () => docs
  };
}

const OWNER = async () => ({ status: 'owner' });

async function seedDoc(collection, {
  plain, kind = 'bootstrap', grants = [], createdBy = 'account-A',
  workspaceId = 'ws-1', scope = 'readWrite', expiresAt = null,
  label = 'runner-bootstrap', consumed = false, parentTokenId = null
}) {
  const doc = {
    _id: crypto.randomUUID(),
    urlKey: 'acme',
    tokenHash: crypto.createHash('sha256').update(plain).digest('hex'),
    label, scope, kind, singleUse: kind === 'bootstrap',
    createdBy, grants: grants.slice(), parentTokenId, workspaceId,
    createdAt: new Date(), lastUsedAt: null, expiresAt, consumed
  };
  await collection.insertOne(doc);
  return doc;
}

function newStore(ownerCheck) {
  const collection = createLineageCollection();
  const store = new ProxyTokenStore({ collection });
  if (ownerCheck) store.setOwnerCheck(ownerCheck);
  return { store, collection };
}

const docById = (collection, id) => collection._docs().find(d => d._id === id);
const standardDocs = (collection) => collection._docs().filter(d => d.kind === 'standard');

// ---------------------------------------------------------------------------
// Never-adds matrix
// ---------------------------------------------------------------------------

describe('LIN-3129 — exchange copies grants verbatim and never adds', () => {
  const bootstraps = [[], ['take'], ['dispatch'], ['take', 'dispatch']];
  const callerOptions = [
    { desc: 'options.grants absent', options: {} },
    { desc: 'options.grants empty', options: { grants: [] } },
    { desc: 'options.grants = superset with unknown name', options: { grants: ['take', 'dispatch', 'admin'] } }
  ];

  for (const grants of bootstraps) {
    for (const { desc, options } of callerOptions) {
      test(`bootstrap grants [${grants}] + ${desc} → working grants [${grants}]`, async () => {
        const { store, collection } = newStore(OWNER);
        const plain = 'boot-' + crypto.randomUUID();
        await seedDoc(collection, { plain, grants });

        const working = await store.exchangeBootstrapToken(plain, options);

        assert.ok(working, 'the exchange succeeds');
        assert.deepEqual(working.grants, grants, 'grants are copied from the bootstrap, never added');
        const workingDoc = docById(collection, working.tokenId);
        assert.deepEqual(workingDoc.grants, grants);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// TTL
// ---------------------------------------------------------------------------

describe('LIN-3129 — exchange TTL', () => {
  test('a grant-bearing working token has its TTL forced to 86400s, ignoring the 48h route TTL', async () => {
    const { store, collection } = newStore(OWNER);
    const plain = 'boot-' + crypto.randomUUID();
    await seedDoc(collection, { plain, grants: ['take', 'dispatch'] });

    const before = Date.now();
    const working = await store.exchangeBootstrapToken(plain, { ttl: 48 * 60 * 60 });
    const seconds = (new Date(working.expiresAt).getTime() - before) / 1000;
    assert.ok(seconds > 86399 && seconds <= 86401, `expected ~86400s, got ${seconds}`);
  });

  test('a grant-less working token keeps the caller TTL (48h)', async () => {
    const { store, collection } = newStore();
    const plain = 'boot-' + crypto.randomUUID();
    await seedDoc(collection, { plain, grants: [] });

    const working = await store.exchangeBootstrapToken(plain, { ttl: 48 * 60 * 60 });
    const hours = (new Date(working.expiresAt).getTime() - Date.now()) / (60 * 60 * 1000);
    assert.ok(hours > 47.9 && hours <= 48.1, `expected ~48h, got ${hours}`);
  });

  test('a grant-less working token with no caller TTL uses the store default (LIN-376 behaviour preserved)', async () => {
    const { store, collection } = newStore();
    const plain = 'boot-' + crypto.randomUUID();
    await seedDoc(collection, { plain, grants: [] });

    const working = await store.exchangeBootstrapToken(plain);
    const days = (new Date(working.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(days > 80 && days < 95, `expected ~90d, got ${days}`);
  });

  test('LIN-2394 store half: an expired document reports its expiresAt via describeRejectionCause', async () => {
    const { store, collection } = newStore();
    const plain = 'std-' + crypto.randomUUID();
    const expiredAt = new Date(Date.now() - 60 * 1000);
    await seedDoc(collection, { plain, kind: 'standard', grants: [], expiresAt: expiredAt });

    const descriptor = await store.describeRejectionCause(plain);
    assert.equal(descriptor.state, 'expired');
    assert.equal(descriptor.expiresAt, expiredAt.toISOString());
  });
});

// ---------------------------------------------------------------------------
// Owner at exchange
// ---------------------------------------------------------------------------

describe('LIN-3129 — owner is re-checked at exchange for grant-bearing bootstraps', () => {
  test('not-owner → null, and the bootstrap is spent (a second exchange also fails)', async () => {
    const { store, collection } = newStore(async () => ({ status: 'not-owner' }));
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: ['take'] });

    assert.equal(await store.exchangeBootstrapToken(plain), null, 'a non-owner exchange fails closed');
    assert.equal(docById(collection, boot._id).consumed, true, 'the bootstrap is spent, not left live');
    assert.equal(standardDocs(collection).length, 0, 'no working token is minted');
    assert.equal(await store.exchangeBootstrapToken(plain), null, 'copy again: the spent bootstrap cannot re-exchange');
  });

  test('no-owner and a throwing seam also → null and spent', async () => {
    for (const check of [async () => ({ status: 'no-owner' }), async () => { throw new Error('boom'); }]) {
      const { store, collection } = newStore(check);
      const plain = 'boot-' + crypto.randomUUID();
      const boot = await seedDoc(collection, { plain, grants: ['dispatch'] });
      assert.equal(await store.exchangeBootstrapToken(plain), null);
      assert.equal(docById(collection, boot._id).consumed, true);
    }
  });

  test('an unwired seam fails closed for a grant-bearing bootstrap', async () => {
    const { store, collection } = newStore(); // no setOwnerCheck
    const plain = 'boot-' + crypto.randomUUID();
    await seedDoc(collection, { plain, grants: ['take'] });
    assert.equal(await store.exchangeBootstrapToken(plain), null);
  });

  test('a still-owner seam lets the exchange through', async () => {
    const { store, collection } = newStore(OWNER);
    const plain = 'boot-' + crypto.randomUUID();
    await seedDoc(collection, { plain, grants: ['take', 'dispatch'] });
    const working = await store.exchangeBootstrapToken(plain);
    assert.ok(working?.token);
  });

  test('a grant-less exchange is unaffected by the seam, even unwired (no regression)', async () => {
    const { store, collection } = newStore(); // unwired
    const plain = 'boot-' + crypto.randomUUID();
    await seedDoc(collection, { plain, grants: [] });
    const working = await store.exchangeBootstrapToken(plain);
    assert.ok(working?.token, 'grant-less exchanges never consult the owner seam');
  });
});

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

describe('LIN-3129 — exchange records lineage uniformly', () => {
  test('parentTokenId and workspaceId are stamped on a grant-bearing working token', async () => {
    const { store, collection } = newStore(OWNER);
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: ['take'], workspaceId: 'ws-42' });

    const working = await store.exchangeBootstrapToken(plain);
    const workingDoc = docById(collection, working.tokenId);
    assert.equal(workingDoc.parentTokenId, boot._id);
    assert.equal(workingDoc.workspaceId, 'ws-42');
  });

  test('parentTokenId and workspaceId are stamped on a grant-less working token too', async () => {
    const { store, collection } = newStore();
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: [], workspaceId: 'ws-7' });

    const working = await store.exchangeBootstrapToken(plain);
    const workingDoc = docById(collection, working.tokenId);
    assert.equal(workingDoc.parentTokenId, boot._id);
    assert.equal(workingDoc.workspaceId, 'ws-7');
  });
});

// ---------------------------------------------------------------------------
// Revoke race
// ---------------------------------------------------------------------------

describe('LIN-3129 — interleaved revoke race after insert', () => {
  test('a bootstrap revoked between insert and re-read discards the working token and returns null', async () => {
    const { store, collection } = newStore(OWNER);
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: ['take'] });

    // Advisory (final review): #mint fires cleanup(), so a bootstrap exchanged
    // within milliseconds of its 1h expiry could be deleted before the re-read,
    // yielding a spurious fail-closed 401. The window is negligible — noted, not
    // fixed. Here the race is provoked deterministically: the bootstrap is
    // deleted as the working token is inserted, i.e. strictly before the re-read.
    const originalInsert = collection.insertOne.bind(collection);
    collection.insertOne = async (doc) => {
      const r = await originalInsert(doc);
      if (doc.kind === 'standard') await collection.deleteOne({ _id: boot._id });
      return r;
    };

    assert.equal(await store.exchangeBootstrapToken(plain), null, 'the race fails closed');
    assert.equal(collection._docs().length, 0, 'neither the revoked bootstrap nor the orphaned working token remains');
  });

  test('a GRANT-LESS exchange whose bootstrap is deleted between insert and re-read still succeeds', async () => {
    // Scoping invariant: the post-insert re-read is a grant-bearing concern only.
    // An ordinary worker bootstrap exchange must not gain the near-expiry window
    // (nor the race failure) that the grant path deliberately carries.
    const { store, collection } = newStore(); // unwired seam: grant-less path
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: [] });

    const originalInsert = collection.insertOne.bind(collection);
    collection.insertOne = async (doc) => {
      const r = await originalInsert(doc);
      if (doc.kind === 'standard') await collection.deleteOne({ _id: boot._id });
      return r;
    };

    const working = await store.exchangeBootstrapToken(plain);
    assert.ok(working?.token, 'a grant-less exchange is unaffected by the revoke race');
    assert.ok(docById(collection, working.tokenId), 'the working token is kept');
  });
});

// ---------------------------------------------------------------------------
// Revoke lineage (step 5 / P3c)
// ---------------------------------------------------------------------------

describe('LIN-3129 — revokeToken lineage semantics', () => {
  test('revoking the bootstrap after exchange also removes the working token', async () => {
    const { store, collection } = newStore(OWNER);
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: ['take'] });
    const working = await store.exchangeBootstrapToken(plain);

    assert.equal(await store.revokeToken('acme', boot._id), true);
    assert.equal(docById(collection, boot._id), undefined);
    assert.equal(docById(collection, working.tokenId), undefined, 'the working token is revoked with its root');
    assert.equal(await store.validateToken(working.token), null);
  });

  test('revoking the working token also removes its bootstrap (parent)', async () => {
    const { store, collection } = newStore(OWNER);
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: ['take'] });
    const working = await store.exchangeBootstrapToken(plain);

    assert.equal(await store.revokeToken('acme', working.tokenId), true);
    assert.equal(docById(collection, boot._id), undefined, 'the root bootstrap is revoked with its working token');
    assert.equal(docById(collection, working.tokenId), undefined);
  });

  test('revoke after the root was cleaned up, by the working token\'s own id, still removes it', async () => {
    const { store, collection } = newStore(OWNER);
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: ['take'] });
    const working = await store.exchangeBootstrapToken(plain);
    await collection.deleteOne({ _id: boot._id }); // simulate cleanup() of the 1h root

    assert.equal(await store.revokeToken('acme', working.tokenId), true);
    assert.equal(docById(collection, working.tokenId), undefined);
  });

  test('revoke by a cleaned-up bootstrap id removes the working token (P3c A2)', async () => {
    const { store, collection } = newStore(OWNER);
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: ['take'] });
    const working = await store.exchangeBootstrapToken(plain);
    await collection.deleteOne({ _id: boot._id }); // the root row is gone

    assert.equal(await store.revokeToken('acme', boot._id), true, 'a DELETE naming the cleaned-up root still acts');
    assert.equal(docById(collection, working.tokenId), undefined, 'its working token is removed by parentTokenId');
  });

  test('a token with no lineage is revoked exactly as before', async () => {
    const { store, collection } = newStore();
    const result = await store.createToken('acme', { createdBy: 'account-A' });
    assert.equal(await store.revokeToken('acme', result.tokenId), true);
    assert.equal(await store.validateToken(result.token), null);
  });

  test('lineage never crosses workspaces: a wrong urlKey revokes nothing', async () => {
    const { store, collection } = newStore(OWNER);
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: ['take'] });
    await store.exchangeBootstrapToken(plain);

    assert.equal(await store.revokeToken('other-workspace', boot._id), false);
    assert.equal(collection._docs().length, 2, 'both the bootstrap and working token survive');
  });
});

describe('LIN-3129 — revoke stays single-row for grant-less tokens (no behaviour change)', () => {
  test('revoking a grant-less bootstrap after exchange leaves its working token intact and validating', async () => {
    const { store, collection } = newStore(); // grant-less, unwired seam
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: [] });
    const working = await store.exchangeBootstrapToken(plain);
    assert.ok(working?.token, 'setup: the grant-less exchange succeeded');

    assert.equal(await store.revokeToken('acme', boot._id), true);
    assert.equal(docById(collection, boot._id), undefined);
    assert.ok(docById(collection, working.tokenId), 'a grant-less working token is NOT swept up by lineage');
    assert.ok(await store.validateToken(working.token), 'and it still authenticates');
  });

  test('revoking a grant-less working token leaves its (consumed) bootstrap row in place', async () => {
    const { store, collection } = newStore();
    const plain = 'boot-' + crypto.randomUUID();
    const boot = await seedDoc(collection, { plain, grants: [] });
    const working = await store.exchangeBootstrapToken(plain);

    assert.equal(await store.revokeToken('acme', working.tokenId), true);
    assert.equal(docById(collection, working.tokenId), undefined);
    assert.ok(docById(collection, boot._id), 'the grant-less bootstrap row survives a single-row revoke');
  });

  test('revoking a missing id whose grant-less child names it returns false and leaves the child intact', async () => {
    const { store, collection } = newStore();
    const missingRoot = crypto.randomUUID();
    const plain = 'std-' + crypto.randomUUID();
    const child = await seedDoc(collection, {
      plain, kind: 'standard', grants: [], parentTokenId: missingRoot
    });

    assert.equal(await store.revokeToken('acme', missingRoot), false, 'a missing id with only grant-less children is a no-op');
    assert.ok(docById(collection, child._id), 'the grant-less child is left alone');
  });
});

// ---------------------------------------------------------------------------
// Route response
// ---------------------------------------------------------------------------

function buildApp(tokenStore, events) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: tokenStore,
    proxyEventStore: { recordEvent: async (e) => { events.push(e); } },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function postExchange(app, bearer) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = {};
    if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/token`, { method: 'POST', headers });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-3129 — the exchange response carries grants only when non-empty', () => {
  test('a grant-bearing exchange returns grants (and the forced 24h TTL)', async () => {
    const { store, collection } = newStore(OWNER);
    const plain = 'boot-' + crypto.randomUUID();
    await seedDoc(collection, { plain, grants: ['take', 'dispatch'] });
    const app = buildApp(store, []);

    const res = await postExchange(app, plain);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.grants, ['take', 'dispatch']);
    const hours = (new Date(res.body.expiresAt).getTime() - Date.now()) / (60 * 60 * 1000);
    assert.ok(hours > 23.9 && hours <= 24.1, `expected ~24h, got ${hours}`);
  });

  test('a grant-less exchange response has no grants key (byte-identical to before)', async () => {
    const { store, collection } = newStore();
    const plain = 'boot-' + crypto.randomUUID();
    await seedDoc(collection, { plain, grants: [] });
    const app = buildApp(store, []);

    const res = await postExchange(app, plain);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'grants'), false);
    assert.equal(res.body.scope, 'readWrite');
  });

  test('a non-owner exchange answers the generic 401', async () => {
    const { store, collection } = newStore(async () => ({ status: 'not-owner' }));
    const plain = 'boot-' + crypto.randomUUID();
    await seedDoc(collection, { plain, grants: ['take'] });
    const app = buildApp(store, []);

    const res = await postExchange(app, plain);
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'PROXY_TOKEN_INVALID');
  });
});
