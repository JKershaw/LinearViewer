/**
 * Test plumbing for the request-usage loader (LIN-4201, LIN-4226).
 *
 * The route factories and the async cost entries REQUIRE a request source (the loader) and throw without one. Tests
 * that read snapshot-only lineages pass the named no-records source, NO_REQUEST_RECORDS, by name: `withDefaults` sets
 * it on the argument they would otherwise be missing, and a test's own keys win. A synchronous pure core takes its
 * records as an argument instead (tests/fixtures/cost-read-cores.js). No assertion changes with the wrapper.
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
export function withDefaults(fn, index, defaults) {
  return (...args) => {
    const next = [...args];
    while (next.length <= index) next.push(undefined);
    next[index] = { ...defaults, ...(next[index] ?? {}) };
    return fn(...next);
  };
}
