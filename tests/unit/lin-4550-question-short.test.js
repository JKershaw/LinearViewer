/**
 * LIN-4550 (LIN-4546 piece 2/7): a question's one-line question, `short`.
 *
 * Witnesses, as the task asks:
 *   - the lead derived for a question written before `short` existed (lib/records/question-short.js), over the asks of the
 *     real question records (tests/fixtures/lin-4550-real-asks.json: the nine LIN-4546's research read, and two since), and
 *     over odd inputs: empty, no sentence end, "e.g." and its kin, a URL with dots, a list, one very long sentence;
 *   - a `short` over the cap is refused with 422 through the real records route, naming the limit, and nothing is stored cut;
 *   - the one reader of open questions (lib/open-questions.js openQuestionsFor) gives every row `short`: the field when the
 *     question has one, derived when it does not.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { KINDS } from '../../lib/records/check.js';
import { QUESTION_SHORT_MAX, deriveQuestionShort, questionShortOf } from '../../lib/records/question-short.js';
import { openQuestionsFor } from '../../lib/open-questions.js';

const REAL = JSON.parse(readFileSync(new URL('../fixtures/lin-4550-real-asks.json', import.meta.url), 'utf8')).asks;

describe('the cap is data, read from the kinds', () => {
  test('a question\'s short is a text field of the question kind, capped near 200 characters in KINDS.limits', () => {
    assert.equal(KINDS.kinds.question.fields.short, 'string');
    assert.equal(KINDS.limits.question.short, 200);
    assert.equal(QUESTION_SHORT_MAX, KINDS.limits.question.short);
  });
});

describe('the lead derived for an older question: the real asks', () => {
  test('the fixture holds the nine asks the research read', () => {
    assert.equal(REAL.filter((q) => q.researchSet).length, 9);
  });

  for (const q of REAL) {
    test(`${q.id}${q.researchSet ? '' : ' (asked after the research)'}`, () => {
      const short = deriveQuestionShort(q.asks);
      assert.equal(short, q.short);
      assert.ok(short.length <= QUESTION_SHORT_MAX, `${short.length} characters`);
    });
  }
});

describe('the lead derived for an older question: odd inputs', () => {
  test('empty, blank or not text gives an empty lead, never a throw', () => {
    assert.equal(deriveQuestionShort(''), '');
    assert.equal(deriveQuestionShort('   \n\n  '), '');
    assert.equal(deriveQuestionShort(null), '');
    assert.equal(deriveQuestionShort(undefined), '');
    assert.equal(deriveQuestionShort(42), '');
  });

  test('no sentence end: the whole ask, trimmed and on one line', () => {
    assert.equal(deriveQuestionShort('  Ship the flag now  '), 'Ship the flag now');
    assert.equal(deriveQuestionShort('Ship the flag\nnow'), 'Ship the flag now');
  });

  test('no question mark: the first sentence', () => {
    assert.equal(deriveQuestionShort('Pick a store. The rest can wait.'), 'Pick a store.');
  });

  test('"e.g." and "i.e." do not end a sentence', () => {
    assert.equal(
      deriveQuestionShort('We need a store. Should it be a document store, e.g. MangoDB, or a SQL one?'),
      'Should it be a document store, e.g. MangoDB, or a SQL one?'
    );
    assert.equal(deriveQuestionShort('Use one flag, i.e. the env one. Then ship.'), 'Use one flag, i.e. the env one.');
    assert.equal(deriveQuestionShort('Compare the two (cf. LIN-12) before merging. Done?'), 'Done?');
  });

  test('a URL with dots, or a "?" inside it, does not end a sentence', () => {
    assert.equal(
      deriveQuestionShort('The log is at https://example.com/a.b/c.html?x=1. Should we keep it?'),
      'Should we keep it?'
    );
    assert.equal(
      deriveQuestionShort('Is https://harbour.cat/api/proxy/brief/LIN-1?run=2 the right link?'),
      'Is https://harbour.cat/api/proxy/brief/LIN-1?run=2 the right link?'
    );
    assert.equal(
      deriveQuestionShort('See https://example.com/docs.v2/page.html for the detail. It is long'),
      'See https://example.com/docs.v2/page.html for the detail.'
    );
  });

  test('a list or a heading: its markers are not sentences, and a list item is its own sentence', () => {
    assert.equal(deriveQuestionShort('## Ship\n1. Ship it now\n2. Hold it a day'), 'Ship');
    assert.equal(deriveQuestionShort('Background first:\n\n- one thing\n- another\n\nWhich one?'), 'Which one?');
  });

  test('a question sentence quoted or bracketed still reads as a question', () => {
    assert.equal(deriveQuestionShort('He said so. (Should we wait?) Then go.'), '(Should we wait?)');
  });

  test('one very long sentence: within the cap, cut at a word with an ellipsis, never mid-word', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const long = `${words}?`;
    const short = deriveQuestionShort(long);
    assert.ok(short.length <= QUESTION_SHORT_MAX, `${short.length} characters`);
    assert.ok(short.endsWith('…'), short);
    const kept = short.slice(0, -1);
    assert.ok(long.startsWith(kept), 'the kept text is the start of the sentence');
    assert.equal(long[kept.length], ' ', 'the cut falls at a word boundary');
  });

  test('a long question with an aside drops the aside before it cuts', () => {
    const aside = `(${'a long aside that explains the background in far more words than a lead should carry, '.repeat(3).trim()})`;
    const asks = `Background. Should we ship the flag now ${aside}, or wait for the next release?`;
    assert.ok(asks.length > QUESTION_SHORT_MAX);
    assert.equal(deriveQuestionShort(asks), 'Should we ship the flag now, or wait for the next release?');
  });

  test('one token longer than the cap (a long URL) is cut hard, within the cap', () => {
    const url = `https://example.com/${'x'.repeat(400)}`;
    const short = deriveQuestionShort(`${url}?`);
    assert.ok(short.length <= QUESTION_SHORT_MAX, `${short.length} characters`);
    assert.ok(short.endsWith('…'));
  });
});

describe('questionShortOf: the field when written, else derived', () => {
  test('a written short wins, trimmed', () => {
    assert.equal(questionShortOf({ asks: 'Long background. Which way?', short: '  Left or right?  ' }), 'Left or right?');
  });
  test('a blank or missing short is derived from asks', () => {
    assert.equal(questionShortOf({ asks: 'Long background. Which way?', short: '   ' }), 'Which way?');
    assert.equal(questionShortOf({ asks: 'Long background. Which way?' }), 'Which way?');
    assert.equal(questionShortOf({}), '');
    assert.equal(questionShortOf(null), '');
  });
});

const URL_KEY = 'lin-4550-short';
const harness = createMangoTmpdir('lin-4550-short-');
before(() => harness.connect());
after(() => harness.close());

describe('the records route: a short over the cap is refused 422, never cut', () => {
  let rh;
  let runToken;
  const people = [{ accountId: 'acc-john', name: 'John' }];
  const tickets = new Map([
    ['LIN-4451', { identifier: 'LIN-4451', title: 'Footer', description: 'Make the footer show runs left.', state: { name: 'In Progress', type: 'started' }, parent: null }],
  ]);

  beforeEach(async () => {
    rh = await createRecordsRouteHarness({ harness, urlKey: URL_KEY, tickets, people });
    await rh.store.openRun(URL_KEY, { id: 'row-impl', stage: 'implementation', lineage: 'row-impl', at: '2026-11-24T10:00:00.000Z' });
    runToken = await rh.mintRunToken('row-impl');
  });
  afterEach(async () => { await rh.close(); });

  const question = (short) => ({
    kind: 'question', in: 'LIN-4451', to: 'John', run: 'row-impl',
    asks: 'The footer can show runs left or runs used. Which should it show?',
    options: ['runs left', 'runs used'], recommended: 'runs left', 'if-unanswered': 'show runs left',
    ...(short === undefined ? {} : { short }),
  });

  test('a short within the cap is stored as written', async () => {
    const short = `${'x'.repeat(QUESTION_SHORT_MAX - 1)}?`;
    const r = await rh.post('/api/proxy/records', runToken, question(short));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.fields.short, short);
  });

  test('a short one character over the cap is refused 422 naming the limit, and no question is stored', async () => {
    const short = `${'x'.repeat(QUESTION_SHORT_MAX)}?`;
    const r = await rh.post('/api/proxy/records', runToken, question(short));
    assert.equal(r.status, 422, JSON.stringify(r.body));
    const problem = r.body.problems.find((p) => p.field === 'short');
    assert.ok(problem, JSON.stringify(r.body));
    assert.match(problem.message, new RegExp(`${QUESTION_SHORT_MAX + 1} characters; the limit is ${QUESTION_SHORT_MAX}`));
    assert.match(problem.message, /never cut/);
    assert.equal((await rh.store.find(URL_KEY, { kind: 'question' })).length, 0, 'nothing was stored, cut or whole');
  });

  test('a revise that makes short too long is refused 422 too, and the stored short is unchanged', async () => {
    const made = await rh.post('/api/proxy/records', runToken, question('Runs left or runs used?'));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const r = await rh.post(`/api/proxy/records/${made.body.id}/revise`, runToken, { run: 'row-impl', reason: 'longer', short: 'y'.repeat(QUESTION_SHORT_MAX + 50) });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.ok(r.body.problems.some((p) => p.field === 'short'), JSON.stringify(r.body));
    const [stored] = await rh.store.find(URL_KEY, { kind: 'question' });
    assert.equal(stored.fields.short, 'Runs left or runs used?');
  });
});

describe('openQuestionsFor: every row carries short', () => {
  let rh;
  let dispatch;
  let runToken;
  const people = [{ accountId: 'acc-john', name: 'John' }];
  const tickets = new Map([
    ['LIN-4451', { identifier: 'LIN-4451', title: 'Footer', description: 'Make the footer show runs left.', state: { name: 'In Progress', type: 'started' }, parent: null }],
  ]);

  beforeEach(async () => {
    rh = await createRecordsRouteHarness({ harness, urlKey: URL_KEY, tickets, people });
    dispatch = new DispatchQueueStore({ collection: rh.db.collection('dispatch-queue'), historyCollection: rh.db.collection('dispatch-history') });
    await rh.store.openRun(URL_KEY, { id: 'row-impl', stage: 'implementation', lineage: 'row-impl', at: '2026-11-24T10:00:00.000Z' });
    runToken = await rh.mintRunToken('row-impl');
  });
  afterEach(async () => { await rh.close(); });

  test('a new question reads its written short; an older one, asked without it, reads the derived lead', async () => {
    const real = REAL.find((q) => q.id === 'question-829a69b1');
    const older = await rh.post('/api/proxy/records', runToken, {
      kind: 'question', in: 'LIN-4451', to: 'John', run: 'row-impl', asks: real.asks, options: ['small piece', 'the chain'], recommended: 'small piece',
    });
    assert.equal(older.status, 201, JSON.stringify(older.body));
    const newer = await rh.post('/api/proxy/records', runToken, {
      kind: 'question', in: 'LIN-4451', to: 'John', run: 'row-impl', short: 'Runs left or runs used in the footer?',
      asks: 'The footer can show either. Background follows. Which should it show?', options: ['runs left', 'runs used'], recommended: 'runs left',
    });
    assert.equal(newer.status, 201, JSON.stringify(newer.body));

    const rows = await openQuestionsFor({ recordsStore: rh.store, dispatchStore: dispatch, urlKey: URL_KEY, accountId: 'acc-john' });
    const byId = new Map(rows.map((r) => [r.questionId, r]));
    assert.equal(rows.length, 2);
    assert.equal(byId.get(older.body.id).short, real.short);
    assert.equal(byId.get(newer.body.id).short, 'Runs left or runs used in the footer?');
    for (const r of rows) assert.equal(typeof r.short, 'string');
  });
});
