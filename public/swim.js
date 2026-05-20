/**
 * Swim Page - Client-Side Logic
 *
 * Reads embedded __SWIM_DATA__, computes lanes via assignLanes(),
 * renders the lane view, and handles settings changes + popover.
 */

// =============================================================================
// Lane Assignment (client-side copy of lib/swim-lanes.js algorithm)
// =============================================================================

// Terminal states are non-actionable; mirrored from lib/tree.js (no shared import in public/).
var TERMINAL_STATES = ['completed', 'canceled', 'duplicate'];
function isTerminalState(stateType) {
  return TERMINAL_STATES.indexOf(stateType) !== -1;
}

var SEGMENT_RANK = { started: 0, unstarted: 1, backlog: 2, completed: 3, canceled: 3, duplicate: 3 };

function assignLanes(issues, options) {
  options = options || {};
  var maxLanes = options.maxLanes !== undefined ? options.maxLanes : 6;
  var grouping = options.grouping || 'dependency';
  var showCompleted = !!options.showCompleted;
  var projectOrder = options.projectOrder || {};
  var groupSubtasks = options.groupSubtasks !== false; // default true

  var filtered = showCompleted
    ? issues
    : issues.filter(function(i) { return !isTerminalState(i.stateType); });

  if (filtered.length === 0) return { lanes: [], links: [] };

  // Caller's pre-sort order (priority, bug-first, state) — threaded into
  // orderByDependency as a tiebreaker so priority survives the topo sort.
  var globalIndex = new Map();
  for (var gi = 0; gi < filtered.length; gi++) globalIndex.set(filtered[gi].id, gi);

  var lanes;
  switch (grouping) {
    case 'project': lanes = groupByProject(filtered); break;
    case 'assignee': lanes = groupByAssignee(filtered); break;
    case 'status': lanes = groupByStatus(filtered); break;
    default: lanes = groupByDependency(filtered, globalIndex); break;
  }

  lanes = mergeLanes(lanes, maxLanes);

  // Sort lanes AFTER merging (merge re-sorts by size internally)
  if (grouping === 'project' || grouping === 'dependency') {
    sortLanesByProjectOrder(lanes, projectOrder);
  }

  // Cluster parent+children adjacently within each lane (all grouping modes)
  if (groupSubtasks) {
    for (var li = 0; li < lanes.length; li++) {
      lanes[li].items = clusterSiblingsInLane(lanes[li].items);
    }
  }

  return { lanes: lanes };
}

function clusterSiblingsInLane(items) {
  if (items.length < 2) return items;

  var itemIdx = new Map();
  for (var i = 0; i < items.length; i++) itemIdx.set(items[i].id, i);

  // blockersOf: blockedId → Set of blocker IDs (within the lane)
  var blockersOf = new Map();
  for (var i = 0; i < items.length; i++) {
    var blocksIds = items[i].blocksIds || [];
    for (var j = 0; j < blocksIds.length; j++) {
      if (itemIdx.has(blocksIds[j])) {
        if (!blockersOf.has(blocksIds[j])) blockersOf.set(blocksIds[j], new Set());
        blockersOf.get(blocksIds[j]).add(items[i].id);
      }
    }
  }

  var result = [];
  var claimed = new Set();

  function pullItemAndDescendants(item) {
    result.push(item);
    claimed.add(item.id);
    var myIdx = itemIdx.get(item.id);

    for (var j = myIdx + 1; j < items.length; j++) {
      var candidate = items[j];
      if (claimed.has(candidate.id)) continue;
      if (candidate.parentId !== item.id) continue;

      // Blocker check: don't pull candidate past one of its blockers
      var candidateBlockers = blockersOf.get(candidate.id);
      if (candidateBlockers && candidateBlockers.size > 0) {
        var blocked = false;
        for (var k = myIdx + 1; k < j; k++) {
          if (claimed.has(items[k].id)) continue;
          if (candidateBlockers.has(items[k].id)) { blocked = true; break; }
        }
        if (blocked) continue;
      }

      pullItemAndDescendants(candidate);
    }
  }

  for (var ii = 0; ii < items.length; ii++) {
    if (claimed.has(items[ii].id)) continue;
    pullItemAndDescendants(items[ii]);
  }

  return result;
}

function sortLanesByProjectOrder(lanes, projectOrder) {
  var STATUS_RANK = { started: 0, unstarted: 1, backlog: 2 };

  function getLaneStatusRank(lane) {
    var best = 2;
    for (var i = 0; i < lane.items.length; i++) {
      var rank = STATUS_RANK[lane.items[i].stateType] !== undefined ? STATUS_RANK[lane.items[i].stateType] : 1;
      if (rank < best) best = rank;
      if (best === 0) break;
    }
    return best;
  }

  function getLaneProjectOrder(lane) {
    var counts = new Map();
    for (var i = 0; i < lane.items.length; i++) {
      var name = lane.items[i].projectName || '';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    var bestProject = (lane.items[0] && lane.items[0].projectName) || '';
    var bestCount = 0;
    counts.forEach(function(count, name) {
      if (count > bestCount) { bestCount = count; bestProject = name; }
    });
    return projectOrder[bestProject] !== undefined ? projectOrder[bestProject] : Infinity;
  }

  lanes.sort(function(a, b) {
    var statusDiff = getLaneStatusRank(a) - getLaneStatusRank(b);
    if (statusDiff !== 0) return statusDiff;
    return getLaneProjectOrder(a) - getLaneProjectOrder(b);
  });
}

function groupByDependency(issues, globalIndex) {
  var issueById = new Map(issues.map(function(i) { return [i.id, i]; }));
  var issueIds = new Set(issues.map(function(i) { return i.id; }));
  var adj = new Map();

  for (var i = 0; i < issues.length; i++) {
    var issue = issues[i];
    if (!adj.has(issue.id)) adj.set(issue.id, new Set());
    var blocksIds = issue.blocksIds || [];
    for (var j = 0; j < blocksIds.length; j++) {
      if (issueIds.has(blocksIds[j])) {
        adj.get(issue.id).add(blocksIds[j]);
        if (!adj.has(blocksIds[j])) adj.set(blocksIds[j], new Set());
        adj.get(blocksIds[j]).add(issue.id);
      }
    }
    if (issue.parentId && issueIds.has(issue.parentId)) {
      adj.get(issue.id).add(issue.parentId);
      if (!adj.has(issue.parentId)) adj.set(issue.parentId, new Set());
      adj.get(issue.parentId).add(issue.id);
    }
  }

  var visited = new Set();
  var components = [];

  for (var i = 0; i < issues.length; i++) {
    var issue = issues[i];
    if (visited.has(issue.id)) continue;
    var component = [];
    var queue = [issue.id];
    visited.add(issue.id);
    while (queue.length > 0) {
      var id = queue.shift();
      component.push(id);
      var neighbors = adj.get(id);
      if (neighbors) {
        neighbors.forEach(function(neighbor) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }
    }
    components.push(component);
  }

  // Merge components that share the same single project
  var projectBuckets = new Map();
  var merged = [];

  for (var ci = 0; ci < components.length; ci++) {
    var compIds = components[ci];
    var compProjects = new Set();
    for (var pi = 0; pi < compIds.length; pi++) {
      var iss = issueById.get(compIds[pi]);
      if (iss && iss.projectName) compProjects.add(iss.projectName);
    }
    if (compProjects.size === 1) {
      var projName = compProjects.values().next().value;
      if (!projectBuckets.has(projName)) projectBuckets.set(projName, []);
      var bucket = projectBuckets.get(projName);
      for (var bi = 0; bi < compIds.length; bi++) bucket.push(compIds[bi]);
    } else {
      merged.push(compIds);
    }
  }
  projectBuckets.forEach(function(ids) { merged.push(ids); });

  return merged.map(function(componentIds, idx) {
    var items = orderByDependency(componentIds, issueById, globalIndex);
    var label = buildChainLabel(items);
    return { id: 'chain-' + idx, label: label, items: items };
  });
}

function orderByDependency(ids, issueById, globalIndex) {
  var idSet = new Set(ids);
  var issues = ids.map(function(id) { return issueById.get(id); }).filter(Boolean);
  var localIndex = new Map(issues.map(function(iss, i) { return [iss.id, i]; }));

  function sortKey(id) {
    var issue = issueById.get(id);
    var stateType = issue ? issue.stateType : 'unstarted';
    var rank = stateType in SEGMENT_RANK ? SEGMENT_RANK[stateType] : 1;
    var idx;
    if (globalIndex && globalIndex.has(id)) idx = globalIndex.get(id);
    else if (localIndex.has(id)) idx = localIndex.get(id);
    else idx = Infinity;
    return rank * 1000000 + idx;
  }

  var adj = new Map();
  var inDegree = new Map();
  ids.forEach(function(id) { adj.set(id, []); inDegree.set(id, 0); });

  issues.forEach(function(issue) {
    (issue.blocksIds || []).forEach(function(blockedId) {
      if (idSet.has(blockedId)) {
        adj.get(issue.id).push(blockedId);
        inDegree.set(blockedId, (inDegree.get(blockedId) || 0) + 1);
      }
    });
    if (issue.parentId && idSet.has(issue.parentId)) {
      adj.get(issue.parentId).push(issue.id);
      inDegree.set(issue.id, (inDegree.get(issue.id) || 0) + 1);
    }
  });

  var queue = issues.filter(function(i) { return (inDegree.get(i.id) || 0) === 0; }).map(function(i) { return i.id; });
  queue.sort(function(a, b) { return sortKey(a) - sortKey(b); });
  var result = [];

  while (queue.length > 0) {
    var id = queue.shift();
    result.push(issueById.get(id));
    (adj.get(id) || []).forEach(function(nextId) {
      var newDeg = inDegree.get(nextId) - 1;
      inDegree.set(nextId, newDeg);
      if (newDeg === 0) {
        var nextKey = sortKey(nextId);
        var insertPos = -1;
        for (var q = 0; q < queue.length; q++) {
          if (sortKey(queue[q]) > nextKey) { insertPos = q; break; }
        }
        if (insertPos === -1) queue.push(nextId);
        else queue.splice(insertPos, 0, nextId);
      }
    });
  }

  if (result.length < issues.length) {
    var placed = new Set(result.map(function(i) { return i.id; }));
    issues.forEach(function(issue) {
      if (!placed.has(issue.id)) result.push(issue);
    });
  }
  return result;
}

function buildChainLabel(items) {
  if (items.length === 0) return 'Empty';
  var projects = [];
  items.forEach(function(i) { if (i.projectName && projects.indexOf(i.projectName) === -1) projects.push(i.projectName); });
  if (projects.length === 1) return projects[0];
  var title = items[0].title || 'Chain';
  return title.length > 24 ? title.slice(0, 22) + '\u2026' : title;
}

function groupByProject(issues) {
  var groups = new Map();
  issues.forEach(function(issue) {
    var key = issue.projectName || 'No Project';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  });
  var result = [];
  groups.forEach(function(items, label) {
    result.push({ id: 'project-' + result.length, label: label, items: items });
  });
  return result;
}

function groupByAssignee(issues) {
  var groups = new Map();
  issues.forEach(function(issue) {
    var key = issue.assignee || 'Unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  });
  var result = [];
  groups.forEach(function(items, label) {
    result.push({ id: 'assignee-' + result.length, label: label, items: items });
  });
  return result;
}

function groupByStatus(issues) {
  var order = ['started', 'unstarted', 'backlog', 'completed', 'canceled'];
  var labels = { started: 'In Progress', unstarted: 'Todo', backlog: 'Backlog', completed: 'Done', canceled: 'Canceled' };
  var groups = new Map();
  issues.forEach(function(issue) {
    // Fold duplicate into canceled so the two share a lane (LIN-276).
    var rawKey = issue.stateType || 'unstarted';
    var key = rawKey === 'duplicate' ? 'canceled' : rawKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  });
  return order.filter(function(k) { return groups.has(k); }).map(function(k, i) {
    return { id: 'status-' + i, label: labels[k] || k, items: groups.get(k) };
  });
}

function mergeLabels(a, b) {
  var existing = new Set(a.split(' + '));
  var incoming = b.split(' + ').filter(function(part) { return !existing.has(part); });
  if (incoming.length === 0) return a;
  return a + ' + ' + incoming.join(' + ');
}

function mergeLanes(lanes, maxLanes) {
  if (maxLanes < 1) maxLanes = 1;
  while (lanes.length > maxLanes) {
    lanes.sort(function(a, b) { return a.items.length - b.items.length; });
    var smallest = lanes.shift();
    var second = lanes.shift();
    lanes.push({
      id: second.id,
      label: mergeLabels(second.label, smallest.label),
      items: second.items.concat(smallest.items)
    });
  }
  return lanes;
}


// =============================================================================
// Segment Assignment
// =============================================================================

function assignSegments(lanes, options) {
  var grouping = (options && options.grouping) || 'dependency';
  var groupSubtasks = !(options && options.groupSubtasks === false);
  var promoteParents = grouping === 'dependency' || groupSubtasks;

  for (var li = 0; li < lanes.length; li++) {
    var lane = lanes[li];
    // Initial segment from stateType
    for (var ii = 0; ii < lane.items.length; ii++) {
      var rank = SEGMENT_RANK[lane.items[ii].stateType];
      lane.items[ii].segment = rank !== undefined ? rank : 1;
    }

    // Parent promotion: keep parents adjacent to their active subtasks
    if (promoteParents) {
      promoteDependencyBlockers(lane.items, { parentsOnly: grouping !== 'dependency' });
    }

    // Coherence: pull every member of a subtask tree to the most-forward
    // segment of any member so grouped siblings stay together visually.
    if (groupSubtasks) {
      cohereSubtaskGroups(lane.items);
    }

    // Stable sort by segment
    var indexed = lane.items.map(function(item, i) { return { item: item, orig: i }; });
    indexed.sort(function(a, b) { return a.item.segment - b.item.segment || a.orig - b.orig; });
    lane.items = indexed.map(function(e) { return e.item; });
  }

  return lanes;
}

function cohereSubtaskGroups(items) {
  if (items.length < 2) return;

  var itemIds = new Set(items.map(function(i) { return i.id; }));

  // Union-find over parent→child edges
  var uf = new Map(items.map(function(i) { return [i.id, i.id]; }));
  function find(x) {
    var root = x;
    while (uf.get(root) !== root) root = uf.get(root);
    var cur = x;
    while (uf.get(cur) !== root) {
      var next = uf.get(cur);
      uf.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a, b) {
    var ra = find(a), rb = find(b);
    if (ra !== rb) uf.set(ra, rb);
  }

  for (var k = 0; k < items.length; k++) {
    var item = items[k];
    if (item.parentId && itemIds.has(item.parentId)) {
      union(item.id, item.parentId);
    }
  }

  // Compute min segment per group root
  var groupMinSeg = new Map();
  for (var m = 0; m < items.length; m++) {
    var it = items[m];
    var root = find(it.id);
    var cur = groupMinSeg.get(root);
    if (cur === undefined || it.segment < cur) {
      groupMinSeg.set(root, it.segment);
    }
  }

  // Apply
  for (var n = 0; n < items.length; n++) {
    var itx = items[n];
    var target = groupMinSeg.get(find(itx.id));
    if (target !== undefined && target < itx.segment) {
      itx.segment = target;
    }
  }
}

function promoteDependencyBlockers(items, options) {
  var parentsOnly = !!(options && options.parentsOnly);
  var itemById = new Map(items.map(function(i) { return [i.id, i]; }));
  var itemIds = new Set(items.map(function(i) { return i.id; }));

  // Build reverse map: blockedId → [blockerItems]
  var blockerOf = new Map();
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!parentsOnly) {
      var blocksIds = item.blocksIds || [];
      for (var j = 0; j < blocksIds.length; j++) {
        if (itemIds.has(blocksIds[j])) {
          if (!blockerOf.has(blocksIds[j])) blockerOf.set(blocksIds[j], []);
          blockerOf.get(blocksIds[j]).push(item);
        }
      }
    }
    if (item.parentId && itemById.has(item.parentId)) {
      var parent = itemById.get(item.parentId);
      if (!blockerOf.has(item.id)) blockerOf.set(item.id, []);
      blockerOf.get(item.id).push(parent);
    }
  }

  // BFS from segment-0 items, promoting their blockers
  var queue = items.filter(function(i) { return i.segment === 0; }).map(function(i) { return i.id; });
  var visited = new Set(queue);

  while (queue.length > 0) {
    var id = queue.shift();
    var blockers = blockerOf.get(id) || [];
    for (var b = 0; b < blockers.length; b++) {
      if (!visited.has(blockers[b].id)) {
        visited.add(blockers[b].id);
        blockers[b].segment = 0;
        queue.push(blockers[b].id);
      }
    }
  }
}

function computeSegmentWidths(lanes, slotWidth, columnCounts) {
  // If column counts are provided (from cross-lane blocking), use those
  if (columnCounts) {
    var widths = {};
    for (var seg in columnCounts) {
      widths[seg] = columnCounts[seg] * slotWidth;
    }
    return widths;
  }

  // Otherwise, find the max number of items per segment across all lanes
  var maxPerSegment = {};
  for (var li = 0; li < lanes.length; li++) {
    var counts = {};
    for (var ii = 0; ii < lanes[li].items.length; ii++) {
      var seg = lanes[li].items[ii].segment;
      counts[seg] = (counts[seg] || 0) + 1;
    }
    for (var seg in counts) {
      if (!maxPerSegment[seg] || counts[seg] > maxPerSegment[seg]) {
        maxPerSegment[seg] = counts[seg];
      }
    }
  }

  // Convert to min-widths
  var widths = {};
  for (var seg in maxPerSegment) {
    widths[seg] = maxPerSegment[seg] * slotWidth;
  }
  return widths;
}

// =============================================================================
// Cross-Lane Column Positioning
// =============================================================================

function computeCrossLaneColumns(lanes, options) {
  var maxGap = (options && options.maxGap !== undefined) ? options.maxGap : 2;

  // Build global maps
  var itemById = new Map();
  var itemLane = new Map();
  for (var li = 0; li < lanes.length; li++) {
    for (var ii = 0; ii < lanes[li].items.length; ii++) {
      var item = lanes[li].items[ii];
      itemById.set(item.id, item);
      itemLane.set(item.id, li);
    }
  }

  // Build reverse map: blockedId → [blockerIds] (cross-lane, same-segment only)
  var crossLaneBlockers = new Map();
  itemById.forEach(function(item) {
    var blocksIds = item.blocksIds || [];
    for (var j = 0; j < blocksIds.length; j++) {
      var blocked = itemById.get(blocksIds[j]);
      if (!blocked) continue;
      if (itemLane.get(item.id) !== itemLane.get(blocksIds[j]) &&
          item.segment === blocked.segment) {
        if (!crossLaneBlockers.has(blocksIds[j])) crossLaneBlockers.set(blocksIds[j], []);
        crossLaneBlockers.get(blocksIds[j]).push(item.id);
      }
    }
  });

  // Collect unique segment indices
  var segmentSet = new Set();
  itemById.forEach(function(item) { segmentSet.add(item.segment); });

  var columnCounts = {};

  segmentSet.forEach(function(seg) {
    // Gather items per lane for this segment
    var laneItems = lanes.map(function(lane) {
      return lane.items.filter(function(i) { return i.segment === seg; });
    });

    // Pass 1: assign default sequential columns
    for (var l = 0; l < laneItems.length; l++) {
      for (var i = 0; i < laneItems[l].length; i++) {
        laneItems[l][i].column = i;
      }
    }

    // Pass 2: push blocked items right of cross-lane blockers
    var changed = true;
    var iterations = 0;
    while (changed && iterations < 20) {
      changed = false;
      iterations++;
      for (var l = 0; l < laneItems.length; l++) {
        for (var i = 0; i < laneItems[l].length; i++) {
          var item = laneItems[l][i];
          var blockers = crossLaneBlockers.get(item.id);
          if (!blockers) continue;

          var minCol = item.column;
          for (var b = 0; b < blockers.length; b++) {
            var blocker = itemById.get(blockers[b]);
            if (blocker && blocker.segment === seg) {
              minCol = Math.max(minCol, blocker.column + 1);
            }
          }

          if (minCol > item.column) {
            var shift = minCol - item.column;
            for (var j = i; j < laneItems[l].length; j++) {
              laneItems[l][j].column += shift;
            }
            changed = true;
          }
        }
      }
    }

    // Pass 3: gap compression (respects blocker constraints)
    for (var l = 0; l < laneItems.length; l++) {
      var items = laneItems[l];
      if (items.length === 0) continue;
      var prevCol = -1;
      for (var i = 0; i < items.length; i++) {
        var gap = items[i].column - prevCol - 1;
        if (gap > maxGap) {
          var reduction = gap - maxGap;
          var blockers = crossLaneBlockers.get(items[i].id);
          if (blockers) {
            var maxBlockerCol = -1;
            for (var b = 0; b < blockers.length; b++) {
              var bl = itemById.get(blockers[b]);
              if (bl && bl.segment === seg) {
                maxBlockerCol = Math.max(maxBlockerCol, bl.column);
              }
            }
            if (maxBlockerCol >= 0) {
              var minAllowed = maxBlockerCol + 1;
              var wouldBe = items[i].column - reduction;
              if (wouldBe < minAllowed) {
                reduction = items[i].column - minAllowed;
              }
            }
          }
          if (reduction > 0) {
            for (var j = i; j < items.length; j++) {
              items[j].column -= reduction;
            }
          }
        }
        prevCol = items[i].column;
      }
    }

    // Pass 4: collapse globally empty columns
    var usedCols = new Set();
    for (var l = 0; l < laneItems.length; l++) {
      for (var i = 0; i < laneItems[l].length; i++) {
        usedCols.add(laneItems[l][i].column);
      }
    }
    if (usedCols.size > 0) {
      var sorted = Array.from(usedCols).sort(function(a, b) { return a - b; });
      var colMap = new Map(sorted.map(function(col, i) { return [col, i]; }));
      for (var l = 0; l < laneItems.length; l++) {
        for (var i = 0; i < laneItems[l].length; i++) {
          laneItems[l][i].column = colMap.get(laneItems[l][i].column);
        }
      }
      columnCounts[seg] = sorted.length;
    } else {
      columnCounts[seg] = 0;
    }
  });

  return { columnCounts: columnCounts };
}

// =============================================================================
// Rendering
// =============================================================================

var data = window.__SWIM_DATA__ || {};
var allIssues = data.issues || [];
var projectOrder = data.projectOrder || {};
var urlKey = data.urlKey || '';
var swipeBase = urlKey ? '/workspace/' + encodeURIComponent(urlKey) + '/swipe' : '/swipe';

var issueById = new Map(allIssues.map(function(i) { return [i.id, i]; }));
var currentLanes = []; // Updated by render() for chain walk access

// Extract unique labels and populate the filter dropdown
var allLabels = [];
(function buildLabelList() {
  var labelSet = {};
  for (var i = 0; i < allIssues.length; i++) {
    var labels = allIssues[i].labels;
    if (labels) {
      for (var j = 0; j < labels.length; j++) {
        labelSet[labels[j]] = true;
      }
    }
  }
  allLabels = Object.keys(labelSet).sort();
  var select = document.getElementById('swim-label-filter');
  if (select) {
    for (var k = 0; k < allLabels.length; k++) {
      var opt = document.createElement('option');
      opt.value = allLabels[k];
      opt.textContent = allLabels[k];
      select.appendChild(opt);
    }
  }
})();

function getSettings() {
  var stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('swim-settings') || '{}');
  } catch (e) { /* ignore */ }

  var grouping = stored.grouping || document.getElementById('swim-grouping').value;
  var showBlockersDefault = (grouping === 'project' || grouping === 'assignee');
  var orientationEl = document.getElementById('swim-orientation');

  return {
    grouping: grouping,
    orientation: stored.orientation || (orientationEl ? orientationEl.value : 'horizontal'),
    maxLanes: stored.maxLanes || parseInt(document.getElementById('swim-max-lanes').value, 10),
    compact: stored.compact !== undefined ? stored.compact : document.getElementById('swim-compact').checked,
    showCompleted: stored.showCompleted !== undefined ? stored.showCompleted : document.getElementById('swim-show-completed').checked,
    showBlockers: stored.showBlockers !== undefined ? stored.showBlockers : showBlockersDefault,
    groupSubtasks: stored.groupSubtasks !== undefined ? stored.groupSubtasks : document.getElementById('swim-group-subtasks').checked,
    labelFilter: stored.labelFilter || document.getElementById('swim-label-filter').value || ''
  };
}

function saveSettings(settings) {
  localStorage.setItem('swim-settings', JSON.stringify(settings));
}

function applySettingsToUI(settings) {
  document.getElementById('swim-grouping').value = settings.grouping;
  var orientationEl = document.getElementById('swim-orientation');
  if (orientationEl) orientationEl.value = settings.orientation || 'horizontal';
  document.getElementById('swim-max-lanes').value = settings.maxLanes;
  document.querySelector('.swim-max-lanes-value').textContent = settings.maxLanes;
  document.getElementById('swim-compact').checked = settings.compact;
  document.getElementById('swim-show-completed').checked = settings.showCompleted;
  document.getElementById('swim-show-blockers').checked = !!settings.showBlockers;
  document.getElementById('swim-group-subtasks').checked = settings.groupSubtasks !== false;
  document.getElementById('swim-label-filter').value = settings.labelFilter || '';
}

function stateIndicator(stateType) {
  if (isTerminalState(stateType)) return '<span class="swim-box-state done">\u2713</span>';
  switch (stateType) {
    case 'started': return '<span class="swim-box-state in-progress">\u25D0</span>';
    case 'backlog': return '<span class="swim-box-state backlog">\u25CC</span>';
    default: return '<span class="swim-box-state todo">\u25CB</span>';
  }
}

function stateClass(stateType) {
  return 'state-' + (stateType || 'unstarted');
}

function renderBox(issue, settings, blockedByMap, groupInfo) {
  var compactClass = settings.compact ? ' compact' : '';
  var titleHtml = escapeHtml(issue.title || '');
  var idHtml = escapeHtml(issue.identifier || '');

  // Check if this issue is blocked by a cross-lane item
  var blockers = blockedByMap ? (blockedByMap.get(issue.id) || []) : [];
  var isBlocked = blockers.length > 0;
  var blockedClass = isBlocked ? ' blocked' : '';
  var goalClass = labelGoalIds.has(issue.id) ? ' swim-goal' : '';

  // Group membership attributes (for post-layout group decoration)
  var groupAttrs = '';
  if (groupInfo) {
    groupAttrs += ' data-group-id="' + escapeHtml(groupInfo.groupId) + '"';
    groupAttrs += ' data-group-role="' + groupInfo.role + '"';
  }

  var html = '<div class="swim-box ' + stateClass(issue.stateType) + compactClass + blockedClass + goalClass +
    '" data-issue-id="' + escapeHtml(issue.id) + '"' + groupAttrs + '>' +
    stateIndicator(issue.stateType) +
    '<span class="swim-box-title">' + titleHtml + '</span>' +
    '<span class="swim-box-id">' + idHtml + '</span>';

  // Show "blocked by" label
  if (isBlocked && !settings.compact) {
    var blockerIds = blockers.map(function(b) { return b.identifier || b.id; });
    html += '<span class="swim-box-blocked-label">\u2190 ' + escapeHtml(blockerIds.join(', ')) + '</span>';
  }

  html += '</div>';
  return html;
}

// Build reverse blockedBy map for rendering blocked labels
function buildBlockedByMap(items) {
  var blockedBy = new Map();
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var blocksIds = item.blocksIds || [];
    for (var j = 0; j < blocksIds.length; j++) {
      if (!blockedBy.has(blocksIds[j])) blockedBy.set(blocksIds[j], []);
      blockedBy.get(blocksIds[j]).push(item);
    }
  }
  return blockedBy;
}

/**
 * Given a set of goal issue IDs, walk upstream blockers transitively
 * and return the full set (goals + all upstream blockers).
 */
function expandUpstreamBlockers(goalIds) {
  var result = new Set();
  var queue = [];
  goalIds.forEach(function(id) { result.add(id); queue.push(id); });

  while (queue.length > 0) {
    var id = queue.shift();
    for (var i = 0; i < allIssues.length; i++) {
      var iss = allIssues[i];
      if (iss.blocksIds && iss.blocksIds.indexOf(id) !== -1 && !result.has(iss.id)) {
        result.add(iss.id);
        queue.push(iss.id);
      }
    }
  }
  return result;
}

var labelGoalIds = new Set(); // Tracks which issues are "goals" for visual marking

function render() {
  var settings = getSettings();

  // Apply label filter: show only labeled issues + their upstream blockers
  var issuesToRender = allIssues;
  labelGoalIds = new Set();
  if (settings.labelFilter) {
    var goalIds = new Set();
    for (var i = 0; i < allIssues.length; i++) {
      var labels = allIssues[i].labels;
      if (labels && labels.indexOf(settings.labelFilter) !== -1) {
        goalIds.add(allIssues[i].id);
      }
    }
    labelGoalIds = goalIds;
    var visibleIds = expandUpstreamBlockers(goalIds);
    issuesToRender = allIssues.filter(function(iss) { return visibleIds.has(iss.id); });
  }

  var result = assignLanes(issuesToRender, {
    maxLanes: settings.maxLanes,
    grouping: settings.grouping,
    showCompleted: settings.showCompleted,
    projectOrder: projectOrder,
    groupSubtasks: settings.groupSubtasks
  });

  var lanes = result.lanes;
  currentLanes = lanes; // Store for chain walk access

  // Apply orientation to the page root so CSS can switch layout
  var orientation = settings.orientation === 'vertical' ? 'vertical' : 'horizontal';
  var pageEl = document.querySelector('.swim-page');
  if (pageEl) pageEl.setAttribute('data-orientation', orientation);

  // Assign segments and compute global widths
  assignSegments(lanes, { grouping: settings.grouping, groupSubtasks: settings.groupSubtasks });
  // "slotWidth" is the sequence-axis slot length — horizontal: width; vertical: height.
  // Vertical cards are shorter along the sequence axis than horizontal ones.
  var slotWidth = settings.compact
    ? (orientation === 'vertical' ? 44 : 140)
    : (orientation === 'vertical' ? 72 : 210);

  // Compute cross-lane columns if showBlockers is on
  var columnCounts = null;
  var useColumns = settings.showBlockers;
  if (useColumns) {
    var colResult = computeCrossLaneColumns(lanes);
    columnCounts = colResult.columnCounts;
  }

  var segmentWidths = computeSegmentWidths(lanes, slotWidth, columnCounts);

  var container = document.getElementById('swim-lanes');

  if (lanes.length === 0) {
    container.innerHTML = '<div class="swim-empty">No tasks to display</div>';
    return;
  }

  // In vertical mode, inline sizes become heights instead of widths
  var sizeProp = orientation === 'vertical' ? 'min-height' : 'min-width';

  // Collect all segment indices in order
  var segmentKeys = Object.keys(segmentWidths).map(Number).sort(function(a, b) { return a - b; });

  // Build blockedBy map for labels
  var blockedByMap = useColumns ? buildBlockedByMap(allIssues) : null;

  // Compute group membership: a group is a parent with ≥1 child in the same
  // lane+segment. Each issue gets a groupInfo {groupId, role} passed to renderBox;
  // the post-layout drawGroupDecorations walks these to paint shaded rects.
  var groupInfoById = settings.groupSubtasks ? computeGroupMembership(lanes) : new Map();

  function boxGroupInfo(issue) {
    return groupInfoById.get(issue.id) || null;
  }

  var html = '';
  for (var li = 0; li < lanes.length; li++) {
    var lane = lanes[li];
    html += '<div class="swim-lane" data-lane-id="' + escapeHtml(lane.id) + '">';
    html += '<div class="swim-lane-label" title="' + escapeHtml(lane.label) + '">' + escapeHtml(lane.label) + '</div>';
    html += '<div class="swim-lane-items">';

    // Group items by segment
    var itemsBySegment = {};
    for (var ii = 0; ii < lane.items.length; ii++) {
      var seg = lane.items[ii].segment;
      if (!itemsBySegment[seg]) itemsBySegment[seg] = [];
      itemsBySegment[seg].push(lane.items[ii]);
    }

    // Render each segment
    for (var si = 0; si < segmentKeys.length; si++) {
      var segKey = segmentKeys[si];
      var segItems = itemsBySegment[segKey] || [];
      var minWidth = segmentWidths[segKey] || 0;

      html += '<div class="swim-lane-segment" data-segment="' + segKey + '" style="' + sizeProp + ':' + minWidth + 'px">';

      if (useColumns && columnCounts && columnCounts[segKey] > 0) {
        // Column-based rendering: place items in column slots
        var totalCols = columnCounts[segKey];
        var itemsByCol = {};
        for (var ii = 0; ii < segItems.length; ii++) {
          var col = segItems[ii].column !== undefined ? segItems[ii].column : ii;
          if (!itemsByCol[col]) itemsByCol[col] = [];
          itemsByCol[col].push(segItems[ii]);
        }

        for (var col = 0; col < totalCols; col++) {
          var colItems = itemsByCol[col] || [];
          html += '<div class="swim-column-slot" data-column="' + col + '" style="' + sizeProp + ':' + slotWidth + 'px">';
          for (var ci = 0; ci < colItems.length; ci++) {
            html += renderBox(colItems[ci], settings, blockedByMap, boxGroupInfo(colItems[ci]));
          }
          html += '</div>';
        }
      } else {
        // Packed rendering: flat sibling boxes, group decoration drawn post-layout
        for (var ii = 0; ii < segItems.length; ii++) {
          html += renderBox(segItems[ii], settings, blockedByMap, boxGroupInfo(segItems[ii]));
        }
      }

      html += '</div>';
    }

    html += '</div></div>';
  }

  container.innerHTML = html;

  // Draw SVG connectors and (optionally) group decorations post-layout
  requestAnimationFrame(function() {
    if (orientation === 'vertical') {
      drawBlockingConnectorsVertical(lanes, useColumns ? blockedByMap : null);
    } else {
      drawBlockingConnectors(lanes, useColumns ? blockedByMap : null);
    }
    if (settings.groupSubtasks) {
      drawGroupDecorations(groupInfoById);
    }
  });
}

/**
 * Build a map: issueId → { groupId, role }
 * A group is a parent that has ≥1 child in the same lane+segment.
 * Supports nested hierarchies — each parent-with-children level forms its own group.
 */
function computeGroupMembership(lanes) {
  var groupInfo = new Map();
  var groupCounter = 0;

  for (var li = 0; li < lanes.length; li++) {
    // Partition lane items by segment
    var bySeg = {};
    for (var ii = 0; ii < lanes[li].items.length; ii++) {
      var item = lanes[li].items[ii];
      var seg = item.segment !== undefined ? item.segment : 0;
      if (!bySeg[seg]) bySeg[seg] = [];
      bySeg[seg].push(item);
    }

    for (var segKey in bySeg) {
      var segItems = bySeg[segKey];
      var idSet = new Set(segItems.map(function(i) { return i.id; }));
      // For each item that has children in this segment, create a group
      var childrenByParent = new Map();
      for (var s = 0; s < segItems.length; s++) {
        var it = segItems[s];
        if (it.parentId && idSet.has(it.parentId)) {
          if (!childrenByParent.has(it.parentId)) childrenByParent.set(it.parentId, []);
          childrenByParent.get(it.parentId).push(it.id);
        }
      }
      childrenByParent.forEach(function(childIds, parentId) {
        var gid = 'g' + (++groupCounter);
        groupInfo.set(parentId, { groupId: gid, role: 'parent' });
        for (var c = 0; c < childIds.length; c++) {
          // Preserve outer group role if already parent of another nested group
          var existing = groupInfo.get(childIds[c]);
          if (existing && existing.role === 'parent') {
            // Nested: this child is also a parent of grandchildren — keep it parent,
            // track membership in outer group via separate attribute later if needed.
            continue;
          }
          groupInfo.set(childIds[c], { groupId: gid, role: 'child' });
        }
      });
    }
  }

  return groupInfo;
}

/**
 * Post-layout: for every group, draw a shaded rect behind its parent+child cards.
 * Uses getBoundingClientRect so it works regardless of columns/gaps/blocker pushes.
 */
function drawGroupDecorations(groupInfoById) {
  // Remove any existing decoration SVG
  var existing = document.getElementById('swim-group-decorations');
  if (existing) existing.remove();

  var lanesEl = document.getElementById('swim-lanes');
  if (!lanesEl) return;

  // Collect card rects by group
  var groups = new Map(); // groupId → { rects: [...], parentTitle: str }
  var cards = lanesEl.querySelectorAll('.swim-box[data-group-id]');
  if (cards.length === 0) return;

  var containerRect = lanesEl.getBoundingClientRect();

  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var gid = card.getAttribute('data-group-id');
    var role = card.getAttribute('data-group-role');
    var r = card.getBoundingClientRect();
    var rect = {
      left: r.left - containerRect.left,
      right: r.right - containerRect.left,
      top: r.top - containerRect.top,
      bottom: r.bottom - containerRect.top
    };
    if (!groups.has(gid)) {
      groups.set(gid, { rects: [], parentTitle: '', parentCard: null });
    }
    var g = groups.get(gid);
    g.rects.push(rect);
    if (role === 'parent') {
      var titleEl = card.querySelector('.swim-box-title');
      g.parentTitle = titleEl ? (titleEl.textContent || '').trim() : '';
      g.parentCard = card;
    }
  }

  if (groups.size === 0) return;

  // Build decoration SVG
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'swim-group-decorations';
  svg.setAttribute('class', 'swim-group-decorations');
  svg.setAttribute('width', lanesEl.scrollWidth);
  svg.setAttribute('height', lanesEl.scrollHeight);

  var PAD_X = 6;
  var PAD_Y = 6;
  var LABEL_HEIGHT = 14;

  groups.forEach(function(g, gid) {
    if (g.rects.length < 2) return; // Need parent + ≥1 child to be a group
    var minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
    for (var i = 0; i < g.rects.length; i++) {
      var r = g.rects[i];
      if (r.left < minLeft) minLeft = r.left;
      if (r.top < minTop) minTop = r.top;
      if (r.right > maxRight) maxRight = r.right;
      if (r.bottom > maxBottom) maxBottom = r.bottom;
    }
    var x = minLeft - PAD_X;
    var y = minTop - PAD_Y - LABEL_HEIGHT;
    var w = (maxRight - minLeft) + PAD_X * 2;
    var h = (maxBottom - minTop) + PAD_Y * 2 + LABEL_HEIGHT;

    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('rx', 8);
    rect.setAttribute('ry', 8);
    rect.setAttribute('class', 'swim-group-rect');
    rect.setAttribute('data-group-id', gid);
    svg.appendChild(rect);

    // Label above the rect — truncate to fit the rect width so narrow lanes
    // (mobile / vertical mode) don't overflow their group into the neighbour.
    if (g.parentTitle) {
      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x + PAD_X);
      label.setAttribute('y', y + LABEL_HEIGHT - 3);
      label.setAttribute('class', 'swim-group-label-text');
      // Approx char width at 9px SF Mono ≈ 5.4px. Leave 2*PAD_X breathing room.
      var availableWidth = Math.max(0, w - PAD_X * 2);
      var maxChars = Math.max(4, Math.floor(availableWidth / 5.4));
      var hardCap = 30;
      var limit = Math.min(maxChars, hardCap);
      var labelText = g.parentTitle.length > limit
        ? g.parentTitle.slice(0, Math.max(1, limit - 1)) + '\u2026'
        : g.parentTitle;
      label.textContent = labelText;
      svg.appendChild(label);
    }
  });

  lanesEl.style.position = 'relative';
  // Insert decorations BEFORE connectors so connectors draw on top
  var connectors = document.getElementById('swim-connectors');
  if (connectors) {
    lanesEl.insertBefore(svg, connectors);
  } else {
    lanesEl.appendChild(svg);
  }
}

// =============================================================================
// SVG Connector Lines
// =============================================================================

function drawBlockingConnectors(lanes, blockedByMap) {
  // Remove any existing SVG
  var existing = document.getElementById('swim-connectors');
  if (existing) existing.remove();

  var container = document.querySelector('.swim-container');
  var lanesEl = document.getElementById('swim-lanes');
  if (!container || !lanesEl) return;

  var containerRect = lanesEl.getBoundingClientRect();

  // Build map of laneIndex per item
  var itemLaneIndex = new Map();
  for (var li = 0; li < lanes.length; li++) {
    for (var ii = 0; ii < lanes[li].items.length; ii++) {
      itemLaneIndex.set(lanes[li].items[ii].id, li);
    }
  }

  // Build item position index within each lane for adjacency check
  var itemPosInLane = new Map();
  for (var li = 0; li < lanes.length; li++) {
    for (var ii = 0; ii < lanes[li].items.length; ii++) {
      itemPosInLane.set(lanes[li].items[ii].id, ii);
    }
  }

  // Find all blocking edges, categorized
  var crossLaneEdges = [];
  var sameLaneAdjacentEdges = [];
  var sameLaneArcEdges = []; // non-adjacent within same lane
  if (blockedByMap) blockedByMap.forEach(function(blockers, blockedId) {
    var blockedLane = itemLaneIndex.get(blockedId);
    var blockedPos = itemPosInLane.get(blockedId);
    for (var i = 0; i < blockers.length; i++) {
      var blockerLane = itemLaneIndex.get(blockers[i].id);
      var blockerPos = itemPosInLane.get(blockers[i].id);
      if (blockerLane === undefined || blockedLane === undefined) continue;
      if (blockerLane !== blockedLane) {
        crossLaneEdges.push({ fromId: blockers[i].id, toId: blockedId });
      } else if (Math.abs(blockedPos - blockerPos) > 1) {
        sameLaneArcEdges.push({ fromId: blockers[i].id, toId: blockedId });
      } else {
        sameLaneAdjacentEdges.push({ fromId: blockers[i].id, toId: blockedId });
      }
    }
  });

  // Collect sequential (non-blocking) adjacent pairs in each lane
  var sequentialEdges = [];
  for (var li = 0; li < lanes.length; li++) {
    var laneItems = lanes[li].items;
    for (var ii = 0; ii < laneItems.length - 1; ii++) {
      var curr = laneItems[ii];
      var next = laneItems[ii + 1];
      // Only if NOT already a blocking pair
      var isBlocking = curr.blocksIds && curr.blocksIds.indexOf(next.id) !== -1;
      if (!isBlocking) {
        sequentialEdges.push({ fromId: curr.id, toId: next.id });
      }
    }
  }

  var totalEdges = crossLaneEdges.length + sameLaneAdjacentEdges.length + sameLaneArcEdges.length + sequentialEdges.length;
  if (totalEdges === 0) return;

  // Create SVG element
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'swim-connectors';
  svg.setAttribute('class', 'swim-connectors');
  svg.setAttribute('width', lanesEl.scrollWidth);
  svg.setAttribute('height', lanesEl.scrollHeight);

  // Define arrowhead marker
  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'swim-arrow');
  marker.setAttribute('viewBox', '0 0 8 8');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '4');
  marker.setAttribute('markerWidth', '5');
  marker.setAttribute('markerHeight', '5');
  marker.setAttribute('orient', 'auto');
  var arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrowPath.setAttribute('d', 'M0,1 L7,4 L0,7 Z');
  arrowPath.setAttribute('fill', '#e67e22');
  arrowPath.setAttribute('opacity', '0.7');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);

  // Grey arrowhead for sequential connectors
  var greyMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  greyMarker.setAttribute('id', 'swim-arrow-grey');
  greyMarker.setAttribute('viewBox', '0 0 8 8');
  greyMarker.setAttribute('refX', '7');
  greyMarker.setAttribute('refY', '4');
  greyMarker.setAttribute('markerWidth', '7');
  greyMarker.setAttribute('markerHeight', '7');
  greyMarker.setAttribute('orient', 'auto');
  var greyArrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  greyArrowPath.setAttribute('d', 'M0,1 L7,4 L0,7 Z');
  greyArrowPath.setAttribute('fill', '#bbb');
  greyArrowPath.setAttribute('opacity', '0.6');
  greyMarker.appendChild(greyArrowPath);
  defs.appendChild(greyMarker);

  svg.appendChild(defs);

  // Collect all box rects for obstacle avoidance
  var allBoxEls = document.querySelectorAll('.swim-box');
  var boxRects = [];
  for (var bi = 0; bi < allBoxEls.length; bi++) {
    var br = allBoxEls[bi].getBoundingClientRect();
    boxRects.push({
      left: br.left - containerRect.left,
      right: br.right - containerRect.left,
      top: br.top - containerRect.top,
      bottom: br.bottom - containerRect.top
    });
  }

  // Check if a vertical line at x intersects any box in the y range
  function hitsBox(x, yMin, yMax, padding) {
    for (var i = 0; i < boxRects.length; i++) {
      var r = boxRects[i];
      if (x >= r.left - padding && x <= r.right + padding &&
          r.bottom > yMin && r.top < yMax) {
        return r;
      }
    }
    return null;
  }

  // Compute lane boundary y-coordinates for gap routing
  var laneEls = document.querySelectorAll('.swim-lane');
  var laneBounds = []; // {top, bottom, midY}
  for (var li = 0; li < laneEls.length; li++) {
    var lr = laneEls[li].getBoundingClientRect();
    laneBounds.push({
      top: lr.top - containerRect.top,
      bottom: lr.bottom - containerRect.top,
      midY: lr.top + lr.height / 2 - containerRect.top
    });
  }

  // Find the y-coordinate in the gap between two lanes (or above/below edge lanes)
  function laneGapY(laneIdx, direction) {
    // direction: 'above' = gap above this lane, 'below' = gap below
    if (direction === 'above') {
      if (laneIdx > 0) {
        return (laneBounds[laneIdx - 1].bottom + laneBounds[laneIdx].top) / 2;
      }
      return laneBounds[laneIdx].top - 4;
    } else {
      if (laneIdx < laneBounds.length - 1) {
        return (laneBounds[laneIdx].bottom + laneBounds[laneIdx + 1].top) / 2;
      }
      return laneBounds[laneIdx].bottom + 4;
    }
  }

  // Pre-compute edge geometries
  var STUB_LEN = 12;
  var CHANNEL_SPACING = 6;
  var BOX_PADDING = 4;

  var edgeData = [];
  for (var e = 0; e < crossLaneEdges.length; e++) {
    var fromEl = document.querySelector('.swim-box[data-issue-id="' + crossLaneEdges[e].fromId + '"]');
    var toEl = document.querySelector('.swim-box[data-issue-id="' + crossLaneEdges[e].toId + '"]');
    if (!fromEl || !toEl) continue;

    var fromRect = fromEl.getBoundingClientRect();
    var toRect = toEl.getBoundingClientRect();
    var fromLane = itemLaneIndex.get(crossLaneEdges[e].fromId);
    var toLane = itemLaneIndex.get(crossLaneEdges[e].toId);

    edgeData.push({
      fromId: crossLaneEdges[e].fromId,
      toId: crossLaneEdges[e].toId,
      x1: fromRect.right - containerRect.left,
      y1: fromRect.top + fromRect.height / 2 - containerRect.top,
      x2: toRect.left - containerRect.left,
      y2: toRect.top + toRect.height / 2 - containerRect.top,
      fromLane: fromLane,
      toLane: toLane
    });
  }

  // Sort edges by blocker x, then by vertical span (smaller spans first)
  edgeData.sort(function(a, b) { return a.x1 - b.x1 || Math.abs(a.y1 - a.y2) - Math.abs(b.y1 - b.y2); });

  // Track used horizontal channels in lane gaps to prevent overlap
  var usedGapChannels = []; // {gapY, xMin, xMax}

  function findClearGapY(baseGapY, xMin, xMax) {
    var y = baseGapY;
    for (var attempt = 0; attempt < 10; attempt++) {
      var conflict = false;
      for (var ci = 0; ci < usedGapChannels.length; ci++) {
        var ch = usedGapChannels[ci];
        if (Math.abs(y - ch.gapY) < CHANNEL_SPACING &&
            ch.xMax > xMin && ch.xMin < xMax) {
          conflict = true;
          y = ch.gapY + CHANNEL_SPACING;
          break;
        }
      }
      if (!conflict) return y;
    }
    return y;
  }

  // Track used vertical channels to prevent overlap
  var usedChannels = []; // {x, yMin, yMax}

  function findClearVertChannel(startX, yMin, yMax) {
    var x = startX;
    for (var attempt = 0; attempt < 30; attempt++) {
      var hit = hitsBox(x, yMin, yMax, BOX_PADDING);
      if (hit) {
        x = hit.right + BOX_PADDING + 2;
        continue;
      }
      var channelConflict = false;
      for (var ci = 0; ci < usedChannels.length; ci++) {
        var ch = usedChannels[ci];
        if (Math.abs(x - ch.x) < CHANNEL_SPACING &&
            ch.yMax > yMin && ch.yMin < yMax) {
          channelConflict = true;
          x = ch.x + CHANNEL_SPACING;
          break;
        }
      }
      if (!channelConflict) return x;
    }
    return x;
  }

  // Draw each edge: route through lane gaps so horizontals never cross cards
  for (var e = 0; e < edgeData.length; e++) {
    var ed = edgeData[e];
    var goingDown = ed.toLane > ed.fromLane;

    // Exit gap: gap between blocker's lane and the next lane toward target
    var exitGapBaseY = laneGapY(ed.fromLane, goingDown ? 'below' : 'above');
    // Entry gap: gap between target's lane and the lane toward blocker
    var entryGapBaseY = laneGapY(ed.toLane, goingDown ? 'above' : 'below');

    // Find the vertical channel x (avoiding boxes)
    var yMin = Math.min(exitGapBaseY, entryGapBaseY);
    var yMax = Math.max(exitGapBaseY, entryGapBaseY);
    var midX = findClearVertChannel(ed.x1 + STUB_LEN, yMin, yMax);
    if (midX > ed.x2 - STUB_LEN) {
      midX = ed.x2 - STUB_LEN;
    }
    usedChannels.push({ x: midX, yMin: yMin, yMax: yMax });

    // Find clear horizontal gap channels (avoid overlapping parallel lines)
    var exitHorizMin = Math.min(ed.x1, midX);
    var exitHorizMax = Math.max(ed.x1, midX);
    var exitGapY = findClearGapY(exitGapBaseY, exitHorizMin, exitHorizMax);
    usedGapChannels.push({ gapY: exitGapY, xMin: exitHorizMin, xMax: exitHorizMax });

    var entryHorizMin = Math.min(midX, ed.x2);
    var entryHorizMax = Math.max(midX, ed.x2);
    var entryGapY = findClearGapY(entryGapBaseY, entryHorizMin, entryHorizMax);
    usedGapChannels.push({ gapY: entryGapY, xMin: entryHorizMin, xMax: entryHorizMax });

    // Build path with horizontal stubs so lines always exit/enter cards horizontally
    var exitStubX = ed.x1 + STUB_LEN;
    var entryStubX = ed.x2 - STUB_LEN;

    var d = 'M' + ed.x1 + ',' + ed.y1 +              // start at blocker right-center
      ' L' + exitStubX + ',' + ed.y1 +                // horizontal stub out of blocker
      ' L' + exitStubX + ',' + exitGapY +              // vertical to exit gap
      ' L' + midX + ',' + exitGapY +                   // horizontal in exit gap
      ' L' + midX + ',' + entryGapY +                  // vertical to entry gap
      ' L' + entryStubX + ',' + entryGapY +            // horizontal in entry gap
      ' L' + entryStubX + ',' + ed.y2 +                // vertical into target lane
      ' L' + ed.x2 + ',' + ed.y2;                      // horizontal stub into target

    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'swim-connector-path');
    path.setAttribute('data-from', ed.fromId);
    path.setAttribute('data-to', ed.toId);
    path.setAttribute('marker-end', 'url(#swim-arrow)');
    svg.appendChild(path);
  }

  // Draw same-lane adjacent blocking connectors (horizontal lines)
  for (var se = 0; se < sameLaneAdjacentEdges.length; se++) {
    var adjFrom = document.querySelector('.swim-box[data-issue-id="' + sameLaneAdjacentEdges[se].fromId + '"]');
    var adjTo = document.querySelector('.swim-box[data-issue-id="' + sameLaneAdjacentEdges[se].toId + '"]');
    if (!adjFrom || !adjTo) continue;

    var adjFromRect = adjFrom.getBoundingClientRect();
    var adjToRect = adjTo.getBoundingClientRect();

    var sx1 = adjFromRect.right - containerRect.left;
    var sy1 = adjFromRect.top + adjFromRect.height / 2 - containerRect.top;
    var sx2 = adjToRect.left - containerRect.left;
    var sy2 = adjToRect.top + adjToRect.height / 2 - containerRect.top;

    var sd = 'M' + sx1 + ',' + sy1 + ' L' + sx2 + ',' + sy2;

    var sPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    sPath.setAttribute('d', sd);
    sPath.setAttribute('class', 'swim-connector-path');
    sPath.setAttribute('data-from', sameLaneAdjacentEdges[se].fromId);
    sPath.setAttribute('data-to', sameLaneAdjacentEdges[se].toId);
    sPath.setAttribute('marker-end', 'url(#swim-arrow)');
    svg.appendChild(sPath);
  }

  // Draw same-lane non-adjacent blocking arcs
  var ARC_HEIGHT = 20;
  for (var ae = 0; ae < sameLaneArcEdges.length; ae++) {
    var arcFromEl = document.querySelector('.swim-box[data-issue-id="' + sameLaneArcEdges[ae].fromId + '"]');
    var arcToEl = document.querySelector('.swim-box[data-issue-id="' + sameLaneArcEdges[ae].toId + '"]');
    if (!arcFromEl || !arcToEl) continue;

    var arcFromRect = arcFromEl.getBoundingClientRect();
    var arcToRect = arcToEl.getBoundingClientRect();

    var ax1 = arcFromRect.right - containerRect.left;
    var ay1 = arcFromRect.top - containerRect.top;
    var ax2 = arcToRect.left - containerRect.left;
    var ay2 = arcToRect.top - containerRect.top;

    // Quadratic bezier arc above the items
    var arcMidX = (ax1 + ax2) / 2;
    var arcTopY = Math.min(ay1, ay2) - ARC_HEIGHT;

    var arcD = 'M' + ax1 + ',' + ay1 +
      ' Q' + arcMidX + ',' + arcTopY + ' ' + ax2 + ',' + ay2;

    var arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arcPath.setAttribute('d', arcD);
    arcPath.setAttribute('class', 'swim-connector-path');
    arcPath.setAttribute('data-from', sameLaneArcEdges[ae].fromId);
    arcPath.setAttribute('data-to', sameLaneArcEdges[ae].toId);
    arcPath.setAttribute('marker-end', 'url(#swim-arrow)');
    svg.appendChild(arcPath);
  }

  // Draw sequential (non-blocking) adjacent connectors as grey lines
  for (var sq = 0; sq < sequentialEdges.length; sq++) {
    var seqFrom = document.querySelector('.swim-box[data-issue-id="' + sequentialEdges[sq].fromId + '"]');
    var seqTo = document.querySelector('.swim-box[data-issue-id="' + sequentialEdges[sq].toId + '"]');
    if (!seqFrom || !seqTo) continue;

    var seqFromRect = seqFrom.getBoundingClientRect();
    var seqToRect = seqTo.getBoundingClientRect();

    var sqx1 = seqFromRect.right - containerRect.left;
    var sqy1 = seqFromRect.top + seqFromRect.height / 2 - containerRect.top;
    var sqx2 = seqToRect.left - containerRect.left;
    var sqy2 = seqToRect.top + seqToRect.height / 2 - containerRect.top;

    var sqd = 'M' + sqx1 + ',' + sqy1 + ' L' + sqx2 + ',' + sqy2;

    var sqPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    sqPath.setAttribute('d', sqd);
    sqPath.setAttribute('class', 'swim-connector-path swim-sequential-path');
    sqPath.setAttribute('data-from', sequentialEdges[sq].fromId);
    sqPath.setAttribute('data-to', sequentialEdges[sq].toId);
    sqPath.setAttribute('marker-end', 'url(#swim-arrow-grey)');
    svg.appendChild(sqPath);
  }

  lanesEl.style.position = 'relative';
  lanesEl.appendChild(svg);
}

// =============================================================================
// SVG Connector Lines — Vertical Orientation
//
// Mirror of drawBlockingConnectors: lanes are columns instead of rows, items
// flow top-to-bottom, blockers exit the BOTTOM of their card and connect to
// the TOP of the target. "Lane gaps" are vertical corridors between lane
// columns, and routing passes through horizontal channels (same x-range, a
// fixed y) instead of vertical ones.
// =============================================================================

function drawBlockingConnectorsVertical(lanes, blockedByMap) {
  // Remove any existing SVG
  var existing = document.getElementById('swim-connectors');
  if (existing) existing.remove();

  var container = document.querySelector('.swim-container');
  var lanesEl = document.getElementById('swim-lanes');
  if (!container || !lanesEl) return;

  var containerRect = lanesEl.getBoundingClientRect();

  // Build map of laneIndex per item
  var itemLaneIndex = new Map();
  for (var li = 0; li < lanes.length; li++) {
    for (var ii = 0; ii < lanes[li].items.length; ii++) {
      itemLaneIndex.set(lanes[li].items[ii].id, li);
    }
  }

  // Build item position index within each lane for adjacency check
  var itemPosInLane = new Map();
  for (var li = 0; li < lanes.length; li++) {
    for (var ii = 0; ii < lanes[li].items.length; ii++) {
      itemPosInLane.set(lanes[li].items[ii].id, ii);
    }
  }

  // Find all blocking edges, categorized
  var crossLaneEdges = [];
  var sameLaneAdjacentEdges = [];
  var sameLaneArcEdges = [];
  if (blockedByMap) blockedByMap.forEach(function(blockers, blockedId) {
    var blockedLane = itemLaneIndex.get(blockedId);
    var blockedPos = itemPosInLane.get(blockedId);
    for (var i = 0; i < blockers.length; i++) {
      var blockerLane = itemLaneIndex.get(blockers[i].id);
      var blockerPos = itemPosInLane.get(blockers[i].id);
      if (blockerLane === undefined || blockedLane === undefined) continue;
      if (blockerLane !== blockedLane) {
        crossLaneEdges.push({ fromId: blockers[i].id, toId: blockedId });
      } else if (Math.abs(blockedPos - blockerPos) > 1) {
        sameLaneArcEdges.push({ fromId: blockers[i].id, toId: blockedId });
      } else {
        sameLaneAdjacentEdges.push({ fromId: blockers[i].id, toId: blockedId });
      }
    }
  });

  // Collect sequential (non-blocking) adjacent pairs in each lane
  var sequentialEdges = [];
  for (var li = 0; li < lanes.length; li++) {
    var laneItems = lanes[li].items;
    for (var ii = 0; ii < laneItems.length - 1; ii++) {
      var curr = laneItems[ii];
      var next = laneItems[ii + 1];
      var isBlocking = curr.blocksIds && curr.blocksIds.indexOf(next.id) !== -1;
      if (!isBlocking) {
        sequentialEdges.push({ fromId: curr.id, toId: next.id });
      }
    }
  }

  var totalEdges = crossLaneEdges.length + sameLaneAdjacentEdges.length + sameLaneArcEdges.length + sequentialEdges.length;
  if (totalEdges === 0) return;

  // Create SVG element
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'swim-connectors';
  svg.setAttribute('class', 'swim-connectors');
  svg.setAttribute('width', lanesEl.scrollWidth);
  svg.setAttribute('height', lanesEl.scrollHeight);

  // Define arrowhead markers (orient="auto" rotates the arrow with the line direction)
  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'swim-arrow');
  marker.setAttribute('viewBox', '0 0 8 8');
  marker.setAttribute('refX', '7');
  marker.setAttribute('refY', '4');
  marker.setAttribute('markerWidth', '5');
  marker.setAttribute('markerHeight', '5');
  marker.setAttribute('orient', 'auto');
  var arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrowPath.setAttribute('d', 'M0,1 L7,4 L0,7 Z');
  arrowPath.setAttribute('fill', '#e67e22');
  arrowPath.setAttribute('opacity', '0.7');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);

  var greyMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  greyMarker.setAttribute('id', 'swim-arrow-grey');
  greyMarker.setAttribute('viewBox', '0 0 8 8');
  greyMarker.setAttribute('refX', '7');
  greyMarker.setAttribute('refY', '4');
  greyMarker.setAttribute('markerWidth', '7');
  greyMarker.setAttribute('markerHeight', '7');
  greyMarker.setAttribute('orient', 'auto');
  var greyArrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  greyArrowPath.setAttribute('d', 'M0,1 L7,4 L0,7 Z');
  greyArrowPath.setAttribute('fill', '#bbb');
  greyArrowPath.setAttribute('opacity', '0.6');
  greyMarker.appendChild(greyArrowPath);
  defs.appendChild(greyMarker);

  svg.appendChild(defs);

  // Collect all box rects for obstacle avoidance
  var allBoxEls = document.querySelectorAll('.swim-box');
  var boxRects = [];
  for (var bi = 0; bi < allBoxEls.length; bi++) {
    var br = allBoxEls[bi].getBoundingClientRect();
    boxRects.push({
      left: br.left - containerRect.left,
      right: br.right - containerRect.left,
      top: br.top - containerRect.top,
      bottom: br.bottom - containerRect.top
    });
  }

  // Check if a horizontal line at y intersects any box in the x range
  function hitsBoxHoriz(y, xMin, xMax, padding) {
    for (var i = 0; i < boxRects.length; i++) {
      var r = boxRects[i];
      if (y >= r.top - padding && y <= r.bottom + padding &&
          r.right > xMin && r.left < xMax) {
        return r;
      }
    }
    return null;
  }

  // Compute lane boundary x-coordinates for gap routing
  var laneEls = document.querySelectorAll('.swim-lane');
  var laneBounds = []; // {left, right, midX}
  for (var li = 0; li < laneEls.length; li++) {
    var lr = laneEls[li].getBoundingClientRect();
    laneBounds.push({
      left: lr.left - containerRect.left,
      right: lr.right - containerRect.left,
      midX: lr.left + lr.width / 2 - containerRect.left
    });
  }

  // Find the x-coordinate in the gap between two lanes
  function laneGapX(laneIdx, direction) {
    // direction: 'left' = gap to the left of this lane, 'right' = gap to the right
    if (direction === 'left') {
      if (laneIdx > 0) {
        return (laneBounds[laneIdx - 1].right + laneBounds[laneIdx].left) / 2;
      }
      return laneBounds[laneIdx].left - 4;
    } else {
      if (laneIdx < laneBounds.length - 1) {
        return (laneBounds[laneIdx].right + laneBounds[laneIdx + 1].left) / 2;
      }
      return laneBounds[laneIdx].right + 4;
    }
  }

  var STUB_LEN = 12;
  var CHANNEL_SPACING = 6;
  var BOX_PADDING = 4;

  // Pre-compute cross-lane edge geometries
  var edgeData = [];
  for (var e = 0; e < crossLaneEdges.length; e++) {
    var fromEl = document.querySelector('.swim-box[data-issue-id="' + crossLaneEdges[e].fromId + '"]');
    var toEl = document.querySelector('.swim-box[data-issue-id="' + crossLaneEdges[e].toId + '"]');
    if (!fromEl || !toEl) continue;

    var fromRect = fromEl.getBoundingClientRect();
    var toRect = toEl.getBoundingClientRect();
    var fromLane = itemLaneIndex.get(crossLaneEdges[e].fromId);
    var toLane = itemLaneIndex.get(crossLaneEdges[e].toId);

    edgeData.push({
      fromId: crossLaneEdges[e].fromId,
      toId: crossLaneEdges[e].toId,
      // Start: horizontal center of blocker's BOTTOM
      x1: fromRect.left + fromRect.width / 2 - containerRect.left,
      y1: fromRect.bottom - containerRect.top,
      // End: horizontal center of target's TOP
      x2: toRect.left + toRect.width / 2 - containerRect.left,
      y2: toRect.top - containerRect.top,
      fromLane: fromLane,
      toLane: toLane
    });
  }

  // Sort edges by blocker y, then by horizontal span (smaller spans first)
  edgeData.sort(function(a, b) { return a.y1 - b.y1 || Math.abs(a.x1 - a.x2) - Math.abs(b.x1 - b.x2); });

  // Track used vertical channels in lane gaps (vertical corridors)
  var usedGapChannels = []; // {gapX, yMin, yMax}

  function findClearGapX(baseGapX, yMin, yMax) {
    var x = baseGapX;
    for (var attempt = 0; attempt < 10; attempt++) {
      var conflict = false;
      for (var ci = 0; ci < usedGapChannels.length; ci++) {
        var ch = usedGapChannels[ci];
        if (Math.abs(x - ch.gapX) < CHANNEL_SPACING &&
            ch.yMax > yMin && ch.yMin < yMax) {
          conflict = true;
          x = ch.gapX + CHANNEL_SPACING;
          break;
        }
      }
      if (!conflict) return x;
    }
    return x;
  }

  // Track used horizontal channels (y coords used for horizontal runs)
  var usedChannels = []; // {y, xMin, xMax}

  function findClearHorizChannel(startY, xMin, xMax) {
    var y = startY;
    for (var attempt = 0; attempt < 30; attempt++) {
      var hit = hitsBoxHoriz(y, xMin, xMax, BOX_PADDING);
      if (hit) {
        y = hit.bottom + BOX_PADDING + 2;
        continue;
      }
      var channelConflict = false;
      for (var ci = 0; ci < usedChannels.length; ci++) {
        var ch = usedChannels[ci];
        if (Math.abs(y - ch.y) < CHANNEL_SPACING &&
            ch.xMax > xMin && ch.xMin < xMax) {
          channelConflict = true;
          y = ch.y + CHANNEL_SPACING;
          break;
        }
      }
      if (!channelConflict) return y;
    }
    return y;
  }

  // Draw each cross-lane edge: route through lane gaps so verticals never cross cards
  for (var e = 0; e < edgeData.length; e++) {
    var ed = edgeData[e];
    var goingRight = ed.toLane > ed.fromLane;

    // Exit gap: gap between blocker's lane and the next lane toward target
    var exitGapBaseX = laneGapX(ed.fromLane, goingRight ? 'right' : 'left');
    // Entry gap: gap between target's lane and the lane toward blocker
    var entryGapBaseX = laneGapX(ed.toLane, goingRight ? 'left' : 'right');

    // Find the horizontal channel y (avoiding boxes)
    var xMin = Math.min(exitGapBaseX, entryGapBaseX);
    var xMax = Math.max(exitGapBaseX, entryGapBaseX);
    var midY = findClearHorizChannel(ed.y1 + STUB_LEN, xMin, xMax);
    if (midY > ed.y2 - STUB_LEN) {
      midY = ed.y2 - STUB_LEN;
    }
    usedChannels.push({ y: midY, xMin: xMin, xMax: xMax });

    // Find clear vertical gap channels
    var exitVertMin = Math.min(ed.y1, midY);
    var exitVertMax = Math.max(ed.y1, midY);
    var exitGapX = findClearGapX(exitGapBaseX, exitVertMin, exitVertMax);
    usedGapChannels.push({ gapX: exitGapX, yMin: exitVertMin, yMax: exitVertMax });

    var entryVertMin = Math.min(midY, ed.y2);
    var entryVertMax = Math.max(midY, ed.y2);
    var entryGapX = findClearGapX(entryGapBaseX, entryVertMin, entryVertMax);
    usedGapChannels.push({ gapX: entryGapX, yMin: entryVertMin, yMax: entryVertMax });

    // Build path with vertical stubs so lines always exit/enter cards vertically
    var exitStubY = ed.y1 + STUB_LEN;
    var entryStubY = ed.y2 - STUB_LEN;

    var d = 'M' + ed.x1 + ',' + ed.y1 +              // start at blocker bottom-center
      ' L' + ed.x1 + ',' + exitStubY +                // vertical stub out of blocker
      ' L' + exitGapX + ',' + exitStubY +              // horizontal to exit gap column
      ' L' + exitGapX + ',' + midY +                   // vertical in exit gap
      ' L' + entryGapX + ',' + midY +                  // horizontal to entry gap column
      ' L' + entryGapX + ',' + entryStubY +            // vertical in entry gap
      ' L' + ed.x2 + ',' + entryStubY +                // horizontal into target lane
      ' L' + ed.x2 + ',' + ed.y2;                      // vertical stub into target top

    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'swim-connector-path');
    path.setAttribute('data-from', ed.fromId);
    path.setAttribute('data-to', ed.toId);
    path.setAttribute('marker-end', 'url(#swim-arrow)');
    svg.appendChild(path);
  }

  // Draw same-lane adjacent blocking connectors (vertical lines)
  for (var se = 0; se < sameLaneAdjacentEdges.length; se++) {
    var adjFrom = document.querySelector('.swim-box[data-issue-id="' + sameLaneAdjacentEdges[se].fromId + '"]');
    var adjTo = document.querySelector('.swim-box[data-issue-id="' + sameLaneAdjacentEdges[se].toId + '"]');
    if (!adjFrom || !adjTo) continue;

    var adjFromRect = adjFrom.getBoundingClientRect();
    var adjToRect = adjTo.getBoundingClientRect();

    var sx1 = adjFromRect.left + adjFromRect.width / 2 - containerRect.left;
    var sy1 = adjFromRect.bottom - containerRect.top;
    var sx2 = adjToRect.left + adjToRect.width / 2 - containerRect.left;
    var sy2 = adjToRect.top - containerRect.top;

    var sd = 'M' + sx1 + ',' + sy1 + ' L' + sx2 + ',' + sy2;

    var sPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    sPath.setAttribute('d', sd);
    sPath.setAttribute('class', 'swim-connector-path');
    sPath.setAttribute('data-from', sameLaneAdjacentEdges[se].fromId);
    sPath.setAttribute('data-to', sameLaneAdjacentEdges[se].toId);
    sPath.setAttribute('marker-end', 'url(#swim-arrow)');
    svg.appendChild(sPath);
  }

  // Draw same-lane non-adjacent blocking arcs (bezier to the right of items)
  var ARC_WIDTH = 20;
  for (var ae = 0; ae < sameLaneArcEdges.length; ae++) {
    var arcFromEl = document.querySelector('.swim-box[data-issue-id="' + sameLaneArcEdges[ae].fromId + '"]');
    var arcToEl = document.querySelector('.swim-box[data-issue-id="' + sameLaneArcEdges[ae].toId + '"]');
    if (!arcFromEl || !arcToEl) continue;

    var arcFromRect = arcFromEl.getBoundingClientRect();
    var arcToRect = arcToEl.getBoundingClientRect();

    var ax1 = arcFromRect.right - containerRect.left;
    var ay1 = arcFromRect.bottom - containerRect.top;
    var ax2 = arcToRect.right - containerRect.left;
    var ay2 = arcToRect.top - containerRect.top;

    // Quadratic bezier arc to the right of the items
    var arcMidY = (ay1 + ay2) / 2;
    var arcRightX = Math.max(ax1, ax2) + ARC_WIDTH;

    var arcD = 'M' + ax1 + ',' + ay1 +
      ' Q' + arcRightX + ',' + arcMidY + ' ' + ax2 + ',' + ay2;

    var arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arcPath.setAttribute('d', arcD);
    arcPath.setAttribute('class', 'swim-connector-path');
    arcPath.setAttribute('data-from', sameLaneArcEdges[ae].fromId);
    arcPath.setAttribute('data-to', sameLaneArcEdges[ae].toId);
    arcPath.setAttribute('marker-end', 'url(#swim-arrow)');
    svg.appendChild(arcPath);
  }

  // Draw sequential (non-blocking) adjacent connectors as grey vertical lines
  for (var sq = 0; sq < sequentialEdges.length; sq++) {
    var seqFrom = document.querySelector('.swim-box[data-issue-id="' + sequentialEdges[sq].fromId + '"]');
    var seqTo = document.querySelector('.swim-box[data-issue-id="' + sequentialEdges[sq].toId + '"]');
    if (!seqFrom || !seqTo) continue;

    var seqFromRect = seqFrom.getBoundingClientRect();
    var seqToRect = seqTo.getBoundingClientRect();

    var sqx1 = seqFromRect.left + seqFromRect.width / 2 - containerRect.left;
    var sqy1 = seqFromRect.bottom - containerRect.top;
    var sqx2 = seqToRect.left + seqToRect.width / 2 - containerRect.left;
    var sqy2 = seqToRect.top - containerRect.top;

    var sqd = 'M' + sqx1 + ',' + sqy1 + ' L' + sqx2 + ',' + sqy2;

    var sqPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    sqPath.setAttribute('d', sqd);
    sqPath.setAttribute('class', 'swim-connector-path swim-sequential-path');
    sqPath.setAttribute('data-from', sequentialEdges[sq].fromId);
    sqPath.setAttribute('data-to', sequentialEdges[sq].toId);
    sqPath.setAttribute('marker-end', 'url(#swim-arrow-grey)');
    svg.appendChild(sqPath);
  }

  lanesEl.style.position = 'relative';
  lanesEl.appendChild(svg);
}

// Redraw connectors on resize
var resizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

// =============================================================================
// Popover
// =============================================================================

var popoverEl = document.getElementById('swim-popover');

function showPopover(issueId, anchorEl) {
  var issue = issueById.get(issueId);
  if (!issue) return;

  currentPopoverIssueId = issueId;

  // Update critical path button text based on current state
  var cpBtn = document.getElementById('swim-popover-critical-path');
  if (cpBtn) {
    cpBtn.textContent = (criticalPathActive && criticalPathIssueId === issueId)
      ? 'Clear critical path' : 'Show critical path';
  }

  var idEl = document.getElementById('swim-popover-id');
  idEl.textContent = issue.identifier || issue.id;
  idEl.href = issue.identifier ? swipeBase + '/' + encodeURIComponent(issue.identifier) : swipeBase;
  document.getElementById('swim-popover-title').textContent = issue.title || '';

  var meta = [];
  if (issue.stateName || issue.stateType) meta.push(issue.stateName || issue.stateType);
  if (issue.assignee) meta.push(issue.assignee);
  if (issue.projectName) meta.push(issue.projectName);
  if (issue.priority) {
    var pLabels = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
    meta.push(pLabels[issue.priority] || 'P' + issue.priority);
  }
  if (issue.labels && issue.labels.length > 0) meta.push(issue.labels.join(', '));
  document.getElementById('swim-popover-meta').textContent = meta.join(' \u00B7 ');

  var desc = issue.description || '';
  document.getElementById('swim-popover-desc').textContent =
    desc.length > 200 ? desc.slice(0, 198) + '\u2026' : desc;

  var link = document.getElementById('swim-popover-link');
  if (issue.url) {
    link.href = issue.url;
    link.style.display = '';
  } else {
    link.style.display = 'none';
  }

  popoverEl.classList.remove('hidden');

  // Position near the anchor
  var rect = anchorEl.getBoundingClientRect();
  var top = rect.bottom + 8;
  var left = rect.left;

  // Keep within viewport
  if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
  if (left < 10) left = 10;
  if (top + 300 > window.innerHeight) top = rect.top - 308;

  popoverEl.style.top = top + 'px';
  popoverEl.style.left = left + 'px';
}

function hidePopover() {
  popoverEl.classList.add('hidden');
}

// =============================================================================
// Chain Highlighting (hover)
// =============================================================================

/**
 * Walk the transitive dependency chain from a given issue.
 * Returns a Set of all issue IDs in the chain (upstream blockers + downstream blocked).
 */
function getTransitiveChain(issueId) {
  var chain = new Set();
  chain.add(issueId);

  // Walk upstream: find everything that blocks this (transitively)
  var upQueue = [issueId];
  while (upQueue.length > 0) {
    var id = upQueue.shift();
    // Find blockers of this item
    for (var i = 0; i < allIssues.length; i++) {
      var iss = allIssues[i];
      if (iss.blocksIds && iss.blocksIds.indexOf(id) !== -1 && !chain.has(iss.id)) {
        chain.add(iss.id);
        upQueue.push(iss.id);
      }
    }
  }

  // Walk downstream: find everything this blocks (transitively)
  var downQueue = [issueId];
  var visited = new Set([issueId]);
  while (downQueue.length > 0) {
    var id = downQueue.shift();
    var issue = issueById.get(id);
    if (!issue || !issue.blocksIds) continue;
    for (var j = 0; j < issue.blocksIds.length; j++) {
      var blockedId = issue.blocksIds[j];
      if (!chain.has(blockedId) && issueById.has(blockedId)) {
        chain.add(blockedId);
        downQueue.push(blockedId);
      }
    }
  }

  // Walk sequential predecessors in the same lane
  // Everything queued before this task is part of its critical path
  for (var li = 0; li < currentLanes.length; li++) {
    var laneItems = currentLanes[li].items;
    var pos = -1;
    for (var ii = 0; ii < laneItems.length; ii++) {
      if (laneItems[ii].id === issueId) { pos = ii; break; }
    }
    if (pos <= 0) continue;
    // Add all predecessors in this lane
    for (var pi = 0; pi < pos; pi++) {
      var predId = laneItems[pi].id;
      if (!chain.has(predId)) {
        chain.add(predId);
        // Also walk this predecessor's upstream blockers (cross-lane)
        var predUpQueue = [predId];
        while (predUpQueue.length > 0) {
          var pid = predUpQueue.shift();
          for (var ai = 0; ai < allIssues.length; ai++) {
            var iss = allIssues[ai];
            if (iss.blocksIds && iss.blocksIds.indexOf(pid) !== -1 && !chain.has(iss.id)) {
              chain.add(iss.id);
              predUpQueue.push(iss.id);
            }
          }
        }
      }
    }
    break; // Found the lane, done
  }

  return chain;
}

/**
 * Walk upstream-only critical path: blockers + sequential predecessors.
 * Answers "what's stopping me from working on this?"
 */
function getUpstreamChain(issueId) {
  var chain = new Set();
  chain.add(issueId);

  // Walk upstream: find everything that blocks this (transitively)
  var upQueue = [issueId];
  while (upQueue.length > 0) {
    var id = upQueue.shift();
    for (var i = 0; i < allIssues.length; i++) {
      var iss = allIssues[i];
      if (iss.blocksIds && iss.blocksIds.indexOf(id) !== -1 && !chain.has(iss.id)) {
        chain.add(iss.id);
        upQueue.push(iss.id);
      }
    }
  }

  // Walk sequential predecessors in the same lane
  for (var li = 0; li < currentLanes.length; li++) {
    var laneItems = currentLanes[li].items;
    var pos = -1;
    for (var ii = 0; ii < laneItems.length; ii++) {
      if (laneItems[ii].id === issueId) { pos = ii; break; }
    }
    if (pos <= 0) continue;
    for (var pi = 0; pi < pos; pi++) {
      var predId = laneItems[pi].id;
      if (!chain.has(predId)) {
        chain.add(predId);
        // Also walk this predecessor's upstream blockers
        var predUpQueue = [predId];
        while (predUpQueue.length > 0) {
          var pid = predUpQueue.shift();
          for (var ai = 0; ai < allIssues.length; ai++) {
            var iss = allIssues[ai];
            if (iss.blocksIds && iss.blocksIds.indexOf(pid) !== -1 && !chain.has(iss.id)) {
              chain.add(iss.id);
              predUpQueue.push(iss.id);
            }
          }
        }
      }
    }
    break;
  }

  return chain;
}

// =============================================================================
// Critical Path Filter
// =============================================================================

var criticalPathActive = false;
var criticalPathIssueId = null;

function showCriticalPath(issueId) {
  criticalPathActive = true;
  criticalPathIssueId = issueId;
  var chain = getUpstreamChain(issueId);

  var lanesEl = document.getElementById('swim-lanes');
  if (!lanesEl) return;

  // Hide non-chain boxes
  var boxes = lanesEl.querySelectorAll('.swim-box');
  for (var i = 0; i < boxes.length; i++) {
    var id = boxes[i].getAttribute('data-issue-id');
    if (!chain.has(id)) {
      boxes[i].classList.add('swim-cp-hidden');
    } else {
      boxes[i].classList.add('swim-cp-visible');
      if (id === issueId) boxes[i].classList.add('swim-cp-target');
    }
  }

  // Hide connectors not in the chain
  var paths = lanesEl.querySelectorAll('.swim-connector-path');
  for (var i = 0; i < paths.length; i++) {
    var from = paths[i].getAttribute('data-from');
    var to = paths[i].getAttribute('data-to');
    if (!chain.has(from) || !chain.has(to)) {
      paths[i].classList.add('swim-cp-hidden');
    }
  }

  // Collapse empty lanes
  var lanes = lanesEl.querySelectorAll('.swim-lane');
  for (var i = 0; i < lanes.length; i++) {
    var visibleBoxes = lanes[i].querySelectorAll('.swim-box:not(.swim-cp-hidden)');
    if (visibleBoxes.length === 0) {
      lanes[i].classList.add('swim-cp-hidden-lane');
    }
  }

  // Collapse empty segments
  var segments = lanesEl.querySelectorAll('.swim-lane-segment');
  for (var i = 0; i < segments.length; i++) {
    var visibleInSeg = segments[i].querySelectorAll('.swim-box:not(.swim-cp-hidden)');
    if (visibleInSeg.length === 0) {
      segments[i].classList.add('swim-cp-hidden-segment');
    }
  }

  lanesEl.classList.add('swim-cp-active');

  // Show clear filter pill
  showClearFilterPill();

  // Update popover button text
  var btn = document.getElementById('swim-popover-critical-path');
  if (btn) btn.textContent = 'Clear critical path';
}

function clearCriticalPath() {
  criticalPathActive = false;
  criticalPathIssueId = null;

  var lanesEl = document.getElementById('swim-lanes');
  if (!lanesEl) return;

  lanesEl.classList.remove('swim-cp-active');

  var hidden = lanesEl.querySelectorAll('.swim-cp-hidden, .swim-cp-visible, .swim-cp-target, .swim-cp-hidden-lane, .swim-cp-hidden-segment');
  for (var i = 0; i < hidden.length; i++) {
    hidden[i].classList.remove('swim-cp-hidden', 'swim-cp-visible', 'swim-cp-target', 'swim-cp-hidden-lane', 'swim-cp-hidden-segment');
  }

  hideClearFilterPill();

  // Update popover button text
  var btn = document.getElementById('swim-popover-critical-path');
  if (btn) btn.textContent = 'Show critical path';
}

function showClearFilterPill() {
  var existing = document.getElementById('swim-cp-clear');
  if (existing) return;

  var pill = document.createElement('button');
  pill.id = 'swim-cp-clear';
  pill.className = 'swim-cp-clear-pill';
  pill.textContent = 'Clear critical path filter';
  pill.addEventListener('click', function() {
    clearCriticalPath();
    hidePopover();
  });

  var page = document.querySelector('.swim-page');
  var container = document.querySelector('.swim-container');
  if (page && container) {
    page.insertBefore(pill, container);
  }
}

function hideClearFilterPill() {
  var pill = document.getElementById('swim-cp-clear');
  if (pill) pill.remove();
}

function highlightChain(issueId) {
  // Always clear previous highlight first to prevent stale state
  clearChainHighlight();

  var chain = getTransitiveChain(issueId);
  var lanesEl = document.getElementById('swim-lanes');
  if (!lanesEl) return;

  lanesEl.classList.add('swim-chain-active');

  // Highlight chain nodes
  var boxes = lanesEl.querySelectorAll('.swim-box');
  for (var i = 0; i < boxes.length; i++) {
    if (chain.has(boxes[i].getAttribute('data-issue-id'))) {
      boxes[i].classList.add('swim-chain-node');
    }
  }

  // Highlight chain connectors
  var paths = lanesEl.querySelectorAll('.swim-connector-path');
  for (var i = 0; i < paths.length; i++) {
    var from = paths[i].getAttribute('data-from');
    var to = paths[i].getAttribute('data-to');
    if (chain.has(from) && chain.has(to)) {
      paths[i].classList.add('swim-chain-link');
    }
  }
}

function clearChainHighlight() {
  var lanesEl = document.getElementById('swim-lanes');
  if (!lanesEl) return;

  lanesEl.classList.remove('swim-chain-active');

  var nodes = lanesEl.querySelectorAll('.swim-chain-node');
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].classList.remove('swim-chain-node');
  }

  var links = lanesEl.querySelectorAll('.swim-chain-link');
  for (var i = 0; i < links.length; i++) {
    links[i].classList.remove('swim-chain-link');
  }
}

// =============================================================================
// Event Handlers
// =============================================================================

// Settings toggle
document.querySelector('.swim-settings-toggle').addEventListener('click', function() {
  var body = document.querySelector('.swim-settings-body');
  var expanded = !body.classList.contains('hidden');
  body.classList.toggle('hidden');
  this.setAttribute('aria-expanded', !expanded);
});

// Settings changes
function onSettingsChange() {
  clearCriticalPath();
  var orientationEl = document.getElementById('swim-orientation');
  var settings = {
    grouping: document.getElementById('swim-grouping').value,
    orientation: orientationEl ? orientationEl.value : 'horizontal',
    maxLanes: parseInt(document.getElementById('swim-max-lanes').value, 10),
    compact: document.getElementById('swim-compact').checked,
    showCompleted: document.getElementById('swim-show-completed').checked,
    showBlockers: document.getElementById('swim-show-blockers').checked,
    groupSubtasks: document.getElementById('swim-group-subtasks').checked,
    labelFilter: document.getElementById('swim-label-filter').value || ''
  };
  document.querySelector('.swim-max-lanes-value').textContent = settings.maxLanes;
  saveSettings(settings);
  render();
}

document.getElementById('swim-grouping').addEventListener('change', function() {
  // Auto-flip showBlockers default when grouping changes
  var grouping = document.getElementById('swim-grouping').value;
  var showBlockersDefault = (grouping === 'project' || grouping === 'assignee');
  document.getElementById('swim-show-blockers').checked = showBlockersDefault;
  onSettingsChange();
});
document.getElementById('swim-max-lanes').addEventListener('input', onSettingsChange);
document.getElementById('swim-compact').addEventListener('change', onSettingsChange);
var orientationEl = document.getElementById('swim-orientation');
if (orientationEl) orientationEl.addEventListener('change', onSettingsChange);
document.getElementById('swim-show-completed').addEventListener('change', onSettingsChange);
document.getElementById('swim-show-blockers').addEventListener('change', onSettingsChange);
document.getElementById('swim-group-subtasks').addEventListener('change', onSettingsChange);
document.getElementById('swim-label-filter').addEventListener('change', function() {
  // Auto-enable show blockers when a label filter is active
  var hasFilter = document.getElementById('swim-label-filter').value !== '';
  if (hasFilter) {
    document.getElementById('swim-show-blockers').checked = true;
  }
  onSettingsChange();
});

// Box clicks → popover
document.getElementById('swim-lanes').addEventListener('click', function(e) {
  var box = e.target.closest('.swim-box');
  if (box) {
    var issueId = box.getAttribute('data-issue-id');
    showPopover(issueId, box);
    e.stopPropagation();
    return;
  }
});

// Box hover → chain highlighting
var currentHighlightId = null;
document.getElementById('swim-lanes').addEventListener('mouseover', function(e) {
  var box = e.target.closest('.swim-box');
  if (box) {
    var id = box.getAttribute('data-issue-id');
    if (id !== currentHighlightId) {
      currentHighlightId = id;
      highlightChain(id);
    }
  } else {
    if (currentHighlightId) {
      currentHighlightId = null;
      clearChainHighlight();
    }
  }
});

// Critical path button in popover
var currentPopoverIssueId = null;
document.getElementById('swim-popover-critical-path').addEventListener('click', function() {
  if (criticalPathActive && criticalPathIssueId === currentPopoverIssueId) {
    clearCriticalPath();
  } else {
    clearCriticalPath(); // Clear any existing filter first
    showCriticalPath(currentPopoverIssueId);
  }
  hidePopover();
});

// Close popover
document.getElementById('swim-popover-close').addEventListener('click', hidePopover);
document.addEventListener('click', function(e) {
  if (!popoverEl.contains(e.target) && !e.target.closest('.swim-box')) {
    hidePopover();
  }
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    if (criticalPathActive) {
      clearCriticalPath();
    }
    hidePopover();
  }
});

// =============================================================================
// Drag-to-scroll
// =============================================================================

(function initDragScroll() {
  var container = document.querySelector('.swim-container');
  if (!container) return;

  var isDragging = false;
  var startX, startY, scrollLeft, scrollTop;

  container.addEventListener('mousedown', function(e) {
    // Don't drag when clicking on interactive elements
    if (e.target.closest('.swim-box, .swim-popover, button, a, input, select, label')) return;
    isDragging = true;
    startX = e.pageX - container.offsetLeft;
    startY = e.pageY - container.offsetTop;
    scrollLeft = container.scrollLeft;
    scrollTop = container.scrollTop;
    container.style.cursor = 'grabbing';
    container.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    var x = e.pageX - container.offsetLeft;
    var y = e.pageY - container.offsetTop;
    container.scrollLeft = scrollLeft - (x - startX);
    container.scrollTop = scrollTop - (y - startY);
  });

  window.addEventListener('mouseup', function() {
    if (!isDragging) return;
    isDragging = false;
    container.style.cursor = '';
    container.style.userSelect = '';
  });
})();

// =============================================================================
// Init
// =============================================================================

(function init() {
  // Restore settings from localStorage
  var stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('swim-settings') || '{}');
  } catch (e) { /* ignore */ }

  if (Object.keys(stored).length > 0) {
    applySettingsToUI(stored);
  } else {
    // Apply smart defaults for showBlockers based on grouping
    var grouping = document.getElementById('swim-grouping').value;
    var showBlockersDefault = (grouping === 'project' || grouping === 'assignee');
    document.getElementById('swim-show-blockers').checked = showBlockersDefault;
  }

  render();
})();
