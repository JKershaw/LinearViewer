/**
 * LIN-4551 (LIN-4546 piece 3/7, late addition 2): a card says "Dismissed" for a person's dismissal and keeps an agent's own word
 * for its withdrawal. A card learns a question already ended from the route's 409 (`ruling-settled`, lib/question-answers.js); that
 * refusal names how it ended (`ended`, the question's end as stored since LIN-4550), and the card's outcome words
 * (questionOutcomeText, lib/question-record-card.js) read it.
 *
 * Runs on the real records store, the real dispatch store and the checked records pipeline, as
 * tests/unit/lin-4531-question-answers.test.js does. Each fails before LIN-4551: the 409 carries no `ended`, and the card says
 * "This ruling was already answered or dismissed." whatever the end was.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { createQuestionAnswers } from '../../lib/question-answers.js';
import { questionOutcomeText } from '../../lib/question-record-card.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { TICKET_CLOSED_QUESTION_REASON } from '../../lib/records/question-facts.js';
import { HARBOUR_WRITER } from '../../lib/records/writes.js';

const URL_KEY = 'lin-4551-workspace';
const NOW = new Date('2026-11-24T12:00:00.000Z');
const PERSON = 'person:acct-owner';
const harness = createMangoTmpdir('lin-4551-settled-');
let records;
let dispatch;
let writes;
let service;

before(() => harness.connect());
after(() => harness.close());

beforeEach(async () => {
  const db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  dispatch = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
  writes = createRecordWrites({ recordsStore: records, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => [] });
  // No run behind the question (`gone`): the route ends it with no resume, which is all these need.
  service = createQuestionAnswers({
    recordsStore: records, writes, dispatchStore: dispatch, now: () => NOW,
    refuseResume: async () => null,
    enqueueResume: async () => ({ status: 200, body: { queued: true, itemId: 'unused' } }),
  });
});

async function askQuestion() {
  const snap = await writes.add({
    urlKey: URL_KEY, kind: 'question', by: 'implementation', run: null,
    input: { asks: 'Which way?', options: ['left', 'right'], recommended: 'left', 'if-unanswered': 'pick left', to: 'project' },
  });
  assert.ok(snap.record, `question refused: ${JSON.stringify(snap.problems)}`);
  return snap.record.id;
}

describe('the settled refusal names how the question ended, and the card words it', () => {
  test('dismissed by a person: the 409 says `ended: dismissed`, and the card says "Dismissed"', async () => {
    const q = await askQuestion();
    const dismissed = await service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));
    const again = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', words: null, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'ruling-settled');
    assert.equal(again.body.ended, 'dismissed');
    assert.match(questionOutcomeText('answer', again.body), /^Dismissed\b/);
  });

  test('withdrawn by the agent that asked: the 409 says `ended: withdrawn`, and the card keeps that word, not "Dismissed"', async () => {
    const q = await askQuestion();
    const ended = await writes.end({ urlKey: URL_KEY, id: q, input: { state: 'withdrawn', reason: 'answered it myself' }, by: 'implementation', run: null });
    assert.ok(!ended.problems, JSON.stringify(ended.problems));
    const again = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', words: null, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'ruling-settled');
    assert.equal(again.body.ended, 'withdrawn');
    const text = questionOutcomeText('answer', again.body);
    assert.match(text, /withdrawn/i);
    assert.doesNotMatch(text, /dismiss/i);
  });

  test('withdrawn by the ticket closer (reason "ticket closed", by Harbour): the card does not say the run that asked took it back', async () => {
    const q = await askQuestion();
    await records.end(URL_KEY, q, { state: 'withdrawn', reason: TICKET_CLOSED_QUESTION_REASON }, { by: HARBOUR_WRITER });
    const again = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', words: null, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(again.status, 409);
    assert.equal(again.body.ended, 'withdrawn');
    const text = questionOutcomeText('answer', again.body);
    assert.match(text, /^Withdrawn\b/);
    assert.doesNotMatch(text, /the run that asked/);
    assert.doesNotMatch(text, /dismiss/i);
  });

  test('a person\'s dismissal from before LIN-4550 (stored `withdrawn`, reason "dismissed", by the person) still reads "Dismissed"', async () => {
    const q = await askQuestion();
    await records.end(URL_KEY, q, { state: 'withdrawn', reason: 'dismissed' }, { by: PERSON });
    const again = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', words: null, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(again.status, 409);
    assert.equal(again.body.ended, 'dismissed');
    assert.match(questionOutcomeText('answer', again.body), /^Dismissed\b/);
  });

  test('answered: a dismissal after it gets `ended: answered`, and the card says "Answered"', async () => {
    const q = await askQuestion();
    const answered = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'right', words: null, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    const again = await service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(again.status, 409);
    assert.equal(again.body.ended, 'answered');
    assert.match(questionOutcomeText('dismiss', again.body), /^Answered\b/);
  });
});
