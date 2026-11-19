/**
 * LIN-4493 (piece 2): the run lifecycle through the REAL dispatch store hooks, on a MangoDB engine. Each test drives
 * DispatchQueueStore's own `takeItem`, `addFeedback`, `closeLineageRows`, `closeIssueRows` or `stampBookkeeping`, with
 * the run seam (lib/run-records.js) wired exactly as server.js wires it. The seam-level tests in
 * lin-4493-run-records.test.js call the seam directly; these prove the store calls it on every path that should end
 * or open a run. Removing any one `_runRecordsSeam` call turns one of these red (the mutation check, recorded in the PR).
 *
 * Witnesses: a take opens the run; a terminal feedback ends it with its final text; an abort row's [aborted] ends its
 * target's run and starts none of its own; a wake taken into an ended run reopens it, and its terminal ends it again;
 * a row closed by the lineage terminal, by a ticket closing, or by an operator's stamp ends its run; a hand-off
 * closure ends nothing.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRunRecords } from '../../lib/run-records.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const URL_KEY = 'run-lifecycle-workspace';
const DISPATCHED = new Date('2026-11-19T10:00:00.000Z');
const LATER = new Date('2026-11-19T11:00:00.000Z');
const harness = createMangoTmpdir('lin-4493-lifecycle-');
let db;
let records;
let dispatch;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  dispatch = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
  dispatch.runRecords = createRunRecords({ recordsStore: records, readRow: (urlKey, id) => dispatch._rowForRunRecords(urlKey, id) });
});

/** A queued dispatch row as the factory writes one (only the fields the take, feedback and closers read). */
function queued(id, extra = {}) {
  return {
    _id: id,
    urlKey: URL_KEY,
    prompt: 'work',
    promptName: null,
    kind: 'implementation',
    target: 'cli',
    issueIdentifier: 'LIN-1',
    dispatchedAt: DISPATCHED,
    dispatchedBy: null,
    followUpTo: null,
    abort: false,
    cascade: false,
    sessionId: null,
    rootItemId: id,
    runRecordId: id,
    feedback: [],
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    ...extra
  };
}

async function enqueue(row) {
  await dispatch.collection.insertOne(row);
}

const runOf = (id) => records.run(URL_KEY, id);
const message = (text, kind) => ({ message: text, ...(kind ? { kind } : {}) });

describe('a take and a feedback through the real dispatch store', () => {
  test('taking a stage row opens its run, under its own id and lineage', async () => {
    await enqueue(queued('row-impl'));
    await dispatch.takeItem('row-impl', URL_KEY);
    const run = await runOf('row-impl');
    assert.equal(run.state, 'open');
    assert.equal(run.by, 'implementation');
    assert.equal(run.lineage, 'row-impl');
  });

  test('a terminal marker on the row ends its run with the final assistant text', async () => {
    await enqueue(queued('row-impl'));
    await dispatch.takeItem('row-impl', URL_KEY);
    await dispatch.addFeedback('row-impl', URL_KEY, message('Looked at the footer.', 'assistant-text'), null, null);
    await dispatch.addFeedback('row-impl', URL_KEY, message('Built it.', 'assistant-text'), null, null);
    await dispatch.addFeedback('row-impl', URL_KEY, message('[done] Task completed'), null, null);
    const run = await runOf('row-impl');
    assert.equal(run.state, 'done');
    assert.equal(run.fields.account, 'Looked at the footer.\nBuilt it.');
  });

  test('[skipped] on the row ends nothing: the run stays open', async () => {
    await enqueue(queued('row-impl'));
    await dispatch.takeItem('row-impl', URL_KEY);
    await dispatch.addFeedback('row-impl', URL_KEY, message('[skipped] human-continued session'), null, null);
    assert.equal((await runOf('row-impl')).state, 'open');
  });

  test('an abort row\'s [aborted] ends its target\'s run, and the abort row starts no run of its own', async () => {
    await enqueue(queued('row-impl'));
    await dispatch.takeItem('row-impl', URL_KEY);
    await dispatch.addFeedback('row-impl', URL_KEY, message('Stopped midway.', 'assistant-text'), null, null);
    await enqueue(queued('abort-1', { abort: true, abortTo: 'row-impl', kind: undefined, runRecordId: undefined, rootItemId: undefined }));
    await dispatch.takeItem('abort-1', URL_KEY);
    await dispatch.addFeedback('abort-1', URL_KEY, message('[aborted] stopped by Stop'), null, null);
    const target = await runOf('row-impl');
    assert.equal(target.state, 'aborted');
    assert.equal(target.fields.account, 'Stopped midway.');
    assert.equal(await runOf('abort-1'), null);
  });

  test('a wake taken into an ended run reopens it, and the wake\'s own terminal ends it again (decision 2c)', async () => {
    await enqueue(queued('row-impl'));
    await dispatch.takeItem('row-impl', URL_KEY);
    await dispatch.addFeedback('row-impl', URL_KEY, message('[done] Task completed'), null, null);
    assert.equal((await runOf('row-impl')).state, 'done');
    await enqueue(queued('row-wake', { kind: 'wake', runRecordId: 'row-impl', rootItemId: 'row-wake-root', dispatchedAt: LATER }));
    await dispatch.takeItem('row-wake', URL_KEY);
    const reopened = await runOf('row-impl');
    assert.equal(reopened.state, 'open');
    assert.equal(reopened.lineage, 'row-impl', 'a wake keeps its run\'s lineage, not its own rootItemId');
    await dispatch.addFeedback('row-wake', URL_KEY, message('[failed] could not reach the remote'), null, null);
    assert.equal((await runOf('row-impl')).state, 'failed');
  });
});

describe('a row that stops being live without a marker ends its run (the closers)', () => {
  test('a lineage-terminal closure ends the run of a stage row it closes, as the lineage\'s status', async () => {
    await enqueue(queued('row-impl'));
    await dispatch.takeItem('row-impl', URL_KEY);
    const closed = await dispatch.closeLineageRows(URL_KEY, 'row-impl', {
      beforeDispatchedAt: LATER, exceptId: 'row-elsewhere', reason: 'lineage-terminal', terminal: 'done', by: 'addFeedback'
    });
    assert.deepEqual(closed.closedIds, ['row-impl']);
    assert.equal((await runOf('row-impl')).state, 'done');
  });

  test('a [failed] on one row of a lineage, through the real feedback, ends the run of a sibling closed without a marker as failed', async () => {
    await enqueue(queued('row-impl'));
    await dispatch.takeItem('row-impl', URL_KEY);
    await enqueue(queued('row-review', { kind: 'review', runRecordId: 'row-review', rootItemId: 'row-impl' }));
    await dispatch.takeItem('row-review', URL_KEY);
    await dispatch.addFeedback('row-review', URL_KEY, message('[failed] the check could not run'), null, null);
    assert.equal((await runOf('row-review')).state, 'failed');
    assert.equal((await runOf('row-impl')).state, 'failed', 'the sibling had no marker of its own; its lineage ended failed');
  });

  test('a ticket closing ends the run of each row it closes, as aborted', async () => {
    await enqueue(queued('row-impl'));
    await dispatch.takeItem('row-impl', URL_KEY);
    const closed = await dispatch.closeIssueRows(URL_KEY, 'LIN-1', { ids: ['row-impl'], quietSince: new Date(0), reason: 'ticket-closed' });
    assert.deepEqual(closed.closedIds, ['row-impl']);
    assert.equal((await runOf('row-impl')).state, 'aborted');
  });

  test('an operator\'s bookkeeping stamp ends the run, as aborted', async () => {
    await enqueue(queued('row-impl'));
    await dispatch.takeItem('row-impl', URL_KEY);
    const stamped = await dispatch.stampBookkeeping(URL_KEY, 'row-impl', { by: 'operator', reason: 'stale' });
    assert.equal(stamped.ok, true);
    assert.equal((await runOf('row-impl')).state, 'aborted');
  });

  test('a hand-off closure of a woken row ends nothing: the successor carries the run on', async () => {
    await enqueue(queued('row-impl'));
    await dispatch.takeItem('row-impl', URL_KEY);
    await enqueue(queued('row-wake', { kind: 'wake', runRecordId: 'row-impl', rootItemId: 'row-wake-root', dispatchedAt: DISPATCHED }));
    await dispatch.takeItem('row-wake', URL_KEY);
    const closed = await dispatch.closeLineageRows(URL_KEY, 'row-wake-root', {
      beforeDispatchedAt: LATER, exceptId: 'row-successor', kinds: ['wake'], reason: 'handed-on', by: 'addFeedback'
    });
    assert.deepEqual(closed.closedIds, ['row-wake']);
    assert.equal((await runOf('row-impl')).state, 'open');
  });
});
