/**
 * LIN-3962: the Models spend window, read in one place. Settings › Models and Home's decision panel both
 * price from the same dispatch rows, so both must ask the store the same question (lib/model-routing-history.js).
 *
 * Run with: node --test tests/unit/model-routing-history.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readModelsHistory, MODELS_HISTORY_CAP } from '../../lib/model-routing-history.js';

function fakeStore(items = []) {
  const calls = [];
  return {
    calls,
    listHistoryWithBodies: async (urlKey, opts) => { calls.push({ urlKey, opts }); return { items, total: items.length }; }
  };
}

describe('readModelsHistory: one window and one cap for both pages', () => {
  test('reads the 30-day window, bounded by the cap, with no prompt bodies', async () => {
    const store = fakeStore([{ id: 'a' }]);
    const out = await readModelsHistory(store, 'acme');
    assert.equal(out.items.length, 1);
    const { urlKey, opts } = store.calls[0];
    assert.equal(urlKey, 'acme');
    assert.equal(opts.limit, MODELS_HISTORY_CAP);
    assert.equal(MODELS_HISTORY_CAP, 2000, 'the cap the Models page has always stated');
    assert.deepEqual(opts.projection, { prompt: 0 });
    const ageDays = (Date.now() - new Date(opts.since).getTime()) / 86_400_000;
    assert.ok(Math.abs(ageDays - 30) < 0.01, `window starts 30 days back, got ${ageDays}`);
  });

  test('Models and Home ask the store the same question, so the same job reads the same numbers', async () => {
    const store = fakeStore();
    await readModelsHistory(store, 'acme');
    await readModelsHistory(store, 'acme');
    const [first, second] = store.calls;
    assert.equal(first.urlKey, second.urlKey);
    assert.equal(first.opts.limit, second.opts.limit);
    assert.deepEqual(first.opts.projection, second.opts.projection);
    assert.ok(Math.abs(new Date(first.opts.since) - new Date(second.opts.since)) < 1000);
  });

  test('no store answers an empty read, never a throw', async () => {
    assert.deepEqual(await readModelsHistory(null, 'acme'), { items: [], total: 0 });
  });
});
