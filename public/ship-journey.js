/**
 * Ship Journey client (experimental, LIN-1675 P3/P5/P7).
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
 * paint from the bounding box of the currently REVEALED points (plus the
 * ship's own in-progress position), so the view zooms out as playback
 * advances and more of the trail comes into frame.
 *
 * Marker geometry is stated as a ratio against that one-unit step (LIN-2089):
 * a waypoint's PAINTED mark (2r plus its halo stroke) stays under 80% of the
 * step, so adjacent waypoints read as beads on a thread rather than merging
 * into a blob. The ratio is scale-invariant — dots and trail live inside the
 * zoomed <g>, so they shrink and grow with the fit exactly as the step does.
 * The ★ (and, since P7, the ship glyph) deliberately does the opposite (see
 * paint()).
 *
 * P7 (LIN-2067) replaced the old teardown-and-rebuild `render()` with a
 * build-once structure (`ensureStructure()`) plus an in-place keyed reconcile
 * (`paint(position)`): retained trail/waypoint nodes keep their identity
 * across updates (culled nodes are `node.remove()`d, never merely hidden —
 * the e2e suite's waypoint-count assertions inspect DOM node counts), and a
 * ship glyph tracks a float `position` — `currentIndex` stays the single
 * source of reveal truth, `position`'s fractional part is transient
 * sub-waypoint tween state only, reset to the integer index on every seek.
 * Standard motion drives `position` continuously via requestAnimationFrame;
 * `prefers-reduced-motion` keeps the original per-waypoint step cadence, but
 * through this same reconcile (never a rebuild) so any future focusable
 * per-waypoint node survives every step.
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
  // split this file already uses for the waypoint's fill and testids). The
  // ship glyph (P7) is deliberately NOT part of this hand-sync contract — its
  // stroke width is CSS-only, with no matching JS constant.
  var WAYPOINT_RADIUS = 0.32;
  var WAYPOINT_HALO = 0.1; // .sj-waypoint stroke-width
  var TRAIL_STROKE = 0.08; // .sj-trail-segment stroke-width
  // How far a dot actually paints beyond its own centre: the fill radius plus
  // half its centred halo stroke. Replaces LIN-1675 P3's blanket 6-unit
  // MARKER_PAD, which padded the content box by six whole steps.
  var DOT_REACH = WAYPOINT_RADIUS + WAYPOINT_HALO / 2;

  // A simple sailboat silhouette (hull + sail), centred on its own origin, in
  // outer-viewBox units — same scale class as the ★'s 6px font-size (P7 /
  // LIN-2067). The exact shape is a reversible rendering choice (Q3 ruling,
  // 2026-08-13), not locked by any test; heading/rotation is explicitly out
  // of scope for this phase.
  var SHIP_GLYPH_PATH = 'M -2.4,0.2 L 2.4,0.2 L 1.6,2 L -1.6,2 Z M 0,-3.2 L 0.2,0.2 L -1.8,0.2 Z';

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

  // Guarded per the house idiom (public/live-console.js:46) so the
  // vm-sandboxed geometry unit test (`window: {}`) never throws — declared
  // below both early returns above, though the `!svg` return already makes
  // that test never reach this line at all; the guard is defense in depth.
  var REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // ── Keyed-reconcile state (P7 / LIN-2067) ─────────────────────────────────
  // `g` is created once by ensureStructure() and only its `transform` is
  // mutated thereafter. `dotNodes`/`segNodes` are index-keyed Maps (house
  // pattern: public/live-console.js:87-89, public/next-run.js:239-280) so
  // retained nodes keep identity across paints; culled nodes are
  // `node.remove()`d, never hidden. `starNode`/`shipNode` are lazily-created
  // singletons, siblings of `g`, outside the zoomed group (like the ★) so
  // they stay a constant size on screen at any fit zoom.
  var g = null;
  var dotNodes = new Map();
  var segNodes = new Map();
  var starNode = null;
  var shipNode = null;

  // `currentIndex` is the single source of reveal truth (gates scrub.value,
  // clamping, bounds). `position` is transient float tween state — reset to
  // the integer `currentIndex` on every seek, and can only diverge from it
  // during an active play() tween between two seeks.
  var currentIndex = waypoints.length - 1; // start fully revealed, matching the server-rendered scrub value
  var position = currentIndex;

  var playing = false;
  var playTimer = null; // reduced-motion stepped cadence
  var rafId = null; // standard-motion continuous tween
  var lastFrameTime = null;

  function ensureStructure() {
    g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-testid', 'ship-journey-trail');
    svg.appendChild(g);
  }

  function paint(pos) {
    var revealIndex = Math.max(0, Math.min(waypoints.length - 1, Math.floor(pos)));
    var revealed = points.slice(0, revealIndex + 1);
    var frac = pos - Math.floor(pos);

    // Interpolation is suppressed across a breakBefore boundary — the ship
    // snaps to the pre-break waypoint rather than tweening across the gap,
    // consistent with the trail's own segment split below.
    var canTween = frac > 0 && revealIndex + 1 < points.length && !breakBefore[revealIndex + 1];
    var shipPoint = points[revealIndex];
    if (canTween) {
      var next = points[revealIndex + 1];
      shipPoint = {
        x: shipPoint.x + (next.x - shipPoint.x) * frac,
        y: shipPoint.y + (next.y - shipPoint.y) * frac,
      };
    }

    // Every segment break resets the walk to a fresh berth one unit from the
    // shared origin (lib/ship-journey.js's derivePositions), so ★ markers for
    // *different* star changes land on top of each other rather than merely
    // near each other — no glyph size can separate them. Collapse them into
    // one counted marker anchored at that origin instead (LIN-2089).
    var starCount = 0;
    for (var b = 0; b <= revealIndex; b++) {
      if (breakBefore[b]) starCount++;
    }

    // The ★ anchors at the origin, which is never itself a plotted waypoint, so
    // a walk heading away from the berth fits a box the origin falls outside.
    // Union it (and the ship's own in-progress point) in so the fit is honest
    // about everything it has to contain.
    var fitted = revealed.concat([shipPoint]);
    if (starCount > 0) fitted = fitted.concat([{ x: 0, y: 0 }]);
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

    g.setAttribute('transform', 'translate(' + translateX + ',' + translateY + ') scale(' + zoom + ')');

    // Waypoint dots — keyed by array index, in place, never rebuilt. Cull
    // anything beyond the revealed prefix first (a seek can move backward).
    for (var key of Array.from(dotNodes.keys())) {
      if (key > revealIndex) { dotNodes.get(key).remove(); dotNodes.delete(key); }
    }
    for (var idx = 0; idx <= revealIndex; idx++) {
      var p = points[idx];
      var circle = dotNodes.get(idx);
      if (!circle) {
        var wp = waypoints[idx];
        circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('r', String(WAYPOINT_RADIUS));
        circle.setAttribute('class', 'sj-waypoint');
        circle.setAttribute('data-testid', 'ship-journey-waypoint');
        circle.setAttribute('data-identifier', wp.identifier);
        circle.setAttribute('data-bearing', wp.bearing);
        g.appendChild(circle);
        dotNodes.set(idx, circle);
      }
      circle.setAttribute('cx', String(p.x));
      circle.setAttribute('cy', String(p.y));
    }

    // Trail segments — path d's are broken wherever a north-star change falls
    // between two consecutive revealed waypoints, keyed by segment-start
    // index so a segment already closed by a break keeps its identity and is
    // never rebuilt once it stops changing. The trailing (still-open) segment
    // additionally tracks the ship's own tween point, so the trail's tip
    // visibly leads into the ship rather than stopping dead at the last dot.
    var wantedSegs = new Set();
    var segStart = 0;
    for (var i2 = 1; i2 <= revealIndex + 1; i2++) {
      if (i2 === revealIndex + 1 || breakBefore[i2]) {
        var segPoints = points.slice(segStart, i2);
        if (i2 === revealIndex + 1 && canTween) segPoints = segPoints.concat([shipPoint]);
        if (segPoints.length > 1) {
          wantedSegs.add(segStart);
          var d = 'M ' + segPoints.map(function (pt) { return pt.x + ',' + pt.y; }).join(' L ');
          var path = segNodes.get(segStart);
          if (!path) {
            path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('class', 'sj-trail-segment');
            g.appendChild(path);
            segNodes.set(segStart, path);
          }
          path.setAttribute('d', d);
        }
        segStart = i2;
      }
    }
    for (var segKey of Array.from(segNodes.keys())) {
      if (!wantedSegs.has(segKey)) { segNodes.get(segKey).remove(); segNodes.delete(segKey); }
    }

    // ★ star-change marker — deliberately a SIBLING of `g`, not a child: the
    // dots and trail belong inside the zoomed group (that is what keeps the
    // mark:step ratio scale-invariant), but the ★ has to stay a constant size
    // on screen, so it lives in the unscaled outer viewBox. Removed (not
    // hidden) once a seek un-reveals its star change.
    if (starCount > 0) {
      if (!starNode) {
        starNode = document.createElementNS(SVG_NS, 'text');
        starNode.setAttribute('class', 'sj-star-marker');
        starNode.setAttribute('data-testid', 'ship-journey-star-marker');
        svg.appendChild(starNode);
      }
      starNode.textContent = starCount === 1 ? '★' : '★×' + starCount;
      starNode.setAttribute('x', String(translateX));
      starNode.setAttribute('y', String(translateY));
    } else if (starNode) {
      starNode.remove();
      starNode = null;
    }

    // Ship glyph — same outer-viewBox rationale as the ★. Always present once
    // playback has anything revealed (P7 / LIN-2067); own additive testid, no
    // JS-declared stroke (keeps it out of the CSS/JS hand-sync contract).
    if (!shipNode) {
      shipNode = document.createElementNS(SVG_NS, 'path');
      shipNode.setAttribute('class', 'sj-ship-marker');
      shipNode.setAttribute('data-testid', 'ship-journey-ship');
      shipNode.setAttribute('d', SHIP_GLYPH_PATH);
      svg.appendChild(shipNode);
    }
    var shipScreenX = translateX + zoom * shipPoint.x;
    var shipScreenY = translateY + zoom * shipPoint.y;
    shipNode.setAttribute('transform', 'translate(' + shipScreenX + ',' + shipScreenY + ')');
  }

  // Advances `position`, keeping `currentIndex` (the reveal-truth int) and
  // the scrub mirror in step whenever the floor crosses a waypoint boundary,
  // then repaints. Used by both the rAF loop and the reduced-motion interval.
  function applyPosition(rawPosition) {
    position = Math.max(0, Math.min(waypoints.length - 1, rawPosition));
    var floored = Math.floor(position);
    if (floored !== currentIndex) {
      currentIndex = floored;
      if (scrub) scrub.value = String(currentIndex);
    }
    paint(position);
  }

  function setIndex(next) {
    currentIndex = Math.max(0, Math.min(waypoints.length - 1, next));
    position = currentIndex; // every seek snaps the tween — nothing can strand the ship mid-frame
    if (scrub) scrub.value = String(currentIndex);
    paint(position);
  }

  function stop() {
    playing = false;
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    lastFrameTime = null;
    if (playBtn) { playBtn.setAttribute('aria-pressed', 'false'); playBtn.textContent = '▶'; }
  }

  function rafStep(now) {
    if (!playing) return;
    if (lastFrameTime === null) lastFrameTime = now;
    var elapsed = now - lastFrameTime;
    lastFrameTime = now;
    applyPosition(position + elapsed / 700);
    if (position >= waypoints.length - 1) { stop(); return; }
    rafId = requestAnimationFrame(rafStep);
  }

  function play() {
    if (currentIndex >= waypoints.length - 1) applyPosition(0); // replay from the start
    if (playBtn) { playBtn.setAttribute('aria-pressed', 'true'); playBtn.textContent = '⏸'; }
    playing = true;
    if (REDUCED_MOTION) {
      // Same paint() reconcile as standard motion — only the cadence differs
      // (discrete +1 per 700ms tick instead of a continuous tween), so any
      // future focusable per-node identity survives every reduced-motion
      // step (mirrors public/live-console.js:1089-1093's REDUCED_MOTION
      // branch: one deterministic paint per tick, no rAF).
      playTimer = setInterval(function () {
        if (!playing) return;
        applyPosition(position + 1);
        if (position >= waypoints.length - 1) stop();
      }, 700);
    } else {
      lastFrameTime = null;
      rafId = requestAnimationFrame(rafStep);
    }
  }

  if (playBtn) {
    playBtn.addEventListener('click', function () {
      if (playing) stop(); else play();
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

  ensureStructure();
  paint(position);
})();
