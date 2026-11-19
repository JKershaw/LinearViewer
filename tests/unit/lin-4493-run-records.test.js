/**
 * LIN-4493 (piece 2): the run lifecycle seam (lib/run-records.js) on the real records store. A run opens when its
 * row is taken and ends on its terminal marker; a custom resume reopens the run it carries (decision 2c); a wake
 * opens nothing; `[skipped]` ends nothing; the account is the final assistant text. The dispatch store's seam call
 * is best-effort: a fault in the seam never fails a take or a feedback.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRunRecords } from '../../lib/run-records.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const URL_KEY = 'run-records-workspace';
const harness = createMangoTmpdir('lin-4493-runs-');
let db;
let store;
let seam;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  seam = createRunRecords({ recordsStore: store, now: () => new Date('2026-11-19T12:00:00.000Z') });
});

const row = (over) => ({ _id: 'row-1', urlKey: URL_KEY, kind: 'implementation', rootItemId: null, runRecordId: null, ...over });
const entry = (message, kind = 'agent') => ({ kind: kind === 'agent' ? 'system' : kind, message });

describe('the run opens when its row is taken', () => {
  test('a stage row opens its own run, under its own id and lineage', async () => {
    const run = await seam.onTaken(row({ _id: 'row-impl', kind: 'implementation' }));
    assert.equal(run.id, 'row-impl');
    assert.equal(run.by, 'implementation');
    assert.equal(run.state, 'open');
    assert.equal(run.lineage, 'row-impl', 'a root row is its own lineage');
  });

  test('a leftover row in a build\'s lineage opens its own run in that lineage', async () => {
    const run = await seam.onTaken(row({ _id: 'row-left', kind: 'leftover', rootItemId: 'row-impl' }));
    assert.equal(run.by, 'leftover');
    assert.equal(run.lineage, 'row-impl');
  });

  test('a wake opens nothing; an autopilot kickoff starts no run', async () => {
    assert.equal(await seam.onTaken(row({ _id: 'row-wake', kind: 'wake', runRecordId: 'row-impl' })), null);
    assert.equal(await seam.onTaken(row({ _id: 'row-kick', kind: 'autopilot' })), null);
  });

  test('a kind-less custom resume reopens the ended run it carries, as a new version', async () => {
    await seam.onTaken(row({ _id: 'row-impl', kind: 'implementation' }));
    await store.endRun(URL_KEY, 'row-impl', { state: 'done', at: '2026-11-19T12:01:00.000Z' });
    const reopened = await seam.onTaken(row({ _id: 'row-resume', kind: null, runRecordId: 'row-impl' }));
    assert.equal(reopened.id, 'row-impl');
    assert.equal(reopened.state, 'open');
    assert.equal(reopened.by, 'implementation', 'it keeps the stage of the run it resumes');
    assert.equal(reopened.v, 3);
  });
});

describe('the run ends on its terminal marker', () => {
  test('[done] ends it with the final assistant text, and that text is kept', async () => {
    await seam.onTaken(row({ _id: 'row-impl', kind: 'implementation' }));
    const feedback = [entry('started', 'system'), { kind: 'assistant-text', message: 'Looked at the footer.' }, { kind: 'assistant-text', message: 'Built it.' }];
    const done = { kind: 'done', message: '[done] Task completed' };
    const run = await seam.onFeedback(row({ _id: 'row-impl', kind: 'implementation' }), done, [...feedback, done]);
    assert.equal(run.state, 'done');
    assert.equal(run.fields.account, 'Looked at the footer.\nBuilt it.');
  });

  test('[failed] and [aborted] end it as those; [skipped] ends nothing; a plain message ends nothing', async () => {
    await seam.onTaken(row({ _id: 'row-a', kind: 'review' }));
    await seam.onTaken(row({ _id: 'row-b', kind: 'review' }));
    await seam.onTaken(row({ _id: 'row-c', kind: 'review' }));
    const failed = { kind: 'failed', message: '[failed] remote never connected' };
    assert.equal((await seam.onFeedback(row({ _id: 'row-a', kind: 'review' }), failed, [failed])).state, 'failed');
    const aborted = { kind: 'aborted', message: '[aborted] stopped' };
    assert.equal((await seam.onFeedback(row({ _id: 'row-b', kind: 'review' }), aborted, [aborted])).state, 'aborted');
    const skipped = { kind: 'skipped', message: '[skipped] human-continued session' };
    assert.equal(await seam.onFeedback(row({ _id: 'row-c', kind: 'review' }), skipped, [skipped]), null);
    assert.equal((await store.run(URL_KEY, 'row-c')).state, 'open');
    const plain = { kind: 'agent', message: 'still working' };
    assert.equal(await seam.onFeedback(row({ _id: 'row-c', kind: 'review' }), plain, [plain]), null);
  });

  test('a row with no run ends nothing', async () => {
    const done = { kind: 'done', message: '[done] finished' };
    assert.equal(await seam.onFeedback(row({ _id: 'row-kick', kind: 'autopilot' }), done, [done]), null);
  });
});

describe('the dispatch store\'s seam call is best-effort', () => {
  test('a fault in the seam is logged and never thrown to the take or the feedback', async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const fake = { runRecords: { onTaken: async () => { throw new Error('records down'); } } };
      await DispatchQueueStore.prototype._runRecordsSeam.call(fake, 'onTaken', row({}));
      await DispatchQueueStore.prototype._runRecordsSeam.call({}, 'onTaken', row({}));
    } finally {
      console.error = original;
    }
    assert.ok(errors.some((line) => /Run records \(onTaken\) failed/.test(line) && /records down/.test(line)));
  });
});
