/**
 * LIN-4358: a model's rate is read from its OpenRouter catalog `pricing` (lib/catalog-rate.js),
 * long-context and time-of-day tiers included, and a request record is priced at the tier its
 * own moment falls in. Fixtures are the real 8 Nov 2026 catalog slice; nothing here touches
 * the network.
 *
 * Run with: node --test tests/unit/catalog-rate.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rateFromCatalogPricing, unmodelledGates, timeGatesHold } from '../../lib/catalog-rate.js';
import { getModelRate, selectRateForPrompt, priceRequest, computeUsageCostUsd } from '../../lib/model-pricing.js';
import { seedPinnedCatalog, clearCatalog, PINNED_CATALOG_BODY } from './helpers/pinned-catalog.js';

const raw = (id) => PINNED_CATALOG_BODY.data.find(m => m.id === id).pricing;
const at = (iso) => Date.parse(iso);

describe('rateFromCatalogPricing', () => {
  test('converts per-token strings to USD per 1M, once, without float noise', () => {
    assert.deepEqual({ ...rateFromCatalogPricing(raw('anthropic/claude-haiku-5.5')), overrides: undefined }, {
      prompt: 0.1, completion: 0.5, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.2, overrides: undefined,
    });
  });

  test('keeps a long-context override with its threshold, in the rate vocabulary', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(rateFromCatalogPricing(raw('openai/gpt-6.1-sol')).overrides)), [
      { minPromptTokens: 272000, prompt: 4, completion: 15, cacheRead: 0.2, cacheWrite: 5 },
    ]);
  });

  test('keeps time-of-day overrides as HHMM windows', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(rateFromCatalogPricing(raw('minimax/minimax-m3.1-flash')).overrides)), [
      { utcStart: 1500, utcEnd: 100, prompt: 0.075, completion: 0.3, cacheRead: 0.0075 },
      { utcStart: 100, utcEnd: 1500, prompt: 0.15, completion: 0.6, cacheRead: 0.015 },
    ]);
  });

  test('ignores tiers a usage record does not count (web_search, image, internal_reasoning)', () => {
    const rate = rateFromCatalogPricing({ prompt: '0.000001', completion: '0.000002', web_search: '0.01', image: '0.5', internal_reasoning: '0.000002' });
    assert.deepEqual({ ...rate }, { prompt: 1, completion: 2 });
  });

  test('no usable base price is null, never a guess: variable routers (-1), missing or junk tiers', () => {
    assert.equal(rateFromCatalogPricing(raw('openrouter/auto')), null);
    assert.equal(rateFromCatalogPricing({ prompt: '0.000001' }), null);
    assert.equal(rateFromCatalogPricing({ prompt: '', completion: '0' }), null);
    assert.equal(rateFromCatalogPricing({ prompt: 'x', completion: '0' }), null);
    assert.equal(rateFromCatalogPricing(null), null);
  });

  test('a free model is priced at zero, not unknown', () => {
    assert.deepEqual({ ...rateFromCatalogPricing({ prompt: '0', completion: '0' }) }, { prompt: 0, completion: 0 });
  });

  test('the rate is frozen and memoized per pricing object', () => {
    const pricing = raw('openai/gpt-5.5');
    const a = rateFromCatalogPricing(pricing);
    assert.equal(rateFromCatalogPricing(pricing), a);
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.overrides) && Object.isFrozen(a.overrides[0]));
  });

  test('an override gated on an unknown key is dropped from the rate and named', () => {
    const pricing = { prompt: '0.000001', completion: '0.000002', overrides: [{ region: 'eu', prompt: '0.000009' }, { min_prompt_tokens: 10, prompt: '0.000003' }] };
    assert.deepEqual(JSON.parse(JSON.stringify(rateFromCatalogPricing(pricing).overrides)), [{ minPromptTokens: 10, prompt: 3 }]);
    assert.deepEqual(unmodelledGates(pricing), ['region']);
    assert.deepEqual(unmodelledGates(raw('minimax/minimax-m3.1-flash')), []);
  });
});

describe('timeGatesHold', () => {
  test('a window wraps past midnight when it ends at or before it starts', () => {
    const night = { utcStart: 1500, utcEnd: 100 };
    assert.equal(timeGatesHold(night, at('2026-11-08T15:00:00Z')), true);
    assert.equal(timeGatesHold(night, at('2026-11-08T23:59:00Z')), true);
    assert.equal(timeGatesHold(night, at('2026-11-09T00:59:00Z')), true);
    assert.equal(timeGatesHold(night, at('2026-11-09T01:00:00Z')), false, 'the end is exclusive');
    assert.equal(timeGatesHold(night, at('2026-11-08T14:59:00Z')), false);
    assert.equal(timeGatesHold({ utcStart: 1600, utcEnd: 0 }, at('2026-11-08T23:00:00Z')), true, '16:00 to midnight');
  });

  test('days are UTC days', () => {
    const weekend = { utcDays: ['saturday', 'sunday'] };
    assert.equal(timeGatesHold(weekend, at('2026-11-08T12:00:00Z')), true, '8 Nov 2026 is a Sunday');
    assert.equal(timeGatesHold(weekend, at('2026-11-09T12:00:00Z')), false);
  });

  test('a timed entry does not hold at an unknown moment; an untimed one always does', () => {
    assert.equal(timeGatesHold({ utcStart: 0, utcEnd: 2400 }, undefined), false);
    assert.equal(timeGatesHold({ minPromptTokens: 5 }, undefined), true);
  });
});

describe('pricing usage from the catalog (lib/model-pricing.js)', () => {
  beforeEach(() => seedPinnedCatalog());
  afterEach(() => clearCatalog());

  const usage = { inputTokens: 10_000, outputTokens: 2_000, cacheReadInputTokens: 0, harness: 'opencode', model: 'minimax/minimax-m3.1-flash' };

  test('a request record is priced at the tier its own moment falls in', () => {
    // 10,000 × 0.075 + 2,000 × 0.30 = 1,350 per 1M in the 15:00–01:00 window; 10,000 × 0.15 + 2,000 × 0.60 = 2,700 outside it.
    assert.equal(priceRequest({ ...usage, at: '2026-11-08T16:30:00Z' }), 0.00135);
    assert.equal(priceRequest({ ...usage, at: '2026-11-08T09:30:00Z' }), 0.0027);
    assert.equal(priceRequest({ ...usage, at: new Date('2026-11-08T00:30:00Z') }), 0.00135);
  });

  test('a usage with no moment, and a session snapshot, price at the base rate (as before time tiers)', () => {
    assert.equal(priceRequest(usage), 0.0027);
    assert.equal(computeUsageCostUsd({ ...usage, at: '2026-11-08T16:30:00Z' }), 0.0027);
  });

  test('a long-context tier still needs the request to be strictly over its threshold', () => {
    const rate = getModelRate('openai/gpt-6.1-sol');
    assert.equal(selectRateForPrompt(rate, 272000), rate);
    assert.equal(selectRateForPrompt(rate, 272001).prompt, 4);
  });

  test('a cold catalog prices nothing: null, the honest unknown', () => {
    clearCatalog();
    assert.equal(getModelRate('openai/gpt-6.1-sol'), null);
    assert.equal(priceRequest({ ...usage, at: '2026-11-08T16:30:00Z' }), null);
  });
});
