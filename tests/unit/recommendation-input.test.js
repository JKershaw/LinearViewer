/**
 * The one preparation of recommendation input (LIN-3469).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepareRecommendationInput } from '../../lib/recommendation-input.js';
import { reviewLoopStep } from '../../lib/recommendation-facts.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { seededRecordsStore, scenarioAt } from '../helpers/records-scenario.js';

const store = {
  listItems: async () => [{ kind: 'implementation', dispatchedAt: '2026-10-05T00:00:00.000Z', feedback: [] }],
  listHistory: async () => ({ items: [] })
};
const ctx = {
  issue: { identifier: 'LIN-1' }, parent: { id: 'p' }, siblings: [{ id: 's' }], project: { id: 'pr' },
  children: [{ id: 'c' }], comments: [{ body: 'hi' }], focusedChild: { id: 'f' }, attachments: [{ url: 'u' }]
};

describe('prepareRecommendationInput (LIN-3469)', () => {
  test('forwards exactly the prompt-read fields plus the task\'s runs', async () => {
    const input = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-1' });
    assert.deepEqual(Object.keys(input).sort(),
      ['allRuns', 'answeredQuestions', 'asked', 'attachments', 'children', 'comments', 'focusedChild', 'landingChanges', 'openFindings', 'parent', 'personFindings', 'planFacts', 'planReviewLoop', 'planReviewRun', 'project', 'reviewRound', 'runTimes', 'runs', 'siblings', 'sizeDecisions', 'trail']);
    assert.equal(input.asked, null, 'no records store: no words on record');
    assert.equal(input.trail, null, 'LIN-4518 step 3: no records store: the trail is not read, so no gate reads a comment for it');
    assert.equal(input.landingChanges, null, 'LIN-4518 step 2: no records store: the landing is not read, so a blind read names no id');
    assert.equal(input.planFacts.measured, false, 'LIN-4504: no records store: plan facts not measured, never "no plan"');
    // LIN-4518 (finding-55356e66): the plan-review loop is not read without a records store, so the bound stands aside.
    assert.equal(input.planReviewLoop, null, 'no records store: the loop is not read, never read from the comments');
    assert.equal(input.parent, ctx.parent);
    assert.equal(input.attachments, ctx.attachments);
    assert.deepEqual(input.runs, [{ stage: 'implementation', at: '2026-10-05T00:00:00.000Z', outcome: 'queued' }]);
    // LIN-4370, LIN-4392: the same read's unsliced runs, with dispatch times and ids, for the look-first route's attempts and the live-stage wait.
    assert.deepEqual(input.allRuns, [{ stage: 'implementation', at: '2026-10-05T00:00:00.000Z', outcome: 'queued', dispatchedAt: '2026-10-05T00:00:00.000Z', id: null }]);
  });

  // LIN-4501: the look-first route reads the person's words from the ticket's task, never from the description.
  test('asked is the ticket\'s task words from the records store, and null when it has no task', async () => {
    const records = { askedForTicket: async (urlKey, ticket) => (urlKey === 'acme' && ticket === 'LIN-1' ? 'The words.' : null) };
    const input = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-1', recordsStore: records });
    assert.equal(input.asked, 'The words.');
    const none = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-2', recordsStore: records });
    assert.equal(none.asked, null);
    const faulty = { askedForTicket: async () => { throw new Error('records down'); } };
    const failed = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-1', recordsStore: faulty });
    assert.equal(failed.asked, null, 'a records fault reads as no words, never the description');
  });

  // LIN-4542 (P8): the size of the move is a standing decision by scoping on the task, read from records.
  test('sizeDecisions are the task\'s standing decisions by scoping, oldest first; null when not read, [] with no task', async () => {
    const recs = [
      { id: 'decision-b', kind: 'decision', by: 'scoping', state: 'stands', in: 'task-1', at: '2026-11-20T12:00:00.000Z', fields: { answer: 'a small tidy first', why: 'the tidy lets the change land on one home.', scope: 'task-1' } },
      { id: 'decision-a', kind: 'decision', by: 'scoping', state: 'stands', in: 'task-1', at: '2026-11-20T10:00:00.000Z', fields: { answer: 'just the task', why: 'nothing binds.', scope: 'task-1' } },
      { id: 'decision-p', kind: 'decision', by: 'person:john', state: 'stands', in: 'task-1', at: '2026-11-20T11:00:00.000Z', fields: { answer: 'Yes', words: 'Go ahead.' } },
      { id: 'decision-o', kind: 'decision', by: 'scoping', state: 'stands', in: 'task-2', at: '2026-11-20T09:00:00.000Z', fields: { answer: 'another task', why: 'not this one.' } },
    ];
    const queries = [];
    const records = {
      taskForTicket: async (urlKey, ticket) => (ticket === 'LIN-1' ? 'task-1' : null),
      find: async (urlKey, q) => { queries.push(q); return recs.filter((r) => (!q.kind || r.kind === q.kind) && (!q.state || r.state === q.state) && (q.inRef === undefined || r.in === q.inRef)); },
    };
    const input = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-1', recordsStore: records });
    assert.deepEqual(input.sizeDecisions, [
      { id: 'decision-a', answer: 'just the task', why: 'nothing binds.', at: '2026-11-20T10:00:00.000Z' },
      { id: 'decision-b', answer: 'a small tidy first', why: 'the tidy lets the change land on one home.', at: '2026-11-20T12:00:00.000Z' },
    ], 'scoping\'s own, on this task, oldest first; a person\'s decision and another task\'s are not the size');
    assert.ok(queries.some((q) => q.kind === 'decision' && q.state === 'stands' && q.inRef === 'task-1'), 'a superseded or withdrawn decision is not read: only standing ones');
    const noTask = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-2', recordsStore: records });
    assert.deepEqual(noTask.sizeDecisions, [], 'no task on record: nothing decided');
    const none = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-1' });
    assert.equal(none.sizeDecisions, null, 'no records store: not read');
    const faulty = { taskForTicket: async () => { throw new Error('records down'); }, find: async () => [] };
    const failed = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-1', recordsStore: faulty });
    assert.equal(failed.sizeDecisions, null, 'a records fault reads as not read, never "not decided"');
  });

  test('does not leak other context fields (issue, siblingsTotal)', async () => {
    const input = await prepareRecommendationInput({ ...ctx, siblingsTotal: 9, extra: 1 }, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-1' });
    assert.equal('issue' in input, false);
    assert.equal('siblingsTotal' in input, false);
    assert.equal('extra' in input, false);
  });

  test('a missing store is no runs, never a throw', async () => {
    const input = await prepareRecommendationInput(ctx, { dispatchQueueStore: null, urlKey: 'acme', identifier: 'LIN-1' });
    assert.deepEqual(input.runs, []);
    assert.equal(input.allRuns, null, 'attempts unknown: the live-stage wait and the look-first route stand aside');
  });
});

// LIN-4518 (finding-5cdbcb2b): the entrance hands the route the plan-review loop's facts from the ticket's records. The
// other suites hand the route a stub or fold the facts themselves, so this wiring is witnessed here against a real store.
describe('the plan-review loop enters the route from the records (LIN-4518 finding-5cdbcb2b)', () => {
  const harness = createMangoTmpdir('lin-4518-recommendation-input-');
  before(() => harness.connect());
  after(() => harness.close());
  const ISSUE = { identifier: 'LIN-1', title: 'Loop', description: '', state: { name: 'In Progress', type: 'started' }, labels: [] };
  // Plan-review rounds on record: `rounds(2, 2, 2)` is three request-changes verdicts, each with two `to: plan` findings.
  const rounds = (...counts) => counts.map((n, i) => ({ kind: 'planReview', at: scenarioAt(i + 1), outcome: 'request-changes', findings: n }));
  const entrance = async (events, comments = []) => prepareRecommendationInput(
    { ...ctx, comments },
    { dispatchQueueStore: store, urlKey: 'ws', identifier: 'LIN-1', recordsStore: await seededRecordsStore(harness, events) },
  );

  test('three rounds of 2, 2, 2 findings on record reach the route as the bound: blocked, with no comment at all', async () => {
    const input = await entrance(rounds(2, 2, 2));
    assert.deepEqual(input.planReviewLoop.run.map((r) => r.blocking), [2, 2, 2]);
    const step = reviewLoopStep(ISSUE, input.planReviewLoop);
    assert.equal(step?.step, 'blocked');
    assert.match(step.why, /reached its bound/);
  });

  test('a converging run (3, 2, 1) on record does not stop the loop through the entrance', async () => {
    const input = await entrance(rounds(3, 2, 1));
    assert.equal(reviewLoopStep(ISSUE, input.planReviewLoop), null);
  });

  // LIN-4535: a person's speech is the task's person finding (lib/comment-ingest.js), read by the entrance, never a comment's text.
  test('a person\'s finding after the latest verdict, read by the entrance, lifts the bound', async () => {
    const records = await seededRecordsStore(harness, rounds(2, 2, 2));
    const realFind = records.find.bind(records);
    assert.ok(await records.taskForTicket('ws', 'LIN-1'), 'the seeded store has the ticket\'s task');
    records.find = async (urlKey, q) => (q.kind === 'finding'
      ? [{ id: 'finding-1', kind: 'finding', by: 'person:john', via: 'comment', at: scenarioAt(4), fields: { says: 'go on, take it to implementation' } }]
      : realFind(urlKey, q));
    const input = await prepareRecommendationInput({ ...ctx, comments: [] }, { dispatchQueueStore: store, urlKey: 'ws', identifier: 'LIN-1', recordsStore: records });
    assert.equal(input.planReviewLoop.personSince, true);
    assert.equal(reviewLoopStep(ISSUE, input.planReviewLoop), null);
  });

  test('a comment that reads like a person\'s words, with no person finding, does not lift the bound', async () => {
    const input = await entrance(rounds(2, 2, 2), [{ createdAt: scenarioAt(4), body: 'go on, take it to implementation' }]);
    assert.equal(input.planReviewLoop.personSince, false);
  });

  test('with no records store the loop is not read, so the bound stands aside (never read from the comments)', async () => {
    const input = await prepareRecommendationInput(
      { ...ctx, comments: [{ body: '### Plan Review Verdict\n\n**Verdict: Request Changes.**\n\nBlocking findings: 2', createdAt: scenarioAt(1) }] },
      { dispatchQueueStore: store, urlKey: 'ws', identifier: 'LIN-1' },
    );
    assert.equal(input.planReviewLoop, null);
    assert.equal(reviewLoopStep(ISSUE, input.planReviewLoop), null);
  });
});
