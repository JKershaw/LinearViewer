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
  test('forwards exactly the prompt-read fields plus the task\'s runs and the size policy', async () => {
    const input = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-1' });
    assert.deepEqual(Object.keys(input).sort(),
      ['attachments', 'children', 'comments', 'focusedChild', 'parent', 'project', 'runs', 'siblings', 'sizePolicy']);
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

  // LIN-4368: the standing size policy comes from the one loader, so every scoping render reads it.
  test('carries the standing size policy, with who set it and when (LIN-4368)', async () => {
    const setBy = { via: 'page', id: 'acct-1' };
    const prefs = { getWorkspacePreferences: async (key) => (key === 'acme' ? { sizePolicy: { value: 'err-larger', setBy, setAt: '2026-11-07T22:18:00.000Z' } } : {}) };
    const input = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, workspacePreferencesStore: prefs, urlKey: 'acme', identifier: 'LIN-1' });
    assert.deepEqual(input.sizePolicy, { value: 'err-larger', setBy, setAt: '2026-11-07T22:18:00.000Z' });
  });

  test('no store, a store with no reader, a read fault or an unknown value is no standing policy (LIN-4368)', async () => {
    const none = { value: 'ask', setBy: null, setAt: null };
    for (const prefs of [undefined, {}, { getWorkspacePreferences: async () => { throw new Error('down'); } }, { getWorkspacePreferences: async () => ({ sizePolicy: { value: 'huge' } }) }]) {
      const input = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, workspacePreferencesStore: prefs, urlKey: 'acme', identifier: 'LIN-1' });
      assert.deepEqual(input.sizePolicy, none);
    }
  });
});
