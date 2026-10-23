/**
 * Task ordering
 *
 * The order of work, shared by swipe, swim, `/stack` (and `get_stack`) and the
 * roadmap: trees → cards, rank (bug boost, unblock promotion, graph reach),
 * blocker-first order, parent clustering, and the `why[]` explanation. Its
 * inputs are tracker fields and the blocking graph; it uses no runs, dispatch
 * or model data. Moved out of render-swipe.js (LIN-3554) so a page is not the
 * owner of a rule every consumer inherits.
 *
 * Pipeline layers, in the order a card meets them:
 *   flatten trees → card   (flattenTrees)
 *   rank                   (sortIssuesForSwipe)
 *   dependency order       (applyBlockingOrder, then clusterByParent)
 *   explain                (buildWhy)
 *
 * Embedded JSON is compared byte-for-byte, so the key order of cards is part
 * of the contract — see the note beside issueToCard.
 */

// The blocking-graph primitives live in the network-free graph-features module
// (LIN-433) so selectFocusSubtask can use them without importing a renderer.
import { buildBlockingGraph } from './graph-features.js';
import { getStateOrder, isTerminalState } from './providers/state-map.js';
import { issueSource, STARTED, UNSTARTED } from './providers/models.js';

// Pipeline identity is `key || id`: a caller may qualify the raw id with
// `card.key` (and a parent with `card.parentKey`); otherwise the id is the key.
export const keyOf = (card) => card.key || card.id;

// =============================================================================
// Trees → cards
// =============================================================================

/**
 * Map an issue tree node to a flat card-data object. The key order here opens
 * every card's key order in `__SWIPE_DATA__`.
 */
function issueToCard(issue, projectName, section) {
  return {
    id: issue.id,
    identifier: issue.identifier || '',
    title: issue.title,
    description: issue.description || '',
    priority: issue.priority || 0,
    url: issue.url || '',
    stateType: issue.state?.type || 'unstarted',
    stateName: issue.state?.name || '',
    assignee: issue.assignee?.name || null,
    labels: (issue.labels?.nodes || []).map(l => l.name),
    projectName,
    completedAt: issue.completedAt || null,
    dueDate: issue.dueDate || null,
    section,
    source: issueSource(issue),
    blocksIds: (issue.relations?.nodes || [])
      .filter(r => r.type === 'blocks')
      .map(r => r.relatedIssue?.id)
      .filter(Boolean),
    parentId: issue.parent?.id || null
  };
}

/** Cards for a node and its whole subtree. */
function subtreeCards(node, projectName, section) {
  return [
    issueToCard(node.issue, projectName, section),
    ...(node.children || []).flatMap(child => subtreeCards(child, projectName, section))
  ];
}

/** Cards for the in-progress nodes below `node` (the node itself excluded). */
function inProgressDescendantCards(node, projectName) {
  return (node.children || []).flatMap(child => [
    ...(child.isInProgress ? [issueToCard(child.issue, projectName, 'in-progress')] : []),
    ...inProgressDescendantCards(child, projectName)
  ]);
}

/**
 * Flatten tree nodes into a flat card array, preserving project info.
 * @param {Array} trees - Project trees, in-progress trees or recent-activity trees
 * @param {string} type - 'project' | 'in-progress' | 'recent-activity'
 * @returns {Array} Flat array of card-data objects (empty for an unknown type)
 */
export function flattenTrees(trees, type) {
  if (type === 'project') {
    return trees.flatMap(({ project, incomplete }) =>
      incomplete.flatMap(node => subtreeCards(node, project.name, type)));
  }

  if (type === 'in-progress') {
    // An in-progress root brings its whole subtree; otherwise only the
    // in-progress descendants below it are picked up.
    return trees.flatMap(({ projectName, roots }) => roots.flatMap(node => (
      node.isInProgress
        ? subtreeCards(node, projectName, type)
        : inProgressDescendantCards(node, projectName)
    )));
  }

  if (type === 'recent-activity') {
    return trees.flatMap(({ roots, projectName }) => roots.map(node => {
      const card = issueToCard(node.issue, node.projectName || projectName || '', type);
      // The row's activity kind/timestamp (LIN-490), so the card shows the right
      // activity (created/edited/completed), not just completedAt.
      card.activityKind = node.activityKind || null;
      card.activityAt = node.activityAt || null;
      return card;
    }));
  }

  return [];
}

// =============================================================================
// Ranking
// =============================================================================

/**
 * Does a card earn the front-of-queue bug boost? (LIN-1253)
 *
 * The `bug` label alone is not enough: a backlog-parked or low/no-priority bug is
 * not "actionable now" work, so jumping it ahead of started/high-priority items on
 * the label alone is noise. Boostable = a real bug that is neither in the backlog
 * state nor at Low(4)/None(0) priority — i.e. Urgent/High/Medium and out of backlog.
 * A non-boostable bug is NOT demoted; it simply falls through to normal
 * state/priority ordering. Shared by the sort and the `buildWhy` digest so the
 * "bug" ranking reason is only advertised when it actually influenced the order.
 *
 * @param {Object} card - Card-data object (labels, stateType, priority)
 * @returns {boolean}
 */
export function isBoostableBug(card) {
  const hasBug = (card.labels || []).some(l => l.toLowerCase() === 'bug');
  const priority = card.priority || 0; // 1 Urgent .. 4 Low, 0 = None
  return hasBug && card.stateType !== 'backlog' && priority >= 1 && priority <= 3;
}

// LIN-1872: an unstarted issue whose downstream reach meets or exceeds this
// floor sorts AS IF it were started. Named after the ticket's own example floor,
// not tuned: >= 2 successors is a real throughput multiplier, while freeing a
// single downstream task is close enough to noise that promoting every reach-1
// issue would swamp genuinely in-flight work with context-switches. The measured
// incident (LIN-1871, downstreamUnblocks: 4) clears it comfortably.
const UNBLOCK_PROMOTION_THRESHOLD = 2;

/**
 * The state rank the sort uses: `getStateOrder(card.stateType)`, except that an
 * unstarted issue clearing UNBLOCK_PROMOTION_THRESHOLD ranks as `started`
 * (LIN-1872). A sort-key fiction only: `stateType`/`stateName` are not rewritten.
 *
 * Why a floor rather than ranking reach above state outright: state is the
 * stronger discriminator in practice (far more in-progress items exist than
 * high-reach ones), so an unconditional promotion would let any unstarted issue
 * with one blocking edge outrank every in-progress item with none, trading a
 * WIP-accumulation bias for a context-switching one. Backlog issues are
 * deliberately not eligible: promotion is scoped to `unstarted` only.
 */
function effectiveStateOrder(card) {
  const promoted = card.stateType === UNSTARTED
    && (card.downstreamUnblocks || 0) >= UNBLOCK_PROMOTION_THRESHOLD;
  return getStateOrder(promoted ? STARTED : card.stateType) ?? 1;
}

/**
 * Sort keys, most significant first; smaller sorts earlier.
 *
 *  1. terminal states last
 *  2. boostable bugs first (LIN-1253)
 *  3. state, with the LIN-1872 promotion
 *  4-5. transitive graph features (LIN-391): unblocking many successors is a
 *     throughput multiplier and critical-path-first minimises makespan, so both
 *     outrank the purely-local priority. Absent features count as 0 so callers
 *     that skip computeGraphFeatures still sort deterministically. They rank
 *     below the promotion-adjusted state, so a promoted unstarted issue and a
 *     real started one still tiebreak on reach.
 *  6. priority, with "none" (0) ranked after Low
 */
function sortKeys(card) {
  return [
    isTerminalState(card.stateType) ? 1 : 0,
    isBoostableBug(card) ? 0 : 1,
    effectiveStateOrder(card),
    -(card.downstreamUnblocks || 0),
    -(card.criticalPathLen || 0),
    card.priority || 5
  ];
}

/**
 * Sort issues by priority for the swipe view.
 *
 * @param {Array} issues - Flat array of card-data objects (sorted IN PLACE;
 *   callers such as task-stack.js, roadmap.js and render-swim.js rely on that
 *   and ignore the return value)
 * @returns {Array} The same array, sorted
 */
export function sortIssuesForSwipe(issues) {
  return issues.sort((a, b) => {
    const keysA = sortKeys(a);
    const keysB = sortKeys(b);
    const at = keysA.findIndex((key, i) => key !== keysB[i]);
    return at === -1 ? 0 : keysA[at] - keysB[at];
  });
}

// =============================================================================
// Dependency order, clustering, explanation
// =============================================================================

/**
 * Build the compact `why[]` explainability array for a digest line (LIN-391).
 * Reasons appear in a stable order; each is a short scalar string, never a body.
 * "bug" is advertised only when the bug actually earned the boost (LIN-1253),
 * so the line never misexplains the order.
 *
 * @param {Object} issue - Card-data object carrying computed features
 * @param {string[]} [heldByIds] - Off-page blocker identifiers (from computeOffPageBlockers)
 * @returns {string[]} e.g. ["bug", "unblocks 6", "critical path 4", "held by LIN-412"]
 */
export function buildWhy(issue, heldByIds = []) {
  return [
    isBoostableBug(issue) && 'bug',
    (issue.downstreamUnblocks || 0) > 0 && `unblocks ${issue.downstreamUnblocks}`,
    (issue.criticalPathLen || 0) > 1 && `critical path ${issue.criticalPathLen}`,
    heldByIds.length > 0 && heldByReason(heldByIds)
  ].filter(Boolean);
}

// "held by LIN-412", or "held by LIN-412 +2" when more than one blocker is off-page.
function heldByReason([first, ...rest]) {
  return rest.length > 0 ? `held by ${first} +${rest.length}` : `held by ${first}`;
}

/**
 * Reorder issues so that blocking issues appear before the issues they block.
 * Kahn's algorithm with the existing sort position as the stable tiebreaker,
 * over the shared edge set (in-set edges, terminal-state blockers skipped — see
 * buildBlockingGraph). Cycles are handled by appending whatever was not placed,
 * in original order.
 *
 * @param {Array} issues - Sorted flat array of card-data objects
 * @returns {Array} New array with blocking-aware ordering
 */
export function applyBlockingOrder(issues) {
  const positionOf = new Map(issues.map((card, i) => [keyOf(card), i]));
  const cardOf = new Map(issues.map(card => [keyOf(card), card]));
  const { adj, inDegree } = buildBlockingGraph(issues);

  // `ready` is kept ordered by original position, so ties resolve to sort order.
  const ready = issues.map(keyOf).filter(key => inDegree.get(key) === 0);
  const result = [];

  while (ready.length > 0) {
    const key = ready.shift();
    result.push(cardOf.get(key));
    for (const blockedKey of adj.get(key)) {
      inDegree.set(blockedKey, inDegree.get(blockedKey) - 1);
      if (inDegree.get(blockedKey) !== 0) continue;
      const insertAt = ready.findIndex(k => positionOf.get(k) > positionOf.get(blockedKey));
      ready.splice(insertAt === -1 ? ready.length : insertAt, 0, blockedKey);
    }
  }

  // Cycle fallback. Placement is tracked by raw `id` (not the pipeline key),
  // exactly as before the rebuild.
  if (result.length < issues.length) {
    const placed = new Set(result.map(card => card.id));
    result.push(...issues.filter(card => !placed.has(card.id)));
  }
  return result;
}

/**
 * Cluster parent issues with their subtasks so they appear together.
 * Within a cluster subtasks come before the parent (unblocking order). A cluster
 * sits where its earliest member appears in the input, so the priority/blocking
 * sort stays the anchor.
 *
 * @param {Array} issues - Sorted flat array of card-data objects
 * @returns {Array} The input itself when no card has a parent link; otherwise a
 *   new array with parent-subtask clusters
 */
export function clusterByParent(issues) {
  const parentOf = new Map();
  const childrenOf = new Map();
  for (const card of issues) {
    if (!card.parentId) continue;
    const parentKey = card.parentKey || card.parentId;
    parentOf.set(keyOf(card), parentKey);
    childrenOf.set(parentKey, [...(childrenOf.get(parentKey) || []), keyOf(card)]);
  }
  if (parentOf.size === 0) return issues;

  const cardOf = new Map(issues.map(card => [keyOf(card), card]));
  const placed = new Set();
  const result = [];

  // Topmost ancestor present in the set. The visited guard stops malformed
  // parent cycles.
  const familyRoot = (startKey) => {
    const visited = new Set();
    let key = startKey;
    while (parentOf.has(key) && cardOf.has(parentOf.get(key))) {
      visited.add(key);
      key = parentOf.get(key);
      if (visited.has(key)) break;
    }
    return key;
  };

  // Depth-first, subtasks before parent; `visiting` guards parent cycles too.
  const collectFamily = (key, cluster, visiting) => {
    if (!cardOf.has(key) || placed.has(key) || visiting.has(key)) return;
    visiting.add(key);
    for (const childKey of childrenOf.get(key) || []) collectFamily(childKey, cluster, visiting);
    cluster.push(cardOf.get(key));
  };

  for (const card of issues) {
    const key = keyOf(card);
    if (placed.has(key)) continue;

    const rootKey = familyRoot(key);
    // A card with no family in this set is emitted as-is.
    const cluster = [];
    if (rootKey === key && !childrenOf.has(key)) cluster.push(card);
    else collectFamily(rootKey, cluster, new Set());

    for (const member of cluster) {
      placed.add(keyOf(member));
      result.push(member);
    }
  }
  return result;
}
