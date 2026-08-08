/**
 * LIN-1887 Step 2 — the durable owner-credential partition (F1), its
 * migrate-on-read (N3), its provider gate (G1), the partitioned single-flight
 * key (N1), and `deleteAll` (N2).
 *
 * These drive the REAL `OwnerCredentialStore` and the REAL
 * `refreshOwnerCredential` seam over an in-memory collection modelling
 * MongoDB/MangoDB's `updateOne` (`matchedCount`, upsert) and `deleteMany`
 * semantics — not re-implementations of them. The point of the ticket is that
 * the key, the CAS witness, and the in-flight key all agree; a fake that
 * modelled the key itself would assume exactly what is under test.
 *
 * Every test here except the `deleteAll` census was RED before this change:
 * the co-resident test found one record carrying Atlassian's refresh token
 * under `provider: 'linear'`, the single-flight test found one exchange and the
 * Jira caller holding Linear's token, and the G1 test found Linear's credential
 * migrated into the `::jira` partition with the legacy record deleted.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { refreshOwnerCredential, _resetInflightForTests } from '../../lib/workspace-token-refresh.js';
import { persistOwnerCredential } from '../../lib/workspace.js';
import { TokenRefreshError } from '../../lib/token-refresh.js';

/**
 * Minimal in-memory collection with the two semantics this store depends on:
 * `updateOne`'s `matchedCount` (the CAS signal) and its upsert, plus
 * `deleteMany` on a field filter.
 */
function fakeCollection(seed = {}) {
  const docs = new Map(Object.entries(seed));
  return {
    docs,
    ids: () => [...docs.keys()].sort(),
    async findOne(filter) {
      const doc = docs.get(filter._id);
      if (!doc) return null;
      for (const [k, v] of Object.entries(filter)) {
        if (k === '_id') continue;
        if (doc[k] !== v) return null;
      }
      return { ...doc };
    },
    async updateOne(filter, update, options = {}) {
      const existing = docs.get(filter._id);
      const matches = existing && Object.entries(filter).every(([k, v]) => k === '_id' || existing[k] === v);
      if (!matches) {
        if (!options.upsert) return { matchedCount: 0, upsertedCount: 0 };
        docs.set(filter._id, { _id: filter._id, ...(update.$setOnInsert || {}), ...update.$set });
        return { matchedCount: 0, upsertedCount: 1 };
      }
      docs.set(filter._id, { ...existing, ...update.$set });
      return { matchedCount: 1, upsertedCount: 0 };
    },
    async deleteOne(filter) {
      docs.delete(filter._id);
      return { deletedCount: 1 };
    },
    async deleteMany(filter) {
      let deletedCount = 0;
      for (const [id, doc] of [...docs.entries()]) {
        if (Object.entries(filter).every(([k, v]) => doc[k] === v)) {
          docs.delete(id);
          deletedCount++;
        }
      }
      return { deletedCount };
    },
  };
}

const LEGACY_LINEAR = {
  _id: 'acct-1::acme',
  accountId: 'acct-1',
  urlKey: 'acme',
  provider: 'linear',
  scope: 'org-1',
  token: 'linear-access',
  refreshToken: 'LINEAR-RT',
  tokenExpiresAt: 1,
};

describe('LIN-1887 F1 — a Jira link must not clobber Linear’s durable credential', () => {
  test('the co-resident case: a Jira OAuth add-source onto a Linear workspace leaves the Linear record intact, correctly labelled, and still refreshing', async () => {
    // This is the ONLY configuration this add-source-only phase produces, and
    // the one the pre-partition store destroyed.
    const collection = fakeCollection();
    const store = new OwnerCredentialStore({ collection });

    await store.put('acct-1', 'acme', {
      provider: 'linear', scope: 'org-1', token: 'linear-access', refreshToken: 'LINEAR-RT', tokenExpiresAt: 1,
    });

    // The Jira link. `workspace.provider` is STILL 'linear' — add-source never
    // makes the new binding active — so the explicit provider argument is what
    // keeps this out of Linear's partition.
    const workspace = {
      urlKey: 'acme',
      provider: 'linear',
      accessToken: 'linear-access',
      tokenExpiresAt: 1,
      bindings: [
        { provider: 'linear', scope: 'org-1', credentials: { token: 'linear-access' } },
        { provider: 'jira', scope: 'https://acme.atlassian.net', credentials: { token: 'jira-access', authType: 'oauth', tokenExpiresAt: 2 } },
      ],
    };
    await persistOwnerCredential('acct-1', workspace, store, 'atlassian-refresh-ROTATING', 'jira');

    const linear = await store.get('acct-1', 'acme', 'linear');
    assert.equal(linear.refreshToken, 'LINEAR-RT', 'Linear’s rotating credential must survive the Jira link');
    assert.equal(linear.provider, 'linear');
    assert.equal(linear.token, 'linear-access');

    const jira = await store.get('acct-1', 'acme', 'jira');
    assert.equal(jira.refreshToken, 'atlassian-refresh-ROTATING');
    assert.equal(jira.provider, 'jira');
    assert.equal(jira.token, 'jira-access', 'the Jira record carries the JIRA binding’s token, not the active scalar mirror');
    assert.equal(jira.tokenExpiresAt, 2);

    assert.deepEqual(collection.ids(), ['acct-1::acme::jira', 'acct-1::acme::linear'], 'two partitions, one per provider');
  });

  test('the `record.provider` gate: a mislabelled record is never spent at the wrong provider’s endpoint', async () => {
    // A legacy record written by the PRE-partition code: Jira's rotating token
    // sitting under `provider: 'linear'`. Independent of the key, and the only
    // defence against records that already exist.
    const collection = fakeCollection({
      'acct-1::acme::linear': { ...LEGACY_LINEAR, _id: 'acct-1::acme::linear', provider: 'jira' },
    });
    const store = new OwnerCredentialStore({ collection });

    let spent = null;
    const result = await refreshOwnerCredential({
      ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'linear', store,
      refreshAccessToken: async (rt) => { spent = rt; return { access_token: 'x', refresh_token: 'y', expires_in: 3600 }; },
    });

    assert.equal(result, null, 'a mislabelled record is "nothing refreshable", not something to spend');
    assert.equal(spent, null, 'the credential must never reach Linear’s exchange');
  });
});

describe('LIN-1887 G1 — the legacy read-through is gated on the record’s own provider', () => {
  beforeEach(() => _resetInflightForTests());

  test('a jira-scoped read on a workspace whose only record is a legacy 2-part LINEAR one returns null and leaves that record where it is', async () => {
    // The required clause. Ungated, this read migrates Linear's rotating
    // credential into the `::jira` partition and deletes the legacy id — after
    // which Linear's own read returns null, `ensureValidToken` throws, and the
    // Linear workspace is removed. F1's outcome, through F1's fix.
    const collection = fakeCollection({ 'acct-1::acme': { ...LEGACY_LINEAR } });
    const store = new OwnerCredentialStore({ collection });

    const jiraRead = await store.get('acct-1', 'acme', 'jira');
    assert.equal(jiraRead, null, 'the Jira partition has nothing — the legacy record belongs to Linear');
    assert.deepEqual(collection.ids(), ['acct-1::acme'], 'the legacy record must be left exactly where it is');

    // And the owner of that record still finds it.
    const linearRead = await store.get('acct-1', 'acme', 'linear');
    assert.equal(linearRead.refreshToken, 'LINEAR-RT');
    assert.equal(linearRead._id, 'acct-1::acme::linear', 'Linear’s own read is what migrates it');
  });

  test('a legacy PROVIDERLESS record reads as Linear’s, not as nobody’s', async () => {
    const collection = fakeCollection({
      'acct-1::acme': { ...LEGACY_LINEAR, provider: undefined },
    });
    const store = new OwnerCredentialStore({ collection });

    assert.equal(await store.get('acct-1', 'acme', 'jira'), null);
    const linear = await store.get('acct-1', 'acme', 'linear');
    assert.equal(linear.refreshToken, 'LINEAR-RT');
    assert.equal(linear.provider, 'linear', 'migration normalizes the absent label rather than carrying it forward');
  });
});

describe('LIN-1887 N3 — migrate-on-read keeps the CAS witness and the read id on the same document', () => {
  beforeEach(() => _resetInflightForTests());

  test('a legacy record is read, migrated, and rotated through a CAS that MATCHES', async () => {
    // Without migrate-on-read the read would hit `acct-1::acme` while
    // `putIfRefreshToken` wrote `acct-1::acme::linear`, so the CAS would miss
    // forever — a silent, permanent failure.
    const collection = fakeCollection({ 'acct-1::acme': { ...LEGACY_LINEAR } });
    const store = new OwnerCredentialStore({ collection });

    const result = await refreshOwnerCredential({
      ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'linear', store,
      refreshAccessToken: async () => ({ access_token: 'fresh-linear', refresh_token: 'LINEAR-RT-2', expires_in: 3600 }),
    });

    assert.equal(result.token, 'fresh-linear');
    assert.equal(result.refreshToken, 'LINEAR-RT-2', 'the CAS matched — the rotation landed');
    assert.deepEqual(collection.ids(), ['acct-1::acme::linear'], 'the legacy id is gone, exactly one partitioned record remains');
    const stored = await store.get('acct-1', 'acme', 'linear');
    assert.equal(stored.refreshToken, 'LINEAR-RT-2');
    assert.equal(stored.scope, 'org-1', 'the migration carries every field, not just the credential');
  });

  test('migration is idempotent — a second read over an already-migrated record is a plain point read', async () => {
    const collection = fakeCollection({ 'acct-1::acme': { ...LEGACY_LINEAR } });
    const store = new OwnerCredentialStore({ collection });
    await store.get('acct-1', 'acme', 'linear');
    const second = await store.get('acct-1', 'acme', 'linear');
    assert.equal(second.refreshToken, 'LINEAR-RT');
    assert.deepEqual(collection.ids(), ['acct-1::acme::linear']);
  });
});

describe('LIN-1887 N1 — the single-flight key is partitioned by provider', () => {
  beforeEach(() => _resetInflightForTests());

  test('concurrent Linear and Jira refreshes on ONE workspace produce two exchanges and two distinct results', async () => {
    // Unpartitioned, these coalesce onto one promise and the Jira caller is
    // handed Linear's freshly-minted access token AND Linear's scope — which
    // `applyAccessTokenToWorkspace` would then mirror onto the workspace. This
    // is a defect INTRODUCED by the store partition, so it lands with it.
    const collection = fakeCollection({
      'acct-1::acme::linear': { _id: 'acct-1::acme::linear', accountId: 'acct-1', urlKey: 'acme', provider: 'linear', scope: 'org-1', token: 'stale-linear', refreshToken: 'LINEAR-RT' },
      'acct-1::acme::jira': { _id: 'acct-1::acme::jira', accountId: 'acct-1', urlKey: 'acme', provider: 'jira', scope: 'https://acme.atlassian.net', token: 'stale-jira', refreshToken: 'JIRA-RT' },
    });
    const store = new OwnerCredentialStore({ collection });

    const exchanges = [];
    const exchangeFor = (name, freshToken, freshRt) => async (rt) => {
      exchanges.push([name, rt]);
      return { access_token: freshToken, refresh_token: freshRt, expires_in: 3600 };
    };

    const [linear, jira] = await Promise.all([
      refreshOwnerCredential({ ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'linear', store, refreshAccessToken: exchangeFor('linear', 'fresh-linear', 'LINEAR-RT-2') }),
      refreshOwnerCredential({ ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'jira', store, refreshAccessToken: exchangeFor('jira', 'fresh-jira', 'JIRA-RT-2') }),
    ]);

    assert.deepEqual(exchanges.sort(), [['jira', 'JIRA-RT'], ['linear', 'LINEAR-RT']], 'two independent exchanges');
    assert.equal(linear.token, 'fresh-linear');
    assert.equal(jira.token, 'fresh-jira', 'the Jira caller must not receive Linear’s token');
    assert.equal(jira.scope, 'https://acme.atlassian.net', 'nor Linear’s scope');
    assert.equal(linear.provider, 'linear');
    assert.equal(jira.provider, 'jira');
  });

  test('two concurrent entrants for the SAME provider still coalesce onto one exchange (LIN-1546 preserved)', async () => {
    const collection = fakeCollection({
      'acct-1::acme::linear': { _id: 'acct-1::acme::linear', accountId: 'acct-1', urlKey: 'acme', provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'R0' },
    });
    const store = new OwnerCredentialStore({ collection });
    let calls = 0;
    const refreshAccessToken = async () => { calls++; return { access_token: 'a1', refresh_token: 'R1', expires_in: 3600 }; };

    const [a, b] = await Promise.all([
      refreshOwnerCredential({ ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'linear', store, refreshAccessToken }),
      refreshOwnerCredential({ ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'linear', store, refreshAccessToken }),
    ]);
    assert.equal(calls, 1, 'same owner + workspace + provider still shares one round-trip');
    assert.equal(a.token, 'a1');
    assert.equal(b.token, 'a1');
  });
});

describe('LIN-1887 N2 — delete semantics under a partitioned key', () => {
  const seedBoth = () => fakeCollection({
    'acct-1::acme::linear': { _id: 'acct-1::acme::linear', accountId: 'acct-1', urlKey: 'acme', provider: 'linear', refreshToken: 'LINEAR-RT' },
    'acct-1::acme::jira': { _id: 'acct-1::acme::jira', accountId: 'acct-1', urlKey: 'acme', provider: 'jira', refreshToken: 'JIRA-RT' },
    'acct-1::other::linear': { _id: 'acct-1::other::linear', accountId: 'acct-1', urlKey: 'other', provider: 'linear', refreshToken: 'OTHER-RT' },
  });

  test('deleteAll removes EVERY partition for the workspace — and nothing outside it', async () => {
    const collection = seedBoth();
    const store = new OwnerCredentialStore({ collection });
    await store.deleteAll('acct-1', 'acme');
    assert.deepEqual(collection.ids(), ['acct-1::other::linear'], 'a single-partition delete here would orphan the sibling');
  });

  test('deleteAll also reaps a not-yet-migrated legacy record', async () => {
    const collection = fakeCollection({ 'acct-1::acme': { ...LEGACY_LINEAR } });
    const store = new OwnerCredentialStore({ collection });
    await store.deleteAll('acct-1', 'acme');
    assert.deepEqual(collection.ids(), [], 'a workspace removed before its credential was ever read leaves nothing behind');
  });

  test('delete is per-partition — unlinking one binding leaves the other provider’s credential alone', async () => {
    const collection = seedBoth();
    const store = new OwnerCredentialStore({ collection });
    await store.delete('acct-1', 'acme', 'jira');
    assert.deepEqual(collection.ids(), ['acct-1::acme::linear', 'acct-1::other::linear']);
  });

  test('delete for a provider that never had a durable record is a harmless no-op', async () => {
    const collection = seedBoth();
    const store = new OwnerCredentialStore({ collection });
    await store.delete('acct-1', 'acme', 'github');
    assert.deepEqual(collection.ids(), ['acct-1::acme::jira', 'acct-1::acme::linear', 'acct-1::other::linear']);
  });
});

describe('LIN-1887 — the seam’s failure contract is unchanged by the parameterisation', () => {
  beforeEach(() => _resetInflightForTests());

  test('a genuine revocation still surfaces as EXPIRED so the LIN-1545 delete guard can fire', async () => {
    const collection = fakeCollection({
      'acct-1::acme::linear': { _id: 'acct-1::acme::linear', accountId: 'acct-1', urlKey: 'acme', provider: 'linear', token: 't', refreshToken: 'R0' },
    });
    const store = new OwnerCredentialStore({ collection });
    await assert.rejects(
      refreshOwnerCredential({
        ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'linear', store,
        refreshAccessToken: async () => { throw new TokenRefreshError('Refresh token expired or invalid', 'EXPIRED'); },
      }),
      (err) => err instanceof TokenRefreshError && err.code === 'EXPIRED'
    );
  });

  test('a race loser converges on the winner’s rotated credential inside its OWN partition', async () => {
    const collection = fakeCollection({
      'acct-1::acme::jira': { _id: 'acct-1::acme::jira', accountId: 'acct-1', urlKey: 'acme', provider: 'jira', token: 'stale', refreshToken: 'R0' },
    });
    const store = new OwnerCredentialStore({ collection });
    const result = await refreshOwnerCredential({
      ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'jira', store,
      refreshAccessToken: async () => {
        // A concurrent winner rotated the record while we were in flight.
        collection.docs.set('acct-1::acme::jira', { _id: 'acct-1::acme::jira', accountId: 'acct-1', urlKey: 'acme', provider: 'jira', token: 'winner-access', refreshToken: 'R1' });
        throw new TokenRefreshError('invalid_grant', 'EXPIRED');
      },
    });
    assert.equal(result.token, 'winner-access', 'the loser converges rather than reporting a dead credential');
    assert.equal(result.refreshToken, 'R1');
  });
});
