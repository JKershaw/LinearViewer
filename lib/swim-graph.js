/**
 * Swim Graph — pure dependency-graph model for the "flow" (side-rail) view.
 *
 * Where swim-lanes.js builds a lane/segment/column grid, this module builds the
 * structures the vertical flow view needs:
 *   - the parent/subtask hierarchy (childrenOf, depth, roots) for nested boxes
 *   - the blocking edges + reverse blockedBy map
 *   - a longest-path rank (topological depth) over blocks + parent edges
 *   - connected components
 *   - a greedy path cover that merges blocking chains into continuous "spines",
 *     leaving fan-out / fan-in as separate "branch" edges.
 *
 * Issue shape (post-flatten, same as render-swim/swim.js):
 *   { id, identifier, title, stateType, parentId, blocksIds: [...] , ... }
 */

import { isTerminalState } from './tree.js';

/**
 * Build the graph model from a flat list of issue cards.
 *
 * @param {Array} issues
 * @param {Object} [options]
 * @param {boolean} [options.showCompleted=false] - include terminal-state issues
 * @returns {{
 *   nodes: Array, byId: Map, childrenOf: Map<string,string[]>, depth: Map<string,number>,
 *   roots: Array, blocks: Array<[string,string]>, blockedBy: Map<string,string[]>,
 *   rank: Map<string,number>, components: Array<Array>
 * }}
 */
export function buildGraph(issues, options = {}) {
  const { showCompleted = false } = options;
  const nodes = showCompleted ? issues.slice() : issues.filter(i => !isTerminalState(i.stateType));
  const byId = new Map(nodes.map(n => [n.id, n]));

  const childrenOf = new Map(nodes.map(n => [n.id, []]));
  const blocks = [];
  const blockedBy = new Map();
  const parentEdges = [];

  for (const n of nodes) {
    for (const t of n.blocksIds || []) {
      if (byId.has(t)) {
        blocks.push([n.id, t]);
        if (!blockedBy.has(t)) blockedBy.set(t, []);
        blockedBy.get(t).push(n.id);
      }
    }
    if (n.parentId && byId.has(n.parentId)) {
      childrenOf.get(n.parentId).push(n.id);
      parentEdges.push([n.parentId, n.id]);
    }
  }

  // hierarchy depth (0 = top-level)
  const depth = new Map();
  function depthOf(id) {
    if (depth.has(id)) return depth.get(id);
    const n = byId.get(id);
    const v = (n.parentId && byId.has(n.parentId)) ? depthOf(n.parentId) + 1 : 0;
    depth.set(id, v);
    return v;
  }
  for (const n of nodes) depthOf(n.id);
  const roots = nodes.filter(n => !n.parentId || !byId.has(n.parentId));

  // longest-path rank over blocks + parent edges (Kahn)
  const directed = blocks.concat(parentEdges);
  const indeg = new Map(nodes.map(n => [n.id, 0]));
  const adj = new Map(nodes.map(n => [n.id, []]));
  for (const [a, b] of directed) { adj.get(a).push(b); indeg.set(b, indeg.get(b) + 1); }
  const rank = new Map();
  const q = [];
  for (const n of nodes) if (indeg.get(n.id) === 0) { rank.set(n.id, 0); q.push(n.id); }
  while (q.length) {
    const u = q.shift();
    for (const v of adj.get(u)) {
      rank.set(v, Math.max(rank.get(v) || 0, (rank.get(u) || 0) + 1));
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) q.push(v);
    }
  }
  // cycle fallback: any unranked node gets 0
  for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0);

  // connected components (undirected over all edges)
  const uf = new Map(nodes.map(n => [n.id, n.id]));
  function find(x) { while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x))); x = uf.get(x); } return x; }
  function union(a, b) { uf.set(find(a), find(b)); }
  for (const [a, b] of directed) union(a, b);
  const compOrder = new Map();
  let o = 0;
  for (const n of nodes) { const r = find(n.id); if (!compOrder.has(r)) compOrder.set(r, o++); }
  const buckets = new Map();
  for (const n of nodes) { const r = find(n.id); if (!buckets.has(r)) buckets.set(r, []); buckets.get(r).push(n); }
  const components = [...buckets.entries()].sort((a, b) => compOrder.get(a[0]) - compOrder.get(b[0])).map(e => e[1]);

  return { nodes, byId, childrenOf, depth, roots, blocks, blockedBy, rank, components };
}

/**
 * Greedy path cover over the blocking graph: each node continues into one
 * not-yet-claimed successor, building maximal chains. Chains of length ≥ 2
 * become "spines" (drawn as a single continuous line); every blocking edge not
 * on a spine is a "branch" (fan-out / fan-in).
 *
 * @param {ReturnType<typeof buildGraph>} graph
 * @returns {{ spines: Array<string[]>, branches: Array<[string,string]> }}
 */
export function pathCover(graph) {
  const { nodes, blocks, rank } = graph;
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const rk = id => (rank.get(id) || 0) * 100000 + (idx.has(id) ? idx.get(id) : 0);

  const outAdj = new Map();
  for (const [s, t] of blocks) { if (!outAdj.has(s)) outAdj.set(s, []); outAdj.get(s).push(t); }
  for (const arr of outAdj.values()) arr.sort((a, b) => rk(a) - rk(b));

  const order = nodes.map(n => n.id).sort((a, b) => rk(a) - rk(b));
  const nextOf = new Map();
  const claimed = new Set();
  for (const u of order) {
    const outs = outAdj.get(u) || [];
    for (const t of outs) { if (!claimed.has(t)) { nextOf.set(u, t); claimed.add(t); break; } }
  }

  const spines = [];
  for (const u of order) {
    if (claimed.has(u)) continue;
    const path = [u];
    let cur = u;
    while (nextOf.has(cur)) { cur = nextOf.get(cur); path.push(cur); }
    if (path.length > 1) spines.push(path);
  }

  const onSpine = new Set();
  for (const [u, v] of nextOf) onSpine.add(u + '>' + v);
  const branches = blocks.filter(([s, t]) => !onSpine.has(s + '>' + t));

  return { spines, branches };
}
