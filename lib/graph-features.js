/**
 * Graph features — network-free blocking-graph primitives (LIN-433).
 *
 * Relocated from lib/render-swipe.js so both the swipe/stack render pipeline AND
 * the recommendation frontier picker (selectFocusSubtask in lib/tree.js) can share
 * one source of truth for the edge set without tree.js importing a renderer (the
 * forbidden layering violation). render-swipe.js re-imports + re-exports these so
 * its behavior — and its callers' import paths — stay byte-identical. Seeds the
 * testable-seam refactor tracked by LIN-434.
 *
 * Imports isTerminalState from the canonical state map (not tree.js) to avoid a
 * tree.js ⇄ graph-features import cycle.
 */

import { isTerminalState } from './providers/state-map.js';

/**
 * Build the blocking dependency graph over a set of issues.
 *
 * Edge direction: blocker → blocked (the blocker must appear first). Only edges
 * where BOTH endpoints are in the set are honored; edges from terminal-state
 * (completed/canceled/duplicate) blockers are skipped because the block is
 * resolved. This is the single source of truth for the edge set, shared by
 * applyBlockingOrder (ordering) and computeGraphFeatures (sort-key features) so
 * the two can never disagree about which edges exist.
 *
 * @param {Array} issues - Flat array of card-data objects
 * @returns {{adj: Map, reverseAdj: Map, inDegree: Map}} Graph keyed by issue id.
 *   adj[blocker] = [blocked...]; reverseAdj[blocked] = [blocker...];
 *   inDegree[blocked] = count of in-set non-terminal blockers.
 */
export function buildBlockingGraph(issues) {
  const issueIds = new Set(issues.map(i => i.id));
  const adj = new Map();
  const reverseAdj = new Map();
  const inDegree = new Map();
  for (const issue of issues) {
    adj.set(issue.id, []);
    reverseAdj.set(issue.id, []);
    inDegree.set(issue.id, 0);
  }

  for (const issue of issues) {
    if (isTerminalState(issue.stateType)) continue;
    for (const blockedId of issue.blocksIds || []) {
      if (issueIds.has(blockedId)) {
        adj.get(issue.id).push(blockedId);
        reverseAdj.get(blockedId).push(issue.id);
        inDegree.set(blockedId, inDegree.get(blockedId) + 1);
      }
    }
  }

  return { adj, reverseAdj, inDegree };
}

/**
 * Compute transitive dependency-graph features and stamp them on each card.
 *
 * Derived from the same in-set, non-terminal edge set used for ordering
 * (buildBlockingGraph), so the features describe exactly the edges the sort
 * honors. Mutates each issue in place (mirroring sortIssuesForSwipe):
 *
 *  - `downstreamUnblocks`: count of DISTINCT issues this one transitively blocks
 *    (most-successors). Exact via reachability bitsets unioned in reverse-topo
 *    order — O(V·E/64).
 *  - `criticalPathLen`: length of the longest dependency chain that starts at
 *    this node (the node itself counts as 1, so a leaf is 1). Exact O(V+E).
 *
 * Cycle-safe: nodes that never reach in-degree 0 (part of a cycle) are left at
 * their initialized defaults rather than throwing — matching applyBlockingOrder's
 * graceful cycle fallback.
 *
 * @param {Array} issues - Flat array of card-data objects (mutated in place)
 * @returns {Array} The same array
 */
export function computeGraphFeatures(issues) {
  const { adj, inDegree } = buildBlockingGraph(issues);

  // Kahn's algorithm to get a topological order (blocker before blocked).
  const remaining = new Map(inDegree);
  const queue = issues.filter(i => remaining.get(i.id) === 0).map(i => i.id);
  const topo = [];
  while (queue.length > 0) {
    const id = queue.shift();
    topo.push(id);
    for (const blockedId of adj.get(id)) {
      const d = remaining.get(blockedId) - 1;
      remaining.set(blockedId, d);
      if (d === 0) queue.push(blockedId);
    }
  }

  // Reverse-topo DP. Processing successors before predecessors lets each node
  // fold in its successors' already-final values in a single pass.
  const indexOf = new Map(issues.map((issue, i) => [issue.id, i]));
  const critical = new Map(issues.map(i => [i.id, 1]));
  const reach = new Map(issues.map(i => [i.id, 0n]));
  for (let k = topo.length - 1; k >= 0; k--) {
    const id = topo[k];
    let longest = 1;
    let bits = 0n;
    for (const blockedId of adj.get(id)) {
      longest = Math.max(longest, 1 + critical.get(blockedId));
      // Union the successor and everything it can reach.
      bits |= (1n << BigInt(indexOf.get(blockedId))) | reach.get(blockedId);
    }
    critical.set(id, longest);
    reach.set(id, bits);
  }

  for (const issue of issues) {
    issue.criticalPathLen = critical.get(issue.id);
    issue.downstreamUnblocks = popcount(reach.get(issue.id));
  }
  return issues;
}

/**
 * Transitive frontier reachability (LIN-444). A candidate child is a transitive
 * "dead end" when its entire reachable subtree frontier is blocked: descending into
 * it can only ever land on blocked work. `selectFocusSubtask` uses this to route a
 * busy epic AWAY from such a candidate toward one with a genuinely open frontier —
 * the HAR-149 defect, where HAR-497 (itself non-blocked) was picked over HAR-545
 * because its dead branch (HAR-497 → blocked HAR-502) was invisible to in-set,
 * single-hop ranking.
 *
 * The "reachable frontier" walked here is the parent/child SUBTREE (not the
 * sibling blocking DAG that buildBlockingGraph/computeGraphFeatures reason over): a
 * node reaches an open frontier iff it is itself non-terminal and non-blocked AND
 * EITHER it has no non-terminal children (it is itself the actionable leaf) OR at
 * least one of its non-terminal children reaches an open frontier. Terminal and
 * blocked nodes contribute nothing. A non-blocked node whose every non-terminal
 * child dead-ends is therefore itself a dead end, because the descent into it would
 * only route on into blocked work.
 *
 * Degrades safely to today's behavior: a node whose children are absent or carry no
 * state/blocked signal (e.g. the ids-only grandchildren the un-enriched Linear query
 * or proxy returns) is treated as an actionable leaf → open. So when the provider
 * has not fetched subtree blocked-ness, every candidate reads as open, the signal is
 * inert, and ranking is unchanged. It only bites once the subtree carries real
 * blocked-ness (the LIN-444 query + harness enrichment).
 *
 * `isBlockedFn` is injected (rather than imported) because `isBlocked` lives in
 * tree.js and tree.js already imports this module — taking it as a parameter keeps
 * the dependency one-way and avoids a tree.js ⇄ graph-features import cycle.
 *
 * @param {Object} node - A child issue ({state, labels, inverseRelations, children})
 * @param {(node: Object) => boolean} isBlockedFn - blocked predicate (e.g. tree.js isBlocked)
 * @param {number} [depth] - recursion-depth guard (internal)
 * @returns {boolean} true if the node's subtree reaches any open, actionable work
 */
export function hasOpenFrontier(node, isBlockedFn, depth = 0) {
  if (!node) return false;
  if (isTerminalState(node.state?.type)) return false;
  if (isBlockedFn(node)) return false;
  // Depth guard: a tree should never be this deep — if it is, we can't prove a
  // dead end below here, so default to "open" (don't penalise on malformed data).
  if (depth >= 64) return true;
  const kids = (node.children?.nodes || node.children || [])
    .filter(c => c && !isTerminalState(c.state?.type));
  if (!kids.length) return true; // non-blocked, non-terminal, no open children → actionable itself
  return kids.some(c => hasOpenFrontier(c, isBlockedFn, depth + 1));
}

/** Count set bits in a non-negative BigInt. */
function popcount(bits) {
  let n = 0;
  while (bits > 0n) {
    n += Number(bits & 1n);
    bits >>= 1n;
  }
  return n;
}

/**
 * Adapt canonical tree children into the flat node shape computeGraphFeatures
 * reads (LIN-433). Canonical children carry `inverseRelations` (who blocks them)
 * but NOT forward `relations`/`blocksIds` (the Linear provider query does not
 * fetch them — lib/providers/linear/index.js), so the in-set sibling edge graph
 * is reconstructed from each child's inverse `blocks` edges instead of read off a
 * forward field. Sound because buildBlockingGraph only ever honors in-set,
 * non-terminal edges anyway — and the blocker's terminal state is re-checked
 * there from the `stateType` carried here.
 *
 * Returns NEW objects, so computeGraphFeatures' in-place mutation never touches
 * the caller's children.
 *
 * @param {Array} children - Canonical child issues ({id, identifier, state, inverseRelations})
 * @returns {Array<{id, identifier, stateType, blocksIds}>}
 */
export function childrenToGraphNodes(children) {
  const inSet = new Set(children.map(c => c.id));
  const blocksByBlocker = new Map(children.map(c => [c.id, []]));
  for (const child of children) {
    for (const rel of child.inverseRelations?.nodes || []) {
      if (rel.type !== 'blocks') continue;
      const blockerId = rel.issue?.id;
      // X blocks `child` iff child's inverse-blocks edge names in-set X.
      if (blockerId && inSet.has(blockerId)) {
        blocksByBlocker.get(blockerId).push(child.id);
      }
    }
  }
  return children.map(c => ({
    id: c.id,
    identifier: c.identifier,
    stateType: c.state?.type,
    blocksIds: blocksByBlocker.get(c.id) || []
  }));
}
