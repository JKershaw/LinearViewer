/**
 * LIN-3124 PR2 (S1) — T8: OwnerCredentialStore connection-keyed records.
 *
 * Run with: node --test tests/unit/lin-3124-pr2-owner-credential-store.test.js
 *
 * Against a REAL MangoDB tmpdir instance (precedent:
 * tests/unit/owner-credential-store.test.js). Covers the D8 contract:
 * `_id = connectionId`, `getByConnection` self-assertion, no collision with the
 * legacy 3-/2-part keys, the per-connection CAS, and the copy / compare-and-
 * delete promotion split (`copyToConnection` / `finalizePromotion`) whose
 * `deleteOne` relies on MangoDB's `deletedCount`.
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
    provider: 'jira',
    scope: 'https://acme.atlassian.net',
    token: 'access-tok-1',
    refreshToken: 'refresh-tok-1',
    tokenExpiresAt: Date.now() + 3600_000,
    ...overrides
  };
}

describe('LIN-3124 PR2 T8 — OwnerCredentialStore connection-keyed records', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin3124-pr2-ocs-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`pr2ocs_${counter++}`);
    return new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
  }

  const connectionIdFor = (accountId, provider, unitId) => `${accountId}::${provider}::${unitId}`;

  test('putByConnection persists a record retrievable by getByConnection, _id = connectionId', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const connectionId = connectionIdFor(acct, 'jira', 'https://acme.atlassian.net');

    assert.strictEqual(
      await store.putByConnection(connectionId, sampleCredential({ accountId: acct, connectionId })),
      true
    );

    const fetched = await store.getByConnection(connectionId);
    assert.ok(fetched);
    assert.strictEqual(fetched._id, connectionId);
    assert.strictEqual(fetched.connectionId, connectionId);
    assert.strictEqual(fetched.accountId, acct);
    assert.strictEqual(fetched.provider, 'jira');
    assert.strictEqual(fetched.token, 'access-tok-1');
    assert.strictEqual(fetched.refreshToken, 'refresh-tok-1');
  });

  test('putByConnection repairs in place (one record, latest wins)', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const connectionId = connectionIdFor(acct, 'jira', 'site');

    await store.putByConnection(connectionId, sampleCredential({ refreshToken: 'r1' }));
    await store.putByConnection(connectionId, sampleCredential({ refreshToken: 'r2' }));

    assert.strictEqual((await store.getByConnection(connectionId)).refreshToken, 'r2');
    const all = await store.collection.find({ connectionId }).toArray();
    assert.strictEqual(all.length, 1);
  });

  test('getByConnection refuses a document whose connectionId disagrees (legacy-id collision guard)', async () => {
    const store = freshStore();
    const connectionId = 'acct-1::jira::site';
    await store.collection.updateOne(
      { _id: connectionId },
      { $set: { connectionId: 'something-else', provider: 'jira' } },
      { upsert: true }
    );
    assert.strictEqual(await store.getByConnection(connectionId), null);
  });

  test('connection-keyed and legacy 3-part keys cannot collide', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    // Legacy key: accountId::urlKey::provider
    await store.put(acct, urlKey, sampleCredential({ provider: 'jira', refreshToken: 'legacy' }));
    // Connection key: accountId::provider::unitId
    const connectionId = connectionIdFor(acct, 'jira', urlKey);
    await store.putByConnection(connectionId, sampleCredential({ provider: 'jira', refreshToken: 'connection' }));

    assert.notStrictEqual(`${acct}::${urlKey}::jira`, connectionId);
    assert.strictEqual((await store.get(acct, urlKey, 'jira')).refreshToken, 'legacy');
    assert.strictEqual((await store.getByConnection(connectionId)).refreshToken, 'connection');
  });

  test('putIfRefreshTokenByConnection: the CAS loser converges and never deletes', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const connectionId = connectionIdFor(acct, 'jira', 'site');
    await store.putByConnection(connectionId, sampleCredential({ refreshToken: 'r0' }));

    assert.strictEqual(
      await store.putIfRefreshTokenByConnection(connectionId, 'r0', sampleCredential({ refreshToken: 'r1' })),
      true
    );
    // A second entrant still holding r0 loses the CAS.
    assert.strictEqual(
      await store.putIfRefreshTokenByConnection(connectionId, 'r0', sampleCredential({ refreshToken: 'rX' })),
      false
    );

    const converged = await store.getByConnection(connectionId);
    assert.strictEqual(converged.refreshToken, 'r1', 'the winner must not be clobbered');
    assert.ok(converged, 'a lost CAS never deletes the record');

    // A landed rotation clears any spend-intent marker.
    await store.markSpendIntentByConnection(connectionId, 'r1');
    assert.ok((await store.getByConnection(connectionId)).pendingSpend);
    await store.putIfRefreshTokenByConnection(connectionId, 'r1', sampleCredential({ refreshToken: 'r2' }));
    assert.strictEqual((await store.getByConnection(connectionId)).pendingSpend, null);
  });

  test('markSpendIntentByConnection / clearSpendIntentByConnection round-trip', async () => {
    const store = freshStore();
    const connectionId = 'acct::jira::site';
    await store.putByConnection(connectionId, sampleCredential());

    assert.strictEqual(await store.markSpendIntentByConnection(connectionId, 'r1'), true);
    assert.deepStrictEqual((await store.getByConnection(connectionId)).pendingSpend.refreshToken, 'r1');

    assert.strictEqual(await store.clearSpendIntentByConnection(connectionId), true);
    assert.strictEqual((await store.getByConnection(connectionId)).pendingSpend, null);
  });

  test('deleteByConnection removes the record', async () => {
    const store = freshStore();
    const connectionId = 'acct::jira::site';
    await store.putByConnection(connectionId, sampleCredential());
    assert.strictEqual(await store.deleteByConnection(connectionId), true);
    assert.strictEqual(await store.getByConnection(connectionId), null);
  });

  test('copyToConnection copies the staged record and leaves the legacy key intact', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    await store.put(acct, urlKey, sampleCredential({ provider: 'jira', refreshToken: 'staged-r' }));
    const connectionId = connectionIdFor(acct, 'jira', urlKey);

    assert.strictEqual(await store.copyToConnection(acct, urlKey, 'jira', connectionId), true);

    assert.strictEqual((await store.getByConnection(connectionId)).refreshToken, 'staged-r');
    assert.strictEqual((await store.get(acct, urlKey, 'jira')).refreshToken, 'staged-r', 'staged record untouched');

    // Idempotent: a second copy is still true and leaves one connection record.
    assert.strictEqual(await store.copyToConnection(acct, urlKey, 'jira', connectionId), true);
    assert.strictEqual((await store.collection.find({ connectionId }).toArray()).length, 1);
  });

  test('copyToConnection returns false when the staged record is absent (step-1 failure)', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const connectionId = connectionIdFor(acct, 'jira', 'site');
    assert.strictEqual(await store.copyToConnection(acct, 'missing-ws', 'jira', connectionId), false);
    assert.strictEqual(await store.getByConnection(connectionId), null);
  });

  test('finalizePromotion is a compare-and-delete: only the copied token is deleted', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    await store.put(acct, urlKey, sampleCredential({ provider: 'jira', refreshToken: 'R1' }));
    const connectionId = connectionIdFor(acct, 'jira', urlKey);
    await store.copyToConnection(acct, urlKey, 'jira', connectionId);

    // A staged record that a later flow overwrote with its own grant must not be
    // deleted by this promotion's finalize.
    assert.strictEqual(
      await store.finalizePromotion(acct, urlKey, 'jira', { connectionId, copiedRefreshToken: 'R-other' }),
      false
    );
    assert.ok(await store.get(acct, urlKey, 'jira'), 'a mismatched staged token must survive');

    // The matching case deletes it, leaving the connection record.
    assert.strictEqual(
      await store.finalizePromotion(acct, urlKey, 'jira', { connectionId, copiedRefreshToken: 'R1' }),
      true
    );
    assert.strictEqual(await store.get(acct, urlKey, 'jira'), null);
    assert.strictEqual((await store.getByConnection(connectionId)).refreshToken, 'R1');

    // Idempotent: the staged record is already gone.
    assert.strictEqual(
      await store.finalizePromotion(acct, urlKey, 'jira', { connectionId, copiedRefreshToken: 'R1' }),
      false
    );
  });

  test('finalizePromotion never deletes the only token when the connection record is absent', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    await store.put(acct, urlKey, sampleCredential({ provider: 'jira', refreshToken: 'R1' }));

    assert.strictEqual(
      await store.finalizePromotion(acct, urlKey, 'jira', { connectionId: connectionIdFor(acct, 'jira', urlKey), copiedRefreshToken: 'R1' }),
      false
    );
    assert.ok(await store.get(acct, urlKey, 'jira'), 'the staged record must survive when finalize is a no-op');
  });

  test('the new methods never throw on a broken collection', async () => {
    const exploding = {
      async updateOne() { throw new Error('boom'); },
      async findOne() { throw new Error('boom'); },
      async deleteOne() { throw new Error('boom'); },
    };
    const store = new OwnerCredentialStore({ collection: exploding });

    assert.strictEqual(await store.getByConnection('c'), null);
    assert.strictEqual(await store.putByConnection('c', sampleCredential()), false);
    assert.strictEqual(await store.putIfRefreshTokenByConnection('c', 'r', sampleCredential()), false);
    assert.strictEqual(await store.markSpendIntentByConnection('c', 'r'), false);
    assert.strictEqual(await store.clearSpendIntentByConnection('c'), false);
    assert.strictEqual(await store.deleteByConnection('c'), false);
    assert.strictEqual(await store.copyToConnection('a', 'u', 'jira', 'c'), false);
    assert.strictEqual(await store.finalizePromotion('a', 'u', 'jira', { connectionId: 'c', copiedRefreshToken: 'r' }), false);
  });

  // B2 (LIN-3124 PR2 review): a connection-keyed record must carry no `urlKey`,
  // so the legacy `deleteAll(accountId, urlKey)` filter can never reach it.
  test('B2: deleteAll(accountId, urlKey) cannot reach a connection-keyed record', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const urlKey = `acme-${randomUUID().slice(0, 8)}`;
    const connectionId = connectionIdFor(acct, 'jira', urlKey);

    await store.put(acct, urlKey, sampleCredential({ provider: 'jira', refreshToken: 'r' }));
    assert.strictEqual(await store.copyToConnection(acct, urlKey, 'jira', connectionId), true);

    // The record must not carry `urlKey`.
    const copied = await store.getByConnection(connectionId);
    assert.strictEqual(copied.urlKey, undefined, 'connection-keyed records carry no urlKey');

    // Removing the workspace that staged it must NOT delete the shared record.
    await store.deleteAll(acct, urlKey);

    const survivor = await store.getByConnection(connectionId);
    assert.ok(survivor, 'the connection-keyed record must survive deleteAll');
    assert.strictEqual(survivor.refreshToken, 'r');
    assert.strictEqual(await store.get(acct, urlKey, 'jira'), null, 'the staged legacy record is gone');
  });

  test('B2: putByConnection never persists a urlKey, even when one is supplied', async () => {
    const store = freshStore();
    const connectionId = `${randomUUID()}::jira::site`;
    assert.strictEqual(await store.putByConnection(connectionId, sampleCredential({ urlKey: 'leak', provider: 'jira' })), true);
    assert.strictEqual((await store.getByConnection(connectionId)).urlKey, undefined);
  });
});
