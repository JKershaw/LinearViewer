/**
 * LIN-4555 (LIN-4546 piece 7, the walk): what the walk found in the rows every question and note surface reads.
 *
 * finding-150d1329: an agent's words quote what it read: a task record id, a person id, an ISO stamp. LIN-4554 read them on the
 * task page only (routes/task-page.js readableRows), so Home's cards and notes, the Questions tab, the run page and Flight Companion
 * printed them raw (the walk's probe found `task-037eb576`, `person:acct-4f1c2e9a` and `2026-11-24T09:52:17.341Z` on Home). Now
 * the one reader (lib/open-questions.js) reads the words of every row it gives, questions and notes alike, so every surface agrees.
 * An option stays as written in `options` (the answer value the card sends back); the card shows its words (`optionWords`).
 *
 * finding-6d2b47e0: the bounded tracker title lookup (lib/question-task-titles.js) was wired for the Questions tab, the run page
 * and Flight Companion but not for Home or the task page. A question whose task is neither in the held set nor titled on its asking
 * run's row showed its identifier alone on Home. Now Home's standing (lib/home-row-states.js createWaitingStanding) and the task
 * page ask it too, and Home's notes take the same chain.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { openQuestionsFor, openQuestionsForRun, openFindingsFor } from '../../lib/open-questions.js';
import { createQuestionTaskTitles } from '../../lib/question-task-titles.js';
import { createWaitingStanding } from '../../lib/home-row-states.js';
import { waitingFragmentOf } from '../../lib/waiting-section.js';
import { createChatToolCatalog } from '../../lib/chat-tools.js';
import { createDashboardRulingsRoutes } from '../../routes/dashboard-rulings.js';
import { createTaskPageRoutes } from '../../routes/task-page.js';

const URL_KEY = 'lin-4555-rows';
const OWNER = 'acct-owner';
const NOW = new Date('2026-11-24T12:00:00.000Z');
const STAMP = '2026-11-24T09:52:17.341Z'; // two hours before NOW
const PEOPLE = [{ accountId: OWNER, name: 'John' }];
const listPeople = async () => PEOPLE;
const UNKNOWN_TASK = 'task-0a1b2c3d'; // no ticket claims it
const RAW = /\btask-[0-9a-f]{8}\b|person:|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DAY = 86400000;

const harness = createMangoTmpdir('lin-4555-rows-');
let records;
let dispatch;

before(() => harness.connect());
after(() => harness.close());

beforeEach(async () => {
  const db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  dispatch = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
});

const taskOf = async (ticket) => (await records.ensureTask(URL_KEY, { identifier: ticket, title: ticket, closed: false }, { by: 'Harbour', at: NOW.toISOString() })).id;

/** A record through the store's own add (a fixture, not a writer under test). */
const add = (kind, fields, { inTask, to = `person:${OWNER}`, by = 'review', at = NOW.toISOString(), run = null } = {}) =>
  records.add(URL_KEY, { kind, state: 'open', fields, links: {}, in: inTask, to }, { by, at, ...(run ? { run } : {}) });

/** A parked asking run on `ticket`, two days old, whose dispatch stored `issueTitle`. */
async function askingRun(id, ticket, issueTitle) {
  await dispatch.historyCollection.insertOne({
    _id: id, urlKey: URL_KEY, prompt: 'work', kind: 'implementation', promptName: null, target: 'cli',
    issueIdentifier: ticket, issueTitle, dispatchedAt: new Date(Date.now() - 2 * DAY), dispatchedBy: OWNER, followUpTo: null,
    abort: false, cascade: false, sessionId: null, rootItemId: id, runRecordId: id, status: 'taken',
    feedback: [{ message: '[blocked] which way?', timestamp: new Date(Date.now() - 2 * DAY).toISOString() }],
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  });
  return id;
}

/** A question on LIN-1 whose words quote LIN-2's task record, an unknown task, the owner and a stamp, as a real ask does. */
async function quotingQuestion({ run = null } = {}) {
  const own = await taskOf('LIN-1');
  const quoted = await taskOf('LIN-2');
  await add('question', {
    asks: `Should ${quoted} keep the old route? person:${OWNER} asked at ${STAMP}, and ${UNKNOWN_TASK} depends on it.\n\n- one\n- two`,
    options: ['Keep it', `Drop it and tell ${quoted}`],
    recommended: 'Keep it',
    'if-unanswered': `I keep it and tell person:${OWNER}.`,
  }, { inTask: own, run });
  return { own, quoted };
}

describe('LIN-4555 — the reader reads the asker\'s words once, for every surface (finding-150d1329)', () => {
  test('a quoted task id reads as its ticket, an unknown one "a task", a person by name, a stamp in words; an option is sent as written and shown in words', async () => {
    const { quoted } = await quotingQuestion();
    const [row] = await openQuestionsFor({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: OWNER, now: () => NOW, listPeople });
    assert.equal(row.asks, 'Should LIN-2 keep the old route? John asked 2 hours ago, and a task depends on it.\n\n- one\n- two');
    assert.equal(row.short, 'Should LIN-2 keep the old route?');
    assert.equal(row.ifUnanswered, 'I keep it and tell John.');
    assert.deepEqual(row.options, ['Keep it', `Drop it and tell ${quoted}`], 'an option is the answer value the card sends: as written');
    assert.deepEqual(row.optionWords, ['Keep it', 'Drop it and tell LIN-2'], 'what the card shows on each option');
    assert.equal(row.recommended, 'Keep it');
  });

  test('without the people (or when their read fails), a quoted person reads "someone", never the raw id', async () => {
    await quotingQuestion();
    for (const people of [null, async () => { throw new Error('down'); }]) {
      const [row] = await openQuestionsFor({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: OWNER, now: () => NOW, listPeople: people });
      assert.match(row.asks, /someone asked/);
      assert.doesNotMatch(`${row.short} ${row.asks} ${row.ifUnanswered}`, RAW);
    }
  });

  test('the people are read only when the words quote one', async () => {
    const own = await taskOf('LIN-3');
    await add('question', { asks: 'Which way?', options: ['left', 'right'] }, { inTask: own });
    let reads = 0;
    await openQuestionsFor({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: OWNER, listPeople: async () => { reads += 1; return PEOPLE; } });
    assert.equal(reads, 0);
  });

  test('a note\'s words and its lead read the same way, its tickets in one claims read with the tasks it quotes', async () => {
    const own = await taskOf('LIN-4');
    const quoted = await taskOf('LIN-5');
    await add('finding', { says: `${quoted}: person:${OWNER} saw the ISO time ${STAMP} on the Records section. A second sentence.` }, { inTask: own });
    let claimReads = 0;
    const counted = Object.create(records);
    counted.ticketsOfTasks = (...args) => { claimReads += 1; return records.ticketsOfTasks(...args); };
    const [note] = await openFindingsFor({ recordsStore: counted, urlKey: URL_KEY, accountId: OWNER, listPeople, now: () => NOW });
    assert.equal(note.ticket, 'LIN-4');
    assert.equal(note.says, 'LIN-5: John saw the ISO time 2 hours ago on the Records section. A second sentence.');
    assert.equal(note.lead, 'LIN-5: John saw the ISO time 2 hours ago on the Records section.');
    assert.equal(claimReads, 1, 'still one claims read, whatever the notes quote');
  });
});

describe('LIN-4555 — every surface shows the reader\'s words (finding-150d1329)', () => {
  let server;
  afterEach(async () => { if (server) await new Promise((r) => server.close(r)); server = null; });

  test('Home: the Waiting section\'s cards and notes, page and live fragment alike (one standing)', async () => {
    const { own } = await quotingQuestion();
    await add('finding', { says: `person:${OWNER} asked on ${UNKNOWN_TASK} at ${STAMP}.` }, { inTask: own });
    const standing = createWaitingStanding({ getLoopsForWorkspace: async () => [], dispatchStore: dispatch, agentStatusStore: {}, enrichLoop: (l) => l, recordsStore: records, listPeople, now: () => NOW });
    const waiting = await standing({ urlKey: URL_KEY, accountId: OWNER });
    assert.equal(waiting.questions.length, 1);
    assert.equal(waiting.records.length, 1);
    const { html } = waitingFragmentOf(waiting, { urlKey: URL_KEY });
    const text = html.replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, RAW, 'no raw id or stamp in what Home draws');
    assert.match(text, /John asked on a task 2 hours ago/);
    assert.match(text, /Drop it and tell LIN-2/, 'the option shows in words');
    assert.match(html, /data-option-id="Drop it and tell task-[0-9a-f]{8}"/, 'and still sends the option as written');
  });

  test('the Questions tab\'s feed', async () => {
    await quotingQuestion();
    const session = { accountId: OWNER, workspaces: [{ urlKey: URL_KEY, name: 'Rows', accessToken: 'tok', provider: 'local' }] };
    const app = express();
    app.use(createDashboardRulingsRoutes({
      workspaceFromUrl: (req, _res, next) => { req.workspace = { urlKey: URL_KEY, id: 'ws-rows' }; req.session = session; next(); },
      sessionsFeedCache: { keyFor: (_ws, ns) => ns, get: async (_k, fn) => fn(), clear() {} },
      mergeLoops: async () => [],
      readTaskFacts: () => ({ complete: false, issues: [] }),
      recordsStore: records, dispatchQueueStore: dispatch, accountStore: { resolveCanonicalAccountId: async (id) => id },
      listPeople,
    }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/workspace/${URL_KEY}/api/dashboard/rulings`)).json();
    assert.equal(body.rulings.length, 1);
    assert.doesNotMatch(`${body.rulings[0].short} ${body.rulings[0].asks} ${body.rulings[0].ifUnanswered}`, RAW);
    assert.match(body.rulings[0].asks, /John asked/);
  });

  test('the run page\'s read (openQuestionsForRun)', async () => {
    const run = await askingRun('run-q', 'LIN-1', 'The first task');
    await quotingQuestion({ run });
    const [row] = await openQuestionsForRun({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: OWNER, runId: run, listPeople, now: () => NOW });
    assert.doesNotMatch(`${row.short} ${row.asks} ${row.ifUnanswered}`, RAW);
    assert.match(row.asks, /Should LIN-2 keep/);
  });

  test('Flight Companion\'s list_pending_decisions', async () => {
    await quotingQuestion();
    const out = await createChatToolCatalog({
      provider: { fetchProjects: async () => ({ projects: [], issues: [] }) }, scope: { workspaceUrlKey: URL_KEY }, urlKey: URL_KEY,
      recordsStore: records, dispatchQueueStore: dispatch, agentStatusStore: {}, dispatchedBy: OWNER, listPeople,
    }).executeTool({ name: 'list_pending_decisions', arguments: {} });
    const q = out.questions[0];
    assert.doesNotMatch(`${q.short} ${q.question}`, RAW);
    assert.match(q.question, /John asked/);
  });
});

describe('LIN-4555 — Home and the task page ask the bounded title lookup too (finding-6d2b47e0)', () => {
  let server;
  afterEach(async () => { if (server) await new Promise((r) => server.close(r)); server = null; });

  const WORKSPACE = { urlKey: URL_KEY, accessToken: 'tok', provider: 'local' };
  const lookup = (seen) => createQuestionTaskTitles({ fetchTitle: async (workspace, ticket) => { seen.push([workspace.urlKey, ticket]); return `Title of ${ticket}`; } });

  test('Home: a question whose run row is titled with its identifier and whose task is not held is titled by the lookup', async () => {
    const own = await taskOf('LIN-31');
    await add('question', { asks: 'Which way?', options: ['left', 'right'] }, { inTask: own, run: await askingRun('run-31', 'LIN-31', 'LIN-31') });
    const seen = [];
    const standing = createWaitingStanding({ getLoopsForWorkspace: async () => [], dispatchStore: dispatch, agentStatusStore: {}, enrichLoop: (l) => l, recordsStore: records, questionTaskTitles: lookup(seen) });
    // The held set (Home's issues) does not name LIN-31.
    const waiting = await standing({ urlKey: URL_KEY, accountId: OWNER, titlesOf: () => ({}), workspace: WORKSPACE });
    assert.deepEqual(waiting.questions.map((q) => [q.ticket, q.title]), [['LIN-31', 'Title of LIN-31']]);
    assert.deepEqual(seen, [[URL_KEY, 'LIN-31']]);
    const { html } = waitingFragmentOf(waiting, { urlKey: URL_KEY });
    assert.match(html, /data-testid="question-record-card-task-title"[^>]*>Title of LIN-31</, 'the card shows the identifier and the title');
  });

  test('Home: a note on a task the held set does not name is titled the same way', async () => {
    await add('finding', { says: 'The footer copy is stale.' }, { inTask: await taskOf('LIN-32') });
    const seen = [];
    const standing = createWaitingStanding({ getLoopsForWorkspace: async () => [], dispatchStore: dispatch, agentStatusStore: {}, enrichLoop: (l) => l, recordsStore: records, questionTaskTitles: lookup(seen) });
    const waiting = await standing({ urlKey: URL_KEY, accountId: OWNER, titlesOf: () => ({}), workspace: WORKSPACE });
    assert.deepEqual(waiting.records.map((n) => [n.ticket, n.title]), [['LIN-32', 'Title of LIN-32']]);
  });

  test('the task page: a page with no title of its own titles its question card through the lookup', async () => {
    const own = await taskOf('LIN-33');
    await add('question', { asks: 'Which way?', options: ['left', 'right'] }, { inTask: own });
    const seen = [];
    const model = { identifier: 'LIN-33', title: null, issueId: null, tracker: null, status: 'open', sentence: 'x', live: false, sessions: [], stages: [], evidence: null, details: null };
    const app = express();
    app.use(createTaskPageRoutes({
      workspaceFromUrl: (req, _res, next) => { req.workspace = WORKSPACE; req.session = { accountId: OWNER, workspaces: [] }; next(); },
      getOpenRouterSource: () => null, getDeployInfo: () => ({}),
      loader: { async loadTaskPage() { return { model: { ...model }, taskState: null }; }, async loadTaskState() { return { model: { ...model }, taskState: null, incomplete: null, runWords: null }; } },
      workspaceOwnerCheck: async () => ({ status: 'owner' }), recordsStore: records,
      dispatchStore: { isRunStopped: async () => false, runTailOf: async () => null },
      accountStore: { resolveCanonicalAccountId: async (id) => id }, listPeople, questionTaskTitles: lookup(seen), now: () => NOW,
    }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const html = await (await fetch(`http://127.0.0.1:${server.address().port}/workspace/${URL_KEY}/task/LIN-33`)).text();
    assert.match(html, /data-testid="question-record-card-task-title"[^>]*>Title of LIN-33</);
    assert.deepEqual(seen, [[URL_KEY, 'LIN-33']]);
  });
});
