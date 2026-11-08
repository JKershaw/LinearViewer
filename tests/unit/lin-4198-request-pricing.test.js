/**
 * LIN-4198 beat 2 (LIN-4195 D5): per-request pricing. A stored per-request usage record is one model
 * request, so it takes the tier rate for its OWN prompt size (selectRateForPrompt), whatever
 * its `harness` says. Native `costUsd` on a record wins over the read-time price.
 *
 * Expected figures are hand-worked from the pinned catalog's rates (LIN-4358; USD per 1M
 * tokens, divided by 1e6 once), never taken from the code under test.
 *
 * Run with: node --test tests/unit/lin-4198-request-pricing.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { priceRequest, computeUsageCostUsd } from '../../lib/model-pricing.js';
import { seedPinnedCatalog } from './helpers/pinned-catalog.js';

// LIN-4358: rates and names come from the catalog; price from the pinned 8 Nov 2026 snapshot.
seedPinnedCatalog();

/** A record as the store holds it: identity and metadata, then the five counters. */
const record = (fields = {}) => ({
  requestId: 'msg_1',
  harness: 'claude-code',
  model: 'claude-haiku-5-5',
  effort: 'high',
  lane: 'build',
  agent: 'main',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheCreation1hInputTokens: 0,
  cacheReadInputTokens: 0,
  ...fields
});

describe('priceRequest — prices by the record, not the harness', () => {
  test('the same tokens and model price identically as a record under claude-code and under opencode', () => {
    const tokens = { inputTokens: 1000, outputTokens: 500 };
    const asClaude = priceRequest(record({ harness: 'claude-code', ...tokens }));
    const asOpencode = priceRequest(record({ harness: 'opencode', ...tokens }));
    assert.equal(asClaude, asOpencode);
    assert.equal(asClaude, 350 / 1e6); // 1000 * 0.10 + 500 * 0.50
  });

  test('a Haiku 5.5 request over 100k prices at the tier rate under claude-code (the cumulative guard does not apply to a record)', () => {
    // prompt 150000 > 100000: override prompt 0.50, completion 2.50 → 150000 * 0.50 + 1000 * 2.50 = 77500
    const r = record({ harness: 'claude-code', inputTokens: 150000, outputTokens: 1000 });
    assert.equal(priceRequest(r), 77500 / 1e6);
  });

  test('the same Haiku request under opencode prices identically', () => {
    const r = record({ harness: 'opencode', inputTokens: 150000, outputTokens: 1000 });
    assert.equal(priceRequest(r), 77500 / 1e6);
  });

  test('the threshold is strictly greater for a record: exactly 100,000 prompt tokens stays on the base rate', () => {
    // 100000 * 0.10 = 10000
    assert.equal(priceRequest(record({ inputTokens: 100000 })), 10000 / 1e6);
  });

  test('a record with no harness field still prices its own size', () => {
    const r = record({ harness: undefined, inputTokens: 150000, outputTokens: 1000 });
    assert.equal(priceRequest(r), 77500 / 1e6);
  });

  test('the prompt size counts the whole prompt: cache-read alone crossing 100k sets the override rate', () => {
    // promptTokens = 10 + 150000 = 150010 > 100000; override cacheRead 0.05 → 150000 * 0.05 = 7500, input 10 * 0.50 = 5
    const r = record({ inputTokens: 10, cacheReadInputTokens: 150000 });
    assert.equal(priceRequest(r), 7505 / 1e6);
  });

  test('cache writes split across 5m and 1h tiers as in the snapshot path: 600 at 0.125 plus 400 at 0.20', () => {
    // cacheCreationInputTokens 1000 with 1h partition 400: 600 * 0.125 + 400 * 0.20 = 155
    const r = record({ cacheCreationInputTokens: 1000, cacheCreation1hInputTokens: 400 });
    assert.equal(priceRequest(r), 155 / 1e6);
  });

  test('the same record that the snapshot path nulls is priced by priceRequest (the contrast this change exists for)', () => {
    const snapshot = { model: 'claude-haiku-5-5', harness: 'claude-code', inputTokens: 150000, outputTokens: 1000 };
    assert.equal(computeUsageCostUsd(snapshot), null);
    assert.equal(priceRequest(record({ harness: 'claude-code', inputTokens: 150000, outputTokens: 1000 })), 77500 / 1e6);
  });
});

describe('priceRequest — native costUsd wins over the read-time price', () => {
  test('a record with a native costUsd prices to that figure, not to the table rate', () => {
    // the table would give 77500 / 1e6 = 0.0775; the native 0.01 wins
    const r = record({ inputTokens: 150000, outputTokens: 1000, costUsd: 0.01 });
    assert.equal(priceRequest(r), 0.01);
  });

  test('a native costUsd of 0 is a figure and wins too (a number, not "absent")', () => {
    const r = record({ inputTokens: 1000, costUsd: 0 });
    assert.equal(priceRequest(r), 0);
  });

  test('a native costUsd wins even on a model the table does not know', () => {
    const r = record({ model: 'some-unknown-model', inputTokens: 1000, costUsd: 0.25 });
    assert.equal(priceRequest(r), 0.25);
  });

  test('a non-number costUsd is ignored and the read-time price applies', () => {
    const r = record({ inputTokens: 1000, costUsd: null });
    assert.equal(priceRequest(r), 100 / 1e6);
  });
});

describe('priceRequest — the null contract (unchanged from computeUsageCostUsd)', () => {
  test('no tokens and no native cost ⇒ null, never 0', () => {
    assert.equal(priceRequest(record({ inputTokens: 0, outputTokens: 0 })), null);
  });

  test('an unknown model with no native cost ⇒ null', () => {
    assert.equal(priceRequest(record({ model: '<synthetic>', inputTokens: 1000 })), null);
  });

  test('a negative token count ⇒ null', () => {
    assert.equal(priceRequest(record({ inputTokens: -5 })), null);
  });

  test('a tier the record uses but the rate does not price ⇒ null (non-Anthropic row has no write tier)', () => {
    assert.equal(priceRequest(record({ model: 'deepseek/deepseek-v4.1-flash-1017', cacheCreationInputTokens: 100 })), null);
  });

  test('never throws on a null or non-object record', () => {
    assert.equal(priceRequest(null), null);
    assert.equal(priceRequest(undefined), null);
    assert.equal(priceRequest('record'), null);
  });
});
