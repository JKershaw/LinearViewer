/**
 * Unit tests for lib/pricing-conformance-sweep.js (LIN-2384; repointed by LIN-4358).
 *
 * The sweep no longer diffs a hand-typed rate card against the catalog: rates are read from
 * the catalog itself. It now reports what can still go wrong: a price gate the parser does
 * not model, a model in use that prices to null, and a hand-kept choice list naming a model
 * the catalog no longer lists.
 *
 * Zero network: the classifiers are pure over an already-fetched catalog array, and the
 * wrapper tests inject a fake getCatalog. Rates come from the pinned 8 Nov 2026 snapshot.
 * Run with: node --test tests/unit/pricing-conformance-sweep.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  findUnmodelledPricing, findUnpricedModels, findListedModelsMissing, createPricingConformanceSweepRun,
} from '../../lib/pricing-conformance-sweep.js';
import { parseUsage } from '../../lib/session-telemetry.js';
import { recordUnpricedModel, getSeenModels, resetSeenModels, MAX_SEEN_MODELS } from '../../lib/unpriced-models.js';
import { getModelCatalog } from '../../lib/openrouter-catalog.js';
import { seedPinnedCatalog, clearCatalog } from './helpers/pinned-catalog.js';

function fakeLogger() {
  const calls = { warn: [], error: [] };
  return { logger: { warn: (...a) => calls.warn.push(a), error: (...a) => calls.error.push(a) }, calls };
}

let PINNED = [];
beforeEach(async () => { seedPinnedCatalog(); PINNED = await getModelCatalog(); });
afterEach(() => clearCatalog());

describe('findUnmodelledPricing (LIN-4358)', () => {
  test('the pinned 8 Nov 2026 catalog has no gate the parser does not model', () => {
    assert.ok(PINNED.length > 0);
    assert.deepEqual(findUnmodelledPricing(PINNED), []);
  });

  test('an override gated on an unknown key is named, with the key', () => {
    const models = [
      { id: 'x/region', pricing: { prompt: '0.000001', completion: '0.000002', overrides: [{ region: 'eu', prompt: '0.000002' }] } },
      { id: 'x/plain', pricing: { prompt: '0.000001', completion: '0.000002' } },
    ];
    assert.deepEqual(findUnmodelledPricing(models), [{ id: 'x/region', gates: ['region'] }]);
  });

  test('a priced tier the usage does not count (web_search, image, audio) is not a gate', () => {
    const models = [{ id: 'x/tiers', pricing: { prompt: '0.000001', completion: '0.000002', overrides: [{ min_prompt_tokens: 10, audio: '0.1', web_search: '0.01' }] } }];
    assert.deepEqual(findUnmodelledPricing(models), []);
  });

  test('tolerates junk input', () => {
    assert.deepEqual(findUnmodelledPricing(undefined), []);
    assert.deepEqual(findUnmodelledPricing([null, { id: 3 }, { id: 'x/no-pricing', pricing: null }]), []);
  });
});

describe('findListedModelsMissing (LIN-4358)', () => {
  test('an id the catalog lists is fine; one it does not list is named with its list', () => {
    assert.deepEqual(
      findListedModelsMissing(PINNED, { SUGGESTED_MODEL_IDS: ['openai/gpt-6.1-sol', 'openai/gpt-retired'], FREE_TIER_MODEL_IDS: ['openai/gpt-5.4-mini'] }),
      [{ list: 'SUGGESTED_MODEL_IDS', id: 'openai/gpt-retired' }]
    );
  });

  test('tolerates junk input', () => {
    assert.deepEqual(findListedModelsMissing(undefined, undefined), []);
    assert.deepEqual(findListedModelsMissing([], { L: [null, '', 7] }), []);
  });
});

describe('findUnpricedModels (LIN-3094)', () => {
  test('priced models yield nothing; <synthetic> is ignored', () => {
    assert.deepStrictEqual(findUnpricedModels(['claude-opus-5-5', 'claude-opus-5-5-20251001', '<synthetic>']), { unpriced: [], unresolvable: [] });
  });

  test('a resolvable id the catalog does not list is unpriced; a bare alias is unresolvable', () => {
    assert.deepStrictEqual(findUnpricedModels(['claude-opus-9-9', 'opus', 'claude-opus-9-9']), {
      unpriced: ['anthropic/claude-opus-9.9'],
      unresolvable: ['opus'],
    });
  });

  test('accepts any iterable, not only arrays (a Set registry must not report nothing)', () => {
    assert.deepStrictEqual(findUnpricedModels(new Set(['claude-opus-9-9'])), { unpriced: ['anthropic/claude-opus-9.9'], unresolvable: [] });
  });

  test('non-array input is tolerated', () => {
    assert.deepStrictEqual(findUnpricedModels(undefined), { unpriced: [], unresolvable: [] });
  });
});

describe('createPricingConformanceSweepRun', () => {
  test('unavailable catalog (empty array) ⇒ warn branch, never error, and no unpriced report', async () => {
    // LIN-4358: rates come from the catalog, so with none every model would read as unpriced.
    // The unpriced check waits for the catalog instead of crying wolf (it ran first before).
    const { logger, calls } = fakeLogger();
    const run = createPricingConformanceSweepRun({ getCatalog: async () => [], getSeenModels: () => ['claude-opus-9-9'], logger });
    await run();
    assert.strictEqual(calls.warn.length, 1);
    assert.match(calls.warn[0][0], /not verified this tick/);
    assert.strictEqual(calls.error.length, 0);
  });

  test('a healthy catalog with nothing wrong ⇒ no log at all (steady state)', async () => {
    const { logger, calls } = fakeLogger();
    const run = createPricingConformanceSweepRun({
      getCatalog: async () => PINNED, getSeenModels: () => ['claude-opus-5-5'],
      getChoiceLists: () => ({ SUGGESTED_MODEL_IDS: ['openai/gpt-6.1-sol'] }), logger,
    });
    await run();
    assert.deepEqual(calls, { warn: [], error: [] });
  });

  test('each kind of problem is one loud error line', async () => {
    const { logger, calls } = fakeLogger();
    const catalog = [...PINNED, { id: 'x/region', pricing: { prompt: '0.000001', completion: '0.000002', overrides: [{ region: 'eu' }] } }];
    const run = createPricingConformanceSweepRun({
      getCatalog: async () => catalog,
      getSeenModels: () => ['claude-opus-9-9'],
      getChoiceLists: () => ({ FREE_TIER_MODEL_IDS: ['openai/gpt-retired'] }),
      logger,
    });
    await run();
    assert.deepEqual(calls.error.map(a => a[0]), [
      '[pricing-conformance] unmodelled pricing gate: x/region (region) — that tier is priced at the base rate',
      '[pricing-conformance] unpriced model in use: anthropic/claude-opus-9.9',
      '[pricing-conformance] FREE_TIER_MODEL_IDS names a model the catalog does not list: openai/gpt-retired',
    ]);
  });

  test('logs an unpriced model on every tick it is seen', async () => {
    const { logger, calls } = fakeLogger();
    const run = createPricingConformanceSweepRun({ getCatalog: async () => PINNED, getSeenModels: () => ['opus'], logger });
    await run(); await run();
    assert.strictEqual(calls.error.length, 2);
    assert.match(calls.error[0][0], /unpriced model in use: opus/);
  });

  test('a throwing getCatalog is swallowed — the wrapper never rejects', async () => {
    const { logger, calls } = fakeLogger();
    const run = createPricingConformanceSweepRun({ getCatalog: async () => { throw new Error('boom'); }, logger });
    await assert.doesNotReject(run());
    assert.strictEqual(calls.error.length, 1);
    assert.match(calls.error[0][0], /sweep tick failed/);
  });

  test('a throwing seen-models reader is reported and the other checks still run', async () => {
    const { logger, calls } = fakeLogger();
    const run = createPricingConformanceSweepRun({
      getCatalog: async () => PINNED, getSeenModels: () => { throw new Error('reader'); },
      getChoiceLists: () => ({ L: ['x/gone'] }), logger,
    });
    await run();
    assert.match(calls.error[0][0], /unpriced-model check failed/);
    assert.match(calls.error[1][0], /L names a model the catalog does not list: x\/gone/);
  });
});

describe('unpriced-model registry wiring (LIN-3094)', () => {
  const usageFeedback = (model) => [{ kind: 'usage', message: `[usage] ${JSON.stringify({ model, inputTokens: 10, outputTokens: 5 })}` }];

  test('an unpriced usage parsed through parseUsage shows up in a sweep tick log; the default reader is the registry', async () => {
    resetSeenModels();
    parseUsage(usageFeedback('claude-opus-9-9'));
    parseUsage(usageFeedback('claude-opus-5-5')); // priced: must not be recorded
    assert.deepStrictEqual(getSeenModels(), ['claude-opus-9-9']);
    const errors = [];
    await createPricingConformanceSweepRun({ getCatalog: async () => PINNED, logger: { warn() {}, error: (...a) => errors.push(a[0]) } })();
    assert.deepStrictEqual(errors, ['[pricing-conformance] unpriced model in use: anthropic/claude-opus-9.9']);
    resetSeenModels();
  });

  test('registry is bounded at 50 ids, evicting the oldest', () => {
    resetSeenModels();
    for (let i = 0; i < MAX_SEEN_MODELS + 5; i++) recordUnpricedModel(`m-${i}`);
    const seen = getSeenModels();
    assert.strictEqual(seen.length, 50);
    assert.strictEqual(seen[0], 'm-5');
    recordUnpricedModel(42); recordUnpricedModel('');
    assert.strictEqual(getSeenModels().length, 50);
    resetSeenModels();
  });
});
