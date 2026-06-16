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
import { getPromptLabels, getPromptDisplayName } from './prompt-templates.js';
import { isTerminalState } from './tree.js';
// buildBlockingGraph/computeGraphFeatures relocated to the shared, network-free
// graph-features module (LIN-433) so selectFocusSubtask can consume them without
// importing a renderer. Re-exported below to preserve this module's public surface
// (computeGraphFeatures is imported from here by tests + pipeline callers).
import { buildBlockingGraph, computeGraphFeatures } from './graph-features.js';
export { computeGraphFeatures };
import { getStateOrder } from './providers/state-map.js';
import { renderEmptyState } from './components/empty-state.js';
import { getProviderForWorkspace } from './providers/registry.js';

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
        items.push(issueToCard(node.issue, node.projectName || projectName || '', 'recent-activity'));
      }
    }
  }

  return items;
}

/**
 * Sort issues by priority for the swipe view.
 * Order: terminal states (completed/canceled/duplicate) last, bugs first, then by state, then by priority.
 *
 * @param {Array} issues - Flat array of card-data objects (mutated in place)
 * @returns {Array} The same array, sorted
 */
export function sortIssuesForSwipe(issues) {
  issues.sort((a, b) => {
    const aCompleted = isTerminalState(a.stateType);
    const bCompleted = isTerminalState(b.stateType);
    if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;

    const aBug = a.labels.some(l => l.toLowerCase() === 'bug') ? 0 : 1;
    const bBug = b.labels.some(l => l.toLowerCase() === 'bug') ? 0 : 1;
    if (aBug !== bBug) return aBug - bBug;

    const aState = getStateOrder(a.stateType) ?? 1;
    const bState = getStateOrder(b.stateType) ?? 1;
    if (aState !== bState) return aState - bState;

    // Transitive graph features as tiebreakers (LIN-391): unblocking many
    // successors is a throughput multiplier and critical-path-first minimizes
    // makespan, so both outrank the purely-local `priority`. Defaulted to 0 so
    // callers that skip computeGraphFeatures still sort deterministically.
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
  const positionOf = new Map(sortedIssues.map((issue, i) => [issue.id, i]));
  const idToIdentifier = new Map(sortedIssues.map(i => [i.id, i.identifier]));
  const heldBy = new Map();
  for (let i = 0; i < sortedIssues.length && i < limit; i++) {
    const issue = sortedIssues[i];
    const offPage = (reverseAdj.get(issue.id) || [])
      .filter(blockerId => (positionOf.get(blockerId) ?? -1) >= limit)
      .map(blockerId => idToIdentifier.get(blockerId))
      .filter(Boolean);
    if (offPage.length > 0) heldBy.set(issue.id, offPage);
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
  if ((issue.labels || []).some(l => l.toLowerCase() === 'bug')) why.push('bug');
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
  const idToIndex = new Map(issues.map((issue, i) => [issue.id, i]));
  const issueById = new Map(issues.map(issue => [issue.id, issue]));

  // Build adjacency list and in-degree count from the shared edge set
  // (in-set edges only, terminal-state blockers skipped). See buildBlockingGraph.
  const { adj, inDegree } = buildBlockingGraph(issues);

  // Kahn's algorithm: start with all zero-in-degree nodes, ordered by original position
  const queue = issues
    .filter(issue => inDegree.get(issue.id) === 0)
    .map(issue => issue.id);

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
      parentOf.set(issue.id, issue.parentId);
      if (!childrenOf.has(issue.parentId)) childrenOf.set(issue.parentId, []);
      childrenOf.get(issue.parentId).push(issue.id);
    }
  }

  // Nothing to cluster
  if (parentOf.size === 0) return issues;

  const issueById = new Map(issues.map(i => [i.id, i]));
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
    if (placed.has(issue.id)) continue;

    // Find the root of this issue's family (walk up parent chain)
    // Guard against cycles in malformed data
    let rootId = issue.id;
    const visited = new Set();
    while (parentOf.has(rootId) && issueById.has(parentOf.get(rootId))) {
      visited.add(rootId);
      rootId = parentOf.get(rootId);
      if (visited.has(rootId)) break;
    }

    // If this issue is not part of any parent-child relationship in the set, emit as-is
    if (rootId === issue.id && !childrenOf.has(issue.id)) {
      placed.add(issue.id);
      result.push(issue);
      continue;
    }

    const cluster = [];
    collectFamily(rootId, cluster, new Set());

    for (const item of cluster) {
      placed.add(item.id);
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
    groups.push({ key: 'recent-activity', label: 'Recently Completed', count: recentIds.length });
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
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {}, customPrompts = [], initialIdentifier = null, isLanding = false, isLocalhost = false, sessionCounts = {} } = options;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'swipe', featureFlags, isLanding });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/swipe',
    urlKey,
    openRouterSource,
    featureFlags,
    isLanding
  });

  // Flatten all issues for client-side use
  const projectIssues = flattenTrees(projectTrees, 'project');
  const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
  const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

  // Deduplicate by id (in-progress issues also appear in project trees)
  const seenIds = new Set();
  const allIssues = [];
  // Add in-progress first, then recent, then project issues
  for (const issue of inProgressIssues) {
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id);
      allIssues.push(issue);
    }
  }
  for (const issue of projectIssues) {
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id);
      allIssues.push(issue);
    }
  }
  for (const issue of recentIssues) {
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id);
      allIssues.push(issue);
    }
  }

  // Build parent/subtask relationships from flattened issues
  const cardById = new Map(allIssues.map(i => [i.id, i]));
  const subtaskMap = new Map();
  for (const issue of allIssues) {
    if (issue.parentId && cardById.has(issue.parentId)) {
      const parent = cardById.get(issue.parentId);
      issue.parentInfo = {
        id: parent.id,
        identifier: parent.identifier,
        title: parent.title,
        stateType: parent.stateType
      };
      if (!subtaskMap.has(issue.parentId)) subtaskMap.set(issue.parentId, []);
      subtaskMap.get(issue.parentId).push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        stateType: issue.stateType
      });
    }
  }
  for (const [parentId, children] of subtaskMap) {
    const parent = cardById.get(parentId);
    if (parent) parent.subtasks = children;
  }

  // Compute transitive graph features (sort-keys) BEFORE the sort so swipe-card
  // order matches the /stack digest order (LIN-391 — both surfaces share this
  // pipeline). Then sort, reorder blockers first, and cluster parent-subtask families.
  computeGraphFeatures(allIssues);
  sortIssuesForSwipe(allIssues);
  const sortedIssues = clusterByParent(applyBlockingOrder(allIssues));

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
    hasAI: isLanding ? false : !!openRouterSource,
    hasForeman: isLanding ? false : featureFlags.proxy === true,
    hasMiniForeman: isLanding ? false : featureFlags.proxy === true,
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
    bodyAttrs: (!isLanding && featureFlags.proxy === true) ? 'data-proxy-feature="true"' : undefined,
    nav: navBarHtml,
    embeddedData: { globalVar: '__SWIPE_DATA__', value: swipeData },
    scripts: ['/common.js', '/purify.min.js', '/marked.min.js', '/recap.js', '/brief.js', '/prompt-section.js', '/sessions.js', '/swipe.js'],
    content: `<main class="swipe-page" data-url-key="${encodedUrlKey}">
    <div class="swipe-filter-bar">
      <select class="swipe-filter-select" aria-label="Filter tasks">
        ${filterGroups.map((g, i) => `<option value="${escapeHtml(g.key)}"${i === 0 ? ' selected' : ''}>${escapeHtml(g.label)} (${g.count})</option>`).join('\n        ')}
      </select>
    </div>

    <div class="swipe-card-area">
      <div class="swipe-card-container">
        <div class="swipe-card" id="swipe-card">
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
