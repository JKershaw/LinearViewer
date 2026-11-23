/**
 * LIN-4538 (LIN-4529 P7a): `list_pending_decisions` reads the person's question records, not the ruling stores.
 *
 * It used to list the old decision rows (collectUnansweredDecisions over the loop feed and the scan and shelving stores) beside
 * the question records. The old rows left this tool with this piece: the chat tool reads what the Rulings page's question
 * reader reads (lib/open-questions.js), so a question the person sees on a card is the one the chat lists.
 *
 * Witnesses, on the real records store and the checked records pipeline:
 *   - the person's OPEN questions, oldest first, each with its id, question, options, recommended and task;
 *   - another person's question, a question to a deciding stage, and an answered or dismissed question are not listed;
 *   - `count` is every open question and `truncated` says the row cap cut the list;
 *   - the tool is read-only: it writes no record;
 *   - with no account on the call (a coordinator's), it lists none;
 *   - a full list of worst-case questions fits the tool's result budget;
 *   - the tool is advertised only when the records store is wired.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { createChatToolCatalog, CHAT_TOOL_RESULT_BUDGETS } from '../../lib/chat-tools.js';
import { DISMISSED_REASON } from '../../lib/records/question-facts.js';

const URL_KEY = 'lin-4538-chat-workspace';
const ACCOUNT = 'acct-owner';
const OTHER = 'acct-other';
const OWNER = `person:${ACCOUNT}`;
const PEOPLE = [{ accountId: ACCOUNT, name: 'Owner' }, { accountId: OTHER, name: 'Other' }];
const SCOPE = { workspaceUrlKey: URL_KEY };
const harness = createMangoTmpdir('lin-4538-chat-');
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

const pause = () => new Promise((resolve) => setTimeout(resolve, 3));

/** A question asked on a task (the ticket's task is made first, as the route makes it). */
async function askQuestion({ task = 'LIN-9', to = OWNER, asks = 'Which way?', options = ['left', 'right'] } = {}) {
  const made = await records.ensureTask(URL_KEY, { identifier: task, title: task }, { by: 'implementation' });
  assert.ok(made.id, `task refused: ${JSON.stringify(made)}`);
  const snap = await writes.add({
    urlKey: URL_KEY, kind: 'question', by: 'implementation', run: null,
    input: { asks, options, recommended: options[0], 'if-unanswered': 'pick the first', to, in: task },
  });
  assert.ok(snap.record, `question refused: ${JSON.stringify(snap.problems)}`);
  await pause();
  return snap.record.id;
}

function catalogFor({ dispatchedBy = ACCOUNT, store = records } = {}) {
  return createChatToolCatalog({
    provider: {}, scope: SCOPE, urlKey: URL_KEY,
    recordsStore: store, dispatchQueueStore: {}, agentStatusStore: {},
    dispatchedBy,
  });
}

describe('list_pending_decisions reads the person\'s open question records (LIN-4538)', () => {
  test('lists the person\'s open questions, oldest first, with the question, options, recommended and task', async () => {
    const first = await askQuestion({ task: 'LIN-1', asks: 'Merge now?', options: ['yes', 'no'] });
    const second = await askQuestion({ task: 'LIN-2', asks: 'Which witness?', options: ['a', 'b', 'c'] });
    const { executeTool } = catalogFor();
    const result = await executeTool({ name: 'list_pending_decisions', arguments: {} });

    assert.equal(result.count, 2);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.questions.map((q) => q.questionId), [first, second]);
    assert.equal(result.questions[0].question, 'Merge now?');
    assert.deepEqual(result.questions[0].options, ['yes', 'no']);
    assert.equal(result.questions[0].recommended, 'yes');
    assert.equal(result.questions[0].issueIdentifier, 'LIN-1');
    assert.equal(result.questions[0].interactive, true);
    assert.equal('decisions' in result, false, 'the old decision rows are gone from this tool');
  });

  test('another person\'s question, a question to a deciding stage, and an answered or dismissed question are not listed', async () => {
    await askQuestion({ task: 'LIN-3', to: `person:${OTHER}`, asks: 'Not mine' });
    await askQuestion({ task: 'LIN-4', to: 'implementation', asks: 'For a stage' });
    const answered = await askQuestion({ task: 'LIN-5', asks: 'Answered' });
    const dismissed = await askQuestion({ task: 'LIN-6', asks: 'Dismissed' });
    const mine = await askQuestion({ task: 'LIN-7', asks: 'Still open' });
    await records.end(URL_KEY, answered, { state: 'answered', reason: 'answered by decision-x' }, { by: OWNER });
    await records.end(URL_KEY, dismissed, { state: 'withdrawn', reason: DISMISSED_REASON }, { by: OWNER });

    const { executeTool } = catalogFor();
    const result = await executeTool({ name: 'list_pending_decisions', arguments: {} });
    assert.deepEqual(result.questions.map((q) => q.questionId), [mine]);
    assert.equal(result.count, 1);
  });

  test('count is every open question; truncated says the row cap cut the list', async () => {
    for (let i = 0; i < 3; i += 1) await askQuestion({ task: `LIN-${20 + i}`, asks: `Question ${i}` });
    const { executeTool } = catalogFor();
    const result = await executeTool({ name: 'list_pending_decisions', arguments: { limit: 2 } });
    assert.equal(result.count, 3);
    assert.equal(result.truncated, true);
    assert.equal(result.questions.length, 2);
    assert.deepEqual(result.questions.map((q) => q.question), ['Question 0', 'Question 1'], 'the longest-waiting ones survive the cap');
  });

  test('is read-only: it writes no record', async () => {
    const id = await askQuestion({ task: 'LIN-30' });
    const before = await records.find(URL_KEY, { kind: 'question', state: 'open' });
    const calls = [];
    const spy = {
      find: (...a) => records.find(...a),
      versionsOf: (...a) => records.versionsOf(...a),
      ticketOfTask: (...a) => records.ticketOfTask(...a),
      add: (...a) => { calls.push('add'); return records.add(...a); },
      end: (...a) => { calls.push('end'); return records.end(...a); },
      revise: (...a) => { calls.push('revise'); return records.revise(...a); },
      link: (...a) => { calls.push('link'); return records.link(...a); },
    };
    const { executeTool } = catalogFor({ store: spy });
    const result = await executeTool({ name: 'list_pending_decisions', arguments: {} });
    assert.deepEqual(result.questions.map((q) => q.questionId), [id]);
    assert.deepEqual(calls, [], 'no write method was called');
    const after = await records.find(URL_KEY, { kind: 'question', state: 'open' });
    assert.deepEqual(after.map((q) => q.id), before.map((q) => q.id));
  });

  test('with no account on the call, it lists none: a question is someone\'s to answer', async () => {
    await askQuestion({ task: 'LIN-40' });
    const { executeTool } = catalogFor({ dispatchedBy: null });
    const result = await executeTool({ name: 'list_pending_decisions', arguments: {} });
    assert.deepEqual(result, { count: 0, truncated: false, questions: [] });
  });

  test('a full list of worst-case questions fits the tool\'s result budget', async () => {
    for (let i = 0; i < 20; i += 1) {
      await askQuestion({
        task: `LIN-${50 + i}`,
        asks: 'q'.repeat(5000),
        options: ['o'.repeat(5000), 'p'.repeat(5000), 'r'.repeat(5000), 's'.repeat(5000), 't'.repeat(5000)],
      });
    }
    const { executeTool } = catalogFor();
    const result = await executeTool({ name: 'list_pending_decisions', arguments: { limit: 20 } });
    const size = JSON.stringify(result).length;
    assert.ok(size <= CHAT_TOOL_RESULT_BUDGETS.list_pending_decisions, `serialized to ${size}`);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)), 'what the model receives is valid JSON');
    assert.equal(result.count, 20);
  });

  test('without the records store it fails as not configured, and is not advertised', async () => {
    const bare = createChatToolCatalog({ provider: {}, scope: SCOPE, urlKey: URL_KEY });
    assert.equal(bare.tools.some((t) => t.function.name === 'list_pending_decisions'), false);
    await assert.rejects(
      () => bare.executeTool({ name: 'list_pending_decisions', arguments: {} }),
      /not configured/
    );
  });
});
