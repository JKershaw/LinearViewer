/**
 * Ship Journey client (experimental, LIN-1675 P3/P5).
 *
 * Plays back `window.__SHIP_JOURNEY_DATA__.waypoints` (ascending by
 * completedAt, already filtered server-side to placeable waypoints) as a
 * cumulative walk — each waypoint's `x`/`y` is derived server-side
 * (lib/ship-journey.js's `derivePositions`) via a heading-inertia model: the
 * ship's heading turns toward each waypoint's bearing angle
 * (lib/ship-layout.js's BEARING_TO_ANGLE convention: canvas-degree, bow toward
 * the north star at 270°) by a bounded per-step turn rather than snapping to
 * it, then advances one unit along the resulting heading, so a direct
 * reversal arcs over several steps instead of flipping across the ship's own
 * wake. A north-star change breaks the trail into a new segment (no
 * connecting line across the change, heading and position reset to a fresh
 * berth). Because every fresh berth sits one unit from the same origin, the
 * ★ markers for those changes are collapsed into a single counted marker at
 * that origin rather than drawn per segment (LIN-2089).
 *
 * Auto-fit (LIN-1682's window.computeFitZoom, common.js) recomputes on every
 * frame from the bounding box of the currently REVEALED points, so the view
 * zooms out as playback advances and more of the trail comes into frame.
 *
 * Marker geometry is stated as a ratio against that one-unit step (LIN-2089):
 * a waypoint's PAINTED mark (2r plus its halo stroke) stays under 80% of the
 * step, so adjacent waypoints read as beads on a thread rather than merging
 * into a blob. The ratio is scale-invariant — dots and trail live inside the
 * zoomed <g>, so they shrink and grow with the fit exactly as the step does.
 * The ★ deliberately does the opposite (see render()).
 *
 * No-op when the map mount is absent (the server renders the honest thin-data
 * empty state instead of the map for a below-threshold journey).
 */
(function () {
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Marker geometry, in SVG user units against derivePositions' 1-unit step
  // (LIN-2089). The invariant — 2*RADIUS + HALO <= 0.8 * step, and
  // TRAIL_STROKE < HALO so the halo visibly cuts the trail where it passes
  // under a dot — is pinned by tests/unit/ship-journey-geometry.test.js.
  // HALO and TRAIL_STROKE are declared here and *rendered* from the matching
  // stroke-width declarations in public/ship-journey.css; keep the two files'
  // numbers in step by hand (same JS-owns-the-attribute, CSS-owns-the-paint
  // split this file already uses for the waypoint's fill and testids).
  var WAYPOINT_RADIUS = 0.32;
  var WAYPOINT_HALO = 0.1; // .sj-waypoint stroke-width
  var TRAIL_STROKE = 0.08; // .sj-trail-segment stroke-width
  // How far a dot actually paints beyond its own centre: the fill radius plus
  // half its centred halo stroke. Replaces LIN-1675 P3's blanket 6-unit
  // MARKER_PAD, which padded the content box by six whole steps.
  var DOT_REACH = WAYPOINT_RADIUS + WAYPOINT_HALO / 2;

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

  // Test-only seam (inert in the browser, where `module` is undefined): expose
  // the geometry constants and the pure bounding-box helper so the
  // ratio-invariant unit test can read the live numbers instead of a copy.
  // Sits ABOVE the DOM lookups below because those return early when the map
  // mount is absent — which is exactly the case in a vm sandbox. Same pattern
  // as public/ship-biscuit.js:211 / public/ship.js.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      WAYPOINT_RADIUS: WAYPOINT_RADIUS,
      WAYPOINT_HALO: WAYPOINT_HALO,
      TRAIL_STROKE: TRAIL_STROKE,
      DOT_REACH: DOT_REACH,
      boundingBox: boundingBox,
    };
  }

  var DATA = window.__SHIP_JOURNEY_DATA__ || { waypoints: [], starChanges: [] };
  var svg = document.getElementById('ship-journey-map');
  if (!svg) return;

  var waypoints = DATA.waypoints || [];
  var starChanges = DATA.starChanges || [];
  if (!waypoints.length) return;

  // x/y are derived server-side (lib/ship-journey.js's derivePositions) —
  // read directly rather than re-deriving placement client-side.
  var points = waypoints.map(function (wp) { return { x: wp.x, y: wp.y }; });

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

  function render() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var revealed = points.slice(0, currentIndex + 1);

    // Every segment break resets the walk to a fresh berth one unit from the
    // shared origin (lib/ship-journey.js's derivePositions), so ★ markers for
    // *different* star changes land on top of each other rather than merely
    // near each other — no glyph size can separate them. Collapse them into
    // one counted marker anchored at that origin instead (LIN-2089).
    var starCount = 0;
    for (var b = 0; b < revealed.length; b++) {
      if (breakBefore[b]) starCount++;
    }

    // The origin is the ★'s anchor but is never itself a plotted waypoint, so
    // it has to be unioned into the fitted box explicitly — otherwise a long
    // single-direction walk fits a box the origin sits outside, and the ★
    // renders beyond the viewBox edge (the live clip LIN-2089 measured at
    // 34.8px outside the SVG's own client rect).
    var fitted = starCount > 0 ? revealed.concat([{ x: 0, y: 0 }]) : revealed;
    var box = boundingBox(fitted);
    var contentWidth = Math.max(1, box.maxX - box.minX + 2 * DOT_REACH);
    var contentHeight = Math.max(1, box.maxY - box.minY + 2 * DOT_REACH);
    var zoom = window.computeFitZoom({
      contentWidth: contentWidth,
      contentHeight: contentHeight,
      availWidth: 200,
      availHeight: 200,
      pad: 10,
      minZoom: 0.15,
      maxZoom: 4,
    });

    // computeFitZoom only sizes content to the viewport — it does not centre
    // it. The walk starts at the origin but is not centred on it (e.g. every
    // waypoint on the same bearing drifts off to one side), so scaling about
    // the origin alone pushes the outermost points outside
    // viewBox="-100 -100 200 200". Pair the scale with a
    // translate that maps the bounding-box centre to the viewBox centre (0,0)
    // — same pattern as public/ship.js:1493's translate(...) scale(...), just
    // in SVG's user-space units instead of CSS pixels (LIN-1970 defect 2).
    var boxCenterX = (box.minX + box.maxX) / 2;
    var boxCenterY = (box.minY + box.maxY) / 2;
    var translateX = -zoom * boxCenterX;
    var translateY = -zoom * boxCenterY;

    var g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', 'translate(' + translateX + ',' + translateY + ') scale(' + zoom + ')');
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

      var circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(p.x));
      circle.setAttribute('cy', String(p.y));
      circle.setAttribute('r', String(WAYPOINT_RADIUS));
      circle.setAttribute('class', 'sj-waypoint');
      circle.setAttribute('data-testid', 'ship-journey-waypoint');
      circle.setAttribute('data-identifier', wp.identifier);
      circle.setAttribute('data-bearing', wp.bearing);
      g.appendChild(circle);
    }

    svg.appendChild(g);

    if (starCount > 0) {
      // Deliberately a SIBLING of `g`, not a child: the dots and trail belong
      // inside the zoomed group (that is what keeps the mark:step ratio
      // scale-invariant), but the ★ has to stay a constant size on screen, so
      // it lives in the unscaled outer viewBox and takes its font-size in
      // those units. Do not "tidy" it back into `g` — a counter-scale on a
      // zoomed child would need a transform-origin correction to match.
      // Its screen position is zoom*(0,0) + translate, which reduces to the
      // translate itself. Containment rides on computeFitZoom's pad: 10 above,
      // which reserves a 10-unit margin between the fitted box and the ±100
      // viewBox edge — comfortably more than this glyph's own ~3.6-unit reach,
      // GIVEN the origin was unioned into that box. Both halves are load-
      // bearing; changing either reopens the clip.
      var flag = document.createElementNS(SVG_NS, 'text');
      flag.setAttribute('x', String(translateX));
      flag.setAttribute('y', String(translateY));
      flag.setAttribute('class', 'sj-star-marker');
      flag.setAttribute('data-testid', 'ship-journey-star-marker');
      flag.textContent = starCount === 1 ? '★' : '★×' + starCount;
      svg.appendChild(flag);
    }
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
