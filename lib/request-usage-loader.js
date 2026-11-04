/**
 * lib/request-usage-loader.js: the one way a cost reader loads request records (LIN-4201, LIN-4195 D13).
 *
 * The cost read (lib/cost-read.js `readCost`/`lineageRecords`, lib/run-view.js `buildRunView`) takes this loader as its
 * required `requestSource` and loads its records through it (LIN-4226); callers pass the loader, never rows, and
 * nothing else reads the `request-usage` collection for a figure. The loader wraps
 * the store's `RequestUsageStore.listForAnchors(urlKey, anchors)` (lib/request-usage-store.js), which reads by the
 * POSTING ROW: it resolves the anchors' member rows from dispatch-history, reads records by `itemId`, relabels each
 * to its row's CURRENT anchor and folds to one record per requestId (LIN-4212). So "by anchor" here means the
 * posting row's current anchor, never the stamp stored at post time.
 *
 * Callers receive the loader built once in server.js (`requestUsageLoader(requestUsageStore)`) as an injected
 * dependency, the way the founder lookup reaches `collectKpiStats` (LIN-4178): no caller imports the store.
 *
 *  - `forAnchors(urlKey, anchors)`: one workspace's lineages, by anchor (the run page, `/cost`, the Models spend, the
 *    effort read-out, the workspace KPIs).
 *  - `forRows(rows, {urlKey})`: the lineages a set of dispatch rows belongs to, grouped by each row's `urlKey`
 *    (falling back to `urlKey`), so the instance-wide `/kpis` read stays one indexed query per workspace batch.
 *
 * Anchors go in batches of REQUEST_ROWS_BATCH_SIZE, so a query's `$in` is bounded. A batch boundary falls between
 * anchors, and the store folds per anchor, so batching never splits a request.
 *
 * The read is a plain projection fetch (D13). The pre-sum fallback is not built: it is for a measured need only.
 */

import { anchorOf } from './lineage-membership.js';

/** Anchors per `listForAnchors` call (the lineage identity read's batch size, lib/dispatch-store.js). */
export const REQUEST_ROWS_BATCH_SIZE = 500;

/**
 * Append every item of `items` to `out`, one by one. Never `out.push(...items)`: a spread passes each record as a
 * function argument, and a steady-state window (about 230k records, LIN-4200) overflows the call stack (found by the
 * LIN-4201 timing run).
 */
function appendAll(out, items) {
  for (const item of items) out.push(item);
}

/**
 * Build the loader over a request-usage store.
 *
 * @param {{listForAnchors: (urlKey: string, anchors: string[]) => Promise<Array<Object>>}} store
 * @returns {{forAnchors: (urlKey: string, anchors: Iterable<string>) => Promise<Array<Object>>,
 *   forRows: (rows: Array<Object>, options?: {urlKey?: string}) => Promise<Array<Object>>}}
 */
export function requestUsageLoader(store) {
  if (!store || typeof store.listForAnchors !== 'function') {
    throw new TypeError('requestUsageLoader: a store with listForAnchors is required (LIN-4201)');
  }

  async function forAnchors(urlKey, anchors) {
    const ids = [...new Set([...(anchors || [])].filter(a => a !== undefined && a !== null && a !== '').map(String))];
    if (!urlKey || ids.length === 0) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += REQUEST_ROWS_BATCH_SIZE) {
      appendAll(out, await store.listForAnchors(urlKey, ids.slice(i, i + REQUEST_ROWS_BATCH_SIZE)));
    }
    return out;
  }

  async function forRows(rows, { urlKey } = {}) {
    const anchorsByUrlKey = new Map();
    for (const row of rows || []) {
      if (!row || typeof row !== 'object') continue;
      const key = row.urlKey || urlKey;
      const anchor = anchorOf(row);
      if (!key || anchor === null) continue;
      let anchors = anchorsByUrlKey.get(key);
      if (!anchors) {
        anchors = new Set();
        anchorsByUrlKey.set(key, anchors);
      }
      anchors.add(anchor);
    }
    const out = [];
    for (const [key, anchors] of anchorsByUrlKey) appendAll(out, await forAnchors(key, anchors));
    return out;
  }

  return Object.freeze({ forAnchors, forRows });
}

/**
 * The loader a caller was given, or a throw naming the caller. A caller wired without one must fail, not read
 * snapshots for every lineage (LIN-4201: no silent fallback).
 *
 * @param {Object|undefined} loader
 * @param {string} caller
 */
export function requireRequestUsageLoader(loader, caller) {
  if (!loader || typeof loader.forAnchors !== 'function' || typeof loader.forRows !== 'function') {
    throw new TypeError(`${caller}: the request-usage loader is required (LIN-4201, lib/request-usage-loader.js)`);
  }
  return loader;
}

/**
 * The loader over a store that holds no request records (LIN-4226, plan decision (d)). A caller that means "this read
 * has no records" passes this by name, so the choice is visible and greppable; `[]` is never a substitute, because a
 * source that returns nothing silently reads every lineage as snapshot-only.
 */
export const NO_REQUEST_RECORDS = requestUsageLoader({ listForAnchors: async () => [] });
