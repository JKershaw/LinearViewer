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
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
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
