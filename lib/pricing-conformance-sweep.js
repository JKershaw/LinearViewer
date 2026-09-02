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
 *
 * **Long-context override tiers (LIN-2403).** `MODEL_PRICING` rows can carry an
 * `overrides` array (see lib/model-pricing.js) mirroring OpenRouter's own
 * `pricing.overrides`. Unlike a base tier, an override tier's OWN PRESENCE is
 * the invariant: the base-tier "present on only one side ⇒ skipped" rule would
 * make every catalog override look one-sided (the table never had that key
 * before this ticket) and go quiet exactly when it must not — so a
 * `min_prompt_tokens` threshold on one side and not the other is always a
 * VIOLATION, never a skip. Within a threshold both sides publish, individual
 * tier keys still follow the base-tier one-sided-skip rule (an override entry
 * omitting a tier its base row also doesn't price is not a drift). A catalog
 * override entry with no `min_prompt_tokens` at all (a time-window-only entry,
 * gated on `utc_days`/`utc_start`/`utc_end` instead) is skipped by
 * construction — this sweep does not model time-of-day pricing, matching
 * lib/model-pricing.js's own `selectRateForPrompt`.
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

/** Diff one tier-value pair, pushing a violation and/or counting a comparison. */
function diffTier(violations, id, tierLabel, tableValue, rawCatalogValue) {
  if (!Number.isFinite(tableValue) || rawCatalogValue === undefined || rawCatalogValue === null) {
    // Tier present on only one side — skipped, not flagged.
    return 0;
  }
  const catalogValue = toUsdPerMillion(rawCatalogValue);
  const roundedTableValue = Number(tableValue.toFixed(COMPARISON_DP));
  if (catalogValue === null || catalogValue !== roundedTableValue) {
    violations.push({ id, tier: tierLabel, tableValue: roundedTableValue, catalogValue });
  }
  return 1;
}

/** This table's `overrides` entries, keyed by `minPromptTokens` (time-window-only entries dropped). */
function tableOverridesByThreshold(rate) {
  const byThreshold = new Map();
  if (Array.isArray(rate.overrides)) {
    for (const entry of rate.overrides) {
      if (entry && Number.isFinite(entry.minPromptTokens)) byThreshold.set(entry.minPromptTokens, entry);
    }
  }
  return byThreshold;
}

/** The catalog's raw `pricing.overrides` entries, keyed by `min_prompt_tokens` (time-window-only entries dropped). */
function catalogOverridesByThreshold(pricing) {
  const byThreshold = new Map();
  const raw = Array.isArray(pricing.overrides) ? pricing.overrides : [];
  for (const entry of raw) {
    if (entry && Number.isFinite(entry.min_prompt_tokens)) byThreshold.set(entry.min_prompt_tokens, entry);
  }
  return byThreshold;
}

/**
 * Diff one checked row's long-context override tiers (LIN-2403). Presence of a
 * threshold is itself the invariant (see module header) — a threshold on only
 * one side is always a violation, never a skip; a threshold both sides publish
 * is diffed tier-by-tier with the base-tier one-sided-skip rule.
 *
 * @returns {number} comparisons made (tier-level only — a presence violation makes none)
 */
function diffOverrides(violations, id, rate, pricing) {
  const tableByThreshold = tableOverridesByThreshold(rate);
  const catalogByThreshold = catalogOverridesByThreshold(pricing);
  const thresholds = new Set([...tableByThreshold.keys(), ...catalogByThreshold.keys()]);
  let comparisons = 0;

  for (const threshold of thresholds) {
    const tableEntry = tableByThreshold.get(threshold);
    const catalogEntry = catalogByThreshold.get(threshold);
    const tierLabelPrefix = `overrides[${threshold}]`;

    if (!tableEntry) {
      violations.push({ id, tier: tierLabelPrefix, tableValue: null, catalogValue: 'present' });
      continue;
    }
    if (!catalogEntry) {
      violations.push({ id, tier: tierLabelPrefix, tableValue: 'present', catalogValue: null });
      continue;
    }
    for (const [tableTier, catalogField] of Object.entries(TIER_MAP)) {
      comparisons += diffTier(violations, id, `${tierLabelPrefix}:${tableTier}`, tableEntry[tableTier], catalogEntry[catalogField]);
    }
  }

  return comparisons;
}

/**
 * Diff every `MODEL_PRICING` row against the retained live catalog pricing.
 * Pure — `catalogModels` is an already-fetched array, not a live store.
 *
 * @param {Array<{id: string, pricing: Object|null}>} catalogModels - lib/openrouter-catalog.js's getModelCatalog() result
 * @returns {{verified: boolean, violations: Array<{id: string, tier: string, tableValue: number|string|null, catalogValue: number|string|null}>, checked: number, comparisons: number}}
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
      comparisons += diffTier(violations, id, tableTier, rate[tableTier], catalogEntry.pricing[catalogField]);
    }
    comparisons += diffOverrides(violations, id, rate, catalogEntry.pricing);
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
