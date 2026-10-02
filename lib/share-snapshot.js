/**
 * Share snapshot builder (LIN-3243, Session A of LIN-3073).
 *
 * Pure transform from the owner's full workspace issue set (the output of
 * `readOwnerIssues`, one `fetchProjects` read) to the small, privacy-bounded
 * payload a public share page renders. Two jobs:
 *
 *   1. Select the collection members — a parent's subtasks (`parent.id`) or
 *      every issue carrying a label.
 *   2. Project each member to a strict allow-list
 *      `{identifier, title, state:{type}, priority, updatedAt}` plus an
 *      opt-in `description`. Comments, URLs, assignees, labels, estimates and
 *      every other field are never selected — the projection is a constructor,
 *      not a filter, so a future query widening cannot leak a field through.
 *
 * Hiding rules: `canceled` is dropped via the shared `isHiddenState` predicate
 * (unchanged, so the dashboard is unaffected) and `duplicate` is dropped
 * explicitly (LIN-276 treats them alike on public surfaces). `completed` stays
 * visible — it IS done — and renders with the ✓ glyph on the share page.
 *
 * Archived issues are never in the input: fetchProjects does not pass includeArchived, so this relies on Linear's default (LIN-3073 plan, "Settled from code at HEAD").
 */

import { DUPLICATE } from './providers/models.js';
import { isHiddenState } from './providers/state-map.js';

/**
 * Label names for an issue, across the shapes major providers emit: Linear's
 * `{ nodes: [{ name }] }`, the flat `[{ name }]` / `['bug']` arrays the other
 * providers use. Order-preserving, blanks dropped.
 *
 * @param {Object} issue
 * @returns {string[]}
 */
function labelNames(issue) {
  const labels = issue?.labels;
  if (Array.isArray(labels)) {
    return labels.map(l => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
  }
  if (labels && Array.isArray(labels.nodes)) {
    return labels.nodes.map(l => l?.name).filter(Boolean);
  }
  return [];
}

function isMember(issue, subject) {
  if (subject.kind === 'parent') return issue?.parent?.id === subject.id;
  return labelNames(issue).includes(subject.id);
}

/**
 * The strict per-issue projection. Every key is written explicitly; nothing is
 * copied wholesale from the source issue.
 */
function project(issue, includeDescriptions) {
  const item = {
    identifier: issue?.identifier ?? null,
    title: issue?.title ?? '',
    state: { type: issue?.state?.type ?? null },
    priority: issue?.priority ?? null,
    updatedAt: issue?.updatedAt ?? null
  };
  if (includeDescriptions) item.description = issue?.description ?? '';
  return item;
}

/**
 * Build the share snapshot from a workspace's canonical issue set.
 *
 * @param {Object} input
 * @param {{type:'collection',kind:'parent'|'label',id:string}} input.subject
 * @param {Object[]} input.issues - the owner's full issue list (e.g. fetchProjects output)
 * @param {boolean} [input.includeDescriptions=false]
 * @returns {{title: string, items: Object[]}}
 */
export function buildShareSnapshot({ subject, issues = [], includeDescriptions = false } = {}) {
  if (!subject || subject.type !== 'collection' || (subject.kind !== 'parent' && subject.kind !== 'label')) {
    throw new Error('subject must be { type: "collection", kind: "parent"|"label", id }');
  }
  const list = Array.isArray(issues) ? issues : [];

  // Parent shares get the parent task's title; label shares are titled by the
  // label itself. Falls back to the subject id if the parent isn't in the set.
  let title = subject.id;
  if (subject.kind === 'parent') {
    const parent = list.find(i => i?.id === subject.id);
    title = parent?.title ?? subject.id;
  }

  const items = list
    .filter(issue => isMember(issue, subject))
    .filter(issue => !isHiddenState(issue))
    .filter(issue => issue?.state?.type !== DUPLICATE)
    .map(issue => project(issue, includeDescriptions));

  return { title, items };
}
