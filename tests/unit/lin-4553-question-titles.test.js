/**
 * LIN-4553 (LIN-4546 piece 5): a question card names its task by identifier AND title on the Questions feed, the run page and
 * Flight Companion, even when the caller's cheap sources miss the title.
 *
 * Before this, each caller handed the reader (lib/open-questions.js) only the titles it already held: the feed the held issue set
 * (cold until Home warms it) and the runs in its 24 h window, the run page its own rows, the chat tool the workspace's project
 * read. A question whose task was in none of those drew its identifier alone. Now the reader also reads:
 *   1. the asking run's own dispatch row (local, by id), whose task title the dispatch stored;
 *   2. then a bounded tracker lookup the caller injects (lib/question-task-titles.js): capped per call, time-boxed, cached for
 *      hits and misses, never throwing, so it cannot slow or break a surface.
 *
 * Witnesses:
 *   - the reader: the run row's title; the injected lookup for the rest, asked only for still-untitled tickets; a lookup that
 *     throws costs only the title; a run row about another task is not used;
 *   - the lookup: the cap, the time box with a background fill, the hit and miss TTLs, one lookup per ticket in flight, a
 *     throwing read, and the per-key clear the key-state reset uses;
 *   - the feed route: a cold held set and no run in the window still titles the row (and its anchor), from the run row, else
 *     from the lookup; a lookup that never answers does not hold the feed past its time box;
 *   - the chat tool: list_pending_decisions titles a question its project read misses, through the provider's one-issue read,
 *     and its rows carry no raw task or person id and no ISO time.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { openQuestionsFor, openQuestionsForRun } from '../../lib/open-questions.js';
import { createQuestionTaskTitles } from '../../lib/question-task-titles.js';
import { createChatToolCatalog } from '../../lib/chat-tools.js';
import { createDashboardRulingsRoutes } from '../../routes/dashboard-rulings.js';

const URL_KEY = 'lin-4553-titles';
const OWNER = 'acct-owner';
const PEOPLE = [{ accountId: OWNER, name: 'Owner' }];
const DAY = 86400000;
const harness = createMangoTmpdir('lin-4553-titles-');
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

/** A parked asking run on `ticket`, two days old (outside the feed's window), with or without the title its dispatch stored. */
async function askingRun(id, ticket, issueTitle = null) {
  await dispatch.historyCollection.insertOne({
    _id: id, urlKey: URL_KEY, prompt: 'work', kind: 'implementation', promptName: null, target: 'cli',
    issueIdentifier: ticket, issueTitle, dispatchedAt: new Date(Date.now() - 2 * DAY), dispatchedBy: OWNER, followUpTo: null,
    abort: false, cascade: false, sessionId: null, rootItemId: id, runRecordId: id, status: 'taken',
    feedback: [{ message: '[blocked] which way?', timestamp: new Date(Date.now() - 2 * DAY).toISOString() }],
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  });
  return id;
}

/** One open question to the owner on `ticket`'s task, asked by `run` (or by no run). */
async function ask(ticket, run = null, asks = 'Which way?') {
  const { id: taskId } = await records.ensureTask(URL_KEY, { identifier: ticket, title: ticket, closed: false }, { by: 'Harbour', at: new Date().toISOString() });
  const out = await writes.add({ urlKey: URL_KEY, kind: 'question', by: 'implementation', run, input: { asks, options: ['left', 'right'], recommended: 'left', to: `person:${OWNER}`, in: taskId } });
  assert.ok(out.record, JSON.stringify(out.problems));
  return out.record.id;
}

const read = (extra = {}) => openQuestionsFor({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: OWNER, ...extra });
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('LIN-4553 — the reader titles a question its caller\'s sources miss', () => {
  test('from the asking run\'s own row, which carries the title its dispatch stored', async () => {
    await ask('LIN-1', await askingRun('run-1', 'LIN-1', 'Ship the thing'));
    const rows = await read({ titlesOf: () => ({}) });
    assert.deepEqual(rows.map((r) => [r.ticket, r.title]), [['LIN-1', 'Ship the thing']]);
  });

  test('the run page\'s read (openQuestionsForRun) gets the same title', async () => {
    const run = await askingRun('run-2', 'LIN-2', 'Second task');
    await ask('LIN-2', run);
    const rows = await openQuestionsForRun({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: OWNER, runId: run, titlesOf: () => ({}) });
    assert.deepEqual(rows.map((r) => r.title), ['Second task']);
  });

  test('a run row about another task is not taken as this task\'s title', async () => {
    await ask('LIN-3', await askingRun('run-3', 'LIN-99', 'Some other task'));
    const rows = await read();
    assert.deepEqual(rows.map((r) => r.title), [null]);
  });

  test('then from the injected lookup, asked only for the tickets still untitled', async () => {
    await ask('LIN-4', await askingRun('run-4', 'LIN-4', 'From the run'));
    await ask('LIN-5', await askingRun('run-5', 'LIN-5'));
    await ask('LIN-6');
    const asked = [];
    const rows = await read({
      titlesOf: () => ({ 'LIN-6': 'From the held set' }),
      lookupTitles: async (tickets) => { asked.push([...tickets].sort()); return { 'LIN-5': 'From the tracker' }; },
    });
    assert.deepEqual(rows.map((r) => [r.ticket, r.title]).sort(), [['LIN-4', 'From the run'], ['LIN-5', 'From the tracker'], ['LIN-6', 'From the held set']]);
    assert.deepEqual(asked, [['LIN-5']], 'the lookup is asked once, for the one ticket nothing else titled');
  });

  test('a title that only repeats the identifier is no title, so the next source is asked (the card shows such a title as none)', async () => {
    await ask('LIN-8', await askingRun('run-8', 'LIN-8', 'LIN-8'));
    const asked = [];
    const rows = await read({
      titlesOf: () => ({ 'LIN-8': 'LIN-8' }),
      lookupTitles: async (tickets) => { asked.push([...tickets]); return { 'LIN-8': 'The real title' }; },
    });
    assert.deepEqual(asked, [['LIN-8']]);
    assert.equal(rows[0].title, 'The real title');
  });

  test('a lookup that throws costs only the title', async () => {
    await ask('LIN-7');
    const rows = await read({ lookupTitles: async () => { throw new Error('tracker down'); } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, null);
  });
});

describe('LIN-4553 — the bounded lookup (lib/question-task-titles.js)', () => {
  const WS = { urlKey: 'ws-a' };

  test('at most maxPerCall reads start per call; the next call reads the rest', async () => {
    const reads = [];
    const titles = createQuestionTaskTitles({ fetchTitle: async (_w, t) => { reads.push(t); return `Title ${t}`; }, maxPerCall: 2 });
    const first = await titles.titlesFor(WS, ['A-1', 'A-2', 'A-3']);
    assert.deepEqual(reads, ['A-1', 'A-2']);
    assert.deepEqual(first, { 'A-1': 'Title A-1', 'A-2': 'Title A-2' });
    const second = await titles.titlesFor(WS, ['A-1', 'A-2', 'A-3']);
    assert.deepEqual(reads, ['A-1', 'A-2', 'A-3'], 'only the unread ticket is read; the others come from the cache');
    assert.deepEqual(second, { 'A-1': 'Title A-1', 'A-2': 'Title A-2', 'A-3': 'Title A-3' });
  });

  test('a call waits at most waitMs; a slow read fills the cache in the background for the next call', async () => {
    let release;
    let reads = 0;
    const titles = createQuestionTaskTitles({ fetchTitle: () => { reads += 1; return new Promise((resolve) => { release = resolve; }); }, waitMs: 20 });
    const started = Date.now();
    assert.deepEqual(await titles.titlesFor(WS, ['B-1']), {});
    assert.ok(Date.now() - started < 1000, 'the call came back on its time box');
    assert.deepEqual(await titles.titlesFor(WS, ['B-1']), {}, 'still running: no second read, no title yet');
    assert.equal(reads, 1, 'one read per ticket in flight');
    release('Slow title');
    await tick();
    assert.deepEqual(await titles.titlesFor(WS, ['B-1']), { 'B-1': 'Slow title' });
    assert.equal(reads, 1);
  });

  test('a hit is kept hitTtlMs and a miss missTtlMs, then read again', async () => {
    let clock = 0;
    const reads = [];
    const answers = { 'C-1': 'Found', 'C-2': null };
    const titles = createQuestionTaskTitles({ fetchTitle: async (_w, t) => { reads.push(t); return answers[t]; }, now: () => clock, hitTtlMs: 1000, missTtlMs: 100 });
    await titles.titlesFor(WS, ['C-1', 'C-2']);
    clock = 50;
    await titles.titlesFor(WS, ['C-1', 'C-2']);
    assert.deepEqual(reads, ['C-1', 'C-2'], 'both cached inside their TTLs');
    clock = 150;
    answers['C-2'] = 'Found later';
    assert.deepEqual(await titles.titlesFor(WS, ['C-1', 'C-2']), { 'C-1': 'Found', 'C-2': 'Found later' });
    assert.deepEqual(reads, ['C-1', 'C-2', 'C-2'], 'the miss is read again after its TTL; the hit is not');
  });

  test('a read that throws or rejects is no title, and the call never throws', async () => {
    const titles = createQuestionTaskTitles({ fetchTitle: (_w, t) => { if (t === 'D-1') throw new Error('sync'); return Promise.reject(new Error('async')); } });
    assert.deepEqual(await titles.titlesFor(WS, ['D-1', 'D-2']), {});
    assert.deepEqual(await createQuestionTaskTitles({}).titlesFor(WS, ['D-1']), {}, 'no fetchTitle: nothing to read');
    assert.deepEqual(await titles.titlesFor({}, ['D-1']), {}, 'no workspace key: nothing to read');
  });

  test('clear and countFor are per workspace key (the key-state reset)', async () => {
    const titles = createQuestionTaskTitles({ fetchTitle: async (_w, t) => `T ${t}` });
    await titles.titlesFor({ urlKey: 'ws-a' }, ['E-1', 'E-2']);
    await titles.titlesFor({ urlKey: 'ws-b' }, ['E-1']);
    assert.equal(titles.countFor({ urlKey: 'ws-a' }), 2);
    titles.clear({ urlKey: 'ws-a' });
    assert.equal(titles.countFor({ urlKey: 'ws-a' }), 0);
    assert.equal(titles.countFor({ urlKey: 'ws-b' }), 1, 'the other key keeps its titles');
  });
});

describe('LIN-4553 — the Questions feed titles a row whose task the held set and the window miss', () => {
  let server;
  afterEach(async () => { if (server) await new Promise((r) => server.close(r)); server = null; });

  async function feed({ questionTaskTitles = undefined } = {}) {
    const session = { accountId: OWNER, workspaces: [{ urlKey: URL_KEY, name: 'Titles', accessToken: 'tok', provider: 'local' }] };
    const ctx = {
      workspaceFromUrl: (req, _res, next) => { req.workspace = { urlKey: URL_KEY, id: 'ws-titles' }; req.session = session; next(); },
      sessionsFeedCache: { keyFor: (_ws, ns) => ns, get: async (_k, fn) => fn(), clear() {} },
      mergeLoops: async () => [], // no run in the window
      readTaskFacts: () => ({ complete: false, issues: [] }), // a cold held set
      recordsStore: records,
      dispatchQueueStore: dispatch,
      accountStore: { resolveCanonicalAccountId: async (id) => id },
      questionTaskTitles,
    };
    const app = express();
    app.use(createDashboardRulingsRoutes(ctx));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const res = await fetch(`http://127.0.0.1:${server.address().port}/workspace/${URL_KEY}/api/dashboard/rulings`);
    assert.equal(res.status, 200);
    return res.json();
  }

  test('from the asking run\'s row, though the run is older than the window', async () => {
    await ask('LIN-11', await askingRun('run-11', 'LIN-11', 'Titled by its run'));
    const body = await feed();
    assert.equal(body.rulings[0].title, 'Titled by its run');
    assert.equal(body.rulings[0].anchor.issueTitle, 'Titled by its run');
  });

  test('else from the bounded tracker lookup, read with the session\'s own workspace', async () => {
    await ask('LIN-12', await askingRun('run-12', 'LIN-12'));
    const seen = [];
    const questionTaskTitles = createQuestionTaskTitles({ fetchTitle: async (workspace, ticket) => { seen.push([workspace.urlKey, workspace.accessToken, ticket]); return 'Titled by the tracker'; } });
    const body = await feed({ questionTaskTitles });
    assert.equal(body.rulings[0].ticket, 'LIN-12');
    assert.equal(body.rulings[0].title, 'Titled by the tracker');
    assert.deepEqual(seen, [[URL_KEY, 'tok', 'LIN-12']]);
  });

  test('a lookup that never answers does not hold the feed past its time box', async () => {
    await ask('LIN-13');
    const questionTaskTitles = createQuestionTaskTitles({ fetchTitle: () => new Promise(() => {}), waitMs: 30 });
    const started = Date.now();
    const body = await feed({ questionTaskTitles });
    assert.ok(Date.now() - started < 2000, `the feed answered in ${Date.now() - started}ms`);
    assert.equal(body.rulings.length, 1, 'the question still comes');
    assert.equal(body.rulings[0].title, null);
  });
});

describe('LIN-4553 — list_pending_decisions titles a question its project read misses, and carries nothing raw', () => {
  const pending = (provider) => createChatToolCatalog({
    provider, scope: { workspaceUrlKey: URL_KEY }, urlKey: URL_KEY, recordsStore: records, dispatchQueueStore: dispatch, agentStatusStore: {}, dispatchedBy: OWNER,
  }).executeTool({ name: 'list_pending_decisions', arguments: {} });

  test('through the provider\'s one-issue read when the project read does not know the task', async () => {
    await ask('LIN-21', null, 'Which witness should the run page use?\n\nThe longer background follows.');
    const reads = [];
    const out = await pending({
      fetchProjects: async () => ({ projects: [], issues: [] }),
      fetchIssueContext: async (scope, id) => { reads.push([scope.workspaceUrlKey, id]); return { issue: { identifier: id, title: 'Titled by the one-issue read' } }; },
    });
    assert.deepEqual(reads, [[URL_KEY, 'LIN-21']]);
    const q = out.questions[0];
    assert.equal(q.issueIdentifier, 'LIN-21');
    assert.equal(q.issueTitle, 'Titled by the one-issue read');
    assert.equal(q.short, 'Which witness should the run page use?');
  });

  test('the rows carry no raw task or person id and no ISO time', async () => {
    await ask('LIN-22', await askingRun('run-22', 'LIN-22', 'A task'));
    const out = await pending({ fetchProjects: async () => ({ projects: [], issues: [] }) });
    const text = JSON.stringify(out);
    assert.doesNotMatch(text, /\btask-[0-9a-f]{6,}\b/);
    assert.doesNotMatch(text, /person:/);
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    assert.equal(out.questions[0].issueTitle, 'A task');
  });
});
