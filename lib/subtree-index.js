/**
 * lib/subtree-index.js — the one children index over a workspace's issue set (LIN-4068 D3; lifted from LIN-4049 / #2196).
 *
 * The In Progress, Recent activity and project forests each hold part of a task's children: a non-started parent gets
 * only its started child's side in the In Progress forest, and a subtask with its own project is a root of that project
 * in the project forest. A row that reads whichever forest it visits first can miss a running descendant. This index is
 * built once, from the fetched set's parent links, at every depth, so every state reads the same subtree.
 *
 * It is built after the hidden-state drop and before the assignee filter (`fetchAndPrepareProjects`), so a filtered view
 * still sees every descendant of a parent it shows. Children are in the natural identifier order `parentNextOf`'s picker
 * uses, so the attention line names the same subtask on every surface. Terminal children are included: a Done child's
 * running close-out still rolls up to its parent.
 */

import { nodeKey, parentKeyOf } from './tree.js';
import { compareByIdentifier } from './recommendation-facts.js';
import { isValidIssueId } from './workspace.js';

/**
 * Order a set of sibling nodes, and each one's subtree, by identifier (the natural order `parentNextOf` uses). In place.
 * @param {Array<{issue: Object, children: Array}>} nodes
 */
export function sortSubtree(nodes) {
  nodes.sort((a, b) => compareByIdentifier(a.issue, b.issue));
  nodes.forEach((node) => sortSubtree(node.children));
}

/**
 * Build the subtree index for a fetched issue set.
 *
 * Nodes are `{issue, children}`. An issue whose parent is outside the set (or was dropped) is a root. An issue whose
 * identifier fails `isValidIssueId` is dropped, since no surface can address it; its children then become roots.
 *
 * @param {Array<Object>} issues - the fetched set, after the hidden-state drop, before the assignee filter
 * @returns {Array<{issue: Object, children: Array}>} the roots, each subtree sorted by identifier
 */
export function buildSubtreeIndex(issues) {
  const byKey = new Map();
  for (const issue of issues || []) {
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
 * Find a node by identifier in an index (depth-first). Null when the index has no such task.
 * @param {Array<{issue: Object, children: Array}>} roots
 * @param {string} identifier
 * @returns {{issue: Object, children: Array}|null}
 */
export function findSubtree(roots, identifier) {
  const stack = [...(roots || [])];
  while (stack.length) {
    const node = stack.pop();
    if (node.issue.identifier === identifier) return node;
    stack.push(...node.children);
  }
  return null;
}

/**
 * Every identifier in a subtree, root first.
 * @param {{issue: Object, children: Array}|null} node
 * @returns {string[]}
 */
export function subtreeIdentifiers(node) {
  const out = [];
  const visit = (n) => {
    out.push(n.issue.identifier);
    n.children.forEach(visit);
  };
  if (node) visit(node);
  return out;
}
