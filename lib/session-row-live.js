import { toEpochMs } from './utils/time.js';

/**
 * Is this `sessions` collection row still live? The one expiry rule shared by
 * `MongoSessionStore.get()` and every reader that scans the collection directly
 * (LIN-3506). A row with no `expires` is live; `expires` strictly before `now`
 * is expired (equal is live); an unparseable `expires` counts as live, as it
 * did before. `expires` may be a Date, an ISO string or epoch ms.
 *
 * @param {{expires?: Date|string|number|null}|null|undefined} row
 * @param {number|Date} [now=Date.now()]
 * @returns {boolean}
 */
export function isSessionRowLive(row, now = Date.now()) {
  const expiresMs = toEpochMs(row?.expires);
  if (expiresMs === null) return true;
  const nowMs = toEpochMs(now) ?? Date.now();
  return !(expiresMs < nowMs);
}

/**
 * @param {Array<Object>|null|undefined} rows
 * @param {number|Date} [now=Date.now()]
 * @returns {Array<Object>} the live rows; `[]` for a missing input
 */
export function liveSessionRows(rows, now = Date.now()) {
  return (rows || []).filter(row => isSessionRowLive(row, now));
}
