/**
 * lib/subtree-index.js — the one owner of a task's subtree (LIN-4049, LIN-4040 S1).
 *
 * The In Progress, Recent activity and project forests each hold part of a task's children: a non-started parent gets
 * only its started child's side in the In Progress forest, and a subtask with its own project is a root of that project
 * in the project forest. A row that reads whichever forest it visits first can miss a running descendant. This module
 * builds the subtree once, from the fetched set's parent links, and every surface that states a task's state reads it.
 *
 * It is built after the hidden-state drop and before the assignee filter (`fetchAndPrepareProjects`), so a filtered view
 * still sees every child of a parent it shows. Children are in the natural identifier order `parentNextOf`'s picker uses,
 * so the attention line names the same subtask on every surface.
 *
 * `/state` has no tracker read, so it cannot build the index. The client sends back the subtree the server computed (as
 * parent→child edges with each child's state type), and `subtreeFromHint` rebuilds it with the same order and the same
 * `buildRowStates` Home reads. The hint is advisory and can only narrow what the box offers.
 */

import { nodeKey, parentKeyOf } from './tree.js';
import { compareByIdentifier } from './recommendation-facts.js';
import { isValidIssueId } from './workspace.js';
import { STATE_ORDER } from './providers/models.js';

/**
 * The most descendants a `/state` read follows (LIN-4049). Over it the box fails closed: it offers no run and says why.
 * PROVISIONAL: the plan sets this from the largest parent in the 29 Oct backlog copy, with margin. That copy is not
 * committed in this repository (searched: tracked files, git history 28-31 Oct, data/linear-viewer, the eval fixtures),
 * so 25 is a placeholder until the copy is measured.
 */
export const SUBTREE_READ_CAP = 25;

/**
 * Order a set of sibling nodes, and each one's subtree, by identifier (the natural order `parentNextOf` uses). In place.
 * @param {Array<{issue: Object, children: Array}>} nodes
 */
export function sortSubtree(nodes) {
  nodes.sort((a, b) => compareByIdentifier(a.issue, b.issue));
  nodes.forEach(node => sortSubtree(node.children));
}

/**
 * Build the subtree index for a fetched issue set.
 *
 * Nodes are `{issue, children}`. An issue whose parent is outside the set (or was dropped) is a root. An issue whose
 * identifier fails `isValidIssueId` is dropped, since no surface can address it; its children then become roots.
 *
 * @param {Issue[]} issues - the fetched set, after the hidden-state drop, before the assignee filter
 * @returns {Array<{issue: Issue, children: Array}>} the roots, each subtree sorted by identifier
 */
export function buildSubtreeIndex(issues) {
  const byKey = new Map();
  for (const issue of issues) {
    if (!isValidIssueId(issue?.identifier)) continue;
    byKey.set(nodeKey(issue), { issue, children: [] });
  }

  const roots = [];
  for (const node of byKey.values()) {
    const parent = byKey.get(parentKeyOf(node.issue));
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  sortSubtree(roots);
  return roots;
}

/**
 * The subtree a surface sends with its state read, and its wire format (LIN-4049): the subtree as parent→child edges,
 * each child with its tracker state type, in breadth-first order from the root, so `edges` is a connected prefix.
 * Stops after `cap + 1` descendants: the server then sees more than the cap and fails closed.
 *
 * @param {{issue: Object, children: Array}} node - an index node (or a rebuilt subtree root)
 * @param {{cap?: number}} [opts]
 * @returns {{edges: Array<[string, string, string|null]>, incomplete: false}}
 */
export function subtreeHintOf(node, { cap = SUBTREE_READ_CAP } = {}) {
  const edges = [];
  const queue = [node];
  while (queue.length > 0 && edges.length <= cap) {
    const current = queue.shift();
    for (const child of current.children) {
      if (edges.length > cap) break;
      edges.push([current.issue.identifier, child.issue.identifier, child.issue.state?.type ?? null]);
      queue.push(child);
    }
  }
  return { edges, incomplete: false };
}

/**
 * The hint for every node of an index that has children, keyed by source-qualified node key (`nodeKey`), so a surface
 * that holds issue records (Home's rows, Swipe's cards) finds its own subtree without walking the tree again.
 *
 * @param {Array<{issue: Object, children: Array}>|null|undefined} roots
 * @returns {Map<string, {edges: Array, incomplete: boolean}>}
 */
export function subtreeHintsByNodeKey(roots) {
  const hints = new Map();
  const visit = (node) => {
    if (node.children.length > 0) hints.set(nodeKey(node.issue), subtreeHintOf(node));
    node.children.forEach(visit);
  };
  (roots || []).forEach(visit);
  return hints;
}

/**
 * Validate the subtree the client sent back with its state read (LIN-4049). The wire format is
 * `{"edges": [[parent, child, stateType], ...], "incomplete": false}`. An entry with an invalid identifier, or a state
 * type outside the tracker's closed set, is dropped, and the result is marked `incomplete`: a dropped entry may hide a
 * running subtask, so the box fails closed rather than offering a run it cannot see past. An unreadable body is
 * incomplete too. No parameter at all is a leaf: no subtree, not incomplete.
 *
 * @param {string|null|undefined} raw - the JSON the `subtree` query parameter carries
 * @returns {{edges: Array<{parent: string, child: string, type: string}>, incomplete: boolean}}
 */
export function parseSubtreeHint(raw) {
  if (raw === undefined || raw === null || raw === '') return { edges: [], incomplete: false };
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { edges: [], incomplete: true };
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.edges)) return { edges: [], incomplete: true };
  let incomplete = body.incomplete === true;
  const edges = [];
  for (const entry of body.edges) {
    if (!Array.isArray(entry) || entry.length !== 3) {
      incomplete = true;
      continue;
    }
    const [parent, child, type] = entry;
    if (!isValidIssueId(parent) || !isValidIssueId(child) || typeof type !== 'string' || !Object.hasOwn(STATE_ORDER, type)) {
      incomplete = true;
      continue;
    }
    edges.push({ parent, child, type });
  }
  return { edges, incomplete };
}

/**
 * Rebuild a task's subtree from validated edges (`parseSubtreeHint`), in the same shape and order `buildSubtreeIndex`
 * gives. Only children reachable from the root are placed; a child listed twice is placed under its first parent; the
 * root is never placed under itself.
 *
 * The root's own `issue.state` is null: `/state` has no tracker read, so it knows no tracker word for the root.
 *
 * @param {string} rootIdentifier
 * @param {Array<{parent: string, child: string, type: string}>} edges
 * @param {{cap?: number}} [opts]
 * @returns {{root: {issue: Object, children: Array}, descendants: number, overCap: boolean}} `overCap` is true when the
 *   reachable subtree is larger than the cap; the caller then reads nothing below the root and fails closed.
 */
export function subtreeFromHint(rootIdentifier, edges, { cap = SUBTREE_READ_CAP } = {}) {
  const childrenOf = new Map();
  for (const { parent, child, type } of edges) {
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push({ identifier: child, type });
  }

  const nodeOf = (identifier, type) => ({ issue: { identifier, title: null, state: type ? { type } : null }, children: [] });
  const root = nodeOf(rootIdentifier, null);
  const placed = new Set([rootIdentifier]);
  const queue = [root];
  let descendants = 0;
  while (queue.length > 0) {
    const node = queue.shift();
    for (const { identifier, type } of childrenOf.get(node.issue.identifier) || []) {
      if (placed.has(identifier)) continue;
      placed.add(identifier);
      const child = nodeOf(identifier, type);
      node.children.push(child);
      queue.push(child);
      descendants += 1;
    }
  }

  sortSubtree([root]);
  return { root, descendants, overCap: descendants > cap };
}
