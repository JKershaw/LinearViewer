/**
 * lib/request-usage-fold.js: how a lineage's request records add up (LIN-4201, LIN-4195 D6).
 *
 * The second fold, beside the snapshot fold (`foldLineageUsage`, lib/row-usage.js). It returns the
 * same shape, so the cost read (lib/cost-read.js) treats either fold's result alike once it has
 * decided which one a lineage reads. That decision is the cost read's, made once; this module never
 * looks at snapshots. Pure: no store, clock or network.
 *
 * It is a sibling of row-usage.js, not part of it, because it prices: lib/model-pricing.js imports
 * `isRunningTotal` from row-usage.js, so pricing from there would be an import cycle.
 *
 * The rules:
 *  - Each record is one model request, priced alone by `priceRequest` (LIN-4198, piece 1): its tier
 *    comes from its own prompt size whatever `harness` says, and a native `costUsd` on the record
 *    wins over the read-time price (review note 4).
 *  - Completeness: `complete` when every record is priced; `unpriced` when any record is not, and
 *    then the figure is withheld, never a partial (the LIN-4176 figure rule); `no-usage` when there
 *    are no records. There is no `unreadable`: a record was validated at intake and has no parse
 *    step to fail.
 *  - Labels: `model` is the priced model with the largest priced cost (ties: the model used latest;
 *    with no priced record at all, the latest record's model). `effort` and `harness` are the latest
 *    record's. "Latest" is by `at`, then `updatedAt`, then `requestId`, never by input order: the
 *    loader returns records sorted by (rootItemId, requestId).
 *  - Review note 3: `missingRowsCanChangeFigure` is false. A lineage's records are fetched by anchor
 *    (the loader, `listForAnchors`, resolves the member rows itself from dispatch-history), so
 *    which rows the caller's own read returned cannot change a record figure. A record lineage is
 *    therefore never `incomplete` under the narrow rule.
 */

import { priceRequest } from './model-pricing.js';
import { sumTokens } from './row-usage.js';
import { toEpochMs } from './utils/time.js';

const NO_USAGE = Object.freeze({
  source: 'records',
  completeness: 'no-usage',
  tokens: null,
  costUsd: null,
  unpricedModels: [],
  lastIndex: null,
  lastItemId: null,
  last: null,
  byModel: [],
  missingRowsCanChangeFigure: false,
});

/** Epoch ms of an instant, with a missing or unusable one sorting first. */
const msOf = value => toEpochMs(value) ?? -Infinity;

/** Oldest first: by `at`, then `updatedAt`, then `requestId`, so the order never depends on the input's. */
function byTime(a, b) {
  return (msOf(a.record.at) - msOf(b.record.at))
    || (msOf(a.record.updatedAt) - msOf(b.record.updatedAt))
    || String(a.record.requestId ?? '').localeCompare(String(b.record.requestId ?? ''));
}

/**
 * The one fold over a lineage's request records.
 *
 * @param {Array<Object>} records  the lineage's records as the loader (`listForAnchors`) returns them
 *   (one per requestId): `requestId`, `at`, `updatedAt`, `harness`, `model`, `effort`, the five token counts,
 *   optional native `costUsd`
 * @returns {{
 *   source: 'records',
 *   completeness: 'no-usage'|'unpriced'|'complete',
 *   tokens: Object|null,
 *   costUsd: number|null,
 *   unpricedModels: string[],
 *   lastIndex: null,
 *   lastItemId: string|null,
 *   last: {harness: string|null, model: string|null, effort: string|null}|null,
 *   byModel: Array<{model: string|null, requests: number, tokens: Object, pricedRequests: number, pricedUsd: number, costUsd: number|null}>,
 *   missingRowsCanChangeFigure: false
 * }} `last` carries the lineage's labels (the snapshot fold's `last` is its counted row's usage; the cost read
 *   reads only `harness`, `model` and `effort` from either). `lastIndex` is null: records are not rows, so the
 *   row a record figure is shown on is the caller's to place; `lastItemId` (the latest record's posting row)
 *   is what it places it by (lib/cost-read.js `lineageFigureOf`). `byModel` is ordered by priced cost, largest first
 *   (`tokens` is that model's own token sum, LIN-4263);
 *   a model's `costUsd` is null when any of its requests is unpriced.
 */
export function foldRequestUsage(records) {
  const priced = (Array.isArray(records) ? records : [])
    .filter(record => record && typeof record === 'object')
    .map(record => ({ record, costUsd: priceRequest(record) }))
    .sort(byTime);
  if (priced.length === 0) return { ...NO_USAGE, unpricedModels: [], byModel: [] };

  // Per model, in time order, so each model's `lastPos` is the position of its latest request.
  const models = new Map();
  priced.forEach(({ record, costUsd }, pos) => {
    const model = record.model ?? null;
    const entry = models.get(model) || { model, requests: 0, pricedRequests: 0, pricedUsd: 0, lastPos: -1, records: [] };
    entry.requests += 1;
    entry.records.push(record);
    if (typeof costUsd === 'number') {
      entry.pricedRequests += 1;
      entry.pricedUsd += costUsd;
    }
    entry.lastPos = pos;
    models.set(model, entry);
  });

  const unpriced = priced.filter(({ costUsd }) => typeof costUsd !== 'number');
  const unpricedModels = [...new Set(unpriced.map(({ record }) => record.model || 'unknown'))];
  const completeness = unpriced.length > 0 ? 'unpriced' : 'complete';

  const ranked = [...models.values()].sort((a, b) => (b.pricedUsd - a.pricedUsd) || (b.lastPos - a.lastPos));
  const latest = priced[priced.length - 1].record;
  const dominant = ranked.find(entry => entry.pricedRequests > 0);

  return {
    source: 'records',
    completeness,
    tokens: sumTokens(priced.map(({ record }) => record)),
    costUsd: completeness === 'complete' ? priced.reduce((sum, { costUsd }) => sum + costUsd, 0) : null,
    unpricedModels,
    lastIndex: null,
    lastItemId: latest.itemId === undefined || latest.itemId === null ? null : String(latest.itemId),
    last: {
      harness: latest.harness ?? null,
      model: dominant ? dominant.model : (latest.model ?? null),
      effort: latest.effort ?? null,
    },
    byModel: ranked.map(({ model, requests, pricedRequests, pricedUsd, records: modelRecords }) => ({
      model,
      requests,
      tokens: sumTokens(modelRecords),
      pricedRequests,
      pricedUsd,
      costUsd: pricedRequests === requests ? pricedUsd : null,
    })),
    missingRowsCanChangeFigure: false,
  };
}
