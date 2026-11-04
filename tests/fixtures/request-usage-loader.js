/**
 * Test plumbing for the required request records (LIN-4201).
 *
 * Since LIN-4201 the cost read, its callers and the route factories that reach it REQUIRE the request records (or the
 * loader that reads them) and throw without them. Tests written before records existed read snapshot-only lineages:
 * for them "no records" is the true input, so they are wrapped once per file with `withRequestRows`, which passes it
 * explicitly. No assertion changes. A test that passes `requestRows: undefined` itself still reaches the throw.
 */
import { requestUsageLoader } from '../../lib/request-usage-loader.js';

/** The no-records source now lives in the loader (LIN-4226, plan decision (d)); re-exported so tests keep one import. */
export { NO_REQUEST_RECORDS } from '../../lib/request-usage-loader.js';

/**
 * A loader over a fixed set of records, read the way the real store answers: the records whose (current-anchor)
 * `rootItemId` is one of the anchors asked for, within the asked `urlKey` when a record names one. Every call is
 * logged on `calls` so a test can see what a caller asked for.
 *
 * @param {Array<Object>} records
 */
export function loaderOver(records) {
  const calls = [];
  const loader = requestUsageLoader({
    listForAnchors: async (urlKey, anchors) => {
      calls.push({ urlKey, anchors: [...anchors] });
      const wanted = new Set(anchors.map(String));
      return records.filter(record => wanted.has(String(record.rootItemId)) && (record.urlKey === undefined || record.urlKey === urlKey));
    },
  });
  return { ...loader, calls };
}

/**
 * `fn` with the argument at `index` (an options object) defaulted to `defaults`, the caller's own keys winning.
 *
 * @param {Function} fn
 * @param {number} index
 * @param {Object} defaults
 */
export function withRequestRows(fn, index, defaults) {
  return (...args) => {
    const next = [...args];
    while (next.length <= index) next.push(undefined);
    next[index] = { ...defaults, ...(next[index] ?? {}) };
    return fn(...next);
  };
}
