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
 */

import { nodeKey, parentKeyOf } from './tree.js';
import { compareByIdentifier } from './recommendation-facts.js';
import { isValidIssueId } from './workspace.js';

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

  const sortSubtree = (nodes) => {
    nodes.sort((a, b) => compareByIdentifier(a.issue, b.issue));
    nodes.forEach(node => sortSubtree(node.children));
  };
  sortSubtree(roots);
  return roots;
}
