/**
 * Swim Lanes — Lane Assignment Algorithm
 *
 * Takes flattened, sorted issue cards and assigns them to horizontal lanes.
 * Horizontal position = sequence, vertical position = parallelism.
 *
 * Grouping modes:
 * - dependency: lanes are dependency chains (default)
 * - project: one lane per project
 * - assignee: one lane per assignee
 * - status: lanes for each workflow state
 */

// =============================================================================
// Main Export
// =============================================================================

/**
 * Assign issues to swim lanes based on grouping mode.
 *
 * @param {Array} issues - Flat array of card-data objects (same shape as swipe cards)
 * @param {Object} [options]
 * @param {number} [options.maxLanes=6] - Maximum number of lanes (overflow merges into last)
 * @param {'dependency'|'project'|'assignee'|'status'} [options.grouping='dependency']
 * @param {boolean} [options.showCompleted=false] - Include completed/canceled issues
 * @param {Object} [options.projectOrder={}] - Map of project name → sortOrder for lane ordering
 * @returns {{ lanes: Array<{id: string, label: string, items: Array}>, links: Array<{from: string, to: string, type: string}> }}
 */
export function assignLanes(issues, options = {}) {
  const { maxLanes = 6, grouping = 'dependency', showCompleted = false, projectOrder = {} } = options;

  // Filter completed if needed
  const filtered = showCompleted
    ? issues
    : issues.filter(i => i.stateType !== 'completed' && i.stateType !== 'canceled');

  if (filtered.length === 0) {
    return { lanes: [], links: [] };
  }

  let lanes;
  switch (grouping) {
    case 'project':
      lanes = groupByProject(filtered);
      break;
    case 'assignee':
      lanes = groupByAssignee(filtered);
      break;
    case 'status':
      lanes = groupByStatus(filtered);
      break;
    case 'dependency':
    default:
      lanes = groupByDependency(filtered);
      break;
  }

  // Sort lanes by project order (for project and dependency grouping)
  if (grouping === 'project' || grouping === 'dependency') {
    sortLanesByProjectOrder(lanes, projectOrder);
  }

  // Enforce maxLanes by merging smallest lanes
  lanes = mergeLanes(lanes, maxLanes);

  // Compute cross-lane blocking links
  const links = computeLinks(filtered, lanes);

  return { lanes, links };
}

// =============================================================================
// Grouping: Dependency Chains
// =============================================================================

/**
 * Merge independent components that belong to the same single project.
 * Components spanning multiple projects (cross-project dependencies) are left alone.
 */
function mergeComponentsByProject(components, issueById) {
  const projectBuckets = new Map(); // projectName → [ids...]
  const result = [];

  for (const componentIds of components) {
    const projects = new Set(
      componentIds.map(id => issueById.get(id)?.projectName).filter(Boolean)
    );
    // Only merge single-project components; multi-project ones stay separate
    if (projects.size === 1) {
      const name = [...projects][0];
      if (!projectBuckets.has(name)) projectBuckets.set(name, []);
      projectBuckets.get(name).push(...componentIds);
    } else {
      result.push(componentIds);
    }
  }

  // Add merged single-project buckets
  for (const ids of projectBuckets.values()) {
    result.push(ids);
  }

  return result;
}

/**
 * Group issues into lanes based on dependency chains.
 * Connected issues (via blocks/parentId) form a single lane.
 * Independent same-project chains are merged into one lane.
 */
function groupByDependency(issues) {
  const issueById = new Map(issues.map(i => [i.id, i]));
  const issueIds = new Set(issues.map(i => i.id));

  // Build undirected adjacency for connected components
  const adj = new Map();
  for (const issue of issues) {
    if (!adj.has(issue.id)) adj.set(issue.id, new Set());

    // Blocking edges
    for (const blockedId of issue.blocksIds || []) {
      if (issueIds.has(blockedId)) {
        adj.get(issue.id).add(blockedId);
        if (!adj.has(blockedId)) adj.set(blockedId, new Set());
        adj.get(blockedId).add(issue.id);
      }
    }

    // Parent-child edges
    if (issue.parentId && issueIds.has(issue.parentId)) {
      adj.get(issue.id).add(issue.parentId);
      if (!adj.has(issue.parentId)) adj.set(issue.parentId, new Set());
      adj.get(issue.parentId).add(issue.id);
    }
  }

  // Find connected components via BFS
  const visited = new Set();
  const components = [];

  for (const issue of issues) {
    if (visited.has(issue.id)) continue;
    const component = [];
    const queue = [issue.id];
    visited.add(issue.id);

    while (queue.length > 0) {
      const id = queue.shift();
      component.push(id);
      for (const neighbor of adj.get(id) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  // Merge components that share the same project (and have no cross-project links)
  const merged = mergeComponentsByProject(components, issueById);

  // Convert components to lanes, ordering items within by dependency
  return merged.map((componentIds, i) => {
    const items = orderByDependency(componentIds, issueById);
    const label = buildChainLabel(items);
    return { id: `chain-${i}`, label, items };
  });
}

/**
 * Order issues within a dependency chain: blockers before blocked, parents before children.
 * Uses topological sort with original array order as tiebreaker.
 */
function orderByDependency(ids, issueById) {
  const idSet = new Set(ids);
  const issues = ids.map(id => issueById.get(id)).filter(Boolean);
  const idToIndex = new Map(issues.map((iss, i) => [iss.id, i]));

  // Build directed edges: blocker → blocked, parent → child
  const adj = new Map();
  const inDegree = new Map();
  for (const id of ids) {
    adj.set(id, []);
    inDegree.set(id, 0);
  }

  for (const issue of issues) {
    // Blocking: this issue blocks others
    for (const blockedId of issue.blocksIds || []) {
      if (idSet.has(blockedId)) {
        adj.get(issue.id).push(blockedId);
        inDegree.set(blockedId, (inDegree.get(blockedId) || 0) + 1);
      }
    }
    // Parent → child
    if (issue.parentId && idSet.has(issue.parentId)) {
      // child depends on parent (parent appears first)
      adj.get(issue.parentId).push(issue.id);
      inDegree.set(issue.id, (inDegree.get(issue.id) || 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue = issues
    .filter(i => (inDegree.get(i.id) || 0) === 0)
    .map(i => i.id);
  const result = [];

  while (queue.length > 0) {
    const id = queue.shift();
    result.push(issueById.get(id));

    for (const nextId of adj.get(id) || []) {
      const newDegree = inDegree.get(nextId) - 1;
      inDegree.set(nextId, newDegree);
      if (newDegree === 0) {
        // Insert maintaining original order as tiebreaker
        const nextIdx = idToIndex.get(nextId);
        const insertPos = queue.findIndex(qId => (idToIndex.get(qId) ?? Infinity) > nextIdx);
        if (insertPos === -1) queue.push(nextId);
        else queue.splice(insertPos, 0, nextId);
      }
    }
  }

  // Cycle fallback: append remaining in original order
  if (result.length < issues.length) {
    const placed = new Set(result.map(i => i.id));
    for (const issue of issues) {
      if (!placed.has(issue.id)) result.push(issue);
    }
  }

  return result;
}

/**
 * Build a human-readable label for a dependency chain.
 * Uses the first item's project name, or the first item's title truncated.
 */
function buildChainLabel(items) {
  if (items.length === 0) return 'Empty';
  // If all items share a project, use that
  const projects = [...new Set(items.map(i => i.projectName).filter(Boolean))];
  if (projects.length === 1) return projects[0];
  // Otherwise use first item's title, truncated
  const title = items[0].title || 'Chain';
  return title.length > 24 ? title.slice(0, 22) + '…' : title;
}

// =============================================================================
// Grouping: Project / Assignee / Status
// =============================================================================

function groupByProject(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const key = issue.projectName || 'No Project';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }
  return [...groups.entries()].map(([label, items], i) => ({
    id: `project-${i}`, label, items
  }));
}

function groupByAssignee(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const key = issue.assignee || 'Unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }
  return [...groups.entries()].map(([label, items], i) => ({
    id: `assignee-${i}`, label, items
  }));
}

function groupByStatus(issues) {
  const order = ['started', 'unstarted', 'backlog', 'completed', 'canceled'];
  const labels = { started: 'In Progress', unstarted: 'Todo', backlog: 'Backlog', completed: 'Done', canceled: 'Canceled' };
  const groups = new Map();

  for (const issue of issues) {
    const key = issue.stateType || 'unstarted';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }

  return order
    .filter(key => groups.has(key))
    .map((key, i) => ({
      id: `status-${i}`, label: labels[key] || key, items: groups.get(key)
    }));
}

// =============================================================================
// Lane Ordering
// =============================================================================

/**
 * Sort lanes by the project sortOrder of their primary project.
 * For dependency chains spanning multiple projects, uses the project
 * that the majority of items belong to (or the first item's project as tiebreaker).
 */
function sortLanesByProjectOrder(lanes, projectOrder) {
  function getLaneSortKey(lane) {
    // Count items per project
    const counts = new Map();
    for (const item of lane.items) {
      const name = item.projectName || '';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    // Find the project with the most items
    let bestProject = lane.items[0]?.projectName || '';
    let bestCount = 0;
    for (const [name, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestProject = name;
      }
    }
    return projectOrder[bestProject] ?? Infinity;
  }

  lanes.sort((a, b) => getLaneSortKey(a) - getLaneSortKey(b));
}

// =============================================================================
// Lane Merging
// =============================================================================

/**
 * Merge smallest lanes when count exceeds maxLanes.
 * Merges the two smallest lanes repeatedly until under the limit.
 */
function mergeLabels(a, b) {
  // Deduplicate when merging labels like "Project A + Project A"
  const existing = new Set(a.split(' + '));
  const incoming = b.split(' + ').filter(part => !existing.has(part));
  if (incoming.length === 0) return a;
  return a + ' + ' + incoming.join(' + ');
}

function mergeLanes(lanes, maxLanes) {
  if (maxLanes < 1) maxLanes = 1;
  while (lanes.length > maxLanes) {
    // Sort by item count ascending, merge two smallest
    lanes.sort((a, b) => a.items.length - b.items.length);
    const smallest = lanes.shift();
    const secondSmallest = lanes.shift();
    const merged = {
      id: secondSmallest.id,
      label: mergeLabels(secondSmallest.label, smallest.label),
      items: [...secondSmallest.items, ...smallest.items]
    };
    lanes.push(merged);
  }
  return lanes;
}

// =============================================================================
// Cross-Lane Links
// =============================================================================

/**
 * Compute blocking relationships that cross lane boundaries.
 */
function computeLinks(issues, lanes) {
  // Build issue → lane index map
  const issueLane = new Map();
  for (let li = 0; li < lanes.length; li++) {
    for (const item of lanes[li].items) {
      issueLane.set(item.id, li);
    }
  }

  const links = [];
  const issueIds = new Set(issues.map(i => i.id));

  for (const issue of issues) {
    for (const blockedId of issue.blocksIds || []) {
      if (!issueIds.has(blockedId)) continue;
      const fromLane = issueLane.get(issue.id);
      const toLane = issueLane.get(blockedId);
      if (fromLane !== undefined && toLane !== undefined && fromLane !== toLane) {
        links.push({ from: issue.id, to: blockedId, type: 'blocks' });
      }
    }
  }

  return links;
}
