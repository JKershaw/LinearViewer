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
function catalogRawFromTable() {
  const FIELD_MAP = {
    prompt: 'prompt',
    completion: 'completion',
    cacheRead: 'input_cache_read',
    cacheWrite: 'input_cache_write',
    cacheWrite1h: 'input_cache_write_1h',
  };
  return Object.entries(MODEL_PRICING).map(([id, rate]) => {
    const pricing = {};
    for (const [tier, field] of Object.entries(FIELD_MAP)) {
      if (Number.isFinite(rate[tier])) pricing[field] = String(rate[tier] / 1e6);
    }
    return { id, name: id, pricing };
  });
}

describe('findPricingConformanceViolations', () => {
  test('empty catalog ⇒ not verified, zero violations, zero checked — never reads as "all clear"', () => {
    assert.deepStrictEqual(findPricingConformanceViolations([]), { verified: false, violations: [], checked: 0 });
  });

  test('non-array input ⇒ not verified (defensive)', () => {
    assert.deepStrictEqual(findPricingConformanceViolations(null), { verified: false, violations: [], checked: 0 });
    assert.deepStrictEqual(findPricingConformanceViolations(undefined), { verified: false, violations: [], checked: 0 });
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

  test('a throwing getCatalog is swallowed — the wrapper never rejects', async () => {
    const { logger, calls } = fakeLogger();
    const run = createPricingConformanceSweepRun({ getCatalog: async () => { throw new Error('boom'); }, logger });
    await assert.doesNotReject(run());
    assert.strictEqual(calls.error.length, 1);
    assert.match(calls.error[0][0], /sweep tick failed/);
  });
});
