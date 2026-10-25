/**
 * Task board view model (LIN-3754, the UI flank's last move).
 *
 * The board-side application of the ordering rules: which trees feed each
 * board, how each board dedupes its cards, which parent links it stamps, and
 * whether it clusters or demotes starter seeds. It sits in the server-rendered
 * pages area on purpose: each board's composition is a board choice, so a
 * change to one board is a pages change. The ranking rules it applies stay in
 * `task-order.js` and `graph-features.js` (Task model), and filing this file
 * under Task model would add a new "pages ⇄ Task model" pair.
 *
 * NO HTML in this file. It composes `task-order.js` and `graph-features.js`
 * and returns plain card arrays; the page renderers format them.
 *
 * Which page uses which function:
 *   orderIssuesForSwipe   → render-swipe.js (the deck) and Home's top-task mark
 *   orderIssuesForSwim    → render-swim.js
 *   flattenIssuesForShip  → render-ship.js
 *   orderInProgress       → Home's In Progress section (LIN-3833); buildInProgressCountLine → its heading line
 *
 * The three boards differ on purpose, and the differences are kept as they are:
 *   - Swipe dedupes by the source-qualified `nodeKey` (LIN-544); Swim and Ship
 *     dedupe by raw `issue.id`.
 *   - Swipe stamps both `parentInfo` and `subtasks`; Swim stamps `parentInfo`
 *     only; Ship stamps neither.
 *   - Swipe and Swim rank and order by blockers; Ship does not rank.
 */

import { nodeKey, PERIODICALS_PROJECT_ID } from './tree.js';
import { computeGraphFeatures } from './graph-features.js';
import { flattenTrees, sortIssuesForSwipe, applyBlockingOrder, clusterByParent, buildWhy } from './task-order.js';
import { starterSeedIssueIds } from './starter-seed.js';

// =============================================================================
// The shared ordering pipeline
// =============================================================================

// Dedupe key: the same source-qualified `source:id` the merged tree uses, not the
// raw id (LIN-544). One ticket source per kind (LIN-3332) makes `source` alone
// unambiguous.
const cardKey = (card) => nodeKey({ id: card.id, source: card.source });

/** The slim card summary embedded in `parentInfo` and `subtasks`. */
const summary = ({ id, identifier, title, stateType }) => ({ id, identifier, title, stateType });

/**
 * Stamp `parentInfo` on every card whose parent is in the set, then `subtasks`
 * on each such parent. Keys are source-qualified so a same-number parent in
 * another provider never adopts a card. Two passes keep the stamp order
 * (parentInfo before subtasks) the embedded JSON depends on.
 */
function linkParents(cards) {
  const cardByKey = new Map(cards.map(card => [cardKey(card), card]));
  const subtasksByParent = new Map();
  for (const card of cards) {
    if (!card.parentId) continue;
    const parentKey = cardKey({ id: card.parentId, source: card.source });
    const parent = cardByKey.get(parentKey);
    if (!parent) continue;
    card.parentInfo = summary(parent);
    subtasksByParent.set(parentKey, [...(subtasksByParent.get(parentKey) || []), summary(card)]);
  }
  for (const [parentKey, subtasks] of subtasksByParent) {
    cardByKey.get(parentKey).subtasks = subtasks;
  }
}

/**
 * Order the flat task set exactly as the Swipe deck does (LIN-2944 P1).
 *
 * One helper, two consumers: `renderSwipePage` (the deck) and Home's top-task
 * mark, so the two surfaces cannot drift. It is pure and synchronous — it ranks
 * data already fetched and adds no provider call. The first element is the
 * deck's front card.
 *
 * Periodicals rows are not tasks to rank: they are unstarted with no priority,
 * so one could become Home's top task while Home never marks a Periodicals row,
 * and a Periodicals-only Home would hide the seed-only onboarding hint. The deck
 * never sees them (it is built without `urlKey`), so they are dropped here, from
 * a copy — the caller's trees are untouched.
 *
 * @param {Object} data
 * @param {Array} [data.projectTrees] - Project trees from fetchAndPrepareProjects
 * @param {Array} [data.inProgressTrees] - In-progress trees
 * @param {Array} [data.recentActivityTrees] - Recent activity trees
 * @param {string|null} [data.urlKey] - Workspace key; enables starter-seed demotion
 * @returns {Array} Ordered card objects, stamped (in this key order) with graph
 *   features, parentInfo/subtasks, `isSeed` and `why`. Stamped only on the cards
 *   built here, never on the trees.
 */
export function orderIssuesForSwipe({ projectTrees = [], inProgressTrees = [], recentActivityTrees = [], urlKey = null } = {}) {
  const realProjectTrees = projectTrees.filter(tree => tree.project?.id !== PERIODICALS_PROJECT_ID);

  // In-progress issues also appear in project trees; the first sighting wins.
  const cards = [
    ...flattenTrees(inProgressTrees, 'in-progress'),
    ...flattenTrees(realProjectTrees, 'project'),
    ...flattenTrees(recentActivityTrees, 'recent-activity')
  ];
  const seen = new Set();
  const allIssues = cards.filter(card => {
    const key = cardKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  linkParents(allIssues);

  // LIN-391: graph features (sort keys) BEFORE the sort, so the deck order
  // matches the /stack digest order — both surfaces share this pipeline.
  computeGraphFeatures(allIssues);
  sortIssuesForSwipe(allIssues);
  const sortedIssues = clusterByParent(applyBlockingOrder(allIssues));

  // LIN-2944 P3 (addendum 18): starter-seed cards are onboarding scaffolding, not
  // real work. Each is marked `isSeed` and moved AFTER every real card (relative
  // order kept) — still in the deck, never the front card as if real. When every
  // card is a seed the caller reads `isSeed` to show the onboarding state.
  const seedIds = urlKey ? starterSeedIssueIds(urlKey) : null;
  for (const card of sortedIssues) {
    card.isSeed = !!(seedIds && seedIds.has(card.id));
  }
  const orderedIssues = seedIds
    ? [...sortedIssues.filter(card => !card.isSeed), ...sortedIssues.filter(card => card.isSeed)]
    : sortedIssues;

  // LIN-2944: each card's one-line ranking reason, the digest the agent stack
  // uses (LIN-391). Swipe shows every card, so no blocker can be off-page; an
  // empty array means the order had nothing to advertise.
  for (const card of orderedIssues) {
    card.why = buildWhy(card);
  }
  return orderedIssues;
}

// =============================================================================
// Swim and Ship boards
// =============================================================================

/**
 * The Swim board's ordered issue list (dedupe by raw id, in-progress first). Ranked and blocker-ordered; not clustered, because Swim does its own
 * lane assignment.
 *
 * @param {Object} trees
 * @param {Array} trees.projectTrees - Project trees
 * @param {Array} trees.inProgressTrees - In-progress trees
 * @param {Array} trees.recentActivityTrees - Recent activity trees
 * @returns {Array} The sorted, blocker-ordered issues
 */
/**
 * LIN-3833: Home's In Progress order. A flat list of the roots across every project, ranked by the
 * row states (`buildRowStates` in task-page-loader.js): tasks that need you (or have a subtask that
 * does), then tasks ready for a next step, then running tasks, then the rest. Project order is the
 * tie-break, so an order with no state information (a copy-first viewer) keeps the project order.
 * Sorting is stable; `orderIssuesForSwipe` is untouched.
 *
 * @param {Array<{projectName: string, roots: Array<Object>}>} inProgressTrees
 * @param {Map<string, {rank: number}>} rowStates - keyed by issue identifier
 * @returns {Array<{projectName: string, node: Object}>}
 */
export function orderInProgress(inProgressTrees, rowStates) {
  const rankOf = (node) => rowStates?.get(node.issue.identifier)?.rank ?? 3;
  return (inProgressTrees || [])
    .flatMap(({ projectName, roots }) => roots.map((node) => ({ projectName, node })))
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => (rankOf(a.node) - rankOf(b.node)) || (a.index - b.index))
    .map(({ projectName, node }) => ({ projectName, node }));
}

/**
 * LIN-3833: the count line under In Progress's heading, for example "3 in progress · 1 needs you ·
 * 2 running". Counts the top-level rows; zero parts are left out, and no tasks means no line.
 *
 * @param {Array<{projectName: string, roots: Array<Object>}>} inProgressTrees
 * @param {Map<string, {needsYou: boolean, running: boolean}>} rowStates
 * @returns {string|null}
 */
export function buildInProgressCountLine(inProgressTrees, rowStates) {
  const roots = (inProgressTrees || []).flatMap(({ roots: r }) => r);
  if (roots.length === 0) return null;
  const states = roots.map((node) => rowStates?.get(node.issue.identifier) || {});
  const needsYou = states.filter((s) => s.needsYou).length;
  const running = states.filter((s) => s.running).length;
  const parts = [`${roots.length} in progress`];
  if (needsYou) parts.push(`${needsYou} needs you`);
  if (running) parts.push(`${running} running`);
  return parts.join(' · ');
}

export function orderIssuesForSwim({ projectTrees, inProgressTrees, recentActivityTrees }) {
  // Flatten all issues for client-side use (reuse swipe helpers)
  const projectIssues = flattenTrees(projectTrees, 'project');
  const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
  const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

  // Deduplicate by id
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

  // Build parent/subtask relationships
  const cardById = new Map(allIssues.map(i => [i.id, i]));
  for (const issue of allIssues) {
    if (issue.parentId && cardById.has(issue.parentId)) {
      const parent = cardById.get(issue.parentId);
      issue.parentInfo = {
        id: parent.id,
        identifier: parent.identifier,
        title: parent.title,
        stateType: parent.stateType
      };
    }
  }

  // Sort (but don't cluster — swim does its own lane assignment)
  sortIssuesForSwipe(allIssues);
  const sortedIssues = applyBlockingOrder(allIssues);
  return sortedIssues;
}

/**
 * The Ship board's flat issue list (dedupe by raw `issue.id`, in-progress first).
 * Unranked: the client decides placement.
 *
 * @param {Object} trees
 * @param {Array} trees.projectTrees - Project trees
 * @param {Array} trees.inProgressTrees - In-progress trees
 * @param {Array} trees.recentActivityTrees - Recent activity trees
 * @returns {Array} The flattened, de-duplicated issues
 */
export function flattenIssuesForShip({ projectTrees, inProgressTrees, recentActivityTrees }) {
  // Flatten everything we know about; the client decides what goes where.
  const projectIssues = flattenTrees(projectTrees, 'project');
  const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
  const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

  const seen = new Set();
  const allIssues = [];
  for (const issue of inProgressIssues) {
    if (!seen.has(issue.id)) { seen.add(issue.id); allIssues.push(issue); }
  }
  for (const issue of projectIssues) {
    if (!seen.has(issue.id)) { seen.add(issue.id); allIssues.push(issue); }
  }
  for (const issue of recentIssues) {
    if (!seen.has(issue.id)) { seen.add(issue.id); allIssues.push(issue); }
  }

  return allIssues;
}
