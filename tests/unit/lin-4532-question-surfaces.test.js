/**
 * LIN-4532 (LIN-4529 P2b): every rulings surface shows the person's open question records, through the one reader
 * (lib/open-questions.js) and the one card (lib/question-record-card.js).
 *
 * What is pinned, and what it fails without the change:
 *   - Home's Waiting on you draws an open question as a card under its task line, for the owner only; the count (`rulingCount`)
 *     and so the badge include it; the records line no longer repeats it (createWaitingStanding over the real stores);
 *   - the chat tool `list_pending_decisions` returns the open questions in `questions`, with their ids, so the model and the Flight
 *     Companion answer through the one question route; a person with none gets the result unchanged (no `questions` key);
 *   - a task page's question section draws a question record card for a task with no ruling, and nothing when there is none;
 *   - a run page pins the question records its own run asked (golden: tests/unit/render-session-golden.test.js).
 *
 * The stores are real (the records store and the dispatch store over the mango harness), as in lin-4532-open-questions.test.js.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { createHomeRowStates, createWaitingStanding } from '../../lib/home-row-states.js';
import { renderWaitingSection } from '../../lib/waiting-section.js';
import { renderQuestionRecordCards, renderQuestionRecordCard } from '../../lib/question-record-card.js';
import { renderTaskQuestion } from '../../lib/render-task-page.js';
import { createChatToolCatalog } from '../../lib/chat-tools.js';

const URL_KEY = 'lin-4532-surfaces';
const OWNER = 'acct-owner';
const OTHER = 'acct-other';
const DAY = 86400000;
const PEOPLE = [{ accountId: OWNER, name: 'Owner' }, { accountId: OTHER, name: 'Other' }];
const harness = createMangoTmpdir('lin-4532-surfaces-');
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

/** A parked asking run (its tail is `[blocked]`, so the question is answerable), on the task LIN-9. */
async function askingRun(id) {
  await dispatch.collection.insertOne({
    _id: id, urlKey: URL_KEY, prompt: 'work', kind: 'implementation', promptName: null, target: 'cli',
    issueIdentifier: 'LIN-9', dispatchedAt: new Date(Date.now() - DAY), dispatchedBy: OWNER, followUpTo: null,
    abort: false, cascade: false, sessionId: null, rootItemId: id, runRecordId: id, status: 'taken', feedback: blocked(),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  });
  return id;
}

async function askQuestion({ run = null, to = `person:${OWNER}`, asks = 'Which way?', task = 'LIN-9' } = {}) {
  // `in` names a task record: the ticket's task is made first, as the route makes it (records-store ensureTask).
  const made = await records.ensureTask(URL_KEY, { identifier: task, title: task }, { by: 'implementation' });
  assert.ok(made.id, `task refused: ${JSON.stringify(made)}`);
  const snap = await writes.add({
    urlKey: URL_KEY, kind: 'question', by: 'implementation', run,
    input: { asks, options: ['left', 'right'], recommended: 'left', 'if-unanswered': 'pick left', to, in: task },
  });
  assert.ok(snap.record, `question refused: ${JSON.stringify(snap.problems)}`);
  return snap.record.id;
}

/** A decision-free ruling standing: no task decisions, no shelves (the real reducer over no loops). */
const NO_RULINGS = {
  listUnansweredForWorkspaces: async () => [],
  listForWorkspaces: async () => [],
  listNewestScanPerTask: async () => ({}),
};

const ROW = (over = {}) => ({
  questionId: 'q-1', asks: 'Which way?', options: ['left', 'right'], recommended: 'left', ifUnanswered: 'pick left',
  taskId: 'task-9', ticket: 'LIN-9', runId: 'run-1', askedAt: '2026-11-23T09:00:00.000Z', state: 'resumable', reason: null, interactive: true,
  ...over,
});

describe('Home: Waiting on you draws the open question cards and counts them (LIN-4532 P2b)', () => {
  test('an open question addressed to the owner is in the standing, counted, and not repeated as a records line', async () => {
    const run = await askingRun('run-home');
    const qid = await askQuestion({ run });
    const standing = createWaitingStanding({
      getLoopsForWorkspace: async () => [], dispatchStore: dispatch, agentStatusStore: null,
      taskDecisionsStore: NO_RULINGS, shelvedRulingsStore: NO_RULINGS, enrichLoop: (l) => l,
      recordsStore: records, canonicalAccountId: async (id) => id,
    });
    const out = await standing({ urlKey: URL_KEY, accountId: OWNER });
    assert.deepEqual(out.questions.map((q) => q.questionId), [qid]);
    assert.equal(out.questions[0].interactive, true);
    assert.equal(out.questions[0].ticket, 'LIN-9', 'the question is filed under its task, by its ticket');
    assert.equal(out.records.some((r) => r.kind === 'question'), false, 'a question is a card, not a records line');

    const homeStates = createHomeRowStates({
      getLoopsForWorkspace: async () => [], dispatchStore: dispatch, agentStatusStore: null, taskDecisionsStore: NO_RULINGS,
      shelvedRulingsStore: NO_RULINGS, enrichLoop: (l) => l, deriveSessionWaiting: () => ({ waiting: false }), waitingStanding: standing,
    });
    const states = await homeStates({ urlKey: URL_KEY, issues: [], runControls: true, accountId: OWNER });
    assert.equal(states.rulingCount, 1, 'the count and the badge include the open question');
    assert.deepEqual(states.questions.map((q) => q.questionId), [qid]);
  });

  test('a question to someone else, or none for a non-owner, is not on the owner\'s Waiting section', async () => {
    await askQuestion({ run: await askingRun('run-other'), to: `person:${OTHER}` });
    const standing = createWaitingStanding({
      getLoopsForWorkspace: async () => [], dispatchStore: dispatch, agentStatusStore: null,
      taskDecisionsStore: NO_RULINGS, shelvedRulingsStore: NO_RULINGS, enrichLoop: (l) => l,
      recordsStore: records, canonicalAccountId: async (id) => id,
    });
    assert.deepEqual((await standing({ urlKey: URL_KEY, accountId: OWNER })).questions, []);
    assert.deepEqual((await standing({ urlKey: URL_KEY, accountId: null })).questions, []);
  });

  test('the section draws each question as a card under its task line, and is shown with only a question open', () => {
    // LIN-4549: the row carries its task's title (lib/open-questions.js titlesOf), and the card draws the task line itself.
    const html = renderWaitingSection({ rows: [], questions: [{ ...ROW(), title: 'Ship the thing' }] }, { urlKey: URL_KEY, owner: true });
    assert.match(html, /data-testid="waiting-question"/);
    assert.match(html, /data-testid="question-record-card"[^>]*data-question-id="q-1"/);
    assert.match(html, /<a class="sess-qcard-task-id" href="[^"]*LIN-9[^"]*" data-testid="question-record-card-task-id">LIN-9<\/a>/);
    assert.match(html, /data-testid="question-record-card-task-title">Ship the thing</);
    assert.doesNotMatch(html, / hidden"/, 'an open question is a reason to show the section');
    assert.equal(renderWaitingSection({ rows: [], questions: [ROW()] }, { urlKey: URL_KEY, owner: false }), '', 'a non-owner gets no section');
    // LIN-4549: Home's own task line is gone: the identifier shows once per card, on the card's task line.
    assert.equal((html.match(/>LIN-9</g) || []).length, 1, 'the identifier shows once');
    assert.doesNotMatch(html, /waiting-task-line/);
  });

  test('an empty section stays hidden', () => {
    const html = renderWaitingSection({ rows: [], questions: [] }, { urlKey: URL_KEY, owner: true });
    assert.match(html, /class="waiting-section hidden"/);
  });
});

describe('the question card list (LIN-4532 P2b)', () => {
  test('no rows draw nothing; each row is a card in one wrapper, in order', () => {
    assert.equal(renderQuestionRecordCards([], { urlKey: URL_KEY }), '');
    const html = renderQuestionRecordCards([ROW({ questionId: 'a' }), ROW({ questionId: 'b' })], { urlKey: URL_KEY, testid: 'x-records' });
    assert.match(html, /^<div class="sess-qrecords" data-testid="x-records">/);
    assert.deepEqual([...html.matchAll(/data-question-id="([^"]+)"/g)].map((m) => m[1]), ['a', 'b']);
  });

  test('a card for a run still working is read-only, and says so', () => {
    const html = renderQuestionRecordCard(ROW({ interactive: false, state: 'mid-turn' }), { urlKey: URL_KEY });
    assert.match(html, /data-testid="question-record-card-readonly"/);
    assert.doesNotMatch(html, /question-record-card-answer/);
  });
});

describe('the task page: a question record with no ruling (LIN-4532 P2b)', () => {
  test('the owner\'s question section carries the record card when the task is not waiting on a ruling', () => {
    const html = renderTaskQuestion({ waitingFor: null, questionRecords: [ROW()] }, { urlKey: URL_KEY, binding: {} });
    assert.match(html, /data-testid="task-page-question"/);
    assert.match(html, /data-testid="task-page-question-records"/);
    assert.match(html, /data-question-id="q-1"/);
  });

  test('no question records and no ruling draws no section', () => {
    assert.equal(renderTaskQuestion({ waitingFor: null, questionRecords: [] }, { urlKey: URL_KEY, binding: {} }), '');
    assert.equal(renderTaskQuestion({ waitingFor: null }, { urlKey: URL_KEY, binding: {} }), '');
  });
});

describe('the chat tool: list_pending_decisions carries the open questions (LIN-4532 P2b)', () => {
  function catalogFor(dispatchedBy, resolveCanonicalAccountId = null) {
    const { executors } = createChatToolCatalog({
      provider: { name: 'fake' }, scope: 'scope', urlKey: URL_KEY,
      recordsStore: records, dispatchQueueStore: dispatch, agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
      sessionIsTerminal: () => false, dispatchedBy, resolveCanonicalAccountId,
    });
    return executors.list_pending_decisions;
  }

  test('an open question for the person is listed in `questions`, with the id the question routes answer by', async () => {
    const qid = await askQuestion({ run: await askingRun('run-chat') });
    const out = await catalogFor(OWNER)({});
    assert.equal(out.count, 1);
    assert.equal(out.questions.length, 1);
    assert.equal(out.questions[0].questionId, qid);
    assert.deepEqual(out.questions[0].options, ['left', 'right']);
    assert.equal(out.questions[0].recommended, 'left');
    assert.equal(out.questions[0].interactive, true);
  });

  test('a person with no open question gets an empty `questions` list and a count of zero', async () => {
    const out = await catalogFor(OWNER)({});
    assert.deepEqual(out, { count: 0, truncated: false, questions: [] });
  });

  // finding-79815581: a merged account's alias is the session account; its questions are addressed to the canonical one.
  test('a session account that is an alias of a merged account reads the questions addressed to the canonical account', async () => {
    const qid = await askQuestion({ run: await askingRun('run-alias') });
    const ALIAS = 'acct-alias';
    const canonical = async (id) => (id === ALIAS ? OWNER : id);
    const out = await catalogFor(ALIAS, canonical)({});
    assert.equal(out.questions?.[0]?.questionId, qid, 'the alias sees the question the Rulings page shows');
    assert.equal(out.count, 1);
  });

  test('without a resolver the session account is read as before, so an alias sees no question', async () => {
    await askQuestion({ run: await askingRun('run-alias-none') });
    const out = await catalogFor('acct-alias')({});
    assert.deepEqual(out.questions, [], 'the unresolved alias has no open question (the case the resolver fixes)');
  });

  test('a resolver that throws reads the session account, and does not fail the tool', async () => {
    const qid = await askQuestion({ run: await askingRun('run-throw') });
    const out = await catalogFor(OWNER, async () => { throw new Error('store down'); })({});
    assert.equal(out.questions?.[0]?.questionId, qid);
  });
});
