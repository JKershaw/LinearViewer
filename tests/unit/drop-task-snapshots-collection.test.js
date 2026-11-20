/**
 * Unit tests for lib/drop-task-snapshots-collection.js (LIN-4502), modelled on
 * tests/unit/drop-shares-collection.test.js (LIN-3325).
 *
 * The one-off cleanup that drops the retired `task-snapshots` collection and its
 * indexes. No test runs it against production; the operator does, after deploy. Runs on a REAL MangoDB tmpdir (tests/fixtures/mango-tmpdir.js) so the
 * `drop()` and the existence probe are the real engine's, not a double's.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/drop-task-snapshots-collection.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { dropTaskSnapshotsCollection, TASK_SNAPSHOTS_COLLECTION } from '../../lib/drop-task-snapshots-collection.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const silentLogger = { log() {} };

describe('drop-task-snapshots-collection (LIN-4502, real MangoDB tmpdir)', () => {
  let harness;
  before(async () => { harness = createMangoTmpdir('lin-4502-drop-'); await harness.connect(); });
  after(async () => { await harness.close(); });

  async function seed(db) {
    const snapshots = db.collection(TASK_SNAPSHOTS_COLLECTION);
    await snapshots.createIndex({ urlKey: 1, taskIdentifier: 1 });
    await snapshots.insertOne({ _id: 's1', urlKey: 'ws', taskIdentifier: 'LIN-1' });
    await snapshots.insertOne({ _id: 's2', urlKey: 'ws', taskIdentifier: 'LIN-1' });
    return snapshots;
  }

  test('dry run reports existence and record count, and drops nothing', async () => {
    const db = harness.freshDb();
    const snapshots = await seed(db);

    const report = await dropTaskSnapshotsCollection({ db, dryRun: true, logger: silentLogger });

    assert.equal(report.collection, TASK_SNAPSHOTS_COLLECTION);
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.existed, true);
    assert.equal(report.records, 2);
    assert.equal(report.dropped, false);
    assert.equal(await snapshots.countDocuments(), 2, 'the dry run left the records in place');
    assert.equal((await db.collection(TASK_SNAPSHOTS_COLLECTION).listIndexes().toArray()).some(i => i.name === 'urlKey_1_taskIdentifier_1'), true, 'the index is still there after a dry run');
  });

  test('execute drops the records and the indexes', async () => {
    const db = harness.freshDb();
    await seed(db);

    const report = await dropTaskSnapshotsCollection({ db, dryRun: false, logger: silentLogger });

    assert.equal(report.mode, 'drop');
    assert.equal(report.dropped, true);
    assert.equal(await db.collection(TASK_SNAPSHOTS_COLLECTION).countDocuments(), 0, 'the records are gone');
    const indexes = await db.collection(TASK_SNAPSHOTS_COLLECTION).listIndexes().toArray();
    assert.equal(indexes.some(i => i.name === 'urlKey_1_taskIdentifier_1'), false, 'the snapshot index is gone with the collection');
  });

  test('a repeat run is a safe no-op (idempotent) and never throws', async () => {
    const db = harness.freshDb();
    await seed(db);

    const first = await dropTaskSnapshotsCollection({ db, dryRun: false, logger: silentLogger });
    const second = await dropTaskSnapshotsCollection({ db, dryRun: false, logger: silentLogger });

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

    await dropTaskSnapshotsCollection({ db, dryRun: false, logger: silentLogger });

    assert.equal(await other.countDocuments(), 1, 'an unrelated collection is not affected');
  });
});
