/**
 * lib/time-words.js: the duration and relative-time wording, one home for the server and the task page (LIN-4472).
 *
 *  - `fmtDuration`: a compact human duration (`5m 7s`, `2h 3m`), or null when unknown. The run page, the task page
 *    and the server's clocks all draw it.
 *  - `relativeAgo`: a moment in the reader's relative terms ("just now", "25 minutes ago", "2 days ago"). The server's
 *    task-page and Home words, and the share list the task page paints, are this function.
 *
 * Pure, and a leaf: it is also served to the browser as /lib/time-words.js (LIN-4472), so it imports nothing and names
 * no browser or Node global (tests/unit/shared-modules.test.js). Every server caller imports it from here; no server module
 * re-exports it (tests/unit/lin-4472-time-words.test.js scans lib/, routes/ and server.js only; the classic browser
 * copies in public/session.js and live-console.js are listed in docs/areas/front-end-browser.md).
 */

/** A compact, human duration (`5m 7s`, `2h 3m`), or null when unknown. */
export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * "just now", "25 minutes ago", "3 hours ago", "2 days ago" (LIN-3991): a moment in the reader's own
 * relative terms, so no state sentence on Home carries a UTC stamp or mixes "since" with "ago".
 * null when there is no moment. A moment a little in the future (clock skew) reads "just now".
 *
 * @param {string|null|undefined} value - an ISO timestamp
 * @param {Date} now
 * @returns {string|null}
 */
export function relativeAgo(value, now = new Date()) {
  const ms = value ? now.getTime() - Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.floor(Math.max(ms, 0) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
