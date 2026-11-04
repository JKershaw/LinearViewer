/**
 * LIN-4198 beat 2: characterization of the LEGACY snapshot pricing path, written before the
 * per-request change and pinned to hand-worked arithmetic (never to the code's own output).
 * Every expected figure below is derived from the rate table rows in lib/model-pricing.js:
 * USD per 1M tokens, divided by 1e6 once.
 *
 * These must pass on the unchanged code and still pass after it. The snapshot path keeps its
 * `crossesThreshold && isRunningTotal` null guard exactly as it is.
 *
 * Run with: node --test tests/unit/lin-4198-pricing-characterization.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeUsageCostUsd } from '../../lib/model-pricing.js';

describe('snapshot pricing (legacy path) — hand-worked figures', () => {
  test('Haiku 5.5 below the 100k threshold: base rates (prompt 0.10, completion 0.50)', () => {
    // 1000 * 0.10 + 500 * 0.50 = 350 per 1M
    const usage = { model: 'claude-haiku-5-5', harness: 'claude-code', inputTokens: 1000, outputTokens: 500 };
    assert.equal(computeUsageCostUsd(usage), 350 / 1e6);
  });

  test('Haiku 5.5 at exactly 100,000 prompt tokens stays on the base rate (gate is strictly greater)', () => {
    // 100000 * 0.10 = 10000 per 1M
    const usage = { model: 'claude-haiku-5-5', harness: 'claude-code', inputTokens: 100000 };
    assert.equal(computeUsageCostUsd(usage), 10000 / 1e6);
  });

  test('Haiku 5.5 over 100k under claude-code (cumulative row) is null: the guard holds', () => {
    const usage = { model: 'claude-haiku-5-5', harness: 'claude-code', inputTokens: 150000, outputTokens: 1000 };
    assert.equal(computeUsageCostUsd(usage), null);
  });

  test('Haiku 5.5 over 100k with no harness field is null too: an unknown harness is a running total', () => {
    const usage = { model: 'claude-haiku-5-5', inputTokens: 150000, outputTokens: 1000 };
    assert.equal(computeUsageCostUsd(usage), null);
  });

  test('the guard counts the whole prompt: cache-read alone pushing a claude-code row over 100k nulls it', () => {
    const usage = { model: 'claude-haiku-5-5', harness: 'claude-code', inputTokens: 10, cacheReadInputTokens: 150000 };
    assert.equal(computeUsageCostUsd(usage), null);
  });

  test('Haiku 5.5 over 100k under opencode (per-request row) prices at the override tier (prompt 0.50, completion 2.50)', () => {
    // 150000 * 0.50 + 1000 * 2.50 = 77500 per 1M
    const usage = { model: 'claude-haiku-5-5', harness: 'opencode', inputTokens: 150000, outputTokens: 1000 };
    assert.equal(computeUsageCostUsd(usage), 77500 / 1e6);
  });

  test('a model with no override tier is unaffected by the guard at any size (claude-code)', () => {
    // anthropic/claude-haiku-4.5 has no overrides: 150000 * 1.00 = 150000 per 1M
    const usage = { model: 'anthropic/claude-haiku-4.5', harness: 'claude-code', inputTokens: 150000 };
    assert.equal(computeUsageCostUsd(usage), 150000 / 1e6);
  });

  test('a native costUsd on the snapshot usage is NOT read by computeUsageCostUsd (precedence lives in session-telemetry)', () => {
    const usage = { model: 'claude-haiku-5-5', harness: 'claude-code', inputTokens: 1000, costUsd: 9.99 };
    assert.equal(computeUsageCostUsd(usage), 100 / 1e6);
  });

  test('unpriceable inputs stay null: missing model, zero tokens, negative tokens', () => {
    assert.equal(computeUsageCostUsd({ harness: 'claude-code', inputTokens: 1000 }), null);
    assert.equal(computeUsageCostUsd({ model: 'claude-haiku-5-5', harness: 'claude-code', inputTokens: 0 }), null);
    assert.equal(computeUsageCostUsd({ model: 'claude-haiku-5-5', harness: 'claude-code', inputTokens: -1 }), null);
    assert.equal(computeUsageCostUsd(null), null);
  });
});
