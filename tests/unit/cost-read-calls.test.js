/**
 * Unit tests for lib/cost-read-calls.js: the Harbour calls read (LIN-4179), split out of lib/cost-read.js in LIN-4457.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/cost-read-calls.test.js
 *
 * Pure over the docs given: the figure rule (`readCalls`), S1's wire shape (`appCallsOf`) and the workspace calls
 * surface (`callsSurfaceOf`). The store reads that feed them (`listInHorizon`) are tested in tests/unit/llm-call-log.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readCalls, appCallsOf, callsSurfaceOf } from '../../lib/cost-read-calls.js';

describe('readCalls: the calls figure (LIN-4179, the figure rule)', () => {
  const doc = (feature, cost) => ({ feature, model: 'm1', cost });

  test('a null cost is counted as unpriced, never added as 0', () => {
    const f = readCalls([doc('scan', 0.03), doc('scan', null), doc('review', 0)]);
    assert.strictEqual(f.calls, 3);
    assert.strictEqual(f.pricedCalls, 2);
    assert.strictEqual(f.unpricedCalls, 1);
    assert.strictEqual(f.pricedUsd, 0.03);
    assert.strictEqual(f.complete, false);
    assert.strictEqual(f.totalUsd, null, 'a partly priced sum publishes no total');
  });

  test('a complete zero is a real total of $0, distinct from no data', () => {
    const zero = readCalls([doc('review', 0)]);
    assert.strictEqual(zero.complete, true);
    assert.strictEqual(zero.totalUsd, 0);
    const none = readCalls([]);
    assert.strictEqual(none.calls, 0);
    assert.strictEqual(none.complete, false, 'no calls is no data, not a complete zero');
    assert.strictEqual(none.totalUsd, null);
  });

  test('byFeature is busiest first, with each feature\'s priced sum and unpriced count', () => {
    const f = readCalls([doc('review', null), doc('scan', 0.05), doc('scan', 0.03), doc('scan', null)]);
    assert.deepStrictEqual(f.byFeature.map(r => r.feature), ['scan', 'review']);
    assert.deepStrictEqual(f.byFeature[0], { feature: 'scan', calls: 3, pricedCalls: 2, unpricedCalls: 1, pricedUsd: 0.08 });
  });
});

describe('appCallsOf and callsSurfaceOf: the wire shape and the surfaces (LIN-4179)', () => {
  test('appCallsOf is the S1 wire shape: calls, costUsd (the priced sum), unpricedCalls, byFeature (feature, calls, costUsd)', () => {
    const app = appCallsOf([
      { feature: 'proxy-x', model: 'm', cost: 0.2 },
      { feature: 'review', model: 'm', cost: null },
    ]);
    assert.deepStrictEqual(Object.keys(app), ['calls', 'costUsd', 'unpricedCalls', 'byFeature']);
    assert.deepStrictEqual(app, {
      calls: 2,
      costUsd: 0.2,
      unpricedCalls: 1,
      byFeature: [
        { feature: 'proxy-x', calls: 1, costUsd: 0.2 },
        { feature: 'review', calls: 1, costUsd: 0 },
      ],
    });
  });

  test('appCallsOf over no calls is the literal zero shape (never the no-data carrier)', () => {
    assert.deepStrictEqual(appCallsOf([]), { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] });
  });

  test('callsSurfaceOf is Health\'s and the Weather line\'s figure: the calls read and the telemetry, with the unpriced count', () => {
    const s = callsSurfaceOf([{ feature: 'scan', model: 'm', cost: 0.04, totalTokens: 7, timestamp: new Date('2026-11-01T00:00:00Z') }, { feature: 'scan', model: 'm', cost: null, totalTokens: 3, timestamp: new Date('2026-11-02T00:00:00Z') }]);
    assert.strictEqual(s.totalCalls, 2);
    assert.strictEqual(s.totalTokens, 10);
    assert.strictEqual(s.lastCallAt, '2026-11-02T00:00:00.000Z');
    assert.strictEqual(s.pricedUsd, 0.04);
    assert.strictEqual(s.unpricedCalls, 1);
    assert.strictEqual(s.totalUsd, null);
    assert.strictEqual(s.complete, false);
  });
});
