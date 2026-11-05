/**
 * Which rows belong to a dispatch lineage, and which issue it counts under (LIN-4147).
 *
 * Every cost reader takes this one answer. Each part is decided from the row's own data:
 *
 * - anchor: the doc-level `rootItemId`, else the row's own id (`_id` on a raw doc, `id` on a
 *   formatted row). Every row since 2026-07-20 carries a doc `rootItemId` (dispatch-store.js
 *   addItem), so the older feedback-tag fallback is never reached on a cost read.
 * - member: a row that ran (`status === 'taken'`) and is not a Home-Stop abort row (`abort`).
 *   Queued, cancelled and expired rows never ran; an abort row records a stop, not a model call.
 * - start: the earliest member's `dispatchedAt` (null when no member has a time).
 * - issue: the `issueIdentifier` of the earliest-dispatched member that carries one, never a wake
 *   row's: a wake may inherit a lineage's issue, never found it (LIN-2121 L1). Null when none does.
 * - dispatch order: `byDispatchOrder`, the one order a lineage's dispatches sort in (LIN-4276).
 *   Readers that list dispatches (`dispatchesOf` in lib/cost-read.js) reuse it; none re-writes it.
 *
 * So a model call's cost lands under at most one issue: the issue its lineage was for. Leaf
 * module: it imports nothing but utils/time.js, so every reader can take it without a cycle.
 */

import { toEpochMs } from './utils/time.js';

/**
 * The anchor a row's lineage is keyed by, as a string; null for a row with no id at all.
 *
 * A lineage key, not a posting-row key: `postingKeysOf` (lib/cost-read.js) lists the ids that identify a row, and this
 * one groups rows into a lineage. Do not fold it into that list (LIN-4276).
 *
 * @param {{rootItemId?: string, _id?: *, id?: *}} row
 * @returns {string|null}
 */
export function anchorOf(row) {
  const anchor = row.rootItemId || row._id || row.id;
  return anchor ? String(anchor) : null;
}

/**
 * Whether a row is a member of its lineage for cost: it ran, and it is not an abort row.
 *
 * @param {{status?: string, abort?: boolean}} row
 * @returns {boolean}
 */
export function isMember(row) {
  return row.status === 'taken' && row.abort !== true;
}

/** Sort key for dispatch order: a row with no dispatch time sorts last (Infinity). */
function dispatchOrder(row) {
  return toEpochMs(row.dispatchedAt) ?? Infinity;
}

/**
 * The dispatch order of two rows (LIN-4276): earlier `dispatchedAt` first, a row with no time last, and two rows with
 * the same time (or both without one) keep their input order. A comparator over rows, for `Array#sort`.
 *
 * @param {{dispatchedAt?: *}} a
 * @param {{dispatchedAt?: *}} b
 * @returns {number}
 */
export function byDispatchOrder(a, b) {
  const x = dispatchOrder(a);
  const y = dispatchOrder(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * Group rows into their lineages' cost membership. Pure; never mutates its input.
 *
 * The caller passes each row once: a row listed twice would count twice. Rows are grouped by
 * `anchorOf` whatever batch they arrived in, so a sibling batch keyed by anchor is safe to pass
 * as one flat list.
 *
 * @param {Array<Object>} rows  dispatch rows, formatted or raw
 * @returns {Map<string, {anchor: string, members: Array<Object>, issueIdentifier: string|null, start: number|null}>}
 *   `members` in dispatch order (ties keep input order). Only lineages with at least one member appear.
 */
export function groupLineageMembership(rows) {
  const byAnchor = new Map();
  for (const row of rows) {
    if (!row || !isMember(row)) continue;
    const anchor = anchorOf(row);
    if (anchor === null) continue;
    const members = byAnchor.get(anchor);
    if (members) members.push(row);
    else byAnchor.set(anchor, [row]);
  }

  const lineages = new Map();
  for (const [anchor, members] of byAnchor) {
    members.sort(byDispatchOrder);
    const founder = members.find(row => row.kind !== 'wake' && row.issueIdentifier);
    const start = dispatchOrder(members[0]);
    lineages.set(anchor, {
      anchor,
      members,
      issueIdentifier: founder ? founder.issueIdentifier : null,
      start: start === Infinity ? null : start
    });
  }
  return lineages;
}
