/**
 * Swim Page - Client-Side Logic
 *
 * Reads embedded __SWIM_DATA__, computes lanes via assignLanes(),
 * renders the lane view, and handles settings changes + popover.
 */

// =============================================================================
// Lane Assignment (client-side copy of lib/swim-lanes.js algorithm)
// =============================================================================

var SEGMENT_RANK = { started: 0, unstarted: 1, backlog: 2, completed: 3, canceled: 3 };

function assignLanes(issues, options) {
  const { maxLanes = 6, grouping = 'dependency', showCompleted = false, projectOrder = {} } = options || {};

  const filtered = showCompleted
    ? issues
    : issues.filter(function(i) { return i.stateType !== 'completed' && i.stateType !== 'canceled'; });

  if (filtered.length === 0) return { lanes: [], links: [] };

  var lanes;
  switch (grouping) {
    case 'project': lanes = groupByProject(filtered); break;
    case 'assignee': lanes = groupByAssignee(filtered); break;
    case 'status': lanes = groupByStatus(filtered); break;
    default: lanes = groupByDependency(filtered); break;
  }

  lanes = mergeLanes(lanes, maxLanes);

  // Sort lanes AFTER merging (merge re-sorts by size internally)
  if (grouping === 'project' || grouping === 'dependency') {
    sortLanesByProjectOrder(lanes, projectOrder);
  }
  return { lanes: lanes };
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

function groupByDependency(issues) {
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
    var items = orderByDependency(componentIds, issueById);
    var label = buildChainLabel(items);
    return { id: 'chain-' + idx, label: label, items: items };
  });
}

function orderByDependency(ids, issueById) {
  var idSet = new Set(ids);
  var issues = ids.map(function(id) { return issueById.get(id); }).filter(Boolean);
  var idToIndex = new Map(issues.map(function(iss, i) { return [iss.id, i]; }));

  function sortKey(id) {
    var issue = issueById.get(id);
    var stateType = issue ? issue.stateType : 'unstarted';
    var rank = stateType in SEGMENT_RANK ? SEGMENT_RANK[stateType] : 1;
    var idx = idToIndex.has(id) ? idToIndex.get(id) : Infinity;
    return rank * 100000 + idx;
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
    var key = issue.stateType || 'unstarted';
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

  for (var li = 0; li < lanes.length; li++) {
    var lane = lanes[li];
    // Initial segment from stateType
    for (var ii = 0; ii < lane.items.length; ii++) {
      var rank = SEGMENT_RANK[lane.items[ii].stateType];
      lane.items[ii].segment = rank !== undefined ? rank : 1;
    }

    // Dependency promotion
    if (grouping === 'dependency') {
      promoteDependencyBlockers(lane.items);
    }

    // Stable sort by segment
    var indexed = lane.items.map(function(item, i) { return { item: item, orig: i }; });
    indexed.sort(function(a, b) { return a.item.segment - b.item.segment || a.orig - b.orig; });
    lane.items = indexed.map(function(e) { return e.item; });
  }

  return lanes;
}

function promoteDependencyBlockers(items) {
  var itemById = new Map(items.map(function(i) { return [i.id, i]; }));
  var itemIds = new Set(items.map(function(i) { return i.id; }));

  // Build reverse map: blockedId → [blockerItems]
  var blockerOf = new Map();
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var blocksIds = item.blocksIds || [];
    for (var j = 0; j < blocksIds.length; j++) {
      if (itemIds.has(blocksIds[j])) {
        if (!blockerOf.has(blocksIds[j])) blockerOf.set(blocksIds[j], []);
        blockerOf.get(blocksIds[j]).push(item);
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

var issueById = new Map(allIssues.map(function(i) { return [i.id, i]; }));

function getSettings() {
  var stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('swim-settings') || '{}');
  } catch (e) { /* ignore */ }

  var grouping = stored.grouping || document.getElementById('swim-grouping').value;
  var showBlockersDefault = (grouping === 'project' || grouping === 'assignee');

  return {
    grouping: grouping,
    maxLanes: stored.maxLanes || parseInt(document.getElementById('swim-max-lanes').value, 10),
    compact: stored.compact !== undefined ? stored.compact : document.getElementById('swim-compact').checked,
    showCompleted: stored.showCompleted !== undefined ? stored.showCompleted : document.getElementById('swim-show-completed').checked,
    showBlockers: stored.showBlockers !== undefined ? stored.showBlockers : showBlockersDefault
  };
}

function saveSettings(settings) {
  localStorage.setItem('swim-settings', JSON.stringify(settings));
}

function applySettingsToUI(settings) {
  document.getElementById('swim-grouping').value = settings.grouping;
  document.getElementById('swim-max-lanes').value = settings.maxLanes;
  document.querySelector('.swim-max-lanes-value').textContent = settings.maxLanes;
  document.getElementById('swim-compact').checked = settings.compact;
  document.getElementById('swim-show-completed').checked = settings.showCompleted;
  document.getElementById('swim-show-blockers').checked = !!settings.showBlockers;
}

function stateIndicator(stateType) {
  switch (stateType) {
    case 'completed': case 'canceled': return '<span class="swim-box-state done">\u2713</span>';
    case 'started': return '<span class="swim-box-state in-progress">\u25D0</span>';
    case 'backlog': return '<span class="swim-box-state backlog">\u25CC</span>';
    default: return '<span class="swim-box-state todo">\u25CB</span>';
  }
}

function stateClass(stateType) {
  return 'state-' + (stateType || 'unstarted');
}

function renderBox(issue, settings, blockedByMap) {
  var compactClass = settings.compact ? ' compact' : '';
  var titleHtml = escapeHtml(issue.title || '');
  var idHtml = escapeHtml(issue.identifier || '');

  // Check if this issue is blocked by a cross-lane item
  var blockers = blockedByMap ? (blockedByMap.get(issue.id) || []) : [];
  var isBlocked = blockers.length > 0;
  var blockedClass = isBlocked ? ' blocked' : '';

  var html = '<div class="swim-box ' + stateClass(issue.stateType) + compactClass + blockedClass +
    '" data-issue-id="' + escapeHtml(issue.id) + '">' +
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

function render() {
  var settings = getSettings();
  var result = assignLanes(allIssues, {
    maxLanes: settings.maxLanes,
    grouping: settings.grouping,
    showCompleted: settings.showCompleted,
    projectOrder: projectOrder
  });

  var lanes = result.lanes;

  // Assign segments and compute global widths
  assignSegments(lanes, { grouping: settings.grouping });
  var slotWidth = settings.compact ? 140 : 210;

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

  // Collect all segment indices in order
  var segmentKeys = Object.keys(segmentWidths).map(Number).sort(function(a, b) { return a - b; });

  // Build blockedBy map for labels
  var blockedByMap = useColumns ? buildBlockedByMap(allIssues) : null;

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

      html += '<div class="swim-lane-segment" data-segment="' + segKey + '" style="min-width:' + minWidth + 'px">';

      if (useColumns && columnCounts && columnCounts[segKey] > 0) {
        // Column-based rendering: place items in column slots
        var totalCols = columnCounts[segKey];
        // Build a map: column → items for this lane+segment
        var itemsByCol = {};
        for (var ii = 0; ii < segItems.length; ii++) {
          var col = segItems[ii].column !== undefined ? segItems[ii].column : ii;
          if (!itemsByCol[col]) itemsByCol[col] = [];
          itemsByCol[col].push(segItems[ii]);
        }

        var prevColItem = null;
        for (var col = 0; col < totalCols; col++) {
          var colItems = itemsByCol[col] || [];
          // Insert grey arrow for non-blocking sequence; blocking pairs get SVG connector instead
          if (colItems.length > 0 && prevColItem) {
            var isBlocking = prevColItem.blocksIds && prevColItem.blocksIds.indexOf(colItems[0].id) !== -1;
            if (!isBlocking) {
              html += '<span class="swim-lane-arrow">\u2192</span>';
            }
            // blocking pairs: no HTML arrow — SVG connector will be drawn
          }
          html += '<div class="swim-column-slot" data-column="' + col + '" style="min-width:' + slotWidth + 'px">';
          for (var ci = 0; ci < colItems.length; ci++) {
            html += renderBox(colItems[ci], settings, blockedByMap);
          }
          html += '</div>';
          if (colItems.length > 0) prevColItem = colItems[colItems.length - 1];
        }
      } else {
        // Default packed rendering (no columns)
        var rendered = new Set();
        for (var ii = 0; ii < segItems.length; ii++) {
          var issue = segItems[ii];
          if (rendered.has(issue.id)) continue;

          // Check if this is a parent with children in this segment
          var children = segItems.filter(function(item) {
            return item.parentId === issue.id && !rendered.has(item.id);
          });

          if (children.length > 0 && !issue.parentId) {
            html += '<div class="swim-group">';
            html += '<div class="swim-group-label">' + escapeHtml(issue.title || '').slice(0, 20) + '</div>';
            html += '<div class="swim-group-items">';
            html += renderBox(issue, settings);
            rendered.add(issue.id);
            for (var ci = 0; ci < children.length; ci++) {
              var childBlocked = issue.blocksIds && issue.blocksIds.indexOf(children[ci].id) !== -1;
              if (!childBlocked) {
                html += '<span class="swim-lane-arrow">\u2192</span>';
              }
              html += renderBox(children[ci], settings);
              rendered.add(children[ci].id);
            }
            html += '</div></div>';
          } else {
            if (ii > 0 && !rendered.has(issue.id)) {
              var prevIssue = segItems[ii - 1];
              var prevBlocks = prevIssue && prevIssue.blocksIds && prevIssue.blocksIds.indexOf(issue.id) !== -1;
              if (!prevBlocks) {
                html += '<span class="swim-lane-arrow">\u2192</span>';
              }
            }
            html += renderBox(issue, settings);
            rendered.add(issue.id);
          }
        }
      }

      html += '</div>';
    }

    html += '</div></div>';
  }

  container.innerHTML = html;

  // Draw SVG connectors for cross-lane blocking
  if (useColumns) {
    // Use requestAnimationFrame to ensure DOM is laid out before measuring
    requestAnimationFrame(function() {
      drawBlockingConnectors(lanes, blockedByMap);
    });
  }
}

// =============================================================================
// SVG Connector Lines
// =============================================================================

function drawBlockingConnectors(lanes, blockedByMap) {
  // Remove any existing SVG
  var existing = document.getElementById('swim-connectors');
  if (existing) existing.remove();

  if (!blockedByMap) return;

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
  blockedByMap.forEach(function(blockers, blockedId) {
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

  var totalEdges = crossLaneEdges.length + sameLaneAdjacentEdges.length + sameLaneArcEdges.length;
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
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '8');
  marker.setAttribute('orient', 'auto');
  var arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrowPath.setAttribute('d', 'M0,1 L7,4 L0,7 Z');
  arrowPath.setAttribute('fill', '#e67e22');
  arrowPath.setAttribute('opacity', '0.7');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
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

  document.getElementById('swim-popover-id').textContent = issue.identifier || issue.id;
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

  return chain;
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
  var settings = {
    grouping: document.getElementById('swim-grouping').value,
    maxLanes: parseInt(document.getElementById('swim-max-lanes').value, 10),
    compact: document.getElementById('swim-compact').checked,
    showCompleted: document.getElementById('swim-show-completed').checked,
    showBlockers: document.getElementById('swim-show-blockers').checked
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
document.getElementById('swim-show-completed').addEventListener('change', onSettingsChange);
document.getElementById('swim-show-blockers').addEventListener('change', onSettingsChange);

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

// Close popover
document.getElementById('swim-popover-close').addEventListener('click', hidePopover);
document.addEventListener('click', function(e) {
  if (!popoverEl.contains(e.target) && !e.target.closest('.swim-box')) {
    hidePopover();
  }
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') hidePopover();
});

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
