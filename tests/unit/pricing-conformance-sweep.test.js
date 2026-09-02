/**
 * Unit tests for lib/pricing-conformance-sweep.js (LIN-2384).
 *
 * Zero network: findPricingConformanceViolations is pure over an
 * already-fetched catalog array, and the wrapper tests inject a fake
 * getCatalog. Run with: node --test tests/unit/pricing-conformance-sweep.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findPricingConformanceViolations, createPricingConformanceSweepRun } from '../../lib/pricing-conformance-sweep.js';
import { MODEL_PRICING } from '../../lib/model-pricing.js';

// A live-catalog-shaped fixture matching the corrected MODEL_PRICING table
// exactly, for every id the table carries. Built once here rather than
// hand-typed per test, so "zero violations" stays true even if the table
// gains rows later.
const FIELD_MAP = {
  prompt: 'prompt',
  completion: 'completion',
  cacheRead: 'input_cache_read',
  cacheWrite: 'input_cache_write',
  cacheWrite1h: 'input_cache_write_1h',
};

function catalogRawFromTable() {
  return Object.entries(MODEL_PRICING).map(([id, rate]) => {
    const pricing = {};
    for (const [tier, field] of Object.entries(FIELD_MAP)) {
      if (Number.isFinite(rate[tier])) pricing[field] = String(rate[tier] / 1e6);
    }
    // LIN-2403: mirror the table's own overrides array into the catalog's raw
    // shape (min_prompt_tokens + snake_case tier fields) so a table gaining an
    // overrides entry doesn't spuriously go "table models a threshold the
    // catalog no longer publishes" against this fixture.
    if (Array.isArray(rate.overrides) && rate.overrides.length > 0) {
      pricing.overrides = rate.overrides.map(entry => {
        const raw = { min_prompt_tokens: entry.minPromptTokens };
        for (const [tier, field] of Object.entries(FIELD_MAP)) {
          if (Number.isFinite(entry[tier])) raw[field] = String(entry[tier] / 1e6);
        }
        return raw;
      });
    }
    return { id, name: id, pricing };
  });
}

describe('findPricingConformanceViolations', () => {
  test('empty catalog ⇒ not verified, zero violations, zero checked — never reads as "all clear"', () => {
    assert.deepStrictEqual(findPricingConformanceViolations([]), { verified: false, violations: [], checked: 0, comparisons: 0 });
  });

  test('non-array input ⇒ not verified (defensive)', () => {
    assert.deepStrictEqual(findPricingConformanceViolations(null), { verified: false, violations: [], checked: 0, comparisons: 0 });
    assert.deepStrictEqual(findPricingConformanceViolations(undefined), { verified: false, violations: [], checked: 0, comparisons: 0 });
  });

  test('a catalog matching the table exactly ⇒ verified, zero violations', () => {
    const result = findPricingConformanceViolations(catalogRawFromTable());
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, []);
    assert.strictEqual(result.checked, Object.keys(MODEL_PRICING).length);
  });

  test('a mismatched tier is reported as a violation', () => {
    const catalog = catalogRawFromTable();
    const sol = catalog.find(m => m.id === 'openai/gpt-5.6-sol');
    sol.pricing.completion = '0.00003'; // 30.00 per 1M — the pre-fix stale value
    const result = findPricingConformanceViolations(catalog);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, [
      { id: 'openai/gpt-5.6-sol', tier: 'completion', tableValue: 10.00, catalogValue: 30.00 },
    ]);
  });

  test('a table id absent from the live catalog is skipped, not reported', () => {
    const catalog = catalogRawFromTable().filter(m => m.id !== 'openai/gpt-5.6-sol');
    const result = findPricingConformanceViolations(catalog);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, []);
    assert.strictEqual(result.checked, Object.keys(MODEL_PRICING).length - 1);
  });

  test('a catalog entry with pricing: null is skipped, not reported (catalog fetch degraded for that id)', () => {
    const catalog = catalogRawFromTable();
    const sol = catalog.find(m => m.id === 'openai/gpt-5.6-sol');
    sol.pricing = null;
    const result = findPricingConformanceViolations(catalog);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, []);
    assert.strictEqual(result.checked, Object.keys(MODEL_PRICING).length - 1);
  });

  test('a tier present on only one side is skipped, not flagged', () => {
    const catalog = catalogRawFromTable();
    const sol = catalog.find(m => m.id === 'openai/gpt-5.6-sol');
    // sol's table row has no cacheWrite1h; give the catalog one anyway.
    sol.pricing.input_cache_write_1h = '0.000004';
    const result = findPricingConformanceViolations(catalog);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, []);
  });

  test('float precision: 0.000002 * 1e6 compares equal to 2, not 1.9999999999998', () => {
    const catalog = [{ id: 'anthropic/claude-sonnet-5', name: 'x', pricing: { prompt: '0.000002' } }];
    // Real rate row: prompt 2.00 exactly.
    const result = findPricingConformanceViolations(catalog);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, []);
  });
});

describe('findPricingConformanceViolations — override tiers (LIN-2403)', () => {
  test('an override tier the table does not model is a VIOLATION, not a skip', () => {
    const catalog = catalogRawFromTable();
    const mini = catalog.find(m => m.id === 'openai/gpt-5.4-mini'); // no overrides in the table
    mini.pricing.overrides = [{ min_prompt_tokens: 100000, prompt: '0.000002' }];
    const result = findPricingConformanceViolations(catalog);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, [
      { id: 'openai/gpt-5.4-mini', tier: 'overrides[100000]', tableValue: null, catalogValue: 'present' },
    ]);
  });

  test('an override the table models but the catalog no longer publishes is also a violation', () => {
    const catalog = catalogRawFromTable();
    delete catalog.find(m => m.id === 'openai/gpt-5.6-sol').pricing.overrides;
    const result = findPricingConformanceViolations(catalog);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, [
      { id: 'openai/gpt-5.6-sol', tier: 'overrides[272000]', tableValue: 'present', catalogValue: null },
    ]);
  });

  test('a drifted override value is reported with its threshold in the tier label', () => {
    const catalog = catalogRawFromTable();
    catalog.find(m => m.id === 'openai/gpt-5.6-sol').pricing.overrides[0].input_cache_write = '0.000006'; // 6.00 vs the table's 5.00
    const result = findPricingConformanceViolations(catalog);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, [
      { id: 'openai/gpt-5.6-sol', tier: 'overrides[272000]:cacheWrite', tableValue: 5.00, catalogValue: 6.00 },
    ]);
  });

  test('a matching threshold with a tier present on only one side is skipped within that threshold, not flagged', () => {
    const catalog = catalogRawFromTable();
    // gpt-5.5's override table entry has no cacheWrite; give the catalog one anyway.
    catalog.find(m => m.id === 'openai/gpt-5.5').pricing.overrides[0].input_cache_write = '0.000012';
    const result = findPricingConformanceViolations(catalog);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, []);
  });

  test('a time-window override (no min_prompt_tokens) is ignored, never treated as an always-on tier', () => {
    const catalog = catalogRawFromTable();
    // Shaped like the real deepseek/deepseek-v4-flash-vision-exp catalog entries
    // (LIN-2403 research): time-gated, no min_prompt_tokens at all.
    catalog.find(m => m.id === 'openai/gpt-5.4-mini').pricing.overrides = [
      { utc_days: [1, 2, 3, 4, 5], utc_start: '0000', utc_end: '0800', prompt: '0.0000005' },
    ];
    const result = findPricingConformanceViolations(catalog);
    assert.strictEqual(result.verified, true);
    assert.deepStrictEqual(result.violations, []);
  });

  test('override comparisons count toward comparisons — the zero-work guard covers the new layer', () => {
    const withOverrides = findPricingConformanceViolations(catalogRawFromTable());
    const withoutOverrides = findPricingConformanceViolations(
      catalogRawFromTable().map(m => ({ ...m, pricing: { ...m.pricing, overrides: undefined } }))
    );
    assert.deepStrictEqual(withOverrides.violations, []);
    assert.strictEqual(withOverrides.checked, withoutOverrides.checked, 'checked counts rows, unaffected by overrides');
    // The exact delta, not a hardcoded literal (per the LIN-2403 research): one
    // comparison per non-threshold key across every table override entry.
    const overrideTierCount = Object.values(MODEL_PRICING)
      .flatMap(rate => (Array.isArray(rate.overrides) ? rate.overrides : []))
      .reduce((sum, entry) => sum + Object.keys(entry).filter(k => k !== 'minPromptTokens').length, 0);
    assert.ok(overrideTierCount > 0, 'sanity: the table has at least one override tier to count');
    assert.strictEqual(withOverrides.comparisons - withoutOverrides.comparisons, overrideTierCount);
  });
});

describe('createPricingConformanceSweepRun', () => {
  function fakeLogger() {
    const calls = { warn: [], error: [] };
    return { logger: { warn: (...a) => calls.warn.push(a), error: (...a) => calls.error.push(a) }, calls };
  }

  test('unavailable catalog (empty array) ⇒ warn branch, never error', async () => {
    const { logger, calls } = fakeLogger();
    const run = createPricingConformanceSweepRun({ getCatalog: async () => [], logger });
    await run();
    assert.strictEqual(calls.warn.length, 1);
    assert.match(calls.warn[0][0], /not verified this tick/);
    assert.strictEqual(calls.error.length, 0);
  });

  test('non-empty catalog with zero checkable rows ⇒ warn branch identifying that condition, never a silent all-clear (LIN-2384 F1)', async () => {
    const { logger, calls } = fakeLogger();
    // Non-empty catalog, but no id overlaps MODEL_PRICING at all — checked stays 0.
    const catalog = [{ id: 'unrelated/model-not-in-table', name: 'x', pricing: { prompt: '0.000001' } }];
    const run = createPricingConformanceSweepRun({ getCatalog: async () => catalog, logger });
    await run();
    assert.strictEqual(calls.warn.length, 1);
    assert.match(calls.warn[0][0], /not verified this tick/);
    assert.match(calls.warn[0][0], /zero checkable rows/);
    assert.strictEqual(calls.error.length, 0);
  });

  test('verified with zero violations ⇒ no log at all (steady state)', async () => {
    const { logger, calls } = fakeLogger();
    const run = createPricingConformanceSweepRun({ getCatalog: async () => catalogRawFromTable(), logger });
    await run();
    assert.strictEqual(calls.warn.length, 0);
    assert.strictEqual(calls.error.length, 0);
  });

  test('verified with a violation ⇒ loud error log, one per violation', async () => {
    const { logger, calls } = fakeLogger();
    const catalog = catalogRawFromTable();
    catalog.find(m => m.id === 'openai/gpt-5.6-sol').pricing.completion = '0.00003';
    const run = createPricingConformanceSweepRun({ getCatalog: async () => catalog, logger });
    await run();
    assert.strictEqual(calls.warn.length, 0);
    assert.strictEqual(calls.error.length, 1);
    assert.match(calls.error[0][0], /violation/);
    assert.match(calls.error[0][0], /gpt-5\.6-sol/);
  });

  test('rows matched but pricing fields renamed upstream ⇒ zero tier comparisons, warn branch, never a silent all-clear', async () => {
    const { logger, calls } = fakeLogger();
    // Every row matches by id and carries a non-null pricing object, but the
    // field names inside it were renamed upstream — no TIER_MAP field lines
    // up, so every tier is skipped and zero comparisons happen despite
    // checked > 0.
    const catalog = Object.entries(MODEL_PRICING).map(([id, rate]) => ({
      id,
      name: id,
      pricing: {
        input_price: String(rate.prompt / 1e6),
        output_price: String(rate.completion / 1e6),
      },
    }));
    const pure = findPricingConformanceViolations(catalog);
    assert.ok(pure.checked > 0);
    assert.strictEqual(pure.comparisons, 0);

    const run = createPricingConformanceSweepRun({ getCatalog: async () => catalog, logger });
    await run();
    assert.strictEqual(calls.warn.length, 1);
    assert.match(calls.warn[0][0], /not verified this tick/);
    assert.match(calls.warn[0][0], /zero tier comparisons/);
    assert.strictEqual(calls.error.length, 0);
  });

  test('a throwing getCatalog is swallowed — the wrapper never rejects', async () => {
    const { logger, calls } = fakeLogger();
    const run = createPricingConformanceSweepRun({ getCatalog: async () => { throw new Error('boom'); }, logger });
    await assert.doesNotReject(run());
    assert.strictEqual(calls.error.length, 1);
    assert.match(calls.error[0][0], /sweep tick failed/);
  });
});
