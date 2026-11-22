/**
 * The one preparation of recommendation input (LIN-3469).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { prepareRecommendationInput } from '../../lib/recommendation-input.js';

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
