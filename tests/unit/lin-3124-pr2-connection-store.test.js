/**
 * LIN-3124 PR2 (S1) — T7: ConnectionStore referent/delete lifecycle.
 *
 * Run with: node --test tests/unit/lin-3124-pr2-connection-store.test.js
 *
 * Against a REAL MangoDB tmpdir instance (precedent: tests/unit/connection-store.test.js)
 * — the whole claim is the atomic upsert + `$size:0`/`origin` delete gate, so a
 * mock would encode the assumption instead of testing it.
 *
 * The three-state `referents` rule (D10):
 *   absent  = a LIN-3127-born dual-write row, never connection-managed
 *   []      = referenced and now empty
 *   non-empty = referenced
 * Absent rows are never read by the referent lookups and never deleted;
 * `origin:'connection'` is required for deletion/reporting.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore, CONNECTION_ORIGIN } from '../../lib/connection-store.js';

describe('LIN-3124 PR2 T7 — ConnectionStore referent/delete lifecycle', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin3124-pr2-cs-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`pr2cs_${counter++}`);
    return new ConnectionStore({ collection: db.collection('connections') });
  }

  const referent = (urlKey, provider = 'github', scope = 'acct/repo') => ({ urlKey, provider, scope });

  test('link is one atomic upsert: credentials + origin + referent', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const id = store._id(acct, 'github', 'install-1');

    assert.strictEqual(
      await store.link(acct, 'github', 'install-1', { token: 'gh', installationId: 'install-1' }, referent('ws-a')),
      true
    );

    const doc = await store.readConnectionById(id);
    assert.strictEqual(doc.origin, CONNECTION_ORIGIN);
    assert.strictEqual(doc.credentials.token, 'gh');
    assert.deepStrictEqual(doc.referents, [referent('ws-a')]);
  });

  test('link $addToSet: the same referent is not duplicated, a new one is added', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const id = store._id(acct, 'github', 'install-1');

    await store.link(acct, 'github', 'install-1', { token: 'gh' }, referent('ws-a'));
    await store.link(acct, 'github', 'install-1', { token: 'gh2' }, referent('ws-a'));
    await store.link(acct, 'github', 'install-1', { token: 'gh2' }, referent('ws-b'));

    const doc = await store.readConnectionById(id);
    assert.strictEqual(doc.referents.length, 2, 'the duplicate referent must not be added twice');
    assert.strictEqual(doc.credentials.token, 'gh2', 'the credential is rewritten');
    assert.strictEqual(doc.origin, CONNECTION_ORIGIN, 'origin stays set on update');
  });

  test('an existing LIN-3127 row (no origin) keeps no origin after link, and stays undeletable', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const id = store._id(acct, 'github', 'install-1');

    // A LIN-3127-born row: put never sets referents or origin.
    await store.put(acct, 'github', 'install-1', { token: 'gh' });
    assert.strictEqual((await store.readConnectionById(id)).origin, undefined);

    // A connection-backed link shares the row.
    await store.link(acct, 'github', 'install-1', { token: 'gh' }, referent('ws-a'));
    const linked = await store.readConnectionById(id);
    assert.strictEqual(linked.origin, undefined, '$setOnInsert must not set origin on an existing row');
    assert.strictEqual(linked.referents.length, 1);

    // Empty it, then try to delete: origin is absent, so it must survive.
    await store.removeReferent(id, referent('ws-a'));
    assert.deepStrictEqual((await store.readConnectionById(id)).referents, []);
    assert.strictEqual(await store.deleteIfUnreferenced(id), false);
    assert.ok(await store.readConnectionById(id), 'a LIN-3127 row is never deleted');
  });

  test('three-state matrix: absent rows are never returned by the referent lookups', async () => {
    const store = freshStore();
    const acct = randomUUID();

    await store.put(acct, 'github', 'absent', { token: 'a' });
    await store.put(acct, 'github', 'empty', { token: 'e' });

    const emptyId = store._id(acct, 'github', 'empty');
    await store.link(acct, 'github', 'empty', { token: 'e' }, referent('ws-a'));
    await store.removeReferent(emptyId, referent('ws-a'));

    const linkedId = store._id(acct, 'github', 'linked');
    await store.link(acct, 'github', 'linked', { token: 'l' }, referent('ws-a'));

    const referenced = await store.readReferencedConnections();
    const ids = referenced.map(d => d._id).sort();
    assert.deepStrictEqual(ids, [emptyId, linkedId].sort(), 'only rows with the referents field exist');

    // A row with referents [] is not matched by a urlKey referent lookup.
    const byReferent = await store.readConnectionsByReferent('ws-a');
    assert.deepStrictEqual(byReferent.map(d => d._id), [linkedId]);
  });

  test('readConnectionsByReferent filters by provider on the SAME element', async () => {
    const store = freshStore();
    const acct = randomUUID();
    await store.link(acct, 'github', 'install-1', { token: 'gh' }, referent('ws-a', 'github'));
    await store.link(acct, 'jira', 'https://acme.atlassian.net', { token: 'j' }, referent('ws-a', 'jira'));

    assert.strictEqual((await store.readConnectionsByReferent('ws-a', 'github')).length, 1);
    assert.strictEqual((await store.readConnectionsByReferent('ws-a', 'jira')).length, 1);
    assert.strictEqual((await store.readConnectionsByReferent('ws-a', 'linear')).length, 0);
    assert.strictEqual((await store.readConnectionsByReferent('nope')).length, 0);
  });

  test('deleteIfUnreferenced requires origin:connection AND referents present with $size 0', async () => {
    const store = freshStore();
    const acct = randomUUID();

    const liveId = store._id(acct, 'github', 'live');
    await store.link(acct, 'github', 'live', { token: 'x' }, referent('ws-a'));
    assert.strictEqual(await store.deleteIfUnreferenced(liveId), false, 'a referenced row must survive');
    assert.ok(await store.readConnectionById(liveId));

    const emptyId = store._id(acct, 'github', 'empty');
    await store.link(acct, 'github', 'empty', { token: 'x' }, referent('ws-a'));
    await store.removeReferent(emptyId, referent('ws-a'));
    assert.strictEqual(await store.deleteIfUnreferenced(emptyId), true, 'an empty referenced row is deleted');
    assert.strictEqual(await store.readConnectionById(emptyId), null);
  });

  test('deleteConnection returns the removed referents; [] when the row is absent', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const id = store._id(acct, 'github', 'install-1');
    await store.link(acct, 'github', 'install-1', { token: 'x' }, referent('ws-a'));
    await store.link(acct, 'github', 'install-1', { token: 'x' }, referent('ws-b'));

    const removed = await store.deleteConnection(id);
    assert.strictEqual(removed.length, 2);
    assert.strictEqual(await store.readConnectionById(id), null);
    assert.deepStrictEqual(await store.deleteConnection(id), []);
  });

  test('readConnectionsByAccountPrefix is anchored (does not match a longer account id)', async () => {
    const store = freshStore();
    await store.link('acct-A', 'github', 'i1', { token: '1' }, referent('ws-a'));
    await store.link('acct-A', 'github', 'i2', { token: '2' }, referent('ws-b'));
    await store.link('acct-A2', 'github', 'i1', { token: '3' }, referent('ws-c'));

    const rows = await store.readConnectionsByAccountPrefix('acct-A');
    assert.deepStrictEqual(rows.map(r => r._id).sort(), ['acct-A::github::i1', 'acct-A::github::i2'].sort());
  });

  test('deleteEmptyByAccountPrefix deletes only origin rows with no referents', async () => {
    const store = freshStore();
    const acct = randomUUID();

    // origin + empty -> deleted
    const orphanId = store._id(acct, 'github', 'orphan');
    await store.link(acct, 'github', 'orphan', { token: 'o' }, referent('ws-a'));
    await store.removeReferent(orphanId, referent('ws-a'));

    // origin + referenced -> kept
    const liveId = store._id(acct, 'github', 'live');
    await store.link(acct, 'github', 'live', { token: 'l' }, referent('ws-a'));

    // LIN-3127 row (no origin) -> kept even with referents []
    const legacyId = store._id(acct, 'github', 'legacy');
    await store.put(acct, 'github', 'legacy', { token: 'g' });
    await store.collection.updateOne({ _id: legacyId }, { $set: { referents: [] } });

    // another account -> untouched
    await store.link('other-account', 'github', 'i1', { token: 'z' }, referent('ws-z'));

    const deleted = await store.deleteEmptyByAccountPrefix(acct);
    assert.strictEqual(deleted, 1);
    assert.strictEqual(await store.readConnectionById(orphanId), null);
    assert.ok(await store.readConnectionById(liveId));
    assert.ok(await store.readConnectionById(legacyId), 'a no-origin row is never deleted');
    assert.ok(await store.readConnectionById('other-account::github::i1'));
  });

  test('put writes credentials on an unmanaged row (byte-identical legacy behaviour)', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const id = store._id(acct, 'github', 'install-1');
    await store.put(acct, 'github', 'install-1', { token: 'v1' });
    await store.put(acct, 'github', 'install-1', { token: 'v2' });
    assert.strictEqual((await store.readConnectionById(id)).credentials.token, 'v2');
  });

  test('put skips the credentials $set once the row is connection-managed', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const id = store._id(acct, 'github', 'install-1');
    await store.link(acct, 'github', 'install-1', { token: 'linked' }, referent('ws-a'));

    await store.put(acct, 'github', 'install-1', { token: 'legacy-clobber' });

    const doc = await store.readConnectionById(id);
    assert.strictEqual(doc.credentials.token, 'linked', 'the linked credential must survive put');
    assert.strictEqual(doc.referents.length, 1);
  });

  test('put/link race window is bounded and self-repairs via updateCredentials', async () => {
    const real = client.db(`pr2cs_${counter++}`).collection('connections');
    const acct = randomUUID();
    const id = `${acct}::github::install-1`;
    const REF = referent('ws-a');

    // A collection wrapper that simulates a concurrent link landing between
    // put's read (finds the row unmanaged/absent) and its write.
    const racing = {
      async findOne(filter) { return real.findOne(filter); },
      async updateOne(filter, update, options) {
        await real.updateOne(filter, {
          $set: { accountId: acct, provider: 'github', unitId: 'install-1', origin: CONNECTION_ORIGIN, credentials: { token: 'linked', tokenExpiresAt: 1000 }, updatedAt: new Date() },
          $addToSet: { referents: REF }
        }, { upsert: true });
        return real.updateOne(filter, update, options);
      }
    };
    const store = new ConnectionStore({ collection: racing });

    await store.put(acct, 'github', 'install-1', { token: 'legacy', tokenExpiresAt: 500 });

    // The accepted window: put clobbered the linked credential.
    const raced = await real.findOne({ _id: id });
    assert.strictEqual(raced.credentials.token, 'legacy');

    // Self-repair: the authoritative writer has no managed-row skip and writes a
    // newer credential.
    const repaired = new ConnectionStore({ collection: real });
    assert.strictEqual(await repaired.updateCredentials(id, { token: 'fresh', tokenExpiresAt: 2000 }), true);
    assert.strictEqual((await real.findOne({ _id: id })).credentials.token, 'fresh');
  });

  test('updateCredentials is monotonic: a stale tokenExpiresAt is refused', async () => {
    const store = freshStore();
    const acct = randomUUID();
    const id = store._id(acct, 'github', 'install-1');
    await store.link(acct, 'github', 'install-1', { token: 'old', tokenExpiresAt: 2000 }, referent('ws-a'));

    assert.strictEqual(await store.updateCredentials(id, { token: 'newer', tokenExpiresAt: 3000 }), true);
    assert.strictEqual((await store.readConnectionById(id)).credentials.token, 'newer');

    assert.strictEqual(await store.updateCredentials(id, { token: 'stale', tokenExpiresAt: 1000 }), false);
    assert.strictEqual((await store.readConnectionById(id)).credentials.token, 'newer', 'a stale write must not land');

    // A missing row is a miss, not a create.
    assert.strictEqual(await store.updateCredentials(`${acct}::github::missing`, { token: 'x', tokenExpiresAt: 9 }), false);
  });

  // B4/R6 — the referent lookup must match BOTH fields on the SAME element.
  test('B4/R6: readConnectionsByReferent matches both fields on the same element', async () => {
    const store = freshStore();
    const acct = randomUUID();
    await store.link(acct, 'linear', 'org-1', { token: 'x' }, { urlKey: 'a', provider: 'jira', scope: 's' });
    await store.link(acct, 'linear', 'org-1', { token: 'x' }, { urlKey: 'b', provider: 'linear', scope: 's' });

    assert.deepStrictEqual(
      await store.readConnectionsByReferent('a', 'linear'), [],
      'urlKey a belongs to the jira referent, not the linear one'
    );
    assert.strictEqual((await store.readConnectionsByReferent('a', 'jira')).length, 1);
    assert.strictEqual((await store.readConnectionsByReferent('b', 'linear')).length, 1);
  });

  // B4/R10 — the account-prefix scan and the empty-delete must be anchored.
  test('B4/R10: account-prefix scan and empty-delete are anchored', async () => {
    const store = freshStore();
    const first = store._id('acc1', 'linear', 'x'); // acc1::linear::x
    const second = 'xacc1::linear::y';
    for (const id of [first, second]) {
      await store.collection.updateOne(
        { _id: id },
        { $set: { accountId: id.split('::')[0], provider: 'linear', unitId: id.split('::')[2], origin: 'connection', referents: [], credentials: {}, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true }
      );
    }

    const rows = await store.readConnectionsByAccountPrefix('acc1');
    assert.deepStrictEqual(rows.map(r => r._id), [first], 'xacc1 must not match the acc1 prefix');

    const deleted = await store.deleteEmptyByAccountPrefix('acc1');
    assert.strictEqual(deleted, 1);
    assert.strictEqual(await store.readConnectionById(first), null);
    assert.ok(await store.readConnectionById(second), 'xacc1::linear::y must survive');
  });
});
