/**
 * LIN-4504 (slice 2, P4), session 1: plans flip to records.
 *
 * Witnesses:
 *   - find's array form: one query for many tasks; `[]` matches nothing; `null` still means the project and a string
 *     one task (the widened guard, tried);
 *   - planFactsForTickets: a fixed number of store reads for 1 ticket and for 50 (note C, finding-28f100bc), one call
 *     answering for every child;
 *   - the fold: own plans exclude the pieces child tasks name; session fit; review owed (open finding, Approve ends it,
 *     request-changes leaves it, a breakdown plan with no finding); revision; child tasks with no ticket; a superseded
 *     piece followed; a ticket with no task;
 *   - a revision the selector can see: request-changes then a revise to v2 changes the facts, the unrevised plan with
 *     the same open finding does not;
 *   - poisoned descriptions through buildSelectorArgs (leaf and node) and prepareRecommendationInput, both ways: the
 *     ticket text says one thing and the records the opposite, and the records win;
 *   - description invariance over the active routing fixtures (tests/fixtures/stage-router-prompts/cases.mjs): the facts
 *     block is byte-identical with the description's plan section removed or a contrary plan put in;
 *   - the shared recognition rule (lib/legacy-plan-text.js) returns text only, `#` to `###`.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { planFactsOf, planFactsNotMeasured, currentPieceOf } from '../../lib/records/plan-facts.js';
import * as legacy from '../../lib/legacy-plan-text.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { prepareRecommendationInput } from '../../lib/recommendation-input.js';
import { CASES } from '../fixtures/stage-router-prompts/cases.mjs';

const URL_KEY = 'lin-4504-workspace';
const harness = createMangoTmpdir('lin-4504-');
let db;
let store;
let reads;

/** A collection that counts every read (find, findOne) it serves. */
const counted = (col) => new Proxy(col, {
  get(target, prop) {
    const v = target[prop];
    if (typeof v !== 'function') return v;
    if (prop === 'find' || prop === 'findOne') return (...args) => { reads.n += 1; return v.apply(target, args); };
    return v.bind(target);
  }
});

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  reads = { n: 0 };
  store = new RecordsStore({ records: counted(db.collection(RECORDS_COLLECTION)), refs: counted(db.collection(REFS_COLLECTION)), queryLog: db.collection(QUERY_LOG_COLLECTION) });
});

const by = { by: 'plan' };
const task = (ticket, extra = {}) => store.add(URL_KEY, { kind: 'task', state: 'open', fields: { ref: ticket, asked: `${ticket} words` }, links: {}, ...extra }, by)
  .then(async (t) => { await store.claimTicket(URL_KEY, ticket, t.id); return t; });
const plan = (taskId, to, extra = {}) => store.add(URL_KEY, { kind: 'plan', state: 'kept', in: taskId, to, fields: { says: `a plan ${to}` }, links: {}, ...extra }, by);
const finding = (planId, state = 'open') => store.add(URL_KEY, { kind: 'finding', state, to: 'plan-review', fields: { says: 'review this plan' }, links: { about: [planId] } }, by);

describe('find: the array form of inRef (the widened guard)', () => {
  test('one query for many tasks; [] matches nothing; null is the project; a string is one task', async () => {
    const a = await task('LIN-1');
    const b = await task('LIN-2');
    const pa = await plan(a.id, 'implementation');
    const pb = await plan(b.id, 'breakdown');
    const loose = await store.add(URL_KEY, { kind: 'finding', state: 'open', to: 'project', fields: { says: 'project-wide' }, links: {} }, by);
    const ids = (rs) => rs.map((r) => r.id).sort();
    assert.deepEqual(ids(await store.find(URL_KEY, { inRef: [a.id, b.id] })), [pa.id, pb.id].sort());
    assert.deepEqual(ids(await store.find(URL_KEY, { inRef: [a.id] })), [pa.id]);
    reads.n = 0;
    assert.deepEqual(await store.find(URL_KEY, { inRef: [] }), [], 'an empty list matches nothing');
    assert.equal(reads.n, 0, 'and reads nothing');
    assert.deepEqual(ids(await store.find(URL_KEY, { inRef: null })), ids([a, b, loose]), 'null still means records in no task');
    assert.deepEqual(ids(await store.find(URL_KEY, { inRef: b.id })), [pb.id]);
    assert.deepEqual(ids(await store.find(URL_KEY, { kind: 'plan', inRef: [a.id, b.id], to: 'breakdown' })), [pb.id]);
  });
});

describe('planFactsForTickets: one call answers every ticket, in a fixed number of reads', () => {
  // The plan-review findings read returns every such finding in the workspace (ended ones included): the number of
  // reads stays fixed, but that read grows with history (plan-review note 10).
  async function parentWithChildren(n) {
    const parent = await task('LIN-100');
    const breakdownPlan = await plan(parent.id, 'breakdown');
    await finding(breakdownPlan.id, 'done');
    const tickets = [];
    for (let i = 0; i < n; i++) {
      const piece = await plan(parent.id, 'implementation');
      const ticket = `LIN-${200 + i}`;
      await task(ticket, { in: parent.id, links: { piece: piece.id } });
      tickets.push(ticket);
    }
    return { parent, tickets };
  }

  test('1 child and 50 children take the same number of reads, and each child reads its piece', async () => {
    const one = await parentWithChildren(1);
    reads.n = 0;
    const factsOne = await store.planFactsForTickets(URL_KEY, ['LIN-100', ...one.tickets]);
    const readsForOne = reads.n;

    db = harness.freshDb();
    await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
    store = new RecordsStore({ records: counted(db.collection(RECORDS_COLLECTION)), refs: counted(db.collection(REFS_COLLECTION)), queryLog: db.collection(QUERY_LOG_COLLECTION) });
    const fifty = await parentWithChildren(50);
    reads.n = 0;
    const factsFifty = await store.planFactsForTickets(URL_KEY, ['LIN-100', ...fifty.tickets]);
    assert.equal(reads.n, readsForOne, `${reads.n} reads for 50 children against ${readsForOne} for 1`);
    assert.ok(readsForOne <= 8, `a small fixed number of reads (${readsForOne})`);

    assert.equal(factsFifty.size, 51);
    for (const t of fifty.tickets) {
      const f = factsFifty.get(t);
      assert.equal(f.measured, true);
      assert.equal(f.partOfParent, true, t);
      assert.equal(f.sessionFit, 'one', t);
      assert.equal(f.reviewOwed.owed, false, t);
    }
    const parent = factsFifty.get('LIN-100');
    assert.equal(parent.own.length, 1, 'the pieces belong to their children, so only the breakdown plan is the parent\'s own');
    assert.equal(parent.sessionFit, 'several');
    assert.equal(parent.reviewOwed.owed, false, 'its plan-review finding ended (Approve)');
    assert.equal(factsOne.get('LIN-100').own.length, 1);
  });

  test('a ticket with no task reads as measured with no plan; an empty list reads nothing', async () => {
    const facts = await store.planFactsForTickets(URL_KEY, ['LIN-404']);
    assert.deepEqual({ measured: facts.get('LIN-404').measured, hasPlan: facts.get('LIN-404').hasPlan, taskId: facts.get('LIN-404').taskId }, { measured: true, hasPlan: false, taskId: null });
    reads.n = 0;
    assert.equal((await store.planFactsForTickets(URL_KEY, [])).size, 0);
    assert.equal(reads.n, 0);
  });

  test('one workspace never answers for another', async () => {
    const t = await task('LIN-5');
    await plan(t.id, 'implementation');
    assert.equal((await store.planFactsForTickets('another-workspace', ['LIN-5'])).get('LIN-5').hasPlan, false);
  });

  test('a superseded piece is followed to the plan that took over, as the brief does', async () => {
    const parent = await task('LIN-300');
    const old = await plan(parent.id, 'implementation');
    const next = await plan(parent.id, 'implementation');
    await store.end(URL_KEY, old.id, { state: 'superseded', reason: 'split differently', into: next.id }, by);
    await task('LIN-301', { in: parent.id, links: { piece: old.id } });
    const f = (await store.planFactsForTickets(URL_KEY, ['LIN-301'])).get('LIN-301');
    assert.equal(f.piece.id, next.id);
    assert.equal(f.hasPlan, true);
  });

  test('a piece superseded twice (p1 -> p2 -> p3) is followed the whole way, as the pure fold does', async () => {
    const parent = await task('LIN-310');
    const p1 = await plan(parent.id, 'implementation');
    const p2 = await plan(parent.id, 'implementation');
    const p3 = await plan(parent.id, 'implementation');
    await store.end(URL_KEY, p1.id, { state: 'superseded', reason: 'first correction', into: p2.id }, by);
    await store.end(URL_KEY, p2.id, { state: 'superseded', reason: 'second correction', into: p3.id }, by);
    await task('LIN-311', { in: parent.id, links: { piece: p1.id } });
    const f = (await store.planFactsForTickets(URL_KEY, ['LIN-311'])).get('LIN-311');
    assert.equal(f.piece.id, p3.id, 'the chain is read to its end');
    assert.equal(f.hasPlan, true);
  });

  test('a supersede cycle terminates and reads no plan', async () => {
    const parent = await task('LIN-320');
    const a = await plan(parent.id, 'implementation');
    const b = await plan(parent.id, 'implementation');
    await store.end(URL_KEY, a.id, { state: 'superseded', reason: 'x', into: b.id }, by);
    await store.end(URL_KEY, b.id, { state: 'superseded', reason: 'y', into: a.id }, by);
    await task('LIN-321', { in: parent.id, links: { piece: a.id } });
    const f = (await store.planFactsForTickets(URL_KEY, ['LIN-321'])).get('LIN-321');
    assert.equal(f.piece, null);
  });
});

describe('the fold (lib/records/plan-facts.js planFactsOf)', () => {
  const T = { id: 'task-a', kind: 'task', state: 'open' };
  const P = (id, to, extra = {}) => ({ id, v: 1, kind: 'plan', state: 'kept', in: 'task-a', to, at: '2026-11-20T10:00:00.000Z', ...extra });
  const F = (id, about, state) => ({ id, kind: 'finding', to: 'plan-review', state, links: { about: [about] } });

  test('session fit: several with any breakdown plan, one when all are implementation or only a piece, none with no plan', () => {
    assert.equal(planFactsOf({ task: T, inside: [P('plan-1', 'implementation'), P('plan-2', 'breakdown')] }).sessionFit, 'several');
    assert.equal(planFactsOf({ task: T, inside: [P('plan-1', 'implementation'), P('plan-2', 'implementation')] }).sessionFit, 'one');
    assert.equal(planFactsOf({ task: { ...T, links: { piece: 'plan-9' } }, piece: P('plan-9', 'implementation', { in: 'task-p' }) }).sessionFit, 'one');
    assert.equal(planFactsOf({ task: T }).sessionFit, null);
    assert.equal(planFactsOf({ task: T, inside: [P('plan-1', 'breakdown', { state: 'superseded' })] }).hasPlan, false, 'only kept plans count');
    assert.equal(planFactsOf({ task: T, inside: [P('plan-1', 'breakdown', { state: 'superseded' })] }).everPlanned, true, 'but the task had one');
  });

  test('review owed: an open finding about an own plan; Approve (ended) is not owed; request-changes (open) is; a breakdown plan with no finding is', () => {
    assert.deepEqual(planFactsOf({ task: T, inside: [P('plan-1', 'implementation')], findings: [F('finding-1', 'plan-1', 'open')] }).reviewOwed, { owed: true, why: 'open-finding', plan: 'plan-1', finding: 'finding-1' });
    assert.equal(planFactsOf({ task: T, inside: [P('plan-1', 'implementation')], findings: [F('finding-1', 'plan-1', 'done')] }).reviewOwed.owed, false);
    assert.equal(planFactsOf({ task: T, inside: [P('plan-1', 'implementation')] }).reviewOwed.owed, false, 'one session with no finding: not owed');
    assert.deepEqual(planFactsOf({ task: T, inside: [P('plan-1', 'breakdown')] }).reviewOwed, { owed: true, why: 'breakdown-unreviewed', plan: 'plan-1', finding: null });
    assert.equal(planFactsOf({ task: T, inside: [P('plan-1', 'breakdown')], findings: [F('finding-1', 'plan-1', 'done')] }).reviewOwed.owed, false, 'a breakdown plan with an ended finding is reviewed');
    assert.equal(planFactsOf({ task: T, inside: [P('plan-1', 'implementation')], findings: [F('finding-1', 'plan-other', 'open')] }).reviewOwed.owed, false, 'a finding about another plan is not this task\'s');
  });

  test('own plans exclude the pieces child tasks name; open child tasks with no ticket are counted', () => {
    const inside = [
      P('plan-b', 'breakdown'), P('plan-p1', 'implementation'), P('plan-p2', 'implementation'),
      { id: 'task-c1', kind: 'task', state: 'open', in: 'task-a', fields: { ref: 'LIN-11' }, links: { piece: 'plan-p1' } },
      { id: 'task-c2', kind: 'task', state: 'open', in: 'task-a', fields: {}, links: { piece: 'plan-p2' } },
      { id: 'task-c3', kind: 'task', state: 'done', in: 'task-a', fields: {}, links: {} },
    ];
    const f = planFactsOf({ task: T, inside });
    assert.deepEqual(f.own.map((p) => p.id), ['plan-b']);
    assert.equal(f.childTasksWithoutTicket, 1);
  });

  test('not measured is never "no plan"', () => {
    const f = planFactsNotMeasured('the store is down');
    assert.equal(f.measured, false);
    assert.equal(f.hasPlan, undefined);
    assert.equal(f.reason, 'the store is down');
    assert.equal(currentPieceOf(null, () => null), null);
  });

  test('currentPieceOf follows every hop of a chain, and a cycle reads no plan', () => {
    const recs = {
      a: { id: 'a', state: 'superseded', ended: { into: 'b' } },
      b: { id: 'b', state: 'superseded', ended: { into: 'c' } },
      c: { id: 'c', state: 'kept' },
      x: { id: 'x', state: 'superseded', ended: { into: 'y' } },
      y: { id: 'y', state: 'superseded', ended: { into: 'x' } }
    };
    const get = (id) => recs[id] || null;
    assert.equal(currentPieceOf(recs.a, get).id, 'c', 'two hops reach the plan that holds');
    assert.equal(currentPieceOf(recs.c, get).id, 'c');
    assert.equal(currentPieceOf(recs.x, get), null);
  });
});

describe('a revision the selector can see (request-changes, revise to v2, review again)', () => {
  test('the revised plan shows v2 changed after the latest verdict; the unrevised plan with the same open finding does not', async () => {
    const t = await task('LIN-50');
    const p = await plan(t.id, 'implementation', { at: undefined });
    await finding(p.id, 'open');
    const verdict = { user: 'Reviewer', createdAt: '2026-11-20T12:00:00.000Z', body: '### Plan Review Verdict\n\n**Verdict:** Request Changes.\n\nBlocking findings: 1' };
    const issue = { identifier: 'LIN-50', title: 'x', description: 'Goal.', state: { name: 'Todo', type: 'unstarted' }, labels: [] };
    const factsOf = async () => buildSelectorArgs(issue, { comments: [verdict], children: [], planFacts: (await store.planFactsForTickets(URL_KEY, ['LIN-50'])).get('LIN-50') }).facts;

    const before = await factsOf();
    await store.revise(URL_KEY, p.id, { fields: { says: 'revised plan' } }, { by: 'plan', reason: 'answers the verdict', at: '2026-11-20T13:00:00.000Z' });
    const afterRevise = await factsOf();
    assert.notEqual(afterRevise, before, 'the revise changes the facts the selector reads');
    assert.match(afterRevise, new RegExp(`${p.id} v2 to implementation \\(changed 2026-11-20 13:00\\)`));
    assert.match(afterRevise, /latest: request changes \(2026-11-20 12:00\)/, 'beside the verdict line, so changed-after-verdict shows');
    assert.match(afterRevise, /- Plan review owed: yes \(open finding /, 'the finding stays open until a plan-review ends it');
    assert.match(before, new RegExp(`${p.id} v1 to implementation`));
    assert.equal(await factsOf(), afterRevise, 'deterministic');
  });
});

describe('poisoned descriptions: the records win both ways', () => {
  const PLAN_TEXT = 'Goal.\n\n## Implementation Plan\n\nThe old plan.\n\nSession fit: needs multiple sessions.\n\nplan-review due: yes';
  const PLAN_TEXT_ONE = 'Goal.\n\n## Implementation Plan\n\nThe old plan.\n\nSession fit: fits one session.\n\nplan-review due: no';
  const issue = (description) => ({ identifier: 'LIN-60', title: 'x', description, state: { name: 'Todo', type: 'unstarted' }, labels: [] });
  const T = { id: 'task-60', kind: 'task', state: 'open' };
  const one = planFactsOf({ task: T, inside: [{ id: 'plan-60', v: 1, kind: 'plan', state: 'kept', in: 'task-60', to: 'implementation', at: '2026-11-20T10:00:00.000Z' }] });
  const several = planFactsOf({ task: T, inside: [{ id: 'plan-60', v: 1, kind: 'plan', state: 'kept', in: 'task-60', to: 'breakdown', at: '2026-11-20T10:00:00.000Z' }] });
  const none = planFactsOf({ task: T });
  const planComment = { user: 'Agent', createdAt: '2026-11-20T09:00:00.000Z', body: '## Implementation Plan\n\nneeds multiple sessions\n\nplan-review due: yes' };

  test('leaf: the text says several sessions and review due; the records say one session and nothing owed', () => {
    const f = buildSelectorArgs(issue(PLAN_TEXT), { comments: [planComment], children: [], planFacts: one }).facts;
    assert.match(f, /- Session fit \(the plan records' addressee\): one session/);
    assert.match(f, /- Plan review owed: no/);
    assert.doesNotMatch(f, /several sessions|needs multiple|due: yes/);
  });

  test('leaf: the text says one session and no review; the records say several sessions and a review owed', () => {
    const f = buildSelectorArgs(issue(PLAN_TEXT_ONE), { comments: [], children: [], planFacts: several }).facts;
    assert.match(f, /several sessions \(a plan is addressed to breakdown\)/);
    assert.match(f, /- Plan review owed: yes/);
  });

  test('leaf: the text holds a plan; the records hold none: no plan', () => {
    const f = buildSelectorArgs(issue(PLAN_TEXT), { comments: [planComment], children: [], planFacts: none }).facts;
    assert.match(f, /- Plan records on this task: none/);
  });

  test('node: the text says several sessions; the records say one (and the reverse)', () => {
    const children = [{ id: 'c', identifier: 'LIN-61', title: 'c', state: { name: 'Todo', type: 'unstarted' } }];
    assert.match(buildSelectorArgs(issue(PLAN_TEXT), { children, comments: [], planFacts: one }).facts, /- Session fit \(this task's own plan records\): one session/);
    assert.match(buildSelectorArgs(issue(PLAN_TEXT_ONE), { children, comments: [], planFacts: several }).facts, /- Session fit \(this task's own plan records\): several sessions/);
  });

  test('prepareRecommendationInput: the one producer reads records; no store or a fault is not measured', async () => {
    const runsStore = { listItems: async () => [], listHistory: async () => ({ items: [], total: 0 }) };
    const ctx = { comments: [planComment], children: [], issue: issue(PLAN_TEXT) };
    const t = await task('LIN-60');
    await plan(t.id, 'implementation');
    const withStore = await prepareRecommendationInput(ctx, { dispatchQueueStore: runsStore, urlKey: URL_KEY, identifier: 'LIN-60', recordsStore: store });
    assert.equal(withStore.planFacts.sessionFit, 'one');
    const noStore = await prepareRecommendationInput(ctx, { dispatchQueueStore: runsStore, urlKey: URL_KEY, identifier: 'LIN-60' });
    assert.equal(noStore.planFacts.measured, false);
    const failing = { askedForTicket: async () => null, planFactsForTickets: async () => { throw new Error('db down'); } };
    const origError = console.error;
    console.error = () => {};
    try {
      const fault = await prepareRecommendationInput(ctx, { dispatchQueueStore: runsStore, urlKey: URL_KEY, identifier: 'LIN-60', recordsStore: failing });
      assert.equal(fault.planFacts.measured, false);
      assert.match(fault.planFacts.reason, /db down/);
    } finally {
      console.error = origError;
    }
  });
});

describe('description invariance over the active routing fixtures', () => {
  // The facts block is byte-identical whether a case's description plan section is removed or a contrary plan is put in.
  const CONTRARY = '\n\n## Implementation Plan\n\nA contrary plan.\n\nSession fit: needs multiple sessions.\n\nplan-review due: yes\n\nfits one session';
  for (const entry of CASES) {
    test(entry.id, () => {
      const { issue, context } = entry.ticket;
      const factsWith = (description) => buildSelectorArgs({ ...issue, description }, context).facts;
      const base = factsWith(issue.description);
      assert.equal(factsWith(legacy.textWithoutPlan(issue.description)), base, 'plan section removed');
      assert.equal(factsWith(`${issue.description}${CONTRARY}`), base, 'a contrary plan put in');
      assert.equal(factsWith(''), base, 'no description at all');
    });
  }
});

describe('the shared recognition rule (lib/legacy-plan-text.js) returns text, never a fact', () => {
  test('exports: the heading, a presence test, two text helpers and the added-heading list; nothing reads a session fit or a review', () => {
    // LIN-4527: textBeforePlan is retired with askedOf's plan trim.
    assert.deepEqual(Object.keys(legacy).sort(), ['LEGACY_PLAN_HEADING', 'PLAN_HEADING_WORDS', 'PLAN_IN_DESCRIPTION', 'addedPlanHeadings', 'hasPlanHeading', 'textWithoutPlan'].sort());
    assert.ok(Array.isArray(legacy.addedPlanHeadings('', '## Implementation Plan')), 'a list of heading lines, text');
    assert.equal(typeof legacy.textWithoutPlan('x'), 'string');
  });

  test('`#`, `##` and `###` headings are recognised (the deliberate widening, plan-review note 6)', () => {
    for (const h of ['#', '##', '###']) {
      const text = `Before.\n\n${h} Implementation Plan\n\nPlan body.`;
      assert.equal(legacy.hasPlanHeading(text), true, h);
      assert.equal(legacy.textWithoutPlan(text), 'Before.', h);
    }
    assert.equal(legacy.hasPlanHeading('#### Implementation Plan'), false, 'four hashes is not the heading');
    assert.equal(legacy.hasPlanHeading('Our implementation plan is simple.'), false, 'prose is not the heading');
  });

  test('a section ends at the next heading of the same or a higher level; subsections stay inside it', () => {
    const text = 'Intro.\n\n## Implementation Plan\n\nBody.\n\n### Steps\n\nStep.\n\n## After\n\nKept.\n\n# Top\n\nAlso kept.';
    assert.equal(legacy.textWithoutPlan(text), 'Intro.\n\n## After\n\nKept.\n\n# Top\n\nAlso kept.');
    const h3 = 'Intro.\n\n### Implementation Plan\n\nBody.\n\n### Next\n\nKept.';
    assert.equal(legacy.textWithoutPlan(h3), 'Intro.\n\n### Next\n\nKept.');
    assert.equal(legacy.textWithoutPlan('No plan.'), 'No plan.');
    assert.equal(legacy.textWithoutPlan(null), '');
  });
});
