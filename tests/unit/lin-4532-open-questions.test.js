/**
 * LIN-4532 (LIN-4529 P2b): the one reader of open questions for a person (lib/open-questions.js), over the real records store and the
 * real dispatch store. The rulings feed, the count, the badge and the cards all call it, so these rows are what every surface shows.
 *
 * What is pinned, and what it fails without the change:
 *   - a question addressed to the person, with its run parked, is listed with its question, options, recommendation and "if you
 *     don't answer", and is interactive;
 *   - a question addressed to someone else is not listed for this person;
 *   - a question that has ended (answered or withdrawn) is not listed;
 *   - a question whose run was stopped is listed as stopped, and is still answerable (the answer says it was not resumed);
 *   - a question with no asking run is listed as gone, and is answerable.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { openQuestionsFor } from '../../lib/open-questions.js';

const URL_KEY = 'lin-4532-open';
const OWNER = 'acct-owner';
const OTHER = 'acct-other';
const DAY = 86400000;
const PEOPLE = [{ accountId: OWNER, name: 'Owner' }, { accountId: OTHER, name: 'Other' }];
const harness = createMangoTmpdir('lin-4532-open-');
let records;
let dispatch;
let writes;

before(() => harness.connect());
after(() => harness.close());

beforeEach(async () => {
  const db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  dispatch = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
  writes = createRecordWrites({ recordsStore: records, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => PEOPLE });
});

const blocked = (t = new Date()) => [{ message: '[blocked] waiting on the person', timestamp: t.toISOString() }];

async function askingRun(id, { feedback = [], status = 'taken' } = {}) {
  await dispatch.collection.insertOne({
    _id: id, urlKey: URL_KEY, prompt: 'work', kind: 'implementation', promptName: null, target: 'cli',
    issueIdentifier: 'LIN-9', dispatchedAt: new Date(Date.now() - DAY), dispatchedBy: OWNER, followUpTo: null,
    abort: false, cascade: false, sessionId: null, rootItemId: id, runRecordId: id, status, feedback,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  });
  return id;
}

async function askQuestion({ run = null, to = `person:${OWNER}`, asks = 'Which way?' } = {}) {
  const snap = await writes.add({
    urlKey: URL_KEY, kind: 'question', by: 'implementation', run,
    input: { asks, options: ['left', 'right'], recommended: 'left', 'if-unanswered': 'pick left', to },
  });
  assert.ok(snap.record, `question refused: ${JSON.stringify(snap.problems)}`);
  return snap.record.id;
}

const listed = (accountId = OWNER) => openQuestionsFor({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId });

describe('openQuestionsFor', () => {
  test('a question to the person, its run parked, is listed with what the card shows, and is interactive', async () => {
    const run = await askingRun('run-open-1', { feedback: blocked() });
    const q = await askQuestion({ run, asks: 'Ship the flag now?' });
    const rows = await listed();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.questionId, q);
    assert.equal(row.asks, 'Ship the flag now?');
    assert.deepEqual(row.options, ['left', 'right']);
    assert.equal(row.recommended, 'left');
    assert.equal(row.ifUnanswered, 'pick left');
    assert.equal(row.runId, run, 'the asking run is the question\'s first version\'s run');
    assert.equal(row.interactive, true);
    assert.equal(row.state, 'resumable');
  });

  test('a question addressed to someone else is not listed for this person', async () => {
    const run = await askingRun('run-open-2', { feedback: blocked() });
    await askQuestion({ run, to: `person:${OTHER}` });
    assert.deepEqual(await listed(OWNER), []);
    assert.equal((await listed(OTHER)).length, 1);
  });

  test('a question that has ended is not listed', async () => {
    const run = await askingRun('run-open-3', { feedback: blocked() });
    const q = await askQuestion({ run });
    await writes.end({ urlKey: URL_KEY, id: q, input: { state: 'withdrawn', reason: 'dismissed' }, by: `person:${OWNER}`, run: null });
    assert.deepEqual(await listed(), []);
  });

  test('a question whose run was stopped is listed as stopped, and stays answerable', async () => {
    const run = await askingRun('run-open-4', { feedback: blocked() });
    await dispatch.collection.insertOne({ _id: 'abort-open-4', urlKey: URL_KEY, abort: true, abortTo: run, feedback: [{ message: '[aborted] stopped', timestamp: new Date().toISOString() }], status: 'done', feedbackAt: new Date(), expiresAt: new Date('2099-01-01T00:00:00.000Z') });
    await askQuestion({ run });
    const [row] = await listed();
    assert.equal(row.state, 'stopped');
    assert.equal(row.reason, 'stopped');
    assert.equal(row.interactive, true);
  });

  test('a question with no asking run is listed as gone, and stays answerable', async () => {
    await askQuestion({ run: null });
    const [row] = await listed();
    assert.equal(row.runId, null);
    assert.equal(row.state, 'gone');
    assert.equal(row.interactive, true);
  });

  test('no account reads nothing', async () => {
    await askQuestion({ run: null });
    assert.deepEqual(await openQuestionsFor({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: null }), []);
  });

  test('each question\'s versions are read once, not twice (finding-de388107)', async () => {
    const run = await askingRun('run-open-reads', { feedback: blocked() });
    const ids = [await askQuestion({ run, asks: 'One' }), await askQuestion({ run, asks: 'Two' })];
    const realVersionsOf = records.versionsOf.bind(records);
    let reads = 0;
    // The per-question reads: one question id on its own. `find` reads every candidate in one batched call, which is not counted.
    records.versionsOf = async (urlKey, recordIds, ...rest) => {
      if (recordIds?.length === 1 && ids.includes(recordIds[0])) reads += 1;
      return realVersionsOf(urlKey, recordIds, ...rest);
    };
    try {
      const rows = await listed();
      assert.equal(rows.length, 2);
      assert.ok(rows.every((r) => r.runId === run && r.askedAt), 'run and askedAt still come from the v1 snapshot');
      assert.equal(reads, 2, 'one versionsOf read per question');
    } finally {
      records.versionsOf = realVersionsOf;
    }
  });
});
