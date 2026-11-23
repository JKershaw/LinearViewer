/**
 * LIN-4538 (LIN-4529 P7a): the question facts every reader outside the ruling machinery shares (lib/records/question-facts.js).
 *
 * Witnesses, on the real records store and the checked records pipeline:
 *   - a dismissal is a question ended `withdrawn` by a PERSON with reason "dismissed" (outcome `dismissed`); an agent's
 *     withdrawal with the same reason is not one;
 *   - a closed ticket's open question ends `withdrawn`, reason "ticket closed", filed by Harbour: outcome `self-resolved`,
 *     never `dismissed`; a second close is a no-op;
 *   - an answered question's outcome is `answered`; an open one has no outcome and is the only one `openQuestionFacts` keeps;
 *   - raisedAt and the asking run come from the question's first version, not its latest.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import {
  questionFacts, openQuestionFacts, endOpenQuestionsOfTicket, questionOutcomeOf,
  DISMISSED_REASON, TICKET_CLOSED_QUESTION_REASON,
} from '../../lib/records/question-facts.js';

const URL_KEY = 'lin-4538-facts-workspace';
const ACCOUNT = 'acct-owner';
const OWNER = `person:${ACCOUNT}`;
const PEOPLE = [{ accountId: ACCOUNT, name: 'Owner' }];
const harness = createMangoTmpdir('lin-4538-facts-');
let records;
let writes;

before(() => harness.connect());
after(() => harness.close());

beforeEach(async () => {
  const db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  writes = createRecordWrites({ recordsStore: records, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => PEOPLE });
});

async function askQuestion({ task, to = OWNER, run = null, asks = 'Which way?' }) {
  const made = await records.ensureTask(URL_KEY, { identifier: task, title: task }, { by: 'implementation' });
  assert.ok(made.id, `task refused: ${JSON.stringify(made)}`);
  const snap = await writes.add({
    urlKey: URL_KEY, kind: 'question', by: 'implementation', run,
    input: { asks, options: ['left', 'right'], recommended: 'left', 'if-unanswered': 'pick left', to, in: task },
  });
  assert.ok(snap.record, `question refused: ${JSON.stringify(snap.problems)}`);
  return snap.record.id;
}

const byId = (rows, id) => rows.find((r) => r.questionId === id);

describe('outcomes: what an end means', () => {
  test('a person dismissal is a dismissed outcome; an agent withdrawal with the same reason is not', () => {
    assert.equal(questionOutcomeOf({ state: 'withdrawn', reason: DISMISSED_REASON, by: OWNER }), 'dismissed');
    assert.equal(questionOutcomeOf({ state: 'withdrawn', reason: DISMISSED_REASON, by: 'implementation' }), null);
  });

  test('a ticket-closed end is self-resolved, never dismissed; an answer is answered; an open question has no outcome', () => {
    assert.equal(questionOutcomeOf({ state: 'withdrawn', reason: TICKET_CLOSED_QUESTION_REASON, by: 'harbour' }), 'self-resolved');
    assert.equal(questionOutcomeOf({ state: 'answered', reason: 'answered by decision-1', by: OWNER }), 'answered');
    assert.equal(questionOutcomeOf({ state: 'open' }), null);
  });
});

describe('questionFacts', () => {
  test('a dismissed question is a dismissal; the facts carry the first version time and the asking run', async () => {
    const id = await askQuestion({ task: 'LIN-9', run: 'run-ask-1' });
    await records.end(URL_KEY, id, { state: 'withdrawn', reason: DISMISSED_REASON }, { by: OWNER });
    const rows = await questionFacts(records, URL_KEY);
    const row = byId(rows, id);
    assert.equal(row.state, 'withdrawn');
    assert.equal(row.outcome, 'dismissed');
    assert.equal(row.reason, DISMISSED_REASON);
    assert.equal(row.endedBy, OWNER);
    assert.equal(row.runId, 'run-ask-1');
    assert.equal(row.ticket, 'LIN-9');
    assert.ok(row.raisedAt, 'raisedAt is the question v1 time');
    assert.ok(row.resolvedAt && row.resolvedAt >= row.raisedAt, 'resolvedAt is the end time');
  });

  test('openQuestionFacts keeps only the open ones', async () => {
    const open = await askQuestion({ task: 'LIN-10' });
    const done = await askQuestion({ task: 'LIN-11' });
    await records.end(URL_KEY, done, { state: 'withdrawn', reason: DISMISSED_REASON }, { by: OWNER });
    const rows = await questionFacts(records, URL_KEY);
    assert.deepEqual(openQuestionFacts(rows).map((r) => r.questionId), [open]);
  });
});

describe('endOpenQuestionsOfTicket: the ticket closer', () => {
  test('a closed ticket\'s open question ends withdrawn, "ticket closed", by Harbour, and is self-resolved, not a dismissal', async () => {
    const id = await askQuestion({ task: 'LIN-20' });
    const out = await endOpenQuestionsOfTicket({ recordsStore: records, urlKey: URL_KEY, ticket: 'LIN-20' });
    assert.equal(out.ended, 1);
    const row = byId(await questionFacts(records, URL_KEY), id);
    assert.equal(row.state, 'withdrawn');
    assert.equal(row.reason, TICKET_CLOSED_QUESTION_REASON);
    assert.equal(row.endedBy, 'harbour');
    assert.equal(row.outcome, 'self-resolved');
  });

  test('a second close ends nothing more; a ticket with no task, or another ticket\'s question, is untouched', async () => {
    const mine = await askQuestion({ task: 'LIN-21' });
    const other = await askQuestion({ task: 'LIN-22' });
    await endOpenQuestionsOfTicket({ recordsStore: records, urlKey: URL_KEY, ticket: 'LIN-21' });
    assert.equal((await endOpenQuestionsOfTicket({ recordsStore: records, urlKey: URL_KEY, ticket: 'LIN-21' })).ended, 0);
    assert.equal((await endOpenQuestionsOfTicket({ recordsStore: records, urlKey: URL_KEY, ticket: 'LIN-404' })).ended, 0);
    const rows = await questionFacts(records, URL_KEY);
    assert.equal(byId(rows, mine).state, 'withdrawn');
    assert.equal(byId(rows, other).state, 'open');
  });
});
