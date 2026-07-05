// Pure task-stack projection pipeline (LIN-1026).
//
// The sorted "task stack" — the swipe-view ordering distilled into an
// orientation-grade list — was inlined in the `/api/proxy/stack` route
// (routes/proxy.js). It is now a single pure helper so that BOTH the route and
// the read-only chat tool `get_stack` (lib/chat-tools.js) drive the exact same
// projection: same forest build, same dedupe order, same graph-feature sort,
// same digest/full wire shape. Extracting it here (rather than re-implementing
// in the tool) is what keeps the two consumers from drifting; the `/stack`
// contract is pinned by a characterization test in tests/unit/task-stack.test.js.
//
// This module is network-free and provider-agnostic: it takes the already
// fetched `{ projects, issues }` and returns the projected `{ tasks, total, view }`.
// Fetching those inputs (Linear GraphQL for the route, `provider.fetchProjects`
// for the tool) stays with the caller.

import {
  buildForest,
  partitionCompleted,
  buildInProgressForest,
  buildRecentActivityForest,
  NO_PROJECT_ID,
} from './tree.js';
import {
  flattenTrees,
  sortIssuesForSwipe,
  applyBlockingOrder,
  clusterByParent,
  computeGraphFeatures,
  computeOffPageBlockers,
  buildWhy,
} from './render-swipe.js';

/** Max length of the deterministic one-line headline in the `/stack` digest view. */
export const STACK_HEADLINE_MAX = 140;

/**
 * Reduce a task description to a single deterministic headline line for the
 * `/stack?view=digest` projection. Takes the first non-empty line and truncates
 * it — no LLM, cheap and exact, so orientation stays light and reproducible.
 * @param {string|null|undefined} description - Full task description
 * @returns {string} One-line headline (possibly empty)
 */
export function toStackHeadline(description) {
  if (!description || typeof description !== 'string') return '';
  const firstLine = description.split('\n').map(s => s.trim()).find(s => s.length > 0) || '';
  if (firstLine.length <= STACK_HEADLINE_MAX) return firstLine;
  return firstLine.slice(0, STACK_HEADLINE_MAX - 1).trimEnd() + '…';
}

/**
 * Clamp a requested stack limit to the supported window: an integer in 1–50,
 * defaulting to 5 when absent/invalid. Shared by the route (parses a query
 * param) and the `get_stack` tool (receives a number) so both bound identically.
 * @param {*} raw
 * @returns {number} Integer in [1, 50]
 */
export function clampStackLimit(raw) {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
  return Math.min(Math.max(Number.isFinite(n) ? Math.trunc(n) : 5, 1), 50);
}

/**
 * Build the sorted task stack from already-fetched projects + issues, using the
 * same pipeline as the swipe view: forest build → dedupe (in-progress, then
 * project, then recent-activity) → transitive graph features → swipe sort →
 * blocking order + parent clustering → slice → project to the wire shape.
 *
 * NOTE: mutates the passed `projects`/`issues` (pushes a synthetic "No Project",
 * stamps parent/children + graph features onto issues), exactly as the route did
 * inline. Callers pass freshly-fetched arrays.
 *
 * @param {Object} args
 * @param {Array<Object>} args.projects - Projects from the provider fetch.
 * @param {Array<Object>} args.issues - Issues from the provider fetch.
 * @param {*} [args.limit] - Requested count; clamped to 1–50 (default 5).
 * @param {'full'|'digest'} [args.view='full'] - Projection shape.
 * @returns {{ tasks: Array<Object>, total: number, view: 'full'|'digest' }}
 */
export function buildTaskStack({ projects, issues, limit, view = 'full' } = {}) {
  const boundedLimit = clampStackLimit(limit);
  const isDigest = view === 'digest';

  // Build tree structure
  const forest = buildForest(issues);
  if (forest.has(NO_PROJECT_ID)) {
    projects.push({
      id: NO_PROJECT_ID,
      name: 'No Project',
      content: null,
      url: null,
      sortOrder: Number.MAX_SAFE_INTEGER
    });
  }

  const inProgressTrees = buildInProgressForest(issues, projects);
  const recentActivityTrees = buildRecentActivityForest(issues, projects, 1);
  const trees = projects
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(project => {
      const { roots } = forest.get(project.id) || { roots: [] };
      const { incomplete } = partitionCompleted(roots);
      return { project, incomplete };
    });

  // Flatten and deduplicate (same as swipe view)
  const projectIssues = flattenTrees(trees, 'project');
  const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
  const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

  const seenIds = new Set();
  const allIssues = [];
  for (const issue of inProgressIssues) {
    if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
  }
  for (const issue of projectIssues) {
    if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
  }
  for (const issue of recentIssues) {
    if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
  }

  // Build parent/child relationships (flat throughout; this is already the
  // neutral flat wire shape the rest of the API now aligns onto).
  const cardById = new Map(allIssues.map(i => [i.id, i]));
  const childrenMap = new Map();
  for (const issue of allIssues) {
    if (issue.parentId && cardById.has(issue.parentId)) {
      const parent = cardById.get(issue.parentId);
      issue.parentIdentifier = parent.identifier;
      issue.parentTitle = parent.title;
      if (!childrenMap.has(issue.parentId)) childrenMap.set(issue.parentId, []);
      childrenMap.get(issue.parentId).push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        state: { type: issue.stateType }
      });
    }
  }
  for (const [parentId, children] of childrenMap) {
    const parent = cardById.get(parentId);
    if (parent) parent.children = children;
  }

  // Compute transitive graph features (LIN-391) BEFORE the sort — they are
  // sort-keys (downstreamUnblocks/criticalPathLen) and also stamped onto the
  // digest line. Same ordering as the swipe view (renderSwipePage), which
  // runs the identical pipeline.
  computeGraphFeatures(allIssues);
  sortIssuesForSwipe(allIssues);
  const sortedIssues = clusterByParent(applyBlockingOrder(allIssues));

  // Trim to limit and project to the neutral flat wire shape. Agents assume
  // `state.name`, `parent.identifier`, `children` (not `subtasks`), so we
  // expose that shape uniformly here.
  //
  // `view: 'digest'` returns a compact, orientation-grade projection: it drops
  // the (potentially large) full `description` in favour of a deterministic
  // one-line `headline`, and replaces the `children`/`blocksIds` arrays with
  // counts. This lets a light orchestrator get a sense of the whole stack at a
  // glance without holding every task's full body in context.
  const sliced = sortedIssues.slice(0, boundedLimit);
  // Off-page blockers (LIN-391): direct blockers pushed beyond the slice that
  // still shaped a visible line's position. Derived from final post-cluster
  // positions; no transitive closure stored.
  const offPageBlockers = computeOffPageBlockers(sortedIssues, boundedLimit);
  const tasks = isDigest
    ? sliced.map(issue => {
        const heldBy = offPageBlockers.get(issue.id) || [];
        return {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          headline: toStackHeadline(issue.description),
          priority: issue.priority,
          state: { name: issue.stateName, type: issue.stateType },
          labels: issue.labels || [],
          section: issue.section || null,
          assignee: issue.assignee || null,
          project: issue.projectName ? { name: issue.projectName } : null,
          parent: issue.parentId
            ? { identifier: issue.parentIdentifier || null }
            : null,
          blocks: (issue.blocksIds || []).length,
          children: (issue.children || []).length,
          // Explainability (LIN-391): transitive features + compact `why`.
          downstreamUnblocks: issue.downstreamUnblocks || 0,
          criticalPathLen: issue.criticalPathLen || 0,
          ...(heldBy.length > 0 ? { heldBy } : {}),
          why: buildWhy(issue, heldBy)
        };
      })
    : sliced.map(issue => {
        const heldBy = offPageBlockers.get(issue.id) || [];
        return {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description,
          priority: issue.priority,
          state: { name: issue.stateName, type: issue.stateType },
          labels: issue.labels || [],
          project: issue.projectName ? { name: issue.projectName } : null,
          parent: issue.parentId
            ? { id: issue.parentId, identifier: issue.parentIdentifier || null, title: issue.parentTitle || null }
            : null,
          children: issue.children || [],
          blocksIds: issue.blocksIds || [],
          // Same computed scalars as digest, for full/digest consistency (LIN-391).
          downstreamUnblocks: issue.downstreamUnblocks || 0,
          criticalPathLen: issue.criticalPathLen || 0,
          ...(heldBy.length > 0 ? { heldBy } : {})
        };
      });

  return { tasks, total: sortedIssues.length, view: isDigest ? 'digest' : 'full' };
}
