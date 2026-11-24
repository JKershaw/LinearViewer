/**
 * LIN-4554 (LIN-4546 piece 6/7): the task page: the question once, records that read as a person would.
 *
 * Witnesses, through the real task-page route and the real records store (a MangoDB engine), never a hand-built view:
 *   (a) an open question the page draws as a card is not listed again in Records; one the viewer gets no card for (a member) is
 *       listed there, so it shows exactly once either way;
 *   (b) a record line names the person (the name the workspace shows), a stage writer by its plain stage word, an unknown id as
 *       "someone"; its time is words inside a <time datetime> element; kinds and states are plain words; the page's text holds no
 *       raw record or person id and no ISO time (the scan covers the flags that carried ids: answered, stale, under an ended task);
 *   (c) a dismissal reads once as dismissed: the LIN-4550 end (finding-515bc015: not "dismissed — dismissed"), and a person's
 *       dismissal from before LIN-4550, stored withdrawn with reason "dismissed" (finding-9101b1fc, read through
 *       questionOutcomeOf); an agent's own withdrawal keeps "withdrawn";
 *   (d) the record-writing tools sit inside a closed fold, for the owner and for a member who can act, and nowhere for anyone else;
 *   (e) an end form offers only the ends of its own record's kind that a person may write from here: never `dismissed`, never
 *       `withdrawn` on a question (the agent's word for taking its own question back), and no `answered` on a question asked of a
 *       person (their card answers it, writing the decision and resuming the run); a question to the project or a stage has no card,
 *       so it keeps `answered`. The end route refuses what the form does not offer;
 *   (f) LIN-4159: the task page says "needs you" for a waiting stage, the word Home uses, never "waiting on you".
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { createTaskRecordsRoutes } from '../../routes/task-records.js';
import { createFakeTracker } from '../helpers/fake-records-tracker.js';
import { renderTaskRecordsSection } from '../../lib/render-task-records.js';
import { renderTaskPage } from '../../lib/render-task-page.js';
import { KINDS } from '../../lib/records/check.js';
import { stageLabel } from '../../lib/run-view.js';

const URL_KEY = 'lin-4554-workspace';
const TICKET = 'LIN-4460';
const OWNER = 'acc-john';
const MEMBER = 'acc-mia';
const NOW = new Date('2026-11-24T12:00:00.000Z');
const HOURS_AGO = (h) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const harness = createMangoTmpdir('lin-4554-records-');
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
  store = new RecordsStore({
    records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION),
    now: () => NOW,
  });
  sessionAccount = OWNER;
});

/** The people the workspace shows (lib/workspace-people.js's shape): the owner and a member, by name. */
const listPeople = async () => [{ accountId: OWNER, name: 'John' }, { accountId: MEMBER, name: 'Mia' }];
/** No asking run is live: every question row is answerable (lib/question-answers.js runStateOf reads `gone`). */
const dispatchStore = { isRunStopped: async () => false, runTailOf: async () => null };
const readTicket = async (_ctx, ref) => ({ identifier: ref, description: 'The person asked for this.', state: { type: 'started', name: 'In Progress' }, parent: null });
const outward = createFakeTracker();

function session(req, _res, next) {
  req.workspace = { urlKey: URL_KEY, id: 'ws-1' };
  req.session = sessionAccount ? { accountId: sessionAccount, workspaces: [] } : {};
  next();
}

const MODEL = { identifier: TICKET, title: 'Footer', issueId: null, tracker: null, status: 'open', sentence: 'x', live: false, sessions: [], stages: [], evidence: null, details: null };
const loader = { async loadTaskPage() { return { model: { ...MODEL }, taskState: null }; } };

/** The task page and the record routes, as server.js wires them, for `viewer` ('owner' or 'member'). */
async function serve(viewer = 'owner') {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const accountStore = { resolveCanonicalAccountId: async (id) => id };
  app.use(createTaskPageRoutes({
    workspaceFromUrl: session, getOpenRouterSource: () => null, getDeployInfo: () => ({}), loader,
    workspaceOwnerCheck: async () => ({ status: viewer }), recordsStore: store, dispatchStore, accountStore, listPeople, now: () => NOW,
  }));
  app.use(createTaskRecordsRoutes({ workspaceFromUrl: session, recordsStore: store, accountStore, listPeople, readTicket, tracker: outward.tracker }));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}

const getPage = async () => {
  const res = await fetch(`${base}/workspace/${URL_KEY}/task/${TICKET}`);
  assert.equal(res.status, 200, 'the task page renders');
  return res.text();
};

async function makeTicketTask(ticket = TICKET) {
  return (await store.ensureTask(URL_KEY, { identifier: ticket, asked: 'The person asked for this.', closed: false, closedReason: null }, { by: `person:${OWNER}` })).id;
}

/** A fixture record through the store's own add (not a writer under test). */
async function add(kind, state, fields, { inTask, to = null, by = 'implementation', at = HOURS_AGO(3), links = {} } = {}) {
  return store.add(URL_KEY, { kind, state, fields, links, ...(inTask ? { in: inTask } : {}), ...(to ? { to } : {}) }, { by, at });
}

const endAs = (id, state, reason, by, { at = HOURS_AGO(1), into = null } = {}) => store.end(URL_KEY, id, { state, reason, ...(into ? { into } : {}) }, { by, at });

/** The page's visible text: scripts and styles dropped, every tag dropped (attributes are not text), entities decoded. */
function pageText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** The Records section's markup (its mount), or '' when the page draws none. */
function recordsSection(html) {
  const at = html.indexOf('data-testid="task-records"');
  if (at < 0) return '';
  const end = html.indexOf('data-testid="task-page-track-mount"', at);
  return html.slice(at, end < 0 ? undefined : end);
}

/** One record line's markup, by its record id. */
function recordLine(html, id) {
  const m = html.match(new RegExp(`<li[^>]*data-record-id="${id}"[^>]*>([\\s\\S]*?)</li>`));
  return m ? m[0] : null;
}

/** The innermost <details> that encloses position `pos` in `html`, as its opening tag, or null. */
function enclosingDetails(html, pos) {
  const stack = [];
  const re = /<details\b[^>]*>|<\/details>/g;
  let m;
  while ((m = re.exec(html)) && m.index < pos) {
    if (m[0].startsWith('</')) stack.pop();
    else stack.push(m[0]);
  }
  return stack.length ? stack[stack.length - 1] : null;
}

/** Every record-writing form on the page, with its position. */
const writeForms = (html) => [...html.matchAll(/<form\b[^>]*data-testid="task-record-[a-z-]+-form"[^>]*>/g)].map((m) => ({ tag: m[0], pos: m.index }));

const RAW_ID = /\b(?:task|finding|question|decision|verdict|plan|change|lesson|run)-[0-9a-f]{8}\b/;
const PERSON_ID = /person:/;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

describe('(a) an open question shows once on the task page', () => {
  test('the owner meets it as a card, and Records does not list it again', async () => {
    const taskId = await makeTicketTask();
    const q = await add('question', 'open', { asks: 'Should the footer keep the old links?', options: ['Keep them', 'Drop them'], recommended: 'Keep them' }, { inTask: taskId, to: `person:${OWNER}`, by: 'review' });
    await serve('owner');
    const html = await getPage();
    const cards = html.match(new RegExp(`data-testid="question-record-card"[^>]*data-question-id="${q.id}"`, 'g')) || [];
    assert.equal(cards.length, 1, 'the question is drawn once, as its card');
    assert.equal(recordLine(recordsSection(html), q.id), null, 'Records leaves out the open question the page already draws as a card');
    assert.equal((pageText(html).match(/Should the footer keep the old links\?/g) || []).length, 1, 'its words appear once on the page');
  });

  test('a member gets no card, so Records still lists it: once either way', async () => {
    const taskId = await makeTicketTask();
    const q = await add('question', 'open', { asks: 'Should the footer keep the old links?', options: ['Keep them', 'Drop them'] }, { inTask: taskId, to: `person:${OWNER}`, by: 'review' });
    sessionAccount = MEMBER;
    await serve('member');
    const html = await getPage();
    assert.doesNotMatch(html, /data-testid="question-record-card"/, 'a member is drawn no question card');
    assert.ok(recordLine(recordsSection(html), q.id), 'so Records lists the question, the one place it shows');
  });
});

describe('(b) record lines read as a person would', () => {
  test('names, "someone", a stage word, time words in <time datetime>, plain kinds and states, and no raw id or ISO time in the text', async () => {
    const taskId = await makeTicketTask();
    const byStage = await add('finding', 'open', { says: 'The footer links 404 on a phone.', how: 'open it at 390px' }, { inTask: taskId, to: 'project', by: 'review', at: HOURS_AGO(3) });
    const byOwner = await add('finding', 'open', { says: 'Check the footer copy with Mia.', how: 'ask' }, { inTask: taskId, to: `person:${MEMBER}`, by: `person:${OWNER}`, at: HOURS_AGO(2) });
    const byGhost = await add('finding', 'open', { says: 'Someone left a note.', how: 'read it' }, { inTask: taskId, to: 'person:acc-ghost', by: 'person:acc-ghost', at: HOURS_AGO(5) });
    const handedOn = await add('finding', 'open', { says: 'Move the footer work to the design task.', how: 'see it' }, { inTask: taskId, to: 'project', by: 'review' });
    await endAs(handedOn.id, 'handed-on', 'moved to design', `person:${OWNER}`, { into: byStage.id });
    // The flags that carried raw ids: an answered question (the decision's id), a stale decision (the target's id), and a record
    // addressed to an ended child task (the task's id).
    const asked = await add('question', 'open', { asks: 'Which footer?', options: ['A', 'B'] }, { inTask: taskId, to: `person:${OWNER}`, by: 'review' });
    await add('decision', 'stands', { answer: 'A', words: 'A, plainly.' }, { inTask: taskId, by: `person:${OWNER}`, links: { answers: asked.id } });
    await endAs(asked.id, 'answered', 'answered on the card', `person:${OWNER}`);
    const lesson = await add('lesson', 'holds', { says: 'Footers are shared.' }, { inTask: taskId, by: 'review' });
    await add('decision', 'stands', { answer: 'Keep one footer.' }, { inTask: taskId, by: `person:${OWNER}`, links: { on: [`${lesson.id}@1`] } });
    await endAs(lesson.id, 'disproved', 'they are not', 'review');
    const child = await add('task', 'open', { 'done-when': 'the footer is one component' }, { inTask: taskId, by: `person:${OWNER}` });
    await endAs(child.id, 'done', 'done', `person:${OWNER}`);
    await add('finding', 'open', { says: 'Tidy the old footer CSS.', how: 'grep' }, { inTask: taskId, to: child.id, by: 'review' });

    await serve('owner');
    const html = await getPage();
    const section = recordsSection(html);
    assert.ok(section, 'the Records section is drawn');

    const stageLine = pageText(recordLine(section, byStage.id) || '');
    assert.match(stageLine, new RegExp(`\\b${stageLabel('review')}\\b`), 'a stage writer reads as its plain stage word');
    assert.doesNotMatch(stageLine, /\bby review\b/, 'not the raw stage kind');
    assert.match(recordLine(section, byStage.id), new RegExp(`<time[^>]*datetime="${HOURS_AGO(3)}"[^>]*>3 hours ago</time>`), 'its time is words, the exact time kept in <time datetime>');

    const ownerLine = pageText(recordLine(section, byOwner.id) || '');
    assert.match(ownerLine, /\bJohn\b/, 'a person writer reads as their name');
    assert.match(ownerLine, /\bMia\b/, 'and a person it is addressed to by theirs');

    const ghostLine = pageText(recordLine(section, byGhost.id) || '');
    assert.match(ghostLine, /\bsomeone\b/, 'an id the workspace cannot name reads "someone"');
    assert.doesNotMatch(ghostLine, /acc-ghost/, 'never the raw id');

    const handedLine = pageText(recordLine(section, handedOn.id) || '');
    assert.match(handedLine, /\bhanded on\b/, 'an end reads in plain words');
    assert.doesNotMatch(handedLine, /handed-on/, 'not the stored end');

    const text = pageText(html);
    assert.doesNotMatch(text, RAW_ID, `no raw record id in the page text: ${(text.match(RAW_ID) || [])[0]}`);
    assert.doesNotMatch(text, PERSON_ID, 'no raw person id in the page text');
    assert.doesNotMatch(text, ISO, `no ISO time in the page text: ${(text.match(ISO) || [])[0]}`);
  });
});

describe('(c) a dismissal reads once, as dismissed; an agent\'s own withdrawal stays withdrawn', () => {
  test('the LIN-4550 end, an old withdrawn-by-a-person "dismissed" row, and an agent\'s withdrawal', async () => {
    const taskId = await makeTicketTask();
    const fresh = await add('question', 'open', { asks: 'Rename the footer?' }, { inTask: taskId, to: `person:${OWNER}`, by: 'review' });
    await endAs(fresh.id, 'dismissed', 'dismissed', `person:${OWNER}`);
    const old = await add('question', 'open', { asks: 'Move the footer?' }, { inTask: taskId, to: `person:${OWNER}`, by: 'review' });
    await endAs(old.id, 'withdrawn', 'dismissed', `person:${OWNER}`);
    const agents = await add('question', 'open', { asks: 'Split the footer?' }, { inTask: taskId, to: `person:${OWNER}`, by: 'review' });
    await endAs(agents.id, 'withdrawn', 'no longer needed', 'review');

    await serve('owner');
    const section = recordsSection(await getPage());

    const freshLine = pageText(recordLine(section, fresh.id) || '');
    assert.equal((freshLine.match(/dismissed/gi) || []).length, 1, `a dismissal says dismissed once (finding-515bc015), got: ${freshLine}`);
    assert.match(freshLine, /\bJohn\b/, 'naming who dismissed it');

    const oldLine = pageText(recordLine(section, old.id) || '');
    assert.match(oldLine, /\bdismissed\b/i, 'a person\'s dismissal from before LIN-4550 reads dismissed (finding-9101b1fc)');
    assert.doesNotMatch(oldLine, /withdrawn/i, 'not withdrawn');
    assert.equal((oldLine.match(/dismissed/gi) || []).length, 1, 'once');

    const agentLine = pageText(recordLine(section, agents.id) || '');
    assert.match(agentLine, /\bwithdrawn\b/i, 'an agent taking its own question back keeps withdrawn');
    assert.doesNotMatch(agentLine, /dismissed/i);
  });
});

describe('(d) the record-writing tools sit in a closed fold, for those who can act only', () => {
  for (const viewer of ['owner', 'member']) {
    test(`a ${viewer} who can act finds every write form inside a closed fold`, async () => {
      const taskId = await makeTicketTask();
      await add('finding', 'open', { says: 'Check the footer.', how: 'look' }, { inTask: taskId, to: 'project', by: 'review' });
      await add('lesson', 'holds', { says: 'Footers are shared.' }, { inTask: taskId, by: 'review' });
      if (viewer === 'member') sessionAccount = MEMBER;
      await serve(viewer);
      const html = await getPage();
      const forms = writeForms(html);
      const ids = forms.map((f) => f.tag.match(/data-testid="([^"]+)"/)[1]);
      for (const want of ['task-record-add-form', 'task-record-child-form', 'task-record-end-form', 'task-record-supersede-form']) {
        assert.ok(ids.includes(want), `the ${want} is still offered to a ${viewer} who can act`);
      }
      for (const form of forms) {
        const fold = enclosingDetails(html, form.pos);
        assert.ok(fold, `${form.tag} sits inside a fold`);
        assert.match(fold, /data-testid="task-records?-tools"/, `${form.tag} sits inside the records tools fold, got ${fold}`);
        assert.doesNotMatch(fold, /\sopen(?:[\s>=])/, 'and that fold is closed when the page loads');
      }
    });
  }

  test('a reader who cannot act gets no forms and no tools fold', async () => {
    const taskId = await makeTicketTask();
    await add('finding', 'open', { says: 'Check the footer.', how: 'look' }, { inTask: taskId, to: 'project', by: 'review' });
    const views = await store.viewsOf(URL_KEY, await store.find(URL_KEY, { inRef: taskId }));
    const html = renderTaskRecordsSection({ views, identifier: TICKET, urlKey: URL_KEY, canAct: false, people: [], now: NOW });
    assert.doesNotMatch(html, /<form/);
    assert.doesNotMatch(html, /task-records?-tools/);
  });

  test('the fold is styled in the task page sheet with the type-size tokens', () => {
    const css = fs.readFileSync(new URL('../../public/task-page.css', import.meta.url), 'utf8');
    const rules = [...css.matchAll(/([^{}]*\.task-records?-tools[^{}]*)\{([^}]*)\}/g)];
    assert.ok(rules.length > 0, 'public/task-page.css styles the records tools fold');
    for (const [, , body] of rules) {
      const size = body.match(/font-size:\s*([^;]+)/);
      if (size) assert.match(size[1], /var\(--font-size-/, 'any font size on the fold is a --font-size-* token');
    }
  });
});

describe('(e) an end form offers only its own kind\'s ends a person may write here', () => {
  test('each kind lists its own ends; nothing offers dismissed; a question never offers withdrawn, and answered only when no card answers it', async () => {
    const taskId = await makeTicketTask();
    const made = {};
    made.finding = await add('finding', 'open', { says: 'Check the footer.', how: 'look' }, { inTask: taskId, to: 'project', by: 'review' });
    made.question = await add('question', 'open', { asks: 'Which footer?' }, { inTask: taskId, to: `person:${MEMBER}`, by: 'review' });
    const projectQuestion = await add('question', 'open', { asks: 'Who owns the footer?' }, { inTask: taskId, to: 'project', by: 'review' });
    made.decision = await add('decision', 'stands', { answer: 'One footer.' }, { inTask: taskId, by: `person:${OWNER}` });
    made.lesson = await add('lesson', 'holds', { says: 'Footers are shared.' }, { inTask: taskId, by: 'review' });
    made.change = await add('change', 'open', { ref: 'https://github.com/o/r/pull/1' }, { inTask: taskId, by: 'implementation' });
    const views = await store.viewsOf(URL_KEY, await store.find(URL_KEY, { inRef: taskId }));
    const html = renderTaskRecordsSection({ views, identifier: TICKET, urlKey: URL_KEY, canAct: true, people: await listPeople(), now: NOW });
    for (const [kind, rec] of Object.entries(made)) {
      const line = recordLine(html, rec.id);
      assert.ok(line, `the ${kind} is listed`);
      const offered = [...(line.match(/name="state"[\s\S]*?<\/select>/)?.[0] || '').matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
      for (const end of offered) assert.ok(KINDS.kinds[kind].ends.includes(end), `the ${kind}'s end form offers only its own ends (got ${end})`);
      assert.ok(!offered.includes('dismissed'), `the ${kind}'s end form never offers dismissed`);
      if (kind === 'question') {
        assert.deepEqual(offered, ['handed-on'], 'a question asked of a person ends from here only as handed on: answered and dismissed go through their card, withdrawn is the agent\'s word');
      } else {
        assert.ok(offered.length > 0, `the ${kind} has an end to offer`);
      }
    }
    const projectLine = recordLine(html, projectQuestion.id);
    const projectOffered = [...(projectLine.match(/name="state"[\s\S]*?<\/select>/)?.[0] || '').matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(projectOffered, ['answered', 'handed-on'], 'a question to the project has no card, so a person may still settle it here; never withdrawn');
  });

  for (const [state, to] of [['withdrawn', 'project'], ['withdrawn', `person:${OWNER}`], ['answered', `person:${OWNER}`]]) {
    test(`the end route refuses a person ending a question to ${to} ${state} from the task page, and the question stays open`, async () => {
      const taskId = await makeTicketTask();
      const q = await add('question', 'open', { asks: 'Which footer?' }, { inTask: taskId, to, by: 'review' });
      await serve('owner');
      const res = await fetch(`${base}/workspace/${URL_KEY}/records/${q.id}/end`, {
        method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ identifier: TICKET, state, reason: 'not needed' }),
      });
      assert.equal(res.status, 303);
      assert.match(res.headers.get('location') || '', /records_refused=/, `ending a question ${state} from the page is refused`);
      assert.equal((await store.current(URL_KEY, q.id)).state, 'open', 'the question stays open');
    });
  }
});

describe('(f) LIN-4159: the task page says "needs you" for a waiting stage', () => {
  test('the stage strip and its attempts say "needs you", never "waiting on you"', () => {
    const stage = { id: 'loop-1', kind: 'implementation', label: 'Build', state: 'waiting', attempts: 1, open: true, checkIns: [], startedAt: HOURS_AGO(1),
      sessions: [{ state: 'waiting', loopId: 'loop-1', runId: null, message: 'asked a question', links: [], endedAt: null }] };
    const html = renderTaskPage({ ...MODEL, stages: [stage] }, { viewer: 'owner', urlKey: URL_KEY, now: NOW });
    const track = html.slice(html.indexOf('data-testid="task-page-track-mount"'));
    assert.match(track, /data-testid="task-page-stage-state">needs you</, 'the stage reads "needs you", Home\'s word');
    assert.doesNotMatch(pageText(html), /waiting on you/i, 'the task page never says "waiting on you"');
  });
});
