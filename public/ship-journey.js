/**
 * Ship Journey client (experimental, LIN-1675 P3).
 *
 * Plays back `window.__SHIP_JOURNEY_DATA__.waypoints` (ascending by
 * completedAt, already filtered server-side to placeable waypoints) as a
 * spiralling trail — each waypoint's bearing sets its angle
 * (lib/ship-layout.js's BEARING_TO_ANGLE convention: canvas-degree, bow toward
 * the north star at 270°) and its position in the sequence sets its radius, so
 * the trail grows outward over time. A north-star change breaks the trail
 * into a new segment (no connecting line across the change) and marks the
 * first waypoint of the new segment with a ★.
 *
 * Auto-fit (LIN-1682's window.computeFitZoom, common.js) recomputes on every
 * frame from the bounding box of the currently REVEALED points, so the view
 * zooms out as playback advances and more of the trail comes into frame.
 *
 * No-op when the map mount is absent (the server renders the honest thin-data
 * empty state instead of the map for a below-threshold journey).
 */
(function () {
  var DATA = window.__SHIP_JOURNEY_DATA__ || { waypoints: [], starChanges: [] };
  var svg = document.getElementById('ship-journey-map');
  if (!svg) return;

  var waypoints = DATA.waypoints || [];
  var starChanges = DATA.starChanges || [];
  if (!waypoints.length) return;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var BASE_RADIUS = 12;
  var RADIUS_STEP = 8;
  var MARKER_PAD = 6; // bounding-box padding for the marker's own radius

  function toXY(wp, index) {
    var radius = BASE_RADIUS + index * RADIUS_STEP;
    var rad = ((wp.angle || 0) * Math.PI) / 180;
    return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) };
  }
  var points = waypoints.map(toXY);

  // breakBefore[i] = the starChange that fell between waypoint i-1 and i's
  // completedAt, or null. Computed once — the underlying data never changes
  // during playback, only how much of it is revealed.
  var breakBefore = new Array(waypoints.length).fill(null);
  for (var i = 1; i < waypoints.length; i++) {
    var prevAt = waypoints[i - 1].completedAt;
    var currAt = waypoints[i].completedAt;
    for (var s = 0; s < starChanges.length; s++) {
      var at = starChanges[s].at;
      if (at > prevAt && at <= currAt) { breakBefore[i] = starChanges[s]; break; }
    }
  }

  var playBtn = document.getElementById('ship-journey-play');
  var stepBackBtn = document.getElementById('ship-journey-step-back');
  var stepForwardBtn = document.getElementById('ship-journey-step-forward');
  var scrub = document.getElementById('ship-journey-scrub');

  var currentIndex = waypoints.length - 1; // start fully revealed, matching the server-rendered scrub value
  var playTimer = null;

  function boundingBox(pts) {
    if (!pts.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].x < minX) minX = pts[i].x;
      if (pts[i].x > maxX) maxX = pts[i].x;
      if (pts[i].y < minY) minY = pts[i].y;
      if (pts[i].y > maxY) maxY = pts[i].y;
    }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function render() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var revealed = points.slice(0, currentIndex + 1);
    var box = boundingBox(revealed);
    var contentWidth = Math.max(1, box.maxX - box.minX + 2 * MARKER_PAD);
    var contentHeight = Math.max(1, box.maxY - box.minY + 2 * MARKER_PAD);
    var zoom = window.computeFitZoom({
      contentWidth: contentWidth,
      contentHeight: contentHeight,
      availWidth: 200,
      availHeight: 200,
      pad: 10,
      minZoom: 0.15,
      maxZoom: 4,
    });

    var g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', 'scale(' + zoom + ')');
    g.setAttribute('data-testid', 'ship-journey-trail');

    // Path segments, broken wherever a north-star change falls between two
    // consecutive revealed waypoints — no line is drawn across the change.
    var segStart = 0;
    for (var i = 1; i <= revealed.length; i++) {
      if (i === revealed.length || breakBefore[i]) {
        var seg = revealed.slice(segStart, i);
        if (seg.length > 1) {
          var d = 'M ' + seg.map(function (p) { return p.x + ',' + p.y; }).join(' L ');
          var path = document.createElementNS(SVG_NS, 'path');
          path.setAttribute('d', d);
          path.setAttribute('class', 'sj-trail-segment');
          g.appendChild(path);
        }
        segStart = i;
      }
    }

    for (var idx = 0; idx < revealed.length; idx++) {
      var p = revealed[idx];
      var wp = waypoints[idx];

      if (breakBefore[idx]) {
        var flag = document.createElementNS(SVG_NS, 'text');
        flag.setAttribute('x', String(p.x + 4));
        flag.setAttribute('y', String(p.y - 4));
        flag.setAttribute('class', 'sj-star-marker');
        flag.setAttribute('data-testid', 'ship-journey-star-marker');
        flag.textContent = '★';
        g.appendChild(flag);
      }

      var circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(p.x));
      circle.setAttribute('cy', String(p.y));
      circle.setAttribute('r', '3');
      circle.setAttribute('class', 'sj-waypoint');
      circle.setAttribute('data-testid', 'ship-journey-waypoint');
      circle.setAttribute('data-identifier', wp.identifier);
      circle.setAttribute('data-bearing', wp.bearing);
      g.appendChild(circle);
    }

    svg.appendChild(g);
  }

  function setIndex(next) {
    currentIndex = Math.max(0, Math.min(waypoints.length - 1, next));
    if (scrub) scrub.value = String(currentIndex);
    render();
  }

  function stop() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    if (playBtn) { playBtn.setAttribute('aria-pressed', 'false'); playBtn.textContent = '▶'; }
  }

  function play() {
    if (currentIndex >= waypoints.length - 1) currentIndex = -1; // replay from the start
    if (playBtn) { playBtn.setAttribute('aria-pressed', 'true'); playBtn.textContent = '⏸'; }
    playTimer = setInterval(function () {
      if (currentIndex >= waypoints.length - 1) { stop(); return; }
      setIndex(currentIndex + 1);
    }, 700);
  }

  if (playBtn) {
    playBtn.addEventListener('click', function () {
      if (playTimer) stop(); else play();
    });
  }
  if (stepBackBtn) stepBackBtn.addEventListener('click', function () { stop(); setIndex(currentIndex - 1); });
  if (stepForwardBtn) stepForwardBtn.addEventListener('click', function () { stop(); setIndex(currentIndex + 1); });
  if (scrub) {
    scrub.addEventListener('input', function () {
      stop();
      setIndex(parseInt(scrub.value, 10) || 0);
    });
  }

  render();
})();
