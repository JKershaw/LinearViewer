/**
 * Unit tests for lib/drop-brief-recap-caches.js (LIN-4537), modelled on
 * tests/unit/drop-task-snapshots-collection.test.js (LIN-4502).
 *
 * The one-off cleanup that drops the two retired derived caches, `brief-cache` and `recap-cache`. No test runs it
 * against production; the operator does, after deploy. Runs on a REAL MangoDB tmpdir (tests/fixtures/mango-tmpdir.js)
 * so the `drop()` and the existence probe are the real engine's, not a double's.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/drop-brief-recap-caches.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import {
  dropBriefRecapCaches,
  BRIEF_CACHE_COLLECTION,
  RECAP_CACHE_COLLECTION,
  RETIRED_CACHE_COLLECTIONS,
} from '../../lib/drop-brief-recap-caches.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const silentLogger = { log() {} };

describe('drop-brief-recap-caches (LIN-4537, real MangoDB tmpdir)', () => {
  let harness;
  before(async () => { harness = createMangoTmpdir('lin-4537-drop-'); await harness.connect(); });
  after(async () => { await harness.close(); });

  // The shape the retired stores wrote: `_id` `${urlKey}:${issueId}`, an input hash and the model's text.
  async function seed(db) {
    await db.collection(BRIEF_CACHE_COLLECTION).insertOne({ _id: 'ws:i1', workspaceId: 'ws', issueId: 'i1', inputHash: 'h', brief: '## Current\nx', model: 'm' });
    await db.collection(BRIEF_CACHE_COLLECTION).insertOne({ _id: 'ws:i2', workspaceId: 'ws', issueId: 'i2', inputHash: 'h', brief: '## Current\ny', model: 'm' });
    await db.collection(RECAP_CACHE_COLLECTION).insertOne({ _id: 'ws:i1', workspaceId: 'ws', issueId: 'i1', inputHash: 'h', recap: { done: [], pending: [], deviations: [] }, model: 'm' });
  }

  test('names exactly the two retired caches', () => {
    assert.deepEqual([...RETIRED_CACHE_COLLECTIONS], ['brief-cache', 'recap-cache']);
  });

  test('dry run reports each collection and its record count, and drops nothing', async () => {
    const db = harness.freshDb();
    await seed(db);

    const report = await dropBriefRecapCaches({ db, dryRun: true, logger: silentLogger });

    assert.equal(report.mode, 'dry-run');
    assert.deepEqual(report.collections.map(c => [c.collection, c.existed, c.records, c.dropped]), [
      ['brief-cache', true, 2, false],
      ['recap-cache', true, 1, false],
    ]);
    assert.equal(await db.collection(BRIEF_CACHE_COLLECTION).countDocuments(), 2, 'the dry run left the briefs in place');
    assert.equal(await db.collection(RECAP_CACHE_COLLECTION).countDocuments(), 1, 'the dry run left the recaps in place');
  });

  test('execute drops both collections', async () => {
    const db = harness.freshDb();
    await seed(db);

    const report = await dropBriefRecapCaches({ db, dryRun: false, logger: silentLogger });

    assert.equal(report.mode, 'drop');
    assert.deepEqual(report.collections.map(c => [c.collection, c.dropped, c.skipped]), [
      ['brief-cache', true, null],
      ['recap-cache', true, null],
    ]);
    assert.equal(await db.collection(BRIEF_CACHE_COLLECTION).countDocuments(), 0, 'the briefs are gone');
    assert.equal(await db.collection(RECAP_CACHE_COLLECTION).countDocuments(), 0, 'the recaps are gone');
  });

  test('a repeat run is a safe no-op (idempotent) and never throws', async () => {
    const db = harness.freshDb();
    await seed(db);

    const first = await dropBriefRecapCaches({ db, dryRun: false, logger: silentLogger });
    const second = await dropBriefRecapCaches({ db, dryRun: false, logger: silentLogger });

    assert.deepEqual(first.collections.map(c => c.existed), [true, true]);
    assert.deepEqual(second.collections.map(c => c.existed), [false, false], 'both are gone after the first drop');
    assert.deepEqual(second.collections.map(c => c.skipped), [null, null]);
  });

  test('a dry run against absent collections says so', async () => {
    const db = harness.freshDb();

    const report = await dropBriefRecapCaches({ db, dryRun: true, logger: silentLogger });

    assert.deepEqual(report.collections.map(c => [c.existed, c.skipped]), [[false, 'absent'], [false, 'absent']]);
  });

  test('one collection failing does not stop the other, and the error text is never reported', async () => {
    const db = harness.freshDb();
    await seed(db);
    const real = db.collection.bind(db);
    const failing = Object.create(db);
    failing.listCollections = () => db.listCollections();
    failing.collection = (name) => (name === BRIEF_CACHE_COLLECTION
      ? { countDocuments: async () => 2, drop: async () => { throw new Error('mongodb://secret@host'); } }
      : real(name));
    const lines = [];

    const report = await dropBriefRecapCaches({ db: failing, dryRun: false, logger: { log: (l) => lines.push(l) } });

    assert.deepEqual(report.collections.map(c => [c.collection, c.dropped, c.skipped]), [
      ['brief-cache', false, 'unexpected-error'],
      ['recap-cache', true, null],
    ]);
    assert.equal(await db.collection(RECAP_CACHE_COLLECTION).countDocuments(), 0, 'the recap cache still dropped');
    assert.ok(!lines.join('\n').includes('secret'), 'the error message never reaches the log');
  });

  test('leaves every other collection untouched', async () => {
    const db = harness.freshDb();
    await seed(db);
    const other = db.collection('run-summary-cache');
    await other.insertOne({ _id: 'ws:loop' });

    await dropBriefRecapCaches({ db, dryRun: false, logger: silentLogger });

    assert.equal(await other.countDocuments(), 1, 'an unrelated cache is not affected');
  });
});
