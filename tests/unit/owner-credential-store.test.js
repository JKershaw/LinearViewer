/**
 * Unit tests for lib/owner-credential-store.js (LIN-1523, Session 1).
 *
 * Run with: node --test tests/unit/owner-credential-store.test.js
 *
 * Against a REAL MangoDB tmpdir instance (precedent: tests/unit/workspace-store.test.js)
 * — this store's entire claim is durability + upsert-in-place, so a mock
 * would just encode the assumption instead of testing it.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';

function sampleCredential(overrides = {}) {
  return {
    provider: 'linear',
    scope: 'org-1',
    token: 'access-tok-1',
    refreshToken: 'refresh-tok-1',
    tokenExpiresAt: Date.now() + 3600_000,
    ...overrides
  };
}

describe('owner-credential-store', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'owner-credential-store-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`ocs_${counter++}`);
    return new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
  }

  // OC1
  test('null on a missing point read, never throws', async () => {
    const store = freshStore();
    const result = await store.get('acct-1', 'workspace-1');
    assert.strictEqual(result, null);
  });

  // OC2
  test('put persists a record retrievable by get, keyed on accountId::urlKey::provider', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    const credential = sampleCredential();

    const ok = await store.put(accountId, urlKey, credential);
    assert.strictEqual(ok, true);

    const fetched = await store.get(accountId, urlKey);
    assert.ok(fetched, 'record should be retrievable after put');
    // LIN-1887 F1: the key gained a provider partition, derived from the
    // record's OWN provider field so the two cannot disagree.
    assert.strictEqual(fetched._id, `${accountId}::${urlKey}::linear`);
    assert.strictEqual(fetched.accountId, accountId);
    assert.strictEqual(fetched.urlKey, urlKey);
    assert.strictEqual(fetched.provider, 'linear');
    assert.strictEqual(fetched.scope, credential.scope);
    assert.strictEqual(fetched.token, credential.token);
    assert.strictEqual(fetched.refreshToken, credential.refreshToken);
    assert.strictEqual(fetched.tokenExpiresAt, credential.tokenExpiresAt);
    assert.ok(fetched.createdAt instanceof Date);
    assert.ok(fetched.updatedAt instanceof Date);
  });

  // OC3 — the load-bearing "repairs in place" guarantee
  test('a second put for the same accountId/urlKey repairs in place, never creating a second record', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;

    await store.put(accountId, urlKey, sampleCredential({ refreshToken: 'rotation-1' }));
    await new Promise(resolve => setTimeout(resolve, 5));
    await store.put(accountId, urlKey, sampleCredential({ refreshToken: 'rotation-2' }));

    const fetched = await store.get(accountId, urlKey);
    assert.strictEqual(fetched.refreshToken, 'rotation-2', 'the rotated value must win');

    // Assert the collection count, not just the field values — the point of
    // the composite-_id upsert is that a duplicate record is unrepresentable.
    const all = await store.collection.find({ accountId, urlKey }).toArray();
    assert.strictEqual(all.length, 1, 'exactly one document should exist for this accountId/urlKey pair');
  });

  // OC4
  test('put for a different urlKey under the same accountId creates a separate record', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const urlKeyA = `acme-a-${randomUUID().slice(0, 8)}`;
    const urlKeyB = `acme-b-${randomUUID().slice(0, 8)}`;

    await store.put(accountId, urlKeyA, sampleCredential({ refreshToken: 'tok-a' }));
    await store.put(accountId, urlKeyB, sampleCredential({ refreshToken: 'tok-b' }));

    const fetchedA = await store.get(accountId, urlKeyA);
    const fetchedB = await store.get(accountId, urlKeyB);
    assert.strictEqual(fetchedA.refreshToken, 'tok-a');
    assert.strictEqual(fetchedB.refreshToken, 'tok-b');
  });

  // OC5 — read-merge
  test('patch updates a subset of fields via read-merge, preserving sibling fields', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    await store.put(accountId, urlKey, sampleCredential({ token: 'access-1', refreshToken: 'refresh-1' }));

    // LIN-1887: `provider` is explicit on patch — it selects the partition to
    // read-merge against, exactly as it does on `get`.
    const ok = await store.patch(accountId, urlKey, 'linear', { token: 'access-2' });
    assert.strictEqual(ok, true);

    const fetched = await store.get(accountId, urlKey);
    assert.strictEqual(fetched.token, 'access-2', 'the patched field must update');
    assert.strictEqual(fetched.refreshToken, 'refresh-1', 'sibling fields must survive untouched');
    assert.strictEqual(fetched.scope, 'org-1', 'sibling fields must survive untouched');

    // Re-read via a fresh store instance, not just trust the mutation's own
    // return value — proves the write path, not just the return shape.
    const freshRead = await new OwnerCredentialStore({ collection: store.collection }).get(accountId, urlKey);
    assert.deepStrictEqual(freshRead, fetched);
  });

  // OC6
  test('delete removes the record', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    await store.put(accountId, urlKey, sampleCredential());

    const ok = await store.delete(accountId, urlKey);
    assert.strictEqual(ok, true);

    const fetched = await store.get(accountId, urlKey);
    assert.strictEqual(fetched, null, 'record must be gone after delete');
  });

  // OC7
  test('delete on a record that is not there is a no-op, never throws', async () => {
    const store = freshStore();
    const ok = await store.delete('does-not-exist', 'does-not-exist');
    assert.strictEqual(ok, true);
  });

  // OC8
  test('get/put/patch/delete without accountId or urlKey fail safe (no throw)', async () => {
    const store = freshStore();

    assert.strictEqual(await store.get(null, 'workspace-1'), null);
    assert.strictEqual(await store.get('acct-1', null), null);
    assert.strictEqual(await store.put(null, 'workspace-1', sampleCredential()), false);
    assert.strictEqual(await store.put('acct-1', null, sampleCredential()), false);
    assert.strictEqual(await store.patch(null, 'workspace-1', 'linear', { token: 'x' }), false);
    assert.strictEqual(await store.delete(null, 'workspace-1'), false);
  });

  // -------------------------------------------------------------------------
  // putIfRefreshToken — optimistic CAS (LIN-1546, S3). Against the same REAL
  // MangoDB instance, since the whole point is the atomic conditional write.
  // -------------------------------------------------------------------------

  // OC9 — CAS WIN
  test('putIfRefreshToken writes when the stored refreshToken still matches the witness (CAS win) and returns true', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    await store.put(accountId, urlKey, sampleCredential({ token: 'access-0', refreshToken: 'R0' }));

    const won = await store.putIfRefreshToken(accountId, urlKey, 'R0', {
      provider: 'linear', scope: 'org-1', token: 'access-1', refreshToken: 'R1', tokenExpiresAt: Date.now() + 3600_000,
    });
    assert.strictEqual(won, true);

    const fetched = await store.get(accountId, urlKey);
    assert.strictEqual(fetched.refreshToken, 'R1', 'the rotated refreshToken must win');
    assert.strictEqual(fetched.token, 'access-1', 'the rotated access token lands too');
    assert.ok(fetched.createdAt instanceof Date, 'createdAt is preserved (no upsert re-init)');
  });

  // OC10 — CAS LOSE (witness no longer matches — a concurrent winner rotated it)
  test('putIfRefreshToken does NOT write when the stored refreshToken has changed (CAS lose) and returns false, leaving the winner\'s record intact', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    // The durable record already holds the WINNER's rotated token R1.
    await store.put(accountId, urlKey, sampleCredential({ token: 'access-winner', refreshToken: 'R1' }));

    // A race loser still holding the spent R0 tries to write its own R_loser.
    const won = await store.putIfRefreshToken(accountId, urlKey, 'R0', {
      provider: 'linear', scope: 'org-1', token: 'access-loser', refreshToken: 'R_loser', tokenExpiresAt: Date.now() + 3600_000,
    });
    assert.strictEqual(won, false, 'the loser must not win the CAS');

    const fetched = await store.get(accountId, urlKey);
    assert.strictEqual(fetched.refreshToken, 'R1', 'the winner\'s healthy credential must be untouched');
    assert.strictEqual(fetched.token, 'access-winner');
  });

  // OC11 — CAS on a MISSING record: no upsert, returns false, never creates one
  test('putIfRefreshToken on a missing record returns false and does NOT create one (no upsert)', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;

    const won = await store.putIfRefreshToken(accountId, urlKey, 'R0', {
      provider: 'linear', scope: 'org-1', token: 'access-1', refreshToken: 'R1', tokenExpiresAt: Date.now() + 3600_000,
    });
    assert.strictEqual(won, false);

    const fetched = await store.get(accountId, urlKey);
    assert.strictEqual(fetched, null, 'a CAS miss must never resurrect/create a record');
  });

  // OC12 — guards: missing accountId/urlKey/expectedRefreshToken all fail safe (no throw, no write)
  test('putIfRefreshToken guards on accountId/urlKey/expectedRefreshToken (all fail safe, no throw)', async () => {
    const store = freshStore();
    const accountId = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    await store.put(accountId, urlKey, sampleCredential({ refreshToken: 'R0' }));
    const next = { provider: 'linear', scope: 'org-1', token: 't', refreshToken: 'R1', tokenExpiresAt: Date.now() + 3600_000 };

    assert.strictEqual(await store.putIfRefreshToken(null, urlKey, 'R0', next), false);
    assert.strictEqual(await store.putIfRefreshToken(accountId, null, 'R0', next), false);
    // A missing/empty witness must be refused as a safe miss — never treated as
    // an unconditional write masquerading as a CAS.
    assert.strictEqual(await store.putIfRefreshToken(accountId, urlKey, null, next), false);
    assert.strictEqual(await store.putIfRefreshToken(accountId, urlKey, '', next), false);

    // None of the guarded calls wrote anything — the seeded R0 is intact.
    const fetched = await store.get(accountId, urlKey);
    assert.strictEqual(fetched.refreshToken, 'R0');
  });
});
