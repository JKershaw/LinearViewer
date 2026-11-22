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
      ['allRuns', 'asked', 'attachments', 'children', 'comments', 'focusedChild', 'landingChanges', 'openFindings', 'parent', 'planFacts', 'planReviewLoop', 'project', 'runs', 'siblings', 'trail']);
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

  test('a person\'s comment after the latest verdict, read by the entrance, lifts the bound', async () => {
    const input = await entrance(rounds(2, 2, 2), [{ createdAt: scenarioAt(4), body: 'go on, take it to implementation' }]);
    assert.equal(input.planReviewLoop.personSince, true);
    assert.equal(reviewLoopStep(ISSUE, input.planReviewLoop), null);
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
