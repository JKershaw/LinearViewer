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
      ['attachments', 'children', 'comments', 'focusedChild', 'parent', 'project', 'runs', 'siblings']);
    assert.equal(input.parent, ctx.parent);
    assert.equal(input.attachments, ctx.attachments);
    assert.deepEqual(input.runs, [{ stage: 'implementation', at: '2026-10-05T00:00:00.000Z', outcome: 'queued' }]);
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
  });
});
