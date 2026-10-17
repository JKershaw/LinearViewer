/**
 * Swipe Page Renderer
 *
 * Generates HTML for the mobile-first task swipe page, and owns the ordering
 * pipeline that the deck and Home's top-task mark share (LIN-2944 P1).
 * Issue data is embedded as JSON (`window.__SWIPE_DATA__`) for client-side cards.
 *
 * Pipeline layers, in the order a card meets them:
 *   flatten trees → card   (flattenTrees)
 *   dedupe, link parents   (orderIssuesForSwipe)
 *   rank                   (sortIssuesForSwipe)
 *   dependency order       (applyBlockingOrder, then clusterByParent)
 *   stamp                  (isSeed, why; sessionCount in renderSwipePage)
 *
 * Embedded JSON is compared byte-for-byte, so the key order of cards and of
 * `__SWIPE_DATA__` is part of the contract — see the notes beside each builder.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';
import { buildPromptOpts } from './home-swipe-prompt-opts.js';
import { isTerminalState, nodeKey, PERIODICALS_PROJECT_ID } from './tree.js';
// The blocking-graph primitives live in the network-free graph-features module
// (LIN-433) so selectFocusSubtask can use them without importing a renderer.
// computeGraphFeatures is re-exported (same function object) because tests and
// pipeline callers import it from here.
import { buildBlockingGraph, computeGraphFeatures } from './graph-features.js';
export { computeGraphFeatures };
import { getStateOrder } from './providers/state-map.js';
import { renderEmptyState } from './components/empty-state.js';
import { starterSeedIssueIds } from './starter-seed.js';
import { getProviderForWorkspace } from './providers/registry.js';
import { findWorkspaceByUrlKey } from './workspace-lookup.js';
import { issueSource, STARTED, UNSTARTED } from './providers/models.js';

// Pipeline identity is `key || id`: a caller may qualify the raw id with
// `card.key` (and a parent with `card.parentKey`); otherwise the id is the key.
const keyOf = (card) => card.key || card.id;

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
 * Identify, for each visible (within-limit) issue, the direct blockers that were
 * pushed beyond the limit slice — so a digest line can explain a position forced
 * by an off-page blocker (LIN-391, "heldBy").
 *
 * Only DIRECT predecessors are reported; no transitive closure. In a pure
 * topological slice a blocker always precedes its blocked node, so this is
 * normally empty — the realistic trigger is clusterByParent (or the cycle
 * fallback) pulling a blocked family member ahead of an off-page blocker.
 *
 * @param {Array} sortedIssues - The fully ordered (post-cluster) issue array
 * @param {number} limit - The slice size; positions >= limit are off-page
 * @returns {Map<string, string[]>} issue key → off-page blocker identifiers
 */
export function computeOffPageBlockers(sortedIssues, limit) {
  const { reverseAdj } = buildBlockingGraph(sortedIssues);
  const positionOf = new Map(sortedIssues.map((card, i) => [keyOf(card), i]));
  const identifierOf = new Map(sortedIssues.map(card => [keyOf(card), card.identifier]));
  const heldBy = new Map();
  for (const card of sortedIssues.filter((_, i) => i < limit)) {
    const offPage = (reverseAdj.get(keyOf(card)) || [])
      .filter(blockerKey => (positionOf.get(blockerKey) ?? -1) >= limit)
      .map(blockerKey => identifierOf.get(blockerKey))
      .filter(Boolean);
    if (offPage.length > 0) heldBy.set(keyOf(card), offPage);
  }
  return heldBy;
}

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

/**
 * Build the filter dropdown groups: All, In Progress, Recent activity, one per
 * project, then one per label in use (most used first, ties by name).
 *
 * @param {Array} allIssues - All deduplicated issues
 * @returns {Array<{key: string, label: string, count: number}>} Filter groups
 */
export function buildFilterGroups(allIssues) {
  const countWhere = (predicate) => allIssues.filter(predicate).length;
  const groups = [{ key: 'all', label: 'All', count: allIssues.length }];

  const inProgress = countWhere(i => i.stateType === 'started');
  if (inProgress > 0) groups.push({ key: 'in-progress', label: 'In Progress', count: inProgress });

  const recent = countWhere(i => i.section === 'recent-activity');
  if (recent > 0) groups.push({ key: 'recent-activity', label: 'Recent activity', count: recent });

  const projectNames = [...new Set(allIssues.map(i => i.projectName).filter(Boolean))];
  for (const name of projectNames) {
    groups.push({ key: `project:${name}`, label: name, count: countWhere(i => i.projectName === name) });
  }

  // A label counts once per issue, however often the issue repeats it.
  const labelCounts = new Map();
  for (const issue of allIssues) {
    for (const name of new Set((issue.labels || []).filter(Boolean))) {
      labelCounts.set(name, (labelCounts.get(name) || 0) + 1);
    }
  }
  const labelsByUse = [...labelCounts].sort(([nameA, countA], [nameB, countB]) =>
    countB - countA || nameA.localeCompare(nameB));
  for (const [name, count] of labelsByUse) {
    groups.push({ key: `label:${name}`, label: name, count });
  }

  return groups;
}

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
// Page
// =============================================================================

/**
 * Renders the swipe page.
 *
 * @param {Object} data - Page data
 * @param {Array} data.projectTrees - Project trees from fetchAndPrepareProjects
 * @param {Array} data.inProgressTrees - In-progress trees
 * @param {Array} data.recentActivityTrees - Recent activity trees
 * @param {Object} options - Page options
 * @returns {string} Complete HTML document
 */
export function renderSwipePage(data, options = {}) {
  const { projectTrees = [], inProgressTrees = [], recentActivityTrees = [] } = data;
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {}, customPrompts = [], initialIdentifier = null, isLanding = false, isLocalhost = false, sessionCounts = {}, teams = [], selectedTeamId = null, proxyDefault = true } = options;

  const navBarHtml = renderNavBar({ workspaces, teams, selectedTeamId, urlKey, currentPage: 'swipe', featureFlags, isLanding });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/swipe', urlKey, openRouterSource, featureFlags, isLanding });

  const cards = orderIssuesForSwipe({ projectTrees, inProgressTrees, recentActivityTrees, urlKey });
  // The accordion header shows "Dispatched Sessions [N]" at a glance; counts come
  // from the server-side getLoopsForWorkspace snapshot and the body lazy-loads.
  // Landing has none.
  for (const card of cards) {
    card.sessionCount = (sessionCounts && sessionCounts[card.identifier]) || 0;
  }
  const filterGroups = buildFilterGroups(cards);

  // Provider-aware name for the "View in {provider}" link (LIN-177 S3); Linear for
  // legacy/landing contexts, matching the dashboard.
  const providerDisplayName = getProviderForWorkspace(findWorkspaceByUrlKey(workspaces, urlKey))?.ui?.displayName || 'Linear';

  // Landing is a read-only preview: AI, Autopilot, dispatch, custom prompts and
  // the localhost seam are all off, and only the prompt-button flag is honoured.
  const prompts = isLanding
    ? buildPromptOpts({ featureFlags: { aiRecommendations: false, promptButtons: featureFlags.promptButtons } })
    : buildPromptOpts({ openRouterSource, featureFlags, customPrompts, isLocalhost });

  // Key order is part of the contract: this object is embedded as JSON.
  const swipeData = {
    issues: cards,
    filters: filterGroups,
    promptMeta: prompts.promptMeta,
    defaultPromptKeys: prompts.defaultPromptKeys,
    morePromptKeys: prompts.morePromptKeys,
    customPrompts: prompts.customPrompts,
    urlKey: isLanding ? '' : (urlKey || ''),
    providerDisplayName,
    initialIdentifier,
    hasAI: prompts.hasAI,
    aiState: prompts.aiState,
    freeTier: prompts.freeTier,
    promptButtons: prompts.promptButtons,
    hasAutopilot: prompts.hasAutopilot,
    dispatchEnabled: prompts.dispatchEnabled,
    proxyEnabled: prompts.proxyEnabled,
    isLocalhost: prompts.isLocalhost
  };

  // LIN-525 #2: the live proxy flag lets ProxyToggle.maybeAppend no-op when off.
  // LIN-2944 P3 (addendum 16): the account's proxy-default state for
  // ProxyToggle.isActive(); unset means on, landing omits both.
  const bodyAttrs = isLanding ? [] : [
    featureFlags.proxy === true && 'data-proxy-feature="true"',
    `data-proxy-active="${proxyDefault !== false}"`
  ];

  const filterOptions = filterGroups
    .map((g, i) => `<option value="${escapeHtml(g.key)}"${i === 0 ? ' selected' : ''}>${escapeHtml(g.label)} (${g.count})</option>`)
    .join('\n        ');

  return renderPage({
    title: 'Swipe - Tasks',
    viewport: 'width=device-width, initial-scale=1.0, user-scalable=no',
    stylesheets: ['/style.css', '/swipe.css'],
    bodyAttrs: bodyAttrs.filter(Boolean).join(' ') || undefined,
    nav: navBarHtml,
    embeddedData: { globalVar: '__SWIPE_DATA__', value: swipeData },
    scripts: ['/common.js', '/purify.min.js', '/marked.min.js', '/recap.js', '/brief.js', '/scan.js', '/context.js', '/prompt-section.js', '/sessions.js', '/swipe.js'],
    content: `<main class="swipe-page" data-testid="swipe-page" data-url-key="${escapeHtml(urlKey || '')}">
    ${renderPageHeader({ title: 'Swipe', subtitle: 'Triage tasks one card at a time.', headerClass: 'swipe-header' })}
    <div class="swipe-filter-bar">
      <select class="swipe-filter-select" data-testid="swipe-filter" aria-label="Filter tasks">
        ${filterOptions}
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
