/**
 * Unit tests for lib/drop-shares-collection.js (LIN-3325).
 *
 * The one-off cleanup that drops the retired `shares` collection and its
 * indexes. Runs on a REAL MangoDB tmpdir (tests/fixtures/mango-tmpdir.js) so the
 * `drop()` and the existence probe are the real engine's, not a double's.
 *
 * Run with: node --test tests/unit/drop-shares-collection.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { dropSharesCollection, SHARES_COLLECTION } from '../../lib/drop-shares-collection.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const silentLogger = { log() {} };

describe('drop-shares-collection (LIN-3325, real MangoDB tmpdir)', () => {
  let harness;
  before(async () => { harness = createMangoTmpdir('lin-3325-drop-'); await harness.connect(); });
  after(async () => { await harness.close(); });

  async function seed(db) {
    const shares = db.collection(SHARES_COLLECTION);
    await shares.createIndex({ tokenHash: 1 }, { unique: true });
    await shares.insertOne({ _id: 'h1', tokenHash: 'h1', urlKey: 'ws' });
    await shares.insertOne({ _id: 'h2', tokenHash: 'h2', urlKey: 'ws' });
    return shares;
  }

  test('dry run reports existence and record count, and drops nothing', async () => {
    const db = harness.freshDb();
    const shares = await seed(db);

    const report = await dropSharesCollection({ db, dryRun: true, logger: silentLogger });

    assert.equal(report.collection, SHARES_COLLECTION);
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.existed, true);
    assert.equal(report.records, 2);
    assert.equal(report.dropped, false);
    assert.equal(await shares.countDocuments(), 2, 'the dry run left the records in place');
    assert.equal((await db.collection(SHARES_COLLECTION).listIndexes().toArray()).some(i => i.name === 'tokenHash_1'), true, 'the unique index is still there after a dry run');
  });

  test('execute drops the records and the indexes', async () => {
    const db = harness.freshDb();
    await seed(db);

    const report = await dropSharesCollection({ db, dryRun: false, logger: silentLogger });

    assert.equal(report.mode, 'drop');
    assert.equal(report.dropped, true);
    assert.equal(await db.collection(SHARES_COLLECTION).countDocuments(), 0, 'the records are gone');
    const indexes = await db.collection(SHARES_COLLECTION).listIndexes().toArray();
    assert.equal(indexes.some(i => i.name === 'tokenHash_1'), false, 'the share index is gone with the collection');
  });

  test('a repeat run is a safe no-op (idempotent) and never throws', async () => {
    const db = harness.freshDb();
    await seed(db);

    const first = await dropSharesCollection({ db, dryRun: false, logger: silentLogger });
    const second = await dropSharesCollection({ db, dryRun: false, logger: silentLogger });

    assert.equal(first.existed, true);
    assert.equal(first.dropped, true);
    assert.equal(second.existed, false, 'the collection is gone after the first drop');
    assert.equal(second.dropped, true);
    assert.equal(second.skipped, null);
  });

  test('leaves every other collection untouched', async () => {
    const db = harness.freshDb();
    await seed(db);
    const other = db.collection('dispatch-history');
    await other.insertOne({ _id: 'row' });

    await dropSharesCollection({ db, dryRun: false, logger: silentLogger });

    assert.equal(await other.countDocuments(), 1, 'an unrelated collection is not affected');
  });
});
