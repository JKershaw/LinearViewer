/**
 * Unit tests for model-pricing.js (LIN-1495)
 *
 * Run with: node --test tests/unit/model-pricing.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  MODEL_PRICING,
  getModelRate,
  getDisplayPricing,
  resolveWorkerModelId,
  computeUsageCostUsd,
} from '../../lib/model-pricing.js';
import { AVAILABLE_MODELS, formatModelPricing } from '../../lib/openrouter.js';

// A real dispatched worker's shape: cache-read dominates the input side.
const WORKER_USAGE = {
  model: 'claude-opus-5',
  inputTokens: 40,
  outputTokens: 12_435,
  cacheCreationInputTokens: 89_849,
  cacheReadInputTokens: 1_090_513,
};

describe('computeUsageCostUsd — arithmetic (LIN-1495)', () => {
  test('prices all four token fields, applying the per-1M divisor exactly once', () => {
    // Hand-computed from anthropic/claude-opus-5's rates, stated independently of
    // the implementation: prompt 5.00, completion 25.00, cacheWrite 6.25,
    // cacheRead 0.50 — all USD per 1M tokens, so ONE division by 1e6 at the end.
    const expected = (
      40 * 5.00
      + 12_435 * 25.00
      + 89_849 * 6.25
      + 1_090_513 * 0.50
    ) / 1e6;

    assert.strictEqual(computeUsageCostUsd(WORKER_USAGE), expected);
    // Sanity on the magnitude: ~$1.42, not ~$1.42e6 and not ~$1.42e-6.
    assert.ok(expected > 1 && expected < 2, `expected ~$1.42, got ${expected}`);
  });

  test('cache tiers are load-bearing: prompt/completion-only pricing overstates ~4.4x', () => {
    const cacheAware = computeUsageCostUsd(WORKER_USAGE);
    // What a regression that silently fell back to the two-tier card would produce:
    // every input-side token billed at the uncached `prompt` rate.
    const naive = (
      (WORKER_USAGE.inputTokens
        + WORKER_USAGE.cacheCreationInputTokens
        + WORKER_USAGE.cacheReadInputTokens) * 5.00
      + WORKER_USAGE.outputTokens * 25.00
    ) / 1e6;

    const overstatement = naive / cacheAware;
    assert.ok(
      overstatement > 4 && overstatement < 5,
      `two-tier pricing should overstate by ~4.4x, got ${overstatement.toFixed(2)}x`
    );
  });

  test('a missing token field is absent, not an error — the present fields still price', () => {
    const cost = computeUsageCostUsd({ model: 'claude-opus-5', outputTokens: 1_000_000 });
    assert.strictEqual(cost, 25.00);
  });

  test('a rate tier the usage does not touch is not required', () => {
    // gpt-5.5-pro exposes no cache tiers at all; zero cache tokens must not block it.
    const cost = computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    assert.strictEqual(cost, 30.00);
  });
});

describe('computeUsageCostUsd — null contract (LIN-1086 / LIN-1495)', () => {
  const nullCases = [
    ['no usage object', undefined],
    ['null usage', null],
    ['non-object usage', 'claude-opus-5'],
    ['no model on the payload', { inputTokens: 1, outputTokens: 2 }],
    ['unmappable model (<synthetic>)', { ...WORKER_USAGE, model: '<synthetic>' }],
    ['unmappable model (bare alias)', { ...WORKER_USAGE, model: 'opus' }],
    ['resolvable model with no rate row', { ...WORKER_USAGE, model: 'claude-opus-9' }],
    ['empty usage object', {}],
    ['zero tokens across every field', {
      model: 'claude-opus-5',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    }],
    ['non-finite token field', { ...WORKER_USAGE, outputTokens: NaN }],
    ['infinite token field', { ...WORKER_USAGE, inputTokens: Infinity }],
    ['negative token field', { ...WORKER_USAGE, cacheReadInputTokens: -1 }],
  ];

  for (const [label, usage] of nullCases) {
    test(`${label} ⇒ null, never 0 or NaN`, () => {
      const cost = computeUsageCostUsd(usage);
      assert.strictEqual(cost, null, `${label} should price to null, got ${cost}`);
    });
  }

  test('a tier the usage USES but the rate does not price ⇒ null, not a silent drop', () => {
    // gpt-5.5-pro has no cacheWrite rate; billing those tokens at zero would
    // understate the cost while still looking authoritative.
    assert.strictEqual(
      computeUsageCostUsd({ model: 'openai/gpt-5.5-pro', outputTokens: 10, cacheCreationInputTokens: 5 }),
      null
    );
  });

  test('never throws on hostile input', () => {
    assert.doesNotThrow(() => computeUsageCostUsd([]));
    assert.doesNotThrow(() => computeUsageCostUsd({ model: 42 }));
    assert.doesNotThrow(() => computeUsageCostUsd({ model: 'claude-opus-5', inputTokens: '10' }));
    assert.strictEqual(computeUsageCostUsd({ model: 'claude-opus-5', inputTokens: '10' }), null);
  });
});

describe('resolveWorkerModelId (LIN-1495)', () => {
  // The model strings actually observed across 2,624 real worker transcripts.
  const cases = [
    ['claude-opus-4-8', 'anthropic/claude-opus-4.8'],
    ['claude-sonnet-5', 'anthropic/claude-sonnet-5'],
    ['claude-opus-5', 'anthropic/claude-opus-5'],
    ['claude-haiku-4-5-20251001', 'anthropic/claude-haiku-4.5'], // date suffix stripped
    ['<synthetic>', null],                                       // no model at all
    ['opus', null],                                              // bare alias, no version
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
    [42, null],
    ['anthropic/claude-opus-4.8', 'anthropic/claude-opus-4.8'],   // already a catalog id
    ['openai/gpt-4-turbo', null],                                 // catalog-shaped but unknown
  ];

  for (const [raw, expected] of cases) {
    test(`${JSON.stringify(raw)} → ${JSON.stringify(expected)}`, () => {
      assert.strictEqual(resolveWorkerModelId(raw), expected);
    });
  }

  test('resolution is not a promise of a rate — a mapped id with no row still prices to null', () => {
    assert.strictEqual(resolveWorkerModelId('claude-opus-9'), 'anthropic/claude-opus-9');
    assert.strictEqual(getModelRate('anthropic/claude-opus-9'), null);
  });

  test('every model string the transcripts emit resolves to a priceable row, or to null on purpose', () => {
    for (const raw of ['claude-opus-4-8', 'claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001']) {
      assert.ok(getModelRate(resolveWorkerModelId(raw)), `${raw} must have a rate row`);
    }
  });
});

describe('rate table shape (LIN-1495)', () => {
  test('every row carries well-formed non-negative prompt/completion rates', () => {
    for (const [id, rate] of Object.entries(MODEL_PRICING)) {
      assert.strictEqual(typeof rate.prompt, 'number', `${id} prompt rate is a number`);
      assert.strictEqual(typeof rate.completion, 'number', `${id} completion rate is a number`);
      assert.ok(rate.prompt >= 0 && rate.completion >= 0, `${id} rates are non-negative`);
      for (const tier of ['cacheRead', 'cacheWrite']) {
        if (rate[tier] !== undefined) {
          assert.ok(Number.isFinite(rate[tier]) && rate[tier] >= 0, `${id} ${tier} rate is well-formed`);
        }
      }
    }
  });

  test('every anthropic/claude-* row carries both cache tiers — they are the point of this table', () => {
    for (const [id, rate] of Object.entries(MODEL_PRICING)) {
      if (!id.startsWith('anthropic/claude-')) continue;
      assert.ok(Number.isFinite(rate.cacheRead), `${id} must price cache reads`);
      assert.ok(Number.isFinite(rate.cacheWrite), `${id} must price cache writes`);
    }
  });

  test('the table and its rows are frozen — a rate card a caller can mutate is not one representation', () => {
    assert.ok(Object.isFrozen(MODEL_PRICING));
    for (const [id, rate] of Object.entries(MODEL_PRICING)) {
      assert.ok(Object.isFrozen(rate), `${id}'s rate row is frozen`);
    }
    const row = getModelRate('anthropic/claude-opus-5');
    assert.throws(() => { 'use strict'; row.prompt = 0; }, TypeError);
    assert.strictEqual(getModelRate('anthropic/claude-opus-5').prompt, 5.00);
  });

  test('getModelRate rejects unknown, falsy, and non-string ids', () => {
    assert.strictEqual(getModelRate('some-provider/unknown-model'), null);
    assert.strictEqual(getModelRate(''), null);
    assert.strictEqual(getModelRate(null), null);
    assert.strictEqual(getModelRate(42), null);
    assert.strictEqual(getModelRate('toString'), null); // no prototype-chain leak
  });
});

describe('AVAILABLE_MODELS derives its pricing from this table (LIN-993 charter preserved)', () => {
  // Known-good pricing for every currently curated entry (LIN-1763 widened this
  // past the original 5-id extraction snapshot; see the superset invariant test
  // below for what actually must hold going forward).
  const CURRENT_PRICING = {
    'openai/gpt-5.4-mini': { prompt: 0.75, completion: 4.50 },
    'anthropic/claude-sonnet-4.6': { prompt: 3.00, completion: 15.00 },
    'anthropic/claude-opus-4.8': { prompt: 5.00, completion: 25.00 },
    'openai/gpt-5.5': { prompt: 5.00, completion: 30.00 },
    'openai/gpt-5.5-pro': { prompt: 30.00, completion: 180.00 },
    'anthropic/claude-sonnet-5': { prompt: 2.00, completion: 10.00 },
    'anthropic/claude-opus-5': { prompt: 5.00, completion: 25.00 },
    'anthropic/claude-fable-5': { prompt: 10.00, completion: 50.00 },
    'anthropic/claude-haiku-4.5': { prompt: 1.00, completion: 5.00 },
    'openai/gpt-5.6-sol': { prompt: 5.00, completion: 30.00 },
  };

  test('every curated entry deep-equals its known-good pricing', () => {
    assert.deepStrictEqual(
      AVAILABLE_MODELS.map(m => m.id).sort(),
      Object.keys(CURRENT_PRICING).sort(),
      'the curated allowlist must match the known-good pricing snapshot exactly — update both together'
    );
    for (const m of AVAILABLE_MODELS) {
      assert.deepStrictEqual(m.pricing, CURRENT_PRICING[m.id], `${m.id} pricing is unchanged`);
    }
  });

  test('the derived view is exactly two tiers — no cache keys leak into the display shape', () => {
    for (const m of AVAILABLE_MODELS) {
      assert.deepStrictEqual(Object.keys(m.pricing).sort(), ['completion', 'prompt']);
    }
  });

  test('the rendered pricing hint is byte-identical for every curated model', () => {
    const expected = {
      'openai/gpt-5.4-mini': '$0.75 in / $4.50 out per 1M tokens',
      'anthropic/claude-sonnet-4.6': '$3.00 in / $15.00 out per 1M tokens',
      'anthropic/claude-opus-4.8': '$5.00 in / $25.00 out per 1M tokens',
      'openai/gpt-5.5': '$5.00 in / $30.00 out per 1M tokens',
      'openai/gpt-5.5-pro': '$30.00 in / $180.00 out per 1M tokens',
      'anthropic/claude-sonnet-5': '$2.00 in / $10.00 out per 1M tokens',
      'anthropic/claude-opus-5': '$5.00 in / $25.00 out per 1M tokens',
      'anthropic/claude-fable-5': '$10.00 in / $50.00 out per 1M tokens',
      'anthropic/claude-haiku-4.5': '$1.00 in / $5.00 out per 1M tokens',
      'openai/gpt-5.6-sol': '$5.00 in / $30.00 out per 1M tokens',
    };
    for (const m of AVAILABLE_MODELS) {
      assert.strictEqual(formatModelPricing(m), expected[m.id], `${m.id} hint is byte-identical`);
    }
  });

  test('MODEL_PRICING is a superset of AVAILABLE_MODELS — every curated id is priceable (membership flows one way)', () => {
    for (const m of AVAILABLE_MODELS) {
      assert.ok(getModelRate(m.id), `${m.id} must be priceable — a curated entry with no rate row is a charter violation`);
    }
  });

  test('getDisplayPricing degrades to null for an id with no rate', () => {
    assert.strictEqual(getDisplayPricing('some-provider/unknown-model'), null);
    assert.strictEqual(formatModelPricing({ pricing: getDisplayPricing('nope/nope') }), null);
  });
});
