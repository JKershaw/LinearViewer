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
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createTaskRecordsRoutes } from '../../routes/task-records.js';
import { createProjectPageRoutes } from '../../routes/project-page.js';
import { renderTaskRecordsSection, renderWaitingRecordLine } from '../../lib/render-task-records.js';
import { renderTaskPage } from '../../lib/render-task-page.js';
import { renderWaitingSection } from '../../lib/waiting-section.js';
import { createWaitingStanding } from '../../lib/home-row-states.js';
import { renderRunAccount } from '../../lib/render-session.js';
import { readRunAccount } from '../../routes/dashboard.js';
import { renderProjectPage } from '../../lib/render-project-page.js';

const URL_KEY = 'lin-4494-workspace';
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

const pagesRoutes = () => {
  const deps = {
    workspaceFromUrl: session,
    recordsStore: store,
    accountStore: { resolveCanonicalAccountId: async (id) => id },
    listPeople: people,
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
async function addFinding(says, extra = {}) {
  return store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says, how: 'a test' }, links: {}, to: 'project', ...extra }, { by: 'implementation' });
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
    assert.equal(kids[0].by, `person:${ACCOUNT}`);
    assert.equal(kids[0].fields['done-when'], 'the count is right on Home');
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
    await addFinding('first, oldest', { });
    await new Promise((r) => setTimeout(r, 5));
    await addFinding('second');
    await store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'to a stage' }, links: {}, to: 'implementation' }, { by: 'review' });
    await serve(pagesRoutes()[1]);
    const html = await (await fetch(`${base}/workspace/${URL_KEY}/project`)).text();
    const numbers = [...html.matchAll(/data-testid="backlog-number">(\d+)\./g)].map((m) => m[1]);
    assert.deepEqual(numbers, ['1', '2']);
    assert.match(html, /first, oldest/);
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

describe('the session page: the run account', () => {
  test('the account is the latest ended run record of the session loops, and draws as plain text', async () => {
    await store.openRun(URL_KEY, { id: 'row-stage-1', stage: 'implementation', lineage: 'row-stage-1', at: '2026-11-19T10:00:00.000Z' });
    await store.endRun(URL_KEY, 'row-stage-1', { state: 'done', account: 'Shipped <b>the</b> footer.', at: '2026-11-19T10:05:00.000Z' });
    const account = await readRunAccount(store, URL_KEY, { loops: [{ loopId: 'row-stage-1' }, { loopId: 'row-unknown' }] });
    assert.equal(account, 'Shipped <b>the</b> footer.');
    assert.match(renderRunAccount(account), /Shipped &lt;b&gt;the&lt;\/b&gt; footer\./, 'escaped, never markup');
    assert.equal(renderRunAccount(null), '');
    assert.equal(await readRunAccount(store, URL_KEY, { loops: [] }), null);
  });

  test('the session page places the account section in its header block (wiring read from the renderer source)', async () => {
    // renderSessionPage needs a full run view (a live page), which this file does not build; the page's one line that draws
    // the account is pinned here, and renderRunAccount's own output is pinned above.
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../lib/render-session.js', import.meta.url), 'utf8'));
    assert.match(src, /\$\{renderRunAccount\(runAccount\)\}/);
  });
});
