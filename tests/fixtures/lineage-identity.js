/**
 * LIN-4177: a test stub for the founder lookup (`DispatchQueueStore.lineageIdentityRows`).
 *
 * It answers from the same rows a test's list stub serves, in the scalar shape the real lookup
 * returns: the lineage's members by anchor (`rootItemId`, else the row's own id) or, for an issue, the
 * rows whose `issueIdentifier` matches. Rows are passed as a getter so a stub built before its rows
 * still sees them.
 */
import { anchorOf } from '../../lib/lineage-membership.js';

/**
 * @param {() => Array<Object>} getRows  every row the store serves, in any shape
 * @returns {(urlKey: string, opts?: {anchors?: string[], issueIdentifier?: string}) => Promise<Array<Object>>}
 */
export function stubLineageIdentity(getRows) {
  return async function lineageIdentityRows(urlKey, { anchors, issueIdentifier } = {}) {
    const rows = getRows().filter(Boolean);
    const hit = anchors !== undefined
      ? rows.filter(row => anchors.includes(anchorOf(row)))
      : rows.filter(row => row.issueIdentifier === issueIdentifier);
    return hit.map(row => ({
      _id: row._id ?? row.id,
      rootItemId: anchorOf(row),
      status: row.status,
      abort: row.abort,
      kind: row.kind,
      issueIdentifier: row.issueIdentifier ?? null,
      dispatchedAt: row.dispatchedAt,
    }));
  };
}
