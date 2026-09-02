/**
 * lib/pricing-conformance-sweep.js
 *
 * Startup/periodic pricing conformance sweep (LIN-2384). Same two-layer shape
 * as lib/credential-invariant-sweep.js / lib/observer-sweep.js: a pure
 * classification function over one tick's read, plus a thin I/O-injected
 * wrapper that builds a scheduler-compatible `run` closure.
 *
 * The invariant: every `lib/model-pricing.js` `MODEL_PRICING` row should match
 * the live OpenRouter catalog's own published rate for that id, tier by tier.
 * This is the class fix for LIN-2384's `openai/gpt-5.6-sol` finding — the
 * table hand-types its rates and `lib/openrouter-catalog.js` used to discard
 * the catalog's `pricing` field entirely, so a transcription error like that
 * one had no way to become visible. Now that the catalog retains `pricing`,
 * this sweep diffs the table against it every tick.
 *
 * Network-tolerant by construction: `getModelCatalog()` already degrades to
 * `[]` on any fetch failure (by design — see that module's own header), and an
 * empty catalog here yields `verified: false`, never `verified: true` with
 * zero violations. Reporting a failed fetch as "all clear" would reproduce the
 * exact silent-drift fault this ticket exists to fix. A table id absent from
 * the live catalog today is SKIPPED, not reported (mirrors
 * credential-invariant-sweep's "no urlKey to check against → skipped"
 * precedent) — there is nothing to diff it against.
 */

import { MODEL_PRICING } from './model-pricing.js';
import { getModelCatalog } from './openrouter-catalog.js';

// Table tier name -> OpenRouter's raw per-token field name. A tier present on
// only one side is skipped, not flagged (lib/model-pricing.js's own "omit a
// tier a model does not expose rather than inventing one" discipline).
const TIER_MAP = {
  prompt: 'prompt',
  completion: 'completion',
  cacheRead: 'input_cache_read',
  cacheWrite: 'input_cache_write',
  cacheWrite1h: 'input_cache_write_1h',
};

// Rounded to 6dp before comparison so float noise (e.g. 0.000002 * 1e6 landing
// on 1.9999999999998 rather than 2) never reads as a violation.
const COMPARISON_DP = 6;

function toUsdPerMillion(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? Number((n * 1e6).toFixed(COMPARISON_DP)) : null;
}

/**
 * Diff every `MODEL_PRICING` row against the retained live catalog pricing.
 * Pure — `catalogModels` is an already-fetched array, not a live store.
 *
 * @param {Array<{id: string, pricing: Object|null}>} catalogModels - lib/openrouter-catalog.js's getModelCatalog() result
 * @returns {{verified: boolean, violations: Array<{id: string, tier: string, tableValue: number, catalogValue: number}>, checked: number, comparisons: number}}
 */
export function findPricingConformanceViolations(catalogModels) {
  if (!Array.isArray(catalogModels) || catalogModels.length === 0) {
    // Indistinguishable from "OpenRouter unreachable this tick" — see module
    // header. Must never read as "0 violations, all clear".
    return { verified: false, violations: [], checked: 0, comparisons: 0 };
  }

  const catalogById = new Map(catalogModels.filter(m => m && m.id).map(m => [m.id, m]));
  const violations = [];
  let checked = 0;
  let comparisons = 0;

  for (const [id, rate] of Object.entries(MODEL_PRICING)) {
    const catalogEntry = catalogById.get(id);
    if (!catalogEntry || !catalogEntry.pricing || typeof catalogEntry.pricing !== 'object') {
      // A table id with no live catalog match today — nothing to diff against.
      continue;
    }
    checked += 1;
    for (const [tableTier, catalogField] of Object.entries(TIER_MAP)) {
      const tableValue = rate[tableTier];
      const rawCatalogValue = catalogEntry.pricing[catalogField];
      if (!Number.isFinite(tableValue) || rawCatalogValue === undefined || rawCatalogValue === null) {
        // Tier present on only one side — skipped, not flagged.
        continue;
      }
      comparisons += 1;
      const catalogValue = toUsdPerMillion(rawCatalogValue);
      const roundedTableValue = Number(tableValue.toFixed(COMPARISON_DP));
      if (catalogValue === null || catalogValue !== roundedTableValue) {
        violations.push({ id, tier: tableTier, tableValue: roundedTableValue, catalogValue });
      }
    }
  }

  return { verified: true, violations, checked, comparisons };
}

/**
 * Build the `run` callback `Scheduler.register()` arms for the pricing
 * conformance sweep. Never throws — a network failure surfaces as the
 * `verified: false` branch below, not a rejection.
 *
 * @param {Object} deps
 * @param {Function} [deps.getCatalog] - seam for tests; defaults to getModelCatalog
 * @param {Console} [deps.logger] - seam for tests; defaults to console
 * @returns {() => Promise<void>}
 */
export function createPricingConformanceSweepRun({ getCatalog = getModelCatalog, logger = console } = {}) {
  return async () => {
    try {
      const catalogModels = await getCatalog();
      const { verified, violations, checked, comparisons } = findPricingConformanceViolations(catalogModels);

      if (!verified) {
        logger.warn('[pricing-conformance] not verified this tick — catalog unavailable');
        return;
      }
      if (checked === 0) {
        // A non-empty catalog that resolved zero checkable rows (no table id
        // matched a live entry with usable pricing) is the same "nothing was
        // actually verified" state as an unavailable catalog — must not read
        // as steady-state silence just because `verified` came back true.
        logger.warn('[pricing-conformance] not verified this tick — catalog was non-empty but yielded zero checkable rows');
        return;
      }
      if (comparisons === 0) {
        // Rows matched (checked > 0) but every tier lookup missed — the
        // catalog's pricing field shape moved upstream (rename/restructure).
        // Distinct from the checked === 0 case above: rows DID match, they
        // just yielded nothing to diff. Must not fall through to the
        // steady-state no-log path below.
        logger.warn(`[pricing-conformance] not verified this tick — ${checked} catalog rows matched but zero tier comparisons were made (pricing field shape changed upstream?)`);
        return;
      }
      for (const violation of violations) {
        logger.error(`[pricing-conformance] violation: ${JSON.stringify(violation)}`);
      }
      // verified === true, checked > 0, violations.length === 0: steady state, no log.
    } catch (err) {
      // Fail soft, like credential-invariant-sweep's own tick catch: a tick
      // that can't complete logs and self-heals next tick rather than
      // crashing the scheduler's timer loop.
      logger.error('[pricing-conformance] sweep tick failed:', err);
    }
  };
}
