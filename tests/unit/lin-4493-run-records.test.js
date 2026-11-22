/**
 * LIN-4493 (piece 2): the run lifecycle seam (lib/run-records.js) on the real records store. A run opens when its
 * row is taken and ends on its terminal marker; a custom resume and a wake reopen the run they carry (decision 2c);
 * a wake with no run opens nothing; `[skipped]` ends nothing; the account is the final assistant text; a row closed
 * without a marker ends its run, except on a hand-off; an abort row's `[aborted]` ends its target's run. The dispatch
 * store's seam call is best-effort: a fault in the seam never fails a take, a feedback or a closure.
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

  test('a wake with no run to wake opens nothing; a fresh autopilot kickoff opens its own run (LIN-4531), and its follow-up none', async () => {
    assert.equal(await seam.onTaken(row({ _id: 'row-wake', kind: 'wake', runRecordId: null })), null);
    assert.equal(await seam.onTaken(row({ _id: 'row-wake-2', kind: 'wake', runRecordId: 'row-missing' })), null);
    const kick = await seam.onTaken(row({ _id: 'row-kick', kind: 'autopilot' }));
    assert.equal(kick.id, 'row-kick', 'the kickoff is its own run, so it can file a question');
    // A follow-up of the kickoff is a message into its run: it reopens that run and starts none of its own.
    const note = await seam.onTaken(row({ _id: 'row-kick-note', kind: 'autopilot', followUpTo: 'row-kick', runRecordId: 'row-kick' }));
    assert.equal(note.id, 'row-kick');
    assert.equal(note.fields?.stage, 'autopilot', 'the run keeps the kickoff\'s stage: the follow-up opens no run of its own');
  });

  test('a wake reopens the run it wakes, as a custom resume does, and keeps that run\'s lineage (decision 2c)', async () => {
    await seam.onTaken(row({ _id: 'row-impl', kind: 'implementation', rootItemId: 'row-root' }));
    await store.endRun(URL_KEY, 'row-impl', { state: 'done', at: '2026-11-19T12:01:00.000Z' });
    const woken = await seam.onTaken(row({ _id: 'row-wake', kind: 'wake', runRecordId: 'row-impl', rootItemId: 'row-wake-root' }));
    assert.equal(woken.id, 'row-impl');
    assert.equal(woken.state, 'open');
    assert.equal(woken.lineage, 'row-root', 'a wake\'s own rootItemId is not its run\'s lineage (lib/run-lineage.js)');
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

describe('a row closed without a marker ends its run (the closers)', () => {
  test('a lineage-terminal closure ends the run of a row it closes, as the lineage\'s status', async () => {
    await seam.onTaken(row({ _id: 'row-impl', kind: 'implementation' }));
    const closed = [{ _id: 'row-impl', urlKey: URL_KEY, kind: 'implementation', runRecordId: 'row-impl', feedback: [{ kind: 'assistant-text', message: 'Half done.' }] }];
    assert.equal(await seam.onClosed(closed, { reason: 'lineage-terminal', terminal: 'failed' }), 1);
    const run = await store.run(URL_KEY, 'row-impl');
    assert.equal(run.state, 'failed');
    assert.equal(run.fields.account, 'Half done.');
  });

  test('a ticket-closed closure, or an operator stamp, ends the run as aborted', async () => {
    await seam.onTaken(row({ _id: 'row-a', kind: 'review' }));
    await seam.onTaken(row({ _id: 'row-b', kind: 'review' }));
    await seam.onClosed([{ _id: 'row-a', urlKey: URL_KEY, kind: 'review', runRecordId: 'row-a', feedback: [] }], { reason: 'ticket-closed' });
    await seam.onClosed([{ _id: 'row-b', urlKey: URL_KEY, kind: 'review', runRecordId: 'row-b', feedback: [] }], { reason: 'operator' });
    assert.equal((await store.run(URL_KEY, 'row-a')).state, 'aborted');
    assert.equal((await store.run(URL_KEY, 'row-b')).state, 'aborted');
  });

  test('a handed-on closure ends nothing: the successor that replaced the row carries its run on', async () => {
    await seam.onTaken(row({ _id: 'row-impl', kind: 'implementation' }));
    const closed = [{ _id: 'row-wake', urlKey: URL_KEY, kind: 'wake', runRecordId: 'row-impl', feedback: [] }];
    assert.equal(await seam.onClosed(closed, { reason: 'handed-on' }), 0);
    assert.equal((await store.run(URL_KEY, 'row-impl')).state, 'open');
  });

  test('a row with no run closes with nothing to end', async () => {
    const closed = [{ _id: 'row-kick', urlKey: URL_KEY, kind: 'autopilot', runRecordId: null, feedback: [] }];
    assert.equal(await seam.onClosed(closed, { reason: 'ticket-closed' }), 0);
  });
});

describe('an abort row\'s [aborted] ends the run of the row it targets', () => {
  test('the target run ends aborted, with the target\'s own final text; the abort row starts no run', async () => {
    await seam.onTaken(row({ _id: 'row-impl', kind: 'implementation' }));
    const targets = { 'row-impl': row({ _id: 'row-impl', kind: 'implementation', runRecordId: 'row-impl', feedback: [{ kind: 'assistant-text', message: 'Stopped midway.' }] }) };
    const withReader = createRunRecords({ recordsStore: store, readRow: async (_u, id) => targets[id] ?? null, now: () => new Date('2026-11-19T12:00:00.000Z') });
    const abortRow = { _id: 'abort-1', urlKey: URL_KEY, abort: true, abortTo: 'row-impl', kind: undefined };
    const aborted = { kind: 'aborted', message: '[aborted] stopped by Stop' };
    const ended = await withReader.onFeedback(abortRow, aborted, [aborted]);
    assert.equal(ended.state, 'aborted');
    assert.equal(ended.fields.account, 'Stopped midway.');
    assert.equal(await store.run(URL_KEY, 'abort-1'), null);
  });

  test('without a reader for the target, an abort row ends nothing', async () => {
    const aborted = { kind: 'aborted', message: '[aborted] stopped' };
    assert.equal(await seam.onFeedback({ _id: 'abort-2', urlKey: URL_KEY, abort: true, abortTo: 'row-impl' }, aborted, [aborted]), null);
  });
});

describe('the dispatch store\'s seam call is best-effort', () => {
  test('a fault in the seam is logged and never thrown to the take or the feedback', async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const fake = { runRecords: { onClosed: async () => { throw new Error('records down'); } } };
      await DispatchQueueStore.prototype._runRecordsSeam.call(fake, 'onClosed', [row({})], { reason: 'ticket-closed' });
      await DispatchQueueStore.prototype._runRecordsSeam.call({}, 'onTaken', row({}));
    } finally {
      console.error = original;
    }
    assert.ok(errors.some((line) => /Run records \(onClosed\) failed/.test(line) && /records down/.test(line)));
  });
});
