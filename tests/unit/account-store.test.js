/**
 * Unit tests for lib/account-store.js (LIN-1327).
 *
 * Run with: node --test tests/unit/account-store.test.js
 *
 * Against a REAL MangoDB tmpdir instance (precedent: tests/unit/db-indexes.test.js),
 * not a hand-rolled mock — this store's correctness rests on `$elemMatch` array
 * semantics, and a mock would just encode an assumption about that operator
 * instead of testing it.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { AccountStore } from '../../lib/account-store.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('account-store', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'account-store-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`acct_${counter++}`);
    return new AccountStore({ collection: db.collection('accounts') });
  }

  test('createAccount mints a UUID accountId and persists a retrievable account', async () => {
    const store = freshStore();
    const account = await store.createAccount();

    assert.match(account._id, UUID_RE);
    assert.deepStrictEqual(account.identities, []);

    const fetched = await store.getAccount(account._id);
    assert.ok(fetched, 'account should be retrievable after creation');
    assert.strictEqual(fetched._id, account._id);
  });

  test('linkIdentity happy path attaches the identity', async () => {
    const store = freshStore();
    const account = await store.createAccount();

    const result = await store.linkIdentity(account._id, 'linear', 'org-1', { token: 'tok-1' });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.account.identities.length, 1);
    assert.deepStrictEqual(result.account.identities[0], {
      provider: 'linear',
      scope: 'org-1',
      credentials: { token: 'tok-1' }
    });

    const fetched = await store.getAccount(account._id);
    assert.strictEqual(fetched.identities.length, 1);
  });

  test('strict conflict: identity already on another account returns an explicit conflict, no mutation', async () => {
    const store = freshStore();
    const accountA = await store.createAccount();
    const accountB = await store.createAccount();

    await store.linkIdentity(accountA._id, 'github', 'owner/repo', { token: 'a-tok' });

    const result = await store.linkIdentity(accountB._id, 'github', 'owner/repo', { token: 'b-tok' });

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.conflict, { accountId: accountA._id });

    // Neither account was mutated by the attempted link.
    const refetchedA = await store.getAccount(accountA._id);
    const refetchedB = await store.getAccount(accountB._id);
    assert.strictEqual(refetchedA.identities.length, 1);
    assert.strictEqual(refetchedA.identities[0].credentials.token, 'a-tok');
    assert.strictEqual(refetchedB.identities.length, 0);
  });

  test('(provider, scope) keying: same provider at two scopes yields two identities on one account', async () => {
    const store = freshStore();
    const account = await store.createAccount();

    await store.linkIdentity(account._id, 'github', 'owner/repo', { token: 'issues-tok' });
    const result = await store.linkIdentity(account._id, 'github', 'org/42', { token: 'projects-tok' });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.account.identities.length, 2);

    // Regression guard for the dotted-path false-conflict bug: a lookup for an
    // identity this account does NOT have must not match across array elements.
    const owner = await store.findAccountByIdentity('github', 'org/999');
    assert.strictEqual(owner, null);
  });

  test('idempotent re-link: same (provider, scope) on the same account merges, does not duplicate or conflict', async () => {
    const store = freshStore();
    const account = await store.createAccount();

    await store.linkIdentity(account._id, 'linear', 'org-1', { token: 'first-tok' });
    const result = await store.linkIdentity(account._id, 'linear', 'org-1', { refreshToken: 'r-tok' });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.account.identities.length, 1);
    assert.deepStrictEqual(result.account.identities[0].credentials, {
      token: 'first-tok',
      refreshToken: 'r-tok'
    });
  });

  test('linkIdentity against an unknown accountId returns an explicit reason, not a throw', async () => {
    const store = freshStore();

    const result = await store.linkIdentity('does-not-exist', 'linear', 'org-1', { token: 'tok' });

    assert.deepStrictEqual(result, { ok: false, reason: 'unknown-account' });
  });
});
