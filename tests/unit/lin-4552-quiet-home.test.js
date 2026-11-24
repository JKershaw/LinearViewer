/**
 * LIN-4552 (LIN-4546 piece 4/7): a quiet Home. "Waiting on you" is said once; the count line, the nav badge and the live fragment
 * say one number, the questions; the owner's open findings are "Notes for you" below the questions, short lines naming their task,
 * clearable, folded after five and live in the fragment with a batched lookup; the source notice is one small line; Home and the
 * task page say one word per state; a member sees no section; nothing raw in Home's text.
 *
 * In process, on the real records store (a MangoDB engine) and the real renderers, routes and browser modules (over the shared fake
 * DOM). Each test names the change that makes it fail.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { createWaitingStanding } from '../../lib/home-row-states.js';
import { openFindingsFor } from '../../lib/open-questions.js';
import { renderWaitingSection, waitingFragmentOf, NOTES_SHOWN } from '../../lib/waiting-section.js';
import { buildInProgressCountParts, questionsWords } from '../../lib/task-board-view.js';
import { renderPage } from '../../lib/render.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { renderHomeStatus, renderTaskStatus } from '../../lib/render-task-page.js';
import { STATE_WORDS } from '../../lib/task-state.js';
import { createDashboardRulingsRoutes } from '../../routes/dashboard-rulings.js';
import { createTaskRecordsRoutes } from '../../routes/task-records.js';
import { createFakeDom } from './helpers/fake-dom.js';
import { holdsCard } from '../../public/question-records.js';

const URL_KEY = 'lin-4552-ws';
const OWNER = 'acc-owner';
const harness = createMangoTmpdir('lin-4552-');
let db;
let store;
let dispatchStore;
let server = null;

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
  dispatchStore = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
});

const writes = () => createRecordWrites({
  recordsStore: store, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation', 'review'],
  listPeople: async () => [{ accountId: OWNER, name: 'Owner' }],
});

/** `n` open questions to the owner, each long enough to read as a real ask. */
async function seedQuestions(n, urlKey = URL_KEY) {
  for (let i = 0; i < n; i++) {
    const out = await writes().add({
      urlKey, kind: 'question', by: 'implementation', run: null,
      input: { asks: `Should piece ${i} ship now? It touches the shared card.\n\n- one\n- two`, options: ['yes', 'no'], recommended: 'yes', 'if-unanswered': 'wait', to: `person:${OWNER}` },
    });
    assert.ok(!out.problems, JSON.stringify(out.problems));
  }
}

/** `m` open findings to the owner, spread over `tickets` (each made a task that claims it), and one to someone else. */
async function seedFindings(m, tickets = ['LIN-7', 'LIN-8']) {
  const taskIds = [];
  for (const ticket of tickets) taskIds.push((await store.ensureTask(URL_KEY, { identifier: ticket, title: ticket, closed: false }, { by: 'harbour' })).id);
  const ids = [];
  for (let i = 0; i < m; i++) {
    const out = await writes().add({
      urlKey: URL_KEY, kind: 'finding', by: 'review', run: null,
      input: { says: `Note ${i} says the footer is wrong. It uses the old token (see lib/x.js).`, to: `person:${OWNER}`, in: taskIds[i % taskIds.length] },
    });
    assert.ok(!out.problems, JSON.stringify(out.problems));
    ids.push(out.record.id);
  }
  await writes().add({ urlKey: URL_KEY, kind: 'finding', by: 'review', run: null, input: { says: 'Not yours.', to: 'project' } });
  return { ids, taskIds };
}

const TITLES = { 'LIN-7': 'Fix the footer', 'LIN-8': 'Tidy the header' };
const titlesOf = (tickets) => Object.fromEntries(tickets.filter((t) => TITLES[t]).map((t) => [t, TITLES[t]]));

const standing = () => createWaitingStanding({
  getLoopsForWorkspace: async () => [], dispatchStore, agentStatusStore: {}, enrichLoop: (l) => l,
  recordsStore: store, canonicalAccountId: async (id) => id,
});

/** The visible text of some markup: tags dropped, entities for quotes undone, whitespace folded. */
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** The rulings feed's GET handler (the badge's source), the way express calls it. */
async function feedFor(urlKey) {
  const router = createDashboardRulingsRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    sessionsFeedCache: { keyFor: (_ws, ns) => ns, get: async (_k, fn) => fn(), clear() {} },
    mergeLoops: async () => [],
    recordsStore: store,
    dispatchQueueStore: dispatchStore,
    accountStore: { resolveCanonicalAccountId: async (id) => id },
  });
  const layer = router.stack.find((l) => l.route?.path === '/workspace/:urlKey/api/dashboard/rulings');
  const handle = layer.route.stack.at(-1).handle;
  let body = null;
  const res = {
    headersSent: false, writableEnded: false,
    status() { return this; }, setHeader() {}, writeHead() { return this; }, write() {}, flushHeaders() {}, on() {},
    json(b) { body = b; this.headersSent = true; this.writableEnded = true; return this; },
    send(b) { body = typeof b === 'string' ? JSON.parse(b) : b; this.headersSent = true; this.writableEnded = true; return this; },
    end(b) { if (b) body = JSON.parse(b); this.writableEnded = true; },
  };
  await handle({ session: { accountId: OWNER, workspaces: [{ urlKey, name: 'WS' }] }, params: { urlKey }, on() {} }, res);
  return body;
}

describe('one number: N questions plus M findings', () => {
  test('the count line, the badge\'s feed and the fragment\'s count all say N; the section draws N cards and M notes', async () => {
    // Fails before LIN-4552: the fragment counted the standing's rows plus the questions (2N), and the count line said "N waiting on you".
    const N = 3;
    const M = 7;
    await seedQuestions(N);
    await seedFindings(M);
    const waiting = await standing()({ urlKey: URL_KEY, accountId: OWNER, titlesOf });
    assert.equal(waiting.questions.length, N);
    assert.equal(waiting.records.length, M, 'the owner\'s notes, not the project\'s');
    assert.equal(waiting.ruling.rows.length, N);

    const fragment = waitingFragmentOf({ rows: waiting.ruling.rows, questions: waiting.questions, records: waiting.records }, { urlKey: URL_KEY });
    assert.equal(fragment.count, N, 'the fragment counts the questions once, and no note');
    assert.equal((fragment.html.match(/data-testid="question-record-card"/g) || []).length, N);
    assert.equal((fragment.html.match(/data-testid="waiting-note"/g) || []).length, M);

    const parts = buildInProgressCountParts([], new Map(), { rulingCount: waiting.ruling.rows.length });
    assert.deepEqual(parts.map((p) => p.text), [`${N} questions`]);

    const feed = await feedFor(URL_KEY);
    assert.equal(feed.workspaceCount, N, 'the badge\'s number is the questions; findings are never in it (finding-68be8578)');
  });

  test('the badge and the count line word a number the same way, on the server and in the browser', () => {
    // Fails when either copy drifts: the badge (public/common.js, a classic file) cannot import the server's.
    const src = readFileSync(new URL('../../public/common.js', import.meta.url), 'utf8');
    const start = src.indexOf('window.questionsWords = function questionsWords(');
    const end = src.indexOf('\n};', start);
    const sandbox = {};
    new Function('window', src.slice(start, end + 3))(sandbox);
    for (const n of [0, 1, 2, 11]) assert.equal(sandbox.questionsWords(n), questionsWords(n), String(n));
    assert.equal(questionsWords(1), '1 question');
    assert.equal(questionsWords(4), '4 questions');
    const nav = renderNavBar({ workspaces: [], urlKey: URL_KEY, featureFlags: { runControls: true } });
    assert.match(nav, /data-testid="nav-questions-badge"[^>]*href="\/workspace\/lin-4552-ws\/observation\?view=rulings"/);
  });
});

describe('Home says "Waiting on you" once, and nothing raw', () => {
  test('the whole owner Home, with questions, notes and the badge, says it once, with no raw id, person id or ISO time in its text', async () => {
    // Fails before LIN-4552: the count line ("N waiting on you"), the badge ("waiting on you") and the header all said it, and a
    // record line printed "in task-…" and "to person:…".
    await seedQuestions(2);
    await seedFindings(8);
    const waiting = await standing()({ urlKey: URL_KEY, accountId: OWNER, titlesOf });
    const homeView = { inProgressTrees: [], trees: [], upNext: [], recent: { nodes: [], remaining: 0 }, waiting: { rows: waiting.ruling.rows, ids: [], contextIds: [], questions: waiting.questions, records: waiting.records } };
    const html = renderPage([], [], [], 'Org', { urlKey: URL_KEY, workspaces: [], featureFlags: { runControls: true }, homeView, rowStates: new Map(), rulingCount: waiting.ruling.rows.length });
    const text = textOf(html.slice(html.indexOf('<body')));
    assert.equal((text.match(/waiting on you/gi) || []).length, 1, 'said once, by the section header');
    assert.match(text, /2 questions/, 'the count line names what it counts');
    assert.match(text, /Notes for you/);
    assert.doesNotMatch(text, /\btask-[0-9a-f]{8}\b/, 'no task record id');
    assert.doesNotMatch(text, /\bfinding-[0-9a-f]{8}\b/, 'no finding id');
    assert.doesNotMatch(text, /person:/, 'no person id');
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'no ISO time');
    assert.doesNotMatch(text, /needs you/, 'the cards carry no state words under a header that already says it');
  });

  test('a member sees no section and no notes', async () => {
    await seedFindings(2);
    const waiting = await standing()({ urlKey: URL_KEY, accountId: OWNER, titlesOf });
    assert.equal(renderWaitingSection({ questions: [], records: waiting.records }, { urlKey: URL_KEY, owner: false }), '');
    const homeView = { inProgressTrees: [], trees: [], upNext: [], recent: { nodes: [], remaining: 0 }, waiting: { rows: [], ids: [], contextIds: [], questions: [], records: waiting.records } };
    const html = renderPage([], [], [], 'Org', { urlKey: URL_KEY, workspaces: [], featureFlags: {}, homeView, rulingCount: 0 });
    assert.doesNotMatch(html, /waiting-on-you|waiting-note|Notes for you/);
  });
});

describe('Notes for you: short lines naming their task', () => {
  test('each line links its task by identifier and title, leads with the note\'s first sentence whole, and keeps the rest behind a fold', async () => {
    // Fails before LIN-4552: the line was "Finding in task-… · to person:…" and a cut preview, with no link.
    await seedFindings(2);
    const notes = await openFindingsFor({ recordsStore: store, urlKey: URL_KEY, accountId: OWNER, titlesOf });
    const html = renderWaitingSection({ questions: [], records: notes }, { urlKey: URL_KEY, owner: true });
    assert.match(html, /<a class="waiting-note-task" href="\/workspace\/lin-4552-ws\/task\/LIN-7" data-testid="waiting-note-task"><span class="waiting-note-id" data-testid="waiting-note-id">LIN-7<\/span> <span class="waiting-note-title" data-testid="waiting-note-title">Fix the footer<\/span><\/a>/);
    assert.match(html, /data-testid="waiting-note-says">Note 1 says the footer is wrong\.</, 'the first sentence, whole; the newest note first');
    assert.match(html, /data-testid="waiting-note-full"><p>Note 1 says the footer is wrong\. It uses the old token \(see lib\/x\.js\)\.<\/p>/);
    assert.match(html, /data-key="record:finding-[0-9a-f]{8}"/, 'keyed for the live merge');
  });

  test('a note whose task claims no ticket reads without a link and never names the record', async () => {
    const out = await writes().add({ urlKey: URL_KEY, kind: 'finding', by: 'review', run: null, input: { says: 'A project-wide note.', to: `person:${OWNER}` } });
    assert.ok(!out.problems);
    const notes = await openFindingsFor({ recordsStore: store, urlKey: URL_KEY, accountId: OWNER, titlesOf });
    assert.equal(notes[0].ticket, null);
    const html = renderWaitingSection({ questions: [], records: notes }, { urlKey: URL_KEY, owner: true });
    assert.doesNotMatch(html, /waiting-note-task/);
    assert.doesNotMatch(html, /waiting-note-fold/, 'one sentence: nothing more to fold');
    assert.match(html, /data-testid="waiting-note-says">A project-wide note\.</);
  });

  test('the first five show; the rest are folded behind "show N more"', () => {
    const notes = Array.from({ length: 8 }, (_, i) => ({ recordId: `finding-0000000${i}`, says: `Note ${i}.`, lead: `Note ${i}.`, ticket: 'LIN-7', title: 'Fix the footer' }));
    const html = renderWaitingSection({ questions: [], records: notes }, { urlKey: URL_KEY, owner: true });
    assert.equal(NOTES_SHOWN, 5);
    assert.equal((html.match(/data-testid="waiting-note"[^>]*data-folded="true"/g) || []).length, 3);
    assert.match(html, /data-shown="5" data-expanded="false"/);
    assert.match(html, /data-testid="waiting-notes-more" aria-expanded="false"><span data-testid="waiting-notes-more-closed">show <span data-testid="waiting-notes-hidden-count">3<\/span> more<\/span><span class="hidden" data-testid="waiting-notes-more-open">show fewer<\/span>/);
  });

  test('the notes are read in a fixed number of store reads: 50 findings cost what 1 does', async () => {
    // Fails with a per-finding ticket lookup (ticketOfTask in a loop): the reads would grow with the findings.
    const counting = () => {
      const counts = { reads: 0 };
      const wrap = (coll) => new Proxy(coll, {
        get(target, prop) {
          const v = target[prop];
          if (typeof v !== 'function') return v;
          if (['find', 'findOne', 'aggregate', 'countDocuments'].includes(prop)) return (...a) => { counts.reads += 1; return v.apply(target, a); };
          return v.bind(target);
        },
      });
      const counted = new RecordsStore({ records: wrap(db.collection(RECORDS_COLLECTION)), refs: wrap(db.collection(REFS_COLLECTION)), queryLog: db.collection(QUERY_LOG_COLLECTION) });
      return { counts, counted };
    };
    await seedFindings(1, ['LIN-7']);
    const one = counting();
    assert.equal((await openFindingsFor({ recordsStore: one.counted, urlKey: URL_KEY, accountId: OWNER, titlesOf })).length, 1);
    await seedFindings(49, ['LIN-7', 'LIN-8', 'LIN-9']);
    const fifty = counting();
    const notes = await openFindingsFor({ recordsStore: fifty.counted, urlKey: URL_KEY, accountId: OWNER, titlesOf });
    assert.equal(notes.length, 50);
    assert.ok(notes.every((n) => /^LIN-[789]$/.test(n.ticket)), 'every note names its ticket');
    assert.equal(fifty.counts.reads, one.counts.reads, `50 findings: ${fifty.counts.reads} reads; 1 finding: ${one.counts.reads}`);
    assert.ok(one.counts.reads <= 3, `the candidates, their versions and one claims read (${one.counts.reads})`);
  });
});

describe('clear: the end route answers JSON, and form posts are unchanged', () => {
  async function serve() {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());
    const session = (req, res, next) => { req.workspace = { urlKey: URL_KEY, id: 'ws-1' }; req.session = { accountId: OWNER, workspaces: [] }; next(); };
    app.use(createTaskRecordsRoutes({ workspaceFromUrl: session, recordsStore: store, accountStore: { resolveCanonicalAccountId: async (id) => id }, listPeople: async () => [{ accountId: OWNER, name: 'Owner' }] }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    return `http://127.0.0.1:${server.address().port}`;
  }
  const postJson = (base, id, body) => fetch(`${base}/workspace/${URL_KEY}/records/${id}/end`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });

  test('a JSON clear ends the finding done and answers 200 JSON, with no identifier', async () => {
    // Fails before LIN-4552: the route demanded a form's `identifier` (404 "Task not found") and answered only with a redirect.
    const { ids } = await seedFindings(1);
    const base = await serve();
    const res = await postJson(base, ids[0], { state: 'done', reason: 'cleared from Home' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, id: ids[0], state: 'done' });
    const after = await store.current(URL_KEY, ids[0]);
    assert.equal(after.state, 'done');
    assert.equal(after.ended.reason, 'cleared from Home');
    assert.deepEqual(await openFindingsFor({ recordsStore: store, urlKey: URL_KEY, accountId: OWNER }), [], 'the note leaves Home');
  });

  test('a JSON refusal answers its status and first problem; a missing record is a 404', async () => {
    const { ids } = await seedFindings(1);
    const base = await serve();
    const bad = await postJson(base, ids[0], { state: 'answered' });
    assert.equal(bad.status, 422);
    assert.match((await bad.json()).error, /\S/);
    const missing = await postJson(base, 'finding-deadbeef', { state: 'done' });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, 'That record is not in this workspace');
  });

  test('a form post still needs its identifier and still answers 303 back to the task page', async () => {
    const { ids } = await seedFindings(1);
    const base = await serve();
    const noId = await fetch(`${base}/workspace/${URL_KEY}/records/${ids[0]}/end`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ state: 'done', reason: 'fixed' }) });
    assert.equal(noId.status, 404);
    const res = await fetch(`${base}/workspace/${URL_KEY}/records/${ids[0]}/end`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ state: 'done', reason: 'fixed', identifier: 'LIN-7' }) });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /\/task\/LIN-7#task-records$/);
  });
});

// ── The browser half, over the shared fake DOM ─────────────────────────────────

let instance = 0;
const notesModule = () => import(`../../public/waiting-notes.js?world=${instance += 1}`);
const note = (i, extra = {}) => ({ recordId: `finding-0000${String(i).padStart(4, '0')}`, says: `Note ${i}.`, lead: `Note ${i}.`, ticket: 'LIN-7', title: 'Fix the footer', ...extra });
const sectionFor = (notes, questions = []) => renderWaitingSection({ questions, records: notes }, { urlKey: URL_KEY, owner: true });

function notesWorld(notes) {
  const dom = createFakeDom();
  dom.parse(sectionFor(notes), dom.document.body);
  const body = dom.document.querySelector('.waiting-body');
  const lines = () => [...body.querySelectorAll('[data-testid="waiting-note"]')];
  return { dom, body, lines, keys: () => lines().map((l) => l.dataset.key) };
}

describe('the notes stay current: the live merge (finding-d4767b81)', () => {
  test('a new note appears once, in server order; a gone one leaves; a kept one is the same node', async () => {
    // Fails before LIN-4552: the fragment carried no notes and nothing merged them, so a note waited for a reload.
    const { mergeNotes } = await notesModule();
    const w = notesWorld([note(1), note(2)]);
    const kept = w.lines()[0];
    mergeNotes(w.body, sectionFor([note(3), note(1)]));
    assert.deepEqual(w.keys(), ['record:finding-00000003', 'record:finding-00000001']);
    assert.equal(w.lines()[1], kept, 'kept, not redrawn');
    mergeNotes(w.body, sectionFor([note(3), note(1)]));
    assert.equal(w.lines().length, 2, 'appears once');
  });

  test('a line being cleared, or read with its fold open, is held across a repaint that no longer lists it', async () => {
    // Fails if the notes merge does not ask the one keep-a-card rule (public/question-records.js holdsCard).
    const { mergeNotes } = await notesModule();
    const w = notesWorld([note(1, { says: 'Note 1. More words here.' }), note(2)]);
    w.lines()[0].querySelector('[data-testid="waiting-note-fold"]').setAttribute('open', '');
    w.lines()[1].querySelector('[data-testid="waiting-note-clear"]').disabled = true;
    assert.equal(holdsCard(w.lines()[0]), true);
    mergeNotes(w.body, sectionFor([]));
    assert.equal(w.lines().length, 2);
  });

  test('the fold follows the merge: past five, the extra lines are folded and the control counts them', async () => {
    const { mergeNotes, toggleNotesFold } = await notesModule();
    const w = notesWorld([note(1)]);
    const more = () => w.body.querySelector('[data-testid="waiting-notes-more"]');
    // The label that shows: the words are the server's, the browser sets the number and picks the label.
    const label = () => [...more().children].find((el) => !el.classList.contains('hidden'))?.textContent;
    mergeNotes(w.body, sectionFor([1, 2, 3, 4, 5, 6, 7].map((i) => note(i))));
    assert.equal(w.lines().filter((l) => l.dataset.folded === 'true').length, 2);
    assert.equal(label(), 'show 2 more');
    assert.equal(more().classList.contains('hidden'), false);
    toggleNotesFold(w.body.querySelector('[data-testid="waiting-notes"]'));
    assert.equal(label(), 'show fewer');
    assert.equal(more().getAttribute('aria-expanded'), 'true');
    mergeNotes(w.body, sectionFor([]));
    assert.equal(w.body.querySelector('[data-testid="waiting-notes"]').classList.contains('hidden'), true, 'an empty group hides');
  });

  test('a new question card goes in above the notes', async () => {
    const { mergeWaitingCards } = await import(`../../public/waiting-merge.js?world=${instance += 1}`);
    const w = notesWorld([note(1)]);
    const q = { questionId: 'q-1', asks: 'Which?', short: 'Which?', options: ['a'], recommended: null, ticket: 'LIN-7', title: 'Fix the footer', state: 'resumable', interactive: true };
    mergeWaitingCards(w.body, sectionFor([note(1)], [q]));
    const order = w.body.children.map((c) => c.classList.contains('waiting-question') ? 'question' : c.classList.contains('waiting-notes') ? 'notes' : 'other');
    assert.deepEqual(order, ['question', 'notes']);
  });
});

describe('clear in the browser', () => {
  test('a clear posts the end, takes the line out and is never re-added by an older response', async () => {
    const { clearNote, mergeNotes } = await notesModule();
    const w = notesWorld([note(1), note(2)]);
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ ok: true }) }; };
    try {
      const cleared = [];
      assert.equal(await clearNote(w.lines()[0], { urlKey: URL_KEY, onCleared: (k) => cleared.push(k) }), true);
      assert.equal(calls[0].url, `/workspace/${URL_KEY}/records/finding-00000001/end`);
      assert.deepEqual(JSON.parse(calls[0].init.body), { state: 'done', reason: 'cleared from Home' });
      assert.equal(calls[0].init.headers['content-type'], 'application/json');
      assert.deepEqual(w.keys(), ['record:finding-00000002']);
      assert.deepEqual(cleared, ['record:finding-00000001']);
      mergeNotes(w.body, sectionFor([note(1), note(2)]));
      assert.deepEqual(w.keys(), ['record:finding-00000002'], 'a response requested before the clear does not bring it back');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('a refused clear keeps the line, says why on it and gives the control back', async () => {
    const { clearNote } = await notesModule();
    const w = notesWorld([note(1)]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'That record changed while you were writing; reload and try again' }) });
    try {
      assert.equal(await clearNote(w.lines()[0], { urlKey: URL_KEY }), false);
      assert.equal(w.lines().length, 1);
      assert.match(w.lines()[0].querySelector('[data-testid="waiting-note-feedback"]').textContent, /changed while you were writing/);
      assert.equal(w.lines()[0].querySelector('[data-testid="waiting-note-clear"]').disabled, false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('one word per state on Home and the task page (LIN-4159)', () => {
  test('each decided state reads the same word on Home\'s opened task and the task page\'s pill, from one table', () => {
    // Fails when either pill table spells a state its own way.
    const model = { sentence: 'x', sessions: [{ state: 'done' }], stages: [] };
    for (const state of ['needs-you', 'parked', 'failed', 'done', 'backlog']) {
      const home = renderHomeStatus(model, { taskState: { state } }).match(/data-testid="home-task-status-pill"><span[^>]*><\/span>([^<]*)</)?.[1];
      const page = renderTaskStatus(model, { taskState: { state } }).match(/data-testid="task-page-status-pill"><span[^>]*><\/span>([^<]*)</)?.[1];
      assert.equal(home, STATE_WORDS[state], `Home: ${state}`);
      assert.equal(page, STATE_WORDS[state], `task page: ${state}`);
    }
    assert.equal(STATE_WORDS['needs-you'], 'needs you');
    for (const state of ['running', 'queued']) {
      const page = renderTaskStatus(model, { taskState: { state } }).match(/data-testid="task-page-status-pill"><span[^>]*><\/span>([^<]*)</)?.[1];
      assert.equal(page, STATE_WORDS[state], `task page: ${state} (Home's opened task leaves these to its run box)`);
    }
  });
});
