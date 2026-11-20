/**
 * LIN-4496 (piece 5 of LIN-4491): the records readings reader (scripts/records-readings.mjs) on a real MangoDB store. The
 * reader reads the records, the records query log and the dispatch queue and history, and prints the readings with their
 * window and n. Seeds are written with the store's own writes and with the dispatch collections' documents; the expected
 * values are worked out by hand from the seeds.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { readFromDb, recordsOfSnapshots, readingsOf } from '../../scripts/records-readings.mjs';
import { STATUS } from '../../scripts/stability-measures-core.mjs';

const URL_KEY = 'lin-4496-readings';
const harness = createMangoTmpdir('lin-4496-readings-');
const BASE = Date.UTC(2026, 10, 22, 12, 0);
const iso = (minutes) => new Date(BASE + minutes * 60000).toISOString();
const ASOF = iso(0);
const shape = (kind, fields = {}, extra = {}) => ({ kind, state: 'open', fields, links: {}, ...extra });

let db;
let store;

before(() => harness.connect());
after(() => harness.close());

async function seed() {
  db = harness.freshDb();
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  // Two tasks: LIN-9 (task-1) under LIN-8 (task-0). The finding under LIN-9 is addressed to the implementation stage.
  const parent = await store.add(URL_KEY, shape('task', { ref: 'LIN-8', asked: 'Parent.' }), { by: 'person', at: iso(-600) });
  const task = await store.add(URL_KEY, shape('task', { ref: 'LIN-9', asked: 'Child.' }, { in: parent.id }), { by: 'person', at: iso(-600) });
  // Opened 60 minutes before asOf, addressed to the implementation stage: a held producer's stage.
  const toStage = await store.add(URL_KEY, shape('finding', { says: 'For implementation.', how: 'read it' }, { to: 'implementation', in: task.id }), { by: 'review', at: iso(-60) });
  // Opened 30 minutes before asOf, addressed to the project: an open hand-off that no held run answers to.
  await store.add(URL_KEY, shape('finding', { says: 'For the project.', how: 'read it' }, { to: 'project', in: task.id }), { by: 'review', at: iso(-30) });
  // Runs: one open for 30 hours (stale), one open for 2 hours (not stale).
  await store.openRun(URL_KEY, { id: 'run-old', stage: 'implementation', lineage: 'lineage-old', at: iso(-30 * 60) });
  await store.openRun(URL_KEY, { id: 'run-new', stage: 'implementation', lineage: 'lineage-new', at: iso(-120) });
  // The implementation stage reads the stage-addressed finding 30 minutes after it was opened; the reader itself reads it
  // 5 minutes after it was opened, and that read must not count.
  await store.logQuery(URL_KEY, { by: 'implementation', cmd: 'brief', taskId: task.id }, new Date(BASE - 30 * 60000));
  await store.logQuery(URL_KEY, { by: 'records-readings', cmd: 'brief', taskId: task.id }, new Date(BASE - 55 * 60000));
  // Dispatch (the real shape: a row names its stage in `kind`, the hook stamps the claim on the producer): build-7 is
  // claimed and its leftover is queued, so it is held; build-8 is unclaimed, so its queued leftover holds nothing;
  // leftover-3 was cancelled before it ran.
  await db.collection('dispatch-history').insertMany([
    { _id: 'build-7', urlKey: URL_KEY, kind: 'implementation', issueIdentifier: 'LIN-9', status: 'taken', heldWakeClaimedAt: iso(-200) },
    { _id: 'build-8', urlKey: URL_KEY, kind: 'review', issueIdentifier: 'LIN-9', status: 'taken', heldWakeClaimedAt: null },
    // build-9 was claimed and its leftover ran to completion: the row stays `taken` and its end is in lineageStatus, so
    // it holds nothing (LIN-4496 finding 339d6a7f). The projection must carry lineageStatus or this reads as held.
    { _id: 'build-9', urlKey: URL_KEY, kind: 'implementation', issueIdentifier: 'LIN-9', status: 'taken', heldWakeClaimedAt: iso(-100) },
    { _id: 'leftover-4', urlKey: URL_KEY, kind: 'leftover', status: 'taken', lineageStatus: 'done', heldWakeFor: 'build-9' }
  ]);
  await db.collection('dispatch-queue').insertMany([
    { _id: 'leftover-1', urlKey: URL_KEY, kind: 'leftover', status: 'queued', heldWakeFor: 'build-7' },
    { _id: 'leftover-2', urlKey: URL_KEY, kind: 'leftover', status: 'queued', heldWakeFor: 'build-8' },
    { _id: 'leftover-3', urlKey: URL_KEY, kind: 'leftover', status: 'cancelled', heldWakeFor: 'build-7' }
  ]);
  return { toStageId: toStage.id };
}

describe('the records readings reader (LIN-4496): read-only, with each reading\'s window and n', () => {
  test('the readings come out of the seeds by hand: records rows, the held run with its read, and the stale open runs', async () => {
    await seed();
    const out = await readFromDb(db, URL_KEY, { asOf: ASOF });
    const byKey = Object.fromEntries(out.rows.map((r) => [r.key, r]));

    // Open hand-offs: the stage-addressed finding and the project finding.
    assert.deepEqual(byKey['records.openToProject'].value, { count: 1, of: 2 });
    assert.deepEqual(byKey['records.openToStage'].value, { count: 1, of: 2 });
    assert.equal(byKey['records.sitTime'].status, STATUS.MEASURED);

    // Held: leftover-1 only (build-7 is claimed; build-8 is not, so leftover-2 holds nothing; leftover-3 was cancelled;
    // leftover-4 ran to `done` on the claimed build-9, so it is not held).
    const held = byKey['records.heldRuns'];
    assert.equal(held.status, STATUS.MEASURED);
    assert.equal(held.value.held, 1);
    assert.equal(held.value.addressed, 1, 'only the stage-addressed finding answers to the held producer');
    assert.equal(held.value.read, 1, 'the implementation stage read it; the reader\'s own read does not count');
    assert.equal(held.value.medianSitHours, 0.5, 'opened 60 minutes before asOf, first read 30 minutes before: it sat 30 minutes');
    assert.deepEqual(held.value.window, { asOf: ASOF });

    // Stale open runs: run-old is 30 hours old; run-new is 2 hours old.
    assert.deepEqual(out.staleOpenRuns, { count: 1, of: 2, runs: ['run-old'], asOf: ASOF, olderThanHours: 24 });
    assert.deepEqual(out.n, { records: 6, queryLog: 2, dispatchRows: 7 }, 'n: records (2 tasks, 2 findings, 2 runs), query-log rows, dispatch rows (queue and history)');
  });

  test('the reader writes nothing: the query log is the same length after a read as before it', async () => {
    await seed();
    const logBefore = await db.collection(QUERY_LOG_COLLECTION).countDocuments({ urlKey: URL_KEY });
    await readFromDb(db, URL_KEY, { asOf: ASOF });
    await readFromDb(db, URL_KEY, { asOf: ASOF });
    assert.equal(await db.collection(QUERY_LOG_COLLECTION).countDocuments({ urlKey: URL_KEY }), logBefore);
  });

  test('the reader leaves out its own reads: with it counted, the held run would sit 5 minutes, not 30', async () => {
    await seed();
    const counted = await readFromDb(db, URL_KEY, { asOf: ASOF, measuringReader: 'nobody' });
    const excluded = await readFromDb(db, URL_KEY, { asOf: ASOF });
    const sit = (o) => o.rows.find((r) => r.key === 'records.heldRuns').value.medianSitHours;
    assert.equal(sit(excluded), 0.5);
    assert.equal(sit(counted), 0.08, 'with the measuring reader\'s read counted, the first read is 5 minutes after opening');
  });

  test('a record whose current version is older than the stale window is counted only when open: an ended run is not stale', async () => {
    await seed();
    await store.endRun(URL_KEY, 'run-old', { state: 'aborted', at: iso(-10) });
    const out = await readFromDb(db, URL_KEY, { asOf: ASOF });
    assert.deepEqual(out.staleOpenRuns.runs, [], 'an ended run is not an open one');
    assert.equal(out.staleOpenRuns.of, 1);
  });
});

describe('the pure reader: its inputs are data', () => {
  test('recordsOfSnapshots: the current version and the first version\'s time, per record; a task\'s ref', () => {
    const snaps = [
      { id: 'task-1', v: 1, op: 'add', kind: 'task', state: 'open', at: iso(-100), fields: { ref: 'LIN-1' } },
      { id: 'task-1', v: 2, op: 'revise', kind: 'task', state: 'open', at: iso(-50), fields: { ref: 'LIN-1' } },
      { id: 'finding-1', v: 1, op: 'add', kind: 'finding', state: 'open', at: iso(-10), to: 'project', fields: {} }
    ];
    const { records } = recordsOfSnapshots(snaps, ASOF);
    const byId = Object.fromEntries(records.map((r) => [r.id, r]));
    assert.equal(byId['task-1'].openedAt, iso(-100), 'opened at the first version');
    assert.equal(byId['task-1'].ref, 'LIN-1');
    assert.equal(byId['finding-1'].to, 'project');
  });

  test('readingsOf with a missing source is not measured for the held run, and still reads the records', () => {
    const out = readingsOf({ snapshots: [], queryLog: [], dispatchRows: null, asOf: ASOF });
    assert.equal(out.rows.find((r) => r.key === 'records.heldRuns').status, STATUS.NOT_MEASURED);
    assert.equal(out.staleOpenRuns.count, 0);
  });
});
