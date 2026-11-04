/**
 * tests/fixtures/task-cost-adapter.js: the old `buildTaskCost` call shape, kept for the unit tests that pin lineage
 * behaviour through it (LIN-4179). It was production code until LIN-4179 removed it: no production surface calls
 * it, and every production surface reads lib/cost-read.js directly. It holds no lineage arithmetic of its own; it
 * is `readCost` with the sibling rows flattened and the own rows' lineages selected.
 *
 * Without `identityRows` the fetched rows stand in for the founder lookup, which is right only when the fetch
 * holds whole lineages (the tests' fixtures do).
 */

import { readCost, anchorsOfRows } from '../../lib/cost-read.js';
import { isMember } from '../../lib/lineage-membership.js';

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
