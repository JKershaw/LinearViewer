/**
 * Ship Journey client (experimental, LIN-1675 P3/P5/P7/P8).
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
 * connecting line across the change) but the walk itself continues from
 * wherever it already is — it does not reset to a fresh berth (LIN-2956).
 * Because each break now lands at its own distinct junction on the trail
 * rather than colliding at a shared origin, the ★ markers are drawn one per
 * junction, keyed by break index, rather than collapsed into a single counted
 * marker (reverting LIN-2089's collapse, which only existed because every
 * break shared one origin).
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
 * P8 (LIN-2068) adds waypoint identity + run provenance inside this same
 * keyed reconcile: each waypoint `<circle>` becomes the repo's first
 * focusable/labelled SVG node (`tabindex`, `role="img"`, an `aria-label` +
 * nested `<title>` built from its already-embedded `identifier`/`title`/
 * `topic`/`reason`/`source`), a reveal-on-focus/hover text label lives in its
 * own declared layer keyed by the same index, and the dot's fill colour
 * carries run provenance via `data-source-rank` — a small 4-token ramp keyed
 * by each source run's first-appearance order, never a path segmentation
 * (runs interleave). All of it is set once at create time; `paint()` still
 * only mutates position-related attributes on repaint, and a focused
 * waypoint culled by backward scrub or replay-to-start has its focus
 * reassigned to the new leading waypoint rather than losing it to `<body>`.
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

  // ── Keyed-reconcile state (P7 / LIN-2067; starNodes added LIN-2956) ───────
  // `g` is created once by ensureStructure() and only its `transform` is
  // mutated thereafter. `dotNodes`/`segNodes`/`starNodes` are index-keyed Maps
  // (house pattern: public/live-console.js:87-89, public/next-run.js:239-280)
  // so retained nodes keep identity across paints; culled nodes are
  // `node.remove()`d, never hidden. `starNodes` is keyed by break index (one
  // ★ per revealed junction); `shipNode` is a lazily-created singleton,
  // sibling of `g`, outside the zoomed group (like the ★s) so it stays a
  // constant size on screen at any fit zoom.
  //
  // Paint order inside SVG is document order — there is no z-index. Review
  // (LIN-2067 F1/F2) found the original code left that order to node
  // *creation* order (segments/dots appended to `g` as they happened to be
  // created; star/ship appended to `svg` as they happened to be created),
  // which (a) let the trail paint over the waypoint halos, breaking the
  // LIN-2089 "beads on a thread" cut, and (b) let the ★/ship sibling order
  // flip after a seek re-created the star node. `trailLayer`/`dotLayer` and
  // `starLayer`/`shipLayer` are persistent, empty layer groups created once
  // in ensureStructure() in the declared paint order (trail below dots;
  // star below ship) — every segment/dot/star/ship node is appended into
  // its own layer, never directly into `g`/`svg`, so recreation after a cull
  // can never change which layer (and therefore which paint order) it lands
  // in.
  var g = null;
  var trailLayer = null;
  var dotLayer = null;
  var starLayer = null;
  var shipLayer = null;
  var labelLayer = null;
  var dotNodes = new Map();
  var segNodes = new Map();
  var starNodes = new Map();
  var labelNodes = new Map();
  var shipNode = null;

  // The idx of a waypoint that just blurred straight into one of the three
  // playback buttons (P8 / LIN-2068, narrowed LIN-2962), consumed exactly
  // once by the next paint() call. A playback control is a <button>: the
  // browser's mousedown default action moves focus to it (firing the
  // circle's own blur/focusout) BEFORE the button's `click` listener runs —
  // so by the time that listener calls paint(), document.activeElement is
  // already the button, not the waypoint that was focused a moment ago. The
  // delegated focusout handler below observes the blur synchronously, in the
  // same task, before paint() runs, so this is read (and reset) at the top
  // of paint() instead of trusting document.activeElement alone.
  //
  // Narrowed via e.relatedTarget to arm ONLY for that one button-steal case
  // (LIN-2962 F2): the original shipped version recorded every waypoint
  // blur, wherever focus was going, cleared only by the next paint() — so a
  // legitimate blur to the scrub control (or anywhere else) left this idx
  // armed, and any later paint() with a lower revealIndex yanked focus back
  // into the map out from under the control the user had actually moved to
  // (breaking keyboard scrubbing). The read side in paint() is unchanged;
  // only this write is now conditional on relatedTarget being one of
  // playBtn/stepBackBtn/stepForwardBtn.
  var lastBlurredWaypointIdx = null;

  // Waypoint identity/provenance (P8 / LIN-2068). `runRank` is a plain
  // ordinal lookup off already-embedded `waypoints[idx].source.id` — a run's
  // first-appearance rank among distinct source ids, computed once here (same
  // "underlying data never changes during playback" placement as
  // breakBefore above), never mutated after this one pass, and never a second
  // copy of run metadata. RUN_COLOR_COUNT bounds the provenance colour ramp
  // to the 4 semantic tokens that carry no status meaning elsewhere
  // (public/ship-journey.css).
  var runRank = {};
  var runRankCount = 0;
  for (var ri = 0; ri < waypoints.length; ri++) {
    var sid = waypoints[ri].source && waypoints[ri].source.id;
    if (sid != null && !(sid in runRank)) { runRank[sid] = runRankCount++; }
  }
  var RUN_COLOR_COUNT = 4;

  // Builds the waypoint's accessible name (SVG <title> hover text AND
  // aria-label) from fields already embedded on the client — tolerant of the
  // nulls deriveWaypoints's contract allows (no project, no persisted reason).
  function buildAccessibleLabel(wp) {
    var parts = [wp.identifier];
    if (wp.title) parts.push(wp.title);
    var head = parts.join(' — ');
    if (wp.topic) head += ' (' + wp.topic + ')';
    var sentence = head + '.';
    if (wp.reason) sentence += ' ' + wp.reason;
    if (wp.source && wp.source.id) {
      sentence += ' From run ' + wp.source.id;
      if (wp.source.generatedAt) sentence += ' (' + wp.source.generatedAt + ')';
      sentence += '.';
    }
    return sentence;
  }

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

    // Declared paint order, established once: trail below dots inside `g`
    // (both live inside the zoomed group); star below ship as siblings of
    // `g` in the outer viewBox. Appending trailLayer/dotLayer/starLayer/
    // shipLayer in this order fixes the layering for the lifetime of the
    // page — content nodes are always appended into their own layer, so no
    // later creation/removal can move them relative to another layer.
    trailLayer = document.createElementNS(SVG_NS, 'g');
    dotLayer = document.createElementNS(SVG_NS, 'g');
    g.appendChild(trailLayer);
    g.appendChild(dotLayer);

    starLayer = document.createElementNS(SVG_NS, 'g');
    shipLayer = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(starLayer);
    svg.appendChild(shipLayer);

    // Waypoint label layer (P8 / LIN-2068): appended last, so revealed labels
    // paint on top of everything else. A sibling of `g`, not a child — like
    // the ★/ship, a revealed label must stay a constant on-screen size at any
    // fit zoom, positioned via the same translate+zoom transform as those.
    labelLayer = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(labelLayer);
  }

  function paint(pos) {
    var revealIndex = Math.max(0, Math.min(waypoints.length - 1, Math.floor(pos)));
    var revealed = points.slice(0, revealIndex + 1);
    var frac = pos - Math.floor(pos);

    // Focus-preserving reassignment on cull (P8 / LIN-2068): determine which
    // waypoint (if any) was focused just before this paint(), so the dot-cull
    // loop below never silently drops focus to <body>. document.activeElement
    // is checked first (covers a hypothetical direct paint() with no
    // intervening blur), falling back to lastBlurredWaypointIdx — the actual
    // case for both residual paths the research found (step-back/backward
    // scrub and play()'s replay-to-start applyPosition(0) wipe): both are
    // triggered by clicking a <button>, whose mousedown default action moves
    // focus to the button (blurring the circle) before its `click` listener
    // (and therefore this paint() call) ever runs. One-shot: reset
    // immediately so a later, unrelated paint() never reuses a stale blur.
    var prevFocusedIdx = null;
    var activeEl = document.activeElement;
    if (activeEl && activeEl.getAttribute && activeEl.getAttribute('data-testid') === 'ship-journey-waypoint') {
      prevFocusedIdx = parseInt(activeEl.getAttribute('data-idx'), 10);
    } else if (lastBlurredWaypointIdx !== null) {
      prevFocusedIdx = lastBlurredWaypointIdx;
    }
    lastBlurredWaypointIdx = null;

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

    // Every revealed break now lands at its own junction point on the trail
    // (lib/ship-journey.js's derivePositions no longer resets to a shared
    // origin, LIN-2956), so each already sits inside the revealed points —
    // no separate union is needed to keep the fit honest (contrast LIN-2089's
    // origin-union, removed along with the collapsed marker it existed for).
    var fitted = revealed.concat([shipPoint]);
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
        // Identity/provenance/accessible-name attributes (P8 / LIN-2068), set
        // ONCE here at create time — paint()'s per-frame work below this
        // create-branch only ever mutates cx/cy, so a focused waypoint is
        // never rebuilt (the LIN-1566 lesson). This is the first client of
        // the title/topic/reason/source fields P6 (LIN-2066) embedded: at
        // the reference workspace's 121 waypoints, worst case is already
        // ≈35-45KB of inline JSON shipped on every page load regardless of
        // what renders here (LIN-2066 close-out ledger item 4) — this step
        // adds render cost, not payload.
        circle.setAttribute('tabindex', '0');
        circle.setAttribute('role', 'img');
        circle.setAttribute('data-idx', String(idx));
        circle.setAttribute('data-source-run', wp.source ? wp.source.id : '');
        var rank = wp.source && wp.source.id != null ? runRank[wp.source.id] % RUN_COLOR_COUNT : 0;
        circle.setAttribute('data-source-rank', String(rank));
        var label = buildAccessibleLabel(wp);
        circle.setAttribute('aria-label', label);
        var titleEl = document.createElementNS(SVG_NS, 'title');
        titleEl.textContent = label;
        circle.appendChild(titleEl);
        dotLayer.appendChild(circle);
        dotNodes.set(idx, circle);
      }
      circle.setAttribute('cx', String(p.x));
      circle.setAttribute('cy', String(p.y));
    }

    // Waypoint labels — reveal-on-focus/hover, in their own declared layer
    // (P8 / LIN-2068). Keyed by the same index and culled in the same
    // revealIndex pass as the dots above so the two node sets never disagree
    // on which indices exist. Positioned via the same translate+zoom
    // transform as the ★/ship (outer-viewBox units, constant on-screen size).
    for (var labelKey of Array.from(labelNodes.keys())) {
      if (labelKey > revealIndex) { labelNodes.get(labelKey).remove(); labelNodes.delete(labelKey); }
    }
    for (var lidx = 0; lidx <= revealIndex; lidx++) {
      var lp = points[lidx];
      var lbl = labelNodes.get(lidx);
      if (!lbl) {
        var lwp = waypoints[lidx];
        lbl = document.createElementNS(SVG_NS, 'text');
        lbl.setAttribute('class', 'sj-waypoint-label');
        lbl.setAttribute('data-testid', 'ship-journey-waypoint-label');
        lbl.setAttribute('data-idx', String(lidx));
        lbl.setAttribute('data-revealed', 'false');
        lbl.textContent = lwp.title || lwp.identifier;
        labelLayer.appendChild(lbl);
        labelNodes.set(lidx, lbl);
      }
      lbl.setAttribute('x', String(translateX + zoom * lp.x));
      lbl.setAttribute('y', String(translateY + zoom * lp.y));
    }

    // Reassign focus to the new leading waypoint if the previously-focused
    // one was just culled, rather than letting it fall to <body> (P8 /
    // LIN-2068). {preventScroll: true} — this is a programmatic refocus the
    // user did not directly request (they clicked a different control), so
    // an unrequested page scroll on top of a culled node would be more
    // disorienting than the focus loss it fixes.
    if (prevFocusedIdx !== null && prevFocusedIdx > revealIndex) {
      var leading = dotNodes.get(revealIndex);
      if (leading) leading.focus({ preventScroll: true });
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
            trailLayer.appendChild(path);
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

    // ★ star-change markers — one per revealed junction, keyed by break index
    // (LIN-2956; reverts LIN-2089's single counted marker, which only made
    // sense while every break shared one origin). Deliberately SIBLINGS of
    // `g`, not children: the dots and trail belong inside the zoomed group
    // (that is what keeps the mark:step ratio scale-invariant), but a ★ has
    // to stay a constant size on screen, so it lives in the unscaled outer
    // viewBox — positioned via the SAME translate+zoom transform as the ship
    // glyph below, anchored to its own junction point rather than the origin.
    // Culled (not hidden) once a seek un-reveals its star change, same
    // discipline as dotNodes/segNodes.
    for (var starKey of Array.from(starNodes.keys())) {
      if (starKey > revealIndex) { starNodes.get(starKey).remove(); starNodes.delete(starKey); }
    }
    for (var bi = 1; bi <= revealIndex; bi++) {
      if (!breakBefore[bi]) continue;
      var star = starNodes.get(bi);
      if (!star) {
        star = document.createElementNS(SVG_NS, 'text');
        star.setAttribute('class', 'sj-star-marker');
        star.setAttribute('data-testid', 'ship-journey-star-marker');
        star.textContent = '★';
        starLayer.appendChild(star);
        starNodes.set(bi, star);
      }
      var junction = points[bi];
      star.setAttribute('x', String(translateX + zoom * junction.x));
      star.setAttribute('y', String(translateY + zoom * junction.y));
    }

    // Ship glyph — same outer-viewBox rationale as the ★. Always present once
    // playback has anything revealed (P7 / LIN-2067); own additive testid, no
    // JS-declared stroke (keeps it out of the CSS/JS hand-sync contract).
    if (!shipNode) {
      shipNode = document.createElementNS(SVG_NS, 'path');
      shipNode.setAttribute('class', 'sj-ship-marker');
      shipNode.setAttribute('data-testid', 'ship-journey-ship');
      shipNode.setAttribute('d', SHIP_GLYPH_PATH);
      shipLayer.appendChild(shipNode);
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

  // Reveal-on-focus/hover for waypoint labels (P8 / LIN-2068), delegated on
  // the persistent `svg` rather than per-node — the house pattern (LIN-1566 /
  // next-run.js's delegated direction-chip listener) so the binding survives
  // every repaint regardless of which dot nodes get culled/recreated.
  // focusin/focusout/pointerover/pointerout all bubble (unlike
  // focus/blur/pointerenter/pointerleave), which delegation requires.
  function toggleLabel(target, revealed) {
    var circle = target.closest && target.closest('[data-testid="ship-journey-waypoint"]');
    if (!circle) return;
    var idx = parseInt(circle.getAttribute('data-idx'), 10);
    var lbl = labelNodes.get(idx);
    if (lbl) lbl.setAttribute('data-revealed', revealed ? 'true' : 'false');
  }
  svg.addEventListener('focusin', function (e) { toggleLabel(e.target, true); });
  svg.addEventListener('focusout', function (e) {
    // toggleLabel is unconditional — label reveal is a separate concern from
    // the focus-restoration fallback below and must not be coupled to it.
    toggleLabel(e.target, false);
    // See lastBlurredWaypointIdx's declaration: this fires synchronously,
    // still inside the same task as (and before) a playback button's `click`
    // listener, which is the only way paint() otherwise learns a waypoint
    // was focused right before a button-triggered cull stole its focus.
    // e.relatedTarget is the native, platform-supplied "where focus is
    // going" field for a blur/focusout — restricting the write to it (rather
    // than recording every waypoint blur) is what keeps this fallback from
    // arming on a legitimate blur to the scrub control or anywhere else.
    var circle = e.target.closest && e.target.closest('[data-testid="ship-journey-waypoint"]');
    if (circle && (e.relatedTarget === playBtn || e.relatedTarget === stepBackBtn || e.relatedTarget === stepForwardBtn)) {
      var idx = parseInt(circle.getAttribute('data-idx'), 10);
      if (!isNaN(idx)) lastBlurredWaypointIdx = idx;
    }
  });
  svg.addEventListener('pointerover', function (e) { toggleLabel(e.target, true); });
  svg.addEventListener('pointerout', function (e) { toggleLabel(e.target, false); });

  ensureStructure();
  paint(position);
})();
