/**
 * lib/task-cost.js: the old `buildTaskCost` call shape, kept as an adapter over the one cost read
 * (lib/cost-read.js, LIN-4177). It holds no lineage arithmetic of its own.
 *
 * It takes the caller's own rows and the sibling rows batched by anchor, and reports the lineages an
 * own row is a member of (LIN-4147). Without `identityRows` the fetched rows stand in for the
 * founder lookup, which is right only when the fetch holds whole lineages. Every production surface
 * passes a real lookup to `readCost` directly; this adapter is for callers that have the whole
 * lineage in hand already.
 */

import { readCost, anchorsOfRows } from './cost-read.js';
import { isMember } from './lineage-membership.js';

/**
 * @param {Object} params
 * @param {Array<Object>} [params.ownRows]
 * @param {Map<string, Array<Object>>} [params.siblingRowsByAnchor]
 * @param {Object} [params.appSummary]
 * @param {string} [params.issueIdentifier]
 * @param {Array<Object>} [params.identityRows]  the founder lookup's scalar rows, when the caller has one
 */
export function buildTaskCost({ ownRows = [], siblingRowsByAnchor = new Map(), appSummary, issueIdentifier, identityRows } = {}) {
  const siblings = [...siblingRowsByAnchor.values()].flat();
  const ownMembers = ownRows.filter(row => row && isMember(row));
  return readCost({
    fetchedRows: [...siblings, ...ownRows],
    identityRows: identityRows ?? [],
    appSummary,
    issueIdentifier,
    selectAnchors: anchorsOfRows(ownMembers),
  });
}
