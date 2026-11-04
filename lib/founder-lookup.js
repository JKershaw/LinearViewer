/**
 * lib/founder-lookup.js: the founder lookup over the RAW collections, for the KPI path (LIN-4178,
 * plan LIN-4176 "raw-collection adapter").
 *
 * The dispatch store's `lineageIdentityRows` (lib/dispatch-store.js) serves the per-issue and per-session
 * cost readers. The KPI path reads raw dispatch collections instead (the public `/kpis` and the workspace
 * KPIs read the aggregation shape of `loadDispatchHistory`, and `dispatchQueue` directly), so it needs the
 * same scalar read over the collections themselves.
 *
 * The read is the lineage identity projection (LINEAGE_IDENTITY_PROJECTION) over BOTH collections, keyed by
 * `{urlKey, rootItemId: {$in: anchors}}`. `{urlKey, rootItemId}` is the index (lib/db-indexes.js); a bare
 * `{rootItemId: {$in}}` would scan. So anchors are grouped per `urlKey` and batched, never read across
 * workspaces in one query. It is never capped and never windowed by `since`: a lineage whose founder is older
 * than the KPI window still reports its true issue, kind and members (LIN-4148).
 *
 * This module stays out of `lib/kpi-stats.js`: the public path receives its output as an injected function
 * (`lineageIdentity`), so the identifier-bearing lookup never sits on the public path's own code.
 */

import { LINEAGE_IDENTITY_PROJECTION } from './dispatch-store.js';

/** Anchors per `$in` batch. A batch is one indexed query per collection, so the query count is bounded. */
export const FOUNDER_BATCH_SIZE = 500;

/**
 * The founder rows of every lineage the given dispatch rows belong to, over both collections, deduplicated.
 *
 * @param {Object} collections
 * @param {Object} [collections.dispatchHistory]  a raw collection with `find(filter, {projection})`
 * @param {Object} [collections.dispatchQueue]    likewise
 * @param {Array<Object>} rows  dispatch rows carrying `urlKey` and `rootItemId` (either load shape)
 * @returns {Promise<Array<Object>>}  the scalar rows (LINEAGE_IDENTITY_PROJECTION fields), keyed by `_id`
 */
export async function lookupFounderRows({ dispatchHistory, dispatchQueue } = {}, rows = []) {
  const collections = [dispatchHistory, dispatchQueue].filter(Boolean);
  if (collections.length === 0) return [];

  const anchorsByUrlKey = new Map();
  for (const row of rows) {
    const anchor = row?.rootItemId;
    const urlKey = row?.urlKey;
    if (!anchor || !urlKey) continue;
    let anchors = anchorsByUrlKey.get(urlKey);
    if (!anchors) {
      anchors = new Set();
      anchorsByUrlKey.set(urlKey, anchors);
    }
    anchors.add(String(anchor));
  }

  const byId = new Map();
  for (const [urlKey, anchorSet] of anchorsByUrlKey) {
    const anchors = [...anchorSet];
    for (let i = 0; i < anchors.length; i += FOUNDER_BATCH_SIZE) {
      const query = { urlKey, rootItemId: { $in: anchors.slice(i, i + FOUNDER_BATCH_SIZE) } };
      const batches = await Promise.all(collections.map(c => c.find(query, { projection: LINEAGE_IDENTITY_PROJECTION }).toArray()));
      for (const batch of batches) for (const row of batch) byId.set(String(row._id), row);
    }
  }
  return [...byId.values()];
}
