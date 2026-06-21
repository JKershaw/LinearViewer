/**
 * Context graph — network-free relationship-neighborhood builder (LIN-572).
 *
 * Given the workspace's flat canonical issue set (the same `{ issues }` array
 * `provider.fetchProjects` returns) and a root issue, assembles the slice of the
 * task graph a user needs to understand "where does this task sit, and where do
 * I start?":
 *
 *   - blockers: everything that (transitively) blocks the root, by depth
 *   - blocked:  everything the root (transitively) blocks, by depth
 *   - parentChain / children: the hierarchy around the root
 *   - related:  one-hop `related`/`duplicate` links
 *
 * It is deterministic and resolves every edge WITHIN the supplied set (the same
 * universe the dashboard already renders), so it needs no per-hop API calls and
 * transitive chains fall straight out of a BFS. Both blocking dimensions are
 * derived from the SAME `blocks` edges: a blocker→blocked edge reversed is a
 * blocked-by link, so we never depend on a provider populating `blocked-by`.
 *
 * Edges are read from BOTH `relations` (forward: this issue blocks X) AND
 * `inverseRelations` (X blocks this issue) when present, then de-duplicated — so
 * the builder is correct whether the source stores an edge on the blocker side
 * (Linear's `fetchProjects`), the blocked side, or both (test fixtures).
 */

const TERMINAL_STATES = new Set(['completed', 'canceled', 'duplicate']);

// Bounded so a pathological graph can never produce an unrenderable wall of
// nodes (or a silent runaway BFS). Truncation is reported, never silent.
const DEFAULT_MAX_PER_DIRECTION = 24;
const DEFAULT_MAX_PARENT_DEPTH = 8;
const DEFAULT_MAX_CHILDREN = 50;

function isTerminal(stateType) {
  return TERMINAL_STATES.has(stateType);
}

/** Project a canonical issue down to the compact node the client renders. */
function toNode(issue) {
  return {
    id: issue.id,
    identifier: issue.identifier || issue.id,
    title: issue.title || '',
    stateType: issue.state?.type || 'backlog',
    stateName: issue.state?.name || '',
    url: issue.url || null,
  };
}

function stateOrder(stateType) {
  switch (stateType) {
    case 'started': return 0;
    case 'unstarted': return 1;
    case 'backlog': return 2;
    default: return 3; // terminal
  }
}

/**
 * Build the relationship neighborhood of `rootId` from a flat canonical issue
 * set.
 *
 * @param {Array<Object>} issues - Canonical issues (id, identifier, title, state,
 *   url, parent:{id}, relations:{nodes}, inverseRelations?:{nodes}).
 * @param {string} rootId - Canonical id of the root issue (must be in the set).
 * @param {Object} [opts]
 * @param {number} [opts.maxPerDirection] - Cap on blocker / blocked nodes each.
 * @returns {Object|null} The context graph, or null if rootId is absent.
 */
export function buildContextGraph(issues, rootId, opts = {}) {
  const maxPerDirection = opts.maxPerDirection ?? DEFAULT_MAX_PER_DIRECTION;
  const maxParentDepth = opts.maxParentDepth ?? DEFAULT_MAX_PARENT_DEPTH;
  const maxChildren = opts.maxChildren ?? DEFAULT_MAX_CHILDREN;

  const byId = new Map();
  for (const issue of issues || []) {
    if (issue && issue.id) byId.set(issue.id, issue);
  }
  const root = byId.get(rootId);
  if (!root) return null;

  // blocksAdj:    blocker -> Set(blocked)
  // blockedByAdj: blocked -> Set(blocker)
  // relatedPairs: id -> Map(otherId -> relType)
  const blocksAdj = new Map();
  const blockedByAdj = new Map();
  const relatedPairs = new Map();

  const addBlocks = (blocker, blocked) => {
    if (!byId.has(blocker) || !byId.has(blocked) || blocker === blocked) return;
    if (!blocksAdj.has(blocker)) blocksAdj.set(blocker, new Set());
    if (!blockedByAdj.has(blocked)) blockedByAdj.set(blocked, new Set());
    blocksAdj.get(blocker).add(blocked);
    blockedByAdj.get(blocked).add(blocker);
  };
  const addRelated = (a, b, relType) => {
    if (!byId.has(a) || !byId.has(b) || a === b) return;
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!relatedPairs.has(from)) relatedPairs.set(from, new Map());
      // Prefer the more specific 'duplicate' label if either side claims it.
      const existing = relatedPairs.get(from).get(to);
      if (existing !== 'duplicate') relatedPairs.get(from).set(to, relType);
    }
  };

  for (const issue of byId.values()) {
    for (const r of issue.relations?.nodes || []) {
      const other = r?.relatedIssue?.id;
      if (!other) continue;
      if (r.type === 'blocks') addBlocks(issue.id, other);
      else if (r.type === 'related' || r.type === 'duplicate') addRelated(issue.id, other, r.type);
    }
    for (const r of issue.inverseRelations?.nodes || []) {
      const other = r?.issue?.id;
      if (!other) continue;
      if (r.type === 'blocks') addBlocks(other, issue.id);
      else if (r.type === 'related' || r.type === 'duplicate') addRelated(issue.id, other, r.type);
    }
  }

  // Transitive BFS in one direction. `adj` maps a node to its next hop. Returns
  // nodes (excluding the root) tagged with their hop distance, capped.
  const bfs = (adj) => {
    const visited = new Set([rootId]);
    const out = [];
    let frontier = [rootId];
    let depth = 0;
    let truncated = 0;
    while (frontier.length) {
      depth += 1;
      const next = [];
      for (const id of frontier) {
        for (const neighbor of adj.get(id) || []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          if (out.length >= maxPerDirection) { truncated += 1; continue; }
          out.push({ ...toNode(byId.get(neighbor)), depth });
          next.push(neighbor);
        }
      }
      frontier = next;
    }
    return { nodes: out, truncated };
  };

  const blockersResult = bfs(blockedByAdj);
  const blockedResult = bfs(blocksAdj);

  // A blocker is a "start here" candidate when it is itself actionable: not
  // terminal and not held up by any non-terminal blocker inside this set.
  const hasOpenBlocker = (id) => {
    for (const b of blockedByAdj.get(id) || []) {
      if (!isTerminal(byId.get(b)?.state?.type)) return true;
    }
    return false;
  };
  for (const node of blockersResult.nodes) {
    node.isStart = !isTerminal(node.stateType) && !hasOpenBlocker(node.id);
  }

  // Sort each direction by distance, then by state relevance, then identifier —
  // deterministic and read-left-to-right "root cause first" for blockers.
  const byDepthThenState = (a, b) =>
    a.depth - b.depth ||
    stateOrder(a.stateType) - stateOrder(b.stateType) ||
    a.identifier.localeCompare(b.identifier);
  blockersResult.nodes.sort(byDepthThenState);
  blockedResult.nodes.sort(byDepthThenState);

  // Parent chain (nearest-first), cycle- and depth-bounded.
  const parentChain = [];
  const seenParents = new Set([rootId]);
  let cursor = root;
  while (cursor?.parent?.id && parentChain.length < maxParentDepth) {
    const parent = byId.get(cursor.parent.id);
    if (!parent || seenParents.has(parent.id)) break;
    seenParents.add(parent.id);
    parentChain.push(toNode(parent));
    cursor = parent;
  }

  // Children = issues whose parent is the root.
  const allChildren = [];
  for (const issue of byId.values()) {
    if (issue.parent?.id === rootId) allChildren.push(toNode(issue));
  }
  allChildren.sort((a, b) =>
    stateOrder(a.stateType) - stateOrder(b.stateType) || a.identifier.localeCompare(b.identifier));
  const childrenTruncated = Math.max(0, allChildren.length - maxChildren);
  const children = allChildren.slice(0, maxChildren);

  // Related / duplicate (one hop, undirected).
  const related = [];
  for (const [otherId, relType] of relatedPairs.get(rootId) || []) {
    const node = byId.get(otherId);
    if (node) related.push({ ...toNode(node), relType });
  }
  related.sort((a, b) =>
    stateOrder(a.stateType) - stateOrder(b.stateType) || a.identifier.localeCompare(b.identifier));

  const rootNode = toNode(root);
  rootNode.isBlocked = blockersResult.nodes.some(n => !isTerminal(n.stateType));

  return {
    root: rootNode,
    parent: parentChain[0] || null,
    parentChain,
    children,
    childrenTruncated,
    blockers: blockersResult.nodes,
    blockersTruncated: blockersResult.truncated,
    blocked: blockedResult.nodes,
    blockedTruncated: blockedResult.truncated,
    related,
  };
}
