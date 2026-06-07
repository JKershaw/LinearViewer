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

import { isTerminalState } from './tree.js';
import { STARTED, UNSTARTED, BACKLOG, COMPLETED, CANCELED, DUPLICATE } from './providers/models.js';

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
 * @param {boolean} [options.showCompleted=false] - Include terminal-state (completed/canceled/duplicate) issues
 * @param {Object} [options.projectOrder={}] - Map of project name → sortOrder for lane ordering
 * @param {boolean} [options.groupSubtasks=true] - Cluster parent+children adjacently within each lane
 * @returns {{ lanes: Array<{id: string, label: string, items: Array}> }}
 */
export function assignLanes(issues, options = {}) {
  const {
    maxLanes = 6,
    grouping = 'dependency',
    showCompleted = false,
    projectOrder = {},
    groupSubtasks = true
  } = options;

  // Filter completed if needed
  const filtered = showCompleted
    ? issues
    : issues.filter(i => !isTerminalState(i.stateType));

  if (filtered.length === 0) {
    return { lanes: [], links: [] };
  }

  // Capture the caller's sort order as a global tiebreaker source. Callers
  // pre-sort by priority/bug/state (see render-swipe.js sortIssuesForSwipe),
  // so we thread that order into passes that would otherwise fall back on
  // arbitrary local indices (notably orderByDependency's topological sort).
  const globalIndex = new Map(filtered.map((issue, i) => [issue.id, i]));

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
      lanes = groupByDependency(filtered, globalIndex);
      break;
  }

  // Enforce maxLanes by merging smallest lanes
  lanes = mergeLanes(lanes, maxLanes);

  // Sort lanes by project order AFTER merging (merge re-sorts by size internally)
  if (grouping === 'project' || grouping === 'dependency') {
    sortLanesByProjectOrder(lanes, projectOrder);
  }

  // Cluster parent+children adjacently within each lane so subtask groups
  // render as tight visual units. Runs in all grouping modes.
  if (groupSubtasks) {
    for (const lane of lanes) {
      lane.items = clusterSiblingsInLane(lane.items);
    }
  }

  return { lanes };
}

/**
 * Reorder items within a lane so each parent is immediately followed by its
 * children (and their descendants). Only moves a child forward if no unclaimed
 * item between the parent and the child is a direct blocker of that child,
 * preserving topological validity with respect to blocking relations.
 */
function clusterSiblingsInLane(items) {
  if (items.length < 2) return items;

  const itemIdx = new Map();
  items.forEach((item, i) => itemIdx.set(item.id, i));

  // blockersOf: childId → Set of IDs that block it (within the lane)
  const blockersOf = new Map();
  for (const item of items) {
    for (const blockedId of item.blocksIds || []) {
      if (itemIdx.has(blockedId)) {
        if (!blockersOf.has(blockedId)) blockersOf.set(blockedId, new Set());
        blockersOf.get(blockedId).add(item.id);
      }
    }
  }

  const result = [];
  const claimed = new Set();

  function pullItemAndDescendants(item) {
    result.push(item);
    claimed.add(item.id);
    const myIdx = itemIdx.get(item.id);

    // Scan forward for unclaimed children of `item` in original order
    for (let j = myIdx + 1; j < items.length; j++) {
      const candidate = items[j];
      if (claimed.has(candidate.id)) continue;
      if (candidate.parentId !== item.id) continue;

      // Blocker check: don't pull candidate past one of its blockers
      const candidateBlockers = blockersOf.get(candidate.id);
      if (candidateBlockers && candidateBlockers.size > 0) {
        let blocked = false;
        for (let k = myIdx + 1; k < j; k++) {
          if (claimed.has(items[k].id)) continue;
          if (candidateBlockers.has(items[k].id)) { blocked = true; break; }
        }
        if (blocked) continue;
      }

      pullItemAndDescendants(candidate);
    }
  }

  for (let i = 0; i < items.length; i++) {
    if (claimed.has(items[i].id)) continue;
    pullItemAndDescendants(items[i]);
  }

  return result;
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
 *
 * @param {Array} issues
 * @param {Map<string, number>} [globalIndex] - Map of issue id → position in
 *   the pre-sorted input array. Used as tiebreaker in orderByDependency so
 *   priority (and other caller-sort signals) survive the topological sort.
 */
function groupByDependency(issues, globalIndex) {
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
    const items = orderByDependency(componentIds, issueById, globalIndex);
    const label = buildChainLabel(items);
    return { id: `chain-${i}`, label, items };
  });
}

// Derived from canonical state constants (LIN-174 Phase 1). Deliberate variant:
// all terminal states collapse to a single rank (3) here, unlike the canonical
// STATE_ORDER which ranks completed=3, canceled/duplicate=4.
const SEGMENT_RANK = { [STARTED]: 0, [UNSTARTED]: 1, [BACKLOG]: 2, [COMPLETED]: 3, [CANCELED]: 3, [DUPLICATE]: 3 };

/**
 * Order issues within a dependency chain: blockers before blocked, parents before children.
 * Uses topological sort with status rank as primary tiebreaker (started before todo),
 * then the caller's global sort index as secondary tiebreaker so priority /
 * bugs-first / etc. from the input sort survive into the chain order.
 */
function orderByDependency(ids, issueById, globalIndex) {
  const idSet = new Set(ids);
  const issues = ids.map(id => issueById.get(id)).filter(Boolean);
  const localIndex = new Map(issues.map((iss, i) => [iss.id, i]));

  // Sort key: status rank first, then caller's global sort order (priority,
  // bug-first, etc.), falling back to local component order if unavailable.
  function sortKey(id) {
    const issue = issueById.get(id);
    const rank = SEGMENT_RANK[issue?.stateType] ?? 1;
    const idx = globalIndex?.get(id) ?? localIndex.get(id) ?? Infinity;
    return rank * 1000000 + idx;
  }

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

  // Kahn's algorithm with status-aware tiebreaking
  const queue = issues
    .filter(i => (inDegree.get(i.id) || 0) === 0)
    .map(i => i.id);
  queue.sort((a, b) => sortKey(a) - sortKey(b));
  const result = [];

  while (queue.length > 0) {
    const id = queue.shift();
    result.push(issueById.get(id));

    for (const nextId of adj.get(id) || []) {
      const newDegree = inDegree.get(nextId) - 1;
      inDegree.set(nextId, newDegree);
      if (newDegree === 0) {
        // Insert maintaining status rank + original order as tiebreaker
        const nextKey = sortKey(nextId);
        const insertPos = queue.findIndex(qId => sortKey(qId) > nextKey);
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
    // Fold duplicate into canceled so the two share a lane (LIN-276).
    const rawKey = issue.stateType || 'unstarted';
    const key = rawKey === 'duplicate' ? 'canceled' : rawKey;
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
  // Derived from canonical state constants (LIN-174 Phase 1); non-terminal only.
  const STATUS_RANK = { [STARTED]: 0, [UNSTARTED]: 1, [BACKLOG]: 2 };

  function getLaneStatusRank(lane) {
    let best = 2;
    for (const item of lane.items) {
      const rank = STATUS_RANK[item.stateType] ?? 1;
      if (rank < best) best = rank;
      if (best === 0) break;
    }
    return best;
  }

  function getLaneProjectOrder(lane) {
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

  lanes.sort((a, b) => {
    const statusDiff = getLaneStatusRank(a) - getLaneStatusRank(b);
    if (statusDiff !== 0) return statusDiff;
    return getLaneProjectOrder(a) - getLaneProjectOrder(b);
  });
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
// Segment Assignment
// =============================================================================

/**
 * Assign a segment index to each item in each lane based on stateType.
 * Items that block a started item (directly or transitively) are promoted to
 * segment 0 when either `grouping === 'dependency'` or `groupSubtasks` is on —
 * the latter keeps parents alongside their active subtasks in all grouping modes.
 *
 * Mutates items in place (adds `segment` property).
 * Also re-sorts items within each lane so segment-0 items come first.
 *
 * @param {Array} lanes - Lanes from assignLanes()
 * @param {Object} [options]
 * @param {'dependency'|'project'|'assignee'|'status'} [options.grouping='dependency']
 * @param {boolean} [options.groupSubtasks=true] - Promote parents of active children in all modes
 * @returns {Array} The same lanes array (mutated)
 */
export function assignSegments(lanes, options = {}) {
  const { grouping = 'dependency', groupSubtasks = true } = options;
  const promoteParents = grouping === 'dependency' || groupSubtasks;

  for (const lane of lanes) {
    // Initial segment from stateType
    for (const item of lane.items) {
      item.segment = SEGMENT_RANK[item.stateType] ?? 1;
    }

    // Promotion: if an item blocks a started item (directly or transitively
    // within the lane), promote it to segment 0. In dependency mode all blockers
    // are promoted; when groupSubtasks is on (any mode), at minimum parents of
    // active children are promoted so the subtask group doesn't split segments.
    if (promoteParents) {
      promoteDependencyBlockers(lane.items, {
        parentsOnly: grouping !== 'dependency'
      });
    }

    // Coherence: pull every member of a subtask tree (parent + all descendants)
    // to the most-forward segment of any member. Keeps groups visually tight even
    // when siblings are spread across to-do / backlog / completed.
    if (groupSubtasks) {
      cohereSubtaskGroups(lane.items);
    }

    // Stable sort: group by segment, preserve order within each segment
    const indexed = lane.items.map((item, i) => ({ item, orig: i }));
    indexed.sort((a, b) => a.item.segment - b.item.segment || a.orig - b.orig);
    lane.items = indexed.map(e => e.item);
  }

  return lanes;
}

/**
 * Unify subtask trees to a single segment per group.
 *
 * Uses union-find over parent→child edges to group every ancestor/descendant
 * into one set, then pulls all members to the minimum (most-forward) segment
 * held by anyone in the set. The result: grouped siblings (and the parent, and
 * any grandparents) share one segment, so the group decoration stays together.
 *
 * Nobody moves backwards — if the whole group is already in one segment, this
 * is a no-op. Completed/canceled siblings get pulled forward too; the card's
 * state indicator still reflects its true state, and this only matters visually
 * when "show completed" is on.
 *
 * Mutates items in place.
 */
function cohereSubtaskGroups(items) {
  if (items.length < 2) return;

  const itemIds = new Set(items.map(i => i.id));

  // Union-find
  const uf = new Map(items.map(i => [i.id, i.id]));
  function find(x) {
    let root = x;
    while (uf.get(root) !== root) root = uf.get(root);
    // Path compression
    let cur = x;
    while (uf.get(cur) !== root) {
      const next = uf.get(cur);
      uf.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) uf.set(ra, rb);
  }

  for (const item of items) {
    if (item.parentId && itemIds.has(item.parentId)) {
      union(item.id, item.parentId);
    }
  }

  // Compute min segment per group root
  const groupMinSeg = new Map();
  for (const item of items) {
    const root = find(item.id);
    const cur = groupMinSeg.get(root);
    if (cur === undefined || item.segment < cur) {
      groupMinSeg.set(root, item.segment);
    }
  }

  // Apply: every item inherits its group's min segment
  for (const item of items) {
    const target = groupMinSeg.get(find(item.id));
    if (target !== undefined && target < item.segment) {
      item.segment = target;
    }
  }
}

// =============================================================================
// Cross-Lane Column Positioning
// =============================================================================

/**
 * Assign column positions to items within each segment, pushing blocked items
 * right of their cross-lane blockers. Creates the "staggering" effect where
 * gaps in a lane communicate "waiting for another lane."
 *
 * Mutates items in place (adds `column` property).
 *
 * @param {Array} lanes - Lanes with segments already assigned (from assignSegments)
 * @param {Object} [options]
 * @param {number} [options.maxGap=2] - Maximum empty columns between items in a lane
 * @returns {{ columnWidths: Object<number, number> }} Per-segment column count for layout
 */
export function computeCrossLaneColumns(lanes, options = {}) {
  const { maxGap = 2 } = options;

  // Build global maps
  const itemById = new Map();
  const itemLane = new Map(); // itemId → laneIndex
  for (let li = 0; li < lanes.length; li++) {
    for (const item of lanes[li].items) {
      itemById.set(item.id, item);
      itemLane.set(item.id, li);
    }
  }

  // Build reverse map: blockedId → [blockerIds] (cross-lane only)
  const crossLaneBlockers = new Map();
  for (const item of itemById.values()) {
    for (const blockedId of item.blocksIds || []) {
      const blocked = itemById.get(blockedId);
      if (!blocked) continue;
      // Only track cross-lane, same-segment blocking
      if (itemLane.get(item.id) !== itemLane.get(blockedId) &&
          item.segment === blocked.segment) {
        if (!crossLaneBlockers.has(blockedId)) crossLaneBlockers.set(blockedId, []);
        crossLaneBlockers.get(blockedId).push(item.id);
      }
    }
  }

  // Collect unique segment indices
  const segmentSet = new Set();
  for (const item of itemById.values()) {
    segmentSet.add(item.segment);
  }

  const columnCounts = {}; // segment → max columns needed

  for (const seg of segmentSet) {
    // Gather items per lane for this segment, preserving lane order
    const laneItems = lanes.map(lane =>
      lane.items.filter(i => i.segment === seg)
    );

    // Pass 1: assign default sequential columns within each lane
    for (const items of laneItems) {
      for (let i = 0; i < items.length; i++) {
        items[i].column = i;
      }
    }

    // Pass 2: push blocked items right of their cross-lane blockers
    // Iterate until stable (a shift may cascade to downstream items)
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 20) {
      changed = false;
      iterations++;
      for (const items of laneItems) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const blockers = crossLaneBlockers.get(item.id);
          if (!blockers) continue;

          let minCol = item.column;
          for (const blockerId of blockers) {
            const blocker = itemById.get(blockerId);
            if (blocker && blocker.segment === seg) {
              minCol = Math.max(minCol, blocker.column + 1);
            }
          }

          if (minCol > item.column) {
            const shift = minCol - item.column;
            // Shift this item and all subsequent items in the lane
            for (let j = i; j < items.length; j++) {
              items[j].column += shift;
            }
            changed = true;
          }
        }
      }
    }

    // Pass 3: gap compression — cap gaps at maxGap empty columns
    // But never compress a blocked item past its blocker's column
    for (const items of laneItems) {
      if (items.length === 0) continue;
      let prevCol = -1;
      for (let ii = 0; ii < items.length; ii++) {
        const item = items[ii];
        const gap = item.column - prevCol - 1;
        if (gap > maxGap) {
          let reduction = gap - maxGap;
          // Don't compress past blocker constraints
          const blockers = crossLaneBlockers.get(item.id);
          if (blockers) {
            let maxBlockerCol = -1;
            for (const bid of blockers) {
              const b = itemById.get(bid);
              if (b && b.segment === seg) {
                maxBlockerCol = Math.max(maxBlockerCol, b.column);
              }
            }
            if (maxBlockerCol >= 0) {
              const minAllowed = maxBlockerCol + 1;
              const wouldBe = item.column - reduction;
              if (wouldBe < minAllowed) {
                reduction = item.column - minAllowed;
              }
            }
          }
          if (reduction > 0) {
            for (let j = ii; j < items.length; j++) {
              items[j].column -= reduction;
            }
          }
        }
        prevCol = item.column;
      }
    }

    // Pass 4: collapse globally empty columns
    // Find all used columns across all lanes for this segment
    const usedCols = new Set();
    for (const items of laneItems) {
      for (const item of items) {
        usedCols.add(item.column);
      }
    }
    if (usedCols.size > 0) {
      const sorted = [...usedCols].sort((a, b) => a - b);
      const colMap = new Map(sorted.map((col, i) => [col, i]));
      for (const items of laneItems) {
        for (const item of items) {
          item.column = colMap.get(item.column);
        }
      }
      columnCounts[seg] = sorted.length;
    } else {
      columnCounts[seg] = 0;
    }
  }

  return { columnCounts };
}

/**
 * Promote items that block a started item to segment 0.
 * Walks backwards through blocking chains: if A blocks B and B is segment 0,
 * then A should also be segment 0.
 *
 * @param {Array} items
 * @param {Object} [options]
 * @param {boolean} [options.parentsOnly=false] - If true, only parent→child edges
 *   are treated as blocking (explicit blocksIds are ignored). Used by non-dependency
 *   grouping modes to keep parents adjacent to active subtasks without pulling
 *   unrelated blockers into segment 0.
 */
function promoteDependencyBlockers(items, options = {}) {
  const { parentsOnly = false } = options;
  const itemById = new Map(items.map(i => [i.id, i]));
  const itemIds = new Set(items.map(i => i.id));

  // Build reverse map: blockedId → [blockerItems]
  const blockerOf = new Map();
  for (const item of items) {
    if (!parentsOnly) {
      for (const blockedId of item.blocksIds || []) {
        if (itemIds.has(blockedId)) {
          if (!blockerOf.has(blockedId)) blockerOf.set(blockedId, []);
          blockerOf.get(blockedId).push(item);
        }
      }
    }
    // Parent blocks child (parent should be promoted if child is active)
    if (item.parentId && itemById.has(item.parentId)) {
      const parent = itemById.get(item.parentId);
      if (!blockerOf.has(item.id)) blockerOf.set(item.id, []);
      blockerOf.get(item.id).push(parent);
    }
  }

  // BFS from all segment-0 items, promoting their blockers
  const queue = items.filter(i => i.segment === 0).map(i => i.id);
  const visited = new Set(queue);

  while (queue.length > 0) {
    const id = queue.shift();
    for (const blocker of blockerOf.get(id) || []) {
      if (!visited.has(blocker.id)) {
        visited.add(blocker.id);
        blocker.segment = 0;
        queue.push(blocker.id);
      }
    }
  }
}

