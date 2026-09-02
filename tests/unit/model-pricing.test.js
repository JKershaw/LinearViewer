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
  selectRateForPrompt,
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
    // Stays under the LIN-2403 272,000 long-context override threshold so this
    // exercises the base rate, not the override tier (covered separately below).
    const cost = computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      inputTokens: 200_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    assert.strictEqual(cost, 200_000 * 30.00 / 1e6);
  });
});

describe('computeUsageCostUsd — 1h cache-write split (LIN-2113)', () => {
  test('splits cacheCreationInputTokens across cacheWrite1h and cacheWrite by the 1h partition marker', () => {
    const usage = {
      ...WORKER_USAGE,
      cacheCreation1hInputTokens: 80_000, // of the 89_849 total; remainder is 5m
    };
    // anthropic/claude-opus-5: prompt 5.00, completion 25.00, cacheWrite 6.25,
    // cacheWrite1h 10.00, cacheRead 0.50 — all USD per 1M tokens.
    const expected = (
      40 * 5.00
      + 12_435 * 25.00
      + 80_000 * 10.00           // 1h portion at cacheWrite1h
      + (89_849 - 80_000) * 6.25 // remainder at cacheWrite (5m)
      + 1_090_513 * 0.50
    ) / 1e6;
    assert.strictEqual(computeUsageCostUsd(usage), expected);
  });

  test('absent cacheCreation1hInputTokens prices byte-identically to pre-LIN-2113 behavior', () => {
    assert.strictEqual(computeUsageCostUsd(WORKER_USAGE), computeUsageCostUsd({ ...WORKER_USAGE }));
    // WORKER_USAGE itself never carries the field — this is the historical/OpenCode shape.
    assert.strictEqual('cacheCreation1hInputTokens' in WORKER_USAGE, false);
    const expected = (
      40 * 5.00
      + 12_435 * 25.00
      + 89_849 * 6.25 // entire total at the 5m rate, as before this field existed
      + 1_090_513 * 0.50
    ) / 1e6;
    assert.strictEqual(computeUsageCostUsd(WORKER_USAGE), expected);
  });

  test('a 1h count exceeding the total clamps rather than going negative on the cacheWrite remainder', () => {
    const usage = {
      model: 'claude-opus-5',
      outputTokens: 1, // keep tokenTotal non-zero regardless of the cache split
      cacheCreationInputTokens: 100,
      cacheCreation1hInputTokens: 1_000_000, // wildly exceeds the total
    };
    const expected = (1 * 25.00 + 100 * 10.00) / 1e6; // entire total clamped to the 1h rate
    assert.strictEqual(computeUsageCostUsd(usage), expected);
  });

  test('cacheCreation1hInputTokens on a model with no cacheWrite1h rate ⇒ null, never a silent fallback', () => {
    // Every non-anthropic/claude-* row (gpt-5.6-sol included) has no cacheWrite1h.
    assert.strictEqual(computeUsageCostUsd({
      model: 'openai/gpt-5.6-sol',
      outputTokens: 1,
      cacheCreationInputTokens: 100,
      cacheCreation1hInputTokens: 10,
    }), null);
  });

  test('a present-but-zero 1h count on a non-Anthropic row does NOT require cacheWrite1h (load-bearing: present ≠ non-zero)', () => {
    const cost = computeUsageCostUsd({
      model: 'openai/gpt-5.6-sol',
      outputTokens: 1,
      cacheCreationInputTokens: 100,
      cacheCreation1hInputTokens: 0,
    });
    assert.strictEqual(cost, (1 * 10.00 + 100 * 2.50) / 1e6);
  });

  for (const [label, oneHour] of [
    ['negative', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ]) {
    test(`cacheCreation1hInputTokens ${label} ⇒ null for the whole usage`, () => {
      assert.strictEqual(computeUsageCostUsd({ ...WORKER_USAGE, cacheCreation1hInputTokens: oneHour }), null);
    });
  }

  test('1h present and valid but the total is absent ⇒ null (N1: prevents min(1h, undefined) → NaN)', () => {
    const usage = {
      model: 'claude-opus-5',
      outputTokens: 1,
      cacheCreation1hInputTokens: 10,
      // cacheCreationInputTokens deliberately omitted — a corrupt payload
    };
    assert.strictEqual(computeUsageCostUsd(usage), null);
  });

  for (const [label, total] of [
    ['non-finite', NaN],
    ['negative', -1],
  ]) {
    test(`1h present and valid but the total is ${label} ⇒ null`, () => {
      const usage = {
        model: 'claude-opus-5',
        outputTokens: 1,
        cacheCreationInputTokens: total,
        cacheCreation1hInputTokens: 10,
      };
      assert.strictEqual(computeUsageCostUsd(usage), null);
    });
  }
});

describe('selectRateForPrompt — LIN-2403', () => {
  const base = Object.freeze({ prompt: 1, completion: 2, cacheRead: 0.1 });

  test('no overrides ⇒ the identical object reference, no allocation', () => {
    assert.strictEqual(selectRateForPrompt(base, 1_000_000), base);
  });

  test('empty overrides array ⇒ the identical object reference', () => {
    const rate = Object.freeze({ ...base, overrides: Object.freeze([]) });
    assert.strictEqual(selectRateForPrompt(rate, 1_000_000), rate);
  });

  test('below the threshold ⇒ the identical object reference (no allocation)', () => {
    const rate = Object.freeze({ ...base, overrides: [{ minPromptTokens: 100, prompt: 2 }] });
    assert.strictEqual(selectRateForPrompt(rate, 100), rate); // strict > — exactly the threshold stays base
    assert.strictEqual(selectRateForPrompt(rate, 99), rate);
  });

  test('above the threshold ⇒ a merged row, base row untouched', () => {
    const rate = Object.freeze({ ...base, overrides: [{ minPromptTokens: 100, prompt: 2 }] });
    const merged = selectRateForPrompt(rate, 101);
    assert.notStrictEqual(merged, rate);
    assert.strictEqual(merged.prompt, 2);
    assert.strictEqual(merged.completion, 2, 'an omitted key inherits the base row (merge, not replace)');
    assert.strictEqual(merged.cacheRead, 0.1, 'an omitted key inherits the base row (merge, not replace)');
    assert.strictEqual(rate.prompt, 1, 'the base row itself is never mutated');
  });

  test('multiple applicable entries: later entries win per key, in array order', () => {
    const rate = Object.freeze({
      ...base,
      overrides: [
        { minPromptTokens: 100, prompt: 2, completion: 20 },
        { minPromptTokens: 200, prompt: 3 }, // omits completion — does NOT revert it to base
      ],
    });
    const merged = selectRateForPrompt(rate, 201);
    assert.strictEqual(merged.prompt, 3, 'the later (200) entry wins over the earlier (100) entry');
    assert.strictEqual(merged.completion, 20, 'a key the later entry omits keeps the earlier applicable entry\'s value');
  });

  test('a middle threshold applies, a higher one does not', () => {
    const rate = Object.freeze({
      ...base,
      overrides: [
        { minPromptTokens: 100, prompt: 2 },
        { minPromptTokens: 1000, prompt: 3 },
      ],
    });
    const merged = selectRateForPrompt(rate, 500);
    assert.strictEqual(merged.prompt, 2);
  });

  test('a time-window-only entry (no minPromptTokens) is never applied as a token gate', () => {
    const rate = Object.freeze({
      ...base,
      overrides: [{ utcDays: [1, 2, 3], utcStart: 0, utcEnd: 800, prompt: 999 }],
    });
    assert.strictEqual(selectRateForPrompt(rate, Number.MAX_SAFE_INTEGER), rate);
  });
});

describe('computeUsageCostUsd — long-context override tier (LIN-2403)', () => {
  test('a prompt above minPromptTokens prices at the override rate, not the base', () => {
    const cost = computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      harness: 'opencode',
      inputTokens: 300_000,
      outputTokens: 0,
    });
    assert.strictEqual(cost, 300_000 * 60.00 / 1e6); // override prompt rate, not the base 30.00
  });

  test('the threshold is strictly greater — exactly minPromptTokens stays on the base rate', () => {
    const atThreshold = computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      harness: 'opencode',
      inputTokens: 272_000,
      outputTokens: 0,
    });
    assert.strictEqual(atThreshold, 272_000 * 30.00 / 1e6);

    const justOver = computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      harness: 'opencode',
      inputTokens: 272_001,
      outputTokens: 0,
    });
    assert.strictEqual(justOver, 272_001 * 60.00 / 1e6);
  });

  test('the threshold counts the WHOLE prompt — inputTokens + cacheRead + cacheCreation together cross it', () => {
    // 100k + 100k + 80k = 280k > 272k, though no single field (nor any pair) alone
    // crosses it — proving the threshold check sums all three, not just inputTokens
    // or inputTokens+cacheRead.
    const cost = computeUsageCostUsd({
      model: 'openai/gpt-5.6-sol',
      harness: 'opencode',
      inputTokens: 100_000,
      cacheReadInputTokens: 100_000,
      cacheCreationInputTokens: 80_000,
      outputTokens: 0,
    });
    const expected = (100_000 * 4.00 + 100_000 * 0.40 + 80_000 * 5.00) / 1e6; // override rates
    assert.strictEqual(cost, expected);
    // Sanity: the base-rate reading (had the sum not crossed) would have been half this.
    const baseReading = (100_000 * 2.00 + 100_000 * 0.20 + 80_000 * 2.50) / 1e6;
    assert.strictEqual(cost, baseReading * 2);
  });

  test('the threshold counts the WHOLE prompt — inputTokens + cacheRead alone crossing is enough', () => {
    const cost = computeUsageCostUsd({
      model: 'openai/gpt-5.5',
      harness: 'opencode',
      inputTokens: 10_000,
      cacheReadInputTokens: 265_000, // 275k total > 272k
      outputTokens: 1,
    });
    const expected = (10_000 * 10.00 + 265_000 * 1.00 + 1 * 45.00) / 1e6; // override rates
    assert.strictEqual(cost, expected);
  });

  test('an override tier neither row prices stays absent — merge does not invent a tier', () => {
    // openai/gpt-5.5's override models prompt/completion/cacheRead but not cacheWrite;
    // gpt-5.5 has no cacheWrite rate at the base tier either, so a non-zero
    // cache-creation total still prices to null under the override, exactly as it
    // would under the base rate (the meaningful "omitted key inherits a REAL base
    // price" case is covered directly against a synthetic rate in the
    // selectRateForPrompt suite above, since none of this table's 3 real
    // override-bearing rows happen to omit a tier their base row prices).
    assert.strictEqual(computeUsageCostUsd({
      model: 'openai/gpt-5.5',
      harness: 'opencode',
      inputTokens: 300_000,
      cacheCreationInputTokens: 1,
    }), null);
  });

  test('computeUsageCostUsd selects the override rate through selectRateForPrompt faithfully', () => {
    const cost = computeUsageCostUsd({
      model: 'openai/gpt-5.6-sol',
      harness: 'opencode',
      inputTokens: 300_000,
      outputTokens: 1,
      cacheCreationInputTokens: 10,
    });
    const expected = (300_000 * 4.00 + 1 * 15.00 + 10 * 5.00) / 1e6;
    assert.strictEqual(cost, expected);
  });

  test('a cumulative (claude-code) row on an override-bearing model prices to null once it clears a threshold, never a guessed tier', () => {
    assert.strictEqual(computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      harness: 'claude-code',
      inputTokens: 300_000,
      outputTokens: 1,
    }), null);
  });

  test('an unknown/absent-harness row on an override-bearing model also prices to null once it clears a threshold', () => {
    assert.strictEqual(computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      inputTokens: 300_000,
      outputTokens: 1,
    }), null);
    assert.strictEqual(computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      harness: 'some-future-harness',
      inputTokens: 300_000,
      outputTokens: 1,
    }), null);
  });

  test('the cumulative-guard boundary is strictly greater too — exactly minPromptTokens does NOT null out a cumulative row', () => {
    const cost = computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      harness: 'claude-code',
      inputTokens: 272_000,
      outputTokens: 1,
    });
    assert.strictEqual(cost, (272_000 * 30.00 + 1 * 180.00) / 1e6);
  });

  test('a cumulative row on an override-bearing model that does NOT clear the threshold prices normally', () => {
    const cost = computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      harness: 'claude-code',
      inputTokens: 200_000,
      outputTokens: 1,
    });
    assert.strictEqual(cost, (200_000 * 30.00 + 1 * 180.00) / 1e6);
  });

  test('an opencode row on an override-bearing model that does NOT clear the threshold prices at the base rate', () => {
    const cost = computeUsageCostUsd({
      model: 'openai/gpt-5.5-pro',
      harness: 'opencode',
      inputTokens: 200_000,
      outputTokens: 1,
    });
    assert.strictEqual(cost, (200_000 * 30.00 + 1 * 180.00) / 1e6);
  });

  test('a cumulative row on a model with NO override tier is unaffected regardless of size', () => {
    // anthropic/claude-opus-5 carries no overrides — a huge cumulative total must
    // still price normally, not fall into the null guard.
    const cost = computeUsageCostUsd({
      model: 'claude-opus-5',
      harness: 'claude-code',
      inputTokens: 5_000_000,
      outputTokens: 0,
    });
    assert.strictEqual(cost, 5_000_000 * 5.00 / 1e6);
  });

  test('the 7 rows with no override tier price byte-identically to HEAD', () => {
    for (const id of Object.keys(MODEL_PRICING)) {
      if (Array.isArray(MODEL_PRICING[id].overrides)) continue;
      const usage = { model: id, harness: 'claude-code', inputTokens: 1_000_000, outputTokens: 1 };
      const rate = MODEL_PRICING[id];
      const expected = (1_000_000 * rate.prompt + 1 * rate.completion) / 1e6;
      assert.strictEqual(computeUsageCostUsd(usage), expected, `${id} must price unchanged`);
    }
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
      for (const tier of ['cacheRead', 'cacheWrite', 'cacheWrite1h']) {
        if (rate[tier] !== undefined) {
          assert.ok(Number.isFinite(rate[tier]) && rate[tier] >= 0, `${id} ${tier} rate is well-formed`);
        }
      }
    }
  });

  test('every anthropic/claude-* row carries all three cache tiers — they are the point of this table', () => {
    for (const [id, rate] of Object.entries(MODEL_PRICING)) {
      if (!id.startsWith('anthropic/claude-')) continue;
      assert.ok(Number.isFinite(rate.cacheRead), `${id} must price cache reads`);
      assert.ok(Number.isFinite(rate.cacheWrite), `${id} must price cache writes (5m)`);
      assert.ok(Number.isFinite(rate.cacheWrite1h), `${id} must price cache writes (1h, LIN-2113)`);
    }
  });

  test('cacheWrite1h (LIN-2113) is present ONLY on the 6 anthropic/claude-* rows, at exactly 2x prompt', () => {
    // Verified live against https://openrouter.ai/api/v1/models on 2026-08-15: all six
    // anthropic/claude-* rows publish input_cache_write_1h at exactly prompt x 2;
    // openai/gpt-5.6-sol carries input_cache_write but no 1h key, and the other three
    // OpenAI rows carry neither.
    const anthropicRows = Object.keys(MODEL_PRICING).filter(id => id.startsWith('anthropic/claude-'));
    assert.strictEqual(anthropicRows.length, 6, 'expected exactly 6 anthropic/claude-* rows');
    for (const id of anthropicRows) {
      const rate = MODEL_PRICING[id];
      assert.strictEqual(rate.cacheWrite1h, rate.prompt * 2, `${id} cacheWrite1h must be prompt x 2`);
    }
    for (const [id, rate] of Object.entries(MODEL_PRICING)) {
      if (id.startsWith('anthropic/claude-')) continue;
      assert.strictEqual(rate.cacheWrite1h, undefined, `${id} must NOT carry cacheWrite1h`);
    }
  });

  test('gpt-5.6-sol matches the live catalog rate (LIN-2384 — corrected a 2.5-3x transcription error)', () => {
    // LIN-1763 landed this row character-identical to the openai/gpt-5.5 row
    // above it, under a same-commit "verified" claim the copy-down error
    // survived. Re-verified against https://openrouter.ai/api/v1/models on
    // 2026-08-30 (LIN-2384): prompt/cacheRead/cacheWrite were 2.5x overstated,
    // completion was 3x overstated.
    assert.deepStrictEqual(MODEL_PRICING['openai/gpt-5.6-sol'], {
      prompt: 2.00,
      completion: 10.00,
      cacheRead: 0.20,
      cacheWrite: 2.50,
      // LIN-2403: long-context override tier, verified 2026-09-02.
      overrides: [{ minPromptTokens: 272000, prompt: 4.00, completion: 15.00, cacheRead: 0.40, cacheWrite: 5.00 }],
    });
  });

  test('the table and its rows are frozen — a rate card a caller can mutate is not one representation', () => {
    assert.ok(Object.isFrozen(MODEL_PRICING));
    for (const [id, rate] of Object.entries(MODEL_PRICING)) {
      assert.ok(Object.isFrozen(rate), `${id}'s rate row is frozen`);
      if (Array.isArray(rate.overrides)) {
        assert.ok(Object.isFrozen(rate.overrides), `${id}'s overrides array is frozen`);
        for (const entry of rate.overrides) assert.ok(Object.isFrozen(entry), `${id}'s override entry is frozen`);
      }
    }
    const row = getModelRate('anthropic/claude-opus-5');
    assert.throws(() => { 'use strict'; row.prompt = 0; }, TypeError);
    assert.strictEqual(getModelRate('anthropic/claude-opus-5').prompt, 5.00);

    const overrideRow = getModelRate('openai/gpt-5.5-pro');
    assert.throws(() => { 'use strict'; overrideRow.overrides.push({}); }, TypeError);
    assert.throws(() => { 'use strict'; overrideRow.overrides[0].prompt = 0; }, TypeError);
    assert.strictEqual(getModelRate('openai/gpt-5.5-pro').overrides[0].prompt, 60.00);
  });

  test('getModelRate rejects unknown, falsy, and non-string ids', () => {
    assert.strictEqual(getModelRate('some-provider/unknown-model'), null);
    assert.strictEqual(getModelRate(''), null);
    assert.strictEqual(getModelRate(null), null);
    assert.strictEqual(getModelRate(42), null);
    assert.strictEqual(getModelRate('toString'), null); // no prototype-chain leak
  });

  test('every overrides entry is well-formed (finite non-negative tiers, finite minPromptTokens) — LIN-2403', () => {
    for (const [id, rate] of Object.entries(MODEL_PRICING)) {
      if (!Array.isArray(rate.overrides)) continue;
      for (const entry of rate.overrides) {
        assert.ok(Number.isFinite(entry.minPromptTokens) && entry.minPromptTokens >= 0, `${id} override minPromptTokens is well-formed`);
        for (const tier of ['prompt', 'completion', 'cacheRead', 'cacheWrite', 'cacheWrite1h']) {
          if (entry[tier] !== undefined) {
            assert.ok(Number.isFinite(entry[tier]) && entry[tier] >= 0, `${id} override ${tier} is well-formed`);
          }
        }
      }
    }
  });

  test('overrides are present on exactly the 3 openai rows the live catalog gates at 272000 (LIN-2403)', () => {
    // Sibling of the cacheWrite1h-only-on-anthropic test above — the tripwire that
    // forces the LIN-2403 cumulative-guard conversation the day an anthropic row
    // gains an override tier (the live catalog already publishes one on
    // anthropic/claude-sonnet-4.5 and anthropic/claude-sonnet-4, both currently
    // absent from this curated table).
    const overrideRows = Object.keys(MODEL_PRICING).filter(id => Array.isArray(MODEL_PRICING[id].overrides));
    assert.deepStrictEqual(overrideRows.sort(), ['openai/gpt-5.5', 'openai/gpt-5.5-pro', 'openai/gpt-5.6-sol'].sort());
    for (const id of overrideRows) {
      assert.strictEqual(MODEL_PRICING[id].overrides.length, 1, `${id} carries exactly one override entry today`);
      assert.strictEqual(MODEL_PRICING[id].overrides[0].minPromptTokens, 272000, `${id} gates at 272000`);
    }
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
    'openai/gpt-5.6-sol': { prompt: 2.00, completion: 10.00 },
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
      'openai/gpt-5.6-sol': '$2.00 in / $10.00 out per 1M tokens',
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

  test('getDisplayPricing stays exactly two tiers — overrides never leak into the display shape (LIN-2403)', () => {
    // openai/gpt-5.5, openai/gpt-5.5-pro and openai/gpt-5.6-sol now carry an
    // overrides array on their MODEL_PRICING row; OpenRouter's own rule is that
    // top-level keys are the default-condition price, so the display hint must
    // keep showing the base rate and must not gain a third key.
    for (const id of ['openai/gpt-5.5', 'openai/gpt-5.5-pro', 'openai/gpt-5.6-sol']) {
      const display = getDisplayPricing(id);
      assert.deepStrictEqual(Object.keys(display).sort(), ['completion', 'prompt']);
      assert.strictEqual(display.prompt, MODEL_PRICING[id].prompt);
      assert.strictEqual(display.completion, MODEL_PRICING[id].completion);
    }
  });
});
