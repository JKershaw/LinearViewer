/**
 * LIN-4549 (LIN-4546 piece 1): every row the one question reader returns (lib/open-questions.js openQuestionsFor) carries its
 * task's `title`, through a lookup each caller injects from its own tracker read (the Records area takes outside reads injected,
 * docs/areas/records.md). The reader, then each caller with its own source:
 *   - Home (lib/home-row-states.js): the page's issues; the live fragment's held issue set is the same `titlesFromIssues`;
 *   - Flight Companion's chat tool (lib/chat-tools.js list_pending_decisions): the workspace's issue read, best effort;
 *   - the rulings feed (routes/dashboard-rulings.js): the runs it already read (a run carries its task's title);
 *   - the task page (routes/task-page.js) is witnessed in tests/unit/task-page-route.test.js, the run page (routes/dashboard.js)
 *     end to end in tests/e2e/lin-4549-card-task-line.spec.js.
 * A task with no known title reads as its identifier alone: `title` is null, never '' or 'undefined'.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { openQuestionsFor, titlesFromIssues } from '../../lib/open-questions.js';
import { createHomeRowStates, createWaitingStanding } from '../../lib/home-row-states.js';
import { createChatToolCatalog } from '../../lib/chat-tools.js';
import { createDashboardRulingsRoutes } from '../../routes/dashboard-rulings.js';
import { renderQuestionRecordCard } from '../../lib/question-record-card.js';

const URL_KEY = 'lin-4549-titles';
const OWNER = 'acct-owner';
const PEOPLE = [{ accountId: OWNER, name: 'Owner' }];
const SCOPE = { workspaceUrlKey: URL_KEY };
const harness = createMangoTmpdir('lin-4549-titles-');
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

/** One open question to the owner, filed under `ticket`'s task. */
async function ask(ticket, asks = 'Which way?') {
  const { id: taskId } = await records.ensureTask(URL_KEY, { identifier: ticket, title: ticket, closed: false }, { by: 'Harbour', at: new Date().toISOString() });
  const out = await writes.add({ urlKey: URL_KEY, kind: 'question', by: 'implementation', run: null, input: { asks, options: ['left', 'right'], to: `person:${OWNER}`, in: taskId } });
  assert.ok(out.record, JSON.stringify(out.problems));
  return out.record.id;
}

const ISSUES = [{ identifier: 'LIN-1', title: 'Ship the thing' }, { identifier: 'LIN-2', title: 'Second task' }];

describe('LIN-4549 — the reader: every row carries `title` from the injected lookup', () => {
  test('a lookup that knows the task names it; one that does not leaves null; none at all leaves null', async () => {
    await ask('LIN-1');
    await ask('LIN-3');
    const rows = await openQuestionsFor({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: OWNER, titlesOf: titlesFromIssues(ISSUES) });
    assert.deepEqual(rows.map((r) => [r.ticket, r.title]).sort(), [['LIN-1', 'Ship the thing'], ['LIN-3', null]]);
    const bare = await openQuestionsFor({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: OWNER });
    assert.ok(bare.every((r) => 'title' in r && r.title === null), 'every row has the key, null with no lookup');
  });

  test('a lookup that throws costs only the titles: the questions still come, untitled', async () => {
    await ask('LIN-1');
    const rows = await openQuestionsFor({ recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: OWNER, titlesOf: async () => { throw new Error('tracker down'); } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, null);
  });

  test('a blank title is no title (no gap on the card), and the lookup is asked once for the distinct tickets', async () => {
    await ask('LIN-1', 'One?');
    await ask('LIN-1', 'Two?');
    const asked = [];
    const rows = await openQuestionsFor({
      recordsStore: records, dispatchStore: dispatch, urlKey: URL_KEY, accountId: OWNER,
      titlesOf: (tickets) => { asked.push(tickets); return { 'LIN-1': '   ' }; },
    });
    assert.deepEqual(asked, [['LIN-1']]);
    assert.ok(rows.every((r) => r.title === null));
  });

  test('the card: identifier alone when the title is unknown or only repeats it; identifier then title when known', () => {
    const card = (row) => renderQuestionRecordCard({ questionId: 'q', asks: 'A?', options: [], state: 'resumable', interactive: true, ...row }, { urlKey: 'w' });
    for (const title of [null, '', 'LIN-1', undefined]) {
      const html = card({ ticket: 'LIN-1', title });
      assert.match(html, /data-testid="question-record-card-task-id">LIN-1</);
      assert.doesNotMatch(html, /question-record-card-task-title/, `title ${JSON.stringify(title)}: no title span`);
      assert.doesNotMatch(html, /undefined|null/, 'no "undefined" or "null" reaches the page');
    }
    const named = card({ ticket: 'LIN-1', title: 'Ship the thing' });
    assert.match(named, /task-id">LIN-1<\/span> <span class="sess-qcard-task-title" data-testid="question-record-card-task-title">Ship the thing</);
    assert.equal(card({ ticket: null, title: null }).includes('question-record-card-task'), false, 'no task, no line');
  });
});

describe('LIN-4549 — Home (lib/home-row-states.js): the questions carry titles from the page\'s issues', () => {
  test('createHomeRowStates passes its issues as the lookup', async () => {
    await ask('LIN-1');
    const deps = {
      getLoopsForWorkspace: async () => [], dispatchStore: dispatch, agentStatusStore: { getAll: async () => [] }, enrichLoop: (l) => l,
      deriveSessionWaiting: () => ({ waiting: false }), recordsStore: records, canonicalAccountId: async (id) => id,
    };
    const waitingStanding = createWaitingStanding(deps);
    const page = await createHomeRowStates({ ...deps, waitingStanding })({ urlKey: URL_KEY, issues: ISSUES, runControls: true, accountId: OWNER });
    assert.deepEqual(page.questions.map((q) => q.title), ['Ship the thing']);
    // The live fragment's call: the held issue set as the lookup, the same function.
    const fragment = await waitingStanding({ urlKey: URL_KEY, accountId: OWNER, titlesOf: titlesFromIssues(ISSUES) });
    assert.deepEqual(fragment.questions.map((q) => q.title), ['Ship the thing']);
    const cold = await waitingStanding({ urlKey: URL_KEY, accountId: OWNER });
    assert.deepEqual(cold.questions.map((q) => q.title), [null], 'a cold held set: the identifier alone');
  });
});

describe('LIN-4549 — Flight Companion\'s chat tool (lib/chat-tools.js): each pending question carries its task\'s title', () => {
  const catalog = (provider) => createChatToolCatalog({
    provider, scope: SCOPE, urlKey: URL_KEY, recordsStore: records, dispatchQueueStore: dispatch, agentStatusStore: {}, dispatchedBy: OWNER,
  });
  const pending = (provider) => catalog(provider).executeTool({ name: 'list_pending_decisions', arguments: {} });

  test('from the workspace\'s issue read; a failing read leaves the identifier alone', async () => {
    await ask('LIN-2');
    const named = await pending({ fetchProjects: async () => ({ projects: [], issues: ISSUES }) });
    assert.equal(named.questions[0].issueIdentifier, 'LIN-2');
    assert.equal(named.questions[0].issueTitle, 'Second task');
    const failing = await pending({ fetchProjects: async () => { throw new Error('tracker down'); } });
    assert.equal(failing.questions.length, 1, 'the question still comes');
    assert.equal(failing.questions[0].issueTitle, null);
  });
});

describe('LIN-4549 — the rulings feed (routes/dashboard-rulings.js): each row carries its task\'s title from the runs it read', () => {
  let server;
  let feedLoops = [];
  afterEach(async () => { if (server) await new Promise((r) => server.close(r)); server = null; feedLoops = []; });

  async function feed() {
    const session = { accountId: OWNER, workspaces: [{ urlKey: URL_KEY, name: 'Titles' }] };
    const app = express();
    app.use(createDashboardRulingsRoutes({
      workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URL_KEY, id: 'ws' }; req.session = session; next(); },
      sessionsFeedCache: { keyFor: (_ws, ns) => ns, get: async (_k, fn) => fn(), clear() {} },
      mergeLoops: async () => feedLoops,
      recordsStore: records, dispatchQueueStore: dispatch, accountStore: { resolveCanonicalAccountId: async (id) => id },
    }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const res = await fetch(`http://127.0.0.1:${server.address().port}/workspace/${URL_KEY}/api/dashboard/rulings`);
    return res.json();
  }

  test('a run on the task names it; a task with no run here reads as its identifier alone', async () => {
    await ask('LIN-1');
    await ask('LIN-3');
    feedLoops = [{ workspaceUrlKey: URL_KEY, issueIdentifier: 'LIN-1', issueTitle: 'Ship the thing' }, { workspaceUrlKey: 'other', issueIdentifier: 'LIN-3', issueTitle: 'Not this workspace' }];
    const body = await feed();
    const byTicket = Object.fromEntries(body.rulings.map((r) => [r.ticket, r.title]));
    assert.deepEqual(byTicket, { 'LIN-1': 'Ship the thing', 'LIN-3': null });
  });
});
