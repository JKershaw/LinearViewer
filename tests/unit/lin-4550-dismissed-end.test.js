/**
 * LIN-4550 (LIN-4546 piece 2/7): a person's dismissal ends a question `dismissed`, and only a person may write it.
 *
 * Witnesses:
 *   - through the real records route, a run's own credential (a dispatch-origin writer, not a person) ending its question
 *     `dismissed` is refused 422, naming the rule and the end an agent writes instead; the question stays open. The same run
 *     may still withdraw it (an agent's withdrawal is unchanged). A person's credential may end it `dismissed`;
 *   - Harbour (the ticket closer's writer) may not write `dismissed` either; its `withdrawn` "ticket closed" end is unchanged;
 *   - questionOutcomeOf reads the new `dismissed` end and the old `withdrawn` + "dismissed" by a person both as dismissed, and
 *     an agent's withdrawal as no outcome;
 *   - scripts/pipeline-churn.mjs (readQuestions) books old and new dismissals as dismissed and an agent's withdrawal as withdrawn.
 * The other KPI readers' witnesses sit beside their own harnesses: tests/unit/escalation-kpis.test.js,
 * tests/unit/dashboard-routes.test.js (the KPI route) and tests/unit/stability-measures.test.js (the seat).
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import express from 'express';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createTaskRecordsRoutes } from '../../routes/task-records.js';
import { renderTaskRecordsSection } from '../../lib/render-task-records.js';
import { createFakeTracker } from '../helpers/fake-records-tracker.js';
import { DISMISSED_END as CHECK_DISMISSED_END } from '../../lib/records/check.js';
import { DISMISSED_END as FACTS_DISMISSED_END } from '../../lib/records/question-facts.js';
import { createRecordWrites, HARBOUR_WRITER } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { KINDS } from '../../lib/records/check.js';
import { questionOutcomeOf, DISMISSED_REASON, TICKET_CLOSED_QUESTION_REASON, endOpenQuestionsOfTicket } from '../../lib/records/question-facts.js';
import { readQuestions } from '../../scripts/pipeline-churn.mjs';

const URL_KEY = 'lin-4550-dismissed';
const PEOPLE = [{ accountId: 'acc-john', name: 'John' }];
const JOHN = 'person:acc-john';
const TICKETS = new Map([
  ['LIN-4451', { identifier: 'LIN-4451', title: 'Footer', description: 'Make the footer show runs left.', state: { name: 'In Progress', type: 'started' }, parent: null }],
]);

const harness = createMangoTmpdir('lin-4550-dismissed-');
before(() => harness.connect());
after(() => harness.close());

describe('the question kind ends `dismissed`', () => {
  test('`dismissed` is an end of question, beside answered, withdrawn and handed-on', () => {
    assert.deepEqual(KINDS.kinds.question.ends, ['answered', 'withdrawn', 'dismissed', 'handed-on']);
  });
  test('`dismissed` is a stale end, as `withdrawn` (which old dismissals were) is', () => {
    assert.ok(KINDS.staleEnds.includes('dismissed'));
    assert.ok(KINDS.staleEnds.includes('withdrawn'));
  });
});

describe('only a person ends a question dismissed (the real records route)', () => {
  let rh;
  let runToken;
  let personToken;

  beforeEach(async () => {
    rh = await createRecordsRouteHarness({ harness, urlKey: URL_KEY, tickets: TICKETS, people: PEOPLE });
    await rh.store.openRun(URL_KEY, { id: 'row-impl', stage: 'implementation', lineage: 'row-impl', at: '2026-11-24T10:00:00.000Z' });
    runToken = await rh.mintRunToken('row-impl');
    personToken = await rh.mintPersonToken('acc-john');
  });
  afterEach(async () => { await rh.close(); });

  async function ask() {
    const r = await rh.post('/api/proxy/records', runToken, {
      kind: 'question', in: 'LIN-4451', to: 'John', run: 'row-impl',
      asks: 'The footer can show runs left or runs used. Which should it show?', options: ['runs left', 'runs used'], recommended: 'runs left',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id;
  }

  test('an agent\'s run credential ending its question dismissed is refused 422, naming the rule and withdrawal; the question stays open', async () => {
    const id = await ask();
    const r = await rh.post(`/api/proxy/records/${id}/end`, runToken, { run: 'row-impl', state: 'dismissed', reason: 'not needed any more' });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    const problem = r.body.problems.find((p) => p.field === 'state');
    assert.ok(problem, JSON.stringify(r.body));
    assert.match(problem.message, /only a person/);
    assert.match(problem.message, /'implementation'/, 'it names the writer it refused');
    assert.match(problem.message, /withdrawn/, 'it names what an agent writes instead');
    assert.deepEqual(problem.works, ['withdrawn']);
    assert.equal((await rh.store.current(URL_KEY, id)).state, 'open');
  });

  test('the same run may still withdraw its own question (an agent\'s withdrawal is unchanged)', async () => {
    const id = await ask();
    const r = await rh.post(`/api/proxy/records/${id}/end`, runToken, { run: 'row-impl', state: 'withdrawn', reason: 'answered it myself' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.state, 'withdrawn');
    assert.equal(r.body.by, 'implementation');
  });

  test('a person\'s credential ends the question dismissed, filed under the person', async () => {
    const id = await ask();
    const r = await rh.post(`/api/proxy/records/${id}/end`, personToken, { state: 'dismissed', reason: DISMISSED_REASON });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.state, 'dismissed');
    assert.equal(r.body.by, JOHN);
    const stored = await rh.store.current(URL_KEY, id);
    assert.equal(stored.state, 'dismissed');
    assert.equal(questionOutcomeOf({ state: stored.state, reason: stored.ended?.reason ?? null, by: stored.by }), 'dismissed');
  });

  test('Harbour may not write dismissed; the ticket closer\'s withdrawn "ticket closed" end is unchanged', async () => {
    const writes = createRecordWrites({ recordsStore: rh.store, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => PEOPLE });
    const id = await ask();
    const refused = await writes.end({ urlKey: URL_KEY, id, input: { state: 'dismissed', reason: DISMISSED_REASON }, by: HARBOUR_WRITER });
    assert.ok(refused.problems?.some((p) => p.field === 'state'), JSON.stringify(refused));
    assert.equal((await rh.store.current(URL_KEY, id)).state, 'open');
    const closed = await endOpenQuestionsOfTicket({ recordsStore: rh.store, writes, urlKey: URL_KEY, ticket: 'LIN-4451' });
    assert.equal(closed.ended, 1);
    const stored = await rh.store.current(URL_KEY, id);
    assert.deepEqual([stored.state, stored.ended?.reason, stored.by], ['withdrawn', TICKET_CLOSED_QUESTION_REASON, HARBOUR_WRITER]);
  });
});

describe('questionOutcomeOf counts new and old dismissals', () => {
  test('a question ended dismissed by a person is dismissed', () => {
    assert.equal(questionOutcomeOf({ state: 'dismissed', reason: DISMISSED_REASON, by: JOHN }), 'dismissed');
    assert.equal(questionOutcomeOf({ state: 'dismissed', reason: 'not for me', by: JOHN }), 'dismissed', 'the end says it, whatever the reason');
  });
  test('an old row, withdrawn with reason "dismissed" by a person, is still dismissed', () => {
    assert.equal(questionOutcomeOf({ state: 'withdrawn', reason: DISMISSED_REASON, by: JOHN }), 'dismissed');
  });
  test('an agent\'s withdrawal is no outcome, even with the reason "dismissed"', () => {
    assert.equal(questionOutcomeOf({ state: 'withdrawn', reason: 'answered it myself', by: 'implementation' }), null);
    assert.equal(questionOutcomeOf({ state: 'withdrawn', reason: DISMISSED_REASON, by: 'implementation' }), null);
  });
});

describe('scripts/pipeline-churn.mjs books old and new dismissals as dismissed', () => {
  const ended = (id, state, reason, by) => ({ id, kind: 'question', state, at: '2026-11-24T12:00:00.000Z', ended: { reason }, by });
  const records = [
    ended('question-old', 'withdrawn', DISMISSED_REASON, JOHN),
    ended('question-new', 'dismissed', DISMISSED_REASON, JOHN),
    ended('question-agent', 'withdrawn', 'answered it myself', 'implementation'),
  ];
  const get = async (path) => {
    if (path.startsWith('/records?')) return { records };
    const id = /^\/records\/([^@]+)@1$/.exec(path)?.[1];
    return { id, v: 1, at: '2026-11-24T11:00:00.000Z', run: 'row-impl', fields: { asks: 'Which?', options: ['a', 'b'] } };
  };

  test('old withdrawn+"dismissed" and new dismissed read dismissed; an agent\'s withdrawal reads withdrawn', async () => {
    const out = await readQuestions(get, 'LIN-4451');
    assert.deepEqual(Object.fromEntries(out.map((q) => [q.id, q.outcome])), {
      'question-old': 'dismissed',
      'question-new': 'dismissed',
      'question-agent': 'withdrawn',
    });
  });
});

describe('the task page\'s generic end form does not dismiss a question (it would skip the dismiss spine\'s resume)', () => {
  const TASK_URL_KEY = 'lin-4550-task-page';
  const TICKET = 'LIN-4451';
  let store;
  let server;
  let base;

  beforeEach(async () => {
    const db = harness.freshDb();
    for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
      for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
        await db.collection(collection).createIndex(spec.keySpec, spec.options);
      }
    }
    store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use((req, _res, next) => { req.workspace = { urlKey: TASK_URL_KEY, id: 'ws-1' }; req.session = { accountId: 'acc-john', workspaces: [] }; next(); });
    app.use(createTaskRecordsRoutes({
      workspaceFromUrl: (_req, _res, next) => next(),
      recordsStore: store,
      accountStore: { resolveCanonicalAccountId: async (id) => id },
      listPeople: async () => PEOPLE,
      readTicket: async (_ctx, ref) => ({ identifier: ref, description: 'The person asked for this.', state: { type: 'started', name: 'In Progress' }, parent: null }),
      tracker: createFakeTracker().tracker,
    }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  async function openQuestion() {
    const task = await store.ensureTask(TASK_URL_KEY, { identifier: TICKET, asked: 'The person asked for this.', closed: false, closedReason: null }, { by: JOHN });
    return store.add(TASK_URL_KEY, { kind: 'question', state: 'open', fields: { asks: 'Runs left or runs used?', options: ['runs left', 'runs used'], recommended: 'runs left' }, links: {}, in: task.id, to: 'person:acc-john' }, { by: 'implementation' });
  }
  const postEnd = (id, state, reason) => fetch(`${base}/workspace/${TASK_URL_KEY}/records/${id}/end`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ identifier: TICKET, state, reason }),
  });

  test('a signed-in person posting state=dismissed to the task-page end route gets the refusal and the question stays open', async () => {
    const q = await openQuestion();
    const r = await postEnd(q.id, 'dismissed', 'not needed');
    assert.equal(r.status, 303);
    assert.match(decodeURIComponent(r.headers.get('location')), /records_refused=Dismiss a question with its card's Dismiss, which tells the run that asked/);
    assert.equal((await store.current(TASK_URL_KEY, q.id)).state, 'open');
  });

  // LIN-4554 changed what this pinned: a person no longer ends a question `withdrawn` here (the asking agent's word for taking its own
  // question back), nor `answered` when it was asked of a person (their card answers it and resumes the run). The route still ends
  // a question another way: handed on into a record, and `answered` for a question to the project, which has no card.
  test('the same route still ends a question another way (handed on; answered stays a person\'s generic end where no card answers it)', async () => {
    const q = await openQuestion();
    const taken = await store.add(TASK_URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'carried on here', how: 'a test' }, links: {}, in: q.in, to: 'project' }, { by: 'implementation' });
    const r = await fetch(`${base}/workspace/${TASK_URL_KEY}/records/${q.id}/end`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ identifier: TICKET, state: 'handed-on', reason: 'carried on in a finding', into: taken.id }),
    });
    assert.equal(r.status, 303);
    assert.doesNotMatch(r.headers.get('location'), /records_refused/);
    assert.equal((await store.current(TASK_URL_KEY, q.id)).state, 'handed-on');

    const toProject = await store.add(TASK_URL_KEY, { kind: 'question', state: 'open', fields: { asks: 'Who owns it?' }, links: {}, in: q.in, to: 'project' }, { by: 'implementation' });
    const a = await postEnd(toProject.id, 'answered', 'the owner said so');
    assert.equal(a.status, 303);
    assert.doesNotMatch(a.headers.get('location'), /records_refused/);
    assert.equal((await store.current(TASK_URL_KEY, toProject.id)).state, 'answered');
  });

  test('the rendered end form for an open question has no `dismissed` option, and one for a finding is unchanged', async () => {
    const q = await openQuestion();
    const finding = await store.add(TASK_URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'a thing', how: 'a test' }, links: {}, to: 'project' }, { by: 'implementation' });
    const views = await store.viewsOf(TASK_URL_KEY, [await store.current(TASK_URL_KEY, q.id), await store.current(TASK_URL_KEY, finding.id)]);
    const html = renderTaskRecordsSection({ views, identifier: TICKET, urlKey: TASK_URL_KEY, canAct: true });
    const questionLine = html.split('<li').find((l) => l.includes(`records/${q.id}/end`));
    assert.ok(questionLine, 'the question line carries its end form');
    assert.doesNotMatch(questionLine, /<option value="dismissed"/);
    // LIN-4554: asked of a person, so their card answers it and only the asking agent withdraws it: the form offers handed on alone.
    assert.match(questionLine, /<option value="handed-on"/);
    assert.doesNotMatch(questionLine, /<option value="answered"/);
    assert.doesNotMatch(questionLine, /<option value="withdrawn"/);
  });
});

describe('the end word has one owner', () => {
  test('lib/records/question-facts.js re-exports the word lib/records/check.js defines', () => {
    assert.equal(FACTS_DISMISSED_END, 'dismissed');
    assert.equal(CHECK_DISMISSED_END, FACTS_DISMISSED_END);
  });
});
