/**
 * lib/read-horizon.js
 *
 * The shared 30-day READ/REPORTING horizon (LIN-3157 A1).
 *
 * This is deliberately NOT a storage-retention constant. Evidence stores are
 * retained for the life of the project (LIN-3157/LIN-3163 — no expiry, no
 * evictor), but every published read/reporting window
 * (periodicals, `/cost`, `/kpis`, pipeline loops) stays fixed at 30 days so
 * published figures do not silently widen. Consumers derive their query bound
 * from here instead of from a store's TTL, which keeps the read horizon and
 * the retention policy as separate quantities.
 *
 * Adopt this only at the sites enumerated in LIN-3161. Unrelated
 * `30 * 24 * 60 * 60` literals stay as they are.
 */

export const READ_HORIZON_DAYS = 30;

export const READ_HORIZON_MS = READ_HORIZON_DAYS * 24 * 60 * 60 * 1000;

/**
 * Start of the read window: `now − READ_HORIZON_MS`.
 *
 * `now` accepts either an epoch-ms number or a `Date`, matching the call
 * sites (`routes/proxy-compute.js` passes `Date.now()`, `lib/kpi-stats.js`
 * passes a `Date`). It always returns a `Date`: the consumers compare it
 * against real `Date` fields (`dispatchedAt`, `timestamp`), and the
 * file-backed MangoDB store's cross-type `$gte` returns no match for a Date
 * field against a raw number.
 *
 * @param {Date|number} [now=Date.now()] - current time, as a Date or epoch ms
 * @returns {Date} the horizon start
 */
export function readHorizonStart(now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  return new Date(nowMs - READ_HORIZON_MS);
}
