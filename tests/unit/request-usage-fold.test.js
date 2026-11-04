/**
 * The fold over a lineage's request records (LIN-4201, LIN-4195 D6): `foldRequestUsage`.
 *
 * Each rule the ticket names has its own test: per-request pricing (tier by the record's own prompt size,
 * whatever the harness), native `costUsd` precedence, the three completeness values, the label rules
 * (cost-dominant model with ties to the latest; effort and harness from the latest record), the per-model
 * costs, and review note 3 (a record lineage is never `incomplete`: missing rows cannot change its figure).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { foldRequestUsage } from '../../lib/request-usage-fold.js';
import { foldLineageUsage } from '../../lib/row-usage.js';
import { priceRequest, computeUsageCostUsd } from '../../lib/model-pricing.js';

const at = (minute) => new Date(Date.UTC(2026, 10, 4, 9, minute));
// One stored request record, in the loader's projection shape (its LIST_PROJECTION).
const rec = (requestId, minute, fields = {}) => ({
  rootItemId: 'root-1', itemId: 'root-1', requestId, at: at(minute), updatedAt: at(minute),
  harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high', lane: null, agent: 'main',
  inputTokens: 1000, outputTokens: 100, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0,
  ...fields,
});
// Opus 5.5 is tier-free: 1000 input at $4/M + 100 output at $20/M.
const OPUS_ONE = 1000 * 4 / 1e6 + 100 * 20 / 1e6;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

describe('foldRequestUsage: the shape', () => {
  test('returns the foldLineageUsage keys, plus per-model costs and the record-source facts', () => {
    const fold = foldRequestUsage([rec('a', 1)]);
    for (const key of Object.keys(foldLineageUsage([]))) assert.ok(key in fold, `missing ${key}`);
    assert.equal(fold.source, 'records');
    assert.ok(Array.isArray(fold.byModel));
  });

  test('no records: no-usage, null tokens and cost (the cost read falls back to snapshots, not this fold)', () => {
    const fold = foldRequestUsage([]);
    assert.equal(fold.completeness, 'no-usage');
    assert.equal(fold.tokens, null);
    assert.equal(fold.costUsd, null);
    assert.deepEqual(fold.unpricedModels, []);
    assert.equal(fold.last, null);
    assert.deepEqual(fold.byModel, []);
  });

  test('a non-array input reads as no records', () => {
    assert.equal(foldRequestUsage(undefined).completeness, 'no-usage');
    assert.equal(foldRequestUsage(null).completeness, 'no-usage');
  });
});

describe('foldRequestUsage: pricing is per request', () => {
  test('every record priced: complete, cost is the sum of each record priced alone', () => {
    const fold = foldRequestUsage([rec('a', 1), rec('b', 2), rec('c', 3)]);
    assert.equal(fold.completeness, 'complete');
    close(fold.costUsd, 3 * OPUS_ONE);
    assert.deepEqual(fold.tokens, {
      inputTokens: 3000, outputTokens: 300, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0,
    });
    assert.deepEqual(fold.unpricedModels, []);
  });

  test('Haiku over 100k: each request takes its own tier, so the lineage prices (a snapshot of the same total does not)', () => {
    const small = { model: 'claude-haiku-5-5', inputTokens: 60_000, outputTokens: 500 };
    const large = { model: 'claude-haiku-5-5', inputTokens: 150_000, outputTokens: 500 };
    const fold = foldRequestUsage([rec('a', 1, small), rec('b', 2, large)]);
    assert.equal(fold.completeness, 'complete');
    // Haiku 5.5 rate card: base $0.10/M in, $0.50/M out; over 100k prompt tokens $0.50/M in, $2.50/M out.
    close(fold.costUsd, (60_000 * 0.10 + 500 * 0.50) / 1e6 + (150_000 * 0.50 + 500 * 2.50) / 1e6);
    // The same tokens as one cumulative snapshot price to null (the guard D5 keeps for snapshots).
    assert.equal(computeUsageCostUsd({ model: 'claude-haiku-5-5', harness: 'claude-code', inputTokens: 210_000, outputTokens: 1000 }), null);
  });

  test('the harness label does not change a record\'s price', () => {
    const tokens = { model: 'claude-haiku-5-5', inputTokens: 150_000, outputTokens: 500 };
    const cc = foldRequestUsage([rec('a', 1, { ...tokens, harness: 'claude-code' })]);
    const oc = foldRequestUsage([rec('a', 1, { ...tokens, harness: 'opencode' })]);
    assert.equal(cc.completeness, 'complete');
    assert.equal(cc.costUsd, oc.costUsd);
  });

  test('a native costUsd wins over the read-time price, including 0 and an unknown model', () => {
    const fold = foldRequestUsage([
      rec('a', 1, { harness: 'opencode', costUsd: 0.5 }),
      rec('b', 2, { harness: 'opencode', costUsd: 0 }),
      rec('c', 3, { harness: 'opencode', model: 'some/unknown-model', costUsd: 0.25 }),
    ]);
    assert.equal(fold.completeness, 'complete');
    close(fold.costUsd, 0.75);
  });
});

describe('foldRequestUsage: completeness', () => {
  test('any unpriced record: unpriced, the figure is withheld (never a partial), tokens still summed (LIN-4176)', () => {
    const fold = foldRequestUsage([rec('a', 1), rec('b', 2, { model: '<synthetic>' }), rec('c', 3, { model: 'mystery-model' })]);
    assert.equal(fold.completeness, 'unpriced');
    assert.equal(fold.costUsd, null);
    assert.equal(fold.tokens.inputTokens, 3000);
    assert.deepEqual(fold.unpricedModels.sort(), ['<synthetic>', 'mystery-model']);
  });

  test('a record with no model is unpriced and named `unknown`, as the snapshot fold names it', () => {
    const fold = foldRequestUsage([rec('a', 1, { model: undefined })]);
    assert.equal(fold.completeness, 'unpriced');
    assert.deepEqual(fold.unpricedModels, ['unknown']);
  });

  test('a record is never `unreadable`: records are validated at intake, there is no parse to fail', () => {
    const fold = foldRequestUsage([rec('a', 1, { model: 'mystery-model' })]);
    assert.notEqual(fold.completeness, 'unreadable');
  });
});

describe('foldRequestUsage: labels', () => {
  test('model is the priced model with the largest cost, not the last one', () => {
    // Two cheap Haiku requests late, one Opus request early that costs more.
    const fold = foldRequestUsage([
      rec('a', 1, { model: 'claude-opus-5-5', inputTokens: 100_000 }),
      rec('b', 2, { model: 'claude-haiku-5-5', inputTokens: 1000 }),
      rec('c', 3, { model: 'claude-haiku-5-5', inputTokens: 1000 }),
    ]);
    assert.equal(fold.last.model, 'claude-opus-5-5');
  });

  test('a cost tie goes to the model used latest', () => {
    const fold = foldRequestUsage([
      rec('a', 1, { model: 'model-x', costUsd: 0.1 }),
      rec('b', 5, { model: 'model-y', costUsd: 0.1 }),
      rec('c', 3, { model: 'model-x', costUsd: 0 }),
    ]);
    assert.equal(fold.last.model, 'model-y');
    const reversed = foldRequestUsage([
      rec('a', 5, { model: 'model-x', costUsd: 0.1 }),
      rec('b', 1, { model: 'model-y', costUsd: 0.1 }),
    ]);
    assert.equal(reversed.last.model, 'model-x');
  });

  test('an unpriced model is never the label while a priced one exists', () => {
    const fold = foldRequestUsage([
      rec('a', 1, { model: 'claude-opus-5-5' }),
      rec('b', 2, { model: 'mystery-model', inputTokens: 1_000_000 }),
    ]);
    assert.equal(fold.last.model, 'claude-opus-5-5');
  });

  test('with no priced record the label is the latest record\'s model', () => {
    const fold = foldRequestUsage([rec('a', 2, { model: 'mystery-b' }), rec('b', 1, { model: 'mystery-a' })]);
    assert.equal(fold.last.model, 'mystery-b');
  });

  test('effort and harness are the latest record\'s, by `at`, whatever order the loader returned', () => {
    // The loader sorts by (rootItemId, requestId), not time: `z` is first by id but latest by time.
    const fold = foldRequestUsage([
      rec('a', 1, { effort: 'low', harness: 'opencode' }),
      rec('z', 9, { effort: 'max', harness: 'claude-code' }),
      rec('m', 4, { effort: 'medium', harness: 'opencode' }),
    ]);
    assert.equal(fold.last.effort, 'max');
    assert.equal(fold.last.harness, 'claude-code');
  });

  test('labels do not depend on input order', () => {
    const records = [rec('a', 1, { effort: 'low' }), rec('b', 2, { model: 'claude-haiku-5-5', effort: 'max' }), rec('c', 2, { effort: 'medium' })];
    const forward = foldRequestUsage(records);
    const backward = foldRequestUsage([...records].reverse());
    assert.deepEqual(forward.last, backward.last);
    assert.deepEqual(forward.byModel, backward.byModel);
  });
});

describe('foldRequestUsage: per-model costs', () => {
  test('byModel lists each model\'s requests and priced cost; a model with an unpriced request has a null cost', () => {
    const fold = foldRequestUsage([
      rec('a', 1, { model: 'claude-opus-5-5' }),
      rec('b', 2, { model: 'claude-opus-5-5' }),
      rec('c', 3, { model: 'claude-haiku-5-5' }),
      rec('d', 4, { model: 'mystery-model' }),
    ]);
    const byModel = Object.fromEntries(fold.byModel.map(entry => [entry.model, entry]));
    assert.equal(byModel['claude-opus-5-5'].requests, 2);
    close(byModel['claude-opus-5-5'].costUsd, 2 * OPUS_ONE);
    close(byModel['claude-haiku-5-5'].costUsd, priceRequest(rec('c', 3, { model: 'claude-haiku-5-5' })));
    assert.equal(byModel['mystery-model'].costUsd, null);
    assert.equal(byModel['mystery-model'].pricedRequests, 0);
    // The model costs add up to the lineage's priced part.
    const priced = fold.byModel.reduce((sum, entry) => sum + entry.pricedUsd, 0);
    close(priced, 2 * OPUS_ONE + byModel['claude-haiku-5-5'].costUsd);
  });

  test('a mixed-model lineage prices each model at its own rate, not at the last model', () => {
    const opus = rec('a', 1, { model: 'claude-opus-5-5' });
    const haiku = rec('b', 2, { model: 'claude-haiku-5-5' });
    const fold = foldRequestUsage([opus, haiku]);
    close(fold.costUsd, priceRequest(opus) + priceRequest(haiku));
    assert.notEqual(fold.costUsd, priceRequest({ ...haiku, inputTokens: 2000, outputTokens: 200 }));
  });
});

describe('foldRequestUsage: review note 3, a record lineage is never incomplete', () => {
  test('missingRowsCanChangeFigure is false on every record fold: records are fetched by anchor, not by the caller\'s rows', () => {
    // The loader (`listForAnchors`) resolves the lineage's member rows itself from dispatch-history, so the
    // records a lineage has do not depend on which rows the caller's own (capped or windowed) read returned.
    for (const records of [[rec('a', 1)], [rec('a', 1, { model: 'mystery-model' })]]) {
      assert.equal(foldRequestUsage(records).missingRowsCanChangeFigure, false);
    }
  });

  test('the snapshot fold makes no such claim (its missing rows can change its figure)', () => {
    const snapshot = { harness: 'claude-code', model: 'claude-opus-5-5', inputTokens: 1000, costUsd: 0.004 };
    for (const rows of [[], [{ state: 'present', usage: snapshot }], [{ state: 'unreadable', usage: null }]]) {
      assert.equal(foldLineageUsage(rows).missingRowsCanChangeFigure, undefined);
    }
  });
});

describe('foldRequestUsage: the row a record figure sits on', () => {
  test('lastItemId is the latest record\'s posting row (the run page places the figure by it)', () => {
    const fold = foldRequestUsage([rec('a', 9, { itemId: 'wake-2' }), rec('z', 1, { itemId: 'root-1' })]);
    assert.equal(fold.lastItemId, 'wake-2');
    assert.equal(foldRequestUsage([]).lastItemId, null);
  });
});
