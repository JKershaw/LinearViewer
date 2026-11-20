/**
 * LIN-4494 (piece 3): the records pages and the session writes, in process, on the real store (a MangoDB engine).
 *
 * Witnesses (the piece's own list): the task page's Records section in both grid templates, with "no ticket yet" for a
 * ticketless task; a signed-in person's add, child task, end and supersede through the session (no token), filed by
 * their account, and a refused write redirects with its reason; a guest page carries no records, and the renderer
 * refuses them for a guest; the project page numbers its backlog oldest first, makes a task (no ticket, once, retry
 * safe) and declines a finding; Home's Waiting on you carries the person's open records for an owner only; the session
 * page shows the run's account.
 */
import { describe, test, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createTaskRecordsRoutes } from '../../routes/task-records.js';
import { createFakeTracker } from '../helpers/fake-records-tracker.js';
import { HARBOUR_WRITER } from '../../lib/records/writes.js';
import { createProjectPageRoutes } from '../../routes/project-page.js';
import { renderTaskRecordsSection, renderWaitingRecordLine } from '../../lib/render-task-records.js';
import { renderTaskPage } from '../../lib/render-task-page.js';
import { renderWaitingSection } from '../../lib/waiting-section.js';
import { createWaitingStanding } from '../../lib/home-row-states.js';
import { renderRunAccount } from '../../lib/render-session.js';
import { readRunAccount, createDashboardRoutes as createDashboardRoutesUnplumbed } from '../../routes/dashboard.js';
import { withDefaults, NO_REQUEST_RECORDS } from '../fixtures/request-usage-loader.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { renderProjectPage } from '../../lib/render-project-page.js';
import { createTaskPageRoutes } from '../../routes/task-page.js';

const URL_KEY = 'lin-4494-workspace';
const createDashboardRoutesUnplumbed_withDefaults = (deps) => withDefaults(createDashboardRoutesUnplumbed, 0, { requestUsageLoader: NO_REQUEST_RECORDS })(deps);
const ACCOUNT = 'acc-john';
const TICKET = 'LIN-4460';
const harness = createMangoTmpdir('lin-4494-pages-');
let db;
let store;
let server;
let base;
let sessionAccount;

before(() => harness.connect());
after(() => harness.close());
afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  server = null;
});

beforeEach(async () => {
  db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  sessionAccount = ACCOUNT;
});

const people = async () => [{ accountId: ACCOUNT, name: 'John' }];
const isTerminalState = (t) => t === 'completed' || t === 'canceled' || t === 'duplicate';

/** A stand-in for the workspace and session middleware: a signed-in person of this workspace, or a session with none. */
function session(req, res, next) {
  req.workspace = { urlKey: URL_KEY, id: 'ws-1' };
  req.session = { accountId: sessionAccount, workspaces: [] };
  next();
}

async function serve(router) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(router);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

/** The tracker's words for a ticket, as the session's binding reads them (a stand-in: no tracker is called). */
const readTicket = async (_ctx, ref) => (ref === 'LIN-NOPE' ? null : { identifier: ref, description: 'The person asked for this.', state: { type: 'started', name: 'In Progress' }, parent: null });
// LIN-4503: a child task's ticket goes through the outward port; this test's tracker is the in-memory one, never the network.
const outward = createFakeTracker();

const pagesRoutes = () => {
  const deps = {
    workspaceFromUrl: session,
    recordsStore: store,
    accountStore: { resolveCanonicalAccountId: async (id) => id },
    listPeople: people,
    readTicket,
    tracker: outward.tracker,
  };
  return [
    createTaskRecordsRoutes(deps),
    createProjectPageRoutes({ ...deps, getDeployInfo: () => ({}), getOpenRouterSource: () => null }),
  ];
};

/** A ticket's task record, made the way the store makes it: through ensureTask, with the tracker's words. */
async function makeTicketTask(ticket = TICKET) {
  const r = await store.ensureTask(URL_KEY, { identifier: ticket, asked: 'The person asked for this.', closed: false, closedReason: null }, { by: 'person:acc-john' });
  return r.id;
}

/** Add a record through the store's own add (the test's fixture, not a writer under test). */
async function addFinding(says, extra = {}, at = undefined) {
  return store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says, how: 'a test' }, links: {}, to: 'project', ...extra }, { by: 'implementation', ...(at ? { at } : {}) });
}

describe('the task page: the Records section', () => {
  test('a ticket with no task record has no records and no forms to add to', () => {
    const html = renderTaskRecordsSection({ views: [], identifier: TICKET, urlKey: URL_KEY, canAct: false });
    assert.match(html, /data-testid="task-records-none"/);
    assert.doesNotMatch(html, /task-record-add-form/);
  });

  test('a ticketless child task reads "no ticket yet", never as queued work', async () => {
    const taskId = await makeTicketTask();
    await store.add(URL_KEY, { kind: 'task', state: 'open', fields: { 'done-when': 'the thing is done' }, links: {}, in: taskId }, { by: 'person:acc-john' });
    const views = await store.viewsOf(URL_KEY, await store.find(URL_KEY, { inRef: taskId }));
    const html = renderTaskRecordsSection({ views, identifier: TICKET, urlKey: URL_KEY, canAct: true });
    assert.match(html, /data-testid="task-record-no-ticket"[^>]*>no ticket yet</);
    assert.match(html, /data-kind="task"/);
  });

  test('a signed-in person gets the end, supersede, add and child forms; a guest renders none', async () => {
    const taskId = await makeTicketTask();
    await store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'check the footer' }, links: {}, in: taskId, to: 'project' }, { by: 'implementation' });
    await store.add(URL_KEY, { kind: 'lesson', state: 'holds', fields: { says: 'a lesson' }, links: {}, in: taskId }, { by: 'implementation' });
    const views = await store.viewsOf(URL_KEY, await store.find(URL_KEY, { inRef: taskId }));
    const member = renderTaskRecordsSection({ views, identifier: TICKET, urlKey: URL_KEY, canAct: true });
    assert.match(member, /data-testid="task-record-end-form"/);
    assert.match(member, /data-testid="task-record-supersede-form"/);
    assert.match(member, /data-testid="task-record-add-form"/);
    assert.match(member, /data-testid="task-record-child-form"/);
    const readOnly = renderTaskRecordsSection({ views, identifier: TICKET, urlKey: URL_KEY, canAct: false });
    assert.doesNotMatch(readOnly, /<form/);
  });

  test('the section has its own grid area in both templates, and a guest page is refused records outright', async () => {
    const taskId = await makeTicketTask();
    const views = await store.viewsOf(URL_KEY, await store.find(URL_KEY, { inRef: taskId }));
    const model = { identifier: TICKET, title: 'Footer', issueId: null, tracker: null, status: 'open', sentence: 'x', live: false, sessions: [], stages: [], brief: null, recap: null, evidence: null, details: null };
    const html = renderTaskPage(model, { viewer: 'owner', urlKey: URL_KEY, records: { views, canAct: true } });
    assert.match(html, /class="[^"]*task-records[^"]*"/);
    const css = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../public/task-page.css', import.meta.url), 'utf8'));
    const areaRows = [...css.matchAll(/"records records"/g)].length;
    assert.equal(areaRows, 2, 'both grid templates name the records row');
    assert.match(css, /\.task-records \{ grid-area: records; \}/);
    assert.throws(() => renderTaskPage(model, { viewer: 'guest', urlKey: URL_KEY, records: { views, canAct: false } }), /not drawn for a guest/);
  });
});

describe('the task page for a ticket with no task record yet', () => {
  test('a signed-in member gets the add forms; a page GET makes no task, the first POST does', async () => {
    const loader = {
      async loadTaskPage() {
        return { model: { identifier: TICKET, title: 'Footer', issueId: null, tracker: null, status: 'open', sentence: 'x', live: false, sessions: [], stages: [], brief: null, recap: null, evidence: null, details: null }, taskState: null };
      },
    };
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(createTaskPageRoutes({
      workspaceFromUrl: session, getOpenRouterSource: () => null, getDeployInfo: () => ({}), loader,
      workspaceOwnerCheck: async () => ({ status: 'member' }), recordsStore: store, now: () => new Date(),
    }));
    app.use(createTaskRecordsRoutes({ workspaceFromUrl: session, recordsStore: store, accountStore: { resolveCanonicalAccountId: async (id) => id }, listPeople: people, readTicket, tracker: outward.tracker }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;

    const page = await fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}`);
    const html = await page.text();
    assert.equal(page.status, 200, 'the task page renders');
    assert.match(html, /data-testid="task-record-add-form"/, 'the add form is offered before the task exists');
    assert.match(html, /data-testid="task-record-child-form"/, 'and the child-task form');
    assert.equal(await store.taskForTicket(URL_KEY, TICKET), null, 'a page GET makes no task');
    assert.equal((await store.find(URL_KEY, { kind: 'task' })).length, 0);

    const add = await fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}/records`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ kind: 'question', text: 'who owns the footer?', to: 'project' }),
    });
    assert.equal(add.status, 303);
    assert.ok(await store.taskForTicket(URL_KEY, TICKET), 'the first write made the ticket task');
    const after = await (await fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}`)).text();
    assert.match(after, /who owns the footer\?/, 'the record is on the page after the write');
  });
});

describe('a records-store failure costs the records, not the page', () => {
  test('the task page still renders, with no Records section, when the records read throws', async () => {
    const loader = {
      async loadTaskPage() {
        return { model: { identifier: TICKET, title: 'Footer', issueId: null, tracker: null, status: 'open', sentence: 'x', live: false, sessions: [], stages: [], brief: null, recap: null, evidence: null, details: null }, taskState: null };
      },
    };
    const broken = { taskForTicket: async () => { throw new Error('records down'); } };
    const app = express();
    app.use(createTaskPageRoutes({
      workspaceFromUrl: session, getOpenRouterSource: () => null, getDeployInfo: () => ({}), loader,
      workspaceOwnerCheck: async () => ({ status: 'member' }), recordsStore: broken, now: () => new Date(),
    }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
    const quiet = mock.method(console, 'error', () => {});
    try {
      const page = await fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}`);
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.doesNotMatch(html, /data-testid="task-records"/);
      assert.match(html, /Footer/, 'the task itself is drawn');
    } finally {
      quiet.mock.restore();
    }
  });

  test("Home's waiting standing keeps its rulings and loops when the records read throws", async () => {
    const loops = [{ loopId: 'l1' }];
    const standing = createWaitingStanding({
      getLoopsForWorkspace: async () => loops,
      dispatchStore: {}, agentStatusStore: {}, enrichLoop: (l) => l,
      taskDecisionsStore: { listUnansweredForWorkspaces: async () => [], listNewestScanPerTask: async () => ({}) },
      shelvedRulingsStore: { listForWorkspaces: async () => [] },
      recordsStore: { find: async () => { throw new Error('records down'); } },
    });
    const out = await standing({ urlKey: URL_KEY, accountId: ACCOUNT });
    assert.deepEqual(out.records, []);
    assert.ok(out.ruling, 'the ruling standing is still there');
    const brokenCanonical = createWaitingStanding({
      getLoopsForWorkspace: async () => [],
      dispatchStore: {}, agentStatusStore: {}, enrichLoop: (l) => l,
      taskDecisionsStore: { listUnansweredForWorkspaces: async () => [], listNewestScanPerTask: async () => ({}) },
      shelvedRulingsStore: { listForWorkspaces: async () => [] },
      recordsStore: store, canonicalAccountId: async () => { throw new Error('accounts down'); },
    });
    assert.deepEqual((await brokenCanonical({ urlKey: URL_KEY, accountId: ACCOUNT })).records, []);
  });
});

describe('the session writes: a signed-in person, filed by their account', () => {
  test('add a finding on the task, end it, add a child task, and refuse what the check refuses', async () => {
    const taskId = await makeTicketTask();
    await serve(pagesRoutes()[0]);
    const add = await fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}/records`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ kind: 'finding', text: 'the footer shows the wrong count', to: 'project' }),
    });
    assert.equal(add.status, 303);
    assert.match(add.headers.get('location'), new RegExp(`/task/${TICKET}#task-records$`));
    const found = await store.find(URL_KEY, { kind: 'finding', inRef: taskId });
    assert.equal(found.length, 1);
    assert.equal(found[0].by, `person:${ACCOUNT}`, 'filed by the session account, never a body field');

    const refused = await fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}/records`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ kind: 'finding', text: 'no reader given', to: 'nobody-at-all' }),
    });
    assert.equal(refused.status, 303);
    assert.match(decodeURIComponent(refused.headers.get('location')), /records_refused=/);
    assert.equal((await store.find(URL_KEY, { kind: 'finding', inRef: taskId })).length, 1, 'a refused write adds nothing');

    const end = await fetch(`${base}/workspace/${URL_KEY}/records/${found[0].id}/end`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ identifier: TICKET, state: 'declined', reason: 'not this one' }),
    });
    assert.equal(end.status, 303);
    assert.equal((await store.current(URL_KEY, found[0].id)).state, 'declined');

    const child = await fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}/records/child`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'done-when': 'the count is right on Home' }),
    });
    assert.equal(child.status, 303);
    const kids = (await store.find(URL_KEY, { kind: 'task', inRef: taskId }));
    assert.equal(kids.length, 1);
    // LIN-4503: the filing (v1) is the person's; the child's ticket then revises its ref as Harbour, so the current version is Harbour's.
    const [filed] = (await store.versionsOf(URL_KEY, [kids[0].id])).sort((a, b) => a.v - b.v);
    assert.equal(filed.by, `person:${ACCOUNT}`);
    assert.equal(kids[0].by, HARBOUR_WRITER);
    assert.equal(kids[0].fields['done-when'], 'the count is right on Home');
  });

  test('the first write on a ticket with no task record makes exactly one task for it, and its finding under it', async () => {
    assert.equal(await store.taskForTicket(URL_KEY, TICKET), null, 'no task before the first write');
    await serve(pagesRoutes()[0]);
    const add = () => fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}/records`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ kind: 'finding', text: 'first ever record on this ticket', to: 'project' }),
    });
    const res = await add();
    assert.equal(res.status, 303);
    assert.doesNotMatch(decodeURIComponent(res.headers.get('location')), /records_refused=/, 'the write is accepted, not refused');
    const taskId = await store.taskForTicket(URL_KEY, TICKET);
    assert.ok(taskId, 'the ticket now has its task');
    const task = await store.current(URL_KEY, taskId);
    assert.equal(task.fields.ref, TICKET, 'the task is the ticket\'s, by ref');
    assert.equal((await store.find(URL_KEY, { kind: 'task' })).length, 1, 'exactly one task');
    const found = await store.find(URL_KEY, { kind: 'finding', inRef: taskId });
    assert.deepEqual(found.map((f) => f.fields.says), ['first ever record on this ticket']);
    assert.equal(found[0].by, `person:${ACCOUNT}`);
    // A second write finds the task it already has: still one task.
    assert.equal((await add()).status, 303);
    assert.equal((await store.find(URL_KEY, { kind: 'task' })).length, 1, 'a second write makes no second task');
  });

  test('the first child task on a ticket with no task record makes the ticket task, then the child under it', async () => {
    assert.equal(await store.taskForTicket(URL_KEY, TICKET), null);
    await serve(pagesRoutes()[0]);
    const res = await fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}/records/child`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'done-when': 'the first child is done' }),
    });
    assert.equal(res.status, 303);
    const taskId = await store.taskForTicket(URL_KEY, TICKET);
    assert.ok(taskId, 'the ticket task was made for the child');
    const kids = await store.find(URL_KEY, { kind: 'task', inRef: taskId });
    assert.equal(kids.length, 1, 'the child task sits under the ticket task');
    assert.equal(kids[0].fields['done-when'], 'the first child is done');
    assert.equal((await store.find(URL_KEY, { kind: 'task' })).length, 2, 'the ticket task and its one child');
  });

  test('a ticket the tracker cannot read is refused by name, and makes no task', async () => {
    await serve(pagesRoutes()[0]);
    const res = await fetch(`${base}/workspace/${URL_KEY}/task/LIN-NOPE/records`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ kind: 'finding', text: 'nobody can read this ticket', to: 'project' }),
    });
    assert.equal(res.status, 303);
    assert.match(decodeURIComponent(res.headers.get('location')), /records_refused=.*LIN-NOPE/, 'the refusal names the ticket');
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-NOPE'), null);
    assert.equal((await store.find(URL_KEY, { kind: 'task' })).length, 0);
  });

  test('supersede ends the old record into a new one, and a retry makes no second record', async () => {
    const taskId = await makeTicketTask();
    const old = await store.add(URL_KEY, { kind: 'lesson', state: 'holds', fields: { says: 'the footer reads the run count' }, links: {}, in: taskId }, { by: 'implementation' });
    await serve(pagesRoutes()[0]);
    const post = () => fetch(`${base}/workspace/${URL_KEY}/records/${old.id}/supersede`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ identifier: TICKET, says: 'the footer reads the open count' }),
    });
    assert.equal((await post()).status, 303);
    assert.equal((await store.current(URL_KEY, old.id)).state, 'superseded');
    const before = (await store.find(URL_KEY, { kind: 'lesson', inRef: taskId })).length;
    // A retry of the same supersede: the old record is already ended, so nothing new is made.
    assert.equal((await post()).status, 303);
    assert.equal((await store.find(URL_KEY, { kind: 'lesson', inRef: taskId })).length, before);
  });

  test('a session with no account is refused: no write, no sign-in means no writer', async () => {
    await makeTicketTask();
    sessionAccount = null;
    await serve(pagesRoutes()[0]);
    const res = await fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}/records`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ kind: 'finding', text: 'x', to: 'project' }),
    });
    assert.equal(res.status, 403);
    assert.equal((await store.find(URL_KEY, { kind: 'finding' })).length, 0);
  });
});

describe('the project page', () => {
  test('numbers the backlog oldest first, and lists only open records addressed to the project', async () => {
    // Inserted out of order (neither oldest-first nor newest-first), with explicit times: the order must come from `at`,
    // and the middle insertion keeps both a reversed sort and no sort from passing.
    await addFinding('middle', {}, '2026-11-19T11:00:00.000Z');
    await addFinding('second', {}, '2026-11-19T12:00:00.000Z');
    await addFinding('first, oldest', {}, '2026-11-19T10:00:00.000Z');
    await store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'to a stage' }, links: {}, to: 'implementation' }, { by: 'review' });
    await serve(pagesRoutes()[1]);
    const html = await (await fetch(`${base}/workspace/${URL_KEY}/project`)).text();
    const numbers = [...html.matchAll(/data-testid="backlog-number">(\d+)\./g)].map((m) => m[1]);
    assert.deepEqual(numbers, ['1', '2', '3']);
    const itemWith = (words) => html.split('<li ').find((chunk) => chunk.includes(words)) || '';
    assert.match(itemWith('>first, oldest<'), /data-number="1"/, 'number 1 is the oldest record');
    assert.match(itemWith('>middle<'), /data-number="2"/, 'number 2 is the middle one');
    assert.match(itemWith('>second<'), /data-number="3"/, 'number 3 is the newest');
    assert.doesNotMatch(html, /to a stage/);
  });

  test('make a task: the finding is handed on into a task addressed to the project, with no ticket; retry is safe', async () => {
    const finding = await addFinding('make this a task');
    await serve(pagesRoutes()[1]);
    const post = () => fetch(`${base}/workspace/${URL_KEY}/project/records/${finding.id}/make-task`, { method: 'POST', redirect: 'manual' });
    assert.equal((await post()).status, 303);
    const ended = await store.current(URL_KEY, finding.id);
    assert.equal(ended.state, 'handed-on');
    const taskId = ended.ended.into;
    const task = await store.current(URL_KEY, taskId);
    assert.equal(task.kind, 'task');
    assert.equal(task.to, 'project');
    assert.equal(task.fields.ref, undefined, 'no tracker ticket: that is slice 2');
    assert.equal((await post()).status, 303, 'a retry after success is a no-op');
    assert.equal((await store.find(URL_KEY, { kind: 'task' })).length, 1, 'one task, not two');
    const html = await (await fetch(`${base}/workspace/${URL_KEY}/project`)).text();
    assert.match(html, /data-testid="backlog-no-ticket"/, 'the new task shows on the backlog with no ticket yet');
  });

  test('decline ends the finding as declined with its reason, and the backlog drops it', async () => {
    const finding = await addFinding('not worth doing');
    await serve(pagesRoutes()[1]);
    const res = await fetch(`${base}/workspace/${URL_KEY}/project/records/${finding.id}/decline`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ reason: 'out of scope' }),
    });
    assert.equal(res.status, 303);
    const after = await store.current(URL_KEY, finding.id);
    assert.equal(after.state, 'declined');
    assert.equal(after.ended.reason, 'out of scope');
  });

  test('a backlog cut short says so, and one that is not says nothing', () => {
    const items = [{ id: 'finding-1', kind: 'finding', state: 'open', fields: { says: 'x' }, by: 'implementation', at: 'now', number: 1, to: 'project' }];
    assert.match(renderProjectPage({ urlKey: URL_KEY, items, cut: 7, canAct: false }, {}), /data-testid="project-backlog-cut">… and 7 more/);
    assert.doesNotMatch(renderProjectPage({ urlKey: URL_KEY, items, cut: 0, canAct: false }, {}), /project-backlog-cut/);
  });

  test('the page renders its actions for a signed-in person only', () => {
    const items = [{ id: 'finding-1', kind: 'finding', state: 'open', fields: { says: 'x' }, by: 'implementation', at: 'now', number: 1, to: 'project' }];
    const member = renderProjectPage({ urlKey: URL_KEY, items, canAct: true }, {});
    assert.match(member, /data-testid="backlog-make-task-form"/);
    assert.match(member, /data-testid="backlog-decline-form"/);
    const guest = renderProjectPage({ urlKey: URL_KEY, items, canAct: false }, {});
    assert.doesNotMatch(guest, /backlog-make-task-form/);
  });
});

describe("Home's Waiting on you: the person's open records, owner only", () => {
  test('a reader with an account gets their open records; a reader without one gets none', async () => {
    await store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'for john' }, links: {}, to: `person:${ACCOUNT}` }, { by: 'review' });
    await store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'for someone else' }, links: {}, to: 'person:acc-other' }, { by: 'review' });
    const standing = createWaitingStanding({
      getLoopsForWorkspace: async () => [],
      dispatchStore: {}, agentStatusStore: {}, enrichLoop: (l) => l,
      taskDecisionsStore: { listUnansweredForWorkspaces: async () => [], listNewestScanPerTask: async () => ({}) },
      shelvedRulingsStore: { listForWorkspaces: async () => [] },
      recordsStore: store,
    });
    const mine = await standing({ urlKey: URL_KEY, accountId: ACCOUNT });
    assert.deepEqual(mine.records.map((r) => r.fields.says), ['for john']);
    const none = await standing({ urlKey: URL_KEY });
    assert.deepEqual(none.records, []);
  });

  test('the section draws the records beside the rulings, for the owner only', () => {
    const records = [{ id: 'finding-abc', kind: 'finding', state: 'open', fields: { says: 'the footer is wrong' }, in: 'task-1', to: 'person:acc-john' }];
    const owner = renderWaitingSection({ rows: [], records }, { urlKey: URL_KEY, owner: true });
    assert.match(owner, /data-testid="waiting-record"/);
    assert.doesNotMatch(owner, /class="waiting-section hidden"/, 'a record alone shows the section');
    assert.equal(renderWaitingSection({ rows: [], records }, { urlKey: URL_KEY, owner: false }), '');
    assert.match(renderWaitingRecordLine(records[0], { urlKey: URL_KEY }), /the footer is wrong/);
  });

  test('a section with no rulings and no records stays hidden', () => {
    assert.match(renderWaitingSection({ rows: [], records: [] }, { urlKey: URL_KEY, owner: true }), /class="waiting-section hidden"/);
  });
});

/** A dispatch history row as the session route reads it: its id, its kind, and the run it resumes (if a follow-up). */
const historyRow = (id, extra = {}) => ({ _id: id, id, sessionId: null, kind: 'implementation', issueIdentifier: TICKET, issueTitle: 'Footer', prompt: 'p', dispatchedAt: new Date().toISOString(), resolvedAt: new Date().toISOString(), status: 'taken', feedback: [], ...extra });

describe('the session page: the run account', () => {
  test('the account is the latest ended run record of the session loops, and draws as plain text', async () => {
    await store.openRun(URL_KEY, { id: 'row-stage-1', stage: 'implementation', lineage: 'row-stage-1', at: '2026-11-19T10:00:00.000Z' });
    await store.endRun(URL_KEY, 'row-stage-1', { state: 'done', account: 'Shipped <b>the</b> footer.', at: '2026-11-19T10:05:00.000Z' });
    const rows = { 'row-stage-1': historyRow('row-stage-1') };
    const readRow = async (_urlKey, id) => rows[id] ?? null;
    const account = await readRunAccount(store, readRow, URL_KEY, { loops: [{ loopId: 'row-stage-1' }, { loopId: 'row-unknown' }] });
    assert.equal(account, 'Shipped <b>the</b> footer.');
    assert.match(renderRunAccount(account), /Shipped &lt;b&gt;the&lt;\/b&gt; footer\./, 'escaped, never markup');
    assert.equal(renderRunAccount(null), '');
    assert.equal(await readRunAccount(store, readRow, URL_KEY, { loops: [] }), null);
  });

  test('a follow-up row reads the run it resumes: session -> row -> run, through the row\'s runRecordId', async () => {
    await store.openRun(URL_KEY, { id: 'row-origin', stage: 'implementation', lineage: 'row-origin', at: '2026-11-19T10:00:00.000Z' });
    await store.endRun(URL_KEY, 'row-origin', { state: 'done', account: 'The run said this.', at: '2026-11-19T10:05:00.000Z' });
    const rows = { 'row-follow': historyRow('row-follow', { kind: 'custom', runRecordId: 'row-origin' }) };
    const readRow = async (_urlKey, id) => rows[id] ?? null;
    assert.equal(await readRunAccount(store, readRow, URL_KEY, { loops: [{ loopId: 'row-follow' }] }), 'The run said this.');
  });

  test('a session made only of a follow-up row shows the run account through the real session route', async () => {
    await store.openRun(URL_KEY, { id: 'row-origin', stage: 'implementation', lineage: 'row-origin', at: new Date(Date.now() - 60_000).toISOString() });
    await store.endRun(URL_KEY, 'row-origin', { state: 'done', account: 'Shipped the footer on the follow-up path.', at: new Date().toISOString() });
    const follow = historyRow('row-follow', { kind: 'custom', sessionId: 'sess-follow', runRecordId: 'row-origin' });
    const origin = historyRow('row-origin', { sessionId: 'sess-origin' });
    const items = { live: [], history: [origin, follow] };
    const app = express();
    app.use(createDashboardRoutesUnplumbed_withDefaults({
      workspaceFromUrl: (req, res, next) => { req.session = { features: {}, workspaces: [{ urlKey: URL_KEY, name: 'Acme' }] }; req.workspace = { urlKey: URL_KEY }; next(); },
      dispatchQueueStore: {
        async getItemStatus(_urlKey, id) { return items.history.find((i) => i.id === id) || null; },
        async listItems() { return []; },
        async listHistory(_urlKey, opts = {}) { return { items: items.history.filter((i) => !opts.sessionId || i.sessionId === opts.sessionId) }; },
        async rowForRunRecords(_urlKey, id) { return items.history.find((i) => i._id === id) || null; },
      },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      recordsStore: store,
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      briefCacheStore: { async get() { return null; } },
      recapCacheStore: { async get() { return null; } },
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
    }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/workspace/${URL_KEY}/observation/session/sess-follow`);
    const html = await res.text();
    assert.equal(res.status, 200, 'the session page rendered');
    assert.match(html, /Shipped the footer on the follow-up path\./, 'the follow-up-only session shows its run account');
  });

  test('the session page places the account section in its header block (wiring read from the renderer source)', async () => {
    // renderSessionPage needs a full run view (a live page), which this file does not build; the page's one line that draws
    // the account is pinned here, and renderRunAccount's own output is pinned above.
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../lib/render-session.js', import.meta.url), 'utf8'));
    assert.match(src, /\$\{renderRunAccount\(runAccount\)\}/);
  });
});
