/**
 * Swipe Page Renderer
 *
 * Generates HTML for the mobile-first task swipe page.
 * Embeds issue data as JSON for client-side card rendering.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';
import { getPromptLabels, getPromptDisplayName } from './prompt-templates.js';
import { isTerminalState, nodeKey } from './tree.js';
// buildBlockingGraph/computeGraphFeatures relocated to the shared, network-free
// graph-features module (LIN-433) so selectFocusSubtask can consume them without
// importing a renderer. Re-exported below to preserve this module's public surface
// (computeGraphFeatures is imported from here by tests + pipeline callers).
import { buildBlockingGraph, computeGraphFeatures } from './graph-features.js';
export { computeGraphFeatures };
import { getStateOrder } from './providers/state-map.js';
import { renderEmptyState } from './components/empty-state.js';
import { starterSeedIssueIds } from '../routes/workspace.js';
import { getProviderForWorkspace } from './providers/registry.js';
import { issueSource, STARTED, UNSTARTED } from './providers/models.js';

// Default prompts shown for every actionable issue
const DEFAULT_PROMPT_KEYS = ['look-into', 'research', 'plan', 'implementation'];

// All additional prompt keys behind "more"
const MORE_PROMPT_KEYS = getPromptLabels().filter(k => !new Set(DEFAULT_PROMPT_KEYS).has(k));

/**
 * Build prompt metadata for client-side rendering
 * @returns {Object} Prompt key → display name mapping
 */
function buildPromptMeta() {
  const meta = {};
  for (const key of [...DEFAULT_PROMPT_KEYS, ...MORE_PROMPT_KEYS]) {
    meta[key] = getPromptDisplayName(key);
  }
  return meta;
}

/**
 * Map an issue tree node to a flat card-data object.
 * @param {Object} issue - Issue from tree node
 * @param {string} projectName - Project name for display
 * @param {string} section - Section type ('project' | 'in-progress' | 'recent-activity')
 * @returns {Object} Flat issue object for client-side rendering
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
    // LIN-3240: carry the row's binding stamp so the swipe client can forward
    // `bindingScope` beside `source`. SPARSE — added only when stamped, so the
    // embedded JSON (and every single-binding/legacy card) is byte-identical.
    ...(typeof issue.bindingScope === 'string' && issue.bindingScope
      ? { bindingScope: issue.bindingScope }
      : {}),
    blocksIds: (issue.relations?.nodes || [])
      .filter(r => r.type === 'blocks')
      .map(r => r.relatedIssue?.id)
      .filter(Boolean),
    parentId: issue.parent?.id || null
  };
}

/**
 * Flatten tree nodes into a flat issue array, preserving project info.
 * @param {Array} trees - Project trees or in-progress trees
 * @param {string} type - 'project' | 'in-progress' | 'recent-activity'
 * @returns {Array} Flat array of card-data objects
 */
export function flattenTrees(trees, type) {
  const items = [];

  function walkAll(node, projectName) {
    items.push(issueToCard(node.issue, projectName, type));
    for (const child of node.children || []) {
      walkAll(child, projectName);
    }
  }

  function walkInProgress(node, projectName) {
    if (node.isInProgress) {
      items.push(issueToCard(node.issue, projectName, 'in-progress'));
    }
    for (const child of node.children || []) {
      walkInProgress(child, projectName);
    }
  }

  if (type === 'project') {
    for (const { project, incomplete } of trees) {
      for (const node of incomplete) {
        walkAll(node, project.name);
      }
    }
  } else if (type === 'in-progress') {
    for (const { projectName, roots } of trees) {
      for (const node of roots) {
        if (node.isInProgress) {
          walkAll(node, projectName);
        } else {
          for (const child of node.children || []) {
            walkInProgress(child, projectName);
          }
        }
      }
    }
  } else if (type === 'recent-activity') {
    for (const { roots, projectName } of trees) {
      for (const node of roots) {
        const card = issueToCard(node.issue, node.projectName || projectName || '', 'recent-activity');
        // Carry the row's activity kind/timestamp (LIN-490) so the card shows the
        // right activity (created/edited/completed), not just completedAt.
        card.activityKind = node.activityKind || null;
        card.activityAt = node.activityAt || null;
        items.push(card);
      }
    }
  }

  return items;
}

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
// floor sorts AS IF it were started — see `effectiveStateOrder` below for the
// full rationale. Named after the ticket's own example floor, not tuned
// separately: >= 2 successors is a real throughput multiplier (freeing a
// single downstream task is close enough to noise that treating every
// reach-1 unstarted issue as "started" would swamp genuinely in-flight work
// with context-switches), while the measured incident case (LIN-1871,
// downstreamUnblocks: 4) clears it comfortably.
const UNBLOCK_PROMOTION_THRESHOLD = 2;

/**
 * The state rank `sortIssuesForSwipe` actually sorts by — usually just
 * `getStateOrder(card.stateType)`, EXCEPT an unstarted issue whose
 * `downstreamUnblocks` clears {@link UNBLOCK_PROMOTION_THRESHOLD}, which sorts
 * at the `started` rank instead (LIN-1872). `card.stateType`/`stateName` are
 * NOT rewritten — this promotion is a sort-key fiction only; the card still
 * displays and reports its real state everywhere else.
 *
 * Why a threshold rather than moving `downstreamUnblocks` above state
 * outright (LIN-1872 Option 1): the LIN-391 comment below already lifted
 * graph reach above the purely-local `priority`, but never reconsidered it
 * against `state` — and state is the stronger discriminator in practice
 * (far more in-progress items exist than high-reach ones), so an unconditional
 * promotion would let ANY unstarted issue with so much as one blocking edge
 * outrank EVERY in-progress item with none, trading a WIP-accumulation bias
 * for a context-switching one. A floor bounds the blast radius to genuinely
 * high-value unblockers — exactly the shape of the incident that raised this
 * (an unstarted blocker with real, multi-task reach silently sinking below
 * ~34 in-progress items that block nothing) — without displacing in-flight
 * work for marginal reach. Backlog issues are deliberately NOT eligible: the
 * measured case and the ticket's own Option 2 wording both scope promotion to
 * `unstarted` only.
 *
 * @param {Object} card - Card-data object (stateType, downstreamUnblocks)
 * @returns {number}
 */
function effectiveStateOrder(card) {
  const promoted = card.stateType === UNSTARTED
    && (card.downstreamUnblocks || 0) >= UNBLOCK_PROMOTION_THRESHOLD;
  return getStateOrder(promoted ? STARTED : card.stateType) ?? 1;
}

/**
 * Sort issues by priority for the swipe view.
 * Order: terminal states (completed/canceled/duplicate) last, boostable bugs first,
 * then by state (an unstarted high-reach blocker sorts as if started — LIN-1872,
 * see effectiveStateOrder), then by priority. (LIN-1253: backlog / low-priority
 * bugs are no longer boosted — see isBoostableBug.)
 *
 * @param {Array} issues - Flat array of card-data objects (mutated in place)
 * @returns {Array} The same array, sorted
 */
export function sortIssuesForSwipe(issues) {
  issues.sort((a, b) => {
    const aCompleted = isTerminalState(a.stateType);
    const bCompleted = isTerminalState(b.stateType);
    if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;

    const aBug = isBoostableBug(a) ? 0 : 1;
    const bBug = isBoostableBug(b) ? 0 : 1;
    if (aBug !== bBug) return aBug - bBug;

    const aState = effectiveStateOrder(a);
    const bState = effectiveStateOrder(b);
    if (aState !== bState) return aState - bState;

    // Transitive graph features as tiebreakers (LIN-391): unblocking many
    // successors is a throughput multiplier and critical-path-first minimizes
    // makespan, so both outrank the purely-local `priority`. Defaulted to 0 so
    // callers that skip computeGraphFeatures still sort deterministically.
    // (Below the promotion-adjusted state comparison above — a promoted
    // unstarted issue and a real started issue still tiebreak on reach.)
    const aUnblock = a.downstreamUnblocks || 0;
    const bUnblock = b.downstreamUnblocks || 0;
    if (aUnblock !== bUnblock) return bUnblock - aUnblock;

    const aCrit = a.criticalPathLen || 0;
    const bCrit = b.criticalPathLen || 0;
    if (aCrit !== bCrit) return bCrit - aCrit;

    return (a.priority || 5) - (b.priority || 5);
  });
  return issues;
}

/**
 * Identify, for each visible (within-limit) issue, the direct blockers that were
 * pushed beyond the limit slice — so a digest line can explain a position forced
 * by an off-page blocker (LIN-391, "heldBy").
 *
 * Only DIRECT predecessors are reported (the immediately actionable blocker); no
 * transitive closure is stored. In a pure topological slice a blocker always
 * precedes its blocked node, so this is normally empty — the realistic trigger is
 * clusterByParent (or the cycle fallback) pulling a blocked family member ahead
 * of an off-page blocker.
 *
 * @param {Array} sortedIssues - The fully ordered (post-cluster) issue array
 * @param {number} limit - The slice size; positions >= limit are off-page
 * @returns {Map<string, string[]>} issue id → off-page blocker identifiers
 */
export function computeOffPageBlockers(sortedIssues, limit) {
  const { reverseAdj } = buildBlockingGraph(sortedIssues);
  const keyOf = (issue) => issue.key || issue.id;
  const positionOf = new Map(sortedIssues.map((issue, i) => [keyOf(issue), i]));
  const idToIdentifier = new Map(sortedIssues.map(i => [keyOf(i), i.identifier]));
  const heldBy = new Map();
  for (let i = 0; i < sortedIssues.length && i < limit; i++) {
    const issue = sortedIssues[i];
    const offPage = (reverseAdj.get(keyOf(issue)) || [])
      .filter(blockerId => (positionOf.get(blockerId) ?? -1) >= limit)
      .map(blockerId => idToIdentifier.get(blockerId))
      .filter(Boolean);
    if (offPage.length > 0) heldBy.set(keyOf(issue), offPage);
  }
  return heldBy;
}

/**
 * Build the compact `why[]` explainability array for a digest line (LIN-391).
 * Reasons appear in a stable order; each is a short scalar string, never a body.
 *
 * @param {Object} issue - Card-data object carrying computed features
 * @param {string[]} [heldByIds] - Off-page blocker identifiers (from computeOffPageBlockers)
 * @returns {string[]} e.g. ["bug", "unblocks 6", "critical path 4", "held by LIN-412"]
 */
export function buildWhy(issue, heldByIds = []) {
  const why = [];
  // Only advertise "bug" when the bug actually earned the boost (LIN-1253) — a
  // backlog/low-priority bug no longer jumps the queue, so claiming it as a
  // ranking reason would misexplain the order (LIN-391 "explainable, not opaque").
  if (isBoostableBug(issue)) why.push('bug');
  if ((issue.downstreamUnblocks || 0) > 0) why.push(`unblocks ${issue.downstreamUnblocks}`);
  if ((issue.criticalPathLen || 0) > 1) why.push(`critical path ${issue.criticalPathLen}`);
  if (heldByIds.length > 0) {
    const [first, ...rest] = heldByIds;
    why.push(rest.length > 0 ? `held by ${first} +${rest.length}` : `held by ${first}`);
  }
  return why;
}

/**
 * Reorder issues so that blocking issues appear before the issues they block.
 * Uses Kahn's algorithm for topological sort with the existing sort position
 * as a stable tiebreaker. Only considers edges from non-completed blockers.
 * Handles cycles gracefully by appending remaining issues in original order.
 *
 * @param {Array} issues - Sorted flat array of card-data objects
 * @returns {Array} New array with blocking-aware ordering
 */
export function applyBlockingOrder(issues) {
  // LIN-3240: pipeline identity is `key || id` (see the card.key stamp in
  // renderSwipePage); byte-identical for unstamped cards.
  const idToIndex = new Map(issues.map((issue, i) => [issue.key || issue.id, i]));
  const issueById = new Map(issues.map(issue => [issue.key || issue.id, issue]));

  // Build adjacency list and in-degree count from the shared edge set
  // (in-set edges only, terminal-state blockers skipped). See buildBlockingGraph.
  const { adj, inDegree } = buildBlockingGraph(issues);

  // Kahn's algorithm: start with all zero-in-degree nodes, ordered by original position
  const queue = issues
    .filter(issue => inDegree.get(issue.key || issue.id) === 0)
    .map(issue => issue.key || issue.id);

  const result = [];

  while (queue.length > 0) {
    const id = queue.shift();
    result.push(issueById.get(id));

    for (const blockedId of adj.get(id)) {
      const newDegree = inDegree.get(blockedId) - 1;
      inDegree.set(blockedId, newDegree);
      if (newDegree === 0) {
        // Insert maintaining original sort position for stability
        const blockedIdx = idToIndex.get(blockedId);
        const insertPos = queue.findIndex(qId => idToIndex.get(qId) > blockedIdx);
        if (insertPos === -1) {
          queue.push(blockedId);
        } else {
          queue.splice(insertPos, 0, blockedId);
        }
      }
    }
  }

  // Cycle fallback: append any remaining issues in original order
  if (result.length < issues.length) {
    const placed = new Set(result.map(i => i.id));
    for (const issue of issues) {
      if (!placed.has(issue.id)) {
        result.push(issue);
      }
    }
  }

  return result;
}

/**
 * Cluster parent issues with their subtasks so they appear together.
 * Within each cluster, subtasks appear before the parent (unblocking order).
 * The cluster is positioned where its earliest member appears in the input,
 * preserving the priority/blocking sort as the anchor.
 *
 * @param {Array} issues - Sorted flat array of card-data objects
 * @returns {Array} New array with parent-subtask clusters
 */
export function clusterByParent(issues) {
  // Build parent→children map from the issues in this set
  const childrenOf = new Map();
  const parentOf = new Map();
  for (const issue of issues) {
    if (issue.parentId) {
      const id = issue.key || issue.id;
      const parentKey = issue.parentKey || issue.parentId;
      parentOf.set(id, parentKey);
      if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
      childrenOf.get(parentKey).push(id);
    }
  }

  // Nothing to cluster
  if (parentOf.size === 0) return issues;

  const issueById = new Map(issues.map(i => [i.key || i.id, i]));
  const placed = new Set();
  const result = [];

  // Collect a family tree depth-first, subtasks before parent (unblocking order).
  // visiting set guards against cycles in malformed parent data.
  function collectFamily(nodeId, cluster, visiting) {
    if (!issueById.has(nodeId) || placed.has(nodeId) || visiting.has(nodeId)) return;
    visiting.add(nodeId);
    for (const childId of childrenOf.get(nodeId) || []) {
      collectFamily(childId, cluster, visiting);
    }
    cluster.push(issueById.get(nodeId));
  }

  for (const issue of issues) {
    if (placed.has(issue.key || issue.id)) continue;

    // Find the root of this issue's family (walk up parent chain)
    // Guard against cycles in malformed data
    let rootId = issue.key || issue.id;
    const visited = new Set();
    while (parentOf.has(rootId) && issueById.has(parentOf.get(rootId))) {
      visited.add(rootId);
      rootId = parentOf.get(rootId);
      if (visited.has(rootId)) break;
    }

    // If this issue is not part of any parent-child relationship in the set, emit as-is
    if (rootId === (issue.key || issue.id) && !childrenOf.has(issue.key || issue.id)) {
      placed.add(issue.key || issue.id);
      result.push(issue);
      continue;
    }

    const cluster = [];
    collectFamily(rootId, cluster, new Set());

    for (const item of cluster) {
      placed.add(item.key || item.id);
      result.push(item);
    }
  }

  return result;
}

/**
 * Build filter groups from the flattened issue list.
 * @param {Array} allIssues - All deduplicated issues
 * @returns {Array<{key: string, label: string, count: number}>} Filter groups
 */
export function buildFilterGroups(allIssues) {
  const groups = [];

  // All issues (default)
  groups.push({ key: 'all', label: 'All', count: allIssues.length });

  // In Progress
  const inProgressIds = allIssues
    .filter(i => i.stateType === 'started')
    .map(i => i.id);
  if (inProgressIds.length > 0) {
    groups.push({ key: 'in-progress', label: 'In Progress', count: inProgressIds.length });
  }

  // Recent Activity
  const recentIds = allIssues
    .filter(i => i.section === 'recent-activity')
    .map(i => i.id);
  if (recentIds.length > 0) {
    groups.push({ key: 'recent-activity', label: 'Recent activity', count: recentIds.length });
  }

  // Per project
  const projectNames = [...new Set(allIssues.map(i => i.projectName).filter(Boolean))];
  for (const name of projectNames) {
    const count = allIssues.filter(i => i.projectName === name).length;
    if (count > 0) {
      groups.push({ key: `project:${name}`, label: name, count });
    }
  }

  // Per label (only labels in use, sorted by count desc then name asc)
  const labelCounts = new Map();
  for (const issue of allIssues) {
    const seen = new Set();
    for (const name of issue.labels || []) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      labelCounts.set(name, (labelCounts.get(name) || 0) + 1);
    }
  }
  const labelEntries = [...labelCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  for (const [name, count] of labelEntries) {
    groups.push({ key: `label:${name}`, label: name, count });
  }

  return groups;
}

/**
 * Order the flat task set exactly as the Swipe deck does (LIN-2944 P1).
 *
 * One helper, two consumers: `renderSwipePage` (the deck) and Home's top-task
 * mark. It reproduces the deck's ordering verbatim — flatten in-progress →
 * project → recent and dedup, build parent/subtask links, then
 * `computeGraphFeatures` → `sortIssuesForSwipe` → `applyBlockingOrder` →
 * `clusterByParent`, and stamp each card's `why` explainability array — so the
 * two surfaces cannot drift. It is pure and synchronous: it ranks data already
 * fetched, adds no provider call, and does not alter `sortIssuesForSwipe`,
 * `task-stack.js` or the seed. The first element is the deck's front card.
 *
 * @param {Object} data
 * @param {Array} [data.projectTrees] - Project trees from fetchAndPrepareProjects
 * @param {Array} [data.inProgressTrees] - In-progress trees
 * @param {Array} [data.recentActivityTrees] - Recent activity trees
 * @returns {Array} Ordered card objects (mutated with graph features,
 *   parent/subtask info and `why`)
 */
export function orderIssuesForSwipe({ projectTrees = [], inProgressTrees = [], recentActivityTrees = [], urlKey = null } = {}) {
  // Flatten all issues for client-side use
  const projectIssues = flattenTrees(projectTrees, 'project');
  const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
  const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

  // LIN-3240: de-duplicate on the SAME binding-aware key the merged tree uses
  // (`source[@bindingScope]:id`), not the raw id. Two same-number issues from two
  // bindings (repoA#1, repoB#1) are distinct cards; an unstamped card keys
  // `source:id` exactly as before, so single-binding/legacy output is unchanged.
  const cardKey = (card) => nodeKey({ id: card.id, source: card.source, bindingScope: card.bindingScope });

  // Deduplicate by binding-aware id (in-progress issues also appear in project trees)
  const seenIds = new Set();
  const allIssues = [];
  // Add in-progress first, then project, then recent issues.
  for (const issue of inProgressIssues) {
    const key = cardKey(issue);
    if (!seenIds.has(key)) {
      seenIds.add(key);
      allIssues.push(issue);
    }
  }
  for (const issue of projectIssues) {
    const key = cardKey(issue);
    if (!seenIds.has(key)) {
      seenIds.add(key);
      allIssues.push(issue);
    }
  }
  for (const issue of recentIssues) {
    const key = cardKey(issue);
    if (!seenIds.has(key)) {
      seenIds.add(key);
      allIssues.push(issue);
    }
  }

  // Build parent/subtask relationships from flattened issues (binding-aware, so a
  // same-number parent in another binding never adopts this card).
  const cardById = new Map(allIssues.map(i => [cardKey(i), i]));
  const subtaskMap = new Map();
  for (const issue of allIssues) {
    const parentKey = issue.parentId ? cardKey({ id: issue.parentId, source: issue.source, bindingScope: issue.bindingScope }) : null;
    if (parentKey && cardById.has(parentKey)) {
      const parent = cardById.get(parentKey);
      issue.parentInfo = {
        id: parent.id,
        identifier: parent.identifier,
        title: parent.title,
        stateType: parent.stateType
      };
      if (!subtaskMap.has(parentKey)) subtaskMap.set(parentKey, []);
      subtaskMap.get(parentKey).push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        stateType: issue.stateType
      });
    }
  }
  for (const [parentKey, children] of subtaskMap) {
    const parent = cardById.get(parentKey);
    if (parent) parent.subtasks = children;
  }

  // LIN-3240: the graph/sort/cluster pipeline keys on card identity. A stamped
  // card (a same-provider pair, repoA#1 + repoB#1) gets the binding-aware
  // `source[@bindingScope]:id` identity the tree uses, so those maps can't
  // collapse it; its relation targets (same binding) are remapped to match.
  // An unstamped card keeps its raw id and raw edge ids — byte-identical.
  for (const card of allIssues) {
    if (!card.bindingScope) continue;
    card.key = nodeKey({ id: card.id, source: card.source, bindingScope: card.bindingScope });
    card.parentKey = card.parentId
      ? nodeKey({ id: card.parentId, source: card.source, bindingScope: card.bindingScope })
      : null;
    card.blocksIds = (card.blocksIds || []).map(id =>
      nodeKey({ id, source: card.source, bindingScope: card.bindingScope })
    );
  }

  // Compute transitive graph features (sort-keys) BEFORE the sort so swipe-card
  // order matches the /stack digest order (LIN-391 — both surfaces share this
  // pipeline). Then sort, reorder blockers first, and cluster parent-subtask families.
  computeGraphFeatures(allIssues);
  sortIssuesForSwipe(allIssues);
  const sortedIssues = clusterByParent(applyBlockingOrder(allIssues));

  // LIN-2944: stamp each card with its one-line ranking reason (`buildWhy`), the
  // same explainability digest the agent stack uses (LIN-391). Swipe shows all
  // cards, so no blocker can be off-page — an empty array means the order had no
  // reason to advertise and the component renders no line.
  //
  // LIN-2944 P3 (addendum 18): starter-seed cards are onboarding scaffolding, not
  // real work. Mark each card `isSeed` and move the seeds AFTER every real card,
  // keeping their relative order — they stay in the deck (reachable), never the
  // front card as if real. When every remaining card is a seed the deck front is
  // the onboarding state (the caller reads `isSeed` to know). The seed-id set is
  // read-only data from the workspace route; `sortIssuesForSwipe`/`task-stack.js`
  // are untouched.
  const seedIds = urlKey ? starterSeedIssueIds(urlKey) : null;
  for (const issue of sortedIssues) {
    issue.isSeed = !!(seedIds && seedIds.has(issue.id));
  }
  const orderedIssues = seedIds
    ? [...sortedIssues.filter((issue) => !issue.isSeed), ...sortedIssues.filter((issue) => issue.isSeed)]
    : sortedIssues;

  for (const issue of orderedIssues) {
    issue.why = buildWhy(issue);
  }

  return orderedIssues;
}

/**
 * Renders the swipe page.
 *
 * @param {Object} data - Page data
 * @param {Array} data.projectTrees - Project trees from fetchAndPrepareProjects
 * @param {Array} data.inProgressTrees - In-progress trees
 * @param {Array} data.recentActivityTrees - Recent activity trees
 * @param {string} data.organizationName - Organization name
 * @param {Object} options - Page options
 * @returns {string} Complete HTML document
 */
export function renderSwipePage(data, options = {}) {
  const { projectTrees = [], inProgressTrees = [], recentActivityTrees = [] } = data;
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {}, customPrompts = [], initialIdentifier = null, isLanding = false, isLocalhost = false, sessionCounts = {}, teams = [], selectedTeamId = null, proxyDefault = true } = options;

  const navBarHtml = renderNavBar({ workspaces, teams, selectedTeamId, urlKey, currentPage: 'swipe', featureFlags, isLanding });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/swipe',
    urlKey,
    openRouterSource,
    featureFlags,
    isLanding
  });

  // One shared ordering pipeline for the deck and Home's top-task mark (LIN-2944
  // P1). `orderIssuesForSwipe` reproduces the ordering below verbatim, so the two
  // surfaces cannot drift.
  const sortedIssues = orderIssuesForSwipe({ projectTrees, inProgressTrees, recentActivityTrees, urlKey });

  // Stamp the dispatched-session count onto each card so its accordion header can
  // show "Dispatched Sessions [N]" at a glance (landing has none). Counts come
  // from the server-side getLoopsForWorkspace snapshot; the body still lazy-loads.
  for (const issue of sortedIssues) {
    issue.sessionCount = (sessionCounts && sessionCounts[issue.identifier]) || 0;
  }

  const filterGroups = buildFilterGroups(sortedIssues);
  const promptMeta = buildPromptMeta();

  // Provider-aware display name for the "View in {provider}" link (LIN-177 S3).
  // Falls back to Linear for legacy/landing contexts, matching the dashboard.
  const providerDisplayName = getProviderForWorkspace(workspaces?.find(w => w.urlKey === urlKey))?.ui?.displayName || 'Linear';

  // F9 flag parity (LIN-2944): Swipe previously gated the prompt surface on
  // `!!openRouterSource` alone, ignoring the person's `aiRecommendations` choice.
  // `aiState` lets the shared component show the ✦ action DISABLED with the right
  // plain-words reason (off-by-choice / unconfigured) instead of hiding it.
  // LIN-3239: `freeTier` tells the component to read the caller's own run
  // allowance from /api/dispatch/quota at load, for the ladder.
  const aiRecommendations = featureFlags.aiRecommendations !== false;
  const aiState = isLanding
    ? 'off'
    : (!aiRecommendations ? 'off' : (!openRouterSource ? 'unconfigured' : 'ready'));

  const swipeData = {
    issues: sortedIssues,
    filters: filterGroups,
    promptMeta,
    defaultPromptKeys: DEFAULT_PROMPT_KEYS,
    morePromptKeys: MORE_PROMPT_KEYS,
    customPrompts: isLanding ? [] : customPrompts.map(p => ({ id: p.id, name: p.name })),
    urlKey: isLanding ? '' : (urlKey || ''),
    providerDisplayName,
    initialIdentifier,
    hasAI: isLanding ? false : (!!openRouterSource && aiRecommendations),
    aiState,
    freeTier: !isLanding && openRouterSource === 'free',
    promptButtons: featureFlags.promptButtons !== false,
    hasAutopilot: isLanding ? false : featureFlags.proxy === true,
    dispatchEnabled: isLanding ? false : featureFlags.dispatch === true,
    proxyEnabled: isLanding ? false : featureFlags.proxy === true,
    isLocalhost: isLanding ? false : isLocalhost
  };

  const encodedUrlKey = escapeHtml(urlKey || '');

  return renderPage({
    title: 'Swipe - Tasks',
    viewport: 'width=device-width, initial-scale=1.0, user-scalable=no',
    stylesheets: ['/style.css', '/swipe.css'],
    // LIN-525 #2: live proxy flag → ProxyToggle.maybeAppend no-ops when off.
    // LIN-2944 P3 (addendum 16): also emit the account's proxy-default state for
    // ProxyToggle.isActive(); unset means on, landing omits it.
    bodyAttrs: [
      (!isLanding && featureFlags.proxy === true) ? 'data-proxy-feature="true"' : null,
      !isLanding ? `data-proxy-active="${proxyDefault !== false ? 'true' : 'false'}"` : null
    ].filter(Boolean).join(' ') || undefined,
    nav: navBarHtml,
    embeddedData: { globalVar: '__SWIPE_DATA__', value: swipeData },
    scripts: ['/common.js', '/purify.min.js', '/marked.min.js', '/recap.js', '/brief.js', '/scan.js', '/context.js', '/prompt-section.js', '/sessions.js', '/swipe.js'],
    content: `<main class="swipe-page" data-testid="swipe-page" data-url-key="${encodedUrlKey}">
    ${renderPageHeader({ title: 'Swipe', subtitle: 'Triage tasks one card at a time.', headerClass: 'swipe-header' })}
    <div class="swipe-filter-bar">
      <select class="swipe-filter-select" data-testid="swipe-filter" aria-label="Filter tasks">
        ${filterGroups.map((g, i) => `<option value="${escapeHtml(g.key)}"${i === 0 ? ' selected' : ''}>${escapeHtml(g.label)} (${g.count})</option>`).join('\n        ')}
      </select>
    </div>

    <div class="swipe-card-area">
      <div class="swipe-card-container">
        <div class="swipe-card" id="swipe-card" data-testid="swipe-card">
          ${renderEmptyState({ className: 'swipe-card-empty', text: 'No tasks to display' })}
        </div>
      </div>
    </div>

    <div class="swipe-nav-row">
      <button class="swipe-arrow swipe-arrow-left" aria-label="Previous task" disabled>&#8592;</button>
      <div class="swipe-counter" id="swipe-counter"></div>
      <button class="swipe-arrow swipe-arrow-right" aria-label="Next task">&#8594;</button>
    </div>
  </main>
  ${footerHtml}`
  });
}
