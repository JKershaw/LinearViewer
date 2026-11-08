/**
 * lib/pricing-conformance-sweep.js
 *
 * Periodic pricing conformance sweep (LIN-2384; repointed by LIN-4358). Same two-layer
 * shape as lib/credential-invariant-sweep.js / lib/observer-sweep.js: pure
 * classification functions over one tick's read, plus a thin I/O-injected wrapper that
 * builds a scheduler-compatible `run` closure.
 *
 * Until LIN-4358 the invariant was "every hand-typed `MODEL_PRICING` row matches the
 * catalog". The rows are gone: rates are read from the catalog itself
 * (lib/catalog-rate.js), so there is no copy to drift. What can still go wrong, and
 * what this sweep now says out loud each tick:
 *
 *   1. **A price the parser does not understand.** A catalog override gated on a key
 *      lib/catalog-rate.js does not model is dropped from the rate, so usage in that
 *      tier would be priced at the base rate. `findUnmodelledPricing` names the model
 *      and the key. (None on 8 Nov 2026: the gates were `min_prompt_tokens`,
 *      `utc_start`, `utc_end` and `utc_days`.)
 *   2. **A model in use that prices to null** (LIN-3094): a worker-reported model the
 *      catalog does not list, or a string that maps to no catalog id.
 *   3. **A choice list naming a model the catalog no longer lists** (LIN-4358): the
 *      suggestion lists, the free-tier allowlist and the Claude Code alias targets are
 *      the hand lists that remain, because they encode choices. A retired model in one
 *      of them would be offered or allowed and then fail; `findListedModelsMissing`
 *      names it.
 *
 * Network-tolerant by construction: `getModelCatalog()` degrades to `[]` on any fetch
 * failure, and an empty catalog is "not verified this tick", never "all clear". Checks
 * 2 and 3 need the catalog too now (a cold catalog would report every model in use as
 * unpriced), so all three wait for it.
 */

import { resolveWorkerModelId, getModelRate } from './model-pricing.js';
import { unmodelledGates } from './catalog-rate.js';
import { getModelCatalog } from './openrouter-catalog.js';
import { getSeenModels as readSeenModels } from './unpriced-models.js';

/**
 * Catalog models whose pricing carries an override gate lib/catalog-rate.js does not
 * model. Pure.
 *
 * @param {Array<{id: string, pricing: Object|null}>} catalogModels
 * @returns {Array<{id: string, gates: string[]}>}
 */
export function findUnmodelledPricing(catalogModels) {
  const out = [];
  for (const model of Array.isArray(catalogModels) ? catalogModels : []) {
    if (!model || typeof model.id !== 'string') continue;
    const gates = unmodelledGates(model.pricing);
    if (gates.length) out.push({ id: model.id, gates });
  }
  return out;
}

/**
 * Which worker-reported model strings in use price to null (LIN-3094). Pure apart from
 * the synchronous catalog-cache read inside `getModelRate`. Distinct raw strings are
 * resolved to catalog ids, then priced. `<synthetic>` (Claude Code's placeholder turn)
 * is ignored.
 *
 * @param {Iterable<string>} modelStrings
 * @returns {{unpriced: string[], unresolvable: string[]}} resolved ids with no rate; raw strings that map to no id
 */
export function findUnpricedModels(modelStrings) {
  const unpriced = new Set();
  const unresolvable = new Set();
  // LIN-3094: any iterable (a Set registry is the natural seam shape), not only arrays.
  const iterable = modelStrings != null && typeof modelStrings[Symbol.iterator] === 'function' ? modelStrings : [];
  for (const raw of new Set(iterable)) {
    if (raw === '<synthetic>') continue;
    const id = resolveWorkerModelId(raw);
    if (id === null) unresolvable.add(raw);
    else if (!getModelRate(id)) unpriced.add(id);
  }
  return { unpriced: [...unpriced], unresolvable: [...unresolvable] };
}

/**
 * Ids a choice list names that the catalog does not list. Pure.
 *
 * @param {Array<{id: string}>} catalogModels
 * @param {Record<string, Iterable<string>>} lists - list name -> ids
 * @returns {Array<{list: string, id: string}>}
 */
export function findListedModelsMissing(catalogModels, lists) {
  const listed = new Set((Array.isArray(catalogModels) ? catalogModels : []).map(m => m && m.id).filter(Boolean));
  const out = [];
  for (const [list, ids] of Object.entries(lists || {})) {
    for (const id of ids || []) {
      if (typeof id === 'string' && id && !listed.has(id)) out.push({ list, id });
    }
  }
  return out;
}

/**
 * Build the `run` callback `Scheduler.register()` arms for the pricing conformance
 * sweep. Never throws.
 *
 * @param {Object} deps
 * @param {Function} [deps.getCatalog] - seam for tests; defaults to getModelCatalog
 * @param {() => Iterable<string>} [deps.getSeenModels] - seam (LIN-3094): model strings seen in use. Defaults to
 *   the bounded registry parseUsagePayload fills (lib/unpriced-models.js).
 * @param {() => Record<string, Iterable<string>>} [deps.getChoiceLists] - seam (LIN-4358): the hand lists that
 *   remain, by name. server.js passes them; the default checks none.
 * @param {Console} [deps.logger] - seam for tests; defaults to console
 * @returns {() => Promise<void>}
 */
export function createPricingConformanceSweepRun({ getCatalog = getModelCatalog, getSeenModels = readSeenModels, getChoiceLists = () => ({}), logger = console } = {}) {
  return async () => {
    try {
      const catalogModels = await getCatalog();
      if (!Array.isArray(catalogModels) || catalogModels.length === 0) {
        // Indistinguishable from "OpenRouter unreachable this tick". Must never read as all clear,
        // and must not report every model in use as unpriced either.
        logger.warn('[pricing-conformance] not verified this tick — catalog unavailable');
        return;
      }
      for (const { id, gates } of findUnmodelledPricing(catalogModels)) {
        logger.error(`[pricing-conformance] unmodelled pricing gate: ${id} (${gates.join(', ')}) — that tier is priced at the base rate`);
      }
      try {
        const { unpriced, unresolvable } = findUnpricedModels(getSeenModels());
        for (const id of [...unpriced, ...unresolvable]) {
          logger.error(`[pricing-conformance] unpriced model in use: ${id}`);
        }
      } catch (err) {
        logger.error('[pricing-conformance] unpriced-model check failed:', err);
      }
      for (const { list, id } of findListedModelsMissing(catalogModels, getChoiceLists())) {
        logger.error(`[pricing-conformance] ${list} names a model the catalog does not list: ${id}`);
      }
      // Steady state: no log.
    } catch (err) {
      // Fail soft: a tick that can't complete logs and self-heals next tick rather than
      // crashing the scheduler's timer loop.
      logger.error('[pricing-conformance] sweep tick failed:', err);
    }
  };
}
