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
 * PROVISIONAL: the plan sets this from the largest parent in the 29 Oct backlog copy, with margin. That copy is not in
 * this repository, so the value here is a placeholder until it is measured.
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
 * Validate a subtree hint the client sent back (LIN-4049). Each entry is `[parentIdentifier, childIdentifier,
 * childStateType]`. An entry with an invalid identifier or a state type outside the tracker's closed set is dropped.
 *
 * @param {string|null|undefined} raw - the JSON the `subtree` query parameter carries
 * @returns {Array<{parent: string, child: string, type: string}>} the valid edges, in the order sent
 */
export function parseSubtreeHint(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length !== 3) return [];
    const [parent, child, type] = entry;
    if (!isValidIssueId(parent) || !isValidIssueId(child)) return [];
    if (typeof type !== 'string' || !Object.hasOwn(STATE_ORDER, type)) return [];
    return [{ parent, child, type }];
  });
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
