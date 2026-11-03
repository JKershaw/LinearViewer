/**
 * The dispatch rows the Models spend is priced from (LIN-3962). Settings › Models and Home's decision panel both
 * read them here, so both price the same window with the same cap: one read, one authority for the window.
 *
 * The rows are the 30-day read window, bounded by MODELS_HISTORY_CAP; a read at the cap says so on the page.
 * The caller reduces them to numbers (lib/model-routing-spend.js) and keeps its own failure handling: Models
 * shows an empty spend, Home's panel shows no numbers, and neither throws.
 */
import { readHorizonStart } from './read-horizon.js';
import { anchorOf } from './lineage-membership.js';

/** The largest history read the Models spend takes; a read at the cap says so on the page. */
export const MODELS_HISTORY_CAP = 2000;

/**
 * LIN-4177: the page also carries `identityRows`, the founder lookup for every lineage its rows belong to
 * (uncapped, scalar). The spend readers take both, so a lineage whose founder is older than the window keeps its
 * true kind (lib/cost-read.js).
 *
 * @returns {Promise<{items: Array, total: number, identityRows: Array}>}
 */
export async function readModelsHistory(dispatchStore, urlKey) {
  if (!dispatchStore) return { items: [], total: 0, identityRows: [] };
  const page = await dispatchStore.listHistoryWithBodies(urlKey, { since: readHorizonStart(), limit: MODELS_HISTORY_CAP, projection: { prompt: 0 } });
  const anchors = [...new Set(page.items.map(anchorOf).filter(Boolean))];
  const identityRows = await dispatchStore.lineageIdentityRows(urlKey, { anchors });
  return { ...page, identityRows };
}
