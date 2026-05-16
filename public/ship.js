/**
 * Ship Page — Client-side layout and interaction.
 *
 * Reads __SHIP_DATA__, computes positions via the same primitives as
 * lib/ship-layout.js (inlined here so the page has no build step), and renders
 * cards absolutely-positioned around the central ship rectangle.
 *
 * Popover behaviour copied from swim.js; card markup matches swim's .swim-box.
 */

(function () {
  // =============================================================================
  // Layout primitives (mirror of lib/ship-layout.js)
  // =============================================================================

  var SECTORS = {
    SHIP: 'ship',
    FORWARD: 'forward',
    STARBOARD: 'starboard',
    AFT: 'aft',
    PORT: 'port',
    DRIFT: 'drift'
  };

  var SECTOR_RANGES = {
    forward:   { start: 225, end: 315 },
    starboard: { start: 315, end: 45  },
    aft:       { start: 45,  end: 135 },
    port:      { start: 135, end: 225 }
  };

  var PRIORITY_RING = { 1: 0, 2: 1, 3: 2, 4: 3, 0: 4 };
  var RING_COUNT = 5;

  function hash32(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function hashFloat(str, salt) {
    return hash32((salt || '') + ':' + str) / 0x100000000;
  }

  function assignProjectSides(names) {
    var deduped = {};
    for (var i = 0; i < names.length; i++) {
      if (names[i]) deduped[names[i]] = true;
    }
    var sorted = Object.keys(deduped).sort();
    var sides = {};
    for (var j = 0; j < sorted.length; j++) {
      sides[sorted[j]] = j % 2 === 0 ? SECTORS.STARBOARD : SECTORS.PORT;
    }
    return sides;
  }

  function cardMatchesHeading(card, heading) {
    if (!heading || !heading.kind || !heading.name) return false;
    if (heading.kind === 'label') {
      var wanted = String(heading.name).toLowerCase();
      var labels = card.labels || [];
      for (var i = 0; i < labels.length; i++) {
        if (String(labels[i]).toLowerCase() === wanted) return true;
      }
      return false;
    }
    if (heading.kind === 'project') return card.projectName === heading.name;
    return false;
  }

  function buildSegments(cards, heading) {
    heading = heading || null;
    var ship = [], heads = [], bugs = [], drift = [], byProject = {};
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.stateType === 'started') { ship.push(c); continue; }
      if (heading && cardMatchesHeading(c, heading)) { heads.push(c); continue; }
      var labels = (c.labels || []).map(function (l) { return String(l).toLowerCase(); });
      if (labels.indexOf('bug') !== -1) { bugs.push(c); continue; }
      if (c.projectName) {
        if (!byProject[c.projectName]) byProject[c.projectName] = [];
        byProject[c.projectName].push(c);
      } else {
        drift.push(c);
      }
    }

    // Skip projects whose remaining cards are entirely backlog — functionally
    // dormant, no need to claim a port/starboard segment for them.
    var pnames = Object.keys(byProject);
    for (var pn = 0; pn < pnames.length; pn++) {
      var pgroup = byProject[pnames[pn]];
      var allBacklog = true;
      for (var pc = 0; pc < pgroup.length; pc++) {
        if (pgroup[pc].stateType !== 'backlog') { allBacklog = false; break; }
      }
      if (allBacklog) delete byProject[pnames[pn]];
    }

    // Project-side alternation runs only over projects that produce segments
    // (i.e. have non-started, non-heading, non-bug cards). Keeps the project-
    // heading naturally out of the port/starboard rotation.
    var projectSide = assignProjectSides(Object.keys(byProject));

    var segments = [];

    // Forward: heading (always pushed when a heading is set so seam lines and
    // segment label render even with an empty arc).
    if (heading) {
      segments.push({
        id: 'heading:' + (heading.id || heading.name),
        label: heading.name,
        sector: SECTORS.FORWARD,
        range: { start: 225, end: 315 },
        cards: heads
      });
    }

    if (bugs.length > 0) {
      segments.push({
        id: 'bugs', label: 'BUGS', sector: SECTORS.AFT,
        range: { start: 45, end: 135 }, cards: bugs
      });
    }

    var starboardProjects = [], portProjects = [];
    var projectNames = Object.keys(byProject).sort();
    for (var p = 0; p < projectNames.length; p++) {
      var name = projectNames[p];
      var entry = { name: name, group: byProject[name] };
      if (projectSide[name] === SECTORS.PORT) portProjects.push(entry);
      else starboardProjects.push(entry);
    }
    pushProjectSegs(segments, starboardProjects, 315, 90, SECTORS.STARBOARD);
    pushProjectSegs(segments, portProjects, 135, 90, SECTORS.PORT);

    return {
      segments: segments,
      shipCards: ship,
      driftCards: drift,
      headingCards: heads,
      projectSide: projectSide
    };
  }

  function pushProjectSegs(out, projects, startAngle, sideSpan, sector) {
    if (projects.length === 0) return;
    var step = sideSpan / projects.length;
    for (var i = 0; i < projects.length; i++) {
      var start = (startAngle + i * step) % 360;
      var end = (startAngle + (i + 1) * step) % 360;
      out.push({
        id: 'project:' + projects[i].name,
        label: projects[i].name,
        sector: sector,
        projectName: projects[i].name,
        range: { start: start, end: end },
        cards: projects[i].group
      });
    }
  }

  function midpointAngle(range) {
    var span = sectorSpan(range);
    return ((range.start + span / 2) % 360 + 360) % 360;
  }

  function stableById(a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  function makePoint(geom, angle, radius, ring, subRing, sector, segmentId) {
    var rad = angle * Math.PI / 180;
    return {
      x: geom.centerX + radius * Math.cos(rad),
      y: geom.centerY + radius * Math.sin(rad),
      ring: ring, subRing: subRing, angle: angle, sector: sector,
      segmentId: segmentId || null
    };
  }

  function placeSegmentBucket(segment, geom, cardPitch, positions, proximityRings) {
    if (!segment.cards || segment.cards.length === 0) return;
    var byPriority = {};
    for (var i = 0; i < segment.cards.length; i++) {
      var c = segment.cards[i];
      var ring = (proximityRings && proximityRings[c.id] !== undefined)
        ? proximityRings[c.id]
        : priorityToRing(c.priority);
      if (!byPriority[ring]) byPriority[ring] = [];
      byPriority[ring].push(c);
    }
    var range = segment.range;
    var span = sectorSpan(range);
    var subRingStep = Math.max(geom.ringSpacing * 0.55, 75);
    var SEAM_CLEAR_PX = (cardPitch / 2) + 6;
    var ringKeys = Object.keys(byPriority).map(Number).sort(function (a, b) { return a - b; });

    for (var ri = 0; ri < ringKeys.length; ri++) {
      var baseRing = ringKeys[ri];
      // Topo-order bucket so blockers / parents slice into inner sub-rings.
      var group = orderByDependency(byPriority[baseRing]);
      var baseR = ringRadius(baseRing, geom);
      var subRing = 0, cursor = 0;
      while (cursor < group.length) {
        var r = baseR + subRing * subRingStep;
        var angBufDeg = (SEAM_CLEAR_PX / r) * (180 / Math.PI);
        var usable = Math.max(0, span - 2 * angBufDeg);
        var arc = (usable * Math.PI / 180) * r;
        var capacity = Math.max(1, Math.floor(arc / cardPitch) + 1);
        var remaining = group.length - cursor;
        var here = Math.min(capacity, remaining);
        // Cluster subtask siblings angularly within the sub-ring slice.
        var slice = clusterSubtaskSiblings(group.slice(cursor, cursor + here));
        var step = here > 1 ? usable / here : 0;
        var staggerOffset;
        if (here === 1) {
          staggerOffset = subRing % 2 === 0 ? usable / 3 : (2 * usable) / 3;
        } else {
          staggerOffset = subRing % 2 === 0 ? step / 2 : step;
        }

        for (var k = 0; k < here; k++) {
          var card = slice[k];
          var angle = ((range.start + angBufDeg + staggerOffset + k * step) % 360 + 360) % 360;
          var jitter = (hashFloat(card.id, 'r') - 0.5) * subRingStep * 0.2;
          positions[card.id] = makePoint(geom, angle, r + jitter, baseRing, subRing, segment.sector, segment.id);
        }
        cursor += here;
        subRing++;
      }
    }
  }

  // Topological order within a bucket. Mirror of lib/ship-layout.js
  // orderByDependency — Kahn's algorithm with stable id tiebreak.
  function orderByDependency(cards) {
    if (cards.length <= 1) return cards.slice();
    var idSet = {};
    for (var i = 0; i < cards.length; i++) idSet[cards[i].id] = true;
    var byId = {};
    for (var j = 0; j < cards.length; j++) byId[cards[j].id] = cards[j];
    var out = {};
    var indeg = {};
    for (var k = 0; k < cards.length; k++) indeg[cards[k].id] = 0;
    for (var n = 0; n < cards.length; n++) {
      var card = cards[n];
      var blocks = card.blocksIds || [];
      for (var b = 0; b < blocks.length; b++) {
        var blockedId = blocks[b];
        if (idSet[blockedId]) {
          if (!out[card.id]) out[card.id] = [];
          out[card.id].push(blockedId);
          indeg[blockedId] = indeg[blockedId] + 1;
        }
      }
      if (card.parentId && idSet[card.parentId]) {
        if (!out[card.parentId]) out[card.parentId] = [];
        out[card.parentId].push(card.id);
        indeg[card.id] = indeg[card.id] + 1;
      }
    }

    var ready = cards.filter(function (c) { return indeg[c.id] === 0; }).slice().sort(stableById);
    var result = [];
    while (ready.length > 0) {
      var cur = ready.shift();
      result.push(cur);
      var children = out[cur.id] || [];
      for (var ci = 0; ci < children.length; ci++) {
        var childId = children[ci];
        var d = indeg[childId] - 1;
        indeg[childId] = d;
        if (d === 0) {
          var cc = byId[childId];
          var ii = 0;
          while (ii < ready.length && stableById(ready[ii], cc) < 0) ii++;
          ready.splice(ii, 0, cc);
        }
      }
    }

    if (result.length < cards.length) {
      var seen = {};
      for (var s = 0; s < result.length; s++) seen[result[s].id] = true;
      var leftover = cards.filter(function (c) { return !seen[c.id]; }).slice().sort(stableById);
      for (var lo = 0; lo < leftover.length; lo++) result.push(leftover[lo]);
    }
    return result;
  }

  // Cluster subtask siblings inside a sub-ring slice. Mirror of
  // lib/ship-layout.js clusterSubtaskSiblings.
  function clusterSubtaskSiblings(orderedCards) {
    if (orderedCards.length <= 1) return orderedCards.slice();
    var idSet = {};
    for (var i = 0; i < orderedCards.length; i++) idSet[orderedCards[i].id] = true;
    var byId = {};
    for (var j = 0; j < orderedCards.length; j++) byId[orderedCards[j].id] = orderedCards[j];

    function familyKey(card) {
      var cur = card;
      while (cur.parentId) {
        if (idSet[cur.parentId]) cur = byId[cur.parentId];
        else return 'external:' + cur.parentId;
      }
      return 'root:' + cur.id;
    }

    var families = {};
    var familyOrder = [];
    for (var k = 0; k < orderedCards.length; k++) {
      var c = orderedCards[k];
      var key = familyKey(c);
      if (!families[key]) { families[key] = []; familyOrder.push(key); }
      families[key].push(c);
    }
    var result = [];
    for (var fo = 0; fo < familyOrder.length; fo++) {
      var fam = families[familyOrder[fo]];
      for (var f = 0; f < fam.length; f++) result.push(fam[f]);
    }
    return result;
  }

  function placeDriftBucket(cards, geom, cardPitch, positions) {
    if (cards.length === 0) return;
    var sorted = cards.slice().sort(stableById);
    var baseR = ringRadius(RING_COUNT, geom);
    var subRingStep = geom.ringSpacing * 0.4;
    var subRing = 0, cursor = 0;
    while (cursor < sorted.length) {
      var r = baseR + subRing * subRingStep;
      var arc = 2 * Math.PI * r;
      var capacity = Math.max(4, Math.floor(arc / cardPitch));
      var remaining = sorted.length - cursor;
      var here = Math.min(capacity, remaining);
      var step = 360 / here;
      for (var k = 0; k < here; k++) {
        var card = sorted[cursor + k];
        var angle = (k * step) % 360;
        var jitter = (hashFloat(card.id, 'r') - 0.5) * subRingStep * 0.25;
        positions[card.id] = makePoint(geom, angle, r + jitter, RING_COUNT, subRing, SECTORS.DRIFT);
      }
      cursor += here;
      subRing++;
    }
  }

  function runLayout(cards, geom, cardPitch, heading, cardSize) {
    var built = buildSegments(cards, heading || null);
    var orbitCards = built.driftCards.slice();
    for (var s = 0; s < built.segments.length; s++) {
      orbitCards = orbitCards.concat(built.segments[s].cards);
    }
    var proximityRings = computeProximityRings(orbitCards, built.shipCards);
    var positions = {};
    for (var s2 = 0; s2 < built.segments.length; s2++) {
      placeSegmentBucket(built.segments[s2], geom, cardPitch, positions, proximityRings);
    }
    placeDriftBucket(built.driftCards, geom, cardPitch, positions);
    resolveCollisions(positions, geom, cardSize || CARD_SIZE);
    return {
      positions: positions,
      segments: built.segments,
      shipCards: built.shipCards,
      driftCards: built.driftCards,
      headingCards: built.headingCards || []
    };
  }

  // Iterative anti-collision pass. Mirror of lib/ship-layout.js
  // resolveCollisions — nudges the lower-priority / further-out card of each
  // overlapping pair radially outward, preserving angle (and therefore
  // segment membership) by construction.
  function resolveCollisions(positions, geom, cardSize) {
    var W = cardSize.width, H = cardSize.height;
    var PAD = 4, STEP = 8, MAX_ITER = 80;
    var cx = geom.centerX, cy = geom.centerY;

    var entries = [];
    for (var id in positions) entries.push({ id: id, pos: positions[id] });

    for (var iter = 0; iter < MAX_ITER; iter++) {
      var moved = false;
      for (var i = 0; i < entries.length; i++) {
        for (var j = i + 1; j < entries.length; j++) {
          var ea = entries[i], eb = entries[j];
          var a = ea.pos, b = eb.pos;
          if (Math.abs(a.x - b.x) >= W + PAD) continue;
          if (Math.abs(a.y - b.y) >= H + PAD) continue;

          var loser;
          if (a.ring !== b.ring) {
            loser = a.ring > b.ring ? a : b;
          } else if (a.subRing !== b.subRing) {
            loser = a.subRing > b.subRing ? a : b;
          } else {
            var rA = Math.hypot(a.x - cx, a.y - cy);
            var rB = Math.hypot(b.x - cx, b.y - cy);
            if (Math.abs(rA - rB) > 0.5) {
              loser = rA > rB ? a : b;
            } else {
              loser = ea.id < eb.id ? b : a;
            }
          }
          var rL = Math.hypot(loser.x - cx, loser.y - cy) + STEP;
          var rad = loser.angle * Math.PI / 180;
          loser.x = cx + rL * Math.cos(rad);
          loser.y = cy + rL * Math.sin(rad);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  function sectorSpan(range) {
    if (range.start <= range.end) return range.end - range.start;
    return (360 - range.start) + range.end;
  }

  function pickAngle(card, sector) {
    var h = hashFloat(card.id, 'a');
    if (sector === SECTORS.DRIFT) return h * 360;
    var range = SECTOR_RANGES[sector];
    if (!range) return h * 360;
    var span = sectorSpan(range);
    var usable = span * 0.8;
    var offset = span * 0.1;
    return ((range.start + offset + h * usable) % 360 + 360) % 360;
  }

  function priorityToRing(p) {
    return PRIORITY_RING[p] !== undefined ? PRIORITY_RING[p] : PRIORITY_RING[0];
  }

  // Mirror of lib/ship-layout.js computeProximityRings. Pipeline:
  //   1. Priority → initial ring
  //   2. completed/canceled → outermost
  //   3. blocker of in-progress (transitive) → innermost
  //   4. parent of in-progress descendant → innermost
  //   5. subtask coherence → min ring within subtask tree
  function computeProximityRings(orbitCards, shipCards) {
    var INNERMOST = 0;
    var OUTERMOST = RING_COUNT - 1;
    var orbitById = {};
    for (var i = 0; i < orbitCards.length; i++) orbitById[orbitCards[i].id] = orbitCards[i];
    var allCards = orbitCards.concat(shipCards || []);
    var allById = {};
    for (var j = 0; j < allCards.length; j++) allById[allCards[j].id] = allCards[j];

    var ring = {};
    for (var k = 0; k < orbitCards.length; k++) {
      ring[orbitCards[k].id] = priorityToRing(orbitCards[k].priority);
    }
    for (var k2 = 0; k2 < orbitCards.length; k2++) {
      var c2 = orbitCards[k2];
      if (c2.stateType === 'completed' || c2.stateType === 'canceled') {
        ring[c2.id] = OUTERMOST;
      }
    }

    var blockersOf = {};
    for (var m = 0; m < allCards.length; m++) {
      var card2 = allCards[m];
      var blocks = card2.blocksIds || [];
      for (var b = 0; b < blocks.length; b++) {
        if (!blockersOf[blocks[b]]) blockersOf[blocks[b]] = [];
        blockersOf[blocks[b]].push(card2.id);
      }
    }

    var queue = (shipCards || []).map(function (sc) { return sc.id; });
    var visited = {};
    for (var q = 0; q < queue.length; q++) visited[queue[q]] = true;

    while (queue.length > 0) {
      var id = queue.shift();
      var blockers = blockersOf[id] || [];
      for (var bi = 0; bi < blockers.length; bi++) {
        var bId = blockers[bi];
        if (!visited[bId] && orbitById[bId]) {
          visited[bId] = true;
          ring[bId] = INNERMOST;
          queue.push(bId);
        }
      }
      var asCard = allById[id];
      if (asCard && asCard.parentId && !visited[asCard.parentId]) {
        visited[asCard.parentId] = true;
        if (orbitById[asCard.parentId]) ring[asCard.parentId] = INNERMOST;
        queue.push(asCard.parentId);
      }
    }

    var uf = {};
    for (var u = 0; u < orbitCards.length; u++) uf[orbitCards[u].id] = orbitCards[u].id;
    function find(x) {
      var root = x;
      while (uf[root] !== root) root = uf[root];
      var cur = x;
      while (uf[cur] !== root) { var next = uf[cur]; uf[cur] = root; cur = next; }
      return root;
    }
    function union(a, c) {
      var ra = find(a), rc = find(c);
      if (ra !== rc) uf[ra] = rc;
    }
    for (var p = 0; p < orbitCards.length; p++) {
      var cp = orbitCards[p];
      if (cp.parentId && orbitById[cp.parentId]) union(cp.id, cp.parentId);
    }
    var groupMin = {};
    for (var g = 0; g < orbitCards.length; g++) {
      var cg = orbitCards[g];
      var root = find(cg.id);
      var r = ring[cg.id];
      if (groupMin[root] === undefined || r < groupMin[root]) groupMin[root] = r;
    }
    for (var g2 = 0; g2 < orbitCards.length; g2++) {
      var cg2 = orbitCards[g2];
      var target = groupMin[find(cg2.id)];
      if (target !== undefined && target < ring[cg2.id]) ring[cg2.id] = target;
    }

    return ring;
  }

  function ringRadius(idx, geom) {
    var shipBound = Math.sqrt(geom.shipHalfWidth * geom.shipHalfWidth + geom.shipHalfHeight * geom.shipHalfHeight);
    var firstGap = geom.firstRingGap !== undefined ? geom.firstRingGap : 40;
    return shipBound + firstGap + idx * geom.ringSpacing;
  }

  function computePosition(card, sector, geom) {
    if (sector === SECTORS.SHIP) return null;
    var ring = priorityToRing(card.priority);
    var baseR = ringRadius(ring, geom);
    var angle = pickAngle(card, sector);
    var radialJitter = (hashFloat(card.id, 'r') - 0.5) * (geom.ringSpacing * 0.35);
    var radius = baseR + radialJitter;
    var rad = angle * Math.PI / 180;
    return {
      x: geom.centerX + radius * Math.cos(rad),
      y: geom.centerY + radius * Math.sin(rad),
      ring: ring,
      angle: angle
    };
  }

  function computeShipDimensions(n, cardSize) {
    var rows = Math.max(1, Math.ceil(n / 2));
    var GRID_PAD = 16, LABEL_AREA = 20, GAP = 8;
    return {
      width: 2 * cardSize.width + GAP + 2 * GRID_PAD,
      height: rows * cardSize.height + (rows - 1) * GAP + LABEL_AREA + 2 * GRID_PAD,
      rows: rows,
      padding: GRID_PAD,
      labelArea: LABEL_AREA,
      gap: GAP
    };
  }

  // =============================================================================
  // Card markup (matches swim's .swim-box)
  // =============================================================================

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stateIndicator(stateType) {
    switch (stateType) {
      case 'completed': case 'canceled': return '<span class="swim-box-state done">✓</span>';
      case 'started': return '<span class="swim-box-state in-progress">◐</span>';
      case 'backlog': return '<span class="swim-box-state backlog">◌</span>';
      default: return '<span class="swim-box-state todo">○</span>';
    }
  }

  function stateClass(stateType) {
    return 'state-' + (stateType || 'unstarted');
  }

  function renderCardHtml(card) {
    return (
      '<div class="swim-box ' + stateClass(card.stateType) +
      '" data-issue-id="' + escapeHtml(card.id) + '">' +
      stateIndicator(card.stateType) +
      '<span class="swim-box-title">' + escapeHtml(card.title || '') + '</span>' +
      '<span class="swim-box-id">' + escapeHtml(card.identifier || '') + '</span>' +
      '</div>'
    );
  }

  // =============================================================================
  // Render
  // =============================================================================

  // height matches the natural rendered swim-box at width 160 (line-clamp 2 +
  // swim.css padding). Used for collision detection; the ship rect's actual
  // height is measured from the DOM (see render()).
  var CARD_SIZE = { width: 160, height: 69 };
  // Priority bands. ringSpacing must comfortably fit two sub-rings (subRingStep
  // ≥ cardHeight + small gap = 75). 150 leaves 75px headroom = exactly two
  // sub-ring layers per band before bleeding into the next priority.
  var RING_SPACING = 150;
  var FIRST_RING_GAP = 40;
  var SECTOR_LABEL_OFFSET = 36; // px past outer ring
  var CARD_PITCH = 180; // min spacing between card centres along an arc

  function loadHeading() {
    try {
      var raw = window.localStorage.getItem('ship-settings');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var h = parsed && parsed.heading;
      if (!h || !h.kind || !h.name) return null;
      return h;
    } catch (e) {
      return null;
    }
  }

  function saveHeading(heading) {
    try {
      var raw = window.localStorage.getItem('ship-settings');
      var parsed = raw ? JSON.parse(raw) : {};
      parsed.heading = heading || null;
      window.localStorage.setItem('ship-settings', JSON.stringify(parsed));
    } catch (e) { /* ignore */ }
  }

  function uniqueProjects(issues) {
    var seen = {};
    var names = [];
    for (var i = 0; i < issues.length; i++) {
      var n = issues[i].projectName;
      if (n && !seen[n]) { seen[n] = true; names.push(n); }
    }
    names.sort();
    return names;
  }

  function uniqueLabels(issues) {
    var seen = {};
    var names = [];
    for (var i = 0; i < issues.length; i++) {
      var labels = issues[i].labels || [];
      for (var j = 0; j < labels.length; j++) {
        var n = String(labels[j]);
        var k = n.toLowerCase();
        if (!seen[k]) { seen[k] = true; names.push(n); }
      }
    }
    names.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    return names;
  }

  function render() {
    var data = window.__SHIP_DATA__ || { issues: [] };
    var issues = data.issues || [];
    var heading = loadHeading();

    // The rect's *width* is deterministic (2-wide silhouette is constant).
    // Its *height* depends on the natural rendered height of swim-box cards,
    // which varies with font, padding, line-clamp, etc. We trust the DOM:
    //   1) Render the WIP cards into the rect with width + padding set inline
    //      but height left CSS-auto.
    //   2) Read offsetHeight back. That's the authoritative height.
    //   3) Use it for shipHalfHeight in the orbit layout.
    //
    // This makes the rect resilient to swim-box style changes — there's no
    // fragile CARD_SIZE.height constant to keep in sync.
    var inProgressCount = 0;
    var shipCardsPreview = [];
    for (var ii = 0; ii < issues.length; ii++) {
      if (issues[ii].stateType === 'started') {
        inProgressCount++;
        shipCardsPreview.push(issues[ii]);
      }
    }

    // Compute width-only dimensions (height is a placeholder we'll overwrite).
    var ship = computeShipDimensions(Math.max(1, inProgressCount), CARD_SIZE);

    // Pre-render WIP cards into the rect so we can measure the natural height.
    var shipElPre = document.getElementById('ship-rect');
    var shipCardsElPre = document.getElementById('ship-rect-cards');
    shipCardsElPre.innerHTML = shipCardsPreview.length === 0
      ? '<div class="ship-rect-empty">no work in progress</div>'
      : shipCardsPreview.map(renderCardHtml).join('');
    shipElPre.style.width = ship.width + 'px';
    shipElPre.style.height = ''; // let CSS size to content
    shipElPre.style.padding =
      (ship.padding + ship.labelArea) + 'px ' +
      ship.padding + 'px ' +
      ship.padding + 'px';
    // Off-canvas while we measure to avoid a layout flash.
    shipElPre.style.left = '-99999px';
    shipElPre.style.top = '-99999px';
    var measuredHeight = shipElPre.offsetHeight;
    // Empty-state fallback: keep a sensible minimum so the silhouette persists.
    if (!measuredHeight || measuredHeight < 80) {
      measuredHeight = 80;
    }
    ship.height = measuredHeight;

    var geom = {
      centerX: 0, centerY: 0,
      shipHalfWidth: ship.width / 2,
      shipHalfHeight: ship.height / 2,
      ringSpacing: RING_SPACING,
      firstRingGap: FIRST_RING_GAP
    };

    // Sized canvas needs to know the maximum sub-ring used, which depends on
    // density. Run the layout once at a placeholder centre, measure max radius,
    // then size canvas and re-run with proper centre.
    geom.centerX = 0; geom.centerY = 0;
    var probe = runLayout(issues, geom, CARD_PITCH, heading);
    var maxR = ringRadius(RING_COUNT - 1, geom);
    for (var id in probe.positions) {
      var p = probe.positions[id];
      var d = Math.sqrt(p.x * p.x + p.y * p.y);
      if (d > maxR) maxR = d;
    }
    var halfSize = Math.ceil(maxR + CARD_SIZE.width / 2 + SECTOR_LABEL_OFFSET + 16);

    var pageEl = document.querySelector('.ship-page');
    var viewportW = pageEl ? pageEl.clientWidth : 1200;
    var viewportH = pageEl ? pageEl.clientHeight : 800;
    var canvasSize = Math.max(viewportW, viewportH, halfSize * 2);

    geom.centerX = canvasSize / 2;
    geom.centerY = canvasSize / 2;
    var result = runLayout(issues, geom, CARD_PITCH, heading);

    var canvas = document.getElementById('ship-canvas');
    canvas.style.width = canvasSize + 'px';
    canvas.style.height = canvasSize + 'px';

    // Ship rect — set padding inline so CSS can't drift from the JS-computed
    // dimensions. Top padding includes label-area + grid-pad; the other three
    // sides use grid-pad so breathing is consistent around the WIP grid.
    var shipEl = document.getElementById('ship-rect');
    shipEl.style.left = (geom.centerX - ship.width / 2) + 'px';
    shipEl.style.top = (geom.centerY - ship.height / 2) + 'px';
    shipEl.style.width = ship.width + 'px';
    shipEl.style.height = ship.height + 'px';
    shipEl.style.padding =
      (ship.padding + ship.labelArea) + 'px ' +
      ship.padding + 'px ' +
      ship.padding + 'px';

    var shipCardsEl = document.getElementById('ship-rect-cards');
    if (result.shipCards.length === 0) {
      shipCardsEl.innerHTML = '<div class="ship-rect-empty">no work in progress</div>';
    } else {
      shipCardsEl.innerHTML = result.shipCards.map(renderCardHtml).join('');
    }

    // Orbit
    var orbit = document.getElementById('ship-orbit');
    orbit.innerHTML = '';
    var fragments = [];
    for (var i = 0; i < issues.length; i++) {
      var card = issues[i];
      var pos = result.positions[card.id];
      if (!pos) continue;
      var el = document.createElement('div');
      el.innerHTML = renderCardHtml(card);
      var node = el.firstChild;
      node.style.left = pos.x + 'px';
      node.style.top = pos.y + 'px';
      node.setAttribute('data-sector', pos.sector);
      node.setAttribute('data-ring', pos.ring);
      node.setAttribute('data-sub-ring', pos.subRing);
      if (pos.segmentId) node.setAttribute('data-segment', pos.segmentId);
      fragments.push(node);
    }
    fragments.forEach(function (n) { orbit.appendChild(n); });

    drawSegmentGuides(geom, canvasSize, ship, result.segments);
    renderHeadingControl(heading, issues, geom, ship);

    if (pageEl) {
      pageEl.scrollLeft = geom.centerX - viewportW / 2;
      pageEl.scrollTop = geom.centerY - viewportH / 2;
    }
  }

  // ===========================================================================
  // Heading control (chip + picker, positioned above the ship rect)
  // ===========================================================================

  function renderHeadingControl(heading, issues, geom, ship) {
    var control = document.getElementById('ship-heading-control');
    if (!control) return;

    // Lift the chip well above the segment-label horizon (segment labels sit
    // ~26px past the ship edge). Sitting at that horizon makes the chip read
    // as "label of the top segment" rather than "annotation of the whole
    // chart"; pushing it higher gives the chart its top.
    var CHIP_GAP = 100; // px above the ship rect
    control.style.left = geom.centerX + 'px';
    control.style.top = (geom.centerY - ship.height / 2 - CHIP_GAP) + 'px';

    // Chip text
    var chipText = document.getElementById('ship-heading-chip-text');
    if (heading) {
      chipText.textContent = heading.name;
      chipText.parentElement.setAttribute('data-state', 'set');
    } else {
      chipText.textContent = 'pick a heading';
      chipText.parentElement.setAttribute('data-state', 'empty');
    }

    // Dropdown options (rebuild every render so newly-loaded issues show up).
    var projectSel = document.getElementById('ship-heading-project');
    var labelSel = document.getElementById('ship-heading-label');
    var projects = uniqueProjects(issues);
    var labels = uniqueLabels(issues);

    rebuildSelect(projectSel, projects,
      heading && heading.kind === 'project' ? heading.name : '');
    rebuildSelect(labelSel, labels,
      heading && heading.kind === 'label' ? heading.name : '');
  }

  function rebuildSelect(sel, names, currentValue) {
    while (sel.options.length > 1) sel.remove(1); // keep "— none —"
    for (var i = 0; i < names.length; i++) {
      var opt = document.createElement('option');
      opt.value = names[i];
      opt.textContent = names[i];
      sel.appendChild(opt);
    }
    sel.value = currentValue || '';
  }

  function wireHeadingControl() {
    var chip = document.getElementById('ship-heading-chip');
    var picker = document.getElementById('ship-heading-picker');
    var projectSel = document.getElementById('ship-heading-project');
    var labelSel = document.getElementById('ship-heading-label');
    var clearBtn = document.getElementById('ship-heading-clear');
    if (!chip || !picker) return;

    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !picker.classList.contains('hidden');
      if (open) {
        picker.classList.add('hidden');
        chip.setAttribute('aria-expanded', 'false');
      } else {
        picker.classList.remove('hidden');
        chip.setAttribute('aria-expanded', 'true');
      }
    });

    projectSel.addEventListener('change', function () {
      if (projectSel.value) {
        saveHeading({ kind: 'project', name: projectSel.value });
        labelSel.value = ''; // mutually exclusive
      } else {
        saveHeading(null);
      }
      picker.classList.add('hidden');
      chip.setAttribute('aria-expanded', 'false');
      render();
    });

    labelSel.addEventListener('change', function () {
      if (labelSel.value) {
        saveHeading({ kind: 'label', name: labelSel.value });
        projectSel.value = ''; // mutually exclusive
      } else {
        saveHeading(null);
      }
      picker.classList.add('hidden');
      chip.setAttribute('aria-expanded', 'false');
      render();
    });

    clearBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      saveHeading(null);
      picker.classList.add('hidden');
      chip.setAttribute('aria-expanded', 'false');
      render();
    });

    document.addEventListener('click', function (e) {
      if (picker.classList.contains('hidden')) return;
      if (picker.contains(e.target) || chip.contains(e.target)) return;
      picker.classList.add('hidden');
      chip.setAttribute('aria-expanded', 'false');
    });
  }

  function drawSegmentGuides(geom, canvasSize, ship, segments) {
    var existing = document.querySelector('.ship-sector-guide');
    if (existing) existing.remove();
    var existingLabels = document.querySelectorAll('.ship-sector-label');
    existingLabels.forEach(function (n) { n.remove(); });

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ship-sector-guide');
    svg.setAttribute('viewBox', '0 0 ' + canvasSize + ' ' + canvasSize);
    svg.setAttribute('width', canvasSize);
    svg.setAttribute('height', canvasSize);

    // Concentric rings (subtle reference for priority bands)
    for (var r = 0; r < RING_COUNT; r++) {
      var radius = ringRadius(r, geom);
      var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', geom.centerX);
      circle.setAttribute('cy', geom.centerY);
      circle.setAttribute('r', radius);
      svg.appendChild(circle);
    }

    // Seam lines: one at every unique segment boundary angle. Cardinal seams
    // (between sides) and inter-project seams (within a side) both included.
    var shipBound = Math.sqrt(geom.shipHalfWidth * geom.shipHalfWidth + geom.shipHalfHeight * geom.shipHalfHeight);
    var seamInner = shipBound + 6;
    var seamOuter = ringRadius(RING_COUNT - 1, geom) + RING_SPACING * 0.9;
    var seamAngles = {};
    // Always draw the 4 cardinal seams so the sides are visually delineated
    // even when a side holds no segments yet.
    [45, 135, 225, 315].forEach(function (a) { seamAngles[a] = true; });
    for (var s = 0; s < segments.length; s++) {
      seamAngles[segments[s].range.start] = true;
      seamAngles[segments[s].range.end] = true;
    }
    Object.keys(seamAngles).forEach(function (key) {
      var a = parseFloat(key);
      var rad = a * Math.PI / 180;
      var x1 = geom.centerX + seamInner * Math.cos(rad);
      var y1 = geom.centerY + seamInner * Math.sin(rad);
      var x2 = geom.centerX + seamOuter * Math.cos(rad);
      var y2 = geom.centerY + seamOuter * Math.sin(rad);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      svg.appendChild(line);
    });

    document.getElementById('ship-canvas').insertBefore(svg, document.getElementById('ship-rect'));

    // Segment labels: one chip per segment at its midpoint angle. Each label
    // is placed in two passes so its INNER edge (toward the ship) clears the
    // rect by a consistent gap — single-pass placement-by-center leaves wide
    // labels crashing into the rect at near-cardinal directions.
    //
    // The forward (heading) segment intentionally has no segment-horizon
    // label — the floating heading chip up above the chart owns that role,
    // which is what gives the forward direction its chart-annotation status
    // instead of reading as just another segment.
    var SEGMENT_LABEL_GAP = 14; // px of visible gap between rect edge and label
    var canvasEl = document.getElementById('ship-canvas');
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (seg.sector === SECTORS.FORWARD) continue;
      var midAngle = midpointAngle(seg.range);
      var rad2 = midAngle * Math.PI / 180;
      var cos = Math.cos(rad2), sin = Math.sin(rad2);
      // Distance from centre at which the ship's *bounding rectangle* ends in
      // this direction.
      var shipEdge = Math.min(
        Math.abs(geom.shipHalfWidth / (cos || 1e-6)),
        Math.abs(geom.shipHalfHeight / (sin || 1e-6))
      );

      var labEl = document.createElement('div');
      labEl.className = 'ship-sector-label';
      labEl.textContent = seg.label;
      labEl.title = seg.label;
      labEl.setAttribute('data-segment', seg.id);
      labEl.style.transform = 'translate(-50%, -50%)';
      // First-pass approximate position so we can measure dimensions.
      labEl.style.left = (geom.centerX + (shipEdge + 30) * cos) + 'px';
      labEl.style.top = (geom.centerY + (shipEdge + 30) * sin) + 'px';
      canvasEl.appendChild(labEl);

      // Project the label's bounding box onto the radial direction. That gives
      // the distance from its centre to its inner edge along the ray, so we
      // can push it out by exactly that much + gap to clear the rect.
      var lw = labEl.offsetWidth / 2;
      var lh = labEl.offsetHeight / 2;
      var projectedHalf = Math.abs(lw * cos) + Math.abs(lh * sin);
      var labR = shipEdge + SEGMENT_LABEL_GAP + projectedHalf;
      labEl.style.left = (geom.centerX + labR * cos) + 'px';
      labEl.style.top = (geom.centerY + labR * sin) + 'px';
    }
  }

  // =============================================================================
  // Popover (adapted from swim.js)
  // =============================================================================

  function findIssue(id) {
    var data = window.__SHIP_DATA__ || { issues: [] };
    for (var i = 0; i < data.issues.length; i++) {
      if (data.issues[i].id === id) return data.issues[i];
    }
    return null;
  }

  function openPopover(card, anchorEl) {
    var pop = document.getElementById('ship-popover');
    document.getElementById('ship-popover-id').textContent = card.identifier || '';
    document.getElementById('ship-popover-id').href = card.url || '#';
    document.getElementById('ship-popover-title').textContent = card.title || '';

    var meta = [];
    if (card.stateName) meta.push(card.stateName);
    if (card.projectName) meta.push(card.projectName);
    if (card.assignee) meta.push(card.assignee);
    if (card.labels && card.labels.length) meta.push(card.labels.join(', '));
    document.getElementById('ship-popover-meta').textContent = meta.join(' · ');

    document.getElementById('ship-popover-desc').textContent =
      (card.description || '').slice(0, 320);

    var link = document.getElementById('ship-popover-link');
    if (card.url) { link.href = card.url; link.style.display = ''; }
    else link.style.display = 'none';

    pop.classList.remove('hidden');

    // Position near the click, kept on-screen
    var rect = anchorEl.getBoundingClientRect();
    var popRect = pop.getBoundingClientRect();
    var left = rect.right + 12;
    var top = rect.top;
    if (left + popRect.width > window.innerWidth - 8) {
      left = Math.max(8, rect.left - popRect.width - 12);
    }
    if (top + popRect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - popRect.height - 8);
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function closePopover() {
    document.getElementById('ship-popover').classList.add('hidden');
  }

  function wirePopover() {
    document.addEventListener('click', function (e) {
      var box = e.target.closest('.swim-box');
      if (box) {
        var id = box.getAttribute('data-issue-id');
        var card = findIssue(id);
        if (card) {
          e.preventDefault();
          e.stopPropagation();
          openPopover(card, box);
        }
        return;
      }
      var pop = document.getElementById('ship-popover');
      if (pop && !pop.contains(e.target)) closePopover();
    });

    var closeBtn = document.getElementById('ship-popover-close');
    if (closeBtn) closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closePopover();
    });
  }

  // =============================================================================
  // Init
  // =============================================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    render();
    wirePopover();
    wireHeadingControl();
  }
})();
