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

  if (grouping === 'project' || grouping === 'dependency') {
    sortLanesByProjectOrder(lanes, projectOrder);
  }

  lanes = mergeLanes(lanes, maxLanes);
  return { lanes: lanes };
}

function sortLanesByProjectOrder(lanes, projectOrder) {
  function getLaneSortKey(lane) {
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
  lanes.sort(function(a, b) { return getLaneSortKey(a) - getLaneSortKey(b); });
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
    var idx = idToIndex.get(id) || 0;
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

function computeSegmentWidths(lanes, slotWidth) {
  // Find the max number of items per segment across all lanes
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

  return {
    grouping: stored.grouping || document.getElementById('swim-grouping').value,
    maxLanes: stored.maxLanes || parseInt(document.getElementById('swim-max-lanes').value, 10),
    compact: stored.compact !== undefined ? stored.compact : document.getElementById('swim-compact').checked,
    showCompleted: stored.showCompleted !== undefined ? stored.showCompleted : document.getElementById('swim-show-completed').checked
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

function renderBox(issue, settings) {
  var compactClass = settings.compact ? ' compact' : '';
  var titleHtml = escapeHtml(issue.title || '');
  var idHtml = escapeHtml(issue.identifier || '');

  var html = '<div class="swim-box ' + stateClass(issue.stateType) + compactClass +
    '" data-issue-id="' + escapeHtml(issue.id) + '">' +
    stateIndicator(issue.stateType) +
    '<span class="swim-box-id">' + idHtml + '</span>' +
    '<span class="swim-box-title">' + titleHtml + '</span>' +
    '</div>';

  return html;
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
  var segmentWidths = computeSegmentWidths(lanes, slotWidth);

  var container = document.getElementById('swim-lanes');

  if (lanes.length === 0) {
    container.innerHTML = '<div class="swim-empty">No tasks to display</div>';
    return;
  }

  // Collect all segment indices in order
  var segmentKeys = Object.keys(segmentWidths).map(Number).sort(function(a, b) { return a - b; });

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
            html += '<span class="swim-lane-arrow">\u2192</span>';
            html += renderBox(children[ci], settings);
            rendered.add(children[ci].id);
          }
          html += '</div></div>';
        } else {
          if (ii > 0 && !rendered.has(issue.id)) {
            html += '<span class="swim-lane-arrow">\u2192</span>';
          }
          html += renderBox(issue, settings);
          rendered.add(issue.id);
        }
      }

      html += '</div>';
    }

    html += '</div></div>';
  }

  container.innerHTML = html;
}

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
    showCompleted: document.getElementById('swim-show-completed').checked
  };
  document.querySelector('.swim-max-lanes-value').textContent = settings.maxLanes;
  saveSettings(settings);
  render();
}

document.getElementById('swim-grouping').addEventListener('change', onSettingsChange);
document.getElementById('swim-max-lanes').addEventListener('input', onSettingsChange);
document.getElementById('swim-compact').addEventListener('change', onSettingsChange);
document.getElementById('swim-show-completed').addEventListener('change', onSettingsChange);

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
  }

  render();
})();
